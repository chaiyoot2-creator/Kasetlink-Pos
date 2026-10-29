import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, MapPinOff, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Empty, ErrorBox, Field, Loading, NumberInput, Stat, TableWrap } from '@/components/common'
import { ProductPicker } from '@/components/ProductPicker'
import { apiFetch, errorMessage } from '@/lib/api'
import { dateOnly, qty, round3 } from '@/lib/format'
import type { Product } from '@/lib/types'
import type { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { ORDER_STATUS_LABEL, kg, unitWeightKg, type DeliveryOrder, type Place } from './types'

/** Orders for one delivery date: list, totals, add, and status changes. */
export function OrdersTab({
  date,
  setDate,
  orders,
  places,
}: {
  date: string
  setDate: (d: string) => void
  orders: ReturnType<typeof useApi<DeliveryOrder[]>>
  places: Place[]
}) {
  const [adding, setAdding] = useState(false)
  const list = orders.data ?? []
  const active = list.filter((o) => o.status !== 'cancelled')
  const sum = (f: (o: DeliveryOrder) => number) => active.reduce((s, o) => s + f(o), 0)

  const setStatus = async (o: DeliveryOrder, status: 'cancelled' | 'delivered' | 'pending') => {
    if (status === 'cancelled' && !window.confirm(`ยกเลิกใบจัดส่ง ${o.docNo}?`)) return
    try {
      await apiFetch(`/delivery/orders/${o.id}`, { method: 'PATCH', body: { status } })
      void orders.reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Field label="วันที่ส่ง">
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
        </Field>
        <Button className="mt-auto ml-auto cursor-pointer" onClick={() => setAdding(true)}>
          <Plus /> เพิ่มออเดอร์จัดส่ง
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="ออเดอร์" value={active.length} sub={`รอจัดเส้นทาง ${active.filter((o) => o.status === 'pending').length}`} />
        <Stat label="จำนวนกระสอบ" value={qty(sum((o) => o.totalBags))} />
        <Stat label="น้ำหนักรวม" value={kg(sum((o) => o.totalWeightKg))} />
        <Stat label="ยังไม่ปักหมุด" value={active.filter((o) => o.lat === null).length} tone={active.some((o) => o.lat === null) ? 'warn' : undefined} />
      </div>
      {orders.error ? <ErrorBox message={orders.error} onRetry={() => void orders.reload()} /> : null}
      {orders.loading && !orders.data ? <Loading /> : null}
      {orders.data && list.length === 0 ? (
        <Empty title={`ยังไม่มีออเดอร์จัดส่งวันที่ ${dateOnly(date)}`} hint="เพิ่มออเดอร์ที่ลูกค้าสั่ง หรือกด “จัดส่ง” จากบิลขาย" />
      ) : null}
      {list.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ใบจัดส่ง / ผู้รับ</TableHead>
                <TableHead className="text-right">กระสอบ</TableHead>
                <TableHead className="text-right">น้ำหนัก</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((o) => (
                <TableRow key={o.id} className={cn(o.status === 'cancelled' && 'opacity-50')}>
                  <TableCell>
                    <p className="font-medium">
                      {o.recipientName}
                      {o.lat === null ? (
                        <Badge variant="outline" className="ml-2 border-amber-400 text-amber-700">
                          <MapPinOff className="size-3" /> ยังไม่ปักหมุด
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {o.docNo}
                      {o.saleBillNo ? ` · บิล ${o.saleBillNo}` : o.source === 'agency' ? ' · ฟาร์มสุข' : ''}
                      {o.address ? ` · ${o.address}` : ''}
                    </p>
                  </TableCell>
                  <TableCell className="tabular text-right">{qty(o.totalBags)}</TableCell>
                  <TableCell className="tabular text-right">{kg(o.totalWeightKg)}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === 'pending' ? 'outline' : o.status === 'delivered' ? 'default' : 'secondary'}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    {o.tripNo ? <p className="text-xs text-muted-foreground">{o.tripNo}</p> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {o.status === 'pending' ? (
                      <Button variant="ghost" size="sm" className="cursor-pointer text-destructive" onClick={() => void setStatus(o, 'cancelled')}>
                        ยกเลิก
                      </Button>
                    ) : null}
                    {o.status === 'cancelled' ? (
                      <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => void setStatus(o, 'pending')}>
                        กู้คืน
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}
      <p className="text-xs text-muted-foreground">ลูกค้าที่ยังไม่ปักหมุดจะจัดเส้นทางไม่ได้ — ปักหมุดได้ที่แท็บ “แผนที่”</p>
      <OrderDialog
        open={adding}
        date={date}
        places={places}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false)
          void orders.reload()
        }}
      />
    </div>
  )
}

interface Line {
  key: string
  product: Product | null
  name: string
  qty: number | null
  unitWeightKg: number | null
}

function OrderDialog({ open, date, places, onClose, onSaved }: { open: boolean; date: string; places: Place[]; onClose: () => void; onSaved: () => void }) {
  const [deliveryDate, setDeliveryDate] = useState(date)
  const [q, setQ] = useState('')
  const [who, setWho] = useState<Place | null>(null)
  const [freeName, setFreeName] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDeliveryDate(date)
    setQ('')
    setWho(null)
    setFreeName('')
    setNote('')
    setLines([])
  }, [open, date])

  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return []
    return places
      .filter((p) => p.kind !== 'location' && p.isActive && (p.name.toLowerCase().includes(term) || (p.code ?? '').toLowerCase().includes(term) || (p.phone ?? '').includes(term)))
      .slice(0, 8)
  }, [q, places])

  const setLine = (key: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const weightOf = (l: Line) => (l.unitWeightKg ?? 0) * (l.qty ?? 0)
  const valid = lines.filter((l) => l.name.trim() && (l.qty ?? 0) > 0)
  const totalKg = valid.reduce((s, l) => s + weightOf(l), 0)
  const canSave = (who || freeName.trim()) && valid.length > 0 && !busy

  const save = async () => {
    setBusy(true)
    try {
      await apiFetch('/delivery/orders', {
        method: 'POST',
        body: {
          deliveryDate,
          customerId: who?.kind === 'customer' ? who.id : null,
          agencyCustomerId: who?.kind === 'agency' ? who.id : null,
          recipientName: who ? null : freeName.trim(),
          note: note.trim() || null,
          lines: valid.map((l) => ({
            productId: l.product?.id ?? null,
            productName: l.name.trim(),
            unit: l.product?.unit ?? 'กระสอบ',
            qty: l.qty,
            unitWeightKg: l.unitWeightKg,
          })),
        },
      })
      toast.success('เพิ่มออเดอร์จัดส่งแล้ว')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-h-[92vh] max-w-2xl grid-cols-1 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>เพิ่มออเดอร์จัดส่ง</DialogTitle>
            <DialogDescription>ระบบคำนวณจำนวนกระสอบและน้ำหนักรวม เพื่อเลือกรถให้อัตโนมัติ</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label="วันที่ส่ง">
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </Field>
            <Field label="ลูกค้า / ผู้รับ">
              {who ? (
                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {who.name} <span className="text-muted-foreground">· {who.subtitle}</span>
                    {who.lat === null ? <span className="text-amber-700"> · ยังไม่ปักหมุด</span> : null}
                  </span>
                  <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setWho(null)}>
                    เปลี่ยน
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาลูกค้า (ชื่อ / รหัส / เบอร์)" />
                  {candidates.length > 0 ? (
                    <ul className="absolute z-10 mt-1 w-full divide-y rounded-md border bg-popover shadow-md">
                      {candidates.map((p) => (
                        <li key={`${p.kind}:${p.id}`}>
                          <button type="button" className="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setWho(p)}>
                            {p.name} <span className="text-xs text-muted-foreground">· {p.subtitle}</span>
                            {p.lat === null ? <span className="text-xs text-amber-700"> · ยังไม่ปักหมุด</span> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!q.trim() ? null : candidates.length === 0 ? (
                    <Input className="mt-2" value={freeName} onChange={(e) => setFreeName(e.target.value)} placeholder="ไม่พบ — พิมพ์ชื่อผู้รับ (ปักหมุดภายหลัง)" />
                  ) : null}
                </div>
              )}
            </Field>
          </div>

          <div className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">สินค้า</p>
              <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setPicking(true)}>
                <Plus /> เพิ่มสินค้า
              </Button>
            </div>
            {lines.length === 0 ? <p className="text-sm text-muted-foreground">ยังไม่มีสินค้า</p> : null}
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_auto] items-end gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">รวม {kg(weightOf(l))}</p>
                </div>
                <Field label={`จำนวน (${l.product?.unit ?? 'กส.'})`}>
                  <NumberInput value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} />
                </Field>
                <Field label="กก./หน่วย">
                  <NumberInput value={l.unitWeightKg} onChange={(v) => setLine(l.key, { unitWeightKg: v })} />
                </Field>
                <Button variant="ghost" size="icon" className="cursor-pointer" aria-label="ลบ" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-1 text-xs">
              <span className="text-muted-foreground">น้ำหนักต่อหน่วยเริ่มต้น:</span>
              <span>อาหารเลี้ยงลูกด้วยนม 10 กก.</span>·<span>สัตว์น้ำ/สัตว์เลี้ยง 20 กก.</span>·<span>สุกร วัว ไก่ ฯลฯ 30 กก.</span>
            </div>
          </div>
          <Field label="หมายเหตุ">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Field>
          <p className="rounded-md bg-muted/60 p-2 text-sm">
            รวม <b>{qty(round3(valid.reduce((s, l) => s + (l.qty ?? 0), 0)))}</b> หน่วย · น้ำหนัก <b>{kg(totalKg)}</b>
          </p>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button className="cursor-pointer" disabled={!canSave} onClick={() => void save()}>
              {busy ? <Loader2 className="animate-spin" /> : null} บันทึกออเดอร์
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProductPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPicking(false)
          setLines((prev) => [...prev, { key: crypto.randomUUID(), product: p, name: p.name, qty: 1, unitWeightKg: unitWeightKg(p) }])
        }}
      />
    </>
  )
}
