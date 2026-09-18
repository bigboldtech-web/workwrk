# WorkwrK: existing product and UI direction (audit brief)

Compiled 2026-09-10 from a read-only pass over `docs/plans/*` (all 28 files), `docs/PRODUCT_VISION.md`, `docs/POLISH-PLAN.md`, `docs/product/*`, `docs/i18n-and-currency.md`, `docs/compliance.md`, `AGENTS.md` / `CLAUDE.md`, the token section of `src/app/(dashboard)/os.css`, `src/app/globals.css`, the primitives in `src/components/ui/`, the shell in `src/components/layout/os/`, the brand loaders in `src/components/brand/`, and the project memory notes that record founder decisions. Counts below were measured with grep on the working tree at commit `21a21623`.

Purpose: give a redesign team everything that is already decided, already built, or already promised, and flag where those things fight a "crazy simple" direction.

---

## 1. Product vision and target market, as written

There are four vision statements on disk and they do not fully agree. The most recent ones win, but all four still shape code and plans.

### 1.1 The four statements, newest first

| Date | Source | Statement |
|---|---|---|
| 2026-08-14 | `docs/product/getting-started/what-is-workwrk.mdx`, `docs/product/README.md` | WorkwrK is a **People + Project Management System (PPMS)**: a ClickUp/Monday work-management half (Spaces, Folders, Lists, tasks, 17 view types, custom fields) plus a people-and-performance half (Roles, KRAs with weights, KPIs, single-owner goals, a reporting line that decides visibility). Explicitly **not an HRIS, not payroll, not an employment system of record**; those modules "were removed". First audience today is **our own team**. |
| 2026-06-12 | `docs/plans/00-index.md` | "The product is **one connected OS**: a ClickUp/Monday-style PPMS (Space → Folder → Board → Item, with Views) infused with SOPs / KRAs / KPIs / OKRs. Everything is connected (Lego)." Mission: **enhance to full ClickUp parity, remove nothing**. |
| 2026-06-03 | memory `project_workwrk_ppms_scope` | Scope decision: CRM, Marketing, Helpdesk, ITSM, Finance, Legal, Dev removed from the rail. Verticals are assembled from Boards + Notes + Whiteboards + Files + custom fields ("this is our Lego"). Routes and models stay on disk, unlinked. |
| 2026-05-22 | memory `project_workwrk_ai_os_vision` | **AI-run operating system**: "the AI controls the people." Apps as first-class containers, KRA/KPI/SOP-gated entry (later moved to the Role), teams build their own workspace, marketplace. Every surface should ask "what does the AI need to see here, what guarded actions can it take." |
| 2026-05-19 | `docs/PRODUCT_VISION.md` | "The operating system Workday won't sell you": one AI-native platform for **50 to 500 person companies** running HR, work, performance, knowledge, finance and engagement. Six module families (Work, Performance, People, Engagement, Finance, Recruiting and Learning). Design principles: one product feel, AI-native, **Inbox is the homepage**, mobile is real for high-frequency flows, configuration over customization, cohesion over completeness, defaults that work. |

Net direction today: **PPMS chassis at ClickUp parity, with the alignment layer (Roles → KRAs → KPIs → Goals, SOPs) as the differentiator, and AI layered across it.** The Workday-breadth vision is dormant but its pages, Prisma models and CSS are still in the tree.

### 1.2 Target market and competitive frame

- **End clients only, never agencies** (memory `feedback_target_market`, 2026-05-30). No `clientId` scoping, no client switcher.
- Competitors named: **Monday.com, ClickUp, Workday**; later also Lattice/Leapsome for performance. Slack/Zoom (Talk) and Google Sheets/Zoho (Tables) are the reference bars for the two premium modules.
- Size: 50 to 500 employees (vision doc), described elsewhere as SMB to mid-market. Architecture is to be designed "as a Fortune 500 owner with 5 lakh employees" (memory `feedback_working_style`): indexes, cursor pagination, Decimal money, audit everything.
- Pricing frame: below the sum of the tools replaced; deploy in days.
- Modular packaging (2026-08-28, `docs/plans/modular-architecture.md`): **Core** = Work, Planner, AI, Teams, Docs, Library, Forms, Clips, SOPs, Settings. **Premium modules** (off for new orgs, toggled in Settings → Modules): Talk, Tables; Accounting is the future proof-of-pattern. Dashboards **removed**. Goals → core, Timesheets → module, Reviews → Teams are proposed and awaiting confirmation.

### 1.3 Build philosophy on record

- **ClickUp-first, two phases** (memory `project_workwrk_clickup_first_strategy`, 2026-06-05): Phase A mirror ClickUp 1:1 ("they have done the R&D"); Phase B layer SOPs/KRAs/reviews onto that chassis using the same patterns. Phase A is still "in effect" on paper.
- **SaaS to screenshot quality first, marketing captured last** (2026-05-19).
- **Honesty rule** (`docs/product/README.md`, `docs/plans/system-alignment.md`): "a surface may only exist if its backend exists AND is wired." Unfinished apps show "Coming soon", not hidden.
- **Data integrity paramount**: never regress a save/load path; autosave with keepalive and retry; soft deletes; `ContentVersion` snapshots.
- **Integrations demand-driven**; build the in-house product whole first.
- Working style: terse "go" directives, autonomous sequencing, testing deferred to the end, "build everything, do not propose a don't-build list", design each feature from the end user's perspective and keep it "slimmer".

---

## 2. The shell and navigation as they exist today

This is the frame any redesign starts inside.

