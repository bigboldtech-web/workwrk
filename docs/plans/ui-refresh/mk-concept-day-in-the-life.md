# workwrk.com concept: "A Day in the Life" (One Tuesday, One Task, One App)

Creative direction proposal, 2026-09-10. Scope: the public marketing site (Home, Pricing, Product/module pages, How it connects). The visual token system (exact colours, type family, spacing) is decided separately; this document designs the story, the structure, the motion, and the funnel, and marks every place where the token system plugs in with the tag [TOKENS].

Inputs honoured: marketing-references.md (product-is-the-demo, single conversion goal, trial-first with a demo side door, Tier A/B/C motion stack, no Spline hero, no dark sections), phase2-inputs.md (YBRG only as the four dots, blue #0073EA as the only fill, Monday-clean, 14px body, no em dashes, honesty rules, mobile stepper first), existing-direction.md (PPMS positioning, Roles to KRAs to KPIs to Goals as the differentiator, SOP center, Talk, Tables, Planner, AI door budget, "a surface exists only if its backend is wired").

---

## 0. The idea in one paragraph

The whole site is one workday. A visitor lands at 8:47 AM on a manager's screen and scrolls through Tuesday. At 9:02 a client signs; a form submission lands as a row in a table; the "Client onboarding" SOP creates one task, owned by a role rather than a name; that task rides with the visitor through the board, a Talk thread where a decision gets made, a contract doc, a 2:00 PM "Blocked" moment that the system unblocks, a KPI that ticks at 4:45, a goal that answers "on track?", and a kudos at 6:02 that lands in the owner's review as evidence against her KRA. One task card is the only object that persists across the page; it collects a trail as it goes. At the end of the day the four dots it earned along the way (Yellow at the SOP, Blue at the board, Red at the block, Green at the goal) snap into the WorkwrK logo, and the visitor sees the "work receipt": every connection that one task made in one day. Then the trial starts with that exact workspace. The story you scrolled is the template you get.

Why this angle wins for WorkwrK specifically: the product's differentiator is invisible in a screenshot. "People connect to processes connect to work connect to goals" is a sentence a buyer nods at and forgets. A day is the only container where that connection is felt rather than explained, because every buyer has lived the bad version of this exact Tuesday across 14 tabs. The empathy is the conversion mechanism: the visitor recognises their own team in the cast, and the outcome ("at 6:02 the manager knows if the quarter is on track without asking anyone") is the promise.

---

## 1. The hero: 8:47 AM

### 1.1 Headline direction

Shape: outcome without trade-off, in the voice of a workday, present tense.

Primary recommendation:

> **One app. The whole workday.**
> WorkwrK connects your people, your processes, your work and your goals, so every task knows which SOP created it and which goal it moves. Replace the tab pile. Train nobody.

Alternates tested against the "five-second test" (what is it, who is it for, what do I do next):

1. "Every task knows why it exists." (the connection thread, most distinctive, slightly abstract)
2. "The work app your managers will actually open." (borrowed straight from the real customer quote; outcome plus the Workday objection in one line)
3. "From SOP to task to goal. No tabs in between." (the mechanism, literal)
4. "Your team's Tuesday, in one place." (the story frame; pairs with the clock)
5. "Run the company from one screen. No training required." (the phase2 default, safe)

Recommendation: ship 1 as the hero eyebrow line ("Every task knows why it exists") and "One app. The whole workday." as the H1; A/B 2 against it after launch since it is customer-sourced vocabulary, which the conversion research says outperforms marketer copy.

Sub-line microcopy under the CTAs: "Free for 14 days. No credit card. Cancel anytime." Only include an import claim ("Import from ClickUp/Monday") when the competitor importers actually ship; today they are on the unbuilt list, so the microcopy stays silent on it. [TRUTH GATE]

CTAs: one blue "Start free" (fill, the only filled button on the page), one text link "Watch the day in 60 seconds" (opens a modal that plays the story scene as an 8-second loop, then a 60-second narrated cut). No third CTA in the hero; "Book a demo" lives in the nav as a ghost button and in the final block.

### 1.2 The 3D / interactive idea: the tilted desk

The hero visual is the real WorkwrK shell (rail, secondary sidebar, top bar, content) rendered as React components, sitting on a shallow CSS 3D stage: `perspective: 1400px`, the shell rotated `rotateX(6deg) rotateY(-8deg)` so it reads as a desk seen slightly from above, with a flat 1px border and no shadow (flat brand). It shows the Work hub on My work (the Q7 default landing surface), buckets Overdue / Today / This week, the manager's morning. In the top-right corner of the stage sits a small clock: **8:47 AM**. The clock is the page's narrator.

This is "3D modules of the system working together" done in a way that keeps the brand flat and the UI real: panels are DOM, not meshes, so text stays crisp, selectable, indexable, and every surface is the actual product. Depth is a camera move, never a material.

### 1.3 The first five seconds (a timeline)

| t | What happens | Why |
|---|---|---|
| 0.0s | H1, sub-line, CTAs and the stage frame paint as server-rendered HTML. The shell is present in the DOM at its resting tilt, static. LCP is the H1. | Utsubo/Vercel rule: ship HTML, never an empty canvas. |
| 0.3s | The four dots (the existing DotsLoader bounce) settle into the logo in the nav. One beat, 400ms. | The signature motif is introduced without a canvas. |
| 0.8s | The stage eases from `rotateX(10deg)` to `rotateX(6deg)`, 600ms ease-out, one time only. | A breath of depth so the visitor registers "this is a space". Transform only; no layout. |
| 1.4s | The clock ticks 8:47 → 8:48. A new row slides into the Today bucket: **"Onboard Bluefin Foods"**, with three tiny link glyphs on the right (SOP, KPI, role). A blue hairline draws from the row to a caption outside the stage: "Created by SOP: Client onboarding, step 3. Owner: Onboarding lead. Moves: Onboarding cycle time." | The differentiator is visible in the first two seconds: a task with provenance. |
| 2.4s | A cursor-less hover affordance: the row glows the selected-row tint on a 2s cycle until the visitor interacts. Hovering (tap on mobile) the row highlights its three links with blue connectors. | Invitation to touch. Attio-style micro-interaction. |
| 3.5s | Under the stage, one line in the secondary text colour: "It's 8:48. A client is about to sign. Scroll to see Tuesday happen." with a 16px down-chevron that nudges once. | The scroll prompt is the story's first line, not a UI hint. |
| 5.0s | Nothing else moves. The page waits. | Vercel novelty mapping: earn attention, do not spend it. |

Reduced motion: steps 0.8 and 1.4 play as an instant final state; the caption line reads "Scroll to see Tuesday happen." Mobile: tilt removed (`rotate 0`), the shell becomes a 16:10 static composition of the same surface with the same row and connectors, still DOM.

[TOKENS] the stage tint, the selected-row tint, the connector blue, display size for the H1 (48 on mobile, 72 on desktop at one weight), the clock's mono face if a mono family is in the system.

---

## 2. Page architecture: HOME

One conversion goal (Start free), repeated six times plus a sticky bar. Every section is listed with: its job, its content, the real product surface it shows, and its CTA. Sections marked CALM are low-novelty interludes so the one high-novelty scene is never followed by another.

### Section 0. Nav (sticky, 56px desktop, 48px mobile)

- Job: orientation and the always-available primary CTA.
- Content: logo (four dots between the k's), links: Product (mega-menu of the 8 modules, each with one line and one dot), How it connects, Pricing, Customers (hidden until real customers exist), Log in.
- CTA: blue "Start free" + ghost "Book a demo".
- Behaviour: transparent on the hero, white with a 1px bottom border after 80px of scroll. On mobile the CTA moves to a bottom sticky bar (48px) that appears once the hero leaves the viewport.

### Section 1. Hero: "8:47 AM" (see part 1)

- Surface: Work › My work (date-bucketed).
- CTA: Start free (primary), Watch the day in 60 seconds (text link).

### Section 2. Trust line (CALM)

- Job: answer "can I trust you" before the story asks for two minutes of attention.
- Content: one row, three items. (a) The real customer line, verbatim from the login page: "We replaced 14 SaaS tools with WorkwrK in one quarter. Our managers actually open the app now. That didn't happen with Workday." with the attribution the customer has approved (role and company size at minimum; logo if permitted). (b) Honest product metrics that the database can prove (workspaces, tasks completed this month, countries), rendered from a build-time query, never typed by hand. (c) G2 / Product Hunt badge slots, empty and hidden until they exist. [TRUTH GATE]
- Surface: none.
- CTA: none. This section exists to lower the guard, not to sell.

### Section 3. "The old Tuesday" (problem, one screen) (CALM, grey)

- Job: make the visitor feel the 14-tab day before they see the one-app day.
- Content: a browser tab strip with 14 grey, unnamed tabs (favicons blurred to grey squares, no competitor logos), and under it a timeline in grey type:
  - 9:02 The deal closes in the CRM.
  - 9:15 Someone remembers the onboarding checklist lives in a wiki nobody updated.
  - 9:40 A task is created in the PM tool. Wrong owner.
  - 11:00 A chat thread makes a decision. The task never hears about it.
  - 2:00 It's blocked. Nobody knows who unblocks it.
  - 4:30 The goals spreadsheet is still last month's.
  - Friday, 5:15 "Are we on track?" Nobody can answer without a meeting.
- Then one line in body text: "Same client. Same team. Same Tuesday. Watch it happen in one app."
- Surface: none (abstract nodes only ever depict the problem, never the solution).
- CTA: none. The scroll is the CTA.

### Section 4. THE STORY: "Tuesday, in one app" (the single high-novelty scene)

This is the signature. Pinned on desktop, scrubbed by scroll, snapped per beat; a vertical stepper on mobile (designed first). The stage is the one light-blue tint block on the page (`#E6F2FD` or the token that replaces it). [TOKENS]

The persistent object is **the task card** "Onboard Bluefin Foods". It is born in beat 2, and from then on it is the only element that moves between beats (GSAP Flip between named slots inside each surface). Each beat adds one line to its trail. Each beat has a clock time, one real surface, one sentence of narration, and (four times in the day) one dot.

Cast (illustrative, consistently labelled as the "Tuesday workspace" that ships as a trial template, so nothing is presented as a customer record): Maya, Operations lead (the manager; the visitor's proxy). Sam, Onboarding lead (task owner). Priya, Finance. Bluefin Foods, the new client. [TRUTH GATE: the persona is a template, not a testimonial; say so in 12px under the stage: "The Tuesday workspace is a template. It's yours on day one."]

| Beat | Clock | Module (rail hub) | What the visitor sees (real surface) | Narration line (one sentence, present tense) | Trail line added to the card | Dot |
|---|---|---|---|---|---|---|
| 1 | 9:02 | Tables (Forms) | A form submission ("Bluefin Foods, Signed, Annual, weekly reporting") lands as a new row in the Clients table. Letter headers, Google-Sheets-plain, one row highlights. | "A client signs. The form writes the row. Nobody retypes anything." | "9:02 Row 41 in Clients" | none |
| 2 | 9:03 | Docs (SOPs) | The SOP "Client onboarding v4", step 3 "Kick off internal onboarding". The camera moves from the table to the SOP page. A task template attached to the step spawns the task: title, checklist (7 items), due in 10 days (the SOP's SLA), owner = the Onboarding lead role, which resolves to Sam. | "The process creates the task. The role picks the owner. Sam didn't need to be told." | "9:03 Born from SOP step 3 · Owner by role" | **Yellow** (attention: an SOP step is live) |
| 3 | 9:04 | Work | The task card flies (Flip) into the Onboarding board, list view, "This week" group; then the camera pulls back to show it also sitting in Sam's My work › Today. Fields visible: Status "To do", Due, Linked SOP, Linked KPI "Onboarding cycle time". | "One task, two places, zero copies. Sam's morning already knows." | "9:04 Onboarding board · Sam's Today" | **Blue** (action) |
| 4 | 10:30 | Talk | Channel #onboarding, split view. Sam: "Bluefin wants weekly reporting, not monthly. Does that change the contract?" A short thread; Maya replies; the Sidekick summary pins one line to the task: "Decision: weekly reporting, contract addendum needed." A new checklist item appears on the card. | "The decision happens in chat and lands on the task, not in someone's memory." | "10:30 Decision from #onboarding" | none |
| 5 | 11:15 | Docs (Contracts) | The contract doc created from the template, v2, "Reporting cadence" clause highlighted; the Policy "Client reporting" linked in the right rail; the doc attaches to the task. | "The contract, the policy it follows, and the task it belongs to are one click apart." | "11:15 Contract v2 attached" | none |
| 6 | 2:00 → 2:30 | Work + Planner (+ Automation) | Status flips to "Blocked: finance sign-off". The card's status chip goes to the danger token. An automation rule (status changed → notify role owner) pings Priya; a 15-minute huddle appears in Planner at 2:15; the timer shows 2h 10m logged on the task; at 2:30 status flips to "In progress". The red dot appears at 2:00 and is retired into the trail at 2:30. | "It gets blocked. The system knows who unblocks it. It takes a 15-minute huddle, not a day." | "2:00 Blocked · 2:15 Huddle w/ Finance · 2:30 Unblocked · 2h 10m logged" | **Red** (blocked, then resolved) |
| 7 | 4:45 | Goals | KPI "Onboarding cycle time" records a new value; the goal "Onboard every client in 10 days" progress ring moves 61% → 64%; the "On track?" verdict reads: "On track. 3 of 4 onboardings this month inside SLA. Bluefin projected day 8." | "The goal moves because the work moved. Nobody updated a spreadsheet." | "4:45 KPI +1 · Goal 64% · On track" | **Green** (goal, done) |
| 8 | 6:02 | Teams | Maya's evening: My work is clear. She sends Sam a Kudos tagged to the company value "Own it"; it lands in Sam's review timeline as evidence against the KRA "Client onboarding runs on time (30%)". The camera pulls all the way back: all eight surfaces visible at once as small tilted panels, connected by blue hairlines to the card in the centre. The four collected dots leave the card and snap into the WorkwrK wordmark. The card renders as the **work receipt** (see part 6). | "At 6:02 the manager knows the quarter is on track. She didn't ask anyone." | "6:02 Kudos · Evidence for KRA" | (all four resolve into the logo) |

Under the stage, after beat 8 (the page unpins): a single centred CTA block, the second placement:

> **Start Tuesday in your workspace.** The Tuesday workspace (the SOP, the board, the goal, the roles) is a template on your first screen.
> [Start free] "No credit card."

Deep link: `app.workwrk.com/signup?template=tuesday`. The story is the onboarding.

Truth gates for the beats (every surface must be wired; verify each before storyboarding; where a beat's mechanism is not shipped, the fallback below keeps the beat honest):
- Beat 1: Forms → Table row. Forms exist under Tables; confirm a form submission creates a row. Fallback: Sam enters the row from the signed deal (still honest, weaker).
- Beat 2: SOP step spawning a task. SOP run-execution is listed as deferred. Fallback (fully shipped today): Task Types with LINKED_SOP + a Task Template from Template Center with the checklist; the narration becomes "Sam applies the onboarding template; the SOP and KPI come with it." Owner-by-role depends on the Operating Core RoleInstance being live; fallback is direct assignment.
- Beat 4: Sidekick summary pinned to a task. Confirm; fallback is a human "Decision:" comment linked to the task via the Talk → task link.
- Beat 6: Automation "status changed → notify". Only 5 of 16 triggers fire today; confirm status change is one of them. Timer and huddle are shipped (TimerSession, huddles).
- Beat 7: "On track?" AI verdict. Listed as a Goals feature; confirm the surface.
- Beat 8: Kudos tied to values (shipped 6187227a), evidence on review timeline (confirm the KRA link).

### Section 5. "Everything Sam touched today" (the module tour) (CALM)

- Job: let the visitor who wants a feature list get one, framed by the story so it never reads as a 100-feature wall.
- Content: eight tabs in rail order (Work, Planner, AI, Talk, Teams, Docs, Tables, and Goals, which is folded under Work in the product but earns its own tab here because it is the outcome). Each tab: one real surface at rest (flat, no tilt), one sentence of what it did in the story, a "Replaces:" line (Work replaces ClickUp/Asana/Trello; Docs replaces Notion/Confluence/Google Docs for SOPs; Talk replaces Slack for internal chat and calls; Tables replaces Sheets/Airtable for operational data; Goals replaces the OKR spreadsheet and Lattice-style goals; Teams replaces the HR directory, review tool and pulse-survey tool; Planner replaces the shared calendar and timesheet tool; AI replaces the "ask three people" step), and a text link "See Work in detail" to the module page.
- Surface: one per tab, the same surfaces as the story so nothing new has to be built.
- CTA: none inside the tabs; the sticky bar carries it.

### Section 6. "How it connects" (the spine, small) (CALM)

- Job: give the analytical buyer the model in one diagram, using the story's entities, and route them to the deeper page.
- Content: four columns joined by blue hairlines: **People** (Role: Onboarding lead · KRA: Client onboarding runs on time, 30%) → **Process** (SOP: Client onboarding v4 · Automation: blocked → notify) → **Work** (Task: Onboard Bluefin Foods · Board: Onboarding · Contract v2 · #onboarding thread) → **Goals** (KPI: Onboarding cycle time · Goal: 10-day onboarding, 64%, on track). Each node is the real entity chip from the product (EntityTile + label), not an abstract circle. Hovering a node highlights its edges.
- Surface: entity chips only.
- CTA: text link "See how it connects" → /how-it-connects.

### Section 7. "You're in this story" (roles) (CALM)

- Job: the empathy beat. The visitor identifies their seat and sees their own Tuesday.
- Content: five cards, each a person's Home at 8:47: Founder / COO ("Is the quarter on track?" → Company goals + team KPIs), Operations manager (Maya's My work + the Onboarding board), People / HR lead (Teams: reviews due, survey results, org chart), Team lead (Team goals rollup + workload), Individual contributor (Sam's Today + one SOP). Each card is a real, smaller shell composition with one line: "Your Tuesday: ..." and what the day ends with.
- Surface: five Home compositions.
- CTA: after the cards, third placement: "Start free" (primary only, inline).

### Section 8. Proof (built only from real material) (CALM)

- Job: someone else already lived this Tuesday.
- Content: the long form of the real quote, set large (display size) with the attribution, plus up to three metric cards that the customer has stated (today only "14 tools → 1 in one quarter" is real; "managers open the app" is qualitative and belongs in the quote, not a number). Placeholder slots for two more named customers stay hidden until real. [TRUTH GATE]
- Surface: none.
- CTA: none (the block after it carries one).

### Section 9. How it works, three steps (CALM)

- Job: the "no training" promise made concrete, and the bridge to the trial.
- Content: 1. Invite your team (a People import from CSV or Google Workspace, if wired). 2. Pick a starting workspace ("Tuesday: client onboarding" is the first tile; others: Hiring, Product launch, Monthly close, Field service). 3. Work. It connects itself. Each step is a small real surface (the invite modal, the Template Center grid, My work).
- Surface: three modals/pages.
- CTA: fourth placement, "Start free".

### Section 10. Pricing preview

- Job: answer "is it worth it" without leaving the page.
- Content: three cards, monthly / annual pill (annual default), per-seat USD with a local-currency toggle (Q10 default), one line each of who it is for, five bullets max, a "Replaces" list per tier, and the "Tab pile calculator": a one-input control ("How many tools does your team pay for today?" default 8) that prints "Roughly $X per seat per month across those tools" from a conservative public-list-price table, next to the WorkwrK price. Only tiers and prices that exist in billing. Talk and Tables shown as modules toggled per tier (module packaging is real).
- CTA: per tier: "Start free" on the first two tiers, "Talk to sales" on the top tier only (Front's pattern). Fifth placement.

### Section 11. Objections: FAQ + security + migration (CALM)

- Job: remove the last reasons to close the tab.
- Content: seven questions mirrored into the existing FAQPage JSON-LD: Do we have to move everything at once? (no; modules toggle), We already use ClickUp/Monday, why switch? (the connection story in two sentences), Do managers need training? (the site was the training), Is it an HR system / payroll? (People and performance yes; payroll and benefits through partners), Where is our data hosted and who can see it? (regions, roles, audit), What happens after the trial? (plan choice; workspace kept), Can we bring our data? (CSV today; competitor importers when shipped). Security badge row (SOC 2 / GDPR) shows only badges that are true; before that, a plain "Security" text link. "Cancel anytime" line.
- Surface: none.
- CTA: none.

### Section 12. The close: "It's 8:47 somewhere."

- Job: the sixth placement, with the story's emotional residue.
- Content: display headline "It's 8:47 somewhere. Start the day in one app." The four dots, large, resting between the k's of the wordmark; the small clock from the hero now reads the visitor's local time (a tiny, honest wink). Blue "Start free", ghost "Book a demo", "No credit card."
- Surface: the logo only.
- Footer: product links, module pages, How it connects, Pricing, Security, Status, Docs (documentation.ai), Log in, locale/currency switch, legal.

CTA cadence: nav, hero, after the story, after roles, pricing (per tier), close. Sticky bar past the hero (desktop 56px top, mobile 48px bottom). Six placements, one goal.

---

## 3. The other pages

### 3.1 Pricing (/pricing)

Same three cards at full detail, a comparison table (rows are the eight modules plus governance items: roles, KRAs, reviews, SOP publishing, audit log), the tab-pile calculator at full width, module add-on rows (Talk, Tables), an FAQ subset about billing, and the demo side door pinned to the top tier: "For teams over 50, we'll set up your Tuesday with you" → Book a demo. The page ends with the same close as Home. No story scene here; pricing pages should be quiet.

### 3.2 Product / module pages (/product/work, /product/docs, /product/talk, /product/tables, /product/goals, /product/teams, /product/planner, /product/ai)

Each module page is that module's chapter of the same Tuesday. The universe is consistent: the same cast, the same client, the same clock. Structure per page:
1. Hero: the module's surface, flat, with the clock at that module's beat time (Talk's page opens at 10:30 with the #onboarding thread). Headline in the module's voice ("Talk: the decision lands on the task.").
2. "What happened at [time]": the beat from Home expanded to three or four sub-moments with real surfaces (Talk: the thread, the Sidekick summary, the huddle, the call dock).
3. "What it connects to": the spine diagram with only that module's edges lit.
4. Feature list in plain rows (name, one line, honest "Coming soon" hidden by default behind "Show upcoming features", per the Q15 default).
5. Replaces line, proof slot, the close.
The AI page is the exception: it has no single beat, so it shows the three moments AI appeared in the day (Sidekick summary at 10:30, the notify automation at 2:00, the on-track verdict at 4:45) and states the AI door policy plainly: "One Ask on every page. Not a chatbot on every button."

### 3.3 How it connects (/how-it-connects)

The page for the buyer who needs the model before they trust the story. It is the spine at full size: People (Roles, KRAs, KPIs, reporting line) → Process (SOPs, policies, task templates, automations) → Work (spaces, boards, tasks, docs, tables, threads) → Goals (OKRs, KPI rollups, on-track verdicts, reviews). Interactive: click any entity node and the right pane shows its real surface and the edges it owns. A second block, "Why one system, not integrations": three short paragraphs, no diagram (integrations are demand-driven; the site never promises connectors that are not built). Third block: the governance layer for admins (roles, permissions, scoped visibility, audit). Ends with the close. This page also hosts the JSON-LD for the "connected work OS" positioning.

### 3.4 /tuesday (shareable)

A standalone page with only the story scene (Section 4), the receipt, and one CTA. It exists so the scene has a clean URL to share on LinkedIn and in sales emails, and it gets its own OG image (the receipt). Same code, one route.

---

## 4. Scroll and motion choreography, and the stack

### 4.1 The rule

Motion has a director, and the director is the clock. Every animated thing on the page is either (a) the clock advancing, (b) the card moving to where the clock says it is, or (c) a surface responding to the card. Nothing animates for decoration. Sections 2, 3, 5 to 12 use at most a 180ms fade-and-rise on entry (`whileInView`, once), and hover states are colour and border only (the existing no-hover-transform rule extends to marketing).

### 4.2 The story scene, desktop (pinned)

- Container: a `position: sticky` stage of `100vh` inside a scroll track of `8 × 100vh` (one viewport of scroll per beat). GSAP ScrollTrigger pins the stage, `scrub: 0.6`, `snap: { snapTo: 1/7, duration: 0.4, ease: "power1.inOut" }` so a release always lands on a beat.
- Camera: the stage holds a single `.stage` element with `perspective: 1400px` and a `.world` child that receives `translate3d` and `rotateX/rotateY` per beat. The eight surfaces are laid out in that world at fixed positions (a loose arc, each panel at most 10deg from flat so text stays legible). Moving between beats is a camera move of the world, not a re-layout of panels; GSAP tweens `x, y, z, rotateX, rotateY` on `.world` only.
- Visibility budget: only the current beat's panel and its neighbours (previous and next) are rendered with full fidelity; the others are `visibility: hidden` and `content-visibility: auto` until they are within one beat. That keeps compositor layers under five at any time.
- The card: a single DOM node, `position: absolute` inside `.world`, moved with GSAP Flip between named slots (`[data-slot="board-row"]`, `[data-slot="talk-pinned"]`, ...) at each beat's midpoint. Its trail list grows by one line per beat with a 120ms height animation.
- The clock: a text node driven by the scrub progress, mapped piecewise through the beat times (9:02, 9:03, 9:04, 10:30, 11:15, 2:00, 4:45, 6:02) so the minutes appear to advance continuously between beats. On the right edge of the stage, a vertical beat rail (eight ticks with times) doubles as navigation: clicking a tick scrolls to that beat (keyboard accessible).
- The dots: four small circles that appear on the card at beats 2, 3, 6 and 7 (Yellow, Blue, Red, Green, the brand hexes and nowhere else on the page at full saturation), and at beat 8 fly (Flip) to the wordmark. Rive is the Tier B upgrade for the dot state machine (idle / arriving / resolved); the Tier A version is SVG + GSAP and is fully adequate.
- Narration: the one-sentence line per beat sits in a fixed caption slot under the stage and cross-fades (150ms). It is also in an `aria-live="polite"` region.
- Connectors: blue hairlines between the card and the surface it is interacting with, drawn with SVG `stroke-dashoffset` (DrawSVG is free in GSAP 3.13+, or hand-rolled), 300ms.
- Exit: after beat 8 the pin releases; the world eases back to flat as the section scrolls away, so the CTA block below arrives on a calm surface.

### 4.3 The story scene, mobile (designed first)

No pin, no camera, no tilt. Eight stacked cards, each `min-height: 80vh`, the beat time set large (48px display) on the left edge, the surface as a flat 16:10 composition, the narration under it. The task card is repeated inside each beat with its trail so far (the "moving object" becomes "the same object, growing"). The clock lives in the sticky bottom CTA bar as a 12px label that updates by IntersectionObserver as beats enter. Dots appear in place on the card; at beat 8 they animate 400ms into the wordmark rendered inside that beat. This is the version 83% of visitors will see; it has to stand on its own with zero JS (it does: the stepper is plain HTML/CSS; JS only adds the clock label and the dot hop).

### 4.4 Everything else

- Hero: the tilt settle and the row arrival are Motion v12 (`LazyMotion` + `m`), transform and opacity only. The hover connectors are CSS.
- Section 3 timeline rows: CSS scroll-driven `animation-timeline: view()` fade-in, gated by `@supports` and `prefers-reduced-motion`; Firefox gets the static state.
- Module tabs (Section 5) and role cards (7): Motion `layout` and `AnimatePresence`, 200ms.
- Spine diagram (6): SVG edges with hover highlight, CSS only.
- Close (12): the local-time clock is one `Date` read on the client after hydration, rendered as text; no ticking.
- Watch-the-day modal: an MP4/WebM export of the desktop scene (the 8-second loop) rendered once from the real scene with a headless browser at build time, so the video and the live scene never drift. Lazy-loaded on click.

### 4.5 Stack decision (from the reference options)

| Layer | Choice | Why, and why not the alternative |
|---|---|---|
| Product surfaces | React components from the product's own primitives (EntityTile, StatusChip, ViewTab, MenuItem, the shell), fed by a static "Tuesday" fixture, rendered in the marketing bundle behind a thin `MarketingShell` wrapper | The only way the UI is honest, theme-safe, and free to update when the product changes. Screenshots go stale; components do not. |
| 3D | CSS 3D transforms (perspective + rotate on a world container) | Gives the "modules in space working together" feel with zero bytes, real text, real focus order. React Three Fiber would force the surfaces into textures (blurry text, no selection, 170 KB gz of three.js). Spline is the same problem with a heavier runtime. |
| Pinned story | GSAP 3 + ScrollTrigger + Flip + `@gsap/react` useGSAP, loaded through `next/dynamic({ ssr: false })` inside a `"use client"` wrapper (`story-scene.client.tsx`), only on `(min-width: 1024px)` and `prefers-reduced-motion: no-preference`, after the hero is visible | Pin, scrub, snap and shared-element Flip are exactly what Motion's useScroll does not do. ~30 KB gz, free since April 2025. Mobile never downloads it. |
| Component and scroll-linked motion | Motion v12 with LazyMotion (~4.6 KB) | Already installed as framer-motion ^12.38; switch the existing FadeIn helpers to `m` components. |
| Zero-JS reveals | CSS scroll-driven animations | Compositor thread, no bundle. |
| The four-dot mark | Tier A: SVG + GSAP. Tier B: Rive state machine, self-hosted WASM under /public, preloaded, lazy-mounted | Rive is an upgrade, not a dependency; the concept ships without it. |
| Optional literal 3D | Tier C: one R3F object at the close (four flat MeshBasicMaterial spheres settling into the wordmark), loaded after `window.load`, DPR 1.5, paused offscreen, WebP fallback | Only if the founder wants a physical object somewhere; it is the last section so it never touches LCP. Not required. |
| Video | Only in the Watch-the-day modal | Never the hero. |
| Not used | Spline, Lenis, Lottie, dark sections, canvas image sequences | Per the references: LCP threat, INP threat, CPU threat, wrong brand signal, and unnecessary when surfaces are DOM. |

### 4.6 Performance and SEO handling on Next.js 16 App Router

- `page.tsx` stays a Server Component. All copy (H1, narration lines, beat captions, FAQ answers, pricing) is server-rendered HTML. The story's eight beats render as a semantic ordered list (`<ol>` of `<section>`s with headings "9:02 A client signs") that the desktop scene enhances; crawlers and reduced-motion users get the list.
- Client islands: `hero-stage.client.tsx` (Motion, tiny), `story-scene.client.tsx` (dynamic import of GSAP, gated by media queries, loading fallback = the mobile stepper), `pricing-calculator.client.tsx`, `watch-modal.client.tsx`. Each does its own `next/dynamic` inside a client file, per the Next 16 rule that `ssr:false` is only legal in Client Components and that server → client dynamic imports do not code-split.
- LCP: the H1. The hero shell reserves its box with `aspect-ratio` and renders as DOM (no image decode). Fonts: one family, `next/font` with `display: swap` and a preloaded subset; no seven-family load.
- CLS 0: every stage, tab panel and calculator reserves height; the story track's `8 × 100vh` height is set in CSS before JS runs.
- INP: transforms and opacity only; `will-change: transform` applied to `.world` only while the pin is active (ScrollTrigger `onToggle`), removed after; no scroll-linked layout reads; the calculator debounces input.
- Below the fold: `content-visibility: auto` with `contain-intrinsic-size` on sections 5 to 12.
- Budget: first-load JS under 200 KB gz before the GSAP island; GSAP island ≤ 40 KB gz; total image weight of fallbacks ≤ 600 KB (WebP, AVIF where supported).
- Offscreen discipline: ScrollTrigger kills the scrub outside the story track; the hero's hover cycle stops when the hero is out of view (IntersectionObserver).
- SEO: keep and update the JSON-LD (WebSite, SoftwareApplication with the real USD offers, Organization, FAQPage mirrored to the DOM FAQ); add `BreadcrumbList` on module pages; `/tuesday` gets `og:image` of the receipt and `og:video` of the loop; module pages target "[module] for [use]" queries with the story's concrete nouns (client onboarding SOP, onboarding cycle time KPI), which double as long-tail content.
- Instrumentation: six CTA placements plus the sticky bar carry distinct `data-cta` ids; the story track fires beat-reached events (1 to 8) so drop-off per beat is measurable and the scene can be A/B tested against the flat stepper on desktop.

---

## 5. The conversion funnel

### 5.1 Motion: trial-first, demo side door (hybrid)

WorkwrK is self-explanatory (PM and collaboration), sub-$10K ACV at SMB, single decision maker at 50 to 150 seats: the reference framework says trial-dominant with a demo escalation. The design makes the trial cheap to start and rich on minute one:

- Primary path: Start free → signup (email + Google/Microsoft SSO, ≤ 5 fields) → workspace created from the "Tuesday" template by default (the SOP, the board, the goal, the roles, the cast as example records clearly marked "example", removable in one click) → the first screen is the same My work at 8:47 the visitor saw in the hero. Time-to-first-value target: under five minutes, because the visitor already read the UI on the site.
- Demo path (side door): "Book a demo" ghost in the nav, the top pricing tier, the FAQ ("For teams over 50 we'll build your Tuesday with you"), and the close. Demo form: name, work email, team size, "what does your Tuesday look like today?" (free text, optional). Five fields max.
- Escalation trigger inside the trial: when a workspace invites five or more teammates or toggles a premium module (Talk, Tables), Sidekick offers a 20-minute setup call. The site never begs for a demo from someone who is already trying.
- Objection interception on the pricing card: "Not sure which plan? Start free; you choose at day 14."

### 5.2 CTA frequency and placement

Six placements, one goal, one label everywhere ("Start free"), one fill colour (blue), plus the sticky bar. Secondary labels are always text links or ghost buttons: "Watch the day in 60 seconds" (hero), "Book a demo" (nav, tier 3, close), "See how it connects" (section 6). Never two filled buttons in one viewport.

### 5.3 Pricing presentation

Three tiers, annual default, per seat, USD with local currency toggle, module add-ons as visible toggles (honest: Talk and Tables are packaged modules), "Replaces" list per tier, the tab-pile calculator as the only interactive element. No "most popular" badge unless it is true from billing data; a plain "Teams of 10 to 100 usually start here" line instead.

### 5.4 Objection handling (where each objection dies)

| Objection | Where it is answered |
|---|---|
| "Another tool to learn" | Hero microcopy ("Train nobody"), Section 9 ("the site was the training"), FAQ |
| "We already have ClickUp/Monday" | Section 3 (the old Tuesday), Section 6 (the spine), FAQ, module pages' "Replaces" lines |
| "Managers won't use it" | Trust line (the real quote) and Section 7 (five Homes) |
| "Do we have to switch everything at once" | Pricing add-on toggles, FAQ ("modules toggle") |
| "Is it an HR system / payroll" | FAQ, /how-it-connects governance block |
| "Security / data" | FAQ, security badges (only when true), footer link |
| "What if we churn" | "Cancel anytime", "workspace kept after trial" |
| "Is it worth it" | The calculator, the Replaces lists, the real 14→1 quote |

### 5.5 Social proof policy

Real or absent. The one real quote is used three times at three sizes (trust line, proof block, and as an OG-image candidate). Product metrics come from a build-time query. Logo, G2 and metric slots exist in the layout, hidden until filled. No stock faces; the cast are initials-avatars from the product's own avatar component.

---

## 6. The crazy factor: the Work Receipt

The single shareable moment is the last frame of the story: at 6:02 the task card stops moving and turns into a receipt.

```
ONBOARD BLUEFIN FOODS                          Tuesday
------------------------------------------------------
09:02  Row 41 written by form            Tables
09:03  Created by SOP step 3             Docs · SOP     ●Y
       Owner by role: Onboarding lead → Sam
09:04  Onboarding board · Sam's Today    Work           ●B
10:30  Decision from #onboarding         Talk
11:15  Contract v2 attached              Docs
14:00  Blocked: finance sign-off         Work           ●R
14:15  Huddle with Priya (15 min)        Planner
14:30  Unblocked · 2h 10m logged         Planner
16:45  KPI +1 · Goal 64% · On track      Goals          ●G
18:02  Kudos "Own it" → review evidence  Teams
------------------------------------------------------
1 task · 8 modules · 0 tabs switched · 0 status meetings
```

Why it is the screenshot: it is the product's whole argument on one card, in the visitor's own vocabulary (times, names, a client), it looks like something a person made rather than a marketing graphic, and it ends on a line that is a brag ("0 tabs switched, 0 status meetings"). People screenshot receipts. Under it: "Replay Tuesday (8s)" (re-runs the scene as a loop without scrolling) and "Share this Tuesday" (copies /tuesday, whose OG image is this receipt). The four dots on the receipt's right edge are the only saturated YBRG on the page, and the moment they leave the receipt and land between the k's is the two-second GIF that the founder posts.

The receipt is also the hero of the Watch-the-day loop (it is the last frame), and the trial's first-run tour ends by showing the visitor their own empty receipt: "Your first task's receipt will appear here."

---

## 7. Staying on-brand, and where boldness is spent

### 7.1 The rules the concept obeys

- Blue `#0073EA` (or the token that replaces it) is the only fill for buttons and links; hover the single hover value; one filled button per viewport. [TOKENS]
- YBRG appears at full saturation only as the four dots, and each dot is earned once with a semantic meaning: Yellow = an SOP step is live (attention), Blue = action on the board, Red = blocked, Green = goal on track. Same mapping as the product's dot semantics. No dot is used as a background, a gradient, a headline colour or an icon tint. Status chips inside the surfaces use the product's semantic tokens (success/warning/danger), never the brand hexes; the two sets never mix, exactly as phase2 §3.3 demands.
- One tint stage for the story (the light blue tint token); white everywhere else; no dark sections; no gradients; no glass; 1px borders; no shadows except the modal and the sticky bar's hairline.
- Type: one grotesk, display 48 to 72 at one weight, tight leading; body 14; the clock and receipt in the mono face if the system has one, otherwise tabular figures of the grotesk. [TOKENS]
- Illustration language is the four dots and nothing else. No mascots, no claymation, no isometric office. Depth is a camera move on real UI.
- Copy: no em dashes, no double hyphens; commas, colons, periods.

### 7.2 Where boldness is spent (four bets, in order of cost)

1. **Time as the scroll axis.** The clock is the site's signature; timestamps set at display size ("9:02" at 96px on the mobile stepper) are the boldest typographic move on the page and cost nothing.
2. **One object that travels.** The task card is the "sell one object properly" principle applied to a work OS: a single card, lit by nothing, moving through real surfaces. The GSAP Flip choreography is the one high-novelty investment.
3. **Real UI tilted in space.** CSS 3D on DOM panels is the "3D modules working together" the founder asked for, delivered in the flat brand: no materials, no lighting, panels at ≤ 10deg. It photographs as premium because the UI is real.
4. **The receipt.** A designed artefact that is also a product feature (the task's connection trail). Boldness through honesty: it only exists because the product really links these things.

Everything else is deliberately quiet: white, type, whitespace, one blue.

---

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pinned CSS-3D DOM stage stutters on mid-range laptops (eight surfaces with hundreds of nodes each) | The one signature moment feels cheap | Visibility budget (current ± 1 beat rendered; others hidden), transforms on one `.world` node only, `will-change` only while pinned, surfaces frozen (no hover states, no live components) inside the stage, a 60 fps check on a 2020 MacBook Air and a mid-range Android before launch; fallback flag that swaps the desktop scene for the stepper if `requestAnimationFrame` cadence drops below 45 fps in the first two beats |
| Scroll-jacking accessibility (pin + snap) | Keyboard and screen-reader users trapped; reduced-motion users get a broken page | The eight beats are a semantic `<ol>` in the DOM; a "Skip the story" link precedes the stage; the beat rail is keyboard-focusable; `aria-live` narration; `prefers-reduced-motion` and `< 1024px` never load GSAP and get the stepper; snap duration short (0.4s) and cancellable by continued scroll |
| Mobile is 83% of visits and cannot pin | The primary experience is the fallback | The stepper is designed first, reviewed first, and instrumented first; the desktop scene is an enhancement layered on the same DOM; the sticky bottom CTA bar carries the clock so the narrative still has its narrator |
| Build effort: eight real surfaces as marketing-safe React components | Weeks, not days; risk of copying the product's token debt into the site | Phase the surfaces: v1 uses four live DOM surfaces (My work, board list, Talk thread, goal ring) and four static WebP captures of the real product with the DOM card overlaid; v2 swaps captures for components as the product's token migration lands. Build a `MarketingShell` wrapper that renders product primitives with a static fixture and no data hooks. Order of build: mobile stepper (week 1), hero (week 1), desktop scene with captures (week 2), pricing and pages (week 3), component swap (rolling) |
| Honesty: a beat shows a mechanism that is not wired (SOP spawns task, role-based owner, status automation, on-track verdict) | Violates the founder's own honesty rule; a trial user hits a gap the site promised away | Truth gates listed under Section 4; each beat has a shipped fallback; the storyboard is signed off against the running product, not the plan; the "Tuesday workspace" template is built and tested in a real trial before the page ships, so the story and the first-run experience are literally the same data |
| Fictional cast read as fake customers | Trust damage | The cast are always labelled as the "Tuesday workspace template"; no company logos in the story; the only customer voice on the site is the real quote; the receipt says "example" in its footer on the site (not in the shared OG image, which says "The Tuesday workspace") |
| Animation fatigue / pompous | Visitors bounce mid-story | Vercel novelty mapping: the story is the only high-novelty section; sections on either side are calm; the whole scene is eight viewports of scroll (about 20 seconds at reading pace), with a beat rail to jump; the founder's own test: "if it felt pompous or out of rhythm, don't build it" is applied per beat in review |
| GSAP + Motion on one page | Element ownership conflicts | Motion owns everything outside the story track; GSAP owns only `.world`, the card, the dots, the connectors and the clock; documented in the client wrapper |
| Two module lists disagree (rail order vs marketing tour) | Confusion | The tour uses rail order plus Goals; the mega-menu mirrors the rail exactly; module page slugs match hub keys |
| Currency and positioning still say INR / India (JSON-LD, metadata) | Wrong offers indexed | Update JSON-LD to USD offers and PPMS positioning in the same PR as the hero (Q10 default), keep the locale toggle |
| Trial not ready for sub-5-minute value (no template, no sample data) | Trial-first funnel leaks at step one | Gate the launch on the Tuesday template existing in Template Center and being applied at signup; if it slips, the hero primary temporarily becomes "Book a demo" with "Start free" as the ghost, and the copy stays the same |

---

## 9. Build order (so the story ships in the right sequence)

1. Write the Tuesday fixture (cast, client, SOP, board, goal, KRA, thread, contract, timesheet, kudos) as one JSON file used by both the site and the trial template.
2. Mobile stepper for the story + hero + nav + close (the minimum honest page).
3. Sections 2, 3, 5, 9, 10, 11 (calm, mostly static).
4. Desktop pinned scene with captures for four surfaces, live DOM for four.
5. Pricing page, module pages (chapters), /how-it-connects, /tuesday.
6. Rive dots (Tier B) if a Rive file exists; otherwise ship SVG.
7. Instrument, measure per-beat drop-off, A/B hero headline (H1 vs the customer-quote headline).

The visual token system plugs in at: display type family and sizes, neutrals and borders, the single blue and its hover, the story tint, the semantic chip tokens inside the surfaces, the four brand hexes for the dots, radius ramp for cards and buttons, and the shadow values for the modal and sticky bar. Nothing in this concept depends on a specific hex; it depends on there being exactly one accent, one tint, and four dots.
