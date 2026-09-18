# UI audit: workwrk.com marketing site

Subsystem: `src/app/(marketing)/**`, `src/components/landing/*`, `src/components/marketing/*`, plus the host-routing in `src/proxy.ts`, `src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/layout.tsx`, and the token block in `src/app/globals.css:108-144`.
Audit date: 2026-09-10. Read-only; no files modified. Every claim below cites `file:line`.

---

## 0. Executive summary (what the redesign must know first)

1. **The buy path is broken at the last click.** Every primary CTA on the site (24 occurrences: topbar "Sign up", hero "Get started, it's free", pricing "Start free" / "Start 14-day trial", CTABand default, changelog/blog "Subscribe", developers "Get an API key") links to `/signup`. No `/signup` route exists anywhere under `src/app` (only `src/app/(auth)/register/page.tsx`), there is no redirect in `next.config.ts:9-21`, and `signup` is not in `APP_PREFIXES` in `src/proxy.ts:41-55`. Result: 404 on every "buy now" click. `marketing-topbar.tsx:86`, `landing-v4.tsx:105`, `pricing/page.tsx:51,70`, `primitives.tsx:543`.
2. **The blog index links to 8 posts that do not exist.** `blog/page.tsx:23-32` hard-codes its own `POSTS` array (slugs `why-we-built-7-hubs`, `the-kpi-engine-design`, ...) while `blog/[slug]/page.tsx:5,95` resolves against `src/data/blog-posts.ts` whose slugs are `what-is-a-business-operating-system`, `how-to-build-performance-review-system`, `sop-compliance-tracking-guide`, `employee-recognition-impact-on-performance`, `ai-for-business-intelligence-practical-guide`, `kpi-tracking-mistakes-growing-businesses`. Every card on `/blog` 404s; the six real posts are reachable only from `sitemap.ts:25-30`.
3. **The demo form posts nowhere.** `demo/page.tsx:124` is `<form action="#" method="post">` with no handler, no API route, no success or error state. The "Get a demo" secondary funnel is cosmetic.
4. **Three competing design systems coexist**, none of which is the product's own `--os-*` Monday-clean flat-blue system:
   - Inner pages: `components/marketing/primitives.tsx` (ClickUp/Linear restraint: white canvas, `slate-900` black pill CTAs, 10-hue `HUES` map, `violet` default accent).
   - Home page only: `components/landing/landing-v4.tsx` and 11 section components using the monday-style `--m-*` neutrals and `--brand-red` as the primary CTA (`landing-v4.tsx:104-110`, `how-it-works.tsx:104-110`, `closing-cta.tsx:28`).
   - Orphaned "bento dark-lime" system (`--b-lime`, `--b-card`) in `faq-client.tsx`, `features/ai-engine/visuals.tsx`, `features/sops/visuals.tsx`, and 14 `scene/*` files; those tokens are only defined in `src/app/(dashboard)/app-shell.css:77-79`, so they are undefined on marketing pages.
   The brand rule in memory (YBRG, blue `#0073EA` primary, "no purple") is violated: primary CTAs are black on inner pages and red on home; violet is the default accent everywhere (`primitives.tsx:152,256,491`, `(marketing)/layout.tsx:14` selection color, `compare/page.tsx:102,168`).
5. **The product story on the site does not match the product.** Marketing sells "7 hubs" including Money (spend, vendors, procurement), Growth (pipeline, deals, CRM), and Talent (comp, recruiting) (`primitives.tsx:75-83`, `features/page.tsx:34-91`, `scroll-showcase.tsx:49-120`). Per project memory the product is a PPMS with CRM, Marketing, Finance removed from the rail (2026-06-03), and the real premium modules are Talk and Tables (`src/lib/modules.ts:24-40`). None of Talk, Tables, Canvas, Notes/Docs, Boards, Goals, Rooms, or the modular-installation model appear on the marketing site. There is no "modular / 3D product" narrative at all.
6. **Social proof is fabricated and self-incrementing.** Customer logos, quotes, "500+ teams across 8 countries", a live ticker that starts at 12,847 and increments every 6s (`customer-outcomes.tsx:495-501`), a signup counter that starts at 31,247 and increments every 5.5s (`how-it-works.tsx:293-297`), SOC 2 Type II / ISO 27001 / HIPAA / PCI-DSS badges (`enterprise-control.tsx:63-70`, `security/page.tsx:26-33`), a HackerOne bounty table (`security/page.tsx:113-127`), "$12M Series A" (`about/page.tsx:113`), three office addresses (`contact/page.tsx:40-44`), "Verified by Cure53" (`do-not-sell/page.tsx:60`). This is a legal and trust risk for a "buy now" site.
7. **Home page has no pricing section** (the `PricingPreview` component exists at `components/landing/pricing-preview.tsx` but is not imported by `landing-v4.tsx:25-42`), no product video (both "Watch the demo" CTAs go to a booking form), and its scroll-pinned showcase has no mobile fallback despite the comment claiming one (`scroll-showcase.tsx:13-15` vs `:140-200`).

---

## 1. Global shell (every marketing route)

### Layout: `src/app/(marketing)/layout.tsx`
- Wraps every page in `<div class="bg-white text-slate-900 ... selection:bg-violet-200">` (`:14`), then `<MarketingTopbar/>`, `<main>`, `<MarketingFooter/>`.
- Root `src/app/layout.tsx` applies `next-themes` `ThemeProvider attribute="class" defaultTheme="dark"` (`components/layout/providers.tsx:33-35`), so `<html class="dark">` is present on marketing pages; the marketing shell survives only because every component hard-codes light colors. `--m-*` tokens have no dark variants (`globals.css:133-139`).
- Root layout loads 7 Google font families (Outfit, JetBrains Mono, Syne, Geist, Geist Mono, Instrument Serif, Figtree) on every page (`src/app/layout.tsx:10-51`); marketing uses `font-sans` = Outfit (`globals.css:256`). Syne/Instrument Serif/Figtree are unused by the marketing code that ships.
- No `loading.tsx`, `error.tsx`, `not-found.tsx`, or `template.tsx` inside `(marketing)`; root `src/app/not-found.tsx` (zinc palette, `GoBackButton`) is the 404 for the whole site and does not use the marketing shell (no topbar/footer).
- i18n: root layout sets `lang`/`dir` from next-intl; marketing content is hard-coded English. An Arabic locale would flip `dir="rtl"` around untranslated English.

