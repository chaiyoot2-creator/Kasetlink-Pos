import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { HttpError } from '../errors.js'
import { guardTerm, query, transaction, type BatchOp, type Row } from '../gate.js'
import type { AppEnv } from '../app-env.js'
import { nextBarcode, nextCustomerCode, nextSku, withCodeRetry } from '../codes.js'
import { bangkokMonth } from '../invoice.js'
import { allocate, loadOpenBills, summarize } from '../receivables.js'
import { eventInsertSql, eventParams } from '../stock.js'
import { bool, counterBumpSql, docNoSql, eventEnvelope, money, num, round2, str, strOrNull, uuid } from '../util.js'

export const masterRoutes = new Hono<AppEnv>()

// ---------------------------------------------------------------- settings

export const DEFAULT_LEVEL_NAMES = ['ปลีก', 'ส่ง', 'สมาชิก', 'ส่งพิเศษ', 'ตัวแทน']

/** Level names arrive as JSON text (`to_json(price_level_names)`) to avoid driver array formats. */
function levelNames(r: Row | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(r ? str(r, 'level_names_json') : '')
    if (Array.isArray(parsed) && parsed.length === 5) return parsed.map((v) => String(v))
  } catch {
    // fall through to defaults
  }
  return [...DEFAULT_LEVEL_NAMES]
}

function mapSettings(r: Row | undefined) {
  return {
    priceLevelNames: levelNames(r),
    shopName: r ? str(r, 'shop_name') : 'ร้านอาหารสัตว์',
    address: r ? strOrNull(r, 'address') : null,
    phone: r ? strOrNull(r, 'phone') : null,
    taxId: r ? strOrNull(r, 'tax_id') : null,
    promptpayId: r ? strOrNull(r, 'promptpay_id') : null,
    receiptFooter: r ? strOrNull(r, 'receipt_footer') : null,
    expiryAlertDays: r ? num(r, 'expiry_alert_days') : 30,
    branchCode: r ? str(r, 'branch_code') || '00000' : '00000',
  }
}

function mapLocation(r: Row) {
  return {
    id: str(r, 'id'),
    code: str(r, 'code'),
    name: str(r, 'name'),
    kind: str(r, 'kind'),
    isActive: bool(r, 'is_active'),
  }
}

masterRoutes.get('/bootstrap', async (c) => {
  const ctx = c.get('ctx')
  const [settings, locations, terminals] = await Promise.all([
    query(ctx, 'SELECT *, to_json(price_level_names)::text AS level_names_json FROM shop_settings LIMIT 1'),
    query(ctx, 'SELECT * FROM locations ORDER BY kind DESC, code'),
    query(ctx, 'SELECT id, name, location_id FROM terminals ORDER BY name'),
  ])
  return c.json({
    me: { userId: ctx.userId, orgId: ctx.orgId, orgRole: ctx.orgRole },
    stage: ctx.stage,
    settings: mapSettings(settings[0]),
    locations: locations.map(mapLocation),
    terminals: terminals.map((r) => ({
      id: str(r, 'id'),
      name: str(r, 'name'),
      locationId: strOrNull(r, 'location_id'),
    })),
  })
})

const settingsSchema = z.object({
  shopName: z.string().trim().min(1).max(120),
  address: z.string().trim().max(400).nullish(),
  phone: z.string().trim().max(40).nullish(),
  taxId: z.string().trim().max(20).nullish(),
  promptpayId: z
    .string()
    .trim()
    .regex(/^(\d{10}|\d{13}|\d{15})$/, 'พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขประจำตัว 13 หลัก')
    .nullish()
    .or(z.literal('')),
  receiptFooter: z.string().trim().max(400).nullish(),
  expiryAlertDays: z.number().int().min(0).max(365),
  priceLevelNames: z.array(z.string().trim().min(1).max(30)).length(5).default(DEFAULT_LEVEL_NAMES),
  branchCode: z.string().trim().regex(/^\d{5}$/, 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)').default('00000'),
})

