#!/usr/bin/env bash
# Connect Google Drive for POS backups (once; safe to re-run). Run from your PC:
#   ssh -t munjai-user@151.242.34.51 "sudo bash /opt/kasetlink-pos/deploy/coolify/setup-drive.sh"
# rclone asks "Use web browser to automatically authenticate?" → answer n. It then shows
#   rclone authorize "drive" "..."
# Run that on your PC (rclone is installed there), sign in with the shop's Google account,
# and paste the token it prints back here. The rclone config lives in the API container's
# /data volume, separate from 888bike HR.
set -euo pipefail
cd /opt/kasetlink-pos
FOLDER=${FOLDER:-KasetLink-POS-Backup}
API=kasetlink-pos-api-1

# scope drive.file: rclone only sees files it created itself, not the rest of the Drive.
if ! docker exec "$API" rclone listremotes | grep -qx 'gdrive:'; then
  docker exec "$API" rclone config create gdrive drive scope=drive.file --non-interactive >/dev/null
fi
# Interactive Google sign-in (headless flow).
docker exec -it "$API" rclone config reconnect gdrive:

docker exec "$API" rclone mkdir "gdrive:$FOLDER"
sed -i "s#^RCLONE_REMOTE=.*#RCLONE_REMOTE=gdrive:$FOLDER#" .env
docker compose -f deploy/coolify/docker-compose.yml --env-file .env up -d api
echo "Google Drive connected: gdrive:$FOLDER"
echo "เปิด POS → ตั้งค่า → สำรองข้อมูลไป Google Drive → ทดสอบการเชื่อมต่อ / สำรองเดี๋ยวนี้"
