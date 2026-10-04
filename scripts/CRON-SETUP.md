# Cron schedule — production setup (INSTALLED 2026-08-18)

WorkwrK's time-driven jobs are `POST` endpoints fired by curl from root's
crontab on the aaPanel server — the SAME mechanism the ManagedAd app on this
host uses, NOT the aaPanel Cron UI. The canonical install is the
"WorkwrK cron schedule" block in `crontab -l` (21 rows), with the shared
secret exported from `/etc/profile.d/workwrk.sh` (copied from the app env's
`CRON_SECRET`). All output appends to `/var/log/workwrk-cron.log`.

STATUS: installed and verified end-to-end on 2026-08-18 (daemon-fired runs
return 200; every endpoint test-fired once). Three older duplicate WorkwrK
tasks in the aaPanel Cron UI should be deleted there (reminders every-minute,
recurring-tasks hourly, kpi-reminders daily with a broken literal secret) —
do NOT touch the aaPanel SSL-renewal task (acme_v2).

Editing rules:
- `crontab -e` on the server; keep the WorkwrK block below the ManagedAd one.
- cron treats a literal `%` as end-of-command — never use `date +%F`-style
  format strings inside a crontab line (this bit us during install).
- `/api/email/process` is deliberately NOT scheduled: it is a legacy
  duplicate of `/api/cron/email-queue`.
- Endpoints added since the original doc: `/api/cron/automation-retry`
  (every 10 min) and `/api/cron/org-hard-delete` (daily 03:30).

The `vercel.json` in the repo root is reference-only (not used on aaPanel).

## One secret check for every job (2026-10-05)

Every endpoint in this file checks the secret the same way
(`src/lib/cron-auth.ts`): `x-cron-secret: <secret>` or
`Authorization: Bearer <secret>`, compared in constant time. With
`CRON_SECRET` unset or empty in the app's environment, every one answers 503
and runs nothing; a missing or wrong secret is a 403 (a few answered 401
before, and `curl -fsS` fails the same way on both). Before this, 11 of the
`/api/cron` routes ran for anybody when the secret was unset and 4 more did
outside production, three routes fell back to `NEXTAUTH_SECRET`, and
`/api/cron/run-due-agents` let any signed-in workspace admin fire every
workspace's agents. Production has the secret set, so no installed row
changes. Locally, start the dev server with a `CRON_SECRET` and send it.

## Rotating CRON_SECRET (do this now: the old value was public)

Until 2026-10-05 this file and `LAUNCH-CHECKLIST.md` printed the production
`CRON_SECRET` (and the checklist the `SECRETS_ENCRYPTION_KEY`), and the
repository is public. Git history keeps them, so removing them from the files
is not enough: anyone can still read them. With that value anybody can send
every reminder email to every customer again and again, run the purge jobs,
and forge a signed audit export. Replace it on the server:

1. `openssl rand -hex 32` makes the new value.
2. Put it in the app's `.env` as `CRON_SECRET`, in `/etc/profile.d/workwrk.sh`,
   and in any crontab or aaPanel row that has the value written in.
3. `pm2 reload workwrk --update-env`, so the app reads it.
4. Check: `curl -s -o /dev/null -w '%{http_code}' -X POST -H "x-cron-secret: <the OLD value>" https://workwrk.com/api/cron/ratelimit-cleanup`
   answers 403, and the next cron run in `/var/log/workwrk-cron.log` succeeds.
5. Set a separate `AUDIT_SIGNING_KEY` (also `openssl rand -hex 32`): signed
   audit exports fall back to `CRON_SECRET` without one.

`SECRETS_ENCRYPTION_KEY` encrypts stored secrets (bring-your-own AI keys), so
it is rotated with `scripts/rotate-secrets-key.ts`, which re-encrypts them:
see that file's header.

## Removed: Task SLA check

`*/15 * * * * curl ... /api/tasks/run-sla-check`: **delete this row from the
crontab.** Phase 2 W4 (docs/plans/ui-refresh/spec-work-home.md section 4)
retired `/api/tasks/run-sla-check`; it answers 410 now, so the cron logs a
failure every fifteen minutes until the row is gone.

