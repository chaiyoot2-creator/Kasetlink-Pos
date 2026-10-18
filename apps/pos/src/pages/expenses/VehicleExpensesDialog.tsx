import { useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, ErrorBox, Loading, Stat } from '@/components/common'
import { baht, dateOnly, todayISO } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { ExpenseDialog, type ExpenseDialogTarget } from './ExpenseDialog'
import { ConfirmDelete } from './ExpensesPage'
import { MONTH_SHORT, PAY_LABEL, thaiYear, type Expense, type VehicleExpenses } from './types'

/** Everything spent on one vehicle in a year: totals by category and month, and each expense. */
export function VehicleExpensesDialog({
  vehicle,
  canEdit,
  onClose,
  onChanged,
}: {
  vehicle: { id: string; label: string; name: string } | null
  /** Staff with the expenses permission may add / edit / delete from here. */
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const thisYear = Number(todayISO().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const data = useApi<VehicleExpenses>(vehicle ? `/delivery/vehicles/${vehicle.id}/expenses?year=${year}` : null)
  const [editing, setEditing] = useState<ExpenseDialogTarget | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const d = data.data
  const maxMonth = d ? Math.max(0, ...d.months.map((m) => m.total)) : 0
  const changed = () => {
    void data.reload()
    onChanged()
  }

  return (
    <>
      <Dialog open={vehicle !== null && editing === null && deleting === null} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="size-5" /> ค่าใช้จ่ายรถ {vehicle?.label}
            </DialogTitle>
            <DialogDescription>{vehicle && vehicle.label !== vehicle.name ? vehicle.name : 'รวมทุกรายการที่ผูกกับรถคันนี้'}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" className="cursor-pointer" aria-label="ปีก่อน" onClick={() => setYear(year - 1)}>
              <ChevronLeft />
            </Button>
            <p className="min-w-20 text-center font-semibold">ปี {thaiYear(year)}</p>
            <Button variant="outline" size="icon" className="cursor-pointer" aria-label="ปีถัดไป" disabled={year >= thisYear} onClick={() => setYear(year + 1)}>
              <ChevronRight />
            </Button>
            {canEdit ? (
              <Button className="ml-auto cursor-pointer" onClick={() => vehicle && setEditing({ expense: null, vehicleId: vehicle.id })}>
                <Plus /> บันทึกค่าใช้จ่ายรถคันนี้
              </Button>
            ) : null}
          </div>
          {data.error ? <ErrorBox message={data.error} onRetry={() => void data.reload()} /> : null}
          {data.loading && !d ? <Loading /> : null}
          {d && d.items.length === 0 ? <Empty title={`ยังไม่มีค่าใช้จ่ายของรถคันนี้ในปี ${thaiYear(year)}`} /> : null}
          {d && d.items.length > 0 ? (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat label={`รวมปี ${thaiYear(year)}`} value={`฿${baht(d.total)}`} sub={`${d.items.length} รายการ`} />
                <Stat label="หมวดที่จ่ายมากสุด" value={d.categories[0]?.name ?? '-'} sub={d.categories[0] ? `฿${baht(d.categories[0].total)}` : undefined} />
              </div>
              <div className="grid grid-cols-6 gap-1 sm:grid-cols-12" aria-label="รายเดือน">
                {d.months.map((m) => (
                  <div key={m.month} className="grid gap-1 text-center">
                    <div className="flex h-14 items-end rounded bg-muted/50">
                      <div className="w-full rounded bg-primary" style={{ height: `${maxMonth > 0 ? (m.total / maxMonth) * 100 : 0}%` }} title={`฿${baht(m.total)}`} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{MONTH_SHORT[m.month - 1]}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {d.categories.map((c) => (
                  <span key={c.categoryId} className="rounded-full border px-2.5 py-1 text-xs">
                    {c.name} <b className="tabular">฿{baht(c.total)}</b>
                  </span>
                ))}
              </div>
              <ul className="divide-y rounded-lg border">
                {d.items.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 p-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{e.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {dateOnly(e.expenseDate)} · {e.categoryName}
                        {e.vendor ? ` · ${e.vendor}` : ''} · {PAY_LABEL[e.paymentMethod]}
                        {e.createdByName ? ` · ${e.createdByName}` : ''}
                      </p>
                    </div>
                    <span className="tabular font-medium">{baht(e.amount)}</span>
                    {canEdit ? (
                      <>
                        <Button variant="ghost" size="icon" className="size-7 cursor-pointer" aria-label="แก้ไข" onClick={() => setEditing({ expense: e })}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7 cursor-pointer text-destructive" aria-label="ลบ" onClick={() => setDeleting(e)}>
                          <Trash2 />
                        </Button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <ExpenseDialog
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          changed()
        }}
      />
      <ConfirmDelete
        expense={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null)
          changed()
        }}
      />
    </>
  )
}
