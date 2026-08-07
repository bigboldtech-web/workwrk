#!/usr/bin/env bash
# Emergency manual deploy to the aaPanel production server.
#
# ⚠️  DO NOT run this while the GitHub Actions pipeline is alive.
# The normal paths, in order of preference:
#   1. Push to main            -> CI -> Deploy (automatic)
#   2. Actions "Deploy" -> Run workflow (workflow_dispatch) — same pipeline,
#      serialized by the deploy-production concurrency group.
# This script exists ONLY for when Actions itself is down. It refuses to run
# if a Deploy workflow run is queued or in progress (2026-08-07 outage: a raw
# SSH deploy raced the pipeline deploy in the same directory; the interleaved
# npm ci + double build produced module-not-found chaos, pm2 reloaded onto an
# incomplete .next, and prod served 502s until the pipeline's own serialized
# run rebuilt it).
#
# Lessons encoded here:
#   - Never pipe the build through tail/head: the pipeline exit code masks a
#     failed build and pm2 then reloads onto a broken .next. Capture rc
#     directly, log to a file, and abort before touching pm2.
#   - Check server memory before building (the build wants a 4GB heap; the
#     box has 4GB RAM + 4GB swap, but a crashlooping app can eat it).
set -euo pipefail

HOST="root@172.236.169.129"
KEY="$HOME/.ssh/workwrk_deploy"
DIR="/www/wwwroot/workwrk.com"
REPO="bigboldtech-web/workwrk"

# ── Guard: refuse to race the Actions pipeline ──────────────────────────────
TOKEN=$(printf "protocol=https\nhost=github.com\n" | git credential fill 2>/dev/null | sed -n 's/^password=//p' || true)
if [ -n "$TOKEN" ]; then
  ACTIVE=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://api.github.com/repos/$REPO/actions/workflows/deploy.yml/runs?per_page=5" |
    python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for r in d.get('workflow_runs',[]) if r['status'] in ('queued','in_progress')))" 2>/dev/null || echo "?")
  if [ "$ACTIVE" != "0" ] && [ "$ACTIVE" != "?" ]; then
    echo "ABORT: $ACTIVE Deploy workflow run(s) queued/in progress. Let the pipeline finish." >&2
    exit 1
  fi
else
  echo "WARN: no GitHub token available — cannot verify the pipeline is idle. Ctrl-C now if unsure." >&2
  sleep 5
fi

ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=10 "$HOST" 'bash -s' <<'DEPLOY'
set -euo pipefail
export PATH=/www/server/nodejs/v20.20.0/bin:$PATH
cd /www/wwwroot/workwrk.com

AVAIL=$(free -m | awk '/^Mem:/{print $7}')
if [ "$AVAIL" -lt 1024 ]; then
  echo "ABORT: only ${AVAIL}MB available memory — building now risks another OOM outage." >&2
  echo "Find what is eating memory (pm2 list, top) before deploying." >&2
  exit 1
fi

echo "==> Fetching latest main"
git fetch --prune origin main
git reset --hard origin/main
git log --oneline -1

echo "==> Installing dependencies"
npm ci --legacy-peer-deps --no-audit --no-fund

echo "==> Building (full log: /root/deploy-build.log)"
if ! npm run build > /root/deploy-build.log 2>&1; then
  echo "BUILD FAILED — pm2 NOT reloaded, old app still serving. Last 30 log lines:" >&2
  tail -30 /root/deploy-build.log >&2
  exit 1
fi
test -f .next/BUILD_ID || { echo "BUILD_ID missing after build — refusing to reload pm2." >&2; exit 1; }
echo "BUILD_ID: $(cat .next/BUILD_ID)"

echo "==> Restoring ownership to www"
chown -R www:www /www/wwwroot/workwrk.com

echo "==> Reloading PM2 process"
pm2 reload workwrk --update-env

echo "==> Deploy complete"
DEPLOY

echo "==> Verifying public site"
sleep 5
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://workwrk.com)
echo "workwrk.com: $CODE"
[ "$CODE" = "200" ] || { echo "Site is NOT healthy after deploy." >&2; exit 1; }
