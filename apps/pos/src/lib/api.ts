/**
 * Deadline for every request this app makes. The backend scales to zero, so a
 * cold start can take ~10s; CloudFront aborts at 30s. Keep between 15000 and
 * 30000 — skill app-backend § Cold Starts (Scale-to-Zero).
 */
export const REQUEST_TIMEOUT_MS = 20000

function collectErrorObjects(error: unknown): Record<string, unknown>[] {
  if (!error || typeof error !== 'object') return []
  const err = error as Record<string, unknown>
  const nested = [err, err['data'], err['error'], err['body']]
  return nested.filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
}

/**
 * Detects AppTokenValidationError across different error shapes returned by the SDK.
 * Use this in every API call's catch block.
 */
export function isAppTokenValidationError(error: unknown): boolean {
  return collectErrorObjects(error).some((e) => e['name'] === 'AppTokenValidationError')
}

/**
 * Reads `reason` from an AppTokenValidationError payload (e.g. `missing_gate_service_token`, `expired`).
 */
export function extractAppTokenValidationReason(error: unknown): string | undefined {
  for (const e of collectErrorObjects(error)) {
    if (e['name'] !== 'AppTokenValidationError') continue
    const r = e['reason']
    return typeof r === 'string' && r.length > 0 ? r : undefined
  }
  return undefined
}

/**
 * Optional platform `hint` on AppTokenValidationError (e.g. from nx gate-service proxy).
 */
export function extractAppTokenValidationHint(error: unknown): string | undefined {
  for (const e of collectErrorObjects(error)) {
    if (e['name'] !== 'AppTokenValidationError') continue
    const h = e['hint']
    return typeof h === 'string' && h.length > 0 ? h : undefined
  }
  return undefined
}

/** Map a caught API error to the modal error type (reason + optional server hint). */
export function authErrorFromAppTokenFailure(error: unknown): AuthTokenExpiredError {
  return new AuthTokenExpiredError(extractAppTokenValidationReason(error), extractAppTokenValidationHint(error))
}

/** User-facing title + body for the auth modal; driven by platform `reason`, not only clock expiry. */
export function authUiForAppTokenReason(
  reason: string | undefined,
  serverHint?: string,
): { title: string; body: string } {
  if (reason === 'expired') {
    return {
      title: 'เซสชันหมดอายุ',
      body: 'การเข้าใช้งานหมดอายุแล้ว กรุณารีเฟรชหน้าเพื่อเข้าใช้งานต่อ (ข้อมูลที่บันทึกแล้วไม่หาย)',
    }
  }
  if (reason === 'missing_gate_service_token') {
    const title = 'Gate access missing from app token'
    const base =
      'This is not a browser session timeout. The platform issued an app token without the Gate (gst) part, so every Gate API call is rejected. Refresh once; if it persists, the app likely declares Gate permissions that your org role cannot receive together — review fusebaseGateMeta.permissions and org role matrix, or contact support with the x-request-id from the failed response.'
    const body = serverHint ? `${serverHint}\n\n${base}` : base
    return { title, body }
  }
  if (reason) {
    return {
      title: 'ยืนยันตัวตนไม่สำเร็จ',
      body: `ระบบปฏิเสธโทเคนของแอป (สาเหตุ: ${reason}) กรุณารีเฟรชหน้า หากยังเกิดซ้ำให้ติดต่อผู้ดูแลระบบ`,
    }
  }
  return {
    title: 'ยืนยันตัวตนไม่สำเร็จ',
    body: 'ระบบตรวจสอบสิทธิ์การใช้งานไม่ได้ กรุณารีเฟรชหน้าแล้วลองใหม่',
  }
}

/**
 * Thrown when Gate/dashboard returns AppTokenValidationError. Catch at the UI level to show AuthExpiredModal.
 * `appTokenReason` mirrors the server `reason` field when present.
 */
export class AuthTokenExpiredError extends Error {
  readonly appTokenReason: string | undefined
  readonly serverHint: string | undefined

  constructor(appTokenReason?: string, serverHint?: string) {
    const ui = authUiForAppTokenReason(appTokenReason, serverHint)
    super(ui.title)
    this.name = 'AuthTokenExpiredError'
    this.appTokenReason = appTokenReason
    this.serverHint = serverHint
  }
}

