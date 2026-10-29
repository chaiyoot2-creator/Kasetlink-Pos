import { useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Empty, ErrorBox, Loading, PageHeader, Stat, TableWrap } from '@/components/common'
import { useApp } from '@/lib/app-context'
import { PAYMENT_LABEL, addDaysISO, baht, dateOnly, pct, qty, todayISO } from '@/lib/format'
import { levelName } from '@/lib/pricing'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { SaleDialog } from './SalesPage'

interface CustomerRow {
  customerId: string
  code: string
  name: string
  phone: string | null
  priceLevel: number
  balance: number
  isActive: boolean
  bills: number
  qty: number
  revenue: number
  profit: number
  marginPct: number
  avgBill: number
  creditSales: number
  lastPurchase: string | null
  lastPurchaseEver: string | null
}

interface CustomerList {
  from: string
  to: string
  customers: CustomerRow[]
  walkIn: { bills: number; revenue: number; profit: number }
}

interface CustomerDetail {
  from: string
  to: string
  customer: {
    id: string
    code: string
    name: string
    phone: string | null
    priceLevel: number
    balance: number
    creditLimit: number
    creditTermDays: number
    firstPurchaseEver: string | null
  }
  summary: { bills: number; revenue: number; profit: number; marginPct: number; avgBill: number; qty: number; productCount: number; lastPurchase: string | null }
  products: {
    productId: string
    productName: string
    sku: string
    unit: string
    category: string | null
    brandName: string | null
    qty: number
    revenue: number
    profit: number
    marginPct: number
    bills: number
    avgPrice: number
    lastBought: string
  }[]
  categories: { name: string; qty: number; revenue: number }[]
  brands: { name: string; qty: number; revenue: number }[]
  monthly: { month: string; bills: number; revenue: number; profit: number }[]
  bills: { id: string; billNo: string; taxInvoiceNo: string | null; soldAt: string; total: number; profit: number; paymentMethod: string; items: number }[]
}

type Preset = '30' | '90' | 'year' | 'all'
type SortKey = 'revenue' | 'bills' | 'profit' | 'recent'

function presetRange(p: Preset): { from: string; to: string } {
  const to = todayISO()
  if (p === '30') return { from: addDaysISO(to, -29), to }
  if (p === '90') return { from: addDaysISO(to, -89), to }
  if (p === 'year') return { from: `${to.slice(0, 4)}-01-01`, to }
  return { from: '2000-01-01', to }
}

const PRESET_LABEL: Record<Preset, string> = { '30': '30 วัน', '90': '90 วัน', year: 'ปีนี้', all: 'ทั้งหมด' }