Nothing replaces it, and that is a deliberate loss rather than an oversight:
SLA hours, the escalation timestamp and the escalation target were columns on
the legacy `Task` table only. The `Item` model this product runs on has no
equivalent, so there is no escalation to run. The columns themselves are not
deleted (every migrated task keeps `slaHours`, `escalatedAt` and
`escalatedToId` under `Item.metadata.legacyTask`), so a future SLA feature can
read the old settings back rather than starting from nothing.

Two things this also fixed, worth recording because both were live:
the endpoint was **completely unauthenticated whenever `CRON_SECRET` was
unset** while writing notifications, mutating tasks and firing Slack webhooks;
and it ran against a table the product's task surfaces no longer read, so its
escalations pointed at work nobody could see.

| What it does | Schedule (aaPanel) | Script |
|---|---|---|
| Drain queued emails | `* * * * *` (every minute) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/email-queue` |
| Sync Google Calendar | `*/5 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/calendar-sync` |
| Retry failed webhooks | `*/5 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/webhook-retry` |
| Rate-limit cleanup | `0 3 * * *` (3 AM nightly) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/ratelimit-cleanup` |
| Surveys rotate keys (Phase 6: its Inbox rows link the survey itself, `/surveys/{id}`, never the list) | `0 4 * * *` (4 AM nightly) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/surveys-rotate` |
| OKR reminders | `0 9 * * 1-5` (9 AM weekdays) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/okr-reminders` |
| Review cycles auto-open (Phase 6: tells the People team and Admins only, with a link to the cycle itself, `/reviews/{cycleId}`, never the list) | `0 8 * * *` (8 AM daily) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/review-cycles` |
| Review closes in 3 days (NOT INSTALLED: the founder adds this row, Phase 6; it nudges everyone in an Active cycle who has not done their part, once, with a link to `/reviews/{cycleId}`) | `30 8 * * *` (8:30 AM daily) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/review-closing` |
| KPI score reminders | `0 9 * * 1-5` (9 AM weekdays) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/kpi-reminders` |
| Announcements publish | `*/5 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/announcements-publish` |
| Autonomous agents | `*/10 * * * *` | `curl -fsS --max-time 290 -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/run-due-agents` |
| Recurring tasks spawn | `0 * * * *` (hourly) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/recurring-tasks` |
| Retry failed automation runs | `*/10 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/automation-retry` |
| Automation time triggers (NOT INSTALLED: the founder adds this row, Phase 7; until it ticks, the builder shows the two time triggers as "Not live yet") | `*/5 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/automation-schedule` |
| Hard-delete cancelled orgs (30-day grace) | `30 3 * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/org-hard-delete` |
| Personal reminders fire (closed-app) | `*/5 * * * *` | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/reminders` |
| Purge table rows in Trash > 60 days | `45 3 * * *` (3:45 AM nightly) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/table-row-purge` |

`-fsS` = fail silently on HTTP errors but still print errors. So a 403
or 500 lands in the cron log.

## Form responses daily summary (NOT INSTALLED: the founder adds this row)

`POST /api/cron/form-daily-summary` is the reader of the form builder's
"Send a daily summary instead" switch (Settings tab, Notifications card,
spec-tables-forms section 2 `/forms/[id]`). Once a day, for every form set to
the summary, the people on its "Tell these people about each new response"
list get ONE notification counting the last 24 hours of responses, instead of
one notification per response. A form with no responses in the window sends
nothing. Added in Phase 5 (2026-09-23).

**Install it in two steps, together**: add the row below, AND set
`FORM_DAILY_SUMMARY_CRON=on` in the app's `.env` (then reload pm2). The app
cannot see the crontab, so that flag is how it knows the reader exists. Until
the flag is on, the builder does not show "Send a daily summary instead", and
a form already set to it keeps sending one notification per response, so
nobody silently stops hearing about responses. Set the flag only once the row
is in, or a summary form goes quiet.

