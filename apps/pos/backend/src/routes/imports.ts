import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { hasAny } from '../auth.js'
import { formatBarcode, formatSku, maxCodeNumbers } from '../codes.js'
import { HttpError } from '../errors.js'
import { query, transaction, type BatchOp } from '../gate.js'
import { avgCostUpdateSql, eventInsertSql, eventParams, lotUpsertSql, movementsForLotIdentitySql } from '../stock.js'
import { bool, eventEnvelope, round2, round3, round4, str, strOrNull, uuid } from '../util.js'
import { ADJUST_REASONS, docHeaderOp } from './stock.js'

/**
 * Bulk import of master data from the old POS (Excel / CSV parsed in the browser).
 * Every endpoint takes `dryRun`: the dry run returns one verdict per row and writes
 * nothing; the real run writes all valid rows in one transaction and skips error rows.
 *
 * Products match existing ones by SKU, then barcode, then exact name, so running the
 * same file again updates prices instead of creating duplicates. Opening stock is
 * only booked for products that have never had stock, so a re-run cannot double it.
 */
export const importRoutes = new Hono<AppEnv>()

const MAX_ROWS = 3000

export type RowAction = 'create' | 'update' | 'skip' | 'error'

export interface RowResult {
  row: number
  action: RowAction
  label: string
  messages: string[]
  sku?: string
  stockQty?: number
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null)

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

function summarize(results: RowResult[]) {
  const count = (a: RowAction) => results.filter((r) => r.action === a).length
  return { create: count('create'), update: count('update'), skip: count('skip'), error: count('error') }
}

function zodMessages(err: z.ZodError): string[] {
  return err.issues.map((i) => {
    const field = String(i.path[0] ?? '')
    return FIELD_LABEL[field] ? `${FIELD_LABEL[field]}: ${i.message}` : i.message
  })
}

const FIELD_LABEL: Record<string, string> = {
  name: 'ชื่อ',
  phone: 'เบอร์โทร',
  note: 'หมายเหตุ',
  sku: 'รหัสสินค้า',
  barcode: 'บาร์โค้ด',
  unit: 'หน่วย',
  category: 'หมวดหมู่',
  brand: 'แบรนด์',
  supplier: 'ผู้จำหน่าย',
  prices: 'ราคา',
  weightKg: 'น้ำหนัก',
  reorderPoint: 'จุดสั่งซื้อ',
  openingQty: 'จำนวนคงเหลือ',
  unitCost: 'ต้นทุนต่อหน่วย',
  lotNo: 'เลขล็อต',
  expiryDate: 'วันหมดอายุ',
}

// ---------------------------------------------------------------- suppliers

const supplierRow = z.object({
  name: z.string().trim().min(1, 'ต้องมีชื่อ').max(160),
  phone: text(40),
  note: text(400),
})

const supplierImport = z.object({
  dryRun: z.boolean(),
  rows: z.array(z.unknown()).min(1).max(MAX_ROWS),
})

importRoutes.post('/import/suppliers', async (c) => {
  const ctx = c.get('ctx')
  const b = supplierImport.parse(await c.req.json())
  const existing = await query(ctx, 'SELECT id, name FROM suppliers')
  const byName = new Map(existing.map((r) => [key(str(r, 'name')), str(r, 'id')]))

  const results: RowResult[] = []
  const inserts: { id: string; name: string; phone: string | null; note: string | null }[] = []
  const updates: { id: string; phone: string | null; note: string | null }[] = []
  const seen = new Set<string>()

  b.rows.forEach((raw, i) => {
    const parsed = supplierRow.safeParse(raw)
    const label = typeof raw === 'object' && raw && 'name' in raw ? String((raw as { name: unknown }).name ?? '') : ''
    if (!parsed.success) {
      results.push({ row: i, action: 'error', label, messages: zodMessages(parsed.error) })
      return
    }
    const r = parsed.data
    const k = key(r.name)
    if (seen.has(k)) {
      results.push({ row: i, action: 'skip', label: r.name, messages: ['ชื่อซ้ำกับแถวก่อนหน้าในไฟล์'] })
      return
    }
    seen.add(k)
    const id = byName.get(k)
    if (id) {
      if (!r.phone && !r.note) {
        results.push({ row: i, action: 'skip', label: r.name, messages: ['มีในระบบแล้ว'] })
        return
      }
      updates.push({ id, phone: r.phone, note: r.note })
      results.push({ row: i, action: 'update', label: r.name, messages: ['มีในระบบแล้ว — อัปเดตเบอร์โทร/หมายเหตุ'] })
      return
    }
    inserts.push({ id: randomUUID(), name: r.name, phone: r.phone, note: r.note })
    results.push({ row: i, action: 'create', label: r.name, messages: [] })
  })

  if (!b.dryRun && (inserts.length > 0 || updates.length > 0)) {
    const ops: BatchOp[] = []
    if (inserts.length > 0) {
      ops.push({
        sql: `INSERT INTO suppliers (id, name, phone, note)
              SELECT x.id, x.name, x.phone, x.note
                FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, name text, phone text, note text)`,
        params: [JSON.stringify(inserts)],
      })
    }
    if (updates.length > 0) {
      ops.push({
        sql: `UPDATE suppliers s SET phone = COALESCE(x.phone, s.phone), note = COALESCE(x.note, s.note)
                FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, phone text, note text)
               WHERE s.id = x.id`,
        params: [JSON.stringify(updates)],
      })
    }
    await transaction(ctx, ops)
  }
  return c.json({ dryRun: b.dryRun, summary: summarize(results), rows: results })
})

