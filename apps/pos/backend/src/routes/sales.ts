import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { taxInvoiceOps } from '../invoice.js'
import { loadOpenBills } from '../receivables.js'
import { guardTerm, query, transaction, type BatchOp, type Row } from '../gate.js'
import {
  aggregateByLot,
  allocateFefo,
  avgCostUpdateSql,
  demandByProduct,
  eventInsertSql,
  eventParams,
  loadLots,
  loadProducts,
  lotDecrementSql,
  movementsForLotsSql,
} from '../stock.js'
import {
  bangkokPeriod,
  bool,
  counterBumpSql,
  dateOnly,
  docNoSql,
  eventEnvelope,
  money,
  num,
  qty,
  round2,
  round3,
  round4,
  str,
  strOrNull,
  uuid,
} from '../util.js'

export const salesRoutes = new Hono<AppEnv>()

const saleSchema = z.object({
  ...eventEnvelope,
  locationId: uuid,
  customerId: uuid.nullish(),
  priceLevel: z.number().int().min(1).max(5),
  lines: z
    .array(
      z.object({
        productId: uuid,
        qty,
        unitPrice: money,
        lineDiscount: money.default(0),
        /** fixed = customer fixed price, level = customer's level, fallback = level 1, manual = edited. */
        priceSource: z.enum(['fixed', 'level', 'fallback', 'manual']).nullish(),
      }),
    )
    .min(1)
    .max(200),
  billDiscount: money.default(0),
  paymentMethod: z.enum(['cash', 'promptpay', 'credit']),
  cashReceived: money.nullish(),
  note: z.string().trim().max(400).nullish(),
  /** Issue a full tax invoice now and include the bill in the accounting hand-off. */
  forAccounting: z.boolean().default(false),
  /** The quotation this bill was made from; it is marked converted in the same transaction. */
  quotationId: uuid.nullish(),
})

/** Spread the bill discount over lines in proportion to their totals (last line takes the rounding rest). */
function allocateBillDiscount(lineTotals: number[], billDiscount: number): number[] {
  const base = lineTotals.reduce((s, v) => s + v, 0)
  if (billDiscount <= 0 || base <= 0) return lineTotals.map(() => 0)
  const shares: number[] = []
  let used = 0
  lineTotals.forEach((total, i) => {
    if (i === lineTotals.length - 1) {
      shares.push(round2(billDiscount - used))
    } else {
      const share = round2((billDiscount * total) / base)
      shares.push(share)
      used = round2(used + share)
    }
  })
  return shares
}

