# WorkwrK UI/UX refresh: Phase 2 (Design) inputs brief

Date: 2026-09-10. Audience: the design agents producing the token spec, shell spec, component sheet, key screens and the marketing page. Sources: `design-references.md` (best-in-class product teardowns, 60+ Mobbin screens, verified contrast math), `marketing-references.md` (site references, conversion evidence, Next.js 16 motion stack), `existing-direction.md` (what is already decided, built, promised, and measured in the repo at `21a21623`). Where the three disagree, this brief picks and says why.

How to read it: section 1 is non-negotiable. Sections 2 to 5 are the recommended direction; design against them unless a founder answer in section 6 changes them. Every section 6 question carries a default so design work never blocks on an answer.

---

## 1. Hard constraints

### 1.1 Brand (fixed)
- Palette YBRG: Yellow `#FFCB00`, Blue `#0073EA`, Red `#FF3D57`, Green `#00C875` (memory `project_workwrk_brand_palette`). These four values are the **brand dots** and appear at full saturation in exactly one place: the four-dot motif (logo, loader, marketing connectors). They are not UI state colours (see 3.3).
- Blue `#0073EA` is the single primary accent. No purple, violet, indigo, pink or taupe as an accent anywhere in product or marketing.
- Monday-clean: generous whitespace, flat solids, no gradients, no glassmorphism, shadows only on popovers, modals and drag ghosts.
- Logo: four dots between the two "k"s. The dots are the only illustration language.
- Target feel: "crazy simple", seamless, any business adopts it with no training. This is the tie-breaker for every design call.

### 1.2 Navigation shell (fixed shape)
- Left icon rail of **8 hubs**, in the code's order and labels: **Work, Planner, AI, Talk, Teams, Docs, Tables, Settings** (`src/components/layout/os/apps-catalog.tsx`, commit `21a21623`). Nineteen apps are folded into hub sidebars via `offRail` (Goals and Timesheets under Work/Planner, Announcements under Talk, Library/Clips/SOPs/Policies/Contracts under Docs, Reviews/Candor/Kudos/Surveys under Teams, Forms under Tables, Automation under AI, Tools/Assets/Build/Marketplace/Trash under Settings). Design may propose relabelling a hub; it may not add a ninth or reorder without a founder decision.
- Rail is **access-derived**, never personal: every user sees every hub they can access, in the admin's order (Settings → Admin → Apps: hide / floor / order). Personal pinning was removed on 2026-08-22 and must not come back.
- Secondary sidebar (sub-sections of the current hub) with the **"Customize Sidebar" footer kept** (appearance, section order, density entry).
- One top bar. Settings is a full-screen takeover with a way back to the app.

### 1.3 Conventions already in force (keep)
- 14px body base, `text-xs` = 13px, hard floor 10px (2026-08-20). This wins over the older parity target of 12 to 13px labels.
- `BackButton{fallbackHref}` on every detail/full-page route; bare `router.back()` forbidden.
- No hover transforms on the hovered element; hover = background/colour/border only.
- One focus ring, `:focus-visible` only.
- Pickers inside a Dialog are `position:absolute` children, never portalled (Radix focus trap).
- Honesty rules: no fabricated data, no silently dead controls, "Coming soon" where the backend is missing, a surface exists only if its backend is wired.
- Tables surface: "does Google Sheets have it?" No selection chrome, letter headers, tiny corner add controls, 1000-row default grid.
- Data integrity: never regress a save/load path; autosave with keepalive + retry and surfaced failures.
- Copy: no em dashes, no double hyphens; commas, colons, periods.
- Shared primitives that stay and get tokenised: `EntityTile`, `MenuItem/MenuList`, `ViewTab`, `Chip/StatusChip`, `BackButton`, `Button`, `OsTitleBar`, `OsEmptyView`, `Dialog`, `MorePortal`, `useAnchorPos`, `DotsLoader/ValueLoader`, `Switch`, `useOsToast`.
- Marked for deletion (do not design around them): `ui/empty-state.tsx` (0 importers), `OsMainTable/OsTabs/OsFilterBar` (1 each), `ui/accent.ts` taupe, `app-shell.css` (no importer), the ~40 per-module BEM CSS families in `os.css` for removed modules (payroll, helpdesk, ITSM, invoices, tickets, procurement).