- **Three-column ClickUp-style shell** (`os-shell.tsx`, rebuilt 2026-06-03): app rail 60px (`--os-rail-w`, `w-[60px]`), secondary sidebar 260px (`--os-side-w`), topbar 32px (`--os-top-h`, shrunk from 44). The comment block at the top of `os-shell.tsx` still says 48/88/280; it is stale.
- **Topbar** = three floating rounded cards on a zinc-100 page ground: workspace switcher + calendar peek (left), search ⌘K (center, max 520px), quick tools + reminders bell + notifications bell + avatar (right). One inbox (`/inbox`, Primary/Other/Later/Cleared) absorbed the old per-module popovers.
- **Rail = 8 hubs** since 2026-09-10 (`21a21623`): Work, Planner, Talk, Docs, Teams, Tables, AI, Settings. About 19 apps were folded into hub sidebars via `AppEntry.offRail` (Goals under Work, Timesheets under Planner, Announcements under Talk, Library/Clips/SOPs/Policies/Contracts under Docs, Reviews/Candor/Kudos/Surveys under Teams, Forms under Tables, Automation under AI, Tools/Assets/Build/Marketplace/Trash under Settings). Nothing deleted, no routes changed. The ⊞ More launcher lists everything by category.
- **Rail is access-derived, not personal** (2026-08-22): every user sees every app they can access, in the admin's order (`OrgPreference.sidebarDefault.apps`). Personal pinning was removed and must not return. `home` and `settings` are `alwaysPinned`.
- **Home** (`/today`) is a server redirect to the viewer's first Space's Overview tab (ClickUp parity slice 1a). The earlier invented `/today` workspace shell was removed.
- **Secondary sidebar footer "Customize Sidebar"** must stay (memory `feedback_customize_sidebar`): it opens the CustomizePanel (appearance, icons-only rail, Home cards, section order, themes and 11 accents, density).
- **Settings = two doors**: Admin (org, server-gated) and Personal (`/account/*`). Full-screen takeover layout.
- **Mission splash loader**: on app open (and at most every 10 minutes on navigation) a full-screen deep-navy overlay shows the org mission or one rotating value for 1.6s then fades (`mission-splash.tsx`). `ValueLoader` (brand dots + rotating value) replaced ~41 in-page spinners and the route-level `loading.tsx`. The founder asked for this; the friction was flagged and is awaiting a call.
- **Portals**: every menu/popover renders through `MorePortal` (33 files) or Radix; `MorePortal` wrappers carry `.workwrk-os` so tokens and dark rules reach them.
- Marketing (`workwrk.com`) and app (`app.workwrk.com`) are host-split (`b7c9d055`); `admin.` back-office exists behind a tenant-role gate that the subdomain plan flags as a security gap still to fix (platform-staff table, cookie domain).

---

## 3. UI/UX decisions and conventions already made

Each entry: the rule, where it is recorded, whether the code actually follows it.

### 3.1 Reference and process rules

| Rule | Source | Status in code |
|---|---|---|
| **Exact ClickUp parity; do not invent surfaces.** Ask for a screenshot (now: pull from Mobbin MCP) before designing any page, header, menu, popover, tab strip, empty state. Match menu items exactly, including order; stub unbuilt items as `disabled + "Soon"` rather than remove. No autonomous "Phase N" shipping for visible UI. | memory `feedback_clickup_exact_parity` (2026-06-05), `docs/plans/ui-parity-roadmap.md` principle 1 | In effect. Folder "…" menu has 16 entries to match ClickUp. Wave 1 to E shipped against Mobbin references. |
| **Honest "Soon", no fake toggles.** Show ClickUp's full option set but wire only what is backed. | `ui-parity-roadmap.md` principle 2 | Applied broadly; "Ask" on board headers is a deliberate disabled Soon button. |
| **No dead controls** (2026-08-31): a control that looks live must do something or not render. `OsEmptyView` renders its CTA only with `onCta`/`ctaHref`. | memory `project_workwrk_ui_conventions` | Applied. Note it partly contradicts the Soon rule above; the resolution in practice is "disabled + labelled Soon is honest, silently dead is not." |
| **A surface may only exist if its backend exists and is wired; a backend earns a surface.** Unfinished apps show "Coming soon", nothing hidden. | `docs/plans/system-alignment.md` decision 1 | Four waves shipped 2026-08-14 killing fakes (API keys, audit feed, identity save, calendar OAuth theater). |
| **One shared primitive per pattern**: context menus, create menus, popovers, pickers, empty states, toasts each route through one component. Any new component without a design-system home is rework. | `ui-parity-roadmap.md` foundations; memory `feedback_visual_design` escalation (2026-06-03) | Partially. See 3.3 and 4.4 for adoption counts. |
| **Verify before ship**: tsc + eslint, render in dev, compare to reference; never `next build` beside the running dev server. | roadmap principle 4, `BUILD-PROMPTS.md` | Process rule; unaffected by redesign. |
| **Design from the actual end user's perspective; output-oriented; slimmer.** | memory `feedback_working_style` (2026-08-28) | Applied to Talk polish, bookmarks, goals redesign. |

### 3.2 Visual language

| Rule | Source | Status in code |
|---|---|---|
| **Monday-clean**: whitespace over color, flat solids, minimal borders, type-driven hierarchy. One accent for primary actions; hue palette only for categorical icons (avatars, department dots, type tags), never for chrome. Cap "stamps" per row at one status pill. Hue-keyed left borders belong on group headers, not cards. Write markup with zero color first. | memory `feedback_visual_design` (2026-06-02, escalated 06-03: "messy", "pathetic", no more feature work until surfaces meet the bar) | Directionally applied since June (violet purge b97e419, flat buttons, de-purpled docs/goals). Still ~18 files use violet/purple/indigo/pink Tailwind classes. |
| **Brand palette "YBRG"**: Yellow `#FFCB00`, Blue `#0073EA`, Red `#FF3D57`, Green `#00C875`. **Blue is the one primary** (`--os-brand`). **No purple/violet for brand. No gradients anywhere.** Logo = four dots between the two k's. | memory `project_workwrk_brand_palette` (2026-06-27) | `--os-brand` default is blue; `--os-c-purple`/`pink`/`indigo` are aliased to blue/red/deep-blue as "banned hue retired." But the CustomizePanel still offers Purple (grape), Violet, Pink, Indigo accents (see 6.6). `globals.css` header comment still says "Single accent: violet (the brand)" although values are blue. |
| **Destructive = `#E2445C`** flat red. | goals-ux-redesign.md, button.tsx | Consistent. |
| **No hover transforms** on the hovered element (translate/scale strobe the cursor). Hover feedback = background/color/border/shadow only. | memory `project_workwrk_ui_conventions` (5f05070, round 2 on 08-27) | Purged twice; rule is live. |
| **Focus**: one ring everywhere, `outline: 2px solid color-mix(brand 45%)` on `:focus-visible` only, none for pointer focus. | `os.css` lines 160 to 174 | Consistent inside `.workwrk-os`. `button.tsx` uses its own `ring-[#0073EA]/40`. |
| **Motion**: `--duration-fast` 150ms, `--duration-base` 200ms, "no 300ms+ anywhere." | `globals.css` | `.animate-fade-in` is 0.3s; MissionSplash fade 380ms; both violate the written rule. |
| **Density**: `--os-row-h` 28px, `--os-row-h-lg` 32px, controls 26px/22px, page and card padding 12px; sidebar tree rows `h-7`; ClickUp target "h-7 rows, 12 to 13px labels." User-level density pref exists (comfortable 44 / compact 32 in globals) plus admin locks. | `os.css` tokens, `ui-parity-roadmap.md` foundations, memory `project_workwrk_design_system` | Measured: `h-7` 481 uses, `h-8` 467, `h-6` 237, `h-9` 210, `h-10` 74. Dense is the de facto standard. |
| **Icon system**: four roles only. Affordance 17px zinc-400 (empty cell prompts), Labeled 14px zinc-400 or entity color, Action 14px zinc-500 in h-7/h-8 controls, Entity tile via `EntityTile`. "On" state uses `var(--os-brand)`, never a hardcoded taupe or flat zinc-900. One icon per concept app-wide (assignee `UserPlus`, due `CalendarPlus`, priority `Flag`, tags `Tag`, more `MoreHorizontal`...). Rail, topbar quick tools and More popover are lucide line icons only. | `docs/plans/icon-system.md`, memory `project_workwrk_design_system` (08-26/27) | Sweep item 1 done; items 2 to 7 (kanban cards, view tabs, board action row, sidebar chevrons, create modals, empty states) listed as pending. |
| **Empty states**: confident tone, "empty is a starting line"; CTA only when wired. | `ui/empty-state.tsx` docblock, `ui_conventions` | Two competing primitives: `ui/empty-state.tsx` (0 importers) and `layout/os/empty-view.tsx` `OsEmptyView` (44 importers). The latter is the real one. |
| **Skeletons**: shimmer default, pulse variant; `SkeletonCard/Row/Table/Grid/PageSkeleton`. | `ui/skeleton.tsx` | Exists; loaders were largely replaced by `ValueLoader` dots in September. |
| **Writing**: no em dashes, no double hyphens in copy; commas, colons, periods. | memory `feedback_no_double_dashes`, `docs/product/README.md` | Applies to every label and empty-state string. |

