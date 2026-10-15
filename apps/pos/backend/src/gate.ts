import {
  AccessApi,
  ApiError,
  FilesApi,
  IsolatedStoresApi,
  createClient,
  type IsolatedStoreSqlBatchOperationContract,
  type IsolatedStoreSqlBatchOperationResultContract,
  type MeResponseContract,
} from '@fusebase/fusebase-gate-sdk'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { HttpError } from './errors.js'

/** Logical store alias. Deploy suffixes the Gate-side alias with the env name (e.g. `kasetlink-pos-prod`). */
const STORE_ALIAS = 'kasetlink-pos'

export type Stage = 'dev' | 'prod'

export type Row = Record<string, unknown>

export interface RequestCtx {
  token: string
  orgId: string
  userId: string
  orgRole: string | null
  storeId: string
  stage: Stage
}

function gateBaseUrl(): string {
  const host = process.env.FUSEBASE_HOST?.trim() || 'thefusebase.com'
  return `https://app-api.${host}/v4/api/proxy/gate-service/v1`
}

function createGateSdkClient(appToken: string) {
  // Leave the SDK's 30000ms `timeout` default alone — skill app-backend § Cold Starts.
  return createClient({
    baseUrl: gateBaseUrl(),
    defaultHeaders: { 'x-app-feature-token': appToken },
  })
}

export function createAccessApi(appToken: string): AccessApi {
  return new AccessApi(createGateSdkClient(appToken))
}

export function createFilesApi(appToken: string): FilesApi {
  return new FilesApi(createGateSdkClient(appToken))
}

export function createIsolatedStoresApi(appToken: string): IsolatedStoresApi {
  return new IsolatedStoresApi(createGateSdkClient(appToken))
}

/**
 * Local `fusebase dev start` works against the `dev` stage, deployed backends against `prod`.
 * The platform injects FBS_FEATURE_TOKEN only into deployed backends.
 */
export function resolveStage(): Stage {
  const explicit = process.env.POS_STORE_STAGE?.trim()
  if (explicit === 'dev' || explicit === 'prod') return explicit
  return process.env.FBS_FEATURE_TOKEN ? 'prod' : 'dev'
}

interface Identity {
  orgId: string
  userId: string
  orgRole: string | null
  expiresAt: number
}

const identityCache = new Map<string, Identity>()
const storeCache = new Map<string, string>()
const IDENTITY_TTL_MS = 5 * 60 * 1000

