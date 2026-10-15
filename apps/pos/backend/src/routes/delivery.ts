import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { query, transaction, type BatchOp, type RequestCtx, type Row } from '../gate.js'
import {
  assignVehicles,
  browserMapsKey,
  distanceMatrix,
  routeLine,
  serverMapsKey,
  shortestOrder,
  unitWeightKg,
  type LatLng,
  type StopInfo,
  type VehicleInfo,
} from '../routing.js'
import { bool, counterBumpSql, dateOnly, docNoSql, num, round2, round3, str, strOrNull, uuid } from '../util.js'

/** Map pins, vehicles, delivery orders and route planning for deliveries. */
export const deliveryRoutes = new Hono<AppEnv>()

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const lat = z.number().min(-90).max(90)
const lng = z.number().min(-180).max(180)

function numOrNull(r: Row, k: string): number | null {
  const v = r[k]
  return v === null || v === undefined || v === '' ? null : num(r, k)
}

// ---------------------------------------------------------------- map config & pins

deliveryRoutes.get('/maps/config', (c) =>
  c.json({ browserKey: browserMapsKey(), hasServerKey: serverMapsKey() !== null }),
)

type PlaceKind = 'location' | 'customer' | 'agency'
const PLACE_TABLE: Record<PlaceKind, { table: string; note: string }> = {
  location: { table: 'locations', note: 'address' },
  customer: { table: 'customers', note: 'map_note' },
  agency: { table: 'agency_customers', note: 'map_note' },
}

/** Every point that can be pinned: shop branches, POS customers and ฟาร์มสุข customers. */
deliveryRoutes.get('/delivery/places', async (c) => {
  const ctx = c.get('ctx')
  const [locations, customers, agency] = await Promise.all([
    query(ctx, 'SELECT id, code, name, kind, lat, lng, address, is_active FROM locations ORDER BY kind DESC, code'),
    query(ctx, 'SELECT id, code, name, phone, address, lat, lng, map_note, is_active FROM customers ORDER BY name'),
    query(ctx, 'SELECT id, name, phone, address, lat, lng, map_note, is_active FROM agency_customers ORDER BY name'),
  ])
  const place = (kind: PlaceKind, r: Row, extra: Record<string, unknown>) => ({
    kind,
    id: str(r, 'id'),
    name: str(r, 'name'),
    lat: numOrNull(r, 'lat'),
    lng: numOrNull(r, 'lng'),
    isActive: bool(r, 'is_active'),
    ...extra,
  })
  return c.json([
    ...locations.map((r) =>
      place('location', r, { code: str(r, 'code'), subtitle: str(r, 'kind') === 'warehouse' ? 'โกดัง' : 'หน้าร้าน', address: strOrNull(r, 'address'), note: null, phone: null }),
    ),
    ...customers.map((r) =>
      place('customer', r, { code: str(r, 'code'), subtitle: 'ลูกค้าร้าน', address: strOrNull(r, 'address'), note: strOrNull(r, 'map_note'), phone: strOrNull(r, 'phone') }),
    ),
    ...agency.map((r) =>
      place('agency', r, { code: null, subtitle: 'ลูกค้าฟาร์มสุข', address: strOrNull(r, 'address'), note: strOrNull(r, 'map_note'), phone: strOrNull(r, 'phone') }),
    ),
  ])
})

const placeKind = z.enum(['location', 'customer', 'agency'])
const pinSchema = z.object({
  lat,
  lng,
  address: z.string().trim().max(400).nullish(),
  note: z.string().trim().max(400).nullish(),
})

deliveryRoutes.put('/delivery/places/:kind/:id', async (c) => {
  const ctx = c.get('ctx')
  const kind = placeKind.parse(c.req.param('kind'))
  const id = uuid.parse(c.req.param('id'))
  const b = pinSchema.parse(await c.req.json())
  const t = PLACE_TABLE[kind]
  // locations keep the address in `address`; customers keep a map note plus their own address.
  const sql =
    kind === 'location'
      ? `UPDATE locations SET lat = $2::float8, lng = $3::float8, address = COALESCE($4, address) WHERE id = $1::uuid RETURNING id`
      : `UPDATE ${t.table} SET lat = $2::float8, lng = $3::float8, address = COALESCE($4, address), ${t.note} = $5, updated_at = now()
         WHERE id = $1::uuid RETURNING id`
  const params = kind === 'location' ? [id, b.lat, b.lng, b.address || null] : [id, b.lat, b.lng, b.address || null, b.note || null]
  const ops: BatchOp[] = [{ sql, params }]
  if (kind !== 'location') {
    // Orders still waiting for a route follow the customer's new pin.
    ops.push({
      sql: `UPDATE delivery_orders SET lat = $2::float8, lng = $3::float8, updated_at = now()
             WHERE ${kind === 'customer' ? 'customer_id' : 'agency_customer_id'} = $1::uuid AND status = 'pending'`,
      params: [id, b.lat, b.lng],
    })
  }
  const [rows] = await transaction(ctx, ops)
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบจุดนี้')
  return c.json({ ok: true })
})

