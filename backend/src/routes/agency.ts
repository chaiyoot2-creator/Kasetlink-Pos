import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { guardTerm, query, transaction, type BatchOp, type RequestCtx, type Row } from '../db.js'
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
} from '../stock.js'
import {
  bool,
  counterBumpSql,
  dateOnly,
  docNoSql,
  eventEnvelope,
  num,
  optionalDate,
  round2,
  round3,
  round4,
  str,
  strOrNull,
  uuid,
} from '../util.js'

/**
 * Agency channel for บริษัท ฟาร์มสุข (เบทาโกร). Goods belong to the company and the customer
 * pays the company; the shop records each delivery to earn
 *   - incentive: percent (by customer group) of the month's sales at the standard price
 *   - transport: a fixed rate per sack (by route)
 * Nothing here touches shop stock, sales, receivables or profit reports.
 */
export const agencyRoutes = new Hono<AppEnv>()

const DEFAULT_GROUPS: [string, number][] = [
  ['ลูกค้าร้านธีรัตม์ (ตรง)', 8],
  ['ซับร้านบ้านข้าวสาร', 2],
  ['ซับร้านกัลยา แม่สรวย', 3],
]
const DEFAULT_ROUTES: [string, number][] = [
  ['ฝากพ่วงรถบรรทุกของร้าน', 17],
  ['ฝากส่ง อ.พาน / อ.แม่ลาว', 12],
  ['ฝากส่ง อ.แม่สรวย', 18],
  ['ไม่มีค่าขนส่ง (บริษัทส่งเอง)', 0],
]

const month = z.string().regex(/^\d{4}-\d{2}$/, 'เดือนต้องอยู่ในรูปแบบ YYYY-MM')
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// ---------------------------------------------------------------- setup lists

function mapGroup(r: Row) {
  return { id: str(r, 'id'), name: str(r, 'name'), incentivePct: num(r, 'incentive_pct'), sortOrder: num(r, 'sort_order'), isActive: bool(r, 'is_active') }
}
function mapRoute(r: Row) {
  return { id: str(r, 'id'), name: str(r, 'name'), ratePerSack: num(r, 'rate_per_sack'), sortOrder: num(r, 'sort_order'), isActive: bool(r, 'is_active') }
}
function mapProduct(r: Row) {
  return {
    id: str(r, 'id'),
    code: strOrNull(r, 'code'),
    name: str(r, 'name'),
    unit: str(r, 'unit'),
    stdPrice: num(r, 'std_price'),
    shopProductId: strOrNull(r, 'shop_product_id'),
    isActive: bool(r, 'is_active'),
  }
}
function mapCustomer(r: Row) {
  return {
    id: str(r, 'id'),
    name: str(r, 'name'),
    phone: strOrNull(r, 'phone'),
    address: strOrNull(r, 'address'),
    groupId: strOrNull(r, 'group_id'),
    routeId: strOrNull(r, 'route_id'),
    note: strOrNull(r, 'note'),
    isActive: bool(r, 'is_active'),
  }
}

/** First visit: create the shop's groups and routes with the agreed rates (editable later). */
async function ensureDefaults(ctx: RequestCtx) {
  const [g, r] = await Promise.all([
    query(ctx, 'SELECT count(*) AS n FROM agency_groups'),
    query(ctx, 'SELECT count(*) AS n FROM agency_routes'),
  ])
  const ops = []
  if (num(g[0] ?? {}, 'n') === 0) {
    ops.push({
      sql: `INSERT INTO agency_groups (name, incentive_pct, sort_order)
            SELECT x.name, x.pct, x.ord FROM jsonb_to_recordset($1::jsonb) AS x(name text, pct numeric, ord int)
            ON CONFLICT (org_id, name) DO NOTHING`,
      params: [JSON.stringify(DEFAULT_GROUPS.map(([name, pct], i) => ({ name, pct, ord: i + 1 })))],
    })
  }
  if (num(r[0] ?? {}, 'n') === 0) {
    ops.push({
      sql: `INSERT INTO agency_routes (name, rate_per_sack, sort_order)
            SELECT x.name, x.rate, x.ord FROM jsonb_to_recordset($1::jsonb) AS x(name text, rate numeric, ord int)
            ON CONFLICT (org_id, name) DO NOTHING`,
      params: [JSON.stringify(DEFAULT_ROUTES.map(([name, rate], i) => ({ name, rate, ord: i + 1 })))],
    })
  }
  if (ops.length) await transaction(ctx, ops)
}

agencyRoutes.get('/agency/setup', async (c) => {
  const ctx = c.get('ctx')
  await ensureDefaults(ctx)
  const [groups, routes, products, customers] = await Promise.all([
    query(ctx, 'SELECT * FROM agency_groups ORDER BY sort_order, name'),
    query(ctx, 'SELECT * FROM agency_routes ORDER BY sort_order, name'),
    query(ctx, 'SELECT * FROM agency_products ORDER BY is_active DESC, name'),
    query(ctx, 'SELECT * FROM agency_customers ORDER BY is_active DESC, name'),
  ])
  return c.json({
    groups: groups.map(mapGroup),
    routes: routes.map(mapRoute),
    products: products.map(mapProduct),
    customers: customers.map(mapCustomer),
  })
})

