# workwrk.com: the definitive concept

**"The Snap, one Tuesday, one receipt."** Final synthesis from the judged panel, 2026-09-11. Scope: the public marketing site (`src/app/(marketing)`): Home, Pricing, eight module pages, How it connects, Compare, the shareable /tuesday route, Demo. The visual token system (exact neutrals, blue ramp, type family, navy chrome values) is decided separately; every place it plugs in is marked **[TOKEN HOOK]** and collected in section 14.

Inputs: marketing-references.md, phase2-inputs.md, existing-direction.md, zoho-reference.md, the three concept documents, and the three verdicts (founder, buyer lens, growth engineer).

---

## 0. The verdict, and how the conflicts were resolved

### 0.1 Chosen base: The Connected OS (the Snap), rebuilt on the Tuesday spine

The founder's winner is the chassis: eight blocks carrying real product surfaces snap into the real WorkwrK shell as you scroll, the module tour rotates those same blocks, the spine pulls two blocks out at a time and draws a blue wire between their dots, the How-it-connects page is the explorable map, and the Compare pages end with the map showing what each competitor leaves disconnected. This is the most literal answer to the brief ("3D modules of the system working together") and the founder weighted crazy and conversion highest.

But the panel was a near tie (Connected OS 113 against Tuesday 119 and Fourteen to One 118 once the name variants are summed), and both the buyer and the growth engineer picked Tuesday for reasons that are not taste: legibility of the hero at first paint, one pin instead of three, a signature that survives the phone 83% of visitors are on, the story being the trial template, and the Work Receipt as an honest artefact. The founder's own grafts (one object with a clock, the Work Receipt, the story is the template, per-beat truth gates, seat cards) move the Snap's spine most of the way to Tuesday anyway. So the definitive concept is:

- **Chassis from the Snap:** the block metaphor, the hero Snap into the shell, the two-blocks-and-a-wire grammar, the tour, the map, the compare pages, the final snap into the logo, the in-shell "Get this for your team" CTA, the sandbox (phased).
- **Spine and funnel from Tuesday:** the spine is one Tuesday, one task ("Onboard Bluefin Foods"), one clock, one trail, ending in the Work Receipt; the story is literally the trial template; per-beat truth gates with shipped fallbacks; five seat cards; the /tuesday share route.
- **Money layer from Fourteen to One:** the gaps headline over fourteen category tiles, the 14 → 1 collapse as the transition into the spine, the full Stack Receipt calculator with "Copy my receipt", the personal number in the sticky bar, "Moving is a quarter, not a year" with the switch-off schedule, the "Managers actually open it" adoption block, "Replaces roughly $X/seat" on pricing cards, the single CTA config flag.

### 0.2 Conflict resolution table