**It is fail-closed**: with `CRON_SECRET` unset it answers 503 and sends
nothing, because it writes into people's inboxes.

| What it does | Schedule (aaPanel) | Script |
|---|---|---|
| Form responses daily summary | `0 8 * * *` (8 AM daily) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/form-daily-summary` |

## Scheduled email reports (NOT INSTALLED: the founder adds this row)

`POST /api/cron/report-schedules` sends the scheduled email reports of a
dashboard or a saved view (Phase 5b, gap 16). Every five minutes it takes the
schedules whose next instant has arrived, computes each recipient's copy
under THAT recipient's own access (a card or a List they cannot read is not
in their email; someone who cannot read the target at all is skipped and
counted, never named), and queues the emails into the same EmailLog queue the
"Drain queued emails" row above sends. It is idempotent per schedule and due
instant: the run is claimed with a compare-and-swap in the transaction that
queues its emails, so a retried or overlapping run never sends twice.
Recipients are always workspace members, never typed addresses. Added in
Phase 5b (2026-09-24).

**Install it in two steps, together**: add the row below, AND set
`REPORT_SCHEDULE_CRON=on` in the app's `.env` (then reload pm2). The app
cannot see the crontab, so that flag is how the report routes tell the UI a
sender exists (`cronInstalled` in GET /api/report-schedules); until it is on,
the UI should not offer scheduling, so nobody sets up a report that never
arrives.

**It is fail-closed**: with `CRON_SECRET` unset it answers 503 and sends
nothing, because it mails people. It needs prisma/sql/2026-09-24-phase5b-data.sql
(in the deploy manifest); before that file is applied it answers
`{ ran: true, skipped: "table_absent" }` and does nothing.

| What it does | Schedule (aaPanel) | Script |
|---|---|---|
| Scheduled email reports | `*/5 * * * *` | `curl -fsS --max-time 290 -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/report-schedules` |

## Scheduled AI updates in Talk (NOT INSTALLED: the founder adds this row)

`POST /api/cron/talk-updates` posts the scheduled AI updates (Batch 8): a
Daily standup or a Weekly project update that AI writes from one List or one
Space, posted into a private channel or a group chat as the person who set it
up. Every five minutes it takes the updates whose next instant has arrived,
claims each instant with one compare-and-swap (an overlapping or retried tick
posts nothing twice), skips a slot more than three hours late rather than
posting at an odd hour, and lists only the tasks that the person who set it
up AND every member of the conversation can open, recomputed at every run.
A conversation with a Guest in it, a public channel, or a workspace with
"Scheduled AI updates in Talk" off gets no post. The answer is counts only.
Added in Batch 8 (2026-10-04).

**Install it in two steps, together**: add the row below, AND set
`TALK_UPDATES_CRON=on` in the app's `.env` (then reload pm2). The app cannot
see the crontab, so that flag is how the Details panel says whether updates
post on their schedule; until it is on, the panel says they post only with
Post now.

**It is fail-closed**: with `CRON_SECRET` unset it answers 503 and runs
nothing, because it posts into conversations and sends task content to the
AI provider. The secret is compared in constant time. It needs
prisma/sql/2026-10-04-ai-fields-and-updates.sql (in the deploy manifest);
before that file is applied it answers 503 `not_ready` and does nothing.

| What it does | Schedule (aaPanel) | Script |
|---|---|---|
| Scheduled AI updates in Talk | `*/5 * * * *` | `curl -fsS --max-time 290 -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/talk-updates` |

## Inbox auto-clear (NOT INSTALLED: the founder adds this row)

`POST /api/cron/inbox-auto-clear` sweeps CLEARED notifications for the people
who asked for it in Inbox options > "Auto-clear read notifications". It is the
one cron in this file that deletes user data, so it is listed separately and is
not in the table above: adding the row is a deliberate decision, not a default.

**It is fail-closed.** With `CRON_SECRET` empty or unset the route answers 503
and sweeps nothing, because a delete job that runs for anybody who can reach
the URL is worse than a job that never runs. Set `CRON_SECRET` in `.env` before
adding the row, and check the 503 is gone by running the dry run below.

**Cleared, not merely read.** Since 2026-09-18 "read" and "cleared" are two
states (`prisma/sql/2026-09-18-notification-cleared-at.sql`). A row you have
read still sits in your Primary tab where you can see it, so the sweep takes
only rows you filed away with Clear. On a database that still predates the
`clearedAt` column the route falls back to `read = true`, which was the same
set of rows under the old semantics, so applying the SQL file late changes
nothing about what gets deleted.

| What it does | Schedule (aaPanel) | Script |
|---|---|---|
| Auto-clear read notifications | `15 4 * * *` (4:15 AM nightly) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/inbox-auto-clear` |

