import { useState } from 'react'
import { toast } from 'sonner'
import { Ban, Loader2, Printer, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Empty, ErrorBox, Loading, PageHeader, TableWrap } from '@/components/common'
import { Receipt } from '@/components/Receipt'
import { apiFetch, errorMessage } from '@/lib/api'
import { PAYMENT_LABEL, baht, dateTime, todayISO } from '@/lib/format'
import { newEvent } from '@/lib/terminal'
import type { SaleDetail, SaleHeader } from '@/lib/types'
import { useApi, useDebounced } from '@/lib/use-api'

export function SalesPage() {
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(todayISO())
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim())
  const list = useApi<SaleHeader[]>(`/sales?from=${from}&to=${to}&q=${encodeURIComponent(dq)}`)
  const [openId, setOpenId] = useState<string | null>(null)

  const completed = list.data?.filter((s) => s.status === 'completed') ?? []
  const total = completed.reduce((s, b) => s + b.total, 0)

  return (
    <div>
      <PageHeader title="ประวัติบิลขาย" subtitle={list.data ? `${completed.length} บิล · ยอดขาย ${baht(total)} บาท` : undefined} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          ตั้งแต่
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </label>
        <label className="grid gap-1 text-sm">
          ถึง
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </label>
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="เลขที่บิล / ชื่อลูกค้า" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {list.error ? <ErrorBox message={list.error} onRetry={() => void list.reload()} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data?.length === 0 ? <Empty title="ไม่มีบิลในช่วงวันที่นี้" /> : null}
      {list.data && list.data.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เลขที่บิล</TableHead>
                <TableHead>เวลา</TableHead>
                <TableHead className="hidden md:table-cell">ลูกค้า</TableHead>
                <TableHead>ชำระ</TableHead>
                <TableHead className="text-right">ยอดสุทธิ</TableHead>
                <TableHead className="hidden text-right sm:table-cell">กำไร</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpenId(s.id)}>
                  <TableCell className="font-medium">
                    {s.billNo}
                    {s.status === 'voided' ? <Badge variant="destructive" className="ml-2">ยกเลิก</Badge> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{dateTime(s.soldAt)}</TableCell>
                  <TableCell className="hidden md:table-cell">{s.customerName ?? '-'}</TableCell>
                  <TableCell>{PAYMENT_LABEL[s.paymentMethod]}</TableCell>
                  <TableCell className={`tabular text-right ${s.status === 'voided' ? 'text-muted-foreground line-through' : ''}`}>{baht(s.total)}</TableCell>
                  <TableCell className="tabular hidden text-right sm:table-cell">{s.status === 'voided' ? '-' : baht(s.profit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}

      <SaleDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => void list.reload()} />
    </div>
  )
}

function SaleDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<SaleDetail>(id ? `/sales/${id}` : null)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const sale = id && detail.data?.id === id ? detail.data : null

  const doVoid = async () => {
    if (!sale) return
    setBusy(true)
    try {
      await apiFetch(`/sales/${sale.id}/void`, { method: 'POST', body: { ...newEvent(), reason: reason.trim() } })
      toast.success(`ยกเลิกบิล ${sale.billNo} และคืนสต็อกแล้ว`)
      setVoiding(false)
      setReason('')
      onChanged()
      void detail.reload()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sale?.billNo ?? 'บิลขาย'}</DialogTitle>
          <DialogDescription>
            {sale ? `ต้นทุน ${baht(sale.costTotal)} · กำไร ${baht(sale.profit)} บาท` : ' '}
          </DialogDescription>
        </DialogHeader>
        {detail.error ? <ErrorBox message={detail.error} /> : null}
        {!sale && !detail.error ? <Loading /> : null}
        {sale ? <Receipt sale={sale} /> : null}
        {sale?.status === 'voided' ? (
          <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">ยกเลิกแล้ว: {sale.voidReason}</p>
        ) : null}
        {voiding ? (
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="void-reason">
              เหตุผลที่ยกเลิกบิล
            </label>
            <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้าเปลี่ยนใจ / คีย์ผิด" />
            <p className="text-xs text-muted-foreground">ระบบจะคืนสต็อกเข้าล็อตเดิม และถ้าเป็นเงินเชื่อจะลดยอดลูกหนี้ให้อัตโนมัติ</p>
          </div>
        ) : null}
        <DialogFooter>
          {sale?.status === 'completed' && !voiding ? (
            <Button variant="outline" className="cursor-pointer text-destructive" onClick={() => setVoiding(true)}>
              <Ban /> ยกเลิกบิล
            </Button>
          ) : null}
          {voiding ? (
            <Button variant="destructive" className="cursor-pointer" disabled={busy || reason.trim().length < 2} onClick={() => void doVoid()}>
              {busy ? <Loader2 className="animate-spin" /> : <Ban />} ยืนยันยกเลิกบิล
            </Button>
          ) : (
            <Button className="cursor-pointer" onClick={() => window.print()} disabled={!sale}>
              <Printer /> พิมพ์ซ้ำ
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
