import { useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'
import { Banknote, FileText, Loader2, NotebookPen, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NumberInput } from '@/components/common'
import { useApp } from '@/lib/app-context'
import { addDaysISO, baht, dateOnly, round2, todayISO } from '@/lib/format'
import { isValidPromptPayId, promptPayPayload } from '@/lib/promptpay'
import type { Customer, PaymentMethod } from '@/lib/types'
import { cn } from '@/lib/utils'

const QUICK_CASH = [20, 50, 100, 500, 1000]

export function PaymentDialog({
  open,
  total,
  customer,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean
  total: number
  customer: Customer | null
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (method: PaymentMethod, cashReceived: number | null, forAccounting: boolean) => void
}) {
  const { data } = useApp()
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [cash, setCash] = useState<number | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [forAccounting, setForAccounting] = useState(false)
  const promptpayId = data.settings.promptpayId

  useEffect(() => {
    if (open) {
      setMethod('cash')
      setCash(null)
      setForAccounting(customer?.sendToAccounting ?? false)
    }
  }, [open, customer])

  useEffect(() => {
    if (method !== 'promptpay' || !isValidPromptPayId(promptpayId) || !promptpayId) {
      setQr(null)
      return
    }
    let alive = true
    toDataURL(promptPayPayload(promptpayId, total), { margin: 1, width: 280 })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null))
    return () => {
      alive = false
    }
  }, [method, promptpayId, total])

  const received = cash ?? total
  const change = round2(received - total)
  const creditAvailable = customer ? round2(customer.creditLimit - customer.balance) : 0
  const creditBlocked = !customer ? 'ขายเชื่อต้องเลือกลูกค้าก่อน' : customer.creditLimit <= 0 ? 'ลูกค้านี้ยังไม่มีวงเงินเครดิต' : total > creditAvailable ? `เกินวงเงิน (ใช้ได้ ${baht(creditAvailable)})` : null
  const canConfirm =
    !busy &&
    ((method === 'cash' && received >= total) ||
      (method === 'promptpay' && isValidPromptPayId(promptpayId)) ||
      (method === 'credit' && !creditBlocked))

  const confirm = () => {
    if (canConfirm) onConfirm(method, method === 'cash' ? received : null, forAccounting && customer !== null)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>รับชำระเงิน</DialogTitle>
          <DialogDescription>
            ยอดที่ต้องชำระ <span className="tabular text-lg font-semibold text-foreground">{baht(total)}</span> บาท
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['cash', 'เงินสด', Banknote],
              ['promptpay', 'พร้อมเพย์', QrCode],
              ['credit', 'เงินเชื่อ', NotebookPen],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-3 text-sm transition-colors',
                method === m ? 'border-primary bg-primary/10 font-semibold text-primary' : 'hover:bg-muted',
              )}
            >
              <Icon className="size-5" /> {label}
            </button>
          ))}
        </div>

        {method === 'cash' ? (
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm">
              รับเงินมา (บาท)
              <NumberInput value={cash} onChange={setCash} placeholder={baht(total)} className="h-12 text-xl" autoFocus onEnter={confirm} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setCash(total)}>
                พอดี
              </Button>
              {QUICK_CASH.filter((v) => v >= total || v >= 100).map((v) => (
                <Button key={v} variant="outline" size="sm" className="cursor-pointer" onClick={() => setCash(v)}>
                  {v.toLocaleString('th-TH')}
                </Button>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
              <span className="text-sm text-muted-foreground">เงินทอน</span>
              <span className={cn('tabular text-2xl font-bold', change < 0 ? 'text-destructive' : 'text-primary')}>
                {change < 0 ? `ขาด ${baht(-change)}` : baht(change)}
              </span>
            </div>
          </div>
        ) : null}

        {method === 'promptpay' ? (
          isValidPromptPayId(promptpayId) ? (
            <div className="flex flex-col items-center gap-2">
              {qr ? <img src={qr} alt="QR พร้อมเพย์" className="size-56 rounded-lg border bg-white p-2" /> : <Loader2 className="size-8 animate-spin" />}
              <p className="text-sm text-muted-foreground">
                พร้อมเพย์ {promptpayId} · {baht(total)} บาท
              </p>
              <p className="text-center text-xs text-muted-foreground">ให้ลูกค้าสแกน แล้วตรวจสอบยอดเงินเข้าก่อนกดยืนยัน</p>
            </div>
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              ยังไม่ได้ตั้งค่าเบอร์/เลขพร้อมเพย์ของร้าน — ไปที่เมนู ตั้งค่า
            </p>
          )
        ) : null}

        {method === 'credit' ? (
          <div className="grid gap-1 rounded-lg bg-muted p-3 text-sm">
            <p>
              ลูกค้า: <span className="font-medium">{customer?.name ?? '— ยังไม่ได้เลือก —'}</span>
            </p>
            {customer ? (
              <>
                <p className="tabular">ยอดค้างเดิม {baht(customer.balance)} · วงเงิน {baht(customer.creditLimit)}</p>
                <p className="tabular">หลังขายบิลนี้ ค้าง {baht(customer.balance + total)}</p>
                <p>
                  เครดิต {customer.creditTermDays} วัน · ครบกำหนดชำระ {dateOnly(addDaysISO(todayISO(), customer.creditTermDays))}
                </p>
              </>
            ) : null}
            {creditBlocked ? <p className="font-medium text-destructive">{creditBlocked}</p> : null}
          </div>
        ) : null}

        <label
          className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-sm ${customer ? 'cursor-pointer' : 'opacity-60'}`}
        >
          <span className="flex items-start gap-2">
            <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              ส่งบัญชี (ออกใบเสร็จเต็มรูป)
              <span className="block text-xs text-muted-foreground">
                {customer
                  ? customer.taxId
                    ? `ผู้ซื้อ ${customer.name} · เลขผู้เสียภาษี ${customer.taxId}`
                    : 'ลูกค้านี้ยังไม่มีเลขผู้เสียภาษี/ที่อยู่ — เพิ่มได้ที่ข้อมูลลูกค้า'
                  : 'ต้องเลือกลูกค้าก่อน'}
              </span>
            </span>
          </span>
          <Switch checked={forAccounting && customer !== null} disabled={!customer} onCheckedChange={setForAccounting} />
        </label>

        {error ? <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={busy}>
            กลับไปแก้ไข
          </Button>
          <Button className="h-11 cursor-pointer text-base" onClick={confirm} disabled={!canConfirm}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {method === 'promptpay' ? 'ได้รับเงินแล้ว — บันทึกบิล' : 'ยืนยันบันทึกบิล'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
