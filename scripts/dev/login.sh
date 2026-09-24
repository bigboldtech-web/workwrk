#!/bin/zsh
# Usage: login.sh <email> <password> <cookie-out-file>
# Logs in through NextAuth credentials on the local smoke server and writes
# the session token value to the cookie file (for shot.mjs).
set -e
BASE=${BASE:-http://localhost:3007}
EMAIL="$1"; PASS="$2"; OUT="$3"
JAR=$(mktemp)
CSRF=$(curl -s -c "$JAR" "$BASE/api/auth/csrf" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).csrfToken))')
CODE=$(curl -s -b "$JAR" -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/callback/credentials" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=$EMAIL" --data-urlencode "password=$PASS" --data-urlencode "json=true")
TOKEN=$(grep "next-auth.session-token" "$JAR" | awk '{print $NF}')
print -n -- "$TOKEN" > "$OUT"
echo "login $EMAIL → HTTP $CODE, token bytes ${#TOKEN}"
rm -f "$JAR"
