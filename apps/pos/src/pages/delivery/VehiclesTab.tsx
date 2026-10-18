import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Download, FileCheck2, Loader2, Pencil, Plus, ShieldCheck, Trash2, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Empty, Field, NumberInput } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { baht, daysUntil, dateOnly, todayISO } from '@/lib/format'
import { cn } from '@/lib/utils'
import { VEHICLE_TYPE_LABEL, kg, type Vehicle, type VehiclePolicy } from './types'

type Form = Omit<Vehicle, 'id'>

const PRESETS: { label: string; form: Partial<Form> }[] = [
  { label: 'กระบะ 3,000 กก.', form: { vehicleType: 'pickup', minLoadKg: 0, capacityKg: 3000 } },
  { label: 'รถ 6 ล้อ 4,500–9,000 กก.', form: { vehicleType: 'truck6', minLoadKg: 4500, capacityKg: 9000 } },
]

const noPolicy: VehiclePolicy = { company: null, start: null, expiry: null, cost: null }

const empty: Form = {
  name: '',
  plate: null,
  vehicleType: 'pickup',
  minLoadKg: 0,
  capacityKg: 3000,
  costPerKm: 0,
  driverName: null,
  note: null,
  isActive: true,
  insurance: noPolicy,
  act: noPolicy,
  tax: { expiry: null, cost: null },
}

/** Days left from today (Bangkok) to an expiry date; within this many days counts as "soon". */
const SOON_DAYS = 30

type DocState = 'none' | 'expired' | 'soon' | 'ok'

function docState(expiry: string | null): DocState {
  const d = daysUntil(expiry)
  if (d === null) return 'none'
  if (d < 0) return 'expired'
  return d <= SOON_DAYS ? 'soon' : 'ok'
}

function DaysBadge({ expiry }: { expiry: string | null }) {
  const d = daysUntil(expiry)
  const state = docState(expiry)
  const text =
    d === null ? 'ยังไม่ระบุ' : d < 0 ? `หมดอายุแล้ว ${-d} วัน` : d === 0 ? 'หมดอายุวันนี้' : `เหลืออีก ${d.toLocaleString('th-TH')} วัน`
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        state === 'none' && 'bg-muted text-muted-foreground',
        state === 'expired' && 'bg-destructive/10 text-destructive',
        state === 'soon' && 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
        state === 'ok' && 'bg-primary/10 text-primary',
      )}
    >
      {text}
    </span>
  )
}

function DocBox({ icon: Icon, title, expiry, children }: { icon: ComponentType<{ className?: string }>; title: string; expiry: string | null; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5 rounded-lg border bg-muted/30 p-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5 text-muted-foreground" /> {title}
      </p>
      <DaysBadge expiry={expiry} />
      <div className="grid gap-0.5 text-[11px] leading-snug text-muted-foreground">{children}</div>
    </div>
  )
}

function line(label: string, value: string | null) {
  return (
    <p className="truncate">
      {label}: <span className="text-foreground/80">{value ?? '-'}</span>
    </p>
  )
}

const costText = (n: number | null) => (n === null ? null : `฿${baht(n)}`)
const dateText = (d: string | null) => (d ? dateOnly(d) : null)