// ---------------------------------------------------------------- products (+ opening stock)

const price = z.number().min(0, 'ต้องไม่ติดลบ').max(100_000_000).nullable()

const productRow = z.object({
  sku: text(40),
  barcode: text(64),
  name: z.string().trim().min(1, 'ต้องมีชื่อสินค้า').max(160),
  unit: text(20),
  category: text(80),
  brand: text(120),
  supplier: text(160),
  prices: z.array(price).length(5),
  weightKg: z.number().positive('ต้องมากกว่า 0').max(10_000).nullish(),
  reorderPoint: z.number().min(0).max(1_000_000).nullish(),
  trackExpiry: z.boolean().nullish(),
  openingQty: z.number().min(0, 'ต้องไม่ติดลบ').max(1_000_000).nullish(),
  unitCost: z.number().min(0, 'ต้องไม่ติดลบ').max(10_000_000).nullish(),
  lotNo: text(60),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง')
    .nullish()
    .transform((v) => v ?? null),
})

type ProductRow = z.infer<typeof productRow>

const productImport = z.object({
  dryRun: z.boolean(),
  /** Location that receives the opening stock; required when any row has a quantity. */
  locationId: uuid.nullish(),
  /** Unit for new products when the file has none. */
  defaultUnit: z.string().trim().min(1).max(20).default('กระสอบ'),
  rows: z.array(z.unknown()).min(1).max(MAX_ROWS),
  ...eventEnvelope,
})

interface ExistingProduct {
  id: string
  sku: string
  barcode: string | null
  name: string
  trackExpiry: boolean
  hasStock: boolean
}