masterRoutes.put('/settings', async (c) => {
  const ctx = c.get('ctx')
  const b = settingsSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `INSERT INTO shop_settings (shop_name, address, phone, tax_id, promptpay_id, receipt_footer, expiry_alert_days,
              price_level_names, vat_registered, branch_code)
            VALUES ($1, $2, $3, $4, $5, $6, $7::int, ARRAY(SELECT jsonb_array_elements_text($8::jsonb)), false, $9)
            ON CONFLICT (org_id) DO UPDATE SET shop_name = EXCLUDED.shop_name, address = EXCLUDED.address,
              phone = EXCLUDED.phone, tax_id = EXCLUDED.tax_id, promptpay_id = EXCLUDED.promptpay_id,
              receipt_footer = EXCLUDED.receipt_footer, expiry_alert_days = EXCLUDED.expiry_alert_days,
              price_level_names = EXCLUDED.price_level_names, vat_registered = false,
              branch_code = EXCLUDED.branch_code, updated_at = now()
            RETURNING *, to_json(price_level_names)::text AS level_names_json`,
      params: [
        b.shopName,
        b.address || null,
        b.phone || null,
        b.taxId || null,
        b.promptpayId || null,
        b.receiptFooter || null,
        b.expiryAlertDays,
        JSON.stringify(b.priceLevelNames),
        b.branchCode,
      ],
    },
  ])
  return c.json(mapSettings(rows?.[0]))
})

// ---------------------------------------------------------------- locations (zones)

const locationSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['store', 'warehouse']),
  isActive: z.boolean().default(true),
})

masterRoutes.post('/locations', async (c) => {
  const ctx = c.get('ctx')
  const b = locationSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `INSERT INTO locations (code, name, kind, is_active) VALUES ($1, $2, $3, $4::boolean) RETURNING *`,
      params: [b.code, b.name, b.kind, b.isActive],
    },
  ])
  return c.json(mapLocation(rows?.[0] ?? {}), 201)
})

masterRoutes.put('/locations/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = locationSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE locations SET code = $2, name = $3, kind = $4, is_active = $5::boolean WHERE id = $1::uuid RETURNING *`,
      params: [id, b.code, b.name, b.kind, b.isActive],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบสาขา/โซน')
  return c.json(mapLocation(rows[0]))
})

// ---------------------------------------------------------------- terminals

const terminalSchema = z.object({
  id: z.string().trim().min(4).max(80),
  name: z.string().trim().min(1).max(80),
  locationId: uuid.nullish(),
})

masterRoutes.put('/terminals', async (c) => {
  const ctx = c.get('ctx')
  const b = terminalSchema.parse(await c.req.json())
  await transaction(ctx, [
    {
      sql: `INSERT INTO terminals (id, name, location_id) VALUES ($1, $2, $3::uuid)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, location_id = EXCLUDED.location_id, last_seen_at = now()`,
      params: [b.id, b.name, b.locationId ?? null],
    },
  ])
  return c.json({ id: b.id, name: b.name, locationId: b.locationId ?? null })
})

// ---------------------------------------------------------------- products

export function mapProduct(r: Row) {
  return {
    id: str(r, 'id'),
    sku: str(r, 'sku'),
    barcode: strOrNull(r, 'barcode'),
    name: str(r, 'name'),
    category: strOrNull(r, 'category'),
    unit: str(r, 'unit'),
    priceLevels: [1, 2, 3, 4, 5].map((n) => num(r, `price_l${n}`)),
    avgCost: num(r, 'avg_cost'),
    reorderPoint: num(r, 'reorder_point'),
    trackExpiry: bool(r, 'track_expiry'),
    isActive: bool(r, 'is_active'),
    qtyTotal: num(r, 'qty_total'),
    qtyHere: num(r, 'qty_here'),
    brandId: strOrNull(r, 'brand_id'),
    brandName: strOrNull(r, 'brand_name'),
    supplierId: strOrNull(r, 'brand_supplier_id'),
    supplierName: strOrNull(r, 'brand_supplier_name'),
    imageUrl: strOrNull(r, 'image_url'),
    weightKg: r.weight_kg === null || r.weight_kg === undefined ? null : num(r, 'weight_kg'),
  }
}

export const PRODUCT_SELECT = `
  SELECT p.*, COALESCE(s.qty_total, 0) AS qty_total, COALESCE(s.qty_here, 0) AS qty_here,
         b.name AS brand_name, b.supplier_id AS brand_supplier_id, su.name AS brand_supplier_name
    FROM products p
    LEFT JOIN (
      SELECT product_id, SUM(qty) AS qty_total,
             SUM(qty) FILTER (WHERE location_id = NULLIF($1, '')::uuid) AS qty_here
        FROM stock_lots GROUP BY product_id
    ) s ON s.product_id = p.id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN suppliers su ON su.id = b.supplier_id`

