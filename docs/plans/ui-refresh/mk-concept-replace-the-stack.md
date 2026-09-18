# workwrk.com concept: "Fourteen to One" (angle: Replace the stack)

Creative direction proposal, 2026-09-11. One of three independent concepts. Inputs honoured: marketing-references.md (stack, conversion evidence, refs), phase2-inputs.md (brand constraints, blueprint), existing-direction.md (PPMS positioning, honesty rules). Visual tokens (exact hex, type family, ramps) are decided separately; this document marks every place the token system plugs in with **[TOKENS]**.

The real quote this whole site is built around (already live on the login page, `src/app/(auth)/layout.tsx`):

> "We replaced 14 SaaS tools with WorkwrK in one quarter. Our managers actually open the app now. That didn't happen with Workday."
> Mohsin S., COO, 280-person services firm

Two promises hide in that quote and the site makes both of them: **ROI** (14 subscriptions, 14 logins, 14 places to look become one) and **relief** (people actually use it). Every section is either proof of the first or proof of the second.

---

## 0. The concept in one paragraph

The visitor lands on a page that shows their own software stack as fourteen loose tiles, watches them get pulled into a single flat 3D slab that is the real WorkwrK shell, and reads one number that just got smaller. From there the page proves, hub by hub, that each replaced tool is genuinely covered (not a checkbox, a real surface), shows the one thing no stack of point tools can do (a role, an SOP, a task, a KPI and a review that know about each other), lets the visitor tap the tools they pay for and prints a "stack receipt" with their monthly number, tells them the switch takes a quarter and not a year, and asks them to start free. One goal, one blue button, repeated at every point where a decision could be made.

Working title: **Fourteen to One**. The typographic mark "14 → 1" (arrow glyph, one weight, display size) is the concept's signature and appears exactly three times: hero, receipt, final CTA.

---

## 1. Hero: "The Collapse"

### Headline direction
Outcome first, trade-off removed, customer vocabulary. Primary:

**Cancel 14 tools. Keep one.**
Sub: WorkwrK is tasks, docs, chat, spreadsheets, goals, people ops, calendar and AI in one system, built so your people, your processes, your work and your goals finally know about each other. Teams switch in a quarter. No training.

CTA row: blue **Start free** (only filled element in the viewport). Text link: **See what it replaces ↓** (scrolls to section 4). Microcopy under the button: "No credit card. Import from a spreadsheet in minutes." (Phrase depends on founder Q11; if self-serve is not live, the primary becomes Book a demo and the whole funnel below flips to demo-first.)

Alternates are in section 6.

### The interactive / 3D idea
The hero is split: headline column left (DOM text, this is the LCP element), stage right (60% width on desktop, full width below headline on mobile).

The stage contains two things:

1. **Fourteen tool tiles.** Category tiles, not competitor logos: Task tracker, Wiki, Team chat, Video calls, Spreadsheets, Forms, OKR tool, HRIS directory, Review tool, Survey tool, Calendar, Timesheets, Whiteboard, Contracts / e-sign. Each tile is a real DOM card (glyph + label + a small "$/seat" tag) so it is crawlable and screen-reader-legible. They float in a loose cloud with slow idle drift. **[TOKENS: tiles are neutral cards, N0 fill, N200 border, N600 glyph. No colour on tiles, ever. They are the "before".]**
2. **The slab.** The real WorkwrK shell (rail, sidebar, top bar, a list view) rendered as React components, tilted in CSS 3D (perspective 1600px, rotateX 18deg, rotateY minus 14deg) so it reads as a physical object. The slab is 3D without WebGL, which is what makes it crawlable, theme-safe and cheap. **[TOKENS: the shell uses the product token set exactly, so the marketing hero is the product.]**

