import { useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Empty, ErrorBox, Field, Loading, PageHeader, Stat, TableWrap } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { baht, dateOnly, todayISO } from '@/lib/format'
import { useApi, useDebounced } from '@/lib/use-api'
import { cn } from '@/lib/utils'
import { ExpenseDialog, type ExpenseDialogTarget } from './ExpenseDialog'
import {
  MONTH_LONG,
  MONTH_SHORT,
  PAY_LABEL,
  monthLabel,
  monthRange,
  thaiYear,
  type Expense,
  type ExpenseCategory,
  type ExpenseList,
  type ExpenseSummary,
  type ExpenseVehicle,
} from './types'

const ALL = '__all__'

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

/** Business expenses: enter / edit / delete, monthly and yearly summary, categories. */
export function ExpensesPage() {
  const [tab, setTab] = useState('list')
  const [month, setMonth] = useState(todayISO().slice(0, 7))
  const [year, setYear] = useState(Number(todayISO().slice(0, 4)))

  return (
    <div>
      <PageHeader title="ค่าใช้จ่าย" subtitle="บันทึกค่าใช้จ่ายของร้าน ผูกกับรถได้ และดูสรุปรายเดือน / รายปี" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list" className="cursor-pointer">
            รายการ
          </TabsTrigger>
          <TabsTrigger value="summary" className="cursor-pointer">
            สรุปเดือน / ปี
          </TabsTrigger>
          <TabsTrigger value="categories" className="cursor-pointer">
            หมวดหมู่
          </TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-3">
          <ListTab month={month} setMonth={setMonth} />
        </TabsContent>
        <TabsContent value="summary" className="mt-3">
          <SummaryTab
            year={year}
            setYear={setYear}
            openMonth={(m) => {
              setMonth(`${year}-${String(m).padStart(2, '0')}`)
              setTab('list')
            }}
          />
        </TabsContent>
        <TabsContent value="categories" className="mt-3">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------- list

function ListTab({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const [categoryId, setCategoryId] = useState(ALL)
  const [vehicleId, setVehicleId] = useState(ALL)
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 300)
  const { from, to } = monthRange(month)
  const params = new URLSearchParams({ from, to })
  if (categoryId !== ALL) params.set('categoryId', categoryId)
  if (vehicleId !== ALL) params.set('vehicleId', vehicleId)
  if (q) params.set('q', q)
  const list = useApi<ExpenseList>(`/expenses?${params.toString()}`)
  const categories = useApi<ExpenseCategory[]>('/expenses/categories')
  const vehicles = useApi<ExpenseVehicle[]>('/expenses/vehicles')
  const [editing, setEditing] = useState<ExpenseDialogTarget | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const filtered = categoryId !== ALL || vehicleId !== ALL || q !== ''

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="cursor-pointer" aria-label="เดือนก่อน" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft />
          </Button>
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-40" aria-label="เดือน" />
          <Button variant="outline" size="icon" className="cursor-pointer" aria-label="เดือนถัดไป" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight />
          </Button>
        </div>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="w-44 cursor-pointer" aria-label="กรองหมวด">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>ทุกหมวด</SelectItem>
            {(categories.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={vehicleId} onValueChange={setVehicleId}>
          <SelectTrigger className="w-40 cursor-pointer" aria-label="กรองรถ">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>ทุกคัน</SelectItem>
            {(vehicles.data ?? []).map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-40 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหารายละเอียด / ร้าน" className="pl-8" />
        </div>
        <Button className="cursor-pointer" onClick={() => setEditing({ expense: null, vehicleId: vehicleId !== ALL ? vehicleId : null })}>
          <Plus /> บันทึกค่าใช้จ่าย
        </Button>
      </div>

      {list.error ? <ErrorBox message={list.error} onRetry={() => void list.reload()} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data ? (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <Stat label={`รวม ${monthLabel(month)}${filtered ? ' (ตามตัวกรอง)' : ''}`} value={`฿${baht(list.data.total)}`} />
            <Stat label="จำนวนรายการ" value={list.data.items.length.toLocaleString('th-TH')} />
          </div>
          {list.data.items.length === 0 ? (
            <Empty title="ยังไม่มีค่าใช้จ่ายในเดือนนี้" hint={filtered ? 'ลองล้างตัวกรอง' : 'กด "บันทึกค่าใช้จ่าย" เพื่อเพิ่มรายการแรก'} />
          ) : (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>รายการ</TableHead>
                    <TableHead className="hidden md:table-cell">หมวด</TableHead>
                    <TableHead className="text-right">จำนวนเงิน</TableHead>
                    <TableHead className="w-10 sm:w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.items.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="align-top whitespace-nowrap">{dateOnly(e.expenseDate)}</TableCell>
                      <TableCell className="min-w-32 align-top whitespace-normal">
                        <p className="font-medium">{e.description}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="md:hidden">{e.categoryName} · </span>
                          {e.vehicleLabel ? (
                            <span className="inline-flex items-center gap-0.5">
                              <Truck className="size-3" /> {e.vehicleLabel} ·{' '}
                            </span>
                          ) : null}
                          {e.vendor ? `${e.vendor} · ` : ''}
                          {PAY_LABEL[e.paymentMethod]}
                          {e.createdByName ? ` · บันทึกโดย ${e.createdByName}` : ''}
                          {e.updatedByName ? ` · แก้โดย ${e.updatedByName}` : ''}
                        </p>
                        {e.note ? <p className="text-xs text-muted-foreground italic">{e.note}</p> : null}
                      </TableCell>
                      <TableCell className="hidden align-top md:table-cell">{e.categoryName}</TableCell>
                      <TableCell className="tabular text-right align-top font-medium">{baht(e.amount)}</TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                          <Button variant="ghost" size="icon" className="size-8 cursor-pointer" aria-label="แก้ไข" onClick={() => setEditing({ expense: e })}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-8 cursor-pointer text-destructive" aria-label="ลบ" onClick={() => setDeleting(e)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2} className="md:hidden">
                      รวม
                    </TableCell>
                    <TableCell colSpan={3} className="hidden md:table-cell">
                      รวม
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">{baht(list.data.total)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </TableWrap>
          )}
          {list.data.truncated ? <p className="text-xs text-muted-foreground">แสดง 1,000 รายการแรก — ใช้ตัวกรองเพื่อดูรายการที่เหลือ</p> : null}
        </>
      ) : null}

      <ExpenseDialog
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void list.reload()
        }}
      />
      <ConfirmDelete
        expense={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null)
          void list.reload()
        }}
      />
    </div>
  )
}