salesRoutes.post('/sales', async (c) => {
  const ctx = c.get('ctx')
  const b = saleSchema.parse(await c.req.json())

  // Idempotent retry: the terminal re-sends the same eventId after a network error.
  const existing = await query(ctx, 'SELECT id, bill_no, total FROM sales WHERE event_id = $1::uuid', [b.eventId])
  if (existing[0]) {
    return c.json({ id: str(existing[0], 'id'), billNo: str(existing[0], 'bill_no'), total: num(existing[0], 'total'), duplicate: true })
  }

  if (b.forAccounting && !b.customerId) {
    throw new HttpError(400, 'ออกใบเสร็จเต็มรูปต้องเลือกลูกค้า (ชื่อ/ที่อยู่ผู้ซื้อ)')
  }

  const products = await loadProducts(ctx, b.lines.map((l) => l.productId))
  for (const p of products.values()) {
    if (!p.isActive) throw new HttpError(400, `สินค้า ${p.name} ถูกปิดการขายแล้ว`)
  }

  const computed = b.lines.map((l, i) => {
    const gross = round2(l.qty * l.unitPrice)
    const lineDiscount = round2(l.lineDiscount)
    if (lineDiscount > gross) {
      throw new HttpError(400, `ส่วนลดรายการที่ ${i + 1} มากกว่าราคาสินค้า`)
    }
    return { ...l, qty: round3(l.qty), unitPrice: round2(l.unitPrice), gross, lineDiscount, lineTotal: round2(gross - lineDiscount) }
  })
  const subtotal = round2(computed.reduce((s, l) => s + l.gross, 0))
  const lineDiscountTotal = round2(computed.reduce((s, l) => s + l.lineDiscount, 0))
  const afterLines = round2(subtotal - lineDiscountTotal)
  const billDiscount = round2(b.billDiscount)
  if (billDiscount > afterLines) throw new HttpError(400, 'ส่วนลดท้ายบิลมากกว่ายอดขาย')
  const total = round2(afterLines - billDiscount)
  const shares = allocateBillDiscount(computed.map((l) => l.lineTotal), billDiscount)

  let cashReceived: number | null = null
  let change: number | null = null
  if (b.paymentMethod === 'cash') {
    cashReceived = round2(b.cashReceived ?? total)
    if (cashReceived < total) throw new HttpError(400, 'รับเงินสดน้อยกว่ายอดที่ต้องชำระ')
    change = round2(cashReceived - total)
  }

  let customerName: string | null = null
  if (b.paymentMethod === 'credit') {
    if (!b.customerId) throw new HttpError(400, 'ขายเชื่อต้องเลือกลูกค้า')
    const rows = await query(ctx, 'SELECT name, balance, credit_limit, is_active FROM customers WHERE id = $1::uuid', [b.customerId])
    const cust = rows[0]
    if (!cust) throw new HttpError(400, 'ไม่พบลูกค้า')
    customerName = str(cust, 'name')
    const limit = num(cust, 'credit_limit')
    if (limit <= 0) throw new HttpError(400, `ลูกค้า ${customerName} ยังไม่ได้กำหนดวงเงินเครดิต`)
    const available = round2(limit - num(cust, 'balance'))
    if (total > available) {
      throw new HttpError(409, `เกินวงเงินเครดิต (ใช้ได้อีก ${available.toLocaleString('th-TH')} บาท)`, 'credit_limit')
    }
  }

  const names = new Map([...products.values()].map((p) => [p.id, p.name]))
  const lots = await loadLots(ctx, b.locationId, [...products.keys()])
  const allocations = allocateFefo(lots, demandByProduct(computed), names, { skipExpired: true })
  const lotQty = aggregateByLot(allocations)

  const saleId = randomUUID()
  const lineRecords = computed.map((l, i) => ({
    line_no: i + 1,
    product_id: l.productId,
    qty: l.qty,
    unit_price: l.unitPrice,
    line_discount: l.lineDiscount,
    line_total: l.lineTotal,
    share: shares[i] ?? 0,
    net: round2(l.lineTotal - (shares[i] ?? 0)),
    price_source: l.priceSource ?? null,
  }))

  const ops: BatchOp[] = [
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'sale.completed',
        terminalId: b.terminalId,
        zoneId: b.locationId,
        occurredAt: b.occurredAt,
        refType: 'sale',
        refId: saleId,
        payload: {
          saleId,
          locationId: b.locationId,
          customerId: b.customerId ?? null,
          priceLevel: b.priceLevel,
          paymentMethod: b.paymentMethod,
          forAccounting: b.forAccounting,
          subtotal,
          lineDiscountTotal,
          billDiscount,
          total,
          lines: lineRecords.map((l) => ({ ...l, product_name: names.get(l.product_id) ?? '' })),
          lots: allocations,
        },
      }),
    },
    { sql: counterBumpSql, params: ['S', bangkokPeriod(b.occurredAt)] },
    {
      sql: `INSERT INTO sales (id, bill_no, event_id, terminal_id, location_id, customer_id, price_level, subtotal,
              line_discount_total, bill_discount, total, payment_method, cash_received, change_amount, note, sold_at,
              due_date)
            VALUES ($3::uuid, ${docNoSql('$1', '$2')}, $4::uuid, $5::text, $6::uuid, $7::uuid, $8::smallint, $9::numeric,
                    $10::numeric, $11::numeric, $12::numeric, $13::text, $14::numeric, $15::numeric, $16::text,
                    $17::timestamptz,
                    CASE WHEN $13::text = 'credit'
                         THEN ($17::timestamptz AT TIME ZONE 'Asia/Bangkok')::date
                              + COALESCE((SELECT credit_term_days FROM customers WHERE id = $7::uuid), 0)
                    END)
            RETURNING bill_no`,
      params: [
        'S',
        bangkokPeriod(b.occurredAt),
        saleId,
        b.eventId,
        b.terminalId,
        b.locationId,
        b.customerId ?? null,
        b.priceLevel,
        subtotal,
        lineDiscountTotal,
        billDiscount,
        total,
        b.paymentMethod,
        cashReceived,
        change,
        b.note ?? null,
        b.occurredAt,
      ],
    },
    {
      // Cost of goods sold = moving average cost at the moment of sale.
      sql: `INSERT INTO sale_lines (sale_id, line_no, product_id, product_name, unit, qty, unit_price, line_discount,
              line_total, bill_discount_share, net_amount, unit_cost, cost_total, price_source)
            SELECT $1::uuid, x.line_no, x.product_id, p.name, p.unit, x.qty, x.unit_price, x.line_discount,
                   x.line_total, x.share, x.net, p.avg_cost, ROUND(p.avg_cost * x.qty, 4), x.price_source
              FROM jsonb_to_recordset($2::jsonb) AS x(line_no int, product_id uuid, qty numeric, unit_price numeric,
                   line_discount numeric, line_total numeric, share numeric, net numeric, price_source text)
              JOIN products p ON p.id = x.product_id`,
      params: [saleId, JSON.stringify(lineRecords)],
    },
    {
      sql: `UPDATE sales SET cost_total = (SELECT COALESCE(SUM(cost_total), 0) FROM sale_lines WHERE sale_id = $1::uuid)
             WHERE id = $1::uuid`,
      params: [saleId],
    },
    {
      sql: movementsForLotsSql({
        event: '$1',
        terminal: '$2',
        zone: '$3',
        occurredAt: '$4',
        type: "'sale'",
        recordset: '$5',
        refType: "'sale'",
        refId: '$6',
        reason: 'NULL',
        sign: -1,
      }),
      params: [b.eventId, b.terminalId, b.locationId, b.occurredAt, JSON.stringify(lotQty), saleId],
    },
    { sql: lotDecrementSql('$1'), params: [JSON.stringify(lotQty)] },
  ]

  if (b.paymentMethod === 'credit' && b.customerId) {
    ops.push(
      {
        sql: `UPDATE customers
                 SET balance = balance + $2::numeric + ${guardTerm('balance + $2::numeric <= credit_limit')},
                     updated_at = now()
               WHERE id = $1::uuid`,
        params: [b.customerId, total],
        guard: 'เกินวงเงินเครดิตของลูกค้า',
      },
      {
        sql: `INSERT INTO ar_entries (customer_id, event_id, entry_type, amount, ref_id)
              VALUES ($1::uuid, $2::uuid, 'sale', $3::numeric, $4::uuid)`,
        params: [b.customerId, b.eventId, total, saleId],
      },
    )
  }

  if (b.quotationId) {
    ops.push({
      sql: `UPDATE quotations SET status = 'converted', sale_id = $2::uuid, converted_at = now(), updated_at = now(),
              total = total + ${guardTerm(`status = 'open'`)}
            WHERE id = $1::uuid`,
      params: [b.quotationId, saleId],
      guard: 'ใบเสนอราคานี้ถูกเปลี่ยนเป็นบิลหรือยกเลิกไปแล้ว',
    })
  }

  const invoiceAt = ops.length
  if (b.forAccounting) ops.push(...taxInvoiceOps(saleId, b.occurredAt))

  const results = await transaction(ctx, ops)
  const billNo = str(results[2]?.[0] ?? {}, 'bill_no')
  const taxInvoiceNo = b.forAccounting ? strOrNull(results[invoiceAt + 1]?.[0] ?? {}, 'tax_invoice_no') : null
  return c.json({ id: saleId, billNo, total, change, customerName, taxInvoiceNo, duplicate: false }, 201)
})