### Topbar: `src/components/landing/marketing-topbar.tsx`
Elements (desktop, `lg+`): Logo lockup → `/` (`:35-41`); `Product ▾` mega-menu (`:44-51`); `Solutions ▾` (`:52-59`); `Pricing` → `/pricing`; `Customers` → `/customers`; `Resources ▾` (`:62-69`); right cluster: `Log in` → `appHref("/login")` (`:73-78`), `Get a demo` → `/demo` (`md+`, `:79-84`), `Sign up` black pill → `/signup` (`:85-90`). Below `lg`: hamburger → full-screen `MobileMenu` (`:280-330`).
- Product menu (`:170-207`): 7 hub tiles from `HUBS` → `/features#{slug}` + "See all features" → `/features`.
- Solutions menu (`:211-248`): 7 industries → `/industries/{slug}` + "All industries".
- Resources menu (`:252-276`): Help Center, Blog, Changelog, Developers, Security, FAQ, Compare.
- Mobile menu (`:296-303`): Product→`/features`, Solutions→`/industries`, Pricing, Customers, Blog, Resources→`/help-center`; buttons Sign up (`/signup`), Get a demo, "Already have an account? Log in".
Issues:
- Mega menus open on `onMouseEnter` only (`:133`); the trigger `<button>` has no `onClick`, no `aria-expanded`, no keyboard handling → unusable via keyboard and on touch devices at `lg+` widths (iPad landscape).
- `appHref` is applied to `/login` but not to `/signup`; under `HARD_HOST_SPLIT` the sign-up click stays on the marketing host (`proxy.ts:165`) and 404s even after `/signup` is fixed to `/register`, because `register` is an app prefix and would need `appHref`.
- No signed-in state: a logged-in visitor still sees Log in / Sign up.
- Scroll-state hairline (`:28-32`) is the only interactive polish; no active-route indication in the nav.
- No language/currency/region switch although the root layout resolves currency (`src/app/layout.tsx:118`).

### Footer: `src/components/landing/marketing-footer.tsx`
- Brand column with tagline that mentions "money" (`:23-27`); social buttons to `twitter.com/workwrk`, `linkedin.com/company/workwrk`, `github.com/workwrk` (`:29-37`, unverified external handles).
- Columns: Product (Features, Pricing, Changelog, Demo), Solutions (Industries, Customers, Compare, Partners), Resources (Help Center, Blog, FAQ, Developers, Security), Company (About, Contact, Privacy, Terms) (`:42-78`).
- Bottom strip: © year, Privacy, Terms, Cookies, Do not sell (`:81-89`).
Issues: no newsletter capture, no status page, no careers, no roadmap link, no app-store/CTA repeat; header comment promises a "rainbow rim" (`:2`) that is not rendered (drift between comment and code).

### Consent banner
`components/layout/providers.tsx:8-9` mounts `ConsentProvider` + `ConsentBanner` globally, backed by `src/app/api/consent/route.ts` (cookie `wwrk_consent`). The Cookie Policy page lists different cookie names (`ww_session`, `ww_csrf`, `ww_consent`, `_ga`) at `cookies/page.tsx:18-25`; NextAuth actually uses `next-auth.session-token` (`proxy.ts:80`) and there is no Google Analytics script anywhere in `src`.

### Host routing: `src/proxy.ts`
- `MARKETING_PREFIXES` (`:31-35`) enumerates the 19 marketing first segments; `roadmap` was removed in commit `b7c9d055` and the set is consistent with the filesystem.
- Under `HARD_HOST_SPLIT`, an unknown path such as `/signup` stays on the marketing host and hits the root 404 (`:160-167`).

### SEO plumbing
- `sitemap.ts:10-23` lists only 12 static routes + 6 blog posts; missing: all 12 `/features/*`, all 7 `/industries/*`, `/compare`, `/customers`, `/demo`, `/developers`, `/security`, `/contact`, `/changelog`, `/partners`.
- Root metadata title template `"%s · WorkwrK"` (`src/app/layout.tsx:57`) plus every page setting `title: "X — WorkwrK"` yields "X — WorkwrK · WorkwrK" double branding (e.g. `pricing/page.tsx:29`).
- Home JSON-LD (`(marketing)/page.tsx:71-203`) declares a `SearchAction` to `/search?q=` (no such route), and three `Offer`s priced in INR (4,999 / 14,999 / 29,999 per month with 25/100/500 user caps) that contradict the USD "Free / $8 per user / Custom from $29,999 per year" on `/pricing`.
- `public/llms.txt` and `llms-full.txt` exist (good). `public/security.asc` referenced at `security/page.tsx:108` does not exist.

---

## 2. Route inventory

Conventions used below. "Reachable from" is written as `Topbar > menu > item`, `Footer > column > item`, `In-page: <page> > <element>`, or `URL-only`. "Back button" is answered against `BackButton` / `router.back` / `fallbackHref`: none exist in this subsystem; the only in-page back affordance is the blog post's "All posts" link. "Sidebar" is N/A except the legal pages' sticky table of contents. "Top bar" is the global topbar unless noted.

