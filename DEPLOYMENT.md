# Deployment

How WorkwrK runs in production: one self-hosted server (aaPanel) running
Postgres, nginx and the Next.js app under pm2. The live setup, every variable
and the hosts are in [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md); how a release
reaches the server is in [scripts/DEPLOY-NOTES.md](scripts/DEPLOY-NOTES.md).

## Releases

A push to `main` runs CI (type check and tests). When it passes, the Deploy
workflow deploys the newest commit on `main` whose CI passed on a push (an
automatic run never goes back, and does nothing when that commit is already
live; a re-run of CI never deploys): it applies the database migrations,
builds beside the live release, swaps the new build in, reloads pm2, checks
the new release answers, and puts the previous build back if it does not.
Releases go through the workflow. The only deploys by hand are the Going back
steps in [scripts/DEPLOY-NOTES.md](scripts/DEPLOY-NOTES.md), for when Actions
cannot run.

## Database

The schema changes through two paths, both applied by the deploy before the
build (`npm run deploy:migrate`, which runs only with `DEPLOY_MIGRATE=1`):

- `prisma/sql/*.sql` files listed in the manifest in
  `scripts/deploy-migrations.mjs`: additive and idempotent, each under a lock
  timeout, applied on every deploy.
- `prisma/migrations`: applied with `prisma migrate deploy` when one is
  pending.

Never run `prisma migrate dev`, `prisma migrate reset` or `prisma db push`
against production. Production has tables that no migration creates, so
`migrate dev` reports drift and offers to reset the database, which drops
every table. `npm run db:migrate`, `db:reset`, `db:seed` and `db:deploy`
refuse any database that is not `localhost:5432` (`scripts/require-local-db.mjs`),
because a developer's `.env` can be a tunnel to production. `npm run build`
only builds; it no longer touches a database.

## Environment variables

The full list, with the live values, is in
[LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md). `.env.example` is the template.

## Object storage

Scribe stores recorded SOP screenshots as S3 objects so the Postgres
rows stay small. The client works against any S3-compatible provider.

Required env vars:

| Var                      | Example (Linode, Chennai)                 |
| ------------------------ | ----------------------------------------- |
| `S3_ACCESS_KEY_ID`       | From provider's Access Keys page          |
| `S3_SECRET_ACCESS_KEY`   | From provider's Access Keys page          |
| `S3_BUCKET`              | `workwrk-scribe` (whatever you created)   |
| `S3_REGION`              | `in-maa-1`                                |
| `S3_ENDPOINT`            | `https://in-maa-1.linodeobjects.com`      |

For AWS S3, omit `S3_ENDPOINT`. For Cloudflare R2, set
`S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com` and
`S3_FORCE_PATH_STYLE=true`.

**Bucket CORS**: the Chrome extension PUTs directly from
`chrome-extension://*`, so the bucket needs these CORS rules:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`*` is safe here because uploads are gated by presigned URLs: an
attacker without a presigned URL can't upload regardless of origin.

**Bucket ACL**: keep the bucket **private**. Workwrk generates
short-lived presigned GET URLs at read time. No public-read policy
needed.

**Backfill**: if you have existing RECORDED SOPs stored inline, run
`npm run scribe:backfill` once after provisioning S3. Idempotent; safe
to rerun. Use `--dry-run` first.

Files that land on the server's disk instead (workspace logos, avatars, and
uploads made while object storage is unset or failing) are in
`storage/uploads`, outside `public/`, served only by the uploads route; the
nightly backup copies them (scripts/BACKUPS.md).

## Scheduled jobs

Root's crontab on the server, one `curl` per job, every one checking
`CRON_SECRET`: [scripts/CRON-SETUP.md](scripts/CRON-SETUP.md). `vercel.json`
is reference only. A job that fails answers 500, which the cron log records
as a failure, and emails `OPS_ALERT_EMAIL` when it is set (scripts/DEPLOY-NOTES.md,
"Email and alerts", says what counts as failed). The email-queue job's own
failure cannot email anyone, since that email would wait in the failing queue.

## Backups

Nightly, encrypted and off the server: [scripts/BACKUPS.md](scripts/BACKUPS.md).
Self-hosted Postgres gives no point-in-time recovery unless WAL archiving is
set up for it; until it is, the nightly backup is the only way back from a
lost disk or a bad write.

## Monitoring

- Uptime: an uptime monitor on `https://app.workwrk.com/api/health`, which
  answers 503 when the database is unreachable and names the build it serves.
- Scheduled jobs: `OPS_ALERT_EMAIL` (above), and for the email-queue job the
  dead-man check on its row (scripts/CRON-SETUP.md), a launch step in
  LAUNCH-CHECKLIST.md.
- Error tracking: not wired yet.

## Google sign in and Calendar

1. Create an OAuth client at
   [console.cloud.google.com](https://console.cloud.google.com/).
2. Authorized redirect URI:
   `https://<your-domain>/api/auth/callback/google`.
3. Paste `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The /login page
   auto-detects and shows the Google button.

## API keys and webhooks

Admins can generate API keys at **/settings/api** for programmatic
access. Developers can grab the OpenAPI spec at
`/api/v1/openapi.json` or read the reference at `/developers`.
