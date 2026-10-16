import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env.js'
import { canViewAnalytics, currentUser, type AppUser } from '../auth.js'
import { HttpError } from '../errors.js'
import { query, transaction } from '../gate.js'
import { json, num, str, strOrNull, uuid } from '../util.js'

/**
 * App usage analytics. Events carry no sales content (no customer, product, bill or payment
 * data) and no IP address: only the event type, time, page, a random browser id, a random
 * session id and — when known — the signed-in staff account and FuseBase user.
 */
export const analyticsRoutes = new Hono<AppEnv>()

export const USAGE_EVENT_TYPES = ['app_opened', 'page_viewed', 'feature_opened', 'sale_started', 'sale_completed'] as const

const eventSchema = z.object({
  eventId: uuid,
  type: z.enum(USAGE_EVENT_TYPES),
  occurredAt: z.string().datetime({ offset: true }),
  sessionId: uuid,
  browserId: uuid,
  page: z
    .string()
    .regex(/^[a-z0-9._-]{1,40}$/)
    .nullish()
    .transform((v) => v ?? null),
  /** Staff account the browser believed was signed in; kept only when it matches the session. */
  userId: uuid.nullish().transform((v) => v ?? null),
})
const batchSchema = z
  .object({
    events: z.array(eventSchema).max(50).default([]),
    /** "Still using the app" signal: moves the session's last activity without an event row. */
    activity: z
      .object({ sessionId: uuid, browserId: uuid, at: z.string().datetime({ offset: true }), userId: uuid.nullish() })
      .nullish(),
  })
  .refine((b) => b.events.length > 0 || b.activity, 'empty')

/** FuseBase user behind the app token, when the request carries one (deployed visitors do not). */
function fusebaseUserId(userId: string): string | null {
  return userId && userId !== 'system' && userId !== 'app' ? userId : null
}

interface SessionRow {
  session_id: string
  browser_id: string
  app_user_id: string | null
  started_at: string
  last_activity_at: string
}

function spanSession(map: Map<string, SessionRow>, sessionId: string, browserId: string, appUserId: string | null, at: string) {
  const s = map.get(sessionId)
  if (!s) {
    map.set(sessionId, { session_id: sessionId, browser_id: browserId, app_user_id: appUserId, started_at: at, last_activity_at: at })
    return
  }
  if (Date.parse(at) < Date.parse(s.started_at)) s.started_at = at
  if (Date.parse(at) > Date.parse(s.last_activity_at)) s.last_activity_at = at
  s.app_user_id = s.app_user_id ?? appUserId
}

/**
 * Reachable before sign-in so "app opened" on the login screen counts. Failures are
 * reported but never thrown at the client — analytics must not get in the way of selling.
 */
