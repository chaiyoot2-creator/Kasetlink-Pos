import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, MonitorSmartphone, Plus, Printer, Store } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Field, LocationSelect, NumberInput, PageHeader } from '@/components/common'
import { BackupSettings } from '@/components/BackupSettings'
import { ReceiptPrint } from '@/components/Receipt'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { isValidPromptPayId } from '@/lib/promptpay'
import { PRICE_LEVELS } from '@/lib/pricing'
import { PAPER_LABEL, getPrintPrefs, printSoon, savePrintPrefs, type PaperSize, type PrintPrefs } from '@/lib/print'
import type { Location, SaleDetail, Settings } from '@/lib/types'

export function SettingsPage() {
  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader title="ตั้งค่า" />
      <ThisTerminal />
      <PrinterSettings />
      <ShopSettings />
      <Locations />
      <BackupSettings />
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
        // Animal feed is VAT exempt: the shop never splits VAT on its documents.
        body: { ...f, vatRegistered: false, promptpayId: f.promptpayId?.replace(/\D/g, '') || null },
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
        <div className="grid gap-2 rounded-lg border p-3 sm:col-span-2">
          <p className="text-sm font-medium">ชื่อระดับราคา 5 ระดับ</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {PRICE_LEVELS.map((lvl) => (
              <Field key={lvl} label={`ระดับ ${lvl}`}>
                <Input
                  value={f.priceLevelNames[lvl - 1] ?? ''}
                  maxLength={30}
                  onChange={(e) => set('priceLevelNames', f.priceLevelNames.map((n, i) => (i === lvl - 1 ? e.target.value : n)))}
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">ระดับ 1 คือราคาเริ่มต้นของลูกค้าทั่วไป และใช้แทนเมื่อสินค้าไม่มีราคาในระดับของลูกค้า</p>
        </div>
        <Field label="สาขาของร้าน" hint="00000 = สำนักงานใหญ่ · พิมพ์บนใบเสร็จเต็มรูป">
          <Input value={f.branchCode} onChange={(e) => set('branchCode', e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" />
        </Field>
        <Field label="ข้อความท้ายใบเสร็จ" className="sm:col-span-2">
          <Input value={f.receiptFooter ?? ''} onChange={(e) => set('receiptFooter', e.target.value)} placeholder="ขอบคุณที่ใช้บริการ" />
        </Field>
        <Button className="cursor-pointer justify-self-start" onClick={() => void save()} disabled={busy || !f.shopName.trim() || ppInvalid || f.priceLevelNames.some((n) => !n.trim()) || !/^\d{5}$/.test(f.branchCode)}>
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

/** Sample bill for the test print. */
function sampleSale(): SaleDetail {
  return {
    id: 'test',
    billNo: 'TEST-0001',
    eventId: 'test',
    terminalId: 'ทดสอบ',
    locationId: '',
    locationName: 'ทดสอบเครื่องพิมพ์',
    customerId: null,
    customerName: null,
    priceLevel: 1,
    subtotal: 1040,
    lineDiscountTotal: 0,
    billDiscount: 20,
    total: 1020,
    costTotal: 0,
    profit: 0,
    paymentMethod: 'cash',
    cashReceived: 1100,
    changeAmount: 80,
    status: 'completed',
    voidReason: null,
    note: null,
    soldAt: new Date().toISOString(),
    createdBy: null,
    forAccounting: false,
    taxInvoiceNo: null,
    taxInvoiceAt: null,
    vatRate: null,
    vatAmount: null,
    buyer: null,
    accountingSentAt: null,
    dueDate: null,
    lines: [
      { lineNo: 1, productId: 'a', productName: 'อาหารหมูขุน สูตร 1 (30 กก.)', unit: 'กระสอบ', qty: 1, unitPrice: 520, lineDiscount: 0, lineTotal: 520, billDiscountShare: 10, netAmount: 510, unitCost: 0, costTotal: 0, priceSource: 'level' },
      { lineNo: 2, productId: 'b', productName: 'อาหารไก่ไข่ (30 กก.)', unit: 'กระสอบ', qty: 1, unitPrice: 520, lineDiscount: 0, lineTotal: 520, billDiscountShare: 10, netAmount: 510, unitCost: 0, costTotal: 0, priceSource: 'level' },
    ],
    lots: [],
  }
}

function PrinterSettings() {
  const [prefs, setPrefs] = useState<PrintPrefs>(getPrintPrefs)
  const [testing, setTesting] = useState(false)

  const update = (patch: Partial<PrintPrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrintPrefs(next)
  }

  useEffect(() => {
    if (!testing) return
    printSoon()
    const done = () => setTesting(false)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [testing])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="size-5" /> เครื่องพิมพ์ใบเสร็จ (เครื่องนี้)
        </CardTitle>
        <CardDescription>
          ตั้งค่าแยกแต่ละเครื่อง ใช้เครื่องพิมพ์ที่ติดตั้งในคอมพิวเตอร์/แท็บเล็ตนี้ เลือกเครื่องพิมพ์ได้ในหน้าต่างพิมพ์ของเบราว์เซอร์
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="ขนาดกระดาษ">
          <Select value={prefs.paper} onValueChange={(v) => update({ paper: v === '58' || v === 'a4' ? v : ('80' satisfies PaperSize) })}>
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['58', '80', 'a4'] as const).map((p) => (
                <SelectItem key={p} value={p}>
                  {PAPER_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <label className="flex h-9 cursor-pointer items-center justify-between gap-3 rounded-md border px-3 text-sm">
          พิมพ์อัตโนมัติหลังบันทึกบิล
          <Switch checked={prefs.autoPrint} onCheckedChange={(v) => update({ autoPrint: v })} />
        </label>
        <Button variant="outline" className="cursor-pointer" onClick={() => setTesting(true)}>
          <Printer /> ทดสอบพิมพ์
        </Button>
      </CardContent>
      {testing ? <ReceiptPrint sale={sampleSale()} /> : null}
    </Card>
  )
}
