import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Empty, ErrorBox, Loading, PageHeader, Stat, TableWrap } from '@/components/common'
import { PAYMENT_LABEL, addDaysISO, baht, dateOnly, dateTime, pct, qty, todayISO } from '@/lib/format'
import type { BillReport, DailyReport, ProductReport } from '@/lib/types'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

const PRESETS: { label: string; days: number }[] = [
  { label: 'วันนี้', days: 0 },
  { label: '7 วัน', days: 6 },
  { label: '30 วัน', days: 29 },
]

function ProfitCell({ value, className }: { value: number; className?: string }) {
  return <TableCell className={cn('tabular text-right font-medium', value < 0 ? 'text-destructive' : 'text-primary', className)}>{baht(value)}</TableCell>
}

export function ReportsPage() {
  const [to, setTo] = useState(todayISO())
  const [from, setFrom] = useState(addDaysISO(todayISO(), -6))
  const [tab, setTab] = useState('daily')
  const range = `from=${from}&to=${to}`
  const daily = useApi<DailyReport>(tab === 'daily' ? `/reports/daily?${range}` : null)
  const products = useApi<ProductReport>(tab === 'products' ? `/reports/products?${range}` : null)
  const bills = useApi<BillReport>(tab === 'bills' ? `/reports/bills?${range}` : null)

  return (
    <div>
      <PageHeader title="กำไรขาดทุน" subtitle="ต้นทุนขาย = ต้นทุนถัวเฉลี่ย ณ เวลาที่ขาย · ยอดขายหลังหักส่วนลด · ไม่รวมบิลที่ยกเลิก" />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          ตั้งแต่
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </label>
        <label className="grid gap-1 text-sm">
          ถึง
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </label>
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => {
              const t = todayISO()
              setTo(t)
              setFrom(addDaysISO(t, -p.days))
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="daily" className="cursor-pointer">รายวัน</TabsTrigger>
          <TabsTrigger value="products" className="cursor-pointer">รายสินค้า</TabsTrigger>
          <TabsTrigger value="bills" className="cursor-pointer">รายบิล</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-3 grid gap-3">
          {daily.error ? <ErrorBox message={daily.error} onRetry={() => void daily.reload()} /> : null}
          {daily.loading && !daily.data ? <Loading /> : null}
          {daily.data ? (
            <>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <Stat label="ยอดขายสุทธิ" value={baht(daily.data.totals.revenue)} sub={`${daily.data.totals.bills} บิล · ส่วนลด ${baht(daily.data.totals.discounts)}`} />
                <Stat label="ต้นทุนขาย" value={baht(daily.data.totals.cogs)} />
                <Stat label="กำไรขั้นต้น" value={baht(daily.data.totals.profit)} tone={daily.data.totals.profit < 0 ? 'bad' : 'good'} />
                <Stat label="อัตรากำไร" value={pct(daily.data.totals.marginPct)} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="เงินสด" value={baht(daily.data.totals.cash)} />
                <Stat label="พร้อมเพย์" value={baht(daily.data.totals.promptpay)} />
                <Stat label="เงินเชื่อ" value={baht(daily.data.totals.credit)} />
              </div>
              {daily.data.days.length === 0 ? (
                <Empty title="ไม่มียอดขายในช่วงนี้" />
              ) : (
                <TableWrap>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>วันที่</TableHead>
                        <TableHead className="text-right">บิล</TableHead>
                        <TableHead className="text-right">ยอดขาย</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">ต้นทุน</TableHead>
                        <TableHead className="text-right">กำไร</TableHead>
                        <TableHead className="hidden text-right md:table-cell">%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {daily.data.days.map((d) => (
                        <TableRow key={d.day}>
                          <TableCell>{dateOnly(d.day)}</TableCell>
                          <TableCell className="tabular text-right">{d.bills}</TableCell>
                          <TableCell className="tabular text-right">{baht(d.revenue)}</TableCell>
                          <TableCell className="tabular hidden text-right sm:table-cell">{baht(d.cogs)}</TableCell>
                          <ProfitCell value={d.profit} />
                          <TableCell className="tabular hidden text-right md:table-cell">{pct(d.marginPct)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrap>
              )}
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="products" className="mt-3">
          {products.error ? <ErrorBox message={products.error} onRetry={() => void products.reload()} /> : null}
          {products.loading && !products.data ? <Loading /> : null}
          {products.data?.items.length === 0 ? <Empty title="ไม่มียอดขายในช่วงนี้" /> : null}
          {products.data && products.data.items.length > 0 ? (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>สินค้า</TableHead>
                    <TableHead className="text-right">จำนวน</TableHead>
                    <TableHead className="text-right">ยอดขาย</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">ต้นทุน</TableHead>
                    <TableHead className="text-right">กำไร</TableHead>
                    <TableHead className="hidden text-right md:table-cell">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.data.items.map((p) => (
                    <TableRow key={p.productId}>
                      <TableCell>
                        {p.productName}
                        <p className="text-xs text-muted-foreground">
                          {p.sku} · {p.bills} บิล
                        </p>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {qty(p.qty)} <span className="text-xs text-muted-foreground">{p.unit}</span>
                      </TableCell>
                      <TableCell className="tabular text-right">{baht(p.revenue)}</TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">{baht(p.cogs)}</TableCell>
                      <ProfitCell value={p.profit} />
                      <TableCell className="tabular hidden text-right md:table-cell">{pct(p.marginPct)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          ) : null}
        </TabsContent>

        <TabsContent value="bills" className="mt-3">
          {bills.error ? <ErrorBox message={bills.error} onRetry={() => void bills.reload()} /> : null}
          {bills.loading && !bills.data ? <Loading /> : null}
          {bills.data?.bills.length === 0 ? <Empty title="ไม่มีบิลในช่วงนี้" /> : null}
          {bills.data && bills.data.bills.length > 0 ? (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>บิล</TableHead>
                    <TableHead className="hidden md:table-cell">ชำระ</TableHead>
                    <TableHead className="text-right">ยอดขาย</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">ต้นทุน</TableHead>
                    <TableHead className="text-right">กำไร</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.data.bills.map((b) => (
                    <TableRow key={b.id} className={cn(b.voided && 'opacity-50')}>
                      <TableCell>
                        <span className={cn('font-medium', b.voided && 'line-through')}>{b.billNo}</span>
                        <p className="text-xs text-muted-foreground">
                          {dateTime(b.soldAt)}
                          {b.customerName ? ` · ${b.customerName}` : ''}
                          {b.voided ? ' · ยกเลิก' : ''}
                        </p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{PAYMENT_LABEL[b.paymentMethod]}</TableCell>
                      <TableCell className="tabular text-right">{baht(b.revenue)}</TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">{baht(b.cogs)}</TableCell>
                      {b.voided ? <TableCell className="text-right">-</TableCell> : <ProfitCell value={b.profit} />}
                      <TableCell className="tabular hidden text-right lg:table-cell">{b.voided ? '-' : pct(b.marginPct)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>
                      รวม {bills.data.totals.bills} บิล{bills.data.totals.voided ? ` (ยกเลิก ${bills.data.totals.voided})` : ''}
                    </TableCell>
                    <TableCell className="hidden md:table-cell" />
                    <TableCell className="tabular text-right">{baht(bills.data.totals.revenue)}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{baht(bills.data.totals.cogs)}</TableCell>
                    <ProfitCell value={bills.data.totals.profit} />
                    <TableCell className="tabular hidden text-right lg:table-cell">{pct(bills.data.totals.marginPct)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </TableWrap>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}
