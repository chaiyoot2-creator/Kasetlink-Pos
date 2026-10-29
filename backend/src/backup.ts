import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from './errors.js'
import { buildSystemCtx, query, shopOrgId, transaction, type RequestCtx, type Row } from './db.js'
import { bool, num, str, strOrNull } from './util.js'

/**
 * Backup to Google Drive: `pg_dump` (custom format, already compressed) into BACKUP_DIR,
 * then `rclone copy` to RCLONE_REMOTE (a Drive remote the owner set up once on the VPS
 * with `rclone config`). Old dumps are pruned locally and on Drive after BACKUP_KEEP_DAYS.
 * Restore: `pg_restore --clean --no-owner -d <db> <file>.dump`.
 */

export type Frequency = 'hourly' | 'every6h' | 'daily'

export interface BackupConfig {
  enabled: boolean
  frequency: Frequency
  runHour: number
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | null
  lastMessage: string | null
  lastFile: string | null
  lastBytes: number | null
  lastTrigger: string | null
}

export interface BackupEnv {
  remote: string | null
  localDir: string
  keepDays: number
}

export function backupEnv(): BackupEnv {
  return {
    remote: process.env.RCLONE_REMOTE?.trim() || null,
    localDir: process.env.BACKUP_DIR?.trim() || '/var/backups/kasetlink-pos',
    keepDays: Number(process.env.BACKUP_KEEP_DAYS) || 30,
  }
}

function mapConfig(r: Row): BackupConfig {
  const freq = str(r, 'frequency')
  const status = str(r, 'last_status')
  return {
    enabled: bool(r, 'enabled'),
    frequency: freq === 'hourly' || freq === 'every6h' ? freq : 'daily',
    runHour: num(r, 'run_hour'),
    lastRunAt: strOrNull(r, 'last_run_at'),
    lastStatus: status === 'ok' || status === 'error' ? status : null,
    lastMessage: strOrNull(r, 'last_message'),
    lastFile: strOrNull(r, 'last_file'),
    lastBytes: r.last_bytes === null || r.last_bytes === undefined ? null : num(r, 'last_bytes'),
    lastTrigger: strOrNull(r, 'last_trigger'),
  }
}

/** Current config; creates the row on first use. */
export async function loadBackupConfig(ctx: RequestCtx): Promise<BackupConfig> {
  const rows = await query(ctx, 'SELECT * FROM backup_config LIMIT 1')
  if (rows[0]) return mapConfig(rows[0])
  const [created] = await transaction(ctx, [
    {
      // `secret` is left over from the Google Sheet backup; the column is NOT NULL.
      sql: `INSERT INTO backup_config (secret, run_hour) VALUES ($1, 2)
            ON CONFLICT (org_id) DO UPDATE SET updated_at = backup_config.updated_at
            RETURNING *`,
      params: [randomBytes(16).toString('hex')],
    },
  ])
  const row = created?.[0]
  if (!row) throw new HttpError(500, 'สร้างการตั้งค่าสำรองข้อมูลไม่สำเร็จ')
  return mapConfig(row)
}

export async function saveBackupConfig(
  ctx: RequestCtx,
  input: { enabled: boolean; frequency: Frequency; runHour: number },
): Promise<BackupConfig> {
  await loadBackupConfig(ctx)
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE backup_config SET enabled = $1::boolean, frequency = $2, run_hour = $3::smallint, updated_at = now()
            RETURNING *`,
      params: [input.enabled, input.frequency, input.runHour],
    },
  ])
  const row = rows?.[0]
  if (!row) throw new HttpError(500, 'บันทึกการตั้งค่าไม่สำเร็จ')
  return mapConfig(row)
}

// ---------------------------------------------------------------- running tools

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env, timeoutMs = 30 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`เรียก ${cmd} ไม่ได้: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`${path.basename(cmd)} ล้มเหลว (code ${code}): ${(err || out).trim().slice(-400)}`))
    })
  })
}

const pgDumpBin = () => process.env.PG_DUMP_BIN?.trim() || 'pg_dump'
const rcloneBin = () => process.env.RCLONE_BIN?.trim() || 'rclone'

function bangkokStamp(now: Date): string {
  // 2026-10-30_0205 in Asia/Bangkok (UTC+7, no DST)
  const t = new Date(now.getTime() + 7 * 3600 * 1000).toISOString()
  return `${t.slice(0, 10)}_${t.slice(11, 13)}${t.slice(14, 16)}`
}

