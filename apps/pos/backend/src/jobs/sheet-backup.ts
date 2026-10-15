import { isBackupDue, loadBackupConfig, runBackup } from '../backup.js'
import { buildSystemCtx } from '../gate.js'

/**
 * Cron (every hour): back up to Google Sheet when this hour matches the schedule
 * the owner chose in Settings. Runs as the app's service token.
 */
async function main() {
  const ctx = await buildSystemCtx()
  const config = await loadBackupConfig(ctx)
  const now = new Date()
  if (!isBackupDue(config, now)) {
    console.log('[sheet-backup] not due', { enabled: config.enabled, frequency: config.frequency, runHour: config.runHour })
    process.exit(0)
  }
  const result = await runBackup(ctx, 'schedule')
  console.log('[sheet-backup]', result.ok ? 'done' : 'failed', result.message)
  process.exit(result.ok ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('[sheet-backup] crashed', err)
  process.exit(1)
})
