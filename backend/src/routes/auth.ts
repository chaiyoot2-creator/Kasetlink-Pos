import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import {
  DEFAULT_ROLES,
  PERMISSIONS,
  SESSION_COOKIE,
  SESSION_HOURS,
  currentUser,
  failedLoginSql,
  findUserBy,
  forgetUser,
  hasAny,
  hashPassword,
  isLocked,
  issueToken,
  mapAppUser,
  verifyPassword,
  type AppUser,
} from '../auth.js'
import { HttpError } from '../errors.js'
import { query, transaction, type RequestCtx, type Row } from '../db.js'
import { bool, num, str, uuid } from '../util.js'

/** Staff login (username + password) and user / role management. */
export const authRoutes = new Hono<AppEnv>()

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'ชื่อผู้ใช้ 3–32 ตัว ใช้ a-z 0-9 . _ - เท่านั้น')
const password = z.string().min(6, 'รหัสผ่านอย่างน้อย 6 ตัว').max(100)
const displayName = z.string().trim().min(1).max(80)

function publicUser(u: AppUser) {
  return { id: u.id, username: u.username, displayName: u.displayName, roleName: u.roleName, isOwner: u.isOwner, permissions: u.permissions }
}

async function startSession(c: Context<AppEnv>, ctx: RequestCtx, user: AppUser) {
  const { token, expiresAt } = await issueToken(ctx, user)
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: c.req.url.startsWith('https:'),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  })
  return { token, expiresAt, user: publicUser(user) }
}

/** Default roles on first use. */
async function ensureRoles(ctx: RequestCtx): Promise<void> {
  const [r] = await query(ctx, 'SELECT count(*) AS n FROM app_roles')
  if (num(r ?? {}, 'n') > 0) return
  await transaction(ctx, [
    {
      sql: `INSERT INTO app_roles (role_key, name, permissions, is_owner, sort_order)
            SELECT x.role_key, x.name, ARRAY(SELECT jsonb_array_elements_text(x.permissions)), x.is_owner, x.sort_order
              FROM jsonb_to_recordset($1::jsonb) AS x(role_key text, name text, permissions jsonb, is_owner boolean, sort_order int)
            ON CONFLICT (org_id, name) DO NOTHING`,
      params: [JSON.stringify(DEFAULT_ROLES.map((d, i) => ({ role_key: d.key, name: d.name, permissions: d.permissions, is_owner: d.isOwner, sort_order: i + 1 })))],
    },
  ])
}

async function userCount(ctx: RequestCtx): Promise<number> {
  const [r] = await query(ctx, 'SELECT count(*) AS n FROM app_users')
  return num(r ?? {}, 'n')
}

/** Who is signed in on this device, and whether the shop still needs its owner account. */
authRoutes.get('/auth/status', async (c) => {
  const ctx = c.get('ctx')
  await ensureRoles(ctx)
  const user = await currentUser(c, ctx)
  return c.json({
    setupRequired: (await userCount(ctx)) === 0,
    user: user ? publicUser(user) : null,
    allPermissions: PERMISSIONS,
  })
})

const setupSchema = z.object({ displayName, username, password })

/** First owner account. Only works while the shop has no users at all. */
authRoutes.post('/auth/setup', async (c) => {
  const ctx = c.get('ctx')
  const b = setupSchema.parse(await c.req.json())
  await ensureRoles(ctx)
  if ((await userCount(ctx)) > 0) throw new HttpError(409, 'ตั้งค่าเจ้าของร้านไปแล้ว — เข้าสู่ระบบด้วยบัญชีที่มีอยู่')
  const hash = await hashPassword(b.password)
  await transaction(ctx, [
    {
      sql: `INSERT INTO app_users (username, display_name, password_hash, role_id)
            SELECT $1, $2, $3, id FROM app_roles WHERE is_owner ORDER BY sort_order LIMIT 1`,
      params: [b.username, b.displayName, hash],
    },
  ])
  const row = await findUserBy(ctx, 'username', b.username)
  if (!row) throw new HttpError(500, 'สร้างบัญชีเจ้าของไม่สำเร็จ')
  return c.json(await startSession(c, ctx, mapAppUser(row)), 201)
})

const loginSchema = z.object({ username, password: z.string().min(1).max(100) })