export interface Buyer {
  name: string
  code: string | null
  taxId: string | null
  address: string | null
  branchCode: string | null
  phone: string | null
}

/** Buyer snapshot frozen on the sale when its tax invoice was issued. */
function parseBuyer(text: string | null): Buyer | null {
  if (!text) return null
  try {
    const v: unknown = JSON.parse(text)
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    const s = (k: string) => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : null)
    return { name: s('name') ?? '', code: s('code'), taxId: s('taxId'), address: s('address'), branchCode: s('branchCode'), phone: s('phone') }
  } catch {
    return null
  }
}

export function mapSaleHeader(r: Row) {
  return {
    id: str(r, 'id'),
    billNo: str(r, 'bill_no'),
    eventId: str(r, 'event_id'),
    terminalId: str(r, 'terminal_id'),
    locationId: str(r, 'location_id'),
    locationName: strOrNull(r, 'location_name'),
    customerId: strOrNull(r, 'customer_id'),
    customerName: strOrNull(r, 'customer_name'),
    priceLevel: num(r, 'price_level'),
    subtotal: num(r, 'subtotal'),
    lineDiscountTotal: num(r, 'line_discount_total'),
    billDiscount: num(r, 'bill_discount'),
    total: num(r, 'total'),
    costTotal: num(r, 'cost_total'),
    profit: round2(num(r, 'total') - num(r, 'cost_total')),
    paymentMethod: str(r, 'payment_method'),
    cashReceived: r['cash_received'] === null ? null : num(r, 'cash_received'),
    changeAmount: r['change_amount'] === null ? null : num(r, 'change_amount'),
    status: str(r, 'status'),
    voidReason: strOrNull(r, 'void_reason'),
    note: strOrNull(r, 'note'),
    soldAt: str(r, 'sold_at'),
    createdBy: strOrNull(r, 'created_by'),
    forAccounting: bool(r, 'for_accounting'),
    taxInvoiceNo: strOrNull(r, 'tax_invoice_no'),
    taxInvoiceAt: strOrNull(r, 'tax_invoice_at'),
    vatRate: r['vat_rate'] === null || r['vat_rate'] === undefined ? null : num(r, 'vat_rate'),
    vatAmount: r['vat_amount'] === null || r['vat_amount'] === undefined ? null : num(r, 'vat_amount'),
    buyer: parseBuyer(strOrNull(r, 'buyer_text')),
    accountingSentAt: strOrNull(r, 'accounting_sent_at'),
    dueDate: strOrNull(r, 'due_text'),
  }
}

