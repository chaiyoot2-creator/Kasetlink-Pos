import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { query, transaction, type BatchOp, type Row } from '../gate.js'
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
  lotUpsertSql,
  movementsForLotIdentitySql,
  movementsForLotsSql,
  todayBangkok,
  type Allocation,
} from '../stock.js'
import {
  bangkokPeriod,
  bool,
  counterBumpSql,
  docNoSql,
  dateOnly,
  eventEnvelope,
  num,
  optionalDate,
  qty,
  round3,
  round4,
  str,
  strOrNull,
  uuid,
} from '../util.js'

export const stockRoutes = new Hono<AppEnv>()

export const ADJUST_REASONS = {
  count: 'ตรวจนับสต็อก',
  damaged: 'สินค้าเสียหาย',
  expired: 'สินค้าหมดอายุ',
  lost: 'สูญหาย',
  opening: 'ยอดยกมา',
  internal_use: 'เบิกใช้ภายใน',
  other: 'อื่น ๆ',
} as const

// ---------------------------------------------------------------- balances & lots

stockRoutes.get('/stock/balances', async (c) => {
  const ctx = c.get('ctx')
  const q = (c.req.query('q') ?? '').trim()
  const rows = await query(
    ctx,
    `SELECT p.id, p.sku, p.name, p.unit, p.category, p.reorder_point, p.avg_cost, p.is_active,
            COALESCE(jsonb_object_agg(s.location_id, s.qty) FILTER (WHERE s.location_id IS NOT NULL), '{}'::jsonb)::text AS by_location,
            COALESCE(SUM(s.qty), 0) AS qty_total
       FROM products p
       LEFT JOIN (SELECT product_id, location_id, SUM(qty) AS qty FROM stock_lots GROUP BY product_id, location_id) s
         ON s.product_id = p.id
      WHERE ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.sku ILIKE $1 || '%' OR p.barcode = $1)
      GROUP BY p.id
      ORDER BY p.is_active DESC, p.name
      LIMIT 1000`,
    [q],
  )
  return c.json(
    rows.map((r) => {
      const parsed: unknown = JSON.parse(str(r, 'by_location') || '{}')
      const byLocation: Record<string, number> = {}
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) byLocation[k] = Number(v) || 0
      }
      const qtyTotal = num(r, 'qty_total')
      return {
        productId: str(r, 'id'),
        sku: str(r, 'sku'),
        name: str(r, 'name'),
        unit: str(r, 'unit'),
        category: strOrNull(r, 'category'),
        reorderPoint: num(r, 'reorder_point'),
        avgCost: num(r, 'avg_cost'),
        isActive: bool(r, 'is_active'),
        qtyTotal,
        stockValue: round4(qtyTotal * num(r, 'avg_cost')),
        byLocation,
      }
    }),
  )
})

function mapLot(r: Row) {
  return {
    id: str(r, 'id'),
    productId: str(r, 'product_id'),
    productName: strOrNull(r, 'product_name'),
    unit: strOrNull(r, 'unit'),
    locationId: str(r, 'location_id'),
    locationName: strOrNull(r, 'location_name'),
    lotNo: str(r, 'lot_no'),
    expiryDate: dateOnly(r, 'expiry_text'),
    qty: num(r, 'qty'),
    lastUnitCost: num(r, 'last_unit_cost'),
    receivedAt: str(r, 'received_at'),
  }
}

const LOT_SELECT = `
  SELECT sl.*, sl.expiry_date::text AS expiry_text, p.name AS product_name, p.unit, l.name AS location_name
    FROM stock_lots sl
    JOIN products p ON p.id = sl.product_id
    JOIN locations l ON l.id = sl.location_id`

stockRoutes.get('/stock/lots', async (c) => {
  const ctx = c.get('ctx')
  const productId = c.req.query('productId') ?? ''
  const locationId = c.req.query('locationId') ?? ''
  if (productId) uuid.parse(productId)
  if (locationId) uuid.parse(locationId)
  const rows = await query(
    ctx,
    `${LOT_SELECT}
      WHERE sl.qty > 0
        AND ($1 = '' OR sl.product_id = NULLIF($1, '')::uuid)
        AND ($2 = '' OR sl.location_id = NULLIF($2, '')::uuid)
      ORDER BY p.name, sl.expiry_date ASC NULLS LAST, sl.received_at
      LIMIT 1000`,
    [productId, locationId],
  )
  return c.json(rows.map(mapLot))
})