### 2.1 `/` Home
- Files: `(marketing)/page.tsx` (metadata + JSON-LD) → `components/landing/landing-v4.tsx` → 11 section components.
- Purpose: primary landing; positions WorkwrK as "the operating system that runs your people, processes & performance", "replace 15+ tools", "free forever up to 5 people".
- Reachable from: Topbar logo, Footer logo, root URL.
- Back: none. Top bar: global. Sidebar: none.
- Sections in order (`landing-v4.tsx:28-40`):
  1. **Hero** (`landing-v4.tsx:52-131`): badge "v4 marketing relaunch, read the post" → `/changelog` (not a post); H1 with red/blue/yellow word tints; lede; CTA "Get started, it's free" (brand-red pill → `/signup`), "Watch the demo" text link → `/demo` (a booking form, not a video); micro-copy "Free forever for up to 5 people. No credit card."; right: `HeroBoardMock` (`hero-board-mock.tsx`) animated People/Performance board with 4 floating chips (Cmd-K AI, ticker, KPI card, "AI auto-assigned 3 tasks"). Mock tab strip lists People/Work/KPIs/SOPs/Money/Talent/Kudos (`:29-37`), a different 7 than the `HUBS` catalog.
  2. **TrustStrip** (`:137-178`): "500+ teams across 8 countries run on workwrk" + 8 invented wordmarks as plain text.
  3. **ScrollShowcase** (`scroll-showcase.tsx`): 720vh tall section (`:144`) with a `sticky top-0 h-screen overflow-hidden` pin; left rail of 7 hubs (non-clickable `<li>`s, `:206-273`), right browser-chrome mock cross-fading per hub. Hub copy includes Money "Vendor spend $71.5k / $80k", Growth "$2.4M forecast" pipeline.
  4. **TeamWorkspaces** (`team-workspaces.tsx`): 6 team tabs (Sales, Operations, HR, Finance, Engineering, Marketing) → dense animated mock with KPI strip, sparklines, ticker, right rail of dead `<button>`s ("+ New deal", "Open Sales hub", `:753-780`), floating "Right now" chip.
  5. **ProductMosaic** (`product-mosaic.tsx`): three infinite marquee rows of 12 fixed-width (460-520px) tiles. Tile content is monday.com-derived filler unrelated to WorkwrK: "Responsible Adult · Feb 2026 / Your finances are thriving" (`:518-527`), "TaskFlow" brand (`:742,796,854`), "IT Tickets / Wifi is super slow today" (`:491`), "AI Lead Experts / Waisman Gallery" (`:696,703`), "Recruiting agent" (`:893-935`). Fonts down to 7.5px (`:605,776`).
  6. **AIAgents** (`ai-agents.tsx`): dark section; 8 named agents (@inbox, @kpi, @reviewer, @pipeline, @vendor, @recruiter, @sop, @coach) + "Build your own" tile → `#train-your-own`; tabbed "Agents at work" (Operations/Sales/HR/Finance); "Train your own" with builder mock; CTAs "Train your first agent" → `/signup`, "See the agent docs" → `/features/ai-engine`.
  7. **CustomerOutcomes** (`customer-outcomes.tsx`): auto-cycling testimonial (8s) with dot pager; "Read the {company} story" → `/customers/helios-labs`, `/customers/forge-capital`, `/customers/quill-health` (`:54,70,86`), none of which exist; 3 count-up metric cards; live ticker "12,847 teams running on WorkwrK · +47 this week" incrementing every 6s (`:495-501`).
  8. **HowItWorks** (`how-it-works.tsx`): 3 steps (Sign up free / Pick your hubs / Invite your team) with typing, checkbox and avatar mocks; "31,247 signups this quarter" counter incrementing (`:292-310`); avatars hot-linked from `api.dicebear.com` (`:418-421`); CTA "Start your workspace" → `/signup`.
  9. **EnterpriseControl** (`enterprise-control.tsx`): 6 governance pillars; compliance badge strip SOC 2 Type II / ISO 27001 / GDPR / DPDP / HIPAA / PCI-DSS (`:63-70`); `mailto:security@workwrk.com`; "Visit our trust portal" → `/security`.
  10. **IntegrationsGrid** (`integrations-grid.tsx`): 26 connectors, logos hot-linked from `cdn.simpleicons.org` (`:194`) with letter fallback; marquee + category grid; cards have hover arrow but no link (`:247-278`).
  11. **LandingFAQ** (`landing-faq.tsx`): 6 `<details>` rows; "Chat with the team" → `/contact`; copy says "$8/user above that", "See /security".
  12. **ClosingCTA** (`closing-cta.tsx`): brand-red panel, particles, radar-pulse white pill "Get started, it's free" → `/signup`, "Watch a 2-min demo" → `/demo`; reassurance row "Free forever · No credit card · 60-second signup · SOC 2 + ISO 27001".
- Controls: team tabs (6), agent workflow tabs (4), testimonial dot pager (3), FAQ accordion (6). Everything else is decorative or a dead `<button>` inside mocks (hero "Approve/Investigate" buttons `scroll-showcase.tsx:381-390`, "Sign off" `:727-733`, right-rail actions).
- UI state: **polished visually, broken functionally** (all CTAs 404; story links 404).
- Issues:
  - `/signup` 404 (8 links on this page).
  - No pricing section; no product video; hero CTA says "free", closing CTA says "14-day free trial" and "free forever" in the same sentence (`closing-cta.tsx:112-113`).
  - ScrollShowcase: no mobile fallback; on phones the 100vh sticky with `overflow-hidden` clips the 440px mock below the rail text (`scroll-showcase.tsx:146-199`). Also hijacks ~7 screens of scroll.
  - Trust numbers contradict each other on the same page: "500+ teams" (TrustStrip, CustomerOutcomes header) vs "12,847 teams" (ticker).
  - ProductMosaic content is not WorkwrK's product; several tiles reference "monday.com"-style chrome ("Integrate · Automate / 2").
  - 5 infinite marquees + 4 drifting blur blobs + particles + 4 interval timers run continuously; zero `prefers-reduced-motion` handling anywhere in `components/landing` or `components/marketing` (grep count 0).
  - Every section is a `"use client"` framer-motion component with `initial={{opacity:0}}`; without JS (or before hydration) the whole page below the hero is invisible.
  - Hover transforms (`hover:-translate-y-1`, `whileHover={{y:-6}}`) throughout, against the app's "no hover transforms" convention.
  - Colour: hero CTA red, topbar CTA black, section eyebrows red, headline accents blue/yellow/red, hub tints in 7 hues, AI section yellow accent. No single accent.

### 2.2 `/features`
- File: `features/page.tsx`.
- Purpose: index of the 7 hubs, each with 3 bullets and 1-5 sub-feature cards linking to `/features/{slug}`.
- Reachable: Topbar > Product > any hub tile (`/features#hub`) and "See all features"; Footer > Product > Features; Mobile menu > Product; in-page "Part of the X hub" on every feature sub-page.
- Back: none. Sidebar: none (a chip row of anchor jumps `:126-140`).
- Controls: hero CTAs "Try every feature free" (violet secondary → `/signup`), "Get a guided tour" → `/demo`; 7 anchor chips; sub-feature cards.
- UI state: polished (primitives style).
- Issues: `/signup` 404; Money hub's only sub-feature is "Integrations" and Growth's is "Analytics" (`:63-69`, `:84-90`), i.e. hubs with no real feature pages; Reviews and Analytics appear under two hubs each; gradient icon tiles (`:160`) contradict the primitives' "no gradient chrome" rule (`primitives.tsx:4-11`); default CTABand.

### 2.3 Feature sub-pages (12) — all rendered by `components/marketing/sub-page.tsx` `FeatureSubPage`
Shared structure (`sub-page.tsx:87-202`): hero (eyebrow, H1 with `GradientText`, lede, CTAs "Try it free" hue-coloured secondary → `/signup` and "Get a tour" outline → `/demo`, "Part of the {hub} hub" link → `/features#{hub}`) → "Core capabilities" 6 `FeatureCard`s → optional "How it works" numbered steps (gradient number badges, `:143`) → optional "Plays well with" related cards → optional `Quote` → optional `FAQ` (`<details>`) → optional `bottomSlot` → `CTABand`.
Shared issues: `/signup` 404 on every page; no breadcrumb/back beyond the hub link; no product screenshot or mock anywhere on any feature page (all icon cards + prose); hue-per-page means 5 different accent colours across sibling pages; related-card hover `-translate-y-0.5`.

