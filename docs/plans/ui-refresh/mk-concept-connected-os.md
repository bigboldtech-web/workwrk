# workwrk.com concept: "The Connected OS"

Creative direction proposal, one of three. Date: 2026-09-10. Scope: the public marketing site (src/app/(marketing)), home page first, then Pricing, module pages and a "How it connects" page.

Inputs honoured: marketing-references.md (reference sites, conversion evidence, Next.js 16 motion stack), phase2-inputs.md (brand constraints, 11-block blueprint, open founder questions with defaults), existing-direction.md (PPMS positioning, protected parity screens, honesty rules). Where this concept departs from the synthesized blueprint it says so and why.

The visual token system (exact neutrals, blue ramp, type family) is decided separately. This document designs story, structure, motion and funnel; every place where the token system plugs in is marked "TOKEN HOOK".

---

## 0. The idea in one paragraph

WorkwrK's pitch is that people, processes, work and goals live in one system instead of fourteen. So the site is built around one physical metaphor and never leaves it: the eight modules are **blocks**. In the hero they float apart, exploded, each carrying one YBRG dot and a real product surface on its face. As the visitor scrolls, the blocks **snap** into the WorkwrK shell (rail, sidebar, top bar) and the assembled shell is the live product, clickable, in the hero. Every section after that isolates one **connection** between two blocks (people to process, process to work, work to goals), pulls those two blocks out of the shell, draws the blue wire between them, and shows the real UI on both ends doing the connecting. The page ends where it started: the blocks snap together one last time and become the four-dot logo. The spine is literal: it all connects, and you watch it connect.

Name for the system internally: **the Snap**.

---

## 1. Hero: "the exploded shell"

### 1.1 Headline direction

Shape: outcome without trade-off, in the vocabulary of the real customer quote ("replaced 14 SaaS tools", "managers actually open the app").

Primary candidate:

> **Your people, processes, work and goals. One system, snapped together.**
> Sub: WorkwrK connects roles to SOPs to tasks to goals, so nothing lives in a silo and nobody needs training. Replace the tool sprawl in a quarter.

Alternates (see section 6 for the full five):
- "Run the whole company from one place. Nothing left to stitch together."
- "Fourteen tools. One system. It all connects."

