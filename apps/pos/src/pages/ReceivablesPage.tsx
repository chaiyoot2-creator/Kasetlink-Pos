import { useEffect, useMemo, useState } from 'react'
import { HandCoins } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, ErrorBox, Loading, PageHeader, Stat } from '@/components/common'
import { ReceivePaymentDialog } from '@/components/ReceivePaymentDialog'
import { baht, dateOnly, round2 } from '@/lib/format'
import type { OpenBill, ReceivablesSummary } from '@/lib/types'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'overdue' | 'due7'

export function DueBadge({ days }: { days: number }) {
  if (days > 0) return <Badge variant="destructive">เกินกำหนด {days} วัน</Badge>
  if (days === 0) return <Badge className="bg-amber-500 text-white hover:bg-amber-500">ครบกำหนดวันนี้</Badge>
  if (days >= -7) return <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">อีก {-days} วัน</Badge>
  return <span className="text-xs text-muted-foreground">อีก {-days} วัน</span>
}

export function ReceivablesPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const { data, error, loading, reload } = useApi<{ bills: OpenBill[]; summary: ReceivablesSummary }>(`/receivables?filter=${filter}`)
  const [selected, setSelected] = useState<string[]>([])
  const [paying, setPaying] = useState<{ customer: { id: string; name: string; balance: number }; bills: OpenBill[] } | null>(null)

  useEffect(() => setSelected([]), [data])

  // Group bills by customer, most overdue customer first.
  const groups = useMemo(() => {
    const map = new Map<string, OpenBill[]>()
    for (const b of data?.bills ?? []) map.set(b.customerId, [...(map.get(b.customerId) ?? []), b])
    return [...map.values()]
  }, [data])

  const selectedBills = (data?.bills ?? []).filter((b) => selected.includes(b.saleId))
  const selectedCustomer = selectedBills[0]?.customerId ?? null

  const toggle = (b: OpenBill) =>
    setSelected((prev) => (prev.includes(b.saleId) ? prev.filter((x) => x !== b.saleId) : [...prev, b.saleId]))

  const pay = (bills: OpenBill[]) => {
    const first = bills[0]
    if (!first) return
    // Settle in due-date order; oldest due first.
    const ordered = [...bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    setPaying({ customer: { id: first.customerId, name: first.customerName, balance: round2(bills.reduce((s, x) => s + x.outstanding, 0)) }, bills: ordered })
  }

  const s = data?.summary

  return (
    <div className="pb-20">
      <PageHeader title="ลูกหนี้" subtitle="บิลเงินเชื่อที่ยังไม่ได้รับชำระ — ติ๊กเลือกบิลที่ลูกค้าจ่าย แล้วออกใบเสร็จรับเงิน" />
      {s ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="ค้างชำระทั้งหมด" value={baht(s.outstanding)} />
          <Stat label="เกินกำหนด" value={baht(s.overdue)} sub={`${s.overdueCount} บิล`} tone={s.overdueCount ? 'bad' : undefined} />
          <Stat label="ครบกำหนดใน 7 วัน" value={baht(s.dueSoon)} sub={`${s.dueSoonCount} บิล`} tone={s.dueSoonCount ? 'warn' : undefined} />
          <Stat label="ลูกค้าที่ค้าง" value={new Set((data?.bills ?? []).map((b) => b.customerId)).size} />
        </div>
      ) : null}

      <div className="mb-3 grid w-full max-w-md grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ['all', 'ทั้งหมด'],
            ['overdue', 'เกินกำหนด'],
            ['due7', 'ครบใน 7 วัน'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={cn('cursor-pointer rounded-md py-1.5 text-sm', filter === k ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground')}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && groups.length === 0 ? <Empty title="ไม่มีบิลค้างชำระ" hint={filter === 'all' ? 'บิลเงินเชื่อทั้งหมดได้รับชำระแล้ว' : 'ไม่มีบิลในเงื่อนไขนี้'} /> : null}

      <div className="grid gap-3">
        {groups.map((bills) => {
          const first = bills[0]
          if (!first) return null
          const total = round2(bills.reduce((x, b) => x + b.outstanding, 0))
          const disabled = selectedCustomer !== null && selectedCustomer !== first.customerId
          return (
            <section key={first.customerId} className={cn('rounded-lg border bg-card', disabled && 'opacity-50')}>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                <div>
                  <p className="font-semibold">{first.customerName}</p>
                  <p className="text-xs text-muted-foreground">
                    {first.customerCode}
                    {first.customerPhone ? ` · โทร ${first.customerPhone}` : ''} · ค้าง {bills.length} บิล
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular font-semibold">{baht(total)}</span>
                  <Button variant="outline" size="sm" className="cursor-pointer" disabled={disabled} onClick={() => pay(bills)}>
                    รับชำระทั้งหมด
                  </Button>
                </div>
              </header>
              <ul className="divide-y">
                {bills.map((b) => (
                  <li key={b.saleId}>
                    <label className={cn('flex items-center gap-3 px-3 py-2', disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-muted/50')}>
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        disabled={disabled}
                        checked={selected.includes(b.saleId)}
                        onChange={() => toggle(b)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{b.taxInvoiceNo ?? b.billNo}</span>
                        <span className="block text-xs text-muted-foreground">
                          ขาย {dateOnly(b.soldAt)} · ครบกำหนด {dateOnly(b.dueDate)}
                          {b.paid > 0 ? ` · ชำระแล้ว ${baht(b.paid)} จาก ${baht(b.total)}` : ''}
                        </span>
                      </span>
                      <DueBadge days={b.daysOverdue} />
                      <span className="tabular w-24 text-right font-semibold">{baht(b.outstanding)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {selectedBills.length > 0 ? (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-card/95 p-3 backdrop-blur md:bottom-0 md:left-20 lg:left-56">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-sm">
              เลือก {selectedBills.length} บิล · <span className="tabular font-semibold">{baht(selectedBills.reduce((x, b) => x + b.outstanding, 0))}</span>
            </p>
            <Button className="cursor-pointer" onClick={() => pay(selectedBills)}>
              <HandCoins /> รับชำระบิลที่เลือก
            </Button>
          </div>
        </div>
      ) : null}

      <ReceivePaymentDialog
        open={paying !== null}
        customer={paying?.customer ?? null}
        bills={paying?.bills ?? NO_BILLS}
        onClose={() => setPaying(null)}
        onDone={() => void reload()}
      />
    </div>
  )
}

const NO_BILLS: OpenBill[] = []