masterRoutes.get('/products', async (c) => {
  const ctx = c.get('ctx')
  const q = (c.req.query('q') ?? '').trim()
  const locationId = c.req.query('locationId') ?? ''
  if (locationId) uuid.parse(locationId)
  const includeInactive = c.req.query('all') === '1'
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 500)
  // brandId: '' = all, 'none' = products without a brand, otherwise a brand uuid.
  const brandId = c.req.query('brandId') ?? ''
  if (brandId && brandId !== 'none') uuid.parse(brandId)
  const supplierId = c.req.query('supplierId') ?? ''
  if (supplierId) uuid.parse(supplierId)
  const rows = await query(
    ctx,
    `${PRODUCT_SELECT}
      WHERE ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.sku ILIKE $2 || '%' OR p.barcode = $2
             OR p.category ILIKE '%' || $2 || '%' OR b.name ILIKE '%' || $2 || '%')
        AND ($3::boolean OR p.is_active)
        AND ($5 = '' OR ($5 = 'none' AND p.brand_id IS NULL) OR p.brand_id::text = $5)
        AND ($6 = '' OR b.supplier_id::text = $6)
      ORDER BY (p.barcode = $2 OR p.sku = $2) DESC NULLS LAST, p.name
      LIMIT $4::int`,
    [locationId, q, includeInactive, limit, brandId, supplierId],
  )
  return c.json(rows.map(mapProduct))
})

/**
 * Quick picks for the POS screen at one location: best sellers (qty, last 30 days),
 * recently sold, and everything in stock here (best sellers first).
 */
masterRoutes.get('/products/quick', async (c) => {
  const ctx = c.get('ctx')
  const locationId = uuid.parse(c.req.query('locationId'))
  const soldHere = `SELECT sl.product_id, SUM(sl.qty) AS sold_qty, MAX(s2.sold_at) AS last_sold
                      FROM sale_lines sl JOIN sales s2 ON s2.id = sl.sale_id
                     WHERE s2.status = 'completed' AND s2.location_id = $1::uuid
                       AND s2.sold_at > now() - interval '30 days'
                     GROUP BY sl.product_id`
  const [best, recent, inStock] = await Promise.all([
    query(
      ctx,
      `${PRODUCT_SELECT}
        JOIN (${soldHere}) h ON h.product_id = p.id
       WHERE p.is_active
       ORDER BY h.sold_qty DESC, p.name
       LIMIT 12`,
      [locationId],
    ),
    query(
      ctx,
      `${PRODUCT_SELECT}
        JOIN (SELECT sl.product_id, MAX(s2.sold_at) AS last_sold
                FROM sale_lines sl JOIN sales s2 ON s2.id = sl.sale_id
               WHERE s2.status = 'completed' AND s2.location_id = $1::uuid
               GROUP BY sl.product_id) r ON r.product_id = p.id
       WHERE p.is_active
       ORDER BY r.last_sold DESC
       LIMIT 12`,
      [locationId],
    ),
    query(
      ctx,
      `${PRODUCT_SELECT}
        LEFT JOIN (${soldHere}) h ON h.product_id = p.id
       WHERE p.is_active AND COALESCE(s.qty_here, 0) > 0
       ORDER BY COALESCE(h.sold_qty, 0) DESC, p.name
       LIMIT 300`,
      [locationId],
    ),
  ])
  return c.json({ bestSellers: best.map(mapProduct), recent: recent.map(mapProduct), inStock: inStock.map(mapProduct) })
})

/** Exact barcode / SKU lookup for scanners. */
masterRoutes.get('/products/lookup', async (c) => {
  const ctx = c.get('ctx')
  const code = (c.req.query('code') ?? '').trim()
  const locationId = c.req.query('locationId') ?? ''
  if (locationId) uuid.parse(locationId)
  if (!code) throw new HttpError(400, 'กรุณาระบุบาร์โค้ด')
  const rows = await query(
    ctx,
    `${PRODUCT_SELECT} WHERE p.is_active AND (p.barcode = $2 OR p.sku = $2) LIMIT 1`,
    [locationId, code],
  )
  if (!rows[0]) throw new HttpError(404, `ไม่พบสินค้ารหัส ${code}`, 'not_found')
  return c.json(mapProduct(rows[0]))
})

const productSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  barcode: z.string().trim().max(64).nullish(),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(80).nullish(),
  unit: z.string().trim().min(1).max(20),
  /** Prices for levels 1..5; 0 = not set (POS falls back to level 1). */
  priceLevels: z.array(money).length(5),
  reorderPoint: z.number().min(0).max(1_000_000),
  trackExpiry: z.boolean(),
  isActive: z.boolean().default(true),
  brandId: uuid.nullish(),
  /** Weight of one selling unit (sack) for delivery planning; empty = from the name / feed kind. */
  weightKg: z.number().positive().max(10_000).nullish(),
})

