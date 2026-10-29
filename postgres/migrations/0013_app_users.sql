-- Shop staff accounts inside the app: username + password (scrypt hash), a role with a
-- permission list, and a per-org signing secret for login sessions. The device still
-- opens the app through the shop's FuseBase account; this decides who is using it.

CREATE TABLE public.app_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  role_key TEXT,
  name TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  is_owner BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX app_roles_org_id_idx ON public.app_roles (org_id);

CREATE TABLE public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  username TEXT NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id UUID NOT NULL REFERENCES public.app_roles (id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  session_version INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, username)
);
CREATE INDEX app_users_org_id_idx ON public.app_users (org_id);

CREATE TABLE public.app_auth_config (
  org_id TEXT PRIMARY KEY DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  session_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY app_roles_tenant ON public.app_roles FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users FORCE ROW LEVEL SECURITY;
CREATE POLICY app_users_tenant ON public.app_users FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.app_auth_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_auth_config FORCE ROW LEVEL SECURITY;
CREATE POLICY app_auth_config_tenant ON public.app_auth_config FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
