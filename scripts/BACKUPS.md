# Backups

Every night, root's crontab runs `scripts/backup/backup.sh`. It dumps the
database and archives `public/uploads` (workspace logos, avatars, and files
saved while object storage was unset or failing), encrypts both on the
server, and copies them to a bucket that is not the app's own. Without this,
the database and the local uploads exist only on the server's disk, and one
disk failure loses every customer's data.

Tested end to end on 2026-10-05 against a local database: dump, encrypt,
store, fetch, decrypt and `pg_restore` into a scratch database gave the same
211 tables and the same row counts; a wrong passphrase is refused.

## What you need first

1. **A bucket somewhere else.** Another provider or at least another region
   than the server and the app's own bucket, with its own access key. Give the
   key write and list on that bucket only. The strongest setup: a key that
   cannot delete, a lifecycle rule on the bucket that expires objects after 30
   days, and `BACKUP_PRUNE=off` (below), so not even root on the server can
   remove old backups.
2. **A passphrase**, made once: `openssl rand -hex 32`. Store it in your
   password manager as well as on the server. Every backup is encrypted with
   it; without it, no backup can be read by anyone, you included.
3. **Optional, a dead-man check**: a free check at healthchecks.io (or
   similar) that expects a ping every day and emails you when one is missed.

## Install (once, as root on the server)

Root runs the backup, so root must own every file it runs: the app directory
belongs to `www`, and anything `www` can change must never run as root.

```
install -d -o root -g root -m 700 /usr/local/lib/workwrk-backup
install -o root -g root -m 700 /www/wwwroot/workwrk.com/scripts/backup/backup.sh /usr/local/lib/workwrk-backup/backup.sh
install -o root -g root -m 600 /www/wwwroot/workwrk.com/scripts/backup/store.mjs /usr/local/lib/workwrk-backup/store.mjs
cd /usr/local/lib/workwrk-backup && /www/server/nodejs/v20.20.0/bin/npm install --no-save @aws-sdk/client-s3
```

Then `/etc/workwrk-backup.env`, mode 600, owned by root:

```
BACKUP_PASSPHRASE=<the passphrase>
BACKUP_S3_BUCKET=<bucket>
BACKUP_S3_REGION=<region>
BACKUP_S3_ACCESS_KEY_ID=<key id>
BACKUP_S3_SECRET_ACCESS_KEY=<secret>
# For a provider other than AWS:
BACKUP_S3_ENDPOINT=https://<provider endpoint>
# BACKUP_S3_FORCE_PATH_STYLE=true      (Cloudflare R2, MinIO)
# BACKUP_KEEP_DAYS=30                  (1 to 90; the privacy policy allows no more than 90)
# BACKUP_PRUNE=off                     (when a bucket lifecycle rule expires old backups)
# BACKUP_PING_URL=https://hc-ping.com/<uuid>
```

Run it once by hand and read the output:

```
/usr/local/lib/workwrk-backup/backup.sh
```

It prints the database step, `stored db/<time>.dump.enc (<n> bytes)`, the
same for uploads, the prune lines and `done`. Then add the crontab row
(`crontab -e`, next to the WorkwrK block; no `%` anywhere in the line):

```
15 2 * * * /usr/local/lib/workwrk-backup/backup.sh >> /var/log/workwrk-backup.log 2>&1
```

When the script in the repository changes, repeat the two `install` lines;
the deploy never changes the root-owned copy.

## Do one test restore now, and after any change

A backup nobody has restored is not a backup. On the server (or any machine
with Postgres 16 tools and the passphrase), as root:

```
set -a && . /etc/workwrk-backup.env && set +a
cd /usr/local/lib/workwrk-backup
node store.mjs list db/
node store.mjs get db/<time>.dump.enc /var/tmp/restore.dump.enc
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
  -in /var/tmp/restore.dump.enc -out /var/tmp/restore.dump
createdb workwrk_restore_test
pg_restore --no-owner --no-privileges -d workwrk_restore_test /var/tmp/restore.dump
psql -d workwrk_restore_test -c 'SELECT count(*) FROM "User"'
psql -d workwrk_restore_test -c 'SELECT count(*) FROM "Organization"'
dropdb workwrk_restore_test
rm -f /var/tmp/restore.dump /var/tmp/restore.dump.enc
```

The counts should match production's (run the same two queries against it).
`createdb`, `psql` and `pg_restore` may need `-U <user>` and `-h 127.0.0.1`,
or `sudo -u postgres`, depending on how Postgres was installed.

## Restore after a disaster

1. Stop the app: `pm2 stop workwrk`.
2. Fetch and decrypt the newest dump (above).
3. Restore into a NEW database (`createdb workwrk_restored`, then
   `pg_restore --no-owner --no-privileges -d workwrk_restored ...`). Never
   restore over the damaged one: it may still hold what you need.
4. Point `DATABASE_URL` in the app's `.env` at the restored database (or
   rename the databases), then `pm2 start workwrk` and check
   `https://app.workwrk.com/api/health`.
5. Uploads: fetch and decrypt the newest `uploads/<time>.tar.gz.enc`, then
   `openssl enc -d ... | tar -xzf - -C /www/wwwroot/workwrk.com/public` and
   `chown -R www:www /www/wwwroot/workwrk.com/public/uploads`.

Everything written after the backup's time is lost; tell the customers whose
workspaces changed in that window.

## The app's own bucket

Files, attachments and Scribe screenshots live in the app's object storage,
not in these backups. Turn on versioning for that bucket, with a lifecycle
rule that expires old versions after 30 days, so a file deleted by mistake
can be brought back and the privacy policy's 90 days still hold.
