import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { HttpError } from './errors.js'
import { query, transaction, type RequestCtx, type Row } from './gate.js'
import { bool, num, str, strOrNull } from './util.js'

/**
 * Shop staff login inside the app. Passwords are scrypt hashes; a login gives a signed
 * token (cookie + header) carrying user id, session version and expiry. Changing a
 * password, the role or deactivating the user bumps session_version and ends old sessions.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>

export const SESSION_COOKIE = 'kl_session'
export const SESSION_HEADER = 'x-kl-session'
export const SESSION_HOURS = 16
const MAX_FAILED = 5
const LOCK_MINUTES = 5

/** Everything a role can be allowed to do. `users.manage` is reserved for the owner role. */
export const PERMISSIONS = [
  'pos.sell',
  'quotations',
  'sales.view',
  'sales.void',
  'receivables',
  'customers.insight',
  'agency',
  'delivery',
  'purchasing',
  'stock',
  'alerts',
  'reports',
  'accounting',
  'master',
  'settings',
  'view.cost',
] as const
export type Permission = (typeof PERMISSIONS)[number] | 'users.manage'

export const DEFAULT_ROLES: { key: string; name: string; permissions: Permission[]; isOwner: boolean }[] = [
  { key: 'owner', name: 'เจ้าของ', permissions: [...PERMISSIONS, 'users.manage'], isOwner: true },
  {
    key: 'manager',
    name: 'ผู้จัดการ',
    permissions: ['pos.sell', 'quotations', 'sales.view', 'sales.void', 'receivables', 'customers.insight', 'agency', 'delivery', 'purchasing', 'stock', 'alerts', 'reports', 'accounting', 'master', 'view.cost'],
    isOwner: false,
  },
  { key: 'cashier', name: 'พนักงานขาย', permissions: ['pos.sell', 'quotations', 'sales.view', 'receivables', 'alerts'], isOwner: false },
  { key: 'warehouse', name: 'พนักงานคลัง-จัดส่ง', permissions: ['stock', 'purchasing', 'delivery', 'alerts'], isOwner: false },
]

export interface AppUser {
  id: string
  username: string
  displayName: string
  roleId: string
  roleName: string
  isOwner: boolean
  permissions: Permission[]
  sessionVersion: number
}