function productParams(b: z.infer<typeof productSchema>): unknown[] {
  return [
    b.sku,
    b.barcode || null,
    b.name,
    b.category || null,
    b.unit,
    ...b.priceLevels.map(round2),
    b.reorderPoint,
    b.trackExpiry,
    b.isActive,
    b.brandId ?? null,
    b.weightKg ?? null,
  ]
}

/** Next codes the server would assign, shown as hints in the create forms. */
masterRoutes.get('/next-codes', async (c) => {
  const ctx = c.get('ctx')
  const [sku, barcode, customerCode] = await Promise.all([nextSku(ctx), nextBarcode(ctx), nextCustomerCode(ctx)])
  return c.json({ sku, barcode, customerCode })
})

// On create, an empty SKU or barcode means "generate one" (P00001 / in-store EAN-13).
const productCreateSchema = productSchema.extend({
  sku: z.string().trim().max(40).nullish(),
  autoBarcode: z.boolean().default(true),
})

masterRoutes.post('/products', async (c) => {
  const ctx = c.get('ctx')
  const input = productCreateSchema.parse(await c.req.json())
  const autoSku = !input.sku
  const autoBarcode = !input.barcode && input.autoBarcode
  const row = await withCodeRetry(autoSku || autoBarcode, async () => {
    const b = {
      ...input,
      sku: autoSku ? await nextSku(ctx) : (input.sku ?? ''),
      barcode: autoBarcode ? await nextBarcode(ctx) : input.barcode,
    }
    const [rows] = await transaction(ctx, [
      {
        sql: `INSERT INTO products (sku, barcode, name, category, unit, price_l1, price_l2, price_l3, price_l4,
                price_l5, reorder_point, track_expiry, is_active, brand_id, weight_kg)
              VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::numeric,
                      $12::boolean, $13::boolean, $14::uuid, $15::numeric)
              RETURNING *, 0 AS qty_total, 0 AS qty_here`,
        params: productParams(b),
      },
    ])
    return rows?.[0] ?? {}
  })
  return c.json(mapProduct(row), 201)
})

masterRoutes.put('/products/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = productSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE products SET sku = $1, barcode = $2, name = $3, category = $4, unit = $5,
              price_l1 = $6::numeric, price_l2 = $7::numeric, price_l3 = $8::numeric, price_l4 = $9::numeric,
              price_l5 = $10::numeric, reorder_point = $11::numeric, track_expiry = $12::boolean, is_active = $13::boolean,
              brand_id = $14::uuid, weight_kg = $15::numeric, updated_at = now()
            WHERE id = $16::uuid RETURNING *, 0 AS qty_total, 0 AS qty_here`,
      params: [...productParams(b), id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบสินค้า')
  return c.json(mapProduct(rows[0]))
})

// ---------------------------------------------------------------- brands (แบรนด์ → ผู้จำหน่าย)

function mapBrand(r: Row) {
  return {
    id: str(r, 'id'),
    name: str(r, 'name'),
    supplierId: str(r, 'supplier_id'),
    supplierName: strOrNull(r, 'supplier_name'),
    note: strOrNull(r, 'note'),
    isActive: bool(r, 'is_active'),
    productCount: num(r, 'product_count'),
  }
}

const BRAND_SELECT = `
  SELECT b.*, su.name AS supplier_name,
         (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id) AS product_count
    FROM brands b
    JOIN suppliers su ON su.id = b.supplier_id`

masterRoutes.get('/brands', async (c) => {
  const ctx = c.get('ctx')
  const supplierId = c.req.query('supplierId') ?? ''
  if (supplierId) uuid.parse(supplierId)
  const rows = await query(
    ctx,
    `${BRAND_SELECT}
      WHERE ($1 = '' OR b.supplier_id::text = $1)
      ORDER BY b.is_active DESC, su.name, b.name`,
    [supplierId],
  )
  return c.json(rows.map(mapBrand))
})

const brandSchema = z.object({
  name: z.string().trim().min(1).max(120),
  supplierId: uuid,
  note: z.string().trim().max(400).nullish(),
  isActive: z.boolean().default(true),
})

masterRoutes.post('/brands', async (c) => {
  const ctx = c.get('ctx')
  const b = brandSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `INSERT INTO brands (name, supplier_id, note, is_active) VALUES ($1, $2::uuid, $3, $4::boolean) RETURNING *, 0 AS product_count`,
      params: [b.name, b.supplierId, b.note || null, b.isActive],
    },
  ])
  return c.json(mapBrand(rows?.[0] ?? {}), 201)
})

masterRoutes.put('/brands/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = brandSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE brands SET name = $1, supplier_id = $2::uuid, note = $3, is_active = $4::boolean, updated_at = now()
            WHERE id = $5::uuid RETURNING *, 0 AS product_count`,
      params: [b.name, b.supplierId, b.note || null, b.isActive, id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบแบรนด์')
  return c.json(mapBrand(rows[0]))
})

