import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCheck, Download, FileText, Loader2, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Empty, ErrorBox, Loading, PageHeader, Stat, TableWrap } from '@/components/common'
import { TaxInvoicePrint } from '@/components/TaxInvoice'
import { apiFetch, errorMessage } from '@/lib/api'
import { baht, dateOnly, dateTime, round2, todayISO } from '@/lib/format'
import { printSoon } from '@/lib/print'
import type { SaleDetail, SaleHeader } from '@/lib/types'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

function monthStart(iso: string): string {
  return `${iso.slice(0, 8)}01`
}

function csvCell(v: string | number): string {
  const text = String(v)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Accounting hand-off list as CSV (UTF-8 with BOM so Excel shows Thai correctly). */
function downloadCsv(rows: SaleHeader[], from: string, to: string) {
  const header = [
    'ลำดับ',
    'วันที่',
    'เลขที่ใบเสร็จเต็มรูป',
    'เลขที่บิล',
    'ชื่อผู้ซื้อ',
    'เลขประจำตัวผู้เสียภาษี',
    'สาขา',
    'รวมทั้งสิ้น',
    'สถานะ',
    'ส่งบัญชีแล้ว',
  ]
  const lines = rows.map((s, i) => {
    const voided = s.status === 'voided'
    return [
      i + 1,
      s.soldAt.slice(0, 10),
      s.taxInvoiceNo ?? '',
      s.billNo,
      s.buyer?.name ?? s.customerName ?? '',
      s.buyer?.taxId ?? '',
      s.buyer?.taxId ? (s.buyer.branchCode && s.buyer.branchCode !== '00000' ? s.buyer.branchCode : 'สำนักงานใหญ่') : '',
      voided ? 0 : s.total.toFixed(2),
      voided ? 'ยกเลิก' : 'ปกติ',
      s.accountingSentAt ? s.accountingSentAt.slice(0, 10) : '',
    ]
      .map(csvCell)
      .join(',')
  })
  const blob = new Blob(['﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ส่งบัญชี_${from}_${to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function AccountingPage() {
  const [to, setTo] = useState(todayISO())
  const [from, setFrom] = useState(monthStart(todayISO()))
  const [status, setStatus] = useState<'pending' | 'sent' | 'all'>('pending')
  const list = useApi<SaleHeader[]>(`/accounting/invoices?from=${from}&to=${to}&status=${status}`)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [printDocs, setPrintDocs] = useState<SaleDetail[] | null>(null)
  const [busy, setBusy] = useState<'print' | 'mark' | null>(null)

  const rows = useMemo(() => list.data ?? [], [list.data])
  useEffect(() => setSelected(new Set()), [list.data])

  const chosen = rows.filter((r) => selected.has(r.id))
  const target = chosen.length > 0 ? chosen : rows
  const active = target.filter((r) => r.status !== 'voided')
  const sumTotal = round2(active.reduce((s, r) => s + r.total, 0))

  useEffect(() => {
    if (!printDocs) return
    printSoon()
    const done = () => setPrintDocs(null)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [printDocs])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const print = async () => {
    if (target.length === 0) return
    setBusy('print')
    try {
      const docs = await apiFetch<SaleDetail[]>(`/accounting/documents?ids=${target.map((r) => r.id).join(',')}`)
      setPrintDocs(docs)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const mark = async (sent: boolean) => {
    if (target.length === 0) return
    setBusy('mark')
    try {
      const res = await apiFetch<{ updated: number }>('/accounting/mark-sent', {
        method: 'POST',
        body: { saleIds: target.map((r) => r.id), sent },
      })
      toast.success(sent ? `บันทึกว่าส่งบัญชีแล้ว ${res.updated} ใบ` : `ย้ายกลับเป็นรอส่ง ${res.updated} ใบ`)
      void list.reload()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const scope = chosen.length > 0 ? `ที่เลือก ${chosen.length} ใบ` : `ทั้งหมด ${rows.length} ใบ`

  return (
    <div>
      <PageHeader
        title="ส่งบัญชี"
        subtitle="ใบเสร็จรับเงินเต็มรูปที่ต้องส่งสำนักงานบัญชี (สินค้าอาหารสัตว์ได้รับยกเว้น VAT)"
      />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          ตั้งแต่
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </label>
        <label className="grid gap-1 text-sm">
          ถึง
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </label>
        <div className="w-40">
          <Select value={status} onValueChange={(v) => setStatus(v === 'sent' || v === 'all' ? v : 'pending')}>
            <SelectTrigger className="w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">รอส่ง</SelectItem>
              <SelectItem value="sent">ส่งแล้ว</SelectItem>
              <SelectItem value="all">ทั้งหมด</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Stat label={`จำนวนใบ (${chosen.length > 0 ? 'ที่เลือก' : 'ทั้งหมด'})`} value={active.length} />
        <Stat label="ยอดรวม" value={baht(sumTotal)} />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button className="cursor-pointer" disabled={target.length === 0 || busy !== null} onClick={() => void print()}>
          {busy === 'print' ? <Loader2 className="animate-spin" /> : <FileText />} พิมพ์ / บันทึก PDF ({scope})
        </Button>
        <Button
          variant="outline"
          className="cursor-pointer"
          disabled={target.length === 0}
          onClick={() => downloadCsv(target, from, to)}
        >
          <Download /> ส่งออก Excel (CSV)
        </Button>
        {status !== 'sent' ? (
          <Button variant="outline" className="cursor-pointer" disabled={target.length === 0 || busy !== null} onClick={() => void mark(true)}>
            {busy === 'mark' ? <Loader2 className="animate-spin" /> : <CheckCheck />} ทำเครื่องหมายว่าส่งแล้ว
          </Button>
        ) : (
          <Button variant="outline" className="cursor-pointer" disabled={target.length === 0 || busy !== null} onClick={() => void mark(false)}>
            <Undo2 /> ย้ายกลับเป็นรอส่ง
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        เลือกบางใบด้วยช่องติ๊ก หรือไม่เลือกเลยเพื่อทำทั้งหมดในช่วงวันที่ · ในหน้าต่างพิมพ์เลือก “Save as PDF” เพื่อได้ไฟล์ส่งอีเมล · พิมพ์ต้นฉบับและสำเนาให้ทุกใบ
      </p>

      {list.error ? <ErrorBox message={list.error} onRetry={() => void list.reload()} /> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data?.length === 0 ? (
        <Empty title="ไม่มีใบเสร็จเต็มรูปในช่วงนี้" hint="ติ๊ก “ส่งบัญชี (ออกใบเสร็จเต็มรูป)” ตอนชำระเงิน หรือออกย้อนหลังจากหน้าบิลขาย" />
      ) : null}
      {rows.length > 0 ? (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="เลือกทั้งหมด"
                    className="size-4 cursor-pointer accent-primary"
                    checked={selected.size > 0 && selected.size === rows.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </TableHead>
                <TableHead>เลขที่ใบเสร็จ</TableHead>
                <TableHead className="hidden sm:table-cell">วันที่</TableHead>
                <TableHead>ผู้ซื้อ</TableHead>
                <TableHead className="text-right">ยอดรวม</TableHead>
                <TableHead className="hidden lg:table-cell">สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={cn(r.status === 'voided' && 'opacity-60')}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`เลือก ${r.taxInvoiceNo}`}
                      className="size-4 cursor-pointer accent-primary"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {r.taxInvoiceNo}
                    <p className="text-xs font-normal text-muted-foreground">บิล {r.billNo}</p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{dateOnly(r.soldAt)}</TableCell>
                  <TableCell>
                    {r.buyer?.name ?? r.customerName}
                    {r.buyer?.taxId ? <p className="text-xs text-muted-foreground">{r.buyer.taxId}</p> : null}
                  </TableCell>
                  <TableCell className={cn('tabular text-right', r.status === 'voided' && 'line-through')}>{baht(r.total)}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {r.status === 'voided' ? <Badge variant="destructive">ยกเลิก</Badge> : null}
                    {r.accountingSentAt ? (
                      <span className="text-xs text-muted-foreground">ส่งแล้ว {dateTime(r.accountingSentAt)}</span>
                    ) : (
                      <Badge variant="secondary">รอส่ง</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      ) : null}

      {printDocs ? <TaxInvoicePrint sales={printDocs} /> : null}
    </div>
  )
}