const name = z.string().trim().min(1).max(120)
const groupSchema = z.object({ name, incentivePct: z.number().min(0).max(100), sortOrder: z.number().int().default(0), isActive: z.boolean().default(true) })
const routeSchema = z.object({ name, ratePerSack: z.number().min(0).max(100000), sortOrder: z.number().int().default(0), isActive: z.boolean().default(true) })
const productSchema = z.object({
  code: z.string().trim().max(40).nullish(),
  name,
  unit: z.string().trim().min(1).max(30).default('กระสอบ'),
  stdPrice: z.number().min(0).max(10_000_000),
  shopProductId: uuid.nullish(),
  isActive: z.boolean().default(true),
})
const customerSchema = z.object({
  name,
  phone: z.string().trim().max(40).nullish(),
  address: z.string().trim().max(400).nullish(),
  groupId: uuid.nullish(),
  routeId: uuid.nullish(),
  note: z.string().trim().max(400).nullish(),
  isActive: z.boolean().default(true),
})

agencyRoutes.post('/agency/groups', async (c) => {
  const b = groupSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    { sql: 'INSERT INTO agency_groups (name, incentive_pct, sort_order, is_active) VALUES ($1, $2::numeric, $3::int, $4::boolean) RETURNING *', params: [b.name, b.incentivePct, b.sortOrder, b.isActive] },
  ])
  return c.json(mapGroup(rows?.[0] ?? {}), 201)
})
agencyRoutes.put('/agency/groups/:id', async (c) => {
  const id = uuid.parse(c.req.param('id'))
  const b = groupSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `UPDATE agency_groups SET name = $1, incentive_pct = $2::numeric, sort_order = $3::int, is_active = $4::boolean, updated_at = now()
            WHERE id = $5::uuid RETURNING *`,
      params: [b.name, b.incentivePct, b.sortOrder, b.isActive, id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบกลุ่มลูกค้า')
  return c.json(mapGroup(rows[0]))
})

agencyRoutes.post('/agency/routes', async (c) => {
  const b = routeSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    { sql: 'INSERT INTO agency_routes (name, rate_per_sack, sort_order, is_active) VALUES ($1, $2::numeric, $3::int, $4::boolean) RETURNING *', params: [b.name, b.ratePerSack, b.sortOrder, b.isActive] },
  ])
  return c.json(mapRoute(rows?.[0] ?? {}), 201)
})
agencyRoutes.put('/agency/routes/:id', async (c) => {
  const id = uuid.parse(c.req.param('id'))
  const b = routeSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `UPDATE agency_routes SET name = $1, rate_per_sack = $2::numeric, sort_order = $3::int, is_active = $4::boolean, updated_at = now()
            WHERE id = $5::uuid RETURNING *`,
      params: [b.name, b.ratePerSack, b.sortOrder, b.isActive, id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบเส้นทาง')
  return c.json(mapRoute(rows[0]))
})

agencyRoutes.post('/agency/products', async (c) => {
  const b = productSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `INSERT INTO agency_products (code, name, unit, std_price, is_active, shop_product_id)
            VALUES ($1, $2, $3, $4::numeric, $5::boolean, $6::uuid) RETURNING *`,
      params: [b.code || null, b.name, b.unit, b.stdPrice, b.isActive, b.shopProductId ?? null],
    },
  ])
  return c.json(mapProduct(rows?.[0] ?? {}), 201)
})
agencyRoutes.put('/agency/products/:id', async (c) => {
  const id = uuid.parse(c.req.param('id'))
  const b = productSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `UPDATE agency_products SET code = $1, name = $2, unit = $3, std_price = $4::numeric, is_active = $5::boolean,
              shop_product_id = $7::uuid, updated_at = now()
            WHERE id = $6::uuid RETURNING *`,
      params: [b.code || null, b.name, b.unit, b.stdPrice, b.isActive, id, b.shopProductId ?? null],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบสินค้า')
  return c.json(mapProduct(rows[0]))
})

agencyRoutes.post('/agency/customers', async (c) => {
  const b = customerSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `INSERT INTO agency_customers (name, phone, address, group_id, route_id, note, is_active)
            VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7::boolean) RETURNING *`,
      params: [b.name, b.phone || null, b.address || null, b.groupId ?? null, b.routeId ?? null, b.note || null, b.isActive],
    },
  ])
  return c.json(mapCustomer(rows?.[0] ?? {}), 201)
})
agencyRoutes.put('/agency/customers/:id', async (c) => {
  const id = uuid.parse(c.req.param('id'))
  const b = customerSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `UPDATE agency_customers SET name = $1, phone = $2, address = $3, group_id = $4::uuid, route_id = $5::uuid, note = $6,
              is_active = $7::boolean, updated_at = now()
            WHERE id = $8::uuid RETURNING *`,
      params: [b.name, b.phone || null, b.address || null, b.groupId ?? null, b.routeId ?? null, b.note || null, b.isActive, id],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบลูกค้า')
  return c.json(mapCustomer(rows[0]))
})

// ---------------------------------------------------------------- deliveries

function mapDelivery(r: Row) {
  return {
    id: str(r, 'id'),
    docNo: str(r, 'doc_no'),
    deliveredOn: dateOnly(r, 'delivered_on') ?? '',
    companyRef: strOrNull(r, 'company_ref'),
    customerId: strOrNull(r, 'customer_id'),
    customerName: str(r, 'customer_name'),
    groupId: strOrNull(r, 'group_id'),
    groupName: str(r, 'group_name'),
    incentivePct: num(r, 'incentive_pct'),
    routeId: strOrNull(r, 'route_id'),
    routeName: str(r, 'route_name'),
    ratePerSack: num(r, 'rate_per_sack'),
    sacks: num(r, 'sacks'),
    salesValue: num(r, 'sales_value'),
    incentiveAmount: num(r, 'incentive_amount'),
    transportAmount: num(r, 'transport_amount'),
    note: strOrNull(r, 'note'),
    status: str(r, 'status'),
    voidReason: strOrNull(r, 'void_reason'),
    createdAt: str(r, 'created_at'),
    stockLocationId: strOrNull(r, 'stock_location_id'),
    lentQty: num(r, 'lent_qty'),
  }
}

