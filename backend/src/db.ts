import pg from 'pg'
import { HttpError } from './errors.js'

/**
 * Direct PostgreSQL access (self-hosted on the VPS). Every call runs in its own
 * transaction with `app.org_id` set, so the RLS policies from 0002_rls.sql keep
 * isolating rows exactly as they did behind FuseBase Gate. The app role must not be
 * a superuser (superusers bypass RLS).
 */

export type Row = Record<string, unknown>

export interface RequestCtx {
  orgId: string
  userId: string
  orgRole: string | null
}

// NUMERIC / BIGINT arrive as strings (same as Gate did); timestamps stay ISO strings too.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString())
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v) => v)
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL?.trim()
    if (!connectionString) throw new Error('DATABASE_URL is not set')
    pool = new pg.Pool({ connectionString, max: Number(process.env.DB_POOL_MAX) || 10, idleTimeoutMillis: 30000 })
    pool.on('error', (err) => console.error('[db] idle client error', err.message))
  }
  return pool
}

/** Single shop per install. Override ORG_ID only when restoring data exported from FuseBase. */
export function shopOrgId(): string {
  return process.env.ORG_ID?.trim() || 'main'
}

export function buildRequestCtx(): RequestCtx {
  return { orgId: shopOrgId(), userId: 'app', orgRole: null }
}

export function buildSystemCtx(): RequestCtx {
  return { orgId: shopOrgId(), userId: 'system', orgRole: null }
}

interface PgError {
  code?: string
  constraint?: string
  message?: string
}

function isPgError(err: unknown): err is PgError {
  return typeof err === 'object' && err !== null && 'code' in err
}

/** Translate Postgres failures into Thai messages the cashier can act on. */
function mapSqlError(err: unknown, guard: string | undefined): never {
  if (err instanceof HttpError) throw err
  if (!isPgError(err)) {
    console.error('[sql]', err)
    throw new HttpError(503, 'ฐานข้อมูลไม่ตอบสนอง รอสักครู่แล้วกดลองใหม่ (ข้อมูลไม่หาย)', 'db_unavailable')
  }
  const text = `${err.constraint ?? ''} ${err.message ?? ''}`
  if (err.code === 'ECONNREFUSED' || err.code === '57P03' || err.code === '53300') {
    console.error('[sql] database unavailable', err.code, err.message)
    throw new HttpError(503, 'ฐานข้อมูลขัดข้องชั่วคราว รอสักครู่แล้วกดลองใหม่ (ข้อมูลไม่หาย)', 'db_unavailable')
  }
  if (err.code === '22012') {
    throw new HttpError(409, guard ?? 'ข้อมูลเปลี่ยนแปลง กรุณาลองใหม่', 'guard_failed')
  }
  if (err.code === '23514' && /stock_lots/.test(text)) {
    throw new HttpError(409, 'สต็อกไม่พอ (มีรายการอื่นตัดสต็อกไปก่อน) กรุณาลองใหม่', 'stock_conflict')
  }
  if (err.code === '23503') throw new HttpError(409, 'ข้อมูลนี้ถูกใช้งานอยู่ หรืออ้างอิงข้อมูลที่ถูกลบไปแล้ว', 'in_use')
  if (err.code === '23505') {
    if (/brands_org_id_name/.test(text)) throw new HttpError(409, 'ชื่อแบรนด์นี้มีอยู่แล้ว', 'duplicate')
    if (/products_org_barcode_uidx/.test(text)) throw new HttpError(409, 'บาร์โค้ดนี้ถูกใช้กับสินค้าอื่นแล้ว', 'duplicate')
    if (/sku/.test(text)) throw new HttpError(409, 'รหัสสินค้านี้มีอยู่แล้ว', 'duplicate')
    if (/code/.test(text)) throw new HttpError(409, 'รหัสนี้มีอยู่แล้ว', 'duplicate')
    if (/event_id|pos_events_pkey/.test(text)) throw new HttpError(409, 'รายการนี้ถูกบันทึกไปแล้ว', 'duplicate_event')
    throw new HttpError(409, 'ข้อมูลซ้ำกับที่มีอยู่แล้ว', 'duplicate')
  }
  console.error('[sql]', err.code, err.message)
  throw new HttpError(500, 'บันทึกข้อมูลไม่สำเร็จ', 'sql_error')
}

async function withOrg<T>(ctx: RequestCtx, readOnly: boolean, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  let client: pg.PoolClient
  try {
    client = await getPool().connect()
  } catch (err) {
    mapSqlError(err, undefined)
  }
  try {
    await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN')
    await client.query("SELECT set_config('app.org_id', $1, true)", [ctx.orgId])
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

/** Read-only statement (runs in a READ ONLY transaction). */
export async function query(ctx: RequestCtx, sql: string, params: unknown[] = []): Promise<Row[]> {
  try {
    return await withOrg(ctx, true, async (client) => (await client.query(sql, params)).rows as Row[])
  } catch (err) {
    mapSqlError(err, undefined)
  }
}

export interface BatchOp {
  sql: string
  params?: unknown[]
  /** When this op is a guard (raises division by zero on failure), the Thai message to return. */
  guard?: string
}

/**
 * Run several statements atomically (one transaction, all-or-nothing, max 25 ops).
 * Returns rows per op in request order.
 */
export async function transaction(ctx: RequestCtx, ops: BatchOp[]): Promise<Row[][]> {
  if (ops.length > 25) throw new HttpError(400, 'รายการมากเกินไปในครั้งเดียว', 'batch_too_large')
  let current: BatchOp | undefined
  try {
    return await withOrg(ctx, false, async (client) => {
      const results: Row[][] = []
      for (const op of ops) {
        current = op
        results.push((await client.query(op.sql, op.params ?? [])).rows as Row[])
      }
      return results
    })
  } catch (err) {
    mapSqlError(err, current?.guard)
  }
}

/**
 * Numeric term (always 0) that aborts the transaction with "division by zero" when
 * `condition` is false for the row being updated:
 *   UPDATE customers SET balance = balance + $2 + ${guardTerm('balance + $2 <= credit_limit')} WHERE id = $1
 * The row is locked by the UPDATE, so the check sees the committed current value.
 */
export function guardTerm(condition: string): string {
  return `0 * (1 / (CASE WHEN ${condition} THEN 1 ELSE 0 END))`
}
