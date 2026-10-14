import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { guardTerm, query, transaction, type BatchOp, type Row } from '../gate.js'
import {
  avgCostUpdateSql,
  eventInsertSql,
  eventParams,
  loadProducts,
  lotUpsertSql,
  movementsForLotIdentitySql,
} from '../stock.js'
import {
  bangkokPeriod,
  bool,
  counterBumpSql,
  dateOnly,
  docNoSql,
  eventEnvelope,
  num,
  optionalDate,
  qty,
  round2,
  round3,
  round4,
  str,
  strOrNull,
  uuid,
} from '../util.js'

export const purchasingRoutes = new Hono<AppEnv>()

const unitCost = z.number().min(0).max(10_000_000)

// ---------------------------------------------------------------- purchase orders

function mapPo(r: Row) {
  return {
    id: str(r, 'id'),
    poNo: str(r, 'po_no'),
    supplierId: str(r, 'supplier_id'),
    supplierName: strOrNull(r, 'supplier_name'),
    locationId: str(r, 'location_id'),
    locationName: strOrNull(r, 'location_name'),
    status: str(r, 'status'),
    orderDate: dateOnly(r, 'order_date'),
    expectedDate: dateOnly(r, 'expected_date'),
    note: strOrNull(r, 'note'),
    total: num(r, 'total'),
    receivedPercent: num(r, 'received_percent'),
    createdAt: str(r, 'created_at'),
  }
}

const PO_SELECT = `
  SELECT po.*, su.name AS supplier_name, l.name AS location_name,
         COALESCE((SELECT ROUND(100 * SUM(LEAST(qty_received, qty_ordered)) / NULLIF(SUM(qty_ordered), 0))
                     FROM po_lines WHERE po_id = po.id), 0) AS received_percent
    FROM purchase_orders po
    JOIN suppliers su ON su.id = po.supplier_id
    JOIN locations l ON l.id = po.location_id`

purchasingRoutes.get('/purchase-orders', async (c) => {
  const ctx = c.get('ctx')
  const status = c.req.query('status') ?? ''
  const rows = await query(
    ctx,
    `${PO_SELECT}
      WHERE ($1 = '' OR po.status = $1 OR ($1 = 'pending' AND po.status IN ('open', 'partial')))
      ORDER BY po.created_at DESC LIMIT 300`,
    [status],
  )
  return c.json(rows.map(mapPo))
})

purchasingRoutes.get('/purchase-orders/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [header, lines, receipts] = await Promise.all([
    query(ctx, `${PO_SELECT} WHERE po.id = $1::uuid`, [id]),
    query(
      ctx,
      `SELECT pl.*, p.name AS product_name, p.sku, p.unit, p.track_expiry
         FROM po_lines pl JOIN products p ON p.id = pl.product_id
        WHERE pl.po_id = $1::uuid ORDER BY pl.line_no`,
      [id],
    ),
    query(
      ctx,
      `SELECT id, receipt_no, supplier_invoice_no, total, received_at FROM goods_receipts
        WHERE po_id = $1::uuid ORDER BY received_at`,
      [id],
    ),
  ])
  if (!header[0]) throw new HttpError(404, 'ไม่พบใบสั่งซื้อ')
  return c.json({
    ...mapPo(header[0]),
    lines: lines.map((r) => ({
      id: str(r, 'id'),
      lineNo: num(r, 'line_no'),
      productId: str(r, 'product_id'),
      productName: str(r, 'product_name'),
      sku: str(r, 'sku'),
      unit: str(r, 'unit'),
      trackExpiry: bool(r, 'track_expiry'),
      qtyOrdered: num(r, 'qty_ordered'),
      qtyReceived: num(r, 'qty_received'),
      unitCost: num(r, 'unit_cost'),
    })),
    receipts: receipts.map((r) => ({
      id: str(r, 'id'),
      receiptNo: str(r, 'receipt_no'),
      supplierInvoiceNo: strOrNull(r, 'supplier_invoice_no'),
      total: num(r, 'total'),
      receivedAt: str(r, 'received_at'),
    })),
  })
})

const poSchema = z.object({
  ...eventEnvelope,
  supplierId: uuid,
  locationId: uuid,
  expectedDate: optionalDate,
  note: z.string().trim().max(400).nullish(),
  lines: z.array(z.object({ productId: uuid, qtyOrdered: qty, unitCost })).min(1).max(200),
})

