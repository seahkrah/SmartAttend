#!/usr/bin/env bash
# Starts the API (http://localhost:5000) and the web app (http://localhost:5173)
# together; Ctrl+C stops both. Run scripts/setup-local.sh first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/apps/backend/.env" ] || { echo "Run scripts/setup-local.sh first."; exit 1; }
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx jjelotech-dev-db; then
  docker start jjelotech-dev-db >/dev/null
fi

(cd "$ROOT/apps/backend" && npm run dev) &
API=$!
(cd "$ROOT/apps/frontend" && npm run dev -- --port 5173 --strictPort) &
WEB=$!
trap 'kill $API $WEB 2>/dev/null; wait 2>/dev/null' INT TERM EXIT

echo
echo "  API:     http://localhost:5000/api/health"
echo "  Web app: http://localhost:5173"
echo "  Ctrl+C stops both."
echo
wait
