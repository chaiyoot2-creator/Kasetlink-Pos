#!/bin/sh
# First start of the db container only: the app role `pos` (not a superuser, so RLS applies)
# becomes the owner of the database and its public schema; migrations then run as `pos`.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE pos LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_DB_PASSWORD}';
ALTER DATABASE kasetlink_pos OWNER TO pos;
ALTER SCHEMA public OWNER TO pos;
SQL