authRoutes.post('/auth/login', async (c) => {
  const ctx = c.get('ctx')
  const b = loginSchema.parse(await c.req.json())
  const row = await findUserBy(ctx, 'username', b.username)
  const wrong = new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'login_failed')
  if (!row || !bool(row, 'is_active')) {
    // Same work as a real check so timing does not reveal which usernames exist.
    await verifyPassword(b.password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86))
    throw wrong
  }
  if (isLocked(row)) throw new HttpError(429, 'ใส่รหัสผิดหลายครั้ง บัญชีถูกล็อก 5 นาที', 'locked')
  if (!(await verifyPassword(b.password, str(row, 'password_hash')))) {
    await transaction(ctx, [{ sql: failedLoginSql(), params: [str(row, 'id')] }])
    throw wrong
  }
  await transaction(ctx, [
    {
      sql: 'UPDATE app_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1::uuid',
      params: [str(row, 'id')],
    },
  ])
  return c.json(await startSession(c, ctx, mapAppUser(row)))
})

authRoutes.post('/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

const changeSchema = z.object({ currentPassword: z.string().min(1), newPassword: password })

authRoutes.post('/auth/change-password', async (c) => {
  const ctx = c.get('ctx')
  const me = await currentUser(c, ctx)
  if (!me) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ', 'app_login_required')
  const b = changeSchema.parse(await c.req.json())
  const row = await findUserBy(ctx, 'id', me.id)
  if (!row || !(await verifyPassword(b.currentPassword, str(row, 'password_hash')))) throw new HttpError(400, 'รหัสผ่านเดิมไม่ถูกต้อง')
  await transaction(ctx, [
    {
      sql: 'UPDATE app_users SET password_hash = $2, session_version = session_version + 1, updated_at = now() WHERE id = $1::uuid',
      params: [me.id, await hashPassword(b.newPassword)],
    },
  ])
  forgetUser(me.id)
  const fresh = await findUserBy(ctx, 'id', me.id)
  return c.json(await startSession(c, ctx, mapAppUser(fresh ?? row)))
})

// ---------------------------------------------------------------- management (owner)

function requireManager(c: Context<AppEnv>): AppUser {
  const me = c.get('appUser')
  if (!me || !hasAny(me, ['users.manage'])) throw new HttpError(403, 'เฉพาะเจ้าของร้านจัดการผู้ใช้ได้', 'forbidden')
  return me
}

function mapRole(r: Row) {
  let permissions: string[] = []
  try {
    const parsed: unknown = JSON.parse(str(r, 'permissions_json') || '[]')
    if (Array.isArray(parsed)) permissions = parsed.map(String)
  } catch {
    permissions = []
  }
  return {
    id: str(r, 'id'),
    name: str(r, 'name'),
    roleKey: str(r, 'role_key') || null,
    isOwner: bool(r, 'is_owner'),
    permissions: bool(r, 'is_owner') ? [...PERMISSIONS, 'users.manage'] : permissions,
    userCount: num(r, 'user_count'),
  }
}

authRoutes.get('/auth/roles', async (c) => {
  requireManager(c)
  const rows = await query(
    c.get('ctx'),
    `SELECT r.*, to_json(r.permissions)::text AS permissions_json, (SELECT count(*) FROM app_users u WHERE u.role_id = r.id) AS user_count
       FROM app_roles r ORDER BY r.sort_order, r.name`,
  )
  return c.json(rows.map(mapRole))
})

const roleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
})

authRoutes.post('/auth/roles', async (c) => {
  requireManager(c)
  const b = roleSchema.parse(await c.req.json())
  const [rows] = await transaction(c.get('ctx'), [
    {
      sql: `INSERT INTO app_roles (name, permissions, sort_order)
            VALUES ($1, ARRAY(SELECT jsonb_array_elements_text($2::jsonb)), (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM app_roles))
            RETURNING id`,
      params: [b.name, JSON.stringify(b.permissions)],
    },
  ])
  return c.json({ id: str(rows?.[0] ?? {}, 'id') }, 201)
})

/** Edit a role. The owner role always keeps every permission. Users of the role must sign in again. */
authRoutes.put('/auth/roles/:id', async (c) => {
  requireManager(c)
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = roleSchema.parse(await c.req.json())
  const [rows] = await transaction(ctx, [
    {
      sql: `UPDATE app_roles SET name = $2, permissions = CASE WHEN is_owner THEN permissions ELSE ARRAY(SELECT jsonb_array_elements_text($3::jsonb)) END,
              updated_at = now()
            WHERE id = $1::uuid RETURNING id`,
      params: [id, b.name, JSON.stringify(b.permissions)],
    },
  ])
  if (!rows?.[0]) throw new HttpError(404, 'ไม่พบระดับผู้ใช้')
  const users = await query(ctx, 'SELECT id FROM app_users WHERE role_id = $1::uuid', [id])
  for (const u of users) forgetUser(str(u, 'id'))
  return c.json({ ok: true })
})

