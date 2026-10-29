import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { query, transaction, type RequestCtx, type Row } from '../db.js'
import { counterBumpSql, dateOnly, docNoSql, money, num, qty, round2, round3, str, strOrNull, uuid } from '../util.js'
import { PRODUCT_SELECT, mapProduct } from './master.js'

/** Quotations: priced offers that become a POS bill when the customer agrees. */
export const quotationRoutes = new Hono<AppEnv>()

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

function mapQuotation(r: Row) {
  const status = str(r, 'status')
  const validUntil = dateOnly(r, 'valid_until') ?? ''
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
  return {
    id: str(r, 'id'),
    docNo: str(r, 'doc_no'),
    quoteDate: dateOnly(r, 'quote_date') ?? '',
    validUntil,
    /** open / expired (open but past validity) / converted / cancelled */
    status: status === 'open' && validUntil < today ? 'expired' : status,
    customerId: strOrNull(r, 'customer_id'),
    customerName: str(r, 'customer_name'),
    customerCode: strOrNull(r, 'customer_code'),
    phone: strOrNull(r, 'phone'),
    address: strOrNull(r, 'address'),
    taxId: strOrNull(r, 'tax_id'),
    priceLevel: num(r, 'price_level') || 1,
    subtotal: num(r, 'subtotal'),
    lineDiscountTotal: num(r, 'line_discount_total'),
    billDiscount: num(r, 'bill_discount'),
    total: num(r, 'total'),
    note: strOrNull(r, 'note'),
    saleId: strOrNull(r, 'sale_id'),
    saleBillNo: strOrNull(r, 'bill_no'),
    convertedAt: strOrNull(r, 'converted_at'),
    cancelReason: strOrNull(r, 'cancel_reason'),
    createdByName: strOrNull(r, 'created_by_name'),
    itemCount: num(r, 'item_count'),
  }
}

const SELECT = `
  SELECT q.*, s.bill_no, (SELECT count(*) FROM quotation_lines l WHERE l.quotation_id = q.id) AS item_count
    FROM quotations q LEFT JOIN sales s ON s.id = q.sale_id`

quotationRoutes.get('/quotations', async (c) => {
  const ctx = c.get('ctx')
  const from = date.parse(c.req.query('from'))
  const to = date.parse(c.req.query('to'))
  const q = (c.req.query('q') ?? '').trim()
  const rows = await query(
    ctx,
    `${SELECT}
      WHERE q.quote_date BETWEEN $1::date AND $2::date
        AND ($3 = '' OR q.doc_no ILIKE '%' || $3 || '%' OR q.customer_name ILIKE '%' || $3 || '%')
      ORDER BY q.quote_date DESC, q.doc_no DESC LIMIT 500`,
    [from, to, q],
  )
  return c.json(rows.map(mapQuotation))
})

/** One quotation with its lines, plus current product data so the POS can load it into the cart. */
quotationRoutes.get('/quotations/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const locationId = c.req.query('locationId') ?? ''
  if (locationId) uuid.parse(locationId)
  const [head, lines] = await Promise.all([
    query(ctx, `${SELECT} WHERE q.id = $1::uuid`, [id]),
    query(ctx, 'SELECT * FROM quotation_lines WHERE quotation_id = $1::uuid ORDER BY line_no', [id]),
  ])
  if (!head[0]) throw new HttpError(404, 'ไม่พบใบเสนอราคา')
  const productIds = [...new Set(lines.map((l) => str(l, 'product_id')))]
  const products = productIds.length
    ? await query(ctx, `${PRODUCT_SELECT} WHERE p.id IN (SELECT jsonb_array_elements_text($2::jsonb)::uuid)`, [locationId, JSON.stringify(productIds)])
    : []
  return c.json({
    ...mapQuotation(head[0]),
    lines: lines.map((r) => ({
      lineNo: num(r, 'line_no'),
      productId: str(r, 'product_id'),
      productName: str(r, 'product_name'),
      unit: str(r, 'unit'),
      qty: num(r, 'qty'),
      unitPrice: num(r, 'unit_price'),
      lineDiscount: num(r, 'line_discount'),
      lineTotal: num(r, 'line_total'),
      priceSource: strOrNull(r, 'price_source'),
    })),
    products: products.map(mapProduct),
  })
})