stockRoutes.get('/stock/movements', async (c) => {
  const ctx = c.get('ctx')
  const productId = c.req.query('productId') ?? ''
  const locationId = c.req.query('locationId') ?? ''
  if (productId) uuid.parse(productId)
  if (locationId) uuid.parse(locationId)
  const limit = Math.min(Number(c.req.query('limit') ?? 200) || 200, 1000)
  const rows = await query(
    ctx,
    `SELECT m.*, m.expiry_date::text AS expiry_text, p.name AS product_name, p.unit, l.name AS location_name,
            COALESCE(s.bill_no, gr.receipt_no, d.doc_no) AS doc_no
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       JOIN locations l ON l.id = m.location_id
       LEFT JOIN sales s ON m.ref_type = 'sale' AND s.id = m.ref_id
       LEFT JOIN goods_receipts gr ON m.ref_type = 'goods_receipt' AND gr.id = m.ref_id
       LEFT JOIN stock_documents d ON m.ref_type = 'stock_document' AND d.id = m.ref_id
      WHERE ($1 = '' OR m.product_id = NULLIF($1, '')::uuid)
        AND ($2 = '' OR m.location_id = NULLIF($2, '')::uuid)
      ORDER BY m.occurred_at DESC, m.created_at DESC
      LIMIT $3::int`,
    [productId, locationId, limit],
  )
  return c.json(
    rows.map((r) => ({
      id: str(r, 'id'),
      eventId: str(r, 'event_id'),
      terminalId: str(r, 'terminal_id'),
      zoneId: str(r, 'zone_id'),
      occurredAt: str(r, 'occurred_at'),
      movementType: str(r, 'movement_type'),
      productId: str(r, 'product_id'),
      productName: str(r, 'product_name'),
      unit: str(r, 'unit'),
      locationName: str(r, 'location_name'),
      lotNo: str(r, 'lot_no'),
      expiryDate: dateOnly(r, 'expiry_text'),
      qtyChange: num(r, 'qty_change'),
      unitCost: num(r, 'unit_cost'),
      refType: str(r, 'ref_type'),
      docNo: strOrNull(r, 'doc_no'),
      reason: strOrNull(r, 'reason'),
    })),
  )
})

// ---------------------------------------------------------------- alerts

stockRoutes.get('/alerts', async (c) => {
  const ctx = c.get('ctx')
  const today = todayBangkok()
  const settings = await query(ctx, 'SELECT expiry_alert_days FROM shop_settings LIMIT 1')
  const days = settings[0] ? num(settings[0], 'expiry_alert_days') : 30
  const [low, expiring] = await Promise.all([
    query(
      ctx,
      `SELECT p.id, p.sku, p.name, p.unit, p.reorder_point, COALESCE(s.qty, 0) AS qty
         FROM products p
         LEFT JOIN (SELECT product_id, SUM(qty) AS qty FROM stock_lots GROUP BY product_id) s ON s.product_id = p.id
        WHERE p.is_active AND p.reorder_point > 0 AND COALESCE(s.qty, 0) <= p.reorder_point
        ORDER BY COALESCE(s.qty, 0) / NULLIF(p.reorder_point, 0), p.name`,
    ),
    query(
      ctx,
      `${LOT_SELECT}
        WHERE sl.qty > 0 AND sl.expiry_date IS NOT NULL AND sl.expiry_date <= $1::date + $2::int
        ORDER BY sl.expiry_date, p.name`,
      [today, days],
    ),
  ])
  const lots = expiring.map(mapLot)
  return c.json({
    expiryAlertDays: days,
    lowStock: low.map((r) => ({
      productId: str(r, 'id'),
      sku: str(r, 'sku'),
      name: str(r, 'name'),
      unit: str(r, 'unit'),
      reorderPoint: num(r, 'reorder_point'),
      qty: num(r, 'qty'),
    })),
    expired: lots.filter((l) => l.expiryDate !== null && l.expiryDate < today),
    nearExpiry: lots.filter((l) => l.expiryDate !== null && l.expiryDate >= today),
  })
})