export const SALE_SELECT = `
  SELECT s.*, s.buyer::text AS buyer_text, s.due_date::text AS due_text, l.name AS location_name, cu.name AS customer_name
    FROM sales s
    JOIN locations l ON l.id = s.location_id
    LEFT JOIN customers cu ON cu.id = s.customer_id`

salesRoutes.get('/sales', async (c) => {
  const ctx = c.get('ctx')
  const from = z.string().date().parse(c.req.query('from'))
  const to = z.string().date().parse(c.req.query('to'))
  const q = (c.req.query('q') ?? '').trim()
  const rows = await query(
    ctx,
    `${SALE_SELECT}
      WHERE (s.sold_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date
        AND ($3 = '' OR s.bill_no ILIKE '%' || $3 || '%' OR cu.name ILIKE '%' || $3 || '%')
      ORDER BY s.sold_at DESC LIMIT 500`,
    [from, to, q],
  )
  return c.json(rows.map(mapSaleHeader))
})

salesRoutes.get('/sales/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [header, lines, lots] = await Promise.all([
    query(ctx, `${SALE_SELECT} WHERE s.id = $1::uuid`, [id]),
    query(
      ctx,
      'SELECT sl.*, p.image_url FROM sale_lines sl LEFT JOIN products p ON p.id = sl.product_id WHERE sl.sale_id = $1::uuid ORDER BY sl.line_no',
      [id],
    ),
    query(
      ctx,
      `SELECT product_id, lot_no, expiry_date::text AS expiry_date, -qty_change AS qty
         FROM stock_movements WHERE ref_type = 'sale' AND ref_id = $1::uuid AND movement_type = 'sale'`,
      [id],
    ),
  ])
  if (!header[0]) throw new HttpError(404, 'ไม่พบบิล')
  return c.json({
    ...mapSaleHeader(header[0]),
    lines: lines.map((r) => ({
      lineNo: num(r, 'line_no'),
      productId: str(r, 'product_id'),
      productName: str(r, 'product_name'),
      imageUrl: strOrNull(r, 'image_url'),
      unit: str(r, 'unit'),
      qty: num(r, 'qty'),
      unitPrice: num(r, 'unit_price'),
      lineDiscount: num(r, 'line_discount'),
      lineTotal: num(r, 'line_total'),
      billDiscountShare: num(r, 'bill_discount_share'),
      netAmount: num(r, 'net_amount'),
      unitCost: num(r, 'unit_cost'),
      costTotal: num(r, 'cost_total'),
      priceSource: strOrNull(r, 'price_source'),
    })),
    lots: lots.map((r) => ({
      productId: str(r, 'product_id'),
      lotNo: str(r, 'lot_no'),
      expiryDate: dateOnly(r, 'expiry_date'),
      qty: num(r, 'qty'),
    })),
  })
})