const bodySchema = z.object({
  quoteDate: date,
  validDays: z.number().int().min(1).max(365).default(15),
  customerId: uuid.nullish(),
  customerName: z.string().trim().max(160).nullish(),
  phone: z.string().trim().max(40).nullish(),
  address: z.string().trim().max(400).nullish(),
  priceLevel: z.number().int().min(1).max(5),
  billDiscount: money.default(0),
  note: z.string().trim().max(1000).nullish(),
  lines: z
    .array(
      z.object({
        productId: uuid,
        qty,
        unitPrice: money,
        lineDiscount: money.default(0),
        priceSource: z.enum(['fixed', 'level', 'fallback', 'manual']).nullish(),
      }),
    )
    .min(1, 'เพิ่มสินค้าอย่างน้อย 1 รายการ')
    .max(200),
})

type Body = z.infer<typeof bodySchema>

/** Totals, snapshots of customer and product names, and the rows to write. */
async function prepare(ctx: RequestCtx, b: Body) {
  const [customerRows, productRows] = await Promise.all([
    b.customerId ? query(ctx, 'SELECT code, name, phone, address, tax_id FROM customers WHERE id = $1::uuid', [b.customerId]) : Promise.resolve([]),
    query(ctx, 'SELECT id, name, unit FROM products WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)', [
      JSON.stringify([...new Set(b.lines.map((l) => l.productId))]),
    ]),
  ])
  const cu = customerRows[0]
  if (b.customerId && !cu) throw new HttpError(400, 'ไม่พบลูกค้า')
  const name = (cu ? str(cu, 'name') : b.customerName?.trim()) || ''
  if (!name) throw new HttpError(400, 'ระบุชื่อลูกค้า')
  const products = new Map(productRows.map((r) => [str(r, 'id'), r]))
  const lines = b.lines.map((l, i) => {
    const p = products.get(l.productId)
    if (!p) throw new HttpError(400, 'ไม่พบสินค้าบางรายการ')
    const gross = round2(l.qty * l.unitPrice)
    const discount = Math.min(round2(l.lineDiscount), gross)
    return {
      line_no: i + 1,
      product_id: l.productId,
      product_name: str(p, 'name'),
      unit: str(p, 'unit'),
      qty: round3(l.qty),
      unit_price: round2(l.unitPrice),
      line_discount: discount,
      line_total: round2(gross - discount),
      price_source: l.priceSource ?? null,
      gross,
    }
  })
  const subtotal = round2(lines.reduce((s, l) => s + l.gross, 0))
  const lineDiscountTotal = round2(lines.reduce((s, l) => s + l.line_discount, 0))
  const billDiscount = Math.min(round2(b.billDiscount), round2(subtotal - lineDiscountTotal))
  const total = round2(subtotal - lineDiscountTotal - billDiscount)
  const validUntil = new Date(new Date(`${b.quoteDate}T00:00:00Z`).getTime() + b.validDays * 86400_000).toISOString().slice(0, 10)
  return {
    head: {
      customerName: name,
      customerCode: cu ? str(cu, 'code') : null,
      phone: b.phone || (cu ? strOrNull(cu, 'phone') : null),
      address: b.address || (cu ? strOrNull(cu, 'address') : null),
      taxId: cu ? strOrNull(cu, 'tax_id') : null,
      subtotal,
      lineDiscountTotal,
      billDiscount,
      total,
      validUntil,
    },
    lines: lines.map(({ gross: _gross, ...rest }) => rest),
  }
}

const LINES_SQL = `INSERT INTO quotation_lines (quotation_id, line_no, product_id, product_name, unit, qty, unit_price, line_discount, line_total, price_source)
  SELECT $1::uuid, x.line_no, x.product_id, x.product_name, x.unit, x.qty, x.unit_price, x.line_discount, x.line_total, x.price_source
    FROM jsonb_to_recordset($2::jsonb)
      AS x(line_no int, product_id uuid, product_name text, unit text, qty numeric, unit_price numeric, line_discount numeric,
           line_total numeric, price_source text)`

