# WorkwrK Launch Checklist

Last updated: 2026-05-07.
Owner: Ibrahim.
Stack: aaPanel + Cloudflare DNS + PM2 + git-pull/npm-build/pm2-reload deploys.

This is the only thing you need to do to take WorkwrK from
"code-ready" to "strangers can use it." Code is shippable today;
what's left is server config and packaging.

Each item is one of:
- 🔴 **Blocker** — strangers can't use the app without this
- 🟡 **Should-do** — fine to launch without, but ship within first week
- 🟢 **Post-launch** — sometime in the first month

---

## What Claude finished for you

- ✅ **AppSumo redemption flow** — schema + migration deployed, customer `/redeem` page, staff `/admin/appsumo` bulk-import + filter + refund UI.
- ✅ **Sandbox demo org seeded in prod** — 8 users, 4 SOPs, 2 KRAs, 4 KPIs, 3 cascaded OKRs. Reviewers log in at `admin@sandbox.workwrk.com` / `demo-1234`.
- ✅ **Cron schedules documented** for aaPanel — see [scripts/CRON-SETUP.md](scripts/CRON-SETUP.md).
- ✅ **Marketing site verified** — `/privacy`, `/terms`, `/help-center`, `/compare`, all `/features/*` populated.
- ✅ **Production secrets generated** (below).
- ✅ Type-check + build clean.

---

## 🔴 Blockers — must do before public launch

### 1. Rotate the Postgres DB password (5 min) — *do later, you said*
- aaPanel → **PostgreSQL Manager** → **DB List** → **workwrk** → reset password
- Update `DATABASE_URL` in `.env` (or aaPanel Node config)
- `pm2 restart workwrk`

### 2. Set production environment variables (10 min)
SSH in and edit your `.env.production` (or use aaPanel Node config UI).

Add these:
```
ADMIN_HOST=admin.workwrk.com
APP_HOST=workwrk.com
CUSTOM_DOMAINS_ENABLED=true
CRON_SECRET=b205e8314f25686b30892b1adb60e654e35a9c1e427a15da9d62fe4a6f322eb1
SECRETS_ENCRYPTION_KEY=e13f9e09c2096a2263b1cb3d7e0ae183a172be66c04e678759a2b446cdeedc68
```

Verify these existing ones are also present:
- `DATABASE_URL`
- `NEXTAUTH_URL=https://workwrk.com`
- `NEXTAUTH_SECRET`
- `ANTHROPIC_API_KEY`
- `S3_*` (for SOP screenshots)
- Email provider creds (`SMTP_*` or `RESEND_API_KEY`)

Then: `pm2 restart workwrk` (replace `workwrk` with your actual PM2 process name; `pm2 ls` to find it).

### 3. Stripe configuration (30 min)
Add to `.env.production`:
```
STRIPE_SECRET_KEY=<your live key, sk_live_...>
STRIPE_WEBHOOK_SECRET=<from your Stripe webhook endpoint>
STRIPE_PRICE_GROWTH_PER_USER=<price ID>
STRIPE_PRICE_TEAM_FLAT=<price ID>
STRIPE_PRICE_GROWTH_FLAT=<price ID>
STRIPE_PRICE_SCALE_FLAT=<price ID>
```

In Stripe dashboard:
1. **Developers → Webhooks → Add endpoint**
2. URL: `https://workwrk.com/api/billing/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. Copy the signing secret → that's `STRIPE_WEBHOOK_SECRET`

Restart PM2 after env change.

### 4. DNS + admin subdomain (Cloudflare + aaPanel) (15 min)
**Cloudflare:**
- Dashboard → `workwrk.com` → DNS → **Add Record**
- Type: `A`, Name: `admin`, IPv4: `<your server's public IP>`, Proxy: orange-clouded ON (or off — your call)

**aaPanel:**
1. Website → **Add Site**: domain = `admin.workwrk.com`, point to the **same Node app directory** as `workwrk.com`, same port.
   - Or: keep one Node app, add `admin.workwrk.com` as an additional domain on the existing site.
2. SSL → **Let's Encrypt** → enable for `admin.workwrk.com`.
3. Reverse Proxy → set up the same proxy as your main site (proxy to `127.0.0.1:<your-node-port>`).

The middleware reads the host header and routes `/admin` only when the host matches `ADMIN_HOST`. No code changes needed — both domains hit the same Node process, the middleware handles the split.