/** Remove a pin (the customer/branch itself stays). */
deliveryRoutes.delete('/delivery/places/:kind/:id', async (c) => {
  const ctx = c.get('ctx')
  const kind = placeKind.parse(c.req.param('kind'))
  const id = uuid.parse(c.req.param('id'))
  const [rows] = await transaction(ctx, [
    { sql: `UPDATE ${PLACE_TABLE[kind].table} SET lat = NULL, lng = NULL WHERE id = $1::uuid RETURNING id`, params: [id] },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบจุดนี้')
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- vehicles

function mapVehicle(r: Row) {
  return {
    id: str(r, 'id'),
    name: str(r, 'name'),
    plate: strOrNull(r, 'plate'),
    vehicleType: str(r, 'vehicle_type'),
    minLoadKg: num(r, 'min_load_kg'),
    capacityKg: num(r, 'capacity_kg'),
    costPerKm: num(r, 'cost_per_km'),
    driverName: strOrNull(r, 'driver_name'),
    note: strOrNull(r, 'note'),
    isActive: bool(r, 'is_active'),
  }
}

const vehicleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    plate: z.string().trim().max(30).nullish(),
    vehicleType: z.string().trim().min(1).max(30).default('pickup'),
    minLoadKg: z.number().min(0).max(100_000).default(0),
    capacityKg: z.number().positive().max(100_000),
    costPerKm: z.number().min(0).max(1000).default(0),
    driverName: z.string().trim().max(80).nullish(),
    note: z.string().trim().max(300).nullish(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.minLoadKg <= v.capacityKg, 'น้ำหนักขั้นต่ำต้องไม่เกินความจุ')

deliveryRoutes.get('/delivery/vehicles', async (c) => {
  const rows = await query(c.get('ctx'), 'SELECT * FROM vehicles ORDER BY is_active DESC, capacity_kg DESC, name')
  return c.json(rows.map(mapVehicle))
})

deliveryRoutes.post('/delivery/vehicles', async (c) => {
  const b = vehicleSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `INSERT INTO vehicles (name, plate, vehicle_type, min_load_kg, capacity_kg, cost_per_km, driver_name, note, is_active)
            VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7, $8, $9::boolean) RETURNING *`,
      params: [b.name, b.plate || null, b.vehicleType, b.minLoadKg, b.capacityKg, b.costPerKm, b.driverName || null, b.note || null, b.isActive],
    },
  ])
  return c.json(mapVehicle(rows?.[0] ?? {}), 201)
})

deliveryRoutes.put('/delivery/vehicles/:id', async (c) => {
  const id = uuid.parse(c.req.param('id'))
  const b = vehicleSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `UPDATE vehicles SET name = $1, plate = $2, vehicle_type = $3, min_load_kg = $4::numeric, capacity_kg = $5::numeric,
              cost_per_km = $6::numeric, driver_name = $7, note = $8, is_active = $9::boolean, updated_at = now()
            WHERE id = $10::uuid RETURNING *`,
      params: [b.name, b.plate || null, b.vehicleType, b.minLoadKg, b.capacityKg, b.costPerKm, b.driverName || null, b.note || null, b.isActive, id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบรถ')
  return c.json(mapVehicle(rows[0]))
})

// ---------------------------------------------------------------- delivery orders

function mapOrder(r: Row) {
  return {
    id: str(r, 'id'),
    docNo: str(r, 'doc_no'),
    deliveryDate: dateOnly(r, 'delivery_date') ?? '',
    source: str(r, 'source'),
    saleId: strOrNull(r, 'sale_id'),
    saleBillNo: strOrNull(r, 'bill_no'),
    customerId: strOrNull(r, 'customer_id'),
    agencyCustomerId: strOrNull(r, 'agency_customer_id'),
    recipientName: str(r, 'recipient_name'),
    phone: strOrNull(r, 'phone'),
    address: strOrNull(r, 'address'),
    lat: numOrNull(r, 'lat'),
    lng: numOrNull(r, 'lng'),
    totalBags: num(r, 'total_bags'),
    totalWeightKg: num(r, 'total_weight_kg'),
    status: str(r, 'status'),
    note: strOrNull(r, 'note'),
    tripId: strOrNull(r, 'trip_id'),
    tripNo: strOrNull(r, 'trip_no'),
  }
}

const ORDER_SELECT = `
  SELECT o.*, s.bill_no, tr.id AS trip_id, tr.doc_no AS trip_no
    FROM delivery_orders o
    LEFT JOIN sales s ON s.id = o.sale_id
    LEFT JOIN LATERAL (
      SELECT t.id, t.doc_no FROM delivery_trip_stops ts JOIN delivery_trips t ON t.id = ts.trip_id
       WHERE ts.order_id = o.id AND t.status <> 'cancelled' ORDER BY t.created_at DESC LIMIT 1
    ) tr ON true`

deliveryRoutes.get('/delivery/orders', async (c) => {
  const ctx = c.get('ctx')
  const from = date.parse(c.req.query('from'))
  const to = date.parse(c.req.query('to') ?? from)
  const status = c.req.query('status') ?? ''
  const rows = await query(
    ctx,
    `${ORDER_SELECT}
      WHERE o.delivery_date BETWEEN $1::date AND $2::date AND ($3 = '' OR o.status = $3)
      ORDER BY o.delivery_date, o.created_at`,
    [from, to, status],
  )
  return c.json(rows.map(mapOrder))
})

deliveryRoutes.get('/delivery/orders/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [head, lines] = await Promise.all([
    query(ctx, `${ORDER_SELECT} WHERE o.id = $1::uuid`, [id]),
    query(ctx, 'SELECT * FROM delivery_order_lines WHERE order_id = $1::uuid ORDER BY line_no', [id]),
  ])
  if (!head[0]) throw new HttpError(404, 'ไม่พบใบจัดส่ง')
  return c.json({
    ...mapOrder(head[0]),
    lines: lines.map((r) => ({
      lineNo: num(r, 'line_no'),
      productId: strOrNull(r, 'product_id'),
      productName: str(r, 'product_name'),
      unit: str(r, 'unit'),
      qty: num(r, 'qty'),
      unitWeightKg: num(r, 'unit_weight_kg'),
      weightKg: num(r, 'weight_kg'),
    })),
  })
})

