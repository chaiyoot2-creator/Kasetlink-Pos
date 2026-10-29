#!/usr/bin/env bash
# Build and (re)start the API from /opt/kasetlink-pos/src. Run on the VPS as root;
# deploy/push.sh calls it after uploading new code.
set -euo pipefail
SRC_DIR=/opt/kasetlink-pos/src
ENV_FILE=/etc/kasetlink-pos/api.env

cd "$SRC_DIR/backend"
npm ci --omit=optional --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund

echo "==> Migrations"
set -a; . "$ENV_FILE"; set +a
MIGRATIONS_DIR="$SRC_DIR/postgres/migrations" node dist/migrate.js

systemctl restart kasetlink-pos
sleep 2
systemctl --no-pager --lines=5 status kasetlink-pos
curl -fsS http://127.0.0.1:3001/api/health && echo " <- API healthy"