agencyRoutes.get('/agency/deliveries', async (c) => {
  const ctx = c.get('ctx')
  const from = date.parse(c.req.query('from'))
  const to = date.parse(c.req.query('to'))
  const q = (c.req.query('q') ?? '').trim()
  const rows = await query(
    ctx,
    `SELECT * FROM agency_deliveries
      WHERE delivered_on BETWEEN $1::date AND $2::date
        AND ($3 = '' OR customer_name ILIKE '%' || $3 || '%' OR doc_no ILIKE '%' || $3 || '%' OR company_ref ILIKE '%' || $3 || '%')
      ORDER BY delivered_on DESC, doc_no DESC LIMIT 1000`,
    [from, to, q],
  )
  return c.json(rows.map(mapDelivery))
})

agencyRoutes.get('/agency/deliveries/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [head, lines] = await Promise.all([
    query(ctx, 'SELECT * FROM agency_deliveries WHERE id = $1::uuid', [id]),
    query(ctx, 'SELECT * FROM agency_delivery_lines WHERE delivery_id = $1::uuid ORDER BY line_no', [id]),
  ])
  if (!head[0]) throw new HttpError(404, 'ไม่พบรายการส่ง')
  return c.json({
    ...mapDelivery(head[0]),
    lines: lines.map((r) => ({
      lineNo: num(r, 'line_no'),
      productId: strOrNull(r, 'product_id'),
      productName: str(r, 'product_name'),
      unit: str(r, 'unit'),
      qty: num(r, 'qty'),
      stdPrice: num(r, 'std_price'),
      amount: num(r, 'amount'),
      shopProductId: strOrNull(r, 'shop_product_id'),
      fromStock: strOrNull(r, 'shop_product_id') !== null,
    })),
  })
})

const deliverySchema = z.object({
  ...eventEnvelope,
  deliveredOn: date,
  companyRef: z.string().trim().max(60).nullish(),
  customerId: uuid.nullish(),
  customerName: z.string().trim().max(120).nullish(),
  groupId: uuid,
  routeId: uuid,
  note: z.string().trim().max(400).nullish(),
  /** Location the shop's own stock is taken from when any line has fromStock. */
  stockLocationId: uuid.nullish(),
  lines: z
    .array(
      z.object({
        productId: uuid.nullish(),
        /** Delivered from the shop's stock now; ฟาร์มสุข replaces the same product later. */
        fromStock: z.boolean().default(false),
        shopProductId: uuid.nullish(),
        productName: z.string().trim().min(1).max(120),
        unit: z.string().trim().min(1).max(30).default('กระสอบ'),
        qty: z.number().positive().max(100_000),
        stdPrice: z.number().min(0).max(10_000_000),
      }),
    )
    .min(1, 'เพิ่มสินค้าอย่างน้อย 1 รายการ')
    .max(100),
})

