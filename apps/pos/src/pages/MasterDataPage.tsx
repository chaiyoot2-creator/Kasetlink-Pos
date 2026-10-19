import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet, FileText, HandCoins, Loader2, Plus, Printer, Search, Trash2 } from 'lucide-react'
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
import { ImportDialog } from '@/components/ImportDialog'
import { ProductImage } from '@/components/ProductImage'
import { ProductImageField } from '@/components/ProductImageField'
import { ProductPicker } from '@/components/ProductPicker'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { uploadProductImage } from '@/lib/image'
import { unitWeightKg } from '@/pages/delivery/types'
import { PAYMENT_LABEL, baht, dateOnly, dateTime, qty } from '@/lib/format'
import { PRICE_LEVELS, levelName } from '@/lib/pricing'
import { toDataURL } from 'qrcode'
import { StatementPrint } from '@/components/Statement'
import { PaymentReceiptPrint } from '@/components/PaymentReceipt'
import { ReceivePaymentDialog } from '@/components/ReceivePaymentDialog'
import { DueBadge } from '@/pages/ReceivablesPage'
import { printSoon } from '@/lib/print'
import { isValidPromptPayId, promptPayPayload } from '@/lib/promptpay'
import type { Brand, Customer, CustomerPrice, Ledger, LedgerEntry, OpenBill, PaymentReceipt, Product, Supplier } from '@/lib/types'
import { useAuth } from '@/lib/auth'
import { useApi, useDebounced } from '@/lib/use-api'
import { cn } from '@/lib/utils'

