import type { RequestCtx } from './gate.js'

export type AppEnv = { Variables: { ctx: RequestCtx } }
