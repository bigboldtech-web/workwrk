# Deploy notes

Things the production environment must have that the code cannot check for
itself. Read before a release that touches any of them.

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
`/api/auth`, `/login`, `/_next` and `/favicon.ico` on that host, redirects
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
is lost). Apply it with `prisma db execute --file <file>`: this Prisma 7 CLI
rejects `--schema` on `db execute`.
Every write a staff member makes is recorded there in the same transaction,
so a change that cannot record itself does not happen; do not drop or
truncate the table, it is the record a customer is shown when they ask who
changed what.
