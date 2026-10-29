import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch, errorMessage } from '@/lib/api'
import { addDaysISO, todayISO } from '@/lib/format'

/** Turn a POS bill into a delivery order (customer, goods and weights come from the bill). */
export function CreateDeliveryButton({ saleId, hasCustomer }: { saleId: string; hasCustomer: boolean }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => (new Date().getHours() >= 15 ? addDaysISO(todayISO(), 1) : todayISO()))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    try {
      const o = await apiFetch<{ docNo: string; lat: number | null }>(`/delivery/orders/from-sale/${saleId}`, { method: 'POST', body: { deliveryDate: date } })
      setDone(o.docNo)
      setOpen(false)
      toast.success(`สร้างใบจัดส่ง ${o.docNo} แล้ว${o.lat === null ? ' — ลูกค้ายังไม่ปักหมุด ปักได้ที่เมนูจัดส่ง › แผนที่' : ''}`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (done) return <p className="text-sm text-emerald-700">ส่งเข้าคิวจัดส่งแล้ว ({done})</p>
  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-fit cursor-pointer" onClick={() => setOpen(true)}>
        <Truck /> ต้องจัดส่ง
      </Button>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
      <span>วันที่ส่ง</span>
      <Input type="date" className="h-8 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
      <Button size="sm" className="cursor-pointer" disabled={busy} onClick={() => void create()}>
        {busy ? <Loader2 className="animate-spin" /> : <Truck />} สร้างใบจัดส่ง
      </Button>
      <Button size="sm" variant="ghost" className="cursor-pointer" onClick={() => setOpen(false)}>
        ยกเลิก
      </Button>
      {!hasCustomer ? <p className="w-full text-xs text-amber-700">บิลนี้ไม่มีชื่อลูกค้า — จะต้องปักหมุดให้ใบจัดส่งเอง</p> : null}
    </div>
  )
}