agencyRoutes.post('/agency/deliveries', async (c) => {
  const ctx = c.get('ctx')
  const b = deliverySchema.parse(await c.req.json())
  const [groupRows, routeRows, customerRows] = await Promise.all([
    query(ctx, 'SELECT * FROM agency_groups WHERE id = $1::uuid', [b.groupId]),
    query(ctx, 'SELECT * FROM agency_routes WHERE id = $1::uuid', [b.routeId]),
    b.customerId ? query(ctx, 'SELECT name FROM agency_customers WHERE id = $1::uuid', [b.customerId]) : Promise.resolve([]),
  ])
  const group = groupRows[0]
  const route = routeRows[0]
  if (!group) throw new HttpError(400, 'ไม่พบกลุ่มลูกค้า')
  if (!route) throw new HttpError(400, 'ไม่พบเส้นทางขนส่ง')
  const customerName = (customerRows[0] ? str(customerRows[0], 'name') : b.customerName?.trim()) || ''
  if (!customerName) throw new HttpError(400, 'ระบุลูกค้า')

  const lines = b.lines.map((l, i) => ({ ...l, lineNo: i + 1, qty: round3(l.qty), amount: round2(l.qty * l.stdPrice) }))
  const sacks = round3(lines.reduce((s, l) => s + l.qty, 0))
  const salesValue = round2(lines.reduce((s, l) => s + l.amount, 0))
  const pct = num(group, 'incentive_pct')
  const rate = num(route, 'rate_per_sack')
  const incentiveAmount = round2((salesValue * pct) / 100)
  const transportAmount = round2(sacks * rate)
  const id = randomUUID()
  const period = b.deliveredOn.slice(0, 7).replace('-', '')

  // Lines delivered from the shop's own stock: take it now (FEFO) and record what ฟาร์มสุข owes back.
  const lentLines: { productId: string; qty: number }[] = []
  for (const l of lines.filter((x) => x.fromStock)) {
    if (!l.shopProductId) throw new HttpError(400, `เลือกสินค้าในร้านที่ใช้ส่งแทนสำหรับ “${l.productName}”`)
    lentLines.push({ productId: l.shopProductId, qty: l.qty })
  }
  const stockLocationId = lentLines.length > 0 ? (b.stockLocationId ?? null) : null
  if (lentLines.length > 0 && !stockLocationId) throw new HttpError(400, 'เลือกสาขา/โซนที่ตัดสต็อก')
  const shopProducts = await loadProducts(
    ctx,
    lentLines.map((l) => l.productId),
  )
  const demand = demandByProduct(lentLines)
  const allocations = stockLocationId
    ? allocateFefo(
        await loadLots(ctx, stockLocationId, [...demand.keys()]),
        demand,
        new Map([...shopProducts].map(([pid, p]) => [pid, p.name])),
        { skipExpired: true },
      )
    : []
  const unitCost = (pid: string) => shopProducts.get(pid)?.avgCost ?? 0
  const lentQty = round3(lentLines.reduce((s, l) => s + l.qty, 0))

  const ops: BatchOp[] = [
    { sql: counterBumpSql, params: ['FS', period] },
    {
      sql: `INSERT INTO agency_deliveries (id, doc_no, event_id, terminal_id, delivered_on, company_ref, customer_id, customer_name,
              group_id, group_name, incentive_pct, route_id, route_name, rate_per_sack, sacks, sales_value, incentive_amount,
              transport_amount, note, stock_location_id, lent_qty)
            VALUES ($1::uuid, ${docNoSql('$2', '$3')}, $4::uuid, $5, $6::date, $7, $8::uuid, $9, $10::uuid, $11, $12::numeric,
              $13::uuid, $14, $15::numeric, $16::numeric, $17::numeric, $18::numeric, $19::numeric, $20, $21::uuid, $22::numeric)`,
      params: [
        id,
        'FS',
        period,
        b.eventId,
        b.terminalId,
        b.deliveredOn,
        b.companyRef || null,
        b.customerId ?? null,
        customerName,
        b.groupId,
        str(group, 'name'),
        pct,
        b.routeId,
        str(route, 'name'),
        rate,
        sacks,
        salesValue,
        incentiveAmount,
        transportAmount,
        b.note || null,
        stockLocationId,
        lentQty,
      ],
    },
    {
      sql: `INSERT INTO agency_delivery_lines (delivery_id, line_no, product_id, product_name, unit, qty, std_price, amount,
              shop_product_id, unit_cost)
            SELECT $1::uuid, x.line_no, x.product_id, x.product_name, x.unit, x.qty, x.std_price, x.amount, x.shop_product_id, x.unit_cost
              FROM jsonb_to_recordset($2::jsonb)
                AS x(line_no int, product_id uuid, product_name text, unit text, qty numeric, std_price numeric, amount numeric,
                     shop_product_id uuid, unit_cost numeric)`,
      params: [
        id,
        JSON.stringify(
          lines.map((l) => ({
            line_no: l.lineNo,
            product_id: l.productId ?? null,
            product_name: l.productName,
            unit: l.unit,
            qty: l.qty,
            std_price: l.stdPrice,
            amount: l.amount,
            shop_product_id: l.fromStock ? (l.shopProductId ?? null) : null,
            unit_cost: l.fromStock && l.shopProductId ? unitCost(l.shopProductId) : 0,
          })),
        ),
      ],
    },
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'agency_delivery',
        terminalId: b.terminalId,
        zoneId: stockLocationId ?? 'agency-farmsuk',
        occurredAt: b.occurredAt,
        refType: 'agency_delivery',
        refId: id,
        payload: {
          customerName,
          group: str(group, 'name'),
          route: str(route, 'name'),
          sacks,
          salesValue,
          incentiveAmount,
          transportAmount,
          lentFromStock: allocations.map((a) => ({ lotId: a.lotId, productId: a.productId, qty: a.qty })),
        },
      }),
    },
  ]

  if (allocations.length > 0 && stockLocationId) {
    const byLot = aggregateByLot(allocations)
    const lotProduct = new Map(allocations.map((a) => [a.lotId, a.productId]))
    ops.push(
      { sql: lotDecrementSql('$1'), params: [JSON.stringify(byLot)] },
      {
        sql: movementsForLotsSql({
          event: '$1',
          terminal: '$2',
          zone: '$3',
          occurredAt: '$4',
          type: "'agency_lend'",
          recordset: '$5',
          refType: "'agency_delivery'",
          refId: '$6',
          reason: '$7',
          sign: -1,
        }),
        params: [
          b.eventId,
          b.terminalId,
          stockLocationId,
          b.occurredAt,
          JSON.stringify(byLot.map((x) => ({ ...x, unit_cost: unitCost(lotProduct.get(x.lot_id) ?? '') }))),
          id,
          `ส่งลูกค้าฟาร์มสุขแทน (${customerName}) — รอบริษัทส่งคืน`,
        ],
      },
      {
        sql: `INSERT INTO agency_loan_entries (entry_type, product_id, qty, unit_cost, delivery_id, event_id, occurred_on)
              SELECT 'lend', x.product_id, x.qty, x.unit_cost, $1::uuid, $2::uuid, $3::date
                FROM jsonb_to_recordset($4::jsonb) AS x(product_id uuid, qty numeric, unit_cost numeric)`,
        params: [
          id,
          b.eventId,
          b.deliveredOn,
          JSON.stringify([...demand].map(([product_id, qty]) => ({ product_id, qty, unit_cost: unitCost(product_id) }))),
        ],
      },
    )
  }

  await transaction(ctx, ops)
  const [row] = await query(ctx, 'SELECT * FROM agency_deliveries WHERE id = $1::uuid', [id])
  return c.json(mapDelivery(row ?? {}), 201)
})

const voidSchema = z.object({ ...eventEnvelope, reason: z.string().trim().min(1, 'ระบุเหตุผล').max(300) })

