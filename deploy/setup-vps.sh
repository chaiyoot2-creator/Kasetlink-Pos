#!/usr/bin/env bash
# One-time setup of the KasetLink POS API on a fresh Munjai Cloud VPS (Ubuntu 24.04).
# Run as root (or with sudo) ON THE VPS:
#   sudo API_DOMAIN=api.yourshop.com WEB_ORIGINS=https://pos.yourshop.com CERT_EMAIL=you@example.com \
#        bash /opt/kasetlink-pos/src/deploy/setup-vps.sh
# Safe to re-run: existing database password, env file and certificates are kept.
set -euo pipefail

: "${API_DOMAIN:?set API_DOMAIN, e.g. api.yourshop.com (DNS A record must point to this VPS)}"
: "${WEB_ORIGINS:?set WEB_ORIGINS, the Vercel URL(s) of the web app, comma separated}"
: "${CERT_EMAIL:?set CERT_EMAIL for Let-s-Encrypt certificate expiry notices}"

APP_USER=kasetlink
APP_DIR=/opt/kasetlink-pos
SRC_DIR=$APP_DIR/src
DATA_DIR=/var/lib/kasetlink-pos
BACKUP_DIR=/var/backups/kasetlink-pos
ENV_DIR=/etc/kasetlink-pos
ENV_FILE=$ENV_DIR/api.env

echo "==> Packages (Nginx, PostgreSQL 16, Certbot, UFW, Fail2Ban, rclone, Node.js 22)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg nginx postgresql postgresql-client certbot python3-certbot-nginx ufw fail2ban rclone
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y && apt-get install -y nodejs
fi

echo "==> Firewall + Fail2Ban (as in the Munjai Fail2Ban guide)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
cat > /etc/fail2ban/jail.d/kasetlink.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> App user and folders"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR" "$DATA_DIR/uploads" "$BACKUP_DIR"
install -d -m 0755 "$APP_DIR"
install -d -m 0750 -g "$APP_USER" "$ENV_DIR"

echo "==> PostgreSQL role + database (non-superuser so row-level security applies)"
systemctl enable --now postgresql
if [ -f "$ENV_FILE" ]; then
  DB_PASS=$(grep -oP '^DATABASE_URL=postgres://pos:\K[^@]+' "$ENV_FILE")
else
  DB_PASS=$(openssl rand -hex 24)
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos') THEN
    CREATE ROLE pos LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE pos PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='kasetlink_pos'" | grep -q 1 \
  || sudo -u postgres createdb -O pos kasetlink_pos

echo "==> $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgres://pos:$DB_PASS@127.0.0.1:5432/kasetlink_pos
PORT=3001
HOST=127.0.0.1
PUBLIC_API_URL=https://$API_DOMAIN
CORS_ORIGINS=$WEB_ORIGINS
UPLOAD_DIR=$DATA_DIR/uploads
BACKUP_DIR=$BACKUP_DIR
BACKUP_KEEP_DAYS=30
# Set after running deploy/setup-drive.sh:
RCLONE_REMOTE=
RCLONE_CONFIG=$DATA_DIR/rclone.conf
EOF
else
  sed -i "s#^CORS_ORIGINS=.*#CORS_ORIGINS=$WEB_ORIGINS#; s#^PUBLIC_API_URL=.*#PUBLIC_API_URL=https://$API_DOMAIN#" "$ENV_FILE"
fi
chown root:"$APP_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

echo "==> systemd service"
cat > /etc/systemd/system/kasetlink-pos.service <<EOF
[Unit]
Description=KasetLink POS API
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$SRC_DIR/backend
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR $BACKUP_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable kasetlink-pos

echo "==> Nginx reverse proxy for $API_DOMAIN"
cat > /etc/nginx/sites-available/kasetlink-pos <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $API_DOMAIN;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/kasetlink-pos /etc/nginx/sites-enabled/kasetlink-pos
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Build, migrate, start"
bash "$SRC_DIR/deploy/update.sh"

echo "==> HTTPS (Let's Encrypt, as in the Munjai SSL guide)"
certbot --nginx -d "$API_DOMAIN" -m "$CERT_EMAIL" --agree-tos --non-interactive --redirect

echo
echo "Done. Check: curl https://$API_DOMAIN/api/health"
echo "Next: connect Google Drive with  sudo bash $SRC_DIR/deploy/setup-drive.sh"
