import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Field, LocationSelect, TableWrap } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { useApp } from '@/lib/app-context'
import { useAuth } from '@/lib/auth'
import { baht, qty } from '@/lib/format'
import {
  PRODUCT_FIELDS,
  SUPPLIER_FIELDS,
  UnsupportedFileError,
  autoMap,
  convertRows,
  downloadTemplate,
  readGrid,
  splitHeader,
  type ConvertedRow,
  type FieldDef,
  type Grid,
} from '@/lib/import-sheet'
import { newEvent } from '@/lib/terminal'
import { cn } from '@/lib/utils'

export type ImportKind = 'suppliers' | 'products'

type RowAction = 'create' | 'update' | 'skip' | 'error'

interface RowResult {
  row: number
  action: RowAction
  label: string
  messages: string[]
  sku?: string
  stockQty?: number
}

interface ImportResponse {
  dryRun: boolean
  summary: {
    create: number
    update: number
    skip: number
    error: number
    newSuppliers?: number
    newBrands?: number
    stockItems?: number
    stockTotal?: number
    stockValue?: number
  }
  docNo?: string | null
  rows: RowResult[]
}

const KIND: Record<ImportKind, { title: string; fields: FieldDef[]; template: string; endpoint: string }> = {
  suppliers: { title: 'นำเข้าผู้จำหน่าย', fields: SUPPLIER_FIELDS, template: 'แม่แบบ_ผู้จำหน่าย.xlsx', endpoint: '/import/suppliers' },
  products: { title: 'นำเข้าสินค้าและยอดยกมา', fields: PRODUCT_FIELDS, template: 'แม่แบบ_สินค้า.xlsx', endpoint: '/import/products' },
}

const ACTION_LABEL: Record<RowAction, string> = { create: 'เพิ่มใหม่', update: 'อัปเดต', skip: 'ข้าม', error: 'มีปัญหา' }
const ACTION_CLASS: Record<RowAction, string> = {
  create: 'bg-primary/10 text-primary',
  update: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  skip: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/10 text-destructive',
}

const NOT_USED = '__none__'

/** Body for `/import/*` from converted rows: products get their five prices as one array. */
function toPayloadRow(kind: ImportKind, v: ConvertedRow['values']): Record<string, unknown> {
  if (kind === 'suppliers') return { name: v['name'] ?? '', phone: v['phone'], note: v['note'] }
  const { price1, price2, price3, price4, price5, ...rest } = v
  return { ...rest, name: v['name'] ?? '', prices: [price1, price2, price3, price4, price5] }
}

type Step = 'upload' | 'map' | 'review' | 'done'