/** Outstanding (lent − returned) per shop product. */
async function loanBalances(ctx: RequestCtx): Promise<Map<string, number>> {
  const rows = await query(ctx, 'SELECT product_id, SUM(qty) AS qty FROM agency_loan_entries GROUP BY product_id')
  return new Map(rows.map((r) => [str(r, 'product_id'), num(r, 'qty')]))
}

agencyRoutes.post('/agency/deliveries/:id/void', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = voidSchema.parse(await c.req.json())
  const [head, movements, lentEntries] = await Promise.all([
    query(ctx, 'SELECT * FROM agency_deliveries WHERE id = $1::uuid', [id]),
    query(
      ctx,
      `SELECT lot_id, product_id, -qty_change AS qty, unit_cost FROM stock_movements
        WHERE ref_type = 'agency_delivery' AND ref_id = $1::uuid AND movement_type = 'agency_lend'`,
      [id],
    ),
    query(ctx, `SELECT product_id, qty, unit_cost FROM agency_loan_entries WHERE delivery_id = $1::uuid AND entry_type = 'lend'`, [id]),
  ])
  const delivery = head[0]
  if (!delivery) throw new HttpError(404, 'ไม่พบรายการส่ง')
  if (str(delivery, 'status') !== 'active') throw new HttpError(409, 'รายการนี้ถูกยกเลิกไปแล้ว')

  // Stock lent on this delivery comes back — unless ฟาร์มสุข already replaced it.
  if (lentEntries.length > 0) {
    const balances = await loanBalances(ctx)
    for (const e of lentEntries) {
      if ((balances.get(str(e, 'product_id')) ?? 0) + 0.0005 < num(e, 'qty')) {
        throw new HttpError(409, 'ฟาร์มสุขส่งสินค้าทดแทนรายการนี้มาแล้ว จึงยกเลิกไม่ได้ — ถ้าบันทึกผิด ให้ปรับสต็อกแทน', 'already_returned')
      }
    }
  }

  const ops: BatchOp[] = [
    {
      sql: `UPDATE agency_deliveries SET status = 'voided', void_reason = $2, voided_at = now(),
              sacks = sacks + ${guardTerm(`status = 'active'`)}
            WHERE id = $1::uuid`,
      params: [id, b.reason],
      guard: 'รายการนี้ถูกยกเลิกไปแล้ว',
    },
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'agency_delivery_void',
        terminalId: b.terminalId,
        zoneId: strOrNull(delivery, 'stock_location_id') ?? 'agency-farmsuk',
        occurredAt: b.occurredAt,
        refType: 'agency_delivery',
        refId: id,
        payload: { reason: b.reason },
      }),
    },
  ]

  const locationId = strOrNull(delivery, 'stock_location_id')
  if (movements.length > 0 && locationId) {
    const returned = movements.map((m) => ({
      lot_id: str(m, 'lot_id'),
      product_id: str(m, 'product_id'),
      qty: num(m, 'qty'),
      unit_cost: num(m, 'unit_cost'),
    }))
    ops.push(
      // Average cost first (it reads on-hand before the lots are refilled).
      {
        sql: avgCostUpdateSql('$1'),
        params: [JSON.stringify(returned.map((m) => ({ product_id: m.product_id, q: m.qty, amount: round4(m.qty * m.unit_cost) })))],
      },
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
          type: "'agency_lend_void'",
          recordset: '$5',
          refType: "'agency_delivery'",
          refId: '$6',
          reason: '$7',
          sign: 1,
        }),
        params: [b.eventId, b.terminalId, locationId, b.occurredAt, JSON.stringify(returned), id, b.reason],
      },
      {
        sql: `INSERT INTO agency_loan_entries (entry_type, product_id, qty, unit_cost, delivery_id, event_id, occurred_on)
              SELECT 'lend_void', x.product_id, -x.qty, x.unit_cost, $1::uuid, $2::uuid, (now() AT TIME ZONE 'Asia/Bangkok')::date
                FROM jsonb_to_recordset($3::jsonb) AS x(product_id uuid, qty numeric, unit_cost numeric)`,
        params: [
          id,
          b.eventId,
          JSON.stringify(lentEntries.map((e) => ({ product_id: str(e, 'product_id'), qty: num(e, 'qty'), unit_cost: num(e, 'unit_cost') }))),
        ],
      },
    )
  }

  await transaction(ctx, ops)
  const [row] = await query(ctx, 'SELECT * FROM agency_deliveries WHERE id = $1::uuid', [id])
  return c.json(mapDelivery(row ?? {}))
})

// ---------------------------------------------------------------- stock lent to ฟาร์มสุข

/**
 * Stock lent to ฟาร์มสุข. Per shop product (with the ฟาร์มสุข item numbers it was sent as):
 * owed at the start of the period, lent and returned within it, and owed at its end.
 * Without from/to the period is all time. History lists the entries inside the period.
 */