analyticsRoutes.post('/analytics/events', async (c) => {
  const parsed = batchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ ok: false, error: 'invalid_events' }, 400)
  const ctx = c.get('ctx')

  let staff: AppUser | null = null
  try {
    staff = await currentUser(c, ctx)
  } catch {
    staff = null
  }
  // The browser says who it thinks is signed in; only the request's own session can confirm it.
  const confirmed = (userId: string | null | undefined) => (staff && userId === staff.id ? staff.id : null)
  const fbUser = fusebaseUserId(ctx.userId)
  const { events, activity } = parsed.data

  // Client clocks drift: future times become now, anything older than 30 days (a queue left
  // offline for weeks) is dropped. The SQL below repeats both rules against the database clock.
  const nowMs = Date.now()
  const fresh = (at: string) => Date.parse(at) > nowMs - 30 * 86_400_000
  const clamp = (at: string) => (Date.parse(at) > nowMs ? new Date(nowMs).toISOString() : at)

  const rows = events.filter((e) => fresh(e.occurredAt)).map((e) => ({
    event_id: e.eventId,
    event_type: e.type,
    occurred_at: clamp(e.occurredAt),
    session_id: e.sessionId,
    browser_id: e.browserId,
    app_user_id: confirmed(e.userId),
    fusebase_user_id: fbUser,
    page: e.page,
  }))
  const sessions = new Map<string, SessionRow>()
  for (const r of rows) spanSession(sessions, r.session_id, r.browser_id, r.app_user_id, r.occurred_at)
  if (activity && fresh(activity.at)) spanSession(sessions, activity.sessionId, activity.browserId, confirmed(activity.userId), clamp(activity.at))
  if (sessions.size === 0) return c.json({ ok: true })

  // Re-sent events hit the primary key and are ignored.
  const ops = []
  if (rows.length > 0) {
    ops.push({
      sql: `INSERT INTO usage_events (event_id, event_type, occurred_at, session_id, browser_id, app_user_id, fusebase_user_id, page)
            SELECT x.event_id, x.event_type, LEAST(x.occurred_at, now()), x.session_id, x.browser_id, x.app_user_id, x.fusebase_user_id, x.page
              FROM jsonb_to_recordset($1::jsonb) AS x(event_id uuid, event_type text, occurred_at timestamptz, session_id uuid,
                   browser_id uuid, app_user_id uuid, fusebase_user_id text, page text)
             WHERE x.occurred_at > now() - interval '30 days'
            ON CONFLICT (org_id, event_id) DO NOTHING`,
      params: [json(rows)],
    })
  }
  ops.push({
    sql: `INSERT INTO usage_sessions (session_id, browser_id, app_user_id, started_at, last_activity_at)
          SELECT x.session_id, x.browser_id, x.app_user_id, LEAST(x.started_at, now()), LEAST(x.last_activity_at, now())
            FROM jsonb_to_recordset($1::jsonb) AS x(session_id uuid, browser_id uuid, app_user_id uuid, started_at timestamptz, last_activity_at timestamptz)
           WHERE x.last_activity_at > now() - interval '30 days'
          ON CONFLICT (org_id, session_id) DO UPDATE SET
            started_at = LEAST(usage_sessions.started_at, EXCLUDED.started_at),
            last_activity_at = GREATEST(usage_sessions.last_activity_at, EXCLUDED.last_activity_at),
            app_user_id = COALESCE(EXCLUDED.app_user_id, usage_sessions.app_user_id)`,
    params: [json([...sessions.values()])],
  })
  try {
    await transaction(ctx, ops)
  } catch (err) {
    console.error('[analytics] could not record events', err instanceof Error ? err.message : err)
    return c.json({ ok: false, error: 'not_recorded' }, 503)
  }
  return c.json({ ok: true })
})

