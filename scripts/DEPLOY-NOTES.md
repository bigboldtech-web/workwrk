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
