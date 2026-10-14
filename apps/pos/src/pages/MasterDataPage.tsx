import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { HandCoins, Loader2, Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Empty, ErrorBox, Field, Loading, NumberInput, PageHeader, TableWrap } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { PAYMENT_LABEL, PRICE_TIER_LABEL, baht, dateTime, qty } from '@/lib/format'
import { newEvent } from '@/lib/terminal'
import type { Customer, LedgerEntry, PriceTier, Product, Supplier } from '@/lib/types'
import { useApi, useDebounced } from '@/lib/use-api'
import { cn } from '@/lib/utils'

export function MasterDataPage({ initialTab = 'products' }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab)
  useEffect(() => setTab(initialTab), [initialTab])
  return (
    <div>
      <PageHeader title="ข้อมูลหลัก" subtitle="สินค้า ลูกค้า และผู้จำหน่าย" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="products" className="cursor-pointer">สินค้า</TabsTrigger>
          <TabsTrigger value="customers" className="cursor-pointer">ลูกค้า / ลูกหนี้</TabsTrigger>
          <TabsTrigger value="suppliers" className="cursor-pointer">ผู้จำหน่าย</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-3">
          <Products />
        </TabsContent>
        <TabsContent value="customers" className="mt-3">
          <Customers />
        </TabsContent>
        <TabsContent value="suppliers" className="mt-3">
          <Suppliers />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-48 flex-1 sm:max-w-sm">
      <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-8" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

// ---------------------------------------------------------------- products

type ProductForm = Omit<Product, 'id' | 'avgCost' | 'qtyTotal' | 'qtyHere'>

const emptyProduct: ProductForm = {
  sku: '',
  barcode: null,
  name: '',
  category: null,
  unit: 'กระสอบ',
  priceRetail: 0,
  priceWholesale: 0,
  priceMember: 0,
  reorderPoint: 0,
  trackExpiry: true,
  isActive: true,
}

function toProductForm(p: Product): ProductForm {
  return {
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    category: p.category,
    unit: p.unit,
    priceRetail: p.priceRetail,
    priceWholesale: p.priceWholesale,
    priceMember: p.priceMember,
    reorderPoint: p.reorderPoint,
    trackExpiry: p.trackExpiry,
    isActive: p.isActive,
  }
}

function Products() {
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim())
  const { data, error, loading, reload } = useApi<Product[]>(`/products?q=${encodeURIComponent(dq)}&all=1&limit=500`)
  const [editing, setEditing] = useState<{ id: string | null; form: ProductForm } | null>(null)

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="ชื่อ / รหัส / บาร์โค้ด / หมวด" />
        <Button className="cursor-pointer" onClick={() => setEditing({ id: null, form: { ...emptyProduct } })}>
          <Plus /> เพิ่มสินค้า
        </Button>
      </div>
      {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? <Empty title="ยังไม่มีสินค้า" hint="เพิ่มสินค้า แล้วรับเข้าสต็อกหรือปรับยอดยกมา" /> : null}
      {data && data.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>สินค้า</TableHead>
                <TableHead className="text-right">ปลีก</TableHead>
                <TableHead className="hidden text-right sm:table-cell">ส่ง</TableHead>
                <TableHead className="hidden text-right sm:table-cell">สมาชิก</TableHead>
                <TableHead className="hidden text-right md:table-cell">ทุนเฉลี่ย</TableHead>
                <TableHead className="text-right">คงเหลือ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow
                  key={p.id}
                  className={cn('cursor-pointer', !p.isActive && 'opacity-50')}
                  onClick={() => setEditing({ id: p.id, form: toProductForm(p) })}
                >
                  <TableCell>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.sku}
                      {p.barcode ? ` · ${p.barcode}` : ''}
                      {p.category ? ` · ${p.category}` : ''}
                      {!p.isActive ? ' · ปิดขาย' : ''}
                    </p>
                  </TableCell>
                  <TableCell className="tabular text-right">{baht(p.priceRetail)}</TableCell>
                  <TableCell className="tabular hidden text-right sm:table-cell">{baht(p.priceWholesale)}</TableCell>
                  <TableCell className="tabular hidden text-right sm:table-cell">{baht(p.priceMember)}</TableCell>
                  <TableCell className="tabular hidden text-right md:table-cell">{baht(p.avgCost)}</TableCell>
                  <TableCell className="tabular text-right">
                    {qty(p.qtyTotal)} <span className="text-xs text-muted-foreground">{p.unit}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}
      <ProductDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void reload()
        }}
      />
    </div>
  )
}

