import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field, NumberInput } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { todayISO } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { PAY_LABEL, type Expense, type ExpenseCategory, type ExpenseVehicle, type PaymentMethod } from './types'

interface Form {
  expenseDate: string
  categoryId: string
  amount: number | null
  description: string
  vendor: string
  paymentMethod: PaymentMethod
  vehicleId: string | null
  note: string
}

export interface ExpenseDialogTarget {
  /** null = new expense. */
  expense: Expense | null
  /** Prefill for a new expense (e.g. opened from a vehicle card). */
  vehicleId?: string | null
}

const NO_VEHICLE = '__none__'

function toForm(t: ExpenseDialogTarget): Form {
  const e = t.expense
  return e
    ? {
        expenseDate: e.expenseDate,
        categoryId: e.categoryId,
        amount: e.amount,
        description: e.description,
        vendor: e.vendor ?? '',
        paymentMethod: e.paymentMethod,
        vehicleId: e.vehicleId,
        note: e.note ?? '',
      }
    : { expenseDate: todayISO(), categoryId: '', amount: null, description: '', vendor: '', paymentMethod: 'cash', vehicleId: t.vehicleId ?? null, note: '' }
}

/** Add or edit one business expense. Categories and vehicles load when the dialog opens. */
export function ExpenseDialog({ target, onClose, onSaved }: { target: ExpenseDialogTarget | null; onClose: () => void; onSaved: (e: Expense) => void }) {
  const open = target !== null
  const categories = useApi<ExpenseCategory[]>(open ? '/expenses/categories' : null)
  const vehicles = useApi<ExpenseVehicle[]>(open ? '/expenses/vehicles' : null)
  const [f, setF] = useState<Form>(() => toForm({ expense: null }))
  const [busy, setBusy] = useState(false)
  // One id per new expense: pressing save again after a timeout cannot record it twice.
  const clientRef = useRef<string>(crypto.randomUUID())

  useEffect(() => {
    if (!target) return
    setF(toForm(target))
    clientRef.current = crypto.randomUUID()
  }, [target])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  const cats = (categories.data ?? []).filter((c) => c.isActive || c.id === f.categoryId)
  const cat = categories.data?.find((c) => c.id === f.categoryId)
  const vehicleRequired = cat?.isVehicle ?? false
  const vehicleList = (vehicles.data ?? []).filter((v) => v.isActive || v.id === f.vehicleId)
  const badYear = f.expenseDate !== '' && (f.expenseDate < '2000-01-01' || f.expenseDate > '2100-12-31')
  const valid = f.expenseDate !== '' && !badYear && f.categoryId !== '' && f.amount !== null && f.amount > 0 && f.description.trim() !== '' && (!vehicleRequired || f.vehicleId !== null)

  const save = async () => {
    if (!target || !valid) return
    setBusy(true)
    try {
      const body = {
        expenseDate: f.expenseDate,
        categoryId: f.categoryId,
        amount: f.amount,
        description: f.description.trim(),
        vendor: f.vendor.trim() || null,
        paymentMethod: f.paymentMethod,
        vehicleId: f.vehicleId,
        note: f.note.trim() || null,
      }
      const saved = target.expense
        ? await apiFetch<Expense>(`/expenses/${target.expense.id}`, { method: 'PUT', body })
        : await apiFetch<Expense>('/expenses', { method: 'POST', body: { ...body, clientRef: clientRef.current } })
      toast.success(target.expense ? 'แก้ไขค่าใช้จ่ายแล้ว' : 'บันทึกค่าใช้จ่ายแล้ว')
      onSaved(saved)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target?.expense ? 'แก้ไขค่าใช้จ่าย' : 'บันทึกค่าใช้จ่าย'}</DialogTitle>
          <DialogDescription>ค่าใช้จ่ายที่เกี่ยวกับร้าน เช่น ค่าน้ำมัน ค่าซ่อมรถ ค่าไฟ ค่าเช่า</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="วันที่จ่าย" htmlFor="exp-date">
            <Input id="exp-date" type="date" value={f.expenseDate} onChange={(e) => set('expenseDate', e.target.value)} />
          </Field>
          <Field label="จำนวนเงิน (บาท)" htmlFor="exp-amount">
            <NumberInput id="exp-amount" value={f.amount} onChange={(v) => set('amount', v)} placeholder="0.00" />
          </Field>
          <Field label="หมวด" className="sm:col-span-2">
            <Select value={f.categoryId} onValueChange={(v) => set('categoryId', v)}>
              <SelectTrigger className="w-full cursor-pointer" aria-label="หมวด">
                <SelectValue placeholder={categories.loading ? 'กำลังโหลด…' : 'เลือกหมวด'} />
              </SelectTrigger>
              <SelectContent>
                {cats.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.isVehicle ? ' (ค่าใช้จ่ายรถ)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="รายละเอียด" htmlFor="exp-desc" className="sm:col-span-2">
            <Input id="exp-desc" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="เช่น เติมดีเซล 40 ลิตร / เปลี่ยนยาง 2 เส้น" />
          </Field>
          <Field label={vehicleRequired ? 'รถ (ต้องเลือก)' : 'เกี่ยวกับรถ (ถ้ามี)'} className="sm:col-span-2">
            <Select value={f.vehicleId ?? NO_VEHICLE} onValueChange={(v) => set('vehicleId', v === NO_VEHICLE ? null : v)}>
              <SelectTrigger className="w-full cursor-pointer" aria-label="รถ">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_VEHICLE}>— ไม่เกี่ยวกับรถ —</SelectItem>
                {vehicleList.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label}
                    {v.label !== v.name ? ` · ${v.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="จ่ายให้ / ร้าน" htmlFor="exp-vendor">
            <Input id="exp-vendor" value={f.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="เช่น ปั๊ม ปตท. สาขา…" />
          </Field>
          <Field label="ชำระโดย">
            <Select value={f.paymentMethod} onValueChange={(v) => set('paymentMethod', v as PaymentMethod)}>
              <SelectTrigger className="w-full cursor-pointer" aria-label="ชำระโดย">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PAY_LABEL) as PaymentMethod[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {PAY_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="หมายเหตุ" htmlFor="exp-note" className="sm:col-span-2">
            <Textarea id="exp-note" rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </div>
        {badYear ? <p className="text-sm text-destructive">วันที่ต้องเป็นปี ค.ศ. (เช่น 2026) ไม่ใช่ พ.ศ.</p> : null}
        {vehicleRequired && !f.vehicleId ? <p className="text-sm text-amber-700 dark:text-amber-400">หมวดนี้ต้องเลือกรถ</p> : null}
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="cursor-pointer" disabled={!valid || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : null} บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
