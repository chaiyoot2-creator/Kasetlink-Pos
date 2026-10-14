import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { query } from '../gate.js'
import { num, round2, str, strOrNull } from '../util.js'

export const reportRoutes = new Hono<AppEnv>()

function range(from: string | undefined, to: string | undefined) {
  const f = z.string().date().parse(from)
  const t = z.string().date().parse(to)
  if (f > t) throw new HttpError(400, 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด')
  return [f, t] as const
}

function margin(revenue: number, profit: number): number {
  return revenue > 0 ? round2((profit / revenue) * 100) : 0
}

const BKK_DAY = `(s.sold_at AT TIME ZONE 'Asia/Bangkok')::date`

/** กำไรขาดทุนรายวัน (บิลที่ยกเลิกไม่นับ) */
reportRoutes.get('/reports/daily', async (c) => {
  const ctx = c.get('ctx')
  const [from, to] = range(c.req.query('from'), c.req.query('to'))
  const locationId = c.req.query('locationId') ?? ''
  if (locationId) z.string().uuid().parse(locationId)
  const rows = await query(
    ctx,
    `SELECT ${BKK_DAY}::text AS day,
            COUNT(*) AS bills,
            SUM(s.subtotal) AS gross_sales,
            SUM(s.line_discount_total + s.bill_discount) AS discounts,
            SUM(s.total) AS revenue,
            SUM(s.cost_total) AS cogs,
            SUM(s.total) FILTER (WHERE s.payment_method = 'cash') AS cash,
            SUM(s.total) FILTER (WHERE s.payment_method = 'promptpay') AS promptpay,
            SUM(s.total) FILTER (WHERE s.payment_method = 'credit') AS credit
       FROM sales s
      WHERE s.status = 'completed' AND ${BKK_DAY} BETWEEN $1::date AND $2::date
        AND ($3 = '' OR s.location_id = NULLIF($3, '')::uuid)
      GROUP BY 1 ORDER BY 1`,
    [from, to, locationId],
  )
  const days = rows.map((r) => {
    const revenue = num(r, 'revenue')
    const cogs = round2(num(r, 'cogs'))
    const profit = round2(revenue - cogs)
    return {
      day: str(r, 'day'),
      bills: num(r, 'bills'),
      grossSales: num(r, 'gross_sales'),
      discounts: num(r, 'discounts'),
      revenue,
      cogs,
      profit,
      marginPct: margin(revenue, profit),
      cash: num(r, 'cash'),
      promptpay: num(r, 'promptpay'),
      credit: num(r, 'credit'),
    }
  })
  const sum = (k: 'bills' | 'grossSales' | 'discounts' | 'revenue' | 'cogs' | 'profit' | 'cash' | 'promptpay' | 'credit') =>
    round2(days.reduce((s, d) => s + d[k], 0))
  const totals = {
    bills: sum('bills'),
    grossSales: sum('grossSales'),
    discounts: sum('discounts'),
    revenue: sum('revenue'),
    cogs: sum('cogs'),
    profit: sum('profit'),
    marginPct: margin(sum('revenue'), sum('profit')),
    cash: sum('cash'),
    promptpay: sum('promptpay'),
    credit: sum('credit'),
  }
  return c.json({ from, to, days, totals })
})

/** กำไรขาดทุนรายสินค้า — revenue is net of line and bill discounts. */
reportRoutes.get('/reports/products', async (c) => {
  const ctx = c.get('ctx')
  const [from, to] = range(c.req.query('from'), c.req.query('to'))
  const rows = await query(
    ctx,
    `SELECT sl.product_id, MAX(sl.product_name) AS product_name, MAX(sl.unit) AS unit, p.sku, p.category,
            SUM(sl.qty) AS qty, SUM(sl.net_amount) AS revenue, SUM(sl.cost_total) AS cogs, COUNT(DISTINCT s.id) AS bills
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       JOIN products p ON p.id = sl.product_id
      WHERE s.status = 'completed' AND ${BKK_DAY} BETWEEN $1::date AND $2::date
      GROUP BY sl.product_id, p.sku, p.category
      ORDER BY SUM(sl.net_amount) - SUM(sl.cost_total) DESC`,
    [from, to],
  )
  const items = rows.map((r) => {
    const revenue = num(r, 'revenue')
    const cogs = round2(num(r, 'cogs'))
    const profit = round2(revenue - cogs)
    return {
      productId: str(r, 'product_id'),
      productName: str(r, 'product_name'),
      sku: str(r, 'sku'),
      category: strOrNull(r, 'category'),
      unit: str(r, 'unit'),
      qty: num(r, 'qty'),
      bills: num(r, 'bills'),
      revenue,
      cogs,
      profit,
      marginPct: margin(revenue, profit),
    }
  })
  return c.json({ from, to, items })
})

/** กำไรขาดทุนรายบิล */
reportRoutes.get('/reports/bills', async (c) => {
  const ctx = c.get('ctx')
  const [from, to] = range(c.req.query('from'), c.req.query('to'))
  const rows = await query(
    ctx,
    `SELECT s.id, s.bill_no, s.sold_at, s.status, s.payment_method, s.total, s.cost_total,
            s.line_discount_total + s.bill_discount AS discounts, cu.name AS customer_name, l.name AS location_name,
            (SELECT COUNT(*) FROM sale_lines WHERE sale_id = s.id) AS items
       FROM sales s
       JOIN locations l ON l.id = s.location_id
       LEFT JOIN customers cu ON cu.id = s.customer_id
      WHERE ${BKK_DAY} BETWEEN $1::date AND $2::date
      ORDER BY s.sold_at DESC LIMIT 2000`,
    [from, to],
  )
  const bills = rows.map((r) => {
    const voided = str(r, 'status') === 'voided'
    const revenue = num(r, 'total')
    const cogs = round2(num(r, 'cost_total'))
    const profit = round2(revenue - cogs)
    return {
      id: str(r, 'id'),
      billNo: str(r, 'bill_no'),
      soldAt: str(r, 'sold_at'),
      status: str(r, 'status'),
      paymentMethod: str(r, 'payment_method'),
      customerName: strOrNull(r, 'customer_name'),
      locationName: str(r, 'location_name'),
      items: num(r, 'items'),
      discounts: num(r, 'discounts'),
      revenue,
      cogs,
      profit,
      marginPct: margin(revenue, profit),
      voided,
    }
  })
  const active = bills.filter((b) => !b.voided)
  const revenue = round2(active.reduce((s, b) => s + b.revenue, 0))
  const cogs = round2(active.reduce((s, b) => s + b.cogs, 0))
  return c.json({
    from,
    to,
    bills,
    totals: { bills: active.length, voided: bills.length - active.length, revenue, cogs, profit: round2(revenue - cogs), marginPct: margin(revenue, revenue - cogs) },
  })
})

/**
 * Event stream for integrations (AI Vision, analytics). Cursor = recorded_at of the last event seen.
 */
reportRoutes.get('/events', async (c) => {
  const ctx = c.get('ctx')
  const since = c.req.query('since') ?? ''
  if (since) z.string().datetime({ offset: true }).parse(since)
  const type = c.req.query('type') ?? ''
  const zoneId = c.req.query('zoneId') ?? ''
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500)
  const rows = await query(
    ctx,
    `SELECT event_id, event_type, terminal_id, zone_id, occurred_at, recorded_at, actor_user_id, source,
            ref_type, ref_id, schema_version, payload::text AS payload_text
       FROM pos_events
      WHERE ($1 = '' OR recorded_at > NULLIF($1, '')::timestamptz)
        AND ($2 = '' OR event_type = $2)
        AND ($3 = '' OR zone_id = $3)
      ORDER BY recorded_at ${since ? 'ASC' : 'DESC'}
      LIMIT $4::int`,
    [since, type, zoneId, limit],
  )
  return c.json(
    rows.map((r) => ({
      eventId: str(r, 'event_id'),
      eventType: str(r, 'event_type'),
      terminalId: str(r, 'terminal_id'),
      zoneId: str(r, 'zone_id'),
      occurredAt: str(r, 'occurred_at'),
      recordedAt: str(r, 'recorded_at'),
      actorUserId: strOrNull(r, 'actor_user_id'),
      source: str(r, 'source'),
      refType: strOrNull(r, 'ref_type'),
      refId: strOrNull(r, 'ref_id'),
      schemaVersion: num(r, 'schema_version'),
      payload: JSON.parse(str(r, 'payload_text') || '{}') as unknown,
    })),
  )
})
