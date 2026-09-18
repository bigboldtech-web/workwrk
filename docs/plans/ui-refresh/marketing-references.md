# WorkwrK marketing site: references, conversion structure, motion stack, brand boldness

Research brief for workwrk.com. Date: 2026-09-10. Scope: the public marketing site only (src/app/(marketing)), not the product.

Fixed constraints this brief honours: YBRG palette (yellow, blue, red, green) with blue #0073EA as the single primary and no purple; Monday-clean (whitespace, flat, single accent); logo = four dots between the two "k"s; the founder's target feel is "crazy simple", seamless, adoptable with no training. Product is a ClickUp/Monday/Workday-class work OS: tasks/boards, docs, chat (Talk), tables, goals/OKRs, people-ops/reviews, SOPs. Shell: left icon rail of 8 hubs, secondary sidebar, top bar.

---

## 0. Executive summary (read this if nothing else)

1. The winning 2025-2026 pattern is "the product is the demo": the best B2B sites (Linear, Attio, Cursor, Notion) no longer show screenshots, they show the real product working, often with an agent inside it. Static 3D "showcase" scenes are being out-scored by scroll-driven narratives on Awwwards (by ~1.8 points on a 10-point scale). So: build the story out of WorkwrK's real shell (rail, sidebar, topbar) rendered as React components, and spend the one "crazy" moment on a scroll-pinned "it all connects" scene, not on a decorative 3D hero.
2. For an SMB/mid-market work OS the CTA motion should be trial-first with a demo side door (hybrid). Benchmarks: free-trial median 18% signup-to-paid (top quartile 32%+), demo 32% (48%+), hybrid 28% (42%+). Products that are self-explanatory (collaboration, PM) with sub-24h time-to-first-value favour trial; escalate to demo when a trial user invites teammates.
3. One conversion goal repeated at hero, mid-page, end and as a thin sticky CTA. Single-goal pages convert ~13.5% vs ~10.5% for pages with competing CTAs; sticky CTAs add 5-15% on long pages (up to +17% on mobile in one Smashing Magazine test). Roughly 83% of visits are mobile even though desktop converts better, so the mobile fallback of every animated section is the primary experience, not an afterthought.
4. Recommended stack for Next.js 16.2.6 App Router: (a) DOM/SVG product shell as React components; (b) Motion v12 (already installed as framer-motion ^12.38) for scroll-linked and component animation, using useScroll which runs on the native ScrollTimeline when available; (c) GSAP 3 + ScrollTrigger (free since April 2025, ~30 KB gz) only for the one pinned/scrubbed/snapped story scene; (d) Rive (self-hosted WASM, lazy) for the four-dot "connect" mark and module state machines; (e) React Three Fiber only if a single hero object is wanted, loaded client-only via next/dynamic ssr:false inside a client component, never as the LCP element, with a static WebP fallback on mobile and reduced-motion. Do not use Spline for the hero.
5. Brand boldness is spent on four things: the four-dot connection metaphor (each module carries one YBRG dot, semantic like Google's and Slack's four colours), oversized type with generous whitespace, one directed signature motion moment, and honest real-UI. Blue stays the only fill colour for CTAs and links. YBRG never becomes section backgrounds. No purple (Linear, Loom, Jasper, Reflect all own purple; being the blue one is the differentiator), no mesh gradients (Stripe/Reflect), no dark-by-default (dev-tool signal, wrong for "any business").

---

## 1. Where the site is today (grounding in the repo)

