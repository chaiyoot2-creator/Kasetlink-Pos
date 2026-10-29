import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'

/** Error with a Thai, user-facing message. */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string

  constructor(status: ContentfulStatusCode, message: string, code = 'error') {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export function handleError(err: Error, c: Context) {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, code: err.code }, err.status)
  }
  if (err instanceof ZodError) {
    const first = err.issues[0]
    const field = first?.path.join('.') ?? ''
    return c.json(
      { error: `ข้อมูลไม่ถูกต้อง${field ? ` (${field})` : ''}: ${first?.message ?? ''}`, code: 'validation' },
      400,
    )
  }
  console.error('[unhandled]', err)
  return c.json({ error: 'เกิดข้อผิดพลาดในระบบ', code: 'internal' }, 500)
}