export function MasterDataPage({ initialTab = 'products' }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab)
  useEffect(() => setTab(initialTab), [initialTab])
  return (
    <div>
      <PageHeader title="ข้อมูลหลัก" subtitle="สินค้า แบรนด์ ลูกค้า และผู้จำหน่าย" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="products" className="cursor-pointer">สินค้า</TabsTrigger>
          <TabsTrigger value="brands" className="cursor-pointer">แบรนด์</TabsTrigger>
          <TabsTrigger value="customers" className="cursor-pointer">ลูกค้า / ลูกหนี้</TabsTrigger>
          <TabsTrigger value="suppliers" className="cursor-pointer">ผู้จำหน่าย</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-3">
          <Products />
        </TabsContent>
        <TabsContent value="brands" className="mt-3">
          <Brands />
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

interface NextCodes {
  sku: string
  barcode: string
  customerCode: string
}

/** Codes the server would assign next — shown as placeholders while creating. */
function useNextCodes(enabled: boolean): NextCodes | null {
  const { data } = useApi<NextCodes>(enabled ? '/next-codes' : null)
  return enabled ? data : null
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

type ProductForm = Omit<Product, 'id' | 'avgCost' | 'qtyTotal' | 'qtyHere' | 'brandName' | 'supplierId' | 'supplierName' | 'imageUrl'>

const emptyProduct: ProductForm = {
  sku: '',
  barcode: null,
  name: '',
  category: null,
  unit: 'กระสอบ',
  priceLevels: [0, 0, 0, 0, 0],
  reorderPoint: 0,
  trackExpiry: true,
  isActive: true,
  brandId: null,
}

function toProductForm(p: Product): ProductForm {
  return {
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    category: p.category,
    unit: p.unit,
    priceLevels: [...p.priceLevels],
    reorderPoint: p.reorderPoint,
    trackExpiry: p.trackExpiry,
    isActive: p.isActive,
    brandId: p.brandId,
    weightKg: p.weightKg ?? null,
  }
}

/** Level 1 always visible; higher levels appear as the screen widens. */
const LEVEL_COL_CLASS = ['', 'hidden sm:table-cell', 'hidden md:table-cell', 'hidden lg:table-cell', 'hidden lg:table-cell']

function Products() {
  const levelNames = useApp().data.settings.priceLevelNames
  const showCost = useAuth().can('view.cost')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim())
  const [brandFilter, setBrandFilter] = useState('')
  const { data, error, loading, reload } = useApi<Product[]>(
    `/products?q=${encodeURIComponent(dq)}&all=1&limit=500&brandId=${brandFilter}`,
  )
  const brands = useApi<Brand[]>('/brands')
  const [editing, setEditing] = useState<{ id: string | null; form: ProductForm; imageUrl: string | null } | null>(null)
  const [importing, setImporting] = useState(false)

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="ชื่อ / รหัส / บาร์โค้ด / หมวด / แบรนด์" />
        <div className="w-full sm:w-56">
          <Select value={brandFilter || 'all'} onValueChange={(v) => setBrandFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกแบรนด์</SelectItem>
              <SelectItem value="none">ไม่ระบุแบรนด์</SelectItem>
              {brands.data?.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button className="cursor-pointer" onClick={() => setEditing({ id: null, form: { ...emptyProduct }, imageUrl: null })}>
          <Plus /> เพิ่มสินค้า
        </Button>
        <Button variant="outline" className="cursor-pointer" onClick={() => setImporting(true)}>
          <FileSpreadsheet /> นำเข้า Excel
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
                {PRICE_LEVELS.map((lvl) => (
                  <TableHead key={lvl} className={cn('text-right', LEVEL_COL_CLASS[lvl - 1])}>
                    {levelName(levelNames, lvl)}
                  </TableHead>
                ))}
                {showCost ? <TableHead className="hidden text-right md:table-cell">ทุนเฉลี่ย</TableHead> : null}
                <TableHead className="text-right">คงเหลือ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow
                  key={p.id}
                  className={cn('cursor-pointer', !p.isActive && 'opacity-50')}
                  onClick={() => setEditing({ id: p.id, form: toProductForm(p), imageUrl: p.imageUrl ?? null })}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                    <ProductImage url={p.imageUrl} alt={p.name} className="size-11 shrink-0 border" />
                    <div className="min-w-0">
                    <p className="font-medium">
                      {p.name}
                      {p.brandName ? (
                        <Badge variant="secondary" className="ml-2 align-middle font-normal">
                          {p.brandName}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.sku}
                      {p.barcode ? ` · ${p.barcode}` : ''}
                      {p.category ? ` · ${p.category}` : ''}
                      {!p.isActive ? ' · ปิดขาย' : ''}
                    </p>
                    </div>
                    </div>
                  </TableCell>
                  {PRICE_LEVELS.map((lvl) => {
                    const price = p.priceLevels[lvl - 1] ?? 0
                    return (
                      <TableCell key={lvl} className={cn('tabular text-right', LEVEL_COL_CLASS[lvl - 1], price <= 0 && 'text-muted-foreground')}>
                        {price > 0 ? baht(price) : '-'}
                      </TableCell>
                    )
                  })}
                  {showCost ? <TableCell className="tabular hidden text-right md:table-cell">{baht(p.avgCost)}</TableCell> : null}
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
        onImageChanged={() => void reload()}
      />
      <ImportDialog kind="products" open={importing} onClose={() => setImporting(false)} onDone={() => void reload()} />
    </div>
  )
}

function ProductDialog({
  editing,
  onClose,
  onSaved,
  onImageChanged,
}: {
  editing: { id: string | null; form: ProductForm; imageUrl: string | null } | null
  onClose: () => void
  onSaved: () => void
  onImageChanged: () => void
}) {
  const levelNames = useApp().data.settings.priceLevelNames
  const [f, setF] = useState<ProductForm>(emptyProduct)
  const [busy, setBusy] = useState(false)
  // New products: the chosen photo is uploaded right after the product is created.
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  useEffect(() => {
    if (editing) setF(editing.form)
    setPendingImage(null)
  }, [editing])
  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const isNew = editing !== null && editing.id === null
  const next = useNextCodes(isNew)
  // New products may leave SKU / barcode empty: the server assigns them.
  const valid = (isNew || f.sku.trim()) && f.name.trim() && f.unit.trim()

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      const saved = await apiFetch<Product>(editing.id ? `/products/${editing.id}` : '/products', {
        method: editing.id ? 'PUT' : 'POST',
        body: {
          ...f,
          sku: f.sku.trim() || null,
          barcode: f.barcode?.trim() || null,
          category: f.category?.trim() || null,
        },
      })
      if (isNew && pendingImage) {
        try {
          await uploadProductImage(saved.id, pendingImage)
        } catch (err) {
          toast.error(`เพิ่มสินค้าแล้ว แต่อัปโหลดรูปไม่สำเร็จ: ${errorMessage(err)}`)
        }
      }
      toast.success(isNew ? `เพิ่มสินค้าแล้ว · รหัส ${saved.sku}${saved.barcode ? ` · บาร์โค้ด ${saved.barcode}` : ''}` : 'บันทึกสินค้าแล้ว')
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
          <ProductImageField
            className="sm:col-span-2"
            productId={editing?.id ?? null}
            name={f.name}
            initialUrl={editing?.imageUrl ?? null}
            pending={pendingImage}
            onPending={setPendingImage}
            onChanged={onImageChanged}
          />
          <Field label="ชื่อสินค้า" className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="เช่น อาหารหมูขุน สูตร 1 (30 กก.)" />
          </Field>
          <Field label="รหัสสินค้า (SKU)" hint={isNew ? 'เว้นว่างไว้ ระบบจะสร้างรหัสให้อัตโนมัติ' : undefined}>
            <Input
              value={f.sku}
              onChange={(e) => set('sku', e.target.value)}
              placeholder={isNew ? `อัตโนมัติ${next ? `: ${next.sku}` : ''}` : undefined}
            />
          </Field>
          <Field label="บาร์โค้ด" hint={isNew ? 'สแกนบาร์โค้ดจากถุงได้ ถ้าเว้นว่างระบบสร้างบาร์โค้ดภายในร้าน (EAN-13) ให้' : undefined}>
            <Input
              value={f.barcode ?? ''}
              onChange={(e) => set('barcode', e.target.value)}
              inputMode="numeric"
              placeholder={isNew ? `อัตโนมัติ${next ? `: ${next.barcode}` : ''}` : undefined}
            />
          </Field>
          <Field label="แบรนด์" className="sm:col-span-2" hint="แบรนด์ผูกกับผู้จำหน่าย — เพิ่มแบรนด์ได้ที่แท็บ แบรนด์">
            <BrandSelect value={f.brandId} onChange={(v) => set('brandId', v)} />
          </Field>
          <Field label="หมวดหมู่">
            <Input value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="อาหารหมู / อาหารไก่ / ยาสัตว์" />
          </Field>
          <Field label="หน่วยขาย">
            <Input value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="กระสอบ / ถุง / กก." />
          </Field>
          <Field
            label="น้ำหนักต่อหน่วย (กก.) — ใช้คำนวณรถจัดส่ง"
            className="sm:col-span-2"
            hint={`เว้นว่าง = ระบบเดาจากชื่อหรือหมวด (ตอนนี้ ${unitWeightKg({ weightKg: null, name: f.name, category: f.category })} กก.)`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <NumberInput className="w-28" value={f.weightKg ?? null} onChange={(v) => set('weightKg', v)} />
              {[
                [10, 'อาหารเลี้ยงลูกด้วยนม'],
                [20, 'สัตว์น้ำ/สัตว์เลี้ยง'],
                [30, 'สุกร วัว ไก่ ฯลฯ'],
              ].map(([w, label]) => (
                <Button
                  key={w}
                  type="button"
                  size="sm"
                  variant={f.weightKg === w ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => set('weightKg', Number(w))}
                >
                  {w} กก. · {label}
                </Button>
              ))}
            </div>
          </Field>
          <div className="grid gap-3 rounded-lg border p-3 sm:col-span-2">
            <p className="text-sm font-medium">ราคาขาย 5 ระดับ</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {PRICE_LEVELS.map((lvl) => (
                <Field key={lvl} label={`${lvl}. ${levelName(levelNames, lvl)}`}>
                  <NumberInput
                    value={f.priceLevels[lvl - 1] ?? 0}
                    onChange={(v) => set('priceLevels', f.priceLevels.map((old, i) => (i === lvl - 1 ? (v ?? 0) : old)))}
                  />
                </Field>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              ระดับที่เว้น 0 ไว้ ระบบจะใช้ราคา{levelName(levelNames, 1)}แทนและแจ้งเตือนในตะกร้า · ลูกค้าที่มีราคาฟิกซ์จะใช้ราคาฟิกซ์ก่อน
            </p>
          </div>
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

type CustomerForm = Omit<Customer, 'id' | 'balance' | 'fixedPriceCount'>
const emptyCustomer: CustomerForm = {
  code: '',
  name: '',
  phone: null,
  priceLevel: 1,
  creditLimit: 0,
  note: null,
  isActive: true,
  taxId: null,
  address: null,
  branchCode: null,
  sendToAccounting: false,
  creditTermDays: 30,
}

function toCustomerForm(c: Customer): CustomerForm {
  return {
    code: c.code,
    name: c.name,
    phone: c.phone,
    priceLevel: c.priceLevel,
    creditLimit: c.creditLimit,
    note: c.note,
    isActive: c.isActive,
    taxId: c.taxId,
    address: c.address,
    branchCode: c.branchCode,
    sendToAccounting: c.sendToAccounting,
    creditTermDays: c.creditTermDays,
  }
}

function Customers() {
  const levelNames = useApp().data.settings.priceLevelNames
  const [fixedFor, setFixedFor] = useState<Customer | null>(null)
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
                <TableHead>ระดับราคา</TableHead>
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
                      setEditing({ id: c.id, form: toCustomerForm(c) })
                    }
                  >
                    <p className="font-medium">
                      {c.name}
                      {c.sendToAccounting ? (
                        <Badge variant="outline" className="ml-2 align-middle font-normal">
                          ส่งบัญชี
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.code}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="secondary">{levelName(levelNames, c.priceLevel)}</Badge>
                      {c.fixedPriceCount > 0 ? <Badge>ฟิกซ์ {c.fixedPriceCount}</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="tabular hidden text-right sm:table-cell">{c.creditLimit > 0 ? baht(c.creditLimit) : '-'}</TableCell>
                  <TableCell className={cn('tabular text-right', c.balance > 0 && 'font-semibold text-destructive')}>{baht(c.balance)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setFixedFor(c)}>
                        ราคาฟิกซ์
                      </Button>
                      <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setLedgerId(c.id)}>
                        บัญชี
                      </Button>
                    </div>
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
      <FixedPriceDialog customer={fixedFor} onClose={() => setFixedFor(null)} onChanged={() => void reload()} />
    </div>
  )
}

function CustomerDialog({ editing, onClose, onSaved }: { editing: { id: string | null; form: CustomerForm } | null; onClose: () => void; onSaved: () => void }) {
  const levelNames = useApp().data.settings.priceLevelNames
  const [f, setF] = useState<CustomerForm>(emptyCustomer)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (editing) setF(editing.form)
  }, [editing])
  const set = <K extends keyof CustomerForm>(k: K, v: CustomerForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const isNew = editing !== null && editing.id === null
  const next = useNextCodes(isNew)

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      const saved = await apiFetch<Customer>(editing.id ? `/customers/${editing.id}` : '/customers', {
        method: editing.id ? 'PUT' : 'POST',
        body: {
          ...f,
          code: f.code.trim() || null,
          phone: f.phone?.trim() || null,
          note: f.note?.trim() || null,
          taxId: f.taxId?.trim() || null,
          address: f.address?.trim() || null,
          branchCode: f.branchCode?.trim() || null,
        },
      })
      toast.success(isNew ? `เพิ่มลูกค้าแล้ว · รหัส ${saved.code}` : 'บันทึกลูกค้าแล้ว')
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
          <Field label="รหัสลูกค้า" hint={isNew ? 'เว้นว่างไว้ ระบบจะสร้างรหัสให้อัตโนมัติ' : undefined}>
            <Input
              value={f.code}
              onChange={(e) => set('code', e.target.value)}
              placeholder={isNew ? `อัตโนมัติ${next ? `: ${next.customerCode}` : ''}` : undefined}
            />
          </Field>
          <Field label="เบอร์โทร">
            <Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
          </Field>
          <Field label="ระดับราคา" hint="ใช้กับสินค้าที่ไม่ได้ตั้งราคาฟิกซ์ให้ลูกค้าคนนี้">
            <Select value={String(f.priceLevel)} onValueChange={(v) => set('priceLevel', Number(v))}>
              <SelectTrigger className="w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_LEVELS.map((lvl) => (
                  <SelectItem key={lvl} value={String(lvl)}>
                    {lvl}. {levelName(levelNames, lvl)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="วงเงินเครดิต (บาท)" hint="0 = ไม่อนุญาตขายเชื่อ">
            <NumberInput value={f.creditLimit} onChange={(v) => set('creditLimit', v ?? 0)} />
          </Field>
          <Field label="เครดิตเทอม (วัน)" hint="บิลเงินเชื่อครบกำหนดชำระ = วันขาย + จำนวนวันนี้">
            <NumberInput value={f.creditTermDays} onChange={(v) => set('creditTermDays', Math.min(365, Math.max(0, Math.round(v ?? 0))))} />
          </Field>
          <div className="grid gap-3 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2">
            <p className="text-sm font-medium sm:col-span-2">ข้อมูลสำหรับใบเสร็จเต็มรูป</p>
            <Field label="เลขประจำตัวผู้เสียภาษี (13 หลัก)">
              <Input value={f.taxId ?? ''} onChange={(e) => set('taxId', e.target.value.replace(/\D/g, '').slice(0, 13))} inputMode="numeric" />
            </Field>
            <Field label="สาขา" hint="เว้นว่าง หรือ 00000 = สำนักงานใหญ่">
              <Input value={f.branchCode ?? ''} onChange={(e) => set('branchCode', e.target.value)} inputMode="numeric" placeholder="00000" />
            </Field>
            <Field label="ที่อยู่ (ตามที่จะพิมพ์ในใบเสร็จเต็มรูป)" className="sm:col-span-2">
              <Textarea value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} rows={2} />
            </Field>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">
              <span>
                ส่งบัญชี
                <span className="block text-xs text-muted-foreground">บิลของลูกค้านี้จะติ๊ก “ส่งบัญชี (ออกใบเสร็จเต็มรูป)” ให้อัตโนมัติ (เอาออกได้ตอนชำระเงิน)</span>
              </span>
              <Switch checked={f.sendToAccounting} onCheckedChange={(v) => set('sendToAccounting', v)} />
            </label>
          </div>
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
          <Button className="cursor-pointer" onClick={() => void save()} disabled={(!isNew && !f.code.trim()) || !f.name.trim() || busy}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LedgerDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data: app } = useApp()
  const { data, error, reload } = useApi<Ledger>(id ? `/customers/${id}/ledger` : null)
  const [selected, setSelected] = useState<string[]>([])
  const [paying, setPaying] = useState<OpenBill[] | null>(null)
  const [statement, setStatement] = useState<{ customer: Customer; bills: OpenBill[]; qr: string | null } | null>(null)
  const [reprint, setReprint] = useState<PaymentReceipt | null>(null)
  const ledger = id && data?.customer.id === id ? data : null

  useEffect(() => setSelected([]), [data])

  useEffect(() => {
    if (!statement && !reprint) return
    printSoon()
    const done = () => {
      setStatement(null)
      setReprint(null)
    }
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [statement, reprint])

  const printStatement = async () => {
    if (!ledger) return
    const total = ledger.openBills.reduce((s, b) => s + b.outstanding, 0)
    let qr: string | null = null
    const pp = app.settings.promptpayId
    if (pp && isValidPromptPayId(pp) && total > 0) {
      try {
        qr = await toDataURL(promptPayPayload(pp, Math.round(total * 100) / 100), { margin: 1, width: 300 })
      } catch {
        qr = null
      }
    }
    setStatement({ customer: ledger.customer, bills: ledger.openBills, qr })
  }

  const reprintReceipt = async (entry: LedgerEntry) => {
    try {
      setReprint(await apiFetch<PaymentReceipt>(`/payments/${entry.id}`))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const toggle = (saleId: string) => setSelected((prev) => (prev.includes(saleId) ? prev.filter((x) => x !== saleId) : [...prev, saleId]))
  const selectedBills = ledger ? ledger.openBills.filter((b) => selected.includes(b.saleId)) : []

  const label = (e: LedgerEntry) =>
    e.entryType === 'sale'
      ? `ขายเชื่อ ${e.billNo ?? ''}`
      : e.entryType === 'sale_void'
        ? `ยกเลิกบิล ${e.billNo ?? ''}`
        : `รับชำระ (${PAYMENT_LABEL[e.paymentMethod ?? ''] ?? '-'})${e.receiptNo ? ` · ใบเสร็จ ${e.receiptNo}` : ''}`

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && paying === null && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ledger?.customer.name ?? 'บัญชีลูกหนี้'}</DialogTitle>
          <DialogDescription>
            {ledger
              ? `ยอดค้างชำระ ${baht(ledger.customer.balance)} บาท · วงเงิน ${baht(ledger.customer.creditLimit)} · เครดิต ${ledger.customer.creditTermDays} วัน`
              : ' '}
          </DialogDescription>
        </DialogHeader>
        {error ? <ErrorBox message={error} /> : null}
        {!ledger && !error ? <Loading /> : null}

        {ledger && ledger.openBills.length > 0 ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                บิลค้างชำระ {ledger.openBills.length} ใบ
                {ledger.summary.overdue > 0 ? (
                  <Badge variant="destructive" className="ml-2">
                    เกินกำหนด {baht(ledger.summary.overdue)}
                  </Badge>
                ) : null}
              </p>
              <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => void printStatement()}>
                <FileText /> พิมพ์ใบแจ้งหนี้ / ใบวางบิล
              </Button>
            </div>
            <ul className="divide-y rounded-lg border">
              {ledger.openBills.map((b) => (
                <li key={b.saleId}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                    <input type="checkbox" className="size-4 accent-primary" checked={selected.includes(b.saleId)} onChange={() => toggle(b.saleId)} />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-medium">{b.taxInvoiceNo ?? b.billNo}</span>
                      <span className="block text-xs text-muted-foreground">
                        ขาย {dateOnly(b.soldAt)} · ครบกำหนด {dateOnly(b.dueDate)}
                        {b.paid > 0 ? ` · จ่ายแล้ว ${baht(b.paid)} จาก ${baht(b.total)}` : ''}
                      </span>
                    </span>
                    <DueBadge days={b.daysOverdue} />
                    <span className="tabular w-20 text-right text-sm font-semibold">{baht(b.outstanding)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="cursor-pointer" onClick={() => setPaying([])}>
                รับชำระ (ตัดบิลเก่าก่อน)
              </Button>
              <Button
                className="cursor-pointer"
                disabled={selectedBills.length === 0}
                onClick={() => setPaying([...selectedBills].sort((a, b) => a.dueDate.localeCompare(b.dueDate)))}
              >
                <HandCoins /> รับชำระบิลที่เลือก{selectedBills.length > 0 ? ` (${selectedBills.length})` : ''}
              </Button>
            </div>
          </div>
        ) : null}
        {ledger && ledger.openBills.length === 0 && ledger.customer.balance <= 0 ? (
          <p className="rounded-lg bg-muted p-3 text-sm">ไม่มียอดค้างชำระ</p>
        ) : null}

        {ledger?.entries.length === 0 ? <Empty title="ยังไม่มีรายการ" /> : null}
        {ledger && ledger.entries.length > 0 ? (
          <ul className="divide-y text-sm">
            {ledger.entries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p>{label(e)}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime(e.createdAt)}
                    {e.note ? ` · ${e.note}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {e.entryType === 'payment' && e.receiptNo ? (
                    <Button variant="ghost" size="icon-sm" className="cursor-pointer" aria-label={`พิมพ์ใบเสร็จ ${e.receiptNo}`} onClick={() => void reprintReceipt(e)}>
                      <Printer />
                    </Button>
                  ) : null}
                  <span className={cn('tabular font-medium', e.amount > 0 ? 'text-destructive' : 'text-primary')}>
                    {e.amount > 0 ? '+' : ''}
                    {baht(e.amount)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {statement ? <StatementPrint customer={statement.customer} bills={statement.bills} qr={statement.qr} /> : null}
        {reprint ? <PaymentReceiptPrint receipt={reprint} /> : null}
        <ReceivePaymentDialog
          open={paying !== null}
          customer={ledger ? { id: ledger.customer.id, name: ledger.customer.name, balance: ledger.customer.balance } : null}
          bills={paying ?? NO_OPEN_BILLS}
          onClose={() => setPaying(null)}
          onDone={() => {
            onChanged()
            void reload()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

const NO_OPEN_BILLS: OpenBill[] = []

// ---------------------------------------------------------------- customer fixed prices

interface FixedDraft {
  product: { id: string; name: string; unit: string; levelPrice: number }
  price: number | null
  note: string
}

function FixedPriceDialog({ customer, onClose, onChanged }: { customer: Customer | null; onClose: () => void; onChanged: () => void }) {
  const levelNames = useApp().data.settings.priceLevelNames
  const { data, error, loading, reload } = useApi<CustomerPrice[]>(customer ? `/customers/${customer.id}/prices` : null)
  const [picker, setPicker] = useState(false)
  const [draft, setDraft] = useState<FixedDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const rows = customer && data ? data : []
  const customerLevel = customer ? levelName(levelNames, customer.priceLevel) : ''

  useEffect(() => {
    if (!customer) setDraft(null)
  }, [customer])

  const saveDraft = async () => {
    if (!customer || !draft || draft.price === null) return
    setBusy(true)
    try {
      await apiFetch(`/customers/${customer.id}/prices`, {
        method: 'PUT',
        body: { productId: draft.product.id, price: draft.price, note: draft.note.trim() || null },
      })
      toast.success(`ตั้งราคาฟิกซ์ ${draft.product.name} = ${baht(draft.price)} บาท`)
      setDraft(null)
      void reload()
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row: CustomerPrice) => {
    if (!customer) return
    setBusy(true)
    try {
      await apiFetch(`/customers/${customer.id}/prices/${row.productId}`, { method: 'DELETE' })
      toast.success(`ลบราคาฟิกซ์ ${row.productName} แล้ว — กลับไปใช้ราคา${customerLevel}`)
      void reload()
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={customer !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ราคาฟิกซ์ — {customer?.name}</DialogTitle>
          <DialogDescription>สินค้าที่ไม่มีในรายการนี้ จะใช้ราคา{customerLevel}ของลูกค้าโดยอัตโนมัติ</DialogDescription>
        </DialogHeader>
        {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
        {loading && !data ? <Loading /> : null}
        {customer && data?.length === 0 ? <Empty title="ยังไม่มีราคาฟิกซ์" hint="กด “เพิ่มสินค้า” เพื่อกำหนดราคาเฉพาะลูกค้าคนนี้" /> : null}
        {rows.length > 0 ? (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>สินค้า</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">ราคา{customerLevel}</TableHead>
                  <TableHead className="text-right">ราคาฟิกซ์</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.productId}>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() =>
                        setDraft({
                          product: { id: r.productId, name: r.productName, unit: r.unit, levelPrice: r.levelPrice },
                          price: r.price,
                          note: r.note ?? '',
                        })
                      }
                    >
                      <p className="font-medium">{r.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.sku}
                        {r.brandName ? ` · ${r.brandName}` : ''}
                        {r.note ? ` · ${r.note}` : ''}
                      </p>
                    </TableCell>
                    <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">
                      {r.levelPrice > 0 ? baht(r.levelPrice) : '-'}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold text-primary">{baht(r.price)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="cursor-pointer text-destructive"
                        aria-label={`ลบราคาฟิกซ์ ${r.productName}`}
                        disabled={busy}
                        onClick={() => void remove(r)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        ) : null}

        {draft ? (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_10rem_auto] sm:items-end">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{draft.product.name}</p>
              <p className="text-xs text-muted-foreground">
                ราคา{customerLevel} {draft.product.levelPrice > 0 ? baht(draft.product.levelPrice) : '-'} / {draft.product.unit}
              </p>
            </div>
            <Field label="ราคาฟิกซ์">
              <NumberInput value={draft.price} onChange={(v) => setDraft({ ...draft, price: v })} autoFocus onEnter={() => void saveDraft()} />
            </Field>
            <Field label="หมายเหตุ">
              <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="เช่น ตกลงราคาถึง ธ.ค." />
            </Field>
            <div className="flex gap-1">
              <Button variant="ghost" className="cursor-pointer" disabled={busy} onClick={() => setDraft(null)}>
                ยกเลิก
              </Button>
              <Button className="cursor-pointer" disabled={busy || draft.price === null} onClick={() => void saveDraft()}>
                {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="cursor-pointer justify-self-start" onClick={() => setPicker(true)}>
            <Plus /> เพิ่มสินค้า
          </Button>
        )}
        <ProductPicker
          open={picker}
          onClose={() => setPicker(false)}
          onPick={(p) => {
            const existing = rows.find((r) => r.productId === p.id)
            const levelPrice = customer ? (p.priceLevels[customer.priceLevel - 1] ?? 0) : 0
            setDraft({
              product: { id: p.id, name: p.name, unit: p.unit, levelPrice },
              price: existing ? existing.price : levelPrice > 0 ? levelPrice : null,
              note: existing?.note ?? '',
            })
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- brands

/** Brand picker for the product form; each option shows its supplier. */
function BrandSelect({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { data } = useApi<Brand[]>('/brands')
  const options = data?.filter((b) => b.isActive || b.id === value) ?? []
  return (
    <Select value={value ?? 'none'} onValueChange={(v) => onChange(v === 'none' ? null : v)}>
      <SelectTrigger className="w-full cursor-pointer">
        <SelectValue placeholder="เลือกแบรนด์" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">— ไม่ระบุแบรนด์ —</SelectItem>
        {options.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name} <span className="text-muted-foreground">({b.supplierName})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type BrandForm = { name: string; supplierId: string; note: string | null; isActive: boolean }

function Brands() {
  const [supplierFilter, setSupplierFilter] = useState('')
  const { data, error, loading, reload } = useApi<Brand[]>(`/brands?supplierId=${supplierFilter}`)
  const suppliers = useApi<Supplier[]>('/suppliers')
  const [editing, setEditing] = useState<{ id: string | null; form: BrandForm } | null>(null)
  const [deleting, setDeleting] = useState<Brand | null>(null)
  const [busy, setBusy] = useState(false)
  const activeSuppliers = suppliers.data?.filter((s) => s.isActive || s.id === editing?.form.supplierId) ?? []

  const setForm = (patch: Partial<BrandForm>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await apiFetch(editing.id ? `/brands/${editing.id}` : '/brands', {
        method: editing.id ? 'PUT' : 'POST',
        body: { ...editing.form, name: editing.form.name.trim(), note: editing.form.note?.trim() || null },
      })
      toast.success(editing.id ? 'บันทึกแบรนด์แล้ว' : 'เพิ่มแบรนด์แล้ว')
      setEditing(null)
      void reload()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await apiFetch(`/brands/${deleting.id}`, { method: 'DELETE' })
      toast.success(`ลบแบรนด์ ${deleting.name} แล้ว`)
      setDeleting(null)
      setEditing(null)
      void reload()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <Select value={supplierFilter || 'all'} onValueChange={(v) => setSupplierFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกผู้จำหน่าย</SelectItem>
              {suppliers.data?.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="cursor-pointer sm:ml-auto"
          disabled={!suppliers.data || suppliers.data.length === 0}
          onClick={() => setEditing({ id: null, form: { name: '', supplierId: supplierFilter, note: null, isActive: true } })}
        >
          <Plus /> เพิ่มแบรนด์
        </Button>
      </div>
      {suppliers.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">ต้องเพิ่มผู้จำหน่ายก่อน (แท็บ ผู้จำหน่าย) แล้วจึงเพิ่มแบรนด์ได้</p>
      ) : null}
      {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? <Empty title="ยังไม่มีแบรนด์" hint="เพิ่มแบรนด์ แล้วเลือกแบรนด์ให้สินค้าแต่ละตัว" /> : null}
      {data && data.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>แบรนด์</TableHead>
                <TableHead>ผู้จำหน่าย</TableHead>
                <TableHead className="text-right">สินค้า</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((b) => (
                <TableRow key={b.id} className={cn(!b.isActive && 'opacity-50')}>
                  <TableCell
                    className="cursor-pointer"
                    onClick={() => setEditing({ id: b.id, form: { name: b.name, supplierId: b.supplierId, note: b.note, isActive: b.isActive } })}
                  >
                    <p className="font-medium">{b.name}</p>
                    {b.note || !b.isActive ? (
                      <p className="text-xs text-muted-foreground">
                        {!b.isActive ? 'ปิดใช้งาน' : ''}
                        {b.note && !b.isActive ? ' · ' : ''}
                        {b.note ?? ''}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>{b.supplierName}</TableCell>
                  <TableCell className="tabular text-right">{b.productCount}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="cursor-pointer text-destructive"
                      aria-label={`ลบแบรนด์ ${b.name}`}
                      onClick={() => setDeleting(b)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && !busy && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'แก้ไขแบรนด์' : 'เพิ่มแบรนด์'}</DialogTitle>
            <DialogDescription>แต่ละแบรนด์ผูกกับผู้จำหน่าย 1 ราย</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-3">
              <Field label="ชื่อแบรนด์">
                <Input value={editing.form.name} onChange={(e) => setForm({ name: e.target.value })} placeholder="เช่น ซีพี 551, เบทาโกร, โกลด์คอยน์" />
              </Field>
              <Field label="ผู้จำหน่าย">
                <Select value={editing.form.supplierId || undefined} onValueChange={(v) => setForm({ supplierId: v })}>
                  <SelectTrigger className="w-full cursor-pointer">
                    <SelectValue placeholder="เลือกผู้จำหน่าย" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeSuppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            <Button
              className="cursor-pointer"
              disabled={busy || !editing?.form.name.trim() || !editing?.form.supplierId}
              onClick={() => void save()}
            >
              {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && !busy && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ลบแบรนด์ {deleting?.name}?</DialogTitle>
            <DialogDescription>
              {deleting && deleting.productCount > 0
                ? `แบรนด์นี้มีสินค้า ${deleting.productCount} รายการ จึงลบไม่ได้ ให้ย้ายสินค้าไปแบรนด์อื่นก่อน หรือปิดการใช้งานแบรนด์แทน`
                : 'ลบแล้วกู้คืนไม่ได้'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" disabled={busy} onClick={() => setDeleting(null)}>
              ยกเลิก
            </Button>
            {deleting && deleting.productCount > 0 ? (
              <Button
                className="cursor-pointer"
                onClick={() => {
                  setEditing({ id: deleting.id, form: { name: deleting.name, supplierId: deleting.supplierId, note: deleting.note, isActive: false } })
                  setDeleting(null)
                }}
              >
                ปิดการใช้งานแทน
              </Button>
            ) : (
              <Button variant="destructive" className="cursor-pointer" disabled={busy} onClick={() => void remove()}>
                {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} ลบแบรนด์
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------- suppliers

type SupplierForm = Omit<Supplier, 'id'>

function Suppliers() {
  const { data, error, loading, reload } = useApi<Supplier[]>('/suppliers')
  const [editing, setEditing] = useState<{ id: string | null; form: SupplierForm } | null>(null)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)

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
      <div className="flex flex-wrap gap-2">
        <Button className="cursor-pointer" onClick={() => setEditing({ id: null, form: { name: '', phone: null, note: null, isActive: true } })}>
          <Plus /> เพิ่มผู้จำหน่าย
        </Button>
        <Button variant="outline" className="cursor-pointer" onClick={() => setImporting(true)}>
          <FileSpreadsheet /> นำเข้า Excel
        </Button>
      </div>
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
      <ImportDialog kind="suppliers" open={importing} onClose={() => setImporting(false)} onDone={() => void reload()} />
    </div>
  )
}
