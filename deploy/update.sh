#!/usr/bin/env bash
# Update & redeploy btc.dataniilo.fi on the dataniilo server.
#
#   ssh dataniilo 'cd ~/btc-risk && ./deploy/update.sh'
#
# Pulls latest, rebuilds the image, restarts the container, prunes the
# now-dangling build layers, and health-checks the result.
set -euo pipefail

# repo root (this script lives in deploy/)
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."

echo "→ pulling latest…"
git pull --ff-only

echo "→ rebuilding & restarting…"
docker compose up -d --build

# Reclaim space: remove ONLY dangling (untagged) layers left by the rebuild.
# NOT -a (that would delete other apps' unused images on this shared server).
echo "→ pruning dangling images…"
docker image prune -f

echo "→ health check…"
sleep 3
# /login, not / — the root now 307s to /login for anonymous requests, and a
# 200 from /login also proves the auth stack booted (AUTH_SECRET present etc.)
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://localhost:3004/login || echo 000)"
echo "  localhost:3004/login → HTTP ${code}"
[ "${code}" = "200" ] || { echo "⚠ health check failed — check: docker logs btc-risk-metric"; exit 1; }

echo "✓ deployed"