// ---------------------------------------------------------------- transfers (โอนย้าย)

const transferSchema = z.object({
  ...eventEnvelope,
  fromLocationId: uuid,
  toLocationId: uuid,
  note: z.string().trim().max(400).nullish(),
  lines: z.array(z.object({ productId: uuid, qty })).min(1).max(200),
})

stockRoutes.post('/transfers', async (c) => {
  const ctx = c.get('ctx')
  const b = transferSchema.parse(await c.req.json())
  if (b.fromLocationId === b.toLocationId) throw new HttpError(400, 'ต้นทางและปลายทางต้องต่างกัน')

  const products = await loadProducts(ctx, b.lines.map((l) => l.productId))
  const names = new Map([...products.values()].map((p) => [p.id, p.name]))
  const lots = await loadLots(ctx, b.fromLocationId, [...products.keys()])
  const allocations = allocateFefo(lots, demandByProduct(b.lines), names, { skipExpired: false })

  const docId = randomUUID()
  const outRows = allocations.map((a) => ({ lot_id: a.lotId, qty: a.qty, unit_cost: a.lastUnitCost }))
  const inRows = toLotIdentityRows(allocations)

  const ops: BatchOp[] = [
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'stock.transferred',
        terminalId: b.terminalId,
        zoneId: b.fromLocationId,
        occurredAt: b.occurredAt,
        refType: 'stock_document',
        refId: docId,
        payload: { docId, fromLocationId: b.fromLocationId, toLocationId: b.toLocationId, note: b.note ?? null, lots: allocations },
      }),
    },
    ...docHeaderOp({
      prefix: 'TR',
      docId,
      docType: 'transfer',
      eventId: b.eventId,
      from: b.fromLocationId,
      to: b.toLocationId,
      reasonCode: null,
      note: b.note ?? null,
      terminalId: b.terminalId,
      occurredAt: b.occurredAt,
    }),
    {
      sql: movementsForLotsSql({
        event: '$1', terminal: '$2', zone: '$3', occurredAt: '$4', type: "'transfer_out'",
        recordset: '$5', refType: "'stock_document'", refId: '$6', reason: 'NULL', sign: -1,
      }),
      params: [b.eventId, b.terminalId, b.fromLocationId, b.occurredAt, JSON.stringify(outRows), docId],
    },
    { sql: lotDecrementSql('$1'), params: [JSON.stringify(aggregateByLot(allocations))] },
    { sql: lotUpsertSql('$1', '$2', '$3'), params: [b.toLocationId, JSON.stringify(inRows), b.occurredAt] },
    {
      sql: movementsForLotIdentitySql({
        event: '$1', terminal: '$2', zone: '$3', occurredAt: '$4', type: "'transfer_in'", location: '$5',
        recordset: '$6', refType: "'stock_document'", refId: '$7', reason: 'NULL',
      }),
      params: [b.eventId, b.terminalId, b.fromLocationId, b.occurredAt, b.toLocationId, JSON.stringify(inRows), docId],
    },
  ]
  const results = await transaction(ctx, ops)
  return c.json({ id: docId, docNo: str(results[2]?.[0] ?? {}, 'doc_no') }, 201)
})

/** Allocated lots re-keyed by lot identity for the destination upsert. */
function toLotIdentityRows(allocations: Allocation[]) {
  const map = new Map<string, { product_id: string; lot_no: string; expiry_date: string | null; qty: number; unit_cost: number }>()
  for (const a of allocations) {
    const key = `${a.productId}|${a.lotNo}|${a.expiryDate ?? ''}`
    const cur = map.get(key) ?? { product_id: a.productId, lot_no: a.lotNo, expiry_date: a.expiryDate, qty: 0, unit_cost: a.lastUnitCost }
    cur.qty = round3(cur.qty + a.qty)
    map.set(key, cur)
  }
  return [...map.values()]
}

