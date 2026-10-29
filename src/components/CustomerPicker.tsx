import { useState } from 'react'
import { Search, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ErrorBox, Loading } from '@/components/common'
import { useApp } from '@/lib/app-context'
import { baht } from '@/lib/format'
import { levelName } from '@/lib/pricing'
import type { Customer } from '@/lib/types'
import { useApi, useDebounced } from '@/lib/use-api'

export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: Customer | null) => void }) {
  const { data: app } = useApp()
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim())
  const { data, error, loading, reload } = useApi<Customer[]>(open ? `/customers?q=${encodeURIComponent(dq)}` : null)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>เลือกลูกค้า</DialogTitle>
          <DialogDescription>ค้นหาด้วยชื่อ รหัส หรือเบอร์โทร</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="pl-8" value={q} placeholder="ชื่อ / รหัส / เบอร์โทร" onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="-mx-2 min-h-40 flex-1 overflow-y-auto">
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              onPick(null)
              onClose()
            }}
          >
            <UserRound className="size-4 text-muted-foreground" /> ลูกค้าทั่วไป (ไม่ระบุ)
          </button>
          {error ? <ErrorBox message={error} onRetry={() => void reload()} /> : null}
          {loading && !data ? <Loading /> : null}
          {data
            ?.filter((c) => c.isActive)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onPick(c)
                  onClose()
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.code}
                    {c.phone ? ` · ${c.phone}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant="secondary">
                    {levelName(app.settings.priceLevelNames, c.priceLevel)}
                    {c.fixedPriceCount > 0 ? ` · ฟิกซ์ ${c.fixedPriceCount}` : ''}
                  </Badge>
                  {c.balance > 0 ? <span className="tabular text-xs text-destructive">ค้าง {baht(c.balance)}</span> : null}
                </div>
              </button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