### What happens in the first five seconds
- 0.0s: Headline, sub, CTA painted from SSR. Tiles rendered in their scattered positions (SSR positions, deterministic so there is no CLS). The slab is present but small (scale .92, opacity .0) behind the tiles. A counter above the tiles reads **14 tools · $0/mo** with the price counting up to a representative stack total (see section 4.6 for how that number is sourced honestly).
- 0.8s: A magnetic pull starts. Each tile accelerates toward the rail slot of the hub that replaces it (Task tracker to Work, Wiki to Docs, Chat and Calls to Talk, Spreadsheets and Forms to Tables, OKR tool to Goals, HRIS, Reviews and Surveys to Teams, Calendar and Timesheets to Planner, Whiteboard and Contracts to Docs, Automation to AI). Spring physics, slight overshoot, tiles shrink as they travel.
- 1.6s to 2.8s: Tiles are absorbed one after another. On each absorption the target hub's icon on the rail pulses once and its four-dot colour (each hub carries exactly one YBRG dot, semantic per the brief) blinks. The counter decrements: 13, 12, 11 ... and the dollar number falls.
- 2.8s: The slab is at full scale, fully opaque. The counter reads **1 tool**. Under the slab a single caption fades in: "That is what Mohsin's team did in one quarter." with the quote attribution. The four dots settle into the logo mark in the top-left of the slab.
- 3.2s to 5s: Stillness. The slab is a real product screenshot the visitor can read. The only motion left is the cursor-parallax tilt (two degrees, pointer only, disabled on touch and reduced motion).

Hover / touch after the collapse: hovering any hub on the slab's rail shows a small label "Replaced: Task tracker, Sprints board" listing the tiles it absorbed. This is the first taste of section 4 and teaches the rail before the visitor ever signs up.

Reduced motion / no JS / mobile-lite: render the final state (slab plus "14 → 1" mark plus counter at 1) as the static composition. The story still reads without a single frame of animation.

Why this and not a decorative WebGL object: the brief's evidence says the product-is-the-demo pattern wins and static 3D loses to scroll narratives; a flat-shaded shell in CSS 3D gives the founder the "3D modules" he asked for while the LCP stays a headline and the first-load JS stays under 200 KB gz.

---

## 2. HOME page architecture (top to bottom)

Rhythm rule (Vercel novelty mapping): high-novelty sections are 1, 4 and 6. Everything between them is calm and typographic.

### 0. Sticky nav (56px desktop, 48px mobile)
Logo (four dots), Product (dropdown listing the eight hubs with a one-line "replaces" note each), Replace (links to /how-it-connects), Pricing, Customers, Log in, ghost **Book a demo**, blue **Start free**. Once the visitor scrolls past the hero the nav's right side becomes the sticky CTA: "Start free" plus, once the calculator has been used, a small grey "You'd keep $X/mo" chip beside it (persisted in localStorage). On mobile the sticky element is a 48px bottom bar with the single blue button.

### 1. Hero: The Collapse
As specified above. Surface shown: real shell, list view inside. CTA: Start free (primary), See what it replaces (secondary text link).

### 2. Proof strip: the quote is the strip
No logo wall (there are no logos yet and the brief forbids faking them). Instead the strip is the full Mohsin quote in display type, name, role, company size, with the number "14" set in the display weight. To its right, three honest product numbers pulled live from a public stats endpoint (teams on WorkwrK, tasks completed this month, countries), each labelled plainly. When G2 or Product Hunt badges exist, they sit here. Surface shown: none. CTA: none (calm section).

### 3. The stack tax (problem in one screen)
Headline: **You don't pay for 14 tools. You pay for the gaps between them.**
Left panel, "The old way": the same fourteen grey tiles from the hero, now static, connected by dashed grey lines and annotated with the hidden costs: duplicate seats, four places to check a status, the HR tool nobody opens, the wiki nobody trusts, the OKR doc last updated in January. Right panel, "One system": the shell, with one blue line threading rail hub to hub. Under it, three short statements the founder can stand behind without a citation ("Every status lives in one place." "Every process is one click from the task it governs." "Every goal is owned by a named role."). If a sourced statistic about context switching exists, use it; if not, use none. Surface shown: shell (static). CTA: none.

### 4. THE REPLACEMENT MAP (the pinned signature scene)
The one high-novelty scroll section. Pinned on desktop, scrubbed, snapped to nine beats. Vertical stepper on mobile (built first).