function docHeaderOp(p: {
  prefix: string
  docId: string
  docType: 'transfer' | 'adjustment'
  eventId: string
  from: string | null
  to: string | null
  reasonCode: string | null
  note: string | null
  terminalId: string
  occurredAt: string
}): BatchOp[] {
  return [
    { sql: counterBumpSql, params: [p.prefix, bangkokPeriod(p.occurredAt)] },
    {
      sql: `INSERT INTO stock_documents (id, doc_no, doc_type, event_id, from_location_id, to_location_id, reason_code,
              note, terminal_id, occurred_at)
            VALUES ($3::uuid, ${docNoSql('$1', '$2')}, $4::text, $5::uuid, $6::uuid, $7::uuid, $8::text, $9::text,
                    $10::text, $11::timestamptz)
            RETURNING doc_no`,
      params: [
        p.prefix,
        bangkokPeriod(p.occurredAt),
        p.docId,
        p.docType,
        p.eventId,
        p.from,
        p.to,
        p.reasonCode,
        p.note,
        p.terminalId,
        p.occurredAt,
      ],
    },
  ]
}

// ---------------------------------------------------------------- adjustments (ปรับยอด)

const adjustmentSchema = z.object({
  ...eventEnvelope,
  locationId: uuid,
  reasonCode: z.enum(['count', 'damaged', 'expired', 'lost', 'opening', 'internal_use', 'other']),
  note: z.string().trim().max(400).nullish(),
  lines: z
    .array(
      z.object({
        productId: uuid,
        qtyChange: z.number().refine((v) => v !== 0 && Math.abs(v) <= 1_000_000, 'จำนวนต้องไม่เป็นศูนย์'),
        lotId: uuid.nullish(),
        lotNo: z.string().trim().max(60).nullish(),
        expiryDate: optionalDate,
        unitCost: z.number().min(0).max(10_000_000).nullish(),
      }),
    )
    .min(1)
    .max(100),
})