### 3.3 Type scale

- **2026-08-20 readability lift** (memory `project_workwrk_ui_conventions`, `globals.css` header): body base **14px** (was 13). Every hard px size was rescaled one step up (10→11 ... 13.5→14.5), **floor 10px**. `text-xs` overridden to **13px** (`0.8125rem`) via `@theme`. Rule for new code: rows/body 14, secondary 13, metadata 12, micro-labels 11, never below 10.
- `globals.css` also declares "four blessed sizes": `--text-heading` 18, `--text-body` 14, `--text-small` 13, `--text-caption` 11, "anything outside the scale should justify itself."
- Bare headings in `@layer base`: h1 1.25rem, h2 1.1rem, h3 0.95rem.
- Font: OS shell uses **Figtree** (`--os-font`), letter-spacing -0.005em, antialiased. Marketing body uses **Outfit**. Root layout loads **seven** families (Outfit, JetBrains Mono, Syne, Geist, Geist Mono, Instrument Serif, Figtree).
- Reality (measured across 659 tsx files): **356 files use arbitrary `text-[Npx]`** with 14 distinct sizes. Frequency: 13px (837), 14px (813), 12px (621), 11px (438), 13.5px (420), 12.5px (197), 10px (144), 11.5px (129), 15px (98), 14.5px (43), 16px (25), 20px (24), 17px (12), 26px (8). Plus `text-xs` 737, `text-sm` 657, `text-lg` 81, `text-base` 77, `text-2xl` 50, `text-xl` 42, `text-3xl` 15. The "four sizes" rule is aspirational; the half-pixel sizes (13.5, 12.5, 11.5, 14.5) are a fingerprint of the ClickUp-copy era and the +1 rescale.

### 3.4 Shared primitives (what exists, where, adoption)

| Primitive | File | Contract | Importers |
|---|---|---|---|
| **EntityTile** | `ui/entity-tile.tsx` | The one icon square for Space/Folder/Board/Doc/Whiteboard/Table/View. Sizes xs 16 / sm 18 (sidebar) / md 20 (breadcrumb) / lg 36 (page header); radius 4/5/6/9; glyph ~60%. Accepts catalog icon name, lucide component, emoji, or falls back to first letter. Colored chip look (restyled to outline icons 08-26, reverted 08-27: the "lined icons" mandate was rail + topbar + More only). | 15 |
| **MenuItem / MenuList / MenuSeparator / MenuSectionLabel / MenuSubmenu** | `ui/menu.tsx` | The one option row for every dropdown, "…" menu, create popover, context menu, picker. Flush row: gap-2.5, px-3 py-1.5, 13.5px, 14px icon. Inset row: rounded-lg px-2 min-h-9, 14px, 16px icon, optional description. Must render inside a portal (global button reset strips chrome otherwise). Section label 11.5px uppercase zinc-400. Panel: white/`#1B1F26`, rounded-xl, border zinc-200, `shadow-2xl`. | 37 |
| **ViewTabStrip / ViewTab** | `ui/view-tabs.tsx` | Underline tab strip: 13px semibold, gray idle / zinc-900 active, 2px zinc-900 underline, per-view colored icon that goes mono when active, optional colored icon tile. For primary underline strips only; pill/segmented controls and Radix `<Tabs>` are out of scope. | 10 |
| **Chip / StatusChip** | `ui/chip.tsx` | Toolbar pill: 30px tall, rounded-lg, bordered; idle/active/danger; icon size. StatusChip = same silhouette tinted from one hex (8% fill, 20% border, dot + uppercase 13px label). | 2 (memory says it was applied to create-task/create-list modals) |
| **TAUPE accent** | `ui/accent.ts` | `#9d7d70` family for task-creation surfaces, deliberately separate from the brand ("mirrors the brown ClickUp reference"). Backed by `.btn-taupe` in globals. | 7 |
| **BackButton** | `ui/back-button.tsx` | `{fallbackHref, label?}`: browser back when history exists, else push to the natural parent. Every detail/full-page route gets one; **bare `router.back()` is forbidden**. | 4 (plus 2 remaining bare `router.back()` calls) |
| **Button** | `ui/button.tsx` | Monday-clean: flat brand blue `#0073EA` default, flat red destructive, neutral outline/secondary/ghost, link; sizes 36/32/44-pill/36-icon; 8px radius; `shadow-sm` ceiling; `active:translate-y-px`. Uses raw hex and `slate-*`, not tokens. | 50 |
| **OsTitleBar** | `layout/os/title-bar.tsx` | The page header (title, breadcrumb, people, `actions` slot). | 68 |
| **OsEmptyView / OsAiPreviewView** | `layout/os/empty-view.tsx` | The real empty state; CTA only when wired; "Ask Sidekick" hook. | 44 |
| **OsMainTable, OsTabs, OsFilterBar** | `layout/os/*` | Generic chrome from the May polish era. | 1 each (effectively legacy) |
| **MorePortal** | `layout/os/more-portal.tsx` | Body portal for menus; wrapper carries `.workwrk-os`. | 33 |
| **Dialog** (Radix) | `ui/dialog.tsx` | Flat scrim `bg-black/40`, centered via transform. **Pickers inside a dialog must be `position:absolute` in a relative wrapper, never fixed/`useAnchorPos`, and must not portal** (focus trap). | widely |
| **useAnchorPos** | `board-view/use-anchor-pos.ts` | Viewport-aware both axes; returns `{left, maxHeight, top XOR bottom}`; consumers must spread conditionally and cap height. Nine consumers. | 9 |
| **Kbd** | `ui/kbd.tsx` | `dash-kbd` styled key caps. | small |
| **Switch** (one primitive), **useOsToast**, dialog-provider, confirm/prompt dialogs, `AutosaveIndicator`, `Breadcrumbs`, `Section`, `FormRow`, `Badge`, `Card` (default/interactive/hero) | `ui/*` | Present. `Card` and `Skeleton` use the shadcn token vocabulary (`bg-surface`, `border-border`). | mixed |