The stage is the slab from the hero, now flat and large, centred on a light-blue tint background **[TOKENS: the single tint stage, blue-50]**. For each beat, the relevant hub's real surface fills the content area of the shell, the tools it replaces fly in from the edges and are absorbed, and one sentence plus a "Replaces:" line sits in the caption column.

| Beat | Hub (rail label) | Real surface shown | Sentence | Replaces (category names) |
|---|---|---|---|---|
| 1 | Work | List view with groups, statuses, assignees; a Board view flips in | Every task, board and view your team already knows how to use. | Task tracker, Kanban tool, sprint board |
| 2 | Docs | A doc with a linked SOP panel; a canvas thumbnail; a contract with an acknowledgement | Docs, wikis, SOPs, policies, contracts and whiteboards, all in the same tree as the work. | Wiki, SOP tool, whiteboard, e-sign / contract store, file share |
| 3 | Talk | Channel with a thread that references a task; huddle chip | Chat, channels and calls that know which task you are talking about. | Team chat, video calls |
| 4 | Tables | A sheet with letter headers, a formula bar, a form that feeds it | A real spreadsheet and forms, not a grid pretending to be one. | Spreadsheets, form builder |
| 5 | Goals | Goal detail with progress ring, "on track?" AI verdict, linked KRA tasks | Goals owned by named roles, with the AI telling you if you are on track. | OKR tool, KPI dashboard |
| 6 | Teams | Directory, org chart, a review, a kudos card, a survey | People ops your managers will actually open. | HRIS directory, review tool, survey tool, recognition app |
| 7 | Planner | Calendar with time-on-task, timesheet week | Calendar and timesheets that fill themselves from the work. | Calendar, timesheet app |
| 8 | AI | Sidekick answering "what is blocking Q3 goal 2?" with linked evidence; an automation recipe | One assistant that can see all of it, so it can actually answer. | Standalone AI chat, automation tool |
| 9 (finale) | All | The rail with all eight dots lit, the absorbed tiles gone, the counter at 1 | Fourteen tools can't do what comes next. They don't know each other. | (the counter reads 1) |

The finale beat is the handoff to section 5. Inline CTA after the scene: blue **Start free** with the line "Bring one team. Keep the rest of the stack until you are ready." Surface shown: eight real surfaces. This section reuses the shell components from the hero, so the marginal build cost is content, not engineering.

Honesty gate: a hub appears in this map only if its surface is shipped and stable enough to be shown publicly (the founder confirms the list; Tables and Talk are premium modules that are off for new orgs, so their beats say "included on Growth and above" in the caption).

### 5. The part no stack can do (the connection thread)
Calm, horizontal five-step strip, no pin. Headline: **The thing a stack of tools will never do.** Sub: In WorkwrK a role owns a KRA, the KRA is delivered by tasks, the tasks follow an SOP, the numbers roll into a goal, and the review reads all of it. One thread.

Five cards, each a cropped real surface, joined by a single blue line that draws itself as the row scrolls into view: **Role** (role definition with KRAs and weights) → **SOP** (the process step linked from the task) → **Task** (with alignment field showing the KRA) → **KPI / Goal** (moving as the task completes) → **Review** (the review pulling the goal evidence). A sixth ghost card, "Ask Sidekick", shows the AI answering across the thread.

This is the differentiator from existing-direction.md (Roles → KRAs → KPIs → Goals, SOPs) and is the "relief" proof: it is why managers open it. CTA: text link **See how it connects →** (to /how-it-connects). Surface shown: five cropped surfaces.

### 6. Your stack receipt (the calculator, the crazy factor)
Headline: **What does your stack cost? Tap what you pay for.**
A chip strip of the fourteen categories plus "Other" (free text, no price). The visitor taps the tools they use, sets a team size (slider, default 50), and the same collapse animation from the hero runs on their selection into a slab thumbnail. Beside it a receipt-style card prints:

```
STACK RECEIPT                      50 seats
Task tracker ........... $ 12/seat  $600
Wiki ................... $  8/seat  $400
Team chat .............. $  8/seat  $400
OKR tool ............... $ 10/seat  $500
Review tool ............ $  6/seat  $300
-------------------------------------------
Old stack                 5 tools   $2,200/mo
WorkwrK Growth            1 tool    $   ...
-------------------------------------------
You keep                            $ .../mo
14 → 1
```

Per-category prices are the mid-point of public list prices for the leading tools in each category, dated and footnoted ("Typical list price, [month year], editable"), and every line is editable in place so the visitor can put in their real number. WorkwrK's line comes from the live pricing table in the visitor's currency (USD default, INR and others via toggle; founder Q10). The receipt has two buttons: blue **Start free** and ghost **Copy my receipt**, which produces a link to a generated OG image (Next `ImageResponse` route, `/api/og/receipt?t=...&s=50`) so the receipt renders as a shareable card on LinkedIn, X and WhatsApp. If seats > 100 the ghost button becomes **Book a migration call** (the demo escalation rule from the brief). Surface shown: the receipt and the slab thumbnail. CTA: primary + escalation.

### 7. The switch takes a quarter (relief section)
Headline: **Moving is a quarter, not a year. You don't switch everything on day one.**
Three steps with a thin timeline: **Week 1: bring one team.** Invite people, import from a spreadsheet, pick a template. **Weeks 2 to 6: connect the work.** Add SOPs to the lists, give roles their KRAs, turn on Talk when the team is ready. **Weeks 6 to 12: switch off the old tools.** A downloadable "switch-off schedule" (a WorkwrK Table template) lists each tool, its renewal date and who owns cancelling it. Only importers that actually exist are named (today: CSV; ClickUp/Asana/Trello/Monday importers are in the plan and stay unmentioned until shipped). If a migration concierge is offered on Scale, say so here. Surface shown: the switch-off Table template. CTA: **Start with one team** (blue, same destination).

### 8. Managers actually open it (adoption proof)
Headline: **Managers actually open it.** Sub: the second half of the quote, set large, attributed. Two real surfaces side by side: the manager's My Work (date-bucketed) and Team Goals with the "on track?" verdict. When real customers exist, this becomes two or three metric cards with named people (the brief's Jasper/Linear pattern). Until then it is the one quote and the two surfaces, nothing invented. CTA: **Start free** (primary).

### 9. Pricing preview
Three cards, Starter / Growth / Scale, annual toggle, currency toggle. Each card carries one line the competitors' cards do not: "Replaces roughly $X/seat of tools" computed from the same public price table as the receipt (with the same footnote). Per-tier CTA: Start free on Starter and Growth, Talk to sales on Scale only. Premium modules (Talk, Tables) shown as included-from-Growth rows, matching the modular architecture. Link: **Full pricing and the receipt calculator →**. **[TOKENS: card borders N200, one blue button per card, no highlighted-tier fill; the recommended tier gets a 1px blue border and a small "Most teams" chip.]**

### 10. Objections (FAQ) and trust
Six questions, mirrored in the FAQPage JSON-LD:
1. Is this really all-in-one or eight half-apps? (Answer with depth: Tables is a spreadsheet with a formula engine, Talk runs calls on our own infrastructure, Docs has SOP acknowledgement, and link each to its module page.)
2. Can we keep the tools we love? (Honest: email, calendar and SSO now; other connectors are built on request; export is always available.)
3. How long does migration take, and who does it?
4. What happens to our data if we leave? (Full export, soft-delete windows, the data-integrity stance.)
5. Do we have to switch everything at once? (No; section 7.)
6. Is it secure? (Only claims that are true today: MFA at login, idle sessions, hashed reset tokens, audit log; SOC 2 / GDPR badges appear here and in the footer only once true.)
Surface shown: none. CTA: none.

### 11. Final CTA
Display headline: **Fourteen to one starts today.** The "14 → 1" mark, the four dots resolving, blue **Start free**, ghost **Book a demo**, "No credit card" microcopy, and the receipt mini (if the visitor built one, their number is shown here: "Your receipt: keep $2,200/mo"). Footer with security badges (once true), the eight hub links, compare links.

