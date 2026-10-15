import type { AppUser } from './auth.js'
import type { RequestCtx } from './gate.js'

/** ctx: FuseBase caller + store; appUser: the shop staff member signed in on this device. */
export type AppEnv = { Variables: { ctx: RequestCtx; appUser: AppUser | null } }