### 5. Set up the cron jobs (10 min)
Open [scripts/CRON-SETUP.md](scripts/CRON-SETUP.md) and add the 7 cron entries in aaPanel's Cron Manager. Each is a one-line curl. Without these:
- Emails queue but never send
- OKR reminders never fire
- Webhook retries don't happen
- Calendar sync stops

### 6. Smoke test as 4 different roles (45 min)
**Don't skip this.** Use the seeded Sandbox org in prod:

| URL | Login | Verify |
|---|---|---|
| `https://workwrk.com/login` | `admin@sandbox.workwrk.com` / `demo-1234` (CEO/Admin) | Sees everything in sidebar; org-wide dashboard |
| same | `engineering@sandbox.workwrk.com` / `demo-1234` (Manager) | Sees AI / Tools / People / Process Runs / Analytics; team-scoped data |
| same | `alex@sandbox.workwrk.com` / `demo-1234` (Employee) | Does NOT see AI / Tools / People / Process Runs / Analytics / Onboarding / Talent / Assets / Integrations; personal-only dashboard |
| same | Same Employee | `/sops` shows only assigned + folder-accessible SOPs; `/tasks` defaults to "My tasks" |

If anything looks wrong, copy the URL + describe what you saw and I'll fix.

### 7. Email deliverability (15 min)
1. Trigger an invite: log in as Admin → People → Invite a real test address.
2. Check inbox + spam folder.
3. If hitting spam: set up SPF, DKIM, and DMARC records in Cloudflare for the sending domain. Most email providers (Resend, SendGrid, Postmark) give you the exact DNS rows to copy.

---

## 🟡 Should-do — first week

### 8. AppSumo deal terms + import codes
The redemption flow is built. You need:
- Decide tier counts (defaults built into the admin UI: T1 = Growth/5 seats, T2 = Scale/25 seats, T3 = Enterprise/unlimited).
- Get codes from AppSumo merchant dashboard.
- Visit `https://admin.workwrk.com/admin/appsumo` (after step 4) → **Bulk import** tab → paste codes → done.
- Test by redeeming one code as a fresh test customer at `/redeem`.

### 9. Demo collateral
- 60–90s Loom showing: SOP creation → assignment → compliance.
- Sandbox login published on marketing pages: `https://workwrk.com/demo` already exists — link it.
- Help center: skim once for typos.

### 10. G2 + AppSumo profile prep
- Logo, screenshots, integrations, pricing all filled.
- Comparison pages already live at `/compare`.
- Seed 5+ G2 reviews from real customers.

### 11. Customer support
- Real `support@workwrk.com` inbox someone monitors.
- The `?` icon in topbar already links to `/help-center`.

### 12. Monitoring
- Uptime: UptimeRobot free tier ping `https://workwrk.com/api/health` every 5 min.
- Error tracking: Sentry isn't wired yet. Half-day to add if you want it.
- aaPanel: enable email notifications on PM2 process crashes.

---

## 🟢 Post-launch — first month

- Founder analytics dashboard (MRR, signup funnel, churn) at `/admin/analytics`.
- Lighthouse performance budget ≥ 80.
- Mobile responsiveness audit.
- Verify the daily `pg_dump` cron is producing backups in `/backups/pg/`; document the restore procedure.
- More integrations.

---

## Honest sequence to launch

1. Steps 2 → 5 today (env, DNS, crons) — the app actually starts behaving like prod.
2. Step 6 (smoke test as 4 roles) — surfaces UX bugs.
3. Steps 3 + 7 (Stripe + email) — anything you can test from inside.
4. Steps 8–11 (collateral) — what you need to list.

Soft-launch to friendly customers any time after step 6 passes.
List on G2 once steps 9–11 are done.
List on AppSumo once step 8 is done.

## File reference

- [`scripts/CRON-SETUP.md`](scripts/CRON-SETUP.md) — exact aaPanel cron entries
- [`scripts/seed-demo-org.ts`](scripts/seed-demo-org.ts) — sandbox seeder (already run)
- [`vercel.json`](vercel.json) — **NOT USED** (kept as schedule reference)
- [`src/app/api/appsumo/redeem/route.ts`](src/app/api/appsumo/redeem/route.ts) — customer redemption
- [`src/app/(admin)/admin/appsumo/page.tsx`](src/app/(admin)/admin/appsumo/page.tsx) — staff bulk-import
- [`src/lib/permissions.ts`](src/lib/permissions.ts) — permission matrix
- [`src/middleware.ts`](src/middleware.ts) — admin host split + custom domain header
