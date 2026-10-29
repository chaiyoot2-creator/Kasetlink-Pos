import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Ban, Loader2, Plus, Printer, Trash2, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Empty, ErrorBox, Field, Loading, LocationSelect, NumberInput, PageHeader, Stat, TableWrap } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { baht, dateOnly, pct, qty, round2, round3, todayISO } from '@/lib/format'
import { printSoon } from '@/lib/print'
import { newEvent } from '@/lib/terminal'
import type { Product } from '@/lib/types'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------- types

interface Group {
  id: string
  name: string
  incentivePct: number
  sortOrder: number
  isActive: boolean
}
interface Route {
  id: string
  name: string
  ratePerSack: number
  sortOrder: number
  isActive: boolean
}
interface AgencyProduct {
  id: string
  code: string | null
  name: string
  unit: string
  stdPrice: number
  shopProductId: string | null
  isActive: boolean
}
interface AgencyCustomer {
  id: string
  name: string
  phone: string | null
  address: string | null
  groupId: string | null
  routeId: string | null
  note: string | null
  isActive: boolean
}
interface Setup {
  groups: Group[]
  routes: Route[]
  products: AgencyProduct[]
  customers: AgencyCustomer[]
}
interface Delivery {
  id: string
  docNo: string
  deliveredOn: string
  companyRef: string | null
  customerId: string | null
  customerName: string
  groupName: string
  incentivePct: number
  routeName: string
  ratePerSack: number
  sacks: number
  salesValue: number
  incentiveAmount: number
  transportAmount: number
  note: string | null
  status: string
  voidReason: string | null
  lentQty: number
}
interface DeliveryDetail extends Delivery {
  lines: { lineNo: number; productName: string; unit: string; qty: number; stdPrice: number; amount: number; fromStock: boolean }[]
}
interface Totals {
  deliveries: number
  sacks: number
  salesValue: number
  incentive: number
  transport: number
  expected: number
  received: number
  outstanding: number
}
interface MonthRow extends Totals {
  month: string
}
interface MonthDetail {
  month: string
  totals: Totals
  groups: { name: string; incentivePct: number; deliveries: number; sacks: number; salesValue: number; incentive: number }[]
  routes: { name: string; ratePerSack: number; deliveries: number; sacks: number; transport: number }[]
  deliveries: Delivery[]
  payments: { id: string; kind: string; amount: number; receivedOn: string; reference: string | null; note: string | null }[]
}

const KIND_LABEL: Record<string, string> = { incentive: 'ค่า Incentive', transport: 'ค่าขนส่ง', both: 'Incentive + ค่าขนส่ง' }

function thisMonth(): string {
  return todayISO().slice(0, 7)
}
function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y ?? 2000, (mo ?? 1) - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}
function monthLabel(m: string): string {
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(new Date(`${m}-01T00:00:00+07:00`))
}
function monthEnd(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y ?? 2000, mo ?? 1, 0)).toISOString().slice(0, 10)
}

function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => onChange(shiftMonth(value, -1))} aria-label="เดือนก่อน">
        ‹
      </Button>
      <Input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="w-40" />
      <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => onChange(shiftMonth(value, 1))} aria-label="เดือนถัดไป">
        ›
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------- page