/** Delete only unused brands; brands with products must be emptied or deactivated instead. */
masterRoutes.delete('/brands/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const rows = await query(ctx, `${BRAND_SELECT} WHERE b.id = $1::uuid`, [id])
  const brand = rows[0]
  if (!brand) throw new HttpError(404, 'ไม่พบแบรนด์')
  const count = num(brand, 'product_count')
  if (count > 0) {
    throw new HttpError(
      409,
      `ลบไม่ได้ — แบรนด์ ${str(brand, 'name')} มีสินค้า ${count} รายการ ให้ย้ายสินค้าไปแบรนด์อื่นก่อน หรือปิดการใช้งานแบรนด์แทน`,
      'brand_in_use',
    )
  }
  await transaction(ctx, [{ sql: 'DELETE FROM brands WHERE id = $1::uuid', params: [id] }])
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- customers

function mapCustomer(r: Row) {
  return {
    id: str(r, 'id'),
    code: str(r, 'code'),
    name: str(r, 'name'),
    phone: strOrNull(r, 'phone'),
    priceLevel: num(r, 'price_level') || 1,
    fixedPriceCount: num(r, 'fixed_price_count'),
    taxId: strOrNull(r, 'tax_id'),
    address: strOrNull(r, 'address'),
    branchCode: strOrNull(r, 'branch_code'),
    sendToAccounting: bool(r, 'send_to_accounting'),
    creditTermDays: num(r, 'credit_term_days'),
    creditLimit: num(r, 'credit_limit'),
    balance: num(r, 'balance'),
    note: strOrNull(r, 'note'),
    isActive: bool(r, 'is_active'),
  }
}

masterRoutes.get('/customers', async (c) => {
  const ctx = c.get('ctx')
  const q = (c.req.query('q') ?? '').trim()
  const debtOnly = c.req.query('debt') === '1'
  const rows = await query(
    ctx,
    `SELECT c.*, (SELECT COUNT(*) FROM customer_prices cp WHERE cp.customer_id = c.id) AS fixed_price_count
       FROM customers c
      WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR code ILIKE $1 || '%' OR phone LIKE '%' || $1 || '%')
        AND (NOT $2::boolean OR balance > 0)
      ORDER BY is_active DESC, name LIMIT 200`,
    [q, debtOnly],
  )
  return c.json(rows.map(mapCustomer))
})

const customerSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).nullish(),
  priceLevel: z.number().int().min(1).max(5),
  creditLimit: money,
  taxId: z
    .string()
    .trim()
    .regex(/^\d{13}$/, 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก')
    .nullish()
    .or(z.literal('')),
  address: z.string().trim().max(400).nullish(),
  branchCode: z.string().trim().max(20).nullish(),
  sendToAccounting: z.boolean().default(false),
  creditTermDays: z.number().int().min(0).max(365).default(30),
  note: z.string().trim().max(400).nullish(),
  isActive: z.boolean().default(true),
})

// On create, an empty code means "generate one" (C00001).
const customerCreateSchema = customerSchema.extend({ code: z.string().trim().max(20).nullish() })

masterRoutes.post('/customers', async (c) => {
  const ctx = c.get('ctx')
  const b = customerCreateSchema.parse(await c.req.json())
  const autoCode = !b.code
  const row = await withCodeRetry(autoCode, async () => {
    const code = autoCode ? await nextCustomerCode(ctx) : (b.code ?? '')
    const [rows] = await transaction(ctx, [
      {
        sql: `INSERT INTO customers (code, name, phone, price_level, credit_limit, note, is_active, tax_id, address,
                branch_code, send_to_accounting, credit_term_days)
              VALUES ($1, $2, $3, $4::smallint, $5::numeric, $6, $7::boolean, $8, $9, $10, $11::boolean, $12::int) RETURNING *`,
        params: [
          code,
          b.name,
          b.phone || null,
          b.priceLevel,
          round2(b.creditLimit),
          b.note || null,
          b.isActive,
          b.taxId || null,
          b.address || null,
          b.branchCode || null,
          b.sendToAccounting,
          b.creditTermDays,
        ],
      },
    ])
    return rows?.[0] ?? {}
  })
  return c.json(mapCustomer(row), 201)
})

