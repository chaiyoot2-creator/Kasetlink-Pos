import { Hono } from 'hono'
import { z } from 'zod'
import { HttpError } from '../errors.js'
import { guardTerm, query, transaction, type Row } from '../gate.js'
import type { AppEnv } from '../app-env.js'
import { eventInsertSql, eventParams } from '../stock.js'
import { bool, eventEnvelope, money, num, round2, str, strOrNull, uuid } from '../util.js'

export const masterRoutes = new Hono<AppEnv>()

// ---------------------------------------------------------------- settings

function mapSettings(r: Row | undefined) {
  return {
    shopName: r ? str(r, 'shop_name') : 'ร้านอาหารสัตว์',
    address: r ? strOrNull(r, 'address') : null,
    phone: r ? strOrNull(r, 'phone') : null,
    taxId: r ? strOrNull(r, 'tax_id') : null,
    promptpayId: r ? strOrNull(r, 'promptpay_id') : null,
    receiptFooter: r ? strOrNull(r, 'receipt_footer') : null,
    expiryAlertDays: r ? num(r, 'expiry_alert_days') : 30,
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
    query(ctx, 'SELECT * FROM shop_settings LIMIT 1'),
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
})

masterRoutes.put('/settings', async (c) => {
  const ctx = c.get('ctx')
  const b = settingsSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `INSERT INTO shop_settings (shop_name, address, phone, tax_id, promptpay_id, receipt_footer, expiry_alert_days)
            VALUES ($1, $2, $3, $4, $5, $6, $7::int)
            ON CONFLICT (org_id) DO UPDATE SET shop_name = EXCLUDED.shop_name, address = EXCLUDED.address,
              phone = EXCLUDED.phone, tax_id = EXCLUDED.tax_id, promptpay_id = EXCLUDED.promptpay_id,
              receipt_footer = EXCLUDED.receipt_footer, expiry_alert_days = EXCLUDED.expiry_alert_days,
              updated_at = now()
            RETURNING *`,
      params: [
        b.shopName,
        b.address || null,
        b.phone || null,
        b.taxId || null,
        b.promptpayId || null,
        b.receiptFooter || null,
        b.expiryAlertDays,
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

function mapProduct(r: Row) {
  return {
    id: str(r, 'id'),
    sku: str(r, 'sku'),
    barcode: strOrNull(r, 'barcode'),
    name: str(r, 'name'),
    category: strOrNull(r, 'category'),
    unit: str(r, 'unit'),
    priceRetail: num(r, 'price_retail'),
    priceWholesale: num(r, 'price_wholesale'),
    priceMember: num(r, 'price_member'),
    avgCost: num(r, 'avg_cost'),
    reorderPoint: num(r, 'reorder_point'),
    trackExpiry: bool(r, 'track_expiry'),
    isActive: bool(r, 'is_active'),
    qtyTotal: num(r, 'qty_total'),
    qtyHere: num(r, 'qty_here'),
  }
}

const PRODUCT_SELECT = `
  SELECT p.*, COALESCE(s.qty_total, 0) AS qty_total, COALESCE(s.qty_here, 0) AS qty_here
    FROM products p
    LEFT JOIN (
      SELECT product_id, SUM(qty) AS qty_total,
             SUM(qty) FILTER (WHERE location_id = NULLIF($1, '')::uuid) AS qty_here
        FROM stock_lots GROUP BY product_id
    ) s ON s.product_id = p.id`

masterRoutes.get('/products', async (c) => {
  const ctx = c.get('ctx')
  const q = (c.req.query('q') ?? '').trim()
  const locationId = c.req.query('locationId') ?? ''
  if (locationId) uuid.parse(locationId)
  const includeInactive = c.req.query('all') === '1'
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 500)
  const rows = await query(
    ctx,
    `${PRODUCT_SELECT}
      WHERE ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.sku ILIKE $2 || '%' OR p.barcode = $2
             OR p.category ILIKE '%' || $2 || '%')
        AND ($3::boolean OR p.is_active)
      ORDER BY (p.barcode = $2 OR p.sku = $2) DESC NULLS LAST, p.name
      LIMIT $4::int`,
    [locationId, q, includeInactive, limit],
  )
  return c.json(rows.map(mapProduct))
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
  priceRetail: money,
  priceWholesale: money,
  priceMember: money,
  reorderPoint: z.number().min(0).max(1_000_000),
  trackExpiry: z.boolean(),
  isActive: z.boolean().default(true),
})

function productParams(b: z.infer<typeof productSchema>): unknown[] {
  return [
    b.sku,
    b.barcode || null,
    b.name,
    b.category || null,
    b.unit,
    round2(b.priceRetail),
    round2(b.priceWholesale),
    round2(b.priceMember),
    b.reorderPoint,
    b.trackExpiry,
    b.isActive,
  ]
}

masterRoutes.post('/products', async (c) => {
  const ctx = c.get('ctx')
  const b = productSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `INSERT INTO products (sku, barcode, name, category, unit, price_retail, price_wholesale, price_member,
              reorder_point, track_expiry, is_active)
            VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::boolean, $11::boolean)
            RETURNING *, 0 AS qty_total, 0 AS qty_here`,
      params: productParams(b),
    },
  ])
  return c.json(mapProduct(rows?.[0] ?? {}), 201)
})

