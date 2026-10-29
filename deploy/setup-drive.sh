#!/usr/bin/env bash
# Connect Google Drive for backups (run on the VPS as root, once).
# The VPS has no browser, so rclone prints a command to run on YOUR PC:
#   rclone authorize "drive" "<code>"
# Run it on the PC (rclone is already installed there), sign in with the shop's Google
# account, and paste the token it prints back into this terminal.
set -euo pipefail
DATA_DIR=/var/lib/kasetlink-pos
ENV_FILE=/etc/kasetlink-pos/api.env
REMOTE_NAME=gdrive
FOLDER=${FOLDER:-KasetLink-POS-Backup}
export RCLONE_CONFIG=$DATA_DIR/rclone.conf

# scope drive.file: rclone only sees files it created itself, not the rest of the Drive.
sudo -u kasetlink RCLONE_CONFIG="$RCLONE_CONFIG" rclone config create "$REMOTE_NAME" drive scope=drive.file config_is_local=false

sudo -u kasetlink RCLONE_CONFIG="$RCLONE_CONFIG" rclone mkdir "$REMOTE_NAME:$FOLDER"
sed -i "s#^RCLONE_REMOTE=.*#RCLONE_REMOTE=$REMOTE_NAME:$FOLDER#" "$ENV_FILE"
chmod 0600 "$RCLONE_CONFIG"
chown kasetlink:kasetlink "$RCLONE_CONFIG"
systemctl restart kasetlink-pos

echo "Google Drive connected: $REMOTE_NAME:$FOLDER"
echo "Open POS → ตั้งค่า → สำรองข้อมูลไป Google Drive → ทดสอบการเชื่อมต่อ / สำรองเดี๋ยวนี้"