What it will and will not delete, all four of which are in the route:

* **Opt-in per person.** `home.notifications.inboxView.autoClearDays` defaults
  to `null`, which is "Never". Somebody with no stored value is never swept.
* **Cleared rows only.** A row is swept only once its owner cleared it. Unread
  rows, and rows merely read, are never swept.
* **Older than the number of days they chose**, and only 7, 14 or 30 — the
  three the popover offers. Any other number is ignored rather than honoured.
* **Their rows only.** One `deleteMany` per person, scoped to that userId.

Without this row nothing breaks: the setting simply never takes effect, and
"Never" stays true for everyone.

**Dry run first, always.** `?dry=1` counts exactly what it would delete and
deletes nothing:

```
curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" \
  "https://workwrk.com/api/cron/inbox-auto-clear?dry=1"
```

Read the JSON (`peopleWithPreference`, `peopleSwept`, `deleted`, `detail`) and
only then add the schedule.

## Trash retention purge (NOT INSTALLED: the founder adds this row)

`POST /api/cron/trash-purge` permanently deletes `TrashItem` snapshots past
each org's retention window. It is the second cron in this file that deletes
user data, so it is listed separately and is not in the table above.

**Why it exists at all.** Until 2026-09-19 the purge ran inside
`GET /api/trash`: opening the Trash page destroyed expired rows, two people
opening it at once destroyed them twice, and a workspace nobody visited kept
deleted rows forever because the clock only ticked when somebody looked. A read
must not delete, so the read stopped deleting and this row is what carries the
retention promise instead. **Until this row is installed nothing is ever purged
and the 60-day promise on the page is not kept** — that is the one thing to
know before deciding whether to add it.

**It is fail-closed.** With `CRON_SECRET` empty or unset the route answers 503
and purges nothing.

| What it does | Schedule (aaPanel) | Script |
|---|---|---|
| Purge Trash past each org's retention window | `50 3 * * *` (3:50 AM nightly) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/trash-purge` |

What it will and will not delete:

* **Deleted rows only.** `TrashItem` snapshots, which is what a hard delete
  captures. Archived Spaces, Folders, Lists, tasks, Docs, Canvases and
  Contracts are never touched: an archive is something somebody put away, and
  the Archived tab has no clock on it.
* **Past that org's own window.** `settings.retention.trashDays`, defaulting to
  60 when it is unset or nonsense, and floored at one day so a stored zero can
  never purge something on the day it was deleted.
* **Blobs first.** A trashed file's storage is freed before the row naming it
  goes, so nothing is orphaned.

**Dry run first, always.** `?dry=1` counts exactly what it would delete per org
and deletes nothing:

```
curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" \
  "https://workwrk.com/api/cron/trash-purge?dry=1"
```

Read the JSON (`orgs`, `orgsPurged`, `totalDeleted`, `purged`) and only then add
the schedule.


### Audit log retention (Phase 8, NOT INSTALLED)