function ProductDialog({ editing, onClose, onSaved }: { editing: { id: string | null; form: ProductForm } | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<ProductForm>(emptyProduct)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (editing) setF(editing.form)
  }, [editing])
  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const valid = f.sku.trim() && f.name.trim() && f.unit.trim()

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await apiFetch(editing.id ? `/products/${editing.id}` : '/products', {
        method: editing.id ? 'PUT' : 'POST',
        body: { ...f, barcode: f.barcode?.trim() || null, category: f.category?.trim() || null },
      })
      toast.success('บันทึกสินค้าแล้ว')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing?.id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}</DialogTitle>
          <DialogDescription>ต้นทุนเฉลี่ยคำนวณจากการรับเข้า แก้ไขที่นี่ไม่ได้</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ชื่อสินค้า" className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="เช่น อาหารหมูขุน สูตร 1 (30 กก.)" />
          </Field>
          <Field label="รหัสสินค้า (SKU)">
            <Input value={f.sku} onChange={(e) => set('sku', e.target.value)} />
          </Field>
          <Field label="บาร์โค้ด">
            <Input value={f.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="หมวดหมู่">
            <Input value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="อาหารหมู / อาหารไก่ / ยาสัตว์" />
          </Field>
          <Field label="หน่วยขาย">
            <Input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="กระสอบ / ถุง / กก." />
          </Field>
          <Field label="ราคาปลีก">
            <NumberInput value={f.priceRetail} onChange={(v) => set('priceRetail', v ?? 0)} />
          </Field>
          <Field label="ราคาส่ง" hint="0 = ใช้ราคาปลีก">
            <NumberInput value={f.priceWholesale} onChange={(v) => set('priceWholesale', v ?? 0)} />
          </Field>
          <Field label="ราคาสมาชิก" hint="0 = ใช้ราคาปลีก">
            <NumberInput value={f.priceMember} onChange={(v) => set('priceMember', v ?? 0)} />
          </Field>
          <Field label="จุดสั่งซื้อ (แจ้งเตือนเมื่อเหลือ ≤)">
            <NumberInput value={f.reorderPoint} onChange={(v) => set('reorderPoint', v ?? 0)} />
          </Field>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            ต้องระบุวันหมดอายุตอนรับเข้า
            <Switch checked={f.trackExpiry} onCheckedChange={(v) => set('trackExpiry', v)} />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            เปิดขาย
            <Switch checked={f.isActive} onCheckedChange={(v) => set('isActive', v)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" onClick={() => void save()} disabled={!valid || busy}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- customers

type CustomerForm = Omit<Customer, 'id' | 'balance'>
const emptyCustomer: CustomerForm = { code: '', name: '', phone: null, customerType: 'retail', creditLimit: 0, note: null, isActive: true }

function Customers() {
  const [q, setQ] = useState('')
  const [debtOnly, setDebtOnly] = useState(false)
  const dq = useDebounced(q.trim())
  const { data, error, loading, reload } = useApi<Customer[]>(`/customers?q=${encodeURIComponent(dq)}&debt=${debtOnly ? 1 : 0}`)
  const [editing, setEditing] = useState<{ id: string | null; form: CustomerForm } | null>(null)
  const [ledgerId, setLedgerId] = useState<string | null>(null)
  const totalDebt = data?.reduce((s, c) => s + Math.max(c.balance, 0), 0) ?? 0

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="ชื่อ / รหัส / เบอร์โทร" />
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch checked={debtOnly} onCheckedChange={setDebtOnly} /> เฉพาะที่มียอดค้าง
        </label>
        <Button className="cursor-pointer sm:ml-auto" onClick={() => setEditing({ id: null, form: { ...emptyCustomer } })}>
          <Plus /> เพิ่มลูกค้า
        </Button>
      </div>
      {data && totalDebt > 0 ? <p className="text-sm text-muted-foreground">ลูกหนี้รวม (ตามรายการที่แสดง) <span className="tabular font-semibold text-destructive">{baht(totalDebt)}</span> บาท</p> : null}
      {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? <Empty title="ไม่พบลูกค้า" /> : null}
      {data && data.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ลูกค้า</TableHead>
                <TableHead>ประเภท</TableHead>
                <TableHead className="hidden text-right sm:table-cell">วงเงิน</TableHead>
                <TableHead className="text-right">ยอดค้าง</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id} className={cn(!c.isActive && 'opacity-50')}>
                  <TableCell
                    className="cursor-pointer"
                    onClick={() =>
                      setEditing({
                        id: c.id,
                        form: { code: c.code, name: c.name, phone: c.phone, customerType: c.customerType, creditLimit: c.creditLimit, note: c.note, isActive: c.isActive },
                      })
                    }
                  >
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.code}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{PRICE_TIER_LABEL[c.customerType]}</Badge>
                  </TableCell>
                  <TableCell className="tabular hidden text-right sm:table-cell">{c.creditLimit > 0 ? baht(c.creditLimit) : '-'}</TableCell>
                  <TableCell className={cn('tabular text-right', c.balance > 0 && 'font-semibold text-destructive')}>{baht(c.balance)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setLedgerId(c.id)}>
                      บัญชี
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}
      <CustomerDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void reload()
        }}
      />
      <LedgerDialog id={ledgerId} onClose={() => setLedgerId(null)} onChanged={() => void reload()} />
    </div>
  )
}

