# WorkwrK Launch Checklist

Last updated: 2026-05-06.
Owner: Ibrahim.

This is **the only thing you need to do** to take WorkwrK from
"code-ready" to "strangers can use it." Code is shippable today;
what's left is environment setup and packaging on your side.

Each item below is one of:
- 🔴 **Blocker** — strangers can't use the app without this
- 🟡 **Should-do** — fine to launch without, but ship within first week
- 🟢 **Post-launch** — sometime in the first month

---

## What I (Claude) finished for you in this round

- ✅ **Vercel cron schedules** — every cron endpoint (OKR reminders, surveys-rotate, email-queue, calendar-sync, etc.) wired in `vercel.json`. They'll fire automatically once you deploy.
- ✅ **AppSumo redemption flow built end-to-end** — schema, migration applied to prod, customer-facing `/redeem` page (only org admins can redeem), staff `/admin/appsumo` page for bulk-importing codes from CSV + filtering by status + marking refunds. **Just paste codes and go live on AppSumo when you're ready.**
- ✅ **Demo / sandbox seeder** — `scripts/seed-demo-org.ts` creates a "Sandbox" org with 8 users across 4 departments, 4 SOPs, 2 KRAs + 4 KPIs, 3 OKRs cascaded company → team → individual, 2 announcements, and 3 kudos. Reviewer login: `admin@sandbox.workwrk.com` / `demo-1234`.
- ✅ **Marketing site verified** — `/privacy`, `/terms`, `/help-center`, `/compare`, all `/features/*` pages exist with real content.
- ✅ **Production secrets generated** (below).
- ✅ Type-check + build clean.

---

## 🔴 Blockers — must do before public launch

### 1. Rotate the Neon DB password (5 min)
The current production password was pasted in chat. Treat it as compromised.
- Neon dashboard → **Project: Theywrk** → **Settings** → **Reset password**
- Update `DATABASE_URL` in Vercel env (Production + Preview)
- Re-deploy

### 2. Set production environment variables (10 min)
In **Vercel → Settings → Environment Variables**, set these for **Production**:

| Var | Value |
|---|---|
| `ADMIN_HOST` | `admin.workwrk.com` |
| `APP_HOST` | `workwrk.com` |
| `CUSTOM_DOMAINS_ENABLED` | `true` |
| `CRON_SECRET` | `b205e8314f25686b30892b1adb60e654e35a9c1e427a15da9d62fe4a6f322eb1` |
| `SECRETS_ENCRYPTION_KEY` | `e13f9e09c2096a2263b1cb3d7e0ae183a172be66c04e678759a2b446cdeedc68` |

Existing vars to verify present:
- `DATABASE_URL` (after rotation)
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- `ANTHROPIC_API_KEY`
- `S3_*` (for SOP screenshots)
- Email provider creds (`SMTP_*` or `RESEND_API_KEY` etc)

### 3. Stripe configuration (30 min)
- `STRIPE_SECRET_KEY` (live key, not test)
- `STRIPE_WEBHOOK_SECRET` (from your Stripe webhook endpoint)
- `STRIPE_PRICE_GROWTH_PER_USER`, `STRIPE_PRICE_TEAM_FLAT`, `STRIPE_PRICE_GROWTH_FLAT`, `STRIPE_PRICE_SCALE_FLAT` — one per plan
- In Stripe dashboard, add webhook endpoint: `https://workwrk.com/api/billing/webhook`
- Subscribe to events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

### 4. DNS for admin subdomain (15 min)
- Add CNAME: `admin.workwrk.com` → `cname.vercel-dns.com`
- In Vercel → Settings → Domains, add `admin.workwrk.com` and verify
- Once DNS propagates, the middleware automatically routes `/admin` only to that hostname

### 5. Smoke test as 4 different roles (45 min)
**Don't skip this.** Easiest path: run the demo seeder against prod (item 7 below) and log in with the five seeded accounts. Or create test users in Cashkr.

