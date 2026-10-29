import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Route, Save, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Empty, Field, LocationSelect, Stat } from '@/components/common'
import { MapView, type MapLine, type MapPoint } from '@/components/MapView'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { baht, qty } from '@/lib/format'
import { fmtKm, fmtMin } from '@/lib/maps'
import { cn } from '@/lib/utils'
import { TRIP_COLORS, kg, type DeliveryOrder, type Place, type Plan, type Vehicle } from './types'

/** Pick orders and vehicles for a day, compute the plan, adjust, and save it as trips. */
export function PlanTab({
  date,
  setDate,
  orders,
  vehicles,
  places,
  onSaved,
}: {
  date: string
  setDate: (d: string) => void
  orders: DeliveryOrder[]
  vehicles: Vehicle[]
  places: Place[]
  onSaved: () => void
}) {
  const app = useApp()
  const pending = orders.filter((o) => o.status === 'pending')
  const active = vehicles.filter((v) => v.isActive)
  const [depotId, setDepotId] = useState(app.locationId)
  const [orderIds, setOrderIds] = useState<Set<string>>(new Set())
  const [vehicleIds, setVehicleIds] = useState<Set<string>>(new Set())
  const [returnToDepot, setReturnToDepot] = useState(true)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState<'' | 'plan' | 'save'>('')

  // Default: every pending order of the day, every active vehicle.
  const pendingKey = pending.map((o) => o.id).join(',')
  useEffect(() => {
    setOrderIds(new Set(pending.filter((o) => o.lat !== null).map((o) => o.id)))
    setPlan(null)
    // Reset when the set of pending orders changes.
  }, [pendingKey])
  const vehicleKey = active.map((v) => v.id).join(',')
  useEffect(() => setVehicleIds(new Set(active.map((v) => v.id))), [vehicleKey])

  const depot = places.find((p) => p.kind === 'location' && p.id === depotId)
  const chosen = pending.filter((o) => orderIds.has(o.id))
  const totalKg = chosen.reduce((s, o) => s + o.totalWeightKg, 0)
  const capacity = active.filter((v) => vehicleIds.has(v.id)).reduce((s, v) => s + v.capacityKg, 0)

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const n = new Set(set)
    if (on) n.add(id)
    else n.delete(id)
    return n
  }

  const compute = async (fixed?: { vehicleId: string; orderIds: string[] }[]) => {
    setBusy('plan')
    try {
      const p = await apiFetch<Plan>('/delivery/plan', {
        method: 'POST',
        body: { depotLocationId: depotId, orderIds: [...orderIds], vehicleIds: [...vehicleIds], returnToDepot, fixed },
      })
      setPlan(p)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy('')
    }
  }

  /** Move one stop to another vehicle, then re-optimise the order inside each trip. */
  const moveStop = (orderId: string, toVehicle: string) => {
    if (!plan) return
    const groups = new Map<string, string[]>(plan.trips.map((t) => [t.vehicleId, t.stops.map((s) => s.orderId)]))
    for (const [v, ids] of groups) groups.set(v, ids.filter((x) => x !== orderId))
    groups.set(toVehicle, [...(groups.get(toVehicle) ?? []), orderId])
    void compute([...groups].filter(([, ids]) => ids.length > 0).map(([vehicleId, ids]) => ({ vehicleId, orderIds: ids })))
  }

  const save = async () => {
    if (!plan) return
    setBusy('save')
    try {
      const res = await apiFetch<{ trips: { docNo: string }[] }>('/delivery/trips', {
        method: 'POST',
        body: {
          tripDate: date,
          depotLocationId: depotId,
          returnToDepot,
          trips: plan.trips.map((t) => ({ vehicleId: t.vehicleId, orderIds: t.stops.map((s) => s.orderId) })),
        },
      })
      toast.success(`บันทึกแผนแล้ว: ${res.trips.map((t) => t.docNo).join(', ')}`)
      setPlan(null)
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy('')
    }
  }

  const points: MapPoint[] = useMemo(() => {
    const pts: MapPoint[] = []
    if (depot?.lat != null && depot.lng != null) pts.push({ id: 'depot', lat: depot.lat, lng: depot.lng, title: depot.name, color: '#15803d', label: '★' })
    if (plan) {
      plan.trips.forEach((t, ti) =>
        t.stops.forEach((s, si) => pts.push({ id: s.orderId, lat: s.lat, lng: s.lng, title: `${si + 1}. ${s.name} (${t.vehicleName})`, color: TRIP_COLORS[ti % TRIP_COLORS.length]!, label: String(si + 1) })),
      )
    } else {
      for (const o of chosen) if (o.lat !== null && o.lng !== null) pts.push({ id: o.id, lat: o.lat, lng: o.lng, title: o.recipientName, color: '#2563eb' })
    }
    return pts
  }, [plan, chosen, depot])

  const lines: MapLine[] = useMemo(
    () =>
      plan
        ? plan.trips.map((t, ti) => ({
            id: t.vehicleId,
            color: TRIP_COLORS[ti % TRIP_COLORS.length]!,
            polyline: t.polyline,
            path: [plan.depot, ...t.stops.map((s) => ({ lat: s.lat, lng: s.lng })), ...(plan.returnToDepot ? [plan.depot] : [])],
          }))
        : [],
    [plan],
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="วันที่ส่ง">
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="ออกจาก">
            <LocationSelect value={depotId} onChange={setDepotId} />
          </Field>
        </div>
        {depot && depot.lat === null ? <p className="text-sm text-destructive">ยังไม่ได้ปักหมุด {depot.name} — ปักหมุดที่แท็บแผนที่ก่อน</p> : null}
        <label className="flex cursor-pointer items-center justify-between rounded-lg border p-2 text-sm">
          กลับมาที่ร้านหลังส่งเสร็จ (นับระยะทางขากลับ)
          <Switch checked={returnToDepot} onCheckedChange={setReturnToDepot} />
        </label>

        <section className="rounded-lg border">
          <p className="border-b p-2 text-sm font-semibold">
            ออเดอร์ ({chosen.length}/{pending.length}) · {kg(totalKg)}
          </p>
          {pending.length === 0 ? <p className="p-3 text-sm text-muted-foreground">ไม่มีออเดอร์รอจัดเส้นทางในวันนี้</p> : null}
          <ul className="max-h-64 divide-y overflow-y-auto">
            {pending.map((o) => (
              <li key={o.id}>
                <label className={cn('flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm', o.lat === null && 'opacity-50')}>
                  <input
                    type="checkbox"
                    className="accent-primary"
                    disabled={o.lat === null}
                    checked={orderIds.has(o.id)}
                    onChange={(e) => {
                      setOrderIds((s) => toggle(s, o.id, e.target.checked))
                      setPlan(null)
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{o.recipientName}</span>
                  <span className="tabular shrink-0 text-xs text-muted-foreground">{o.lat === null ? 'ไม่มีหมุด' : kg(o.totalWeightKg)}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border">
          <p className="border-b p-2 text-sm font-semibold">
            รถที่พร้อมใช้ · ความจุรวม {kg(capacity)}
          </p>
          {active.length === 0 ? <p className="p-3 text-sm text-muted-foreground">ยังไม่มีรถ — เพิ่มที่แท็บ “รถขนส่ง”</p> : null}
          <ul className="divide-y">
            {active.map((v) => (
              <li key={v.id}>
                <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={vehicleIds.has(v.id)}
                    onChange={(e) => {
                      setVehicleIds((s) => toggle(s, v.id, e.target.checked))
                      setPlan(null)
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{v.name}</span>
                  <span className="tabular shrink-0 text-xs text-muted-foreground">{kg(v.capacityKg)}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        {totalKg > capacity && capacity > 0 ? (
          <p className="flex items-center gap-1 text-sm text-destructive">
            <AlertTriangle className="size-4" /> น้ำหนักเกินความจุรถที่เลือก — เลือกรถเพิ่มหรือแบ่งไปวันอื่น
          </p>
        ) : null}
        <Button
          className="cursor-pointer"
          disabled={busy !== '' || orderIds.size === 0 || vehicleIds.size === 0 || !depot || depot.lat === null}
          onClick={() => void compute()}
        >
          {busy === 'plan' ? <Loader2 className="animate-spin" /> : <Route />} คำนวณเส้นทางที่สั้นที่สุด
        </Button>
      </div>

      <div className="grid content-start gap-3">
        <MapView className="h-[50vh] min-h-72 w-full" points={points} lines={lines} fitKey={`${plan ? 'plan' : 'orders'}-${points.length}-${plan?.totals.distanceKm ?? 0}`} />
        {!plan ? (
          <Empty title="เลือกออเดอร์และรถ แล้วกด “คำนวณเส้นทางที่สั้นที่สุด”" hint="ระบบเลือกรถตามน้ำหนักรวม ถ้าเกินคันเดียวจะแบ่งหลายคันตามโซน แล้วหาลำดับจุดส่งที่ระยะทางรวมสั้นที่สุด" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat label="ระยะทางรวม" value={fmtKm(plan.totals.distanceKm)} sub={plan.distanceSource === 'google' ? 'ตามถนนจริง (Google)' : 'ประมาณการ (ยังไม่มี Google key)'} />
              <Stat label="เวลาขับรวม" value={fmtMin(plan.totals.durationMin)} sub="ไม่รวมเวลาลงของ" />
              <Stat label="น้ำหนักรวม" value={kg(plan.totals.weightKg)} sub={`${plan.trips.length} คัน`} />
              <Stat label="ค่าน้ำมันโดยประมาณ" value={`${baht(plan.totals.fuelCost)} บาท`} sub="ตามค่า บาท/กม. ของรถ" />
            </div>
            {plan.noPin.length ? <p className="text-sm text-amber-700">ไม่ได้จัด (ยังไม่ปักหมุด): {plan.noPin.map((x) => x.name).join(', ')}</p> : null}
            {plan.unassigned.length ? (
              <p className="text-sm text-destructive">บรรทุกไม่ได้ (หนักเกินรถที่เลือก): {plan.unassigned.map((x) => `${x.name} ${kg(x.weightKg)}`).join(', ')}</p>
            ) : null}
            {plan.trips.map((t, ti) => (
              <section key={t.vehicleId} className="rounded-lg border">
                <div className="flex flex-wrap items-center gap-2 border-b p-2">
                  <span className="inline-block size-3 rounded-full" style={{ background: TRIP_COLORS[ti % TRIP_COLORS.length] }} />
                  <Truck className="size-4" />
                  <span className="font-semibold">{t.vehicleName}</span>
                  <span className="text-sm text-muted-foreground">
                    {fmtKm(t.distanceKm)} · {fmtMin(t.durationMin)} · {qty(t.bags)} หน่วย
                  </span>
                  <span className="ml-auto text-sm">
                    {kg(t.weightKg)} / {kg(t.capacityKg)}
                  </span>
                  <div className="h-1.5 w-full rounded-full bg-muted">
                    <div
                      className={cn('h-1.5 rounded-full', t.weightKg > t.capacityKg ? 'bg-destructive' : 'bg-primary')}
                      style={{ width: `${Math.min(100, (t.weightKg / t.capacityKg) * 100)}%` }}
                    />
                  </div>
                </div>
                {t.warnings.map((w) => (
                  <p key={w} className="px-2 pt-1 text-xs text-amber-700">
                    ⚠ {w}
                  </p>
                ))}
                <ol className="divide-y text-sm">
                  {t.stops.map((s, si) => (
                    <li key={s.orderId} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                      <Badge style={{ background: TRIP_COLORS[ti % TRIP_COLORS.length] }}>{si + 1}</Badge>
                      <span className="min-w-0 flex-1 truncate">
                        {s.name}
                        <span className="text-xs text-muted-foreground"> · {kg(s.weightKg)}</span>
                      </span>
                      <span className="tabular text-xs text-muted-foreground">+{fmtKm(s.legKm)}</span>
                      {plan.trips.length > 1 ? (
                        <select
                          className="cursor-pointer rounded border bg-background px-1 py-0.5 text-xs"
                          value={t.vehicleId}
                          onChange={(e) => moveStop(s.orderId, e.target.value)}
                          aria-label="ย้ายไปรถคันอื่น"
                        >
                          {plan.trips.map((x) => (
                            <option key={x.vehicleId} value={x.vehicleId}>
                              {x.vehicleName}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </li>
                  ))}
                  {plan.returnToDepot ? (
                    <li className="px-2 py-1.5 text-xs text-muted-foreground">
                      กลับร้าน +{fmtKm(t.returnKm)}
                    </li>
                  ) : null}
                </ol>
              </section>
            ))}
            <Button className="cursor-pointer" disabled={busy !== '' || plan.trips.length === 0} onClick={() => void save()}>
              {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />} บันทึกแผนการจัดส่ง ({plan.trips.length} เที่ยว)
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
