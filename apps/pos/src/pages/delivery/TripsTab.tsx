import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Ban, CheckCircle2, Navigation, Printer, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Empty, ErrorBox, Field, Loading } from '@/components/common'
import { MapView, type MapPoint } from '@/components/MapView'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { dateOnly, qty } from '@/lib/format'
import { fmtKm, fmtMin, navigationUrl, type LatLng } from '@/lib/maps'
import { printSoon } from '@/lib/print'
import { useApi } from '@/lib/use-api'
import { kg, type Trip, type TripDetail } from './types'

const TRIP_STATUS: Record<Trip['status'], string> = { planned: 'รอออกรถ', done: 'ส่งครบแล้ว', cancelled: 'ยกเลิก' }

export function TripsTab({ date, setDate, onChanged }: { date: string; setDate: (d: string) => void; onChanged: () => void }) {
  const trips = useApi<Trip[]>(`/delivery/trips?from=${date}&to=${date}`)
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <div className="grid gap-3">
      <Field label="วันที่">
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
      </Field>
      {trips.error ? <ErrorBox message={trips.error} onRetry={() => void trips.reload()} /> : null}
      {trips.loading && !trips.data ? <Loading /> : null}
      {trips.data?.length === 0 ? <Empty title={`ยังไม่มีเที่ยวรถวันที่ ${dateOnly(date)}`} hint="จัดเส้นทางที่แท็บ “วางแผนเส้นทาง” แล้วกดบันทึก" /> : null}
      <div className="grid gap-2 md:grid-cols-2">
        {trips.data?.map((t) => (
          <button key={t.id} type="button" onClick={() => setOpenId(t.id)} className="grid cursor-pointer gap-1 rounded-lg border bg-card p-3 text-left hover:border-primary">
            <div className="flex items-center gap-2">
              <Truck className="size-4" />
              <span className="font-semibold">{t.vehicleName}</span>
              <span className="text-sm text-muted-foreground">{t.docNo}</span>
              <Badge variant={t.status === 'planned' ? 'outline' : t.status === 'done' ? 'default' : 'secondary'} className="ml-auto">
                {TRIP_STATUS[t.status]}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t.stopCount} จุด · {fmtKm(t.distanceKm)} · {fmtMin(t.durationMin)} · {kg(t.weightKg)}
            </p>
          </button>
        ))}
      </div>
      <TripDialog
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => {
          void trips.reload()
          onChanged()
        }}
      />
    </div>
  )
}

function TripDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<TripDetail>(id ? `/delivery/trips/${id}` : null)
  const t = id && detail.data?.id === id ? detail.data : null
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    printSoon()
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [printing])

  const depot: LatLng | null = t && t.depotLat !== null && t.depotLng !== null ? { lat: t.depotLat, lng: t.depotLng } : null
  const stopsAt = (t?.stops ?? []).filter((s): s is typeof s & { lat: number; lng: number } => s.lat !== null && s.lng !== null)
  const points: MapPoint[] = useMemo(
    () => [
      ...(depot ? [{ id: 'depot', ...depot, title: t?.depotName ?? 'ร้าน', color: '#15803d', label: '★' }] : []),
      ...stopsAt.map((s) => ({ id: s.orderId, lat: s.lat, lng: s.lng, title: `${s.seq}. ${s.name}`, color: '#2563eb', label: String(s.seq) })),
    ],
    [t],
  )
  // Google navigation links take up to 9 stops in between; longer trips are split into legs.
  const navLinks = useMemo(() => {
    if (!depot || !t) return []
    const pts = stopsAt.map((s) => ({ lat: s.lat, lng: s.lng }))
    const links: string[] = []
    let from = depot
    for (let i = 0; i < pts.length; i += 9) {
      const chunk = pts.slice(i, i + 9)
      const last = i + 9 >= pts.length
      links.push(navigationUrl(from, chunk, last && t.returnToDepot ? depot : undefined))
      from = chunk[chunk.length - 1]!
    }
    return links
  }, [t])

  const setStatus = async (status: 'done' | 'cancelled') => {
    if (!t) return
    if (!window.confirm(status === 'done' ? 'ยืนยันว่าส่งครบทุกจุดแล้ว?' : 'ยกเลิกเที่ยวนี้? ออเดอร์จะกลับไปรอจัดเส้นทาง')) return
    try {
      await apiFetch(`/delivery/trips/${t.id}/status`, { method: 'POST', body: { status } })
      toast.success(status === 'done' ? 'ปิดเที่ยวรถแล้ว' : 'ยกเลิกเที่ยวรถแล้ว')
      await detail.reload()
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl grid-cols-1 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t ? `${t.docNo} · ${t.vehicleName}` : 'เที่ยวรถ'}
            {t?.plate ? ` (${t.plate})` : ''}
          </DialogTitle>
          <DialogDescription>
            {t ? `${dateOnly(t.tripDate)} · ออกจาก ${t.depotName ?? '-'} · ${fmtKm(t.distanceKm)} · ${fmtMin(t.durationMin)} · ${kg(t.weightKg)}${t.distanceSource === 'estimate' ? ' (ระยะทางประมาณ)' : ''}` : ' '}
          </DialogDescription>
        </DialogHeader>
        {detail.error ? <ErrorBox message={detail.error} /> : null}
        {!t && !detail.error ? <Loading /> : null}
        {t ? (
          <>
            <MapView
              className="h-72 w-full"
              points={points}
              lines={[{ id: t.id, color: '#2563eb', polyline: t.polyline, path: [...(depot ? [depot] : []), ...stopsAt.map((s) => ({ lat: s.lat, lng: s.lng })), ...(depot && t.returnToDepot ? [depot] : [])] }]}
              fitKey={t.id}
            />
            <ol className="divide-y rounded-lg border text-sm">
              {t.stops.map((s) => (
                <li key={s.orderId} className="grid gap-0.5 p-2">
                  <div className="flex items-center gap-2">
                    <Badge>{s.seq}</Badge>
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">+{fmtKm(s.legKm)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.items} · {kg(s.weightKg)}
                    {s.phone ? ` · โทร ${s.phone}` : ''}
                    {s.address ? ` · ${s.address}` : ''}
                  </p>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              {navLinks.map((href, i) => (
                <Button key={href} variant="outline" size="sm" className="cursor-pointer" asChild>
                  <a href={href} target="_blank" rel="noreferrer">
                    <Navigation /> นำทางด้วย Google Maps{navLinks.length > 1 ? ` (ช่วง ${i + 1})` : ''}
                  </a>
                </Button>
              ))}
            </div>
            {printing ? <TripSheetPrint trip={t} navLinks={navLinks} /> : null}
          </>
        ) : null}
        <DialogFooter>
          {t?.status === 'planned' ? (
            <>
              <Button variant="outline" className="cursor-pointer text-destructive" onClick={() => void setStatus('cancelled')}>
                <Ban /> ยกเลิกเที่ยว
              </Button>
              <Button variant="outline" className="cursor-pointer" onClick={() => void setStatus('done')}>
                <CheckCircle2 /> ส่งครบแล้ว
              </Button>
            </>
          ) : null}
          <Button className="cursor-pointer" disabled={!t} onClick={() => setPrinting(true)}>
            <Printer /> พิมพ์ใบคุมรถ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A4 sheet for the driver: stop order, goods, weights, phone numbers and signatures. */
function TripSheetPrint({ trip: t, navLinks }: { trip: TripDetail; navLinks: string[] }) {
  const { data } = useApp()
  return createPortal(
    <div id="print-root" data-paper="doc">
      <div className="tax-invoice-page bg-white p-[10mm] text-[11px] leading-snug text-black">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[15px] font-bold">{data.settings.shopName}</p>
            <p>ใบคุมรถ / ลำดับการส่งสินค้า</p>
          </div>
          <div className="text-right">
            <p className="text-[14px] font-bold">{t.docNo}</p>
            <p>วันที่ {dateOnly(t.tripDate)}</p>
            <p>
              รถ {t.vehicleName}
              {t.plate ? ` (${t.plate})` : ''}
              {t.driverName ? ` · คนขับ ${t.driverName}` : ''}
            </p>
          </div>
        </div>
        <p className="mt-2">
          ออกจาก {t.depotName} · {t.stops.length} จุด · {fmtKm(t.distanceKm)} · {fmtMin(t.durationMin)} · {kg(t.weightKg)} · {qty(t.bags)} หน่วย
        </p>
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1 text-left">#</th>
              <th className="text-left">ผู้รับ / ที่อยู่ / โทร</th>
              <th className="text-left">สินค้า</th>
              <th className="text-right">น้ำหนัก</th>
              <th className="text-right">ระยะ</th>
              <th className="w-24 text-center">ลายเซ็นผู้รับ</th>
            </tr>
          </thead>
          <tbody>
            {t.stops.map((s) => (
              <tr key={s.orderId} className="border-b border-gray-400 align-top">
                <td className="py-1">{s.seq}</td>
                <td>
                  <b>{s.name}</b>
                  {s.address ? <div>{s.address}</div> : null}
                  {s.phone ? <div>โทร {s.phone}</div> : null}
                  {s.note ? <div>หมายเหตุ: {s.note}</div> : null}
                </td>
                <td>{s.items}</td>
                <td className="text-right">{kg(s.weightKg)}</td>
                <td className="text-right">{fmtKm(s.legKm)}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
        {navLinks.length ? <p className="mt-3 break-all text-[9px]">นำทาง: {navLinks.join('  ')}</p> : null}
        <div className="mt-10 grid grid-cols-2 gap-8 text-center">
          <div>
            <p>.................................................</p>
            <p>ผู้จัดของ</p>
          </div>
          <div>
            <p>.................................................</p>
            <p>คนขับรถ</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
