import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Copy, DatabaseBackup, ExternalLink, Loader2, PlugZap, RefreshCw, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { dateTime } from '@/lib/format'

type Frequency = 'hourly' | 'every6h' | 'daily'

interface BackupView {
  webAppUrl: string | null
  enabled: boolean
  frequency: Frequency
  runHour: number
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | null
  lastMessage: string | null
  lastRows: number | null
  lastTrigger: string | null
  running: boolean
  script: string
}

const FREQ_LABEL: Record<Frequency, string> = { hourly: 'ทุกชั่วโมง', every6h: 'ทุก 6 ชั่วโมง', daily: 'วันละครั้ง' }
const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/
const hh = (h: number) => `${String(h).padStart(2, '0')}:05`

function scheduleText(f: Frequency, hour: number): string {
  if (f === 'hourly') return 'ทุกชั่วโมง ที่นาทีที่ 5'
  if (f === 'every6h') {
    const first = hour % 6
    return `เวลา ${[0, 6, 12, 18].map((o) => hh(first + o)).join(', ')} น.`
  }
  return `ทุกวัน เวลา ${hh(hour)} น.`
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`คัดลอก${label}แล้ว`)
  } catch {
    toast.error('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C แทน')
  }
}

export function BackupSettings() {
  const [data, setData] = useState<BackupView | null>(null)
  const [url, setUrl] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [frequency, setFrequency] = useState<Frequency>('daily')
  const [runHour, setRunHour] = useState(23)
  const [busy, setBusy] = useState<'' | 'save' | 'test' | 'run' | 'secret'>('')
  const [waiting, setWaiting] = useState(false)
  const [showScript, setShowScript] = useState(false)
  const poll = useRef<number | null>(null)

  const apply = (v: BackupView) => {
    setData(v)
    setUrl(v.webAppUrl ?? '')
    setEnabled(v.enabled)
    setFrequency(v.frequency)
    setRunHour(v.runHour)
  }

  useEffect(() => {
    apiFetch<BackupView>('/backup')
      .then((v) => {
        apply(v)
        if (!v.webAppUrl) setShowScript(true)
      })
      .catch((err: unknown) => toast.error(errorMessage(err)))
    return () => {
      if (poll.current) window.clearInterval(poll.current)
    }
  }, [])

  const dirty =
    !!data && (url.trim() !== (data.webAppUrl ?? '') || enabled !== data.enabled || frequency !== data.frequency || runHour !== data.runHour)
  const urlValid = url.trim() === '' || URL_RE.test(url.trim())

  const save = async () => {
    setBusy('save')
    try {
      apply(await apiFetch<BackupView>('/backup', { method: 'PUT', body: { webAppUrl: url.trim() || null, enabled, frequency, runHour } }))
      toast.success('บันทึกการตั้งค่าสำรองข้อมูลแล้ว')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy('')
    }
  }

  const test = async () => {
    setBusy('test')
    try {
      if (dirty) await save()
      const res = await apiFetch<{ name: string }>('/backup/test', { method: 'POST' })
      toast.success(`เชื่อมต่อสำเร็จ: ${res.name}`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy('')
    }
  }

  const runNow = async () => {
    setBusy('run')
    try {
      if (dirty) await save()
      const res = await apiFetch<{ started: boolean; previousRunAt: string | null }>('/backup/run', { method: 'POST' })
      setWaiting(true)
      toast.info(res.started ? 'เริ่มสำรองข้อมูลแล้ว อาจใช้เวลาสักครู่' : 'กำลังสำรองข้อมูลอยู่แล้ว')
      const started = Date.now()
      if (poll.current) window.clearInterval(poll.current)
      poll.current = window.setInterval(() => {
        void apiFetch<BackupView>('/backup').then((v) => {
          const finished = v.lastRunAt !== res.previousRunAt
          if (finished || Date.now() - started > 10 * 60_000) {
            if (poll.current) window.clearInterval(poll.current)
            poll.current = null
            setWaiting(false)
            setData(v)
            if (finished) {
              if (v.lastStatus === 'ok') toast.success(v.lastMessage ?? 'สำรองข้อมูลสำเร็จ')
              else toast.error(v.lastMessage ?? 'สำรองข้อมูลไม่สำเร็จ')
            }
          }
        })
      }, 3000)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy('')
    }
  }

  const rotate = async () => {
    if (!window.confirm('สร้างรหัสลับใหม่? หลังจากนี้ต้องวางโค้ด Apps Script ใหม่และ Deploy เวอร์ชันใหม่ ไม่เช่นนั้นการสำรองจะล้มเหลว')) return
    setBusy('secret')
    try {
      const v = await apiFetch<BackupView>('/backup/secret', { method: 'POST' })
      setData(v)
      setShowScript(true)
      toast.success('สร้างรหัสลับใหม่แล้ว — คัดลอกโค้ดไปวางใน Apps Script อีกครั้ง')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy('')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="size-5" /> สำรองข้อมูลไป Google Sheet
        </CardTitle>
        <CardDescription>
          คัดลอกข้อมูลทั้งหมดของร้าน (สินค้า ลูกค้า บิลขาย สต็อก ลูกหนี้ ฯลฯ) ไปเก็บใน Google Sheet ของคุณเอง แยกแท็บตามตาราง
          ทุกครั้งที่สำรองจะเขียนทับด้วยข้อมูลล่าสุด
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!data ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              {waiting || data.running ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> กำลังสำรองข้อมูล…
                </>
              ) : data.lastRunAt ? (
                <>
                  {data.lastStatus === 'ok' ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )}
                  <span>
                    สำรองล่าสุด {dateTime(data.lastRunAt)} ({data.lastTrigger === 'manual' ? 'กดเอง' : 'ตั้งเวลา'}) —{' '}
                    <span className={data.lastStatus === 'ok' ? '' : 'text-destructive'}>{data.lastMessage}</span>
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">ยังไม่เคยสำรองข้อมูล</span>
              )}
              {data.enabled && data.webAppUrl ? (
                <Badge variant="secondary" className="ml-auto">
                  อัตโนมัติ: {scheduleText(data.frequency, data.runHour)}
                </Badge>
              ) : null}
            </div>

            <details open={showScript} onToggle={(e) => setShowScript(e.currentTarget.open)} className="rounded-lg border p-3">
              <summary className="cursor-pointer font-medium">วิธีเชื่อมต่อ (ทำครั้งเดียว ประมาณ 5 นาที)</summary>
              <ol className="mt-3 grid list-decimal gap-2 pl-5 text-sm">
                <li>
                  สร้าง Google Sheet ใหม่ (ล็อกอินบัญชี Google ของร้าน){' '}
                  <a href="https://sheets.new" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                    เปิด sheets.new <ExternalLink className="size-3" />
                  </a>
                </li>
                <li>
                  ในชีต ไปที่เมนู <b>ส่วนขยาย → Apps Script</b> ลบโค้ดเดิมทั้งหมด แล้ววางโค้ดด้านล่าง กดบันทึก (ไอคอนแผ่นดิสก์)
                </li>
                <li>
                  กด <b>ทำให้ใช้งานได้ (Deploy) → การทำให้ใช้งานได้รายการใหม่ (New deployment)</b> → รูปเฟือง เลือก <b>เว็บแอป (Web app)</b>
                  <br />
                  ตั้ง “เรียกใช้ในฐานะ” = <b>ฉัน (Me)</b> และ “ผู้ที่มีสิทธิ์เข้าถึง” = <b>ทุกคน (Anyone)</b> → กด Deploy → อนุญาตสิทธิ์ (Authorize
                  access) ด้วยบัญชีของร้าน
                </li>
                <li>
                  คัดลอก <b>URL ของเว็บแอป</b> (ลงท้ายด้วย /exec) มาวางในช่องด้านล่าง แล้วกด <b>ทดสอบการเชื่อมต่อ</b>
                </li>
              </ol>
              <div className="mt-3 grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">โค้ด Apps Script (มีรหัสลับของร้านอยู่ในโค้ด — อย่าแชร์ให้คนอื่น)</span>
                  <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void copy(data.script, 'โค้ด')}>
                    <Copy /> คัดลอกโค้ด
                  </Button>
                </div>
                <Textarea readOnly value={data.script} className="h-40 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              </div>
            </details>

            <Field label="URL ของเว็บแอป (Web app URL)">
              <Input
                value={url}
                placeholder="https://script.google.com/macros/s/…/exec"
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={!urlValid}
              />
              {!urlValid ? <p className="text-xs text-destructive">ลิงก์ต้องขึ้นต้นด้วย https://script.google.com/macros/s/ และลงท้ายด้วย /exec</p> : null}
            </Field>

            <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
              <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
                <Switch checked={enabled} onCheckedChange={setEnabled} /> สำรองอัตโนมัติ
              </label>
              <Field label="ความถี่">
                <Select
                  value={frequency}
                  onValueChange={(v) => setFrequency(v === 'hourly' || v === 'every6h' ? v : 'daily')}
                  disabled={!enabled}
                >
                  <SelectTrigger className="w-full cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FREQ_LABEL) as Frequency[]).map((f) => (
                      <SelectItem key={f} value={f}>
                        {FREQ_LABEL[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {frequency !== 'hourly' ? (
                <Field label={frequency === 'daily' ? 'เวลา' : 'เริ่มรอบเวลา'}>
                  <Select value={String(runHour)} onValueChange={(v) => setRunHour(Number(v))} disabled={!enabled}>
                    <SelectTrigger className="w-full cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: frequency === 'daily' ? 24 : 6 }, (_, h) => (
                        <SelectItem key={h} value={String(h)}>
                          {frequency === 'daily' ? `${hh(h)} น.` : scheduleText('every6h', h)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <div />
              )}
            </div>
            {enabled ? <p className="-mt-2 text-xs text-muted-foreground">จะสำรอง{scheduleText(frequency, runHour)} (เวลาไทย)</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button className="cursor-pointer" disabled={!dirty || !urlValid || busy !== ''} onClick={() => void save()}>
                {busy === 'save' ? <Loader2 className="animate-spin" /> : null} บันทึก
              </Button>
              <Button variant="outline" className="cursor-pointer" disabled={!url.trim() || !urlValid || busy !== ''} onClick={() => void test()}>
                {busy === 'test' ? <Loader2 className="animate-spin" /> : <PlugZap />} ทดสอบการเชื่อมต่อ
              </Button>
              <Button
                variant="outline"
                className="cursor-pointer"
                disabled={!url.trim() || !urlValid || busy !== '' || waiting}
                onClick={() => void runNow()}
              >
                {busy === 'run' || waiting ? <Loader2 className="animate-spin" /> : <DatabaseBackup />} สำรองเดี๋ยวนี้
              </Button>
              <Button variant="ghost" className="ml-auto cursor-pointer" disabled={busy !== ''} onClick={() => void rotate()}>
                <RefreshCw /> สร้างรหัสลับใหม่
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              การสำรองอัตโนมัติทำงานบนเซิร์ฟเวอร์ ไม่ต้องเปิดหน้านี้ค้างไว้ · ถ้าแก้โค้ดใน Apps Script ภายหลัง ต้อง Deploy → จัดการการทำให้ใช้งานได้ →
              แก้ไข → เวอร์ชันใหม่ ลิงก์จึงจะใช้โค้ดใหม่
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