authRoutes.delete('/auth/roles/:id', async (c) => {
  requireManager(c)
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const [r] = await query(ctx, 'SELECT is_owner, (SELECT count(*) FROM app_users u WHERE u.role_id = r.id) AS n FROM app_roles r WHERE id = $1::uuid', [id])
  if (!r) throw new HttpError(404, 'ไม่พบระดับผู้ใช้')
  if (bool(r, 'is_owner')) throw new HttpError(409, 'ลบระดับเจ้าของไม่ได้')
  if (num(r, 'n') > 0) throw new HttpError(409, 'ยังมีผู้ใช้ในระดับนี้ — ย้ายผู้ใช้ไประดับอื่นก่อน')
  await transaction(ctx, [{ sql: 'DELETE FROM app_roles WHERE id = $1::uuid', params: [id] }])
  return c.json({ ok: true })
})

authRoutes.get('/auth/users', async (c) => {
  requireManager(c)
  const rows = await query(
    c.get('ctx'),
    `SELECT u.*, r.name AS role_name, r.is_owner, to_json(r.permissions)::text AS permissions_json
       FROM app_users u JOIN app_roles r ON r.id = u.role_id ORDER BY u.is_active DESC, r.sort_order, u.display_name`,
  )
  return c.json(
    rows.map((r) => {
      const u = mapAppUser(r)
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        roleId: u.roleId,
        roleName: u.roleName,
        isOwner: u.isOwner,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt,
        locked: isLocked(r),
      }
    }),
  )
})

const createUserSchema = z.object({ displayName, username, password, roleId: uuid })

authRoutes.post('/auth/users', async (c) => {
  requireManager(c)
  const ctx = c.get('ctx')
  const b = createUserSchema.parse(await c.req.json())
  if (await findUserBy(ctx, 'username', b.username)) throw new HttpError(409, 'ชื่อผู้ใช้นี้มีอยู่แล้ว', 'duplicate')
  const [rows] = await transaction(ctx, [
    {
      sql: 'INSERT INTO app_users (username, display_name, password_hash, role_id) VALUES ($1, $2, $3, $4::uuid) RETURNING id',
      params: [b.username, b.displayName, await hashPassword(b.password), b.roleId],
    },
  ])
  return c.json({ id: str(rows?.[0] ?? {}, 'id') }, 201)
})

const updateUserSchema = z.object({
  displayName,
  roleId: uuid,
  isActive: z.boolean(),
  /** Set a new password for the user (they did not need to know the old one). */
  newPassword: password.nullish(),
  unlock: z.boolean().default(false),
})

/** Edit a user. Role, password or active changes sign them out everywhere. */
authRoutes.put('/auth/users/:id', async (c) => {
  const me = requireManager(c)
  const ctx = c.get('ctx')
  const id = uuid.parse(c.req.param('id'))
  const b = updateUserSchema.parse(await c.req.json())
  const current = await findUserBy(ctx, 'id', id)
  if (!current) throw new HttpError(404, 'ไม่พบผู้ใช้')
  const [role] = await query(ctx, 'SELECT is_owner FROM app_roles WHERE id = $1::uuid', [b.roleId])
  if (!role) throw new HttpError(400, 'ไม่พบระดับผู้ใช้')
  // Never leave the shop without an active owner.
  const losingOwner = bool(current, 'is_owner') && (!bool(role, 'is_owner') || !b.isActive)
  if (losingOwner) {
    const [n] = await query(ctx, 'SELECT count(*) AS n FROM app_users u JOIN app_roles r ON r.id = u.role_id WHERE r.is_owner AND u.is_active AND u.id <> $1::uuid', [id])
    if (num(n ?? {}, 'n') === 0) throw new HttpError(409, 'ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน')
  }
  if (id === me.id && !b.isActive) throw new HttpError(409, 'ปิดบัญชีตัวเองไม่ได้')
  const signOut = b.roleId !== str(current, 'role_id') || !b.isActive || !!b.newPassword
  await transaction(ctx, [
    {
      sql: `UPDATE app_users SET display_name = $2, role_id = $3::uuid, is_active = $4::boolean,
              password_hash = COALESCE($5, password_hash),
              session_version = session_version + CASE WHEN $6::boolean THEN 1 ELSE 0 END,
              failed_attempts = CASE WHEN $7::boolean THEN 0 ELSE failed_attempts END,
              locked_until = CASE WHEN $7::boolean THEN NULL ELSE locked_until END,
              updated_at = now()
            WHERE id = $1::uuid`,
      params: [id, b.displayName, b.roleId, b.isActive, b.newPassword ? await hashPassword(b.newPassword) : null, signOut, b.unlock],
    },
  ])
  forgetUser(id)
  return c.json({ ok: true })
})
