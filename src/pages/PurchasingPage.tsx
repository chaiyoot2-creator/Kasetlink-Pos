import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Ban, Loader2, PackagePlus, Plus, Trash2, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Empty, ErrorBox, Field, Loading, LocationSelect, NumberInput, PageHeader, TableWrap } from '@/components/common'
import { ProductPicker } from '@/components/ProductPicker'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { PO_STATUS_LABEL, baht, dateOnly, dateTime, qty, round2, round3 } from '@/lib/format'
import { newEvent } from '@/lib/terminal'
import type { Product, PurchaseOrder, PurchaseOrderDetail, ReceiptSummary, Supplier } from '@/lib/types'
import { useApi } from '@/lib/use-api'

export function PurchasingPage() {
  const [tab, setTab] = useState('po')
  const [status, setStatus] = useState('pending')
  const pos = useApi<PurchaseOrder[]>(`/purchase-orders?status=${status === 'all' ? '' : status}`)
  const receipts = useApi<ReceiptSummary[]>(tab === 'receipts' ? '/receipts' : null)
  const [createOpen, setCreateOpen] = useState(false)
  const [directOpen, setDirectOpen] = useState(false)
  const [poId, setPoId] = useState<string | null>(null)

  return (
    <div>
      <PageHeader
        title="รับเข้าสินค้า"
        subtitle="สั่งซื้อ รับของบางส่วนได้ บันทึกล็อตและวันหมดอายุ ต้นทุนถัวเฉลี่ยคำนวณให้อัตโนมัติ"
        actions={
          <>
            <Button variant="outline" className="cursor-pointer" onClick={() => setDirectOpen(true)}>
              <Truck /> รับของ (ไม่มี PO)
            </Button>
            <Button className="cursor-pointer" onClick={() => setCreateOpen(true)}>
              <Plus /> สร้างใบสั่งซื้อ
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="po" className="cursor-pointer">ใบสั่งซื้อ (PO)</TabsTrigger>
          <TabsTrigger value="receipts" className="cursor-pointer">ประวัติการรับ</TabsTrigger>
        </TabsList>

        <TabsContent value="po" className="mt-3">
          <div className="mb-3 w-48">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">ค้างรับ</SelectItem>
                <SelectItem value="received">รับครบแล้ว</SelectItem>
                <SelectItem value="cancelled">ยกเลิก</SelectItem>
                <SelectItem value="all">ทั้งหมด</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {pos.error ? <ErrorBox message={pos.error} onRetry={() => void pos.reload()} /> : null}
          {pos.loading && !pos.data ? <Loading /> : null}
          {pos.data?.length === 0 ? <Empty title="ไม่มีใบสั่งซื้อ" hint="กด “สร้างใบสั่งซื้อ” เพื่อสั่งของจากผู้จำหน่าย" /> : null}
          {pos.data && pos.data.length > 0 ? (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่ PO</TableHead>
                    <TableHead>ผู้จำหน่าย</TableHead>
                    <TableHead className="hidden md:table-cell">รับเข้าที่</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right">ยอดสั่ง</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pos.data.map((po) => (
                    <TableRow key={po.id} className="cursor-pointer" onClick={() => setPoId(po.id)}>
                      <TableCell className="font-medium">
                        {po.poNo}
                        <p className="text-xs font-normal text-muted-foreground">{dateOnly(po.orderDate)}</p>
                      </TableCell>
                      <TableCell>{po.supplierName}</TableCell>
                      <TableCell className="hidden md:table-cell">{po.locationName}</TableCell>
                      <TableCell>
                        <PoStatus status={po.status} percent={po.receivedPercent} />
                      </TableCell>
                      <TableCell className="tabular text-right">{baht(po.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          ) : null}
        </TabsContent>

        <TabsContent value="receipts" className="mt-3">
          {receipts.error ? <ErrorBox message={receipts.error} onRetry={() => void receipts.reload()} /> : null}
          {receipts.loading && !receipts.data ? <Loading /> : null}
          {receipts.data?.length === 0 ? <Empty title="ยังไม่มีการรับสินค้า" /> : null}
          {receipts.data && receipts.data.length > 0 ? (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่ใบรับ</TableHead>
                    <TableHead>วันที่</TableHead>
                    <TableHead className="hidden sm:table-cell">PO</TableHead>
                    <TableHead className="hidden md:table-cell">ผู้จำหน่าย</TableHead>
                    <TableHead className="text-right">มูลค่า</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.receiptNo}
                        {r.supplierInvoiceNo ? <p className="text-xs font-normal text-muted-foreground">บิลผู้ขาย {r.supplierInvoiceNo}</p> : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{dateTime(r.receivedAt)}</TableCell>
                      <TableCell className="hidden sm:table-cell">{r.poNo ?? '-'}</TableCell>
                      <TableCell className="hidden md:table-cell">{r.supplierName ?? '-'}</TableCell>
                      <TableCell className="tabular text-right">{baht(r.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          ) : null}
        </TabsContent>
      </Tabs>

      <CreatePoDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          void pos.reload()
          setPoId(id)
        }}
      />
      <PoDetailDialog
        id={poId}
        onClose={() => setPoId(null)}
        onChanged={() => {
          void pos.reload()
          void receipts.reload()
        }}
      />
      <ReceiveDialog
        open={directOpen}
        po={null}
        onClose={() => setDirectOpen(false)}
        onDone={() => {
          setTab('receipts')
          void receipts.reload()
        }}
      />
    </div>
  )
}

function PoStatus({ status, percent }: { status: PurchaseOrder['status']; percent: number }) {
  const variant = status === 'cancelled' ? 'destructive' : status === 'received' ? 'default' : 'secondary'
  return (
    <Badge variant={variant}>
      {PO_STATUS_LABEL[status]}
      {status === 'partial' ? ` ${percent}%` : ''}
    </Badge>
  )
}

// ---------------------------------------------------------------- create PO

interface DraftLine {
  key: string
  product: Product
  qty: number | null
  cost: number | null
}

function SupplierSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useApi<Supplier[]>('/suppliers')
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="w-full cursor-pointer">
        <SelectValue placeholder={data?.length === 0 ? 'ยังไม่มีผู้จำหน่าย — เพิ่มที่เมนูข้อมูลหลัก' : 'เลือกผู้จำหน่าย'} />
      </SelectTrigger>
      <SelectContent>
        {data
          ?.filter((s) => s.isActive)
          .map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

function CreatePoDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const app = useApp()
  const [supplierId, setSupplierId] = useState('')
  const [locationId, setLocationId] = useState(app.locationId)
  const [expected, setExpected] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setSupplierId('')
      setLocationId(app.locationId)
      setExpected('')
      setNote('')
      setLines([])
    }
  }, [open, app.locationId])

  const total = round2(lines.reduce((s, l) => s + (l.qty ?? 0) * (l.cost ?? 0), 0))
  const valid = supplierId && locationId && lines.length > 0 && lines.every((l) => (l.qty ?? 0) > 0 && l.cost !== null && l.cost >= 0)

  const save = async () => {
    setBusy(true)
    try {
      const res = await apiFetch<{ id: string; poNo: string }>('/purchase-orders', {
        method: 'POST',
        body: {
          ...newEvent(),
          supplierId,
          locationId,
          expectedDate: expected || null,
          note: note.trim() || null,
          lines: lines.map((l) => ({ productId: l.product.id, qtyOrdered: l.qty, unitCost: l.cost })),
        },
      })
      toast.success(`สร้าง ${res.poNo} แล้ว`)
      onClose()
      onCreated(res.id)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>สร้างใบสั่งซื้อ</DialogTitle>
          <DialogDescription>ใส่ต้นทุนต่อหน่วยตามใบเสนอราคา (แก้ได้ตอนรับของจริง)</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ผู้จำหน่าย">
            <SupplierSelect value={supplierId} onChange={setSupplierId} />
          </Field>
          <Field label="รับเข้าที่ (สาขา/โซน)">
            <LocationSelect value={locationId} onChange={setLocationId} />
          </Field>
          <Field label="วันที่คาดว่าจะได้รับ">
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          <Field label="หมายเหตุ">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-2">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_7rem_8rem_auto]">
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <p className="truncate text-sm font-medium">{l.product.name}</p>
                <p className="text-xs text-muted-foreground">ต้นทุนเฉลี่ยปัจจุบัน {baht(l.product.avgCost)}</p>
              </div>
              <Field label={`จำนวน (${l.product.unit})`}>
                <NumberInput value={l.qty} onChange={(v) => setLines((p) => p.map((x) => (x.key === l.key ? { ...x, qty: v } : x)))} />
              </Field>
              <Field label="ต้นทุน/หน่วย">
                <NumberInput value={l.cost} onChange={(v) => setLines((p) => p.map((x) => (x.key === l.key ? { ...x, cost: v } : x)))} />
              </Field>
              <Button variant="ghost" size="icon" className="cursor-pointer" aria-label="ลบรายการ" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" className="cursor-pointer" onClick={() => setPicker(true)}>
            <PackagePlus /> เพิ่มสินค้า
          </Button>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <p className="tabular text-sm">
            รวม <span className="text-lg font-semibold">{baht(total)}</span> บาท
          </p>
          <Button className="cursor-pointer" disabled={!valid || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึกใบสั่งซื้อ
          </Button>
        </DialogFooter>
        <ProductPicker
          open={picker}
          onClose={() => setPicker(false)}
          onPick={(p) =>
            setLines((prev) =>
              prev.some((x) => x.product.id === p.id)
                ? prev
                : [...prev, { key: crypto.randomUUID(), product: p, qty: null, cost: p.avgCost > 0 ? round2(p.avgCost) : null }],
            )
          }
        />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- PO detail

function PoDetailDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<PurchaseOrderDetail>(id ? `/purchase-orders/${id}` : null)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const po = id && detail.data?.id === id ? detail.data : null
  const pending = po?.status === 'open' || po?.status === 'partial'

  const cancel = async () => {
    if (!po) return
    setBusy(true)
    try {
      await apiFetch(`/purchase-orders/${po.id}/cancel`, { method: 'POST', body: { ...newEvent(), reason: reason.trim() } })
      toast.success(`ยกเลิก ${po.poNo} แล้ว`)
      setCancelling(false)
      onChanged()
      void detail.reload()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {po?.poNo ?? 'ใบสั่งซื้อ'} {po ? <PoStatus status={po.status} percent={po.receivedPercent} /> : null}
            </DialogTitle>
            <DialogDescription>{po ? `${po.supplierName} · รับเข้าที่ ${po.locationName}` : ' '}</DialogDescription>
          </DialogHeader>
          {detail.error ? <ErrorBox message={detail.error} /> : null}
          {!po && !detail.error ? <Loading /> : null}
          {po ? (
            <>
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>สินค้า</TableHead>
                      <TableHead className="text-right">สั่ง</TableHead>
                      <TableHead className="text-right">รับแล้ว</TableHead>
                      <TableHead className="text-right">ค้างรับ</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">ทุน/หน่วย</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {po.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.productName}</TableCell>
                        <TableCell className="tabular text-right">{qty(l.qtyOrdered)}</TableCell>
                        <TableCell className="tabular text-right">{qty(l.qtyReceived)}</TableCell>
                        <TableCell className="tabular text-right font-medium">{qty(round3(l.qtyOrdered - l.qtyReceived))}</TableCell>
                        <TableCell className="tabular hidden text-right sm:table-cell">{baht(l.unitCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
              {po.receipts.length > 0 ? (
                <div className="text-sm">
                  <p className="mb-1 font-medium">ประวัติการรับของ PO นี้</p>
                  <ul className="space-y-1 text-muted-foreground">
                    {po.receipts.map((r) => (
                      <li key={r.id} className="tabular flex justify-between">
                        <span>
                          {r.receiptNo} · {dateTime(r.receivedAt)}
                        </span>
                        <span>{baht(r.total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {cancelling ? (
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลที่ยกเลิก (ส่วนที่ยังไม่ได้รับ)" />
              ) : null}
            </>
          ) : null}
          <DialogFooter>
            {pending && !cancelling ? (
              <Button variant="outline" className="cursor-pointer text-destructive" onClick={() => setCancelling(true)}>
                <Ban /> ยกเลิก PO
              </Button>
            ) : null}
            {cancelling ? (
              <Button variant="destructive" className="cursor-pointer" disabled={busy || reason.trim().length < 2} onClick={() => void cancel()}>
                {busy ? <Loader2 className="animate-spin" /> : null} ยืนยันยกเลิก
              </Button>
            ) : null}
            {pending && !cancelling ? (
              <Button className="cursor-pointer" onClick={() => setReceiveOpen(true)}>
                <Truck /> รับสินค้า
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReceiveDialog
        open={receiveOpen}
        po={po}
        onClose={() => setReceiveOpen(false)}
        onDone={() => {
          onChanged()
          void detail.reload()
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------- receive (partial, lots, expiry)

interface ReceiveLine {
  key: string
  poLineId: string | null
  productId: string
  productName: string
  unit: string
  trackExpiry: boolean
  remaining: number | null
  qty: number | null
  cost: number | null
  lotNo: string
  expiryDate: string
}

function ReceiveDialog({ open, po, onClose, onDone }: { open: boolean; po: PurchaseOrderDetail | null; onClose: () => void; onDone: () => void }) {
  const app = useApp()
  const [locationId, setLocationId] = useState(app.locationId)
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<ReceiveLine[]>([])
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [event, setEvent] = useState(newEvent)

  useEffect(() => {
    if (!open) return
    setEvent(newEvent())
    setInvoiceNo('')
    setNote('')
    setSupplierId('')
    if (po) {
      setLocationId(po.locationId)
      setLines(
        po.lines
          .filter((l) => l.qtyOrdered > l.qtyReceived)
          .map((l) => {
            const remaining = round3(l.qtyOrdered - l.qtyReceived)
            return {
              key: l.id,
              poLineId: l.id,
              productId: l.productId,
              productName: l.productName,
              unit: l.unit,
              trackExpiry: l.trackExpiry,
              remaining,
              qty: remaining,
              cost: l.unitCost,
              lotNo: '',
              expiryDate: '',
            }
          }),
      )
    } else {
      setLocationId(app.locationId)
      setLines([])
    }
  }, [open, po, app.locationId])

  const update = (key: string, patch: Partial<ReceiveLine>) => setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const active = lines.filter((l) => (l.qty ?? 0) > 0)
  const problems = active.flatMap((l) => {
    const out: string[] = []
    if (l.remaining !== null && (l.qty ?? 0) > l.remaining) out.push(`${l.productName}: รับเกินค้างรับ`)
    if (l.trackExpiry && !l.expiryDate) out.push(`${l.productName}: ต้องระบุวันหมดอายุ`)
    if (l.cost === null) out.push(`${l.productName}: ต้องระบุต้นทุน`)
    return out
  })
  const total = round2(active.reduce((s, l) => s + (l.qty ?? 0) * (l.cost ?? 0), 0))
  const valid = locationId && active.length > 0 && problems.length === 0

  const save = async () => {
    setBusy(true)
    try {
      const res = await apiFetch<{ receiptNo: string; duplicate: boolean }>('/receipts', {
        method: 'POST',
        body: {
          ...event,
          locationId,
          poId: po?.id ?? null,
          supplierId: po ? null : supplierId || null,
          supplierInvoiceNo: invoiceNo.trim() || null,
          note: note.trim() || null,
          lines: active.map((l) => ({
            poLineId: l.poLineId,
            productId: l.productId,
            qty: l.qty,
            unitCost: l.cost,
            lotNo: l.lotNo.trim() || null,
            expiryDate: l.expiryDate || null,
          })),
        },
      })
      toast.success(`รับสินค้า ${res.receiptNo} เข้าสต็อกแล้ว`)
      onClose()
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{po ? `รับสินค้าตาม ${po.poNo}` : 'รับสินค้า (ไม่มีใบสั่งซื้อ)'}</DialogTitle>
          <DialogDescription>รับไม่ครบได้ — ใส่จำนวนที่ได้รับจริง ส่วนที่เหลือจะค้างรับใน PO</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="รับเข้าที่">
            <LocationSelect value={locationId} onChange={setLocationId} />
          </Field>
          {po ? null : (
            <Field label="ผู้จำหน่าย (ถ้ามี)">
              <SupplierSelect value={supplierId} onChange={setSupplierId} />
            </Field>
          )}
          <Field label="เลขที่บิลผู้ขาย">
            <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-2">
          {lines.map((l) => (
            <div key={l.key} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_6rem_7rem_7rem_9rem_auto] sm:items-end">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{l.productName}</p>
                {l.remaining !== null ? <p className="text-xs text-muted-foreground">ค้างรับ {qty(l.remaining)} {l.unit}</p> : null}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:contents">
                <Field label={`รับ (${l.unit})`}>
                  <NumberInput value={l.qty} onChange={(v) => update(l.key, { qty: v })} />
                </Field>
                <Field label="ทุน/หน่วย">
                  <NumberInput value={l.cost} onChange={(v) => update(l.key, { cost: v })} />
                </Field>
                <Field label="เลขล็อต">
                  <Input value={l.lotNo} onChange={(e) => update(l.key, { lotNo: e.target.value })} placeholder="-" />
                </Field>
                <Field label={l.trackExpiry ? 'วันหมดอายุ *' : 'วันหมดอายุ'}>
                  <Input type="date" value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} />
                </Field>
              </div>
              <Button variant="ghost" size="icon" className="cursor-pointer justify-self-end" aria-label="ไม่รับรายการนี้" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          {po ? null : (
            <Button variant="outline" className="cursor-pointer" onClick={() => setPicker(true)}>
              <PackagePlus /> เพิ่มสินค้า
            </Button>
          )}
        </div>
        <Field label="หมายเหตุ">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        {problems.length > 0 ? <p className="text-sm text-destructive">{problems.join(' · ')}</p> : null}
        <DialogFooter className="items-center sm:justify-between">
          <p className="tabular text-sm">
            มูลค่ารับเข้า <span className="text-lg font-semibold">{baht(total)}</span> บาท
          </p>
          <Button className="cursor-pointer" disabled={!valid || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : <Truck />} บันทึกรับเข้าสต็อก
          </Button>
        </DialogFooter>
        <ProductPicker
          open={picker}
          onClose={() => setPicker(false)}
          onPick={(p) =>
            setLines((prev) => [
              ...prev,
              {
                key: crypto.randomUUID(),
                poLineId: null,
                productId: p.id,
                productName: p.name,
                unit: p.unit,
                trackExpiry: p.trackExpiry,
                remaining: null,
                qty: null,
                cost: p.avgCost > 0 ? round2(p.avgCost) : null,
                lotNo: '',
                expiryDate: '',
              },
            ])
          }
        />
      </DialogContent>
    </Dialog>
  )
}
