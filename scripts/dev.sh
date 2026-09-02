#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp deploy/.env.example .env
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

"$ROOT/scripts/download-livekit.sh"

if [[ ! -d apps/api/node_modules ]]; then
  (cd apps/api && npm install)
fi
if [[ ! -d apps/web/node_modules ]]; then
  (cd apps/web && npm install)
fi

"$ROOT/bin/livekit-server" --config "$ROOT/deploy/livekit.dev.yaml" &
LK_PID=$!
(cd apps/api && APP_PORT=8787 LIVEKIT_URL="$LIVEKIT_URL" LIVEKIT_API_KEY="$LIVEKIT_API_KEY" LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" npm run dev) &
API_PID=$!
(cd apps/web && npm run dev) &
WEB_PID=$!

cleanup() {
  kill "$LK_PID" "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "LiveKit  ws://127.0.0.1:7880"
echo "API      http://127.0.0.1:8787/api/health"
echo "UI       http://127.0.0.1:5173"
wait