purchasingRoutes.post('/purchase-orders', async (c) => {
  const ctx = c.get('ctx')
  const b = poSchema.parse(await c.req.json())
  await loadProducts(ctx, b.lines.map((l) => l.productId))
  const poId = randomUUID()
  const lines = b.lines.map((l, i) => ({
    line_no: i + 1,
    product_id: l.productId,
    qty: round3(l.qtyOrdered),
    unit_cost: round4(l.unitCost),
  }))
  const total = round2(lines.reduce((s, l) => s + l.qty * l.unit_cost, 0))

  const results = await transaction(ctx, [
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'po.created',
        terminalId: b.terminalId,
        zoneId: b.locationId,
        occurredAt: b.occurredAt,
        refType: 'purchase_order',
        refId: poId,
        payload: { poId, supplierId: b.supplierId, locationId: b.locationId, total, lines },
      }),
    },
    { sql: counterBumpSql, params: ['PO', bangkokPeriod(b.occurredAt)] },
    {
      sql: `INSERT INTO purchase_orders (id, po_no, supplier_id, location_id, expected_date, note, total, order_date)
            VALUES ($3::uuid, ${docNoSql('$1', '$2')}, $4::uuid, $5::uuid, $6::date, $7::text, $8::numeric,
                    ($9::timestamptz AT TIME ZONE 'Asia/Bangkok')::date)
            RETURNING po_no`,
      params: ['PO', bangkokPeriod(b.occurredAt), poId, b.supplierId, b.locationId, b.expectedDate, b.note ?? null, total, b.occurredAt],
    },
    {
      sql: `INSERT INTO po_lines (po_id, line_no, product_id, qty_ordered, unit_cost)
            SELECT $1::uuid, x.line_no, x.product_id, x.qty, x.unit_cost
              FROM jsonb_to_recordset($2::jsonb) AS x(line_no int, product_id uuid, qty numeric, unit_cost numeric)`,
      params: [poId, JSON.stringify(lines)],
    },
  ])
  return c.json({ id: poId, poNo: str(results[2]?.[0] ?? {}, 'po_no') }, 201)
})

const cancelSchema = z.object({ ...eventEnvelope, reason: z.string().trim().min(2).max(400) })

purchasingRoutes.post('/purchase-orders/:id/cancel', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = cancelSchema.parse(await c.req.json())
  const rows = await query(ctx, 'SELECT location_id, status FROM purchase_orders WHERE id = $1::uuid', [id])
  if (!rows[0]) throw new HttpError(404, 'ไม่พบใบสั่งซื้อ')
  await transaction(ctx, [
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'po.cancelled',
        terminalId: b.terminalId,
        zoneId: str(rows[0], 'location_id'),
        occurredAt: b.occurredAt,
        refType: 'purchase_order',
        refId: id,
        payload: { poId: id, reason: b.reason },
      }),
    },
    {
      sql: `UPDATE purchase_orders
               SET status = 'cancelled', note = COALESCE(note || E'\\n', '') || 'ยกเลิก: ' || $2::text,
                   total = total + ${guardTerm(`status IN ('open', 'partial')`)}, updated_at = now()
             WHERE id = $1::uuid`,
      params: [id, b.reason],
      guard: 'ใบสั่งซื้อนี้ปิดหรือยกเลิกไปแล้ว',
    },
  ])
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- goods receipts (รับเข้า)

const receiptSchema = z.object({
  ...eventEnvelope,
  locationId: uuid,
  poId: uuid.nullish(),
  supplierId: uuid.nullish(),
  supplierInvoiceNo: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(400).nullish(),
  lines: z
    .array(
      z.object({
        poLineId: uuid.nullish(),
        productId: uuid,
        qty,
        unitCost,
        lotNo: z.string().trim().max(60).nullish(),
        expiryDate: optionalDate,
      }),
    )
    .min(1)
    .max(200),
})

