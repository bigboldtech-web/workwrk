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
| Review cycles auto-open | `0 8 * * *` (8 AM daily) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/review-cycles` |
| KPI score reminders | `0 9 * * 1-5` (9 AM weekdays) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/kpi-reminders` |
| Announcements publish | `*/5 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/announcements-publish` |
| Autonomous agents | `*/10 * * * *` | `curl -fsS --max-time 290 -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/run-due-agents` |
| Recurring tasks spawn | `0 * * * *` (hourly) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/recurring-tasks` |
| Personal reminders fire (closed-app) | `*/5 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/reminders` |

`-fsS` = fail silently on HTTP errors but still print errors. So a 403
or 500 lands in the cron log.

**Why the reminders row matters.** A user's personal/task reminders fire
in the browser via `ReminderTicker` only while the app is open. This
`/api/cron/reminders` job (every 5 min) is what fires them for people
who have the app **closed** — without it, closed-app reminders never go
off. The in-app ticker and this cron claim each due reminder atomically,
so they never double-fire.

## Digest emails — `/api/email/send-reminders`

This one endpoint runs several distinct reminder jobs selected by a
`type` in the **JSON body**, and it authenticates with
`Authorization: Bearer $CRON_SECRET` (NOT the `x-cron-secret` header the
jobs above use). Because a path-only cron (e.g. the reference
`vercel.json`) can't send a body, register these as separate aaPanel
rows, one per `type`:

| What it does | Schedule (aaPanel) | Script |
|---|---|---|
| Tasks due today (in-app notify) | `0 7 * * *` (7 AM daily) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"tasks-due-today"}' https://workwrk.com/api/email/send-reminders` |
| Overdue SOPs digest (user + manager) | `0 8 * * 1` (Mon 8 AM) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"overdue-sops"}' https://workwrk.com/api/email/send-reminders` |
| Overdue tasks digest (manager) | `0 8 * * 1` (Mon 8 AM) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"overdue-tasks"}' https://workwrk.com/api/email/send-reminders` |
| Policy acknowledgment reminders | `0 9 * * 1` (Mon 9 AM) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"policy-ack"}' https://workwrk.com/api/email/send-reminders` |
| Monthly evaluation reminders | `0 8 1 * *` (1st, 8 AM) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"monthly-evaluation"}' https://workwrk.com/api/email/send-reminders` |
| KPI recording reminders | `0 8 1 * *` (1st, 8 AM) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"kpi-recording"}' https://workwrk.com/api/email/send-reminders` |

Do **not** register `send-reminders` with an empty body — a bodiless
POST defaults to `type: "all"`, which would send the monthly evaluation
and KPI emails **every day** it runs. Always pass one `type` per row.

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
