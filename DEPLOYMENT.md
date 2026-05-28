# Deployment

One-time launch checklist for WorkwrK. Targets a self-hosted Postgres
on the app server, but the same steps apply to any Next.js + Postgres host.

## 1 · Database

```bash
# Point DATABASE_URL at your production Postgres
npx prisma migrate deploy
# Or on first provision:
npx prisma migrate dev --name "launch"
```

Run once on every release that includes a schema change. The current
schema includes all launch features: billing (`Subscription`), public
API (`ApiKey`, `ApiKeyRateBucket`, `WebhookSubscription`,
`WebhookDelivery`), and task SLAs (`Task.slaHours`, `TaskPriority`,
`TaskSource`).

## 2 · Environment variables

Copy `.env.example` to your hosting provider. Minimum required:

| Var                    | Required for                      |
| ---------------------- | --------------------------------- |
| `DATABASE_URL`         | Everything                        |
| `NEXTAUTH_SECRET`      | Sessions                          |
| `NEXTAUTH_URL`         | Sessions + OAuth redirects        |
| `ANTHROPIC_API_KEY`    | AI Engine + AI signals            |
| `CRON_SECRET`          | Two cron endpoints                |

Optional (features gracefully no-op without them):

| Var                                  | Enables                   |
| ------------------------------------ | ------------------------- |
| `GOOGLE_CLIENT_ID` + `_SECRET`       | Google SSO on /login      |
| `STRIPE_SECRET_KEY` + webhooks + prices | Self-serve billing     |
| `RESEND_API_KEY` / SMTP              | Transactional email       |
| `S3_*`                               | File uploads (avatars, Scribe) |

### S3-compatible storage (Linode, R2, AWS)

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

**Bucket CORS** — the Chrome extension PUTs directly from
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

`*` is safe here because uploads are gated by presigned URLs — an
attacker without a presigned URL can't upload regardless of origin.

**Bucket ACL** — keep the bucket **private**. Workwrk generates
short-lived presigned GET URLs at read time. No public-read policy
needed.

**Backfill** — if you have existing RECORDED SOPs stored inline, run
`npm run scribe:backfill` once after provisioning S3. Idempotent; safe
to rerun. Use `--dry-run` first.

## 3 · Scheduled jobs

`vercel.json` is pre-wired. On Vercel, the platform reads it and
registers the crons automatically:

- `POST /api/tasks/run-sla-check` — every **15 min** · escalates
  overdue tasks up the reporting chain, posts to Slack if configured,
  fires `task.escalated` webhook.
- `POST /api/cron/webhook-retry` — every **5 min** · retries failed
  webhook deliveries with exponential backoff up to 8 attempts.
- `POST /api/cron/email-queue` — every **1 min** · drains the
  `EmailLog` queue. Safety net behind the inline fire-and-forget
  `processEmailQueue()` calls, which can be terminated early by the
  serverless runtime before they finish sending.
- `POST /api/cron/ratelimit-cleanup` — daily at **03:00 UTC** ·
  prunes stale `ApiKeyRateBucket` rows (minute buckets >24 h old,
  day buckets >30 days old) so the table doesn't grow unbounded.
- `POST /api/cron/calendar-sync` — every **5 min** · pulls deltas
  from every connected Google Calendar subscription and upserts
  the events as read-only Tasks (`externalSource = "GCAL"`). No-ops
  if `GOOGLE_CLIENT_ID` isn't configured.

All endpoints are guarded by `CRON_SECRET`. If you're not on Vercel,
wire equivalents via GitHub Actions, AWS EventBridge, or Upstash.

```yaml
# Example: GitHub Actions
on:
  schedule:
    - cron: "*/15 * * * *"
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST https://your-domain.com/api/tasks/run-sla-check \
            -H "X-Cron-Secret: $CRON_SECRET"
```

## 4 · Stripe setup

If you're enabling billing:

1. Create 4 recurring prices in Stripe:
   - Growth · per-user · $4/month
   - Team · flat · $50/month (up to 25 users)
   - Growth · flat · $150/month (up to 100 users)
   - Scale · flat · $300/month (up to 500 users)
2. Copy their IDs into `STRIPE_PRICE_*` env vars.
3. Create a webhook endpoint in Stripe pointing to
   `https://<your-domain>/api/billing/webhook`. Copy the signing secret
   into `STRIPE_WEBHOOK_SECRET`.
4. Subscribe to these events: `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `checkout.session.completed`.

## 5 · Google SSO

1. Create an OAuth client at
   [console.cloud.google.com](https://console.cloud.google.com/).
2. Authorized redirect URI:
   `https://<your-domain>/api/auth/callback/google`.
3. Paste `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The /login page
   auto-detects and shows the Google button.

## 6 · First admin account

The very first user becomes the admin of their org. Go to
`/register`, sign up with a real admin email, and you'll be routed
to `/setup` for initial configuration.

## 7 · API keys + webhooks

Admins can generate API keys at **/settings/api** for programmatic
access. Developers can grab the OpenAPI spec at
`/api/v1/openapi.json` or read the reference at `/developers`.

## 8 · Post-launch monitoring

Wire these, even if with free tiers:

- **Error tracking**: Sentry (`@sentry/nextjs`)
- **Uptime**: BetterStack / Pingdom pinging `/api/health`
- **Product analytics**: PostHog (or skip — the AI Signals feature
  gives you operational telemetry already)
- **Backups**: Your Postgres provider probably has PITR. Enable it.

## 9 · Going to prod

```bash
git push # Vercel auto-deploys on push to main
# Or if self-hosting:
npm run build && npm run start
```

After first deploy:

1. Hit `/signup` and create the first admin.
2. Go to `/setup` and configure departments, roles, first KRAs.
3. Generate an API key at `/settings/api`.
4. Curl `GET /api/v1/people` with the key to verify everything works.
5. If billing is enabled, hit `/pricing`, sign up, and confirm Stripe
   webhook lands in `Subscription` table.