quotationRoutes.post('/quotations', async (c) => {
  const ctx = c.get('ctx')
  const b = bodySchema.parse(await c.req.json())
  const { head, lines } = await prepare(ctx, b)
  const id = randomUUID()
  const period = b.quoteDate.slice(0, 7).replace('-', '')
  await transaction(ctx, [
    { sql: counterBumpSql, params: ['QT', period] },
    {
      sql: `INSERT INTO quotations (id, doc_no, quote_date, valid_until, customer_id, customer_name, customer_code, phone, address, tax_id,
              price_level, subtotal, line_discount_total, bill_discount, total, note, created_by_name)
            VALUES ($1::uuid, ${docNoSql('$2', '$3')}, $4::date, $5::date, $6::uuid, $7, $8, $9, $10, $11, $12::smallint, $13::numeric,
              $14::numeric, $15::numeric, $16::numeric, $17, $18)`,
      params: [
        id,
        'QT',
        period,
        b.quoteDate,
        head.validUntil,
        b.customerId ?? null,
        head.customerName,
        head.customerCode,
        head.phone,
        head.address,
        head.taxId,
        b.priceLevel,
        head.subtotal,
        head.lineDiscountTotal,
        head.billDiscount,
        head.total,
        b.note || null,
        c.get('appUser')?.displayName ?? null,
      ],
    },
    { sql: LINES_SQL, params: [id, JSON.stringify(lines)] },
  ])
  const [row] = await query(ctx, `${SELECT} WHERE q.id = $1::uuid`, [id])
  return c.json(mapQuotation(row ?? {}), 201)
})

/** Edit an open quotation (lines are replaced). */
quotationRoutes.put('/quotations/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = bodySchema.parse(await c.req.json())
  const [cur] = await query(ctx, 'SELECT status FROM quotations WHERE id = $1::uuid', [id])
  if (!cur) throw new HttpError(404, 'ไม่พบใบเสนอราคา')
  if (str(cur, 'status') !== 'open') throw new HttpError(409, 'แก้ได้เฉพาะใบเสนอราคาที่ยังไม่เปลี่ยนเป็นบิลหรือยกเลิก')
  const { head, lines } = await prepare(ctx, b)
  await transaction(ctx, [
    {
      sql: `UPDATE quotations SET quote_date = $2::date, valid_until = $3::date, customer_id = $4::uuid, customer_name = $5, customer_code = $6,
              phone = $7, address = $8, tax_id = $9, price_level = $10::smallint, subtotal = $11::numeric, line_discount_total = $12::numeric,
              bill_discount = $13::numeric, total = $14::numeric, note = $15, updated_at = now()
            WHERE id = $1::uuid AND status = 'open'`,
      params: [
        id,
        b.quoteDate,
        head.validUntil,
        b.customerId ?? null,
        head.customerName,
        head.customerCode,
        head.phone,
        head.address,
        head.taxId,
        b.priceLevel,
        head.subtotal,
        head.lineDiscountTotal,
        head.billDiscount,
        head.total,
        b.note || null,
      ],
    },
    { sql: 'DELETE FROM quotation_lines WHERE quotation_id = $1::uuid', params: [id] },
    { sql: LINES_SQL, params: [id, JSON.stringify(lines)] },
  ])
  const [row] = await query(ctx, `${SELECT} WHERE q.id = $1::uuid`, [id])
  return c.json(mapQuotation(row ?? {}))
})

const cancelSchema = z.object({ reason: z.string().trim().min(1, 'ระบุเหตุผล').max(300) })

quotationRoutes.post('/quotations/:id/cancel', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = cancelSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE quotations SET status = 'cancelled', cancel_reason = $2, updated_at = now() WHERE id = $1::uuid AND status = 'open' RETURNING id`,
      params: [id, b.reason],
    },
  ])
  if (!rows?.[0]) throw new HttpError(409, 'ยกเลิกได้เฉพาะใบเสนอราคาที่ยังเปิดอยู่')
  return c.json({ ok: true })
})