function mapGateError(err: unknown, fallback: string): never {
  if (err instanceof ApiError) {
    if (err.status === 401) throw new HttpError(401, 'เซสชันหมดอายุ กรุณารีเฟรชหน้า', 'auth_expired')
    if (err.status === 403) throw new HttpError(403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลร้าน', 'forbidden')
  }
  if (err instanceof HttpError) throw err
  console.error('[gate]', fallback, err)
  throw new HttpError(502, fallback, 'gate_error')
}

async function loadIdentity(token: string): Promise<Identity> {
  const cached = identityCache.get(token)
  if (cached && cached.expiresAt > Date.now()) return cached

  let me: MeResponseContract
  try {
    me = await createAccessApi(token).getMe({})
  } catch (err) {
    mapGateError(err, 'ตรวจสอบผู้ใช้ไม่สำเร็จ')
  }
  const orgId =
    process.env.FBS_ORG_ID?.trim() ||
    me.auth.scopes.find((s) => s.scopeType === 'org')?.scopeId
  if (!orgId) throw new HttpError(403, 'ไม่พบองค์กรของผู้ใช้', 'org_unresolved')

  const identity: Identity = {
    orgId,
    userId: me.user.id === null ? 'app' : String(me.user.id),
    orgRole: me.auth.orgRole ?? null,
    expiresAt: Date.now() + IDENTITY_TTL_MS,
  }
  identityCache.set(token, identity)
  if (identityCache.size > 500) {
    for (const [key, value] of identityCache) {
      if (value.expiresAt <= Date.now()) identityCache.delete(key)
    }
  }
  return identity
}

async function resolveStoreId(token: string, orgId: string): Promise<string> {
  const cached = storeCache.get(orgId)
  if (cached) return cached

  let stores
  try {
    const res = await createIsolatedStoresApi(token).listIsolatedStores({
      path: { orgId },
      query: { aliasLike: `${STORE_ALIAS}*` },
    })
    stores = res.stores
  } catch (err) {
    mapGateError(err, 'เชื่อมต่อฐานข้อมูลร้านไม่สำเร็จ')
  }
  const envName = process.env.FUSEBASE_ENV?.trim() || 'prod'
  const candidates = stores.filter(
    (s) => s.alias === STORE_ALIAS || s.alias.startsWith(`${STORE_ALIAS}-`),
  )
  const store =
    candidates.find((s) => s.alias === `${STORE_ALIAS}-${envName}`) ??
    candidates.find((s) => s.alias === STORE_ALIAS) ??
    candidates[0]
  if (!store) throw new HttpError(503, 'ยังไม่ได้สร้างฐานข้อมูลร้าน', 'store_missing')
  storeCache.set(orgId, store.globalId)
  return store.globalId
}

/** Read the visitor app token: header first, cookie second (platform proxies may strip the header). */
export function readAppToken(c: Context): string | null {
  return c.req.header('x-app-feature-token') || getCookie(c, 'fbsfeaturetoken') || null
}

export async function buildRequestCtx(c: Context): Promise<RequestCtx> {
  const token = readAppToken(c)
  if (!token) throw new HttpError(401, 'ไม่พบโทเคนของแอป กรุณารีเฟรชหน้า', 'auth_missing')
  const identity = await loadIdentity(token)
  const storeId = await resolveStoreId(token, identity.orgId)
  return {
    token,
    orgId: identity.orgId,
    userId: identity.userId,
    orgRole: identity.orgRole,
    storeId,
    stage: resolveStage(),
  }
}

/**
 * Context for scheduled jobs (no visitor): the deploy-time service token. Local runs may
 * fall back to GATE_MCP_TOKEN, never in the browser.
 */
export async function buildSystemCtx(): Promise<RequestCtx> {
  const token = process.env.FBS_FEATURE_TOKEN?.trim() || process.env.GATE_MCP_TOKEN?.trim()
  if (!token) throw new Error('FBS_FEATURE_TOKEN is not set')
  const identity = await loadIdentity(token)
  const storeId = await resolveStoreId(token, identity.orgId)
  return { token, orgId: identity.orgId, userId: 'system', orgRole: null, storeId, stage: resolveStage() }
}

function storePath(ctx: RequestCtx) {
  return { orgId: ctx.orgId, storeId: ctx.storeId, stage: ctx.stage }
}

/** Translate Postgres / Gate failures into Thai messages the cashier can act on. */
function mapSqlError(err: unknown, guards: Map<number, string>): never {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) mapGateError(err, '')
    const text = JSON.stringify(err.body ?? err.message)
    if (/ECONNREFUSED|connection timeout|timeout exceeded when trying to connect|starting up|too many clients/i.test(text)) {
      console.error('[sql] database unavailable', text)
      throw new HttpError(503, 'ฐานข้อมูลของ FuseBase ขัดข้องชั่วคราว รอสักครู่แล้วกดลองใหม่ (ข้อมูลไม่หาย)', 'db_unavailable')
    }
    const indexMatch = /operations\[(\d+)\]/i.exec(text) ?? /index[^0-9]{0,12}(\d+)/i.exec(text)
    const failedIndex = indexMatch ? Number(indexMatch[1]) : -1
    if (/division by zero/i.test(text) && guards.has(failedIndex)) {
      throw new HttpError(409, guards.get(failedIndex) ?? 'ข้อมูลเปลี่ยนแปลง กรุณาลองใหม่', 'guard_failed')
    }
    if (/division by zero/i.test(text) && guards.size > 0) {
      throw new HttpError(409, [...guards.values()][0] ?? 'ข้อมูลเปลี่ยนแปลง กรุณาลองใหม่', 'guard_failed')
    }
    if (/stock_lots_qty_check|violates check constraint "stock_lots/i.test(text)) {
      throw new HttpError(409, 'สต็อกไม่พอ (มีรายการอื่นตัดสต็อกไปก่อน) กรุณาลองใหม่', 'stock_conflict')
    }
    if (/violates foreign key/i.test(text)) {
      throw new HttpError(409, 'ข้อมูลนี้ถูกใช้งานอยู่ หรืออ้างอิงข้อมูลที่ถูกลบไปแล้ว', 'in_use')
    }
    if (/duplicate key/i.test(text)) {
      if (/brands_org_id_name/.test(text)) throw new HttpError(409, 'ชื่อแบรนด์นี้มีอยู่แล้ว', 'duplicate')
      if (/products_org_barcode_uidx/.test(text)) throw new HttpError(409, 'บาร์โค้ดนี้ถูกใช้กับสินค้าอื่นแล้ว', 'duplicate')
      if (/sku/.test(text)) throw new HttpError(409, 'รหัสสินค้านี้มีอยู่แล้ว', 'duplicate')
      if (/code/.test(text)) throw new HttpError(409, 'รหัสนี้มีอยู่แล้ว', 'duplicate')
      if (/event_id|pos_events_pkey/.test(text)) throw new HttpError(409, 'รายการนี้ถูกบันทึกไปแล้ว', 'duplicate_event')
      throw new HttpError(409, 'ข้อมูลซ้ำกับที่มีอยู่แล้ว', 'duplicate')
    }
    console.error('[sql]', err.status, text)
    throw new HttpError(500, 'บันทึกข้อมูลไม่สำเร็จ', 'sql_error')
  }
  mapGateError(err, 'ฐานข้อมูลไม่ตอบสนอง')
}

/** Read-only statement (runs in a READ ONLY transaction). */
export async function query(ctx: RequestCtx, sql: string, params: unknown[] = []): Promise<Row[]> {
  try {
    const res = await createIsolatedStoresApi(ctx.token).queryIsolatedStoreSql({
      path: storePath(ctx),
      body: { sql, params },
    })
    return res.result.rows
  } catch (err) {
    mapSqlError(err, new Map())
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
  const guards = new Map<number, string>()
  const operations: IsolatedStoreSqlBatchOperationContract[] = ops.map((op, index) => {
    if (op.guard) guards.set(index, op.guard)
    return { op: 'execute', sql: op.sql, params: op.params ?? [] }
  })
  let results: IsolatedStoreSqlBatchOperationResultContract[]
  try {
    const res = await createIsolatedStoresApi(ctx.token).runIsolatedStoreSqlBatch({
      path: storePath(ctx),
      body: { operations },
    })
    results = res.results
  } catch (err) {
    mapSqlError(err, guards)
  }
  return results.map((r) => r.result?.rows ?? r.rows ?? [])
}

/**
 * Numeric term (always 0) that aborts the transaction with "division by zero" when
 * `condition` is false for the row being updated. Gate's `execute` only accepts
 * statements starting with INSERT/UPDATE/DELETE, so guards live inside `SET`:
 *   UPDATE customers SET balance = balance + $2 + ${guardTerm('balance + $2 <= credit_limit')} WHERE id = $1
 * The row is locked by the UPDATE, so the check sees the committed current value.
 */
export function guardTerm(condition: string): string {
  return `0 * (1 / (CASE WHEN ${condition} THEN 1 ELSE 0 END))`
}