function range(from: string | undefined, to: string | undefined) {
  const f = z.string().date().parse(from)
  const t = z.string().date().parse(to)
  if (f > t) throw new HttpError(400, 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด')
  if (Date.parse(t) - Date.parse(f) > 366 * 86_400_000) throw new HttpError(400, 'เลือกช่วงได้ไม่เกิน 1 ปี')
  return [f, t] as const
}

/** Bangkok-day bounds as timestamptz: [$1 00:00, $2 + 1 day 00:00) in Asia/Bangkok. */
const LO = `($1::date::timestamp AT TIME ZONE 'Asia/Bangkok')`
const HI = `(($2::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`
const IN_RANGE = `occurred_at >= ${LO} AND occurred_at < ${HI}`

/** Dashboard numbers for a date range (Bangkok days, inclusive). Owner and manager only. */
analyticsRoutes.get('/analytics/summary', async (c) => {
  const me = c.get('appUser')
  if (!me || !canViewAnalytics(me)) throw new HttpError(403, 'เฉพาะเจ้าของร้านและผู้จัดการดูสถิติการใช้งานได้', 'forbidden')
  const ctx = c.get('ctx')
  const [from, to] = range(c.req.query('from'), c.req.query('to'))
  const params = [from, to]

  const [totalsRows, sessionRows, pageRows, dayRows, dayAnonRows] = await Promise.all([
    query(
      ctx,
      `SELECT COUNT(*) FILTER (WHERE event_type = 'app_opened') AS visits,
              COUNT(*) FILTER (WHERE event_type = 'page_viewed') AS page_views,
              COUNT(*) FILTER (WHERE event_type = 'feature_opened') AS feature_opened,
              COUNT(*) FILTER (WHERE event_type = 'sale_started') AS sale_started,
              COUNT(*) FILTER (WHERE event_type = 'sale_completed') AS sale_completed,
              COUNT(DISTINCT app_user_id) AS signed_in_users,
              COUNT(DISTINCT fusebase_user_id) AS fusebase_users,
              (SELECT COUNT(*) FROM (SELECT browser_id FROM usage_events WHERE ${IN_RANGE}
                                      GROUP BY browser_id HAVING bool_and(app_user_id IS NULL)) b) AS anonymous_browsers,
              MAX(occurred_at) AS last_event_at
         FROM usage_events WHERE ${IN_RANGE}`,
      params,
    ),
    query(
      ctx,
      `SELECT COUNT(*) AS sessions,
              COALESCE(AVG(EXTRACT(EPOCH FROM (last_activity_at - started_at))), 0) AS avg_seconds
         FROM usage_sessions WHERE started_at >= ${LO} AND started_at < ${HI}`,
      params,
    ),
    query(
      ctx,
      `SELECT page, COUNT(*) AS views FROM usage_events
        WHERE event_type = 'page_viewed' AND page IS NOT NULL AND ${IN_RANGE}
        GROUP BY page ORDER BY views DESC, page LIMIT 50`,
      params,
    ),
    query(
      ctx,
      `SELECT (occurred_at AT TIME ZONE 'Asia/Bangkok')::date::text AS day,
              COUNT(*) FILTER (WHERE event_type = 'app_opened') AS visits,
              COUNT(DISTINCT session_id) AS sessions,
              COUNT(DISTINCT app_user_id) AS signed_in_users,
              COUNT(*) FILTER (WHERE event_type = 'page_viewed') AS page_views,
              COUNT(*) FILTER (WHERE event_type = 'sale_started') AS sale_started,
              COUNT(*) FILTER (WHERE event_type = 'sale_completed') AS sale_completed
         FROM usage_events WHERE ${IN_RANGE}
        GROUP BY 1 ORDER BY 1`,
      params,
    ),
    // Browsers that never signed in that day — counted the same way as the totals.
    query(
      ctx,
      `SELECT b.day, COUNT(*) FILTER (WHERE b.anonymous) AS anonymous_browsers
         FROM (SELECT (occurred_at AT TIME ZONE 'Asia/Bangkok')::date::text AS day, browser_id, bool_and(app_user_id IS NULL) AS anonymous
                 FROM usage_events WHERE ${IN_RANGE} GROUP BY 1, 2) b
        GROUP BY 1`,
      params,
    ),
  ])
  const anonByDay = new Map(dayAnonRows.map((r) => [str(r, 'day'), num(r, 'anonymous_browsers')]))

  const t = totalsRows[0] ?? {}
  const s = sessionRows[0] ?? {}
  const signedInUsers = num(t, 'signed_in_users')
  const anonymousBrowsers = num(t, 'anonymous_browsers')
  return c.json({
    from,
    to,
    timeZone: 'Asia/Bangkok',
    lastEventAt: strOrNull(t, 'last_event_at'),
    totals: {
      visits: num(t, 'visits'),
      uniqueUsers: signedInUsers + anonymousBrowsers,
      signedInUsers,
      anonymousBrowsers,
      fusebaseUsers: num(t, 'fusebase_users'),
      sessions: num(s, 'sessions'),
      avgSessionSeconds: Math.round(num(s, 'avg_seconds')),
      pageViews: num(t, 'page_views'),
      posOpened: num(t, 'feature_opened'),
      salesStarted: num(t, 'sale_started'),
      salesCompleted: num(t, 'sale_completed'),
    },
    pages: pageRows.map((r) => ({ page: str(r, 'page'), views: num(r, 'views') })),
    days: dayRows.map((r) => ({
      day: str(r, 'day'),
      visits: num(r, 'visits'),
      sessions: num(r, 'sessions'),
      users: num(r, 'signed_in_users') + (anonByDay.get(str(r, 'day')) ?? 0),
      pageViews: num(r, 'page_views'),
      salesStarted: num(r, 'sale_started'),
      salesCompleted: num(r, 'sale_completed'),
    })),
  })
})
