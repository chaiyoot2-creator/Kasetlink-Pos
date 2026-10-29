import type { AppUser } from './auth.js'
import type { RequestCtx } from './db.js'

/** ctx: the shop (org_id for RLS); appUser: the shop staff member signed in on this device. */
export type AppEnv = { Variables: { ctx: RequestCtx; appUser: AppUser | null } }