function csvCell(v: string | number | null): string {
  const text = v === null ? '' : String(v)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function exportCsv(vehicles: Vehicle[]) {
  const header = [
    'ทะเบียน', 'ชื่อรถ', 'ประเภท', 'คนขับ', 'สถานะ',
    'ประกันภาคสมัครใจ-บริษัท', 'ประกันภาคสมัครใจ-วันที่ทำ', 'ประกันภาคสมัครใจ-วันหมดอายุ', 'ประกันภาคสมัครใจ-ค่าใช้จ่าย',
    'พ.ร.บ.-บริษัท', 'พ.ร.บ.-วันที่ทำ', 'พ.ร.บ.-วันหมดอายุ', 'พ.ร.บ.-ค่าใช้จ่าย',
    'ภาษี-วันหมดอายุ', 'ภาษี-ค่าใช้จ่าย',
  ]
  const rows = vehicles.map((v) => [
    v.plate, v.name, VEHICLE_TYPE_LABEL[v.vehicleType] ?? v.vehicleType, v.driverName, v.isActive ? 'ใช้งานอยู่' : 'ปิดใช้งาน',
    v.insurance.company, v.insurance.start, v.insurance.expiry, v.insurance.cost,
    v.act.company, v.act.start, v.act.expiry, v.act.cost,
    v.tax.expiry, v.tax.cost,
  ])
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `รถขนส่ง-${todayISO()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function VehiclesTab({ vehicles, onChanged }: { vehicles: Vehicle[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null)
  const [deleting, setDeleting] = useState<Vehicle | null>(null)
  const active = vehicles.filter((v) => v.isActive)
  const docs = active.flatMap((v) => [v.insurance.expiry, v.act.expiry, v.tax.expiry].map(docState))
  const expired = docs.filter((s) => s === 'expired').length
  const soon = docs.filter((s) => s === 'soon').length

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">รถใช้งานอยู่ {active.length} คัน</span>
          {expired > 0 ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">หมดอายุแล้ว {expired} รายการ</span> : null}
          {soon > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              ใกล้หมดอายุใน {SOON_DAYS} วัน {soon} รายการ
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="cursor-pointer" disabled={vehicles.length === 0} onClick={() => exportCsv(vehicles)}>
            <Download /> ส่งออก CSV
          </Button>
          <Button className="cursor-pointer" onClick={() => setEditing({ id: null, form: { ...empty } })}>
            <Plus /> เพิ่มรถ
          </Button>
        </div>
      </div>
      {vehicles.length === 0 ? <Empty title="ยังไม่มีรถ" hint="เพิ่มรถ เช่น รถ 6 ล้อ 4,500–9,000 กก. และกระบะ 3,000 กก." /> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {vehicles.map((v) => (
          <article key={v.id} className={cn('grid gap-3 rounded-xl border bg-card p-4 shadow-sm', !v.isActive && 'opacity-60')}>
            <header className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="text-base font-semibold">{v.plate ?? v.name}</h3>
                  <span className="rounded-full border px-1.5 py-0.5 text-[11px]">{VEHICLE_TYPE_LABEL[v.vehicleType] ?? v.vehicleType}</span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      v.isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {v.isActive ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
                  </span>
                </div>
                {v.plate ? <p className="truncate text-sm text-muted-foreground">{v.name}</p> : null}
                <p className="text-sm">คนขับ: {v.driverName ?? '-'}</p>
                <p className="text-xs text-muted-foreground">
                  <Truck className="mr-1 inline size-3" />
                  ความจุ {v.minLoadKg > 0 ? `${kg(v.minLoadKg)} – ` : ''}
                  {kg(v.capacityKg)}
                  {v.costPerKm > 0 ? ` · ${v.costPerKm} บาท/กม.` : ''}
                </p>
              </div>
              <Button variant="outline" size="icon" className="size-8 cursor-pointer" aria-label="แก้ไขรถ" onClick={() => setEditing({ id: v.id, form: { ...v } })}>
                <Pencil />
              </Button>
              <Button variant="outline" size="icon" className="size-8 cursor-pointer" aria-label="ลบรถ" onClick={() => setDeleting(v)}>
                <Trash2 />
              </Button>
            </header>
            <div className="grid gap-2 sm:grid-cols-3">
              <DocBox icon={ShieldCheck} title="ประกันภาคสมัครใจ" expiry={v.insurance.expiry}>
                {line('บริษัท', v.insurance.company)}
                {line('วันที่ทำ', dateText(v.insurance.start))}
                {line('วันหมดอายุ', dateText(v.insurance.expiry))}
                {line('ค่าใช้จ่าย', costText(v.insurance.cost))}
              </DocBox>
              <DocBox icon={ShieldCheck} title="พ.ร.บ." expiry={v.act.expiry}>
                {line('บริษัท', v.act.company)}
                {line('วันที่ทำ', dateText(v.act.start))}
                {line('วันหมดอายุ', dateText(v.act.expiry))}
                {line('ค่าใช้จ่าย', costText(v.act.cost))}
              </DocBox>
              <DocBox icon={FileCheck2} title="ทะเบียนรถ / ภาษี" expiry={v.tax.expiry}>
                {line('วันหมดอายุ', dateText(v.tax.expiry))}
                {line('ค่าใช้จ่าย', costText(v.tax.cost))}
              </DocBox>
            </div>
          </article>
        ))}
      </div>
      <VehicleDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          onChanged()
        }}
      />
      <DeleteDialog
        vehicle={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null)
          onChanged()
        }}
      />
    </div>
  )
}

function DeleteDialog({ vehicle, onClose, onDeleted }: { vehicle: Vehicle | null; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    if (!vehicle) return
    setBusy(true)
    try {
      await apiFetch(`/delivery/vehicles/${vehicle.id}`, { method: 'DELETE' })
      toast.success('ลบรถแล้ว')
      onDeleted()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={vehicle !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>ลบรถ {vehicle?.plate ?? vehicle?.name}?</DialogTitle>
          <DialogDescription>ลบได้เฉพาะรถที่ยังไม่เคยออกเที่ยวส่ง ถ้ามีประวัติแล้วให้ปิด "ใช้งาน" แทน</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button variant="destructive" className="cursor-pointer" disabled={busy} onClick={() => void remove()}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} ลบ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A Buddhist-era year (25xx) typed into the date box would put the expiry centuries away. */
function badYear(d: string | null): boolean {
  return d !== null && (d < '2000-01-01' || d > '2100-12-31')
}

function PolicyFields({ value, onChange, withCompany = true }: { value: VehiclePolicy; onChange: (v: VehiclePolicy) => void; withCompany?: boolean }) {
  const set = <K extends keyof VehiclePolicy>(k: K, v: VehiclePolicy[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {withCompany ? (
        <Field label="บริษัทประกัน" className="sm:col-span-2">
          <Input value={value.company ?? ''} onChange={(e) => set('company', e.target.value || null)} />
        </Field>
      ) : null}
      {withCompany ? (
        <Field label="วันที่ทำ">
          <Input type="date" value={value.start ?? ''} onChange={(e) => set('start', e.target.value || null)} />
        </Field>
      ) : null}
      <Field label="วันหมดอายุ">
        <Input type="date" value={value.expiry ?? ''} min={value.start ?? undefined} onChange={(e) => set('expiry', e.target.value || null)} />
      </Field>
      <Field label="ค่าใช้จ่าย (บาท)">
        <NumberInput value={value.cost} onChange={(v) => set('cost', v)} />
      </Field>
    </div>
  )
}

function VehicleDialog({ editing, onClose, onSaved }: { editing: { id: string | null; form: Form } | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(empty)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (editing) setF(editing.form)
  }, [editing])
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  const dates = [f.insurance.start, f.insurance.expiry, f.act.start, f.act.expiry, f.tax.expiry]
  const yearProblem = dates.some(badYear)
  const orderProblem = [f.insurance, f.act].some((p) => p.start !== null && p.expiry !== null && p.start > p.expiry)

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await apiFetch(editing.id ? `/delivery/vehicles/${editing.id}` : '/delivery/vehicles', {
        method: editing.id ? 'PUT' : 'POST',
        body: {
          ...f,
          plate: f.plate?.trim() || null,
          driverName: f.driverName?.trim() || null,
          note: f.note?.trim() || null,
          insurance: { ...f.insurance, company: f.insurance.company?.trim() || null },
          act: { ...f.act, company: f.act.company?.trim() || null },
        },
      })
      toast.success('บันทึกรถแล้ว')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing?.id ? 'แก้ไขรถ' : 'เพิ่มรถ'}</DialogTitle>
          <DialogDescription>ความจุใช้เลือกรถและแบ่งของ · น้ำหนักขั้นต่ำ = ใช้รถคันนี้เมื่อของหนักพอให้คุ้ม</DialogDescription>
        </DialogHeader>
        {!editing?.id ? (
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.label} variant="outline" size="sm" className="cursor-pointer" onClick={() => setF((x) => ({ ...x, ...p.form }))}>
                {p.label}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ชื่อรถ" className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="เช่น กระบะ 1 / 6 ล้อ ขาว" />
          </Field>
          <Field label="ประเภท">
            <Select value={f.vehicleType} onValueChange={(v) => set('vehicleType', v)}>
              <SelectTrigger className="w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VEHICLE_TYPE_LABEL).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="ทะเบียน">
            <Input value={f.plate ?? ''} onChange={(e) => set('plate', e.target.value)} placeholder="เช่น ผจ 6749" />
          </Field>
          <Field label="น้ำหนักขั้นต่ำ (กก.)">
            <NumberInput value={f.minLoadKg} onChange={(v) => set('minLoadKg', v ?? 0)} />
          </Field>
          <Field label="ความจุสูงสุด (กก.)">
            <NumberInput value={f.capacityKg} onChange={(v) => set('capacityKg', v ?? 0)} />
          </Field>
          <Field label="ค่าน้ำมัน (บาท/กม.)" hint="ใช้ประมาณค่าน้ำมันของแต่ละเที่ยว">
            <NumberInput value={f.costPerKm} onChange={(v) => set('costPerKm', v ?? 0)} />
          </Field>
          <Field label="คนขับประจำ">
            <Input value={f.driverName ?? ''} onChange={(e) => set('driverName', e.target.value)} />
          </Field>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm sm:col-span-2">
            ใช้งาน
            <Switch checked={f.isActive} onCheckedChange={(v) => set('isActive', v)} />
          </label>
        </div>

        <section className="grid gap-2 border-t pt-3">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="size-4" /> ประกันภาคสมัครใจ
          </h4>
          <PolicyFields value={f.insurance} onChange={(v) => set('insurance', v)} />
        </section>
        <section className="grid gap-2 border-t pt-3">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="size-4" /> พ.ร.บ.
          </h4>
          <PolicyFields value={f.act} onChange={(v) => set('act', v)} />
        </section>
        <section className="grid gap-2 border-t pt-3">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <FileCheck2 className="size-4" /> ทะเบียนรถ / ภาษี
          </h4>
          <PolicyFields value={{ ...noPolicy, ...f.tax }} onChange={(v) => set('tax', { expiry: v.expiry, cost: v.cost })} withCompany={false} />
        </section>
        {yearProblem ? <p className="text-sm text-destructive">วันที่ต้องเป็นปี ค.ศ. (เช่น 2026) ไม่ใช่ พ.ศ.</p> : null}
        {orderProblem ? <p className="text-sm text-destructive">วันที่ทำต้องไม่เกินวันหมดอายุ</p> : null}

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            className="cursor-pointer"
            disabled={!f.name.trim() || f.capacityKg <= 0 || f.minLoadKg > f.capacityKg || yearProblem || orderProblem || busy}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
