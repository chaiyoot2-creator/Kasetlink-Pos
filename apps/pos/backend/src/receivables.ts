import { query, type RequestCtx } from './gate.js'
import { num, round2, str, strOrNull } from './util.js'

export interface OpenBill {
  saleId: string
  customerId: string
  customerName: string
  customerCode: string
  customerPhone: string | null
  billNo: string
  taxInvoiceNo: string | null
  soldAt: string
  dueDate: string
  total: number
  paid: number
  outstanding: number
  /** > 0 overdue by N days, 0 due today, < 0 due in N days. */
  daysOverdue: number
}

function todayBangkok(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Unpaid credit bills. A bill is settled by its explicit payment allocations; payments
 * recorded before allocations existed (or never allocated) settle the oldest bills
 * first. The outstanding amounts therefore always add up to the customer balance.
 */
export async function loadOpenBills(ctx: RequestCtx, customerId?: string): Promise<OpenBill[]> {
  const filter = customerId ?? ''
  const [bills, pools] = await Promise.all([
    query(
      ctx,
      `SELECT s.id, s.customer_id, cu.name AS customer_name, cu.code AS customer_code, cu.phone AS customer_phone,
              s.bill_no, s.tax_invoice_no, s.sold_at, s.total,
              COALESCE(s.due_date, (s.sold_at AT TIME ZONE 'Asia/Bangkok')::date + cu.credit_term_days)::text AS due_text,
              COALESCE((SELECT SUM(a.amount) FROM ar_allocations a WHERE a.sale_id = s.id), 0) AS allocated
         FROM sales s JOIN customers cu ON cu.id = s.customer_id
        WHERE s.payment_method = 'credit' AND s.status = 'completed'
          AND ($1 = '' OR s.customer_id = NULLIF($1, '')::uuid)
        ORDER BY s.customer_id, s.sold_at, s.bill_no`,
      [filter],
    ),
    query(
      ctx,
      `SELECT e.customer_id,
              -SUM(e.amount) AS paid,
              COALESCE((SELECT SUM(a.amount) FROM ar_allocations a JOIN ar_entries p ON p.id = a.payment_id
                         WHERE p.customer_id = e.customer_id), 0) AS allocated
         FROM ar_entries e
        WHERE e.entry_type = 'payment' AND ($1 = '' OR e.customer_id = NULLIF($1, '')::uuid)
        GROUP BY e.customer_id`,
      [filter],
    ),
  ])

  // Unallocated payment money per customer (legacy payments) — applied FIFO below.
  const pool = new Map<string, number>()
  for (const r of pools) pool.set(str(r, 'customer_id'), round2(num(r, 'paid') - num(r, 'allocated')))

  const today = Date.parse(todayBangkok())
  const open: OpenBill[] = []
  for (const r of bills) {
    const cid = str(r, 'customer_id')
    const total = num(r, 'total')
    const allocated = num(r, 'allocated')
    const free = Math.max(pool.get(cid) ?? 0, 0)
    const legacy = round2(Math.min(Math.max(total - allocated, 0), free))
    pool.set(cid, round2(free - legacy))
    const paid = round2(allocated + legacy)
    const outstanding = round2(total - paid)
    if (outstanding <= 0) continue
    const dueDate = str(r, 'due_text').slice(0, 10)
    open.push({
      saleId: str(r, 'id'),
      customerId: cid,
      customerName: str(r, 'customer_name'),
      customerCode: str(r, 'customer_code'),
      customerPhone: strOrNull(r, 'customer_phone'),
      billNo: str(r, 'bill_no'),
      taxInvoiceNo: strOrNull(r, 'tax_invoice_no'),
      soldAt: str(r, 'sold_at'),
      dueDate,
      total,
      paid,
      outstanding,
      daysOverdue: Math.round((today - Date.parse(dueDate)) / 86_400_000),
    })
  }
  return open
}

export function summarize(bills: OpenBill[]) {
  const sum = (list: OpenBill[]) => round2(list.reduce((s, b) => s + b.outstanding, 0))
  const overdue = bills.filter((b) => b.daysOverdue > 0)
  const dueSoon = bills.filter((b) => b.daysOverdue <= 0 && b.daysOverdue >= -7)
  return {
    outstanding: sum(bills),
    overdue: sum(overdue),
    overdueCount: overdue.length,
    dueSoon: sum(dueSoon),
    dueSoonCount: dueSoon.length,
  }
}

/**
 * Split a payment over bills: the chosen bills (in the order given, each capped at its
 * outstanding), or the oldest bills first when none are chosen.
 */
export function allocate(
  bills: OpenBill[],
  amount: number,
  chosen: { saleId: string; amount?: number | null }[] | null,
): { saleId: string; amount: number }[] {
  const byId = new Map(bills.map((b) => [b.saleId, b]))
  const order = chosen && chosen.length > 0 ? chosen : bills.map((b) => ({ saleId: b.saleId, amount: null }))
  let left = round2(amount)
  const out: { saleId: string; amount: number }[] = []
  for (const c of order) {
    if (left <= 0) break
    const bill = byId.get(c.saleId)
    if (!bill) continue
    const cap = c.amount ? Math.min(c.amount, bill.outstanding) : bill.outstanding
    const take = round2(Math.min(cap, left))
    if (take <= 0) continue
    out.push({ saleId: bill.saleId, amount: take })
    left = round2(left - take)
  }
  return out
}