### 1.4 Tech stack (fixed)
- Next.js 16.2.6 App Router, React 19.2, Tailwind v4 (`@theme`), Radix primitives, Lucide icons, `framer-motion` ^12.38 (Motion v12) already installed. Read `node_modules/next/dist/docs/` before writing code; this Next differs from training data.
- Product tokens live in `src/app/(dashboard)/os.css` as `--os-*`, scoped to `.workwrk-os` and mirrored on `:root` so portals resolve them. This is the **single token vocabulary going forward**; the shadcn `--surface/--muted` set in `globals.css`, the "bento" lime dark palette, and marketing brand tokens inside the app are retired.
- Dark mode today is 147 `:root.dark` rules repainting Tailwind utilities with `!important`. The redesign moves dark mode to token rebinding (the `.os-sk` Sidekick panel already proves the pattern). Any class-name change before the token migration silently breaks dark mode; sequence accordingly.
- i18n: 18 locales wired via `next-intl`, RTL (`ar`, `he`) sets `<html dir>`. Layouts must mirror and survive long German/French strings.
- Marketing: `src/app/(marketing)`, `LandingV4` (12 sections, ~7.4k lines), JSON-LD already present. No 3D libraries installed. `next/dynamic({ssr:false})` works only inside Client Components; every canvas island needs its own `"use client"` wrapper.
- Never run `next build` or a second dev server beside the user's running `pnpm dev`; never broad-kill dev servers.

### 1.5 Process constraints
- The 2026-06-05 **exact-ClickUp-parity mandate** ("copy 1:1, match menu order, stub unbuilt as Soon, never invent surfaces, pull a reference before designing anything visible") is still the rule on record for visible UI. Section 6, Q1 asks the founder to supersede it. Until answered, design agents treat List, Board, Calendar, Gantt and the task detail as **protected parity screens** (restyle with tokens, do not restructure) and everything else as open.
- Mobbin MCP is connected (`search_screens`, `search_sections`); cite a reference screen for every new surface.

---

## 2. The simplicity principles to design against

Ten mechanisms, distilled from Linear, Notion, monday, ClickUp, Asana, Slack and Height. Each is a testable rule, not a mood.