`POST /api/cron/audit-purge` deletes Audit log rows older than the window an
Owner chose in Settings > Data > Retention & privacy ("Keep the audit log
for"). It acts ONLY on orgs that set `settings.retention.auditDays`; an org
that never chose keeps its log forever, so adding this row deletes nothing
anyone did not ask to delete. The window is floored at 90 days, deletes run in
batches of 5000, and each org gets one `audit.purged` row naming how many
entries went. It never deletes the rows features read back (weekly review
decisions, goal creators, invitations, shares, the retired permissions grid,
consent and staff rows: `src/lib/audit-retention.ts`). Until this row AND the
trash-purge row are installed, both retention rows sit behind Show upcoming
features on Data > Retention, captioned "Not enforced yet"; once both rows are
in, move them out (data/page.tsx RetentionTab).

| Job | Schedule | Command |
|---|---|---|
| Purge audit rows past each org's chosen window | `10 4 * * *` (4:10 AM nightly) | `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://workwrk.com/api/cron/audit-purge` |

Dry run first (reads only):

```
curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" "https://workwrk.com/api/cron/audit-purge?dry=1"
```

## Access parity job (NOT INSTALLED: the founder adds this row)

`scripts/access-parity-job.mjs` is the step-2 job from
`docs/plans/ui-refresh/access-model-spec.md` section 10: it samples real
(viewer, object) pairs, fills the parity harness through the same Prisma
reads the legacy helpers make, and exits 1 on any mismatch that is not
named in `EXPECTED_MISMATCHES`. It is a node script, not an endpoint, so
it runs from the app directory with the app's `.env`. It is read-only
three ways (the Postgres session is opened with
`default_transaction_read_only=on`, the Prisma client refuses every
non-read operation, and it only calls the loaders), and it needs the
repo's devDependencies present (`esbuild`, pulled in by vitest, compiles
the TypeScript it imports). Run it by hand first (`--dry-run` still opens
the read-only session and runs the sampling reads; it evaluates nothing):

```
cd /www/wwwroot/workwrk.com && node scripts/access-parity-job.mjs --limit 50 --dry-run
```

The row to add to the WorkwrK block in root's crontab (02:15 nightly,
after the 02:xx backups and before the 03:00 cleanups; keep it out of the
aaPanel Cron UI like every other row here). `--rotate` shifts the object
window by the day of the year so the seven nightly runs walk different
rows of each tenant instead of re-checking the same sample; sampling is
otherwise deterministic (most-populated orgs first, one object per
visibility/membership bucket before the rest). `--allow-remote` is only
needed if `DATABASE_URL` does not point at localhost:

```
15 2 * * * cd /www/wwwroot/workwrk.com && /usr/bin/env node scripts/access-parity-job.mjs --limit 500 --rotate --sections legacy,node --node-per-kind 40 --prove-tables --prove-resolver --out /var/log/workwrk-parity-latest.json >> /var/log/workwrk-cron.log 2>&1

Phase 8 stage E fix: `--prove-tables --prove-resolver` evaluate the flip
state in the job's own process (the session stays read-only; the server's
environment is never touched). Without `--prove-tables` the node section
cannot fail: with ACCESS_V2_TABLES off the engine reads the old tables and
one named row explains every node case, so a week of flag-off runs would
prove nothing for Spaces, Folders, Lists, Docs, Tables, Canvases and Forms.
The job prints a WARNING line when it runs the node section with the flag off.

Phase 8 stage E: the job now has two sections. `legacy` is the Phase 0
comparison with a live tie-break; `node` compares can() against the live
resolvers (node-access, item-gate, sop-access, canSeeGoal, the settings door,
the matrix cells). `--node-per-kind 40` keeps the nightly node section to
about the size of the legacy one on a large tenant. Run it once more by hand
with the production flag state you are about to turn on (for example
`ACCESS_V2_TABLES=true ACCESS_V2_RESOLVER=true node scripts/access-parity-job.mjs ...`):
the criterion is zero UNEXPECTED in both sections with that state.
```

Read the log the next morning: a line `UNEXPECTED: 0` is the pass. The
flip in step 4 of the access spec waits for seven consecutive passes;
any `UNEXPECTED: n` above zero lists the cases, and each one is either a
new entry for `EXPECTED_MISMATCHES` (with its source) or an engine bug.
The local development database is thin evidence (one populated org, no
folders, no task-anchored docs, so most fixtures go unexercised); the
seven-day criterion is judged on production data only.

