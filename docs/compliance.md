# Compliance Architecture

This document describes the technical layer WorkwrK ships for privacy and
cookie compliance across multiple jurisdictions, plus **what still needs a
lawyer** before you run ads in any given country.

## What the code does

### 1. Geo-aware consent regimes
[src/lib/compliance/regions.ts](../src/lib/compliance/regions.ts) maps a
visitor's country/region to one of three regimes:

| Regime | Countries | UX |
|---|---|---|
| `OPT_IN_STRICT` | EU/EEA, UK, CH, BR, IN, CN, KR, TH, JP, CA (Canada), AU, SG, NZ, TR, ZA, AE, SA, IL, MX, AR, CO, RU, unknown | No non-essential cookies until explicit consent. Reject-all and Accept-all given equal prominence. |
| `OPT_OUT` | US states with comprehensive privacy laws (CA, CO, CT, UT, VA, TX, OR, MT, IA, DE, NH, NJ, IN, TN, MN) | Cookies allowed by default. Prominent "Do Not Sell or Share" link. |
| `NOTICE_ONLY` | Other US states, rest of world | Informational banner, dismissible. |

Country/region comes from Vercel or Cloudflare headers
(`x-vercel-ip-country`, `cf-ipcountry`, `x-vercel-ip-country-region`).

### 2. Consent banner + storage
- Banner: [src/components/layout/consent-banner.tsx](../src/components/layout/consent-banner.tsx)
- Provider / hook: [src/components/layout/consent-provider.tsx](../src/components/layout/consent-provider.tsx) + `useConsent()`
- Client helpers: [src/lib/compliance/consent-client.ts](../src/lib/compliance/consent-client.ts)

Consent state is stored in a cookie `wwrk_consent` (6 months, GDPR-recommended)
and every grant/withdrawal is also persisted server-side in the `ConsentRecord`
table — ip, user-agent, policy version, method, timestamp — giving you
evidence of lawful basis.

### 3. Policy versioning
`POLICY_VERSION` in [src/lib/compliance/server.ts](../src/lib/compliance/server.ts).
Bump whenever material terms change and every user will be re-prompted
automatically — the banner reopens because the cookie version won't match.

### 4. Data Subject Rights endpoints
- **`GET /api/me/export`** — GDPR Art. 15 / CCPA Right to Know. Returns a
  JSON download of all personal data we hold about the requester.
- **`POST /api/me/delete`** — GDPR Art. 17 / CCPA Right to Delete. Anonymizes
  the user row; retains organizational records in anonymized form per
  Art. 17(3) / legitimate-interest exceptions. Requires typed-email
  confirmation.
- Both exposed in the UI at `/settings → Privacy` tab.

### 5. Do Not Sell/Share
- Page: `/do-not-sell` — one-click opt-out that updates the cookie + logs an
  auditable `ConsentRecord` with `doNotSell: true` and `method: "dnsmpi"`.

### 6. Legal template pages
- `/privacy` — existing policy page
- `/terms` — existing terms
- `/cookies` — **new**, covers what each cookie category does + regional rights
- `/do-not-sell` — **new**, California/state opt-out
- Footer updated to surface all four links + DPO email

### 7. ConsentRecord table (Prisma)
See [prisma/schema.prisma](../prisma/schema.prisma) (end of file). Fields
include `userId`, `sessionId`, each consent category, `region`, `country`,
`policyVersion`, `method`, `ipAddress`, `userAgent`, `withdrawnAt`. **Never
delete rows** — retain for the statute of limitations in each jurisdiction.

## Running the migration

The schema change is **additive only** — it creates a new table and a
client-side back-relation. No existing data can be lost.

```bash
# Generate Prisma types (updates src/generated/prisma)
npx prisma generate

# Create + apply the migration
npx prisma migrate dev --name add_consent_records
```