export function ConfirmDelete({ expense, onClose, onDeleted }: { expense: Expense | null; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    if (!expense) return
    setBusy(true)
    try {
      await apiFetch(`/expenses/${expense.id}`, { method: 'DELETE' })
      toast.success('ลบรายการแล้ว')
      onDeleted()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={expense !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>ลบค่าใช้จ่ายนี้?</DialogTitle>
          <DialogDescription>
            {expense ? `${dateOnly(expense.expenseDate)} · ${expense.description} · ฿${baht(expense.amount)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button variant="destructive" className="cursor-pointer" disabled={busy} onClick={() => void remove()}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} ลบ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- summary

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-muted">
      <div className={cn('h-1.5 rounded-full bg-primary', className)} style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
    </div>
  )
}

function SummaryTab({ year, setYear, openMonth }: { year: number; setYear: (y: number) => void; openMonth: (m: number) => void }) {
  const s = useApi<ExpenseSummary>(`/expenses/summary?year=${year}`)
  const d = s.data
  const thisYear = Number(todayISO().slice(0, 4))
  const monthsWithData = d ? d.months.filter((m) => m.total > 0).length : 0
  const maxMonth = d ? Math.max(0, ...d.months.map((m) => m.total)) : 0
  const maxCat = d ? Math.max(0, ...d.categories.map((c) => c.total)) : 0
  const maxVeh = d ? Math.max(0, ...d.vehicles.map((v) => v.total)) : 0
  const cell = (m: number, categoryId: string) => d?.grid.find((g) => g.month === m && g.categoryId === categoryId)?.total ?? 0

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="cursor-pointer" aria-label="ปีก่อน" onClick={() => setYear(year - 1)}>
          <ChevronLeft />
        </Button>
        <p className="min-w-24 text-center font-semibold">ปี {thaiYear(year)}</p>
        <Button variant="outline" size="icon" className="cursor-pointer" aria-label="ปีถัดไป" disabled={year >= thisYear} onClick={() => setYear(year + 1)}>
          <ChevronRight />
        </Button>
      </div>
      {s.error ? <ErrorBox message={s.error} onRetry={() => void s.reload()} /> : null}
      {s.loading && !d ? <Loading /> : null}
      {d && d.total === 0 ? <Empty title={`ยังไม่มีค่าใช้จ่ายในปี ${thaiYear(year)}`} /> : null}
      {d && d.total > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label={`รวมทั้งปี ${thaiYear(year)}`} value={`฿${baht(d.total)}`} />
            <Stat label="เฉลี่ยต่อเดือน" value={`฿${baht(monthsWithData > 0 ? d.total / monthsWithData : 0)}`} sub={`จาก ${monthsWithData} เดือนที่มีรายการ`} />
            <Stat label="หมวดที่จ่ายมากสุด" value={d.categories[0]?.name ?? '-'} sub={d.categories[0] ? `฿${baht(d.categories[0].total)}` : undefined} />
            <Stat label="ค่าใช้จ่ายรถรวม" value={`฿${baht(d.vehicles.reduce((t, v) => t + v.total, 0))}`} sub={`${d.vehicles.length} คัน`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="grid content-start gap-2">
              <h2 className="text-sm font-semibold">รายเดือน</h2>
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เดือน</TableHead>
                      <TableHead className="text-right">รายการ</TableHead>
                      <TableHead className="text-right">รวม (บาท)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.months.map((m) => (
                      <TableRow key={m.month} className={cn(m.total > 0 && 'cursor-pointer hover:bg-muted/50')} onClick={() => m.total > 0 && openMonth(m.month)}>
                        <TableCell>
                          <p>{MONTH_LONG[m.month - 1]}</p>
                          <Bar value={m.total} max={maxMonth} />
                        </TableCell>
                        <TableCell className="tabular text-right align-top">{m.count || '-'}</TableCell>
                        <TableCell className="tabular text-right align-top font-medium">{m.total > 0 ? baht(m.total) : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell>รวม</TableCell>
                      <TableCell className="tabular text-right">{d.months.reduce((t, m) => t + m.count, 0)}</TableCell>
                      <TableCell className="tabular text-right font-semibold">{baht(d.total)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableWrap>
              <p className="text-xs text-muted-foreground">แตะเดือนเพื่อดูรายการ</p>
            </section>

            <div className="grid content-start gap-3">
              <section className="grid gap-2">
                <h2 className="text-sm font-semibold">ตามหมวด</h2>
                <TableWrap>
                  <Table>
                    <TableBody>
                      {d.categories.map((c) => (
                        <TableRow key={c.categoryId}>
                          <TableCell>
                            <p>
                              {c.name} <span className="text-xs text-muted-foreground">({c.count})</span>
                            </p>
                            <Bar value={c.total} max={maxCat} />
                          </TableCell>
                          <TableCell className="tabular w-32 text-right align-top">
                            {baht(c.total)}
                            <p className="text-xs text-muted-foreground">{Math.round((c.total / d.total) * 100)}%</p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrap>
              </section>
              {d.vehicles.length > 0 ? (
                <section className="grid gap-2">
                  <h2 className="text-sm font-semibold">ตามรถ</h2>
                  <TableWrap>
                    <Table>
                      <TableBody>
                        {d.vehicles.map((v) => (
                          <TableRow key={v.vehicleId}>
                            <TableCell>
                              <p className="flex items-center gap-1">
                                <Truck className="size-3.5" /> {v.label}
                                {v.label !== v.name ? <span className="text-xs text-muted-foreground">· {v.name}</span> : null}
                              </p>
                              <Bar value={v.total} max={maxVeh} />
                            </TableCell>
                            <TableCell className="tabular w-32 text-right align-top">{baht(v.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableWrap>
                </section>
              ) : null}
            </div>
          </div>

          <section className="grid gap-2">
            <h2 className="text-sm font-semibold">รายเดือนแยกหมวด</h2>
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-card">หมวด</TableHead>
                    {MONTH_SHORT.map((m) => (
                      <TableHead key={m} className="text-right">
                        {m}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">รวม</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.categories.map((c) => (
                    <TableRow key={c.categoryId}>
                      <TableCell className="sticky left-0 bg-card whitespace-nowrap">{c.name}</TableCell>
                      {MONTH_SHORT.map((_, i) => {
                        const v = cell(i + 1, c.categoryId)
                        return (
                          <TableCell key={i} className="tabular text-right text-xs whitespace-nowrap">
                            {v > 0 ? baht(v) : '-'}
                          </TableCell>
                        )
                      })}
                      <TableCell className="tabular text-right font-medium whitespace-nowrap">{baht(c.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          </section>
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- categories

function CategoriesTab() {
  const categories = useApi<ExpenseCategory[]>('/expenses/categories')
  const [editing, setEditing] = useState<{ id: string | null; name: string; isVehicle: boolean; isActive: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      const body = { name: editing.name.trim(), isVehicle: editing.isVehicle, isActive: editing.isActive }
      await apiFetch(editing.id ? `/expenses/categories/${editing.id}` : '/expenses/categories', { method: editing.id ? 'PUT' : 'POST', body })
      toast.success('บันทึกหมวดแล้ว')
      setEditing(null)
      void categories.reload()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (c: ExpenseCategory) => {
    try {
      await apiFetch(`/expenses/categories/${c.id}`, { method: 'DELETE' })
      toast.success(`ลบหมวด ${c.name} แล้ว`)
      void categories.reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">หมวดที่ตั้งเป็น "ค่าใช้จ่ายรถ" จะบังคับให้เลือกรถทุกครั้ง</p>
        <Button className="cursor-pointer" onClick={() => setEditing({ id: null, name: '', isVehicle: false, isActive: true })}>
          <Plus /> เพิ่มหมวด
        </Button>
      </div>
      {categories.error ? <ErrorBox message={categories.error} onRetry={() => void categories.reload()} /> : null}
      {categories.loading && !categories.data ? <Loading /> : null}
      {categories.data ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>หมวด</TableHead>
                <TableHead className="text-right">รายการ</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.data.map((c) => (
                <TableRow key={c.id} className={cn(!c.isActive && 'opacity-50')}>
                  <TableCell>
                    {c.name}
                    {c.isVehicle ? <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">ค่าใช้จ่ายรถ</span> : null}
                    {!c.isActive ? <span className="ml-2 text-xs text-muted-foreground">ปิดใช้งาน</span> : null}
                  </TableCell>
                  <TableCell className="tabular text-right">{c.expenseCount}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 cursor-pointer"
                        aria-label={`แก้ไขหมวด ${c.name}`}
                        onClick={() => setEditing({ id: c.id, name: c.name, isVehicle: c.isVehicle, isActive: c.isActive })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 cursor-pointer text-destructive"
                        aria-label={`ลบหมวด ${c.name}`}
                        disabled={c.expenseCount > 0}
                        title={c.expenseCount > 0 ? 'มีรายการแล้ว — ปิดใช้งานแทน' : undefined}
                        onClick={() => void remove(c)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && !busy && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'แก้ไขหมวด' : 'เพิ่มหมวด'}</DialogTitle>
            <DialogDescription>ใช้จัดกลุ่มค่าใช้จ่ายในสรุปรายเดือน / ปี</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-3">
              <Field label="ชื่อหมวด" htmlFor="cat-name">
                <Input id="cat-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm">
                ค่าใช้จ่ายรถ (ต้องเลือกรถ)
                <Switch checked={editing.isVehicle} onCheckedChange={(v) => setEditing({ ...editing, isVehicle: v })} />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm">
                ใช้งาน
                <Switch checked={editing.isActive} onCheckedChange={(v) => setEditing({ ...editing, isActive: v })} />
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setEditing(null)} disabled={busy}>
              ยกเลิก
            </Button>
            <Button className="cursor-pointer" disabled={!editing?.name.trim() || busy} onClick={() => void save()}>
              {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
