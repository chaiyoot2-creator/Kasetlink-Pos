import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Ban, FilePlus2, Loader2, Pencil, Plus, Printer, ReceiptText, Search, Trash2, UserRound, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Empty, ErrorBox, Field, Loading, NumberInput, PageHeader, TableWrap } from '@/components/common'
import { CustomerPicker } from '@/components/CustomerPicker'
import { ProductPicker } from '@/components/ProductPicker'
import { QuotationDoc, QuotationPrint, type Quotation, type QuotationDetail } from '@/components/QuotationDoc'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { useAuth } from '@/lib/auth'
import { addDaysISO, baht, dateOnly, qty, round2, todayISO } from '@/lib/format'
import { PRICE_LEVELS, levelName, resolvePrice, type PriceSource } from '@/lib/pricing'
import { printSoon } from '@/lib/print'
import type { Customer, CustomerPrice, Product } from '@/lib/types'
import { useApi, useDebounced } from '@/lib/use-api'
import { cn } from '@/lib/utils'

/** Key the POS reads to load a quotation into the cart. */
export const QUOTE_TO_SELL_KEY = 'kasetlink.quoteToSell'

const STATUS: Record<Quotation['status'], { label: string; variant: 'outline' | 'default' | 'secondary' | 'destructive' }> = {
  open: { label: 'รอลูกค้าตอบ', variant: 'outline' },
  expired: { label: 'หมดอายุ', variant: 'secondary' },
  converted: { label: 'เปลี่ยนเป็นบิลแล้ว', variant: 'default' },
  cancelled: { label: 'ยกเลิก', variant: 'destructive' },
}