### 3.5 Surface-specific rules that constrain layout

- **Tables** (memory `feedback_tables_sheets_surface`, 2026-08-22): the bar is "does Google Sheets have it?" No row checkboxes, no select-all, no floating "N selected" pill, no chevron open-row, no per-column hover menus. Gutter = plain grey row numbers (click selects, shift extends, drag moves). Headers are pure letters. New sheet is A to Z × 1000 rows. Add controls are a tiny corner plus; growth auto-appends. Number format lives only in the toolbar ($ % 123).
- **Board List/Table view** (Wave 1, 2026-08-05): solid status-pill group headers (white on status color) with counts, column labels repeated per group, labeled toolbar ("Group: Status", "Subtasks", "Columns" + count; Filter/assignee/sort/search/Statuses/Fields/+ Task), dark floating bulk bar. Monday table variant keeps colored group rails, full-cell status chips and per-group summary footers (kept on purpose as a Monday strength).
- **Kanban**: solid status-pill column headers, cards without created-date footer, "Add Task" labels.
- **Calendar**: tinted chips with left color edge + assignee avatar, weekend tint, adjacent-month grey, 4 chips per cell. **Gantt**: two-tier month band, rose today bubble, 24px bars with resize handles, floating zoom stack, backlog panel.
- **Task detail** (drawer + `/item/[id]`): type chip, title, two-column field grid (Status/Dates/Estimate/Track | Assignees/Priority/Tags/Alignment), description, subtasks/relate/checklist/attach, Comments + Activity tabs, solid status pill with "›" advance and ✓ complete, collapsible Custom Fields, Ask Brain strip. Multi-assignee picker shipped 2026-09-09.
- **Sidebar tree**: rows h-7, `EntityTile size="sm"`, active pill, no guide lines, zinc icons, leaf rows `pl-6`; hover cluster (star, "…", "+") still on the to-do list to "match ClickUp exactly."
- **Create modals**: one shared shell (862603e), dark pills, blue focus ring, icon tiles `h-7 w-7 rounded-[8px]`; `space-create-popover` is the north star.
- **Goals** (2026-09-07 redesign): sidebar = My Goals / Team Goals (manager only) / My KRAs & KPIs; no star/favorites; plain "Company" band; automated Effort card from linked work; ClickUp purple → brand blue. Goal detail mirrors ClickUp: neutral hero, large progress ring, Targets card, Timeline card.
- **Docs**: breadcrumb header, Ask/Share, 32px title, font cards System/Serif/Mono, bottom word-count pill, Pages panel on the left, share modal with permission levels.
- **Talk** (`/tlk`): Slack two-pane; huddle chips; calls on our own LiveKit; persistent CallDock planned (see 5).
- **Canvas** (`/canvas`): first-party engine with Excalidraw parity, system-design kit, ER tables, AI chat panel that generates diagrams, on-canvas right-click.
- **Settings**: All-settings nav, 16px headers, blue cards; two doors.
- **Inbox**: Primary/Other/Later/Cleared, Filter, gear, Clear all, hover clear/snooze, date groups.

---

## 4. Design tokens: what exists and how consistently it is used

### 4.1 Two token vocabularies coexist

**A. `src/app/(dashboard)/os.css`, the `--os-*` system** (scoped to `.workwrk-os`, also on `:root` so portals resolve them). This is the intended product system.

- Brand: `--os-brand #0073EA`, `-hover #0060B9`, `-soft #E6F1FB`, `-deep #1F76C2`, `-dark #292F4C`, `-rail #1A2C4A` (desaturated rail tone), `-ink` (accent as text; flips light in dark).
- Status palette (Monday signature): `--os-c-green #00C875`, `orange #FDAB3D`, `red #E2445C`, `yellow #FFCB00`, `blue #579BFC`, `teal #66CCC2`, `brown #7F5347`, `sage #037F4C`, `gray #C4C4C4`, `darkgray #808080`; `purple`/`pink`/`indigo`/`lime` are retired aliases pointing at blue/red/deep-blue/sage.
- Surfaces: `--os-canvas #FFF`, `--os-surface #FFF`, `-1 #F6F7FB`, `-2 #ECEEF5`, `-3 #E6E9EF`, `-hov #F0F3FA`, `--os-row-hov #F8F9FD`.
- Lines: `--os-line #E6E9EF`, `-soft #F0F2F7`, `-strong #D0D4DC`.
- Ink: `--os-ink #323338`, `-2 #676879`, `-3 #9699A6`, `-4 #C4C7D4` (Monday greys).
- Radii: `--os-r-xs 4`, `sm 6`, `md 8`, `lg 12`, `xl 16`, `pill 999`.
- Shadows: `--os-shadow-card` (3px/10px + 1px ring), `-pop` (10px/26px + ring), `-rest` (1px hairline).
- Layout: rail 60, side 260, top 32, title 40, tabs 34, filter 34. Density: page/card pad 12, row 28/32, control 26/22, popover 300.
- Type: Figtree, 14px, 400, -0.005em.
- 11 **accent overrides** keyed by `:root[data-accent=…]`: mint, black, grape (purple), blue, pink, violet, indigo, orange, teal, bronze (and a legacy "purple" normalized to grape). Each redefines brand/hover/soft/deep/rail.
- Dark: `:root.dark .workwrk-os` sets ground `#0F1115`, ink `#E5E7EB`; the Sidekick panel (`.os-sk`) rebinds the surface/line/ink tokens; everything else is handled by **147 `:root.dark` rules that repaint Tailwind utility classes with `!important`** (`.text-zinc-600 → #C7CCD4 !important`, `.bg-white`, `.border-zinc-200`, attribute-selected asides, `[role=dialog]`...). 155 `!important` declarations in the file.