| Route | File | Hub / hue | Title | Extra sections | State | Page-specific issues |
|---|---|---|---|---|---|---|
| `/features/tasks` | `features/tasks/page.tsx` | work / sky | "Tasks that don't fall through cracks." | related, quote, FAQ | polished | Claims 5 views, calendar 2-way sync, auto-escalation ladder |
| `/features/okrs` | `features/okrs/page.tsx` | work / sky | "OKRs that cascade and roll up." | related, FAQ | polished | "The goal system you wish 15Five had been" |
| `/features/kpis` | `features/kpis/page.tsx` | work / sky | "The KPI engine. Auto-scored, auto-rolled-up." | steps, related, quote, FAQ | polished | Composite weight claims (30%) must match product settings |
| `/features/kras` | `features/kras/page.tsx` | work / sky | "KRAs that everyone actually agrees on." | related, FAQ | polished | |
| `/features/sops` | `features/sops/page.tsx` | work / sky | "SOPs your auditor actually likes." | steps, related, quote, FAQ | polished | `features/sops/visuals.tsx` (563 lines, `--b-*` tokens) is never imported: dead |
| `/features/reviews` | `features/reviews/page.tsx` | talent / violet | "360° reviews with data, not vibes." | steps, related, quote, FAQ | polished | Listed under both People and Talent on `/features` |
| `/features/people` | `features/people/page.tsx` | people / violet | "One profile for every person." | related, FAQ | polished | Mentions "BambooHR upsell page" |
| `/features/access` | `features/access/page.tsx` | people / violet | "Access controls your CISO will sign off on." | related (2), FAQ | polished | SAML/SCIM/WebAuthn/data-residency claims |
| `/features/kudos` | `features/kudos/page.tsx` | culture / pink | "Recognition that actually counts." | related, quote, FAQ | polished | "Cancel Bonusly today" |
| `/features/ai-engine` | `features/ai-engine/page.tsx` | home / indigo | "AI is the runtime." | steps, related, FAQ | polished | FAQ names "Claude 4.7" as the model (`:36`); `features/ai-engine/visuals.tsx` (374 lines) never imported: dead |
| `/features/analytics` | `features/analytics/page.tsx` | home / indigo | "Dashboards that know your role." | related, FAQ | polished | Product removed Dashboards (memory 2026-08-28); page sells SQL access, warehouse sync |
| `/features/integrations` | `features/integrations/page.tsx` | money / emerald | "Connects to everything you run." | related, FAQ, bottomSlot directory of 22 names (`:59-76`) | polished | Directory is plain text cards, no logos, no links; counts differ from home (26) |

Reachability for all 12: `/features` sub-feature cards; sibling "Plays well with" cards; `/help-center` does not link them; not in sitemap.

### 2.4 `/industries`
- File: `industries/page.tsx`. Purpose: 7 industry cards + "Templates first" grid.
- Reachable: Topbar > Solutions > "All industries"; Footer > Solutions > Industries; Mobile > Solutions.
- Controls: "Start with templates" → `/signup`; "Talk to an expert" → `/demo`; 7 cards → `/industries/{slug}`.
- State: polished. Issues: `/signup` 404; card link text "See how →" plus an `ArrowRight` icon = double arrow (`:89`); gradient icon tiles; Services card targets agencies (see 2.5).

### 2.5 Industry sub-pages (7) — `IndustrySubPage` in `sub-page.tsx:222-326`
Structure: hero (eyebrow "Industries · X", CTAs "Start with templates" → `/signup`, "Talk to a specialist" → `/demo`) → "Sound familiar?" numbered pains → "Sector-specific capabilities" 6 cards → "Templates ready for day one" KPI chips → optional Quote → optional FAQ → CTABand.

| Route | File | Hue | Claims worth flagging |
|---|---|---|---|
| `/industries/technology` | `industries/technology/page.tsx` | violet | Linear+Jira two-way sync, Carta export, "SOC 2 by default" |
| `/industries/healthcare` | `industries/healthcare/page.tsx` | sky | HIPAA BAA, HL7/FHIR with Epic/Cerner (`:42`) |
| `/industries/manufacturing` | `industries/manufacturing/page.tsx` | emerald | native iOS/Android + offline (`:35-37`), SAP/Oracle/NetSuite/Tally |
| `/industries/logistics` | `industries/logistics/page.tsx` | amber | Locus/Shipsy/FarEye, native offline app |
| `/industries/services` | `industries/services/page.tsx` | pink | Targets "Agencies, consulting firms" (`:18`) against the end-clients-only target-market rule (memory 2026-05-30); timesheets, client portals, white-label |
| `/industries/sales` | `industries/sales/page.tsx` | fuchsia | Commission calc, spiffs, HubSpot/Salesforce sync |
| `/industries/real-estate` | `industries/real-estate/page.tsx` | rose | Zillow/Bayut/PropertyGuru, native offline |

Shared issues: `/signup` 404; no back/breadcrumb (eyebrow text only); no visuals; none in sitemap; every page promises native mobile apps and deep third-party integrations that the demand-driven integrations strategy (memory 2026-05-16) has not built.

### 2.6 `/pricing`
- File: `pricing/page.tsx`. Purpose: 3 tiers, comparison table, add-ons, pricing FAQ, CTA.
- Reachable: Topbar > Pricing; Footer > Product > Pricing; Mobile > Pricing; `pricing-preview.tsx:138-144` (unused).
- Controls: Starter "Start free" → `/signup`; Growth "Start 14-day trial" → `/signup?plan=growth`; Scale "Talk to sales" → `/demo`; comparison table (static, `:230-271`); 4 add-on cards; 6 FAQ `<details>`; CTABand "Get started" → `/signup`.
- State: polished.
- Issues: both self-serve CTAs 404; `?plan=growth` is not read by `(auth)/register/page.tsx` (only `token` at `:23`); no monthly/annual toggle although FAQ says "annual saves 18%" (`:304`); no currency switch though FAQ promises INR via Razorpay (`:306`) and the JSON-LD prices in INR; "All plans include ... 99.9% uptime" (`:216`) vs Scale "99.95%" (`:85`); Growth is "Most chosen" with a black border while home's unused preview uses red; three hue icons (indigo/fuchsia/emerald) on tiers; no per-seat calculator; no "what happens after 5 people" explanation of Starter→Growth; Scale "From $29,999/year" is a price on a "Custom" tier.

### 2.7 `/customers`
- File: `customers/page.tsx`. Reachable: Topbar > Customers; Footer > Solutions > Customers; Mobile > Customers.
- Controls: "Join them, start free" → `/signup`; "Talk to a customer" → `/demo` (label promises a customer reference, lands on demo form); LogoCloud of 8 invented names; 4 `StatCard`s; 4 case-study cards (no links); Quote; CTABand.
- State: polished. Issues: fabricated logos/quotes/metrics; case studies are not clickable while home links to `/customers/{slug}` pages that do not exist; gradient-text metrics (`:104`) and blur blobs contradict primitives rules; "8 countries" vs home ticker.

### 2.8 `/compare`
- File: `compare/page.tsx`. Reachable: Topbar > Resources > Compare; Footer > Solutions > Compare.
- Controls: 12-row × 6-competitor matrix (static); 5 "honest takes" cards; CTABand "Talk to sales" → `/demo`, "Try it free" → `/signup`.
- State: polished. Issues: compares against Workday/BambooHR/Rippling/Lattice/ClickUp but not Monday (the stated design reference) or Notion/Asana; workwrk column highlighted violet (`:102,168`); "US payroll: 2027" and "payroll module (Q1 2027)" (`:36,71`) are roadmap commitments on a marketing page; `/signup` 404.