CTA cadence: nav (sticky), hero, after the map (inline), receipt (primary + escalation), after switching, after adoption proof, pricing per tier, final. One goal, eight placements, plus the mobile bottom bar. Every placement carries a distinct `data-cta` id so each can be measured separately.

---

## 3. The other pages and their jobs

### /pricing
The receipt calculator sits at the top of the page, prefilled from the home page (query string or localStorage), above the three tiers. Below: a "what you would otherwise buy" comparison table (tool category rows, WorkwrK tier columns, checkmarks only where the surface is shipped), premium-module rows, the same FAQ, and a "Book a migration call" side door for 100+ seats. Job: turn intent into a signup with the number already on screen.

### /features (module pages, the existing /features/* routes reorganised into the eight hubs)
Each hub page opens with the hub's beat from the replacement map (same component, unpinned, autoplay once): the tiles it absorbs, its "Replaces:" line, its dot. Then three real surfaces with one sentence each, a "Connected to" strip (the hubs this one links into, e.g. Goals connects to Teams via roles and to Work via KRA tasks), a "what you get on which tier" row, and the same Start free CTA. Job: prove the replacement is real for a visitor who arrived searching "Asana alternative" or "spreadsheet with forms". Existing routes for KRAs, KPIs, OKRs, Reviews, Kudos, SOPs, People, Tasks, AI stay as deep pages under their hub.

### /how-it-connects
The long-form version of home section 5: seven beats, one piece of work travelling role → SOP → task → Talk thread → table row → KPI → review, with AI appearing inside beats (an agent nudging the SOP step, a summary in Talk). Scroll-pinned on desktop, stepper on mobile, reusing the GSAP scene engine from the replacement map with different content. Ends with the anti-bundle argument ("a stack can be integrated; it cannot be connected, because each tool only knows its own objects") and both CTAs. Job: convert the sceptic who believes "all-in-one" means shallow, and give sales a page to send.

### /compare
Two families: "WorkwrK vs Monday / ClickUp / Workday" (nominative use, factual rows, no logos in hero) and "WorkwrK vs your stack" (the receipt again, landing from ads). Job: capture bottom-funnel search.

### /customers
The Mohsin story as the first case study (with permission), later the metric cards. Job: proof depot for section 8 and sales.

### /demo
Two-minute product video (modal from home) plus the booking form (five fields max, seat count included so routing is automatic). Job: the side door.

---

## 4. Motion choreography and the stack

### 4.1 Choreography, section by section
| Section | Motion | Engine | Mobile / reduced motion |
|---|---|---|---|
| 1 Hero | Tiles spring to rail slots, counter tween, slab scale-in, hub pulse, 2deg pointer tilt | Motion v12 (`animate`, springs, `useMotionValue` for the counter), CSS 3D transforms for the slab | Final state static; tiles rendered in their absorbed positions; counter shows 1 |
| 2 Proof | Type reveals only | CSS `animation-timeline: view()` for fade-up, gated by `@supports` | Same, or none |
| 3 Stack tax | Dashed lines draw, then the blue line draws | SVG `stroke-dashoffset` driven by CSS scroll timeline; Motion fallback | Static lines |
| 4 Replacement map | Pin, scrub, snap over nine beats; surfaces cross-fade; tiles absorbed per beat | GSAP 3 + ScrollTrigger + `useGSAP`, mounted only via `gsap.matchMedia()` at ≥1024px and `prefers-reduced-motion: no-preference` | Vertical stepper: nine stacked frames, each a static surface with its caption; `IntersectionObserver` lights the hub dot as it enters |
| 5 Thread | One blue line draws across five cards, cards fade-up in sequence | CSS scroll timeline + Motion `whileInView` (LazyMotion) | Cards stack vertically, line becomes vertical |
| 6 Receipt | Chip toggles re-run a short collapse (600ms), receipt lines animate in with `layout`, number tweens | Motion v12 layout animations | Same, shorter durations; no collapse replay, just the receipt |
| 7 Switch | Timeline draws, step cards fade | CSS scroll timeline | Same |
| 8 Adoption | Two surfaces slide in from opposite sides, 12px only | Motion `whileInView` | Fade only |
| 9 to 11 | Reveals only | CSS | Same |
| Four-dot mark | Idle drift, absorb pulse, resolve-to-logo | Rive state machine (`idle`, `absorb`, `connected`), self-hosted WASM, lazy | Static SVG mark |