export function QuotationsPage() {
  const [from, setFrom] = useState(addDaysISO(todayISO(), -60))
  const [to, setTo] = useState(todayISO())
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim())
  const list = useApi<Quotation[]>(`/quotations?from=${from}&to=${to}&q=${encodeURIComponent(dq)}`)
  const [editing, setEditing] = useState<QuotationDetail | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = list.data ?? []
  const openTotal = rows.filter((r) => r.status === 'open').reduce((s, r) => s + r.total, 0)

  return (
    <div>
      <PageHeader
        title="ใบเสนอราคา"
        subtitle={list.data ? `${rows.length} ใบ · รอลูกค้าตอบ ${baht(openTotal)} บาท` : undefined}
        actions={
          <Button className="cursor-pointer" onClick={() => setEditing('new')}>
            <FilePlus2 /> ออกใบเสนอราคา
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="ตั้งแต่">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </Field>
        <Field label="ถึง">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </Field>
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="เลขที่ / ชื่อลูกค้า" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {list.error ? <ErrorBox message={list.error} onRetry={() => void list.reload()} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && rows.length === 0 ? <Empty title="ยังไม่มีใบเสนอราคาในช่วงนี้" hint="กด “ออกใบเสนอราคา” เพื่อเริ่ม" /> : null}
      {rows.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เลขที่ / ลูกค้า</TableHead>
                <TableHead className="hidden sm:table-cell">วันที่ / ยืนราคาถึง</TableHead>
                <TableHead className="text-right">ยอดรวม</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={cn('cursor-pointer', r.status === 'cancelled' && 'opacity-50')} onClick={() => setOpenId(r.id)}>
                  <TableCell>
                    <p className="font-medium">{r.docNo}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.customerName} · {r.itemCount} รายการ
                    </p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {dateOnly(r.quoteDate)}
                    <p className="text-xs text-muted-foreground">ถึง {dateOnly(r.validUntil)}</p>
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">{baht(r.total)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                    {r.saleBillNo ? <p className="text-xs text-muted-foreground">{r.saleBillNo}</p> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}
      <QuotationView
        id={openId}
        onClose={() => setOpenId(null)}
        onEdit={(d) => {
          setOpenId(null)
          setEditing(d)
        }}
        onChanged={() => void list.reload()}
      />
      <QuotationEditor
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={(id) => {
          setEditing(null)
          void list.reload()
          setOpenId(id)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------- view / print / convert

function QuotationView({ id, onClose, onEdit, onChanged }: { id: string | null; onClose: () => void; onEdit: (d: QuotationDetail) => void; onChanged: () => void }) {
  const detail = useApi<QuotationDetail>(id ? `/quotations/${id}` : null)
  const d = id && detail.data?.id === id ? detail.data : null
  const { can } = useAuth()
  const [printing, setPrinting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setCancelling(false)
    setReason('')
  }, [id])
  useEffect(() => {
    if (!printing) return
    printSoon()
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [printing])

  const convert = () => {
    if (!d) return
    try {
      window.sessionStorage.setItem(QUOTE_TO_SELL_KEY, d.id)
    } catch {
      toast.error('เบราว์เซอร์นี้ส่งข้อมูลไปหน้าขายไม่ได้')
      return
    }
    window.location.hash = '#/pos'
  }

  const cancel = async () => {
    if (!d) return
    setBusy(true)
    try {
      await apiFetch(`/quotations/${d.id}/cancel`, { method: 'POST', body: { reason: reason.trim() } })
      toast.success(`ยกเลิก ${d.docNo} แล้ว`)
      await detail.reload()
      onChanged()
      setCancelling(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const editable = d && (d.status === 'open' || d.status === 'expired')
  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl grid-cols-1 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d ? `${d.docNo} · ${d.customerName}` : 'ใบเสนอราคา'}</DialogTitle>
          <DialogDescription>
            {d ? (
              <>
                <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
                {d.saleBillNo ? ` เปิดบิล ${d.saleBillNo} แล้ว` : ''}
                {d.cancelReason ? ` · ${d.cancelReason}` : ''}
              </>
            ) : (
              ' '
            )}
          </DialogDescription>
        </DialogHeader>
        {detail.error ? <ErrorBox message={detail.error} /> : null}
        {!d && !detail.error ? <Loading /> : null}
        {d ? (
          <div className="overflow-x-auto rounded-lg border">
            <div className="min-w-[640px]">
              <QuotationDoc q={d} />
            </div>
          </div>
        ) : null}
        {d?.status === 'expired' ? <p className="text-sm text-amber-700">เลยวันยืนราคาแล้ว — ยังเปลี่ยนเป็นบิลได้ แต่ควรตรวจราคากับต้นทุนปัจจุบันก่อน</p> : null}
        {cancelling ? (
          <Field label="เหตุผลที่ยกเลิก">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้าไม่ตกลง / ราคาเปลี่ยน" />
          </Field>
        ) : null}
        {printing && d ? <QuotationPrint q={d} /> : null}
        <DialogFooter className="flex-wrap">
          {editable && !cancelling ? (
            <>
              <Button variant="ghost" className="mr-auto cursor-pointer text-destructive" onClick={() => setCancelling(true)}>
                <Ban /> ยกเลิก
              </Button>
              <Button variant="outline" className="cursor-pointer" onClick={() => onEdit(d)}>
                <Pencil /> แก้ไข
              </Button>
            </>
          ) : null}
          {cancelling ? (
            <Button variant="destructive" className="cursor-pointer" disabled={!reason.trim() || busy} onClick={() => void cancel()}>
              {busy ? <Loader2 className="animate-spin" /> : null} ยืนยันยกเลิก
            </Button>
          ) : null}
          <Button variant="outline" className="cursor-pointer" disabled={!d} onClick={() => setPrinting(true)}>
            <Printer /> พิมพ์ / PDF
          </Button>
          {editable && can('pos.sell') ? (
            <Button className="cursor-pointer" onClick={convert}>
              <ReceiptText /> ลูกค้าตกลง → เปลี่ยนเป็นบิล
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- editor

interface Line {
  key: string
  product: Product
  qty: number
  unitPrice: number
  source: PriceSource
  edited: boolean
  discount: number
}

const NO_FIXED: ReadonlyMap<string, number> = new Map()

function QuotationEditor({ editing, onClose, onSaved }: { editing: QuotationDetail | 'new' | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { data: app, locationId } = useApp()
  const levelNames = app.settings.priceLevelNames
  const isNew = editing === 'new'
  const [quoteDate, setQuoteDate] = useState(todayISO())
  const [validDays, setValidDays] = useState<number | null>(15)
  const [customer, setCustomer] = useState<{ id: string; name: string; code: string } | null>(null)
  const [freeName, setFreeName] = useState('')
  const [level, setLevel] = useState(1)
  const [fixed, setFixed] = useState<ReadonlyMap<string, number>>(NO_FIXED)
  const [lines, setLines] = useState<Line[]>([])
  const [billDiscount, setBillDiscount] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [picking, setPicking] = useState<'customer' | 'product' | null>(null)
  const [busy, setBusy] = useState(false)

  // Load an existing quotation's lines with their current product data.
  useEffect(() => {
    if (!editing) return
    if (editing === 'new') {
      setQuoteDate(todayISO())
      setValidDays(15)
      setCustomer(null)
      setFreeName('')
      setLevel(1)
      setFixed(NO_FIXED)
      setLines([])
      setBillDiscount(null)
      setNote('')
      return
    }
    void (async () => {
      try {
        const full = await apiFetch<QuotationDetail & { products: Product[] }>(`/quotations/${editing.id}?locationId=${locationId}`)
        const byId = new Map(full.products.map((p) => [p.id, p]))
        setQuoteDate(full.quoteDate)
        setValidDays(Math.max(1, Math.round((Date.parse(full.validUntil) - Date.parse(full.quoteDate)) / 86400_000)))
        setCustomer(full.customerId ? { id: full.customerId, name: full.customerName, code: full.customerCode ?? '' } : null)
        setFreeName(full.customerId ? '' : full.customerName)
        setLevel(full.priceLevel)
        setBillDiscount(full.billDiscount || null)
        setNote(full.note ?? '')
        setLines(
          full.lines
            .filter((l) => byId.has(l.productId))
            .map((l) => ({
              key: crypto.randomUUID(),
              product: byId.get(l.productId)!,
              qty: l.qty,
              unitPrice: l.unitPrice,
              source: (l.priceSource as PriceSource | null) ?? 'manual',
              edited: true,
              discount: l.lineDiscount,
            })),
        )
        if (full.customerId) await loadFixed(full.customerId)
      } catch (err) {
        toast.error(errorMessage(err))
      }
    })()
    // Load when a different quotation is opened.
  }, [editing])

  const loadFixed = async (customerId: string) => {
    try {
      const rows = await apiFetch<CustomerPrice[]>(`/customers/${customerId}/prices`)
      const map = new Map(rows.map((r) => [r.productId, r.price]))
      setFixed(map)
      return map
    } catch {
      setFixed(NO_FIXED)
      return NO_FIXED
    }
  }

  const reprice = (lvl: number, fx: ReadonlyMap<string, number>) =>
    setLines((prev) => prev.map((l) => (l.edited ? l : { ...l, ...pricing(l.product, lvl, fx) })))
  const pricing = (p: Product, lvl: number, fx: ReadonlyMap<string, number>) => {
    const r = resolvePrice(p, lvl, fx)
    return { unitPrice: r.price, source: r.source }
  }

  const pickCustomer = async (c: Customer | null) => {
    setPicking(null)
    if (!c) {
      setCustomer(null)
      setFixed(NO_FIXED)
      return
    }
    setCustomer({ id: c.id, name: c.name, code: c.code })
    setLevel(c.priceLevel)
    const fx = c.fixedPriceCount > 0 ? await loadFixed(c.id) : NO_FIXED
    if (c.fixedPriceCount === 0) setFixed(NO_FIXED)
    reprice(c.priceLevel, fx)
  }

  const setLine = (key: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const subtotal = round2(lines.reduce((s, l) => s + round2(l.qty * l.unitPrice), 0))
  const lineDisc = round2(lines.reduce((s, l) => s + l.discount, 0))
  const bill = Math.min(billDiscount ?? 0, round2(subtotal - lineDisc))
  const total = round2(subtotal - lineDisc - bill)
  const valid = lines.length > 0 && lines.every((l) => l.qty > 0) && (customer || freeName.trim()) && (validDays ?? 0) > 0

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      const body = {
        quoteDate,
        validDays: validDays ?? 15,
        customerId: customer?.id ?? null,
        customerName: customer ? null : freeName.trim(),
        priceLevel: level,
        billDiscount: bill,
        note: note.trim() || null,
        lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty, unitPrice: l.unitPrice, lineDiscount: l.discount, priceSource: l.edited ? 'manual' : l.source })),
      }
      const res = await apiFetch<Quotation>(isNew ? '/quotations' : `/quotations/${editing.id}`, { method: isNew ? 'POST' : 'PUT', body })
      toast.success(isNew ? `ออกใบเสนอราคา ${res.docNo} แล้ว` : 'บันทึกการแก้ไขแล้ว')
      onSaved(res.id)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-h-[92vh] max-w-3xl grid-cols-1 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? 'ออกใบเสนอราคา' : `แก้ไข ${editing?.docNo ?? ''}`}</DialogTitle>
            <DialogDescription>ราคาใช้ตามระดับราคาและราคาฟิกซ์ของลูกค้า แก้ราคาแต่ละรายการได้ — ยังไม่ตัดสต็อกจนกว่าจะเปลี่ยนเป็นบิล</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_7rem] [&>*]:min-w-0">
            <Field label="ลูกค้า">
              {customer ? (
                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <span className="truncate">
                    <UserRound className="mr-1 inline size-4" />
                    {customer.name} <span className="text-muted-foreground">({customer.code})</span>
                  </span>
                  <Button variant="ghost" size="icon-sm" className="cursor-pointer" aria-label="ล้างลูกค้า" onClick={() => void pickCustomer(null)}>
                    <X />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input value={freeName} onChange={(e) => setFreeName(e.target.value)} placeholder="พิมพ์ชื่อ หรือเลือกจากรายชื่อ" />
                  <Button variant="outline" className="cursor-pointer" onClick={() => setPicking('customer')}>
                    เลือก
                  </Button>
                </div>
              )}
            </Field>
            <Field label="วันที่">
              <Input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
            </Field>
            <Field label="ยืนราคา (วัน)">
              <NumberInput value={validDays} onChange={setValidDays} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">ระดับราคา</span>
            <Select
              value={String(level)}
              onValueChange={(v) => {
                setLevel(Number(v))
                reprice(Number(v), fixed)
              }}
            >
              <SelectTrigger className="w-44 cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_LEVELS.map((l) => (
                  <SelectItem key={l} value={String(l)}>
                    {l}. {levelName(levelNames, l)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fixed.size > 0 ? <Badge variant="secondary">ราคาฟิกซ์ {fixed.size} รายการ</Badge> : null}
            <Button variant="outline" size="sm" className="ml-auto cursor-pointer" onClick={() => setPicking('product')}>
              <Plus /> เพิ่มสินค้า
            </Button>
          </div>

          {lines.length === 0 ? (
            <Empty title="ยังไม่มีสินค้า" hint="กด “เพิ่มสินค้า”" />
          ) : (
            <div className="grid gap-2">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_5rem_6.5rem_5.5rem_auto] items-end gap-2 rounded-lg border p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{l.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.edited ? 'แก้ราคาเอง' : l.source === 'fixed' ? 'ราคาฟิกซ์' : l.source === 'fallback' ? `ใช้ราคา${levelName(levelNames, 1)}` : levelName(levelNames, level)} · รวม{' '}
                      {baht(round2(l.qty * l.unitPrice - l.discount))}
                    </p>
                  </div>
                  <Field label={`จำนวน (${l.product.unit})`}>
                    <NumberInput value={l.qty} onChange={(v) => setLine(l.key, { qty: v ?? 0 })} />
                  </Field>
                  <Field label="ราคา/หน่วย">
                    <NumberInput value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v ?? 0, edited: true })} />
                  </Field>
                  <Field label="ส่วนลด">
                    <NumberInput value={l.discount || null} onChange={(v) => setLine(l.key, { discount: v ?? 0 })} />
                  </Field>
                  <Button variant="ghost" size="icon" className="cursor-pointer" aria-label="ลบ" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <Field label="หมายเหตุ / เงื่อนไข">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="เช่น ราคานี้รวมค่าส่งในเขต อ.เมือง · ชำระเงินสด" />
            </Field>
            <div className="grid content-start gap-1 rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex justify-between">
                <span>รวม</span>
                <span className="tabular">{baht(subtotal)}</span>
              </div>
              {lineDisc > 0 ? (
                <div className="flex justify-between">
                  <span>ส่วนลดรายการ</span>
                  <span className="tabular">-{baht(lineDisc)}</span>
                </div>
              ) : null}
              <Field label="ส่วนลดท้ายบิล">
                <NumberInput value={billDiscount} onChange={setBillDiscount} />
              </Field>
              <div className="flex justify-between border-t pt-1 text-base font-bold">
                <span>ยอดรวม</span>
                <span className="tabular">{baht(total)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{qty(lines.reduce((s, l) => s + l.qty, 0))} หน่วย</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button className="cursor-pointer" disabled={!valid || busy} onClick={() => void save()}>
              {busy ? <Loader2 className="animate-spin" /> : null} {isNew ? 'ออกใบเสนอราคา' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CustomerPicker open={picking === 'customer'} onClose={() => setPicking(null)} onPick={(c) => void pickCustomer(c)} />
      <ProductPicker
        open={picking === 'product'}
        locationId={locationId}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          setPicking(null)
          setLines((prev) => {
            const existing = prev.find((l) => l.product.id === p.id)
            if (existing) return prev.map((l) => (l.key === existing.key ? { ...l, qty: l.qty + 1 } : l))
            return [...prev, { key: crypto.randomUUID(), product: p, qty: 1, ...pricing(p, level, fixed), edited: false, discount: 0 }]
          })
        }}
      />
    </>
  )
}
