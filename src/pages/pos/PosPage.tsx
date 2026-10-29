import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Loader2, Minus, Plus, Printer, ScanLine, Search, ShoppingCart, Trash2, UserRound, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { CreateDeliveryButton } from '@/components/CreateDeliveryButton'
import { CustomerPicker } from '@/components/CustomerPicker'
import { LocationSelect, NumberInput } from '@/components/common'
import { ProductImage } from '@/components/ProductImage'
import { Receipt, ReceiptImageToggle, ReceiptPrint } from '@/components/Receipt'
import { ApiFailure, apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { baht, qty as fmtQty, round2, round3 } from '@/lib/format'
import { PRICE_LEVELS, levelName, resolvePrice, type PriceSource } from '@/lib/pricing'
import { getPrintPrefs, printSoon } from '@/lib/print'
import { newEvent } from '@/lib/terminal'
import type { Customer, CustomerPrice, Ledger, PaymentMethod, Product, SaleDetail, SaleResult } from '@/lib/types'
import { useApi, useDebounced } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { PaymentDialog } from './PaymentDialog'
import type { QuotationDetail } from '@/components/QuotationDoc'
import { QUOTE_TO_SELL_KEY } from '@/pages/QuotationsPage'

interface CartLine {
  key: string
  product: Product
  qty: number
  unitPrice: number
  priceEdited: boolean
  /** Where the (unedited) price came from: fixed / level / fallback. */
  source: PriceSource
  discount: number
}

const NO_FIXED: ReadonlyMap<string, number> = new Map()

export function PosPage() {
  const { locationId, setLocationId, location, data: app } = useApp()
  const levelNames = app.settings.priceLevelNames
  const [search, setSearch] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lines, setLines] = useState<CartLine[]>([])
  const [level, setLevel] = useState(1)
  const [customer, setCustomer] = useState<Customer | null>(null)
  // The selected customer's fixed prices (productId → price).
  const [fixed, setFixed] = useState<ReadonlyMap<string, number>>(NO_FIXED)
  // Unpaid credit of the selected customer, shown as a warning in the cart.
  const [debt, setDebt] = useState<{ outstanding: number; overdue: number; overdueCount: number } | null>(null)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [billDiscount, setBillDiscount] = useState<number | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [payBusy, setPayBusy] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [receipt, setReceipt] = useState<SaleDetail | null>(null)
  // Photos on the receipt only when ticked for this bill.
  const [receiptImages, setReceiptImages] = useState(false)
  useEffect(() => setReceiptImages(false), [receipt])
  const [editLine, setEditLine] = useState<CartLine | null>(null)
  // Quotation being turned into this bill (marked converted when the bill saves).
  const [quotation, setQuotation] = useState<{ id: string; docNo: string } | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  // One event per checkout attempt: re-sending after a timeout cannot double-post the bill.
  const pendingEvent = useRef<ReturnType<typeof newEvent> | null>(null)

  const dq = useDebounced(search.trim(), 200)
  // Best sellers / recently sold / in stock here, shown while the search box is empty.
  const quick = useApi<QuickData>(locationId ? `/products/quick?locationId=${locationId}` : null)
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
  }, [lines, level, customer, billDiscount, locationId])

  const addProduct = useCallback(
    (p: Product, addQty = 1) => {
      setLines((prev) => {
        const existing = prev.find((l) => l.product.id === p.id)
        if (existing) {
          return prev.map((l) => (l.key === existing.key ? { ...l, qty: round3(l.qty + addQty) } : l))
        }
        const { price, source } = resolvePrice(p, level, fixed)
        return [...prev, { key: crypto.randomUUID(), product: p, qty: addQty, unitPrice: price, source, priceEdited: false, discount: 0 }]
      })
      if (p.qtyHere <= 0) toast.warning(`${p.name} ไม่มีสต็อกที่ ${location?.name ?? 'สาขานี้'}`)
    },
    [level, fixed, location],
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

  /** Re-price every line the cashier has not edited by hand. */
  const reprice = (lvl: number, fixedMap: ReadonlyMap<string, number>) =>
    setLines((prev) =>
      prev.map((l) => {
        if (l.priceEdited) return l
        const { price, source } = resolvePrice(l.product, lvl, fixedMap)
        return { ...l, unitPrice: price, source }
      }),
    )

  const changeLevel = (lvl: number) => {
    setLevel(lvl)
    reprice(lvl, fixed)
  }

  const pickCustomer = async (c: Customer | null) => {
    const lvl = c?.priceLevel ?? 1
    setCustomer(c)
    setLevel(lvl)
    let fixedMap: ReadonlyMap<string, number> = NO_FIXED
    if (c && c.fixedPriceCount > 0) {
      try {
        const rows = await apiFetch<CustomerPrice[]>(`/customers/${c.id}/prices`)
        fixedMap = new Map(rows.map((r) => [r.productId, r.price]))
      } catch (err) {
        toast.error(`โหลดราคาฟิกซ์ไม่สำเร็จ: ${errorMessage(err)}`)
      }
    }
    setFixed(fixedMap)
    reprice(lvl, fixedMap)

    setDebt(null)
    if (c && c.balance > 0) {
      try {
        const ledger = await apiFetch<Ledger>(`/customers/${c.id}/ledger`)
        const overdueBills = ledger.openBills.filter((b) => b.daysOverdue > 0)
        setDebt({ outstanding: ledger.summary.outstanding, overdue: ledger.summary.overdue, overdueCount: overdueBills.length })
        if (overdueBills.length > 0) {
          toast.warning(`${c.name} มีบิลเกินกำหนด ${overdueBills.length} บิล รวม ${baht(ledger.summary.overdue)} บาท`)
        }
      } catch {
        // Debt hint is informational only.
      }
    }
  }

  const totals = useMemo(() => {
    const subtotal = round2(lines.reduce((s, l) => s + round2(l.qty * l.unitPrice), 0))
    const lineDiscounts = round2(lines.reduce((s, l) => s + l.discount, 0))
    const afterLines = round2(subtotal - lineDiscounts)
    const bill = Math.min(billDiscount ?? 0, afterLines)
    return { subtotal, lineDiscounts, bill, total: round2(afterLines - bill), items: lines.reduce((s, l) => s + l.qty, 0) }
  }, [lines, billDiscount])

  const resetSale = () => {
    setQuotation(null)
    setLines([])
    setCustomer(null)
    setDebt(null)
    setFixed(NO_FIXED)
    setLevel(1)
    setBillDiscount(null)
    setPayError(null)
    pendingEvent.current = null
    focusSearch()
  }

  const checkout = async (method: PaymentMethod, cashReceived: number | null, forAccounting: boolean) => {
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
          priceLevel: level,
          lines: lines.map((l) => ({
            productId: l.product.id,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineDiscount: l.discount,
            priceSource: l.priceEdited ? 'manual' : l.source,
          })),
          billDiscount: totals.bill,
          paymentMethod: method,
          cashReceived,
          forAccounting,
          quotationId: quotation?.id ?? null,
        },
      })
      setPayOpen(false)
      setCartOpen(false)
      toast.success(
        `บันทึกบิล ${res.billNo} แล้ว${res.taxInvoiceNo ? ` · ใบเสร็จเต็มรูป ${res.taxInvoiceNo}` : ''}${res.change ? ` · ทอน ${baht(res.change)}` : ''}`,
      )
      resetSale()
      void quick.reload()
      try {
        setReceipt(await apiFetch<SaleDetail>(`/sales/${res.id}`))
        if (getPrintPrefs().autoPrint) printSoon()
      } catch {
        // Receipt can be reprinted from sales history.
      }
    } catch (err) {
      setPayError(errorMessage(err))
    } finally {
      setPayBusy(false)
    }
  }

  /** Load a quotation the user chose to convert (set by the quotations page). */
  const loadQuotation = useCallback(
    async (id: string) => {
      try {
        const q = await apiFetch<QuotationDetail & { products: Product[] }>(`/quotations/${id}?locationId=${locationId}`)
        if (q.status === 'converted' || q.status === 'cancelled') {
          toast.error(`${q.docNo} ${q.status === 'converted' ? 'เปลี่ยนเป็นบิลไปแล้ว' : 'ถูกยกเลิกแล้ว'}`)
          return
        }
        let c: Customer | null = null
        if (q.customerId) {
          const found = await apiFetch<Customer[]>(`/customers?q=${encodeURIComponent(q.customerCode ?? q.customerName)}`)
          c = found.find((x) => x.id === q.customerId) ?? null
        }
        await pickCustomer(c)
        setLevel(q.priceLevel)
        const byId = new Map(q.products.map((p) => [p.id, p]))
        const missing = q.lines.filter((l) => !byId.has(l.productId))
        setLines(
          q.lines
            .filter((l) => byId.has(l.productId))
            .map((l) => ({
              key: crypto.randomUUID(),
              product: byId.get(l.productId)!,
              qty: l.qty,
              unitPrice: l.unitPrice,
              // Quoted prices are kept as agreed.
              priceEdited: true,
              source: (l.priceSource as PriceSource | null) ?? 'manual',
              discount: l.lineDiscount,
            })),
        )
        setBillDiscount(q.billDiscount || null)
        setQuotation({ id: q.id, docNo: q.docNo })
        toast.success(`โหลด ${q.docNo} เข้าตะกร้าแล้ว — ตรวจสอบแล้วกดชำระเงิน`)
        if (missing.length) toast.warning(`ไม่พบสินค้า ${missing.length} รายการ (อาจถูกปิดขาย)`)
        const short = q.lines.filter((l) => (byId.get(l.productId)?.qtyHere ?? 0) < l.qty)
        if (short.length) toast.warning(`สต็อกที่นี่ไม่พอ ${short.length} รายการ — เปลี่ยนสาขาหรือรับสินค้าก่อน`)
      } catch (err) {
        toast.error(errorMessage(err))
      }
    },
    // pickCustomer is recreated each render; loading is triggered once per request.
    [locationId],
  )

  useEffect(() => {
    let id: string | null = null
    try {
      id = window.sessionStorage.getItem(QUOTE_TO_SELL_KEY)
      if (id) window.sessionStorage.removeItem(QUOTE_TO_SELL_KEY)
    } catch {
      id = null
    }
    if (id && locationId) void loadQuotation(id)
  }, [loadQuotation, locationId])

  const cartPanel = (
    <CartPanel
      lines={lines}
      level={level}
      levelNames={levelNames}
      customer={customer}
      debt={debt}
      totals={totals}
      billDiscount={billDiscount}
      onBillDiscount={setBillDiscount}
      onLevel={changeLevel}
      onCustomer={() => setCustomerOpen(true)}
      onClearCustomer={() => void pickCustomer(null)}
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
        {quotation ? (
          <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <FileText className="size-4 text-primary" />
            <span>
              กำลังเปิดบิลจากใบเสนอราคา <b>{quotation.docNo}</b> — ราคาตามที่เสนอไว้
            </span>
            <Button variant="ghost" size="sm" className="ml-auto cursor-pointer" onClick={() => setQuotation(null)}>
              ไม่ผูกกับใบเสนอราคา
            </Button>
          </div>
        ) : null}
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
            <QuickPicks
              data={quick.data}
              loading={quick.loading}
              renderCard={(p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  price={resolvePrice(p, level, fixed).price}
                  onPick={() => {
                    addProduct(p)
                    focusSearch()
                  }}
                />
              )}
            />
          ) : results.loading && !results.data ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : results.data?.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">ไม่พบสินค้า “{dq}”</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {results.data?.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  price={resolvePrice(p, level, fixed).price}
                  onPick={() => {
                    addProduct(p)
                    focusSearch()
                  }}
                />
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
      <CustomerPicker open={customerOpen} onClose={() => setCustomerOpen(false)} onPick={(c) => void pickCustomer(c)} />
      <PaymentDialog
        open={payOpen}
        total={totals.total}
        customer={customer}
        busy={payBusy}
        error={payError}
        onClose={() => setPayOpen(false)}
        onConfirm={(m, cash, acc) => void checkout(m, cash, acc)}
      />
      <LineEditor
        line={editLine}
        levelNames={levelNames}
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
          {receipt ? (
            <>
              <CreateDeliveryButton key={receipt.id} saleId={receipt.id} hasCustomer={receipt.customerId !== null} />
              <ReceiptImageToggle sale={receipt} checked={receiptImages} onChange={setReceiptImages} />
              <Receipt sale={receipt} showImages={receiptImages} />
              <ReceiptPrint sale={receipt} showImages={receiptImages} />
            </>
          ) : null}
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
  level: number
  levelNames: string[]
  customer: Customer | null
  debt: { outstanding: number; overdue: number; overdueCount: number } | null
  totals: { subtotal: number; lineDiscounts: number; bill: number; total: number; items: number }
  billDiscount: number | null
  onBillDiscount: (v: number | null) => void
  onLevel: (level: number) => void
  onCustomer: () => void
  onClearCustomer: () => void
  onQty: (key: string, qty: number) => void
  onRemove: (key: string) => void
  onEdit: (l: CartLine) => void
  onClear: () => void
  onPay: () => void
}) {
  const { lines, level, levelNames, customer, debt, totals } = props
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
        <div className="grid grid-cols-5 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="ระดับราคา">
          {PRICE_LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              role="radio"
              aria-checked={level === lvl}
              title={`ราคา${levelName(levelNames, lvl)}`}
              onClick={() => props.onLevel(lvl)}
              className={cn(
                'min-w-0 cursor-pointer truncate rounded-md px-1 py-1.5 text-xs transition-colors sm:text-sm',
                level === lvl ? 'bg-card font-semibold text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {levelName(levelNames, lvl)}
            </button>
          ))}
        </div>
        {customer && debt ? (
          <a
            href="#/receivables"
            className={cn(
              'block rounded-md px-2 py-1 text-xs',
              debt.overdueCount > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
            )}
          >
            ค้างชำระ {baht(debt.outstanding)} บาท
            {debt.overdueCount > 0 ? ` · เกินกำหนด ${debt.overdueCount} บิล (${baht(debt.overdue)})` : ''}
          </a>
        ) : null}
        {customer && customer.fixedPriceCount > 0 ? (
          <p className="text-xs text-muted-foreground">ลูกค้านี้มีราคาฟิกซ์ {customer.fixedPriceCount} รายการ — ใช้ก่อนราคาตามระดับ</p>
        ) : null}
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
                      {l.priceEdited ? (
                        <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">แก้ราคา</Badge>
                      ) : l.source === 'fixed' ? (
                        <Badge className="ml-1 px-1 py-0 text-[10px]">ราคาฟิกซ์</Badge>
                      ) : null}
                      {l.discount > 0 ? <span className="text-destructive"> · ลด {baht(l.discount)}</span> : null}
                    </p>
                    {!l.priceEdited && l.source === 'fallback' ? (
                      <p className="text-xs text-amber-700">ไม่มีราคา{levelName(levelNames, level)} — ใช้ราคา{levelName(levelNames, 1)}</p>
                    ) : null}
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
                      <QtyInput value={l.qty} unit={l.product.unit} onCommit={(q) => props.onQty(l.key, q)} />
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

function LineEditor({
  line,
  levelNames,
  onClose,
  onSave,
}: {
  line: CartLine | null
  levelNames: string[]
  onClose: () => void
  onSave: (l: CartLine) => void
}) {
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
            {PRICE_LEVELS.filter((lvl) => (line.product.priceLevels[lvl - 1] ?? 0) > 0)
              .map((lvl) => `${levelName(levelNames, lvl)} ${baht(line.product.priceLevels[lvl - 1] ?? 0)}`)
              .join(' · ')}
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

interface QuickData {
  bestSellers: Product[]
  recent: Product[]
  inStock: Product[]
}

type QuickTab = 'best' | 'recent' | 'stock'

function ProductCard({ product: p, price, onPick }: { product: Product; price: number; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex min-w-0 cursor-pointer flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
    >
      <ProductImage url={p.imageUrl} alt={p.name} className="aspect-[4/3] w-full" />
      <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
      {p.brandName ? <p className="-mt-1 truncate text-xs text-muted-foreground">{p.brandName}</p> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-1">
        <span className="tabular text-base font-semibold text-primary">{baht(price)}</span>
        <span className={cn('tabular text-xs', p.qtyHere <= 0 ? 'text-destructive' : 'text-muted-foreground')}>
          {fmtQty(p.qtyHere)} {p.unit}
        </span>
      </div>
    </button>
  )
}

/** Tabs of tappable products for fast picking when nothing is being searched. */
function QuickPicks({
  data,
  loading,
  renderCard,
}: {
  data: QuickData | null
  loading: boolean
  renderCard: (p: Product) => React.ReactNode
}) {
  const [tab, setTab] = useState<QuickTab | null>(null)
  const [category, setCategory] = useState('')

  if (loading && !data) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!data || (data.inStock.length === 0 && data.recent.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
        <ScanLine className="size-10" />
        <p>สแกนบาร์โค้ดด้วยเครื่องสแกน หรือกดปุ่มกล้องบนมือถือ/แท็บเล็ต</p>
        <p className="text-xs">ยังไม่มีสินค้าที่มีสต็อกในโซนนี้ — รับเข้าสินค้าหรือปรับยอดยกมาก่อน</p>
      </div>
    )
  }

  // Default tab: best sellers when there are sales, otherwise what is in stock.
  const active: QuickTab = tab ?? (data.bestSellers.length > 0 ? 'best' : data.recent.length > 0 ? 'recent' : 'stock')
  const categories = [...new Set(data.inStock.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'th'))
  const list =
    active === 'best'
      ? data.bestSellers
      : active === 'recent'
        ? data.recent
        : data.inStock.filter((p) => !category || p.category === category)

  const tabs: [QuickTab, string, number][] = [
    ['best', 'ขายดี', data.bestSellers.length],
    ['recent', 'ขายล่าสุด', data.recent.length],
    ['stock', 'มีสต็อกที่นี่', data.inStock.length],
  ]

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors',
              active === key ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {label} <span className={cn('text-xs', active === key ? 'opacity-80' : 'text-muted-foreground')}>{count}</span>
          </button>
        ))}
      </div>
      {active === 'stock' && categories.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {['', ...categories].map((c) => (
            <button
              key={c || 'all'}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'cursor-pointer rounded-md px-2 py-0.5 text-xs',
                category === c ? 'bg-secondary font-semibold text-secondary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {c || 'ทุกหมวด'}
            </button>
          ))}
        </div>
      ) : null}
      {active === 'best' ? <p className="text-xs text-muted-foreground">จำนวนที่ขายได้มากสุด 30 วันล่าสุด ในโซนนี้</p> : null}
      {list.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {active === 'stock' ? 'ไม่มีสินค้าในหมวดนี้' : 'ยังไม่มียอดขายในโซนนี้'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">{list.map((p) => renderCard(p))}</div>
      )}
    </div>
  )
}

/**
 * Cart quantity the cashier can type (decimals allowed, e.g. 2.5 กก.). Commits on Enter
 * or when leaving the field; empty, zero or invalid input puts the old number back.
 */
function QtyInput({ value, unit, onCommit }: { value: number; unit: string; onCommit: (qty: number) => void }) {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false)
  useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])

  const commit = () => {
    setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      setText(String(value))
      return
    }
    const n = round3(Number(text.replace(/,/g, '').trim()))
    if (Number.isFinite(n) && n > 0 && n <= 99999) {
      if (n !== value) onCommit(n)
    } else {
      toast.error('จำนวนต้องมากกว่า 0')
    }
    setText(String(value))
  }

  return (
    <Input
      value={editing ? text : fmtQty(value)}
      inputMode="decimal"
      aria-label={`จำนวน (${unit})`}
      className="tabular h-8 w-16 px-1 text-center text-sm"
      onFocus={(e) => {
        setEditing(true)
        setText(String(value))
        e.currentTarget.select()
      }}
      // A click would otherwise drop the caret into the text and undo the select-all.
      onMouseUp={(e) => e.preventDefault()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
    />
  )
}