- Route: /Users/bigboldtechnologies/theywrk/src/app/(marketing)/page.tsx renders `<LandingV4 />` from /Users/bigboldtechnologies/theywrk/src/components/landing/landing-v4.tsx, plus JSON-LD (WebSite, SoftwareApplication with INR Starter/Growth/Scale offers, Organization, FAQPage). Metadata pitches "Business Operating System" for India/UAE/SEA.
- Section order today (12 sections): Hero (static board mock, comment says "communicate the product in one glance, not through motion") → TrustStrip → ScrollShowcase → TeamWorkspaces → ProductMosaic → AIAgents → CustomerOutcomes → HowItWorks → EnterpriseControl → IntegrationsGrid → LandingFAQ → ClosingCTA. The landing folder is ~7.4k lines; product-mosaic.tsx (1057 lines), team-workspaces.tsx (1307) and scroll-showcase.tsx (881) are the heavy ones. There is a small landing/scene folder (big-number, typed-query, scenes/) with no WebGL.
- Installed: next 16.2.6, react 19.2.4, framer-motion ^12.38. Not installed: three, @react-three/fiber, @splinetool/*, @rive-app/*, gsap, lenis, lottie. /Users/bigboldtechnologies/theywrk/src/components/marketing/motion.tsx already wraps framer-motion `whileInView` FadeIn helpers.
- Brand tokens: src/components/brand/logo.tsx exports BRAND_BLUE #0073EA; src/app/globals.css has --brand-blue #0073EA, --brand-yellow #FFCB00, and a --brand-red #FF3D57 marked "primary brand, CTAs" (a leftover that conflicts with "blue is the single primary"; the marketing rebuild should treat blue as the only CTA fill). mission-splash.tsx uses YBRG accents 579BFC / 00C875 / FFCB00 / E2445C, and dots-loader.tsx already animates the four bouncing dots, which is a ready-made motion motif.
- Next.js docs in node_modules (01-app/02-guides/lazy-loading.md) confirm: `next/dynamic` with `ssr: false` only works inside Client Components (it errors in Server Components), and "when a Server Component dynamically imports a Client Component, automatic code splitting is currently not supported". Every 3D/canvas island therefore needs its own `"use client"` wrapper file that does the dynamic import.

Implication: the rebuild is mostly a re-sequencing plus one new signature scene, not a from-scratch site. The existing hero decision (static first) is still right for LCP; the founder's "crazy" moment belongs in section 4/5 below.

---

## 2. Reference sites: what the hero does, how the scroll narrative is structured, how they demo real product

### 2.1 The "modular / it all connects" storytellers

| Site | Hero | Scroll narrative | How real product is shown | Take for WorkwrK |
|---|---|---|---|---|
| Linear (linear.app) | "The product development system for teams and agents"; kinetic word-swap ("teams"/"agents"); a live agent picks up a task, comments, opens a PR, all animating autonomously in the hero. | Intake & integrations → Planning & monitoring → AI & automations → Build, review, ship → Changelog → testimonials (OpenAI, Ramp, Opendoor) → "Powers 40,000+ product teams" → "Built for the future. Available today" with Get started / Contact sales. | Real UI with real task data; the "From roadmap to release, all in a single tool" section is a layered isometric stack (Discovery / Planning / Building / Insights) with side labels (Customer feedback, Roadmap, Issue tracking, Analytics, Integrations). | This stack is the closest existing visual to a "modules that connect" story. Their 2025 refresh principles apply directly: "Don't compete for attention you haven't earned" and "Structure should be felt not seen"; they also cut colour back to monochrome plus fewer accents. |
| Attio (attio.com) | "Welcome to agentic revenue", three CTAs (Talk to sales / Start for free / Send me a demo); hero runs a live "Ask Attio" command with real data filtering. | Product demo conversation → tabbed platform overview (Build pipeline / Convert leads / Run motions / Forecast / Retain) → one section per module, each with a real UI mockup → "Universal Context" differentiator → ecosystem logos → SDK/API → "Trusted by 30,000+ customers" → changelog → final CTA. | Every section is a real product surface; hover micro-interactions (slight scale, shadow shift, content reveal) are the signature. Dark hero screenshot transitions to light on scroll. | Monochrome base with subtle per-section pastel accents is the model for "one accent, YBRG as garnish". Tabbed platform overview is the right shape for a 7-module tour. |
| Notion (notion.com) | "Where teams and agents think together"; Get Notion free + Request a demo. | Three pillars (Capture knowledge / Find answers / Automate busywork) → use-case tiles → "Trusted by 98% of the Forbes Cloud 100" logo wall → testimonials (Cursor, Faire, Ramp). | Animated "visual stacks" showing workflow combinations; desktop and mobile demos; a video. | Three-pillar framing keeps a broad product readable. Free + demo dual CTA is the hybrid motion. |
| Clay (clay.com) | "Build systems to grow revenue"; Start free trial + Get a demo; 3D claymation machine (funnel, tubes, balls, robot) on green hills. | Data → Agents → Orchestration → Execution (each with a 3D object) → use cases → tabbed "GTM engineers build on Clay" with real product tables → trusted-by wall with metrics embedded (Intercom +140% pipeline, Rippling 2x demos, Verkada 3x reply) → learning/community → CTA. | Real product screenshots inside the tabbed section; the 3D is decorative but single-hued (one green). | Proof of a 3D illustration style done with one dominant brand colour; and of putting metrics inside the logo wall. Mobbin refs: https://mobbin.com/sites/sections/eb82d563-5dd7-4756-8ff5-276bfc175d77 and https://mobbin.com/sites/sections/7ebe7705-9d75-4c11-b752-d5ff85353c32 |
| Cursor (cursor.com) | "Cursor is your coding agent for building ambitious software"; Download / Get started / Request a demo. | Agents turn ideas into code → runs in parallel → in every tool → automate repetitive work → best model per task → agent fleets → "trusted by over half of the Fortune 500" → testimonials from famous names → "Try Cursor now". | Interactive IDE demo, CLI demo, Slack mockup, automation builder; spring-based layout animations and shared-element transitions. | Each section = one real surface + one sentence. Named-person testimonials outperform anonymous quotes. |
| monday.com | "People and agents working as one team"; Get Started + Continue with Google; auto-playing hero video. | Department cards (PMO, Marketing, Ops, IT, HR, Sales, Legal) → workflow demo → "Trusted by over 60% of the Fortune 500" → tabbed agent capabilities → 25+ agent grid → use-case sliders → context & control → security pillars → orchestration diagram → results carousel (25% timeline reduction, 105K hours saved) → GDPR/SOC2/ISO/HIPAA + Gartner + Forrester → "Built for people and agents". | Department dashboards; animated workflow diagram. | Department cards are the right "for every team" pattern; the G2 badge wall plus "Try monday.com for your team" (https://mobbin.com/sites/sections/3e96564f-bc2b-4246-9e73-246e227b4a35) is a proven proof block. 13 sections is too many; borrow structure, not length. |
| ClickUp | "Software to replace all software"; "Get started. It's FREE". | Rotating module carousel ("Activate →") → problem statement "60% of work is lost in context" with video → 100+ feature wall → AI agents → Brain → 6 solution cards with "REPLACES" lists → Forrester ROI (384%) → "Loved by 5+ million teams" + G2 → enterprise security → final CTA with desktop + mobile mockups. | Product previews per module; scrolling metric counters. | Anti-pattern for "crazy simple": the 100-feature wall reads as sprawl. Keep only the problem statement idea and the "REPLACES" line per module. Mobbin whiteboard section: https://mobbin.com/sites/sections/7a119404-083f-4a99-aa26-42c394f04ca0 |

### 2.2 The premium-minimal / craft references

| Site | What to learn |
|---|---|
| Vercel (vercel.com; Rauno Freiberg's breakdown at rauno.me/craft/vercel) | Hero visual layers CSS → SVG → GLSL progressively, "no canvas required initially for fast paint". Sections are mapped by novelty level so a high-novelty animation is always followed by a low-novelty interlude, preventing animation fatigue. Supplementary visuals are React components, not images. Stated rule: "if an animation or interaction didn't perform well, felt pompous, or out of rhythm relative to the page, we didn't build it." Invisible fundamentals first: page speed, legible type, layout stability, focus states. Blueprint grid became the most-copied backdrop of 2024-25 (Stripe, Linear followed). |
| Stripe (stripe.com) | Hero "Financial infrastructure to grow your revenue"; Start now / Contact sales; WebGL mesh gradient built on a tiny custom "minigl" with a scroll observer that disables the effect off-screen. Page: solutions → stats (135+ currencies, 99.999% uptime) → enterprise → startups → platform → developers → news → "Ready to get started?". The gradient is the thing WorkwrK should not copy (flat brand), but the offscreen-pause discipline is worth copying. |
| Raycast (raycast.com) | Product UI is the hero; dark near-black void with cinematic spacing between sections; a single white CTA pill; one 3D cube animation used twice (AI section and final CTA). Good example of spending 3D on one object, repeated. Dark theme is a developer-tool signal, not right for WorkwrK. |
| Framer (framer.com) | "Framer is the AI design agent for every step from idea to launch"; Get started for free + Download; each feature section shows a live preview (layout variations, A/B winner indicators). Real-UI-per-section again. |
| Arc (arc.net) | Uses a customer quote as the headline ("Arc is the Chrome replacement I've been waiting for"); Clean and calm → Spaces → Your perfect setup → Privacy → testimonials → download. Quote-as-headline is a legitimate hero option once WorkwrK has a quotable customer. |
| Lovable (lovable.dev) | Site blocks fetching (403); their own guidance for landing pages: single CTA repeated at hero, mid-page and end; Hook → Detail → Proof → Booking; short sentences; the prompt box is the hero (product-as-hero). |
| Mercury (via 2026 trend round-ups) | The strongest example of "premium minimalism": cream backgrounds, restrained type, a single accent colour that reads as distinctive rather than corporate. |

### 2.3 Awwwards-class scroll and 3D storytelling (what wins, what it costs)

- Utsubo's "Best Three.js websites 2026": scroll became the storytelling engine; Shopify Editions (scroll-sequenced reveals, particle type, depth-layered panels), Cartier Watches & Wonders (six self-contained 3D "rooms" scrolled sequentially), Primland (scroll-controlled terrain flythrough), Oryzo (one hero object with inertial physics). Their guidance: "Sell one object properly. A single product, lit and animated with real material response and an orbiting camera, out-performs a busy scene." And: "Performance is a feature, not an afterthought" (instancing, baked lighting, strict byte budgets).
- Digital Strategy Force on 2026 Awwwards: scroll-driven 3D narratives outscore static 3D showcases by an average 1.8 points on the 10-point scale.
- Hon Tran's "10 award-winning websites of 2026": three non-negotiables are art direction (a specific perspective, not template decoration), directed motion ("the motion has a director, not just a library"), and performance (60 fps on mid-range mobile). Winners used Next.js + GSAP (By-Kin), Three.js lighting + GSAP pacing (Iventions), GSAP timelines (Mat Voyce, Uncommon).
- LogRocket / toimi.pro: the "Linear look" is the most-copied B2B aesthetic; Linear's 2025-26 homepage is the most-copied site of the year "because it executes the product-is-the-demo trend more convincingly than anyone else".

### 2.4 "It connects" section patterns seen on Mobbin (with links)

- Linear layered stack "From roadmap to release, all in a single tool": https://mobbin.com/sites/sections/f8b93019-f62b-4e58-8f0d-e577baa204f3
- Intercom "The old way: disconnected conversations" vs "The new way: The Engagement OS" (two-panel diagram): https://mobbin.com/sites/sections/10a77b79-0e26-4f3e-a34a-d5a1a4ae3588
- Coda "What are Packs?" hub-and-spoke with tool tiles: https://mobbin.com/sites/sections/a160ad8c-9830-4919-81f4-af8d388603d0
- Fibery workspace map: typed entities linked across four panels: https://mobbin.com/sites/sections/a8126226-fe5d-45fd-8309-b3bd9687d4dc
- Zaro "One workspace. Three things. Each one makes the other two better." three-card system: https://mobbin.com/sites/sections/37a1f8f5-17b7-4a51-8618-4353b2642f6b
- Maze isometric 3D path with floating tool tiles and one blue sphere (single-accent 3D done cleanly): https://mobbin.com/sites/sections/efd123f4-8694-4da2-ad1e-7382fef9d90d
- Sprig flow diagram in a flat yellow block (flat, one-hue 2D diagram as a bold moment): https://mobbin.com/sites/sections/8fb268f0-0ec6-452f-b29a-6a64166b0a8d
- Granola "How it works" six-tile grid, Norma three-step cards, Tines step-progress nav: https://mobbin.com/sites/sections/55058dfa-e6bf-460a-9584-02bd4c41e91a , https://mobbin.com/sites/sections/96f4183b-7eb5-437c-90ad-95d1306d320c , https://mobbin.com/sites/sections/f4e74215-cf08-405f-8c5f-1e29f5ec9e29
- Pricing: Linear three-card with Monthly/Annually pill (https://mobbin.com/sites/sections/be148265-d2a2-4e94-82dc-15ecf2b44896), Height (https://mobbin.com/sites/sections/34cdca71-baa5-4c7d-95b3-cbc86f8b54bb), Front "Try for Free" vs "Request a Demo" per tier (https://mobbin.com/sites/sections/7ca07b22-c38a-4005-9b97-436e60a023ce).
- Final CTA: Slack "Welcome to your new digital HQ" Try for free + Talk to sales (https://mobbin.com/sites/sections/7e4557a0-bfa2-4a52-92a1-26c63888208c); Cake "Get started free, no credit card required" with a hand-drawn arrow (https://mobbin.com/sites/sections/e65a6cfc-57c6-4adc-a49d-ab12d80d11b8); ElevenLabs footer with SOC II / GDPR badges (https://mobbin.com/sites/sections/f94e4400-8ac9-4435-bc9d-7f55ac392bc8).
- Proof: Jasper metric cards (1-4 hrs saved, 40%, 93%) (https://mobbin.com/sites/sections/03dd9064-81e2-4501-959f-210f10c6805a); Workable case-study carousel + logo strip (https://mobbin.com/sites/sections/6f5d2c75-b5ac-4975-a0ec-10db391b4754).

Note the pattern across the whole set: the "connection" is always drawn between named surfaces of the real product (Linear's layers are its actual views; Fibery's are its entity types). Abstract nodes and arrows (Intercom old-way panel) are used only to depict the problem, never the solution.

---

## 3. Conversion structure that works for B2B SaaS (and the WorkwrK page blueprint)

### 3.1 Principles with evidence

- Five-second test: a visitor must know what it is, who it is for, and what to do next within 5 seconds. High-converting pages answer four questions above the fold: is this for me, can it do what I need, is it worth it, can I trust you (SaaS Hero 2026 benchmarks; Genesys Growth).
- Outcome-driven headlines score ~14 points higher than feature-driven ones (58 vs 44) and customer-sourced vocabulary beats marketer-written copy; formula "[outcome] without [the usual trade-off]" hits benefit and objection in one line (SaaS Hero value-prop research).
- One conversion goal. Single-CTA pages ~13.5% vs ~10.5% for pages with three or more competing CTAs; but the same CTA repeated at hero, mid-page and footer plus a sticky bar is one goal, not three. A secondary "watch a 2-minute demo" is fine if it serves people not ready for the primary (Foundry CRO, SaaS Hero CTA practices).
- Sticky CTA: +5-15% on long pages in A/B tests; Smashing Magazine measured +17% on mobile with no bounce increase; keep the sticky header 50-60 px desktop, 44-50 px mobile (StickyCTAs, roast.page, Heurilens).
- Trial vs demo (GrowthSpree 2026 framework): sub-$10K ACV → trial-dominant (20-35% trial-to-paid); $10-25K → hybrid; $25-75K → demo-led with a trial option. Self-explanatory products (collaboration, PM), sub-24h time-to-first-value, single decision makers and sub-30-day cycles favour trial. Demos generate ~11x more revenue per qualified lead but trials generate 5-8x more qualified leads per acquisition dollar; hybrids are the fastest-growing motion (35-45% of B2B GTM in 2026 vs 20% in 2022). Escalation trigger: prompt a demo when a trial user invites teammates or configures integrations.
- Social proof placement: near conversion points; security badges (SOC 2, GDPR) answer a hidden objection and belong just before FAQ and in the footer; forms with ≤5 fields convert best (Genesys Growth, Flow Agency, Everything.design).
- Interactive demos (Navattic/Arcade/Storylane, vendor-reported): 3.2x more deals and 7.9x more signups for pages with click-through demos; Zapier reported 70% more booked meetings with Arcade. Treat as directional; the point is that a clickable real surface beats a screenshot.
- Mobile: ~83% of visits, desktop converts ~2x better (4.8-5% vs 2.5-2.9%), so mobile must be designed, not degraded (Genesys Growth, Lovable guide).
- SaaS landing median conversion ~3.8%, top performers high single digits to low double digits (SaaS Hero benchmarks).

### 3.2 Recommended page blueprint (11 blocks, each with its reference)

1. Top bar (sticky, thin). Logo, 4-5 links, "Log in", one blue "Start free" button, ghost "Book a demo". Reference: Linear/Notion nav; sticky CTA evidence above.
2. Hero. Outcome headline in the "[outcome] without [trade-off]" shape (candidate direction: "Run the whole company from one place. No training required."), one-line sub, blue "Start free" + text link "See it work (2 min)", "No credit card" microcopy. Visual: the real WorkwrK shell (rail → sidebar → topbar) rendered as React, static on first paint (LCP = headline or the shell image), then the four dots animate the modules into their rail slots. Reference: Linear (live product in hero), Vercel (progressive layering, no canvas at first paint), Utsubo SEO guide (LCP must be a headline or real image, never an empty canvas).
3. Trust strip. If logos exist, logos; if not, honest metrics (teams, tasks completed, countries) plus G2/Product Hunt when available. Do not fake logos. Reference: Clay wall with embedded metrics, monday G2 wall.
4. Problem, in one screen. "Seven tools. Zero connections." Old-way panel (abstract nodes, grey) vs new-way panel (the shell, blue). Reference: Intercom old-way/new-way; ClickUp "60% of work is lost in context" statement (borrow the shape, cite a real stat or none).
5. THE STORY: "It all connects" (the one signature, scroll-pinned scene). One piece of work travels through the modules: a task is created → it links a doc → the chat thread decides → a table row updates → the SOP step is acknowledged → the goal/KPI moves → the review reflects it. Modules are the real surfaces, each tagged with one YBRG dot; connecting lines are drawn in blue; the four dots resolve into the logo at the end. Scrubbed, pinned, snapped per beat; mobile gets a vertical, non-pinned stepper of the same frames. Reference: Linear layered stack, Shopify Editions scroll beats, Zaro "each one makes the other two better", Vercel novelty mapping (this is the only high-novelty section; sections before and after are calm).
6. Module tour. Seven tabs or sticky-steps (Tasks, Docs, Talk, Tables, Goals, People, SOPs), each a real surface with a one-sentence job and a "Replaces: X, Y" line. Reference: Attio tabbed platform overview, Clay tabbed section, ClickUp "REPLACES" lists.
7. Built for every team. Department cards (Ops, Sales, HR, Finance, Founders, Field teams) that link to /industries or /features. Reference: monday department cards.
8. Proof. Two or three outcome cards with a number, a named person, a company, plus one long quote. Reference: Jasper metric cards, Linear named testimonials, Cursor's named-person quotes.
9. How it works in three steps, with the "no training" promise made concrete: "1. Invite your team, 2. Pick a template, 3. Work; it just connects." Reference: Granola/Norma three-step grids.
10. Pricing preview. Three cards, annual toggle, free/starter emphasised, per-tier CTA ("Start free" on lower tiers, "Talk to sales" on the top tier only). Reference: Linear pricing cards, Front's per-tier trial vs demo.
11. Objections, then the close. FAQ (5-8 questions, mirrored in the existing FAQPage JSON-LD), security badges (SOC 2 / GDPR / data residency once true), migration/import note, "cancel anytime". Then the final CTA block: big headline, blue "Start free", ghost "Book a demo", plus the four dots. Reference: Slack, Cake ("no credit card required"), ElevenLabs footer badges.

Section count goes from 12 to 11 but with far less bulk; TeamWorkspaces, ProductMosaic and AIAgents fold into blocks 5-7. AI belongs inside the story (an agent nudging the SOP step, an AI summary in Talk), not as its own section, unless AI is a top-3 buying reason for the target market.

CTA cadence on the page: hero (primary + secondary), after the story (primary only, inline), after proof (primary), pricing (per tier), final (primary + secondary), sticky bar on scroll past the hero. That is one goal, six placements.

---

## 4. 3D and motion technology on Next.js 16 App Router: feasibility and a recommended stack

### 4.1 Hard constraints from the framework (node_modules/next/dist/docs, v16.2.6)

- `next/dynamic(..., { ssr: false })` is only allowed inside Client Components; it throws in Server Components. Pattern: `page.tsx` (server) → `<HeroScene />` (a `"use client"` file that does `dynamic(() => import("./hero-canvas"), { ssr: false, loading })`).
- "When a Server Component dynamically imports a Client Component, automatic code splitting is currently not supported", so the dynamic import must live in the client wrapper, not in the page.
- Three.js accesses browser APIs at import time; R3F v9 is required for React 19 / Next 15+ (v8 is incompatible). Put models in /public and load with drei's useGLTF.
- Reserve canvas dimensions with explicit width/height/aspect-ratio to avoid CLS; render the headline/CTA as DOM text before any canvas mounts (Utsubo SEO guide: "Ship the page as HTML, hydrate the canvas after").

### 4.2 Option comparison

| Option | Weight | Strengths | Costs / risks | Verdict for WorkwrK |
|---|---|---|---|---|
| CSS scroll-driven animations (animation-timeline: scroll()/view()) | 0 KB | Runs on the compositor thread, no JS; ~84-85% global support (Chrome/Edge 115+, Safari 18+; Firefox 132+ but behind a flag); progressive enhancement via `@supports (animation-timeline: scroll())` and `prefers-reduced-motion: no-preference` (Josh Comeau, MDN). | No pin/snap; Firefox fallback needed. | Use for parallax, reveals, progress bars, dot "arrival" effects. Default choice for anything simple. |
| Motion for React v12 (installed as framer-motion ^12.38) | ~34 KB full, ~4.6 KB with LazyMotion + `m` | useScroll / scroll() drive animations on the native ScrollTimeline when possible (hardware-accelerated, off main thread, JS fallback otherwise); first-class layout animations, AnimatePresence, gestures; React-native API (motion.dev docs; hontran). | useScroll is not a ScrollTrigger replacement for pin/scrub/snap timelines. | Keep as the default library for component and scroll-linked motion; switch the existing FadeIn helpers to LazyMotion to shrink the bundle. |
| GSAP 3 + ScrollTrigger (+ @gsap/react useGSAP) | ~23 KB core + ~7 KB ScrollTrigger (gz) | Pin, scrub, snap, frame-accurate timelines, SplitText/MorphSVG/DrawSVG now free (Webflow made GSAP 100% free on 30 April 2025); useGSAP scopes selectors and auto-reverts on unmount in Strict Mode; the standard engine behind Awwwards winners. | Imperative; two animation libraries on one page need clear element ownership (documented as fine to coexist). | Adopt only for block 5 (the pinned story) and possibly block 2's dot choreography. |
| Lenis smooth scroll | ~3 KB | Momentum scroll; pairs with ScrollTrigger by running on the GSAP ticker; Lenis 1.3.x works with Next 15/16 App Router via `lenis/react`. | Hijacked scroll can hurt INP and accessibility on low-end phones and fights native scroll-driven CSS. | Skip in v1. Revisit only if the story scene feels stuttery with native scroll. |
| Rive (@rive-app/react-canvas or canvas-lite; webgl2 variant) | Small JS; WASM loaded lazily from unpkg by default (self-host with `RuntimeLoader.setWasmUrl` + `<link rel="preload">`, `application/wasm`, immutable cache) | Vector state machines that respond to input; .riv files 3-5x smaller than Lottie JSON for comparable icon-scale work; one runtime for many instances (Rive docs; Unicorn Icons; Pixel Point). | Needs a Rive designer; unpkg dependency unless self-hosted; text feature absent in canvas-lite. | Adopt for the four-dot "connect" mark, module dot state machines, and small interactive explainers. Self-host the WASM. |
| Lottie (dotLottie) | Runtime ~tens of KB; JSON 3-5x larger than .riv | Huge library of assets; LottieFiles added a native state machine in late 2025. | Each instance runs its own rAF loop; 5+ simultaneous instances spike CPU on mobile. | Avoid for anything simultaneous; acceptable for one-off icons if a Rive artist is unavailable. |
| React Three Fiber / Three.js | Three ~155-170 KB gz (does not tree-shake well; ~600 KB minified); R3F + drei extra; models/textures typically push a scene past 3 MB | Full control, brand-exact materials, scroll-scrubbed cameras (drei ScrollControls), instancing; WebGPU via TSL for the future. | Threatens LCP/INP if in the critical path; needs DPR caps, KTX2/Draco compression, offscreen pause, mobile static fallback; every award site cites the "invisible work" as the real cost (Utsubo tips, hontran WebGL examples). | Only for one hero object (e.g., the four dots as physical spheres that "snap" into the wordmark). Load after `load` event, client-only, below the fold or replacing a static image after paint. Not required to hit the brief. |
| Spline (@splinetool/react-spline) | Runtime is heavy (bundlephobia does not display a stable figure; teams report it as the main LCP/main-thread threat) | Designer-friendly visual editor; fastest for a 4-week marketing landing (Dinimiciuil Labs; Svilenković). | Vendor runtime, limited brand control over materials/lighting, scene weight; production teams shipped it only with loader gating, lazy mounting below the fold, IntersectionObserver rAF pausing ("the biggest single performance win"), reduced-motion single frames, and a static composition for no-WebGL users. | Do not use for the hero. Acceptable for one below-the-fold illustration if a designer already works in Spline; wrap with the same gating. |
| Canvas image sequence (Apple-style) | Frames: 100-200 AVIF/WebP images | Most reliable scroll-scrubbed "video"; native scroll drives it; static image on small screens (CSS-Tricks; GSAP helper). | Asset weight; needs preloading. | Good fallback if the story scene must show real screen recordings rather than DOM. |
| Video hero | 1-5 MB | Cheap to produce. | Autoplay/LCP issues; not interactive. | Only for the "See it work (2 min)" modal, not as the hero. |

### 4.3 Recommended stack (in priority order)

Tier A, ship first (no new heavy deps):
- Product surfaces as React components (the real shell), not screenshots. This is also what makes the story mobile-safe and theme-safe.
- Motion v12 with LazyMotion for reveals, tabs, layout animations, and scroll-linked effects via useScroll/useTransform on transform/opacity only.
- CSS scroll-driven animations for parallax and dot arrivals, gated by `@supports` and `prefers-reduced-motion`.
- GSAP + ScrollTrigger + useGSAP for the single pinned story scene (pin, scrub, snap per beat). Mobile: no pin; render the beats as a vertical stepper.

Tier B, the one bold asset:
- Rive for the four-dot connect mark and per-module dot state machines (hover/idle/connected). Self-host rive.wasm under /public with preload and immutable caching; lazy-mount with next/dynamic ssr:false inside a client wrapper.

Tier C, optional:
- One R3F object if the founder wants literal 3D: four spheres in Y/B/R/G with flat, unlit materials (MeshBasicMaterial keeps the flat brand look), loaded after window load, DPR capped at 1.5, paused offscreen, static WebP on mobile/reduced-motion. Budget: ≤ 250 KB gz of JS for the whole island, ≤ 1 MB assets.

Performance budget for the page: LCP < 2.5 s with the LCP element being the headline or a real image; INP < 200 ms (move shader compilation off main thread or avoid shaders); CLS 0 (aspect-ratio reserved); total JS on first load under ~200 KB gz before any 3D island; 3D islands only after `load`. Keep SSR copy, add `<noscript>` text inside any canvas wrapper, keep the existing JSON-LD (update pricing/currency), add FAQ answers that match DOM text.

---

## 5. Staying on-brand (blue, flat, YBRG semantic dots) while feeling premium and "crazy"

### 5.1 Precedents for four-colour brands run with restraint

- Slack (Pentagram, 2019): eleven colours cut to four (blue, green, yellow, red) plus one primary (aubergine) that owns the UI and the CTA; the four colours signal "different colours working together", which is exactly the "people, processes and SOPs connecting" story. Their marketing pages remain white with a single CTA colour.
- Google: four brand colours with a semantic mapping (blue = links/trust, green = success/growth, red = error/energy, yellow = caution/optimism); the mark stays fully saturated while everything else is grey/white. Microsoft's four-square works the same way.
- Linear's 2025 refresh cut colour to "monochrome plus even fewer bold colours"; Attio is monochrome with pastel per-section accents. Restraint is what reads as premium in this category.
- Clay proves a 3D illustration language can stay single-hued (one green) and still feel playful; Maze does the same with one blue sphere on white.

### 5.2 Where boldness is spent (the four bets)

1. The four dots become the system. Yellow / Blue / Red / Green are assigned fixed semantic roles and every module carries one dot: for instance Blue = action (tasks, Talk), Green = done/goals (Goals, Tables results), Yellow = attention/in-progress (SOP steps, reviews due), Red = blocked/urgent. The dots are the only place the four colours appear at full saturation; they animate (the existing dots-loader bounce), connect with blue lines in the story scene, and resolve into the logo. This gives the site a signature without a single gradient.
2. Type and space. Oversized display headlines (one weight, tight leading), 14px+ body, generous section padding, a faint blueprint grid at most (Vercel warns not to overuse it). White page; one light-blue tint (#E6F2FD, already --brand-blue-soft) for the story stage; no dark sections.
3. One directed motion moment. Block 5 is the only high-novelty section; everything around it is quiet (Vercel's novelty mapping). Motion demonstrates the product's behaviour (a task linking a doc), never decoration.
4. Honest real UI. Every visual is the actual shell. That is both the premium signal (Linear, Attio, Cursor) and the "no training required" proof: if the visitor has already read the UI on the marketing site, onboarding is done.

### 5.3 Rules (so the site stays Monday-clean)

- Blue #0073EA is the only fill for buttons and links; hover #0060C2. Retire the marketing use of --brand-red as a CTA colour.
- YBRG only as dots, status pills, underline accents and the story's connectors; never as section backgrounds, never as gradients, never mixed in one headline.
- No purple anywhere (Linear, Loom, Jasper, Reflect, Retool, Slack's aubergine all own purple; the blue-on-white space between Notion's monochrome and monday's rainbow is open).
- No mesh gradients, no glassmorphism, no heavy drop shadows; 1px borders and soft radii; no hover transforms on hovered elements (existing UI convention).
- Illustration only if it is the four dots; no mascots, no 3D claymation worlds.
- Dark mode not needed for marketing; light only.

---

## 6. Risks and open questions

- Proof inventory: are there customer logos, quotable named customers and real metrics today? If not, block 3 must use honest product metrics and block 8 must be built after the first reference customers are secured; do not fabricate.
- Positioning and copy: metadata still says "Business Operating System" with INR pricing and India/UAE/SEA; the founder's current framing is "work OS / PPMS" for any business. Which market and currency lead the page?
- Trial readiness: is self-serve signup live at app.workwrk.com with a sub-24h time-to-value (templates, sample workspace)? The trial-first recommendation assumes yes.
- Asset capability: is there a Rive designer or 3D artist available? Tier B/C depend on it; Tier A does not.
- Founder mandate on UI: the ClickUp-parity rule ("do not invent visible surfaces; ask and request screenshots first") applies to the product, but the story scene will render product surfaces; confirm which real screens (List view, Doc, Talk thread, Table, Goal, Review, SOP) are stable enough to be shown publicly.
- Mobile-first reality: with ~83% mobile traffic, the vertical stepper version of the story scene is the primary experience; design it first, then the pinned desktop version.
- Measurement: define the primary metric (visit → trial signup) and instrument the six CTA placements separately before launch so the story scene's contribution can be A/B tested.

---

## 7. Sources

Reference sites and breakdowns
- Linear design refresh: https://linear.app/now/behind-the-latest-design-refresh
- Linear homepage: https://linear.app/
- LogRocket on Linear design: https://blog.logrocket.com/ux-design/linear-design/
- toimi.pro Top SaaS website designs 2026 (product-is-the-demo): https://toimi.pro/blog/best-saas-website-designs/
- Rauno Freiberg, Vercel craft breakdown: https://rauno.me/craft/vercel
- Setproduct, Vercel blueprint grid guide: https://www.setproduct.com/blog/complete-guide-to-blueprint-grid-design
- Vercel homepage: https://vercel.com/
- Stripe homepage: https://stripe.com/ ; gradient technique: https://kevinhufnagl.com/how-to-stripe-website-gradient-effect/ and https://www.bram.us/2021/10/13/how-to-create-the-stripe-website-gradient-effect/
- Raycast homepage: https://www.raycast.com/ ; DESIGN.md analysis: https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md
- Attio homepage: https://attio.com/ ; DesignRush analysis: https://www.designrush.com/best-designs/websites/attio-website-design ; Strategy Breakdowns: https://strategybreakdowns.com/p/how-attio-does-design
- Clay homepage: https://www.clay.com/
- Notion homepage: https://www.notion.com/
- Cursor homepage: https://cursor.com/
- Framer homepage: https://www.framer.com/
- Arc homepage: https://arc.net/
- monday.com homepage: https://monday.com/
- ClickUp homepage: https://clickup.com/
- Lovable landing-page guidance: https://lovable.dev/guides/landing-page-best-practices-convert
- Utsubo, Best Three.js websites 2026: https://www.utsubo.com/blog/best-threejs-websites-2026
- Digital Strategy Force, immersive experiences at the 2026 Awwwards: https://digitalstrategyforce.com/journal/why-are-immersive-experiences-dominating-the-2026-awwwards/
- Hon Tran, 10 award-winning websites of 2026: https://www.hontran.dev/blog/best-award-winning-websites-2026
- Awwwards SaaS 3D collection: https://www.awwwards.com/inspiration/saas-3d-website-curated-media
- Mobbin section links are inline in section 2.4.

Conversion structure
- Genesys Growth, B2B SaaS landing pages 2026: https://genesysgrowth.com/blog/designing-b2b-saas-landing-pages ; homepages: https://genesysgrowth.com/blog/designing-b2b-saas-homepages
- SaaS Hero conversion benchmarks: https://www.saashero.net/strategy/b2b-saas-conversion-rate-benchmarks/ ; CTA practices: https://www.saashero.net/design/b2b-saas-landing-cta-practices/ ; value-prop frameworks: https://www.saashero.net/content/b2b-saas-value-proposition-frameworks/ ; 2026 trends: https://www.saashero.net/design/landing-page-design-inspiration-2026/
- GrowthSpree, trial vs demo decision framework 2026: https://www.growthspreeofficial.com/blogs/b2b-saas-free-trial-vs-demo-decision-framework-2026-conversion-rates-by-acv-product-type
- ChartMogul SaaS conversion report: https://chartmogul.com/reports/saas-conversion-report/
- Userpilot free-trial conversion benchmarks: https://userpilot.com/blog/saas-average-conversion-rate/
- Foundry CRO CTA benchmarks: https://foundrycro.com/blog/cta-button-conversion-rate-benchmarks-2026/
- StickyCTAs, persistent CTA optimisation: https://www.stickyctas.com/articles/engineering-conversion ; roast.page sticky header: https://roast.page/glossary/sticky-header ; Heurilens CTA placement: https://heurilens.com/blog/trust-conversion/cta-design-placement-copy-color-converts
- Flow Agency landing page practices: https://www.flow-agency.com/blog/b2b-saas-landing-page-best-practices/
- Everything.design B2B CTA: https://www.everything.design/blog/b2b-website-cta
- Arcade interactive demo comparisons: https://www.arcade.software/post/best-interactive-demo-software-2026 ; Navattic: https://www.navattic.com/blog/interactive-demos ; Storylane: https://www.storylane.io/blog/interactive-demo-software

Motion and 3D technology
- Next.js 16.2.6 lazy-loading guide (local): /Users/bigboldtechnologies/theywrk/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md
- Three.js + Next.js integration guide: https://threejsresources.com/frameworks/three-js-nextjs ; R3F bundle discussion: https://github.com/pmndrs/react-three-fiber/discussions/812 ; three.js tree-shaking: https://discourse.threejs.org/t/what-is-the-state-of-tree-shaking/33168
- Utsubo, WebGL site SEO and Core Web Vitals: https://www.utsubo.com/blog/webgl-three-js-site-seo-rankable-guide ; 100 Three.js performance tips: https://www.utsubo.com/blog/threejs-best-practices-100-tips
- Hon Tran, WebGL website examples and code: https://www.hontran.dev/blog/webgl-website-examples
- Dinimiciuil Labs, Spline in Next.js without killing performance: https://dinimiciuillabs.com/blog/spline-nextjs-performance ; Needle vs R3F vs Spline: https://cloud.needle.tools/compare/needle-vs-r3f-vs-spline ; Three.js vs Spline: https://svilenkovic.com/3d/three-js-vs-spline
- Rive WASM preloading and self-hosting: https://rive.app/docs/runtimes/web/preloading-wasm ; Rive React optimisation (Pixel Point): https://pixelpoint.io/blog/rive-react-optimizations/ ; Rive vs Lottie size/perf: https://unicornicons.com/blog/lottie-vs-rive-performance ; LottieFiles view: https://lottiefiles.com/blog/lottie-animations/lottiefiles-or-rive
- GSAP vs Motion verdict and sizes: https://www.hontran.dev/blog/gsap-vs-framer-motion ; bundle comparison: https://www.pkgpulse.com/compare/framer-motion-vs-gsap ; GSAP with React 2026: https://empire-ui.com/blog/gsap-react-guide
- Motion scroll docs (ScrollTimeline): https://motion.dev/docs/react-scroll-animations ; https://motion.dev/docs/react-use-scroll ; https://motion.dev/docs/scroll
- CSS scroll-driven animations: https://www.joshwcomeau.com/animation/scroll-driven-animations/ ; MDN: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations ; 2026 guide: https://cssawwwards.com/blog/css-scroll-driven-animations-guide-2026
- Lenis + GSAP in Next.js 15/16: https://devdreaming.com/blogs/nextjs-smooth-scrolling-with-lenis-gsap
- Apple-style scroll image sequences: https://css-tricks.com/lets-make-one-of-those-fancy-scrolling-animations-used-on-apple-product-pages/ ; GSAP helper: https://codepen.io/GreenSock/pen/VwgevYW

Brand and colour
- Pentagram, Slack identity: https://www.pentagram.com/work/slack ; LogoLounge: https://www.logolounge.com/news/slackrsquos-new-identity ; Coloracci analysis: https://coloracci.ai/blog/slack-brand-colors-analysis
- Google brand colours and meaning: https://colorindicator.com/academy/why-google-logo-is-multicolored ; https://colorcode.tools/brands/google
- monday.com brand palette: https://mobbin.com/colors/brand/monday-com ; Vibe design system: https://vibe.monday.com/
- 2026 premium-minimal trend round-ups: https://www.saasui.design/blog/7-saas-ui-design-trends-2026 ; https://valmax.agency/insights/best-saas-websites-2026/ ; https://mockflow.com/blog/saas-website-design-trends