export function AgencyPage() {
  const setup = useApi<Setup>('/agency/setup')
  return (
    <div>
      <PageHeader
        title="ขายผ่านฟาร์มสุข"
        subtitle="ช่องทางเบทาโกร — สินค้าของบริษัท ลูกค้าจ่ายบริษัทโดยตรง ร้านได้ค่า Incentive และค่าขนส่ง (แยกจากยอดขายร้าน ไม่ตัดสต็อก)"
      />
      {setup.error ? <ErrorBox message={setup.error} onRetry={() => void setup.reload()} /> : null}
      {setup.loading && !setup.data ? <Loading /> : null}
      {setup.data ? (
        <Tabs defaultValue="deliveries">
          <TabsList>
            <TabsTrigger value="deliveries" className="cursor-pointer">
              บันทึกการส่ง
            </TabsTrigger>
            <TabsTrigger value="income" className="cursor-pointer">
              รายได้รายเดือน
            </TabsTrigger>
            <TabsTrigger value="loans" className="cursor-pointer">
              ยืมสต็อก / กระทบยอด
            </TabsTrigger>
            <TabsTrigger value="setup" className="cursor-pointer">
              ตั้งค่า
            </TabsTrigger>
          </TabsList>
          <TabsContent value="deliveries" className="mt-3">
            <Deliveries setup={setup.data} onSetupChanged={() => void setup.reload()} />
          </TabsContent>
          <TabsContent value="income" className="mt-3">
            <Income />
          </TabsContent>
          <TabsContent value="loans" className="mt-3">
            <Loans />
          </TabsContent>
          <TabsContent value="setup" className="mt-3">
            <SetupTab setup={setup.data} onChanged={() => void setup.reload()} />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- deliveries

function Deliveries({ setup, onSetupChanged }: { setup: Setup; onSetupChanged: () => void }) {
  const [m, setM] = useState(thisMonth())
  const [q, setQ] = useState('')
  const list = useApi<Delivery[]>(`/agency/deliveries?from=${m}-01&to=${monthEnd(m)}&q=${encodeURIComponent(q.trim())}`)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const active = list.data?.filter((d) => d.status === 'active') ?? []
  const sum = (f: (d: Delivery) => number) => round2(active.reduce((s, d) => s + f(d), 0))

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker value={m} onChange={setM} />
        <Input className="w-full sm:w-64" placeholder="ลูกค้า / เลขที่ / เลขบิลบริษัท" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button className="ml-auto cursor-pointer" onClick={() => setCreating(true)}>
          <Plus /> บันทึกการส่ง
        </Button>
      </div>
      {list.data ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="ยอดขาย (ราคามาตรฐาน)" value={baht(sum((d) => d.salesValue))} sub={`${active.length} เที่ยว · ${qty(sum((d) => d.sacks))} กระสอบ`} />
          <Stat label="ค่า Incentive (ประมาณ)" value={baht(sum((d) => d.incentiveAmount))} tone="good" />
          <Stat label="ค่าขนส่ง" value={baht(sum((d) => d.transportAmount))} tone="good" />
          <Stat label="รายได้ร้านเดือนนี้" value={baht(sum((d) => d.incentiveAmount + d.transportAmount))} tone="good" sub="บริษัทโอนให้ในเดือนถัดไป" />
        </div>
      ) : null}
      {list.error ? <ErrorBox message={list.error} onRetry={() => void list.reload()} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data?.length === 0 ? <Empty title={`ยังไม่มีการส่งใน${monthLabel(m)}`} hint="กด “บันทึกการส่ง” ทุกครั้งที่ส่งสินค้าฟาร์มสุขให้ลูกค้า" /> : null}
      {list.data && list.data.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เลขที่ / วันที่</TableHead>
                <TableHead>ลูกค้า</TableHead>
                <TableHead className="text-right">กระสอบ</TableHead>
                <TableHead className="hidden text-right sm:table-cell">ยอดขาย</TableHead>
                <TableHead className="text-right">รายได้ร้าน</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((d) => (
                <TableRow key={d.id} className={cn('cursor-pointer', d.status === 'voided' && 'opacity-50')} onClick={() => setOpenId(d.id)}>
                  <TableCell>
                    <p className="font-medium">
                      {d.docNo} {d.status === 'voided' ? <Badge variant="destructive">ยกเลิก</Badge> : null}
                      {d.lentQty > 0 && d.status !== 'voided' ? (
                        <Badge variant="outline" className="ml-1 border-amber-400 text-amber-700">
                          ยืมสต็อก {qty(d.lentQty)}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateOnly(d.deliveredOn)}
                      {d.companyRef ? ` · บิลบริษัท ${d.companyRef}` : ''}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p>{d.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.groupName} {pct(d.incentivePct)} · {d.routeName}
                    </p>
                  </TableCell>
                  <TableCell className="tabular text-right">{qty(d.sacks)}</TableCell>
                  <TableCell className="tabular hidden text-right sm:table-cell">{baht(d.salesValue)}</TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {baht(d.incentiveAmount + d.transportAmount)}
                    <p className="text-xs font-normal text-muted-foreground">
                      I {baht(d.incentiveAmount)} · ขนส่ง {baht(d.transportAmount)}
                    </p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}
      <DeliveryForm
        open={creating}
        setup={setup}
        onClose={() => setCreating(false)}
        onSaved={(d) => {
          setCreating(false)
          setM(d.deliveredOn.slice(0, 7))
          void list.reload()
          onSetupChanged()
        }}
      />
      <DeliveryDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => void list.reload()} />
    </div>
  )
}

interface FormLine {
  key: string
  productId: string | null
  productName: string
  unit: string
  qty: number | null
  stdPrice: number | null
  /** Taken from the shop's stock now; ฟาร์มสุข sends the same product back later. */
  fromStock: boolean
  shopProductId: string | null
}

function blankLine(): FormLine {
  return { key: crypto.randomUUID(), productId: null, productName: '', unit: 'กระสอบ', qty: null, stdPrice: null, fromStock: false, shopProductId: null }
}

function DeliveryForm({ open, setup, onClose, onSaved }: { open: boolean; setup: Setup; onClose: () => void; onSaved: (d: Delivery) => void }) {
  const groups = setup.groups.filter((g) => g.isActive)
  const routes = setup.routes.filter((r) => r.isActive)
  const products = setup.products.filter((p) => p.isActive)
  const customers = setup.customers.filter((c) => c.isActive)
  const [deliveredOn, setDeliveredOn] = useState(todayISO())
  const [companyRef, setCompanyRef] = useState('')
  const [customerId, setCustomerId] = useState<string>('')
  const [customerName, setCustomerName] = useState('')
  const [groupId, setGroupId] = useState('')
  const [routeId, setRouteId] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<FormLine[]>([blankLine()])
  const [busy, setBusy] = useState(false)
  const app = useApp()
  const [stockLocationId, setStockLocationId] = useState(app.locationId)
  const lending = lines.some((l) => l.fromStock)
  const shopProducts = useApi<Product[]>(open && lending && stockLocationId ? `/products?limit=500&locationId=${stockLocationId}` : null)

  useEffect(() => {
    if (!open) return
    setDeliveredOn(todayISO())
    setCompanyRef('')
    setCustomerId('')
    setCustomerName('')
    setGroupId(groups[0]?.id ?? '')
    setRouteId(routes[0]?.id ?? '')
    setNote('')
    setLines([blankLine()])
    setStockLocationId(app.locationId)
    // Reset only when the dialog opens (lists are read from the latest setup at that moment).
  }, [open])

  const pickCustomer = (id: string) => {
    setCustomerId(id === 'new' ? '' : id)
    const c = customers.find((x) => x.id === id)
    if (c?.groupId) setGroupId(c.groupId)
    if (c?.routeId) setRouteId(c.routeId)
  }
  const setLine = (key: string, patch: Partial<FormLine>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const group = groups.find((g) => g.id === groupId)
  const route = routes.find((r) => r.id === routeId)
  const valid = lines.filter((l) => l.productName.trim() && (l.qty ?? 0) > 0)
  const sacks = round3(valid.reduce((s, l) => s + (l.qty ?? 0), 0))
  const value = round2(valid.reduce((s, l) => s + round2((l.qty ?? 0) * (l.stdPrice ?? 0)), 0))
  const incentive = round2((value * (group?.incentivePct ?? 0)) / 100)
  const transport = round2(sacks * (route?.ratePerSack ?? 0))
  const lendOk = valid.every((l) => !l.fromStock || l.shopProductId) && (!lending || !!stockLocationId)
  const canSave = !!group && !!route && valid.length > 0 && (customerId || customerName.trim()) && lendOk && !busy

  const save = async () => {
    setBusy(true)
    try {
      let custId = customerId || null
      // A new name becomes a saved customer, remembering this group and route.
      if (!custId && customerName.trim()) {
        const created = await apiFetch<AgencyCustomer>('/agency/customers', {
          method: 'POST',
          body: { name: customerName.trim(), groupId, routeId, isActive: true },
        })
        custId = created.id
      }
      const d = await apiFetch<Delivery>('/agency/deliveries', {
        method: 'POST',
        body: {
          ...newEvent(),
          deliveredOn,
          companyRef: companyRef.trim() || null,
          customerId: custId,
          customerName: customerName.trim() || null,
          groupId,
          routeId,
          note: note.trim() || null,
          stockLocationId: lending ? stockLocationId : null,
          lines: valid.map((l) => ({
            productId: l.productId,
            productName: l.productName.trim(),
            unit: l.unit,
            qty: l.qty,
            stdPrice: l.stdPrice ?? 0,
            fromStock: l.fromStock,
            shopProductId: l.fromStock ? l.shopProductId : null,
          })),
        },
      })
      toast.success(`บันทึก ${d.docNo} แล้ว · รายได้ร้าน ${baht(d.incentiveAmount + d.transportAmount)} บาท`)
      onSaved(d)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl grid-cols-1 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>บันทึกการส่งสินค้าฟาร์มสุข</DialogTitle>
          <DialogDescription>ใช้ราคามาตรฐานของบริษัทเพื่อคิดค่า Incentive — ไม่ตัดสต็อกร้าน ยกเว้นรายการที่ติ๊ก “ส่งจากสต็อกร้าน”</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Field label="วันที่ส่ง">
            <Input type="date" value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} />
          </Field>
          <Field label="เลขที่บิลบริษัท (ถ้ามี)">
            <Input value={companyRef} onChange={(e) => setCompanyRef(e.target.value)} placeholder="เช่น เลขใบส่งของเบทาโกร" />
          </Field>
          <Field label="ลูกค้า" className="sm:col-span-2">
            <Select value={customerId || 'new'} onValueChange={pickCustomer}>
              <SelectTrigger className="w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">+ ลูกค้าใหม่ (พิมพ์ชื่อ)</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!customerId ? (
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="ชื่อลูกค้า (ระบบจะจำไว้ใช้ครั้งต่อไป)" />
            ) : null}
          </Field>
          <Field label="กลุ่มลูกค้า (คิด Incentive)">
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="w-full cursor-pointer">
                <SelectValue placeholder="เลือกกลุ่ม" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name} · {pct(g.incentivePct)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="การขนส่ง (คิดค่าขนส่ง)">
            <Select value={routeId} onValueChange={setRouteId}>
              <SelectTrigger className="w-full cursor-pointer">
                <SelectValue placeholder="เลือกเส้นทาง" />
              </SelectTrigger>
              <SelectContent>
                {routes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} · {baht(r.ratePerSack)}/กระสอบ
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">สินค้าที่ส่ง</p>
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_5rem_6.5rem_auto] items-start gap-2 [&>*]:min-w-0">
              <Field label="สินค้า">
                <Select
                  value={l.productId ?? (l.productName ? 'custom' : '')}
                  onValueChange={(v) => {
                    const p = products.find((x) => x.id === v)
                    if (p) setLine(l.key, { productId: p.id, productName: p.name, unit: p.unit, stdPrice: p.stdPrice, shopProductId: p.shopProductId })
                    else setLine(l.key, { productId: null, productName: '', stdPrice: null })
                  }}
                >
                  <SelectTrigger className="w-full min-w-0 cursor-pointer">
                    <SelectValue placeholder="เลือกสินค้า" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {baht(p.stdPrice)}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">อื่น ๆ (พิมพ์เอง)</SelectItem>
                  </SelectContent>
                </Select>
                {!l.productId ? (
                  <Input value={l.productName} onChange={(e) => setLine(l.key, { productName: e.target.value })} placeholder="ชื่อสินค้า" />
                ) : null}
              </Field>
              <Field label={`จำนวน (${l.unit === 'กระสอบ' ? 'กส.' : l.unit})`}>
                <NumberInput value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} />
              </Field>
              <Field label="ราคา/หน่วย">
                <NumberInput value={l.stdPrice} onChange={(v) => setLine(l.key, { stdPrice: v })} />
              </Field>
              <Button
                variant="ghost"
                size="icon"
                className="mt-6 cursor-pointer"
                aria-label="ลบรายการ"
                disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
              >
                <Trash2 />
              </Button>
              <div className="col-span-4 -mt-1 grid gap-2 border-b pb-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer accent-primary"
                    checked={l.fromStock}
                    onChange={(e) => setLine(l.key, { fromStock: e.target.checked })}
                  />
                  ส่งจากสต็อกร้าน (ฟาร์มสุขส่งคืนภายหลัง)
                </label>
                {l.fromStock ? (
                  <ShopProductSelect
                    products={shopProducts.data}
                    loading={shopProducts.loading}
                    value={l.shopProductId}
                    need={l.qty ?? 0}
                    onChange={(id) => setLine(l.key, { shopProductId: id })}
                  />
                ) : null}
              </div>
            </div>
          ))}
          {lending ? (
            <Field label="ตัดสต็อกจากสาขา/โซน">
              <LocationSelect value={stockLocationId} onChange={setStockLocationId} />
            </Field>
          ) : null}
          <Button variant="outline" size="sm" className="w-fit cursor-pointer" onClick={() => setLines((prev) => [...prev, blankLine()])}>
            <Plus /> เพิ่มสินค้า
          </Button>
        </div>

        <Field label="หมายเหตุ">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">ยอดขาย ({qty(sacks)} กระสอบ)</p>
            <p className="tabular font-semibold">{baht(value)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Incentive {group ? pct(group.incentivePct) : ''}</p>
            <p className="tabular font-semibold">{baht(incentive)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">ค่าขนส่ง {route ? `${baht(route.ratePerSack)}/กส.` : ''}</p>
            <p className="tabular font-semibold">{baht(transport)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">รายได้ร้าน</p>
            <p className="tabular font-bold text-primary">{baht(incentive + transport)}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" disabled={!canSave} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : <Truck />} บันทึกการส่ง
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeliveryDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<DeliveryDetail>(id ? `/agency/deliveries/${id}` : null)
  const d = id && detail.data?.id === id ? detail.data : null
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setVoiding(false)
    setReason('')
  }, [id])

  const doVoid = async () => {
    if (!d) return
    setBusy(true)
    try {
      await apiFetch(`/agency/deliveries/${d.id}/void`, { method: 'POST', body: { ...newEvent(), reason: reason.trim() } })
      toast.success(`ยกเลิก ${d.docNo} แล้ว`)
      await detail.reload()
      onChanged()
      setVoiding(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg grid-cols-1 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d?.docNo ?? 'รายการส่ง'}</DialogTitle>
          <DialogDescription>{d ? `${dateOnly(d.deliveredOn)}${d.companyRef ? ` · บิลบริษัท ${d.companyRef}` : ''}` : ' '}</DialogDescription>
        </DialogHeader>
        {detail.error ? <ErrorBox message={detail.error} /> : null}
        {!d && !detail.error ? <Loading /> : null}
        {d ? (
          <div className="grid gap-3 text-sm">
            <p>
              <span className="text-muted-foreground">ลูกค้า</span> {d.customerName}
              <br />
              <span className="text-muted-foreground">กลุ่ม</span> {d.groupName} ({pct(d.incentivePct)}) ·{' '}
              <span className="text-muted-foreground">ขนส่ง</span> {d.routeName} ({baht(d.ratePerSack)}/กระสอบ)
            </p>
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>สินค้า</TableHead>
                    <TableHead className="text-right">จำนวน</TableHead>
                    <TableHead className="text-right">ราคามาตรฐาน</TableHead>
                    <TableHead className="text-right">รวม</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.lines.map((l) => (
                    <TableRow key={l.lineNo}>
                      <TableCell>
                        {l.productName}
                        {l.fromStock ? <p className="text-xs text-amber-700">ส่งจากสต็อกร้าน — รอฟาร์มสุขส่งคืน</p> : null}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {qty(l.qty)} {l.unit}
                      </TableCell>
                      <TableCell className="tabular text-right">{baht(l.stdPrice)}</TableCell>
                      <TableCell className="tabular text-right">{baht(l.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="ยอดขาย" value={baht(d.salesValue)} />
              <Stat label="Incentive" value={baht(d.incentiveAmount)} tone="good" />
              <Stat label="ค่าขนส่ง" value={baht(d.transportAmount)} tone="good" />
            </div>
            {d.note ? <p className="text-muted-foreground">หมายเหตุ: {d.note}</p> : null}
            {d.status === 'voided' ? <p className="rounded-md bg-destructive/10 p-2 text-destructive">ยกเลิกแล้ว: {d.voidReason}</p> : null}
            {voiding ? (
              <Field label="เหตุผลที่ยกเลิก">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น บันทึกซ้ำ / ลูกค้ายกเลิก" />
              </Field>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          {d?.status === 'active' && !voiding ? (
            <Button variant="outline" className="cursor-pointer text-destructive" onClick={() => setVoiding(true)}>
              <Ban /> ยกเลิกรายการ
            </Button>
          ) : null}
          {voiding ? (
            <Button variant="destructive" className="cursor-pointer" disabled={!reason.trim() || busy} onClick={() => void doVoid()}>
              {busy ? <Loader2 className="animate-spin" /> : null} ยืนยันยกเลิก
            </Button>
          ) : null}
          <Button className="cursor-pointer" onClick={onClose}>
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- monthly income

function Income() {
  const to = thisMonth()
  const from = shiftMonth(to, -11)
  const months = useApi<MonthRow[]>(`/agency/months?from=${from}&to=${to}`)
  // Default to last month (the one the company pays for now), or the latest month with deliveries.
  const [m, setM] = useState(shiftMonth(to, -1))
  const picked = useRef(false)
  useEffect(() => {
    if (picked.current || !months.data) return
    picked.current = true
    const latest = months.data[0]?.month
    if (latest && !months.data.some((x) => x.month === shiftMonth(to, -1))) setM(latest)
  }, [months.data, to])
  const detail = useApi<MonthDetail>(`/agency/months/${m}`)
  const [paying, setPaying] = useState(false)
  const [printing, setPrinting] = useState(false)
  const reloadAll = () => {
    void months.reload()
    void detail.reload()
  }
  useEffect(() => {
    if (!printing) return
    printSoon()
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [printing])

  const owed = (months.data ?? []).filter((x) => x.outstanding > 0.005 && x.month < to)
  const d = detail.data?.month === m ? detail.data : null

  const removePayment = async (id: string) => {
    if (!window.confirm('ลบรายการรับเงินนี้?')) return
    try {
      await apiFetch(`/agency/payments/${id}`, { method: 'DELETE' })
      reloadAll()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="grid gap-4">
      {owed.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          บริษัทยังโอนไม่ครบ {owed.length} เดือน รวม <b>{baht(owed.reduce((s, x) => s + x.outstanding, 0))}</b> บาท ({owed.map((x) => monthLabel(x.month)).join(', ')})
        </div>
      ) : null}

      <section>
        <h2 className="mb-2 font-semibold">ภาพรวม 12 เดือน</h2>
        {months.error ? <ErrorBox message={months.error} onRetry={() => void months.reload()} /> : null}
        {months.data?.length === 0 ? <Empty title="ยังไม่มีข้อมูล" /> : null}
        {months.data && months.data.length > 0 ? (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เดือนที่ขาย</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">ยอดขาย</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Incentive</TableHead>
                  <TableHead className="hidden text-right md:table-cell">ค่าขนส่ง</TableHead>
                  <TableHead className="text-right">ควรได้รับ</TableHead>
                  <TableHead className="text-right">ได้รับแล้ว</TableHead>
                  <TableHead className="text-right">ค้าง</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.data.map((x) => (
                  <TableRow key={x.month} className={cn('cursor-pointer', x.month === m && 'bg-primary/5')} onClick={() => setM(x.month)}>
                    <TableCell className="font-medium">{monthLabel(x.month)}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{baht(x.salesValue)}</TableCell>
                    <TableCell className="tabular hidden text-right md:table-cell">{baht(x.incentive)}</TableCell>
                    <TableCell className="tabular hidden text-right md:table-cell">{baht(x.transport)}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{baht(x.expected)}</TableCell>
                    <TableCell className="tabular text-right">{baht(x.received)}</TableCell>
                    <TableCell className={cn('tabular text-right', x.outstanding > 0.005 ? 'text-destructive' : 'text-emerald-700')}>
                      {x.outstanding > 0.005 ? baht(x.outstanding) : x.outstanding < -0.005 ? `+${baht(-x.outstanding)}` : 'ครบ'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        ) : null}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">รายละเอียดเดือน</h2>
          <MonthPicker value={m} onChange={setM} />
          <div className="ml-auto flex gap-2">
            <Button variant="outline" className="cursor-pointer" onClick={() => setPaying(true)}>
              <Plus /> บันทึกเงินที่บริษัทโอน
            </Button>
            <Button variant="outline" className="cursor-pointer" disabled={!d} onClick={() => setPrinting(true)}>
              <Printer /> พิมพ์สรุป (A4)
            </Button>
          </div>
        </div>
        {detail.error ? <ErrorBox message={detail.error} onRetry={() => void detail.reload()} /> : null}
        {!d && !detail.error ? <Loading /> : null}
        {d ? (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat label="ยอดขาย (ราคามาตรฐาน)" value={baht(d.totals.salesValue)} sub={`${d.totals.deliveries} เที่ยว · ${qty(d.totals.sacks)} กระสอบ`} />
              <Stat label="ควรได้รับ" value={baht(d.totals.expected)} sub={`Incentive ${baht(d.totals.incentive)} + ขนส่ง ${baht(d.totals.transport)}`} tone="good" />
              <Stat label="บริษัทโอนแล้ว" value={baht(d.totals.received)} />
              <Stat
                label="ค้างรับ"
                value={baht(Math.max(0, d.totals.outstanding))}
                tone={d.totals.outstanding > 0.005 ? 'bad' : undefined}
                sub={d.totals.outstanding < -0.005 ? `ได้รับเกิน ${baht(-d.totals.outstanding)}` : undefined}
              />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Incentive ตามกลุ่มลูกค้า</TableHead>
                      <TableHead className="text-right">ยอดขาย</TableHead>
                      <TableHead className="text-right">Incentive</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.groups.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-muted-foreground">
                          -
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {d.groups.map((g) => (
                      <TableRow key={`${g.name}-${g.incentivePct}`}>
                        <TableCell>
                          {g.name} <span className="text-muted-foreground">({pct(g.incentivePct)})</span>
                        </TableCell>
                        <TableCell className="tabular text-right">{baht(g.salesValue)}</TableCell>
                        <TableCell className="tabular text-right font-semibold">{baht(g.incentive)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ค่าขนส่งตามเส้นทาง</TableHead>
                      <TableHead className="text-right">กระสอบ</TableHead>
                      <TableHead className="text-right">ค่าขนส่ง</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.routes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-muted-foreground">
                          -
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {d.routes.map((r) => (
                      <TableRow key={`${r.name}-${r.ratePerSack}`}>
                        <TableCell>
                          {r.name} <span className="text-muted-foreground">({baht(r.ratePerSack)}/กส.)</span>
                        </TableCell>
                        <TableCell className="tabular text-right">{qty(r.sacks)}</TableCell>
                        <TableCell className="tabular text-right font-semibold">{baht(r.transport)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            </div>
            <section>
              <h3 className="mb-2 text-sm font-semibold">เงินที่บริษัทโอนสำหรับเดือนนี้</h3>
              {d.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">ยังไม่ได้บันทึก</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {d.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                      <span className="font-medium">{dateOnly(p.receivedOn)}</span>
                      <span>{KIND_LABEL[p.kind] ?? p.kind}</span>
                      {p.reference ? <span className="text-muted-foreground">อ้างอิง {p.reference}</span> : null}
                      <span className="tabular ml-auto font-semibold">{baht(p.amount)}</span>
                      <Button variant="ghost" size="icon-sm" className="cursor-pointer" aria-label="ลบ" onClick={() => void removePayment(p.id)}>
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {printing ? <MonthStatementPrint detail={d} /> : null}
          </>
        ) : null}
      </section>
      <PaymentDialog
        open={paying}
        period={m}
        suggested={d ? Math.max(0, d.totals.outstanding) : 0}
        onClose={() => setPaying(false)}
        onSaved={() => {
          setPaying(false)
          reloadAll()
        }}
      />
    </div>
  )
}

function PaymentDialog({ open, period, suggested, onClose, onSaved }: { open: boolean; period: string; suggested: number; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState(period)
  const [kind, setKind] = useState<'both' | 'incentive' | 'transport'>('both')
  const [amount, setAmount] = useState<number | null>(null)
  const [receivedOn, setReceivedOn] = useState(todayISO())
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setP(period)
    setKind('both')
    setAmount(suggested > 0 ? suggested : null)
    setReceivedOn(todayISO())
    setReference('')
  }, [open, period, suggested])

  const save = async () => {
    setBusy(true)
    try {
      await apiFetch('/agency/payments', { method: 'POST', body: { period: p, kind, amount, receivedOn, reference: reference.trim() || null } })
      toast.success('บันทึกเงินที่ได้รับแล้ว')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>บันทึกเงินที่บริษัทโอน</DialogTitle>
          <DialogDescription>เลือกเดือนที่ขาย (บริษัทจะโอนในเดือนถัดไป)</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="สำหรับยอดขายเดือน">
            <Input type="month" value={p} onChange={(e) => e.target.value && setP(e.target.value)} />
          </Field>
          <Field label="ประเภท">
            <Select value={kind} onValueChange={(v) => setKind(v === 'incentive' || v === 'transport' ? v : 'both')}>
              <SelectTrigger className="w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(KIND_LABEL).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="จำนวนเงิน (บาท)">
            <NumberInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="วันที่ได้รับ">
            <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </Field>
          <Field label="อ้างอิง (เลขที่โอน / เอกสาร)">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" disabled={!amount || amount <= 0 || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A4 evidence sheet for ฟาร์มสุข: every delivery of the month plus the income calculation. */
function MonthStatementPrint({ detail: d }: { detail: MonthDetail }) {
  const { data } = useApp()
  const s = data.settings
  const rows = d.deliveries.filter((x) => x.status === 'active')
  return createPortal(
    <div id="print-root" data-paper="doc">
      <div className="tax-invoice-page bg-white p-[10mm] text-[11px] leading-snug text-black">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[15px] font-bold">{s.shopName}</p>
            {s.address ? <p className="whitespace-pre-line">{s.address}</p> : null}
            {s.phone ? <p>โทร {s.phone}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-[16px] font-bold">สรุปการส่งสินค้า บริษัท ฟาร์มสุข</p>
            <p>ประจำเดือน {monthLabel(d.month)}</p>
            <p>พิมพ์วันที่ {dateOnly(todayISO())}</p>
          </div>
        </div>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1 text-left">วันที่</th>
              <th className="text-left">เลขที่ / บิลบริษัท</th>
              <th className="text-left">ลูกค้า</th>
              <th className="text-left">กลุ่ม</th>
              <th className="text-left">ขนส่ง</th>
              <th className="text-right">กระสอบ</th>
              <th className="text-right">ยอดขาย</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className="border-b border-gray-300 align-top">
                <td className="py-0.5">{dateOnly(x.deliveredOn)}</td>
                <td>
                  {x.docNo}
                  {x.companyRef ? ` / ${x.companyRef}` : ''}
                </td>
                <td>{x.customerName}</td>
                <td>{x.groupName}</td>
                <td>{x.routeName}</td>
                <td className="text-right">{qty(x.sacks)}</td>
                <td className="text-right">{baht(x.salesValue)}</td>
              </tr>
            ))}
            <tr className="border-b border-black font-bold">
              <td colSpan={5} className="py-1">
                รวม {rows.length} รายการ
              </td>
              <td className="text-right">{qty(d.totals.sacks)}</td>
              <td className="text-right">{baht(d.totals.salesValue)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-black">
                <th className="py-1 text-left">ค่า Incentive</th>
                <th className="text-right">ยอดขาย</th>
                <th className="text-right">%</th>
                <th className="text-right">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {d.groups.map((g) => (
                <tr key={`${g.name}-${g.incentivePct}`} className="border-b border-gray-300">
                  <td className="py-0.5">{g.name}</td>
                  <td className="text-right">{baht(g.salesValue)}</td>
                  <td className="text-right">{g.incentivePct}</td>
                  <td className="text-right">{baht(g.incentive)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td colSpan={3} className="py-1">
                  รวมค่า Incentive
                </td>
                <td className="text-right">{baht(d.totals.incentive)}</td>
              </tr>
            </tbody>
          </table>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-black">
                <th className="py-1 text-left">ค่าขนส่ง</th>
                <th className="text-right">กระสอบ</th>
                <th className="text-right">บาท/กส.</th>
                <th className="text-right">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {d.routes.map((r) => (
                <tr key={`${r.name}-${r.ratePerSack}`} className="border-b border-gray-300">
                  <td className="py-0.5">{r.name}</td>
                  <td className="text-right">{qty(r.sacks)}</td>
                  <td className="text-right">{baht(r.ratePerSack)}</td>
                  <td className="text-right">{baht(r.transport)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td colSpan={3} className="py-1">
                  รวมค่าขนส่ง
                </td>
                <td className="text-right">{baht(d.totals.transport)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 ml-auto w-1/2 border border-black p-2 text-[12px]">
          <div className="flex justify-between font-bold">
            <span>รวมที่ร้านพึงได้รับ</span>
            <span>{baht(d.totals.expected)} บาท</span>
          </div>
          <div className="flex justify-between">
            <span>บริษัทโอนแล้ว</span>
            <span>{baht(d.totals.received)} บาท</span>
          </div>
          <div className="flex justify-between">
            <span>คงค้าง</span>
            <span>{baht(Math.max(0, d.totals.outstanding))} บาท</span>
          </div>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-8 text-center">
          <div>
            <p>.................................................</p>
            <p>ผู้จัดทำ ({s.shopName})</p>
          </div>
          <div>
            <p>.................................................</p>
            <p>ผู้ตรวจสอบ (บริษัท ฟาร์มสุข)</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- setup

type EditTarget =
  | { kind: 'group'; item: Partial<Group> }
  | { kind: 'route'; item: Partial<Route> }
  | { kind: 'product'; item: Partial<AgencyProduct> }
  | { kind: 'customer'; item: Partial<AgencyCustomer> }

function SetupTab({ setup, onChanged }: { setup: Setup; onChanged: () => void }) {
  const [edit, setEdit] = useState<EditTarget | null>(null)
  const groupName = useMemo(() => new Map(setup.groups.map((g) => [g.id, g.name])), [setup.groups])
  const routeName = useMemo(() => new Map(setup.routes.map((r) => [r.id, r.name])), [setup.routes])

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <SetupList
        title="กลุ่มลูกค้า (% Incentive)"
        hint="เปลี่ยนเปอร์เซ็นต์แล้วมีผลกับการส่งครั้งถัดไป รายการเก่าคงตามอัตราเดิม"
        onAdd={() => setEdit({ kind: 'group', item: { incentivePct: 0, isActive: true, sortOrder: setup.groups.length + 1 } })}
        rows={setup.groups.map((g) => ({ id: g.id, label: g.name, value: pct(g.incentivePct), active: g.isActive, onClick: () => setEdit({ kind: 'group', item: g }) }))}
      />
      <SetupList
        title="การขนส่ง (บาท/กระสอบ)"
        hint="เลือกต่อเที่ยวตอนบันทึกการส่ง"
        onAdd={() => setEdit({ kind: 'route', item: { ratePerSack: 0, isActive: true, sortOrder: setup.routes.length + 1 } })}
        rows={setup.routes.map((r) => ({ id: r.id, label: r.name, value: `${baht(r.ratePerSack)} บาท`, active: r.isActive, onClick: () => setEdit({ kind: 'route', item: r }) }))}
      />
      <SetupList
        title="สินค้าฟาร์มสุข (ราคามาตรฐาน)"
        hint="ราคาที่ลูกค้ารับทราบ ใช้คิดค่า Incentive"
        onAdd={() => setEdit({ kind: 'product', item: { unit: 'กระสอบ', stdPrice: 0, isActive: true } })}
        rows={setup.products.map((p) => ({
          id: p.id,
          label: `${p.code ? `${p.code} · ` : ''}${p.name}`,
          value: `${baht(p.stdPrice)}/${p.unit}`,
          active: p.isActive,
          onClick: () => setEdit({ kind: 'product', item: p }),
        }))}
      />
      <SetupList
        title="ลูกค้าฟาร์มสุข"
        hint="กลุ่มและการขนส่งประจำ จะถูกเลือกให้อัตโนมัติตอนบันทึก"
        onAdd={() => setEdit({ kind: 'customer', item: { isActive: true, groupId: setup.groups[0]?.id ?? null, routeId: setup.routes[0]?.id ?? null } })}
        rows={setup.customers.map((c) => ({
          id: c.id,
          label: c.name,
          value: [c.groupId ? groupName.get(c.groupId) : null, c.routeId ? routeName.get(c.routeId) : null].filter(Boolean).join(' · '),
          active: c.isActive,
          onClick: () => setEdit({ kind: 'customer', item: c }),
        }))}
      />
      <SetupDialog target={edit} setup={setup} onClose={() => setEdit(null)} onSaved={() => {
        setEdit(null)
        onChanged()
      }} />
    </div>
  )
}

function SetupList({
  title,
  hint,
  rows,
  onAdd,
}: {
  title: string
  hint: string
  rows: { id: string; label: string; value: string; active: boolean; onClick: () => void }[]
  onAdd: () => void
}) {
  return (
    <section className="rounded-lg border">
      <div className="flex items-start justify-between gap-2 border-b p-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button size="sm" variant="outline" className="cursor-pointer" onClick={onAdd}>
          <Plus /> เพิ่ม
        </Button>
      </div>
      {rows.length === 0 ? <p className="p-3 text-sm text-muted-foreground">ยังไม่มีรายการ</p> : null}
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={r.onClick} className={cn('flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50', !r.active && 'opacity-50')}>
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="tabular shrink-0 text-muted-foreground">
                {r.value}
                {!r.active ? ' · ปิดใช้' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SetupDialog({ target, setup, onClose, onSaved }: { target: EditTarget | null; setup: Setup; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string | number | boolean | null>>({})
  const [busy, setBusy] = useState(false)
  // Shop products, so a ฟาร์มสุข item can point at the same sack the shop stocks.
  const shopProducts = useApi<Product[]>(target?.kind === 'product' ? '/products?limit=500' : null)
  useEffect(() => {
    if (target) setF({ ...(target.item as Record<string, string | number | boolean | null>) })
  }, [target])
  if (!target) return null

  const s = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '')
  const n = (k: string) => (typeof f[k] === 'number' ? (f[k] as number) : null)
  const set = (k: string, v: string | number | boolean | null) => setF((p) => ({ ...p, [k]: v }))
  const id = typeof f.id === 'string' ? f.id : null
  const path = { group: 'groups', route: 'routes', product: 'products', customer: 'customers' }[target.kind]
  const title = { group: 'กลุ่มลูกค้า', route: 'การขนส่ง', product: 'สินค้าฟาร์มสุข', customer: 'ลูกค้าฟาร์มสุข' }[target.kind]

  const body = () => {
    const common = { name: s('name').trim(), isActive: f.isActive !== false }
    if (target.kind === 'group') return { ...common, incentivePct: n('incentivePct') ?? 0, sortOrder: n('sortOrder') ?? 0 }
    if (target.kind === 'route') return { ...common, ratePerSack: n('ratePerSack') ?? 0, sortOrder: n('sortOrder') ?? 0 }
    if (target.kind === 'product') {
      return { ...common, code: s('code').trim() || null, unit: s('unit').trim() || 'กระสอบ', stdPrice: n('stdPrice') ?? 0, shopProductId: s('shopProductId') || null }
    }
    return {
      ...common,
      phone: s('phone').trim() || null,
      address: s('address').trim() || null,
      groupId: s('groupId') || null,
      routeId: s('routeId') || null,
      note: s('note').trim() || null,
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      await apiFetch(id ? `/agency/${path}/${id}` : `/agency/${path}`, { method: id ? 'PUT' : 'POST', body: body() })
      toast.success('บันทึกแล้ว')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {id ? 'แก้ไข' : 'เพิ่ม'}
            {title}
          </DialogTitle>
          <DialogDescription>
            {target.kind === 'group' || target.kind === 'route' ? 'การแก้อัตรามีผลกับรายการที่บันทึกหลังจากนี้เท่านั้น' : ' '}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {target.kind === 'product' ? (
            <Field label="รหัสสินค้า (ถ้ามี)">
              <Input value={s('code')} onChange={(e) => set('code', e.target.value)} />
            </Field>
          ) : null}
          <Field label="ชื่อ">
            <Input value={s('name')} onChange={(e) => set('name', e.target.value)} />
          </Field>
          {target.kind === 'group' ? (
            <Field label="ค่า Incentive (%)">
              <NumberInput value={n('incentivePct')} onChange={(v) => set('incentivePct', v)} />
            </Field>
          ) : null}
          {target.kind === 'route' ? (
            <Field label="ค่าขนส่ง (บาท/กระสอบ)">
              <NumberInput value={n('ratePerSack')} onChange={(v) => set('ratePerSack', v)} />
            </Field>
          ) : null}
          {target.kind === 'product' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="หน่วย">
                <Input value={s('unit')} onChange={(e) => set('unit', e.target.value)} />
              </Field>
              <Field label="ราคามาตรฐาน (บาท)">
                <NumberInput value={n('stdPrice')} onChange={(v) => set('stdPrice', v)} />
              </Field>
              <Field label="สินค้าเดียวกันในร้าน (ถ้ามี)" className="col-span-2">
                <ShopProductSelect
                  products={shopProducts.data}
                  loading={shopProducts.loading}
                  value={s('shopProductId') || null}
                  need={0}
                  allowNone
                  onChange={(id) => set('shopProductId', id)}
                />
              </Field>
            </div>
          ) : null}
          {target.kind === 'customer' ? (
            <>
              <Field label="เบอร์โทร">
                <Input value={s('phone')} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
              </Field>
              <Field label="ที่อยู่ / หมู่บ้าน">
                <Input value={s('address')} onChange={(e) => set('address', e.target.value)} />
              </Field>
              <Field label="กลุ่มประจำ">
                <Select value={s('groupId')} onValueChange={(v) => set('groupId', v)}>
                  <SelectTrigger className="w-full cursor-pointer">
                    <SelectValue placeholder="เลือกกลุ่ม" />
                  </SelectTrigger>
                  <SelectContent>
                    {setup.groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name} · {pct(g.incentivePct)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="การขนส่งประจำ">
                <Select value={s('routeId')} onValueChange={(v) => set('routeId', v)}>
                  <SelectTrigger className="w-full cursor-pointer">
                    <SelectValue placeholder="เลือกเส้นทาง" />
                  </SelectTrigger>
                  <SelectContent>
                    {setup.routes.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} · {baht(r.ratePerSack)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : null}
          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm">
            เปิดใช้งาน
            <Switch checked={f.isActive !== false} onCheckedChange={(v) => set('isActive', v)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" disabled={!s('name').trim() || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- stock lent to ฟาร์มสุข

function ShopProductSelect({
  products,
  loading,
  value,
  need,
  onChange,
  allowNone = false,
}: {
  products: Product[] | null
  loading: boolean
  value: string | null
  need: number
  onChange: (id: string | null) => void
  allowNone?: boolean
}) {
  const chosen = products?.find((p) => p.id === value)
  return (
    <div className="grid min-w-0 gap-1">
      <Select value={value ?? (allowNone ? 'none' : '')} onValueChange={(v) => onChange(v === 'none' ? null : v)}>
        <SelectTrigger className="w-full min-w-0 cursor-pointer">
          <SelectValue placeholder={loading ? 'กำลังโหลดสินค้าในร้าน…' : 'เลือกสินค้าในร้านที่ใช้ส่ง'} />
        </SelectTrigger>
        <SelectContent>
          {allowNone ? <SelectItem value="none">— ไม่ผูก —</SelectItem> : null}
          {products?.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name} · {p.sku}
              {need > 0 || !allowNone ? ` · คงเหลือ ${qty(p.qtyHere)} ${p.unit}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {chosen && need > chosen.qtyHere ? (
        <p className="text-xs text-destructive">
          สต็อกที่นี่มี {qty(chosen.qtyHere)} {chosen.unit} ไม่พอส่ง {qty(need)}
        </p>
      ) : null}
    </div>
  )
}

interface LoanProduct {
  productId: string
  name: string
  sku: string
  unit: string
  trackExpiry: boolean
  /** ฟาร์มสุข item names (เบอร์) this shop product was delivered as. */
  agencyNames: string[]
  opening: number
  lent: number
  returned: number
  outstanding: number
  trips: number
  avgCost: number
  lastOn: string | null
}

interface LoanSummary {
  from: string | null
  to: string | null
  totals: { opening: number; lent: number; returned: number; outstanding: number; outstandingCost: number }
  products: LoanProduct[]
  entries: {
    id: string
    type: string
    productId: string
    productName: string
    unit: string
    qty: number
    occurredOn: string
    deliveryId: string | null
    docNo: string
    customerName: string | null
    companyRef: string | null
  }[]
}

const LOAN_TYPE_LABEL: Record<string, string> = {
  lend: 'ส่งจากสต็อกร้าน',
  lend_void: 'ยกเลิกการส่ง (คืนสต็อก)',
  return: 'ฟาร์มสุขส่งคืน',
}

type LoanPeriod = 'month' | 'lastMonth' | 'year' | 'all'
const LOAN_PERIOD_LABEL: Record<LoanPeriod, string> = { month: 'เดือนนี้', lastMonth: 'เดือนก่อน', year: 'ปีนี้', all: 'ทั้งหมด' }

function loanRange(p: LoanPeriod): { from: string; to: string; label: string } {
  const today = todayISO()
  const m = today.slice(0, 7)
  if (p === 'month') return { from: `${m}-01`, to: monthEnd(m), label: monthLabel(m) }
  if (p === 'lastMonth') {
    const lm = shiftMonth(m, -1)
    return { from: `${lm}-01`, to: monthEnd(lm), label: monthLabel(lm) }
  }
  if (p === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31`, label: `ปี ${Number(today.slice(0, 4)) + 543}` }
  return { from: '', to: '', label: 'ทั้งหมด' }
}

function agencyLabel(p: LoanProduct): string {
  return p.agencyNames.length ? `ฟาร์มสุข: ${p.agencyNames.join(', ')}` : ''
}

function Loans() {
  const [period, setPeriod] = useState<LoanPeriod>('month')
  const range = loanRange(period)
  const data = useApi<LoanSummary>(`/agency/loans?from=${range.from}&to=${range.to}`)
  // What is owed right now (for the receive form), whatever period is on screen.
  const current = useApi<LoanSummary>('/agency/loans')
  const [receiving, setReceiving] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [onlyOwed, setOnlyOwed] = useState(false)
  useEffect(() => {
    if (!printing) return
    printSoon()
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [printing])

  const owedNow = (current.data?.products ?? []).filter((p) => p.outstanding > 0.0005)
  const rows = (data.data?.products ?? []).filter((p) => !onlyOwed || p.outstanding > 0.0005)
  const t = data.data?.totals

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          สินค้าที่ร้านส่งให้ลูกค้าฟาร์มสุขจากสต็อกของร้านก่อน และรอบริษัทส่งสินค้าเดิมคืน (ทุนเท่าเดิม ไม่กระทบกำไรร้าน)
        </p>
        <div className="ml-auto flex gap-2">
          <Button className="cursor-pointer" disabled={owedNow.length === 0} onClick={() => setReceiving(true)}>
            <Plus /> รับสินค้าทดแทนจากฟาร์มสุข
          </Button>
          <Button variant="outline" className="cursor-pointer" disabled={!data.data} onClick={() => setPrinting(true)}>
            <Printer /> พิมพ์ใบกระทบยอด
          </Button>
        </div>
      </div>

      {owedNow.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          ตอนนี้ฟาร์มสุขค้างคืน{' '}
          {owedNow.map((p, i) => (
            <span key={p.productId}>
              {i > 0 ? ', ' : ''}
              <b>
                {p.agencyNames[0] ?? p.name} {qty(p.outstanding)} {p.unit}
              </b>
            </span>
          ))}
        </div>
      ) : null}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">สรุปการยืมสะสม</h2>
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
            {(Object.keys(LOAN_PERIOD_LABEL) as LoanPeriod[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn('cursor-pointer rounded-md px-3 py-1 text-sm', period === p ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground')}
              >
                {LOAN_PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
            <Switch checked={onlyOwed} onCheckedChange={setOnlyOwed} /> เฉพาะที่ยังค้างคืน
          </label>
        </div>
        {data.error ? <ErrorBox message={data.error} onRetry={() => void data.reload()} /> : null}
        {data.loading && !data.data ? <Loading /> : null}
        {t ? (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {period !== 'all' ? <Stat label="ค้างยกมา (ต้นช่วง)" value={qty(t.opening)} /> : null}
            <Stat label={`ยืมไป · ${range.label}`} value={qty(t.lent)} tone={t.lent > 0 ? 'warn' : undefined} />
            <Stat label={`ได้คืน · ${range.label}`} value={qty(t.returned)} tone={t.returned > 0 ? 'good' : undefined} />
            <Stat
              label={period === 'all' ? 'ค้างคืนตอนนี้' : 'ค้างคืน ณ สิ้นช่วง'}
              value={qty(t.outstanding)}
              tone={t.outstanding > 0.0005 ? 'bad' : undefined}
              sub={`มูลค่าทุน ${baht(t.outstandingCost)} บาท`}
            />
          </div>
        ) : null}
        {data.data && rows.length === 0 ? (
          <Empty title={`ไม่มีการยืมสต็อกใน${range.label === 'ทั้งหมด' ? 'ระบบ' : range.label}`} hint="เมื่อส่งของจากสต็อกร้าน ให้ติ๊ก “ส่งจากสต็อกร้าน” ตอนบันทึกการส่ง" />
        ) : null}
        {rows.length > 0 ? (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>สินค้า (เบอร์)</TableHead>
                  {period !== 'all' ? <TableHead className="hidden text-right sm:table-cell">ยกมา</TableHead> : null}
                  <TableHead className="text-right">ยืมไป</TableHead>
                  <TableHead className="text-right">ได้คืน</TableHead>
                  <TableHead className="text-right">ค้างคืน</TableHead>
                  <TableHead className="hidden text-right md:table-cell">มูลค่าทุนค้าง</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.productId}>
                    <TableCell>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.sku}
                        {agencyLabel(p) ? ` · ${agencyLabel(p)}` : ''}
                        {p.lastOn ? ` · ล่าสุด ${dateOnly(p.lastOn)}` : ''}
                      </p>
                    </TableCell>
                    {period !== 'all' ? <TableCell className="tabular hidden text-right sm:table-cell">{qty(p.opening)}</TableCell> : null}
                    <TableCell className="tabular text-right">
                      {qty(p.lent)}
                      {p.trips > 0 ? <p className="text-xs text-muted-foreground">{p.trips} เที่ยว</p> : null}
                    </TableCell>
                    <TableCell className="tabular text-right">{qty(p.returned)}</TableCell>
                    <TableCell className={cn('tabular text-right font-semibold', p.outstanding > 0.0005 ? 'text-amber-700' : 'text-emerald-700')}>
                      {p.outstanding > 0.0005 ? `${qty(p.outstanding)} ${p.unit}` : 'ครบ'}
                    </TableCell>
                    <TableCell className="tabular hidden text-right md:table-cell">{baht(round2(p.outstanding * p.avgCost))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        ) : null}
        <p className="text-xs text-muted-foreground">ค้างคืน = ยกมา + ยืมไป − ได้คืน · ยืมไปหักรายการที่ยกเลิกแล้ว</p>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">ประวัติ · {range.label}</h2>
        {data.data && data.data.entries.length === 0 ? <p className="text-sm text-muted-foreground">ไม่มีรายการในช่วงนี้</p> : null}
        {data.data && data.data.entries.length > 0 ? (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>วันที่ / เอกสาร</TableHead>
                  <TableHead>รายการ</TableHead>
                  <TableHead className="text-right">จำนวน</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <p className="font-medium">{e.docNo}</p>
                      <p className="text-xs text-muted-foreground">
                        {dateOnly(e.occurredOn)}
                        {e.companyRef ? ` · บิลบริษัท ${e.companyRef}` : ''}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p>{e.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {LOAN_TYPE_LABEL[e.type] ?? e.type}
                        {e.customerName ? ` · ${e.customerName}` : ''}
                      </p>
                    </TableCell>
                    <TableCell className={cn('tabular text-right', e.qty > 0 ? 'text-amber-700' : 'text-emerald-700')}>
                      {e.qty > 0 ? `+${qty(e.qty)}` : qty(e.qty)} {e.unit}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">+ = ฟาร์มสุขค้างร้านเพิ่ม · − = ลดยอดค้าง</p>
      </section>
      {printing && data.data ? <LoansPrint data={data.data} periodLabel={range.label} /> : null}
      <ReturnDialog
        open={receiving}
        owed={owedNow}
        onClose={() => setReceiving(false)}
        onSaved={() => {
          setReceiving(false)
          void data.reload()
          void current.reload()
        }}
      />
    </div>
  )
}

interface ReturnLine {
  productId: string
  qty: number | null
  lotNo: string
  expiryDate: string
}

function ReturnDialog({
  open,
  owed,
  onClose,
  onSaved,
}: {
  open: boolean
  owed: LoanSummary['products']
  onClose: () => void
  onSaved: () => void
}) {
  const app = useApp()
  const [locationId, setLocationId] = useState(app.locationId)
  const [receivedOn, setReceivedOn] = useState(todayISO())
  const [companyRef, setCompanyRef] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setLocationId(app.locationId)
    setReceivedOn(todayISO())
    setCompanyRef('')
    setNote('')
    // Start with everything that is owed; untick or lower what did not arrive.
    setLines(owed.map((p) => ({ productId: p.productId, qty: p.outstanding, lotNo: '', expiryDate: '' })))
    // Only when the dialog opens.
  }, [open])

  const setLine = (pid: string, patch: Partial<ReturnLine>) => setLines((prev) => prev.map((l) => (l.productId === pid ? { ...l, ...patch } : l)))
  const chosen = lines.filter((l) => (l.qty ?? 0) > 0)
  const info = (pid: string) => owed.find((p) => p.productId === pid)
  const problems = chosen.filter((l) => {
    const p = info(l.productId)
    return !p || (l.qty ?? 0) > p.outstanding + 0.0005 || (p.trackExpiry && !l.expiryDate)
  })

  const save = async () => {
    setBusy(true)
    try {
      const res = await apiFetch<{ docNo: string }>('/agency/returns', {
        method: 'POST',
        body: {
          ...newEvent(),
          receivedOn,
          locationId,
          companyRef: companyRef.trim() || null,
          note: note.trim() || null,
          lines: chosen.map((l) => ({ productId: l.productId, qty: l.qty, lotNo: l.lotNo.trim(), expiryDate: l.expiryDate || null })),
        },
      })
      toast.success(`รับสินค้าทดแทน ${res.docNo} เข้าสต็อกแล้ว`)
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl grid-cols-1 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>รับสินค้าทดแทนจากฟาร์มสุข</DialogTitle>
          <DialogDescription>สินค้าเข้าสต็อกร้านด้วยทุนเดิมตอนที่ส่งออกไป และลดยอดที่ฟาร์มสุขค้างคืน</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
          <Field label="วันที่รับ">
            <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </Field>
          <Field label="รับเข้าสาขา/โซน">
            <LocationSelect value={locationId} onChange={setLocationId} />
          </Field>
          <Field label="เลขที่เอกสารบริษัท">
            <Input value={companyRef} onChange={(e) => setCompanyRef(e.target.value)} placeholder="เช่น ใบส่งของ" />
          </Field>
        </div>
        <div className="grid gap-2">
          {lines.map((l) => {
            const p = info(l.productId)
            if (!p) return null
            const over = (l.qty ?? 0) > p.outstanding + 0.0005
            return (
              <div key={l.productId} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_9rem] sm:items-end">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ค้างคืน {qty(p.outstanding)} {p.unit}
                  </p>
                </div>
                <Field label="จำนวนที่ได้">
                  <NumberInput value={l.qty} onChange={(v) => setLine(l.productId, { qty: v })} />
                </Field>
                <Field label="เลขล็อต">
                  <Input value={l.lotNo} onChange={(e) => setLine(l.productId, { lotNo: e.target.value })} />
                </Field>
                <Field label={p.trackExpiry ? 'วันหมดอายุ *' : 'วันหมดอายุ'}>
                  <Input type="date" value={l.expiryDate} onChange={(e) => setLine(l.productId, { expiryDate: e.target.value })} />
                </Field>
                {over ? <p className="text-xs text-destructive sm:col-span-4">เกินยอดที่ค้างคืน</p> : null}
              </div>
            )
          })}
          <p className="text-xs text-muted-foreground">ใส่ 0 สำหรับสินค้าที่ยังไม่ได้รับในรอบนี้</p>
        </div>
        <Field label="หมายเหตุ">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" disabled={chosen.length === 0 || problems.length > 0 || !locationId || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : null} รับเข้าสต็อก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A4 reconciliation sheet: what ฟาร์มสุข still owes the shop, with the movements behind it. */
function LoansPrint({ data, periodLabel }: { data: LoanSummary; periodLabel: string }) {
  const { data: app } = useApp()
  const s = app.settings
  const rows = data.products
  return createPortal(
    <div id="print-root" data-paper="doc">
      <div className="tax-invoice-page bg-white p-[10mm] text-[11px] leading-snug text-black">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[15px] font-bold">{s.shopName}</p>
            {s.address ? <p className="whitespace-pre-line">{s.address}</p> : null}
            {s.phone ? <p>โทร {s.phone}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-[16px] font-bold">ใบกระทบยอดสินค้าที่ฟาร์มสุขค้างคืน</p>
            <p>ช่วง {periodLabel} · พิมพ์ {dateOnly(todayISO())}</p>
          </div>
        </div>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1 text-left">สินค้า (เบอร์)</th>
              <th className="text-right">ยกมา</th>
              <th className="text-right">ยืมไป</th>
              <th className="text-right">ได้คืน</th>
              <th className="text-right">ค้างคืน</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-1">
                  ไม่มีรายการ
                </td>
              </tr>
            ) : null}
            {rows.map((p) => (
              <tr key={p.productId} className="border-b border-gray-300">
                <td className="py-0.5">
                  {p.name} ({p.sku}){p.agencyNames.length ? ` · ฟาร์มสุข ${p.agencyNames.join(', ')}` : ''}
                </td>
                <td className="text-right">{qty(p.opening)}</td>
                <td className="text-right">{qty(p.lent)}</td>
                <td className="text-right">{qty(p.returned)}</td>
                <td className="text-right font-bold">
                  {qty(p.outstanding)} {p.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 font-semibold">รายการเคลื่อนไหว</p>
        <table className="mt-1 w-full border-collapse">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1 text-left">วันที่</th>
              <th className="text-left">เอกสาร / บิลบริษัท</th>
              <th className="text-left">รายการ</th>
              <th className="text-left">สินค้า</th>
              <th className="text-right">จำนวน</th>
            </tr>
          </thead>
          <tbody>
            {data.entries
              .map((e) => (
                <tr key={e.id} className="border-b border-gray-300">
                  <td className="py-0.5">{dateOnly(e.occurredOn)}</td>
                  <td>
                    {e.docNo}
                    {e.companyRef ? ` / ${e.companyRef}` : ''}
                  </td>
                  <td>
                    {LOAN_TYPE_LABEL[e.type] ?? e.type}
                    {e.customerName ? ` (${e.customerName})` : ''}
                  </td>
                  <td>{e.productName}</td>
                  <td className="text-right">{e.qty > 0 ? `+${qty(e.qty)}` : qty(e.qty)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="mt-10 grid grid-cols-2 gap-8 text-center">
          <div>
            <p>.................................................</p>
            <p>ผู้จัดทำ ({s.shopName})</p>
          </div>
          <div>
            <p>.................................................</p>
            <p>ผู้ตรวจสอบ (บริษัท ฟาร์มสุข)</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