const voidSchema = z.object({
  ...eventEnvelope,
  reason: z.string().trim().min(2).max(400),
})

/** ยกเลิกบิล: return stock to the same lots at the sale's cost and reverse any receivable. */
salesRoutes.post('/sales/:id/void', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = voidSchema.parse(await c.req.json())

  const [header, movements] = await Promise.all([
    query(ctx, 'SELECT * FROM sales WHERE id = $1::uuid', [id]),
    query(
      ctx,
      `SELECT lot_id, product_id, -qty_change AS qty, unit_cost FROM stock_movements
        WHERE ref_type = 'sale' AND ref_id = $1::uuid AND movement_type = 'sale'`,
      [id],
    ),
  ])
  const sale = header[0]
  if (!sale) throw new HttpError(404, 'ไม่พบบิล')
  if (str(sale, 'status') !== 'completed') throw new HttpError(409, 'บิลนี้ถูกยกเลิกไปแล้ว')
  // A credit bill that has already received money cannot be voided (the receipt would dangle).
  if (str(sale, 'payment_method') === 'credit' && strOrNull(sale, 'customer_id')) {
    const open = (await loadOpenBills(ctx, str(sale, 'customer_id'))).find((x) => x.saleId === id)
    if (!open || open.paid > 0) {
      throw new HttpError(409, 'บิลเงินเชื่อนี้รับชำระแล้ว (บางส่วนหรือทั้งหมด) จึงยกเลิกไม่ได้', 'credit_paid')
    }
  }

  const returned = movements.map((m) => ({
    lot_id: str(m, 'lot_id'),
    product_id: str(m, 'product_id'),
    qty: num(m, 'qty'),
    unit_cost: num(m, 'unit_cost'),
  }))
  const costIn = returned.map((m) => ({ product_id: m.product_id, q: m.qty, amount: round4(m.qty * m.unit_cost) }))
  const locationId = str(sale, 'location_id')
  const total = num(sale, 'total')
  const customerId = strOrNull(sale, 'customer_id')

  const ops: BatchOp[] = [
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'sale.voided',
        terminalId: b.terminalId,
        zoneId: locationId,
        occurredAt: b.occurredAt,
        refType: 'sale',
        refId: id,
        payload: { saleId: id, billNo: str(sale, 'bill_no'), reason: b.reason, total, lots: returned },
      }),
    },
    {
      sql: `UPDATE sales SET status = 'voided', void_reason = $2, voided_at = $3::timestamptz, void_event_id = $4::uuid,
                   total = total + ${guardTerm(`status = 'completed'`)}
             WHERE id = $1::uuid`,
      params: [id, b.reason, b.occurredAt, b.eventId],
      guard: 'บิลนี้ถูกยกเลิกไปแล้ว',
    },
    // Average cost first (it reads on-hand before the lots are refilled).
    { sql: avgCostUpdateSql('$1'), params: [JSON.stringify(costIn)] },
    {
      sql: `UPDATE stock_lots l SET qty = l.qty + a.qty, updated_at = now()
              FROM (SELECT lot_id, SUM(qty) AS qty FROM jsonb_to_recordset($1::jsonb) AS x(lot_id uuid, qty numeric)
                     GROUP BY lot_id) a
             WHERE l.id = a.lot_id`,
      params: [JSON.stringify(returned)],
    },
    {
      sql: movementsForLotsSql({
        event: '$1',
        terminal: '$2',
        zone: '$3',
        occurredAt: '$4',
        type: "'sale_void'",
        recordset: '$5',
        refType: "'sale'",
        refId: '$6',
        reason: '$7',
        sign: 1,
      }),
      params: [b.eventId, b.terminalId, locationId, b.occurredAt, JSON.stringify(returned), id, b.reason],
    },
  ]

  if (str(sale, 'payment_method') === 'credit' && customerId) {
    ops.push(
      {
        sql: `UPDATE customers SET balance = balance - $2::numeric, updated_at = now() WHERE id = $1::uuid`,
        params: [customerId, total],
      },
      {
        sql: `INSERT INTO ar_entries (customer_id, event_id, entry_type, amount, ref_id, note)
              VALUES ($1::uuid, $2::uuid, 'sale_void', $3::numeric, $4::uuid, $5)`,
        params: [customerId, b.eventId, -total, id, b.reason],
      },
    )
  }

  await transaction(ctx, ops)
  return c.json({ ok: true })
})

