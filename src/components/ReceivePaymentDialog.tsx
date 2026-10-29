import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { HandCoins, Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, NumberInput } from '@/components/common'
import { PaymentReceiptPrint, PaymentReceiptView } from '@/components/PaymentReceipt'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { baht, dateOnly, round2 } from '@/lib/format'
import { printSoon } from '@/lib/print'
import { newEvent } from '@/lib/terminal'
import type { OpenBill, PaymentReceipt } from '@/lib/types'

/**
 * Receive money for specific credit bills (or oldest-first when `bills` is empty),
 * then show and print the receipt.
 */
export function ReceivePaymentDialog({
  open,
  customer,
  bills,
  onClose,
  onDone,
}: {
  open: boolean
  customer: { id: string; name: string; balance: number } | null
  /** Bills the customer is paying, in the order they should be settled. Empty = oldest first. */
  bills: OpenBill[]
  onClose: () => void
  onDone: () => void
}) {
  const { locationId } = useApp()
  const due = useMemo(() => round2(bills.reduce((s, b) => s + b.outstanding, 0)), [bills])
  const max = bills.length > 0 ? due : (customer?.balance ?? 0)
  const [amount, setAmount] = useState<number | null>(null)
  const [method, setMethod] = useState('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null)
  const [printing, setPrinting] = useState(false)
  // Same event for retries of this payment: a resend never issues a second receipt.
  const event = useRef(newEvent())

  useEffect(() => {
    if (!open) return
    event.current = newEvent()
    setAmount(bills.length > 0 ? due : null)
    setMethod('cash')
    setNote('')
    setReceipt(null)
  }, [open, bills, due])

  useEffect(() => {
    if (!printing) return
    printSoon()
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [printing])

  const submit = async () => {
    if (!customer || !amount) return
    setBusy(true)
    try {
      const res = await apiFetch<{ paymentId: string; receiptNo: string | null }>(`/customers/${customer.id}/payments`, {
        method: 'POST',
        body: {
          ...event.current,
          zoneId: locationId || 'office',
          amount,
          method,
          note: note.trim() || null,
          bills: bills.map((b) => ({ saleId: b.saleId })),
        },
      })
      toast.success(`รับชำระ ${baht(amount)} บาท · ใบเสร็จ ${res.receiptNo ?? ''}`)
      setReceipt(await apiFetch<PaymentReceipt>(`/payments/${res.paymentId}`))
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{receipt ? 'ออกใบเสร็จรับเงินแล้ว' : `รับชำระ — ${customer?.name ?? ''}`}</DialogTitle>
          <DialogDescription>
            {receipt
              ? `เลขที่ ${receipt.receiptNo ?? ''}`
              : bills.length > 0
                ? `บิลที่เลือก ${bills.length} ใบ · ค้างรวม ${baht(due)} บาท`
                : `ไม่ได้เลือกบิล — ระบบตัดบิลที่ซื้อก่อนก่อน · ยอดค้างทั้งหมด ${baht(customer?.balance ?? 0)} บาท`}
          </DialogDescription>
        </DialogHeader>

        {receipt ? (
          <>
            <div className="rounded-lg border">
              <PaymentReceiptView receipt={receipt} layout="slip" />
            </div>
            {printing ? <PaymentReceiptPrint receipt={receipt} /> : null}
            <DialogFooter>
              <Button variant="outline" className="cursor-pointer" onClick={() => setPrinting(true)}>
                <Printer /> พิมพ์ใบเสร็จ
              </Button>
              <Button className="cursor-pointer" onClick={onClose}>
                เสร็จ
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {bills.length > 0 ? (
              <ul className="divide-y rounded-lg border text-sm">
                {bills.map((b) => (
                  <li key={b.saleId} className="flex justify-between gap-2 px-3 py-2">
                    <span>
                      {b.taxInvoiceNo ?? b.billNo}
                      <span className="block text-xs text-muted-foreground">ครบกำหนด {dateOnly(b.dueDate)}</span>
                    </span>
                    <span className="tabular">{baht(b.outstanding)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="รับเงิน (บาท)" hint={bills.length > 1 ? 'จ่ายไม่ครบได้ — ตัดตามลำดับบิลด้านบน' : undefined}>
                <NumberInput value={amount} onChange={setAmount} placeholder={baht(max)} autoFocus onEnter={() => void submit()} />
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
              <Field label="หมายเหตุ" className="sm:col-span-2">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โอนเข้าบัญชีกสิกร" />
              </Field>
            </div>
            {amount !== null && amount > max ? <p className="text-sm text-destructive">ยอดรับมากกว่ายอดค้าง ({baht(max)} บาท)</p> : null}
            <DialogFooter>
              <Button className="cursor-pointer" disabled={busy || !amount || amount <= 0 || amount > max} onClick={() => void submit()}>
                {busy ? <Loader2 className="animate-spin" /> : <HandCoins />} รับชำระและออกใบเสร็จ
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