interface OrderLineIn {
  productId: string | null
  productName: string
  unit: string
  qty: number
  unitWeightKg: number
}

/** Unit weights for product lines (product setting → name → feed kind). */
async function withWeights(ctx: RequestCtx, lines: { productId?: string | null; productName: string; unit?: string; qty: number; unitWeightKg?: number | null }[]): Promise<OrderLineIn[]> {
  const ids = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))]
  const rows = ids.length
    ? await query(ctx, 'SELECT id, name, unit, category, weight_kg FROM products WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)', [JSON.stringify(ids)])
    : []
  const byId = new Map(rows.map((r) => [str(r, 'id'), r]))
  return lines.map((l) => {
    const p = l.productId ? byId.get(l.productId) : undefined
    const w =
      l.unitWeightKg && l.unitWeightKg > 0
        ? l.unitWeightKg
        : unitWeightKg({
            weightKg: p ? numOrNull(p, 'weight_kg') : null,
            name: p ? str(p, 'name') : l.productName,
            category: p ? strOrNull(p, 'category') : null,
          })
    return { productId: l.productId ?? null, productName: l.productName, unit: l.unit || (p ? str(p, 'unit') : 'กระสอบ'), qty: round3(l.qty), unitWeightKg: w }
  })
}

function orderInsertOps(
  id: string,
  head: {
    deliveryDate: string
    source: 'manual' | 'sale' | 'agency'
    saleId: string | null
    customerId: string | null
    agencyCustomerId: string | null
    recipientName: string
    phone: string | null
    address: string | null
    lat: number | null
    lng: number | null
    note: string | null
  },
  lines: OrderLineIn[],
): BatchOp[] {
  const period = head.deliveryDate.slice(0, 7).replace('-', '')
  const bags = round3(lines.reduce((s, l) => s + l.qty, 0))
  const weight = round3(lines.reduce((s, l) => s + l.qty * l.unitWeightKg, 0))
  return [
    { sql: counterBumpSql, params: ['DO', period] },
    {
      sql: `INSERT INTO delivery_orders (id, doc_no, delivery_date, source, sale_id, customer_id, agency_customer_id, recipient_name, phone,
              address, lat, lng, total_bags, total_weight_kg, note)
            VALUES ($1::uuid, ${docNoSql('$2', '$3')}, $4::date, $5, $6::uuid, $7::uuid, $8::uuid, $9, $10, $11, $12::float8, $13::float8,
              $14::numeric, $15::numeric, $16)`,
      params: [
        id,
        'DO',
        period,
        head.deliveryDate,
        head.source,
        head.saleId,
        head.customerId,
        head.agencyCustomerId,
        head.recipientName,
        head.phone,
        head.address,
        head.lat,
        head.lng,
        bags,
        weight,
        head.note,
      ],
    },
    {
      sql: `INSERT INTO delivery_order_lines (order_id, line_no, product_id, product_name, unit, qty, unit_weight_kg, weight_kg)
            SELECT $1::uuid, x.line_no, x.product_id, x.product_name, x.unit, x.qty, x.unit_weight_kg, x.weight_kg
              FROM jsonb_to_recordset($2::jsonb)
                AS x(line_no int, product_id uuid, product_name text, unit text, qty numeric, unit_weight_kg numeric, weight_kg numeric)`,
      params: [
        id,
        JSON.stringify(
          lines.map((l, i) => ({
            line_no: i + 1,
            product_id: l.productId,
            product_name: l.productName,
            unit: l.unit,
            qty: l.qty,
            unit_weight_kg: l.unitWeightKg,
            weight_kg: round3(l.qty * l.unitWeightKg),
          })),
        ),
      ],
    },
  ]
}

