# Staff console numbers: why the old MRR was wrong

Release note for Phase 9, Stage D (spec-admin-backoffice section 4 step 6). Read this before comparing a number on the new Overview or Analytics page with one you remember from the old console.

## What changed

The old console served both pages from one endpoint, `GET /api/admin/stats`. It is gone. Two endpoints replace it:

- `GET /api/admin/overview` for Overview: companies, people, paying companies, monthly revenue, what needs attention, the newest eight companies.
- `GET /api/admin/analytics?range=30d|3m|12m` for Analytics: revenue, growth, the signup funnel, retention, cancellations, the biggest and busiest workspaces, companies per plan. `&format=csv` downloads the same numbers.

There is no price list anywhere in the codebase any more. Both copies of the hard-coded `PLAN_PRICES` map (Starter 4,999, Growth 14,999, Scale 29,999, Enterprise 75,000) were deleted, the one in the endpoint and the one in the Analytics page.

## Why the old "Monthly Recurring Revenue" was wrong

The old number was `plan price x number of companies on that plan`, summed over every plan. That is wrong in five ways at once:

1. **It counted companies, not subscriptions.** Every company on a plan counted, whether or not anyone paid. Companies on trial, suspended companies and cancelled companies still have a plan, so they all added to "revenue".
2. **It counted lifetime deals as monthly revenue.** A company that redeemed an AppSumo code has a plan and a subscription row with no Stripe subscription behind it. It paid once, to AppSumo, and was counted every month.
3. **The prices were invented.** The four numbers were typed into the code. They were not read from Stripe, and the marketing pricing page says 8 dollars per person per month, which none of them match. They were also applied once per company, so a per-person plan counted the same for a company of 3 as for a company of 300.
4. **The currency was invented.** The page formatted the number as Indian rupees (`en-IN`, `INR`) whatever currency a customer was actually billed in.
5. **The history was rebuilt with today's price list.** "MRR over the last 12 months" multiplied the same hard-coded prices by subscriptions that existed each month, including past-due ones.

"Active rate" had the same kind of problem: it was the share of companies whose status a staff member set to Active, presented as if it measured use. "Most Active Organizations" summed each company's lifetime tasks, KRAs, SOPs and reviews, so a customer who left years ago could still top it.

## What the numbers mean now

**Monthly revenue** is every WorkwrK Stripe subscription that is active or past due (the same "Paying" the Companies list counts), at Stripe's own price object for each item times its quantity, after the discounts on the item and on the subscription, spread over the price's interval (a yearly price counts one twelfth per month). It is reported **one line per currency** and never converted or added across currencies. "WorkwrK's" means one of the priceCatalog price ids, a customer or subscription our database holds, or checkout's metadata naming a company that exists; anything else in the same Stripe account is not counted. A subscription whose price has no single amount (tiered or metered), or whose discount has no exact amount in its currency, is not guessed: it is left out and the page says how many were left out. Lifetime deals and manual invoices are not counted. The chart is what paid invoices of those subscriptions took, by the day they were paid, before refunds. A page never waits on Stripe for more than six seconds: past that the card offers Retry while the read finishes and fills the hour's cache.

**Annual run rate** is monthly revenue times 12. **Average per paying company** is monthly revenue divided by the number of Stripe subscriptions in that currency.

**The revenue chart** is what paid Stripe invoices actually took in each period of the range (a month, or five days on the 30-day range), per currency. The last period is always the current one and is partial.

Stripe is asked at most once an hour; the Revenue card says when the figures are from. When billing is not connected (no Stripe key on the server) every revenue slot says "Not connected" or "Billing is not connected yet". It never shows a zero in place of a missing number, and never prints a variable name.

**Paying** (Overview) is companies on a Stripe subscription that is active or past due: exactly the Companies list's Paying view.

**Still active** (Retention) means somebody in that workspace did something recorded in its activity log in the last 30 days. It is no longer the billing status. "Somebody in that workspace" is a person whose home workspace or membership is that company; the signup row, signing in and out, switching workspaces, a person's own security settings, data migrations and every staff row do not count (lib/admin/workspace-use.ts). Cohorts hold only companies that signed up inside the range.

**Signup funnel** counts one group of companies, those that signed up in the range, through nested steps: finished setup; of those, created at least one SOP, KRA or task (board tasks included); of those, paying. No step can exceed the one above. The old funnel counted "created something" across every company in the product, so that step could be larger than the number who signed up.

**Busiest workspaces** counts recorded actions in the selected range only, by the same rule as Still active.

**Plans** counts every company that is not cancelled, per plan. There is no revenue per plan, because Stripe does not know our plan names.

## What a founder will see on the first day

- Locally and on any server without a Stripe key: "Not connected" where revenue was. The old figure there was fiction.
- In production with Stripe connected: a number in the currency Stripe charges, very likely much smaller than the old one, because trials, suspended companies, cancelled companies and lifetime deals no longer count, and the prices are the real ones.
- No "Active rate" and no "Projected ARR" tile. The run rate is a line in the Revenue card.

## Operator notes

- Revenue reads `STRIPE_SECRET_KEY` only through `isBillingLive` in `src/services/billing.ts`. How to connect it belongs in the staff runbook (`STAFF_RUNBOOK_URL`); the page links there when the runbook URL is set.
- Stripe lists stop at 10,000 records; past that the Revenue card says the figure is a floor.
- The code: `src/lib/admin/numbers.ts` (pure, tested in `numbers.test.ts`), `src/lib/admin/stripe-revenue.ts` (the Stripe reads and their cache), `src/app/api/admin/overview/route.ts`, `src/app/api/admin/analytics/route.ts`.