Durations: micro state 120 to 180ms, reveals 250 to 400ms (marketing may exceed the app's 250ms ceiling; the brief allows it since it is a different surface, but nothing exceeds 600ms except the hero collapse, which is a 2.8s sequence by design and runs once per session).

### 4.2 Stack decision
- **Product surfaces as React components**, sharing the real shell and tokens. This is the largest single decision: it makes every visual honest, mobile-safe and cheap to update, and it is why the hero can be "3D" with zero WebGL.
- **Motion v12** (installed) with `LazyMotion` + `m` for everything component-level and for the hero physics. Convert the existing `marketing/motion.tsx` FadeIn helpers to LazyMotion.
- **CSS scroll-driven animations** for line draws and reveals (0 KB; ~85% support; Firefox gets the Motion fallback).
- **GSAP 3 + ScrollTrigger** (~30 KB gz, free) for exactly two scenes: the home replacement map and the /how-it-connects story. Loaded through a `"use client"` wrapper that `next/dynamic`-imports the scene with `ssr: false`; the captions and surfaces themselves are still SSR'd as a plain stacked list underneath so the scene's text exists in HTML before hydration.
- **Rive** for the four-dot mark only (Tier B, needs an artist; the SVG fallback ships first).
- **No R3F, no Spline, no Lenis, no Lottie in v1.** If the founder insists on literal WebGL, the only candidate is the hero slab as a single flat-shaded R3F object with `MeshBasicMaterial`, mounted after `window.load`, DPR 1.5, paused offscreen, WebP fallback. It is not required to hit "3D modules working together" because the CSS 3D slab already delivers that.

### 4.3 Performance and SEO handling (Next.js 16 App Router)
- `page.tsx` stays a Server Component. Every animated island is a separate `"use client"` file that does its own dynamic import; never dynamic-import a client component from the server page (Next 16 docs: code splitting not supported that way).
- LCP is the hero headline. Tiles and slab are DOM with explicit `aspect-ratio` and SSR positions, so CLS is 0. No canvas in the critical path.
- First-load JS budget under 200 KB gz. GSAP loads only when the map section is within 1.5 viewports, and only on ≥1024px.
- Images: any real screenshot that cannot be a component (rare) ships as WebP/AVIF via `next/image` with `sizes`.
- The receipt OG image is a `route.ts` using `ImageResponse` (`next/og`), edge runtime, cached by query string; this is what makes the share link render as a card.
- JSON-LD updated: SoftwareApplication offers in the chosen currency (Q10), FAQPage mirrored from section 10, Organization; add `Review` markup for the Mohsin quote only with permission.
- `<noscript>` and reduced-motion states are the mobile-lite composition, so a crawler sees the finished "14 → 1" state, not scattered tiles.
- Instrumentation: `data-cta` on every placement, calculator events (chips selected, seats, receipt copied), scroll-depth beats for the map. Primary metric: visit → trial signup; secondary: receipt built → signup.

---

## 5. Conversion funnel

### 5.1 Motion: trial-first, demo side door, seat-count escalation
The product is self-explanatory, sub-$10K ACV at the tiers on record, and time-to-value is same-day with templates, so trial leads (median 18% trial-to-paid, top quartile 32%+; hybrid pages convert better than pure trial). Demo is a ghost button in the nav, in the final CTA, and the escalation output of the receipt when seats exceed 100. In-product, the escalation trigger from the brief applies: when a trial user invites five or more teammates or turns on a premium module, surface "Book a migration call".

If self-serve signup is not live (founder Q11), swap primary and ghost everywhere and change "Start free" to "Book a demo"; nothing else in the architecture moves.

### 5.2 CTA frequency and placement
Eight placements plus the sticky nav/bottom bar, all one goal, one label ("Start free"), one destination (app.workwrk.com/signup with `utm_content` set from the placement id). The only variants: per-tier labels on pricing and the >100-seat escalation on the receipt. The sticky bar appears after the visitor scrolls past the hero and carries the visitor's receipt number once one exists (this is the brief's +5 to 15% sticky-bar effect with a personal reason attached).

