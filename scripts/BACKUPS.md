# Backups

Every night, root's crontab runs `scripts/backup/backup.sh`. It dumps the
database and archives the files the app keeps on its own disk
(`storage/uploads`: workspace logos, avatars, and files saved while object
storage was unset or failing; and `public/uploads` while anything written
before Batch 11 is still there), encrypts both on the server, and copies them
to a bucket that is not the app's own. Without this,
the database and the local uploads exist only on the server's disk, and one
disk failure loses every customer's data.

Tested end to end on 2026-10-05 against a local database: the database URL
read from an app `.env` as text (a line in it that would run a command did
not run), dump with the password kept off the command line, encrypt, store,
then decrypt straight into `pg_restore` in a scratch database gave the same
211 tables and the same row counts; a wrong passphrase is refused.

## What you need first

1. **A bucket somewhere else.** Another provider or at least another region
   than the server and the app's own bucket, with its own access key. Give the
   key read, write and list on that bucket (each upload is read back to check
   its size, and a restore downloads), plus delete unless `BACKUP_PRUNE=off`.
   A key without delete makes pruning fail loudly every night, by design.
2. **A passphrase**, made once: `openssl rand -hex 32`. Store it in your
   password manager as well as on the server. Every backup is encrypted with
   it; without it, no backup can be read by anyone, you included.
3. **A copy of the app's secrets, off the server.** The backup holds the
   database and the uploads, not the app's `.env`. Keep at least
   `SECRETS_ENCRYPTION_KEY` and `NEXTAUTH_SECRET` in the password manager next
   to the passphrase, and update the copy at every rotation: a database
   restored without its `SECRETS_ENCRYPTION_KEY` cannot read any workspace's
   stored keys and tokens.
4. **A dead-man check**: a free check at healthchecks.io (or similar) that
   expects a ping every day and emails you when one is missed
   (`BACKUP_PING_URL`). Required with the setup below, where nothing else
   would notice that backups stopped.

The strongest setup also protects the backups from someone who takes over
the server, who can read the bucket key in `/etc/workwrk-backup.env`: turn
on **versioning** for the backup bucket with a rule that expires noncurrent
versions (keep the total under 90 days, the privacy policy's limit), or
**Object Lock**, and give the key no delete right, a lifecycle rule that
expires backups after 30 days, and `BACKUP_PRUNE=off`. Versioning or Object
Lock is what stops an overwrite: without one of them, a key that can write
can replace every old backup with an empty file.

## Install (once, as root on the server)

Root runs the backup, so root must own every file it runs: the app directory
belongs to `www`, and anything `www` can change must never run as root.

```
install -d -o root -g root -m 700 /usr/local/lib/workwrk-backup
install -o root -g root -m 700 /www/wwwroot/workwrk.com/scripts/backup/backup.sh /usr/local/lib/workwrk-backup/backup.sh
install -o root -g root -m 600 /www/wwwroot/workwrk.com/scripts/backup/store.mjs /usr/local/lib/workwrk-backup/store.mjs
cd /usr/local/lib/workwrk-backup && /www/server/nodejs/v20.20.0/bin/npm install --no-save @aws-sdk/client-s3
```

Then `/etc/workwrk-backup.env`, mode 600, owned by root. It names the
database itself: the script never runs the app's `.env` (it belongs to `www`;
running it as root would hand root to anything that can write as `www`).
Without `BACKUP_DATABASE_URL` it reads the `DATABASE_URL` line from the app's
`.env` as text, the database the app serves.