// ---------------------------------------------------------------- passwords

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(pw, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$')
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// ---------------------------------------------------------------- signing secret

const secretCache = new Map<string, string>()

/** Per-shop signing secret, created on first use and kept in the shop's own database. */
async function sessionSecret(ctx: RequestCtx): Promise<string> {
  const env = process.env.APP_SESSION_SECRET?.trim()
  if (env && env.length >= 32) return env
  const cached = secretCache.get(ctx.orgId)
  if (cached) return cached
  let rows = await query(ctx, 'SELECT session_secret FROM app_auth_config LIMIT 1')
  if (!rows[0]) {
    await transaction(ctx, [
      {
        sql: 'INSERT INTO app_auth_config (session_secret) VALUES ($1) ON CONFLICT (org_id) DO NOTHING',
        params: [randomBytes(32).toString('base64url')],
      },
    ])
    rows = await query(ctx, 'SELECT session_secret FROM app_auth_config LIMIT 1')
  }
  const secret = str(rows[0] ?? {}, 'session_secret')
  if (!secret) throw new HttpError(500, 'ตั้งค่าการเข้าสู่ระบบไม่สำเร็จ')
  secretCache.set(ctx.orgId, secret)
  return secret
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export async function issueToken(ctx: RequestCtx, user: { id: string; sessionVersion: number }): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + SESSION_HOURS * 3600_000
  const payload = Buffer.from(JSON.stringify({ u: user.id, v: user.sessionVersion, e: expiresAt, o: ctx.orgId })).toString('base64url')
  return { token: `${payload}.${sign(await sessionSecret(ctx), payload)}`, expiresAt }
}

async function readToken(ctx: RequestCtx, token: string): Promise<{ userId: string; version: number } | null> {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = sign(await sessionSecret(ctx), payload)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof data !== 'object' || data === null) return null
    const d = data as { u?: unknown; v?: unknown; e?: unknown; o?: unknown }
    if (typeof d.u !== 'string' || typeof d.v !== 'number' || typeof d.e !== 'number' || d.o !== ctx.orgId) return null
    if (d.e < Date.now()) return null
    return { userId: d.u, version: d.v }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- users

const USER_SELECT = `
  SELECT u.*, r.name AS role_name, r.is_owner, to_json(r.permissions)::text AS permissions_json
    FROM app_users u JOIN app_roles r ON r.id = u.role_id`

export function mapAppUser(r: Row): AppUser & { isActive: boolean; lastLoginAt: string | null; lockedUntil: string | null } {
  let perms: Permission[] = []
  try {
    const parsed: unknown = JSON.parse(str(r, 'permissions_json') || '[]')
    if (Array.isArray(parsed)) perms = parsed.map((p) => String(p) as Permission)
  } catch {
    perms = []
  }
  const isOwner = bool(r, 'is_owner')
  return {
    id: str(r, 'id'),
    username: str(r, 'username'),
    displayName: str(r, 'display_name'),
    roleId: str(r, 'role_id'),
    roleName: str(r, 'role_name'),
    isOwner,
    permissions: isOwner ? [...PERMISSIONS, 'users.manage'] : perms.filter((p) => p !== 'users.manage'),
    sessionVersion: num(r, 'session_version'),
    isActive: bool(r, 'is_active'),
    lastLoginAt: strOrNull(r, 'last_login_at'),
    lockedUntil: strOrNull(r, 'locked_until'),
  }
}

export async function findUserBy(ctx: RequestCtx, field: 'id' | 'username', value: string): Promise<Row | null> {
  const rows = await query(ctx, `${USER_SELECT} WHERE u.${field === 'id' ? 'id = $1::uuid' : 'username = $1'}`, [value])
  return rows[0] ?? null
}

const userCache = new Map<string, { user: AppUser; at: number }>()
const USER_TTL_MS = 30_000

export function forgetUser(id: string): void {
  userCache.delete(id)
}

export function readSessionToken(c: Context): string | null {
  return c.req.header(SESSION_HEADER) || getCookie(c, SESSION_COOKIE) || null
}

/** The signed-in staff member for this request, or null. */
export async function currentUser(c: Context, ctx: RequestCtx): Promise<AppUser | null> {
  const token = readSessionToken(c)
  if (!token) return null
  const t = await readToken(ctx, token)
  if (!t) return null
  const cached = userCache.get(t.userId)
  let user = cached && Date.now() - cached.at < USER_TTL_MS ? cached.user : null
  if (!user) {
    const row = await findUserBy(ctx, 'id', t.userId)
    if (!row) return null
    const u = mapAppUser(row)
    if (!u.isActive) return null
    user = u
    userCache.set(u.id, { user: u, at: Date.now() })
  }
  return user.sessionVersion === t.version ? user : null
}

/** Count failed logins and lock the account for a while after too many. */
export function failedLoginSql(): string {
  return `UPDATE app_users SET failed_attempts = failed_attempts + 1,
            locked_until = CASE WHEN failed_attempts + 1 >= ${MAX_FAILED} THEN now() + interval '${LOCK_MINUTES} minutes' ELSE locked_until END,
            updated_at = now()
          WHERE id = $1::uuid`
}

export function isLocked(r: Row): boolean {
  const until = strOrNull(r, 'locked_until')
  return until !== null && Date.parse(until) > Date.now()
}

// ---------------------------------------------------------------- permissions per API path

type Rule = [method: string, pattern: RegExp, perms: Permission[]]

/** First match wins. Paths without a rule only need a signed-in user. */
const RULES: Rule[] = [
  ['POST', /^\/sales$/, ['pos.sell']],
  ['GET', /^\/sales(\/[^/]+)?$/, ['sales.view', 'pos.sell']],
  ['POST', /^\/sales\/[^/]+\/void$/, ['sales.void']],
  ['POST', /^\/sales\/[^/]+\/tax-invoice$/, ['sales.view', 'pos.sell']],
  ['GET', /^\/customers\/[^/]+\/prices$/, ['pos.sell', 'master']],
  ['GET', /^\/customers\/[^/]+\/ledger$/, ['receivables', 'pos.sell', 'master']],
  ['POST', /^\/customers\/[^/]+\/payments$/, ['receivables']],
  ['GET', /^\/payments\//, ['receivables']],
  ['GET', /^\/receivables/, ['receivables']],
  ['POST', /^\/customers$/, ['master', 'pos.sell']],
  ['*', /^\/customers\//, ['master']],
  ['*', /^\/(products|brands|suppliers|locations)(\/|$)/, ['master']],
  ['*', /^\/import\//, ['master']],
  ['POST', /^\/uploads\//, ['master']],
  ['*', /^\/(settings|backup)(\/|$)/, ['settings']],
  ['*', /^\/(purchase-orders|receipts)(\/|$)/, ['purchasing']],
  ['*', /^\/(stock|transfers|adjustments)(\/|$)/, ['stock']],
  ['*', /^\/(reports|events)(\/|$)/, ['reports']],
  ['*', /^\/insights\//, ['customers.insight']],
  ['GET', /^\/quotations\/[^/]+$/, ['quotations', 'pos.sell']],
  ['*', /^\/quotations(\/|$)/, ['quotations']],
  ['*', /^\/accounting\//, ['accounting']],
  ['*', /^\/agency\//, ['agency']],
  ['POST', /^\/delivery\/orders\/from-sale\//, ['delivery', 'pos.sell']],
  ['GET', /^\/delivery\/places$/, ['delivery', 'master']],
  ['*', /^\/delivery\//, ['delivery']],
]

/** Reads every signed-in user needs (POS lookups, the alert badge, map setup). */
const OPEN_READS = /^\/(bootstrap|products|products\/lookup|products\/quick|customers|brands|suppliers|alerts|next-codes|maps\/config)$/

export function requiredPermissions(method: string, path: string): Permission[] | null {
  if (method === 'GET' && OPEN_READS.test(path)) return null
  for (const [m, re, perms] of RULES) {
    if ((m === '*' || m === method) && re.test(path)) return perms
  }
  return null
}

export function hasAny(user: AppUser, perms: Permission[]): boolean {
  return user.isOwner || perms.some((p) => user.permissions.includes(p))
}
