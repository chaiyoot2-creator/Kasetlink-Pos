import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { getPool, shopOrgId } from './db.js'

/**
 * Apply postgres/migrations/NNNN_*.sql in order, each in its own transaction, once.
 * Run as the app role (the owner of the tables). MIGRATIONS_DIR overrides the folder.
 */
async function main() {
  const dir = process.env.MIGRATIONS_DIR?.trim() || path.resolve('..', 'postgres', 'migrations')
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
  const pool = getPool()
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  const done = new Set((await pool.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version))

  for (const file of files) {
    const version = Number(file.slice(0, 4))
    if (done.has(version)) continue
    const sql = await readFile(path.join(dir, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.org_id', $1, true)", [shopOrgId()])
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, file])
      await client.query('COMMIT')
      console.log(`applied ${file}`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      console.error(`failed ${file}:`, err instanceof Error ? err.message : err)
      process.exitCode = 1
      break
    } finally {
      client.release()
    }
  }
  await pool.end()
}

void main()
