# WorkwrK production setup

Last checked against the code: 2026-10-05.

What the live server must have, in one place. The detail lives in the files
this one links to; where they say more, they win. Generate every secret on the
server (`openssl rand -hex 32`) and never write a value into this repository:
it is public.

- [scripts/DEPLOY-NOTES.md](scripts/DEPLOY-NOTES.md): how a release reaches
  the server, the Staff console host, nginx, email, alerts.
- [scripts/CRON-SETUP.md](scripts/CRON-SETUP.md): the scheduled jobs, which
  live in root's crontab (not the aaPanel Cron UI), and rotating `CRON_SECRET`.
- [scripts/BACKUPS.md](scripts/BACKUPS.md): the nightly off-site backup and
  how to restore it.
- [scripts/MIGRATIONS.md](scripts/MIGRATIONS.md): data scripts, which are run
  by hand, never by the deploy.

## The hosts

| Host | Serves | Set by |
| --- | --- | --- |
| `workwrk.com` | The marketing site | `MARKETING_HOST` |
| `app.workwrk.com` | The product | `APP_HOST`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` |
| `admin.workwrk.com` | The Staff console | `ADMIN_HOST` |

All three are one Node process (pm2 `workwrk`) behind nginx; `src/proxy.ts`
splits them by the `Host` header, so nginx must forward it unchanged.

Cloudflare stays **DNS only** (grey cloud) for all three. Proxying through
Cloudflare makes every visitor's address Cloudflare's: the sign-in lockout,
every per-address limit and the Staff console's IP log would all key on it.
Turn the proxy on only after nginx sets `real_ip_header` and
`set_real_ip_from` for Cloudflare's ranges (DEPLOY-NOTES, "The client
address").

## Environment variables

They live in the app's `.env` on the server (`/www/wwwroot/workwrk.com/.env`).
After a change: `pm2 reload workwrk --update-env`. A `NEXT_PUBLIC_` variable
(`NEXT_PUBLIC_APP_URL`) is built into the release instead: a change to it
takes effect at the next deploy (Actions > Deploy > Run workflow), not at a
reload.

### Required

| Variable | Live value | What it does |
| --- | --- | --- |
| `DATABASE_URL` | the production Postgres URL | Everything: the app reads only this one. |
| `DIRECT_URL` | unset, or the same database | Optional. When set, migrations and the Prisma CLI use it instead of `DATABASE_URL`, so it must name the same database (after a restore, point both at the restored one). |
| `NEXTAUTH_URL` | `https://app.workwrk.com` | Sign-in, links in emails, and the address the deploy checks a new release at. |
| `NEXTAUTH_SECRET` | a secret | Signs sessions and upload names. Changing it signs everyone out. |
| `NEXT_PUBLIC_APP_URL` | `https://app.workwrk.com` | Absolute links from the Staff console and the marketing site into the product. |
| `APP_HOST` | `app.workwrk.com` | The product's host. Never the apex: with `HARD_HOST_SPLIT` on, an `APP_HOST` equal to `MARKETING_HOST` redirects every page to itself. |
| `MARKETING_HOST` | `workwrk.com` | The marketing site's host. |
| `ADMIN_HOST` | `admin.workwrk.com` | Puts the Staff console on its own host and hides it everywhere else (DEPLOY-NOTES). |
| `HARD_HOST_SPLIT` | `true` | Product pages only on the app host, marketing pages only on the marketing host. |
| `AUTH_EDGE_GATE` | `true` | A signed-out request for a product page goes to `/login` before the app loads. |
| `ENFORCE_MFA_AT_LOGIN` | `true` | Asks everyone who turned on two-step verification for their code at sign in. |
| `COOKIE_DOMAIN` | `.workwrk.com` | One sign-in for the app and Staff console hosts. |
| `CRON_SECRET` | a secret | Every `/api/cron` job checks it; unset, they answer 503 and run nothing. The crontab reads it from `/etc/profile.d/workwrk.sh` (CRON-SETUP). |
| `SECRETS_ENCRYPTION_KEY` | a 32-byte secret | Encrypts stored integration tokens and secrets. Rotate with `scripts/rotate-secrets-key.ts`, never by editing it alone. |
| `EMAIL_ENABLED` | `true` | Without it no email leaves the server: in production the queue is held (nothing is marked sent) and the email-queue job answers 503 while any email is waiting. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | your mail provider's | How email is sent: the host always, the user and password for a mail server that needs a login. |
| `SMTP_PORT` | `587` (the default) | Port `465` connects over TLS; on any other port the connection upgrades to TLS when the server offers it. |
| `SMTP_FROM` | e.g. `WorkwrK <noreply@workwrk.com>` | The From address (that is the default). Publish SPF, DKIM and DMARC for its domain before launch, or mail lands in spam. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` | your object store's | Files, attachments and Scribe screenshots (DEPLOYMENT.md). Without them uploads fall back to the server's own disk. |

### Recommended

| Variable | What it does |
| --- | --- |
| `OPS_ALERT_EMAIL` | Where a failing scheduled job sends an alert (at most one per job in six hours). The email-queue job is the exception: its alert would wait in the queue that is failing, so it sends none, and `/api/health` does not check email; the cron log and a dead-man check on its crontab row (CRON-SETUP) show it. Unset, failures only reach the logs. |
| `AUDIT_SIGNING_KEY` | Signs audit log exports. Unset, they are signed with `CRON_SECRET`. |
| `ANTHROPIC_API_KEY` | The AI features. Unset, they are unavailable. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Calls and huddles in Talk. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google, and Google Calendar connections. |
| `STAFF_RUNBOOK_URL` | A link to your runbook in the Staff console. |

### Billing (not live yet)

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_GROWTH_PER_USER`,
`STRIPE_PRICE_TEAM_FLAT`, `STRIPE_PRICE_GROWTH_FLAT`,
`STRIPE_PRICE_SCALE_FLAT`. Leave them unset until billing is fixed: the launch
audit found that with Stripe configured, Plan & billing shows a Manage billing
button that always fails, and nothing yet lets a workspace buy Growth.

