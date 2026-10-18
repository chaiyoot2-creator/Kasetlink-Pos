import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import type { AppEnv } from './app-env.js'
import { currentUser, hasAny, requiredPermissions } from './auth.js'
import { HttpError, handleError } from './errors.js'
import { authRoutes } from './routes/auth.js'
import { buildRequestCtx, buildSystemCtx, resolveStage } from './gate.js'
import { accountingRoutes } from './routes/accounting.js'
import { analyticsRoutes } from './routes/analytics.js'
import { agencyRoutes } from './routes/agency.js'
import { backupRoutes } from './routes/backup.js'
import { imageRoutes } from './routes/images.js'
import { deliveryRoutes } from './routes/delivery.js'
import { expenseRoutes } from './routes/expenses.js'
import { insightRoutes } from './routes/insights.js'
import { masterRoutes } from './routes/master.js'
import { purchasingRoutes } from './routes/purchasing.js'
import { quotationRoutes } from './routes/quotations.js'
import { reportRoutes } from './routes/reports.js'
import { salesRoutes } from './routes/sales.js'
import { stockRoutes } from './routes/stock.js'

const app = new Hono<AppEnv>().basePath('/api')

app.onError(handleError)

app.get('/health', (c) => c.json({ ok: true }))

// Deployed, the app is open to visitors without a FuseBase account, so the shop database is
// reached with the app's service token and the staff login below is the only gate. Local dev
// has no service token and keeps using the FuseBase user's app token (Gate → RLS on org_id).
app.use('*', async (c, next) => {
  if (c.req.path === '/api/health') return next()
  c.set('ctx', process.env.FBS_FEATURE_TOKEN ? await buildSystemCtx() : await buildRequestCtx(c))
  await next()
})

/**
 * Reachable before signing in (change-password checks the session itself; usage events
 * attach the staff account only when the request's own session proves it).
 */
const PUBLIC_PATHS = new Set(['/health', '/auth/status', '/auth/setup', '/auth/login', '/auth/logout', '/auth/change-password', '/analytics/events'])

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
app.route('/', analyticsRoutes)
app.route('/', expenseRoutes)

const port = Number(process.env.BACKEND_PORT) || 3001

serve({ fetch: app.fetch, port }, () => {
  console.log(`KasetLink POS backend on port ${port} (store stage: ${resolveStage()})`)
})

export default app
