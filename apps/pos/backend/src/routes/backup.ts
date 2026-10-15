import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import {
  WEB_APP_URL_RE,
  appsScriptSource,
  loadBackupConfig,
  pingSheet,
  rotateBackupSecret,
  runBackup,
  saveBackupConfig,
  type BackupConfig,
} from '../backup.js'
import { HttpError } from '../errors.js'

/** Google Sheet backup settings, test, and manual run. */
export const backupRoutes = new Hono<AppEnv>()

/** Orgs with a manual backup in flight on this replica (the UI polls lastRunAt for the result). */
const running = new Set<string>()

function view(config: BackupConfig, orgId: string) {
  return { ...config, running: running.has(orgId), script: appsScriptSource(config.secret) }
}

backupRoutes.get('/backup', async (c) => {
  const ctx = c.get('ctx')
  return c.json(view(await loadBackupConfig(ctx), ctx.orgId))
})

const configSchema = z.object({
  webAppUrl: z
    .string()
    .trim()
    .regex(WEB_APP_URL_RE, 'ลิงก์ต้องขึ้นต้นด้วย https://script.google.com/macros/s/ และลงท้ายด้วย /exec')
    .nullish()
    .or(z.literal('')),
  enabled: z.boolean(),
  frequency: z.enum(['hourly', 'every6h', 'daily']),
  runHour: z.number().int().min(0).max(23),
})

backupRoutes.put('/backup', async (c) => {
  const ctx = c.get('ctx')
  const b = configSchema.parse(await c.req.json())
  if (b.enabled && !b.webAppUrl) throw new HttpError(400, 'ใส่ลิงก์ Web App ก่อนเปิดการสำรองอัตโนมัติ')
  const config = await saveBackupConfig(ctx, { ...b, webAppUrl: b.webAppUrl || null })
  return c.json(view(config, ctx.orgId))
})

backupRoutes.post('/backup/secret', async (c) => {
  const ctx = c.get('ctx')
  return c.json(view(await rotateBackupSecret(ctx), ctx.orgId))
})

backupRoutes.post('/backup/test', async (c) => {
  const ctx = c.get('ctx')
  const name = await pingSheet(await loadBackupConfig(ctx))
  return c.json({ ok: true, name })
})

/** Starts a backup and returns at once; large shops can take longer than a request may wait. */
backupRoutes.post('/backup/run', async (c) => {
  const ctx = c.get('ctx')
  const config = await loadBackupConfig(ctx)
  if (!config.webAppUrl) throw new HttpError(400, 'ยังไม่ได้ใส่ลิงก์ Web App')
  if (running.has(ctx.orgId)) return c.json({ started: false, previousRunAt: config.lastRunAt })
  running.add(ctx.orgId)
  void runBackup(ctx, 'manual')
    .catch((err: unknown) => console.error('[backup] manual run failed', err))
    .finally(() => running.delete(ctx.orgId))
  return c.json({ started: true, previousRunAt: config.lastRunAt })
})
