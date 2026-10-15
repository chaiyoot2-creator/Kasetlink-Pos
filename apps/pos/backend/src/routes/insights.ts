import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { HttpError } from '../errors.js'
import { query } from '../gate.js'
import { bool, num, round2, str, strOrNull, uuid } from '../util.js'

/** Customer purchase analytics (completed bills only, revenue net of discounts). */
export const insightRoutes = new Hono<AppEnv>()

const BKK_DAY = `(s.sold_at AT TIME ZONE 'Asia/Bangkok')::date`

function range(from: string | undefined, to: string | undefined) {
  const f = z.string().date().parse(from)
  const t = z.string().date().parse(to)
  if (f > t) throw new HttpError(400, 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด')
  return [f, t] as const
}

function margin(revenue: number, profit: number): number {
  return revenue > 0 ? round2((profit / revenue) * 100) : 0
}

/** Every customer's buying in the range, plus walk-in (no customer) totals. */
insightRoutes.get('/insights/customers', async (c) => {
  const ctx = c.get('ctx')
  const [from, to] = range(c.req.query('from'), c.req.query('to'))
  const [rows, walkIn] = await Promise.all([
    query(
      ctx,
      `SELECT cu.id, cu.code, cu.name, cu.phone, cu.price_level, cu.balance, cu.is_active,
              COUNT(s.id) AS bills,
              COALESCE(SUM(s.total), 0) AS revenue,
              COALESCE(SUM(s.cost_total), 0) AS cogs,
              COALESCE(SUM(s.total) FILTER (WHERE s.payment_method = 'credit'), 0) AS credit_sales,
              MAX(s.sold_at) AS last_purchase,
              (SELECT MAX(s3.sold_at) FROM sales s3 WHERE s3.customer_id = cu.id AND s3.status = 'completed') AS last_purchase_ever,
              (SELECT COALESCE(SUM(sl.qty), 0) FROM sale_lines sl JOIN sales s2 ON s2.id = sl.sale_id
                WHERE s2.customer_id = cu.id AND s2.status = 'completed'
                  AND (s2.sold_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date) AS qty
         FROM customers cu
         LEFT JOIN sales s ON s.customer_id = cu.id AND s.status = 'completed' AND ${BKK_DAY} BETWEEN $1::date AND $2::date
        GROUP BY cu.id
        ORDER BY COALESCE(SUM(s.total), 0) DESC, cu.name`,
      [from, to],
    ),
    query(
      ctx,
      `SELECT COUNT(*) AS bills, COALESCE(SUM(s.total), 0) AS revenue, COALESCE(SUM(s.cost_total), 0) AS cogs
         FROM sales s
        WHERE s.customer_id IS NULL AND s.status = 'completed' AND ${BKK_DAY} BETWEEN $1::date AND $2::date`,
      [from, to],
    ),
  ])
  const customers = rows.map((r) => {
    const revenue = num(r, 'revenue')
    const profit = round2(revenue - num(r, 'cogs'))
    const bills = num(r, 'bills')
    return {
      customerId: str(r, 'id'),
      code: str(r, 'code'),
      name: str(r, 'name'),
      phone: strOrNull(r, 'phone'),
      priceLevel: num(r, 'price_level') || 1,
      balance: num(r, 'balance'),
      isActive: bool(r, 'is_active'),
      bills,
      qty: num(r, 'qty'),
      revenue,
      profit,
      marginPct: margin(revenue, profit),
      avgBill: bills > 0 ? round2(revenue / bills) : 0,
      creditSales: num(r, 'credit_sales'),
      lastPurchase: strOrNull(r, 'last_purchase'),
      lastPurchaseEver: strOrNull(r, 'last_purchase_ever'),
    }
  })
  const w = walkIn[0] ?? {}
  const wRevenue = num(w, 'revenue')
  return c.json({
    from,
    to,
    customers,
    walkIn: { bills: num(w, 'bills'), revenue: wRevenue, profit: round2(wRevenue - num(w, 'cogs')) },
  })
})

/** One customer: summary, products bought, categories/brands, monthly trend and bills. */
insightRoutes.get('/insights/customers/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [from, to] = range(c.req.query('from'), c.req.query('to'))
  const inRange = `s.customer_id = $1::uuid AND s.status = 'completed' AND ${BKK_DAY} BETWEEN $2::date AND $3::date`
  const params = [id, from, to]
  const [customer, products, groups, monthly, bills, firstEver] = await Promise.all([
    query(ctx, 'SELECT id, code, name, phone, price_level, balance, credit_limit, credit_term_days FROM customers WHERE id = $1::uuid', [id]),
    query(
      ctx,
      `SELECT sl.product_id, MAX(sl.product_name) AS product_name, MAX(sl.unit) AS unit, p.sku, p.category, b.name AS brand_name,
              SUM(sl.qty) AS qty, SUM(sl.net_amount) AS revenue, SUM(sl.cost_total) AS cogs,
              COUNT(DISTINCT s.id) AS bills, MAX(s.sold_at) AS last_bought,
              ROUND(SUM(sl.net_amount) / NULLIF(SUM(sl.qty), 0), 2) AS avg_price
         FROM sale_lines sl
         JOIN sales s ON s.id = sl.sale_id
         JOIN products p ON p.id = sl.product_id
         LEFT JOIN brands b ON b.id = p.brand_id
        WHERE ${inRange}
        GROUP BY sl.product_id, p.sku, p.category, b.name
        ORDER BY SUM(sl.net_amount) DESC`,
      params,
    ),
    query(
      ctx,
      `SELECT COALESCE(p.category, 'ไม่ระบุหมวด') AS category, COALESCE(b.name, 'ไม่ระบุแบรนด์') AS brand_name,
              SUM(sl.qty) AS qty, SUM(sl.net_amount) AS revenue
         FROM sale_lines sl
         JOIN sales s ON s.id = sl.sale_id
         JOIN products p ON p.id = sl.product_id
         LEFT JOIN brands b ON b.id = p.brand_id
        WHERE ${inRange}
        GROUP BY 1, 2`,
      params,
    ),
    query(
      ctx,
      `SELECT to_char(s.sold_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') AS month,
              COUNT(*) AS bills, SUM(s.total) AS revenue, SUM(s.cost_total) AS cogs
         FROM sales s
        WHERE ${inRange}
        GROUP BY 1 ORDER BY 1`,
      params,
    ),
    query(
      ctx,
      `SELECT s.id, s.bill_no, s.tax_invoice_no, s.sold_at, s.total, s.cost_total, s.payment_method, s.price_level,
              (SELECT COUNT(*) FROM sale_lines sl WHERE sl.sale_id = s.id) AS items
         FROM sales s
        WHERE ${inRange}
        ORDER BY s.sold_at DESC LIMIT 500`,
      params,
    ),
    query(ctx, `SELECT MIN(sold_at) AS first_ever FROM sales WHERE customer_id = $1::uuid AND status = 'completed'`, [id]),
  ])
  const cu = customer[0]
  if (!cu) throw new HttpError(404, 'ไม่พบลูกค้า')

  const productRows = products.map((r) => {
    const revenue = num(r, 'revenue')
    const profit = round2(revenue - num(r, 'cogs'))
    return {
      productId: str(r, 'product_id'),
      productName: str(r, 'product_name'),
      sku: str(r, 'sku'),
      unit: str(r, 'unit'),
      category: strOrNull(r, 'category'),
      brandName: strOrNull(r, 'brand_name'),
      qty: num(r, 'qty'),
      revenue,
      profit,
      marginPct: margin(revenue, profit),
      bills: num(r, 'bills'),
      avgPrice: num(r, 'avg_price'),
      lastBought: str(r, 'last_bought'),
    }
  })

  // Roll the category × brand rows up both ways.
  const byCategory = new Map<string, { qty: number; revenue: number }>()
  const byBrand = new Map<string, { qty: number; revenue: number }>()
  for (const r of groups) {
    for (const [map, key] of [
      [byCategory, str(r, 'category')],
      [byBrand, str(r, 'brand_name')],
    ] as const) {
      const cur = map.get(key) ?? { qty: 0, revenue: 0 }
      cur.qty = round2(cur.qty + num(r, 'qty'))
      cur.revenue = round2(cur.revenue + num(r, 'revenue'))
      map.set(key, cur)
    }
  }
  const toList = (m: Map<string, { qty: number; revenue: number }>) =>
    [...m].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue)

  const revenue = round2(bills.reduce((s, r) => s + num(r, 'total'), 0))
  const cogs = round2(bills.reduce((s, r) => s + num(r, 'cost_total'), 0))
  const profit = round2(revenue - cogs)

  return c.json({
    from,
    to,
    customer: {
      id: str(cu, 'id'),
      code: str(cu, 'code'),
      name: str(cu, 'name'),
      phone: strOrNull(cu, 'phone'),
      priceLevel: num(cu, 'price_level') || 1,
      balance: num(cu, 'balance'),
      creditLimit: num(cu, 'credit_limit'),
      creditTermDays: num(cu, 'credit_term_days'),
      firstPurchaseEver: strOrNull(firstEver[0] ?? {}, 'first_ever'),
    },
    summary: {
      bills: bills.length,
      revenue,
      profit,
      marginPct: margin(revenue, profit),
      avgBill: bills.length > 0 ? round2(revenue / bills.length) : 0,
      qty: round2(productRows.reduce((s, p) => s + p.qty, 0)),
      productCount: productRows.length,
      lastPurchase: bills[0] ? str(bills[0], 'sold_at') : null,
    },
    products: productRows,
    categories: toList(byCategory),
    brands: toList(byBrand),
    monthly: monthly.map((r) => {
      const rev = num(r, 'revenue')
      return { month: str(r, 'month'), bills: num(r, 'bills'), revenue: rev, profit: round2(rev - num(r, 'cogs')) }
    }),
    bills: bills.map((r) => ({
      id: str(r, 'id'),
      billNo: str(r, 'bill_no'),
      taxInvoiceNo: strOrNull(r, 'tax_invoice_no'),
      soldAt: str(r, 'sold_at'),
      total: num(r, 'total'),
      profit: round2(num(r, 'total') - num(r, 'cost_total')),
      paymentMethod: str(r, 'payment_method'),
      items: num(r, 'items'),
    })),
  })
})