/** Read a cookie value by name. */
export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

/**
 * Read the app token. Checks the `fbsfeaturetoken` cookie first;
 * falls back to `window.FBS_FEATURE_TOKEN` if the cookie is absent.
 *
 * NOTE: cookie name and window global keep the legacy `feature` identifiers
 * because the dev-server proxy and platform runtime still emit those names.
 * Wire-protocol rename is tracked as a separate cleanup ticket.
 */
export function getFeatureToken(): string | null {
  return (window as Window & { FBS_FEATURE_TOKEN?: string }).FBS_FEATURE_TOKEN ?? getCookie('fbsfeaturetoken') ?? null
}

// ---------------------------------------------------------------- app backend client

/** Error from the app backend, carrying its Thai message. */
export class ApiFailure extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, message: string, code: string) {
    super(message)
    this.name = 'ApiFailure'
    this.status = status
    this.code = code
  }
}

// ---------------------------------------------------------------- shop staff session

const SESSION_KEY = 'kasetlink.session'
let memorySession: string | null = null

/** Staff login token for this device (also sent as an httpOnly cookie by the backend). */
export function getSession(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY) ?? memorySession
  } catch {
    return memorySession
  }
}

export function setSession(token: string): void {
  memorySession = token
  try {
    window.localStorage.setItem(SESSION_KEY, token)
  } catch {
    // Storage blocked: the session lasts until the page is closed.
  }
}

export function clearSession(): void {
  memorySession = null
  try {
    window.localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

let sessionListener: (() => void) | null = null

/** The login gate registers this to show the login screen when the session ends. */
export function onSessionEnded(listener: (() => void) | null): void {
  sessionListener = listener
}

type AuthListener = (err: AuthTokenExpiredError) => void
let authListener: AuthListener | null = null

/** App shell registers this to show AuthExpiredModal on 401. */
export function onAuthExpired(listener: AuthListener | null): void {
  authListener = listener
}

function readErrorBody(body: unknown): { message: string; code: string } {
  if (body && typeof body === 'object') {
    const err = (body as { error?: unknown }).error
    const code = (body as { code?: unknown }).code
    return {
      message: typeof err === 'string' ? err : 'เกิดข้อผิดพลาด',
      code: typeof code === 'string' ? code : 'error',
    }
  }
  return { message: 'เกิดข้อผิดพลาด', code: 'error' }
}

async function requestOnce(path: string, method: string, body: unknown): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getFeatureToken()
  if (token) headers['x-app-feature-token'] = token
  const session = getSession()
  if (session) headers['x-kl-session'] = session
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    return await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * Call the app backend. GETs retry once on network / 5xx (backend cold start);
 * writes are not retried here — they carry an eventId so the user can safely press again.
 */
export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? 'GET'
  let res: Response
  try {
    res = await requestOnce(path, method, options.body)
    if (method === 'GET' && res.status >= 502) {
      await new Promise((r) => setTimeout(r, 800))
      res = await requestOnce(path, method, options.body)
    }
  } catch (err) {
    if (method === 'GET') {
      try {
        await new Promise((r) => setTimeout(r, 800))
        res = await requestOnce(path, method, options.body)
      } catch {
        throw new ApiFailure(0, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'network')
      }
    } else {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      throw new ApiFailure(
        0,
        aborted
          ? 'เซิร์ฟเวอร์ตอบช้า ไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ กดบันทึกซ้ำได้ ระบบจะไม่บันทึกซ้ำ'
          : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
        'network',
      )
    }
  }

  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }
  if (!res.ok) {
    if (isAppTokenValidationError(parsed)) {
      const authErr = authErrorFromAppTokenFailure(parsed)
      authListener?.(authErr)
      throw new ApiFailure(401, authErr.message, 'auth_expired')
    }
    const { message, code } = readErrorBody(parsed)
    if (code === 'app_login_required') {
      // The shop staff session ended (expired, signed out elsewhere, role changed).
      clearSession()
      sessionListener?.()
    } else if (res.status === 401 && code !== 'login_failed') {
      authListener?.(new AuthTokenExpiredError('expired'))
    }
    throw new ApiFailure(res.status, message, code)
  }
  return parsed as T
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiFailure) return err.message
  if (err instanceof Error) return err.message
  return 'เกิดข้อผิดพลาด'
}
