import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRightLeft, ClipboardCheck, Loader2, PackagePlus, Search, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Empty, ErrorBox, Field, Loading, LocationSelect, NumberInput, PageHeader, Stat, TableWrap } from '@/components/common'
import { ProductPicker } from '@/components/ProductPicker'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { ADJUST_REASON_LABEL, MOVEMENT_LABEL, baht, dateOnly, dateTime, daysUntil, qty, round3 } from '@/lib/format'
import { newEvent } from '@/lib/terminal'
import type { Lot, Movement, Product, StockBalance, StockDocument } from '@/lib/types'
import { useApi, useDebounced } from '@/lib/use-api'
import { cn } from '@/lib/utils'

export function StockPage() {
  const [tab, setTab] = useState('balances')
  return (
    <div>
      <PageHeader title="จัดการสต็อก" subtitle="ยอดคงเหลือแยกตามสาขา/โซน ล็อต วันหมดอายุ โอนย้าย และปรับยอด" />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="balances" className="cursor-pointer">ยอดคงเหลือ</TabsTrigger>
            <TabsTrigger value="lots" className="cursor-pointer">ล็อต/วันหมดอายุ</TabsTrigger>
            <TabsTrigger value="transfer" className="cursor-pointer">โอนย้าย</TabsTrigger>
            <TabsTrigger value="adjust" className="cursor-pointer">ปรับยอด</TabsTrigger>
            <TabsTrigger value="history" className="cursor-pointer">ความเคลื่อนไหว</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="balances" className="mt-3">
          <Balances />
        </TabsContent>
        <TabsContent value="lots" className="mt-3">
          <Lots />
        </TabsContent>
        <TabsContent value="transfer" className="mt-3">
          <TransferForm onDone={() => setTab('history')} />
        </TabsContent>
        <TabsContent value="adjust" className="mt-3">
          <AdjustmentForm onDone={() => setTab('history')} />
        </TabsContent>
        <TabsContent value="history" className="mt-3">
          <History />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------- balances

function Balances() {
  const { activeLocations } = useApp()
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim())
  const { data, error, loading, reload } = useApi<StockBalance[]>(`/stock/balances?q=${encodeURIComponent(dq)}`)
  const value = data?.reduce((s, b) => s + b.stockValue, 0) ?? 0
  const low = data?.filter((b) => b.isActive && b.reorderPoint > 0 && b.qtyTotal <= b.reorderPoint).length ?? 0

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="มูลค่าสต็อก (ทุนเฉลี่ย)" value={baht(value)} />
        <Stat label="จำนวนสินค้า" value={data?.length ?? '-'} />
        <Stat label="ต่ำกว่าจุดสั่งซื้อ" value={low} tone={low > 0 ? 'warn' : undefined} />
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="ค้นหาสินค้า" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? <Empty title="ไม่พบสินค้า" /> : null}
      {data && data.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>สินค้า</TableHead>
                {activeLocations.map((l) => (
                  <TableHead key={l.id} className="hidden text-right md:table-cell">
                    {l.name}
                  </TableHead>
                ))}
                <TableHead className="text-right">รวม</TableHead>
                <TableHead className="hidden text-right sm:table-cell">ทุนเฉลี่ย</TableHead>
                <TableHead className="hidden text-right lg:table-cell">มูลค่า</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((b) => {
                const isLow = b.reorderPoint > 0 && b.qtyTotal <= b.reorderPoint
                return (
                  <TableRow key={b.productId} className={cn(!b.isActive && 'opacity-50')}>
                    <TableCell>
                      <p className="font-medium">{b.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.sku}
                        {isLow ? <Badge variant="outline" className="ml-2 border-amber-500 text-amber-700">ใกล้หมด (จุดสั่ง {qty(b.reorderPoint)})</Badge> : null}
                      </p>
                    </TableCell>
                    {activeLocations.map((l) => (
                      <TableCell key={l.id} className="tabular hidden text-right md:table-cell">
                        {qty(b.byLocation[l.id] ?? 0)}
                      </TableCell>
                    ))}
                    <TableCell className={cn('tabular text-right font-semibold', isLow && 'text-amber-700')}>
                      {qty(b.qtyTotal)} <span className="text-xs font-normal text-muted-foreground">{b.unit}</span>
                    </TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{baht(b.avgCost)}</TableCell>
                    <TableCell className="tabular hidden text-right lg:table-cell">{baht(b.stockValue)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- lots

export function ExpiryBadge({ date }: { date: string | null }) {
  const d = daysUntil(date)
  if (d === null) return <span className="text-muted-foreground">-</span>
  if (d < 0) return <Badge variant="destructive">หมดอายุแล้ว {dateOnly(date)}</Badge>
  if (d <= 30) return <Badge className="bg-amber-500 text-white hover:bg-amber-500">อีก {d} วัน · {dateOnly(date)}</Badge>
  return <span className="text-sm">{dateOnly(date)}</span>
}

function Lots() {
  const [locationId, setLocationId] = useState('')
  const { data, error, loading, reload } = useApi<Lot[]>(`/stock/lots?locationId=${locationId}`)
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <LocationSelect value={locationId} onChange={setLocationId} placeholder="ทุกสาขา/โซน" />
        </div>
        {locationId ? (
          <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setLocationId('')}>
            ดูทุกสาขา
          </Button>
        ) : null}
      </div>
      {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? <Empty title="ไม่มีล็อตที่มีสต็อก" /> : null}
      {data && data.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>สินค้า</TableHead>
                <TableHead>ล็อต</TableHead>
                <TableHead>วันหมดอายุ</TableHead>
                <TableHead className="hidden md:table-cell">ที่เก็บ</TableHead>
                <TableHead className="text-right">คงเหลือ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.productName}</TableCell>
                  <TableCell>{l.lotNo || '-'}</TableCell>
                  <TableCell>
                    <ExpiryBadge date={l.expiryDate} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{l.locationName}</TableCell>
                  <TableCell className="tabular text-right">
                    {qty(l.qty)} <span className="text-xs text-muted-foreground">{l.unit}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- transfer

interface QtyLine {
  key: string
  product: Product
  qty: number | null
}

function TransferForm({ onDone }: { onDone: () => void }) {
  const app = useApp()
  const [from, setFrom] = useState(app.locationId)
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<QtyLine[]>([])
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  const problems = lines.filter((l) => (l.qty ?? 0) > l.product.qtyHere).map((l) => `${l.product.name} มีที่ต้นทาง ${qty(l.product.qtyHere)}`)
  const valid = from && to && from !== to && lines.length > 0 && lines.every((l) => (l.qty ?? 0) > 0) && problems.length === 0

  const save = async () => {
    setBusy(true)
    try {
      const res = await apiFetch<{ docNo: string }>('/transfers', {
        method: 'POST',
        body: { ...newEvent(), fromLocationId: from, toLocationId: to, note: note.trim() || null, lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty })) },
      })
      toast.success(`โอนย้าย ${res.docNo} เรียบร้อย`)
      setLines([])
      setNote('')
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid max-w-3xl gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <Field label="จาก">
          <LocationSelect
            value={from}
            onChange={(v) => {
              setFrom(v)
              setLines([])
            }}
          />
        </Field>
        <ArrowRightLeft className="mx-auto hidden size-5 text-muted-foreground sm:mb-2 sm:block" />
        <Field label="ไปยัง">
          <LocationSelect value={to} onChange={setTo} exclude={from} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">ระบบตัดล็อตที่หมดอายุก่อนออกก่อน (FEFO) และย้ายล็อต/วันหมดอายุไปปลายทางให้อัตโนมัติ</p>
      <QtyLines lines={lines} setLines={setLines} showHere />
      <Button variant="outline" className="cursor-pointer" onClick={() => setPicker(true)} disabled={!from}>
        <PackagePlus /> เพิ่มสินค้า
      </Button>
      <Field label="หมายเหตุ">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
      {problems.length > 0 ? <p className="text-sm text-destructive">{problems.join(' · ')}</p> : null}
      <Button className="cursor-pointer justify-self-start" disabled={!valid || busy} onClick={() => void save()}>
        {busy ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />} บันทึกการโอนย้าย
      </Button>
      <ProductPicker
        open={picker}
        locationId={from}
        onClose={() => setPicker(false)}
        onPick={(p) => setLines((prev) => (prev.some((x) => x.product.id === p.id) ? prev : [...prev, { key: crypto.randomUUID(), product: p, qty: null }]))}
      />
    </div>
  )
}

function QtyLines({ lines, setLines, showHere }: { lines: QtyLine[]; setLines: (fn: (prev: QtyLine[]) => QtyLine[]) => void; showHere?: boolean }) {
  if (lines.length === 0) return <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">ยังไม่มีรายการสินค้า</p>
  return (
    <div className="grid gap-2">
      {lines.map((l) => (
        <div key={l.key} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2 rounded-lg border p-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{l.product.name}</p>
            {showHere ? <p className="text-xs text-muted-foreground">มี {qty(l.product.qtyHere)} {l.product.unit}</p> : null}
          </div>
          <NumberInput value={l.qty} onChange={(v) => setLines((p) => p.map((x) => (x.key === l.key ? { ...x, qty: v } : x)))} placeholder={l.product.unit} />
          <Button variant="ghost" size="icon" className="cursor-pointer" aria-label="ลบ" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- adjustment

type Mode = 'count' | 'delta'

interface AdjLine {
  key: string
  product: Product
  /** count mode: counted qty; delta mode: +/- change */
  value: number | null
  direction: 'in' | 'out'
  lotNo: string
  expiryDate: string
  unitCost: number | null
}

function AdjustmentForm({ onDone }: { onDone: () => void }) {
  const app = useApp()
  const [locationId, setLocationId] = useState(app.locationId)
  const [reason, setReason] = useState<keyof typeof ADJUST_REASON_LABEL>('count')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<AdjLine[]>([])
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const mode: Mode = reason === 'count' ? 'count' : 'delta'
  const incomingOnly = reason === 'opening'
  const outgoingOnly = reason === 'damaged' || reason === 'expired' || reason === 'lost' || reason === 'internal_use'

  useEffect(() => {
    setLines((prev) => prev.map((l) => ({ ...l, direction: incomingOnly ? 'in' : outgoingOnly ? 'out' : l.direction })))
  }, [incomingOnly, outgoingOnly])

  const change = (l: AdjLine): number => {
    if (l.value === null) return 0
    if (mode === 'count') return round3(l.value - l.product.qtyHere)
    return l.direction === 'in' ? l.value : -l.value
  }

  const effective = lines.filter((l) => change(l) !== 0)
  const valid = locationId && effective.length > 0 && (reason !== 'other' || note.trim().length > 0)

  const save = async () => {
    setBusy(true)
    try {
      const res = await apiFetch<{ docNo: string }>('/adjustments', {
        method: 'POST',
        body: {
          ...newEvent(),
          locationId,
          reasonCode: reason,
          note: note.trim() || null,
          lines: effective.map((l) => ({
            productId: l.product.id,
            qtyChange: change(l),
            lotNo: l.lotNo.trim() || null,
            expiryDate: l.expiryDate || null,
            unitCost: change(l) > 0 && l.unitCost !== null ? l.unitCost : null,
          })),
        },
      })
      toast.success(`ปรับยอด ${res.docNo} เรียบร้อย`)
      setLines([])
      setNote('')
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid max-w-3xl gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="สาขา/โซน">
          <LocationSelect
            value={locationId}
            onChange={(v) => {
              setLocationId(v)
              setLines([])
            }}
          />
        </Field>
        <Field label="เหตุผล">
          <Select value={reason} onValueChange={(v) => setReason(v as keyof typeof ADJUST_REASON_LABEL)}>
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ADJUST_REASON_LABEL).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === 'count'
          ? 'ใส่จำนวนที่นับได้จริง ระบบคำนวณส่วนต่างให้ (ขาด = ตัดล็อตที่หมดอายุก่อน, เกิน = เพิ่มเข้าล็อตที่ระบุ)'
          : incomingOnly
            ? 'ยอดยกมา: ใส่จำนวน ต้นทุนต่อหน่วย ล็อตและวันหมดอายุ เพื่อตั้งต้นทุนถัวเฉลี่ย'
            : 'ใส่จำนวนที่ต้องการตัดออก/เพิ่ม ระบบบันทึกเหตุผลไว้ทุกรายการ'}
      </p>

      {lines.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">ยังไม่มีรายการสินค้า</p> : null}
      {lines.map((l) => {
        const diff = change(l)
        const upd = (patch: Partial<AdjLine>) => setLines((p) => p.map((x) => (x.key === l.key ? { ...x, ...patch } : x)))
        return (
          <div key={l.key} className="grid gap-2 rounded-lg border p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{l.product.name}</p>
                <p className="text-xs text-muted-foreground">
                  ในระบบ {qty(l.product.qtyHere)} {l.product.unit} · ทุนเฉลี่ย {baht(l.product.avgCost)}
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" className="cursor-pointer" aria-label="ลบ" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>
                <Trash2 />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {mode === 'delta' && !incomingOnly && !outgoingOnly ? (
                <Field label="ทิศทาง">
                  <Select value={l.direction} onValueChange={(v) => upd({ direction: v === 'in' ? 'in' : 'out' })}>
                    <SelectTrigger className="w-full cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="out">ตัดออก (−)</SelectItem>
                      <SelectItem value="in">เพิ่มเข้า (+)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              <Field label={mode === 'count' ? 'นับได้' : 'จำนวน'}>
                <NumberInput value={l.value} onChange={(v) => upd({ value: v })} placeholder={l.product.unit} />
              </Field>
              {diff > 0 ? (
                <>
                  <Field label="เลขล็อต">
                    <Input value={l.lotNo} onChange={(e) => upd({ lotNo: e.target.value })} placeholder="-" />
                  </Field>
                  <Field label={l.product.trackExpiry ? 'วันหมดอายุ *' : 'วันหมดอายุ'}>
                    <Input type="date" value={l.expiryDate} onChange={(e) => upd({ expiryDate: e.target.value })} />
                  </Field>
                  {incomingOnly ? (
                    <Field label="ทุน/หน่วย">
                      <NumberInput value={l.unitCost} onChange={(v) => upd({ unitCost: v })} />
                    </Field>
                  ) : null}
                </>
              ) : null}
            </div>
            {l.value !== null ? (
              <p className={cn('tabular text-sm font-medium', diff < 0 ? 'text-destructive' : diff > 0 ? 'text-primary' : 'text-muted-foreground')}>
                ส่วนต่าง {diff > 0 ? '+' : ''}
                {qty(diff)} {l.product.unit}
              </p>
            ) : null}
          </div>
        )
      })}
      <Button variant="outline" className="cursor-pointer" onClick={() => setPicker(true)} disabled={!locationId}>
        <PackagePlus /> เพิ่มสินค้า
      </Button>
      <Field label={reason === 'other' ? 'หมายเหตุ (จำเป็น)' : 'หมายเหตุ'}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
      <Button className="cursor-pointer justify-self-start" disabled={!valid || busy} onClick={() => void save()}>
        {busy ? <Loader2 className="animate-spin" /> : <ClipboardCheck />} บันทึกปรับยอด
      </Button>
      <ProductPicker
        open={picker}
        locationId={locationId}
        onClose={() => setPicker(false)}
        onPick={(p) =>
          setLines((prev) =>
            prev.some((x) => x.product.id === p.id)
              ? prev
              : [
                  ...prev,
                  {
                    key: crypto.randomUUID(),
                    product: p,
                    value: null,
                    direction: incomingOnly ? 'in' : 'out',
                    lotNo: '',
                    expiryDate: '',
                    unitCost: p.avgCost > 0 ? p.avgCost : null,
                  },
                ],
          )
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------- history

function History() {
  const [view, setView] = useState<'movements' | 'documents'>('movements')
  const [locationId, setLocationId] = useState('')
  const movements = useApi<Movement[]>(view === 'movements' ? `/stock/movements?locationId=${locationId}&limit=300` : null)
  const documents = useApi<StockDocument[]>(view === 'documents' ? '/stock/documents' : null)

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(['movements', 'documents'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn('cursor-pointer rounded-md px-3 py-1 text-sm', view === v ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground')}
            >
              {v === 'movements' ? 'รายการเคลื่อนไหว' : 'เอกสารโอน/ปรับยอด'}
            </button>
          ))}
        </div>
        {view === 'movements' ? (
          <div className="w-56">
            <LocationSelect value={locationId} onChange={setLocationId} placeholder="ทุกสาขา/โซน" />
          </div>
        ) : null}
      </div>

      {view === 'movements' ? (
        <>
          {movements.error ? <ErrorBox message={movements.error} onRetry={() => void movements.reload()} /> : null}
          {movements.loading && !movements.data ? <Loading /> : null}
          {movements.data?.length === 0 ? <Empty title="ยังไม่มีความเคลื่อนไหว" /> : null}
          {movements.data && movements.data.length > 0 ? (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เวลา</TableHead>
                    <TableHead>ประเภท</TableHead>
                    <TableHead>สินค้า</TableHead>
                    <TableHead className="hidden md:table-cell">ที่เก็บ / ล็อต</TableHead>
                    <TableHead className="text-right">จำนวน</TableHead>
                    <TableHead className="hidden lg:table-cell">อ้างอิง</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.data.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(m.occurredAt)}</TableCell>
                      <TableCell>{MOVEMENT_LABEL[m.movementType]}</TableCell>
                      <TableCell>
                        {m.productName}
                        {m.reason ? <p className="text-xs text-muted-foreground">{m.reason}</p> : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {m.locationName}
                        <p className="text-xs text-muted-foreground">
                          {m.lotNo ? `ล็อต ${m.lotNo}` : ''} {m.expiryDate ? `หมดอายุ ${dateOnly(m.expiryDate)}` : ''}
                        </p>
                      </TableCell>
                      <TableCell className={cn('tabular text-right font-medium', m.qtyChange < 0 ? 'text-destructive' : 'text-primary')}>
                        {m.qtyChange > 0 ? '+' : ''}
                        {qty(m.qtyChange)}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {m.docNo}
                        <p title={m.eventId}>เครื่อง {m.terminalId}</p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          ) : null}
        </>
      ) : (
        <>
          {documents.error ? <ErrorBox message={documents.error} onRetry={() => void documents.reload()} /> : null}
          {documents.loading && !documents.data ? <Loading /> : null}
          {documents.data?.length === 0 ? <Empty title="ยังไม่มีเอกสาร" /> : null}
          {documents.data && documents.data.length > 0 ? (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่</TableHead>
                    <TableHead>วันที่</TableHead>
                    <TableHead>รายละเอียด</TableHead>
                    <TableHead className="text-right">รายการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.data.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.docNo}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(d.occurredAt)}</TableCell>
                      <TableCell>
                        {d.docType === 'transfer' ? `${d.fromName} → ${d.toName}` : `${ADJUST_REASON_LABEL[d.reasonCode ?? ''] ?? ''} · ${d.fromName}`}
                        {d.note ? <p className="text-xs text-muted-foreground">{d.note}</p> : null}
                      </TableCell>
                      <TableCell className="tabular text-right">{d.itemCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          ) : null}
        </>
      )}
    </div>
  )
}
