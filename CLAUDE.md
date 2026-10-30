# KasetLink POS (Vercel + VPS) — notes for Claude

POS for an animal-feed / farm-supply shop (ธีรัตน์ฟีด). Users and UI text are Thai; keep
all user-facing strings and error messages in Thai. Self-hosted port of the FuseBase
version — there is no FuseBase here (no MCP, no `fusebase` CLI, no Gate SDK).
Branch `vps-vercel` is this version; `main` is the old FuseBase app — never push to or
rewrite `main`.

## Layout

- `src/` — React 18 + Vite + Tailwind 4 + shadcn/ui SPA, deployed on **Vercel**.
  Calls the API only through same-origin `/api/*` (`src/lib/api.ts` → `apiFetch`);
  `vercel.json` rewrites `/api` to the VPS. Never hardcode the API host in frontend code.
  Pages in `src/pages/`, shared pieces in `src/components/`, types in `src/lib/types.ts`.
- `backend/` — Hono on Node 22 (`backend/src/index.ts`), runs on the **VPS** in Docker.
  - `db.ts`: PostgreSQL access. `query()` (read-only) and `transaction()` (all-or-nothing,
    max 25 ops) run with `app.org_id` set, so RLS isolates rows. Use these, never a raw pool.
    Postgres errors become Thai `HttpError`s in `mapSqlError`; use `guardTerm()` for
    conditional updates (stock, credit limits).
  - `auth.ts`: staff login (`x-kl-session` header), roles and permissions; `RULES` maps
    paths to permissions. Every route except `/api/health`, `/api/files/*` and the public
    `/api/auth/*` paths needs a signed-in user.
  - Routes in `backend/src/routes/`; validate input with zod, read rows with `util.ts`
    (`str`, `num`, `bool`, …). Writes from the POS carry an `eventId` so retries don't
    double-record.
  - `backup.ts`: pg_dump (with `app.org_id`, `--enable-row-security`) + rclone → Google Drive,
    scheduled in-process from the settings in `backup_config`.
- `postgres/migrations/NNNN_name.sql` — applied in order by `backend/src/migrate.ts` when the
  container starts. **Never edit an applied migration; add a new numbered file.** Every new
  table needs `org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), '')`,
  `ENABLE` + `FORCE ROW LEVEL SECURITY` and a tenant policy, like `0002_rls.sql`.
- `deploy/coolify/` — the live deployment (Docker Compose behind Coolify's Traefik).
  `deploy/setup-vps.sh` / `update.sh` / `push.sh` are for a *fresh* VPS only; never run
  them on the current server.

## Check before calling a change done

```bash
npx tsc --noEmit && npm run build
cd backend && npx tsc --noEmit && npm run build
```
For UI changes, run both locally (`backend`: `npm run dev` with `DATABASE_URL` pointing at a
local PostgreSQL where the app role is NOT a superuser; root: `npm run dev`, which proxies
`/api` to :3001) and look at the page.

The user's PC is Windows: Windows PowerShell 5.1 has no `&&`, and script execution is
disabled, so in PowerShell use `npm.cmd` / `npx.cmd`. The deploy scripts need Git Bash.

## Deploying (ask the user first)

- **API / DB:** commit, then `bash deploy/coolify/deploy.sh` — ships `git archive HEAD` to
  `/opt/kasetlink-pos` and rebuilds; migrations run on start. Uncommitted changes are not sent.
  Then check `https://pos-api.151-242-34-51.sslip.io/api/health`.
- **Web:** `bash deploy/vercel-deploy.sh` (Vercel project `kasetlink-pos` is not linked to
  GitHub, so a push does not deploy). It stages the frontend outside the repo on purpose.
- Before any migration that changes or drops data, have the user press "สำรองเดี๋ยวนี้"
  in ตั้งค่า, and ask before destructive DB changes.
- After deploying, commit + `git push` so GitHub `vps-vercel` matches what runs.

## Production facts

- Web: https://pos.theeratfeed.co.th (DNS at Bangmod DirectAdmin, CNAME to Vercel),
  fallback https://kasetlink-pos.vercel.app.
- VPS: Munjai, Ubuntu 24.04, `munjai-user@151.242.34.51` (SSH key auth, passwordless sudo).
  The server also runs **Coolify and 888bike HR** — don't touch other containers, ports
  80/443, UFW or Nginx.
- Containers: `kasetlink-pos-api-1`, `kasetlink-pos-db-1` (postgres 17, owner role
  `pos_owner`, app role `pos`). Logs: `sudo docker logs kasetlink-pos-api-1 --tail 100`.
- Secrets live only in `/opt/kasetlink-pos/.env` on the VPS. Never print them, commit them,
  or copy them off the server.
- Backups: Google Drive `gdrive:KasetLink-POS-Backup` (rclone config in the api container's
  `/data` volume), 30 days; restore steps in README.md.
