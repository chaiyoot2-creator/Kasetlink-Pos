-- Backup moves from Google Sheet (Apps Script) to pg_dump + rclone → Google Drive.
-- web_app_url / secret stay for history; the new columns describe the last dump file.

ALTER TABLE public.backup_config ADD COLUMN last_file TEXT;
ALTER TABLE public.backup_config ADD COLUMN last_bytes BIGINT;
ALTER TABLE public.backup_config ALTER COLUMN run_hour SET DEFAULT 2;