agencyRoutes.get('/agency/loans', async (c) => {
  const ctx = c.get('ctx')
  const from = date.optional().parse(c.req.query('from') || undefined) ?? '2000-01-01'
  const to = date.optional().parse(c.req.query('to') || undefined) ?? '2999-12-31'
  if (from > to) throw new HttpError(400, 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด')
  const [summary, entries, aliases] = await Promise.all([
    query(
      ctx,
      `SELECT e.product_id, p.name, p.sku, p.unit, p.track_expiry,
              COALESCE(SUM(e.qty) FILTER (WHERE e.occurred_on < $1::date), 0) AS opening,
              COALESCE(SUM(e.qty) FILTER (WHERE e.entry_type IN ('lend', 'lend_void') AND e.occurred_on BETWEEN $1::date AND $2::date), 0) AS lent,
              COALESCE(-SUM(e.qty) FILTER (WHERE e.entry_type = 'return' AND e.occurred_on BETWEEN $1::date AND $2::date), 0) AS returned,
              COALESCE(SUM(e.qty) FILTER (WHERE e.occurred_on <= $2::date), 0) AS outstanding,
              COUNT(DISTINCT e.delivery_id) FILTER (WHERE e.entry_type = 'lend' AND e.occurred_on BETWEEN $1::date AND $2::date)
                - COUNT(DISTINCT e.delivery_id) FILTER (WHERE e.entry_type = 'lend_void' AND e.occurred_on BETWEEN $1::date AND $2::date) AS trips,
              COALESCE(SUM(e.qty * e.unit_cost) FILTER (WHERE e.entry_type IN ('lend', 'lend_void')), 0) AS lent_cost,
              COALESCE(SUM(e.qty) FILTER (WHERE e.entry_type IN ('lend', 'lend_void')), 0) AS lent_all,
              MAX(e.occurred_on) FILTER (WHERE e.occurred_on <= $2::date) AS last_on
         FROM agency_loan_entries e JOIN products p ON p.id = e.product_id
        GROUP BY e.product_id, p.name, p.sku, p.unit, p.track_expiry
        ORDER BY 9 DESC, p.name`,
      [from, to],
    ),
    query(
      ctx,
      `SELECT e.id, e.entry_type, e.product_id, p.name AS product_name, p.unit, e.qty, e.occurred_on, e.created_at,
              d.id AS delivery_id, d.doc_no AS delivery_no, d.customer_name, d.company_ref AS delivery_ref,
              r.doc_no AS return_no, r.company_ref AS return_ref
         FROM agency_loan_entries e
         JOIN products p ON p.id = e.product_id
         LEFT JOIN agency_deliveries d ON d.id = e.delivery_id
         LEFT JOIN agency_stock_returns r ON r.id = e.return_id
        WHERE e.occurred_on BETWEEN $1::date AND $2::date
        ORDER BY e.occurred_on DESC, e.created_at DESC
        LIMIT 500`,
      [from, to],
    ),
    // The ฟาร์มสุข item names (เบอร์) each shop product was delivered as.
    query(
      ctx,
      `SELECT DISTINCT l.shop_product_id, l.product_name
         FROM agency_delivery_lines l JOIN agency_deliveries d ON d.id = l.delivery_id
        WHERE l.shop_product_id IS NOT NULL AND d.status = 'active'`,
    ),
  ])
  const aliasMap = new Map<string, string[]>()
  for (const a of aliases) {
    const pid = str(a, 'shop_product_id')
    aliasMap.set(pid, [...(aliasMap.get(pid) ?? []), str(a, 'product_name')])
  }
  const products = summary
    .map((r) => {
      const lentAll = num(r, 'lent_all')
      return {
        productId: str(r, 'product_id'),
        name: str(r, 'name'),
        sku: str(r, 'sku'),
        unit: str(r, 'unit'),
        trackExpiry: bool(r, 'track_expiry'),
        agencyNames: aliasMap.get(str(r, 'product_id')) ?? [],
        opening: num(r, 'opening'),
        lent: num(r, 'lent'),
        returned: num(r, 'returned'),
        outstanding: num(r, 'outstanding'),
        trips: num(r, 'trips'),
        avgCost: lentAll > 0 ? round4(num(r, 'lent_cost') / lentAll) : 0,
        lastOn: dateOnly(r, 'last_on'),
      }
    })
    .filter((p) => p.opening !== 0 || p.lent !== 0 || p.returned !== 0 || p.outstanding !== 0)
  const total = (k: 'opening' | 'lent' | 'returned' | 'outstanding') => round3(products.reduce((s, p) => s + p[k], 0))
  return c.json({
    from: from === '2000-01-01' ? null : from,
    to: to === '2999-12-31' ? null : to,
    totals: {
      opening: total('opening'),
      lent: total('lent'),
      returned: total('returned'),
      outstanding: total('outstanding'),
      outstandingCost: round2(products.reduce((s, p) => s + p.outstanding * p.avgCost, 0)),
    },
    products,
    entries: entries.map((r) => ({
      id: str(r, 'id'),
      type: str(r, 'entry_type'),
      productId: str(r, 'product_id'),
      productName: str(r, 'product_name'),
      unit: str(r, 'unit'),
      qty: num(r, 'qty'),
      occurredOn: dateOnly(r, 'occurred_on') ?? '',
      deliveryId: strOrNull(r, 'delivery_id'),
      docNo: strOrNull(r, 'delivery_no') ?? strOrNull(r, 'return_no') ?? '',
      customerName: strOrNull(r, 'customer_name'),
      companyRef: strOrNull(r, 'delivery_ref') ?? strOrNull(r, 'return_ref'),
    })),
  })
})

const returnSchema = z.object({
  ...eventEnvelope,
  receivedOn: date,
  locationId: uuid,
  companyRef: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(400).nullish(),
  lines: z
    .array(
      z.object({
        productId: uuid,
        qty: z.number().positive().max(100_000),
        lotNo: z.string().trim().max(60).default(''),
        expiryDate: optionalDate,
      }),
    )
    .min(1)
    .max(50),
})

/** ฟาร์มสุข sent the replacement: stock comes back in at the cost it left with. */
agencyRoutes.post('/agency/returns', async (c) => {
  const ctx = c.get('ctx')
  const b = returnSchema.parse(await c.req.json())
  const [balances, products, costs] = await Promise.all([
    loanBalances(ctx),
    loadProducts(
      ctx,
      b.lines.map((l) => l.productId),
    ),
    query(
      ctx,
      `SELECT product_id, SUM(qty * unit_cost) / NULLIF(SUM(qty), 0) AS unit_cost
         FROM agency_loan_entries WHERE entry_type IN ('lend', 'lend_void') GROUP BY product_id`,
    ),
  ])
  const costOf = new Map(costs.map((r) => [str(r, 'product_id'), num(r, 'unit_cost')]))
  const demand = demandByProduct(b.lines)
  for (const [pid, q] of demand) {
    const owed = balances.get(pid) ?? 0
    const name = products.get(pid)?.name ?? pid
    if (q > owed + 0.0005) throw new HttpError(409, `${name}: ฟาร์มสุขค้างคืน ${round3(owed)} แต่รับเข้า ${q}`, 'over_return')
  }
  for (const l of b.lines) {
    const p = products.get(l.productId)
    if (p?.trackExpiry && !l.expiryDate) throw new HttpError(400, `${p.name}: ระบุวันหมดอายุ`)
  }

  const id = randomUUID()
  const period = b.receivedOn.slice(0, 7).replace('-', '')
  const totalQty = round3(b.lines.reduce((s, l) => s + l.qty, 0))
  const recs = b.lines.map((l) => ({
    product_id: l.productId,
    lot_no: l.lotNo,
    expiry_date: l.expiryDate,
    qty: round3(l.qty),
    unit_cost: round4(costOf.get(l.productId) ?? products.get(l.productId)?.avgCost ?? 0),
  }))

  const ops: BatchOp[] = [
    // The event goes first: stock_movements.event_id references pos_events.
    {
      sql: eventInsertSql(),
      params: eventParams({
        eventId: b.eventId,
        type: 'agency_stock_return',
        terminalId: b.terminalId,
        zoneId: b.locationId,
        occurredAt: b.occurredAt,
        refType: 'agency_return',
        refId: id,
        payload: { companyRef: b.companyRef ?? null, lines: recs },
      }),
    },
    { sql: counterBumpSql, params: ['FR', period] },
    {
      sql: `INSERT INTO agency_stock_returns (id, doc_no, event_id, terminal_id, received_on, location_id, company_ref, note, total_qty)
            VALUES ($1::uuid, ${docNoSql('$2', '$3')}, $4::uuid, $5, $6::date, $7::uuid, $8, $9, $10::numeric)`,
      params: [id, 'FR', period, b.eventId, b.terminalId, b.receivedOn, b.locationId, b.companyRef || null, b.note || null, totalQty],
    },
    // Average cost first (it reads on-hand before the lots are refilled).
    {
      sql: avgCostUpdateSql('$1'),
      params: [JSON.stringify(recs.map((r) => ({ product_id: r.product_id, q: r.qty, amount: round4(r.qty * r.unit_cost) })))],
    },
    { sql: lotUpsertSql('$1', '$2', '$3'), params: [b.locationId, JSON.stringify(recs), b.occurredAt] },
    {
      sql: movementsForLotIdentitySql({
        event: '$1',
        terminal: '$2',
        zone: '$3',
        occurredAt: '$4',
        type: "'agency_return'",
        location: '$3',
        recordset: '$5',
        refType: "'agency_return'",
        refId: '$6',
        reason: '$7',
      }),
      params: [b.eventId, b.terminalId, b.locationId, b.occurredAt, JSON.stringify(recs), id, 'ฟาร์มสุขส่งสินค้าทดแทน'],
    },
    {
      sql: `INSERT INTO agency_loan_entries (entry_type, product_id, qty, unit_cost, return_id, event_id, occurred_on)
            SELECT 'return', x.product_id, -x.qty, x.unit_cost, $1::uuid, $2::uuid, $3::date
              FROM jsonb_to_recordset($4::jsonb) AS x(product_id uuid, qty numeric, unit_cost numeric)`,
      params: [id, b.eventId, b.receivedOn, JSON.stringify(recs)],
    },
  ]
  await transaction(ctx, ops)
  const [row] = await query(ctx, 'SELECT doc_no FROM agency_stock_returns WHERE id = $1::uuid', [id])
  return c.json({ id, docNo: str(row ?? {}, 'doc_no') }, 201)
})

// ---------------------------------------------------------------- monthly income

interface MonthTotals {
  month: string
  deliveries: number
  sacks: number
  salesValue: number
  incentive: number
  transport: number
  expected: number
  received: number
  outstanding: number
}

/** Incentive is a percent of each group's monthly total; transport is the sum of per-trip fees. */
async function monthTotals(ctx: RequestCtx, from: string, to: string): Promise<Map<string, MonthTotals & { groups: Row[]; routes: Row[] }>> {
  const [groups, routes, paid] = await Promise.all([
    query(
      ctx,
      `SELECT to_char(delivered_on, 'YYYY-MM') AS month, group_name, incentive_pct,
              count(*) AS deliveries, sum(sacks) AS sacks, sum(sales_value) AS sales_value
         FROM agency_deliveries
        WHERE status = 'active' AND to_char(delivered_on, 'YYYY-MM') BETWEEN $1 AND $2
        GROUP BY 1, 2, 3 ORDER BY 1, 2`,
      [from, to],
    ),
    query(
      ctx,
      `SELECT to_char(delivered_on, 'YYYY-MM') AS month, route_name, rate_per_sack,
              count(*) AS deliveries, sum(sacks) AS sacks, sum(transport_amount) AS transport
         FROM agency_deliveries
        WHERE status = 'active' AND to_char(delivered_on, 'YYYY-MM') BETWEEN $1 AND $2
        GROUP BY 1, 2, 3 ORDER BY 1, 2`,
      [from, to],
    ),
    query(ctx, `SELECT period, sum(amount) AS amount FROM agency_payments WHERE period BETWEEN $1 AND $2 GROUP BY 1`, [from, to]),
  ])
  const out = new Map<string, MonthTotals & { groups: Row[]; routes: Row[] }>()
  const get = (m: string) => {
    let t = out.get(m)
    if (!t) {
      t = { month: m, deliveries: 0, sacks: 0, salesValue: 0, incentive: 0, transport: 0, expected: 0, received: 0, outstanding: 0, groups: [], routes: [] }
      out.set(m, t)
    }
    return t
  }
  for (const g of groups) {
    const t = get(str(g, 'month'))
    t.groups.push(g)
    t.deliveries += num(g, 'deliveries')
    t.sacks = round3(t.sacks + num(g, 'sacks'))
    t.salesValue = round2(t.salesValue + num(g, 'sales_value'))
    t.incentive = round2(t.incentive + round2((num(g, 'sales_value') * num(g, 'incentive_pct')) / 100))
  }
  for (const r of routes) {
    const t = get(str(r, 'month'))
    t.routes.push(r)
    t.transport = round2(t.transport + num(r, 'transport'))
  }
  for (const p of paid) get(str(p, 'period')).received = num(p, 'amount')
  for (const t of out.values()) {
    t.expected = round2(t.incentive + t.transport)
    t.outstanding = round2(t.expected - t.received)
  }
  return out
}

/** Month-by-month overview with what the company still owes. */
agencyRoutes.get('/agency/months', async (c) => {
  const ctx = c.get('ctx')
  const from = month.parse(c.req.query('from'))
  const to = month.parse(c.req.query('to'))
  const totals = await monthTotals(ctx, from, to)
  return c.json(
    [...totals.values()]
      .sort((a, b) => b.month.localeCompare(a.month))
      .map(({ groups: _g, routes: _r, ...t }) => t),
  )
})

/** One month in detail: by group, by route, deliveries and payments — the evidence sheet for ฟาร์มสุข. */
agencyRoutes.get('/agency/months/:month', async (c) => {
  const ctx = c.get('ctx')
  const m = month.parse(c.req.param('month'))
  const [totals, deliveries, payments] = await Promise.all([
    monthTotals(ctx, m, m),
    query(ctx, `SELECT * FROM agency_deliveries WHERE to_char(delivered_on, 'YYYY-MM') = $1 ORDER BY delivered_on, doc_no`, [m]),
    query(ctx, 'SELECT * FROM agency_payments WHERE period = $1 ORDER BY received_on, created_at', [m]),
  ])
  const t = totals.get(m)
  return c.json({
    month: m,
    totals: t
      ? { deliveries: t.deliveries, sacks: t.sacks, salesValue: t.salesValue, incentive: t.incentive, transport: t.transport, expected: t.expected, received: t.received, outstanding: t.outstanding }
      : { deliveries: 0, sacks: 0, salesValue: 0, incentive: 0, transport: 0, expected: 0, received: 0, outstanding: 0 },
    groups: (t?.groups ?? []).map((g) => ({
      name: str(g, 'group_name'),
      incentivePct: num(g, 'incentive_pct'),
      deliveries: num(g, 'deliveries'),
      sacks: num(g, 'sacks'),
      salesValue: num(g, 'sales_value'),
      incentive: round2((num(g, 'sales_value') * num(g, 'incentive_pct')) / 100),
    })),
    routes: (t?.routes ?? []).map((r) => ({
      name: str(r, 'route_name'),
      ratePerSack: num(r, 'rate_per_sack'),
      deliveries: num(r, 'deliveries'),
      sacks: num(r, 'sacks'),
      transport: num(r, 'transport'),
    })),
    deliveries: deliveries.map(mapDelivery),
    payments: payments.map((p) => ({
      id: str(p, 'id'),
      kind: str(p, 'kind'),
      amount: num(p, 'amount'),
      receivedOn: dateOnly(p, 'received_on') ?? '',
      reference: strOrNull(p, 'reference'),
      note: strOrNull(p, 'note'),
    })),
  })
})

const paymentSchema = z.object({
  period: month,
  kind: z.enum(['incentive', 'transport', 'both']),
  amount: z.number().positive().max(100_000_000),
  receivedOn: date,
  reference: z.string().trim().max(80).nullish(),
  note: z.string().trim().max(300).nullish(),
})

agencyRoutes.post('/agency/payments', async (c) => {
  const b = paymentSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `INSERT INTO agency_payments (period, kind, amount, received_on, reference, note)
            VALUES ($1, $2, $3::numeric, $4::date, $5, $6) RETURNING id`,
      params: [b.period, b.kind, b.amount, b.receivedOn, b.reference || null, b.note || null],
    },
  ])
  return c.json({ id: str(rows?.[0] ?? {}, 'id') }, 201)
})

/** Remove a payment entered by mistake. */
agencyRoutes.delete('/agency/payments/:id', async (c) => {
  const id = uuid.parse(c.req.param('id'))
  const [rows] = await transaction(c.get('ctx'), [{ sql: 'DELETE FROM agency_payments WHERE id = $1::uuid RETURNING id', params: [id] }])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบรายการรับเงิน')
  return c.json({ ok: true })
})
