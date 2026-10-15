-- Scheduled backup to the shop's own Google Sheet (via an Apps Script web app).
-- One row per org. The secret is shared with the Apps Script so the sheet only
-- accepts writes from this app. Each run overwrites one tab per table.

CREATE TABLE public.backup_config (
  org_id TEXT PRIMARY KEY DEFAULT NULLIF(current_setting('app.org_id', true), ''),
  web_app_url TEXT,
  secret TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('hourly', 'every6h', 'daily')),
  run_hour SMALLINT NOT NULL DEFAULT 23 CHECK (run_hour BETWEEN 0 AND 23),
  last_run_at TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IN ('ok', 'error')),
  last_message TEXT,
  last_rows INTEGER,
  last_trigger TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.backup_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_config FORCE ROW LEVEL SECURITY;
CREATE POLICY backup_config_tenant ON public.backup_config FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
