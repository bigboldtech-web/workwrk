# Deploy notes

Things the production environment must have that the code cannot check for
itself. Read before a release that touches any of them. The full list of
variables and hosts is in `LAUNCH-CHECKLIST.md`.

## How a release reaches the server (Batch 12)

`.github/workflows/deploy.yml`, after CI passed on a push to `main`:

1. It asks GitHub whether CI passed for that exact commit, and deploys that
   commit, never "whatever main is now". A manual run (Actions > Deploy > Run
   workflow) takes an optional commit sha and is held to the same check, so
   going back to an earlier commit is a manual run with its sha.
2. On the box: `git reset --hard <sha>`; `npm ci` only when
   `package-lock.json` changed (the hash it last installed is in
   `node_modules/.deploy-lock-hash`), otherwise `prisma generate`.
3. `npm run deploy:migrate`: the SQL manifest and pending Prisma migrations,
   each SQL file under a 5 second lock timeout, tried up to four times.
4. `next build` into `.next-staging` (`NEXT_DIST_DIR`), while the server keeps
   serving `.next`. A failed or killed build changes nothing that is live.
5. `chown`, then `.next` becomes `.next-prev`, `.next-staging` becomes
   `.next`, and `pm2 reload`.
6. The check: `NEXTAUTH_URL/api/health` must name the new build within two
   minutes, then `/login` and one of the build's scripts must answer 200. If
   not, the deploy puts `.next-prev` back, resets the source to the previous
   commit, reloads, checks the old build, and fails with the reason. The
   build that failed stays in `.next-failed` to look at.

Every failure prints its reason as an annotation (`::error::`), readable
through the public API without the Actions log. `deploy-migrate.log` and
`deploy-build.log` in the app directory keep the last run's output.

To roll back by hand on the box, while `.next-prev` is there:
`mv .next .next-failed && mv .next-prev .next && pm2 reload workwrk --update-env`.
A manual Deploy run with the earlier commit's sha is the better way, since it
also brings the source back.

`NEXT_DIST_DIR` is for the deploy's build only. Never put it in `.env`: the
server would then serve a folder the deploy does not swap.

## Email and alerts

Email goes out only when `EMAIL_ENABLED=true` and `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are set: those are the only names the
code reads (`src/lib/email.ts`). Without `EMAIL_ENABLED` in production the
queue is held, nothing is marked sent, and `/api/cron/email-queue` answers 503
every minute until mail is set up; then everything waiting goes out. A send
that fails is tried again after 1, 5, 30, 120 and 360 minutes, then closed as
FAILED. A row a crash or a reload interrupted mid-send is taken again 15
minutes later, or closed as FAILED once it is a day old, rather than sent late.

Every scheduled job that fails answers 500 (the cron log records it as a
failure, `curl -fsS`) and, when `OPS_ALERT_EMAIL` is set, queues one email to
that address at most every six hours per job (`src/lib/cron-result.ts`).

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