**B. `src/app/globals.css`, the shadcn-style system** (root, unscoped). Written for the May 2026 "Phase B revamp":

- `--color-background/foreground/surface/surface-2/surface-3/border/muted/muted-2/accent`, `--surface`, `--surface-elevated`, `--accent #0073EA`, `--accent-soft`, `--accent-glow`.
- Four **signal** colors (success/warning/danger/info) as fg/bg/border triplets.
- The four blessed text sizes, leading, motion, density (44/32), scrollbar.
- Marketing brand tokens (`--brand-red #FF3D57` primary on the marketing site, `--brand-blue`, `--brand-yellow`, `--status-*` including `--status-special` purple `#A25DDC`).
- A **"Bento" dark design system** with a lime accent (`--color-lime #d4ff2e`) and the dark avatar fallback in lime. This is a third visual language that leaks into the app in dark mode (`.dark .avatar-fallback-tone`).
- The header comment still says "Single accent: violet (the brand)"; the values were switched to blue without updating the prose.

**C. Tailwind utility palette** (`zinc-*`, `slate-*`) used directly in most components, with dark handled by the `!important` repaint layer above.

### 4.2 Adoption measured across `src/components` + `src/app` (659 tsx files)

| Signal | Files | Read |
|---|---|---|
| use `var(--os-…)` | 163 (25%) | the intended system |
| use `zinc-*` classes | 282 (43%) | the de facto system |
| contain raw `#rrggbb` | 255 (39%) | hardcoded color |
| use shadcn tokens (`bg-surface`, `text-muted`, `border-border`, `text-foreground`) | 96 (15%) | the May system, still live |
| use `gray-/slate-/neutral-*` | 41 | palette drift |
| use `violet/purple/indigo/pink/fuchsia-*` | 18 | banned hues |
| use arbitrary `text-[Npx]` | 356 (54%) | scale not enforced |
| use arbitrary `rounded-[Npx]` | 20 | fine |
| `rounded-*` histogram | md 1083, lg 661, full 587, bare 521, xl 309, 2xl 87, sm 22, 3xl 7 | effective radius ramp is 4/6/8/12/16 + pill; `--os-r-*` tokens are not what components reference |

Also: `os.css` is **34,235 lines / ~11,263 rules**, with ~845 `.os*` class families plus ~40 per-module BEM families from the May per-page polish (`.bdoc` 381 rules, `.brow` 237, `.sop` 179, `.cnd` 163, `.hd` 132, `.pos` 118, `.mkt` 117, `.dtbl` 117, `.mtgr` 116, `.bn` 115, `.hdcd` 103, `.okrd` 102, `.skl` 101, `.dept` 99, `.inv` 98, `.ann` 98, `.pyrl` 97, `.evts` 94, `.myl` 93, `.rvw` 92, `.hdq` 91, `.incd` 88, `.kbg` 85, `.ppl` 83, `.tckd` 81, `.pyrr` 81, `.ntk` 80, `.pyrd` 79, `.tckl` 78 ...). Several of those families belong to modules removed from the product in June (payroll `.pyr*`, helpdesk `.hd*`, ITSM `.incd`, invoices `.inv`, tickets `.tck*`, procurement `.pos`). `app-shell.css` (2,741 lines) has **no importer** and is on the system-alignment dead-file list.

**Verdict.** The `--os-*` token set is complete and well chosen (Monday greys, one brand, a status palette, a radius ramp, layout constants), and the primitives written since June do use it. But three quarters of files do not; the dominant idiom is Tailwind zinc plus arbitrary pixel sizes plus raw hex, and dark mode exists only because a 150-rule `!important` repaint layer chases those utilities. Any redesign that changes class names without moving to tokens will silently break dark mode.

### 4.3 Internal inconsistencies worth knowing before touching anything

- **Active-state color**: `ViewTab` active underline is `zinc-900`; `icon-system.md` says active/selected = `var(--os-brand)`; the roadmap logged view tabs as "verified vs Mobbin". Two truths.
- **Button** uses raw `#0073EA` and `slate-*`; **Chip** uses `zinc-*`; **MenuList** hardcodes dark hexes `#1B1F26`/`#2A2F38`; **BackButton** uses `--os-*` tokens. Four primitives, four vocabularies.
- **Taupe** task-creation accent is documented as intentional and separate from brand; it contradicts the single-accent rule and the icon-system line "never a hardcoded taupe hex."
- **Accent picker** offers Purple, Violet, Pink, Indigo although the brand rule bans purple; the roadmap explicitly records the demo account's purple as a "legit theme-picker option."
- **Density**: os tokens say row 28px; globals says compact 32 / comfortable 44; the user density pref writes to `OrgPreference`. Three numbers.
- **Font families**: seven loaded, one used in the app.
- **Motion**: written cap 200ms; several 300ms+ animations exist.
- **Shell comment vs tokens**: 48/88/280 vs 32/60/260.

---

## 5. Planned but unbuilt (or half built) work a redesign must leave room for

Grouped by area. "Shipped" items are listed only where a follow-up is still promised.