### Switches, off unless you decide otherwise

| Variable | Turns on |
| --- | --- |
| `ACCESS_V2_TABLES` | The new sharing tables (your decision; see the access plan). |
| `SETTINGS_OWNER_SPLIT` | Billing, Security and API settings for Owners, and for the Admins given that scope. Off, every Admin opens them. |
| `TALK_UPDATES_CRON` | Talk updates digests (`on`), with its crontab row (CRON-SETUP). |
| `REPORT_SCHEDULE_CRON` | Scheduled email reports (`on`), with its crontab row (CRON-SETUP). |
| `CUSTOM_DOMAINS_ENABLED` | A workspace's own domain pointing at the app. |
| `MARKETING_GEO_HEADERS` | The marketing site's currency picked from the visitor's country header. |

### Never set on the server

- `PLATFORM_STAFF_BOOTSTRAP_EMAILS`: a local development convenience, ignored
  in production. Staff are added from Staff console > Staff.
- `NEXT_DIST_DIR`: the deploy sets it for the build only. Set in `.env`, the
  server would serve a folder the deploy does not swap.

## Before you take strangers' money

- Backups: set up the nightly off-site backup and do one test restore
  ([scripts/BACKUPS.md](scripts/BACKUPS.md)). Until then one disk failure
  loses every customer's data.
- Monitoring: point an uptime monitor (UptimeRobot, BetterStack) at
  `https://app.workwrk.com/api/health` every five minutes, and set
  `OPS_ALERT_EMAIL`.
- Email: send yourself an invitation and a password reset, and check both
  arrive outside spam.
- Billing and AppSumo: not ready. Redeeming an AppSumo code does not grant its
  plan yet, and Stripe should stay unset (above).
- A real `support@workwrk.com` inbox someone reads.
