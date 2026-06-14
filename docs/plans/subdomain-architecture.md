# Subdomain architecture — three surfaces, one app

> Status: PLAN (2026-06-14). Decided: split by hostname; gate the admin
> back-office to **WorkwrK platform staff** (not tenant roles). Build after
> the current polish batch (workspace switcher + error boundaries) ships.

## The three audiences

| Surface | Hostname | Who | Serves |
|---|---|---|---|
| Marketing | `workwrk.com` (apex) | Public visitors | `(marketing)` + `(public)` route groups |
| Product (SaaS) | `app.workwrk.com` | Customers who bought WorkwrK (tenant users) | `(dashboard)` + `(auth)` |
| Back-office | `admin.workwrk.com` | **WorkwrK employees** (us, the makers) | `(admin)/admin` — every tenant's data + ARR |

It is **one Next.js app / one pm2 process**. The split is by `Host` header, not
separate deployments.

## What already exists (don't rebuild)

- `(marketing)` / `(public)` groups → the public site (`/`, `/features`, `/pricing`, `/demo`, `/contact`).
- `(dashboard)` group → the product (`/today`, `/spaces`, …).
- **`(admin)/admin`** → a real cross-tenant console: `Companies` (all orgs),
  `Analytics`, `AppSumo Codes`. `/api/admin/stats` already computes **MRR,
  12-month MRR history, signup funnel, cohort churn** from a `Subscription`
  model. This IS the "how much did we make" panel.
- **`src/proxy.ts`** (Next 16's renamed middleware) already implements the
  **admin host split**: when `ADMIN_HOST` is set, only `/admin`, `/api/admin`,
  `/api/auth`, `/login` pass on that host; everything else redirects to
  `/admin`; and on the customer host `/admin` + `/api/admin` are rewritten to
  `/404` (hidden from customers). Also has opt-in custom-domain header stamping.
- Stripe billing: `/api/billing/checkout`, `/api/billing/webhook`, `products/catalog.ts`.

## What's missing (the actual work)

### 1. App-vs-marketing host split (proxy addition)
Today both marketing (`/`) and the app live on `workwrk.com`. Add a branch to
`src/proxy.ts` mirroring the admin split:
- On **apex** (`workwrk.com`): allow marketing/public/auth paths; the app
  routes stay reachable but the canonical home is marketing.
- On **`app.workwrk.com`**: `/` → redirect to `/today` (or `/login` if
  unauthenticated); marketing pages optionally redirect to apex.
- Drive both off env: `APP_HOST=app.workwrk.com`, `MARKETING_HOST=workwrk.com`.

Decision to confirm at build time: do we *hard-split* (marketing 404s on
`app.`, app 404s on apex) or *soft-split* (canonical redirects, both reachable)?
Recommend **soft-split** first (safer for SEO + existing links), harden later.

### 2. Platform-staff gate (SECURITY — must fix before launch)
`(admin)/layout.tsx` currently gates on `accessLevel === "SUPER_ADMIN"` — a
**per-tenant** role. As written, any customer org's super-admin could open
`/admin` and see *every* company's revenue. Fix:
- Add `User.isPlatformAdmin Boolean @default(false)` (migration), OR a
  `PlatformAdmin` allowlist table keyed by email (lets us pre-authorize a
  WorkwrK employee before their user row exists). **Recommend the table** — it
  models "a set of WorkwrK employees" cleanly and survives re-signup.
- Gate `(admin)/layout.tsx` **and every `/api/admin/*` route** on platform-staff
  status, NOT tenant `accessLevel`. (Currently the API routes must be audited —
  the layout gate is client-side only and does not protect the APIs.)
- Seed the founding WorkwrK accounts (e.g. `bigboldtech@gmail.com`).

### 3. Cross-subdomain auth cookie
NextAuth currently uses default (host-only) cookies, so a session on
`app.workwrk.com` would NOT carry to `admin.workwrk.com`. Set the session
cookie `domain: ".workwrk.com"` in `src/lib/auth.ts` `cookies` config (only in
production; leave host-only in dev/localhost). Verify CSRF + callback cookies
match.

### 4. Infra (aaPanel — user does; I provide configs)
- **DNS**: A-records `app` and `admin` → server IP `172.236.169.129`.
- **nginx**: two new vhosts (`app.workwrk.com`, `admin.workwrk.com`) reverse-
  proxying to the same pm2 app port as `workwrk.com`. SSL via aaPanel/Let's
  Encrypt for each subdomain.
- **Env** on the server: `ADMIN_HOST=admin.workwrk.com`,
  `APP_HOST=app.workwrk.com`, `MARKETING_HOST=workwrk.com`. Restart pm2.

## Phased rollout
1. **W-1 Platform-staff model** — migration + allowlist table + seed + gate the
   admin layout *and* APIs on it. (Pure app code; deployable independently; it's
   a security fix worth doing even before subdomains.)
2. **W-2 Cookie domain** — `.workwrk.com` session cookie (prod only).
3. **W-3 Proxy app/marketing split** — env-driven host routing.
4. **W-4 Infra** — DNS + nginx vhosts + env vars on aaPanel; flip it live.
5. **W-5 Harden** — optional hard-split, security headers, audit `/api/admin/*`.

## Risks
- The admin API routes may currently rely only on the client-side layout gate —
  must be independently gated server-side (anyone could `curl /api/admin/stats`
  today if not). Audit in W-1.
- Cookie-domain change can log everyone out once; ship during a low-traffic
  window.
- Edge runtime in `proxy.ts` can't use Prisma — keep all DB-backed decisions
  (org/staff resolution) in Node-runtime API routes.
