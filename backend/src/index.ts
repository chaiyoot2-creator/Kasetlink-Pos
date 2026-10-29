import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import type { AppEnv } from './app-env.js'
import { currentUser, hasAny, requiredPermissions } from './auth.js'
import { startBackupScheduler } from './backup.js'
import { HttpError, handleError } from './errors.js'
import { authRoutes } from './routes/auth.js'
import { buildRequestCtx } from './db.js'
import { accountingRoutes } from './routes/accounting.js'
import { agencyRoutes } from './routes/agency.js'
import { backupRoutes } from './routes/backup.js'
import { imageRoutes, publicFileRoutes } from './routes/images.js'
import { deliveryRoutes } from './routes/delivery.js'
import { insightRoutes } from './routes/insights.js'
import { masterRoutes } from './routes/master.js'
import { purchasingRoutes } from './routes/purchasing.js'
import { quotationRoutes } from './routes/quotations.js'
import { reportRoutes } from './routes/reports.js'
import { salesRoutes } from './routes/sales.js'
import { stockRoutes } from './routes/stock.js'

const app = new Hono<AppEnv>().basePath('/api')

app.onError(handleError)

// The web app is served from Vercel (another origin); list its URL(s) in CORS_ORIGINS.
const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
app.use(
  '*',
  cors({
    origin: (origin) => (origins.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin) ? origin : null),
    allowHeaders: ['Content-Type', 'Accept', 'x-kl-session'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
)

app.get('/health', (c) => c.json({ ok: true }))
app.route('/', publicFileRoutes)

// Single shop per install: every business route runs with the shop's org_id (RLS).
app.use('*', async (c, next) => {
  c.set('ctx', buildRequestCtx())
  await next()
})

/** Reachable before signing in (change-password checks the session itself). */
const PUBLIC_PATHS = new Set(['/health', '/auth/status', '/auth/setup', '/auth/login', '/auth/logout', '/auth/change-password'])

// Then the shop staff login: every route except login itself needs a signed-in user with
// the permission the path requires (see RULES in auth.ts).
app.use('*', async (c, next) => {
  const path = c.req.path.replace(/^\/api/, '')
  if (PUBLIC_PATHS.has(path)) {
    c.set('appUser', null)
    return next()
  }
  const user = await currentUser(c, c.get('ctx'))
  if (!user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ', 'app_login_required')
  c.set('appUser', user)
  const need = requiredPermissions(c.req.method, path)
  if (need && !hasAny(user, need)) throw new HttpError(403, 'บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้', 'no_permission')
  await next()
})

app.route('/', authRoutes)
app.route('/', masterRoutes)
app.route('/', salesRoutes)
app.route('/', purchasingRoutes)
app.route('/', stockRoutes)
app.route('/', reportRoutes)
app.route('/', accountingRoutes)
app.route('/', insightRoutes)
app.route('/', backupRoutes)
app.route('/', imageRoutes)
app.route('/', agencyRoutes)
app.route('/', deliveryRoutes)
app.route('/', quotationRoutes)

const port = Number(process.env.PORT) || 3001

// Nginx terminates TLS on the VPS and proxies to 127.0.0.1.
serve({ fetch: app.fetch, port, hostname: process.env.HOST || '127.0.0.1' }, () => {
  console.log(`KasetLink POS API on port ${port}`)
})
startBackupScheduler()

export default app
