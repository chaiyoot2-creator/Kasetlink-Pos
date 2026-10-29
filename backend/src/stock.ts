import { HttpError } from './errors.js'
import { query, type RequestCtx } from './db.js'
import { bool, dateOnly, num, round3, str } from './util.js'

export interface Lot {
  id: string
  productId: string
  lotNo: string
  expiryDate: string | null
  qty: number
  lastUnitCost: number
}

export interface Allocation {
  lotId: string
  productId: string
  qty: number
  lotNo: string
  expiryDate: string | null
  lastUnitCost: number
}

/** Lots with stock at one location, first-expiry-first-out order. */
export async function loadLots(ctx: RequestCtx, locationId: string, productIds: string[]): Promise<Lot[]> {
  if (productIds.length === 0) return []
  const rows = await query(
    ctx,
    `SELECT id, product_id, lot_no, expiry_date::text AS expiry_date, qty, last_unit_cost
       FROM stock_lots
      WHERE location_id = $1::uuid AND product_id IN (SELECT jsonb_array_elements_text($2::jsonb)::uuid) AND qty > 0
      ORDER BY expiry_date ASC NULLS LAST, received_at ASC`,
    [locationId, JSON.stringify(productIds)],
  )
  return rows.map((r) => ({
    id: str(r, 'id'),
    productId: str(r, 'product_id'),
    lotNo: str(r, 'lot_no'),
    expiryDate: dateOnly(r, 'expiry_date'),
    qty: num(r, 'qty'),
    lastUnitCost: num(r, 'last_unit_cost'),
  }))
}

export function todayBangkok(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Allocate demanded quantities to lots (FEFO). Throws a Thai 409 listing every
 * product that is short. `skipExpired` keeps expired lots out of sales.
 */
export function allocateFefo(
  lots: Lot[],
  demand: Map<string, number>,
  productNames: Map<string, string>,
  options: { skipExpired: boolean },
): Allocation[] {
  const today = todayBangkok()
  const allocations: Allocation[] = []
  const shortages: string[] = []

  for (const [productId, needed] of demand) {
    let remaining = round3(needed)
    let expiredQty = 0
    for (const lot of lots) {
      if (lot.productId !== productId || remaining <= 0) continue
      if (options.skipExpired && lot.expiryDate !== null && lot.expiryDate < today) {
        expiredQty += lot.qty
        continue
      }
      const take = round3(Math.min(lot.qty, remaining))
      if (take <= 0) continue
      allocations.push({
        lotId: lot.id,
        productId,
        qty: take,
        lotNo: lot.lotNo,
        expiryDate: lot.expiryDate,
        lastUnitCost: lot.lastUnitCost,
      })
      remaining = round3(remaining - take)
    }
    if (remaining > 0) {
      const name = productNames.get(productId) ?? productId
      const available = round3(needed - remaining)
      shortages.push(
        `${name}: ต้องการ ${needed} มี ${available}` + (expiredQty > 0 ? ` (หมดอายุแล้ว ${round3(expiredQty)})` : ''),
      )
    }
  }

  if (shortages.length > 0) {
    throw new HttpError(409, `สต็อกไม่พอ — ${shortages.join(', ')}`, 'insufficient_stock')
  }
  return allocations
}

/** Sum quantities per product. */
export function demandByProduct(lines: { productId: string; qty: number }[]): Map<string, number> {
  const demand = new Map<string, number>()
  for (const line of lines) {
    demand.set(line.productId, round3((demand.get(line.productId) ?? 0) + line.qty))
  }
  return demand
}

/** Lots touched by an allocation, aggregated (one lot may appear once per product). */
export function aggregateByLot(allocations: Allocation[]): { lot_id: string; qty: number }[] {
  const byLot = new Map<string, number>()
  for (const a of allocations) byLot.set(a.lotId, round3((byLot.get(a.lotId) ?? 0) + a.qty))
  return [...byLot].map(([lot_id, qty]) => ({ lot_id, qty }))
}

export interface ProductInfo {
  id: string
  name: string
  unit: string
  avgCost: number
  isActive: boolean
  trackExpiry: boolean
  /** Prices for levels 1..5 (0 = not set). */
  priceLevels: number[]
}

export async function loadProducts(ctx: RequestCtx, ids: string[]): Promise<Map<string, ProductInfo>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await query(
    ctx,
    `SELECT id, name, unit, avg_cost, is_active, track_expiry, price_l1, price_l2, price_l3, price_l4, price_l5
       FROM products WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)`,
    [JSON.stringify(unique)],
  )
  const map = new Map<string, ProductInfo>()
  for (const r of rows) {
    map.set(str(r, 'id'), {
      id: str(r, 'id'),
      name: str(r, 'name'),
      unit: str(r, 'unit'),
      avgCost: num(r, 'avg_cost'),
      isActive: bool(r, 'is_active'),
      trackExpiry: bool(r, 'track_expiry'),
      priceLevels: [1, 2, 3, 4, 5].map((n) => num(r, `price_l${n}`)),
    })
  }
  for (const id of unique) {
    if (!map.has(id)) throw new HttpError(400, 'ไม่พบสินค้าบางรายการ', 'product_missing')
  }
  return map
}

