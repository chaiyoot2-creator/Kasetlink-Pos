#!/usr/bin/env bash
# Upload the API code from this PC to the VPS and rebuild it (Git Bash on Windows works).
#   VPS=munjai-user@151.242.34.51 bash deploy/push.sh            # update (after setup)
#   VPS=munjai-user@151.242.34.51 SETUP=1 bash deploy/push.sh    # first time: upload only
# Uses your SSH login; add an SSH key first (README step 1) so no password is typed each time.
set -euo pipefail
: "${VPS:?set VPS=user@ip}"
cd "$(dirname "$0")/.."

tar czf - --exclude=node_modules --exclude=dist --exclude=.pgdata --exclude=uploads --exclude='.env*' \
  backend postgres deploy \
  | ssh "$VPS" 'sudo mkdir -p /opt/kasetlink-pos/src && sudo tar xzf - -C /opt/kasetlink-pos/src'

if [ "${SETUP:-}" = "1" ]; then
  echo "Uploaded. Now run setup on the VPS (see README step 3)."
else
  ssh -t "$VPS" 'sudo bash /opt/kasetlink-pos/src/deploy/update.sh'
fi
