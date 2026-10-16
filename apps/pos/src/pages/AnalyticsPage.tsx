import { useState } from 'react'
import { Activity, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Empty, ErrorBox, Loading, PageHeader, Stat, TableWrap } from '@/components/common'
import { NAV } from '@/components/AppShell'
import { addDaysISO, dateOnly, dateTime, pct, todayISO } from '@/lib/format'
import type { UsageSummary } from '@/lib/types'
import { useApi } from '@/lib/use-api'

type Preset = 'today' | '7d' | '30d' | 'custom'

const PRESETS: { key: Exclude<Preset, 'custom'>; label: string; days: number }[] = [
  { key: 'today', label: 'วันนี้', days: 0 },
  { key: '7d', label: '7 วันล่าสุด', days: 6 },
  { key: '30d', label: '30 วันล่าสุด', days: 29 },
]

const num = new Intl.NumberFormat('th-TH')

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} วินาที`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที ${seconds % 60} วินาที`
}

function pageLabel(page: string): string {
  return NAV.find((n) => n.route === page)?.label ?? page
}

/** App usage (not sales): visits, users, sessions and POS actions. Owner / manager only. */
export function AnalyticsPage() {
  const [preset, setPreset] = useState<Preset>('7d')
  const [to, setTo] = useState(todayISO())
  const [from, setFrom] = useState(addDaysISO(todayISO(), -6))
  const summary = useApi<UsageSummary>(from && to && from <= to ? `/analytics/summary?from=${from}&to=${to}` : null)
  const d = summary.data
  const t = d?.totals
  const empty = t !== undefined && t.visits + t.pageViews + t.sessions + t.salesStarted + t.salesCompleted === 0
  const maxViews = d ? Math.max(1, ...d.pages.map((p) => p.views)) : 1

  const pick = (p: (typeof PRESETS)[number]) => {
    const today = todayISO()
    setPreset(p.key)
    setTo(today)
    setFrom(addDaysISO(today, -p.days))
  }

  return (
    <div>
      <PageHeader title="สถิติการใช้งาน" subtitle="การเข้าใช้แอป แยกจากข้อมูลการขาย · วันและเวลาเป็นเวลาไทย (Asia/Bangkok)" />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} variant={preset === p.key ? 'default' : 'outline'} size="sm" className="cursor-pointer" onClick={() => pick(p)}>
            {p.label}
          </Button>
        ))}
        <Button variant={preset === 'custom' ? 'default' : 'outline'} size="sm" className="cursor-pointer" onClick={() => setPreset('custom')}>
          กำหนดเอง
        </Button>
        {preset === 'custom' ? (
          <>
            <label className="grid gap-1 text-sm">
              ตั้งแต่
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </label>
            <label className="grid gap-1 text-sm">
              ถึง
              <Input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </label>
          </>
        ) : (
          <p className="pb-1.5 text-sm text-muted-foreground">
            {from === to ? dateOnly(from) : `${dateOnly(from)} – ${dateOnly(to)}`}
          </p>
        )}
      </div>

      {summary.error ? <ErrorBox message={summary.error} onRetry={() => void summary.reload()} /> : null}
      {summary.loading && !d ? <Loading /> : null}

      {d && t && empty ? (
        <Empty
          icon={<Activity className="size-8" />}
          title="ยังไม่มีข้อมูลการใช้งานในช่วงนี้"
          hint="ระบบเริ่มเก็บสถิติตั้งแต่เปิดใช้ฟีเจอร์นี้ ข้อมูลจะขึ้นเมื่อมีคนเปิดใช้แอป"
        />
      ) : null}

      {d && t && !empty ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="การเข้าใช้" value={num.format(t.visits)} sub="เปิดแอป · รีเฟรชหน้าไม่นับซ้ำ" />
            <Stat
              label="ผู้ใช้ไม่ซ้ำ (โดยประมาณ)"
              value={num.format(t.uniqueUsers)}
              sub={`ล็อกอิน ${num.format(t.signedInUsers)} บัญชี · ไม่ได้ล็อกอิน ~${num.format(t.anonymousBrowsers)} เบราว์เซอร์`}
            />
            <Stat label="เซสชัน" value={num.format(t.sessions)} sub="ไม่ได้ใช้งานเกิน 30 นาที = เซสชันใหม่" />
            <Stat label="เวลาเฉลี่ยต่อเซสชัน" value={duration(t.avgSessionSeconds)} />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="เปิดดูหน้า" value={num.format(t.pageViews)} />
            <Stat label="เปิดหน้าขายสินค้า" value={num.format(t.posOpened)} />
            <Stat label="เริ่มขาย" value={num.format(t.salesStarted)} sub="ใส่สินค้าชิ้นแรกลงตะกร้า" />
            <Stat
              label="ขายสำเร็จ"
              value={num.format(t.salesCompleted)}
              tone="good"
              sub={t.salesStarted > 0 ? `${pct(Math.round((t.salesCompleted / t.salesStarted) * 1000) / 10)} ของการเริ่มขาย` : undefined}
            />
          </div>

          <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              ผู้ใช้ที่ล็อกอินนับจากบัญชีพนักงานจริง ส่วนผู้ที่ไม่ได้ล็อกอินเป็น<strong className="font-medium text-foreground">ค่าประมาณ</strong>
              จากรหัสสุ่มของเบราว์เซอร์ (คนเดียวใช้หลายเครื่อง หรือล้างข้อมูลเบราว์เซอร์ จะนับเป็นหลายคน) ไม่เก็บ IP ชื่อลูกค้า สินค้า หรือยอดเงินในสถิตินี้
              {d.lastEventAt ? ` · ข้อมูลล่าสุด ${dateTime(d.lastEventAt)}` : ''}
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="grid content-start gap-2">
              <h2 className="text-sm font-semibold">รายวัน</h2>
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>วันที่</TableHead>
                      <TableHead className="text-right">เข้าใช้</TableHead>
                      <TableHead className="text-right">ผู้ใช้</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">เซสชัน</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">เปิดหน้า</TableHead>
                      <TableHead className="text-right">ขายสำเร็จ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.days.map((day) => (
                      <TableRow key={day.day}>
                        <TableCell>{dateOnly(day.day)}</TableCell>
                        <TableCell className="tabular text-right">{num.format(day.visits)}</TableCell>
                        <TableCell className="tabular text-right">{num.format(day.users)}</TableCell>
                        <TableCell className="tabular hidden text-right sm:table-cell">{num.format(day.sessions)}</TableCell>
                        <TableCell className="tabular hidden text-right sm:table-cell">{num.format(day.pageViews)}</TableCell>
                        <TableCell className="tabular text-right">{num.format(day.salesCompleted)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            </section>

            <section className="grid content-start gap-2">
              <h2 className="text-sm font-semibold">หน้าที่เปิดดู</h2>
              {d.pages.length === 0 ? (
                <Empty title="ยังไม่มีการเปิดดูหน้าในช่วงนี้" />
              ) : (
                <TableWrap>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>หน้า</TableHead>
                        <TableHead className="w-24 text-right">ครั้ง</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.pages.map((p) => (
                        <TableRow key={p.page}>
                          <TableCell>
                            <p>{pageLabel(p.page)}</p>
                            <div className="mt-1 h-1.5 rounded-full bg-muted">
                              <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(p.views / maxViews) * 100}%` }} />
                            </div>
                          </TableCell>
                          <TableCell className="tabular text-right">{num.format(p.views)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrap>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  )
}
