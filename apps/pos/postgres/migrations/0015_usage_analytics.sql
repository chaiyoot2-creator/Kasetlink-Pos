-- App usage analytics (owner / manager only). Separate from sales data on purpose:
-- events say only that something happened (app opened, page viewed, sale started /
-- completed) — no customer, product, bill contents, payment details or IP addresses.
-- browser_id is a random id kept in the browser (pseudonymous), session_id a random id
-- that rolls over after 30 minutes of inactivity.

CREATE TABLE public.usage_events (
  event_id UUID NOT NULL,
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  event_type TEXT NOT NULL CHECK (event_type IN ('app_opened', 'page_viewed', 'feature_opened', 'sale_started', 'sale_completed')),
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id UUID NOT NULL,
  browser_id UUID NOT NULL,
  -- Shop staff account signed in when the event happened (null = not signed in).
  app_user_id UUID,
  -- FuseBase user behind the app token, only when the platform provides one.
  fusebase_user_id TEXT,
  page TEXT CHECK (page IS NULL OR page ~ '^[a-z0-9._-]{1,40}$'),
  PRIMARY KEY (org_id, event_id)
);
CREATE INDEX usage_events_org_occurred_idx ON public.usage_events (org_id, occurred_at);

CREATE TABLE public.usage_sessions (
  session_id UUID NOT NULL,
  org_id TEXT NOT NULL DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  browser_id UUID NOT NULL,
  app_user_id UUID,
  started_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_id, session_id)
);
CREATE INDEX usage_sessions_org_started_idx ON public.usage_sessions (org_id, started_at);

-- Events are append-only; sessions are updated as activity arrives.
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_events_read ON public.usage_events FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''));
CREATE POLICY usage_events_append ON public.usage_events FOR INSERT
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));

ALTER TABLE public.usage_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_sessions_tenant ON public.usage_sessions FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