1. **One accent, everything else neutral.** Blue appears only as punctuation: the one primary button per surface, the active rail pill, links, focus rings, checked controls, progress. Never on headers, group bars, tab bars, icons at rest or illustrations.
2. **Chrome recedes, content leads.** Sidebar and top bar are neutral and quiet (Linear 2026: "don't compete for attention you haven't earned"; "structure should be felt not seen"). Softer borders, fewer separators, no cards or tips inside navigation.
3. **One row rhythm on a 4px grid.** 32px for navigation, menus, pickers and compact tables; 36px for data rows at default density. Nothing else. Three different row heights on one screen is what "cluttered" means.
4. **Hierarchy from weight and grey, not size.** Body 14, titles barely larger; emphasis via 590-ish weight and `text.secondary`. Small type, strong contrast.
5. **Progressive disclosure with the correct split.** Primary layer holds only what is used daily (Linear shows 4 task properties by default). Everything else is one click away behind a labelled "+", "…", or "Display". The entry to the secondary layer is always visible and named.
6. **Progressive complexity at the workspace level.** Settings → Modules is WorkwrK's ClickApps: whole capabilities off by default for new orgs. Per-user "Customize Sidebar" hides sections. Simplicity comes from thinning the product per org, not from personalisation alone.
7. **Empty state = one sentence plus one button.** Same template everywhere; no five coloured empty groups (ClickUp's failure mode).
8. **Detail opens beside the list.** Drawer with expand and a real URL; full page is the deliberate second step. Users never lose their list.
9. **Icons carry words.** Rail icons have labels; icon-only buttons only with tooltips and `aria-label`; at most two icons per row; fewer icons overall.
10. **Feedback is quiet and reversible.** Neutral toast, bottom-left, one action (Undo). No green celebration banners, no blocking overlays.

Corollaries for WorkwrK specifically:
- **Trim, do not add.** The 98-item coverage matrix is a backlog, not a spec. A screen that needs a legend is too complex.
- **Reserve slots, not surfaces**, for promised work (see 4.6).
- **Honest and simple are compatible**: hide unbuilt options behind a "Show upcoming features" preference rather than rendering disabled "Soon" rows by default.

---

## 3. Colour, type, spacing, dark mode

### 3.1 Token architecture (the decision)
Three layers, generated in OKLCH so equal-lightness steps look equal (Linear's reason for abandoning HSL):
1. **Primitives**: `neutral.0..900`, `blue.50..800`, plus `green/yellow/red` scales that are **not exported to components**.
2. **Semantic aliases** (what components use): `bg.app / bg.subtle / bg.raised / bg.hover / bg.selected`, `border.subtle / default / strong`, `text.primary / secondary / placeholder / link`, `accent.solid / solidHover / text / bg`, `success.* / warning.* / danger.*` (each `bg / text / solid`), `focus.ring`.
3. **Component tokens** only where a component genuinely deviates (`chip.status.bg`, `rail.active.bg`).

Implementation: keep the `--os-*` **names** (163 files and every post-June primitive already reference them) and **re-point their values** to the ramp below; add the semantic trio as `--os-success-*` / `--os-warning-*` / `--os-danger-*`. Dark mode is a rebinding of layer 2 under `:root.dark` and `prefers-color-scheme`, with zero component-level colour literals. Reasoning: this is the only migration path that does not break the 25% of files already on tokens and lets the other 75% move file by file.

### 3.2 Neutrals: cool, very low chroma
Reason: `#0073EA` is exactly monday's Vibe `--primary-color`, and monday's greys are warm (`#323338`, `#676879`, the current `--os-ink` values). Cool low-chroma neutrals (LCH chroma 2 to 4, slate family not zinc) make the neutrals and the blue read as one material and are the cheapest lever away from "looks like monday". Verified pairs:

| Token | Hex | Role |
|---|---|---|
| N0 | `#FFFFFF` | app background, cards, table body |
| N50 | `#F6F7F9` | secondary sidebar, table header, subtle sections |
| N100 | `#EEF0F3` | hover on rows and menu items |
| N200 | `#E4E7EC` | structural borders, row separators (sparingly) |
| N300 | `#D0D5DD` | input borders, strong dividers, empty-state line art |
| N400 | `#98A2B3` | placeholder, disabled icons (decorative only, 2.58:1) |
| N500 | `#667085` | secondary text, inactive icons (4.97:1 on white, 4.64:1 on N50) |
| N600 | `#475467` | rail inactive labels, tertiary buttons |
| N700 | `#344054` | headings on tinted backgrounds, form labels |
| N800 | `#1F2430` | primary text (15.5:1); never pure black |
| N900 | `#101215` | dark-mode base |

Rules: no text on N200/N300; N400 is decoration only; body text N800.

### 3.3 Blue (the only accent) and the semantic trio
| Token | Hex | Use |
|---|---|---|
| blue-50 | `#EAF3FE` | selected row, active rail pill, info banner |
| blue-100 | `#D4E7FD` | selected + hover |
| blue-200 | `#A9CFFB` | focus ring (2px, 2px offset) |
| blue-600 | `#0073EA` | solid buttons, checked controls, toggles on (white text 4.53:1, AA; keep button labels 14px+/590) |
| blue-700 | `#0B5FC2` | link text and accent text on light (6.12:1), active rail icon |
| blue-800 | `#0A4C9B` | pressed |
| solid hover | `#0062CC` | hover on solid buttons (5.8:1). Replaces `#0060B9` in os.css and `#0060C2` in marketing; one value. |

Semantic (verified contrast; these are the **only** yellow/red/green tokens components can reach):

| Meaning | Light tokens |
|---|---|
| success / done / on track | bg `#ECFDF3`, text `#15803D`, solid `#15803D` with white (5.02:1). Never green-600 `#16A34A` with white (3.30:1 fails). |
| warning / at risk / due soon / in progress | bg `#FFFAEB`, text `#854D0E`, solid `#FACC15` with N800 text only (10.1:1). Yellow never carries white text. |
| danger / overdue / blocked / destructive | bg `#FEF3F2`, text `#B42318`, solid `#D92D20` with white (4.83:1). Replaces the `#E2445C` destructive red. |
| info / neutral status | blue-50 / blue-700 |
| not started / none | N100 / N600 |

Usage rules:
- Colour never travels alone: pair with a word or glyph.
- Status chips are **pale by default** (bg + text). Solid fills are allowed on one dense surface only: the status column in Board list/table views and Tables, where the whole column is solid. (This is also the second monday differentiator.)
- Red is reserved for overdue / blocked / destructive. Priority: urgent = danger glyph, high = N800 filled glyph, normal = N500, low = N400. Not ClickUp's red/yellow/blue flags.
- **No hue-keyed Spaces, Folders or groups by default.** User-chosen icon colours, if they survive (Q6), come from a small muted set that excludes the three semantic hues so a green folder can never read as "done".
- User-defined per-List **status colours** are data, not chrome, and stay; the picker offers a muted 8-colour set rather than the current 10-colour monday palette, and `--os-c-purple/pink/indigo/lime` aliases are deleted.
- Brand dots (1.1) use the brand hexes; UI states use the semantic tokens. The two sets never mix: no `#00C875` in a "Done" chip, no `#15803D` in the logo.
- Charts follow the dataviz skill's brand-neutral palette; the semantic trio appears in charts only when a series genuinely means success/warning/danger.

### 3.4 Type
- **Family**: one grotesk plus one mono. Recommend **Inter** (variable, weights 400/500/600) and drop the other six loaded families (Outfit, Syne, Geist, Geist Mono, Instrument Serif, Figtree; keep JetBrains Mono or Geist Mono for code and formulas). Reason: monday ships Figtree, WorkwrK currently ships Figtree + monday blue + monday greys, which is a clone; Inter moves the reading experience toward Linear/Notion. Q5 lets the founder keep Figtree; the scale below is family-independent.
- **Scale** (14px base wins, half-pixel sizes banned, floor 10): 20/590 page title · 16/590 section and modal titles · 14/400 body and rows · 14/590 emphasised row title · 13/400 helper and secondary · 12/590 group labels, chips and metadata · 11 micro labels · 10 rail labels only. Line-height 1.4 body, 1.25 titles. Letter-spacing 0 (drop the -0.005em). Replace the 14 arbitrary `text-[Npx]` sizes found in 356 files with these seven.
- Marketing: same family, display sizes 48 to 72 at one weight, tight leading, on white.

### 3.5 Spacing, shape, elevation, motion
- 4px grid: 4/8/12/16/24/32/48. Content padding 24 (up from 12). Card padding 16. Modal padding 24.
- Radius ramp: 6 inputs and chips, 8 cards, menus and buttons, 12 modals, full for avatars and pills. Map `--os-r-*` to exactly this and stop using `rounded-2xl/3xl` in the app.
- Borders over shadows. One structural border (N200), one input border (N300). Shadows only: popovers `0 8px 24px rgba(16,18,21,.12)`, modals `0 8px 32px rgba(16,18,21,.16)`, drag ghost same as popover.
- Motion: 120 to 180ms ease-out for state changes; 200 to 250ms for drawers and modals; nothing over 250ms in the app (retire the 300ms `.animate-fade-in` and the 380ms splash fade); `prefers-reduced-motion` respected.
- Loading: skeleton bars in N100 inside content; the four-dot `DotsLoader` in N300/blue-600 only for route transitions.

### 3.6 Dark mode approach
- Light first; marketing is light only.
- Base `#101215`, raised `#181B20`, second elevation `#1F232A`; elevation = lighter surface, not shadow. Borders `#262A31` / `#30353D`, deliberately faint.
- Text primary `#E6E8EC` (15.3:1), secondary `#9AA3B2` (7.4:1), placeholder `#6B7280`.
- Accent: solid buttons keep `#0073EA` (4.53:1); accent text and icons lift to `#4D9CFF` (6.7:1). Never blue-700 on dark. Selected row = `rgba(0,115,234,.14)`.
- Semantic desaturated and lightened: success `#4ADE80` on `#0F2A1A`, warning `#FCD34D` on `#2A2208`, danger `#F87171` on `#2C1212`.
- Delivered as one remapped semantic layer; a "high contrast" toggle raises the contrast variable rather than adding a third theme.
- Kill the 11-accent picker (Q4 default): one brand blue plus light/dark/system. If the founder keeps it, the four purple-family accents (grape, violet, pink, indigo) are removed regardless.

---

## 4. Navigation, back-navigation, detail views, settings IA

### 4.1 Rail (64px, labelled)
- Width 64 (from 60). Each item = 20px outline icon + 10px label, 56px tall hit area, 8px gap. Active = blue-50 rounded-8 pill with blue-700 icon and label; inactive N600. The rail never scrolls; no Upgrade or Invite badges; no workspace avatar at the top (the workspace switcher lives in the sidebar header).
- Bottom cluster: avatar (menu: profile, preferences, theme, log out) and the Settings hub. Settings stays a hub per 1.2 but sits at the bottom.
- Drop the "icons-only rail" option from CustomizePanel: labels are the zero-training mechanism (Slack, ClickUp 3.0).
- Labels: max 9 characters, no two starting with the same word. Current labels pass.

### 4.2 Secondary sidebar (248px, N50)
- Rows 32px, 14px text, one 16px N500 icon per row, counts right-aligned in N500, group labels 12/590 N500 with 24px top margin, active row N100 fill + 590 weight (not blue). Collapsible per group; collapse-to-rail-only remembered per user.
- **Work hub order**: personal rows first (Home, My work, Inbox), then Favorites, then the access-derived Spaces tree (permission-derived, Notion-style). Other hubs open directly on their tree, with the folded apps as labelled sections.
- Nothing promotional inside the sidebar; the only footer is "Customize Sidebar".
- Sidebar tree rows use `EntityTile size="sm"` with neutral tiles by default (3.3).

### 4.3 Top bar (one row, 48px)
- Left: back / forward arrows, then a **hierarchy breadcrumb** (Hub › Space › Folder › List › Item; last crumb plain text, middle truncated with "…" past 4 levels). This absorbs the location bar; there is never a second location row.
- Centre: real search input, 480px, placeholder "Search or jump to…", ⌘K.
- Right: one solid-blue **"+ Create"** (absorbs quick task / doc / reminder / notepad / voice as menu items), the Reminders bell, help, avatar. No row of quick-tool icons. Remove the three floating cards on a zinc ground; the bar is white with a 1px N200 bottom border.
- Below the top bar, the **content header** is a single row: title 20/590 (or `EntityTile lg` + title), then `ViewTabs` inline, then page actions right. Below it one **toolbar row** (40px): Filter, Sort, Group, Display on the left; the view's primary "+ Add task" on the right. That replaces today's title 40 + tabs 34 + filter 34 stack; ClickUp's three stacked rows are the anti-pattern.
- `ViewTab` active colour resolves to **brand** (blue-700 text, 2px blue-600 underline) per the icon-system rule; the zinc-900 underline is retired.

### 4.4 Back navigation
- Three mechanisms, three jobs (NN/g): browser and top-bar arrows for history, breadcrumb for hierarchy, sidebar highlight for persistent context.
- Keep `BackButton{fallbackHref}` on every full page: it is the narrow-width breadcrumb and protects deep links (a user arriving from a Talk message has no history).
- Every drawer has the same URL as its page so "copy link" always works.

### 4.5 How things open (decision table)
| Situation | Pattern |
|---|---|
| Task, table row, person clicked from a list/board | **Drawer** over the list, 520px, own header with expand / copy link / close, same URL as `/item/[id]`. `BoardItemDetail` becomes drawer-first, page on expand. |
| Doc, SOP, goal, review, KRA page | Full page, 680 to 760px content column, breadcrumb + BackButton |
| From search, notification, deep link | Full page (no list to sit beside) |
| Inbox, Talk threads | Split view, list left, detail right |
| Short create/edit (task, list, member, space) | Centred modal 560; rich create with description 720; editors 960 max |
| Confirm / destructive | 400 modal, danger primary only when destructive, typed confirmation for org-level deletes |
| Person or channel info | Right panel, never modal |
No stacked modals. One picker popover component (search-first, 32px rows, glyphs identical to list glyphs, 240 to 280 wide) serves status, assignee, date, label, priority.

### 4.6 Reserved slots for promised work (design the slot, not the feature)
- **AI: one door per page.** The AI hub in the rail is the destination; each content header gets at most one "Ask AI" action slot on the right. No per-board Sidekick panel, no "Ask" on every header, no AI rows in every menu.
- A persistent **call dock region** (bottom-right, above toasts) for Talk's CallDock.
- An **"Automations…"** entry in the existing Space/List "…" menus (in-context modal later).
- Chip styles for **performance band** (AI Performance Manager) and **co-presence** ("Priya is editing").
- A **comment component** that can grow reactions, replies, resolve and assign without a second implementation.
- RTL-safe mirrored layout for rail, sidebar, breadcrumb and drawer.
- A "Show upcoming features" preference that reveals "Coming soon" rows; hidden by default.

### 4.7 Settings IA
Container: keep the full-screen takeover, left list with a filter field on top, "Back to app" top-left. Merge the two doors (Admin + Personal `/account/*`) into one list whose group names say who the setting is for:
- **You**: Profile, Preferences (theme, density, language, week start, date format), Notifications, Security & access, Connected accounts, Sidebar.
- **Workspace** (admins/owners; members read-only where relevant): General (name, logo, Identity: mission & values, timezone), Members, Teams & hierarchy, Permissions & roles, Apps in rail (hide / floor / order), **Modules** (ClickApps-style cards: name, one line, one toggle; new orgs start minimal), Task types, Statuses & templates, Import & export.
- **Governance**: KRA / KPI / OKR cadence, Reviews, SOP publishing, Thresholds. (Q8: fold into Workspace if SMB admins will rarely touch it.)
- **Billing & plan**: Plan, Invoices, Usage.
- Object-scoped settings (Space, Folder, List statuses, sharing) stay in the object's "…" modal and never appear in the global list.
Behaviour: toggles and selects auto-save with an inline "Saved" tick; text-heavy forms use a sticky save bar that appears only when dirty; destructive actions in a bordered "Danger zone" at the bottom with typed confirmation. Forms: labels above, 36px inputs, one primary per form, max 5 fields per card.

### 4.8 Component standards (one spec each; full detail in design-references §6)
- **Tables/lists**: 36 default / 32 compact rows, 32px N50 header with 12/590 N500 labels, no zebra, hairline separators only in tables, hover-only checkboxes, floating bottom bulk bar, "+" column header with "Show more", empty groups collapse to one line, "+ Add task" ghost row last.
- **Kanban**: 280px columns, 12px gap, N50 column bg; cards white, 1px N200, radius 8, 12px padding, no shadow at rest; title (2-line clamp) + max 3 pale chips + avatar; status never on the card.
- **Toasts**: bottom-left, white, 1px N200, one action (Undo), 5s/8s, max 3 stacked, never for validation.
- **Empty states**: 96px four-dot line illustration in N300, 16/590 title, two-line N500 copy, one primary (with shortcut hint), one ghost "Learn more". Filtered-empty = inline "No results · Clear filters". New workspaces get Notion's "Get started with" chip row plus a checklist.
- **Icons**: Lucide outline, 1.5px stroke, 16px in rows, 20px in the rail; colour only for active rail, semantic glyphs, destructive menu items.
- **Loader policy** (Q3 default): mission/values splash on first open per day only; `ValueLoader` becomes a non-blocking caption under the dots for route transitions; no full-screen overlay on navigation.
- **Home** (Q7 default): the Work hub lands on **My work** (date-bucketed: Overdue / Today / This week / Later) rather than the first Space overview.

---

## 5. Marketing concept and motion stack

### 5.1 Concept: "It all connects", shown with the real product
- The 2025-26 winning pattern is **the product is the demo** (Linear, Attio, Cursor, Notion, Framer): real UI working, not screenshots. On Awwwards, scroll-driven narratives outscore static 3D showcases by ~1.8 points; Utsubo's rule is "sell one object properly".
- WorkwrK's one object is the **four dots**. Each module carries one dot with a fixed semantic role (Blue = action: tasks, Talk; Green = done and goals; Yellow = attention and in-progress: SOP steps, reviews due; Red = blocked and urgent). The dots are the only full-saturation YBRG on the page; they connect with blue lines and resolve into the logo.
- Hero headline shape: "[outcome] without [trade-off]", candidate: "Run the whole company from one place. No training required." Hero visual = the real shell (rail → sidebar → top bar) rendered as React, static on first paint, then the dots animate modules into their rail slots. The LCP element is the headline, never a canvas.
- Honest real UI everywhere is both the premium signal and the "no training" proof: a visitor who has read the UI on the site is already onboarded.

### 5.2 Page blueprint (11 blocks, one goal, six CTA placements)
1. Sticky thin nav: logo, 4 to 5 links, Log in, one blue "Start free", ghost "Book a demo".
2. Hero (above), "No credit card" microcopy, text link "See it work (2 min)".
3. Trust strip: real logos if they exist, else honest product metrics; never fabricated.
4. Problem in one screen: "Seven tools. Zero connections." Old way (grey abstract nodes) vs new way (the shell). Abstract nodes depict the problem only; the solution is always named real surfaces.
5. **The story** (the single high-novelty section): scroll-pinned, one piece of work travels task → doc → Talk thread → table row → SOP step → goal/KPI → review; AI appears inside it (an agent nudging the SOP step, a summary in Talk), not as its own section. Mobile: vertical, non-pinned stepper of the same frames, built first (~83% of visits are mobile).
6. Module tour: seven tabs (Tasks, Docs, Talk, Tables, Goals, People, SOPs), each a real surface + one sentence + "Replaces: X, Y".
7. Built for every team: department cards.
8. Proof: metric cards with a named person and company, one long quote; built only once real customers exist.
9. How it works in three steps ("Invite your team, pick a template, work; it just connects").
10. Pricing preview: three cards, annual toggle, per-tier CTA (Start free on lower tiers, Talk to sales on top tier only).
11. FAQ (mirrored in JSON-LD) + security badges (SOC 2 / GDPR once true) + final CTA with the four dots.
TeamWorkspaces, ProductMosaic and AIAgents fold into blocks 5 to 7. Avoid ClickUp's 100-feature wall.

Conversion evidence: single-goal pages ~13.5% vs ~10.5% with competing CTAs; sticky CTA +5 to 15% (+17% mobile); outcome headlines score 14 points higher than feature headlines; trial-first with a demo side door fits a sub-$10K ACV self-explanatory product (median 18% trial-to-paid, hybrid motion is 35 to 45% of B2B GTM in 2026); escalate to demo when a trial user invites teammates.

### 5.3 Brand rules on the site
- `#0073EA` is the only fill for buttons and links; hover `#0062CC`. Retire `--brand-red` as a CTA colour and update the `globals.css` prose that still calls violet the brand.
- YBRG only as dots, status pills, underline accents and story connectors; never section backgrounds, gradients, or mixed in one headline. One light-blue tint stage (`#E6F2FD`) for the story.
- No purple, no mesh gradients, no glassmorphism, no dark sections, no mascots or claymation worlds. Light only.
- Oversized type, generous section padding, a faint blueprint grid at most. Alternate the one high-novelty section with calm interludes (Vercel's novelty mapping); "if it felt pompous or out of rhythm, don't build it".

### 5.4 Recommended motion / 3D stack (Next.js 16.2.6)
- **Tier A, ship first (no new heavy deps)**: product surfaces as React components; Motion v12 with `LazyMotion` (~4.6 KB) for reveals, tabs, layout and `useScroll` effects on transform/opacity only; CSS scroll-driven animations (0 KB, compositor thread, ~85% support) gated by `@supports (animation-timeline: scroll())` and `prefers-reduced-motion`; **GSAP 3 + ScrollTrigger + useGSAP** (~30 KB gz, free since April 2025) for the single pinned/scrubbed/snapped story scene only. No pin on mobile.
- **Tier B, the one bold asset**: **Rive** for the four-dot connect mark and per-module dot state machines (idle / hover / connected); self-host `rive.wasm` under `/public` with preload and immutable caching; lazy-mount via `next/dynamic({ssr:false})` inside a `"use client"` wrapper.
- **Tier C, optional**: one R3F object (four flat `MeshBasicMaterial` spheres snapping into the wordmark) loaded after `window.load`, client-only, DPR capped 1.5, paused offscreen, static WebP on mobile and reduced-motion. Budget ≤ 250 KB gz JS and ≤ 1 MB assets for the island. Not required to hit the brief.
- **Do not**: Spline for the hero (LCP/main-thread threat), Lenis in v1 (hijacked scroll hurts INP), Lottie for anything simultaneous, video as the hero (modal only).
- **Budget**: LCP < 2.5s with headline/real image as LCP, INP < 200ms, CLS 0 via reserved `aspect-ratio`, < ~200 KB gz first-load JS before any 3D island, SSR all copy, `<noscript>` text in canvas wrappers, keep and update JSON-LD (pricing currency and positioning per Q10).
- Instrument all six CTA placements separately before launch so the story scene can be A/B tested.

---

## 6. Open questions for the founder (each with the default design will use)

| # | Question | Default if unanswered | Why it matters |
|---|---|---|---|
| 1 | Does "crazy simple" supersede the 2026-06-05 exact-ClickUp-parity mandate for visible UI? Which screens stay protected? | Yes for shell, settings, empty states, menus, docs, goals, people; List/Board/Calendar/Gantt/task detail are **restyled with tokens but not restructured** | Every chrome collapse, menu trim and drawer decision hangs on this. Precedent: the June 3 "no more feature work until surfaces meet the bar" escalation and the Sep 10 rail consolidation. |
| 2 | Which of the 98 coverage-matrix gaps are now "won't build"? | Design reserves slots (4.6) and draws none of them | Simplicity is a subtraction decision; the working-style rule "build everything" pushes the other way. |
| 3 | Loader: keep the 1.6s mission/values splash on every open, first-open-per-day only, or non-blocking? | First open per day; non-blocking caption elsewhere | A blocking overlay is the opposite of seamless; the founder explicitly asked for it. |
| 4 | Accents: one blue + light/dark, or keep the 11-accent picker? | One blue + light/dark/system; purple-family accents deleted either way | Accent picker contradicts the single-accent and no-purple rules and multiplies dark-mode QA. |
| 5 | Type family: Inter (differentiates from monday's Figtree) or keep Figtree? | Inter | Blue + Figtree + monday greys photographs as monday. |
| 6 | Do user-chosen Space/Folder icon colours survive? If so, which muted set? | Neutral tiles by default; an 8-colour muted set excluding the semantic hues, opt-in | Hue-keyed trees are the biggest visual-noise source and were already rejected once. |
| 7 | Home: first Space overview (parity) or a My work daily driver? | My work (date-bucketed) | "Inbox is the homepage" (May) vs "first Space overview" (June) is undecided in writing; simple needs one landing surface. |
| 8 | Settings: single takeover with You / Workspace / Governance / Billing, or keep two doors? Is Governance its own group? | Single takeover, four groups | Two entrances to one destination is fine; two destinations is not. |
| 9 | Task click target: drawer-first with expand, or page-first? | Drawer-first, same URL | Changes `BoardItemDetail` routing; needs URL-per-drawer before ship. |
| 10 | Marketing positioning and currency: "work OS / PPMS for any business" in USD, or "Business Operating System" for India/UAE/SEA in INR (current JSON-LD)? | PPMS for any business, USD with local currency toggle | Copy, pricing block and JSON-LD depend on it. |
| 11 | Trial readiness: is self-serve signup at app.workwrk.com live with sub-24h time-to-value (templates, sample workspace)? | Assume yes; hero CTA is "Start free" | The trial-first motion depends on it; otherwise "Book a demo" leads. |
| 12 | Proof inventory: real logos, named customers, metrics? | None; trust strip uses honest product metrics, proof block deferred | Never fabricate. |
| 13 | Rive designer or 3D artist available? | No; ship Tier A, plan Tier B | Tier B/C depend on an artist; Tier A does not. |
| 14 | Is mobile (responsive shell) in scope for this refresh? Does RTL need verification now? | Desktop + tablet 1024/768 for the app; mobile-first for marketing; RTL mirrored in the spec, verified later | The current shell cannot collapse; mobile is greenfield, not a restyle. |
| 15 | Coming-soon policy: disabled "Soon" rows visible by default, or hidden behind "Show upcoming features"? | Hidden behind the preference | Resolves the honesty-vs-simplicity tension without dead controls. |
| 16 | Can removed-module pages, models and CSS (CRM, payroll, helpdesk, ITSM, finance, legal) be deleted? | CSS families deleted; routes/models untouched | 34k-line os.css cannot be tokenised while carrying dead modules. |
| 17 | Goals / Timesheets / Reviews placement (core, module, Teams) and Canvas as module or core | Goals core under Work, Timesheets under Planner, Reviews under Teams, Canvas core under Docs (as today) | Decides sidebar sections in three hubs. |

---

## 7. What Phase 2 must produce (so the next phase can build)

1. **Token spec**: the full `--os-*` map (light + dark) with the values in section 3, generated in OKLCH, plus the semantic trio and the retirement list (shadcn set, bento lime, accent overrides, marketing tokens inside the app).
2. **Shell spec**: rail 64 / sidebar 248 / top bar 48 / content header + toolbar 40, with states (active, hover, collapsed, RTL) and the Work-hub sidebar order.
3. **Component sheet**: table row, kanban card, drawer, modal sizes, picker popover, toast, empty state, chip (pale + solid), button, form card, settings row, tokenised versions of the kept primitives.
4. **Six key screens** in light and dark: Work › My work, a Board list view (protected parity screen, restyled), task drawer over the list, a Doc page, Settings › Workspace › Modules, and a hub landing empty state.
5. **Marketing page**: mobile stepper first, then desktop, all 11 blocks, with the story-scene storyboard (7 beats) and the four-dot Rive state list.
6. **Migration order** for engineering: tokens and dark-mode rebinding → type scale → shell → primitives → empty-state and colour sweep → protected screens → marketing.

First visible milestone recommended in the design-references brief and adopted here: the empty-state and colour sweep (every hub landing, every empty list, every "no results"; every yellow/red/green usage re-pointed to success/warning/danger), verified with the same contrast script in dark mode.