function csvCell(v: string | number): string {
  const text = String(v)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function CustomersPage() {
  const { data: app } = useApp()
  const [preset, setPreset] = useState<Preset>('90')
  const { from, to } = presetRange(preset)
  const { data, error, loading, reload } = useApi<CustomerList>(`/insights/customers?from=${from}&to=${to}`)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('revenue')
  const [onlyBuyers, setOnlyBuyers] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = (data?.customers ?? []).filter(
      (c) =>
        (!onlyBuyers || c.bills > 0) &&
        (!term || c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term) || (c.phone ?? '').includes(term)),
    )
    const key: Record<SortKey, (c: CustomerRow) => number> = {
      revenue: (c) => c.revenue,
      bills: (c) => c.bills,
      profit: (c) => c.profit,
      recent: (c) => (c.lastPurchaseEver ? Date.parse(c.lastPurchaseEver) : 0),
    }
    return [...list].sort((a, b) => key[sort](b) - key[sort](a))
  }, [data, q, sort, onlyBuyers])

  const named = data?.customers.filter((c) => c.bills > 0) ?? []
  const namedRevenue = named.reduce((s, c) => s + c.revenue, 0)
  const totalRevenue = namedRevenue + (data?.walkIn.revenue ?? 0)

  const exportList = () =>
    downloadCsv(
      `ลูกค้า_${from}_${to}.csv`,
      ['รหัส', 'ชื่อลูกค้า', 'โทร', 'ระดับราคา', 'จำนวนบิล', 'จำนวนชิ้น', 'ยอดซื้อ', 'กำไร', 'อัตรากำไร %', 'เฉลี่ยต่อบิล', 'ซื้อเชื่อ', 'ยอดค้างชำระ', 'ซื้อล่าสุด'],
      rows.map((c) => [
        c.code,
        c.name,
        c.phone ?? '',
        levelName(app.settings.priceLevelNames, c.priceLevel),
        c.bills,
        c.qty,
        c.revenue.toFixed(2),
        c.profit.toFixed(2),
        c.marginPct,
        c.avgBill.toFixed(2),
        c.creditSales.toFixed(2),
        c.balance.toFixed(2),
        c.lastPurchaseEver ? c.lastPurchaseEver.slice(0, 10) : '',
      ]),
    )

  return (
    <div>
      <PageHeader
        title="ลูกค้า"
        subtitle="ประวัติการซื้อ ยอดเงิน และสินค้าที่ลูกค้าแต่ละรายซื้อ — ยอดหลังหักส่วนลด ไม่รวมบิลยกเลิก"
        actions={
          <Button variant="outline" className="cursor-pointer" disabled={rows.length === 0} onClick={exportList}>
            <Download /> ส่งออก Excel
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
          {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={cn('cursor-pointer rounded-md px-3 py-1 text-sm', preset === p ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground')}
            >
              {PRESET_LABEL[p]}
            </button>
          ))}
        </div>
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="ชื่อ / รหัส / เบอร์โทร" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-40">
          <Select value={sort} onValueChange={(v) => setSort(v === 'bills' || v === 'profit' || v === 'recent' ? v : 'revenue')}>
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="revenue">เรียงตามยอดซื้อ</SelectItem>
              <SelectItem value="profit">เรียงตามกำไร</SelectItem>
              <SelectItem value="bills">เรียงตามจำนวนบิล</SelectItem>
              <SelectItem value="recent">ซื้อล่าสุดก่อน</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch checked={onlyBuyers} onCheckedChange={setOnlyBuyers} /> เฉพาะที่ซื้อในช่วงนี้
        </label>
      </div>

      {data ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="ลูกค้าที่ซื้อ" value={named.length} sub={`จากทั้งหมด ${data.customers.length} ราย`} />
          <Stat label="ยอดซื้อลูกค้าที่ระบุชื่อ" value={baht(namedRevenue)} sub={totalRevenue > 0 ? `${pct((namedRevenue / totalRevenue) * 100)} ของยอดขาย` : undefined} />
          <Stat label="ลูกค้าทั่วไป (ไม่ระบุชื่อ)" value={baht(data.walkIn.revenue)} sub={`${data.walkIn.bills} บิล`} />
          <Stat label="กำไรจากลูกค้าที่ระบุชื่อ" value={baht(named.reduce((s, c) => s + c.profit, 0))} tone="good" />
        </div>
      ) : null}

      {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && rows.length === 0 ? <Empty title="ไม่มีลูกค้าในเงื่อนไขนี้" hint="ลองเลือกช่วงเวลาที่ยาวขึ้น หรือปิด “เฉพาะที่ซื้อในช่วงนี้”" /> : null}
      {rows.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ลูกค้า</TableHead>
                <TableHead className="text-right">บิล</TableHead>
                <TableHead className="text-right">ยอดซื้อ</TableHead>
                <TableHead className="hidden text-right md:table-cell">กำไร</TableHead>
                <TableHead className="hidden text-right lg:table-cell">เฉลี่ย/บิล</TableHead>
                <TableHead className="hidden sm:table-cell">ซื้อล่าสุด</TableHead>
                <TableHead className="hidden text-right lg:table-cell">ค้างชำระ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.customerId} className={cn('cursor-pointer', !c.isActive && 'opacity-60')} onClick={() => setOpenId(c.customerId)}>
                  <TableCell>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.code} · {levelName(app.settings.priceLevelNames, c.priceLevel)}
                    </p>
                  </TableCell>
                  <TableCell className="tabular text-right">{c.bills}</TableCell>
                  <TableCell className="tabular text-right font-semibold">{baht(c.revenue)}</TableCell>
                  <TableCell className="tabular hidden text-right md:table-cell">
                    {baht(c.profit)}
                    <p className="text-xs text-muted-foreground">{pct(c.marginPct)}</p>
                  </TableCell>
                  <TableCell className="tabular hidden text-right lg:table-cell">{baht(c.avgBill)}</TableCell>
                  <TableCell className="hidden sm:table-cell">{c.lastPurchaseEver ? dateOnly(c.lastPurchaseEver) : '-'}</TableCell>
                  <TableCell className={cn('tabular hidden text-right lg:table-cell', c.balance > 0 && 'text-destructive')}>
                    {c.balance > 0 ? baht(c.balance) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}

      <CustomerDetailDialog id={openId} from={from} to={to} rangeLabel={PRESET_LABEL[preset]} onClose={() => setOpenId(null)} />
    </div>
  )
}

