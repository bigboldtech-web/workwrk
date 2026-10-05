#!/usr/bin/env bash
# Nightly off-site backup of WorkwrK: the database and the files the app keeps
# on its own disk (storage/uploads: logos, avatars, files saved while object
# storage was unset or failing; plus public/uploads, where they lived before
# Batch 11 moved them out, while anything is left there), each
# ENCRYPTED on this server, then copied to a bucket that is not the app's own.
#
# WHY. The database, its only dumps and the local uploads all sat on this one
# server's disk: one disk failure, one bad write or one operator mistake would
# have lost every customer's data, with no tested way back. Restoring is in
# scripts/BACKUPS.md, and a backup nobody has restored once is not one.
#
# Run by root's crontab (BACKUPS.md has the row). Settings come from
# /etc/workwrk-backup.env (mode 600, root only): the store (store.mjs) and
# BACKUP_PASSPHRASE, which encrypts every file and is ALSO kept off this
# server: without it no backup can be read, by anyone.
# The database URL is the app's own (.env in the app directory).
#
# Optional settings: BACKUP_KEEP_DAYS (default 30; the privacy policy promises
# backups are purged within 90 days of a deletion, so never more than 90),
# BACKUP_PING_URL (a dead-man check such as healthchecks.io: pinged on
# success, and at /fail on failure, so a backup that stops running is
# noticed), PG_DUMP (the pg_dump to use; it must be at least the server's
# version), BACKUP_STORE_JS (where store.mjs is installed), BACKUP_PRUNE=off
# (leave retention to the bucket's own lifecycle rule, for a key that cannot
# delete).
#
# ROOT RUNS IT, SO ROOT MUST OWN WHAT IT RUNS. The app directory belongs to
# www (the deploy chowns it), so BACKUPS.md installs this script and store.mjs
# into root-owned paths; never point root's crontab into the app directory.
set -euo pipefail

APP="${APP_DIR:-/www/wwwroot/workwrk.com}"
CONF="${BACKUP_CONF:-/etc/workwrk-backup.env}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STORE_JS="${BACKUP_STORE_JS:-$HERE/store.mjs}"
# aaPanel's Node and Postgres live off the default PATH.
export PATH="/www/server/nodejs/v20.20.0/bin:/www/server/pgsql/bin:$PATH"

ping_fail () {
  if [ -n "${BACKUP_PING_URL:-}" ]; then curl -fsS -m 10 "${BACKUP_PING_URL%/}/fail" > /dev/null 2>&1 || true; fi
}
trap 'echo "backup: FAILED at line $LINENO"; ping_fail' ERR

if [ -f "$CONF" ]; then set -a; . "$CONF"; set +a; fi
[ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "backup: BACKUP_PASSPHRASE is not set ($CONF); refusing to write an unencrypted backup"; ping_fail; exit 1; }
KEEP="${BACKUP_KEEP_DAYS:-30}"
case "$KEEP" in ''|*[!0-9]*) echo "backup: BACKUP_KEEP_DAYS must be a whole number of days"; ping_fail; exit 1 ;; esac
if [ "$KEEP" -lt 1 ] || [ "$KEEP" -gt 90 ]; then echo "backup: BACKUP_KEEP_DAYS must be 1 to 90 (the privacy policy promises backups are purged within 90 days)"; ping_fail; exit 1; fi

# The app's database URL, unless one was given (a test run).
if [ -z "${DATABASE_URL:-}" ] && [ -f "$APP/.env" ]; then set -a; . "$APP/.env"; set +a; fi
DB_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
[ -n "$DB_URL" ] || { echo "backup: no DATABASE_URL"; ping_fail; exit 1; }
# pg_dump refuses Prisma's own URL parameters (?schema=...); keep sslmode only.
PG_URL="${DB_URL%%\?*}"
SSLMODE=$(printf '%s' "$DB_URL" | sed -n 's/.*[?&]sslmode=\([^&]*\).*/\1/p')
[ -z "$SSLMODE" ] || PG_URL="$PG_URL?sslmode=$SSLMODE"
PG_DUMP="${PG_DUMP:-pg_dump}"

STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
WORK=$(mktemp -d "${TMPDIR:-/var/tmp}/workwrk-backup.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
encrypt () { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$1"; }

echo "backup: $STAMP database"
"$PG_DUMP" --format=custom --no-owner --no-privileges "$PG_URL" | encrypt "$WORK/db.dump.enc"
node "$STORE_JS" put "$WORK/db.dump.enc" "db/$STAMP.dump.enc"

# One archive of both places, as storage/uploads/... and public/uploads/...,
# so a restore puts each file back where the app reads it.
DIRS=""
[ -d "$APP/storage/uploads" ] && DIRS="$DIRS storage/uploads"
[ -d "$APP/public/uploads" ] && DIRS="$DIRS public/uploads"
if [ -n "$DIRS" ]; then
  echo "backup: $STAMP uploads"
  # shellcheck disable=SC2086
  tar -C "$APP" -czf - $DIRS | encrypt "$WORK/uploads.tar.gz.enc"
  node "$STORE_JS" put "$WORK/uploads.tar.gz.enc" "uploads/$STAMP.tar.gz.enc"
fi

if [ "${BACKUP_PRUNE:-on}" != "off" ]; then
  node "$STORE_JS" prune db/ "$KEEP"
  node "$STORE_JS" prune uploads/ "$KEEP"
fi

if [ -n "${BACKUP_PING_URL:-}" ]; then curl -fsS -m 10 "$BACKUP_PING_URL" > /dev/null 2>&1 || echo "backup: the success ping did not go through"; fi
echo "backup: $STAMP done"