### 5.1 Work chassis (boards, tasks, views)
- **Comment thread upgrade**: reactions, threaded replies, resolve, assign-comment-to-person, @mention typeahead in the task composer. Coverage matrix calls it "our biggest collab gap"; the Assigned Comments page is permanently empty until `ItemUpdate.assigneeId` exists.
- **Filters**: multi-rule Where/operator/value builder with AND/OR and nesting, saved named filters, live "Showing N of M" count, active-filter-count chip. (Board filter rules + saved filters shipped in Wave A; the toolbar chip, nesting and "save as view" are open.)
- **Toolbar chips** on every view: Group-by-any-field, Subtasks expand toggle, Closed toggle.
- **Table view**: row-number gutter; searchable column checklist; column pinning.
- **Kanban**: customize-card-fields side panel, cover image column, lane count badges.
- **Timeline/Workload/Team**: per-person cards with donut and collapsible status groups; workload capacity settings need per-person weekly hours (data prerequisite).
- **Sprints**: Sprint Points field with fibonacci picker, velocity/burndown widgets.
- **Mind Map view**, required-views admin modal, default view templates (low).
- **Bulk bar / row menu**: Sprint Points, Merge, Convert to subtask, Watchers.
- **Activity view**: day headers, per-task grouping, type filter; item activity log filter and old → new rendering.
- **Everything view** shipped at `/everything`; the ClickUp "All Tasks" sidebar row above Spaces is still listed.
- **Task Types** edit control; Tags update/delete (create-only today).
- **Template Center**: preview thumbnails, Use-case/Tag/Created-by filters, counts, 30 to 50 seed library, audience-scoped save-as from the doc editor.
- **Import**: competitor importers (ClickUp/Asana/Trello/Monday) with a staging/validation grid and job history; workspace CSV export.
- **Attachment lightbox** with download, later proofing pins; external attachment sources (Drive/Dropbox/Box/OneDrive) behind connectors.
- **Legacy `Task` table** still feeds `/analytics`, the performance score and `/api/tasks/workload`; migration to `Item` is tracked debt.

### 5.2 Alignment and performance
- **AI Performance Manager** (`docs/plans/ai-performance-manager.md`, proposed 2026-06-17): `PerformanceSnapshot` model; deterministic 30/20/30/10/10 score; surfaces `/team/performance` (ranked cards with band chips and ▲▼ trend, manager+ only), `/team/performance/[userId]` scorecard with drill-through, `/me/performance` (own band + top-performer callouts only), a review queue reusing `/team/reviews`. Coverage matrix maps ClickUp's "Productivity Points" leaderboard widget onto this.
- **KRA weight in scoring**: displayed, not used; `weightWarning` returned by the API but no UI reads it.
- **Goals**: per-goal Sharing & Permissions; completion celebration; Effort attribution decision (linked Boards/Spaces + KRA tasks); keep three levels as plain bands; Team Goals sub-tree vs direct reports filter.
- **Talent 9-box** still not fed by calibration.
- **Operating core Phase 2** (memory `project_workwrk_operating_core`): Queues, Automation Rules, work-type report, `RoleInstanceOverride` editor, full Teams redesign (alignment/rollup/directory), "Raise request" as a tracked item. Phase 1 (Scope/RoleInstance/OwnershipArea/RoleBoundary/Threshold + Role Definition page) is built but its migration was pending as of July.
- **Kudos**: leaderboard API has no UI (values now drive the chips).
- **Clips**: either build record-screen → gallery → viewer with timestamped comments, or relabel the rail item "Notetaker" (rail promise currently misleading).