### 2.9 `/demo`
- File: `demo/page.tsx`. Purpose: "Book a Demo" with sticky form card.
- Reachable: Topbar "Get a demo"; Mobile "Get a demo"; every hero secondary CTA; every `CTABand` default secondary ("Talk to sales"); home "Watch the demo" / "Watch a 2-min demo".
- Controls: form fields Full name*, Work email*, Company*, Team size (select 5), Industry (select 8), notes textarea, submit "Request demo" (`:124-142`); 4 facet cards; checklist; Quote; CTABand "Start free instead" → `/signup`, "Talk to sales" → `/contact`.
- State: **stub** (looks finished, does nothing). `action="#" method="post"` (`:124`); no handler, no API, no thank-you, no error, no validation beyond `required`; selects have no `required`; no calendar embed.
- Issues: the label "Watch the demo" on home implies video; header promises "We respond within 4 business hours" (`:122`) with no delivery mechanism; fuchsia accent.

### 2.10 `/contact`
- File: `contact/page.tsx`. Reachable: Footer > Company > Contact; FAQ "Chat with the team"; `/demo` CTABand; `/about` CTAs.
- Controls: "Book a demo instead" → `/demo`; `hello@workwrk.com` outline button; 5 channel cards each `mailto:` (sales@, support@, press@, partners@, security@); 3 office cards; CTABand mailto + `/faq`.
- State: polished. Issues: no form, no chat, no phone; every path is `mailto:` (site-wide 25 `mailto:` links to 11 distinct mailboxes: hello, sales, support, press, partners, security, developers, privacy, dpo, legal, hi); office addresses are unverified; two `<h1>` on the page ("Three cities" uses `H1` with `!text-4xl`, `:105`); gradient icon tiles.

### 2.11 `/about`
- File: `about/page.tsx`. Reachable: Footer > Company > About.
- Controls: "Join the team" → `/contact` (no careers page), "Get in touch" → `/contact`; 4 value cards; timeline 2023-2026; 4 stats ("500+ customers", "35 operators", "$12M Series A", "3 yr"); Quote; CTABand → `/contact`.
- State: polished. Issues: fabricated company facts; timeline says "v4 marketing relaunch" in 2026 (self-referential); no team, no photos, no press kit.

### 2.12 `/blog`
- File: `blog/page.tsx`. Reachable: Topbar > Resources > Blog; Footer > Resources > Blog; Mobile > Blog; `/help-center` card.
- Controls: 6 category filter buttons with no `onClick` (`:55-65`, cosmetic; "All" permanently active); featured card → `/blog/why-we-built-7-hubs`; 7 post cards; CTABand "Subscribe" → `/signup?source=blog` (not a newsletter), "All posts" → `/blog` (self-link).
- State: **broken**. All 8 post links 404 (slug mismatch with `src/data/blog-posts.ts`); the 6 real posts are orphaned (URL-only via sitemap).
- Issues: gradient-rim featured card (`:74`); no pagination, no RSS, no author pages, no search.

### 2.13 `/blog/[slug]`
- File: `blog/[slug]/page.tsx`. Data: `src/data/blog-posts.ts` (6 posts). `generateStaticParams` (`:16-18`), `generateMetadata` (`:20-48`), `notFound()` on miss (`:96`).
- Reachable: URL-only in practice (sitemap), because the index links to non-existent slugs.
- Back: "← All posts" link → `/blog` (`:107-112`), the only back affordance in the subsystem. Sidebar: none (no TOC).
- Controls: tag chips (non-links); "Keep reading" 3 related cards; CTABand.
- State: rough. Issues: hand-rolled markdown→HTML with `dangerouslySetInnerHTML` (`:67-87`, no links/images/code support); no share buttons, no author bio, no reading progress; category→hue map.

### 2.14 `/changelog`
- File: `changelog/page.tsx`. Reachable: Topbar > Resources > Changelog; Footer > Product > Changelog; home hero badge; `/help-center` card.
- Controls: "See what's next" → `/roadmap` (`:110`), "Try it free" → `/signup`; timeline of 6 hand-written entries (`:32-94`, last dated 2026-05-18); CTABand "Subscribe" → `/signup`, "See roadmap" → `/roadmap` (`:158`).
- State: rough. Issues: `/roadmap` removed in commit `b7c9d055`, so two dead links; entries are static copy (stale by 4 months against a "we ship every Tuesday" promise); entries describe the marketing site itself ("Marketing primitives library shared across all 22+ marketing pages", "multi-hue rainbow bento mark" that the current logo is not, `:38-41`); no filter by type; no RSS; `/signup` 404.

### 2.15 `/developers`
- File: `developers/page.tsx`. Reachable: Topbar > Resources > Developers; Footer > Resources > Developers; `/partners` button; `/help-center` card.
- Controls: "Read the docs" → `#docs` (same-page anchor, `:84`); "GitHub" → `https://github.com/workwrk`; 6 capability cards; 3 code snippets; CTABand "Get an API key" → `/signup?source=dev`, "Talk to engineering" → mailto.
- State: stub-ish (claims REST+GraphQL, SDKs in TS/Python/Go, Stoplight docs, MIT SDKs on GitHub, `@workwrk/sdk`). No link to the real docs site (documentation.ai "Workwrk" project per memory). `/signup` 404.

### 2.16 `/faq`
- File: `faq/page.tsx`. Reachable: Topbar > Resources > FAQ; Footer > Resources > FAQ; `/contact` and `/help-center` CTABands.
- Controls: 6 jump chips (anchors work, `:102-115`); 6 grouped `<details>` accordions (19 questions); CTABand mailto + `/demo`.
- State: polished. Issues: answer text mentions "Roadmap on /roadmap" (`:77`, dead); "Claude 4.7" (`:50`); offices; migration importers for 8 tools; alternate-row tint pattern differs from the `FAQ` primitive used on other pages (two FAQ visual patterns plus the home `LandingFAQ` = three FAQ designs).

### 2.17 `/help-center`
- File: `help-center/page.tsx`. Reachable: Topbar > Resources > Help Center; Footer > Resources > Help Center; Mobile > "Resources".
- Controls: search `<input type="search">` with no handler (`:74-79`); 6 "Top guides" cards all `href="#"` (`:99`); 7 hub cards → `#home` etc. anchors with no targets (`:128`); 3 cross-link cards (blog/changelog/developers, real); CTABand "Chat with us" → `mailto:support@`.
- State: **stub**. Claims "200+ guides", "~25 guides" per hub, "chat 09:00-20:00 IST/GMT", none exist. Should link to the documentation.ai site.

