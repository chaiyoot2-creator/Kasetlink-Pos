import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, MonitorSmartphone, Plus, Store } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Field, LocationSelect, NumberInput, PageHeader } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { isValidPromptPayId } from '@/lib/promptpay'
import type { Location, Settings } from '@/lib/types'

export function SettingsPage() {
  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader title="ตั้งค่า" />
      <ThisTerminal />
      <ShopSettings />
      <Locations />
    </div>
  )
}

function ThisTerminal() {
  const app = useApp()
  const registered = app.data.terminals.find((t) => t.id === app.terminalId)
  const [name, setName] = useState(registered?.name ?? '')
  const [locationId, setLocationId] = useState(registered?.locationId ?? app.locationId)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await apiFetch('/terminals', { method: 'PUT', body: { id: app.terminalId, name: name.trim(), locationId: locationId || null } })
      if (locationId) app.setLocationId(locationId)
      await app.reload()
      toast.success('บันทึกเครื่องนี้แล้ว')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="size-5" /> เครื่องนี้
        </CardTitle>
        <CardDescription>
          รหัสเครื่อง <span className="font-mono">{app.terminalId}</span> — ทุกบิลและการเคลื่อนไหวสต็อกจะบันทึกรหัสเครื่องและโซนไว้ (สำหรับ AI Vision)
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="ชื่อเครื่อง">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น แคชเชียร์ 1 / แท็บเล็ตโกดัง" />
        </Field>
        <Field label="สาขา/โซนประจำเครื่อง">
          <LocationSelect value={locationId} onChange={setLocationId} />
        </Field>
        <Button className="cursor-pointer" onClick={() => void save()} disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
        </Button>
      </CardContent>
    </Card>
  )
}

function ShopSettings() {
  const app = useApp()
  const [f, setF] = useState<Settings>(app.data.settings)
  const [busy, setBusy] = useState(false)
  useEffect(() => setF(app.data.settings), [app.data.settings])
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF((p) => ({ ...p, [k]: v }))
  const ppInvalid = !!f.promptpayId && !isValidPromptPayId(f.promptpayId)

  const save = async () => {
    setBusy(true)
    try {
      await apiFetch('/settings', {
        method: 'PUT',
        body: { ...f, promptpayId: f.promptpayId?.replace(/\D/g, '') || null },
      })
      await app.reload()
      toast.success('บันทึกข้อมูลร้านแล้ว')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="size-5" /> ข้อมูลร้าน
        </CardTitle>
        <CardDescription>แสดงบนใบเสร็จ และใช้สร้าง QR พร้อมเพย์</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Field label="ชื่อร้าน" className="sm:col-span-2">
          <Input value={f.shopName} onChange={(e) => set('shopName', e.target.value)} />
        </Field>
        <Field label="ที่อยู่" className="sm:col-span-2">
          <Textarea value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} rows={2} />
        </Field>
        <Field label="เบอร์โทร">
          <Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
        </Field>
        <Field label="เลขประจำตัวผู้เสียภาษี">
          <Input value={f.taxId ?? ''} onChange={(e) => set('taxId', e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="พร้อมเพย์ของร้าน" hint={ppInvalid ? 'ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขประจำตัว 13 หลัก' : 'เบอร์มือถือ หรือเลขประจำตัวผู้เสียภาษี'}>
          <Input value={f.promptpayId ?? ''} onChange={(e) => set('promptpayId', e.target.value)} inputMode="numeric" aria-invalid={ppInvalid} />
        </Field>
        <Field label="แจ้งเตือนใกล้หมดอายุล่วงหน้า (วัน)">
          <NumberInput value={f.expiryAlertDays} onChange={(v) => set('expiryAlertDays', Math.round(v ?? 0))} />
        </Field>
        <Field label="ข้อความท้ายใบเสร็จ" className="sm:col-span-2">
          <Input value={f.receiptFooter ?? ''} onChange={(e) => set('receiptFooter', e.target.value)} placeholder="ขอบคุณที่ใช้บริการ" />
        </Field>
        <Button className="cursor-pointer justify-self-start" onClick={() => void save()} disabled={busy || !f.shopName.trim() || ppInvalid}>
          {busy ? <Loader2 className="animate-spin" /> : null} บันทึกข้อมูลร้าน
        </Button>
      </CardContent>
    </Card>
  )
}

function Locations() {
  const app = useApp()
  const [editing, setEditing] = useState<{ id: string | null; code: string; name: string; kind: 'store' | 'warehouse'; isActive: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      const { id, ...body } = editing
      await apiFetch(id ? `/locations/${id}` : '/locations', { method: id ? 'PUT' : 'POST', body })
      await app.reload()
      setEditing(null)
      toast.success('บันทึกสาขา/โซนแล้ว')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const edit = (l: Location) => setEditing({ id: l.id, code: l.code, name: l.name, kind: l.kind === 'warehouse' ? 'warehouse' : 'store', isActive: l.isActive })

  return (
    <Card>
      <CardHeader>
        <CardTitle>สาขา / โซนเก็บสินค้า</CardTitle>
        <CardDescription>แต่ละโซนมีสต็อกแยกกัน (zone_id ของ event) เช่น หน้าร้าน โกดังหลัง</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {app.data.locations.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => edit(l)}
            className="flex cursor-pointer items-center justify-between rounded-lg border p-3 text-left hover:bg-muted"
          >
            <span>
              <span className="font-medium">{l.name}</span> <span className="text-sm text-muted-foreground">({l.code})</span>
            </span>
            <span className="flex gap-1">
              <Badge variant="secondary">{l.kind === 'warehouse' ? 'โกดัง' : 'หน้าร้าน'}</Badge>
              {!l.isActive ? <Badge variant="outline">ปิดใช้</Badge> : null}
            </span>
          </button>
        ))}
        <Button variant="outline" className="cursor-pointer justify-self-start" onClick={() => setEditing({ id: null, code: '', name: '', kind: 'store', isActive: true })}>
          <Plus /> เพิ่มสาขา/โซน
        </Button>
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && !busy && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'แก้ไขสาขา/โซน' : 'เพิ่มสาขา/โซน'}</DialogTitle>
            <DialogDescription>รหัสสั้น ๆ ใช้ในรายงาน เช่น FRONT, WH1</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-3">
              <Field label="ชื่อ">
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="รหัส">
                <Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="ประเภท">
                <Select value={editing.kind} onValueChange={(v) => setEditing({ ...editing, kind: v === 'warehouse' ? 'warehouse' : 'store' })}>
                  <SelectTrigger className="w-full cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store">หน้าร้าน (ขายได้)</SelectItem>
                    <SelectItem value="warehouse">โกดัง</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                ใช้งานอยู่
                <Switch checked={editing.isActive} onCheckedChange={(v) => setEditing({ ...editing, isActive: v })} />
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button className="cursor-pointer" disabled={busy || !editing?.name.trim() || !editing?.code.trim()} onClick={() => void save()}>
              {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