/** Moving weighted-average cost update for incoming quantities (receive / void return / costed adjustment). */
export function avgCostUpdateSql(recordsetParam: string): string {
  return `UPDATE products p
     SET avg_cost = CASE
           WHEN GREATEST(COALESCE(s.onhand, 0), 0) + a.q > 0
             THEN ROUND((GREATEST(COALESCE(s.onhand, 0), 0) * p.avg_cost + a.amount) / (GREATEST(COALESCE(s.onhand, 0), 0) + a.q), 4)
           ELSE p.avg_cost END,
         updated_at = now()
    FROM (SELECT product_id, SUM(q) AS q, SUM(amount) AS amount
            FROM jsonb_to_recordset(${recordsetParam}::jsonb) AS x(product_id uuid, q numeric, amount numeric)
           GROUP BY product_id) a
    LEFT JOIN (SELECT product_id, SUM(qty) AS onhand FROM stock_lots GROUP BY product_id) s
      ON s.product_id = a.product_id
   WHERE p.id = a.product_id`
}

/** Upsert lot rows at a location from a recordset (product_id, lot_no, expiry_date, qty, unit_cost). */
export function lotUpsertSql(locationParam: string, recordsetParam: string, receivedAtParam: string): string {
  return `INSERT INTO stock_lots (product_id, location_id, lot_no, expiry_date, qty, last_unit_cost, received_at)
  SELECT x.product_id, ${locationParam}::uuid, x.lot_no, x.expiry_date, x.qty, x.unit_cost, ${receivedAtParam}::timestamptz
    FROM jsonb_to_recordset(${recordsetParam}::jsonb)
      AS x(product_id uuid, lot_no text, expiry_date date, qty numeric, unit_cost numeric)
  ON CONFLICT (org_id, product_id, location_id, lot_no, (COALESCE(expiry_date, DATE '9999-12-31')))
  DO UPDATE SET qty = stock_lots.qty + EXCLUDED.qty,
                last_unit_cost = EXCLUDED.last_unit_cost,
                updated_at = now()`
}

/** Movement rows for lots identified by (product, lot_no, expiry) at a location — used after an upsert. */
export function movementsForLotIdentitySql(p: {
  event: string
  terminal: string
  zone: string
  occurredAt: string
  type: string
  location: string
  recordset: string
  refType: string
  refId: string
  reason: string
}): string {
  return `INSERT INTO stock_movements (event_id, terminal_id, zone_id, occurred_at, movement_type, product_id,
            location_id, lot_id, lot_no, expiry_date, qty_change, unit_cost, ref_type, ref_id, reason)
  SELECT ${p.event}::uuid, ${p.terminal}::text, ${p.zone}::text, ${p.occurredAt}::timestamptz, ${p.type}::text,
         x.product_id, ${p.location}::uuid, l.id, x.lot_no, x.expiry_date, x.qty, x.unit_cost,
         ${p.refType}::text, ${p.refId}::uuid, ${p.reason}::text
    FROM jsonb_to_recordset(${p.recordset}::jsonb)
      AS x(product_id uuid, lot_no text, expiry_date date, qty numeric, unit_cost numeric)
    JOIN stock_lots l
      ON l.product_id = x.product_id AND l.location_id = ${p.location}::uuid AND l.lot_no = x.lot_no
     AND COALESCE(l.expiry_date, DATE '9999-12-31') = COALESCE(x.expiry_date, DATE '9999-12-31')`
}

/** Decrement allocated lots. The CHECK (qty >= 0) aborts the transaction if another terminal got there first. */
export function lotDecrementSql(recordsetParam: string): string {
  return `UPDATE stock_lots l SET qty = l.qty - a.qty, updated_at = now()
    FROM jsonb_to_recordset(${recordsetParam}::jsonb) AS a(lot_id uuid, qty numeric)
   WHERE l.id = a.lot_id`
}

/** Movement rows for explicit lots (outgoing or returned), qty sign given by `sign`. */
export function movementsForLotsSql(p: {
  event: string
  terminal: string
  zone: string
  occurredAt: string
  type: string
  recordset: string
  refType: string
  refId: string
  reason: string
  sign: 1 | -1
}): string {
  return `INSERT INTO stock_movements (event_id, terminal_id, zone_id, occurred_at, movement_type, product_id,
            location_id, lot_id, lot_no, expiry_date, qty_change, unit_cost, ref_type, ref_id, reason)
  SELECT ${p.event}::uuid, ${p.terminal}::text, ${p.zone}::text, ${p.occurredAt}::timestamptz, ${p.type}::text,
         l.product_id, l.location_id, l.id, l.lot_no, l.expiry_date, ${p.sign} * a.qty,
         COALESCE(a.unit_cost, pr.avg_cost), ${p.refType}::text, ${p.refId}::uuid, ${p.reason}::text
    FROM jsonb_to_recordset(${p.recordset}::jsonb) AS a(lot_id uuid, qty numeric, unit_cost numeric)
    JOIN stock_lots l ON l.id = a.lot_id
    JOIN products pr ON pr.id = l.product_id`
}

export function eventInsertSql(): string {
  return `INSERT INTO pos_events (event_id, event_type, terminal_id, zone_id, occurred_at, ref_type, ref_id, payload)
          VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::timestamptz, $6::text, $7::uuid, $8::jsonb)`
}

export function eventParams(e: {
  eventId: string
  type: string
  terminalId: string
  zoneId: string
  occurredAt: string
  refType: string
  refId: string
  payload: unknown
}): unknown[] {
  return [e.eventId, e.type, e.terminalId, e.zoneId, e.occurredAt, e.refType, e.refId, JSON.stringify(e.payload)]
}