masterRoutes.put('/customers/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = customerSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE customers SET code = $1, name = $2, phone = $3, price_level = $4::smallint, credit_limit = $5::numeric,
              note = $6, is_active = $7::boolean, tax_id = $9, address = $10, branch_code = $11,
              send_to_accounting = $12::boolean, credit_term_days = $13::int, updated_at = now()
            WHERE id = $8::uuid RETURNING *`,
      params: [
        b.code,
        b.name,
        b.phone || null,
        b.priceLevel,
        round2(b.creditLimit),
        b.note || null,
        b.isActive,
        id,
        b.taxId || null,
        b.address || null,
        b.branchCode || null,
        b.sendToAccounting,
        b.creditTermDays,
      ],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบลูกค้า')
  return c.json(mapCustomer(rows[0]))
})

masterRoutes.get('/customers/:id/ledger', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [customer, entries, openBills] = await Promise.all([
    query(ctx, 'SELECT * FROM customers WHERE id = $1::uuid', [id]),
    query(
      ctx,
      `SELECT a.id, a.entry_type, a.amount, a.payment_method, a.note, a.created_at, a.receipt_no, s.bill_no
         FROM ar_entries a LEFT JOIN sales s ON s.id = a.ref_id
        WHERE a.customer_id = $1::uuid ORDER BY a.created_at DESC LIMIT 200`,
      [id],
    ),
    loadOpenBills(ctx, id),
  ])
  if (!customer[0]) throw new HttpError(404, 'ไม่พบลูกค้า')
  const summary = summarize(openBills)

  return c.json({
    customer: mapCustomer(customer[0]),
    openBills,
    summary: { outstanding: summary.outstanding, overdue: summary.overdue, unappliedCredit: 0 },
    entries: entries.map((r) => ({
      id: str(r, 'id'),
      entryType: str(r, 'entry_type'),
      amount: num(r, 'amount'),
      paymentMethod: strOrNull(r, 'payment_method'),
      note: strOrNull(r, 'note'),
      billNo: strOrNull(r, 'bill_no'),
      receiptNo: strOrNull(r, 'receipt_no'),
      createdAt: str(r, 'created_at'),
    })),
  })
})

const paymentSchema = z.object({
  ...eventEnvelope,
  zoneId: z.string().min(1).max(80),
  amount: z.number().positive().max(100_000_000),
  method: z.enum(['cash', 'promptpay', 'transfer']),
  note: z.string().trim().max(400).nullish(),
  /** Bills this payment settles, in order (amount optional = up to its outstanding). Empty = oldest first. */
  bills: z
    .array(z.object({ saleId: uuid, amount: z.number().positive().nullish() }))
    .max(100)
    .nullish(),
})

/**
 * รับชำระหนี้: settle the chosen (or oldest) credit bills and issue a receipt
 * (ใบเสร็จรับเงิน) with a gap-free running number RCyyyymm-nnnn.
 */
masterRoutes.post('/customers/:id/payments', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = paymentSchema.parse(await c.req.json())

  // Idempotent retry of the same payment (same eventId).
  const existing = await query(ctx, 'SELECT id, receipt_no FROM ar_entries WHERE event_id = $1::uuid AND entry_type = $2', [b.eventId, 'payment'])
  if (existing[0]) return c.json({ ok: true, paymentId: str(existing[0], 'id'), receiptNo: strOrNull(existing[0], 'receipt_no'), duplicate: true })

  const amount = round2(b.amount)
  const openBills = await loadOpenBills(ctx, id)
  const chosen = b.bills ?? null
  if (chosen && chosen.length > 0) {
    const openIds = new Set(openBills.map((x) => x.saleId))
    if (chosen.some((x) => !openIds.has(x.saleId))) throw new HttpError(409, 'บางบิลที่เลือกชำระครบแล้วหรือถูกยกเลิก กรุณาเปิดบัญชีลูกค้าใหม่')
    const maxForChosen = round2(
      chosen.reduce((s, x) => {
        const bill = openBills.find((o) => o.saleId === x.saleId)
        return s + (bill ? Math.min(x.amount ?? bill.outstanding, bill.outstanding) : 0)
      }, 0),
    )
    if (amount > maxForChosen) throw new HttpError(400, `ยอดรับชำระมากกว่ายอดค้างของบิลที่เลือก (${maxForChosen.toLocaleString('th-TH')} บาท)`)
  }
  const allocations = allocate(openBills, amount, chosen)
  const paymentId = randomUUID()
  const month = bangkokMonth(b.occurredAt)

  const ops: BatchOp[] = [
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'ar.payment_received',
        terminalId: b.terminalId,
        zoneId: b.zoneId,
        occurredAt: b.occurredAt,
        refType: 'customer',
        refId: id,
        payload: { customerId: id, paymentId, amount, method: b.method, note: b.note ?? null, allocations },
      }),
    },
    {
      sql: `UPDATE customers
               SET balance = balance - $2::numeric + ${guardTerm('balance >= $2::numeric')}, updated_at = now()
             WHERE id = $1::uuid`,
      params: [id, amount],
      guard: 'ยอดชำระมากกว่ายอดค้างชำระ',
    },
    { sql: counterBumpSql, params: ['RC', month] },
    {
      sql: `INSERT INTO ar_entries (id, customer_id, event_id, entry_type, amount, payment_method, note, receipt_no)
            VALUES ($3::uuid, $4::uuid, $5::uuid, 'payment', $6::numeric, $7, $8, ${docNoSql('$1', '$2')})
            RETURNING receipt_no`,
      params: ['RC', month, paymentId, id, b.eventId, -amount, b.method, b.note ?? null],
    },
  ]
  if (allocations.length > 0) {
    ops.push({
      sql: `INSERT INTO ar_allocations (payment_id, sale_id, amount)
            SELECT $1::uuid, x.sale_id, x.amount
              FROM jsonb_to_recordset($2::jsonb) AS x(sale_id uuid, amount numeric)`,
      params: [paymentId, JSON.stringify(allocations.map((a) => ({ sale_id: a.saleId, amount: a.amount })))],
    })
  }
  const results = await transaction(ctx, ops)
  return c.json({ ok: true, paymentId, receiptNo: strOrNull(results[3]?.[0] ?? {}, 'receipt_no'), duplicate: false }, 201)
})

/** One debt-payment receipt with the bills it paid (for printing / reprinting). */
masterRoutes.get('/payments/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [rows, lines] = await Promise.all([
    query(
      ctx,
      `SELECT e.id, e.receipt_no, e.amount, e.payment_method, e.note, e.created_at, e.customer_id,
              cu.name, cu.code, cu.address, cu.tax_id, cu.phone
         FROM ar_entries e JOIN customers cu ON cu.id = e.customer_id
        WHERE e.id = $1::uuid AND e.entry_type = 'payment'`,
      [id],
    ),
    query(
      ctx,
      `SELECT a.sale_id, a.amount, s.bill_no, s.tax_invoice_no, s.sold_at, s.total,
              s.due_date::text AS due_text
         FROM ar_allocations a JOIN sales s ON s.id = a.sale_id
        WHERE a.payment_id = $1::uuid ORDER BY s.sold_at, s.bill_no`,
      [id],
    ),
  ])
  const p = rows[0]
  if (!p) throw new HttpError(404, 'ไม่พบใบเสร็จรับเงิน')
  return c.json({
    paymentId: str(p, 'id'),
    receiptNo: strOrNull(p, 'receipt_no'),
    amount: -num(p, 'amount'),
    method: strOrNull(p, 'payment_method'),
    note: strOrNull(p, 'note'),
    paidAt: str(p, 'created_at'),
    customer: {
      id: str(p, 'customer_id'),
      name: str(p, 'name'),
      code: str(p, 'code'),
      address: strOrNull(p, 'address'),
      taxId: strOrNull(p, 'tax_id'),
      phone: strOrNull(p, 'phone'),
    },
    bills: lines.map((r) => ({
      saleId: str(r, 'sale_id'),
      billNo: str(r, 'bill_no'),
      taxInvoiceNo: strOrNull(r, 'tax_invoice_no'),
      soldAt: str(r, 'sold_at'),
      dueDate: strOrNull(r, 'due_text'),
      total: num(r, 'total'),
      amount: num(r, 'amount'),
    })),
  })
})

/** All unpaid credit bills (ลูกหนี้), optionally only overdue / due within 7 days. */
masterRoutes.get('/receivables', async (c) => {
  const ctx = c.get('ctx')
  const filter = z.enum(['all', 'overdue', 'due7']).catch('all').parse(c.req.query('filter'))
  const bills = await loadOpenBills(ctx)
  const shown =
    filter === 'overdue'
      ? bills.filter((b) => b.daysOverdue > 0)
      : filter === 'due7'
        ? bills.filter((b) => b.daysOverdue >= -7)
        : bills
  shown.sort((a, b) => b.daysOverdue - a.daysOverdue || a.customerName.localeCompare(b.customerName, 'th'))
  return c.json({ bills: shown, summary: summarize(bills) })
})

// ---------------------------------------------------------------- customer fixed prices (ราคาฟิกซ์)

function mapCustomerPrice(r: Row) {
  return {
    productId: str(r, 'product_id'),
    productName: str(r, 'product_name'),
    sku: str(r, 'sku'),
    unit: str(r, 'unit'),
    brandName: strOrNull(r, 'brand_name'),
    price: num(r, 'price'),
    /** The product's price at this customer's level, for comparison. */
    levelPrice: num(r, 'level_price'),
    note: strOrNull(r, 'note'),
    updatedAt: str(r, 'updated_at'),
  }
}

masterRoutes.get('/customers/:id/prices', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const rows = await query(
    ctx,
    `SELECT cp.product_id, cp.price, cp.note, cp.updated_at, p.name AS product_name, p.sku, p.unit, b.name AS brand_name,
            CASE cu.price_level WHEN 2 THEN p.price_l2 WHEN 3 THEN p.price_l3 WHEN 4 THEN p.price_l4
                                WHEN 5 THEN p.price_l5 ELSE p.price_l1 END AS level_price
       FROM customer_prices cp
       JOIN customers cu ON cu.id = cp.customer_id
       JOIN products p ON p.id = cp.product_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE cp.customer_id = $1::uuid
      ORDER BY p.name`,
    [id],
  )
  return c.json(rows.map(mapCustomerPrice))
})

const customerPriceSchema = z.object({
  productId: uuid,
  price: money,
  note: z.string().trim().max(200).nullish(),
})

/** Set (create or replace) a customer's fixed price for one product. */
masterRoutes.put('/customers/:id/prices', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = customerPriceSchema.parse(await c.req.json())
  await transaction(ctx, [
    {
      sql: `INSERT INTO customer_prices (customer_id, product_id, price, note)
            VALUES ($1::uuid, $2::uuid, $3::numeric, $4)
            ON CONFLICT (org_id, customer_id, product_id)
            DO UPDATE SET price = EXCLUDED.price, note = EXCLUDED.note, updated_at = now(),
                          updated_by = NULLIF(current_setting('app.user_id', true), '')`,
      params: [id, b.productId, round2(b.price), b.note || null],
    },
  ])
  return c.json({ ok: true })
})

masterRoutes.delete('/customers/:id/prices/:productId', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const productId = uuid.parse(c.req.param('productId'))
  await transaction(ctx, [
    {
      sql: 'DELETE FROM customer_prices WHERE customer_id = $1::uuid AND product_id = $2::uuid',
      params: [id, productId],
    },
  ])
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- suppliers

function mapSupplier(r: Row) {
  return {
    id: str(r, 'id'),
    name: str(r, 'name'),
    phone: strOrNull(r, 'phone'),
    note: strOrNull(r, 'note'),
    isActive: bool(r, 'is_active'),
  }
}

masterRoutes.get('/suppliers', async (c) => {
  const ctx = c.get('ctx')
  const rows = await query(ctx, 'SELECT * FROM suppliers ORDER BY is_active DESC, name')
  return c.json(rows.map(mapSupplier))
})

const supplierSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).nullish(),
  note: z.string().trim().max(400).nullish(),
  isActive: z.boolean().default(true),
})

masterRoutes.post('/suppliers', async (c) => {
  const ctx = c.get('ctx')
  const b = supplierSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `INSERT INTO suppliers (name, phone, note, is_active) VALUES ($1, $2, $3, $4::boolean) RETURNING *`,
      params: [b.name, b.phone || null, b.note || null, b.isActive],
    },
  ])
  return c.json(mapSupplier(rows?.[0] ?? {}), 201)
})

masterRoutes.put('/suppliers/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = supplierSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE suppliers SET name = $1, phone = $2, note = $3, is_active = $4::boolean WHERE id = $5::uuid RETURNING *`,
      params: [b.name, b.phone || null, b.note || null, b.isActive, id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบผู้จำหน่าย')
  return c.json(mapSupplier(rows[0]))
})
