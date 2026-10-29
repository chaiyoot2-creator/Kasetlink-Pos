import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, DatabaseBackup, HardDrive, Loader2, PlugZap, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/common'
import { apiFetch, errorMessage } from '@/lib/api'
import { dateTime } from '@/lib/format'

type Frequency = 'hourly' | 'every6h' | 'daily'

interface BackupView {
  enabled: boolean
  frequency: Frequency
  runHour: number
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | null
  lastMessage: string | null
  lastFile: string | null
  lastBytes: number | null
  lastTrigger: string | null
  running: boolean
  /** rclone remote configured on the server, e.g. gdrive:KasetLink-POS-Backup (null = not set up). */
  remote: string | null
  keepDays: number
}

const FREQ_LABEL: Record<Frequency, string> = { hourly: 'ทุกชั่วโมง', every6h: 'ทุก 6 ชั่วโมง', daily: 'วันละครั้ง' }
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`

function scheduleText(f: Frequency, hour: number): string {
  if (f === 'hourly') return 'ทุกชั่วโมง'
  if (f === 'every6h') {
    const first = hour % 6
    return `เวลา ${[0, 6, 12, 18].map((o) => hh(first + o)).join(', ')} น.`
  }
  return `ทุกวัน เวลา ${hh(hour)} น.`
}

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function BackupSettings() {
  const [data, setData] = useState<BackupView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [frequency, setFrequency] = useState<Frequency>('daily')
  const [runHour, setRunHour] = useState(2)
  const [busy, setBusy] = useState<'' | 'save' | 'test' | 'run'>('')
  const [waiting, setWaiting] = useState(false)
  const poll = useRef<number | null>(null)

  const apply = (v: BackupView) => {
    setData(v)
    setEnabled(v.enabled)
    setFrequency(v.frequency)
    setRunHour(v.runHour)
  }

  useEffect(() => {
    apiFetch<BackupView>('/backup')
      .then(apply)
      .catch((err: unknown) => toast.error(errorMessage(err)))
    return () => {
      if (poll.current) window.clearInterval(poll.current)
    }
  }, [])

  const dirty = !!data && (enabled !== data.enabled || frequency !== data.frequency || runHour !== data.runHour)

  const save = async () => {
    setBusy('save')
    try {
      apply(await apiFetch<BackupView>('/backup', { method: 'PUT', body: { enabled, frequency, runHour } }))
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
      const res = await apiFetch<{ name: string }>('/backup/test', { method: 'POST' })
      toast.success(`เชื่อมต่อ Google Drive สำเร็จ: ${res.name}`)
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="size-5" /> สำรองข้อมูลไป Google Drive
        </CardTitle>
        <CardDescription>
          สำรองฐานข้อมูลทั้งร้าน (สินค้า ลูกค้า บิลขาย สต็อก ลูกหนี้ ฯลฯ) เป็นไฟล์ .dump แล้วอัปโหลดไปเก็บใน Google Drive ของร้าน
          เก็บไฟล์ย้อนหลังไว้หลายวัน ใช้กู้คืนทั้งฐานข้อมูลได้
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
                    {data.lastBytes !== null ? <span className="text-muted-foreground"> · {fileSize(data.lastBytes)}</span> : null}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">ยังไม่เคยสำรองข้อมูล</span>
              )}
              {data.enabled ? (
                <Badge variant="secondary" className="ml-auto">
                  อัตโนมัติ: {scheduleText(data.frequency, data.runHour)}
                </Badge>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
              <HardDrive className="size-4 text-muted-foreground" />
              {data.remote ? (
                <span>
                  ปลายทาง: <code className="rounded bg-muted px-1 font-mono text-xs">{data.remote}</code> · เก็บย้อนหลัง {data.keepDays} วัน
                </span>
              ) : (
                <span className="text-amber-700">
                  เซิร์ฟเวอร์ยังไม่ได้เชื่อม Google Drive — ผู้ดูแลระบบต้องตั้งค่า rclone และ RCLONE_REMOTE บน VPS ก่อน (ดู README)
                  ระหว่างนี้ไฟล์สำรองจะเก็บไว้บน VPS เท่านั้น
                </span>
              )}
            </div>

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
              <Button className="cursor-pointer" disabled={!dirty || busy !== ''} onClick={() => void save()}>
                {busy === 'save' ? <Loader2 className="animate-spin" /> : null} บันทึก
              </Button>
              <Button variant="outline" className="cursor-pointer" disabled={!data.remote || busy !== ''} onClick={() => void test()}>
                {busy === 'test' ? <Loader2 className="animate-spin" /> : <PlugZap />} ทดสอบการเชื่อมต่อ
              </Button>
              <Button variant="outline" className="cursor-pointer" disabled={busy !== '' || waiting} onClick={() => void runNow()}>
                {busy === 'run' || waiting ? <Loader2 className="animate-spin" /> : <DatabaseBackup />} สำรองเดี๋ยวนี้
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              การสำรองอัตโนมัติทำงานบนเซิร์ฟเวอร์ ไม่ต้องเปิดหน้านี้ค้างไว้ · กู้คืนด้วยคำสั่ง pg_restore (ดู README)
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
