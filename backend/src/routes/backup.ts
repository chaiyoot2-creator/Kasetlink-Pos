import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import {
  backupEnv,
  isBackupRunning,
  loadBackupConfig,
  saveBackupConfig,
  startBackup,
  testRemote,
  type BackupConfig,
} from '../backup.js'

/** Google Drive backup settings, connection test, and manual run. */
export const backupRoutes = new Hono<AppEnv>()

function view(config: BackupConfig) {
  const env = backupEnv()
  return { ...config, running: isBackupRunning(), remote: env.remote, keepDays: env.keepDays }
}

backupRoutes.get('/backup', async (c) => c.json(view(await loadBackupConfig(c.get('ctx')))))

const configSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['hourly', 'every6h', 'daily']),
  runHour: z.number().int().min(0).max(23),
})

backupRoutes.put('/backup', async (c) => {
  const b = configSchema.parse(await c.req.json())
  return c.json(view(await saveBackupConfig(c.get('ctx'), b)))
})

backupRoutes.post('/backup/test', async (c) => c.json({ ok: true, name: await testRemote() }))

/** Starts a backup and returns at once; the UI polls lastRunAt for the result. */
backupRoutes.post('/backup/run', async (c) => {
  const ctx = c.get('ctx')
  const config = await loadBackupConfig(ctx)
  return c.json({ started: startBackup(ctx, 'manual'), previousRunAt: config.lastRunAt })
})