export function ImportDialog({ kind, open, onClose, onDone }: { kind: ImportKind; open: boolean; onClose: () => void; onDone: () => void }) {
  const cfg = KIND[kind]
  const app = useApp()
  const canStock = useAuth().can('stock')
  const fileInput = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Grid>([])
  const [mapping, setMapping] = useState<Record<string, number>>({})
  const [locationId, setLocationId] = useState(app.locationId)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResponse | null>(null)
  const [filter, setFilter] = useState<'problems' | 'all'>('problems')

  const converted = useMemo(() => convertRows(cfg.fields, mapping, rows), [cfg.fields, mapping, rows])
  const hasStockColumn = kind === 'products' && (mapping['openingQty'] ?? -1) >= 0
  const missingRequired = cfg.fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0)

  const reset = () => {
    setStep('upload')
    setFileName('')
    setHeaders([])
    setRows([])
    setMapping({})
    setResult(null)
    setFilter('problems')
    if (fileInput.current) fileInput.current.value = ''
  }
  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const { headers: h, rows: r } = splitHeader(await readGrid(file))
      if (h.length === 0 || r.length === 0) throw new UnsupportedFileError('ไม่พบข้อมูลในไฟล์ — แถวแรกต้องเป็นหัวคอลัมน์')
      if (r.length > 3000) throw new UnsupportedFileError(`ไฟล์มี ${r.length} แถว — นำเข้าได้ครั้งละไม่เกิน 3000 แถว กรุณาแบ่งไฟล์`)
      setFileName(file.name)
      setHeaders(h)
      setRows(r)
      setMapping(autoMap(cfg.fields, h))
      setStep('map')
    } catch (err) {
      toast.error(err instanceof UnsupportedFileError ? err.message : `อ่านไฟล์ไม่ได้: ${errorMessage(err)}`)
      if (fileInput.current) fileInput.current.value = ''
    } finally {
      setBusy(false)
    }
  }

  const send = async (dryRun: boolean) => {
    // Rows with unreadable cells (e.g. a price of "abc") are never sent; they show as errors.
    const sentIdx = converted.flatMap((r, i) => (r.problems.length === 0 ? [i] : []))
    const localErrors: RowResult[] = converted.flatMap((r, i) =>
      r.problems.length > 0 ? [{ row: i, action: 'error' as const, label: String(r.values['name'] ?? ''), messages: r.problems }] : [],
    )
    if (sentIdx.length === 0) {
      setResult({ dryRun, summary: { create: 0, update: 0, skip: 0, error: localErrors.length }, rows: localErrors })
      setStep('review')
      return
    }
    setBusy(true)
    try {
      const res = await apiFetch<ImportResponse>(cfg.endpoint, {
        method: 'POST',
        body: {
          dryRun,
          rows: sentIdx.map((i) => toPayloadRow(kind, converted[i]?.values ?? {})),
          ...(kind === 'products' ? { ...newEvent(), locationId: hasStockColumn ? locationId || null : null } : {}),
        },
      })
      res.rows = [...res.rows.map((r) => ({ ...r, row: sentIdx[r.row] ?? r.row })), ...localErrors].sort((a, b) => a.row - b.row)
      res.summary = { ...res.summary, error: res.summary.error + localErrors.length }
      setResult(res)
      if (dryRun) {
        setStep('review')
      } else {
        setStep('done')
        toast.success('นำเข้าข้อมูลแล้ว')
        onDone()
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const s = result?.summary
  const toWrite = s ? s.create + s.update : 0
  const shownRows = (result?.rows ?? []).filter((r) => filter === 'all' || r.action === 'error' || r.messages.length > 0)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" /> {cfg.title}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'ใช้ไฟล์ Excel (.xlsx) หรือ CSV ที่ส่งออกจากโปรแกรมเดิมได้เลย ระบบจะจับคู่คอลัมน์ให้'}
            {step === 'map' && `${fileName} · ${rows.length} แถว — ตรวจว่าแต่ละช่องตรงกับคอลัมน์ในไฟล์`}
            {step === 'review' && 'ตรวจผลก่อนบันทึก — ยังไม่มีข้อมูลใดถูกบันทึก'}
            {step === 'done' && 'บันทึกเรียบร้อย'}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' ? (
          <div className="grid gap-4">
            <div className="grid gap-2 rounded-lg border p-4 text-sm">
              <p className="font-medium">1. เตรียมไฟล์</p>
              <p className="text-muted-foreground">
                ใช้ไฟล์จากโปรแกรมเดิมได้เลย หรือดาวน์โหลดแม่แบบแล้ววางข้อมูลลงไป
                {kind === 'products' ? ' — ใส่จำนวนคงเหลือและต้นทุนเพื่อยกยอดสต็อกมาพร้อมกัน' : ''}
              </p>
              <Button variant="outline" className="cursor-pointer justify-self-start" onClick={() => void downloadTemplate(cfg.fields, cfg.template)}>
                <Download /> ดาวน์โหลดแม่แบบ
              </Button>
            </div>
            <div className="grid gap-2 rounded-lg border p-4 text-sm">
              <p className="font-medium">2. เลือกไฟล์</p>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.csv,.txt"
                className="hidden"
                onChange={(e) => void pickFile(e.target.files?.[0])}
              />
              <Button className="cursor-pointer justify-self-start" disabled={busy} onClick={() => fileInput.current?.click()}>
                {busy ? <Loader2 className="animate-spin" /> : <Upload />} เลือกไฟล์ .xlsx / .csv
              </Button>
              <p className="text-xs text-muted-foreground">ไฟล์ .xls รุ่นเก่า ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx ก่อน</p>
            </div>
          </div>
        ) : null}

        {step === 'map' ? (
          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {cfg.fields.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
                  <Select
                    value={String(mapping[f.key] ?? -1) === '-1' ? NOT_USED : String(mapping[f.key])}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === NOT_USED ? -1 : Number(v) }))}
                  >
                    <SelectTrigger className={cn('w-full cursor-pointer', (mapping[f.key] ?? -1) < 0 && 'text-muted-foreground')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOT_USED}>— ไม่ใช้ —</SelectItem>
                      {headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)} disabled={!h}>
                          {h || `(คอลัมน์ ${i + 1} ไม่มีหัว)`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ))}
            </div>

            {hasStockColumn ? (
              <div className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium">ลงยอดยกมาที่สาขา/โซน</p>
                <LocationSelect value={locationId} onChange={setLocationId} />
                <p className="text-xs text-muted-foreground">
                  บันทึกเป็นเอกสารปรับยอด "ยอดยกมา" ใช้ต้นทุนในไฟล์เป็นต้นทุนเฉลี่ย สินค้าที่มีสต็อกในระบบแล้วจะข้ามยอดยกมาเพื่อไม่ให้นับซ้ำ
                </p>
                {!canStock ? <p className="text-xs text-destructive">บัญชีนี้ไม่มีสิทธิ์สต็อก — ตั้ง "จำนวนคงเหลือ" เป็น "ไม่ใช้" หรือให้ผู้มีสิทธิ์นำเข้า</p> : null}
              </div>
            ) : null}

            <div className="grid gap-1">
              <p className="text-sm font-medium">ตัวอย่าง 3 แถวแรก</p>
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {cfg.fields
                        .filter((f) => (mapping[f.key] ?? -1) >= 0)
                        .map((f) => (
                          <TableHead key={f.key} className="whitespace-nowrap">
                            {f.label}
                          </TableHead>
                        ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {converted.slice(0, 3).map((r, i) => (
                      <TableRow key={i}>
                        {cfg.fields
                          .filter((f) => (mapping[f.key] ?? -1) >= 0)
                          .map((f) => {
                            const v = r.values[f.key]
                            return (
                              <TableCell key={f.key} className="whitespace-nowrap">
                                {v === null || v === undefined ? <span className="text-muted-foreground">-</span> : typeof v === 'boolean' ? (v ? 'ใช่' : 'ไม่') : String(v)}
                              </TableCell>
                            )
                          })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            </div>
          </div>
        ) : null}

        {(step === 'review' || step === 'done') && s ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['create', 'update', 'skip', 'error'] as const).map((a) => (
                <div key={a} className={cn('rounded-lg p-3', ACTION_CLASS[a])}>
                  <p className="text-xs">{ACTION_LABEL[a]}</p>
                  <p className="tabular text-xl font-semibold">{s[a]}</p>
                </div>
              ))}
            </div>
            {kind === 'products' && ((s.newSuppliers ?? 0) > 0 || (s.newBrands ?? 0) > 0 || (s.stockItems ?? 0) > 0) ? (
              <ul className="grid gap-1 rounded-lg border p-3 text-sm">
                {(s.newSuppliers ?? 0) > 0 ? <li>ผู้จำหน่ายใหม่ {s.newSuppliers} ราย</li> : null}
                {(s.newBrands ?? 0) > 0 ? <li>แบรนด์ใหม่ {s.newBrands} แบรนด์</li> : null}
                {(s.stockItems ?? 0) > 0 ? (
                  <li>
                    ยอดยกมา {s.stockItems} รายการ รวม {qty(s.stockTotal ?? 0)} หน่วย มูลค่าทุน {baht(s.stockValue ?? 0)} ที่ {app.locationName(locationId)}
                    {result?.docNo ? ` — เอกสาร ${result.docNo}` : ''}
                  </li>
                ) : null}
              </ul>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">รายละเอียด</p>
              <Select value={filter} onValueChange={(v) => setFilter(v === 'all' ? 'all' : 'problems')}>
                <SelectTrigger className="w-44 cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="problems">เฉพาะที่มีหมายเหตุ</SelectItem>
                  <SelectItem value="all">ทุกแถว</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {shownRows.length === 0 ? (
              <p className="flex items-center gap-2 rounded-lg border p-3 text-sm text-primary">
                <CheckCircle2 className="size-4" /> ทุกแถวพร้อมนำเข้า ไม่มีหมายเหตุ
              </p>
            ) : (
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">ลำดับ</TableHead>
                      <TableHead>รายการ</TableHead>
                      <TableHead>ผล</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownRows.slice(0, 300).map((r) => (
                      <TableRow key={r.row}>
                        <TableCell className="tabular text-muted-foreground">{r.row + 1}</TableCell>
                        <TableCell>
                          <p className="font-medium">{r.label || '-'}</p>
                          {r.sku ? <p className="text-xs text-muted-foreground">{r.sku}</p> : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={cn('mb-1 font-normal', ACTION_CLASS[r.action])}>
                            {ACTION_LABEL[r.action]}
                            {r.stockQty ? ` · ยกมา ${qty(r.stockQty)}` : ''}
                          </Badge>
                          {r.messages.map((m, i) => (
                            <p key={i} className={cn('text-xs', r.action === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                              {m}
                            </p>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            )}
            {shownRows.length > 300 ? <p className="text-xs text-muted-foreground">แสดง 300 แถวแรกจาก {shownRows.length}</p> : null}
            {step === 'review' && s.error > 0 ? (
              <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> แถวที่มีปัญหาจะถูกข้าม แก้ไขในไฟล์แล้วนำเข้าใหม่ได้ภายหลัง (แถวที่นำเข้าแล้วจะอัปเดต ไม่ซ้ำ)
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          {step === 'map' ? (
            <>
              <Button variant="outline" className="cursor-pointer" disabled={busy} onClick={reset}>
                เลือกไฟล์ใหม่
              </Button>
              <Button
                className="cursor-pointer"
                disabled={busy || missingRequired.length > 0 || (hasStockColumn && (!locationId || !canStock))}
                onClick={() => void send(true)}
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                {missingRequired.length > 0 ? `เลือกคอลัมน์ ${missingRequired.map((f) => f.label).join(', ')}` : 'ตรวจสอบข้อมูล'}
              </Button>
            </>
          ) : null}
          {step === 'review' ? (
            <>
              <Button variant="outline" className="cursor-pointer" disabled={busy} onClick={() => setStep('map')}>
                ย้อนกลับ
              </Button>
              <Button className="cursor-pointer" disabled={busy || toWrite === 0} onClick={() => void send(false)}>
                {busy ? <Loader2 className="animate-spin" /> : null} นำเข้า {toWrite} รายการ
              </Button>
            </>
          ) : null}
          {step === 'done' ? (
            <Button className="cursor-pointer" onClick={close}>
              เสร็จสิ้น
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