### 5.3 Modules and platform
- **Modular architecture**: Goals/Timesheets/Reviews placement decision; Accounting as the next module; plan-tier gating before activation; public `/embed/tables` behaviour when a module is disabled; command-palette recents for disabled modules.
- **Tables 4a to 4h** (Zoho parity): data validation (dropdown/pick-list/checkbox/range, reject vs warn), ~150 functions incl. **array formulas / spill** (design in `array-formulas-spill.md`, paused), conditional formatting v2 (color scales, data bars, icon sets), named ranges, pivot tables + charts + slicers, cell/range/sheet locking + audit trail, row soft-delete + Trash, AI ("clean this column"). Phase 5: aggregate footer row, row grouping, persisted view filters, optimistic-concurrency guard, 20s co-presence chip ("Priya is editing"), 50k rows (blocked on a persistent engine host).
- **Talk**: Phase 6 SSE + typing indicators (gated on measured load); native calls Phase 4 (reactions, raise hand, grid/speaker toggle, PiP, recording via Egress, noise suppression); **persistent CallDock** (one `CallPanel` mounted in `os-shell`, minimized draggable floating window, navigating auto-minimizes); message toasts with avatar + action buttons (extend `ui/toast.tsx`); incoming-call ring toast with Join/Dismiss; per-space **bookmarks** replacing the disabled stub; Space-linked channels (`spaceId` column ready); `FileEntry.s3Key` re-presign migration.
- **Canvas**: Phase 4 real-time multiplayer (Yjs over Talk's transport, presence cursors); Phase 5 templates library, PDF export, embed-a-canvas-in-a-doc (interactive vs static decision), AI "turn this sketch into tasks / summarize this board"; Phase E internal `Whiteboard → Canvas` rename (deferred on purpose); module-or-core decision for Canvas.
- **Automation Hub** is live (Wave E) but: only 5 of 16 triggers fire (task.created, kpi.recorded, kudos.created do not fire from the app); coverage matrix asks for an **in-context Automations modal** opened from a Space/List (Browse recipes / Manage / Usage / Activity / Webhooks / Recurring) and Monday-style fill-in-the-blank sentence recipes; schedule triggers + email report action; agents as automation actions; workspace-level automations kill switch in Settings.
- **AI**: "Create with AI" and "Super Agent" entries open an agent builder that awaits founder detail; `/agents` and `/store` are hardcoded ("Coming soon"); per-board Sidekick panel is the AI-OS pattern; "Ask" on board headers is a Soon button; AI-fill columns and Ask-AI search rows are ClickUp features listed as AI-area scope; AI project-update dashboard card.
- **Dashboards** were removed as an app (modular plan Phase 2; no `dashboards` catalog key today) although `docs/product/reference/status.mdx` (08-14) still lists them as Built; board-level Dashboard view and Space Overview grid remain. Widget "…" menus, chart drill-down, Battery widget were coverage-matrix asks before removal.
- **Subdomain split**: platform-staff allowlist table + gate on `(admin)/layout` and every `/api/admin/*`; `.workwrk.com` cookie domain; admin back-office pages (5) never polished.
- **Settings**: Spaces admin inventory; ad-hoc Teams with @alias; per-user locale/timezone/format + high-contrast toggle; advanced content-policy toggles (private-by-default, request access, public-sharing kill switch); import history with progress/cancel; upgrade page + plan comparison + Stripe-hosted checkout; billing tabs (invoices, add-ons); permissions matrix consolidation (10 of 439 routes consult it; four parallel role ladders); `/settings/api` server gate; density/sidebar lock greying in the Personal door; Offices viewer.
- **Docs**: inline "Improve" AI rewrite, Page Styles panel (font size, header toggles, focus mode, stats), wiki flag + verified badge + search weighting, relationships panel + "Link Task or Doc" chip, PDF/HTML export, Notion/Confluence/Word import, live board/table embed block, page drag-reorder, guest email invites, comment-write gate on restricted docs, 200-row hub cap.
- **Forms**: builder inline in the board Form view (Build/Settings/Preview), more field types (People/Uploads/Rating/Voting/Progress/Signature/Contact/Info block), map-to-task-property, Start/End pages, branding (logo/accent/backdrop), success message/redirect, link expiry, embed snippet UI.
- **Search / command palette**: per-result hover actions (Ask AI, copy link, open new tab), sort control, command mode with typed aliases, **keyboard-shortcuts overlay** (`?` / ⌘/) and the dead `/settings?tab=shortcuts` link; connected-source chips should gate behind Connect or hide.
- **Notifications**: `notifyItemsDueToday` needs a scheduled caller; prod cron rows (reminders, send-reminders, okr-reminders) must be added by hand; `mentionedUserIds` not persisted; topbar quick-capture shortcut collision on macOS.
- **Public share primitive** (expiry/rotation/audit) for SOP and doc links.
- **i18n**: 18 locales including **RTL (`ar`, `he`) set on `<html dir>`**, 21 currencies, `next-intl` with `messages/*.json`; the OS chrome must survive RTL mirroring and long German/French strings. **Compliance** consent banner and DSR endpoints live on the marketing side only.
- **Mobile**: the vision says clock-in/time-off/kudos/approvals must work on a phone; the parity roadmap checks 1024px and 768px; no mobile plan exists beyond that, and the current shell (rail + 260px sidebar + dense 28px rows) is desktop-only.
- **Multi-workspace**: a workspace switcher exists but the product is single-org; flagged as an architectural decision before mid-market.
- **Documentation**: every wave is to be documented on documentation.ai; `changelog.mdx` there is a fabricated placeholder awaiting cleanup.

### 5.4 Recently shipped things a redesign must not regress
Live board polling for teammates' changes (`1ceb9c9f`), multi-assignee data model + picker (`43371422`, `638e9d6f`), additive List/Folder access grants (`d8ab2454`, `9832f926`, `2e6fbbbb`), auth hardening wave (MFA at login, idle sessions, lockout, token version), marketing/app host split, rail consolidation (`21a21623`), single loader on refresh (`bc65f678`), Team Goals by-person rollup (`ae12aa28`), culture values in loaders and Kudos.

---

## 6. Where the recorded direction conflicts with a "crazy simple" redesign

Ranked by how directly each blocks simplification.

1. **The exact-parity mandate is a mandate to add, not subtract.** "Copy ClickUp 1:1, match every menu item and its order, never remove an item because the backend is missing (stub it as Soon), no invented surfaces, ask for a screenshot before designing anything visible" (2026-06-05, `ui-parity-roadmap.md` principle 1 and 2, `BUILD-PROMPTS.md` preamble). A simple redesign is by definition an invented surface with fewer items. This is the single decision that has to be renegotiated explicitly with the founder before any pixel moves, because it is recorded as superseding the "go, don't stop" directives for UI work.

2. **The coverage matrix is a 98-item backlog of surfaces to add** (66 partial + 32 missing, `coverage-matrix.md`), and the plans describe ClickUp-parity chrome in detail: 16-entry folder menus, three-row toolbars, condition builders, Page Styles panels, widget overflow menus, Sprint Points pickers, Template Center filter rails. Simplicity means deciding which of these the product will never build; the founder's working style ("build everything in the suite, don't propose a don't-build list") pushes the other way.

3. **"Show with Coming soon, nothing hidden"** (system-alignment decision 1) keeps disabled controls on screen: the board "Ask" button, "Soon" rows in notification settings, coming-soon integrations, greyed module rows. A simple UI hides what does not work. The two rules are already in tension with the 2026-08-31 "no dead controls" rule; the current compromise (labelled-disabled is honest, silently dead is not) still spends chrome.

4. **The three-column shell stacks five chrome bands** (topbar 32 + title 40 + view tabs 34 + filter bar 34, plus the 60px rail and 260px sidebar) over 28px rows. This is ClickUp's density and the parity work verified it against Mobbin. "Crazy simple" would collapse bands (title + tabs + toolbar into one row) and loosen rows; both changes contradict verified-parity surfaces and the "h-7 rows, 12 to 13px labels" foundation item.

5. **The mission/values loader gates the app.** By explicit ask, every app open (and navigation at most every 10 minutes) shows a 1.6s full-screen overlay, and ~41 in-page spinners now caption a rotating value. A simple product removes blocking splash screens. The friction is already flagged and awaiting the founder's call; the redesign must take a position (non-blocking toast, first-open-only, or keep).

6. **Customization surface must stay.** The "Customize Sidebar" footer + CustomizePanel (memory `feedback_customize_sidebar`) carries 11 accents (four of them purple/violet/pink/indigo, contradicting the no-purple brand rule), icons-only mode, Home card visibility, section order, density, light/dark, plus admin defaults and locks (`/settings/defaults`). A simple product ships one accent and light/dark. Cutting accents is a founder call, and dark mode currently depends on the `!important` repaint layer regardless of accent.

7. **Two design languages by design, three by accident.** Boards (ClickUp), Tables (Google Sheets: letter headers, formula bar, `$ % 123` toolbar, no selection chrome), and the residual May-era per-page "bespoke design" (`POLISH-PLAN.md` execution rule 2: "each page = its own bespoke design") that left ~40 module CSS families and generic `OsMainTable/OsTabs/OsFilterBar` chrome. Monday-clean (June) superseded bespoke-per-page, but the CSS and many People/Knowledge pages were never rebuilt. A single simple language requires deleting the bespoke layer, and the "keep removed pages on disk / build everything" instinct resists deletion.

8. **Token debt makes incremental simplification unsafe.** Two token vocabularies (`--os-*` vs shadcn `--surface/--muted`), a third "bento" lime dark palette, seven fonts, 14 arbitrary text sizes against a four-size rule, 255 files with raw hex, and dark mode implemented as 147 `!important` utility overrides. Any redesign has to pick one vocabulary and migrate before it can safely touch class names; a "just simplify the screens" pass will break dark mode and accents.

9. **Two density targets are on record**: the 2026-08-20 "one step up" readability lift (14px base, floor 10) versus the parity foundation "audit against ClickUp: h-7 rows, 12 to 13px labels." The half-pixel sizes (13.5, 12.5, 11.5) are the residue of both. Simple means one scale; the redesign must state which target wins.

10. **Taupe vs blue.** The chip system's taupe accent for task-creation surfaces is documented as deliberate ("don't fix to brand"), while the brand rule, the icon system and the button primitive say one blue accent. Seven files still import `TAUPE`.

11. **Active-state treatment is split**: `ViewTab` uses a zinc-900 underline (verified parity), `icon-system.md` says brand blue for any "on" state. Pick one.

12. **AI-everywhere vision.** "Every surface: what does the AI need to see, what guarded actions can it take"; per-board Sidekick panels; Ask buttons on boards, docs, tables; Create-with-AI and Super Agent in the "+" menu; an AI chat panel on Canvas; AI-fill columns and Ask-AI rows in search on the parity list. A simple product gives AI one door. The redesign needs an explicit AI placement budget or it inherits an AI affordance on every header.

13. **Access-derived rail forbids hiding complexity per person.** Every user sees every app they can access, admins see the most, and personal pinning is banned. The new 8-hub rail helps, but hub sidebars now carry the folded apps as sections, so the admin's Docs sidebar lists Library, Clips, SOPs, Policies, Contracts. Simplicity cannot lean on personalization to thin the tree; it has to thin the product.

14. **Premium-module packaging adds Settings and gating surfaces** (module toggles, `ModuleDisabledScreen`, plan gates, "what it competes with" copy) that a single-product simple UI would not need.

15. **Enterprise-scale mindset and breadth instinct** ("Fortune 500, 5 lakh employees"; "build payroll, benefits, financials as well") keeps the model count and route count growing; the rail consolidation two days ago shows appetite for reduction at the navigation level but none of the plans propose reducing feature surface.

16. **Inbox-as-homepage (vision, May) vs Home = first Space overview (parity, June).** The daily driver is undecided in writing; simple needs one landing surface.

17. **Mobile is promised in the vision and absent in the plans**; the current shell cannot collapse. If simple also means responsive, it is greenfield work, not a restyle.

Allies of simplification already on record, worth citing back to the founder: Monday-clean (June 2 and the June 3 "no more feature work until surfaces meet the bar" escalation), the Tables rule ("does Google Sheets have it? if not, it needs an explicit ask"), "slimmer, output-oriented" (Aug 28), "no dead controls" (Aug 31), the goals redesign brief ("keep it SIMPLE, not confusing OKR theater", killed the star, collapsed All Goals), the rail consolidation (Sep 10), and the PPMS scope cut (June 3).

---

## 7. Recommendations for the redesign brief

1. **Get one explicit decision from the founder before designing**: does the exact-ClickUp-parity mandate still govern visible UI, or does "crazy simple" supersede it? Every other conflict above hangs on this. Frame it using their own June 3 escalation and Sep 10 consolidation as precedent.
2. **Adopt `--os-*` as the only token vocabulary** and retire the shadcn `--surface/--muted` set, the bento lime palette, the marketing tokens inside the app, and six of the seven fonts. Move dark mode from `!important` utility repaints to token rebinding (the `.os-sk` panel already shows the pattern works). Do this before, not after, screen work.
3. **Fix the type scale to the four blessed sizes** (18/14/13/11) plus 12 for metadata and 10 as the absolute floor, and ban half-pixel sizes. State whether 14px base (Aug 20) or ClickUp 12 to 13px labels wins; the Aug 20 decision is newer.
4. **Keep and build on the primitives that already carry weight**: `EntityTile`, `MenuItem/MenuList`, `ViewTab`, `Chip/StatusChip` (retint to brand), `BackButton`, `Button` (tokenize it), `OsTitleBar`, `OsEmptyView`, `Dialog`, `MorePortal`, `useAnchorPos`, `DotsLoader/ValueLoader`, `Switch`, `useOsToast`. Delete `ui/empty-state.tsx` (0 users), `OsMainTable/OsTabs/OsFilterBar` (1 user each), `accent.ts` taupe, `app-shell.css`, and the removed-module CSS families.
5. **Collapse chrome bands**: one header row (title + view tabs + primary actions) and one toolbar row, both token-driven, replacing title 40 + tabs 34 + filter 34 wherever a surface is not a verified parity screen the founder wants kept.
6. **Decide the loader policy** (non-blocking value line in the first paint, or first-open-only splash) and the accent policy (blue + light/dark, or keep the picker) as explicit line items.
7. **Reserve slots** rather than surfaces for the promised work: a single AI entry point per page, a persistent call dock region, a per-space "Automations" entry in the existing "…" menus, a performance band chip style, a co-presence chip style, RTL-safe mirrored layouts, and a comment thread that can grow reactions/replies/resolve without a second component.
8. **Leave the honesty rules intact** (no fabricated data, no silently dead controls, Coming-soon labels where the backend is missing) and resolve their tension by hiding unbuilt options behind an explicit "show upcoming features" preference instead of disabled rows.

---

## 8. Open questions for the founder

1. Does "crazy simple" supersede the 2026-06-05 exact-ClickUp-parity mandate for visible UI? If yes, which parity screens (List/Board/Calendar/Gantt/task detail) are protected?
2. Which of the 98 coverage-matrix gaps are now explicitly "won't build"?
3. Loader: keep the ~1.6s mission/values splash on every app open, first-open only, or replace with a non-blocking line?
4. Accents: one brand blue + light/dark, or keep the 11-accent picker (and if kept, drop the four purple-family accents to honor the no-purple rule)?
5. Type scale: 14px base (Aug 20) or ClickUp 12 to 13px labels?
6. Home: first Space overview (parity) or a My Work daily driver (Monday's date-bucketed list is the coverage matrix's top adoption pick)?
7. Coming-soon policy: keep disabled Soon rows visible (system-alignment decision 1) or hide unbuilt options?
8. Goals/Timesheets/Reviews placement (core / module / Teams) and Canvas as module or core.
9. Is mobile in scope for this redesign, and does RTL need to be verified now that 18 locales are wired?
10. Can the removed-module pages, models and CSS (CRM, payroll, helpdesk, ITSM, finance, legal) be deleted, or must they stay on disk?