/** Check that the Drive remote is reachable; returns the remote path. */
export async function testRemote(): Promise<string> {
  const { remote } = backupEnv()
  if (!remote) throw new HttpError(400, 'ยังไม่ได้ตั้งค่า RCLONE_REMOTE บนเซิร์ฟเวอร์ (ดู README ขั้นตอน Google Drive)', 'remote_missing')
  try {
    await run(rcloneBin(), ['mkdir', remote], process.env, 60_000)
    await run(rcloneBin(), ['lsf', remote, '--max-depth', '1'], process.env, 60_000)
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : 'เชื่อมต่อ Google Drive ไม่สำเร็จ', 'remote_error')
  }
  return remote
}

async function pruneLocal(dir: string, keepDays: number): Promise<void> {
  const cutoff = Date.now() - keepDays * 86400_000
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.dump')) continue
    const file = path.join(dir, name)
    if ((await stat(file)).mtimeMs < cutoff) await rm(file, { force: true })
  }
}

async function record(ctx: RequestCtx, trigger: string, ok: boolean, message: string, file: string | null, bytes: number | null) {
  await loadBackupConfig(ctx)
  await transaction(ctx, [
    {
      sql: `UPDATE backup_config SET last_run_at = now(), last_status = $1, last_message = $2, last_file = $3,
              last_bytes = $4, last_trigger = $5, updated_at = now()`,
      params: [ok ? 'ok' : 'error', message.slice(0, 1000), file, bytes, trigger],
    },
  ])
}

/** Dump the database and upload it. Never throws: the outcome is stored in backup_config. */
export async function runBackup(ctx: RequestCtx, trigger: 'manual' | 'schedule'): Promise<{ ok: boolean; message: string }> {
  const env = backupEnv()
  const name = `kasetlink-pos_${bangkokStamp(new Date())}.dump`
  const file = path.join(env.localDir, name)
  try {
    const url = process.env.DATABASE_URL?.trim()
    if (!url) throw new Error('DATABASE_URL is not set')
    await mkdir(env.localDir, { recursive: true })
    // Tables use FORCE ROW LEVEL SECURITY, so the dump runs with the shop's org set.
    await run(pgDumpBin(), ['--format=custom', '--no-owner', '--enable-row-security', '--file', file, url], {
      ...process.env,
      PGOPTIONS: `-c app.org_id=${shopOrgId()}`,
    })
    const bytes = (await stat(file)).size
    let message = `สำรองข้อมูลในเครื่องแล้ว (${name})`
    if (env.remote) {
      await run(rcloneBin(), ['copy', file, env.remote])
      await run(rcloneBin(), ['delete', env.remote, '--min-age', `${env.keepDays}d`, '--include', '*.dump']).catch((e: unknown) =>
        console.warn('[backup] prune remote failed', e instanceof Error ? e.message : e),
      )
      message = `อัปโหลดขึ้น Google Drive แล้ว (${name})`
    } else {
      message += ' — ยังไม่ได้ตั้งค่า Google Drive (RCLONE_REMOTE)'
    }
    await pruneLocal(env.localDir, env.keepDays)
    await record(ctx, trigger, env.remote !== null, message, name, bytes)
    return { ok: env.remote !== null, message }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'สำรองข้อมูลไม่สำเร็จ'
    console.error('[backup]', message)
    await record(ctx, trigger, false, message, null, null).catch(() => undefined)
    return { ok: false, message }
  }
}

function bangkokHour(now: Date): number {
  return (now.getUTCHours() + 7) % 24
}

export function isBackupDue(config: BackupConfig, now: Date): boolean {
  if (!config.enabled) return false
  if (config.lastRunAt && now.getTime() - Date.parse(config.lastRunAt) < 50 * 60 * 1000) return false
  const hour = bangkokHour(now)
  if (config.frequency === 'hourly') return true
  if (config.frequency === 'every6h') return hour % 6 === config.runHour % 6
  return hour === config.runHour
}

let running = false

export function isBackupRunning(): boolean {
  return running
}

/** Starts a run unless one is in flight. Returns false when already running. */
export function startBackup(ctx: RequestCtx, trigger: 'manual' | 'schedule'): boolean {
  if (running) return false
  running = true
  void runBackup(ctx, trigger).finally(() => {
    running = false
  })
  return true
}

/** In-process scheduler (one API process per VPS): checks every minute. */
export function startBackupScheduler(): void {
  const tick = async () => {
    try {
      const ctx = buildSystemCtx()
      if (isBackupDue(await loadBackupConfig(ctx), new Date())) startBackup(ctx, 'schedule')
    } catch (err) {
      console.error('[backup] scheduler', err instanceof Error ? err.message : err)
    }
  }
  setInterval(() => void tick(), 60_000).unref()
}