function CustomerDetailDialog({ id, from, to, rangeLabel, onClose }: { id: string | null; from: string; to: string; rangeLabel: string; onClose: () => void }) {
  const { data: app } = useApp()
  const { data, error } = useApi<CustomerDetail>(id ? `/insights/customers/${id}?from=${from}&to=${to}` : null)
  const [saleId, setSaleId] = useState<string | null>(null)
  const d = id && data?.customer.id === id ? data : null
  const maxMonth = Math.max(1, ...(d?.monthly.map((m) => m.revenue) ?? [1]))

  const exportProducts = () => {
    if (!d) return
    downloadCsv(
      `${d.customer.code}_สินค้าที่ซื้อ_${from}_${to}.csv`,
      ['รหัสสินค้า', 'สินค้า', 'แบรนด์', 'หมวด', 'จำนวน', 'หน่วย', 'ยอดซื้อ', 'ราคาเฉลี่ย', 'กำไร', 'อัตรากำไร %', 'จำนวนบิล', 'ซื้อล่าสุด'],
      d.products.map((p) => [
        p.sku,
        p.productName,
        p.brandName ?? '',
        p.category ?? '',
        p.qty,
        p.unit,
        p.revenue.toFixed(2),
        p.avgPrice.toFixed(2),
        p.profit.toFixed(2),
        p.marginPct,
        p.bills,
        p.lastBought.slice(0, 10),
      ]),
    )
  }

  return (
    <>
      <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92vh] max-w-3xl grid-cols-1 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{d?.customer.name ?? 'ลูกค้า'}</DialogTitle>
            <DialogDescription>
              {d
                ? `${d.customer.code} · ราคา${levelName(app.settings.priceLevelNames, d.customer.priceLevel)} · ช่วง ${rangeLabel}${
                    d.customer.firstPurchaseEver ? ` · เป็นลูกค้าตั้งแต่ ${dateOnly(d.customer.firstPurchaseEver)}` : ''
                  }`
                : ' '}
            </DialogDescription>
          </DialogHeader>
          {error ? <ErrorBox message={error} /> : null}
          {!d && !error ? <Loading /> : null}
          {d ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="ยอดซื้อ" value={baht(d.summary.revenue)} sub={`${d.summary.bills} บิล`} />
                <Stat label="กำไร" value={baht(d.summary.profit)} sub={pct(d.summary.marginPct)} tone="good" />
                <Stat label="เฉลี่ยต่อบิล" value={baht(d.summary.avgBill)} />
                <Stat
                  label="ค้างชำระ"
                  value={baht(d.customer.balance)}
                  tone={d.customer.balance > 0 ? 'bad' : undefined}
                  sub={d.summary.lastPurchase ? `ซื้อล่าสุด ${dateOnly(d.summary.lastPurchase)}` : undefined}
                />
              </div>

              <Tabs defaultValue="products">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <TabsList>
                    <TabsTrigger value="products" className="cursor-pointer">
                      สินค้า ({d.products.length})
                    </TabsTrigger>
                    <TabsTrigger value="groups" className="cursor-pointer">หมวด/แบรนด์</TabsTrigger>
                    <TabsTrigger value="monthly" className="cursor-pointer">รายเดือน</TabsTrigger>
                    <TabsTrigger value="bills" className="cursor-pointer">
                      บิล ({d.bills.length})
                    </TabsTrigger>
                  </TabsList>
                  <Button variant="outline" size="sm" className="cursor-pointer" disabled={d.products.length === 0} onClick={exportProducts}>
                    <Download /> Excel
                  </Button>
                </div>

                <TabsContent value="products" className="mt-3">
                  {d.products.length === 0 ? (
                    <Empty title="ไม่มีการซื้อในช่วงนี้" />
                  ) : (
                    <TableWrap>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>สินค้า</TableHead>
                            <TableHead className="text-right">จำนวน</TableHead>
                            <TableHead className="text-right">ยอดซื้อ</TableHead>
                            <TableHead className="hidden text-right sm:table-cell">ราคาเฉลี่ย</TableHead>
                            <TableHead className="hidden text-right md:table-cell">กำไร</TableHead>
                            <TableHead className="hidden md:table-cell">ซื้อล่าสุด</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {d.products.map((p) => (
                            <TableRow key={p.productId}>
                              <TableCell>
                                <p className="font-medium">{p.productName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {p.sku}
                                  {p.brandName ? ` · ${p.brandName}` : ''}
                                  {p.category ? ` · ${p.category}` : ''} · {p.bills} บิล
                                </p>
                              </TableCell>
                              <TableCell className="tabular text-right">
                                {qty(p.qty)} <span className="text-xs text-muted-foreground">{p.unit}</span>
                              </TableCell>
                              <TableCell className="tabular text-right font-semibold">{baht(p.revenue)}</TableCell>
                              <TableCell className="tabular hidden text-right sm:table-cell">{baht(p.avgPrice)}</TableCell>
                              <TableCell className="tabular hidden text-right md:table-cell">
                                {baht(p.profit)}
                                <p className="text-xs text-muted-foreground">{pct(p.marginPct)}</p>
                              </TableCell>
                              <TableCell className="hidden md:table-cell">{dateOnly(p.lastBought)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableWrap>
                  )}
                </TabsContent>

                <TabsContent value="groups" className="mt-3 grid gap-4 sm:grid-cols-2">
                  {[
                    ['ตามหมวดสินค้า', d.categories],
                    ['ตามแบรนด์', d.brands],
                  ].map(([title, list]) => {
                    const items = list as CustomerDetail['categories']
                    const max = Math.max(1, ...items.map((x) => x.revenue))
                    return (
                      <section key={title as string}>
                        <h3 className="mb-2 text-sm font-semibold">{title as string}</h3>
                        {items.length === 0 ? (
                          <p className="text-sm text-muted-foreground">-</p>
                        ) : (
                          <ul className="grid gap-2">
                            {items.map((x) => (
                              <li key={x.name} className="text-sm">
                                <div className="flex justify-between gap-2">
                                  <span className="truncate">{x.name}</span>
                                  <span className="tabular shrink-0">{baht(x.revenue)}</span>
                                </div>
                                <div className="mt-1 h-2 rounded-full bg-muted">
                                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(x.revenue / max) * 100}%` }} />
                                </div>
                                <p className="text-xs text-muted-foreground">{qty(x.qty)} หน่วย</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    )
                  })}
                </TabsContent>

                <TabsContent value="monthly" className="mt-3">
                  {d.monthly.length === 0 ? (
                    <Empty title="ไม่มีการซื้อในช่วงนี้" />
                  ) : (
                    <ul className="grid gap-2">
                      {d.monthly.map((m) => (
                        <li key={m.month} className="grid grid-cols-[5rem_1fr_7rem] items-center gap-2 text-sm">
                          <span className="text-muted-foreground">{dateOnly(`${m.month}-01`).replace(/^1 /, '')}</span>
                          <div className="h-3 rounded-full bg-muted">
                            <div className="h-3 rounded-full bg-primary" style={{ width: `${(m.revenue / maxMonth) * 100}%` }} />
                          </div>
                          <span className="tabular text-right">
                            {baht(m.revenue)}
                            <span className="block text-xs text-muted-foreground">{m.bills} บิล</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="bills" className="mt-3">
                  {d.bills.length === 0 ? (
                    <Empty title="ไม่มีบิลในช่วงนี้" />
                  ) : (
                    <TableWrap>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>บิล</TableHead>
                            <TableHead className="hidden sm:table-cell">ชำระ</TableHead>
                            <TableHead className="text-right">ยอด</TableHead>
                            <TableHead className="hidden text-right sm:table-cell">กำไร</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {d.bills.map((b) => (
                            <TableRow key={b.id} className="cursor-pointer" onClick={() => setSaleId(b.id)}>
                              <TableCell>
                                <span className="font-medium">{b.taxInvoiceNo ?? b.billNo}</span>
                                <p className="text-xs text-muted-foreground">
                                  {dateOnly(b.soldAt)} · {b.items} รายการ
                                </p>
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">
                                {b.paymentMethod === 'credit' ? <Badge variant="outline">เงินเชื่อ</Badge> : PAYMENT_LABEL[b.paymentMethod]}
                              </TableCell>
                              <TableCell className="tabular text-right">{baht(b.total)}</TableCell>
                              <TableCell className="tabular hidden text-right sm:table-cell">{baht(b.profit)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableWrap>
                  )}
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <SaleDialog id={saleId} onClose={() => setSaleId(null)} onChanged={() => undefined} />
    </>
  )
}
