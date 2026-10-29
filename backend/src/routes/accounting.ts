import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { query, transaction } from '../db.js'
import { num, str, strOrNull, uuid } from '../util.js'
import { SALE_SELECT, mapSaleHeader } from './sales.js'

export const accountingRoutes = new Hono<AppEnv>()

const BKK_DAY = `(s.sold_at AT TIME ZONE 'Asia/Bangkok')::date`

/** Bills marked for the accounting office in a date range (by sale date). */
accountingRoutes.get('/accounting/invoices', async (c) => {
  const ctx = c.get('ctx')
  const from = z.string().date().parse(c.req.query('from'))
  const to = z.string().date().parse(c.req.query('to'))
  const status = z.enum(['pending', 'sent', 'all']).catch('all').parse(c.req.query('status'))
  const rows = await query(
    ctx,
    `${SALE_SELECT}
      WHERE s.for_accounting AND s.tax_invoice_no IS NOT NULL
        AND ${BKK_DAY} BETWEEN $1::date AND $2::date
        AND ($3 = 'all' OR ($3 = 'pending' AND s.accounting_sent_at IS NULL) OR ($3 = 'sent' AND s.accounting_sent_at IS NOT NULL))
      ORDER BY s.tax_invoice_no`,
    [from, to, status],
  )
  return c.json(rows.map(mapSaleHeader))
})

/** Full documents (header + lines) for printing several invoices at once. */
accountingRoutes.get('/accounting/documents', async (c) => {
  const ctx = c.get('ctx')
  const ids = z
    .array(uuid)
    .min(1)
    .max(200)
    .parse((c.req.query('ids') ?? '').split(',').filter(Boolean))
  const idsJson = JSON.stringify(ids)
  const [headers, lines] = await Promise.all([
    query(ctx, `${SALE_SELECT} WHERE s.id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid) ORDER BY s.tax_invoice_no, s.bill_no`, [idsJson]),
    query(
      ctx,
      `SELECT * FROM sale_lines WHERE sale_id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid) ORDER BY sale_id, line_no`,
      [idsJson],
    ),
  ])
  return c.json(
    headers.map((h) => {
      const id = str(h, 'id')
      return {
        ...mapSaleHeader(h),
        lots: [],
        lines: lines
          .filter((r) => str(r, 'sale_id') === id)
          .map((r) => ({
            lineNo: num(r, 'line_no'),
            productId: str(r, 'product_id'),
            productName: str(r, 'product_name'),
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
      }
    }),
  )
})

const markSchema = z.object({ saleIds: z.array(uuid).min(1).max(500), sent: z.boolean() })

/** Record that these invoices were handed to (or taken back from) the accounting office. */
accountingRoutes.post('/accounting/mark-sent', async (c) => {
  const ctx = c.get('ctx')
  const b = markSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE sales SET accounting_sent_at = CASE WHEN $2::boolean THEN now() ELSE NULL END
             WHERE for_accounting AND id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)
         RETURNING id`,
      params: [JSON.stringify(b.saleIds), b.sent],
    },
  ])
  return c.json({ updated: rows?.length ?? 0 })
})
