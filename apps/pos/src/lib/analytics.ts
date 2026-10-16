import { getFeatureToken, getSession } from './api'

/**
 * App usage analytics (separate from sales data). Records only that something happened —
 * app opened, page viewed, POS opened, sale started / completed — with a random browser id
 * and a session id that rolls over after 30 minutes of inactivity. Never sends customer,
 * product, bill or payment details. Every call swallows its own errors: a broken analytics
 * request must never stop the cashier.
 */

export type UsageEventType = 'app_opened' | 'page_viewed' | 'feature_opened' | 'sale_started' | 'sale_completed'

interface UsageEvent {
  eventId: string
  type: UsageEventType
  occurredAt: string
  sessionId: string
  browserId: string
  page: string | null
  userId: string | null
}

const BROWSER_KEY = 'kasetlink.analytics.browserId'
const SESSION_KEY = 'kasetlink.analytics.session'
const QUEUE_KEY = 'kasetlink.analytics.queue'
/** Per tab (survives refresh): the session already counted as a visit, and the last page recorded. */
const OPENED_KEY = 'kasetlink.analytics.opened'
const LAST_PAGE_KEY = 'kasetlink.analytics.lastPage'

const IDLE_MS = 30 * 60_000
const MAX_QUEUE = 200
const BATCH = 50
const FLUSH_DELAY_MS = 1500
const RETRY_MS = 30_000
/** Interactions extend the session locally at most this often, and reach the server this often. */
const TOUCH_EVERY_MS = 15_000
const PING_EVERY_MS = 2 * 60_000

const memory = new Map<string, string>()

function read(storage: 'local' | 'session', key: string): string | null {
  try {
    return (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(key) ?? memory.get(`${storage}:${key}`) ?? null
  } catch {
    return memory.get(`${storage}:${key}`) ?? null
  }
}

function write(storage: 'local' | 'session', key: string, value: string): void {
  memory.set(`${storage}:${key}`, value)
  try {
    ;(storage === 'local' ? window.localStorage : window.sessionStorage).setItem(key, value)
  } catch {
    // Storage blocked: the value lives for this page load only.
  }
}

function browserId(): string {
  const stored = read('local', BROWSER_KEY)
  if (stored) return stored
  const id = crypto.randomUUID()
  write('local', BROWSER_KEY, id)
  return id
}

let staffUserId: string | null = null

/** Current session, starting a new one after 30 minutes without activity. */
function touchSession(now = Date.now()): string {
  let session: { id: string; last: number } | null = null
  try {
    const raw = read('local', SESSION_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') {
      const p = parsed as { id?: unknown; last?: unknown }
      if (typeof p.id === 'string' && typeof p.last === 'number') session = { id: p.id, last: p.last }
    }
  } catch {
    session = null
  }
  if (!session || now - session.last > IDLE_MS) session = { id: crypto.randomUUID(), last: now }
  else session.last = Math.max(session.last, now)
  write('local', SESSION_KEY, JSON.stringify(session))
  return session.id
}

function loadQueue(): UsageEvent[] {
  try {
    const parsed: unknown = JSON.parse(read('local', QUEUE_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as UsageEvent[]) : []
  } catch {
    return []
  }
}

function saveQueue(queue: UsageEvent[]): void {
  write('local', QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)))
}

let pendingActivity: { sessionId: string; browserId: string; at: string; userId: string | null } | null = null
let flushTimer: number | null = null
let flushAt = 0
let inFlight = false

/** Keeps the earliest pending send: a long retry wait never delays a sooner one. */
function scheduleFlush(delay = FLUSH_DELAY_MS): void {
  const at = Date.now() + delay
  if (flushTimer !== null) {
    if (flushAt <= at) return
    window.clearTimeout(flushTimer)
  }
  flushAt = at
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flush()
  }, delay)
}

