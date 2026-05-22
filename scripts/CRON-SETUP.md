# Cron schedule — aaPanel setup

WorkwrK ships several time-driven jobs as `POST /api/cron/*` endpoints.
On aaPanel the simplest setup is a shell-script cron per endpoint that
hits the URL with the shared `CRON_SECRET` header.

The previous `vercel.json` in the repo root is **not used** in this
deployment — it's there as historical/reference documentation of the
canonical schedules.

## One-time setup

You should already have `CRON_SECRET` in your env (.env.production or
aaPanel Node config). Confirm with `pm2 env workwrk` or the equivalent.

In aaPanel: **Cron** (left sidebar) → **Add Task**.

For each row below, set:
- Type: **Shell Script**
- Schedule: per-row
- Script: per-row (replace `https://workwrk.com` if your prod host is different)

| What it does | Schedule (aaPanel) | Script |
|---|---|---|
| Drain queued emails | `* * * * *` (every minute) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/email-queue` |
| Sync Google Calendar | `*/5 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/calendar-sync` |
| Retry failed webhooks | `*/5 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/webhook-retry` |
| Task SLA check | `*/15 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/tasks/run-sla-check` |
| Rate-limit cleanup | `0 3 * * *` (3 AM nightly) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/ratelimit-cleanup` |
| Surveys rotate keys | `0 4 * * *` (4 AM nightly) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/surveys-rotate` |
| OKR reminders | `0 9 * * 1-5` (9 AM weekdays) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/okr-reminders` |
| Announcements publish | `*/5 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/announcements-publish` |
| Autonomous agents | `*/10 * * * *` | `curl -fsS --max-time 290 -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/run-due-agents` |

`-fsS` = fail silently on HTTP errors but still print errors. So a 403
or 500 lands in the cron log.

## Where the cron secret comes from

The same value that's in your env as `CRON_SECRET`. In the script
above, `$CRON_SECRET` is a shell variable — for it to expand inside
the cron's environment you have **two options**:

**Option A — inline the value in each cron script** (simplest):
```
curl -fsS -X POST -H "x-cron-secret: b205e8314f25686b30892b1adb60e654e35a9c1e427a15da9d62fe4a6f322eb1" https://workwrk.com/api/cron/email-queue
```

**Option B — export from /etc/profile.d** (if you want one place to update it):
```
# /etc/profile.d/workwrk-secrets.sh
export CRON_SECRET=b205e8314f25686b30892b1adb60e654e35a9c1e427a15da9d62fe4a6f322eb1
```
Then make sure aaPanel's cron runs with a login shell so /etc/profile.d
is sourced. Many setups use a non-login shell, so Option A is safer.

## Verifying

After saving each cron, click **Execute** in aaPanel → check the log
panel. A successful run looks like `{"ran":true,"at":"2026-…"}`.

If you see `{"error":"Forbidden"}`, your `CRON_SECRET` doesn't match.
If you see `Connection refused`, the Node app isn't running on the
expected port; check PM2.

## Day-2 maintenance

- These jobs are idempotent — re-running them is safe.
- If you rotate `CRON_SECRET`, update both the env var and every cron
  script. Restart pm2 after env change.
- If you want to disable any job temporarily, just disable the row in
  aaPanel Cron rather than deleting it — keeps the history.