### 2.18 `/partners`
- File: `partners/page.tsx`. Reachable: Footer > Solutions > Partners (only).
- Controls: "Become a partner" → mailto; "For developers" → `/developers`; 3 program cards (20%/30% rev-share claims); 4 benefit cards ("Partner portal"); 8 invented partner names; CTABand "Apply to partner program" → mailto ("Fill out a short form" copy, no form).
- State: rough. Issues: agency/reseller programme conflicts with the end-client-only market rule; economics are public commitments; gradient rims (`:81-82`).

### 2.19 `/security`
- File: `security/page.tsx`. Reachable: Topbar > Resources > Security; Footer > Resources > Security; home EnterpriseControl "trust portal" link; `/features/access` copy.
- Controls: "Request SOC 2 report" → mailto; "View trust portal" → `https://trust.workwrk.com` (`:64,152`, no such host); 6 cert tiles; 6 pillars; disclosure block with `/security.asc` (`:108`, missing from `public/`); bounty table; FAQ mentions `/security/subprocessors` (`:140`, no route); CTABand.
- State: polished visually; **content unverifiable**. Privacy policy links to `/security#subprocessors` (`privacy/page.tsx:67`) and no element has that id.

### 2.20 `/privacy`, `/terms`, `/cookies`
- Files: `privacy/page.tsx`, `terms/page.tsx`, `cookies/page.tsx`, shell `components/marketing/legal.tsx`.
- Reachable: Footer > Company (Privacy, Terms) and bottom strip (Privacy, Terms, Cookies); demo form footnote → `/privacy`.
- Sidebar: sticky "On this page" numbered TOC (`legal.tsx:33-48`) on `lg+`.
- Controls: TOC anchors only; each ends with the default `CTABand` ("Stop juggling tools" + "Get started" → `/signup`), an aggressive sales band at the bottom of legal documents.
- State: polished. Issues: "Last updated May 18, 2026" on all three; Privacy sub-processor list differs from Security FAQ list (Postmark vs Datadog/Sentry sets); Terms cites "Settings → Billing" (route exists: `(dashboard)/settings/billing`); Cookies lists cookie names that do not match the real `wwrk_consent` / `next-auth.session-token` and claims Google Analytics which is not installed; each legal page uses a different hue (violet/sky/amber).

### 2.21 `/do-not-sell`
- File: `do-not-sell/page.tsx` (`"use client"`, no `metadata` export → inherits root title).
- Reachable: Footer bottom strip "Do not sell my info".
- Controls: opt-out form (name*, email*, California-resident select, notes) → `onSubmit` sets local `submitted` state only (`:81`); success card promises a confirmation email within 15 business days.
- State: **stub** with a fake success state (CCPA exposure: requests are silently dropped). "Verified by Cure53" badge (`:60`). Default CTABand at the bottom.

---

## 3. Components inventory (what is live, what is dead)

Live on home only: `landing-v4.tsx`, `hero-board-mock.tsx`, `scroll-showcase.tsx`, `team-workspaces.tsx`, `product-mosaic.tsx`, `ai-agents.tsx`, `customer-outcomes.tsx`, `how-it-works.tsx`, `enterprise-control.tsx`, `integrations-grid.tsx`, `landing-faq.tsx`, `closing-cta.tsx` (all `"use client"`, framer-motion).
Live everywhere: `marketing-topbar.tsx`, `marketing-footer.tsx`, `components/marketing/primitives.tsx`, `sub-page.tsx`, `legal.tsx`, `components/brand/logo.tsx`.
Dead (no importers found by grep across `src`):
- `components/landing/landing-page.tsx` + `scene/scene.tsx`, `scene/big-number.tsx`, `scene/typed-query.tsx`, 14 files in `scene/scenes/` (a previous "bento" landing; `scene-13-pricing.tsx` uses `components/pricing/pricing-plans.tsx` with a per-user/flat toggle and currency conversion, a pricing model the live site does not show).
- `components/landing/pricing-preview.tsx` (home pricing section, never mounted).
- `components/landing/faq-client.tsx` (bento FAQ; `--b-*` tokens).
- `components/marketing/motion.tsx` (FadeIn/Stagger/CountUp helpers; a broken `CountUp` that never counts, `:158-218`).
- `components/marketing/shared.tsx` (in-app Marketing-module campaign/content/event modals; misfiled under the marketing-site folder and unused).
- `features/ai-engine/visuals.tsx`, `features/sops/visuals.tsx` (styled-jsx bento mocks; `--b-*` tokens undefined in this route group).
Legacy dependencies still present: `components/bento/reveal.tsx`, `components/pricing/pricing-plans.tsx`.

---

## 4. Visual style, palette, type (as shipped)

- **Canvas**: white; section rhythm via `Section` variants default/tint(`slate-50`)/dark(`slate-950`)/mesh(=white) (`primitives.tsx:110-140`); home uses `--m-surface #F6F7FB` instead of `slate-50` (`globals.css:134`), so "tint" sections differ by a few RGB points between home and inner pages.
- **Type**: Outfit via `font-sans`. `H1` clamp 2.4-4.5rem, `-0.035em`, `line-height 1.02` (`primitives.tsx:171-191`); home hero clamp 2.7-5rem extrabold `-0.04em` `line-height 0.98` (`landing-v4.tsx:77-84`); home section H2 clamp 2-3.4rem vs primitives H2 1.9-3rem. Eyebrow 12px bold uppercase `0.18em` tracking (primitives) vs `0.22em` (home). Body 15-16px; mock text down to 7.5px.
- **Palette (declared)**: primitives `HUES` 10 Tailwind hues, default `violet`; home `--brand-red #FF3D57` (primary CTA), `--brand-blue #0073EA`, `--brand-yellow #FFCB00`, status set `#00C875/#FDAB3D/#E2445C/#579BFC/#A25DDC` (`globals.css:115-131`); logo dots YBRG (`logo.tsx:15-18`). Product `--os-brand #0073EA` (`(dashboard)/os.css:40`) is not referenced by any marketing file (0 occurrences of `--os-` in `globals.css`).
- **CTAs**: black pill (`primitives.tsx:308`, topbar), red pill (home), hue-coloured `secondary` pills on every sub-page hero (`sub-page.tsx:98,243`), white-on-black in `CTABand`. Four primary-button treatments.
- **Cards**: 1px `slate-200` border, `rounded-2xl`, hover border only (primitives); home adds layered shadows (`product-mosaic.tsx:29-32`), gradient icon tiles (`features/page.tsx:160`, `contact/page.tsx:85`, `industries/page.tsx:82`), gradient rims (`blog/page.tsx:74`, `partners/page.tsx:81`), gradient text (`customers/page.tsx:104`), all against the primitives header comment (`primitives.tsx:4-11`).
- **Motion**: framer-motion `whileInView` fades on every home section; infinite loops (5 marquees, 4 blobs, radar pulses, sparkline draws, typing effect); no reduced-motion guard.
- **Iconography**: lucide throughout; hub icons differ between files (`scroll-showcase.tsx:27-36` vs `features/page.tsx:93-101` vs `help-center/page.tsx:48-56` use the same set, but `hero-board-mock.tsx` tabs and `how-it-works.tsx:316-324` hub lists differ in naming/order).