importRoutes.post('/import/products', async (c) => {
  const ctx = c.get('ctx')
  const user = c.get('appUser')
  const b = productImport.parse(await c.req.json())

  const [productRows, brandRows, supplierRows, codes] = await Promise.all([
    query(
      ctx,
      `SELECT p.id, p.sku, p.barcode, p.name, p.track_expiry,
              EXISTS (SELECT 1 FROM stock_lots l WHERE l.product_id = p.id) AS has_stock
         FROM products p`,
    ),
    query(ctx, 'SELECT id, name, supplier_id FROM brands'),
    query(ctx, 'SELECT id, name FROM suppliers'),
    maxCodeNumbers(ctx),
  ])
  if (b.locationId) {
    const loc = await query(ctx, 'SELECT 1 FROM locations WHERE id = $1::uuid', [b.locationId])
    if (!loc[0]) throw new HttpError(400, 'ไม่พบสาขา/โซนที่เลือก')
  }

  const products: ExistingProduct[] = productRows.map((r) => ({
    id: str(r, 'id'),
    sku: str(r, 'sku'),
    barcode: strOrNull(r, 'barcode'),
    name: str(r, 'name'),
    trackExpiry: bool(r, 'track_expiry'),
    hasStock: bool(r, 'has_stock'),
  }))
  const bySku = new Map(products.map((p) => [key(p.sku), p]))
  const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode ?? '', p]))
  const byName = new Map(products.map((p) => [key(p.name), p]))
  const brands = new Map(brandRows.map((r) => [key(str(r, 'name')), { id: str(r, 'id'), supplierId: str(r, 'supplier_id') }]))
  const suppliers = new Map(supplierRows.map((r) => [key(str(r, 'name')), str(r, 'id')]))

  // Codes taken so far (database + this file) so auto-generated ones never clash.
  const usedSku = new Set(products.map((p) => key(p.sku)))
  const usedBarcode = new Set(products.flatMap((p) => (p.barcode ? [p.barcode] : [])))
  for (const raw of b.rows) {
    const p = productRow.safeParse(raw)
    if (p.success && p.data.sku) usedSku.add(key(p.data.sku))
    if (p.success && p.data.barcode) usedBarcode.add(p.data.barcode)
  }
  let skuNo = codes.sku
  let barcodeNo = codes.barcode
  const takeSku = () => {
    let s: string
    do s = formatSku(++skuNo)
    while (usedSku.has(key(s)))
    usedSku.add(key(s))
    return s
  }
  const takeBarcode = () => {
    let s: string
    do s = formatBarcode(++barcodeNo)
    while (usedBarcode.has(s))
    usedBarcode.add(s)
    return s
  }

  const results: RowResult[] = []
  const newSuppliers: { id: string; name: string }[] = []
  const newBrands: { id: string; name: string; supplier_id: string }[] = []
  const inserts: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  const stockRows: { product_id: string; lot_no: string; expiry_date: string | null; qty: number; unit_cost: number }[] = []
  const touched = new Set<string>()
  const fileSku = new Set<string>()
  const fileBarcode = new Set<string>()

  const resolveBrand = (r: ProductRow, messages: string[]): string | null | false => {
    if (!r.brand) return null
    const found = brands.get(key(r.brand))
    if (found) return found.id
    if (!r.supplier) {
      messages.push(`แบรนด์ "${r.brand}" ยังไม่มีในระบบ — ต้องระบุผู้จำหน่ายเพื่อสร้างแบรนด์ใหม่`)
      return false
    }
    let supplierId = suppliers.get(key(r.supplier))
    if (!supplierId) {
      supplierId = randomUUID()
      suppliers.set(key(r.supplier), supplierId)
      newSuppliers.push({ id: supplierId, name: r.supplier })
      messages.push(`สร้างผู้จำหน่ายใหม่ "${r.supplier}"`)
    }
    const id = randomUUID()
    brands.set(key(r.brand), { id, supplierId })
    newBrands.push({ id, name: r.brand, supplier_id: supplierId })
    messages.push(`สร้างแบรนด์ใหม่ "${r.brand}"`)
    return id
  }

  b.rows.forEach((raw, i) => {
    const parsed = productRow.safeParse(raw)
    const label = typeof raw === 'object' && raw && 'name' in raw ? String((raw as { name: unknown }).name ?? '') : ''
    if (!parsed.success) {
      results.push({ row: i, action: 'error', label, messages: zodMessages(parsed.error) })
      return
    }
    const r = parsed.data
    const messages: string[] = []

    if (r.sku) {
      if (fileSku.has(key(r.sku))) {
        results.push({ row: i, action: 'error', label: r.name, messages: [`รหัสสินค้า ${r.sku} ซ้ำกับแถวก่อนหน้าในไฟล์`] })
        return
      }
      fileSku.add(key(r.sku))
    }
    if (r.barcode) {
      if (fileBarcode.has(r.barcode)) {
        results.push({ row: i, action: 'error', label: r.name, messages: [`บาร์โค้ด ${r.barcode} ซ้ำกับแถวก่อนหน้าในไฟล์`] })
        return
      }
      fileBarcode.add(r.barcode)
    }

    const match =
      (r.sku ? bySku.get(key(r.sku)) : undefined) ??
      (r.barcode ? byBarcode.get(r.barcode) : undefined) ??
      byName.get(key(r.name))
    if (match && touched.has(match.id)) {
      results.push({ row: i, action: 'skip', label: r.name, messages: ['ตรงกับสินค้าเดียวกับแถวก่อนหน้าในไฟล์'] })
      return
    }
    if (match && r.barcode) {
      const owner = byBarcode.get(r.barcode)
      if (owner && owner.id !== match.id) {
        results.push({ row: i, action: 'error', label: r.name, messages: [`บาร์โค้ด ${r.barcode} เป็นของสินค้า "${owner.name}" อยู่แล้ว`] })
        return
      }
    }
    if (match && r.sku && key(r.sku) !== key(match.sku) && bySku.has(key(r.sku))) {
      results.push({ row: i, action: 'error', label: r.name, messages: [`รหัสสินค้า ${r.sku} เป็นของสินค้าอื่นอยู่แล้ว`] })
      return
    }

    const brandId = resolveBrand(r, messages)
    if (brandId === false) {
      results.push({ row: i, action: 'error', label: r.name, messages })
      return
    }

    // Opening stock
    const wantsStock = (r.openingQty ?? 0) > 0
    const trackExpiry = r.trackExpiry ?? (match ? match.trackExpiry : r.expiryDate !== null)
    let stockQty: number | undefined
    if (wantsStock) {
      if (!b.locationId) {
        results.push({ row: i, action: 'error', label: r.name, messages: [...messages, 'มีจำนวนคงเหลือ แต่ยังไม่ได้เลือกสาขา/โซนที่จะลงสต็อก'] })
        return
      }
      if (match?.hasStock) {
        messages.push('มีสต็อกในระบบแล้ว — ข้ามยอดยกมา (ปรับยอดที่หน้าสต็อกแทน)')
      } else if (trackExpiry && !r.expiryDate) {
        results.push({ row: i, action: 'error', label: r.name, messages: [...messages, 'สินค้านี้ติดตามวันหมดอายุ ต้องระบุวันหมดอายุของยอดยกมา'] })
        return
      } else {
        stockQty = round3(r.openingQty ?? 0)
        if (r.unitCost === null || r.unitCost === undefined) messages.push('ไม่มีต้นทุน — ใช้ต้นทุน 0 (กำไรจะคำนวณผิดจนกว่าจะรับเข้าครั้งถัดไป)')
      }
    }

    if (match) {
      touched.add(match.id)
      updates.push({
        id: match.id,
        sku: r.sku,
        barcode: r.barcode,
        name: r.name,
        unit: r.unit,
        category: r.category,
        brand_id: brandId,
        p1: r.prices[0],
        p2: r.prices[1],
        p3: r.prices[2],
        p4: r.prices[3],
        p5: r.prices[4],
        weight_kg: r.weightKg ?? null,
        reorder_point: r.reorderPoint ?? null,
        track_expiry: r.trackExpiry ?? null,
      })
      if (stockQty !== undefined) {
        stockRows.push({ product_id: match.id, lot_no: r.lotNo ?? '', expiry_date: r.expiryDate, qty: stockQty, unit_cost: round4(r.unitCost ?? 0) })
      }
      results.push({ row: i, action: 'update', label: r.name, sku: match.sku, messages: ['มีในระบบแล้ว — อัปเดตข้อมูลที่กรอกมา', ...messages], stockQty })
      return
    }

    const id = randomUUID()
    const sku = r.sku ?? takeSku()
    const barcode = r.barcode ?? takeBarcode()
    if (!r.unit) messages.push(`ไม่มีหน่วย — ใช้ "${b.defaultUnit}"`)
    inserts.push({
      id,
      sku,
      barcode,
      name: r.name,
      unit: r.unit ?? b.defaultUnit,
      category: r.category,
      brand_id: brandId,
      p1: round2(r.prices[0] ?? 0),
      p2: round2(r.prices[1] ?? 0),
      p3: round2(r.prices[2] ?? 0),
      p4: round2(r.prices[3] ?? 0),
      p5: round2(r.prices[4] ?? 0),
      weight_kg: r.weightKg ?? null,
      reorder_point: r.reorderPoint ?? 0,
      track_expiry: trackExpiry,
    })
    if (stockQty !== undefined) {
      stockRows.push({ product_id: id, lot_no: r.lotNo ?? '', expiry_date: r.expiryDate, qty: stockQty, unit_cost: round4(r.unitCost ?? 0) })
    }
    results.push({ row: i, action: 'create', label: r.name, sku, messages, stockQty })
  })

  if (stockRows.length > 0 && user && !hasAny(user, ['stock'])) {
    throw new HttpError(403, 'บัญชีนี้ไม่มีสิทธิ์ลงยอดสต็อก — ลบคอลัมน์จำนวนคงเหลือออก หรือให้ผู้มีสิทธิ์สต็อกนำเข้า', 'no_permission')
  }

  let docNo: string | null = null
  if (!b.dryRun && (inserts.length > 0 || updates.length > 0)) {
    const ops: BatchOp[] = []
    if (newSuppliers.length > 0) {
      ops.push({
        sql: `INSERT INTO suppliers (id, name) SELECT x.id, x.name FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, name text)`,
        params: [JSON.stringify(newSuppliers)],
      })
    }
    if (newBrands.length > 0) {
      ops.push({
        sql: `INSERT INTO brands (id, name, supplier_id)
              SELECT x.id, x.name, x.supplier_id FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, name text, supplier_id uuid)`,
        params: [JSON.stringify(newBrands)],
      })
    }
    if (inserts.length > 0) {
      ops.push({
        sql: `INSERT INTO products (id, sku, barcode, name, category, unit, price_l1, price_l2, price_l3, price_l4, price_l5,
                reorder_point, track_expiry, brand_id, weight_kg)
              SELECT x.id, x.sku, x.barcode, x.name, x.category, x.unit, x.p1, x.p2, x.p3, x.p4, x.p5,
                     x.reorder_point, x.track_expiry, x.brand_id, x.weight_kg
                FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, sku text, barcode text, name text, category text, unit text,
                     p1 numeric, p2 numeric, p3 numeric, p4 numeric, p5 numeric, reorder_point numeric,
                     track_expiry boolean, brand_id uuid, weight_kg numeric)`,
        params: [JSON.stringify(inserts)],
      })
    }
    if (updates.length > 0) {
      // Empty cells (null) keep the current value.
      ops.push({
        sql: `UPDATE products p SET sku = COALESCE(x.sku, p.sku), barcode = COALESCE(x.barcode, p.barcode),
                name = x.name, unit = COALESCE(x.unit, p.unit), category = COALESCE(x.category, p.category),
                brand_id = COALESCE(x.brand_id, p.brand_id),
                price_l1 = COALESCE(x.p1, p.price_l1), price_l2 = COALESCE(x.p2, p.price_l2),
                price_l3 = COALESCE(x.p3, p.price_l3), price_l4 = COALESCE(x.p4, p.price_l4),
                price_l5 = COALESCE(x.p5, p.price_l5), weight_kg = COALESCE(x.weight_kg, p.weight_kg),
                reorder_point = COALESCE(x.reorder_point, p.reorder_point),
                track_expiry = COALESCE(x.track_expiry, p.track_expiry), updated_at = now()
                FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, sku text, barcode text, name text, unit text, category text,
                     brand_id uuid, p1 numeric, p2 numeric, p3 numeric, p4 numeric, p5 numeric, weight_kg numeric,
                     reorder_point numeric, track_expiry boolean)
               WHERE p.id = x.id`,
        params: [JSON.stringify(updates)],
      })
    }
    let headerIndex = -1
    if (stockRows.length > 0 && b.locationId) {
      // Same bookkeeping as a manual "ยอดยกมา" adjustment: event, ADJ document, average cost, lots, movements.
      const docId = randomUUID()
      const reason = `${ADJUST_REASONS.opening}: นำเข้าจากโปรแกรมเดิม`
      ops.push({
        sql: eventInsertSql(),
        params: eventParams({
          eventId: b.eventId,
          type: 'stock.adjusted',
          terminalId: b.terminalId,
          zoneId: b.locationId,
          occurredAt: b.occurredAt,
          refType: 'stock_document',
          refId: docId,
          payload: { docId, locationId: b.locationId, reasonCode: 'opening', note: 'import', incoming: stockRows, outgoing: [] },
        }),
      })
      const header = docHeaderOp({
        prefix: 'ADJ',
        docId,
        docType: 'adjustment',
        eventId: b.eventId,
        from: b.locationId,
        to: null,
        reasonCode: 'opening',
        note: 'นำเข้าจากโปรแกรมเดิม',
        terminalId: b.terminalId,
        occurredAt: b.occurredAt,
      })
      ops.push(...header)
      headerIndex = ops.length - 1
      ops.push(
        {
          sql: avgCostUpdateSql('$1'),
          params: [JSON.stringify(stockRows.map((r) => ({ product_id: r.product_id, q: r.qty, amount: round4(r.qty * r.unit_cost) })))],
        },
        { sql: lotUpsertSql('$1', '$2', '$3'), params: [b.locationId, JSON.stringify(stockRows), b.occurredAt] },
        {
          sql: movementsForLotIdentitySql({
            event: '$1', terminal: '$2', zone: '$3', occurredAt: '$4', type: "'adjust'", location: '$8',
            recordset: '$5', refType: "'stock_document'", refId: '$6', reason: '$7',
          }),
          params: [b.eventId, b.terminalId, b.locationId, b.occurredAt, JSON.stringify(stockRows), docId, reason, b.locationId],
        },
      )
    }
    const out = await transaction(ctx, ops)
    if (headerIndex >= 0) docNo = strOrNull(out[headerIndex]?.[0] ?? {}, 'doc_no')
  }

  const stockTotal = round3(stockRows.reduce((s, r) => s + r.qty, 0))
  const stockValue = round2(stockRows.reduce((s, r) => s + r.qty * r.unit_cost, 0))
  return c.json({
    dryRun: b.dryRun,
    summary: { ...summarize(results), newSuppliers: newSuppliers.length, newBrands: newBrands.length, stockItems: stockRows.length, stockTotal, stockValue },
    docNo,
    rows: results,
  })
})