purchasingRoutes.post('/receipts', async (c) => {
  const ctx = c.get('ctx')
  const b = receiptSchema.parse(await c.req.json())

  const existing = await query(ctx, 'SELECT id, receipt_no FROM goods_receipts WHERE event_id = $1::uuid', [b.eventId])
  if (existing[0]) {
    return c.json({ id: str(existing[0], 'id'), receiptNo: str(existing[0], 'receipt_no'), duplicate: true })
  }

  const products = await loadProducts(ctx, b.lines.map((l) => l.productId))
  for (const [i, line] of b.lines.entries()) {
    const p = products.get(line.productId)
    if (p?.trackExpiry && !line.expiryDate) {
      throw new HttpError(400, `รายการที่ ${i + 1} (${p.name}) ต้องระบุวันหมดอายุ`)
    }
  }

  let supplierId = b.supplierId ?? null
  const poLineQty = new Map<string, number>()
  if (b.poId) {
    const [po, poLines] = await Promise.all([
      query(ctx, 'SELECT supplier_id, status FROM purchase_orders WHERE id = $1::uuid', [b.poId]),
      query(ctx, 'SELECT id, product_id, qty_ordered, qty_received FROM po_lines WHERE po_id = $1::uuid', [b.poId]),
    ])
    if (!po[0]) throw new HttpError(404, 'ไม่พบใบสั่งซื้อ')
    const status = str(po[0], 'status')
    if (status !== 'open' && status !== 'partial') throw new HttpError(409, 'ใบสั่งซื้อนี้ปิดหรือยกเลิกแล้ว')
    supplierId = str(po[0], 'supplier_id')
    const byId = new Map(poLines.map((r) => [str(r, 'id'), r]))
    for (const line of b.lines) {
      if (!line.poLineId) throw new HttpError(400, 'รับตามใบสั่งซื้อต้องอ้างอิงรายการในใบสั่งซื้อ')
      const pl = byId.get(line.poLineId)
      if (!pl || str(pl, 'product_id') !== line.productId) throw new HttpError(400, 'รายการไม่ตรงกับใบสั่งซื้อ')
      poLineQty.set(line.poLineId, round3((poLineQty.get(line.poLineId) ?? 0) + line.qty))
    }
    for (const [lineId, q] of poLineQty) {
      const pl = byId.get(lineId)
      if (!pl) continue
      const remaining = round3(num(pl, 'qty_ordered') - num(pl, 'qty_received'))
      if (q > remaining) {
        const name = products.get(str(pl, 'product_id'))?.name ?? ''
        throw new HttpError(400, `${name}: รับเกินจำนวนที่ค้างรับ (ค้าง ${remaining})`)
      }
    }
  }

  const receiptId = randomUUID()
  const lines = b.lines.map((l) => ({
    po_line_id: l.poLineId ?? null,
    product_id: l.productId,
    qty: round3(l.qty),
    unit_cost: round4(l.unitCost),
    lot_no: l.lotNo ?? '',
    expiry_date: l.expiryDate,
  }))
  // One row per lot identity so the upsert never touches a row twice.
  const lotMap = new Map<string, { product_id: string; lot_no: string; expiry_date: string | null; qty: number; amount: number }>()
  for (const l of lines) {
    const key = `${l.product_id}|${l.lot_no}|${l.expiry_date ?? ''}`
    const cur = lotMap.get(key) ?? { product_id: l.product_id, lot_no: l.lot_no, expiry_date: l.expiry_date, qty: 0, amount: 0 }
    cur.qty = round3(cur.qty + l.qty)
    cur.amount = round4(cur.amount + l.qty * l.unit_cost)
    lotMap.set(key, cur)
  }
  const lotRows = [...lotMap.values()].map((l) => ({ ...l, unit_cost: l.qty > 0 ? round4(l.amount / l.qty) : 0 }))
  const costIn = lines.map((l) => ({ product_id: l.product_id, q: l.qty, amount: round4(l.qty * l.unit_cost) }))
  const total = round2(lines.reduce((s, l) => s + l.qty * l.unit_cost, 0))
  const poLineRows = [...poLineQty].map(([id, q]) => ({ id, q }))

  const ops: BatchOp[] = [
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'stock.received',
        terminalId: b.terminalId,
        zoneId: b.locationId,
        occurredAt: b.occurredAt,
        refType: 'goods_receipt',
        refId: receiptId,
        payload: { receiptId, poId: b.poId ?? null, supplierId, locationId: b.locationId, total, lines },
      }),
    },
    { sql: counterBumpSql, params: ['GR', bangkokPeriod(b.occurredAt)] },
    {
      sql: `INSERT INTO goods_receipts (id, receipt_no, event_id, po_id, supplier_id, location_id, terminal_id,
              supplier_invoice_no, total, note, received_at)
            VALUES ($3::uuid, ${docNoSql('$1', '$2')}, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::text, $9::text,
                    $10::numeric, $11::text, $12::timestamptz)
            RETURNING receipt_no`,
      params: [
        'GR',
        bangkokPeriod(b.occurredAt),
        receiptId,
        b.eventId,
        b.poId ?? null,
        supplierId,
        b.locationId,
        b.terminalId,
        b.supplierInvoiceNo ?? null,
        total,
        b.note ?? null,
        b.occurredAt,
      ],
    },
    {
      sql: `INSERT INTO goods_receipt_lines (receipt_id, po_line_id, product_id, qty, unit_cost, lot_no, expiry_date)
            SELECT $1::uuid, x.po_line_id, x.product_id, x.qty, x.unit_cost, x.lot_no, x.expiry_date
              FROM jsonb_to_recordset($2::jsonb) AS x(po_line_id uuid, product_id uuid, qty numeric, unit_cost numeric,
                   lot_no text, expiry_date date)`,
      params: [receiptId, JSON.stringify(lines)],
    },
    // Moving average must read on-hand before the new lots land.
    { sql: avgCostUpdateSql('$1'), params: [JSON.stringify(costIn)] },
    { sql: lotUpsertSql('$1', '$2', '$3'), params: [b.locationId, JSON.stringify(lotRows), b.occurredAt] },
    {
      sql: movementsForLotIdentitySql({
        event: '$1',
        terminal: '$2',
        zone: '$3',
        occurredAt: '$4',
        type: "'receive'",
        location: '$7',
        recordset: '$5',
        refType: "'goods_receipt'",
        refId: '$6',
        reason: 'NULL',
      }),
      params: [b.eventId, b.terminalId, b.locationId, b.occurredAt, JSON.stringify(lotRows), receiptId, b.locationId],
    },
  ]

  if (b.poId && poLineRows.length > 0) {
    ops.push(
      {
        sql: `UPDATE po_lines pl
                 SET qty_received = pl.qty_received + a.q + ${guardTerm('pl.qty_received + a.q <= pl.qty_ordered')}
                FROM jsonb_to_recordset($1::jsonb) AS a(id uuid, q numeric)
               WHERE pl.id = a.id`,
        params: [JSON.stringify(poLineRows)],
        guard: 'มีการรับสินค้าตามใบสั่งซื้อนี้จากเครื่องอื่นพร้อมกัน กรุณาเปิดใบสั่งซื้อใหม่',
      },
      {
        sql: `UPDATE purchase_orders SET updated_at = now(),
                status = CASE WHEN EXISTS (SELECT 1 FROM po_lines WHERE po_id = $1::uuid AND qty_received < qty_ordered)
                              THEN 'partial' ELSE 'received' END
              WHERE id = $1::uuid`,
        params: [b.poId],
      },
    )
  }

  const results = await transaction(ctx, ops)
  return c.json({ id: receiptId, receiptNo: str(results[2]?.[0] ?? {}, 'receipt_no'), total, duplicate: false }, 201)
})