On production (where you can't migrate interactively):
```bash
npx prisma migrate deploy
```

## Gating non-essential scripts

Before loading any analytics/marketing snippet, check `useConsent().consent`:

```tsx
"use client";
import { useConsent } from "@/components/layout/consent-provider";

export function AnalyticsLoader() {
  const { consent } = useConsent();
  useEffect(() => {
    if (consent.analytics) loadPostHog();
    if (consent.marketing) loadFacebookPixel();
  }, [consent]);
  return null;
}
```

Do **not** load PostHog, GA, Meta Pixel, LinkedIn Insight, etc. unconditionally.

## What this does NOT cover — get a lawyer

The technical plumbing is ready. **You must not ship to ads without** the
following legal work, which no amount of code can do for you:

### Required before launch in any EU/EEA country
1. **Data Processing Agreements** (Art. 28) with every sub-processor:
   your hosting provider, Stripe, your email provider, analytics vendor,
   AI providers (Anthropic), error monitoring. Each has a standard DPA
   you can sign online.
2. **Record of Processing Activities (ROPA)** under Art. 30. A document
   listing every processing purpose, legal basis, categories of data subjects,
   retention period, recipients, and international transfers.
3. **Data Protection Impact Assessment (DPIA)** under Art. 35 if you process
   employee data at scale (which you do). Templates from CNIL or the ICO work.
4. **EU Representative** under Art. 27 if you have no EU establishment. Paid
   service, ~€100/mo, e.g. EU-rep.com, DataRep.com.
5. **UK Representative** under UK-GDPR Art. 27 if no UK establishment.
6. **Standard Contractual Clauses** for cross-border transfers out of the EEA/UK.
   If your DB is in an AWS EU region, you may be fine intra-EEA; check Vercel
   region and Anthropic API region.
7. **Privacy policy review by counsel** — my generated `/privacy` and `/cookies`
   pages are templates, not legal advice.
8. **Appoint a DPO** if you process special-category data (health, biometric)
   or monitor at scale. Most HR SaaS at your scale needs one.

### Required for California / other US states
1. **CCPA/CPRA notices** in the privacy policy (specific categories sold/shared,
   retention periods, consumer rights, authorized-agent process).
2. **Global Privacy Control** — browser signal respect. The current banner
   does not yet read the `Sec-GPC: 1` header; add that before launching in CA.
3. **Training for any staff handling DSR requests** — 45-day response deadline.

### Required for Brazil (LGPD)
1. **DPO appointment** (Encarregado) — required for all controllers.
2. **Portuguese-language privacy notice** linked from the footer.

### Required for India (DPDPA 2023)
1. **Explicit, itemized notice** in English + relevant regional language.
2. **Consent Manager** integration if using one — being rolled out.

### Required for China (PIPL)
1. **Separate consent** per processing purpose. Single "accept all" is not
   sufficient.
2. **Security assessment** or Standard Contract filing for any data leaving
   mainland China. Very restrictive — talk to a specialist.

### Universally needed
1. **Cyber insurance** covering data-breach response.
2. **Breach notification procedure** (72-hour deadline under GDPR).
3. **Retention schedule** documented per data category.
4. **Vendor review cadence** — annual for processors.

## Implementation checklist before running ads

- [ ] `npx prisma migrate deploy` on production
- [ ] Verify CDN sets `x-vercel-ip-country` or `cf-ipcountry` headers (check
      Network tab — should see it in a server-side fetch response)
- [ ] Update `POLICY_VERSION` any time you edit `/privacy`, `/cookies`, or
      `/terms`
- [ ] Replace `dpo@workwrk.com` with a monitored inbox
- [ ] Fill in postal address + EU/UK reps in `/cookies/page.tsx`
- [ ] Have counsel review `/privacy`, `/terms`, `/cookies`, `/do-not-sell`
- [ ] Sign DPAs with hosting provider, Stripe, Anthropic, analytics provider
- [ ] Gate every analytics/marketing script behind `useConsent().consent`
- [ ] Add `Sec-GPC` header respect (California)
- [ ] Add Brazilian Portuguese + Indian language translations to existing i18n
      system before targeting ads in those countries
- [ ] Cyber insurance quote
- [ ] Document your ROPA
- [ ] Write a breach-response runbook