/** Recipient details (name, phone, address, pin) from a POS or ฟาร์มสุข customer. */
async function recipient(ctx: RequestCtx, customerId: string | null, agencyCustomerId: string | null) {
  if (customerId) {
    const [r] = await query(ctx, 'SELECT name, phone, address, lat, lng FROM customers WHERE id = $1::uuid', [customerId])
    if (!r) throw new HttpError(400, 'ไม่พบลูกค้า')
    return r
  }
  if (agencyCustomerId) {
    const [r] = await query(ctx, 'SELECT name, phone, address, lat, lng FROM agency_customers WHERE id = $1::uuid', [agencyCustomerId])
    if (!r) throw new HttpError(400, 'ไม่พบลูกค้าฟาร์มสุข')
    return r
  }
  return null
}

const orderSchema = z.object({
  deliveryDate: date,
  customerId: uuid.nullish(),
  agencyCustomerId: uuid.nullish(),
  recipientName: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(40).nullish(),
  address: z.string().trim().max(400).nullish(),
  lat: lat.nullish(),
  lng: lng.nullish(),
  note: z.string().trim().max(400).nullish(),
  lines: z
    .array(
      z.object({
        productId: uuid.nullish(),
        productName: z.string().trim().min(1).max(120),
        unit: z.string().trim().max(30).default('กระสอบ'),
        qty: z.number().positive().max(100_000),
        unitWeightKg: z.number().positive().max(10_000).nullish(),
      }),
    )
    .min(1, 'เพิ่มสินค้าอย่างน้อย 1 รายการ')
    .max(100),
})

/** Order typed in on the delivery page (phone order in the morning, ฟาร์มสุข delivery, …). */
deliveryRoutes.post('/delivery/orders', async (c) => {
  const ctx = c.get('ctx')
  const b = orderSchema.parse(await c.req.json())
  const who = await recipient(ctx, b.customerId ?? null, b.agencyCustomerId ?? null)
  const name = (b.recipientName?.trim() || (who ? str(who, 'name') : '')).trim()
  if (!name) throw new HttpError(400, 'ระบุลูกค้า / ผู้รับ')
  const lines = await withWeights(ctx, b.lines)
  const id = randomUUID()
  await transaction(
    ctx,
    orderInsertOps(
      id,
      {
        deliveryDate: b.deliveryDate,
        source: b.agencyCustomerId ? 'agency' : 'manual',
        saleId: null,
        customerId: b.customerId ?? null,
        agencyCustomerId: b.agencyCustomerId ?? null,
        recipientName: name,
        phone: b.phone || (who ? strOrNull(who, 'phone') : null),
        address: b.address || (who ? strOrNull(who, 'address') : null),
        lat: b.lat ?? (who ? numOrNull(who, 'lat') : null),
        lng: b.lng ?? (who ? numOrNull(who, 'lng') : null),
        note: b.note || null,
      },
      lines,
    ),
  )
  const [row] = await query(ctx, `${ORDER_SELECT} WHERE o.id = $1::uuid`, [id])
  return c.json(mapOrder(row ?? {}), 201)
})

const fromSaleSchema = z.object({ deliveryDate: date, note: z.string().trim().max(400).nullish() })

/** Delivery order built from a POS bill (its customer and lines). */
deliveryRoutes.post('/delivery/orders/from-sale/:saleId', async (c) => {
  const ctx = c.get('ctx')
  const saleId = uuid.parse(c.req.param('saleId'))
  const b = fromSaleSchema.parse(await c.req.json())
  const [sale, saleLines, existing] = await Promise.all([
    query(ctx, 'SELECT id, bill_no, customer_id, status FROM sales WHERE id = $1::uuid', [saleId]),
    query(ctx, 'SELECT product_id, product_name, unit, qty FROM sale_lines WHERE sale_id = $1::uuid ORDER BY line_no', [saleId]),
    query(ctx, `SELECT doc_no FROM delivery_orders WHERE sale_id = $1::uuid AND status <> 'cancelled'`, [saleId]),
  ])
  const s = sale[0]
  if (!s) throw new HttpError(404, 'ไม่พบบิล')
  if (str(s, 'status') !== 'completed') throw new HttpError(409, 'บิลนี้ถูกยกเลิกแล้ว')
  if (existing[0]) throw new HttpError(409, `บิลนี้มีใบจัดส่งแล้ว (${str(existing[0], 'doc_no')})`, 'duplicate')
  const customerId = strOrNull(s, 'customer_id')
  const who = await recipient(ctx, customerId, null)
  const lines = await withWeights(
    ctx,
    saleLines.map((l) => ({ productId: str(l, 'product_id'), productName: str(l, 'product_name'), unit: str(l, 'unit'), qty: num(l, 'qty') })),
  )
  const id = randomUUID()
  await transaction(
    ctx,
    orderInsertOps(
      id,
      {
        deliveryDate: b.deliveryDate,
        source: 'sale',
        saleId,
        customerId,
        agencyCustomerId: null,
        recipientName: who ? str(who, 'name') : `บิล ${str(s, 'bill_no')}`,
        phone: who ? strOrNull(who, 'phone') : null,
        address: who ? strOrNull(who, 'address') : null,
        lat: who ? numOrNull(who, 'lat') : null,
        lng: who ? numOrNull(who, 'lng') : null,
        note: b.note || null,
      },
      lines,
    ),
  )
  const [row] = await query(ctx, `${ORDER_SELECT} WHERE o.id = $1::uuid`, [id])
  return c.json(mapOrder(row ?? {}), 201)
})

