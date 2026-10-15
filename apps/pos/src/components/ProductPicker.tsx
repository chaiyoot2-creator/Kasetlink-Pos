import { useState } from 'react'
import { ScanLine, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { BarcodeScanner } from '@/components/BarcodeScanner'
import { ErrorBox, Loading } from '@/components/common'
import { qty } from '@/lib/format'
import type { Product } from '@/lib/types'
import { useApi, useDebounced } from '@/lib/use-api'

/** Search-or-scan dialog to pick one product (PO, transfer, adjustment lines). */
export function ProductPicker({
  open,
  onClose,
  onPick,
  locationId,
}: {
  open: boolean
  onClose: () => void
  onPick: (p: Product) => void
  locationId?: string
}) {
  const [q, setQ] = useState('')
  const [scan, setScan] = useState(false)
  const dq = useDebounced(q.trim())
  const { data, error, loading, reload } = useApi<Product[]>(
    open ? `/products?q=${encodeURIComponent(dq)}&limit=40&locationId=${locationId ?? ''}` : null,
  )

  const pick = (p: Product) => {
    onPick(p)
    setQ('')
    onClose()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
          <DialogHeader>
            <DialogTitle>เลือกสินค้า</DialogTitle>
            <DialogDescription>ค้นหาด้วยชื่อ รหัส หรือบาร์โค้ด</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-8"
                value={q}
                placeholder="พิมพ์ชื่อสินค้า / รหัส / บาร์โค้ด"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && data && data.length > 0) {
                    e.preventDefault()
                    const exact = data.find((p) => p.barcode === q.trim() || p.sku === q.trim())
                    pick(exact ?? data[0]!)
                  }
                }}
              />
            </div>
            <Button variant="outline" size="icon" className="cursor-pointer" onClick={() => setScan(true)} aria-label="สแกนด้วยกล้อง">
              <ScanLine />
            </Button>
          </div>
          <div className="-mx-2 min-h-40 flex-1 overflow-y-auto">
            {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
            {loading && !data ? <Loading /> : null}
            {data?.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">ไม่พบสินค้า</p> : null}
            {data?.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.sku}
                    {p.barcode ? ` · ${p.barcode}` : ''}
                    {p.brandName ? ` · ${p.brandName}` : ''}
                  </p>
                </div>
                <span className="tabular shrink-0 text-sm text-muted-foreground">
                  {locationId ? 'ที่นี่ ' + qty(p.qtyHere) : 'รวม ' + qty(p.qtyTotal)} {p.unit}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <BarcodeScanner open={scan} onClose={() => setScan(false)} onDetected={(code) => setQ(code)} />
    </>
  )
}