const issueSchema = z.object({ ...eventEnvelope })

/** ออกใบเสร็จเต็มรูปย้อนหลังให้บิลที่ขายไปแล้ว */
salesRoutes.post('/sales/:id/tax-invoice', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = issueSchema.parse(await c.req.json())
  const rows = await query(ctx, 'SELECT status, customer_id, tax_invoice_no, location_id, bill_no FROM sales WHERE id = $1::uuid', [id])
  const sale = rows[0]
  if (!sale) throw new HttpError(404, 'ไม่พบบิล')
  if (strOrNull(sale, 'tax_invoice_no')) throw new HttpError(409, `บิลนี้ออกใบเสร็จเต็มรูปแล้ว (${str(sale, 'tax_invoice_no')})`)
  if (str(sale, 'status') !== 'completed') throw new HttpError(409, 'บิลที่ยกเลิกแล้วออกใบเสร็จเต็มรูปไม่ได้')
  if (!strOrNull(sale, 'customer_id')) throw new HttpError(400, 'บิลนี้ไม่ได้ระบุลูกค้า จึงออกใบเสร็จเต็มรูปไม่ได้')

  const results = await transaction(ctx, [
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'sale.tax_invoice_issued',
        terminalId: b.terminalId,
        zoneId: str(sale, 'location_id'),
        occurredAt: b.occurredAt,
        refType: 'sale',
        refId: id,
        payload: { saleId: id, billNo: str(sale, 'bill_no') },
      }),
    },
    ...taxInvoiceOps(id, b.occurredAt),
  ])
  return c.json({ ok: true, taxInvoiceNo: strOrNull(results[2]?.[0] ?? {}, 'tax_invoice_no') })
})
