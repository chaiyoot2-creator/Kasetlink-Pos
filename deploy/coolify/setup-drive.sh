#!/usr/bin/env bash
# Connect Google Drive for POS backups (once). Run ON THE VPS in an SSH terminal:
#   ssh -t munjai-user@151.242.34.51 'sudo bash /opt/kasetlink-pos/deploy/coolify/setup-drive.sh'
# rclone shows a command `rclone authorize "drive" "..."`: run it on your PC (rclone is
# installed there), sign in with the shop's Google account, paste the token back here.
# The rclone config lives in the API container's /data volume, separate from 888bike HR.
set -euo pipefail
cd /opt/kasetlink-pos
FOLDER=${FOLDER:-KasetLink-POS-Backup}
API=kasetlink-pos-api-1

# scope drive.file: rclone only sees files it created itself, not the rest of the Drive.
docker exec -it "$API" rclone config create gdrive drive scope=drive.file config_is_local=false
docker exec "$API" rclone mkdir "gdrive:$FOLDER"
sed -i "s#^RCLONE_REMOTE=.*#RCLONE_REMOTE=gdrive:$FOLDER#" .env
docker compose -f deploy/coolify/docker-compose.yml --env-file .env up -d api
echo "Google Drive connected: gdrive:$FOLDER"
echo "เปิด POS → ตั้งค่า → สำรองข้อมูลไป Google Drive → ทดสอบการเชื่อมต่อ / สำรองเดี๋ยวนี้"