/** Send queued events. Re-sending is safe: the server ignores event ids it already has. */
async function flush(): Promise<void> {
  if (inFlight) {
    scheduleFlush()
    return
  }
  const queue = loadQueue()
  const events = queue.slice(0, BATCH)
  const activity = pendingActivity
  if (events.length === 0 && !activity) return
  inFlight = true
  pendingActivity = null
  // Headers are read now, so a sign-in that happens while the request runs cannot relabel it.
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  const token = getFeatureToken()
  if (token) headers['x-app-feature-token'] = token
  const session = getSession()
  if (session) headers['x-kl-session'] = session
  let delivered = false
  try {
    const res = await fetch('/api/analytics/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({ events, activity }),
      credentials: 'same-origin',
      keepalive: true,
    })
    // 400 = a batch the server will never accept; drop it instead of retrying forever.
    delivered = res.ok || res.status === 400
  } catch {
    delivered = false
  } finally {
    inFlight = false
  }
  if (delivered) {
    const sent = new Set(events.map((e) => e.eventId))
    const rest = loadQueue().filter((e) => !sent.has(e.eventId))
    saveQueue(rest)
    if (rest.length > 0) scheduleFlush(0)
  } else {
    pendingActivity = pendingActivity ?? activity
    scheduleFlush(RETRY_MS)
  }
}

function enqueue(type: UsageEventType, sessionId: string, page: string | null, eventId: string = crypto.randomUUID()): void {
  const queue = loadQueue()
  if (queue.some((e) => e.eventId === eventId)) return
  queue.push({ eventId, type, occurredAt: new Date().toISOString(), sessionId, browserId: browserId(), page, userId: staffUserId })
  saveQueue(queue)
  scheduleFlush()
}

function safely(fn: () => void): void {
  try {
    fn()
  } catch {
    // Analytics never breaks the app.
  }
}

let lastTouch = 0
let lastPing = 0

function onInteraction(): void {
  const now = Date.now()
  if (now - lastTouch < TOUCH_EVERY_MS) return
  lastTouch = now
  safely(() => {
    const sessionId = touchSession(now)
    if (now - lastPing < PING_EVERY_MS) return
    lastPing = now
    pendingActivity = { sessionId, browserId: browserId(), at: new Date(now).toISOString(), userId: staffUserId }
    scheduleFlush()
  })
}

let started = false

/** Once per page load: listeners for activity, sending when the tab hides, and leftovers. */
export function startAnalytics(): void {
  if (started) return
  started = true
  safely(() => {
    window.addEventListener('pointerdown', onInteraction, { passive: true })
    window.addEventListener('keydown', onInteraction, { passive: true })
    window.addEventListener('online', () => scheduleFlush(0))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush()
    })
    if (loadQueue().length > 0) scheduleFlush()
  })
}

/** Called by the login gate. Switching to a different staff account starts a new session. */
export function setAnalyticsUser(id: string | null): void {
  safely(() => {
    if (staffUserId && id && staffUserId !== id) write('local', SESSION_KEY, '')
    staffUserId = id
  })
}

/** "App opened": counted once per session per tab, so refreshing the page does not add visits. */
export function trackAppOpened(): void {
  safely(() => {
    const sessionId = touchSession()
    if (read('session', OPENED_KEY) === sessionId) return
    write('session', OPENED_KEY, sessionId)
    enqueue('app_opened', sessionId, null)
  })
}

/**
 * A page shown to the user. Repeats of the page this tab recorded last in the same session
 * (refresh, React re-render) are ignored. The POS screen also counts as "POS opened".
 */
export function trackPage(page: string): void {
  safely(() => {
    const sessionId = touchSession()
    const key = `${sessionId}:${page}`
    if (read('session', LAST_PAGE_KEY) === key) return
    write('session', LAST_PAGE_KEY, key)
    enqueue('page_viewed', sessionId, page)
    if (page === 'pos') enqueue('feature_opened', sessionId, 'pos')
  })
}

/** Sale started / completed: only that it happened — no bill contents. One event per id. */
export function trackSale(type: 'sale_started' | 'sale_completed', eventId: string): void {
  safely(() => enqueue(type, touchSession(), 'pos', eventId))
}