function CustomerDialog({ editing, onClose, onSaved }: { editing: { id: string | null; form: CustomerForm } | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<CustomerForm>(emptyCustomer)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (editing) setF(editing.form)
  }, [editing])
  const set = <K extends keyof CustomerForm>(k: K, v: CustomerForm[K]) => setF((p) => ({ ...p, [k]: v }))

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await apiFetch(editing.id ? `/customers/${editing.id}` : '/customers', {
        method: editing.id ? 'PUT' : 'POST',
        body: { ...f, phone: f.phone?.trim() || null, note: f.note?.trim() || null },
      })
      toast.success('บันทึกลูกค้าแล้ว')
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
          <DialogTitle>{editing?.id ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า'}</DialogTitle>
          <DialogDescription>ประเภทลูกค้ากำหนดระดับราคาเริ่มต้นตอนขาย</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ชื่อลูกค้า / ฟาร์ม" className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="รหัสลูกค้า">
            <Input value={f.code} onChange={(e) => set('code', e.target.value)} />
          </Field>
          <Field label="เบอร์โทร">
            <Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
          </Field>
          <Field label="ประเภท (ระดับราคา)">
            <Select value={f.customerType} onValueChange={(v) => set('customerType', v as PriceTier)}>
              <SelectTrigger className="w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="retail">ปลีก</SelectItem>
                <SelectItem value="wholesale">ส่ง</SelectItem>
                <SelectItem value="member">สมาชิก</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="วงเงินเครดิต (บาท)" hint="0 = ไม่อนุญาตขายเชื่อ">
            <NumberInput value={f.creditLimit} onChange={(v) => set('creditLimit', v ?? 0)} />
          </Field>
          <Field label="หมายเหตุ" className="sm:col-span-2">
            <Textarea value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} rows={2} />
          </Field>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">
            ใช้งานอยู่
            <Switch checked={f.isActive} onCheckedChange={(v) => set('isActive', v)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" onClick={() => void save()} disabled={!f.code.trim() || !f.name.trim() || busy}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LedgerDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { locationId } = useApp()
  const { data, error, reload } = useApi<{ customer: Customer; entries: LedgerEntry[] }>(id ? `/customers/${id}/ledger` : null)
  const [amount, setAmount] = useState<number | null>(null)
  const [method, setMethod] = useState('cash')
  const [busy, setBusy] = useState(false)
  const ledger = id && data?.customer.id === id ? data : null

  const pay = async () => {
    if (!ledger || !amount) return
    setBusy(true)
    try {
      await apiFetch(`/customers/${ledger.customer.id}/payments`, {
        method: 'POST',
        body: { ...newEvent(), zoneId: locationId || 'office', amount, method },
      })
      toast.success(`รับชำระ ${baht(amount)} บาทแล้ว`)
      setAmount(null)
      onChanged()
      void reload()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const label = (e: LedgerEntry) => (e.entryType === 'sale' ? `ขายเชื่อ ${e.billNo ?? ''}` : e.entryType === 'sale_void' ? `ยกเลิกบิล ${e.billNo ?? ''}` : `รับชำระ (${PAYMENT_LABEL[e.paymentMethod ?? ''] ?? '-'})`)

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ledger?.customer.name ?? 'บัญชีลูกหนี้'}</DialogTitle>
          <DialogDescription>
            {ledger ? `ยอดค้างชำระ ${baht(ledger.customer.balance)} บาท · วงเงิน ${baht(ledger.customer.creditLimit)}` : ' '}
          </DialogDescription>
        </DialogHeader>
        {error ? <ErrorBox message={error} /> : null}
        {!ledger && !error ? <Loading /> : null}
        {ledger && ledger.customer.balance > 0 ? (
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
            <Field label="รับชำระหนี้ (บาท)">
              <NumberInput value={amount} onChange={setAmount} placeholder={baht(ledger.customer.balance)} />
            </Field>
            <Field label="ช่องทาง">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="w-full cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">เงินสด</SelectItem>
                  <SelectItem value="promptpay">พร้อมเพย์</SelectItem>
                  <SelectItem value="transfer">โอนเงิน</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button className="cursor-pointer" disabled={busy || !amount || amount > ledger.customer.balance} onClick={() => void pay()}>
              {busy ? <Loader2 className="animate-spin" /> : <HandCoins />} รับชำระ
            </Button>
          </div>
        ) : null}
        {ledger?.entries.length === 0 ? <Empty title="ยังไม่มีรายการ" /> : null}
        {ledger && ledger.entries.length > 0 ? (
          <ul className="divide-y text-sm">
            {ledger.entries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 py-2">
                <div>
                  <p>{label(e)}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime(e.createdAt)}
                    {e.note ? ` · ${e.note}` : ''}
                  </p>
                </div>
                <span className={cn('tabular font-medium', e.amount > 0 ? 'text-destructive' : 'text-primary')}>
                  {e.amount > 0 ? '+' : ''}
                  {baht(e.amount)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- suppliers

type SupplierForm = Omit<Supplier, 'id'>

function Suppliers() {
  const { data, error, loading, reload } = useApi<Supplier[]>('/suppliers')
  const [editing, setEditing] = useState<{ id: string | null; form: SupplierForm } | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await apiFetch(editing.id ? `/suppliers/${editing.id}` : '/suppliers', {
        method: editing.id ? 'PUT' : 'POST',
        body: { ...editing.form, phone: editing.form.phone?.trim() || null, note: editing.form.note?.trim() || null },
      })
      toast.success('บันทึกผู้จำหน่ายแล้ว')
      setEditing(null)
      void reload()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const setForm = (patch: Partial<SupplierForm>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))

  return (
    <div className="grid gap-3">
      <Button className="cursor-pointer justify-self-start" onClick={() => setEditing({ id: null, form: { name: '', phone: null, note: null, isActive: true } })}>
        <Plus /> เพิ่มผู้จำหน่าย
      </Button>
      {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? <Empty title="ยังไม่มีผู้จำหน่าย" /> : null}
      {data && data.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อ</TableHead>
                <TableHead>เบอร์โทร</TableHead>
                <TableHead className="hidden sm:table-cell">หมายเหตุ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow
                  key={s.id}
                  className={cn('cursor-pointer', !s.isActive && 'opacity-50')}
                  onClick={() => {
                    const { id, ...form } = s
                    setEditing({ id, form })
                  }}
                >
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.phone ?? '-'}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{s.note ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && !busy && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'แก้ไขผู้จำหน่าย' : 'เพิ่มผู้จำหน่าย'}</DialogTitle>
            <DialogDescription>ใช้ในใบสั่งซื้อและการรับสินค้า</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-3">
              <Field label="ชื่อ">
                <Input value={editing.form.name} onChange={(e) => setForm({ name: e.target.value })} />
              </Field>
              <Field label="เบอร์โทร">
                <Input value={editing.form.phone ?? ''} onChange={(e) => setForm({ phone: e.target.value })} inputMode="tel" />
              </Field>
              <Field label="หมายเหตุ">
                <Textarea value={editing.form.note ?? ''} onChange={(e) => setForm({ note: e.target.value })} rows={2} />
              </Field>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                ใช้งานอยู่
                <Switch checked={editing.form.isActive} onCheckedChange={(v) => setForm({ isActive: v })} />
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button className="cursor-pointer" disabled={busy || !editing?.form.name.trim()} onClick={() => void save()}>
              {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
