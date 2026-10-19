#!/usr/bin/env bash
# One-command deployment for the Plesk application root.
#
# Run this ON THE PLESK SERVER, from anywhere:
#   bash scripts/deploy-plesk.sh
#
# Optional first deploy:
#   CREATE_SUPERADMIN=1 SUPERADMIN_EMAIL=you@example.com \
#     SUPERADMIN_PASSWORD='a-strong-password' bash scripts/deploy-plesk.sh
#
# The Plesk Node.js settings (Application root, Document root=dist, startup file
# server/start.mjs, Application mode=production, HTTPS) are one-time UI settings
# and are not changed by this script.

set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
CHECK_ONLY="${1:-}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

echo "==> Application root: $APP_DIR"
node -v
npm -v

[ -f package.json ] || fail "package.json not found in $APP_DIR"
[ -f server/start.mjs ] || fail "server/start.mjs not found"
[ -f .env ] || fail ".env is missing; create it before deploying"

for key in DB_HOST DB_USER DB_NAME; do
  grep -qE "^[[:space:]]*${key}=.+" .env || fail ".env is missing ${key}"
done

if [ -f .env.production ]; then
  grep -qE "^[[:space:]]*VITE_API_BASE_URL=/api[[:space:]]*$" .env.production \
    || fail ".env.production must contain VITE_API_BASE_URL=/api"
else
  if [ "$CHECK_ONLY" = "--check" ]; then
    fail ".env.production is missing; it must contain VITE_API_BASE_URL=/api"
  fi
  printf 'VITE_API_BASE_URL=/api\n' > .env.production
  echo "==> Created .env.production with VITE_API_BASE_URL=/api"
fi

if [ "$CHECK_ONLY" = "--check" ]; then
  echo "==> Preflight OK"
  exit 0
fi

echo "==> Installing dependencies (including build tools)"
npm ci --include=dev

echo "==> Building the SPA"
npm run build

[ -f dist/index.html ] || fail "dist/index.html was not produced"

echo "==> Type-checking the API"
npm run typecheck:api

echo "==> Applying migrations (includes the translation table and seed)"
npm run db:migrate

if [ "${CREATE_SUPERADMIN:-0}" = "1" ]; then
  : "${SUPERADMIN_EMAIL:?Set SUPERADMIN_EMAIL to create the first account}"
  : "${SUPERADMIN_PASSWORD:?Set SUPERADMIN_PASSWORD to create the first account}"
  echo "==> Creating the super-admin account"
  npm run create:superadmin -- "$SUPERADMIN_EMAIL" "$SUPERADMIN_PASSWORD"
fi

# Plesk runs Node through Passenger; touching this file asks it to restart.
# The UI's "Restart App" button remains the fallback.
if [ "${PLESK_RESTART:-1}" = "1" ]; then
  mkdir -p tmp
  touch tmp/restart.txt
  echo "==> Requested an application restart (tmp/restart.txt)"
fi

echo "==> Deployment complete"
echo "    Verify: https://YOUR-DOMAIN/api/health"
echo "    Then sign in with 'Enter as administrator' to see Traducciones."