### 5.3 Pricing presentation
Three cards, annual default with monthly toggle, USD default with currency toggle (INR retained for the existing market), a "Replaces roughly $X/seat" line on each card, premium modules listed as included-from-Growth rows rather than add-ons, "Talk to sales" only on Scale. No "Enterprise: contact us" mystery card; the receipt already told the visitor what they save, so the tiers must be legible against it.

### 5.4 Objection handling (mapped to sections)
| Objection | Where it is answered |
|---|---|
| "All-in-one means shallow" | Section 4 (real surfaces per hub), section 5 (the thread), /how-it-connects, FAQ 1 |
| "Migration will take a year" | Section 7 (quarter, one team first, switch-off schedule) |
| "Our people won't adopt another tool" | Section 8 (managers actually open it), the hero itself (the shell is readable before signup) |
| "What about the tools we keep" | FAQ 2, honest connector list |
| "Lock-in" | FAQ 4, export guarantee |
| "Is it really cheaper" | Section 6 (their own numbers, editable), section 9 |
| "Security" | FAQ 6, footer badges once true |

### 5.5 Social proof
Named quote as the trust strip (Arc's quote-as-hero applied to the strip), the same person's second sentence as section 8, honest product metrics from a live endpoint, badges only when earned, case-study page once permission is secured. Nothing fabricated, per the honesty rules on record.

---

## 6. Copy direction

Voice: plain, numerate, a little dry about subscriptions, never snide about a named competitor in a headline (category names in headlines, competitor names only on /compare and in factual rows). Short sentences. Customer vocabulary over marketer vocabulary ("managers actually open it" is better than anything a copywriter would write). No em dashes, no double hyphens; commas, colons, periods.

Five headline candidates (hero or section leads):
1. **Cancel 14 tools. Keep one.** (hero, primary)
2. **Your stack is a tax. Stop paying it.** (section 3 or paid-ad landing variant)
3. **One app for the whole company. No training, no bundle.** (hero alternate in the "[outcome] without [trade-off]" shape)
4. **Fourteen logins was never the plan.** (section 3 alternate, ad headline)
5. **Replace the stack. Keep the work.** (final CTA alternate; also the /how-it-connects sub)

Quote-as-headline option (Arc pattern), to A/B against candidate 1 once permission is in hand: **"We replaced 14 SaaS tools with WorkwrK in one quarter."**

Microcopy rules: every "Replaces:" line uses category nouns; every number on the page is either the visitor's own input, a live product metric, or a footnoted public list price; "No credit card" appears under the primary button everywhere, never in the button.

---

## 7. The crazy factor: the collapse that prints a receipt

The single shareable moment is **section 6**: the visitor taps the tools they pay for, watches those tiles physically collapse into the WorkwrK slab (the same 3D collapse as the hero, now personalised), and a receipt prints with their tools struck through, one line left, and the number they keep every month, signed "14 → 1". **Copy my receipt** yields a link whose OG image is that receipt, so the thing people post to LinkedIn is their own before/after with WorkwrK's name on the only remaining line. The hero teaches the gesture, the receipt makes it personal, the share makes it travel. It is also the single most measurable section on the site.

---

## 8. On-brand, and where boldness is spent

- **Blue is the only fill.** Start free, links, the connection thread, the active rail pill, the recommended tier's 1px border. **[TOKENS: accent.solid / solidHover / focus ring per the token spec.]**
- **The "before" is grey.** Tool tiles, dashed lines, struck-through receipt lines are all neutrals. Nothing red is used for "cancelled"; cancellation is shown by absorption and strike-through in N400, so red keeps its semantic meaning (blocked / overdue) inside product surfaces only.
- **YBRG appears only as the four dots.** One dot per hub on the rail, the pulse on absorption, the resolve-to-logo at the end of the map and in the final CTA. No YBRG section backgrounds, no gradients, no mixed-colour headlines. One tint stage (blue-50) for the map.
- **Flat.** 1px borders, soft radii, shadows only on the slab's edge (a single 1px darker edge to sell the 3D, not a drop shadow) and on the receipt card.
- **No purple, no dark sections, no mascots.** The tiles carry glyphs, not illustrations.
- **Type does the shouting.** Display sizes 48 to 72, one weight, tight leading, white page. **[TOKENS: marketing display scale and the chosen family, Inter or Figtree, plug in here.]**

Boldness budget (four bets): the hero collapse, the pinned replacement map, the receipt, and the "14 → 1" mark. Everything else is quiet on purpose so those four land.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Competitor pricing and logos** (legal, accuracy) | Category tiles, not logos, everywhere except /compare (nominative use, factual). Receipt prices are dated public list mid-points, footnoted, editable, and reviewed quarterly; store them in one JSON with a `asOf` date. |
| **Fabricated-looking numbers** contradict the honesty rule | Every number is the visitor's input, a live metric, or footnoted. The hero's default stack total is labelled "typical 14-tool stack, 50 seats, list prices" and links to the footnote. |
| **Single-source proof** (one quote) | Get written permission and a full name or company for Mohsin; until then keep the current attribution exactly as on the login page. Do not add second quotes until they exist. |
| **Performance**: 14 animated DOM tiles plus a pinned scene | Transform and opacity only, `will-change` on tiles during the sequence then removed, the collapse runs once per session, GSAP only ≥1024px and only near the section, budget checks in CI (Lighthouse LCP < 2.5s, INP < 200ms, first-load JS < 200 KB gz). |
| **Mobile is ~83% of visits** | Design the stepper version of the map and the receipt on a 390px canvas first; hero on mobile shows the final state with a tap-to-replay; bottom sticky bar 48px. |
| **Accessibility** | Reduced motion renders final states; chips are real buttons with `aria-pressed`; the counter is `aria-live="polite"` and updates once at the end, not per tick; the pinned scene has a skip link and its content exists as a plain list in the DOM; contrast per token spec. |
| **"All-in-one is shallow" scepticism** | Each hub's beat shows a real, non-trivial surface (formula bar, SOP acknowledgement, huddle chip, AI verdict with evidence); the module pages go deeper; premium modules are labelled with their tier. |
| **Importers are not built** (ClickUp/Asana/Trello/Monday are planned) | Section 7 names CSV only until importers ship; the switch-off schedule template is a Table, which exists. |
| **Positioning and currency undecided** (Q10) | Copy is currency-agnostic; the receipt and tiers read from one pricing source with a currency toggle; JSON-LD is generated from the same source. |
| **Trial readiness** (Q11) | The funnel flips primary/ghost with one config flag; no layout changes. |
| **Build effort** | Estimate: hero + tiles 1 week, shell-as-components reuse 1 week (mostly exists), map scene 1.5 weeks, thread + switch + adoption 1 week, receipt + OG route + pricing source 1 week, pages (/pricing, 8 hub pages, /how-it-connects, /compare) 1.5 weeks, QA/perf/a11y 1 week. Roughly 7 to 8 engineer-weeks with no new heavy dependencies beyond GSAP; Rive mark is a parallel design task. |
| **Protected product screens** (ClickUp-parity mandate) | The site renders existing surfaces; it does not invent new product UI. Any surface shown is confirmed with the founder against the list in section 2.4. |

---

## 10. Build order (so the story can ship in slices)
1. Pricing source JSON (tiers, currencies, category list prices with `asOf`) and the receipt OG route.
2. Shell-as-components package for marketing (rail, sidebar, top bar, list view, doc, goal, table, talk thread), tokenised.
3. Hero collapse (Motion, CSS 3D) with static fallback; nav and sticky bar; sections 2, 3, 9, 10, 11. Ship: the site already tells the story.
4. Receipt calculator (section 6) and /pricing. Ship: the crazy factor is live.
5. Replacement map (GSAP, mobile stepper first) and section 5 thread; /how-it-connects.
6. Hub pages, /compare, /customers, Rive mark.
