# Deploy notes

Things the production environment must have that the code cannot check for
itself. Read before a release that touches any of them. The full list of
variables and hosts is in `LAUNCH-CHECKLIST.md`.

## How a release reaches the server (Batch 12)

`.github/workflows/deploy.yml`, after CI passed on a push to `main`:

1. It picks the commit. An automatic run (CI passing on a push to `main`, on
   its first attempt) deploys the newest commit on `main` whose CI passed on
   a push (a pull request's run tested a merge ref, not the commit, and does
   not count), never "whatever main is now". A RE-RUN of a CI run never
   deploys: deploy that commit with a manual run, or let the next push carry
   it. A manual run (Actions > Deploy > Run workflow) takes an optional commit
   sha, held to the same check; without one it deploys the newest green
   commit. Only one deploy job runs at a time (the job's concurrency group),
   and a job its condition skips never takes that slot.
2. On the box it waits for any earlier deploy's script still running there (a
   lock, up to 30 minutes), then, before anything changes: an automatic run
   whose commit is already live, or older, stops with a notice; a commit from
   before Batch 12 is refused (it has no `deploy:migrate` step and builds into
   the live `.next`; see Going back). Then `git reset --hard <sha>`; `npm ci`
   only when `package-lock.json` changed (the hash it last installed is in
   `node_modules/.deploy-lock-hash`), with the live release's packages moved
   to `node_modules-prev` first, not deleted; otherwise `prisma generate`.
3. `npm run deploy:migrate`: the additive SQL manifest, each file under a 5
   second lock timeout and tried up to four times, then any pending Prisma
   migration through `prisma migrate deploy` (no lock timeout, tried three
   times).
4. `next build` into `.next-staging` (`NEXT_DIST_DIR`), while the server keeps
   serving `.next`, and the commit is written beside the build
   (`.next/DEPLOY_SHA` once live). A failed or killed build changes nothing
   that is live.
5. `chown`, then `.next` becomes `.next-prev`, `.next-staging` becomes
   `.next`, and `pm2 reload`.
6. The check: `NEXTAUTH_URL/api/health` must name the new build within two
   minutes, then `/login` and one of the build's scripts must answer 200.