**Why the reminders row matters.** A user's personal/task reminders fire
in the browser via `ReminderTicker` only while the app is open. This
`/api/cron/reminders` job (every 5 min) is what fires them for people
who have the app **closed** — without it, closed-app reminders never go
off. The in-app ticker and this cron claim each due reminder atomically,
so they never double-fire.

## Digest emails — `/api/email/send-reminders`

This one endpoint runs several distinct reminder jobs selected by a
`type` in the **JSON body**, and the rows below authenticate with
`Authorization: Bearer $CRON_SECRET` (the shared check above also accepts
the `x-cron-secret` header the other jobs use, so either works). Because a path-only cron (e.g. the reference
`vercel.json`) can't send a body, register these as separate aaPanel
rows, one per `type`:

| What it does | Schedule (aaPanel) | Script |
|---|---|---|
| Tasks due today (in-app notify) | `0 7 * * *` (7 AM daily) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"tasks-due-today"}' https://workwrk.com/api/email/send-reminders` |
| Overdue SOPs digest (user + manager) | `0 8 * * 1` (Mon 8 AM) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"overdue-sops"}' https://workwrk.com/api/email/send-reminders` |
| Overdue tasks digest (manager) | `0 8 * * 1` (Mon 8 AM) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"overdue-tasks"}' https://workwrk.com/api/email/send-reminders` |
| Policy "Remind before due" (Organize › Defaults, `process.ack.remindDays`; one nudge per assignment inside the window) | `30 8 * * *` (8:30 AM daily) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"policy-ack-due"}' https://workwrk.com/api/email/send-reminders` |
| Policy acknowledgment reminders | `0 9 * * 1` (Mon 9 AM) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"policy-ack"}' https://workwrk.com/api/email/send-reminders` |
| Monthly evaluation reminders | `0 8 1 * *` (1st, 8 AM) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"monthly-evaluation"}' https://workwrk.com/api/email/send-reminders` |
| KPI recording reminders | `0 8 1 * *` (1st, 8 AM) | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"type":"kpi-recording"}' https://workwrk.com/api/email/send-reminders` |

Do **not** register `send-reminders` with an empty body — a bodiless
POST defaults to `type: "all"`, which would send the monthly evaluation
and KPI emails **every day** it runs. Always pass one `type` per row.

## Where the cron secret comes from

The same value that's in your env as `CRON_SECRET`. NEVER write its value in
this file, or anywhere in this repository: the repository is public, and the
value that used to be printed here had to be replaced (2026-10-05). In the
script above, `$CRON_SECRET` is a shell variable — for it to expand inside
the cron's environment you have **two options**:

**Option A — inline the value in each cron script** (simplest):
```
curl -fsS -X POST -H "x-cron-secret: <the CRON_SECRET from the app's .env>" https://workwrk.com/api/cron/email-queue
```

**Option B — export from /etc/profile.d** (if you want one place to update it):
```
# /etc/profile.d/workwrk-secrets.sh
export CRON_SECRET=<the CRON_SECRET from the app's .env>
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

## Phase 4, stage C: the Google Calendar sync row is unchanged, and why that is worth saying

The "Sync Google Calendar" row above (`*/5 * * * *`,
`/api/cron/calendar-sync`) is **already installed** and needs no change.
What changed is where it writes, not when it runs.

Before Phase 4 it wrote Google events into the legacy `Task` table while the
Planner read `Item`, so a connected Google Calendar produced rows nothing in
the product rendered: a person connected their calendar, granted access, and
saw nothing, forever. It now writes `CalendarEvent` rows, which is the table
`GET /api/calendar/events` reads, and keeps writing the legacy row beside it
for one release (see `scripts/MIGRATIONS.md`, "the Google sync now writes two
rows, on purpose").

So: **no crontab edit is needed for the calendar work, and nobody should add
a second sync row.** If Google events are still missing after a deploy, the
thing to check is whether `prisma/sql/2026-09-22-calendar-event.sql` has been
applied, not whether the cron is running. The sync tolerates the table being
absent and keeps behaving exactly as it did before, which is quiet on purpose
but does mean a missing table looks like a missing cron.