masterRoutes.put('/products/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = productSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE products SET sku = $1, barcode = $2, name = $3, category = $4, unit = $5,
              price_retail = $6::numeric, price_wholesale = $7::numeric, price_member = $8::numeric,
              reorder_point = $9::numeric, track_expiry = $10::boolean, is_active = $11::boolean, updated_at = now()
            WHERE id = $12::uuid RETURNING *, 0 AS qty_total, 0 AS qty_here`,
      params: [...productParams(b), id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบสินค้า')
  return c.json(mapProduct(rows[0]))
})

// ---------------------------------------------------------------- customers

function mapCustomer(r: Row) {
  return {
    id: str(r, 'id'),
    code: str(r, 'code'),
    name: str(r, 'name'),
    phone: strOrNull(r, 'phone'),
    customerType: str(r, 'customer_type'),
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
    `SELECT * FROM customers
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
  customerType: z.enum(['retail', 'wholesale', 'member']),
  creditLimit: money,
  note: z.string().trim().max(400).nullish(),
  isActive: z.boolean().default(true),
})

masterRoutes.post('/customers', async (c) => {
  const ctx = c.get('ctx')
  const b = customerSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `INSERT INTO customers (code, name, phone, customer_type, credit_limit, note, is_active)
            VALUES ($1, $2, $3, $4, $5::numeric, $6, $7::boolean) RETURNING *`,
      params: [b.code, b.name, b.phone || null, b.customerType, round2(b.creditLimit), b.note || null, b.isActive],
    },
  ])
  return c.json(mapCustomer(rows?.[0] ?? {}), 201)
})

masterRoutes.put('/customers/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = customerSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE customers SET code = $1, name = $2, phone = $3, customer_type = $4, credit_limit = $5::numeric,
              note = $6, is_active = $7::boolean, updated_at = now()
            WHERE id = $8::uuid RETURNING *`,
      params: [b.code, b.name, b.phone || null, b.customerType, round2(b.creditLimit), b.note || null, b.isActive, id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบลูกค้า')
  return c.json(mapCustomer(rows[0]))
})

masterRoutes.get('/customers/:id/ledger', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [customer, entries] = await Promise.all([
    query(ctx, 'SELECT * FROM customers WHERE id = $1::uuid', [id]),
    query(
      ctx,
      `SELECT a.id, a.entry_type, a.amount, a.payment_method, a.note, a.created_at, s.bill_no
         FROM ar_entries a LEFT JOIN sales s ON s.id = a.ref_id
        WHERE a.customer_id = $1::uuid ORDER BY a.created_at DESC LIMIT 200`,
      [id],
    ),
  ])
  if (!customer[0]) throw new HttpError(404, 'ไม่พบลูกค้า')
  return c.json({
    customer: mapCustomer(customer[0]),
    entries: entries.map((r) => ({
      id: str(r, 'id'),
      entryType: str(r, 'entry_type'),
      amount: num(r, 'amount'),
      paymentMethod: strOrNull(r, 'payment_method'),
      note: strOrNull(r, 'note'),
      billNo: strOrNull(r, 'bill_no'),
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
})

/** รับชำระหนี้ — reduces the customer's receivable balance. */
masterRoutes.post('/customers/:id/payments', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = paymentSchema.parse(await c.req.json())
  const amount = round2(b.amount)
  await transaction(ctx, [
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
        payload: { customerId: id, amount, method: b.method, note: b.note ?? null },
      }),
    },
    {
      sql: `UPDATE customers
               SET balance = balance - $2::numeric + ${guardTerm('balance >= $2::numeric')}, updated_at = now()
             WHERE id = $1::uuid`,
      params: [id, amount],
      guard: 'ยอดชำระมากกว่ายอดค้างชำระ',
    },
    {
      sql: `INSERT INTO ar_entries (customer_id, event_id, entry_type, amount, payment_method, note)
            VALUES ($1::uuid, $2::uuid, 'payment', $3::numeric, $4, $5)`,
      params: [id, b.eventId, -amount, b.method, b.note ?? null],
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