Whatever stops a deploy, the script puts back what it had changed, through
one exit handler: a failed step, a failed check, or an SSH session that ended
(a cancelled job, the 40 minute timeout, a dropped connection: the script
ignores the hang-up and the closed pipe, so it still reaches the handler, and
the next deploy waits on the box's lock until it has). Before the swap that
means the source back at the live commit (read from `.next/DEPLOY_SHA`) and
the live packages back from `node_modules-prev`; after the swap, the new build
moves to `.next-failed`, the previous one comes back with its packages and
commit, PM2 reloads, and the previous build is checked (a build from before
Batch 12, whose health names no build, passes on `"status":"ok"`). The deploy
then fails with the reason.

Every failure prints its reason as an annotation (`::error::`), readable
through the public API without the Actions log. `deploy-migrate.log` and
`deploy-build.log` in the app directory keep the last run's output.

## Going back

- **To any commit from Batch 12 on:** Actions > Deploy > Run workflow with
  that commit's sha. It brings back the build, the source and the packages,
  and is checked like any deploy. This is the way. It lasts until the next
  push to `main` is deployed, which deploys the newest green commit again: to
  stay back, revert the bad commit on `main`, so its push ships the revert.
- **By hand on the box, only when Actions cannot run.** As root. Each block
  below is ONE command in parentheses that first takes the deploy's own lock,
  so a deploy script still finishing on the box (its job ended, its script
  carries on to put things back) can never undo it halfway, and a step that
  fails ends it. `/run` is cleared at every boot, so the first line makes the
  lock's directory.

  The previous build, while `.next-prev` is there (`npm ci` runs only when
  the two commits' `package-lock.json` differ: the live packages are then the
  newer release's):

  ```
  install -d -m 700 /run/workwrk-deploy
  (
    cd /www/wwwroot/workwrk.com || exit 1
    export PATH="/www/server/nodejs/v20.20.0/bin:$PATH"
    flock -w 1800 9 || { echo "a deploy is still running on the box"; exit 1; }
    [ -d .next-prev ] || { echo "no previous build to go back to"; exit 1; }
    SHA=$(cat .next-prev/DEPLOY_SHA 2>/dev/null) || { echo "the previous build is from before Batch 12: use the next block"; exit 1; }
    LOCK_CHANGED=$(git diff --quiet HEAD "$SHA" -- package-lock.json || echo yes)
    rm -rf .next-failed
    mv .next .next-failed && mv .next-prev .next || exit 1
    git reset --hard "$SHA" || exit 1
    if [ -n "$LOCK_CHANGED" ]; then npm ci || exit 1; fi
    chown -R www:www /www/wwwroot/workwrk.com
    pm2 reload workwrk --update-env 9>&-
  ) 9>/run/workwrk-deploy/lock
  ```

  A commit from before Batch 12 (the workflow refuses it, and after two
  deploys no build from before Batch 12 is left in `.next-prev`): a build by
  hand, with the site down while it builds, because that commit builds into
  the live `.next`. Take the database backup first: going back past a
  migration can leave columns the old code does not expect. That commit's
  `.gitignore` does not hide the deploy's parked folders, so they are moved
  out first (moved, not deleted: `.next-prev` is a way back if this build
  fails), and the build gets the same 3 GB heap every build on this box needs:

  ```
  install -d -m 700 /run/workwrk-deploy /root/workwrk-parked
  (
    cd /www/wwwroot/workwrk.com || exit 1
    export PATH="/www/server/nodejs/v20.20.0/bin:$PATH"
    flock -w 1800 9 || { echo "a deploy is still running on the box"; exit 1; }
    for d in .next-prev .next-failed .next-staging node_modules-prev node_modules-failed; do
      if [ -e "$d" ]; then mv "$d" "/root/workwrk-parked/$d-$(date +%s)" || exit 1; fi
    done
    git reset --hard <sha> || exit 1
    npm ci || exit 1
    # npx next build, not npm run build: that commit's build script also
    # runs its migrations.
    NODE_OPTIONS=--max-old-space-size=3072 npx next build || exit 1
    chown -R www:www /www/wwwroot/workwrk.com
    pm2 reload workwrk --update-env 9>&-
  ) 9>/run/workwrk-deploy/lock
  ```

  Until the build finishes the site is down. If it fails, run the block again
  once the cause is fixed, or move the parked `.next-prev` back to `.next`
  and go back to the commit it names, with the first block's `git reset` and
  `npm ci` lines.

  Run `pm2` from a fresh root shell, never one the backup settings were
  loaded into (scripts/BACKUPS.md).

`NEXT_DIST_DIR` is for the deploy's build only. Never put it in `.env`: the
server would then serve a folder the deploy does not swap.

## Email and alerts

Email goes out when `EMAIL_ENABLED=true` and `SMTP_HOST` is set, plus
`SMTP_USER` and `SMTP_PASS` for a mail server that needs a login (with
neither set, no login is attempted). `SMTP_PORT` defaults to 587 and
`SMTP_FROM` to `WorkwrK <noreply@workwrk.com>`, and `EMAIL_REPLY_TO`, the
Reply-To on every email, to `hello@workwrk.com`: replies go there, never to
`SMTP_FROM`. Those are the only names the code reads (`src/lib/email.ts`). Without `EMAIL_ENABLED` in production the
queue is held and nothing is marked sent; `/api/cron/email-queue` answers 503
while any email is waiting, and once mail is set up everything waiting goes
out. A send that fails is tried again after 1, 5, 30, 120 and 360 minutes,
then closed as FAILED. A row a crash or a reload interrupted mid-send is
taken again once its 15 minute claim runs out, however old it is (a backlog
held while mail was off is not lost to a reload during its flush), unless
that was its sixth and last try: then the next run closes it as FAILED.

Every scheduled job answers 500 when it fails (the cron log records curl's
failure, `curl -fsS`): a job that throws, and one whose run reports failures.
That includes `/api/email/send-reminders`, whose seven rows are scheduled
jobs too. Calendar sync and scheduled agents count as failed only when every
subscription, or every run, of the round failed for a reason on the server's
side (Google refusing the app itself, or WorkwrK's own AI key failing); a
person who revoked Google access, a calendar that was deleted or unshared
(Google answers 404), or a workspace's own AI key, is theirs to fix and never
counts. A token Google refuses before its expiry (401) is refreshed once and
the sync tried again, so the round counts Google's own reason. A failing run
logs `[cron-failure] <job>` in pm2's log and, when `OPS_ALERT_EMAIL` is set,
queues one email to that address at most every six hours per job
(`src/lib/cron-result.ts`).

The email-queue job is the exception: its alert would wait in the queue that
is failing, so it sends none, and `/api/health` does not check email either.
Most sends and their retries run in the request that queued them, so this
job also answers 500 when mail is failing between its own runs: an email that
has already failed is waiting to try again, it was queued more than 30
minutes ago, and nothing at all was sent in the last 30 minutes (one bad
address among mail that goes out never counts). What shows it failing is the
cron log, and the dead-man check on its crontab row (scripts/CRON-SETUP.md,
the email-queue row), which is a launch step in `LAUNCH-CHECKLIST.md`.

## The Staff console needs `ADMIN_HOST` in production

The Staff console (`/admin`, `/api/admin/*`) is the cross-company back-office
for WorkwrK's own staff. It is gated on the `PlatformAdmin` allow-list in the
layout and in every API route, and that gate is the security boundary. The
host split is the second wall, and it is only up when the server has:

```
ADMIN_HOST=admin.workwrk.com
NEXT_PUBLIC_APP_URL=https://app.workwrk.com
```

With `ADMIN_HOST` set, `src/proxy.ts` serves only `/admin`, `/api/admin`,
`/api/auth`, `/login`, `/forgot-password`, `/_next` and `/favicon.ico` on
that host, redirects
everything else there to `/admin`, and rewrites `/admin` and `/api/admin` to
`/404` on every other host, so the console is not discoverable from the
customer app or the marketing site.

With `ADMIN_HOST` unset the console still works, but the split does not:
`/admin` answers on the app host, gated only by the allow-list. That is the
documented development behaviour and it is not acceptable in production
(`docs/plans/subdomain-architecture.md`, `docs/plans/ui-refresh/access-model.md`
section 1.9).

`NEXT_PUBLIC_APP_URL` is required alongside it: the console's "WorkwrK" back
link on the denial page and its My settings link are absolute, because the
admin host does not serve product routes and a relative link would bounce
back to `/admin`.

`PLATFORM_STAFF_BOOTSTRAP_EMAILS` is a local-development convenience only and
is ignored when `NODE_ENV` is `production`; never set it on the server. The
first production staff member is the row `prisma/migrations/20260614154258_platform_admin`
seeds; every later one is added from Staff console › Staff.

## The Staff console's schema

`prisma/sql/2026-09-27-staff-console.sql` (in the deploy manifest) adds the
`StaffAction` table and `PlatformAdmin.consolePrefs`. Apply it BEFORE the
code: the running release never names either object, but the new release
logs a StaffAction row inside every staff write's transaction, so until the
file lands every staff write fails closed with a 500 (nothing changes, nothing
is lost). Apply it with `prisma db execute --file <file>` and NO `--schema`
flag: this Prisma 7 CLI rejects `--schema` on `db execute` ("unknown or
unexpected option"). Check the command's own exit status; a pipe such as
`| tail` hides the failure.

`/login` on `ADMIN_HOST` is the staff sign-in: "Sign in to the WorkwrK staff
console" and no Start your free trial link (`src/app/(auth)/login/page.tsx`
compares the request host with `ADMIN_HOST`, so the host header nginx
forwards must be the admin host's own).

Staff console writes are refused (403) unless they come from the console's
own origin (`src/lib/admin/staff-write-origin.ts`, run in `src/proxy.ts`):
the session cookie is shared across `.workwrk.com`, so a page on any sibling
subdomain would otherwise count as same-site. nginx must forward the
browser's `Host` header unchanged (`proxy_set_header Host $host;`).
Every write a staff member makes is recorded there in the same transaction,
so a change that cannot record itself does not happen; do not drop or
truncate the table, it is the record a customer is shown when they ask who
changed what.

### The client address (Phase 8)

Every per-address limit (the sign-in throttle, signup, password reset, invite
links, MFA codes, public forms and tables), the security activity log, API
key "last used from", acknowledgement evidence and the StaffAction IP read
the client's address in one place, `src/lib/client-ip.ts`: `X-Real-IP`
first, then the LAST `X-Forwarded-For` hop. Both are only trustworthy
because nginx writes them, so the app's `location` block must keep both
lines (aaPanel's Node project and reverse proxy templates already have them):

    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

Without the first line a client's own `X-Real-IP` would reach the app and
choose its own rate-limit bucket. If a CDN or a second proxy is ever put in
front of nginx, `$remote_addr` becomes that proxy's address and every visitor
shares one bucket; set nginx's `real_ip_header` and `set_real_ip_from` for that
proxy's ranges at the same time.