For each role, log in and verify:
- Sidebar shows the right items (employees should NOT see AI / Tools / People / Process Runs / Analytics / Onboarding / Talent / Assets / Integrations)
- Dashboard shows the right widgets
- `/sops` shows the right SOPs (folder access scoping)
- `/people` shows the right people (employees don't see it; managers see their team)
- `/tasks` defaults to "My tasks"
- Settings → Branding upsell shows for non-admins; works for admin
- Settings → AI upsell shows for non-Enterprise

### 6. Email deliverability (15 min)
Send a real email from each transactional path:
- Password reset
- Team invite
- One OKR reminder (manually trigger `/api/cron/okr-reminders`)
Check inbox + spam folder. If hitting spam, fix SPF/DKIM/DMARC on the sending domain.

---

## 🟡 Should-do — first week (or before AppSumo / G2 listing)

### 7. Run the demo seeder against prod (10 min)
```bash
DATABASE_URL=<prod url> SEED_PASSWORD=<your choice> npx tsx scripts/seed-demo-org.ts
```
Creates a `Sandbox` org reviewers can poke without signing up. Pin the
login details in your AppSumo / G2 listing as "Try it as a reviewer."

### 8. Set up AppSumo deal + import codes
The redemption flow is built. You just need to:
- Decide on tier counts (suggested defaults built into the admin import UI: T1 = Growth / 5 seats, T2 = Scale / 25 seats, T3 = Enterprise / unlimited)
- Get codes from AppSumo merchant dashboard
- Visit `https://admin.workwrk.com/admin/appsumo` (after DNS) → **Bulk import** tab → paste codes → done
- Test by redeeming one code as a fresh test customer at `/redeem`

### 9. Public-facing collateral
- **Demo video**: 60–90s Loom showing the SOP → assignment → compliance flow. Embed on marketing homepage + use on G2 + AppSumo.
- **Public sandbox**: with the seed script run, you have one. Just publish the credentials.
- **Help center**: already populated. Skim once for typos.

### 10. G2 profile prep
- Profile completion at 90%+ (logo, screenshots, integrations, pricing)
- Comparison pages already exist at `/compare` — re-skim to make sure tables are accurate
- Seed 5+ reviews from real customers (Cashkr team members) to get past the "no reviews" trust gap

### 11. Customer support pipeline
- A real `support@workwrk.com` inbox someone monitors
- The in-app `?` button (already in topbar) links to `/help-center`
- Slack notification on critical bugs

### 12. Monitoring & alerts
- Vercel deployment notifications
- Sentry or similar for runtime errors (not yet wired)
- Uptime monitor (UptimeRobot free tier is fine)

---

## 🟢 Post-launch — first month

- Analytics dashboard for *you* (not the customer): MRR trend, signup funnel, churn
- Performance budget on the app (Lighthouse score ≥ 80)
- Mobile responsiveness audit on small screens
- Backup / restore procedure documented
- SOC 2 readiness if going upmarket
- More integrations (Slack, Notion, Linear, Asana)

---

## My honest founder take

If you finish blockers 1–6 (about 2 hours of focused work), you can
soft-launch this week. The seeded Sandbox org makes the smoke test
faster — log in with five reviewer accounts in 30 minutes.

For **AppSumo**: do blockers 1–6 + items 7, 8, 9 = ready to list. The
redemption flow exists; it just needs your deal terms and a CSV of codes.

For **G2**: do blockers 1–6 + items 9, 10, 11 = ready to list. Get five
internal reviews from your Cashkr team to prime the well.

## Files / references

- [`vercel.json`](vercel.json) — deploy config + cron schedules
- [`scripts/seed-demo-org.ts`](scripts/seed-demo-org.ts) — sandbox seeder
- [`scripts/MIGRATE-SOPS.md`](scripts/MIGRATE-SOPS.md) — historical SOP folder migration record
- [`src/app/api/appsumo/redeem/route.ts`](src/app/api/appsumo/redeem/route.ts) — customer redemption endpoint
- [`src/app/(admin)/admin/appsumo/page.tsx`](src/app/(admin)/admin/appsumo/page.tsx) — staff bulk-import UI
- [`src/lib/permissions.ts`](src/lib/permissions.ts) — single source of truth for default permissions
- [`src/lib/access-levels.ts`](src/lib/access-levels.ts) — single source of truth for access level enum
- [`src/middleware.ts`](src/middleware.ts) — admin host split + custom domain header
