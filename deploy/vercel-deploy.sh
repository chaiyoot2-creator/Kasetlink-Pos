#!/usr/bin/env bash
# Deploy only the web app to Vercel from this PC (Git Bash), without GitHub integration.
#   bash deploy/vercel-deploy.sh            # production
#   PREVIEW=1 bash deploy/vercel-deploy.sh  # preview URL
# Vercel would otherwise detect backend/ (Hono) as a second service, so the frontend files
# are copied into ~/.kasetlink-pos-web and deployed from there. That folder is outside the
# git repo on purpose: with commit metadata attached, Vercel blocks deploys whose commit
# author is not linked to the Vercel account. Needs `npx vercel login` once.
set -euo pipefail
cd "$(dirname "$0")/.."
STAGE="$HOME/.kasetlink-pos-web"

mkdir -p "$STAGE"
find "$STAGE" -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} +
cp -r src index.html package.json package-lock.json vite.config.ts tsconfig.json postcss.config.js components.json vercel.json "$STAGE"/

cd "$STAGE"
[ -f .vercel/project.json ] || npx --yes vercel@latest link --yes --project kasetlink-pos
if [ "${PREVIEW:-}" = "1" ]; then
  npx --yes vercel@latest deploy --yes
else
  npx --yes vercel@latest deploy --prod --yes
fi
