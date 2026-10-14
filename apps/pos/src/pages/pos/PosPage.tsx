import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Minus, Plus, Printer, ScanLine, Search, ShoppingCart, Trash2, UserRound, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { CustomerPicker } from '@/components/CustomerPicker'
import { LocationSelect, NumberInput } from '@/components/common'
import { Receipt } from '@/components/Receipt'
import { ApiFailure, apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { PRICE_TIER_LABEL, baht, qty as fmtQty, round2, round3 } from '@/lib/format'
import { newEvent } from '@/lib/terminal'
import type { Customer, PaymentMethod, PriceTier, Product, SaleDetail, SaleResult } from '@/lib/types'
import { useApi, useDebounced } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { PaymentDialog } from './PaymentDialog'

interface CartLine {
  key: string
  product: Product
  qty: number
  unitPrice: number
  priceEdited: boolean
  discount: number
}

function tierPrice(p: Product, tier: PriceTier): number {
  if (tier === 'wholesale' && p.priceWholesale > 0) return p.priceWholesale
  if (tier === 'member' && p.priceMember > 0) return p.priceMember
  return p.priceRetail
}

export function PosPage() {
  const { locationId, setLocationId, location } = useApp()
  const [search, setSearch] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lines, setLines] = useState<CartLine[]>([])
  const [tier, setTier] = useState<PriceTier>('retail')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [billDiscount, setBillDiscount] = useState<number | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [payBusy, setPayBusy] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [receipt, setReceipt] = useState<SaleDetail | null>(null)
  const [editLine, setEditLine] = useState<CartLine | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  // One event per checkout attempt: re-sending after a timeout cannot double-post the bill.
  const pendingEvent = useRef<ReturnType<typeof newEvent> | null>(null)

  const dq = useDebounced(search.trim(), 200)
  const results = useApi<Product[]>(dq.length >= 1 ? `/products?q=${encodeURIComponent(dq)}&limit=24&locationId=${locationId}` : null)

  const focusSearch = () => window.setTimeout(() => searchRef.current?.focus(), 0)

  // Rotating a tablet to landscape shows the side cart, so drop the bottom sheet.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => mq.matches && setCartOpen(false)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Any change to the cart invalidates the pending checkout event.
  useEffect(() => {
    pendingEvent.current = null
  }, [lines, tier, customer, billDiscount, locationId])

  const addProduct = useCallback(
    (p: Product, addQty = 1) => {
      setLines((prev) => {
        const existing = prev.find((l) => l.product.id === p.id)
        if (existing) {
          return prev.map((l) => (l.key === existing.key ? { ...l, qty: round3(l.qty + addQty) } : l))
        }
        return [...prev, { key: crypto.randomUUID(), product: p, qty: addQty, unitPrice: tierPrice(p, tier), priceEdited: false, discount: 0 }]
      })
      if (p.qtyHere <= 0) toast.warning(`${p.name} ไม่มีสต็อกที่ ${location?.name ?? 'สาขานี้'}`)
    },
    [tier, location],
  )

  const lookupCode = useCallback(
    async (code: string) => {
      if (!code) return
      setLookupBusy(true)
      try {
        const p = await apiFetch<Product>(`/products/lookup?code=${encodeURIComponent(code)}&locationId=${locationId}`)
        addProduct(p)
        setSearch('')
      } catch (err) {
        if (err instanceof ApiFailure && err.status === 404) {
          // Not a barcode — keep the text as a name search.
          setSearch(code)
        } else {
          toast.error(errorMessage(err))
        }
      } finally {
        setLookupBusy(false)
        focusSearch()
      }
    },
    [addProduct, locationId],
  )

  const changeTier = (t: PriceTier) => {
    setTier(t)
    setLines((prev) => prev.map((l) => (l.priceEdited ? l : { ...l, unitPrice: tierPrice(l.product, t) })))
  }

  const pickCustomer = (c: Customer | null) => {
    setCustomer(c)
    changeTier(c?.customerType ?? 'retail')
  }

  const totals = useMemo(() => {
    const subtotal = round2(lines.reduce((s, l) => s + round2(l.qty * l.unitPrice), 0))
    const lineDiscounts = round2(lines.reduce((s, l) => s + l.discount, 0))
    const afterLines = round2(subtotal - lineDiscounts)
    const bill = Math.min(billDiscount ?? 0, afterLines)
    return { subtotal, lineDiscounts, bill, total: round2(afterLines - bill), items: lines.reduce((s, l) => s + l.qty, 0) }
  }, [lines, billDiscount])

  const resetSale = () => {
    setLines([])
    setCustomer(null)
    setTier('retail')
    setBillDiscount(null)
    setPayError(null)
    pendingEvent.current = null
    focusSearch()
  }

  const checkout = async (method: PaymentMethod, cashReceived: number | null) => {
    if (!pendingEvent.current) pendingEvent.current = newEvent()
    setPayBusy(true)
    setPayError(null)
    try {
      const res = await apiFetch<SaleResult>('/sales', {
        method: 'POST',
        body: {
          ...pendingEvent.current,
          locationId,
          customerId: customer?.id ?? null,
          priceTier: tier,
          lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty, unitPrice: l.unitPrice, lineDiscount: l.discount })),
          billDiscount: totals.bill,
          paymentMethod: method,
          cashReceived,
        },
      })
      setPayOpen(false)
      setCartOpen(false)
      toast.success(`บันทึกบิล ${res.billNo} แล้ว${res.change ? ` · ทอน ${baht(res.change)}` : ''}`)
      resetSale()
      try {
        setReceipt(await apiFetch<SaleDetail>(`/sales/${res.id}`))
      } catch {
        // Receipt can be reprinted from sales history.
      }
    } catch (err) {
      setPayError(errorMessage(err))
    } finally {
      setPayBusy(false)
    }
  }

  const cartPanel = (
    <CartPanel
      lines={lines}
      tier={tier}
      customer={customer}
      totals={totals}
      billDiscount={billDiscount}
      onBillDiscount={setBillDiscount}
      onTier={changeTier}
      onCustomer={() => setCustomerOpen(true)}
      onClearCustomer={() => pickCustomer(null)}
      onQty={(key, q) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, qty: q } : l)))}
      onRemove={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
      onEdit={setEditLine}
      onClear={resetSale}
      onPay={() => {
        setPayError(null)
        setPayOpen(true)
      }}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">
      {/* Left: scan + search */}
      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-56">
            <LocationSelect value={locationId} onChange={setLocationId} />
          </div>
          <p className="text-sm text-muted-foreground">ขายจากสต็อกของสาขา/โซนนี้</p>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const exact = results.data?.find((p) => p.barcode === search.trim() || p.sku === search.trim())
                  if (exact) {
                    addProduct(exact)
                    setSearch('')
                  } else void lookupCode(search.trim())
                }
              }}
              placeholder="สแกนบาร์โค้ด หรือพิมพ์ชื่อสินค้า แล้วกด Enter"
              className="h-12 pl-10 text-base"
            />
            {lookupBusy ? <Loader2 className="absolute top-1/2 right-3 size-5 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
          </div>
          <Button variant="outline" className="h-12 w-12 cursor-pointer" onClick={() => setScanOpen(true)} aria-label="สแกนด้วยกล้อง">
            <ScanLine className="size-5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-20 lg:pb-0">
          {dq === '' ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <ScanLine className="size-10" />
              <p>สแกนบาร์โค้ดด้วยเครื่องสแกน หรือกดปุ่มกล้องบนมือถือ/แท็บเล็ต</p>
              <p className="text-xs">พิมพ์ชื่อสินค้าบางส่วนเพื่อค้นหาได้</p>
            </div>
          ) : results.loading && !results.data ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : results.data?.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">ไม่พบสินค้า “{dq}”</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {results.data?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    addProduct(p)
                    focusSearch()
                  }}
                  className="flex cursor-pointer flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
                  <div className="flex items-end justify-between gap-1">
                    <span className="tabular text-base font-semibold text-primary">{baht(tierPrice(p, tier))}</span>
                    <span className={cn('tabular text-xs', p.qtyHere <= 0 ? 'text-destructive' : 'text-muted-foreground')}>
                      {fmtQty(p.qtyHere)} {p.unit}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Right: cart (desktop / tablet landscape) */}
      <aside className="hidden w-[400px] shrink-0 flex-col rounded-xl border bg-card lg:flex">{cartPanel}</aside>

      {/* Phone / portrait tablet: sticky checkout bar + sheet */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-card/95 p-3 backdrop-blur md:bottom-0 md:left-20 lg:hidden">
        <Button className="h-12 w-full cursor-pointer justify-between text-base" onClick={() => setCartOpen(true)} disabled={lines.length === 0}>
          <span className="flex items-center gap-2">
            <ShoppingCart className="size-5" /> ตะกร้า {lines.length} รายการ
          </span>
          <span className="tabular">{baht(totals.total)}</span>
        </Button>
      </div>
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="flex h-[92vh] flex-col gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>ตะกร้าสินค้า</SheetTitle>
          </SheetHeader>
          {cartPanel}
        </SheetContent>
      </Sheet>

      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={(code) => void lookupCode(code)} />
      <CustomerPicker open={customerOpen} onClose={() => setCustomerOpen(false)} onPick={pickCustomer} />
      <PaymentDialog
        open={payOpen}
        total={totals.total}
        customer={customer}
        busy={payBusy}
        error={payError}
        onClose={() => setPayOpen(false)}
        onConfirm={(m, cash) => void checkout(m, cash)}
      />
      <LineEditor
        line={editLine}
        onClose={() => setEditLine(null)}
        onSave={(l) => {
          setLines((prev) => prev.map((x) => (x.key === l.key ? l : x)))
          setEditLine(null)
        }}
      />
      <Dialog open={receipt !== null} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ใบเสร็จ</DialogTitle>
            <DialogDescription>บันทึกบิลเรียบร้อย</DialogDescription>
          </DialogHeader>
          {receipt ? <Receipt sale={receipt} /> : null}
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => window.print()}>
              <Printer /> พิมพ์ใบเสร็จ
            </Button>
            <Button className="cursor-pointer" onClick={() => setReceipt(null)}>
              ขายบิลถัดไป
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CartPanel(props: {
  lines: CartLine[]
  tier: PriceTier
  customer: Customer | null
  totals: { subtotal: number; lineDiscounts: number; bill: number; total: number; items: number }
  billDiscount: number | null
  onBillDiscount: (v: number | null) => void
  onTier: (t: PriceTier) => void
  onCustomer: () => void
  onClearCustomer: () => void
  onQty: (key: string, qty: number) => void
  onRemove: (key: string) => void
  onEdit: (l: CartLine) => void
  onClear: () => void
  onPay: () => void
}) {
  const { lines, tier, customer, totals } = props
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b p-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" className="min-w-0 flex-1 cursor-pointer justify-start" onClick={props.onCustomer}>
            <UserRound />
            <span className="truncate">{customer ? customer.name : 'ลูกค้าทั่วไป'}</span>
          </Button>
          {customer ? (
            <Button variant="ghost" size="icon" className="cursor-pointer" onClick={props.onClearCustomer} aria-label="ล้างลูกค้า">
              <X />
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {(['retail', 'wholesale', 'member'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => props.onTier(t)}
              className={cn(
                'cursor-pointer rounded-md py-1.5 text-sm transition-colors',
                tier === t ? 'bg-card font-semibold text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              ราคา{PRICE_TIER_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีสินค้าในตะกร้า</p>
        ) : (
          <ul className="divide-y">
            {lines.map((l) => {
              const lineTotal = round2(l.qty * l.unitPrice - l.discount)
              return (
                <li key={l.key} className="flex gap-2 p-3">
                  <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => props.onEdit(l)}>
                    <p className="truncate text-sm font-medium">{l.product.name}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {baht(l.unitPrice)} / {l.product.unit}
                      {l.priceEdited ? <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">แก้ราคา</Badge> : null}
                      {l.discount > 0 ? <span className="text-destructive"> · ลด {baht(l.discount)}</span> : null}
                    </p>
                    {l.qty > l.product.qtyHere ? <p className="text-xs text-destructive">สต็อกที่นี่มี {fmtQty(l.product.qtyHere)}</p> : null}
                  </button>
                  <div className="flex flex-col items-end gap-1">
                    <span className="tabular text-sm font-semibold">{baht(lineTotal)}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        className="cursor-pointer"
                        aria-label="ลดจำนวน"
                        onClick={() => (l.qty <= 1 ? props.onRemove(l.key) : props.onQty(l.key, round3(l.qty - 1)))}
                      >
                        {l.qty <= 1 ? <Trash2 /> : <Minus />}
                      </Button>
                      <span className="tabular w-10 text-center text-sm">{fmtQty(l.qty)}</span>
                      <Button variant="outline" size="icon-sm" className="cursor-pointer" aria-label="เพิ่มจำนวน" onClick={() => props.onQty(l.key, round3(l.qty + 1))}>
                        <Plus />
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t p-3">
        <div className="tabular flex justify-between text-sm">
          <span className="text-muted-foreground">รวม {fmtQty(totals.items)} ชิ้น</span>
          <span>{baht(totals.subtotal)}</span>
        </div>
        {totals.lineDiscounts > 0 ? (
          <div className="tabular flex justify-between text-sm text-destructive">
            <span>ส่วนลดรายการ</span>
            <span>-{baht(totals.lineDiscounts)}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">ส่วนลดท้ายบิล (บาท)</span>
          <NumberInput value={props.billDiscount} onChange={props.onBillDiscount} placeholder="0" className="h-8 w-28" />
        </div>
        <div className="flex items-end justify-between pt-1">
          <span className="font-medium">ยอดสุทธิ</span>
          <span className="tabular text-3xl font-bold text-primary">{baht(totals.total)}</span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-2 pt-1">
          <Button variant="outline" className="h-12 cursor-pointer" onClick={props.onClear} disabled={lines.length === 0} aria-label="ล้างบิล">
            <Trash2 />
          </Button>
          <Button className="h-12 cursor-pointer text-lg" onClick={props.onPay} disabled={lines.length === 0}>
            ชำระเงิน
          </Button>
        </div>
      </div>
    </div>
  )
}

function LineEditor({ line, onClose, onSave }: { line: CartLine | null; onClose: () => void; onSave: (l: CartLine) => void }) {
  const [q, setQ] = useState<number | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const [discount, setDiscount] = useState<number | null>(null)

  useEffect(() => {
    if (line) {
      setQ(line.qty)
      setPrice(line.unitPrice)
      setDiscount(line.discount || null)
    }
  }, [line])

  if (!line) return null
  const gross = round2((q ?? 0) * (price ?? 0))
  const invalid = !q || q <= 0 || price === null || price < 0 || (discount ?? 0) > gross

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-6">{line.product.name}</DialogTitle>
          <DialogDescription>
            ปลีก {baht(line.product.priceRetail)} · ส่ง {baht(line.product.priceWholesale)} · สมาชิก {baht(line.product.priceMember)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm">
            จำนวน ({line.product.unit})
            <NumberInput value={q} onChange={setQ} autoFocus />
          </label>
          <label className="grid gap-1.5 text-sm">
            ราคาต่อหน่วย
            <NumberInput value={price} onChange={setPrice} />
          </label>
          <label className="grid gap-1.5 text-sm">
            ส่วนลดรายการนี้ (บาท)
            <NumberInput value={discount} onChange={setDiscount} placeholder="0" />
          </label>
          <p className="tabular text-right text-sm">รวม {baht(gross - (discount ?? 0))} บาท</p>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            className="cursor-pointer"
            disabled={invalid}
            onClick={() =>
              onSave({
                ...line,
                qty: round3(q ?? 1),
                unitPrice: round2(price ?? 0),
                priceEdited: line.priceEdited || round2(price ?? 0) !== line.unitPrice,
                discount: round2(discount ?? 0),
              })
            }
          >
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