const orderPatchSchema = z.object({
  status: z.enum(['pending', 'delivered', 'cancelled']).optional(),
  deliveryDate: date.optional(),
  lat: lat.nullish(),
  lng: lng.nullish(),
})

/** Change date / status, or set the pin for this one order. */
deliveryRoutes.patch('/delivery/orders/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = orderPatchSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE delivery_orders SET status = COALESCE($2, status), delivery_date = COALESCE($3::date, delivery_date),
              lat = CASE WHEN $4::boolean THEN $5::float8 ELSE lat END, lng = CASE WHEN $4::boolean THEN $6::float8 ELSE lng END,
              updated_at = now()
            WHERE id = $1::uuid RETURNING id`,
      params: [id, b.status ?? null, b.deliveryDate ?? null, b.lat !== undefined, b.lat ?? null, b.lng ?? null],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบใบจัดส่ง')
  return c.json({ ok: true })
})

// ---------------------------------------------------------------- planning

interface PlanStop {
  orderId: string
  docNo: string
  name: string
  address: string | null
  phone: string | null
  lat: number
  lng: number
  weightKg: number
  bags: number
  legKm: number
  legMin: number
}

interface PlannedTrip {
  vehicleId: string
  vehicleName: string
  capacityKg: number
  minLoadKg: number
  weightKg: number
  bags: number
  stops: PlanStop[]
  distanceKm: number
  durationMin: number
  returnKm: number
  fuelCost: number
  polyline: string | null
  source: 'google' | 'estimate'
  warnings: string[]
}

async function loadDepot(ctx: RequestCtx, id: string): Promise<LatLng & { name: string }> {
  const [d] = await query(ctx, 'SELECT name, lat, lng FROM locations WHERE id = $1::uuid', [id])
  if (!d) throw new HttpError(400, 'ไม่พบสาขาต้นทาง')
  const la = numOrNull(d, 'lat')
  const ln = numOrNull(d, 'lng')
  if (la === null || ln === null) throw new HttpError(400, `ยังไม่ได้ปักหมุด “${str(d, 'name')}” — ปักหมุดร้านในแท็บแผนที่ก่อน`)
  return { name: str(d, 'name'), lat: la, lng: ln }
}

async function loadOrders(ctx: RequestCtx, ids: string[]): Promise<Row[]> {
  return query(ctx, 'SELECT * FROM delivery_orders WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)', [JSON.stringify(ids)])
}

/** Ordered trip: legs, totals and the road line for one vehicle. */
async function buildTrip(
  vehicle: VehicleInfo & { minLoadKg: number },
  depot: LatLng,
  orderedIdx: number[],
  matrix: { km: number[][]; min: number[][]; source: 'google' | 'estimate' },
  points: LatLng[],
  rowsByIdx: Map<number, Row>,
  returnToDepot: boolean,
): Promise<PlannedTrip> {
  const stops: PlanStop[] = []
  let prev = 0
  for (const i of orderedIdx) {
    const r = rowsByIdx.get(i)
    if (!r) continue
    stops.push({
      orderId: str(r, 'id'),
      docNo: str(r, 'doc_no'),
      name: str(r, 'recipient_name'),
      address: strOrNull(r, 'address'),
      phone: strOrNull(r, 'phone'),
      lat: points[i]!.lat,
      lng: points[i]!.lng,
      weightKg: num(r, 'total_weight_kg'),
      bags: num(r, 'total_bags'),
      legKm: round2(matrix.km[prev]![i]!),
      legMin: round2(matrix.min[prev]![i]!),
    })
    prev = i
  }
  const returnKm = returnToDepot && orderedIdx.length ? round2(matrix.km[prev]![0]!) : 0
  const returnMin = returnToDepot && orderedIdx.length ? matrix.min[prev]![0]! : 0
  let distanceKm = round2(stops.reduce((s, x) => s + x.legKm, 0) + returnKm)
  let durationMin = round2(stops.reduce((s, x) => s + x.legMin, 0) + returnMin)
  const line = await routeLine([depot, ...stops.map((s) => ({ lat: s.lat, lng: s.lng })), ...(returnToDepot ? [depot] : [])])
  if (line.km !== null) distanceKm = round2(line.km)
  if (line.min !== null) durationMin = round2(line.min)
  const weightKg = round3(stops.reduce((s, x) => s + x.weightKg, 0))
  const warnings: string[] = []
  if (weightKg > vehicle.capacityKg) warnings.push(`น้ำหนักเกินความจุรถ ${vehicle.capacityKg.toLocaleString('en-US')} กก.`)
  if (vehicle.minLoadKg > 0 && weightKg < vehicle.minLoadKg) warnings.push(`ต่ำกว่าน้ำหนักขั้นต่ำที่คุ้มของรถคันนี้ (${vehicle.minLoadKg.toLocaleString('en-US')} กก.)`)
  return {
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    capacityKg: vehicle.capacityKg,
    minLoadKg: vehicle.minLoadKg,
    weightKg,
    bags: round3(stops.reduce((s, x) => s + x.bags, 0)),
    stops,
    distanceKm,
    durationMin,
    returnKm,
    fuelCost: round2(distanceKm * vehicle.costPerKm),
    polyline: line.polyline,
    source: line.km !== null ? 'google' : matrix.source,
    warnings,
  }
}

const planSchema = z.object({
  depotLocationId: uuid,
  orderIds: z.array(uuid).min(1, 'เลือกออเดอร์อย่างน้อย 1 รายการ').max(60),
  vehicleIds: z.array(uuid).min(1, 'เลือกรถอย่างน้อย 1 คัน').max(20),
  returnToDepot: z.boolean().default(true),
  /** Optional fixed split from the user: vehicleId → orderIds; only the order inside each trip is optimised. */
  fixed: z.array(z.object({ vehicleId: uuid, orderIds: z.array(uuid) })).optional(),
})

/** Preview: choose vehicles, split stops, and the shortest order per vehicle. Nothing is saved. */
deliveryRoutes.post('/delivery/plan', async (c) => {
  const ctx = c.get('ctx')
  const b = planSchema.parse(await c.req.json())
  const [depot, orders, vehicleRows] = await Promise.all([
    loadDepot(ctx, b.depotLocationId),
    loadOrders(ctx, b.orderIds),
    query(ctx, 'SELECT * FROM vehicles WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid) AND is_active', [JSON.stringify(b.vehicleIds)]),
  ])
  const vehicles = vehicleRows.map((r) => ({
    id: str(r, 'id'),
    name: str(r, 'name'),
    capacityKg: num(r, 'capacity_kg'),
    minLoadKg: num(r, 'min_load_kg'),
    costPerKm: num(r, 'cost_per_km'),
  }))
  if (!vehicles.length) throw new HttpError(400, 'ไม่มีรถที่ใช้งานได้')

  const noPin = orders.filter((o) => numOrNull(o, 'lat') === null || numOrNull(o, 'lng') === null)
  const pinned = orders.filter((o) => !noPin.includes(o))
  const points: LatLng[] = [depot, ...pinned.map((o) => ({ lat: num(o, 'lat'), lng: num(o, 'lng') }))]
  const rowsByIdx = new Map(pinned.map((o, i) => [i + 1, o]))
  const idxByOrder = new Map(pinned.map((o, i) => [str(o, 'id'), i + 1]))
  const matrix = await distanceMatrix(points)

  let groups: { vehicle: (typeof vehicles)[number]; idx: number[] }[]
  let unassigned: string[] = []
  if (b.fixed?.length) {
    groups = b.fixed
      .map((f) => ({ vehicle: vehicles.find((v) => v.id === f.vehicleId), idx: f.orderIds.map((id) => idxByOrder.get(id)).filter((x): x is number => !!x) }))
      .filter((g): g is { vehicle: (typeof vehicles)[number]; idx: number[] } => !!g.vehicle && g.idx.length > 0)
  } else {
    const stops: StopInfo[] = pinned.map((o, i) => ({ index: i + 1, orderId: str(o, 'id'), weightKg: num(o, 'total_weight_kg'), point: points[i + 1]! }))
    const res = assignVehicles(depot, stops, vehicles)
    groups = res.plans.map((p) => ({ vehicle: vehicles.find((v) => v.id === p.vehicle.id)!, idx: p.stops.map((s) => s.index) }))
    unassigned = res.unassigned.map((s) => s.orderId)
  }

  const trips: PlannedTrip[] = []
  for (const g of groups) {
    const order = shortestOrder(g.idx, matrix.km, b.returnToDepot)
    trips.push(await buildTrip(g.vehicle, depot, order, matrix, points, rowsByIdx, b.returnToDepot))
  }
  return c.json({
    depot,
    returnToDepot: b.returnToDepot,
    distanceSource: trips.some((t) => t.source === 'google') ? 'google' : matrix.source,
    trips,
    totals: {
      distanceKm: round2(trips.reduce((s, t) => s + t.distanceKm, 0)),
      durationMin: round2(trips.reduce((s, t) => s + t.durationMin, 0)),
      weightKg: round3(trips.reduce((s, t) => s + t.weightKg, 0)),
      fuelCost: round2(trips.reduce((s, t) => s + t.fuelCost, 0)),
    },
    unassigned: unassigned.map((id) => {
      const o = orders.find((x) => str(x, 'id') === id)
      return { orderId: id, docNo: o ? str(o, 'doc_no') : '', name: o ? str(o, 'recipient_name') : '', weightKg: o ? num(o, 'total_weight_kg') : 0 }
    }),
    noPin: noPin.map((o) => ({ orderId: str(o, 'id'), docNo: str(o, 'doc_no'), name: str(o, 'recipient_name') })),
  })
})

// ---------------------------------------------------------------- trips

const saveSchema = z.object({
  tripDate: date,
  depotLocationId: uuid,
  returnToDepot: z.boolean().default(true),
  trips: z
    .array(
      z.object({
        vehicleId: uuid,
        /** Stops in driving order. */
        orderIds: z.array(uuid).min(1).max(25),
        note: z.string().trim().max(300).nullish(),
      }),
    )
    .min(1)
    .max(10),
})

/** Save the plan: one trip per vehicle with its stop order; orders become "planned". */
deliveryRoutes.post('/delivery/trips', async (c) => {
  const ctx = c.get('ctx')
  const b = saveSchema.parse(await c.req.json())
  const allIds = b.trips.flatMap((t) => t.orderIds)
  if (new Set(allIds).size !== allIds.length) throw new HttpError(400, 'ออเดอร์เดียวอยู่ในหลายเที่ยว')
  const [depot, orders, vehicleRows] = await Promise.all([
    loadDepot(ctx, b.depotLocationId),
    loadOrders(ctx, allIds),
    query(ctx, 'SELECT * FROM vehicles WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)', [JSON.stringify(b.trips.map((t) => t.vehicleId))]),
  ])
  for (const o of orders) {
    if (str(o, 'status') !== 'pending') throw new HttpError(409, `${str(o, 'doc_no')} ไม่ได้อยู่ในสถานะรอจัดส่ง`)
    if (numOrNull(o, 'lat') === null) throw new HttpError(400, `${str(o, 'recipient_name')} ยังไม่ได้ปักหมุด`)
  }
  const byId = new Map(orders.map((o) => [str(o, 'id'), o]))
  const period = b.tripDate.slice(0, 7).replace('-', '')
  const saved: { id: string; docNo: string }[] = []

  for (const t of b.trips) {
    const v = vehicleRows.find((r) => str(r, 'id') === t.vehicleId)
    if (!v) throw new HttpError(400, 'ไม่พบรถ')
    const rows = t.orderIds.map((id) => byId.get(id)).filter((x): x is Row => !!x)
    const points: LatLng[] = [depot, ...rows.map((o) => ({ lat: num(o, 'lat'), lng: num(o, 'lng') }))]
    const matrix = await distanceMatrix(points)
    const trip = await buildTrip(
      { id: str(v, 'id'), name: str(v, 'name'), capacityKg: num(v, 'capacity_kg'), minLoadKg: num(v, 'min_load_kg'), costPerKm: num(v, 'cost_per_km') },
      depot,
      rows.map((_, i) => i + 1),
      matrix,
      points,
      new Map(rows.map((o, i) => [i + 1, o])),
      b.returnToDepot,
    )
    const id = randomUUID()
    await transaction(ctx, [
      { sql: counterBumpSql, params: ['TR', period] },
      {
        sql: `INSERT INTO delivery_trips (id, doc_no, trip_date, vehicle_id, vehicle_name, depot_location_id, return_to_depot, total_weight_kg,
                total_bags, distance_km, duration_min, distance_source, route_polyline, note)
              VALUES ($1::uuid, ${docNoSql('$2', '$3')}, $4::date, $5::uuid, $6, $7::uuid, $8::boolean, $9::numeric, $10::numeric,
                $11::numeric, $12::numeric, $13, $14, $15)`,
        params: [
          id,
          'TR',
          period,
          b.tripDate,
          t.vehicleId,
          str(v, 'name'),
          b.depotLocationId,
          b.returnToDepot,
          trip.weightKg,
          trip.bags,
          trip.distanceKm,
          trip.durationMin,
          trip.source,
          trip.polyline,
          t.note || null,
        ],
      },
      {
        sql: `INSERT INTO delivery_trip_stops (trip_id, seq, order_id, leg_km, leg_min)
              SELECT $1::uuid, x.seq, x.order_id, x.leg_km, x.leg_min
                FROM jsonb_to_recordset($2::jsonb) AS x(seq int, order_id uuid, leg_km numeric, leg_min numeric)`,
        params: [id, JSON.stringify(trip.stops.map((s, i) => ({ seq: i + 1, order_id: s.orderId, leg_km: s.legKm, leg_min: s.legMin })))],
      },
      {
        sql: `UPDATE delivery_orders SET status = 'planned', delivery_date = $2::date, updated_at = now()
               WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid) AND status = 'pending'`,
        params: [JSON.stringify(t.orderIds), b.tripDate],
      },
    ])
    const [row] = await query(ctx, 'SELECT doc_no FROM delivery_trips WHERE id = $1::uuid', [id])
    saved.push({ id, docNo: str(row ?? {}, 'doc_no') })
  }
  return c.json({ trips: saved }, 201)
})

function mapTrip(r: Row) {
  return {
    id: str(r, 'id'),
    docNo: str(r, 'doc_no'),
    tripDate: dateOnly(r, 'trip_date') ?? '',
    vehicleId: str(r, 'vehicle_id'),
    vehicleName: str(r, 'vehicle_name'),
    plate: strOrNull(r, 'plate'),
    driverName: strOrNull(r, 'driver_name'),
    depotLocationId: str(r, 'depot_location_id'),
    depotName: strOrNull(r, 'depot_name'),
    depotLat: numOrNull(r, 'depot_lat'),
    depotLng: numOrNull(r, 'depot_lng'),
    returnToDepot: bool(r, 'return_to_depot'),
    weightKg: num(r, 'total_weight_kg'),
    bags: num(r, 'total_bags'),
    distanceKm: num(r, 'distance_km'),
    durationMin: num(r, 'duration_min'),
    distanceSource: str(r, 'distance_source'),
    polyline: strOrNull(r, 'route_polyline'),
    status: str(r, 'status'),
    stopCount: num(r, 'stop_count'),
  }
}

const TRIP_SELECT = `
  SELECT t.*, v.plate, v.driver_name, l.name AS depot_name, l.lat AS depot_lat, l.lng AS depot_lng,
         (SELECT count(*) FROM delivery_trip_stops s WHERE s.trip_id = t.id) AS stop_count
    FROM delivery_trips t
    JOIN vehicles v ON v.id = t.vehicle_id
    JOIN locations l ON l.id = t.depot_location_id`

deliveryRoutes.get('/delivery/trips', async (c) => {
  const ctx = c.get('ctx')
  const from = date.parse(c.req.query('from'))
  const to = date.parse(c.req.query('to') ?? from)
  const rows = await query(ctx, `${TRIP_SELECT} WHERE t.trip_date BETWEEN $1::date AND $2::date ORDER BY t.trip_date DESC, t.doc_no`, [from, to])
  return c.json(rows.map(mapTrip))
})

deliveryRoutes.get('/delivery/trips/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [head, stops] = await Promise.all([
    query(ctx, `${TRIP_SELECT} WHERE t.id = $1::uuid`, [id]),
    query(
      ctx,
      `SELECT s.seq, s.leg_km, s.leg_min, s.delivered_at, o.id AS order_id, o.doc_no, o.recipient_name, o.phone, o.address, o.lat, o.lng,
              o.total_bags, o.total_weight_kg, o.status, o.note,
              (SELECT string_agg(l.product_name || ' ' || trim(to_char(l.qty, 'FM999999990.###')) || ' ' || l.unit, ', ' ORDER BY l.line_no)
                 FROM delivery_order_lines l WHERE l.order_id = o.id) AS items
         FROM delivery_trip_stops s JOIN delivery_orders o ON o.id = s.order_id
        WHERE s.trip_id = $1::uuid ORDER BY s.seq`,
      [id],
    ),
  ])
  if (!head[0]) throw new HttpError(404, 'ไม่พบเที่ยวรถ')
  return c.json({
    ...mapTrip(head[0]),
    stops: stops.map((r) => ({
      seq: num(r, 'seq'),
      orderId: str(r, 'order_id'),
      docNo: str(r, 'doc_no'),
      name: str(r, 'recipient_name'),
      phone: strOrNull(r, 'phone'),
      address: strOrNull(r, 'address'),
      lat: numOrNull(r, 'lat'),
      lng: numOrNull(r, 'lng'),
      bags: num(r, 'total_bags'),
      weightKg: num(r, 'total_weight_kg'),
      legKm: num(r, 'leg_km'),
      legMin: num(r, 'leg_min'),
      status: str(r, 'status'),
      note: strOrNull(r, 'note'),
      items: strOrNull(r, 'items') ?? '',
    })),
  })
})

const tripStatusSchema = z.object({ status: z.enum(['done', 'cancelled']) })

/** Finish a trip (its orders become delivered) or cancel it (orders go back to waiting). */
deliveryRoutes.post('/delivery/trips/:id/status', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = tripStatusSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE delivery_trips SET status = $2, updated_at = now() WHERE id = $1::uuid AND status = 'planned' RETURNING id`,
      params: [id, b.status],
    },
    {
      sql: `UPDATE delivery_orders SET status = $2, updated_at = now()
             WHERE id IN (SELECT order_id FROM delivery_trip_stops WHERE trip_id = $1::uuid) AND status = 'planned'`,
      params: [id, b.status === 'done' ? 'delivered' : 'pending'],
    },
  ])
  if (!rows?.[0]) throw new HttpError(409, 'เที่ยวนี้ปิดหรือยกเลิกไปแล้ว')
  return c.json({ ok: true })
})