```
# Keep the quotes: a URL's ? and & would otherwise be read as shell syntax.
BACKUP_DATABASE_URL="<the app's DATABASE_URL>"
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
with Postgres 16 tools and the passphrase), as root. Run it as ONE block, in
the parentheses: everything loaded from `/etc/workwrk-backup.env` stays
inside it, so the passphrase and the bucket keys never stay in your shell
(where a later `pm2 ... --update-env` would copy them into the app). The
decrypted dump is every customer's data, so it is never written to disk: it
streams straight into `pg_restore`, and the encrypted copy sits in a folder
only root can read. `<app role>` is the database user in the app's
`DATABASE_URL`.

```
(
  umask 077
  export PATH="/www/server/nodejs/v20.20.0/bin:/www/server/pgsql/bin:$PATH"
  set -a && . /etc/workwrk-backup.env && set +a
  D=$(mktemp -d)
  cd /usr/local/lib/workwrk-backup
  node store.mjs list db/
  node store.mjs get db/<time>.dump.enc "$D/restore.dump.enc"
  sudo -u postgres createdb -O <app role> workwrk_restore_test
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$D/restore.dump.enc" \
    | sudo -u postgres pg_restore --no-owner --no-privileges --role=<app role> -d workwrk_restore_test
  psql "postgresql://<app role>:<password>@127.0.0.1:5432/workwrk_restore_test" -c 'SELECT count(*) FROM "User"'
  psql "postgresql://<app role>:<password>@127.0.0.1:5432/workwrk_restore_test" -c 'SELECT count(*) FROM "Organization"'
  sudo -u postgres dropdb workwrk_restore_test
  rm -rf "$D"
)
```

The counts should match production's (run the same two queries against it).
They are read as the app's own database user on purpose: a restore owned by
`postgres` with no grants would answer `postgres` and refuse the app, while
`/api/health` (which runs only `SELECT 1`) still answered 200. If the app's
user may create databases, run every step as that user instead of
`sudo -u postgres`. `psql` refuses Prisma's `?schema=` parameter: leave it off
the URL. Use the newest dump's `<time>` from the list line.

## Restore after a disaster

1. Stop the app: `pm2 stop workwrk`.
2. If the server's disk is gone, recreate the app's `.env` from your password
   manager's copy (above) before anything else, with the same
   `SECRETS_ENCRYPTION_KEY` and `NEXTAUTH_SECRET`.
3. Restore the newest dump into a NEW database owned by the app's user: the
   test restore's block, with `workwrk_restored` in place of
   `workwrk_restore_test` and without its last two lines (keep the database).
   Never restore over the damaged one: it may still hold what you need.
4. Point `DATABASE_URL` in the app's `.env` at the restored database, and
   `DIRECT_URL` too if the `.env` sets it (migrations and the Prisma CLI use
   it first), and `BACKUP_DATABASE_URL` in `/etc/workwrk-backup.env`, so
   tonight's backup dumps the database the app now serves. Renaming the
   databases instead covers all three. Then, from a fresh root shell (never
   one the backup settings were loaded into), `pm2 start workwrk`.
5. Check with the app's own user, not only `/api/health`: the two `psql`
   counts above against the restored database, then sign in and open a page
   with data on it.
6. Uploads, again as one block in parentheses:

   ```
   (
     umask 077
     export PATH="/www/server/nodejs/v20.20.0/bin:$PATH"
     set -a && . /etc/workwrk-backup.env && set +a
     D=$(mktemp -d)
     cd /usr/local/lib/workwrk-backup
     node store.mjs list uploads/
     node store.mjs get uploads/<time>.tar.gz.enc "$D/uploads.tar.gz.enc"
     openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$D/uploads.tar.gz.enc" \
       | tar -xzf - -C /www/wwwroot/workwrk.com
     rm -rf "$D"
   )
   chown -R www:www /www/wwwroot/workwrk.com/storage
   ```

   It holds `storage/uploads/` and, for an older backup, `public/uploads/`.
   Files restored into `public/uploads` move to `storage/uploads` by
   themselves at the next start.

Everything written after the backup's time is lost; tell the customers whose
workspaces changed in that window.

## The app's own bucket

Files, attachments and Scribe screenshots live in the app's object storage,
not in these backups. Turn on versioning for that bucket, with a lifecycle
rule that expires old versions after 30 days, so a file deleted by mistake
can be brought back and the privacy policy's 90 days still hold.