purchasingRoutes.get('/receipts', async (c) => {
  const ctx = c.get('ctx')
  const rows = await query(
    ctx,
    `SELECT gr.*, su.name AS supplier_name, l.name AS location_name, po.po_no
       FROM goods_receipts gr
       JOIN locations l ON l.id = gr.location_id
       LEFT JOIN suppliers su ON su.id = gr.supplier_id
       LEFT JOIN purchase_orders po ON po.id = gr.po_id
      ORDER BY gr.received_at DESC LIMIT 200`,
  )
  return c.json(
    rows.map((r) => ({
      id: str(r, 'id'),
      receiptNo: str(r, 'receipt_no'),
      poNo: strOrNull(r, 'po_no'),
      supplierName: strOrNull(r, 'supplier_name'),
      locationName: str(r, 'location_name'),
      supplierInvoiceNo: strOrNull(r, 'supplier_invoice_no'),
      total: num(r, 'total'),
      receivedAt: str(r, 'received_at'),
    })),
  )
})

purchasingRoutes.get('/receipts/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [header, lines] = await Promise.all([
    query(
      ctx,
      `SELECT gr.*, su.name AS supplier_name, l.name AS location_name, po.po_no
         FROM goods_receipts gr JOIN locations l ON l.id = gr.location_id
         LEFT JOIN suppliers su ON su.id = gr.supplier_id LEFT JOIN purchase_orders po ON po.id = gr.po_id
        WHERE gr.id = $1::uuid`,
      [id],
    ),
    query(
      ctx,
      `SELECT gl.*, gl.expiry_date::text AS expiry_text, p.name AS product_name, p.unit
         FROM goods_receipt_lines gl JOIN products p ON p.id = gl.product_id WHERE gl.receipt_id = $1::uuid`,
      [id],
    ),
  ])
  if (!header[0]) throw new HttpError(404, 'ไม่พบใบรับสินค้า')
  const h = header[0]
  return c.json({
    id: str(h, 'id'),
    receiptNo: str(h, 'receipt_no'),
    poNo: strOrNull(h, 'po_no'),
    supplierName: strOrNull(h, 'supplier_name'),
    locationName: str(h, 'location_name'),
    supplierInvoiceNo: strOrNull(h, 'supplier_invoice_no'),
    note: strOrNull(h, 'note'),
    total: num(h, 'total'),
    receivedAt: str(h, 'received_at'),
    lines: lines.map((r) => ({
      productName: str(r, 'product_name'),
      unit: str(r, 'unit'),
      qty: num(r, 'qty'),
      unitCost: num(r, 'unit_cost'),
      lotNo: str(r, 'lot_no'),
      expiryDate: dateOnly(r, 'expiry_text'),
    })),
  })
})