stockRoutes.post('/adjustments', async (c) => {
  const ctx = c.get('ctx')
  const b = adjustmentSchema.parse(await c.req.json())
  if (b.reasonCode === 'other' && !b.note) throw new HttpError(400, 'เหตุผล "อื่น ๆ" ต้องระบุหมายเหตุ')
  const reasonText = `${ADJUST_REASONS[b.reasonCode]}${b.note ? `: ${b.note}` : ''}`

  const products = await loadProducts(ctx, b.lines.map((l) => l.productId))
  const names = new Map([...products.values()].map((p) => [p.id, p.name]))

  // Incoming quantities: upsert lots, update moving average at the given (or current) cost.
  const incoming = b.lines.filter((l) => l.qtyChange > 0)
  const inRows = incoming.map((l) => {
    const p = products.get(l.productId)
    if (p?.trackExpiry && !l.expiryDate) throw new HttpError(400, `${p.name} ต้องระบุวันหมดอายุ`)
    return {
      product_id: l.productId,
      lot_no: l.lotNo ?? '',
      expiry_date: l.expiryDate,
      qty: round3(l.qtyChange),
      unit_cost: round4(l.unitCost ?? p?.avgCost ?? 0),
    }
  })
  const inByLot = new Map<string, (typeof inRows)[number]>()
  for (const r of inRows) {
    const key = `${r.product_id}|${r.lot_no}|${r.expiry_date ?? ''}`
    const cur = inByLot.get(key)
    if (cur) cur.qty = round3(cur.qty + r.qty)
    else inByLot.set(key, { ...r })
  }

  // Outgoing quantities: explicit lot when chosen, otherwise FEFO.
  const outgoing = b.lines.filter((l) => l.qtyChange < 0)
  const explicit = outgoing.filter((l) => l.lotId)
  const fefo = outgoing.filter((l) => !l.lotId)
  const lots = await loadLots(ctx, b.locationId, [...new Set(outgoing.map((l) => l.productId))])
  const allocations: Allocation[] = allocateFefo(
    lots,
    demandByProduct(fefo.map((l) => ({ productId: l.productId, qty: -l.qtyChange }))),
    names,
    { skipExpired: false },
  )
  for (const l of explicit) {
    const lot = lots.find((x) => x.id === l.lotId && x.productId === l.productId)
    const need = round3(-l.qtyChange)
    if (!lot) throw new HttpError(400, `ไม่พบล็อตที่เลือกของ ${names.get(l.productId) ?? ''} ในสาขานี้`)
    if (lot.qty < need) throw new HttpError(409, `ล็อต ${lot.lotNo || '-'} ของ ${names.get(l.productId) ?? ''} มีเพียง ${lot.qty}`)
    allocations.push({ lotId: lot.id, productId: lot.productId, qty: need, lotNo: lot.lotNo, expiryDate: lot.expiryDate, lastUnitCost: lot.lastUnitCost })
  }
  const outRows = allocations.map((a) => ({ lot_id: a.lotId, qty: a.qty, unit_cost: null }))

  const docId = randomUUID()
  const ops: BatchOp[] = [
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'stock.adjusted',
        terminalId: b.terminalId,
        zoneId: b.locationId,
        occurredAt: b.occurredAt,
        refType: 'stock_document',
        refId: docId,
        payload: { docId, locationId: b.locationId, reasonCode: b.reasonCode, note: b.note ?? null, incoming: inRows, outgoing: allocations },
      }),
    },
    ...docHeaderOp({
      prefix: 'ADJ',
      docId,
      docType: 'adjustment',
      eventId: b.eventId,
      from: b.locationId,
      to: null,
      reasonCode: b.reasonCode,
      note: b.note ?? null,
      terminalId: b.terminalId,
      occurredAt: b.occurredAt,
    }),
  ]
  if (inRows.length > 0) {
    const lotRows = [...inByLot.values()]
    ops.push(
      {
        sql: avgCostUpdateSql('$1'),
        params: [JSON.stringify(inRows.map((r) => ({ product_id: r.product_id, q: r.qty, amount: round4(r.qty * r.unit_cost) })))],
      },
      { sql: lotUpsertSql('$1', '$2', '$3'), params: [b.locationId, JSON.stringify(lotRows), b.occurredAt] },
      {
        sql: movementsForLotIdentitySql({
          event: '$1', terminal: '$2', zone: '$3', occurredAt: '$4', type: "'adjust'", location: '$8',
          recordset: '$5', refType: "'stock_document'", refId: '$6', reason: '$7',
        }),
        params: [b.eventId, b.terminalId, b.locationId, b.occurredAt, JSON.stringify(lotRows), docId, reasonText, b.locationId],
      },
    )
  }
  if (outRows.length > 0) {
    ops.push(
      {
        sql: movementsForLotsSql({
          event: '$1', terminal: '$2', zone: '$3', occurredAt: '$4', type: "'adjust'",
          recordset: '$5', refType: "'stock_document'", refId: '$6', reason: '$7', sign: -1,
        }),
        params: [b.eventId, b.terminalId, b.locationId, b.occurredAt, JSON.stringify(outRows), docId, reasonText],
      },
      { sql: lotDecrementSql('$1'), params: [JSON.stringify(aggregateByLot(allocations))] },
    )
  }
  const results = await transaction(ctx, ops)
  return c.json({ id: docId, docNo: str(results[2]?.[0] ?? {}, 'doc_no') }, 201)
})

// ---------------------------------------------------------------- stock documents

stockRoutes.get('/stock/documents', async (c) => {
  const ctx = c.get('ctx')
  const type = c.req.query('type') ?? ''
  const rows = await query(
    ctx,
    `SELECT d.*, lf.name AS from_name, lt.name AS to_name,
            (SELECT COUNT(DISTINCT product_id) FROM stock_movements m WHERE m.ref_type = 'stock_document' AND m.ref_id = d.id) AS item_count
       FROM stock_documents d
       LEFT JOIN locations lf ON lf.id = d.from_location_id
       LEFT JOIN locations lt ON lt.id = d.to_location_id
      WHERE ($1 = '' OR d.doc_type = $1)
      ORDER BY d.occurred_at DESC LIMIT 200`,
    [type],
  )
  return c.json(
    rows.map((r) => ({
      id: str(r, 'id'),
      docNo: str(r, 'doc_no'),
      docType: str(r, 'doc_type'),
      fromName: strOrNull(r, 'from_name'),
      toName: strOrNull(r, 'to_name'),
      reasonCode: strOrNull(r, 'reason_code'),
      note: strOrNull(r, 'note'),
      itemCount: num(r, 'item_count'),
      occurredAt: str(r, 'occurred_at'),
      eventId: str(r, 'event_id'),
      terminalId: str(r, 'terminal_id'),
    })),
  )
})
