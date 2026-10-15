import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Empty, Field, NumberInput } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { VEHICLE_TYPE_LABEL, kg, type Vehicle } from './types'

type Form = Omit<Vehicle, 'id'>

const PRESETS: { label: string; form: Partial<Form> }[] = [
  { label: 'กระบะ 3,000 กก.', form: { vehicleType: 'pickup', minLoadKg: 0, capacityKg: 3000 } },
  { label: 'รถ 6 ล้อ 4,500–9,000 กก.', form: { vehicleType: 'truck6', minLoadKg: 4500, capacityKg: 9000 } },
]

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
}

export function VehiclesTab({ vehicles, onChanged }: { vehicles: Vehicle[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null)
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">ระบบเลือกรถคันเล็กที่สุดที่บรรทุกได้ ถ้าเกินคันเดียวจะแบ่งหลายคันอัตโนมัติ</p>
        <Button className="cursor-pointer" onClick={() => setEditing({ id: null, form: { ...empty } })}>
          <Plus /> เพิ่มรถ
        </Button>
      </div>
      {vehicles.length === 0 ? <Empty title="ยังไม่มีรถ" hint="เพิ่มรถ เช่น รถ 6 ล้อ 4,500–9,000 กก. และกระบะ 3,000 กก." /> : null}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {vehicles.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setEditing({ id: v.id, form: { ...v } })}
            className={cn('grid cursor-pointer gap-1 rounded-lg border bg-card p-3 text-left hover:border-primary', !v.isActive && 'opacity-50')}
          >
            <div className="flex items-center gap-2">
              <Truck className="size-4" />
              <span className="font-semibold">{v.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{VEHICLE_TYPE_LABEL[v.vehicleType] ?? v.vehicleType}</span>
            </div>
            <p className="text-sm">
              ความจุ {v.minLoadKg > 0 ? `${kg(v.minLoadKg)} – ` : ''}
              {kg(v.capacityKg)}
            </p>
            <p className="text-xs text-muted-foreground">
              {v.plate ?? 'ไม่ระบุทะเบียน'}
              {v.driverName ? ` · ${v.driverName}` : ''}
              {v.costPerKm > 0 ? ` · ${v.costPerKm} บาท/กม.` : ''}
              {!v.isActive ? ' · ปิดใช้งาน' : ''}
            </p>
          </button>
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

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await apiFetch(editing.id ? `/delivery/vehicles/${editing.id}` : '/delivery/vehicles', {
        method: editing.id ? 'PUT' : 'POST',
        body: { ...f, plate: f.plate?.trim() || null, driverName: f.driverName?.trim() || null, note: f.note?.trim() || null },
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
      <DialogContent className="max-w-lg">
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
            <Input value={f.plate ?? ''} onChange={(e) => set('plate', e.target.value)} />
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
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" disabled={!f.name.trim() || f.capacityKg <= 0 || f.minLoadKg > f.capacityKg || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
