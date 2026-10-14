import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import type { AppEnv } from './app-env.js'
import { handleError } from './errors.js'
import { buildRequestCtx, resolveStage } from './gate.js'
import { masterRoutes } from './routes/master.js'
import { purchasingRoutes } from './routes/purchasing.js'
import { reportRoutes } from './routes/reports.js'
import { salesRoutes } from './routes/sales.js'
import { stockRoutes } from './routes/stock.js'

const app = new Hono<AppEnv>().basePath('/api')

app.onError(handleError)

app.get('/health', (c) => c.json({ ok: true }))

// Every business route runs as the calling user (app token → Gate → RLS on org_id).
app.use('*', async (c, next) => {
  if (c.req.path === '/api/health') return next()
  c.set('ctx', await buildRequestCtx(c))
  await next()
})

app.route('/', masterRoutes)
app.route('/', salesRoutes)
app.route('/', purchasingRoutes)
app.route('/', stockRoutes)
app.route('/', reportRoutes)

const port = Number(process.env.BACKEND_PORT) || 3001

serve({ fetch: app.fetch, port }, () => {
  console.log(`KasetLink POS backend on port ${port} (store stage: ${resolveStage()})`)
})

export default app
