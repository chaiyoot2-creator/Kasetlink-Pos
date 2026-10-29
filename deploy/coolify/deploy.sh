#!/usr/bin/env bash
# Ship the committed code (HEAD) to the Munjai VPS and (re)build the API container.
# Run from this PC in Git Bash:  bash deploy/coolify/deploy.sh
# First run creates /opt/kasetlink-pos/.env on the VPS with random database passwords
# (they never leave the server). Migrations run when the container starts.
set -euo pipefail
cd "$(dirname "$0")/../.."
VPS=${VPS:-munjai-user@151.242.34.51}
API_HOST=${API_HOST:-pos-api.151-242-34-51.sslip.io}
WEB_ORIGIN=${WEB_ORIGIN:-https://pos.theeratfeed.co.th}

git archive --format=tar.gz HEAD | ssh "$VPS" 'sudo mkdir -p /opt/kasetlink-pos && sudo tar -xzf - -C /opt/kasetlink-pos'

ssh "$VPS" "API_HOST='$API_HOST' WEB_ORIGIN='$WEB_ORIGIN' sudo -E bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/kasetlink-pos
if [ ! -f .env ]; then
  umask 077
  cat > .env <<EOF
OWNER_DB_PASSWORD=$(openssl rand -hex 24)
APP_DB_PASSWORD=$(openssl rand -hex 24)
API_HOST=$API_HOST
WEB_ORIGIN=$WEB_ORIGIN
# Set by deploy/coolify/setup-drive.sh
RCLONE_REMOTE=
BACKUP_KEEP_DAYS=30
EOF
  echo "created /opt/kasetlink-pos/.env"
fi
chmod 600 .env
chmod +x deploy/coolify/initdb/*.sh
docker compose -f deploy/coolify/docker-compose.yml --env-file .env up -d --build
docker image prune -f >/dev/null
sleep 8
docker compose -f deploy/coolify/docker-compose.yml --env-file .env ps --format '{{.Name}}\t{{.Status}}'
REMOTE

for i in 1 2 3 4 5 6; do
  if curl -fsS "https://$API_HOST/api/health"; then echo "  <- https://$API_HOST healthy"; exit 0; fi
  sleep 10
done
echo "API not healthy yet; check: ssh $VPS 'sudo docker logs kasetlink-pos-api-1 --tail 50'" >&2
exit 1