| Conflict | Resolution | Why |
|---|---|---|
| Hero geometry: the Snap's exploded isometric (rotateX 55 / rotateZ -35) vs Tuesday's 6deg tilt | Exploded view stays, but **near-frontal**: blocks rotate at most 12deg on X and 14deg on Y; depth comes from Z-spread (40 to 240px), scale (0.55 to 0.85) and overlap, not from rotation. 14px UI text on every block face is readable at the LCP frame. | Buyer bounced from an illegible diagram; the growth engineer flagged blurred rasterization on transform. The exploded-diagram idea survives at a legible angle. |
| "What it replaces" behind a hover | Every exploded block shows its **"Replaces:"** tag under its label in the resting state, no hover needed. The rail-icon hover ("Replaced: Task tracker, Sprint board") stays as a second layer after the Snap. | Buyer's 30-second test. |
| Three pins (hero, spine, final) vs one | **Two pins.** Hero Snap (1 viewport) and the spine (5 viewports, 6 stops). The final snap into the logo is a 1.2s in-view animation, not a pin, because the dots-leave-the-receipt moment at the end of the spine already delivers that gesture at full size. | Growth engineer's drop-off concern; the founder's favourite gesture is kept, moved to where the receipt earns it. |
| Spine content: three connections plus a close (Snap) vs eight Tuesday beats | Desktop pin: **six stops** that are exactly the founder's connections told as Tuesday (People → Process at 9:03, Process → Work at 9:04, Work ↔ Talk/Docs at 10:30 to 11:15, Blocked → unblocked at 2:00 to 2:30, Work → Goals at 4:45, the close at 6:02 with Sidekick sources and the receipt). Mobile stepper: all eight Tuesday beats, scroll is free there. | The growth engineer asked for six; the founder asked for those three connections plus Sidekick; Tuesday supplies the clock and the object. |
| Hero sandbox: strongest conversion device (founder) vs most expensive and desktop-only (buyer, engineer) | Kept, **not launch-gating**. Launch: the assembled shell is static-plus-hover with the in-shell CTA. Phase 3: four surfaces become driveable (My work, board list with task drawer, SOP doc, goal), then Talk, Table, Team. The sandbox workspace is the same fixture as the story and the trial template. | Ships the 83% experience first; the sandbox is measured before it is expanded. |
| Sandbox workspace "Northwind Ops" vs "Tuesday workspace" | One fixture, one name: the sample org is **Northwind Ops**, the template is **"Tuesday: client onboarding"**, deep link `app.workwrk.com/signup?template=tuesday`. | One JSON feeds the site, the sandbox and Template Center. |
| Share route: /snap (founder graft) vs /tuesday (Tuesday) | **/tuesday** is the share route with the Work Receipt as OG image; **/snap** 301s to it. The Home OG image is the beat-6 pull-back frame (eight tilted panels wired to the card). | Two routes with the same content would split shares. |
| The calculator: small pricing tooltip (Snap) vs one-input tab pile (Tuesday) vs full Stack Receipt (Fourteen to One) | **Full Stack Receipt** as its own Home section before pricing and at the top of /pricing. The grey category tiles are the chips, so it stays inside the block metaphor. | All three verdicts asked for it. |
| Two receipts | One `Receipt` component, one `next/og` route. The **Work Receipt** is what you get (story finale); the **Stack Receipt** is what you keep (calculator). They rhyme on purpose and share typography. | Growth engineer's build note. |
| Competitor names | Category nouns everywhere on Home and in the receipt; competitor names only on /compare in factual rows. The problem section names no vendors. | Founder and buyer both flagged it; legal and positioning. |
| "Cancel 14 tools. Keep one." as H1 | Not the control H1 (it is ClickUp's pitch and attracts price shoppers), but it is **variant B** in the launch A/B against the connection headline; the customer's number lives in the eyebrow of the control. | Buyer vs growth engineer; both get their test. |
| Department cards vs seat cards | **Five seat cards** (Founder/COO, Ops manager, People lead, Team lead, Individual contributor). | Founder graft; self-identification by seat. |
| How it works (three steps) vs "Moving is a quarter" | **Moving is a quarter, not a year** with three phases; the three steps become the Week 1 phase. | Kills the migration objection concretely. |
| Beat 2 mechanism not shipped (SOP step spawns the task, owner by role) | **Build it before the desktop story goes live** (task connection trail plus SOP step → task with role-resolved owner). Until then, the mobile stepper and every other section ship with the fallback narration ("Sam applies the onboarding template; the SOP and KPI come with it"). | The buyer called it the spine of the argument; the founder's graft demands truth gates; the product wants the feature anyway. |
| Product surfaces look | Every surface the site shows is drawn in the **Zoho-clean navy chrome**: navy rail plus navy top bar framing a white canvas, light-grey secondary sidebar, one blue button on the canvas. See section 1.1. | Founder's newest endorsement. |

---

## 1. The idea in one paragraph

WorkwrK's pitch is that people, processes, work and goals live in one system instead of fourteen. So the site never leaves one physical metaphor: the eight modules are **blocks**. In the hero they float apart, each a white canvas with a real product surface on its face and one YBRG dot, around a navy frame (the rail and top bar). As the visitor scrolls, the blocks **snap** into the frame and the assembled thing is the real WorkwrK shell, showing a manager's morning at 8:47 with one task already waiting: "Onboard Bluefin Foods". Then the page follows that one task through one Tuesday. Each stop pulls two blocks out of the shell, draws a blue wire between their dots, and shows the real UI making the connection: a role owning an SOP, the SOP step becoming the task, a chat decision landing on it, a block getting unblocked in a 15-minute huddle, a goal moving because the work moved. At 6:02 Sidekick answers "Is Q3 on track?" citing all four blocks, the task prints its **Work Receipt** (every connection it made, one line each, "0 tabs switched, 0 status meetings"), and the four dots it earned leave the receipt and snap between the two k's of the logo. Around that spine the page does the money work: fourteen grey category tiles collapse to one, your own **Stack Receipt** tells you what you keep every month, and moving is a quarter, not a year. The story you scrolled is the template you get on the first screen of the trial.

Internal name: **the Snap**. The spine's internal name: **Tuesday**.

### 1.1 The look of every product surface (global rule)

Every product surface on the site (block faces, the assembled shell, the sandbox, every spine stop, every tour tab, the seat cards, the adoption surfaces, the switch-off Table template, the WebP captures, the OG images, the video) is drawn in the founder-endorsed Zoho-clean look:

- **Navy chrome frames a white canvas.** The 8-hub rail and the top bar are one dark navy [TOKEN HOOK: chrome.navy]; the secondary sidebar is light grey [TOKEN HOOK: bg.subtle]; everything the user works on is white.
- **Active state on navy is a white pill** (never a blue tint); active on the light sidebar is a grey pill. Thin-line Lucide icons at 20px, 1.5px stroke.
- **One blue button on the canvas** (Create, or on the site, the CTA). Blue never sits on the navy chrome (#0073EA on navy fails contrast); on navy the accents are white.
- **The four dots live in the rail top** as the logo. Navy makes them pop; this is the ownable moment and it is why the block dots read as the same system as the rail.
- **List pages** use the Zoho header stack: page title, saved views as text tabs, one toolbar row (Filter and Sort left, view switcher, the one blue Create button right). **Tables** are bordered white cards with hairline rows, no zebra. **Empty states** are a quiet grey illustration plus one sentence.
- Inside surfaces, status uses the semantic trio (success / warning / danger) from the token spec, never the brand hexes. Brand YBRG appears only as the dots.

In the exploded hero, the **blocks are the white canvases** and the **navy frame is what they snap into**. Once assembled, the other seven canvases sit as a deck behind the front one (2px offset edges visible), and clicking a rail icon brings that canvas forward. That is how the assembled shell stays honest to the product (one canvas at a time) and still reads as eight modules in one object.

---

## 2. Hero: the exploded shell, snapped

### 2.1 Headline direction

Shape: outcome without trade-off, customer vocabulary, the differentiator on screen in the first line.

Control (A):

> Eyebrow: **The work OS that replaced 14 tools in one quarter.**
> H1: **Your people, processes, work and goals. Snapped together.**
> Sub: Roles own SOPs. SOPs become tasks. Tasks move goals. One system, no tabs in between, no training. Your managers will actually open it.

Variant B (five-second-test winner, tested at launch): **Cancel 14 tools. Keep one.**
Variant C (quote as headline, once written permission is in hand): **"We replaced 14 SaaS tools with WorkwrK in one quarter."**

CTAs: solid blue **Start free** (the only filled element in the viewport), text link **Watch Tuesday (60 sec)** (opens the video modal). Microcopy under the button: "No credit card." plus "Import from a spreadsheet in minutes." only while CSV import is shipped [TRUTH GATE]. "Book a demo" lives in the nav as a ghost button and in the final block, never in the hero.

[TOKEN HOOK: display type family and sizes (48 mobile / 64 to 72 desktop, one weight, leading 1.05), accent.solid / solidHover for the button, text.secondary for the sub.]

### 2.2 The scene

**What it is.** A navy frame (rail with eight hub icons, top bar with search and the four-dot logo) sits centre-right on a `perspective: 1600px` stage at rotateX 8deg / rotateY -10deg. Eight white blocks float around it, exploded outward on Z (40 to 240px) with X/Y offsets and scale 0.55 to 0.85, each rotated at most 12deg on X and 14deg on Y so its text is readable. Each block is a positioned React component (marketing-lite render of the real surface, Zoho look, about 40 DOM nodes) with:

- a 12/590 label (Work, Planner, AI, Talk, Teams, Docs, Tables, Goals),
- one full-saturation dot (Blue = action: Work, Talk, Planner. Green = outcomes: Goals, Tables results. Yellow = attention: Docs/SOPs, Teams reviews. Red appears only inside surfaces as status, never as a block dot),
- a grey 12px **"Replaces: …"** tag (category nouns) under the label, visible at rest,
- a real surface: My work (Work), week calendar (Planner), Sidekick answer with source chips (AI), a channel thread with a huddle chip (Talk), a role definition page (Teams), the SOP editor (Docs), a sheet with a formula bar (Tables), a goal with its progress ring and on-track verdict (Goals).

Beneath the blocks is the **wire layer**: blue 1.5px SVG lines with rounded caps connecting dots across blocks, drawn with stroke-dashoffset (GSAP DrawSVG). Nothing else: no lighting, no shading, one 1px edge per block [TOKEN HOOK: border.subtle], and the popover shadow token only while a block is lifted [TOKEN HOOK: shadow.popover].

**The exploded view is the LCP frame.** It is server-rendered with the exploded transforms as inline CSS custom properties per block, so the pre-hydration frame and the post-hydration frame are the same DOM. The stage reserves `aspect-ratio` at every breakpoint. No canvas above the fold.

The 14 grey category tiles are NOT in the hero (they belong to the problem section); the hero shows the solution only.

### 2.3 The first five seconds

| Time | What the visitor sees | Tech |
|---|---|---|
| 0.0s | Eyebrow, H1, sub, CTAs, and the exploded composition with its dots, labels and Replaces tags, static. | SSR HTML + CSS transforms. LCP = H1. |
| 0.3s | The four dots in the nav logo settle (the DotsLoader bounce, one beat, 400ms). | CSS keyframes. |
| 0.8s | Blocks begin a slow idle float (±6px, 6s loop, staggered). The block dots pulse once each in Y, B, R, G order. | Compositor-only keyframes; off under reduced motion. |
| 1.4s | One wire draws from the Teams block's yellow dot to the Docs block's yellow dot and fades. A 13px caption appears under the stage: "Scroll to snap it together." | GSAP DrawSVG once; ScrollTrigger then owns the stage. |
| by 3s | The visitor has read: what it is (one system of eight named modules), what each replaces (the tags), who for (people, processes, work, goals), what to do (Start free). | Copy discipline. |
| by 5s | They scroll (the Snap begins) or hover a block (it lifts 12px on Z and its Replaces tag brightens). Hover changes only the scene object's transform, never a button's; the product's no-hover-transform rule governs UI chrome, not scene objects. | GSAP quickTo. |

### 2.4 The Snap (scroll 0 to 100vh, pinned, scrub, snap points at 0 / 0.5 / 1)

- 0.00 to 0.35: blocks travel toward the navy frame in rail order (Work first). As each arrives its rail icon lights and its dot pulses; wires draw between neighbouring dots on the way in.
- 0.35 to 0.55: the frame's rotation eases to (0, 0, 0); the light-grey secondary sidebar slides in from the left; the top bar's clock reads **8:47 AM** (the story's narrator, introduced here).
- 0.55 to 0.70: **the snap.** Every block lands on the same frame with a 40ms overshoot (scale 1.02 → 1.0). Seven canvases stack as a deck behind the Work canvas (2px offset edges). The four dots flash to full saturation together and settle into the rail-top logo. Wires collapse to zero length as gaps close: once assembled you do not see the seams.
- 0.70 to 1.00: the assembled shell shows **Work › My work** for Maya, Ops lead, buckets Overdue / Today / This week. At 0.85 a new row slides into Today: **"Onboard Bluefin Foods"** with three small link glyphs (SOP, KPI, role), and a blue hairline draws to a caption outside the stage: "Created by SOP: Client onboarding, step 3. Owner by role: Onboarding lead. Moves: Onboarding cycle time." The H1 shrinks to a 20/590 caption top-left: "This is the whole thing." The one blue button on the canvas, where Create would be, reads **Get this for your team** and deep-links to `signup?template=tuesday`.

After the pin releases, hovering a rail icon shows "Replaced: Task tracker, Sprint board" (the tags again, now on the rail; this teaches the rail before signup and gives the Product nav dropdown its one-line note per hub).

### 2.5 The sandbox (Phase 3, not launch-gating)

After the Snap the assembled shell becomes driveable: click a rail icon to bring its canvas forward; click the task to open the drawer beside the list; open the SOP from the task's linked-SOP chip; open the goal from the KPI chip. v1 scope: My work, board list with task drawer, SOP doc, goal detail. v2: Talk channel, Table, Team directory, Planner week. Everything is local state on the shared fixture, no network, labelled "Sample workspace: Northwind Ops" in the sidebar header. Only shipped, stable surfaces appear. After three or more interactions a soft in-shell prompt appears: "Want this with your own data? Start free, import in an afternoon." (the second clause gated on CSV import). **Drag to explode**: grabbing the shell's edge re-explodes the blocks (GSAP Draggable, snap back on release), desktop only, the tinkerer's share gesture.

### 2.6 Mobile hero (below 1024px)

Eyebrow, H1, sub, CTA, then a 4:3 stage with a static exploded WebP rendered at build time from the same components; it cross-fades to the assembled WebP at 50% intersection, the dots pulse once, and a "Tap to snap again" replay sits under it. Two images ≤ 120 KB each, one CSS transition. The "Onboard Bluefin Foods" row and its caption are baked into the assembled image and repeated as live text under the stage so the differentiator is in the DOM.

---

## 3. Home page architecture, top to bottom

One conversion goal (Start free), a demo side door, eight placements plus a sticky bar. Novelty rhythm: high (hero) → calm (trust, problem) → high (collapse into the spine) → calm (tour, seats, adoption) → medium (migration, receipt) → calm (pricing, FAQ) → a short flourish (final).

| # | Section | Job | Product surface (Zoho look) | CTA |
|---|---|---|---|---|
| 0 | **Nav**: sticky, 56px desktop / 48px mobile, white, 1px bottom border after 80px of scroll. Logo (four dots), Product ▾ (eight modules, each one line, one dot, one "Replaces:" note), How it connects, Pricing, Compare, Customers (hidden until real), Log in, ghost Book a demo, solid Start free. | Always one way in | none | Start free |
| 1 | **Hero: the exploded shell, snapped** (100vh + 100vh pinned) | Explain the whole product in one object; earn the scroll; introduce the clock and the task | The full shell; every hub's main surface on the block faces | Start free, Watch Tuesday (60 sec), in-shell Get this for your team |
| 2 | **Trust line** (calm, one row) | Lower the guard | none | none |
| 3 | **The gaps** (calm, then a 1.2s collapse) | Name the pain in the customer's number, then show it collapse | The assembled shell, small | none |
| 4 | **The spine: Tuesday** (high, pinned 5 viewports, 6 stops, then the receipt) | The signature. Prove the differentiator with real UI and one object | Role page, SOP editor, board list + drawer, Talk thread, contract doc, Planner week, goal detail, Sidekick, review timeline | Inline after the receipt: Start free ("Start Tuesday in your workspace") |
| 5 | **Module tour: "Eight blocks. One system."** (calm, tabbed) | Let the visitor check the box they came for | One surface per tab | Text link per tab: See Work → |
| 6 | **"You're in this story"** (calm, five seat cards) | Self-identification | Five Home compositions | Start free (inline, primary only) |
| 7 | **"Managers actually open it"** (medium) | Adoption proof from the real quote, shown not asserted | Maya's My work; Team Goals with the on-track verdict | none |
| 8 | **"Moving is a quarter, not a year"** (calm timeline) | Kill the migration objection | The switch-off schedule Table template | Start with one team |
| 9 | **Your Stack Receipt** (medium, interactive) | Price it with the visitor's own numbers; create the personal number | The receipt and a slab thumbnail | Start free + Copy my receipt (>100 seats: Book a migration call) |
| 10 | **Pricing preview** (calm) | Show it costs less than the tools it replaces | none | Start free on the lower tiers, Talk to sales on the top tier |
| 11 | **FAQ + security** (calm) | Objection handling | none | none |
| 12 | **Final: "Snap it together."** (short flourish) | Close with the personal number and the logo | the logo | Start free + Book a demo |
| 13 | **Footer** | product, modules, compare, how it connects, pricing, security, status, docs, log in, locale/currency, legal, badges once true | | |
| sticky | **Sticky bar** after the hero: 52px desktop top-right of the nav, 48px bottom bar on mobile. Start free, ghost Book a demo, and once a Stack Receipt exists a grey chip "You'd keep $X/mo" (localStorage). While the spine is in view on mobile, the bar carries the clock label. | | | |

### Section details

**2. Trust line.** One row, three items: (a) the real quote verbatim, "We replaced 14 SaaS tools with WorkwrK in one quarter. Our managers actually open the app now. That didn't happen with Workday." with the attribution exactly as on the login page (Mohsin S., COO, 280-person services firm) until fuller permission exists; (b) honest product counters from a build-time query (workspaces, tasks completed this month, countries), labelled plainly; (c) G2 / Product Hunt badge slots, hidden until they exist. No logos until there are logos. [TRUTH GATE]

**3. The gaps.** Headline: **You don't pay for 14 tools. You pay for the gaps between them.** Left: fourteen grey category tiles (Task tracker, Wiki, Team chat, Video calls, Spreadsheets, Forms, OKR tool, HRIS directory, Review tool, Survey tool, Calendar, Timesheets, Whiteboard, Contracts / e-sign), each a real DOM card with a glyph, a label and a small "$/seat" tag, scattered with dashed grey lines, annotated with the old Tuesday in grey type: 9:02 the deal closes in the CRM · 9:15 the checklist lives in a wiki nobody updated · 9:40 a task is created, wrong owner · 11:00 a chat thread decides, the task never hears · 2:00 blocked, nobody knows who unblocks it · 4:30 the goals sheet is last month's · Friday 5:15 "Are we on track?" needs a meeting. Right: the assembled navy shell, small, dots lit, one blue line threading the rail. Under it, three statements the founder can stand behind without a citation: "Every status lives in one place." "Every process is one click from the task it governs." "Every goal is owned by a named role." No vendor names, no invented statistics. [TOKEN HOOK: tiles N0 fill, N200 border, N600 glyph, N400 dot; the "before" is always grey.]

**The collapse (transition into the spine).** As the section's last block enters view, the fourteen tiles are pulled into the small shell in one 1.2s spring sequence (Motion, once per session, not pinned): each tile shrinks toward the rail icon of the hub that replaces it, the icon pulses, and a counter above the shell ticks **14 tools → 1**. Caption: "That's what Mohsin's team did in one quarter." Then the light-blue tint stage of the spine takes over. Reduced motion and mobile: the final state (counter at 1) with a tap-to-replay.

**5. Module tour.** Eight tabs in the brief's order (Work, Docs, Talk, Tables, Goals, Teams, Planner, AI). On tab change the corresponding block from the hero rotates to face front (CSS 3D, 300ms, the one duration above the product's 250ms cap, justified as a scene object). Each tab: the real surface at rest, one sentence of what it did on Tuesday ("Talk: the decision landed on the task at 10:30."), a **Replaces:** line in category nouns, a **Connects to:** row of the neighbouring blocks' dots (each a link to that tab), and "See Work →" to the module page. Work: tasks, lists, boards, 17 views. Docs: docs, wikis, SOPs, policies, contracts, canvases, files. Talk: channels, calls, huddles. Tables: sheets and forms. Goals: OKRs, KRAs, KPIs, the on-track verdict. Teams: directory, org chart, roles, reviews, kudos, candor, surveys. Planner: calendar, timesheets. AI: Sidekick, agents, automations ("One Ask on every page. Not a chatbot on every button."). Settings is not a tab; admin is one FAQ answer.

**6. You're in this story.** Five seat cards, each a small real Home composition (navy chrome) at 8:47 and one line of what the day ends with: Founder / COO ("Is the quarter on track?" answered at 6:02 without a meeting), Ops manager (Maya's My work, the Onboarding board), People / HR lead (reviews due, survey results, org chart), Team lead (team goals rollup, workload), Individual contributor (Sam's Today with one SOP). In Phase 3 each card opens the sandbox pre-navigated to that seat.

**7. Managers actually open it.** The second half of the quote set at display size, attributed, beside two real surfaces: the manager's My work and Team Goals with the on-track verdict. Three metric card slots (tools replaced, time to roll out, manager weekly actives) exist in the layout and stay hidden until a customer states them. Nothing invented. [TRUTH GATE]

**8. Moving is a quarter, not a year.** Sub: "You don't switch everything on day one." Three phases on a thin timeline: **Week 1: bring one team** (invite people, import from a spreadsheet, pick a starting workspace; "Tuesday: client onboarding" is the first tile). **Weeks 2 to 6: connect the work** (add SOPs to the lists, give roles their KRAs, turn on Talk and Tables when the team is ready). **Weeks 6 to 12: switch off the old tools**, with the downloadable **switch-off schedule** (a WorkwrK Table template: tool, renewal date, owner of cancelling it, applied into the trial). Only importers that exist are named (CSV today; competitor importers stay unmentioned until shipped). If a migration concierge exists on the top tier, it is said here. CTA: **Start with one team** (same destination).

**9. Your Stack Receipt.** Headline: **What does your stack cost? Tap what you pay for.** The fourteen grey tiles as toggle chips (real buttons, aria-pressed) plus "Other" (free text, no price), a seat slider (default 50), and the receipt prints beside a slab thumbnail that re-runs the collapse on the visitor's selection (600ms). Lines are editable in place; prices are dated public list-price midpoints from one JSON with an `asOf` date, footnoted "Typical list price, [month year], editable"; the WorkwrK line comes from the live pricing source in the visitor's currency. Footer: "You keep $X/mo" and the **14 → 1** mark. Buttons: blue **Start free**, ghost **Copy my receipt** (a link whose OG image is the receipt, via the `next/og` route). Seats over 100 flip the ghost to **Book a migration call**. The number persists in localStorage and appears in the sticky bar and the final CTA.

```
STACK RECEIPT                          50 seats
Task tracker ............ $ 12/seat     $600
Wiki .................... $  8/seat     $400
Team chat ............... $  8/seat     $400
OKR tool ................ $ 10/seat     $500
Review tool ............. $  6/seat     $300
-----------------------------------------------
Old stack               5 tools     $2,200/mo
WorkwrK Growth          1 tool      $  .../mo
-----------------------------------------------
You keep                            $  .../mo
14 → 1
```

**10. Pricing preview.** Three cards using the real billing tiers (Starter / Growth / Scale per the existing JSON-LD; verify against billing before copy freeze), annual default with a monthly toggle, USD default with a currency toggle (INR, AED, SGD, GBP, EUR), one line each of who it is for, five bullets max, a **"Replaces roughly $X/seat of tools"** line computed from the same pricing JSON as the receipt, Talk and Tables shown as included-from-Growth rows (matching the modular packaging; confirm), per-tier CTA (Start free on Starter and Growth, Talk to sales on Scale only), no coloured "most popular" ribbon (a 1px blue border and "Most teams start here"), and the line "Not sure? Start free; you choose at day 14." (or the free-plan equivalent, see open decision 4). Link: **Full pricing and your receipt →**.

**11. FAQ + security.** Seven questions mirrored into the FAQPage JSON-LD: (1) Is this really all-in-one or eight half-apps? Answered with depth per module: Tables has a formula engine, Talk runs calls on our own infrastructure, Docs has SOP acknowledgement, Goals has role-owned KRAs, each linking to its module page. (2) Do we have to switch everything at once? No; modules toggle; section 8. (3) How long does migration take and who does it? (4) Do managers need training? The site was the training; the shell you drove is the shell you get. (5) Is it an HR system or payroll? People and performance yes; payroll and benefits through partners. (6) Where is our data hosted, who can see it, is it secure? Only true claims: MFA at login, idle sessions, lockout, hashed reset tokens, audit log, roles and scoped visibility; SOC 2 / GDPR badges only once true. (7) What happens to our data if we leave, and after the trial? Full export, soft-delete windows, workspace kept. "Cancel anytime."

**12. Final.** Display headline **Snap it together.** with a second line "It's 8:47 somewhere." The four dots settle between the k's (1.2s once in view, not pinned); the small clock reads the visitor's local time (one Date read after hydration, no ticking). If a Stack Receipt exists: "Your receipt: keep $X/mo." Solid Start free, ghost Book a demo, "No credit card."

---

## 4. The spine: Tuesday, storyboard

Pinned on desktop for five viewports of scroll, `scrub: 0.6`, snapped per stop. Stage: the single light-blue tint on the page [TOKEN HOOK: bg.tint / blue-50]. Grammar the visitor learns once: two blocks lift out of the assembled shell (which sits small and greyed at the bottom of the stage as the "you are here" map, with the current blocks highlighted), rotate to face front (≤ 10deg), sit left and right, a blue wire draws between their dots, the real UI on each face performs the connection, and a 12/590 label on the wire names it. The **task card** "Onboard Bluefin Foods" is born at stop 2 and is from then on the only object that moves between stops (GSAP Flip between named slots), collecting one trail line per stop. The **clock** in the stage's top-right is driven by scrub progress, mapped piecewise through the stop times so the minutes appear to advance. A vertical beat rail on the right edge (six ticks with times) is keyboard-focusable navigation. Narration sits in a fixed caption slot under the stage, cross-fading, also in an `aria-live="polite"` region.

Cast, always labelled as the **Tuesday workspace template** (Northwind Ops), never as a customer: Maya, Operations lead (the manager, the visitor's proxy). Sam, Onboarding lead (task owner, by role). Priya, Finance. Bluefin Foods, the new client. Under the stage in 12px: "The Tuesday workspace is a template. It's yours on day one."

| Stop | Clock | Left block (surface) | Right block (surface) | What happens on the wire | Dot | Trail line added | Headline / narration |
|---|---|---|---|---|---|---|---|
| 1. People → Process | 9:02 → 9:03 | **Teams**: Role definition "Onboarding lead", KRA "Client onboarding runs on time" (30%), KPI "Onboarding cycle time" | **Docs**: SOP "Client onboarding v4", steps listed, step 3 "Kick off internal onboarding" | The 9:02 trigger pulses from the Tables block in the mini shell ("Row 41 in Clients, from the signed form"). The yellow dot on Teams sends a pulse to the yellow dot on Docs; the SOP header gains an "Owned by: Onboarding lead (KRA: Client onboarding runs on time)" chip; a second wire attaches step 3 to the KPI. | Yellow | "9:02 Row 41 in Clients · 9:03 SOP step 3 live" | **Every role knows its process.** Roles carry KRAs. KRAs own SOPs. Nobody has to ask "who does this". |
| 2. Process → Work | 9:04 | **Docs**: the same SOP, step 3 | **Work**: Onboarding board, list view, group "This week"; then the camera pulls back to show Sam's My work › Today | The wire carries step 3 to the list; the task card is born at the top of the group: title, linked-SOP chip, owner Sam (resolved from the role), due in 10 days (the SOP's SLA), a 7-item checklist, linked KPI. The same card sits in Sam's Today. | Blue | "9:04 Born from SOP step 3 · Owner by role → Sam · Onboarding board · Sam's Today" | **Every process becomes work.** The SOP step turns into the task with the right owner attached. Sam didn't need to be told. |
| 3. Work ↔ Talk (and Docs) | 10:30 → 11:15 | **Work**: the task drawer open beside the list | **Talk**: #onboarding, split view. Sam: "Bluefin wants weekly reporting, not monthly. Does that change the contract?" Maya replies; Sidekick pins "Decision: weekly reporting, contract addendum needed" to the task; a checklist item appears. At 11:15 the Docs block lifts in the background: contract v2, "Reporting cadence" clause, policy "Client reporting" linked, attaches to the card. | none | "10:30 Decision from #onboarding · 11:15 Contract v2 attached" | **The conversation lives on the task.** Not in a thread nobody can find. |
| 4. Blocked → unblocked | 2:00 → 2:30 | **Work**: status flips to "Blocked: finance sign-off" (danger chip) | **Planner**: a 15-minute huddle with Priya appears at 2:15; the timer shows 2h 10m logged; at 2:30 status flips to "In progress". An automation chip rides the wire: "status changed → notify role owner (Finance)". | Red (appears at 2:00, retires into the trail at 2:30) | "2:00 Blocked · 2:15 Huddle w/ Finance · 2:30 Unblocked · 2h 10m logged" | **Blocked doesn't mean stuck.** The system knows who unblocks it. It takes a 15-minute huddle, not a day. |
| 5. Work → Goals | 4:45 | **Work**: the task marked Done; the Clients Table row updates its cycle-time cell | **Goals**: "Onboard every client in 10 days", ring 61% → 64%, Effort card adds the task with Sam's avatar, KPI "Onboarding cycle time" records a value, verdict: "On track. 3 of 4 onboardings this month inside SLA. Bluefin projected day 8." The Teams block lifts briefly in the background: KRA at 88%. | Green | "4:45 KPI +1 · Goal 64% · On track" | **Every task moves a goal.** The goal moved because the work moved. Nobody updated a spreadsheet. |
| 6. The close | 6:02 | All blocks snap back into the navy-framed shell | **AI**: the Sidekick panel opens over the shell. Maya types "Is Q3 on track?" Sidekick answers in three lines with **four source chips**, one per block it read, dotted: Goal: 10-day onboarding, 64% (G) · SOP: 3 open steps (Y) · Task: Onboard Bluefin Foods, in progress (B) · Blocked 2:00 to 2:30, resolved (R). Then Maya sends Sam a Kudos tagged to the value "Own it"; it lands on Sam's review timeline as evidence against the KRA. The card stops, and prints the **Work Receipt**. The four dots leave the receipt and snap between the k's of the wordmark. The camera pulls back one last time: eight tilted panels wired to the receipt (the Home OG frame). | all four resolve into the logo | "6:02 Kudos 'Own it' → review evidence" | **Ask anything. It knows because it's connected.** At 6:02 the manager knows the quarter is on track. She didn't ask anyone. |

After the pin releases, on the tint stage: **Start Tuesday in your workspace.** "The Tuesday workspace (the SOP, the board, the goal, the roles) is a template on your first screen." [Start free] "No credit card." Then two text links: **Replay Tuesday (8s)** and **Share this Tuesday** (copies /tuesday). Then the page returns to white for the tour.

### 4.1 The Work Receipt

```
ONBOARD BLUEFIN FOODS                         Tuesday
------------------------------------------------------
09:02  Row 41 written by form            Tables
09:03  SOP step 3 live · owner by role   Docs · Teams   ●Y
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

The receipt is a **product feature** (the task's connection trail, built in Phase 3), not a marketing graphic: the trial's first-run tour ends by showing the visitor their own empty receipt ("Your first task's receipt will appear here."). On the site the footer says "Tuesday workspace template"; in the shared OG image it says "The Tuesday workspace". The receipt and the clock use the mono face if the token system has one, otherwise tabular figures of the grotesk [TOKEN HOOK].

### 4.2 Mobile stepper (designed and built first)

No pin, no camera, no tilt. **Eight** stacked cards (9:02 Tables row · 9:03 SOP and role · 9:04 board · 10:30 Talk · 11:15 contract · 2:00 to 2:30 blocked · 4:45 goal · 6:02 close with the receipt), each `min-height: 80vh`, the time set at 48 to 96px display on the left edge, the surface as a flat 16:10 composition (Zoho look), the narration under it, the task card repeated with its trail so far (the moving object becomes the same object, growing), and a vertical wire drawn once on intersection between the two surfaces of each card. The clock lives in the sticky bottom bar as a 12px label updated by IntersectionObserver. Dots appear in place; at the last card they hop 400ms into the wordmark rendered inside that card. Plain HTML/CSS; JS adds only the clock label, the wire draw and the dot hop.

### 4.3 Reduced motion (any breakpoint)

No pin, no draw, no Flip: the stops render as cards with wires already drawn and the end state of each surface. The receipt is static. Nothing is lost except motion.

### 4.4 Truth gates per stop (sign off against the running product, not the plan)

| Stop | Mechanism shown | Status | Shipped fallback if not live at storyboard sign-off |
|---|---|---|---|
| 1 | Role page with KRA/KPI; SOP owned by role; step attached to KPI | Role Definition page built (Operating Core Phase 1, migration pending); SOP center shipped; SOP → KPI link: confirm | SOP "Owner" as a direct person field; KRA shown on the Role page; the wire label reads "Owned by: Sam (Onboarding lead)" |
| 2 | SOP step spawns the task with owner resolved by role | SOP run-execution deferred; RoleInstance migration pending | Task Type "Onboarding" with LINKED_SOP plus a Template Center task template carrying the checklist; narration: "Sam applies the onboarding template; the SOP and KPI come with it." **Launch recommendation: build the real mechanism before the desktop story goes live**, because the fallback reduces the differentiator to templates. |
| 3 | Talk thread referencing the task; Sidekick summary pinned to the task; contract doc attached | Channels/threads shipped; task reference from Talk: confirm; Sidekick pin: confirm; contracts and attachments shipped | A human "Decision:" comment on the task linked from the thread |
| 4 | Automation "status changed → notify role owner"; huddle; timer | Huddles and TimerSession shipped; only 5 of 16 triggers fire, confirm status change is one | Sam @mentions Priya from the task; the huddle and timer stay |
| 5 | KPI record, goal progress, Effort card, on-track verdict | Goals redesign shipped (Effort card from linked KRA tasks); AI verdict: confirm | The deterministic on-track rule rendered as the verdict, without AI phrasing |
| 6 | Sidekick answer with four source chips; Kudos → review evidence; the task connection trail | Kudos with values shipped; review evidence link: confirm; Sidekick sources: confirm; trail: **new product feature, build in Phase 3** | Sidekick chips generated deterministically from the linked entities; receipt rendered from the fixture until the trail feature ships |

---

## 5. The other pages

**/pricing.** The Stack Receipt at the top, prefilled from Home (localStorage or query string), above the three tiers at full detail; a comparison table (rows: the eight modules plus governance items: roles, KRAs, reviews, SOP publishing, audit log; columns: tiers; checkmarks only where the surface is shipped); premium-module rows; a billing FAQ subset; the demo side door pinned to the top tier ("For teams over 100 we'll set up your Tuesday with you" → Book a migration call). Ends with the Home close. No story scene; pricing pages are quiet. JSON-LD offers generated from the pricing JSON.

**/product/[module]** (work, docs, talk, tables, goals, teams, planner, ai). Each page is that module's chapter of the same Tuesday, same cast, same clock. Structure: (1) hero: the module's block as the hero object, front-facing, clock at its beat time, headline in the module's voice ("Talk: the decision lands on the task."); (2) "What happened at [time]": the beat expanded into three or four sub-moments with real surfaces; (3) "What it connects to": the neighbouring blocks pulled in with wires (Talk shows Task → thread; Docs shows SOP → task; Teams shows Role → KRA → Goal), plus the **Connects to** dot row; (4) feature list in plain rows, unbuilt items hidden behind "Show upcoming features"; (5) **Replaces** strip (category nouns), tier row, proof slot, the close. The AI page shows the three moments AI appeared on Tuesday (the 10:30 summary, the 2:00 notify, the 4:45 verdict) and states the AI door policy. These pages carry the SEO keywords; Home carries the story.

**/how-it-connects.** The spine as an explorable map: one full-width stage with the eight blocks as a graph and blue wires as edges, faint blueprint grid behind it. Click any node (Role, KRA, KPI, SOP, Policy, Task, Doc, Channel, Table row, Goal, Review, Kudos) and the right pane shows what it is, what it connects to (edges light), and the real surface where the connection is made. A **Follow Tuesday** toggle plays the six stops as a guided tour with a step-progress nav. Second block: "Why one system, not integrations" (three paragraphs; integrations are demand-driven; no connector promises). Third: the governance layer for admins (roles, permissions, scoped visibility, audit). "Book a demo" from this page pre-fills "Walk me through how it connects".

**/compare/monday, /compare/clickup, /compare/workday.** Honest factual tables (nominative use, no logos in the hero), each ending with the connection map lit to show what the competitor leaves disconnected (people-ops in Monday and ClickUp; the work chassis in Workday), then the close. A fourth page, **/compare/your-stack**, is the Stack Receipt landing for ads.

**/tuesday.** The story scene (mobile stepper or desktop pin), the receipt and one CTA. Its OG image is the Work Receipt; `og:video` is the 8-second loop. /snap redirects here.

**/demo.** The 60-second video and the booking form: name, work email, company size, **"tools you use today"** as the fourteen tappable category tiles (the same component as the receipt), and an optional free-text line. Five fields. Seat count and tool selection feed routing.

**/customers.** Empty until real; the Mohsin story becomes the first case study only with permission.

---

## 6. Motion choreography and stack

### 6.1 Choreography (desktop)

```
scroll     0vh  hero static (LCP), idle float, one wire draws once
     0 → 100vh  PIN 1: the Snap (exploded → rail-order approach → frame squares up → SNAP → My work 8:47, the task row arrives)
   100 → 150vh  trust line (fade), the gaps (tiles + timeline fade-up on CSS scroll timeline)
   150 → 160vh  the collapse: 14 tiles spring into the shell, counter 14 → 1 (Motion, once, not pinned)
   160 → 660vh  PIN 2: Tuesday, six stops (scrub, snap per stop, Flip for the card, DrawSVG wires, clock mapped to progress)
   660 → 700vh  the receipt prints, dots leave for the wordmark, pull-back frame, inline CTA
   700 → 780vh  module tour (tabs; block rotates 300ms), seat cards (fade-up)
   780 → 860vh  adoption (two surfaces slide 12px), migration (timeline draws)
   860 → 940vh  stack receipt (chips, layout animations, number tweens), pricing (toggle only)
   940 → 1000vh FAQ (accordion), final (dots settle 1.2s once in view)
```

Two pins on the page. Everything between them is calm (Vercel's novelty mapping: "if it felt pompous or out of rhythm, don't build it").

### 6.2 Stack decision

| Layer | Choice | Why |
|---|---|---|
| Product surfaces (block faces, sandbox, spine, tour, seats, adoption) | React components: marketing-lite variants of the real product primitives (EntityTile, StatusChip, ViewTab, MenuItem, the shell) behind a `MarketingShell` wrapper, fed by the static Tuesday fixture, in the **navy chrome** variant of the token spec | The product is the demo. Screenshots go stale, don't resize, aren't clickable. [TOKEN HOOK: the marketing-lite components consume the same `--os-*` aliases as the product, chrome.navy variant] |
| Blocks in space | CSS 3D transforms (perspective, preserve-3d) on those components, transforms driven by GSAP | Literal 3D placement of real DOM at zero bundle cost; flat material by construction. Spline rejected (runtime weight, LCP risk). Full R3F rejected because faces must be real DOM. |
| Pin, scrub, snap, Flip, wire draw | GSAP 3 + ScrollTrigger + Flip + DrawSVG + `@gsap/react` useGSAP (about 35 KB gz, free since April 2025), loaded through `next/dynamic({ ssr: false })` inside `"use client"` wrappers, only on `(min-width: 1024px)` and `prefers-reduced-motion: no-preference`, only on Home, /tuesday and /how-it-connects | The only engine with dependable pin, scrub, snap and shared-element Flip. Mobile never downloads it. |
| Reveals, tabs, the collapse springs, the receipt's layout animations, hover lifts | Motion v12 via LazyMotion + `m` (about 4.6 KB), useScroll on ScrollTimeline where available | Already installed; convert the existing FadeIn helpers to LazyMotion. |
| Parallax, dot pulses, timeline fade-ups | CSS scroll-driven animations under `@supports (animation-timeline: scroll())` and reduced-motion gating | 0 KB, compositor thread; Firefox falls back to static. |
| The four-dot mark | Tier A: SVG + GSAP. Tier B: Rive state machine (idle / hover / connected / snapped), self-hosted WASM under /public, preloaded, lazy-mounted | Rive is an upgrade, not a dependency (Q13 default: no artist). |
| Optional literal WebGL | Tier C: one R3F island rendering the four dots as unlit spheres and the wires as tubes with a travelling pulse, under the DOM blocks, after `window.load`, DPR 1.5, paused offscreen, WebP fallback, ≤ 250 KB gz JS | Only if the founder wants literal WebGL after seeing the CSS 3D. Never the LCP element. |
| Video | Only in the Watch Tuesday modal; rendered at build time from the real desktop scene with a headless browser so video and scene never drift | Never the hero. |
| Not used | Spline, Lenis, Lottie, dark sections, canvas image sequences | LCP threat, INP threat, CPU threat, wrong brand signal, unnecessary when surfaces are DOM. |

Element ownership rule: a node animated by GSAP (the two pinned scenes: `.world`, the blocks, the card, the dots, the wires, the clock) is never given Motion props, and vice versa. A lint rule flags `motion.` or `m.` inside `*-scene*.tsx` files.

### 6.3 Performance, SEO, accessibility on Next.js 16.2.6 App Router

- **Server first.** `page.tsx` stays a Server Component. Islands: `hero-scene.client.tsx`, `spine-scene.client.tsx`, `collapse.client.tsx`, `receipt-calculator.client.tsx`, `watch-modal.client.tsx`, `sandbox.client.tsx`. Each does its own `next/dynamic` inside a client file (ssr:false is only legal in Client Components; server → client dynamic imports do not code-split). Each wrapper renders the static composition as children so the pre- and post-hydration frames match.
- **LCP** is the H1 (SSR text); no canvas above the fold; target < 2.5s on a mid-range Android over 4G. Fonts: one family via `next/font`, `display: swap`, preloaded subset; drop the seven-family load.
- **CLS 0**: every stage, block, tab panel and calculator reserves height; the spine track's `5 × 100vh` is set in CSS before JS; ScrollTrigger uses pinSpacing.
- **INP < 200ms**: transforms and opacity only; `will-change: transform` on `.world` and blocks only while pinned (ScrollTrigger onToggle); one transformed ancestor per block (no nested preserve-3d, no overflow containers inside the 3D stage, which would flatten); visibility budget in the spine (current stop ± 1 rendered, others `visibility: hidden` + `content-visibility: auto`, keeping compositor layers under five); tickers killed off-view; sandbox interactions are local state; the calculator debounces.
- **JS budget**: < 200 KB gz first-load before the GSAP island; GSAP island ≤ 40 KB gz; fixture ≤ 40 KB; hero WebPs ≤ 120 KB each; total fallback images ≤ 600 KB. **CI bundle-analyzer gate** on the budget.
- **SEO**: all copy in SSR HTML; the six stops (eight on mobile) are a semantic `<ol>` of `<section>`s with headings ("9:04 The process becomes work") that the desktop scene enhances; `<noscript>` text in every scene wrapper; FAQ text matches the FAQPage JSON-LD; JSON-LD SoftwareApplication offers, the pricing cards' "Replaces roughly" lines and the receipt all read from the one pricing JSON so they never drift; `BreadcrumbList` on module pages; Home OG = the beat-6 pull-back frame; /tuesday OG = the receipt; the receipt OG route is a `route.ts` using `ImageResponse` from `next/og`, edge runtime, cached by query string; metadata and positioning updated to PPMS + USD (Q10 default) in the same PR as the hero.
- **Accessibility**: native scroll (no wheel capture); every stop is a real section with a heading; "Skip the tour" link at the top of each pinned scene; the beat rail is focusable; `aria-live` narration; reduced motion renders end states with no pin; the sandbox is a real DOM with focus order, `aria-label`s and Escape to close the drawer; colour never travels alone (each dot has its label); chips are real buttons with `aria-pressed`; the collapse counter updates `aria-live` once at the end, not per tick.
- **Mobile first** (about 83% of visits): the stepper, the two-WebP hero and the bottom sticky bar are designed, built, reviewed and instrumented before the desktop pins.
- **Engineering guardrails**: a visual regression test renders each marketing-lite surface against the product screenshot in navy chrome; the lint rule for element ownership; the CI budget gate; every copy claim (importers, badges, "import in an afternoon", tier names) behind a feature flag tied to shipped state.
- **Measurement**: distinct `data-cta` ids on all eight placements plus the sticky bar; stop-reached events (1 to 6 desktop, 1 to 8 mobile); sandbox interaction events; receipt events (chips, seats, copied); primary metric visit → trial signup; secondary receipt built → signup; the Snap and the spine A/B-testable against the static hero and the stepper on desktop.

---

## 7. Conversion funnel

### 7.1 Motion: trial first, demo side door, sandbox as the bridge, seat-count escalation

Sub-$10K ACV at SMB, self-explanatory product, sub-24h time-to-first-value with the Tuesday template: trial leads (median 18% trial-to-paid, top quartile 32%+; hybrids convert best). **Start free** is the only filled button everywhere; **Book a demo** is a ghost in the nav, the top pricing tier, the FAQ and the close; the How-it-connects page carries the demo path for mid-market. The sandbox is the bridge: a visitor who drives the shell for 60 seconds is warmer than a video watcher or a form filler; after three interactions the soft in-shell prompt fires, and after stop 5 or a Replay click the inline "Start Tuesday in your workspace" CTA is shown early. Seats over 100 on the receipt flip the ghost to **Book a migration call**. In-product escalation (not a site concern): when a trial workspace invites five or more teammates or turns on Talk or Tables, Sidekick offers a 20-minute setup call.

**Single config flag** (`cta.primary = "trial" | "demo"`): if self-serve signup is not live at launch (Q11), Start free and Book a demo swap roles everywhere with no layout change.

### 7.2 The trial bridge (launch gate)

The primary path: Start free → signup (email or Google/Microsoft SSO, ≤ 5 fields) → workspace created from the **"Tuesday: client onboarding"** Template Center template (the SOP, the board, the goal, the roles, the cast as example records marked "example", removable in one click) → the first screen is the same My work at 8:47 the visitor saw after the Snap. **Launch is gated on that template existing in Template Center and being applied at signup**; without it "Get this for your team" is a broken promise.

### 7.3 CTA cadence

One goal, one label ("Start free"), one fill, one destination (`app.workwrk.com/signup` with `utm_content` from the placement id, `template=tuesday`): nav (persistent), hero (primary + video side door), in-shell (contextual), after the receipt (inline), after the seat cards, migration ("Start with one team"), the Stack Receipt (primary + escalation), pricing (per tier), final (primary + demo). Sticky bar after the hero. Never two filled buttons in one viewport.

### 7.4 The personal number

Once a Stack Receipt exists, the sticky bar shows a grey chip "You'd keep $X/mo" beside Start free (localStorage), the final CTA repeats "Your receipt: keep $X/mo", and /pricing opens prefilled. This attaches a personal reason to the sticky bar's +5 to 15% effect.

### 7.5 Where each objection dies

| Objection | Where |
|---|---|
| "Another tool nobody will use" | Trust line (the quote), section 7 (managers actually open it), the seat cards |
| "We'll need training" | The Snap and the sandbox (you already drove it), FAQ 4, migration Week 1 |
| "All-in-one means eight half-apps" | The spine (real depth per surface), the tour, FAQ 1, the module pages |
| "Migration will take a year" | Section 8 (a quarter, one team first, the switch-off schedule) |
| "What about Slack, Zoom, Sheets?" | Replaces tags on the hero blocks, the tour, the gaps section |
| "Is it really cheaper?" | The Stack Receipt (their numbers, editable), the pricing cards' Replaces line |
| "Is this ClickUp with HR bolted on?" | The spine, How it connects, the compare pages |
| "Security, data, lock-in" | FAQ 6 and 7, badges once true, footer |
| "Too big / too small for us" | Seat cards, pricing tiers, the >100-seat escalation |

### 7.6 Social proof policy

Real or absent. The one real quote is used three times at three sizes (trust line, adoption block, the final's eyebrow when the receipt is absent). Product counters come from a build-time query. Logo, G2 and metric slots exist in the layout, hidden until filled. The cast are initials-avatars from the product's own avatar component; no stock faces. Get written permission for a fuller attribution of the quote before adding a photo or company name.

---

## 8. Copy direction

**Voice.** Physical and plain: verbs of assembly (snap, connect, click into place, roll up, attach), the customer's vocabulary (managers open it, replaced 14 tools, one quarter), present tense in the story, numerate and a little dry about subscriptions. Short sentences. No "supercharge", "seamless", "empower". Second person for the visitor, third person for the system. Category nouns, never competitor names, outside /compare. Every number on the page is the visitor's input, a live product metric, the customer's own, or a footnoted public list price. No em dashes, no double hyphens; commas, colons, periods.

**Hero-grade headlines.**
1. Your people, processes, work and goals. Snapped together. (control)
2. Cancel 14 tools. Keep one. (variant B)
3. "We replaced 14 SaaS tools with WorkwrK in one quarter." (variant C, permission needed)
4. Roles own SOPs. SOPs become tasks. Tasks move goals. That is the whole product.
5. The work OS your managers will actually open.

**Section headline set.** "You don't pay for 14 tools. You pay for the gaps between them." / "14 tools → 1" / "Every role knows its process." / "Every process becomes work." / "The conversation lives on the task." / "Blocked doesn't mean stuck." / "Every task moves a goal." / "Ask anything. It knows because it's connected." / "Start Tuesday in your workspace." / "Eight blocks. One system." / "You're in this story." / "Managers actually open it." / "Moving is a quarter, not a year." / "What does your stack cost? Tap what you pay for." / "Less than the tools it replaces." / "Snap it together."

**Microcopy.** "No credit card." / "Sample workspace: Northwind Ops" / "Scroll to snap it together." / "Skip the tour." / "Get this for your team." / "The Tuesday workspace is a template. It's yours on day one." / "Replay Tuesday (8s)" / "Share this Tuesday" / "Copy my receipt" / "You'd keep $X/mo" / "Start with one team" / "Typical list price, [month year], editable" / "Not sure? Start free; you choose at day 14."

---

## 9. The crazy factor

Three gestures, in the order the visitor meets them:

1. **The Snap.** Eight blocks with real software on their faces snap into a navy-framed app shell as you scroll, and the shell then works. The mid-snap frame (blocks a few pixels from landing, four dots lit, blue wires still visible, the H1 above) is the Product Hunt gallery hero and the first frame of the video. In Phase 3, pulling the shell apart re-explodes it; tinkering is the invitation.
2. **The Work Receipt.** At 6:02 the task stops moving and turns into a receipt: every connection it made in one day, one line each, ending on a brag in the visitor's vocabulary ("0 tabs switched, 0 status meetings"). People screenshot receipts. The two-second GIF is the four dots leaving the receipt and landing between the k's. It is a real product feature, so the share is honest, and /tuesday makes it a URL.
3. **The Stack Receipt.** The visitor taps the tools they pay for, watches those grey tiles collapse into the shell, and prints their own before/after with WorkwrK on the only remaining line, signed 14 → 1. "Copy my receipt" makes it an OG card for LinkedIn and WhatsApp. It is also the most measurable section on the site.

The hero teaches the gesture, the Work Receipt gives it meaning, the Stack Receipt makes it personal.

---

## 10. On-brand rules (where boldness is spent)

- **Blue #0073EA is the only fill** for buttons and links (hover per the token spec) and the only colour for wires and the connection lines. Blue never sits on the navy chrome. [TOKEN HOOK: accent.solid / solidHover / text]
- **YBRG appears only as the four dots** at full brand saturation: one per block, the pulse on the wires, the dots on the receipt, the source chips in Sidekick's answer, the logo in the rail top and the wordmark. Never backgrounds, gradients, or mixed into headlines. Inside product surfaces status uses the semantic trio; a "Done" chip is semantic green, never brand green. The two sets never mix.
- **Navy chrome, white canvas, grey before.** The rail and top bar are navy; canvases are white; the fourteen "before" tiles and struck-through receipt lines are neutral grey (cancellation is shown by absorption and strike-through, never red, so red keeps its meaning inside surfaces).
- **Flat.** White blocks with a 1px edge; the popover shadow only on a lifted block; the 3D is placement and rotation, not material. No lighting, no reflections, no mesh gradients, no glassmorphism, no dark sections beyond the navy chrome itself; light only.
- **One tinted stage** (blue-50) for the spine; the only non-white ground on the page.
- **Type does the shouting**: display 48 to 72 at one weight, tight leading; marketing body 16; the clock, the receipts and the counter in the mono face or tabular figures. Faint blueprint grid only on the hero stage and the How-it-connects map.
- **Four dots are the illustration language.** No mascots, no claymation, no isometric offices. The dots-loader rhythm (Y, B, R, G) is the timing signature of every pulse.
- **No purple anywhere.** No Zoho coral, no Zoho purple, no double navigation layer, no bottom dock; WorkwrK keeps one rail, one secondary sidebar, one top bar.

Boldness budget, four bets: the Snap, the Tuesday spine with its receipt, the Stack Receipt, and the navy-framed real UI on every surface. Everything else is quiet on purpose.

---

## 11. Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| CSS 3D of heavy DOM stutters (eight faces holding real lists, docs, sheets) | Layer explosion and paint cost on mid-range devices | Marketing-lite faces (~40 nodes), `content-visibility: auto` on non-front faces, one transformed ancestor per block, will-change only while pinned, visibility budget in the spine, mobile gets WebPs; 60fps check on a 2020 MacBook Air and a mid-range Android; a runtime flag swaps the desktop scene for the stepper if rAF cadence drops under 45fps in the first two stops |
| LCP/INP regression | 83% mobile, desktop converts 2x; cannot be slower than the current static hero | SSR the composed frame; GSAP after hydration, Home only, ≥1024px; transform/opacity only; tickers killed off-view; CI budget gate |
| Honesty: a stop shows a mechanism that is not wired (SOP → task, owner by role, status automation, on-track verdict, Sidekick sources, the trail) | The founder's rule; a trial user hits the gap the site promised away | Truth-gate table in 4.4 with shipped fallbacks; the storyboard signed off against the running product; build stop 2's mechanism and the trail before the desktop story goes live; the template is tested in a real trial before the page ships |
| Trial not ready (no template at signup) | The strongest lever becomes a broken promise | Launch gate 7.2; the config flag flips primary/ghost to demo-first with the same copy if it slips |
| Fictional cast read as customers | Trust damage | Always labelled "Tuesday workspace template"; no logos in the story; the only customer voice is the real quote; the receipt footer says template |
| Competitor pricing and names (legal, accuracy) | Exposure and drift | Category tiles everywhere but /compare; receipt prices dated, footnoted, editable, reviewed quarterly, one JSON with `asOf` |
| Single-source proof | One quote carries the page | Written permission and fuller attribution for the quote; no second quotes until they exist; metric slots hidden |
| Pinning and accessibility | Trapped or nauseated users | Native scroll, semantic sections, skip links, focusable beat rail, aria-live narration, reduced motion renders end states, snap duration 0.4s and cancellable |
| Two animation libraries | Jank and ownership bugs | Ownership rule + lint rule; GSAP owns only the two scenes |
| Sandbox drifts from the product, or shows a protected parity screen restructured | Honesty; the parity mandate | Marketing-lite components import the product primitives and tokens; visual regression test per surface; only shipped surfaces; "Sample workspace" label; the founder confirms the surface list |
| Copy claims outrun the product (importers, SOC 2, "import in an afternoon", tier names) | Honesty and legal | Every claim behind a flag tied to shipped state; tier names verified against billing before copy freeze; "Free for 14 days" vs "Free plan" resolved (open decision 4) |
| Founder expects WebGL lighting and depth | Flat brand, perf budget | Show the exploded-diagram references up front; the R3F wire layer is the literal-3D concession, unlit, Phase 5 |
| Build effort (eight faces, two pins, a sandbox, thirteen pages, a trail feature) | Weeks | Phased build order in section 12; every phase shippable and measurable |
| Positioning and currency undecided (Q10) | Headline, pricing, JSON-LD | USD default with selector; strings and offers are data, flipping is config |

---

## 12. Build order, page by page

**Phase 0: foundations (week 1).**
1. The **Tuesday fixture** as one JSON (cast, client, SOP, board, task, goal, KRA, KPI, thread, contract, huddle, timer, kudos, receipt lines) used by the site, the sandbox and the Template Center template.
2. The **pricing source JSON** (tiers, currencies, category list prices with `asOf`) feeding the receipt, the pricing cards and the JSON-LD.
3. The **marketing shell package**: `MarketingShell` in the navy chrome variant plus marketing-lite surfaces (rail, top bar, secondary sidebar, My work, board list with task drawer, SOP doc, Talk thread, Table, goal detail, role page, review timeline, Sidekick panel, Planner week, contract doc, invite modal, Template Center grid). [TOKEN HOOK: this package is where the token spec lands first.]
4. The **Receipt** component and the `next/og` route (`/api/og/receipt`), serving both receipts.
5. Config flags (`cta.primary`, importers, badges, tier names), `data-cta` instrumentation, stop-reached events, the lint rule and the CI budget gate.

**Phase 1: Home, mobile first (weeks 2 to 3). Ships the whole story in HTML.**
6. Nav, sticky bar (top on desktop, bottom on mobile), footer, JSON-LD (PPMS positioning, USD offers, FAQPage).
7. Hero: mobile two-WebP version; desktop static exploded composition with hover (no pin yet).
8. Trust line, the gaps section with the collapse (Motion, in-view once), the spine as the eight-beat mobile stepper (also the desktop fallback), the Work Receipt static.
9. Module tour, seat cards, adoption block, migration timeline with the switch-off Table template, the Stack Receipt with Copy my receipt and the sticky chip, pricing preview, FAQ, final.

**Phase 2: the desktop signature (weeks 3 to 4).**
10. Pin 1: the Snap (GSAP ScrollTrigger + DrawSVG), the task row arrival, the rail hover tags.
11. Pin 2: Tuesday with six stops (Flip for the card, the clock, the beat rail), WebP captures for surfaces not yet componentised (four live DOM, four captures at v1), the receipt print, dots to the wordmark, the pull-back frame as the Home OG.
12. Per-stop drop-off measured; A/B H1 control vs variant B.

**Phase 3: drive it, and the product work (weeks 5 to 6).**
13. Product: **task connection trail** (the receipt as a feature) and **SOP step → task with role-resolved owner** (stop 2's mechanism); the **"Tuesday: client onboarding"** template in Template Center applied at `signup?template=tuesday`; the first-run tour ending on the empty receipt. This is the launch gate for the desktop story's stop 2 narration and for "Get this for your team".
14. The sandbox (four surfaces), the intent prompt, drag to explode, seat cards opening the sandbox pre-navigated.

**Phase 4: pages (weeks 6 to 8).**
15. /pricing (receipt on top, comparison table, billing FAQ).
16. /product/[module] × 8 (chapters of Tuesday, Connects-to rows, Replaces strips, hidden upcoming features).
17. /how-it-connects (the map, Follow Tuesday, governance block).
18. /tuesday (share route, receipt OG, loop video), /snap redirect.
19. /compare/monday, /clickup, /workday, /your-stack.
20. /demo (video + five-field form with the tool tiles); the 60-second Watch Tuesday video rendered from the scene at build time.

**Phase 5: opportunistic.**
21. Rive mark (if a Rive file exists), R3F wire layer (only on founder request after seeing CSS 3D), /customers when real, the sandbox's second four surfaces, swapping remaining WebP captures for live components as the product's token migration lands.

---

## 13. Where the visual design system plugs in

Every place below takes a token or type decision from the separate visual pass. Nothing in this concept depends on a specific hex; it depends on there being one accent, one tint, one navy, four dots and one type family.

1. **chrome.navy** (rail and top bar), the white active pill on navy, the light-grey secondary sidebar (bg.subtle) and its grey active pill: every product surface on the site, the hero frame, the assembled shell, the sandbox, the OG images, the video. Verify white on navy AAA and never place blue on navy.
2. **accent.solid / solidHover / text and blue-50**: every Start free, every link, the wires, the collapse line, the spine's tint stage, the recommended tier's 1px border.
3. **The four brand dot hexes** (fixed) and the **semantic trio** (success / warning / danger bg, text, solid): block dots, wires' pulses, receipt dots, Sidekick chips, the logo vs the in-surface status chips (Blocked at 2:00 uses danger, not brand red).
4. **Neutral ramp**: block faces (bg.raised), block edges (border.subtle), the fourteen "before" tiles (N0 fill, N200 border, N600 glyph, N400 dot), struck-through receipt lines (N400), the greyed "you are here" mini shell, the old-Tuesday timeline type (text.secondary).
5. **shadow.popover**: the only shadow on the site (a lifted block, the receipt card, the sticky bar hairline, the video modal).
6. **Display type ramp** (48 / 64 / 72 at one weight, leading 1.05), marketing body 16, caption 13, the 12/590 wire labels and block labels, the 20/590 caption after the Snap; in the chosen family (Inter per Q5 default, Figtree if the founder keeps it).
7. **Mono or tabular figures** for the clock, the counter, both receipts and the 14 → 1 mark.
8. **Radius ramp**: blocks and tiles at 8 (card), chips at 6, the receipt at 8, buttons at 8, the navy pill at 8, pills full.
9. **Marketing-lite surfaces** consume the product's `--os-*` aliases through `MarketingShell` in the navy variant; Zoho header stack (title / text-tab views / one toolbar row), bordered-card tables with hairline rows, quiet empty states, Lucide 20px at 1.5px stroke.
10. **Motion durations** for non-scroll transitions: 120 to 180ms micro, 250 to 400ms reveals, 300ms tab rotate (scene object exception), 600ms receipt collapse, 1.2s the collapse and the final dots, the Snap and Tuesday driven by scroll. Reduced motion respected everywhere.
11. **Icons and avatars**: the product's Lucide set and initials-avatar component for the cast; no stock faces.
12. **The blueprint grid** token (faint, hero stage and the map only).
13. **Focus ring** (blue-200, 2px, 2px offset) on every focusable element in the sandbox, chips, beat rail and forms.
14. **Dark mode**: none on marketing; light only, with the navy chrome as the only dark element.

---

## 14. Open decisions for the founder (each with a recommendation)

1. **Hero H1 control.** "Your people, processes, work and goals. Snapped together." (connection, with the customer's 14 in the eyebrow) vs launching on "Cancel 14 tools. Keep one." Recommendation: connection headline as control, "Cancel 14 tools" as variant B from day one; the quote as variant C once permission exists.
2. **Sandbox at launch.** Gate launch on the driveable shell, or ship the static-plus-hover assembled shell first and add the sandbox in Phase 3. Recommendation: Phase 3; measure the Snap before paying for the sandbox.
3. **Desktop spine length.** Six stops (this document) vs the full eight Tuesday beats pinned. Recommendation: six on desktop, eight on the mobile stepper; per-stop events decide any change.
4. **Free plan vs 14-day trial.** "Start free" and "every connection is one click in the free plan" need a real Free tier; otherwise the copy is "Start free trial" and "Free for 14 days". Recommendation: a real Free tier (Starter free up to a small seat cap), because trial-first at SMB converts better with a free door and the sticky "Start free" label stays honest.
5. **Self-serve signup live at launch (Q11).** Recommendation: yes, with the `cta.primary` flag ready to flip to demo-first the same day if not.
6. **Stop 2's mechanism.** Build SOP step → task with role-resolved owner (and the trail) before the desktop story goes live, or ship with the template fallback narration. Recommendation: build it; it is the spine of the argument and a product feature the roadmap already wants; the stepper and every other section ship meanwhile.
7. **Positioning and currency (Q10).** Recommendation: PPMS / work OS for any business, USD default, geo-detected currency toggle (INR, AED, SGD, GBP, EUR); JSON-LD from the pricing JSON.
8. **Tier names and packaging.** Starter / Growth / Scale per the existing JSON-LD, with Talk and Tables included from Growth. Recommendation: confirm against billing before copy freeze; the pricing JSON makes renaming a data change.
9. **Literal WebGL.** Add the R3F wire layer (unlit spheres and tube wires under the blocks) in Phase 5, or never. Recommendation: never unless the founder, after seeing the CSS 3D Snap on a real device, says it is not crazy enough; the flat 3D is the differentiator against monday's rainbow and Linear's gloss.
10. **Share route.** /tuesday with /snap redirecting, or the reverse. Recommendation: /tuesday; the receipt is the artefact people share and "Tuesday" is the word they will use.
11. **Quote attribution.** Keep "Mohsin S., COO, 280-person services firm" as on the login page, or secure a full name, company and photo. Recommendation: secure written permission for the fuller version and for variant C; until then the login-page attribution, verbatim.
12. **Customers nav link.** Hidden until a real case study exists. Recommendation: hidden; the trust line and the adoption block carry the proof.
13. **Competitor names on /compare.** Recommendation: yes, nominative and factual, no logos in the hero; nowhere else on the site.
14. **Type family for the marketing display scale (Q5).** Recommendation: Inter, so the site and the product read as one material and stop photographing as monday; the token pass owns the final call.
15. **The Watch Tuesday video.** Rendered from the scene at build time (Phase 4) or produced separately. Recommendation: rendered from the scene, so the video, the site and the trial's first screen never drift.
