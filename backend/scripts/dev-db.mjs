// Local development database (no PostgreSQL install needed): `npm run dev:db`.
// Starts PostgreSQL 17 from the embedded-postgres package on port 54329 and creates the
// non-superuser `pos` role (so RLS is enforced exactly like on the VPS).
// DATABASE_URL=postgres://pos:pos@127.0.0.1:54329/kasetlink_pos
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'
import path from 'node:path'

const dataDir = path.resolve('.pgdata')
const fresh = !existsSync(dataDir)
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: 54329, persistent: true })

if (fresh) await pg.initialise()
await pg.start()
if (fresh) {
  const client = pg.getPgClient()
  await client.connect()
  await client.query("CREATE ROLE pos LOGIN PASSWORD 'pos' NOSUPERUSER NOBYPASSRLS")
  await client.query('CREATE DATABASE kasetlink_pos OWNER pos')
  await client.end()
}
console.log('dev database ready: postgres://pos:pos@127.0.0.1:54329/kasetlink_pos (Ctrl+C to stop)')

const stop = async () => {
  await pg.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
setInterval(() => undefined, 1 << 30)