---

## 5. Funnel map (CTAs, buy/trial path, pricing)

- Primary: `/signup` (24 links) → **404**. Intended target is `(auth)/register/page.tsx` ("Start your free trial" / "Create account", `:93-94,216`), which ignores `?plan=`, `?source=` and does not use `appHref`.
- Secondary: `/demo` → form that does not submit.
- Tertiary: `mailto:` (25 links).
- Login: `appHref("/login")` works.
- Pricing exposure: only `/pricing` (home has none). Offer: Starter free ≤5, Growth $8/user/mo (14-day trial, no card), Scale custom from $29,999/yr; add-ons $3,500 / $7,500 / $50k / $2,500-mo. Copy conflicts: "free forever" vs "14-day free trial" (home closing CTA), USD on page vs INR JSON-LD, 99.9 vs 99.95 uptime, "40% of paid customers spent 6+ months on free".
- Trust layer: fabricated logos/quotes/badges/counters (see §0.6).
- Post-click: no `/signup` success, no onboarding hand-off copy, no "what happens next" on demo, no thank-you pages, no email capture anywhere (the "Subscribe" CTAs go to signup).
- Missing for a high-converting buy-now site: working signup, plan-aware signup, currency-aware pricing with monthly/annual toggle, self-serve checkout (Stripe/Razorpay exist as sub-processor claims only), product video/interactive demo, real customer proof, security/trust page with real documents, live chat or a real contact form, exit-intent or sticky CTA on long pages, comparison vs Monday/ClickUp/Notion (the actual competitive set), and a modular product story (choose modules → price → start).

---

## 6. What the site says about the product (and where it diverges)

Says: 7 hubs (Home, People, Work, Money, Talent, Culture, Growth); AI as runtime (Cmd-K, inbox triage, signals, reviewer copilot, 8 named agents, agent builder); 26 native integrations + REST/GraphQL + SDKs; SOC 2/ISO/HIPAA/PCI; native mobile with offline; data residency US/EU/India; industries with templates; "replace 15+ tools"; "built for India/UAE/SEA".
Product reality (from memory + `src/lib/modules.ts`, `proxy.ts` APP_PREFIXES): PPMS (People + Project management), rail apps (Work, Boards/Spaces, Tables, Talk/TLK, Canvas, Docs, SOPs, KRA/KPI, OKRs, Reviews, Kudos, Goals, Calendar, Forms, Timesheets, Automation, Agents/Autopilot/Sidekick), modular premium modules (Talk, Tables) toggled in Settings → Modules, integrations demand-driven, no CRM/Finance/Marketing on the rail. Nothing on the marketing site names Talk, Tables, Canvas, Boards, Docs, Goals, Forms, Timesheets, or the module marketplace/installation model.

---

## 7. Broken / confusing (ranked)