CTAs: solid blue **Start free** (14px+/590 label, white on #0073EA) and a text link **See it connect (90 sec)** that opens a video modal. Microcopy under the primary: "Free plan. No credit card." TOKEN HOOK: button and link colours resolve to accent.solid / accent.text.

### 1.2 The 3D scene

**What it is.** Eight slabs, one per rail hub (Work, Planner, AI, Talk, Teams, Docs, Tables, Settings), plus the two chrome pieces (rail spine and top bar) as thin bars. Each slab is a flat white card with a 1px N200 edge, a real product surface on its face (a marketing-lite render of the actual React component: a List view on Work, a Doc on Docs, a channel on Talk, a sheet on Tables, a goal with progress ring inside Work's Goals section, an org chart on Teams, a week calendar on Planner, a Sidekick answer on AI), a 12/590 label and one full-saturation dot (Blue = action: Work, Talk, Planner. Green = outcomes: Goals inside Work, Tables results. Yellow = attention: Docs/SOPs and Teams reviews. Red = blocked/urgent, appears only inside surfaces as status, never as a block dot).

The slabs are **DOM, not WebGL**. They sit in a `perspective: 2000px` stage with `transform-style: preserve-3d`, rotated to a 3/4 isometric-ish view (rotateX 55deg, rotateZ -35deg is the classic "exploded product diagram" angle). Every slab is a positioned React component whose transform GSAP scrubs on scroll. This is the whole reason the angle works on-brand: it is 3D in space, but flat in material. No lighting, no shading, no shadows beyond a single 1px edge and the popover shadow token when a slab is "lifted".

Beneath the slabs is a **wire layer**: blue #0073EA lines (1.5px, rounded caps) that connect the four dots across slabs, drawn with SVG `stroke-dashoffset` (DrawSVG, free in GSAP 3.13). The wires are the only element that literally draws the "it connects" claim.

Optional Tier C upgrade for the wire layer: an R3F island renders the four dots as physical spheres (MeshBasicMaterial, unlit) and the wires as tube geometry with a travelling pulse, loaded after `window.load`. It sits under the DOM slabs. It is not needed to hit the brief; the SVG version ships first.

**The exploded view is the LCP frame.** It is rendered server-side with the exploded transforms as inline CSS custom properties (`--slab-x`, `--slab-y`, `--slab-z`, `--slab-r`) so the first paint is already the composition, no canvas, no layout shift. The stage has a reserved `aspect-ratio` at every breakpoint.

### 1.3 What happens in the first five seconds

| Time | What the visitor sees | Tech |
|---|---|---|
| 0.0 s | Headline, sub, two CTAs, and the exploded eight-slab composition, fully composed, static. The four dots are already visible on their slabs. | SSR HTML + CSS transforms. LCP = headline text or the Work slab image. |
| 0.3 to 1.2 s | Hydration lands. Slabs begin a slow idle float (±6px, 6 s loop, staggered) so the scene reads as alive, not a picture. The dots pulse once each, in Y, B, R, G order (the existing dots-loader rhythm). | CSS keyframes, compositor only; disabled under reduced motion. |
| 1.2 to 2.0 s | One wire draws from the Teams slab's yellow dot to the Docs slab's yellow dot, then fades. A 13px caption appears under the stage: "Scroll to snap it together". | GSAP DrawSVG once, then ScrollTrigger takes over. |
| by 3 s | Visitor has read: what it is (one system), who for (a company with people, processes, work, goals), what to do (Start free). | Copy discipline, nothing else. |
| by 5 s | Either they scroll (the Snap begins, section 3) or they hover a slab (it lifts 12px on Z, its label reads its "replaces" line: "Talk replaces Slack + Zoom"). | GSAP quickTo on hover; hover changes only transform of the slab, not of any button, so the no-hover-transform product rule is untouched (it governs product UI, and here the hovered thing is a scene object). |

### 1.4 The Snap (scroll 0 to 100vh)

The hero is pinned for one viewport of scroll. Scrub, with snap points at 0, 0.5 and 1.

- 0.00 to 0.35: slabs travel from exploded positions toward their rail slots. The rail spine is the anchor; slabs approach in rail order (Work first, Settings last). Wires draw between neighbouring dots as slabs arrive.
- 0.35 to 0.55: the two chrome bars slide in (top bar from above, sidebar from the left). The isometric rotation eases from (55, 0, -35) to (0, 0, 0): the scene rotates to face the visitor.
- 0.55 to 0.70: the snap. Every slab lands on the same frame with a 40 ms overshoot (scale 1.02 to 1.0) and the four dots flash to full saturation together. Wires collapse to zero length as the gaps close (they are now internal, which is the point: once assembled you do not see the seams).
- 0.70 to 1.00: the assembled shell is a working WorkwrK sandbox. The scrub has ended; the stage is now a real, focusable, clickable product surface (see 1.5). Headline shrinks to a 20/590 caption top-left: "This is the whole thing." A blue **Start free** button sits inside the sandbox's top bar where "+ Create" would be, labelled "Get this for your team".

Mobile (below 900px): no pin. The exploded composition is a static WebP (rendered from the same components at build time) that cross-fades to the assembled shell WebP at 50% viewport intersection; the four dots pulse once. Total cost: two images and one CSS transition.

### 1.5 The sandbox inside the hero

After the Snap, the assembled shell is a real client-side WorkwrK workspace seeded with demo data: one Space ("Northwind Ops"), one List with 12 tasks, one Doc (an SOP), one Talk channel, one Table, one Goal, one Team page. It is the marketing-lite build of the real components (same tokens, same layout, no network). The visitor can click a task and see the drawer open beside the list, click the Docs hub and see the SOP, click the goal and see the linked tasks. Every surface has one blue affordance, "Try this with your team", that is the trial CTA.

Why this is the conversion engine rather than decoration: the interactive-demo evidence (3.2x deals, 7.9x signups for pages with click-through demos, vendor-reported but directionally consistent) and the "no training required" claim are the same thing. If the visitor can already drive the shell on the marketing page, onboarding has been done before signup.

Honesty rule: only surfaces that are stable and shipped appear in the sandbox (List, task drawer, Doc, Talk channel, Table, Goal, Team directory, Planner week). Anything not wired is not in the sandbox. The seeded data is labelled "Sample workspace" in the sidebar header.

---

## 2. Home page architecture, top to bottom

One conversion goal (Start free), a demo side door, six CTA placements plus a sticky bar. Novelty alternates: high (hero) → calm (trust, problem) → high (the spine) → calm (tour, teams) → medium (proof) → calm (how it works, pricing) → high (final snap).

| # | Section | Job | Content | Product surface shown | CTA |
|---|---|---|---|---|---|
| 0 | **Nav** (sticky, 56px desktop / 48px mobile, white, 1px N200 bottom) | Always one way in | Logo (four dots), Product ▾ (the eight modules), How it connects, Pricing, Customers, Log in, ghost "Book a demo", solid "Start free" | none | Start free |
| 1 | **Hero: the exploded shell** (100vh + 100vh pinned scroll) | Explain the whole product in one object; earn the scroll; open the sandbox | Headline, sub, CTAs, the eight-slab scene, the Snap, the sandbox | The full shell + every hub's main surface | Start free (primary), See it connect (video modal), in-sandbox "Get this for your team" |
| 2 | **Trust strip** (calm, 120px) | Answer "can I trust you" without faking | The real login-page quote set as the strip's centre line: "We replaced 14 SaaS tools with WorkwrK in one quarter. Our managers actually open the app now." plus honest live counters from the product API (workspaces created, tasks completed this month, countries) and G2/Product Hunt badges when they exist. Logos only when real. | none | none |
| 3 | **Problem: "14 tools. 0 connections."** (calm, one screen) | Name the pain in the customer's number | Left panel: fourteen grey slabs (the tools people actually use: Slack, Zoom, Sheets, Notion, Asana, BambooHR, Lattice, Google Forms, Calendly, Loom, Trello, Confluence, Typeform, Workday) scattered, no wires, each with a tiny grey dot. Right panel: the assembled WorkwrK shell from the hero with four coloured dots and the wires briefly visible. One line: "Your roles live in one tool, your SOPs in another, your tasks in a third and your goals in a slide. Nothing knows about anything else." | The assembled shell (small) | none (deliberately quiet) |
| 4 | **The spine: "It all connects"** (high novelty, pinned, three beats + a close) | The signature. Prove the differentiator with real UI | See section 3 for the storyboard. Beat 1 People → Process. Beat 2 Process → Work. Beat 3 Work → Goals. Close: the loop, with Sidekick answering "Is Q3 on track?" with sources from all four. | Role definition page + SOP editor; SOP steps + List view with the SOP-linked task; task with KRA alignment + Goal detail with Effort card; Sidekick panel | Inline after the close: **Start free** + "Every connection above is one click in the free plan." |
| 5 | **Module tour: "Eight blocks. One system."** (calm, tabbed) | Let the visitor check the box they came for | Eight tabs in rail order. Each tab: the block from the hero rotates to face front (CSS 3D, 300 ms), a real surface, one sentence, "Replaces: X, Y", and a "Connects to:" row of the other blocks' dots (each a link to that tab). Work: tasks, lists, boards, 17 views. Planner: calendar, timesheets. AI: Sidekick, agents, automations. Talk: channels, calls, huddles. Teams: directory, org chart, roles, reviews, kudos, candor, surveys. Docs: docs, wikis, SOPs, policies, contracts, canvases, files. Tables: sheets and forms. Settings shown as "Admin: modules, permissions, hierarchy" (short). | One real surface per tab | Per tab: text link "See [Module] →" to the module page |
| 6 | **Built for every team** (calm, six cards) | Self-identification | Ops, Sales, HR, Finance, Founders, Field teams. Each card: one line, the two blocks that team lives in (two dots), a "See the [Ops] workspace" link that opens the sandbox pre-navigated to that team's template. | none | link to /solutions/[team] |
| 7 | **Proof** (medium) | Numbers, names, faces | Three metric cards (built only once real: tools replaced, time to roll out, manager weekly actives) and one long quote with name, role, company, photo. Until real customers exist, this section renders the 14-tools quote large with a "Founding customers" line and nothing invented. | none | **Start free** |
| 8 | **How it works** (calm, three steps) | Kill the "how hard is setup" objection | 1. Invite your team (import from Google Workspace or CSV). 2. Pick a template (Ops, Agency-free, HR, Sales...). 3. Work. It snaps together: roles get KRAs, SOPs attach to tasks, tasks roll up to goals. Each step is one small slab with the relevant surface. | Invite modal, Template Center, My work | none |
| 9 | **Pricing preview** (calm) | Show it costs less than the 14 tools | Three cards (Free, Team, Business), annual toggle, per-seat USD with local-currency toggle (default per Q10). Talk and Tables shown as included in Team and above (or as add-ons if that is the packaging decision). Line under the cards: "Compare with what you pay for 14 tools" opens a small calculator (enter seat count, see the sum of typical tool costs vs WorkwrK). | none | Start free on Free and Team, Talk to sales on Business only |
| 10 | **FAQ + security** (calm) | Objection handling | 6 to 8 questions mirrored in FAQPage JSON-LD: Do we need training? Can we import from ClickUp/Asana/Monday? Is my data safe (SOC 2 / GDPR when true, data residency)? What happens to Slack? Can managers see everything? Cancel anytime? Badges row. | none | none |
| 11 | **Final CTA: the last snap** (high, short) | Close | The eight blocks return, exploded, and snap one final time, but this time they snap into the four-dot logo, not the shell (the blocks shrink to dots, the dots settle between the two "k"s of the wordmark). Headline: "Snap it together." Solid Start free + ghost Book a demo. "Free plan. No credit card. Import in an afternoon." | none | Start free + Book a demo |
| 12 | **Footer** | | Standard: product, modules, compare, company, legal, badges. | | |
| sticky | **Sticky CTA bar** appears after the visitor scrolls past the hero: 52px desktop, 48px mobile, white, "Start free" solid + "Book a demo" text. On mobile it is the primary CTA surface. | | | | |

Section count: 12 including footer, versus the current 12, but sections 5, 6 and 7 fold TeamWorkspaces, ProductMosaic and AIAgents. AI does not get its own section; it is the close of the spine (context is the AI story) and one tab in the tour.

### 2.1 Role of the other pages

**Pricing (/pricing).** Full three-column table with the annual toggle, a fourth "Enterprise" column only as a text row ("Talk to sales for SSO, audit, residency"). Above the table, the same 14-tools calculator, expanded: choose the tools you use today from the fourteen slabs (each with a typical per-seat price), enter seats, and the page shows "You pay about $X per seat per month across N tools. WorkwrK Team is $Y." The slabs are the hero's grey slabs; selecting one snaps it into the WorkwrK block. Per-tier CTAs: Start free / Start free / Talk to sales. FAQ specific to billing. JSON-LD offers updated to USD.

**Module pages (/product/[module], eight of them).** Same template: the module's block as a hero object (front-facing, then rotates to show a different surface per feature row), headline in the module's job vocabulary, four to six feature rows each with a real surface, a "Connects to" section that pulls in the neighbouring blocks with wires (Talk's page shows the Task → Talk thread connection; Docs shows SOP → Task; Teams shows Role → KRA → Goal), "Replaces" strip, and the standard pricing preview + final CTA. These pages carry the SEO keywords (task management software, team chat, OKR software, spreadsheet with forms...) while the home page carries the story.

**How it connects (/how-it-connects).** The spine expanded into an explorable map. A single full-width stage with the eight blocks arranged as a graph; the wires are the edges. Click any node (Role, KRA, KPI, SOP, Policy, Task, Doc, Channel, Table row, Goal, Review, Kudos) and the page shows: what it is, what it connects to (edges highlight), and the real surface where that connection is made. A "Follow one piece of work" toggle plays the seven-beat trace from the research brief (task created → links a doc → thread decides → table row updates → SOP step acknowledged → KPI moves → review reflects it) as a guided tour with a step-progress nav (Tines pattern). This page is the demo for the demo path: sales links to it, and "Book a demo" pre-fills "Walk me through how it connects".

**Compare (/compare/monday, /compare/clickup, /compare/workday).** Honest tables; each ends with the connection map showing what the competitor leaves disconnected (people-ops in Monday/ClickUp; the work chassis in Workday). Same final CTA.

**Customers (/customers).** Empty until real; do not ship a fabricated one. Use the section 7 rule.

---

## 3. The spine: storyboard for "It all connects"

Pinned for 3.5 viewports of scroll on desktop, snapped per beat. Stage: the one light-blue tint allowed (#E6F2FD, TOKEN HOOK: bg.tint or the blue-50 alias) so the section reads as the stage, the only tinted ground on the page.

Each beat has the same grammar so the visitor learns it once: two blocks lift out of the assembled shell (which sits small and greyed at the bottom of the stage as a "you are here" map), rotate to face front, sit left and right, a wire draws between the two dots, and the real UI on each face performs the connection. A 12/590 label on the wire names the connection.

| Beat | Scroll span | Left block (surface) | Right block (surface) | What happens on the wire | Copy (headline / one line) |
|---|---|---|---|---|---|
| 1. People → Process | 0.00 to 0.30 | Teams: the Role Definition page for "Ops Manager" with two KRAs (weights 60/40) and their KPIs | Docs: the SOP editor for "Weekly vendor reconciliation", steps listed | The yellow dot on Teams sends a pulse to the yellow dot on Docs; the SOP's header gains an "Owned by: Ops Manager (KRA: Vendor accuracy)" chip; a second wire attaches the SOP's step 3 to a KPI | **Every role knows its process.** Roles carry KRAs. KRAs own SOPs. No one has to ask "who does this". |
| 2. Process → Work | 0.30 to 0.60 | Docs: the same SOP, step 3 "Reconcile invoices over $5k" | Work: the List view, group "This week", a task "Reconcile Q3 vendor invoices" | The wire carries the SOP step to the list; a task appears at the top of the group with a linked-SOP chip, an assignee (the Ops Manager from beat 1) and a due date; the task drawer slides open to show the SOP step inline with an acknowledge button; a Talk thread bubble appears on the task ("Priya: invoices from Northwind are late, pushing to Thursday") | **Every process becomes work.** SOP steps turn into tasks with the right owner attached. The conversation lives on the task, not in a Slack thread nobody can find. |
| 3. Work → Goals | 0.60 to 0.90 | Work: the task from beat 2, now marked Done; a Table row (the invoice sheet) updates its total | Work › Goals: the Goal "Close Q3 books in 5 days" with its progress ring and the Effort card listing linked KRA tasks | The wire runs from the task's blue dot to the goal's green dot; the progress ring advances from 62% to 71%; the Effort card adds the task with the assignee avatar; the KPI "Vendor accuracy" ticks up in the Teams block, which lifts briefly in the background | **Every task moves a goal.** Done work rolls up to KPIs and goals automatically. Progress is measured, not reported. |
| Close. The loop | 0.90 to 1.00 | All eight blocks snap back into the shell | The AI hub's Sidekick panel opens over the shell | Someone types "Is Q3 close on track?" Sidekick answers in three lines with four source chips, one per block it read (Goal 71%, 3 open SOP tasks, Priya's Thursday note, Ops Manager KRA at 88%). The four dots on the chips are Y, B, R, G. | **Ask anything. It knows because it's connected.** Sidekick reads the whole system, so its answer has sources, not guesses. |

After the close, an inline CTA on the tint stage: **Start free**, with "Every connection above is one click in the free plan." Then the page returns to white for the tour.

Mobile version (built first): no pin. The four beats are four full-width cards stacked vertically, each with the two surfaces stacked (left block above right block), the wire drawn vertically between the dots on intersection (DrawSVG triggered by IntersectionObserver, once), the label on the wire, and the copy. The "you are here" mini shell becomes a four-dot progress indicator fixed under the sticky CTA bar while the spine is in view.

Reduced motion (any breakpoint): no pin, no draw; the four cards render with the wire already drawn and the end state of each surface. Nothing is lost except motion.

---

## 4. Motion choreography and stack

### 4.1 Stack decision

Chosen: **DOM surfaces + CSS 3D + GSAP ScrollTrigger for the two pinned scenes + Motion v12 for everything else + Rive for the mark + optional R3F wire layer.**

| Layer | Tool | Why this and not the alternatives |
|---|---|---|
| Product surfaces (the block faces, the sandbox, every tour tab) | React components, marketing-lite variants of the real product components, same tokens | The product is the demo. Screenshots go stale, do not resize, do not respond to theme or RTL, and are not clickable. This also makes the "no training" claim testable on the site itself. TOKEN HOOK: the marketing-lite components consume the same --os-* aliases as the product. |
| The blocks in space (hero, spine, final) | CSS 3D transforms (perspective, preserve-3d) on those components, transforms driven by GSAP | Gives literal 3D placement and rotation of real DOM at zero bundle cost, keeps SSR and accessibility, and the flat-material brand rule is satisfied automatically (there is no lighting model to fight). Spline is rejected for the hero (runtime weight, LCP risk, materials the brand cannot control). Full R3F for the blocks is rejected because the block faces must be real DOM, and drei Html-in-canvas would make the LCP element a canvas. |
| Scroll pin / scrub / snap (hero Snap, the spine, final snap) | GSAP 3 + ScrollTrigger + DrawSVG + useGSAP (~30 KB gz, free since April 2025) | Only engine with dependable pin, scrub and snap. Scoped with useGSAP so Strict Mode and route changes revert cleanly. Loaded only on the home page, only in the client wrappers for those three scenes. |
| Reveals, tabs, hover lifts, layout animations | Motion v12 via LazyMotion + m (~4.6 KB), useScroll on ScrollTimeline where available | Already installed; keeps component motion declarative. Element ownership rule: a node animated by GSAP is never given Motion props, and vice versa. |
| Parallax, dot pulses, progress indicators | CSS scroll-driven animations under @supports (animation-timeline: scroll()) and prefers-reduced-motion: no-preference | 0 KB, compositor thread; Firefox falls back to static. |
| The four-dot mark (nav logo, final CTA, loaders on the site) | Rive, self-hosted rive.wasm under /public with preload and immutable caching, lazy-mounted | State machine (idle / hover / connected / snapped) in one small runtime; Lottie rejected for anything that runs simultaneously. If no Rive designer is available (Q13 default: none), ship the CSS/SVG dots-loader motif and add Rive later; nothing else depends on it. |
| Wire layer upgrade (optional) | React Three Fiber v9 island: four unlit spheres + tube wires with a travelling pulse, under the DOM slabs | Only if the founder wants literal WebGL 3D. Loaded after window.load via next/dynamic ssr:false inside a "use client" wrapper, DPR cap 1.5, IntersectionObserver rAF pause, static WebP on mobile and reduced motion, budget ≤ 250 KB gz JS, ≤ 1 MB assets. Never the LCP element. |
| Smooth scroll | none (no Lenis in v1) | Hijacked scroll hurts INP on low-end phones and fights CSS scroll timelines. Revisit only if the pinned scenes stutter with native scroll. |
| Hero video ("See it connect, 90 sec") | modal, MP4/WebM, lazy | Not the hero; a side door for people who will not scroll. |

### 4.2 Choreography summary (desktop)

```
scroll  0vh ─ hero static (LCP), idle float, one wire draws once
        0 → 100vh  PIN hero: exploded → rail order approach → rotate to front → SNAP → sandbox (scrub, snap 0/.5/1)
        100 → 130vh  trust strip (fade), problem two-panel (grey slabs jitter apart on CSS timeline; assembled shell settles)
        130 → 480vh  PIN spine (3.5 viewports): beat1 → beat2 → beat3 → close (scrub, snap per beat, wires DrawSVG)
        480 → 560vh  module tour (tabs; block rotates 300ms on tab change, Motion layout)
        560 → 640vh  every team (cards fade up), proof (metric counters count once on view)
        640 → 720vh  how it works (three slabs step in), pricing (toggle only)
        720 → 780vh  FAQ (accordion, Motion height), security badges
        780 → 880vh  PIN final (1 viewport): exploded → blocks shrink → dots settle into the wordmark → CTA
```

Two pins plus a short third one on a page is the ceiling; everything between is calm (Vercel's novelty mapping, "if it felt pompous or out of rhythm, don't build it").

### 4.3 Performance and SEO handling on Next.js 16.2.6 App Router

- **Server first.** page.tsx stays a Server Component. Every animated scene is a small "use client" wrapper file (hero-scene.tsx, spine-scene.tsx, final-scene.tsx) that does `next/dynamic(() => import("./hero-scene-motion"), { ssr: false, loading: () => null })`. The wrapper itself renders the static composition (server-rendered DOM with inline transform variables) as children, so the pre-hydration frame and the post-hydration frame are the same DOM; GSAP takes over positions from the CSS custom properties rather than re-rendering. This satisfies the Next constraint that ssr:false only works inside Client Components and that a Server Component dynamic-importing a Client Component does not code-split.
- **LCP** is the headline (SSR text) or the Work slab's face (rendered DOM, or a WebP of it on mobile). No canvas above the fold. Target < 2.5 s on a mid-range Android over 4G.
- **CLS 0**: the stage and every slab have reserved dimensions per breakpoint (aspect-ratio, fixed slab sizes in rem); pinned sections use ScrollTrigger's pinSpacing so the document height is stable; fonts are preloaded with size-adjust fallbacks.
- **INP < 200 ms**: scrub animates transform and opacity only; the sandbox's interactions are local state, no network; GSAP tickers are killed when their trigger is out of view; the marketing-lite components use `content-visibility: auto` on block faces that are not currently front-facing; each slab is one compositor layer (will-change: transform is set only while pinned, then removed).
- **JS budget**: < 200 KB gz first-load before any optional island. GSAP + ScrollTrigger + DrawSVG ≈ 35 KB gz, loaded only on the home page. Motion via LazyMotion. The sandbox's demo data is a static JSON of ~40 KB.
- **Layer discipline for CSS 3D**: eight slabs × one composited layer each is fine; the failure mode is nesting preserve-3d inside scrollable or overflow-hidden containers (it flattens) and stacking many transformed children per slab. The face content is rendered flat (no nested 3D) and the slab is the only transformed ancestor.
- **SEO**: all copy in the DOM at SSR; the spine's four beats are real `<section>`s with headings even while pinned; `<noscript>` text in every canvas wrapper; FAQ text matches the FAQPage JSON-LD; JSON-LD SoftwareApplication offers updated to the chosen currency (Q10); module pages carry the keyword titles; a static OG image of the exploded shell (this is also the share image, see section 7).
- **Accessibility**: pinned scenes are still native scroll (no wheel capture), so screen readers and keyboard users move through the four beat sections normally; each beat's copy has a heading and the wire label is text; the sandbox is a real DOM with focus order, `aria-label`s and Escape to close the drawer; reduced motion gives end states; a "Skip the tour" link at the top of the spine jumps to the module tour; colour never travels alone (each dot has its label).
- **Mobile first** (~83% of visits): the vertical stepper and the two-WebP hero are designed and built before the desktop pins. The sticky bar is the primary CTA surface on mobile.
- **Measurement**: instrument the six CTA placements and the sandbox interactions separately (data-cta attributes) before launch so the Snap and the spine can be A/B tested against a static hero.

---

## 5. Conversion funnel

### 5.1 Motion: trial first, demo as the side door, sandbox as the bridge

ACV is under $10K for SMB, the product is self-explanatory, time-to-first-value is sub-24h with templates (Q11 default: yes). So the primary goal is **Start free** everywhere; **Book a demo** is a ghost button in the nav, the final CTA and the Business tier, and the "How it connects" page carries the demo path for mid-market buyers.

The sandbox is the bridge between the two: a visitor who drives the shell for 60 seconds is warmer than either a video watcher or a form filler. Sandbox interactions fire the same data-cta events; a visitor who opens three or more surfaces gets a soft in-sandbox prompt, "Want this with your own data? Start free, import in an afternoon."

Escalation (post-signup, product-side): when a trial workspace invites 3+ teammates or turns on Talk/Tables, prompt a 20-minute setup call. Not a marketing-site concern but the site's Book a demo form pre-qualifies with two fields (company size, tools you use today, the latter as the fourteen slabs to tap).

### 5.2 CTA placement and frequency

One goal, seven placements: nav (persistent), hero (primary + video side door), inside the sandbox (contextual), after the spine (inline primary), after proof (primary), pricing (per tier), final (primary + demo). Plus the sticky bar after the hero. Every primary is the same words, "Start free", the same blue, the same shape; the demo path is always ghost or text.

### 5.3 Pricing presentation

Three cards, annual default with a monthly toggle, USD with a currency selector (INR, AED, SGD, GBP, EUR; the i18n layer already carries 21 currencies). Free plan real and generous enough to feel the connections (people, SOPs, tasks, goals for up to N users). Talk and Tables presented as what they are in the packaging decision (included from Team, or add-ons); never as the hero of pricing. The "14 tools" calculator turns pricing from a cost into a comparison, and it uses the same slabs so the page stays inside the metaphor. No "most popular" ribbon in a colour; a 1px blue border on the Team card is enough.

### 5.4 Objection handling (where each objection dies)

| Objection | Where | How |
|---|---|---|
| "Another tool nobody will use" | Trust strip + Proof | The customer's own line about managers opening the app; manager weekly actives as a metric once real |
| "We will need training" | Hero sandbox + How it works | If you drove it on the site, you are trained; three steps; templates |
| "Migration is painful" | How it works + FAQ + final CTA microcopy | Importers (CSV now; ClickUp/Asana/Trello/Monday when shipped, and only then named); "import in an afternoon" only when true |
| "What about Slack/Zoom/Sheets?" | Module tour "Replaces" lines + Problem section | Talk and Tables shown as real surfaces, not promises |
| "Is it secure / where is data?" | FAQ + badges + footer | SOC 2 / GDPR / residency shown only when true; until then, plain text on hosting, encryption, MFA, and audit (auth hardening wave shipped) |
| "Too big for us / too small for us" | Every team cards + Pricing | Free plan for small teams, Business for hierarchy, permissions and SSO |
| "Is this just ClickUp with HR bolted on?" | The spine + How it connects page | The connection is shown, not claimed; Compare pages make the gap explicit |

### 5.5 Social proof policy

Real or absent. The login-page quote is real and leads. Product metrics come from a live endpoint (workspaces, tasks completed, countries) and are labelled as live. Named testimonials with photo, role and company are added as they are secured; the proof section's layout reserves three metric cards and one long quote so it grows without a redesign. No logos until there are logos. G2 and Product Hunt badges when they exist.

---

## 6. Copy direction

**Voice.** Physical and plain. Verbs of assembly (snap, connect, click into place, roll up, attach) and the customer's own vocabulary (managers open it, replaced 14 tools, one quarter). Short sentences. No "supercharge", no "seamless", no "empower". Second person for the visitor, third person for the system. Numbers are the customer's, not ours, until ours are real. No em dashes or double hyphens anywhere; commas, colons, periods.

**Five headline candidates (hero-grade).**
1. Your people, processes, work and goals. One system, snapped together.
2. Run the whole company from one place. Nothing left to stitch together.
3. Fourteen tools. One system. It all connects.
4. Roles know their SOPs. SOPs become tasks. Tasks move goals. That is the whole product.
5. The work OS your managers will actually open.

**Section headline set (for rhythm).** "14 tools. 0 connections." / "Every role knows its process." / "Every process becomes work." / "Every task moves a goal." / "Ask anything. It knows because it's connected." / "Eight blocks. One system." / "Built for the team you have." / "Invite. Pick a template. Work." / "Less than the tools it replaces." / "Snap it together."

**Microcopy.** "Free plan. No credit card." "Sample workspace" (sandbox label). "Scroll to snap it together." "Skip the tour." "Get this for your team." "Every connection above is one click in the free plan."

---

## 7. The crazy factor: the Snap, and the shell that is real

The single shareable moment is the hero: eight floating blocks with real software on their faces snap into an app shell as you scroll, and then **the shell works**. You click a task and a drawer opens. You click Docs and the SOP is there. The screenshot people take is the mid-snap frame: the blocks a few pixels from landing, four coloured dots lit, blue wires still visible between them, the headline above. That frame is also the OG image, the Product Hunt gallery hero and the first frame of the 90-second video.

Why it will be shared: it is one object, sold properly (Utsubo's rule), it makes a product claim ("it all connects") visible in a single gesture, and the pay-off is not a video but a live thing you can poke. The second shareable beat is the final section, where the same blocks shrink into the four dots of the logo: the brand mark becomes the ending of the story rather than a badge on it.

The "drag to explode" affordance seals it: after the Snap, grabbing the assembled shell's edge and pulling it apart re-explodes the blocks (GSAP Draggable on the stage with inertia off, snapping back on release). Tinkering is the invitation; sharing is the tinkerer telling a friend "pull it apart".

---

## 8. Staying on-brand, and where boldness is spent

- **Blue #0073EA is the only fill** for buttons and links (hover per the token spec), and the only colour for wires. Nothing else on the page is filled blue. TOKEN HOOK: accent.solid / accent.solidHover / accent.text.
- **YBRG appears only as the four dots**, at full brand saturation: one per block, the pulse on the wires, the chips in Sidekick's answer, the final logo. Never as backgrounds, never as gradients, never mixed into headlines. Inside product surfaces, status colours use the semantic trio from the token spec (success / warning / danger), so a "Done" chip is the semantic green, never the brand green. The two sets never mix.
- **Flat everywhere.** The blocks are white slabs with a 1px N200 edge; lifted slabs use the popover shadow token, nothing else. The 3D is placement and rotation, not material. No lighting, no reflections, no mesh gradients, no glassmorphism, no dark sections; light only. TOKEN HOOK: bg.raised, border.subtle, shadow.popover.
- **One tinted stage** (#E6F2FD, blue-50) for the spine, the single non-white ground on the page.
- **Type does the shouting**: display 56 to 72 at one weight, tight leading, on white; body 16 on marketing (the product's 14 is for rows, not reading). TOKEN HOOK: the marketing type ramp is the product family (Inter per Q5 default) at display sizes.
- **Faint blueprint grid** on the hero stage and the How-it-connects map only; it reads as "engineering drawing", which is the exploded-diagram idea's native habitat, and it is dropped everywhere else.
- **Four dots as the illustration language**: no mascots, no claymation, no scenes. The dots-loader rhythm (Y, B, R, G) is the timing signature for every pulse on the site.

Where boldness is spent: (1) the scale and physicality of the Snap, a full-viewport pinned scene with real UI; (2) the live sandbox in the hero; (3) the spine, three pinned connections with wires; (4) the final snap into the logo. Everything else is quiet on purpose, so those four moments read as directed rather than decorated.

---

## 9. Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| **CSS 3D of heavy DOM tanks frame rate** (eight slabs each holding a real list/doc/sheet) | Layer explosion and paint cost on mid-range mobile and on 4K desktops | Marketing-lite components: ~40 DOM nodes per face, no virtualization, no editors; `content-visibility: auto` on faces not front-facing; one transformed ancestor per slab; will-change only while pinned; mobile gets two WebPs instead of live slabs; measure on a Moto G-class device before adding the optional R3F layer |
| **LCP/INP regression from the pinned scenes** | 83% mobile, desktop converts 2x; the site cannot be slower than the current static hero | SSR the composed frame; GSAP loads after hydration and only on the home page; scrub touches transform/opacity only; kill tickers off-view; enforce the 200 KB gz first-load budget in CI (bundle analyzer gate) |
| **Scroll pinning and accessibility** | Pinned scenes can trap keyboard and screen-reader users or nauseate motion-sensitive ones | Native scroll (no Lenis, no wheel capture); every beat is a real section with a heading; "Skip the tour" link; prefers-reduced-motion renders end states with no pin; the sandbox is a focusable DOM with Escape and visible focus rings |
| **The sandbox drifts from the product** (or shows a surface the parity mandate protects in a restyled form) | Honesty rule; protected List/Board/task detail screens are restyled with tokens, not restructured | The marketing-lite components import from the same primitive files and tokens; a visual regression test renders each face against the product screenshot; only shipped surfaces appear; the sandbox is labelled "Sample workspace" |
| **Build effort** | Eight faces, a sandbox with seven surfaces, three pinned scenes, eight module pages, a map page | Phase it: (1) mobile stepper + two-WebP hero + all copy and SEO (ships first, wins on 83% of traffic); (2) desktop Snap with static faces (WebP) and the spine; (3) live DOM faces and the sandbox; (4) module pages and How it connects; (5) optional R3F wires and Rive mark. Each phase is shippable and measurable. Rough order of magnitude: phase 1 one to two weeks, phases 2 and 3 three to four weeks with one engineer, phase 4 two weeks, phase 5 opportunistic |
| **Founder expects "3D" to mean WebGL lighting and depth** | The brand is flat; glossy 3D would break it and the perf budget | Show the exploded-diagram reference (Linear's layered stack, Maze's isometric path, an engineering drawing) up front; offer the R3F wire layer as the literal-3D concession, unlit; the flatness is the differentiator against monday's rainbow and Linear's dark gloss |
| **Proof inventory is thin** | A proof section with invented numbers would violate the honesty rule and read as fake | Section 7 renders the real quote large and reserves the metric slots; live product counters replace logos; ship without logos rather than with borrowed ones |
| **Two animation libraries on one page** | GSAP and Motion fighting over the same node causes jank and bugs | Ownership rule: pinned scenes are GSAP-only; every other component is Motion-only; a lint rule flags `motion.` inside scene files |
| **Copy claims outrunning the product** (importers, SOC 2, "import in an afternoon") | Honesty rule and legal exposure | Every claim in FAQ, badges and microcopy is gated on a feature flag tied to the shipped state; unshipped importers are not named |
| **Positioning and currency undecided (Q10)** | Headline, pricing and JSON-LD all depend on it | Build with USD + selector per the default; strings and JSON-LD are data, not markup, so flipping to INR-first is a config change |

---

## 10. What the visual token pass needs to hand this concept

1. accent.solid / solidHover / text and blue-50 tint (the wires, the CTAs, the stage).
2. The four brand dot hexes (fixed) and the semantic success/warning/danger trio, so the block dots and the in-surface status chips never share a value.
3. Neutral ramp values for slab edge (border.subtle), slab face (bg.raised), the grey "old tools" slabs (N200 fill, N400 dot), and the greyed "you are here" shell.
4. The popover shadow token (the only shadow the slabs use, when lifted).
5. The display type ramp (56/64/72 at one weight, leading 1.05) and the marketing body size (16), in the chosen family.
6. Radius: slabs at 8 (card), sandbox chrome as the product's own tokens.
7. Motion durations for non-scroll transitions (tab rotate 300 ms is the one exception above the product's 250 ms cap, justified as a scene object, not UI chrome).

Everything else in this document is independent of the exact values.