| # | Severity | Where | What |
|---|---|---|---|
| 1 | high | all CTAs (`marketing-topbar.tsx:86`, `landing-v4.tsx:105`, `pricing/page.tsx:51,70`, `primitives.tsx:543`, `sub-page.tsx:98,243`, +18) | `/signup` route does not exist; no redirect; 404 on every "Sign up / Get started / Start free / Subscribe / Get an API key" click |
| 2 | high | `blog/page.tsx:23-32` vs `src/data/blog-posts.ts` | Index links 8 non-existent slugs; all blog cards 404; 6 real posts orphaned |
| 3 | high | `demo/page.tsx:124` | Demo form `action="#"`, no submit handler, no API, no success/error state |
| 4 | high | home + `/customers` + `/security` + `/about` + `/enterprise-control.tsx:63-70` + `/do-not-sell:60` | Fabricated customers, quotes, counters that self-increment, compliance certifications, bounty programme, funding, offices, "Verified by Cure53" |
| 5 | high | `primitives.tsx` vs `landing-v4.tsx` vs `--b-*` files vs `(dashboard)/os.css` | Three marketing design systems; none uses the product's `--os-*` tokens or the YBRG blue-primary rule; violet default accent; four primary-button colours |
| 6 | high | `primitives.tsx:75-83`, `features/page.tsx`, `scroll-showcase.tsx`, home AI section | Sells Money/Growth/Talent hubs, 8 AI agents, native apps, 26 integrations that the PPMS product does not ship; no Talk/Tables/Canvas/modular story |
| 7 | high | `scroll-showcase.tsx:140-200` | 720vh scroll-pinned section with `overflow-hidden`; no mobile fallback (comment at `:13-15` claims one); mock clipped on phones |
| 8 | high | `product-mosaic.tsx` | Tile content is monday.com-derived filler ("TaskFlow", "Responsible Adult", "Waisman Gallery", "Wifi is super slow today"); 7.5-10px text |
| 9 | medium | `changelog/page.tsx:110,158`, `faq/page.tsx:77` | Links/mentions `/roadmap`, removed in `b7c9d055` |
| 10 | medium | `customer-outcomes.tsx:54,70,86` | "Read the X story" → `/customers/{slug}` routes that do not exist |
| 11 | medium | `help-center/page.tsx:74-79,99,128` | Search input inert; 6 guides `href="#"`; 7 hub cards anchor to missing ids; claims 200+ guides |
| 12 | medium | `do-not-sell/page.tsx:81` | CCPA opt-out form fakes success; requests dropped; no `metadata` export |
| 13 | medium | `blog/page.tsx:55-65` | Category filter buttons have no handler |
| 14 | medium | `security/page.tsx:64,108,140,152`, `privacy/page.tsx:67` | `trust.workwrk.com`, `/security.asc`, `/security/subprocessors`, `#subprocessors` anchor: all missing |
| 15 | medium | `(marketing)/page.tsx:81-119` vs `pricing/page.tsx:35-89` | JSON-LD: `/search` action route missing; INR per-month tier prices contradict USD per-seat pricing page |
| 16 | medium | home `landing-v4.tsx:109-117`, `closing-cta.tsx:112-113,149` | "Watch the demo" / "Watch a 2-min demo" → booking form; "14-day free trial" and "free forever" in one sentence; no pricing section on home |
| 17 | medium | `marketing-topbar.tsx:109-155` | Mega menus hover-only; no click/keyboard/`aria-expanded`; unusable on touch at `lg+` |
| 18 | medium | `marketing-topbar.tsx:74,86` + `proxy.ts:41-55,165` | `appHref` used for login only; under hard host split sign-up stays on marketing host and 404s |
| 19 | medium | `sitemap.ts:10-23` | 22 marketing routes missing from sitemap (features/*, industries/*, compare, customers, demo, developers, security, contact, changelog, partners) |
| 20 | medium | `pricing/page.tsx:70` → `(auth)/register/page.tsx:23` | `?plan=growth` / `?source=` never read; no monthly/annual toggle; no currency; 99.9 vs 99.95 uptime copy |
| 21 | medium | all `components/landing/*` | Zero `prefers-reduced-motion` handling; 5 infinite marquees, 4 drifting blobs, 4 interval timers; sections invisible pre-hydration |
| 22 | medium | `industries/services/page.tsx:18`, `partners/page.tsx` | Sells to agencies/consultancies and recruits resellers, against the end-clients-only market rule |
| 23 | medium | `changelog/page.tsx:32-94` | Static entries last dated 2026-05-18 under "every Tuesday we ship"; entries describe the marketing site itself |
| 24 | medium | `cookies/page.tsx:18-25` vs `api/consent/route.ts:6`, `proxy.ts:80` | Cookie names and Google Analytics claim do not match the real consent cookie and the absence of GA |
| 25 | low | `src/app/layout.tsx:57` + every page `title` | "X — WorkwrK · WorkwrK" double branding |
| 26 | low | `contact/page.tsx:53,105` | Two `<h1>` on one page |
| 27 | low | `team-workspaces.tsx:753-780`, `scroll-showcase.tsx:381-390,727-733`, `hero-board-mock.tsx` | Dead `<button>`s inside mocks are keyboard tab stops |
| 28 | low | `integrations-grid.tsx:194`, `how-it-works.tsx:418-421` | Logos/avatars hot-linked from simpleicons.org and dicebear.com |
| 29 | low | `industries/page.tsx:89` | "See how →" plus arrow icon (double arrow) |
| 30 | low | `about/page.tsx:58` | "Join the team" → `/contact`, no careers page |
| 31 | low | legal pages | Default sales `CTABand` ("Stop juggling tools") appended to Privacy/Terms/Cookies/Do-not-sell |
| 32 | low | dead files (§3) | ~20 orphaned components including a second full landing page and an alternate pricing model, confusing future work |
| 33 | low | `landing-v4.tsx:1-8` | Header comment says only Hero + Trust strip are live; file renders 12 sections (comment drift; also `marketing-footer.tsx:2` "rainbow rim") |

---

## 8. Cross-cutting conventions

- **Back navigation**: none. No `BackButton`, `router.back`, or `fallbackHref` in the subsystem. Only `blog/[slug]/page.tsx:107-112` renders "← All posts". Feature/industry sub-pages offer "Part of the X hub" (feature) or nothing (industry) as the way up. Root 404 has a `GoBackButton`. Convention to set: breadcrumb (Hub › Feature) in every sub-page hero.
- **Loader**: none. No `loading.tsx`; pages are static server components except home and `/do-not-sell` (client). Home's per-section `initial={{opacity:0}}` acts as an accidental skeleton. The product's mission/values loader is not used on marketing.
- **Empty / error states**: none needed for static pages; the two forms have no error state; demo has no success state; do-not-sell fakes success; blog `[slug]` uses `notFound()`.
- **Style consistency**: drift, not a single system. Inner pages = `primitives.tsx` (ClickUp restraint, slate, black pills, violet default). Home = monday-style `--m-*` + `--brand-red` CTAs + framer-motion. Dead files = bento dark-lime. Product `--os-*` tokens unused. Brand YBRG "blue primary, no purple" not followed. Gradients reappear on 8 pages despite the primitives contract. Three FAQ designs (`primitives.FAQ`, `faq/page.tsx` alternating rows, `landing-faq.tsx`). Hover transforms (`-translate-y`) throughout.
- **Mobile / responsive**: topbar collapses at `lg` to a full-screen drawer (works). Home: ScrollShowcase broken on phones; ProductMosaic marquee tiles fixed 460-520px with 7.5-10px text; TeamWorkspaces body grids `grid-cols-4` with no breakpoints (`team-workspaces.tsx:855,1176`); floating chips hidden `<sm`. Inner pages: tables scroll in `overflow-x-auto` (pricing, compare, cookies); legal TOC unsticks below `lg`; `H1` clamps to 2.4rem minimum, fine. No touch-specific handling of hover-only menus.
- **Motion**: framer-motion in 12 home components; no reduced-motion; infinite loops.
- **Copy voice**: consistent "operator" tone, heavy use of double-dash/em-dash punctuation in copy (project rule forbids "--" and em dashes in writing; the site copy uses `&mdash;` extensively, e.g. `landing-v4.tsx:99-100`, `primitives.tsx:610`).
- **External hot-links**: simpleicons CDN, DiceBear API, unverified twitter/linkedin/github handles, `trust.workwrk.com`.

---

## 9. Access notes

- All routes are public; no auth, no gating, no personalization. `proxy.ts` never gates marketing paths; `robots.ts` allows everything except `/api/`, `/dashboard/`, `/admin/`, `/setup/` (note the product's real routes are top-level like `/today`, `/spaces`, so `/dashboard/` in robots is stale).
- Topbar shows Log in / Sign up regardless of session (no "Open app" state).
- Under `HARD_HOST_SPLIT`, only `/login` is host-aware (`appHref`); `/signup`, `/register`, `/demo` are not.
- Consent: global `ConsentBanner` renders on marketing via root `Providers`; geo-regime aware (`api/consent/route.ts:19-26`).
- Do-not-sell and demo requests are collected client-side only; nothing is stored, so no access/PII handling exists for them.
- Inconsistency: legal pages promise in-product "Settings → Privacy" rights tooling (`privacy/page.tsx:73`); only `settings/billing` was verified to exist.

## 10. Settings notes

- Nothing on the marketing site is configurable from the product or a CMS. All copy, pricing tiers, comparison matrices, testimonials, logos, changelog entries, help-center guides, FAQ, office addresses, and integration lists are hard-coded TSX constants. Blog posts alone live in a data file (`src/data/blog-posts.ts`) that the index ignores.
- Should be configurable but is not: pricing (tiers, currency by region, monthly/annual, module-based pricing for Talk/Tables), announcement badge in hero, changelog (could be generated from git/releases), roadmap (removed; changelog still links it), testimonials/logos (should be real and admin-managed), demo/contact form destination (CRM, email, calendar), help-center source (documentation.ai per memory), consent cookie inventory (should derive from the actual consent config), sitemap (should enumerate all marketing routes automatically), module catalogue surfaced on marketing from `src/lib/modules.ts` and the product catalog, region/locale selector (root layout already resolves locale and currency but marketing ignores both).
- Settings the copy promises inside the product that the redesign must not over-promise: composite weight editor, kudos weight 0-15%, audit-log retention 12 months / 7 years, data-residency pin at workspace creation, MFA enforcement, SCIM, per-customer model pinning.
