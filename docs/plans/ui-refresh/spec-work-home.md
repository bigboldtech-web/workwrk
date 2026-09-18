# Work hub home spec

Unit `work-home`. Date 2026-09-11. Written against `design-system.md` (look), `access-model-spec.md` (access), `settings-architecture.md` (settings homes), `spec-template.md` (structure), `zoho-reference.md`, `critic-gaps.json`, `phase2-inputs.md`, `existing-direction.md`, `route-list.txt`, and the code at commit `6187227a`. Every repo path is relative to `/Users/bigboldtechnologies/theywrk/`.

The one sentence: **the Work hub lands on Home, a quiet page of your own work; My work is the full list of everything assigned to you; Inbox is the one place notifications arrive; the legacy task pages fold into the task (Item) world and disappear.**

---

## 0. Scope

### Routes covered (every URL in this unit, with its page file under `src/app`)

| URL | Page file (today) | Page file (after) | Disposition |
|---|---|---|---|
| `/home` | none (the archive path at `item/[id]/page.tsx:75` pushes it today and 404s) | `(dashboard)/home/page.tsx` (new) | NEW: the one landing for the Work hub |
| `/today` | `(dashboard)/today/page.tsx` (server redirect to the first Space) | deleted; 308 in `next.config.ts` | REDIRECT → `/home` |
| `/dashboard` | `(dashboard)/dashboard/page.tsx` (redirect to `/today`) + the dead `dashboard-content.tsx` tree | deleted; 308 | REDIRECT → `/home` |
| `/my-work` | none | `(dashboard)/my-work/page.tsx` (new) | NEW: the full list of tasks assigned to me (Items) |
| `/my-work/personal` | `(dashboard)/tasks/personal-list/page.tsx` | `(dashboard)/my-work/personal/page.tsx` (moved) | MOVE from `/tasks/personal-list` |
| `/inbox` | `(dashboard)/inbox/page.tsx` | same path, rebuilt | KEEP, rebuilt |
| `/favorites` | `(dashboard)/favorites/page.tsx` (pinned Sidekick chats, misnamed) | same path, rebuilt as the real Favorites page | KEEP, content replaced; pinned chats move to the AI unit |
| `/activity` | `(dashboard)/activity/page.tsx` | same path, rebuilt | KEEP, rebuilt |
| `/everything` | `(dashboard)/everything/page.tsx` + `everything-view.tsx` | same path, header stack + pagination | KEEP |
| `/assigned-comments` | `(dashboard)/assigned-comments/page.tsx` (stub) | deleted; 308 | REDIRECT → `/inbox?tab=primary&type=task_comment` |
| `/me/mentions` | `(dashboard)/me/mentions/page.tsx` | deleted; permanent 308 (settings-architecture §8.4) | REDIRECT → `/inbox?tab=mentions` |
| `/me/weekly-review` | `(dashboard)/me/weekly-review/page.tsx` + `components/me/weekly-review-form.tsx` | same path, restyled, week views added | KEEP |
| `/tasks` | `(dashboard)/tasks/page.tsx` (My Wrk card grid) | deleted; 308 | REDIRECT → `/home` |
| `/tasks/assigned-to-me` | `tasks/assigned-to-me/page.tsx` → `TaskListSurface` (legacy Task model) | deleted; 308 | REDIRECT → `/my-work` |
| `/tasks/today-overdue` | `tasks/today-overdue/page.tsx` (legacy Task model) | deleted; 308 | REDIRECT → `/my-work` (default grouping is the due-date buckets it showed) |
| `/tasks/personal-list` | `tasks/personal-list/page.tsx` | deleted; 308 | REDIRECT → `/my-work/personal` |
| `/tasks/backlog` | `tasks/backlog/page.tsx` (orphan, legacy Task) | deleted; 308 | REDIRECT → `/my-work?group=due&bucket=nodate` |
| `/tasks/board` | `tasks/board/page.tsx` (orphan, legacy Task) | deleted; 308 | REDIRECT → `/my-work?view=board` |
| `/tasks/calendar` | `tasks/calendar/page.tsx` (orphan, legacy Task) | deleted; 308 | REDIRECT → `/planner` (the planner unit owns the one calendar: `/planner`, `/calendar` and `/tasks/calendar` become one) |
| `/tasks/gantt` | `tasks/gantt/page.tsx` (orphan, legacy Task) | deleted; 308 | REDIRECT → `/my-work` (Gantt is a List view; personal work has no Gantt) |
| `/tasks/sprint` | `tasks/sprint/page.tsx` (orphan, legacy Task, hard-coded window) | deleted; 308 | REDIRECT → `/my-work` (sprints are List-level, spaces-lists unit, `CreateSprintModal`) |
| `/tasks/[id]` | `tasks/[id]/page.tsx` (legacy Task detail) | `(dashboard)/tasks/[id]/page.tsx` (body replaced by a server lookup that calls `redirect()`) | REDIRECT → `/item/[id]` of the migrated Item (lookup by `Item.metadata.legacyTaskId`); in-shell 404 when no Item exists. It stays a `page.tsx`, never a `route.ts`: Next forbids a `route.js` at the same segment level as `page.js` (`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` line 39) |
| `/ideas` | `(dashboard)/ideas/page.tsx` (orphan) | deleted; 308 | MERGE → an "Ideas" List created from the Template Center's "Ideas board" template (spaces-lists unit); 308 to `/boards/<slug>` of the migrated List when the org had ideas, else to `/templates?q=ideas` |
| `/analytics` | `(dashboard)/analytics/page.tsx` + `analytics/layout.tsx` | same path, rebuilt; sidebar row in the Teams hub | KEEP, re-parented to Teams, rebuilt on the task (Item) model |

Discovered in the code and belonging here: `/home` (referenced by `item/[id]/page.tsx:75` but absent), `GET /api/me/work`, `/api/me/items`, `/api/me/everything`, `/api/me/favorites/*`, `/api/me/pins`, `/api/me/mentions`, `/api/notifications`, `/api/inbox/count` (the existing bell counter, kept and rebuilt as the one unread counter, §2 `/inbox`), `/api/activity`, `/api/analytics`, `/api/tasks*` (legacy), `/api/ideas*`.

### Routes REMOVED / REDIRECTED / MERGED (target and reason; every destination stays reachable)

| Route | Target | Reason |
|---|---|---|
| `/today` | `/home` | one landing, one name ("Work" is the hub, "Home" is the page; "Today" disappears as a label). `/today` was a redirect to the first Space, which is not a personal landing (work-tasks #18, shell 1.1). |
| `/dashboard` | `/home` | duplicate redirect plus a dead 653-line tree (misc-apps 1.18, #8). The ⌘K "Open My Activity" command is re-pointed to `/activity` (shell #16). |
| `/tasks` | `/home` | the My Wrk card grid is 7 stubs out of 11 cards with 15 dead buttons (work-tasks #5); its two real cards (Assigned to me, Goals) become the Home widgets "My work" and "My goals". Its third real card, **KRAs & KPIs** (`GET /api/users/<id>/kpis`), is not a Home widget: its numbers keep two homes that already exist, the **Weekly review** page's "Your KPIs" card (this unit, `/me/weekly-review`) and the profile tab **My KRAs & KPIs** (`/people/me?tab=kras`, goals unit), and Home surfaces it as the Weekly review widget's second row "N KPI numbers to record" linking to that tab, plus the sidebar Goals group row "My KRAs & KPIs" with the same count. No destination is lost. |
| `/tasks/assigned-to-me`, `/tasks/today-overdue`, `/tasks/backlog`, `/tasks/board`, `/tasks/gantt`, `/tasks/sprint` | `/my-work` (with view/group params as listed) | all six run on the legacy `Task` table, so tasks made there never appear anywhere else (work-tasks #1). My work over Items replaces them; the legacy rows are migrated (§4). |
| `/tasks/calendar` | `/planner` | one calendar for the whole app (planner unit). |
| `/tasks/personal-list` | `/my-work/personal` | the page is already the Item-backed personal List; it moves under My work so "My work" is one group with one URL prefix. |
| `/tasks/[id]` | `/item/[id]` | four task-detail UIs become one (work-tasks #10, #17); the legacy row is migrated to an Item and the old id resolves through `Item.metadata.legacyTaskId`. |
| `/assigned-comments` | `/inbox?tab=primary&type=task_comment` | the page is a stub over a schema that does not exist (work-tasks #4). Comments addressed to you are Inbox rows of type `task_comment`; when comment assignment ships (task-detail unit, `CommentThread` assign action) it becomes the Inbox filter "Assigned comments", never a page. |
| `/me/mentions` | `/inbox?tab=mentions` | orphan duplicate of the Inbox Mentions filter (work-tasks 1.14, misc-apps 1.24, settings-architecture §7.1 1.30 already decided the permanent 308). |
| `/ideas` | migrated List, else `/templates?q=ideas` | orphan route; the access spec deletes the `ideas` permission cells ("off the rail; revive as a List", access §9); PPMS Lego rule: verticals are Lists plus fields. The Idea rows are migrated so nothing is lost (§4). |
| `/favorites` list 1, "Pinned chats" | `/sidekick?pinned=1` (AI unit, Sidekick history "Pinned" filter) | the route keeps its name and becomes the real Favorites page; the chats it held are an AI-hub concern (work-tasks 1.11, shell #14). |
| `/favorites` list 2, "Recent chats" (25 rows) | `/sidekick` (AI unit, Sidekick history, default "Recent" filter) | the second list is the same `GET /api/sidekick/sessions` rows with `pinned = false`; both lists land in one Sidekick history surface, so neither half is dropped. The pin toggle each row carried is the same `PATCH /api/sidekick/sessions/[id] { pinned }` the AI unit keeps. |
| `/analytics` tiles that point at live destinations (Tasks, Timesheets, Headcount, SOPs, Compliance) | Tasks → `/my-work` (this unit), Timesheets → `/timesheets` (Planner hub, planner unit), Headcount → `/people` (Teams › Directory, teams-people unit), SOPs → `/sops` and Compliance → `/sops/compliance` (Docs › SOPs, docs-knowledge unit) | the rebuilt `/analytics` is five tiles of the viewer's own team's work, not a launcher of ten links to other hubs. Every one of those five destinations already has its own rail hub and sidebar row, so removing the tile removes a duplicate door, never the door. The other five tiles (`/procurement/pos`, `/financials`, `/financials/reports`, `/financials/statements`, `/planning/variance`) point at modules that no longer exist and have no target (misc-apps High #2). |

### Audit inventories consulted

`work-tasks.md`, `misc-apps.md`, `shell.md` (plus `spaces-boards.md` §0 for the Spaces tree boundary, `time.md` §0 for the calendar boundary, `people-ops.md` for the Goals group boundary, read for cross-references only).

### Audit issue IDs this unit resolves

- `work-tasks.md` §3: #1, #2, #3, #4, #5, #6, #7 (for the routes here), #8, #9 (the `/home` half; the archive push itself is the task-detail unit's), #10, #11 (the "restore from Trash" copy half; the Trash gate is the spaces-lists unit's), #12, #13, #14, #15, #16, #17, #18, #19, #20, #21, #22, #23, #24, #25.
- `misc-apps.md` §3: High #2 (`/analytics` dead links), High #5 (the `/ideas` and `/me/mentions` halves), High #8 (`dashboard-content` dead tree and the palette label), Medium #14 (empty and error CTAs on `/me/mentions`), Medium #19 (the `/analytics` half: the Settings "AI usage" card is the settings-workspace unit's), Medium #20 (client-side stats over capped lists, for `/analytics`), Low #21 (loaders here), Low #23 (Me / My Profile drift in the Work sidebar), Low #25 (weekly review copy).
- `shell.md` §4: #3 (Inbox prefs), #12 (`home.cards` read), #13 (More menu "Drafts & Sent" and pin icons), #14 (`/favorites`), #15 (`/ideas`, `/me/mentions`, `/activity` halves), #16 (palette "Open My Activity"), #17 (`/home` exists), #29 (Work / Today / Home; Me / My Profile; My Wrk / My Work / My tasks), #39 (fake avatars on Favorites / Activity / Ideas).
- `critic-gaps.json` topSystemicIssues: #1 (nav decoupled, orphans: `/ideas`, `/tasks/*`, `/favorites`, `/activity`, `/me/mentions`, `/analytics`, `/dashboard`), #2 (fabricated chrome on every page here), #3 (Task vs Item; `/me/mentions` vs Inbox; `/dashboard` vs `/today`), #4 (read-only rows, gatePage on `/analytics` and `/me/weekly-review`), #5 (back convention on the two detail routes here), #6 (one visual system), #7 (Inbox prefs, `home.cards`, saved filters, `TaskListSurface` in-memory state), #8 (`/analytics` dead links), #9 (naming), #10 (narrow behaviour), #11 (Inbox errors swallowed), #12 (Inbox 50-row cap, Everything 500 cap, polling), #13 (due-date buckets by the user's time zone and week start), #14 (dead code: `components/tasks/*`, `components/today/*`, `dashboard-content` tree, `task-list-surface.tsx`, `task-reference-pages.tsx`, `OsItemDrawer` path), #15 ("Coming soon" rows: Drafts & Sent, Agenda connect buttons).

---

## 1. Unit-level rules

### Hub + sidebar (URL-derived, never sticky)

| Route | Rail hub (white pill) | Active sidebar row |
|---|---|---|
| `/home` | Work | Home |
| `/my-work` | Work | My work (the group row itself; it has one child, Personal list, which is not active here) |
| `/my-work/personal` | Work | My work › Personal list (the group row shows the parent style, the child carries the N200 pill) |
| `/inbox` (any tab) | Work | Inbox |
| `/activity` | Work | Activity |
| `/everything` | Work | Everything (first row of the SPACES section) |
| `/favorites` | Work | See all favorites (the last row of the FAVORITES section; the section label is never an active target because a section label only collapses, design-system §4.2) |
| `/me/weekly-review` | Work | Home (the page is reached from the Home widget; the breadcrumb carries "Weekly review") |
| `/item/[id]` reached from any page here | Work | the row the user came from stays active (the drawer is the task-detail unit's Next intercepting route, so the URL is `/item/<id>` while the host list stays mounted underneath; the full page keeps the last Work row, resolved by the shell's rule: longest `matchPaths` prefix, then the referrer's row) |
| `/analytics` | Teams | Analytics (Teams sidebar row 15, in the PERFORMANCE section; the teams-people unit owns the placement, see below) |
| `/today`, `/dashboard`, `/tasks/*`, `/assigned-comments`, `/me/mentions`, `/ideas` | never rendered (308 before paint) | n/a |

The resolution rule is the shell unit's (URL prefix → hub → row). This unit registers these `matchPaths` for the `home` hub: `/home`, `/my-work`, `/inbox`, `/activity`, `/everything`, `/favorites`, `/me`, `/item`, `/okrs` (goals unit), `/spaces`, `/boards`, `/folders`, `/templates`, `/trash` (spaces-lists unit). `/analytics` registers under `teams`. Nothing here reads `activeAppKey`.

**The Analytics row in the Teams hub sidebar (the exact row the teams-people unit renders).** `/analytics` is orphaned until the row exists, which is the systemic issue this unit is closing, so the row stays a hard cross-unit contract (§4, blocked-on). The hub owner decides where a row sits: `spec-teams-people` §1 places Analytics at **row 15, in the PERFORMANCE section**, of its 20-row sidebar, and that placement stands. This unit owns the page, the label, the icon and the gate, all adopted verbatim below; nothing renumbers, and the earlier "row 4, personal block, sidebar runs 1 to 21" proposal is withdrawn.

| Position | Section | Label | Icon | Href | Gating | Count | Collapsed | Owner |
|---|---|---|---|---|---|---|---|---|
| **row 15** of 20, per `spec-teams-people` §1 | PERFORMANCE | Analytics | `LineChart` (free: no other Teams row uses it; `BarChart3` is taken by Rollup) | `/analytics` | `app:analytics` per access §5.2.1: anyone with reports over their chain, the People team, Owner and Admin; never Guests | none | the PERFORMANCE section's own collapse state (teams-people) | page, label, icon and gate owned by this unit; position and rendering owned by teams-people |

PERFORMANCE collapses entirely for a plain Member, so the row appears and disappears with its manager siblings, which is the behaviour this unit asked for when it first proposed sitting beside My team and Workload.

### Hub sidebar contents: the Work hub secondary sidebar (this unit owns it)

Container per design-system §4.2: 264px, N50, header 56px with the workspace switcher (`EntityTile size="sm"` neutral + org name 15/500 + chevron; the shell unit owns the switcher menu), the hub search field only when the tree exceeds 12 rows, rows 36px `.os-row`, section labels 11/600 uppercase with the rule to the right edge, footer "Customize Sidebar". Header "+" = the global Create menu (shell unit) whose first row is "Task" (⌘⇧K).

Rows in order, top to bottom. Icons are Lucide 20px `--os-ink-2`. Counts are 12/500 `--os-ink-2` right-aligned (`--os-ink-strong` on the active pill). No coloured icons, no hover-only chevrons: group rows carry a visible 16px chevron at the right edge (`ChevronRight` collapsed, `ChevronDown` expanded), keyboard-focusable.

**Personal rows (no section label; the first thing in the sidebar)**

| # | Label | Icon | href | Gating | Badge / count | Collapsed by default | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Home | `House` | `/home` | everyone signed in (Owner, Admin, Member, Agent, Guest) | none | n/a | replaces "Me" as the first row; "Me" (`/people/me`) leaves the Work sidebar (it lives in Teams as "My profile" and in the avatar menu; teams-people unit) |
| 2 | My work | `CheckSquare` | `/my-work` | everyone signed in | count of Overdue + Today items (from `GET /api/me/home` counts) when > 0 | expanded when the child is active, else collapsed; state remembered in `sidebar.groups.myWork` (`UserPreference.sidebar`) | group row; click opens `/my-work`, the chevron toggles. There is no "Assigned to me" child: `/my-work` has exactly one label and one row (hard rule, one label per destination). "Assigned to me" survives only as words inside the page (its default view pill's meaning and its empty-state sentence), never as a row or a destination name |
| 2a | Personal list | `Lock` 16px at the right as a glyph, not a leading icon | `/my-work/personal` | Owner, Admin, Member, Agent (a Guest has no personal List; the row does not render for Guests) | none | | the group's only child, indented 20px |
| 3 | Inbox | `Inbox` | `/inbox` | everyone signed in | unread count from `GET /api/inbox/count` (the route that exists today and already feeds the top-bar bell; 99+ cap), plus the 6px `Dots unread` at the icon when > 0. One counter for the badge, the bell and the Home widget: no second `?count=1` mode is added to `/api/notifications`. The existing route is rebuilt to count Primary + Other unread through `inbox-kinds.ts` and to keep its snooze filter, so the badge and the Inbox tabs can never disagree | n/a | |
| 4 | Activity | `ActivityIcon` (Lucide `Activity`) | `/activity` | Owner, Admin, Member, Agent (never Guests: the feed is org activity, and the access §5.2.1 `home` row gives a Guest only My work and Inbox) | none | n/a | |

**GOALS group** (section label "GOALS" is not used; the group renders as a personal row 5 in the same block, exactly as the goals unit specifies it; listed here by reference)

| # | Label | Icon | href | Gating | Notes |
|---|---|---|---|---|---|
| 5 | Goals (group) | `Target` | `/okrs` | every Member (Owner, Admin, Member, Agent; never Guests), app key `goals` per access §5.2.1 | children My goals `/okrs` (`Trophy`), Team goals `/okrs?view=team` (`Users`; anyone with reports, People team, Owner or Admin), Company goals `/okrs?view=company` (`Building2`), My KRAs & KPIs `/people/me?tab=kras` (`Gauge`, a jump out of the hub with a 12px `ArrowUpRight` and the count of KPIs awaiting my number): **see spec-goals §1, which owns these rows and their hrefs**. The old forms `?mine=1`, `?team=1`, `?level=company` are retired and never printed here. Collapse state is `sidebar.groups.goals`. This unit fixes only the row's position (directly after Activity, before FAVORITES) and its chevron behaviour (same as My work). |

**Tail of the personal block** (after a 1px `--os-line` rule under the Goals group, before FAVORITES; no section label)

Placement override, stated here because this unit owns the hub: `spec-spaces-lists` §1 puts these two rows "under a 1px rule after Inbox so the personal group reads Home · My work · Inbox · Templates · Trash". This hub's personal block also holds Activity and Goals, so the two rows sit at the **tail of the personal block, after Goals**, under that same 1px rule. The personal block therefore reads **Home · My work (› Personal list) · Inbox · Activity · Goals · [rule] · Templates · Trash**. Everything else in that unit's row spec is kept exactly: labels, icons, hrefs, "every Member, never Guests", no counts. Engineers follow this table, not the one in `spec-spaces-lists` §1, for position only.

| # | Label | Icon | href | Gating | Notes |
|---|---|---|---|---|---|
| 6 | Templates | `LayoutTemplate` | `/templates` | every Member (Owner, Admin, Member, Agent); never Guests. There is **no** `template` key in access §5.2.1 and none is invented: `/templates` is a page inside the Work hub, so it gates on `gatePage("view", { type: "app", key: "home" })` and then applies the page's own rule (`spec-spaces-lists` §2 `/templates`: every Member, Guests never), the same shape as every other Work-hub page in this unit | spaces-lists unit owns the page. `/templates` stays in the **Work** hub: the docs-knowledge change request to move the `ROUTE_HUB` prefix from `home` to `docs` (its S1) is declined, the shell keeps `/templates` under `home`, and doc templates are reached from the Docs header "+" and any "Browse templates" row via `/templates?kind=doc`, while Settings › Task system › Templates keeps its link card at `/templates?kind=task` |
| 7 | Trash | `Trash2` | `/trash` | every Member (Owner, Admin, Member, Agent; never Guests) per the access §5.2.1 `trash` row (which does exist as an app key) and settings-architecture §7.1a; the page gates on `{ type: "app", key: "trash" }` | spaces-lists unit owns the page (the ONE trash) |

**FAVORITES section** (label "FAVORITES", rendered only when the viewer has at least one starred object; never for Guests, whose `home` row in access §5.2.1 grants My work and Inbox only)

The label is a **collapse control only** (11/600 uppercase with the rule, chevron on hover, per design-system §4.2). It is never a link: one click target never carries two meanings. The page is reached by the "See all favorites" row below it.

| # | Row | href | Gating | Notes |
|---|---|---|---|---|
| 8 | one row per starred object, `EntityTile size="sm"` neutral + name, kinds mixed and ordered by the order starred (newest first), sub-labels by kind only when the section exceeds 6 rows (kept from today) | the object's URL | the object must still be readable (`accessibleIds`); unreadable favorites are dropped from the list and from the preference on the next write | hover reveals one "…" at the right with: Open in new tab, Copy link, Remove from favorites. Never three hover icons. |
| 8z | See all favorites | `/favorites` | rendered **whenever the section renders**, not only past 8 rows | 13/500 `--os-ink-2` ghost row, always last in the section. It is the row that goes active on `/favorites`. A viewer with zero favorites has no section and no page worth opening; they still reach it from the command palette ("Favorites") and from the toast that fires the first time they star anything ("Starred · See all favorites"), which is also where the habit is taught |

Data: `GET /api/me/favorites` (new, one call for all seven kinds; replaces the seven parallel `/api/me/favorites/{kind}` calls; the seven POST toggles stay). Section collapse state persists in `sidebar.groups.favorites`.

**SPACES section** (label "SPACES"; collapse control only, never a link)

| # | Row | href | Gating | Notes |
|---|---|---|---|---|
| 9 | Everything | `/everything` | every Member; never Guests (same reason as Activity: the `home` row gives a Guest My work and Inbox, and a Guest's tasks in shared Lists are already all of My work) | this unit's row; 20px `Layers` icon; sits first in the section because it is "all tasks in all Spaces" |
| 10 | the Spaces tree | | | **see spec-spaces-lists §1** (Space rows, folders, Lists, views, hover "…" menus, drag, "+ New Space" per access toggle 1) |

**What a Guest's Work sidebar is, in full**: Home, My work (no Personal list child), Inbox. No Activity, no Goals, no Templates, no Trash, no FAVORITES, no Everything. That is exactly the access §5.2.1 `home` row ("My work over shared objects, Inbox") and nothing widens it.

**Footer**: "Customize Sidebar" (design-system §4.2; opens the CustomizePanel: Theme, Chrome, Density, and this sidebar's optional rows and section order). The CustomizePanel's section order writes `sidebar.sectionsOrder` (honoured for FAVORITES and SPACES; the personal block and its tail are fixed in order).

**What `home.cards` means in this sidebar** (settings-architecture §4.2 assigns its reader to "the Work sidebar and Space overview", and this unit is that reader): `home.cards` is the list of **optional rows and sections that are switched on**, edited in My settings › Preferences › Sidebar and in the CustomizePanel, both writing the same key. Optional keys: `activity`, `goals`, `templates`, `trash`, `favorites`, `spaces`. Fixed and never hideable: Home, My work, Inbox (a person must always be able to reach their own work and their notifications). A key the viewer's role does not grant is ignored rather than rendered. This is the only thing `home.cards` controls in the Work hub; Home's widgets are a surface option and live on a different key (§2 `/home`), so the two can never fight over one array.

**Rows removed from today's Work sidebar and where they went**: "Me" → Teams › My profile and the avatar menu; "Assigned Comments" → Inbox filter; "My Wrk" → "My work"; "Today & Overdue" and "Assigned to me" children → My work (one list, grouped by due date); "Goals" keeps its place as a group; "More" menu → deleted ("Drafts & Sent" was a coming-soon row; "All Spaces" is `/spaces`, reached from the SPACES section's "…" › Browse all Spaces, which spec-spaces-lists §2 already lists as an entry point (the label itself only collapses, design-system §4.2; that unit is asked to drop "the SPACES section label" from its entry list for the same reason the FAVORITES label lost its link here); "All Tasks" is Everything; "Customize" is the footer). The decorative Pin icons go with the menu.

**Create action in the header**: the global Create menu (shell unit). Its "Task" row opens the create-task modal (task-detail unit) with the List picker defaulting to the last-used List, else Personal list.

**The quick-task chord is `⌘⇧K`, never `⌘T`** (spec-shell §1.8, which owns `src/lib/shortcuts.ts`, the one window listener, every tooltip hint, the `?` overlay and `/account/shortcuts`). `⌘T` opens a new browser tab in Chrome, Safari, Firefox and Edge on both platforms, so advertising it would break the "advertised equals working" rule. Hub jumps are `G` then `1`…`8` for the same reason, never `⌘1`…`⌘8`. The button label stays **"Create task"**; only the chord printed beside it changes.

### Naming canon (the ONE label per destination in this unit)

| Canonical label | URL | Old labels it replaces (and where they were) |
|---|---|---|
| **Home** | `/home` | "Today" (URL, palette "Today G T", weekly-review breadcrumb), "Home" (error and not-found pages, the rail tooltip), "Work" as a page name (rail label stays "Work" for the hub), "My Wrk" (sidebar row and `/tasks` page title), "Open My Priorities" (palette), "Open My Activity" (palette, `/dashboard`), "Dashboard" (tour copy) |
| **My work** | `/my-work` | "My Wrk" (sidebar), "My Work" (topbar quick-tool panel, `/tasks/today-overdue` panel title, My Wrk card), "My tasks" (palette nav, `/tasks/[id]` back label), "All Tasks" (More menu), "Assigned to me" and "Today & Overdue" (sidebar children and reference pages). One label, one row, one URL: "Assigned to me" is retired as a destination name and appears only as prose inside the page ("Nothing assigned to you yet") |
| **Personal list** | `/my-work/personal` | "Personal List" (sidebar, breadcrumb); "Personal" everywhere in copy |
| **Inbox** | `/inbox` | "Notifications" (avatar menu row, which now goes to My settings › Notifications per settings-architecture §2.4), "Inbox Zero" (empty state copy) |
| **Mentions** | `/inbox?tab=mentions` | "Mentions inbox" (`/me/mentions`), Inbox filter "Mentions" |
| **Activity** | `/activity` | "My Activity" (palette), "Activity feed" |
| **Everything** | `/everything` | "All Tasks" (More menu → `/tasks`), "Everything · N items" (page title with count) |
| **Favorites** | `/favorites` and the FAVORITES section | "Favorites" (the Sidekick-pins page), "Starred", "Top pins" (`TopPinsStrip` chips are the shell unit's "Pinned to top" feature; the word "Favorites" is never used for it) |
| **Weekly review** | `/me/weekly-review` | "Weekly heartbeat", "My weekly review" |
| **Task** | `/item/[id]` | "Item", "row" ("Archive row"), "Task" (legacy `/tasks/[id]`) |
| **Analytics** | `/analytics` | "AI usage" (Settings card, settings-workspace unit), "Reports" |
| **Ideas board** | a List template | "Ideas" (the removed page) |

Priority words everywhere in this unit: Urgent / High / Normal / Low (the legacy Critical / Medium vocabulary dies with `/tasks/[id]`).

### Access (who can reach each route; what a read-only viewer sees; the denial convention)

Vocabulary: org roles Owner / Admin / Member / Guest, the Agent flag, the People team, "has reports"; object roles Full access / Can edit / Can comment / Can view; relationships from access §4 rule 9 (assigned to you = Can edit on that task).

**Which app key each route gates on.** Access §5.2.1 is an exhaustive table keyed by `AppEntry.key`, and "a key with no row does not render and its route 404s". `activity`, `favorites`, `everything`, `my-work` and `template` are **not** `AppEntry` keys (confirmed against `apps-catalog.tsx`), so this unit invents none of them. Every personal page in the Work hub gates on the one key that does exist for the hub, then applies its own scoping in the page:

| Route | `gatePage("view", { type: "app", key })` | Scoping applied after the gate |
|---|---|---|
| `/home`, `/my-work`, `/my-work/personal`, `/inbox`, `/favorites`, `/activity`, `/everything`, `/templates` | `home` | the `home` row grants a Guest exactly "My work over shared objects, Inbox"; every other route in the row calls `notFound()` for a Guest. Data is scoped with `accessibleIds` and `canMany` |
| `/me/weekly-review` | `home` | own people data only; `notFound()` for a Guest (people-data routes 404 for a Guest subject, access §3.5) |
| `/okrs` and its children (Goals group) | `goals` | goals unit |
| `/trash` | `trash` | spaces-lists unit |
| `/analytics` | `analytics` | anyone with reports over their chain, the People team and Owner/Admin over the org |

| Route | Who reaches it | What a read-only viewer sees | Denial |
|---|---|---|---|
| `/home` | everyone signed in (`app: home`, always visible, `alwaysPinned`) | the page is personal; nothing is read-only. A Guest sees the My work and Inbox widgets only; Reminders, My goals, Weekly review and Recent docs do not render for a Guest (the `home` row grants two things, and people data is never attached to a Guest) | none (never denies) |
| `/my-work` | everyone signed in (a Guest sees their assigned tasks in shared Lists: this is the "My work over shared objects" half of the `home` row) | every row in My work is assigned to the viewer, so every row is Can edit (rule 9): inline status, due date and priority edits always render. A task whose List the viewer cannot read still renders (rule 9 context: List name, statuses and fields come from `decision.context`), and its List chip is a plain label, not a link | none |
| `/my-work/personal` | Owner, Admin, Member, Agent | n/a (the viewer is the only holder) | Guest: 404 inside the shell |
| `/inbox` | everyone signed in; a Guest receives only the types access §2.3 allows (mentions, assignments, comments, replies, access granted or expiring) | n/a | none |
| `/favorites` | Owner, Admin, Member, Agent | favorites the viewer can no longer read are dropped silently (never a locked row) | Guest: 404 in the shell (the `home` row does not grant it; the FAVORITES section is likewise absent for a Guest, so no row leads anywhere that 404s) |
| `/activity` | Owner, Admin, Member, Agent | "Just me" for everyone; "My team" only for a viewer with reports (their chain); "Everyone" only for the People team, Owner and Admin. Views the viewer cannot use are not rendered (no downgraded selection, closes work-tasks #8) | Guest: 404 in the shell |
| `/everything` | Owner, Admin, Member, Agent | rows are read-only (plain text cells) when the viewer holds Can view or Can comment on the row's List; inline edit and drag render only for Can edit and Full access rows (`useAccess` per List, resolved once per page via `canMany`). Rows from Lists the viewer cannot read are absent (`accessibleIds(viewer, "list", VIEW).readable`) | Guest: 404 in the shell (a Guest's readable tasks are all of My work already, so nothing is lost) |
| `/me/weekly-review` | Owner, Admin, Member, Agent (own people data) | a submitted review is read-only until the viewer taps Reopen (self EDIT on own self-service parts, access §3.5) | Guest: 404 |
| `/analytics` | anyone with reports (their chain), the People team and Owner/Admin (org) per access §5.2.1 `analytics` | none: the page is scoped, never read-only | a Member without reports, and any Guest: the shell's in-frame 404, and the Teams sidebar row is absent. This is the §5.2.1 rule for an app key whose rule the viewer fails, applied unchanged. There is no `LockedPage` anywhere in this unit: `LockedPage` always carries "Request access" (access §5.3) and belongs to discoverable objects with an owner, which an app key is not |

The one denial convention (access §5.5), used here without variation: not signed in → `/login?callbackUrl=<current>`; signed in and the object or app is not discoverable → the shell's in-frame 404; discoverable object with no role → `LockedPage` at the same URL (no object in this unit is in that category, so the component never renders here); module or app off → `ModuleOff` / `AppOff`; an action the role lacks is not rendered, and a stale tab hitting the API gets one toast "You need Can edit for that. Ask {owner}." Nothing in this unit redirects on denial. `/dashboard`, `/people/me` and `/today` as denial targets are gone.

### Back / close

| Surface | Back target (`BackButton{fallbackHref}`) | Close / Esc |
|---|---|---|
| `/home`, `/my-work`, `/inbox`, `/favorites`, `/activity`, `/everything`, `/analytics` | top-level pages: no BackButton; the top bar ‹ › and the sidebar are the way back | Esc closes any open drawer, then the filter panel, then nothing |
| `/my-work/personal` | no BackButton (it is a sidebar row), breadcrumb "Work › My work › Personal list" | as above |
| `/me/weekly-review` | `BackButton{fallbackHref="/home"}` in the title row, labelled "Home" | Esc: closes a picker if open, else nothing (a dirty form asks "Save your changes?" only when leaving via any navigation, `useDirtyGuard`) |
| Task drawer opened from Home, My work, Everything, Inbox | a row click calls `router.push("/item/<id>")` and the host page mounts the `@drawer` slot, so Next renders the intercepted drawer over the list and the URL becomes `/item/<id>` (task-detail unit owns the mechanism and the component). Closing returns to the host URL with the view, filters and scroll position intact; the drawer's own header ✕ and Esc do the same; Expand keeps the same URL and `BackButton` falls back to the page the drawer opened from (this unit passes `returnTo`). One URL per task, so Copy link always works. The older `?item=<id>` form on a list URL is kept as a 308 to `/item/<id>` for one release | Esc closes the drawer first |
| Inbox right pane (the notification's target) | "Open" goes to the target's full page with `returnTo=/inbox?tab=…` so that page's `BackButton` returns to the same tab | Esc deselects the row (pane shows the "Pick a notification" state) |
| Home "Display" popover, Inbox "Inbox options" popover, filter panels | n/a | Esc closes |
| Create-task modal opened from any page here | n/a (modal) | Esc / ✕ / outside click; dirty confirm (task-detail unit) |
| `/tasks/[id]` with no migrated Item | the shell's in-frame 404 exactly as `spec-shell` §2.4 defines it: one sentence "We couldn't find that page", one text link "Search", and `BackButton{fallbackHref: hub.defaultHref, label: hub.label}`, which on this route resolves to `/home` labelled "Work". No per-route 404 copy, and `GoBackButton` does not exist (the shell unit merges it into `ui/back-button.tsx`) | n/a |

Every page here that links to a full page passes `returnTo` in the URL only when the natural parent is ambiguous (Inbox → task page, Home widget → weekly review); otherwise `BackButton` uses the natural parent.

### Mobile / narrow

The shell unit owns the breakpoints (rail collapses to a bottom bar under 768, sidebar becomes a drawer under 1024). This unit's pages:

- Under 1280: Home's widget grid goes from two columns to one (My work first). Everything and My work tables scroll inside their `TableCard` (`overflow-x: auto`); the filter panel becomes the 320px left drawer (design-system §5.2).
- Under 1024: Inbox split becomes a single pane: the list fills the width; selecting a row pushes the target pane over it with a "‹ Inbox" `BackButton` in its header; Esc or the button returns to the list. Activity and Favorites render as single-column cards. The views row overflows into "•••".
- Under 768: My work Board view is replaced by the List view (the view-type switcher hides the board icon), Calendar view is the week list (planner unit's narrow rule). Weekly review's sliders become 32px steppers. Nothing is hidden behind hover: every hover action ("…", unstar, Mark read, Snooze) also appears in the row's "…" menu, which is a 32px always-visible ghost on touch devices (`pointer: coarse`).

---

## 2. Route specs

### `/home`  (`src/app/(dashboard)/home/page.tsx`, new; replaces `today/page.tsx`, `dashboard/page.tsx`, `tasks/page.tsx`)

- **Purpose**: the page you land on: your work for today, what arrived in your Inbox, your reminders and goals, in one quiet screen.
- **Who sees it and entry points**: everyone signed in (Guests see the two widgets they can hold: My work and Inbox). Entry: rail "Work" (its `defaultHref` becomes `/home`), sidebar "Home", app-host root `/` (`src/proxy.ts:176-179` re-pointed), the four-dot logo click (design-system §4.1), error and not-found pages "Home", `closeSettings()` final fallback (settings-architecture §8.3; the constant `/today` becomes `/home`), command palette "Home" (`⌘K`, alias "home"), the shell's `G` then `H` chord, the reminder ticker "Open" for personal reminders, the 308s from `/today`, `/dashboard`, `/tasks`.

  **The two-destination contract with the shell** (settled; the shell adopts it). Home and My work are two URLs with two labels, so the one-label-per-destination rule holds: `/home` is the quiet widget page a person lands on, `/my-work` is the full list of everything assigned to them. `spec-shell` §1.3 canonised `/today` as "My work" and stated there is no row labelled Home, which was written against a `/today` that was itself a redirect to the first Space. The shell changes accordingly: §1.3 gains two rows (Home, My work), the "no row labelled Home" paragraph is deleted, `ROUTE_HUB`'s `home` row gains `/home` and `/my-work` and loses `/today`, `/dashboard` and `/tasks`, the hub's `defaultHref` becomes `/home`, and `G H` opens `/home`.
- **Top bar**: left ‹ › + breadcrumb "Work › Home" (last crumb 14/500 `--os-chrome-fg`, not clickable); centre global search; right "+" / bell / help / avatar (shell unit). No back button (top-level).
- **Secondary sidebar**: Work hub; "Home" active (N200 pill); groups as remembered.
- **Page header stack**: title row 48: "Home" 22/600; no subtitle (the greeting "Good morning, Priya" that `/tasks` toggled is gone: no description line under a title per design-system §4.4). Right of the title: nothing (no Share, no "…" here; Display lives in the toolbar). Views row: does not render (one view). Toolbar 44: left = empty (no Filter / Sort / Group on a widget page); right = the one blue button **"Create task"** (36px, `Plus`, opens the create-task modal, ⌘⇧K) and the bordered "…" square with: **Display** (a checklist of the widgets below with a switch each, order fixed; writes `home.work.surface.home.viewOptions.widgets`, see Data), **Reset layout** (restores all widgets on). The "Ask AI" slot at the far right of the title row renders only when the AI module is entitled (design-system §4.4).
- **Body layout** (24px padding, 8px under the toolbar, a two-column grid: left column fluid min 560, right column 360, gap 24; under 1280 one column):

  Widgets use design-system §5.8 Home widgets: `--os-surface`, `1px solid var(--os-line)`, radius 12, a 60px header strip in `--os-widget-head-bg` holding the title 15/500 `--os-ink` and one 20px `--os-ink-2` icon (icons only, no secondary text in the strip), then the body. Each widget body is a list of rows at `--os-row-h` (44 / 36 / 32 by density) with hairlines `--os-line-soft`, and a 44px footer row holding one text link 14/500 `--os-brand-deep` ("Open My work"). Empty bodies use the quiet template (four-dot line art by context, one sentence, at most one text link).

  1. **My work** (left column, spans the column, first). Icon `CheckSquare`. Body: three groups with plain 15/500 headers on `--os-surface-1` (design-system §5.1 group header, never a coloured bar): **Overdue** (count 12/500 `--os-danger-text` beside the word, the only semantic colour on the page, paired with the word), **Today**, **This week** (through the end of the viewer's week, `home.locale.weekStart`). Each row: 18px checkbox (checking sets the task's first done status via `PATCH /api/items/[id] { status }`, with a 5s Undo toast), title 15/400 (15/500 when Urgent) as a link opening the task drawer, List name 13/400 `--os-ink-2` ("in Q4 leads"; a plain label when the viewer cannot read the List), due date chip 12/500 (`--os-danger-text` text when overdue, paired with the date), `Flag` priority glyph 16px. Content budget: one chip, one glyph, nothing taller than row minus 12. At most 10 rows across the three groups, then the footer link "Open My work · N more". A "+ Add task" ghost row (15/400 `--os-ink-2`, `Plus`) closes the widget: it opens the create-task modal preselected to Personal list. Empty: four dots in a row, "Nothing due this week", link "Open My work".
  2. **Inbox** (right column, first). Icon `Inbox`. Body: the 5 newest unread Primary notifications as Inbox rows (see `/inbox` row anatomy, compact: one line, title + time). Footer "Open Inbox · N unread". Empty: "You're all caught up", no link.
  3. **Reminders** (right column). Icon `Bell`. Body: reminders due today or overdue from `GET /api/reminders?due=today` (planner unit owns reminders): row = title, time 12/500, Done (28px ghost check) and Snooze (28px ghost, `Picker` with In 1 hour / This evening / Tomorrow 9am). Footer "New reminder" (text link; opens the reminder popover, shell unit). Empty: "No reminders due today". **Not rendered for Guests**, like every widget other than My work and Inbox: the access §5.2.1 `home` row grants a Guest those two and nothing else, and a Guest is a person from outside the company who is in the workspace for one List, not someone the workspace keeps a personal planner for.
  4. **My goals** (right column). Icon `Trophy`. Body: up to 5 goals the viewer owns, from `GET /api/okrs/my-okrs`: title, goal ring 20px (`--os-brand` on `--os-surface-2`) + percent 12/500, due 12/400. Footer "Open Goals" → `/okrs` (the canon URL for My goals, spec-goals §1; the old `?mine=1` form is never printed). Not rendered for Guests. Empty: cluster illustration, "No goals yet", link "Open Goals" (goals unit decides who can create).
  5. **Weekly review** (left column, second). Icon `ClipboardCheck`. Rendered only when the viewer has at least one active KRA assignment, at least one KPI to record this month, or an existing review row (data-derived, `GET /api/me/home` returns `weeklyReview: null` otherwise). Not rendered for Guests. Body: up to two 44px rows. Row 1: "Week of 8 Sep" 15/500, a pale `StatusChip` (Not started = neutral, Draft = warning "In progress", Submitted = info "Submitted", Reviewed = success "Reviewed"). Row 2, rendered only when the count is above zero: "3 KPI numbers to record" 15/400 with the count 12/500 right, linking to `/people/me?tab=kras` (the profile tab, goals unit) so the KRAs & KPIs card the old `/tasks` grid carried keeps a Home surface and its real data (`GET /api/kpi-records?userId=me&period=current&status=PENDING`, the same count the sidebar's "My KRAs & KPIs" row shows). Footer "Open weekly review" → `/me/weekly-review`.
  6. **Recent docs** (left column, third). Icon `FileText`. Body: 8 rows from `GET /api/me/recent-docs`: `EntityTile size="sm"` + title + "opened 2h ago" 12/400. Footer "Open Docs" → `/docs`. Not rendered for Guests (the Docs hub is off for Guests unless a Doc is shared; the widget renders for a Guest only if the endpoint returns rows). Empty: stack illustration, "Nothing opened yet".

  Widget visibility: `UserPreference.home.work.surface.home.viewOptions.widgets: string[]` of visible widget keys `my-work, inbox, reminders, goals, weekly-review, recent-docs` (default: all six). This is the key settings-architecture §7.3 already defines for a surface's own view options (`home.work.surface.{viewId}` with `viewId = "home"`), edited where design-system §4.4 puts view options, in this toolbar's "…" Display, and nowhere else. It is deliberately **not** `home.cards`: settings-architecture §4.2 assigns `home.cards` to the Work sidebar and the Space overview (§1 of this spec says exactly which rows and sections it switches), so the two readers never share an array and no saved value can mean two things. The react-grid-layout drag-and-resize grid, `home.taskCardLayout`, `home.taskCardLayoutV3` and `home.taskCardsHidden` are retired; the one-time migration of each old key is listed in §4.

- **Side panel / drawer / modal**: the task drawer (task-detail unit, 520px, URL `/item/[id]`, list dims to 92%) opens from any My work row; the create-task modal (560/720) from "Create task", "+ Add task" and ⌘⇧K; the reminder popover from "New reminder"; the Display popover (Picker, 280) from "…".
- **States**: loading = rail logo pulse after 200ms + six widget skeletons (header strip drawn, three `--os-skeleton` rows each) with one 13px rotating value line under the first; empty = per widget as above (the page itself is never "empty"; a brand-new user sees the widgets their role renders plus the "Get started with" chip row and the 5-step `steps-n` checklist card from design-system §5.8, placed above the grid until the checklist is done or dismissed, dismissal in `home.ui.dismissed[]`. Each chip is gated the same way every other control here is, so no chip ever leads to something the viewer cannot use: **Task** always (everyone can create in their Personal list); **Doc** when the `docs` app row renders for the viewer (access §5.2.1 `docs`: every Member; a Guest only when a Doc is shared, so a Guest normally sees no Doc chip); **Table** only when the Tables module is entitled and the `tables` app row renders; **Invite** only when `can(viewer, "invite_member", org)`. A row with one chip still renders; a row with none does not, and the checklist card takes its place); error = a widget whose fetch failed shows "Couldn't load · Retry" inline in its body (13px, text link; retry re-fetches that widget only), never an empty list; read-only = n/a; denied = never; offline / session expired = the shell's re-login prompt preserving `/home` (shell unit), widgets keep their last data greyed at `--os-ink-4`.
- **Keyboard**: ⌘⇧K create task; ⌘K search; ↑ ↓ move focus through My work rows, Enter opens the drawer, Space toggles the checkbox; `?` shortcuts overlay (shell).
- **Data**: `GET /api/me/home` (new): `{ work: { overdue[], today[], week[], counts }, inbox: { unread, rows[5] }, reminders: { rows[] }, goals: { rows[5] } | null, weeklyReview: { weekStart, status } | null, recentDocs: rows[8] | null }` composed server-side from the existing helpers behind `/api/me/work` (widened to `assigneeIds`), `/api/notifications`, `/api/reminders`, `/api/okrs/my-okrs`, `/api/me/weekly-review`, `/api/me/recent-docs`, scoped by `can()`. The Inbox widget's unread number comes from the same `GET /api/inbox/count` the sidebar badge and the bell use, carried through the aggregate so the three can never disagree. Writes: `PATCH /api/items/[id]` (complete), `PATCH /api/reminders/[id]` (done, snooze), `PATCH /api/preferences { home: { work: { surface: { home: { viewOptions: { widgets } } } } } }`. Settings read: `home.work.surface.home.viewOptions.widgets` (which widgets show), `home.locale.timezone` and `home.locale.weekStart` (bucket edges are computed in the viewer's time zone), `density`, `home.ui.dismissed`. This page does not read `home.cards`; the Work sidebar does (§1).
- **Realtime**: `workwrk:item-created` and `workwrk:item-changed` window events (create-task modal, drawer) re-fetch the My work widget; `workwrk:notif-changed` (SSE, shell) re-fetches the Inbox widget; the 60s reminder tick re-fetches Reminders; focus / visibility re-fetches everything (one aggregated call).
- **What changes vs today**: `/today` no longer redirects to the first Space (work-tasks #18); the `/tasks` card grid goes: Recents-as-Spaces, Agenda with dead Prev/Next/Today and disabled "Connect" buttons, the always-empty My Work card, the fabricated AI StandUp text, the static Personal List / Reminders / Priorities cards, the dead Expand / More eyebrow buttons, "Manage cards" opening "Add Cards", the unpersisted "Page greeting" switch (work-tasks #5, #21) all disappear; the two real cards (Assigned to me, Goals) survive as honest widgets and the KRAs & KPIs card keeps its data through the Weekly review widget's second row and the Goals group (see §0); `home.cards` is read at last, by the Work sidebar, with its settings-architecture §4.2 meaning intact (#6, shell #12); one loader vocabulary (#20); no `#FAFAFA` / `#0073EA` literals (#24). `/home` finally exists, so the task archive path no longer 404s (#9, shell #17; the push itself is corrected by the task-detail unit to the List or `/home`).
- **Open questions**: (1) Should the Home widget grid allow drag reorder (today's react-grid-layout) or stay fixed-order with visibility toggles? Recommendation: fixed order, toggles only; simplest to explain and nothing to lose. (2) Should a manager see a seventh widget "My team today" (overdue count per report) on Home? Recommendation: not in v1; it belongs to the Teams hub (`/team`).

### `/today`  (`src/app/(dashboard)/today/page.tsx`, deleted; `next.config.ts` 308 → `/home`)

- **Purpose**: none (a redirect so old links and bookmarks keep working).
- **Who sees it and entry points**: anyone following an old link; the redirect runs before auth, then `/home` gates as usual.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: none. Every in-code reference is re-pointed in the same change: `apps-catalog.tsx` `defaultHref`, `src/proxy.ts:176-179`, `(dashboard)/error.tsx` and `not-found.tsx` "Home" links, `settings-shell` fallback (settings-architecture §8.3 constant), `command-palette.tsx` "Today" and "Open My Priorities" rows (both become "Home"), `me/weekly-review/page.tsx:61-65` breadcrumb, `item/[id]/page.tsx:122` "Go to Today", `reminder-ticker.tsx` personal-reminder "Open", `workspace-menu.tsx` switch-workspace target.
- **Realtime**: none.
- **What changes vs today**: the page file and its first-Space query are deleted; the label "Today" leaves the product.
- **Open questions**: none.

### `/dashboard`  (`src/app/(dashboard)/dashboard/page.tsx` + `dashboard-content.tsx` tree, deleted; 308 → `/home`)

- **Purpose**: none (redirect for old links: auth flows, the tour, `bento-nav.tsx`).
- **Who sees it and entry points**: anyone following an old link. The ⌘K "Open My Activity" command is re-pointed to `/activity` and relabelled "Activity"; the tour step "Your Dashboard" is rewritten to "Home" (account-auth unit owns the tour copy; flagged). `bento-nav.tsx:95` (marketing) points at `/home`.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: `/api/dashboard` is deleted with the tree (`components/dashboard/employee-dashboard.tsx`, `manager-dashboard.tsx`, `dept-workspace-banner.tsx`, `dept-home.ts`, `ai-signals.tsx`, `autonomous-digest.tsx`, `birthday-card.tsx`, `dashboard-okrs.tsx`, `announcements-banner.tsx`, `page-header.tsx`, `onboarding-checklist.tsx`; `admin-setup-checklist.tsx` is wired by the settings-workspace unit, §7.2 there, and is not deleted). The employee doors the tree used to hold (Recent kudos, Surveys waiting for you) are re-created by the teams-performance unit as Inbox rows (`kudos`, `survey` types) and Teams sidebar rows; this unit guarantees the Inbox rows route to Primary (surveys, candor) and Other (kudos).
- **Realtime**: none.
- **What changes vs today**: 653 lines of dead code and six `dept-home` routes to removed modules go; the palette label stops describing a page that does not exist (misc-apps #8, shell #16).
- **Open questions**: none.

### `/my-work`  (`src/app/(dashboard)/my-work/page.tsx`, new; replaces `tasks/assigned-to-me`, `tasks/today-overdue`, `tasks/backlog`, `tasks/board`, `tasks/gantt`, `tasks/sprint`)

- **Purpose**: every task assigned to you, across every Space, as one list you can sort, group, filter and tick off.
- **Who sees it and entry points**: everyone signed in (a Guest sees their assigned tasks in shared Lists). Entry: sidebar "My work"; Home widget footer "Open My work"; command palette "My work" (alias "mw"); the topbar "My Work" quick-tool panel is retired by the shell unit in favour of this page (the "+" menu keeps "Task"); the 308s from `/tasks/assigned-to-me`, `/tasks/today-overdue`, `/tasks/backlog`, `/tasks/board`, `/tasks/gantt`, `/tasks/sprint`.
- **Top bar**: breadcrumb "Work › My work". No back button.
- **Secondary sidebar**: Work hub; the "My work" group row itself is active; the group is expanded so Personal list is visible.
- **Page header stack**:
  - Title row: "My work" 22/600. Right: nothing. Ask AI slot per entitlement.
  - Views row 36 (text-tab pills, `.os-row`): **All** (default), then one pill per saved filter in `home.work.savedFilters[]` (name, in saved order), overflow into "•••", then "+ View" ghost 13px (opens the filter panel with "Save as view" focused). Active pill = `--os-surface-2` 15/500. A saved filter's pill "…" (on hover or via keyboard menu) offers Rename, Set as default, Delete. The row renders even when no filter is saved because "+ View" is a live affordance.
  - Toolbar 44: left **Filter** (`Funnel` chip; opens the 272px `FilterPanel`; label "Filter · 2" when active), **Sort** (`ArrowUpDown`; Picker: Due date, Priority, Title, List, Created, Updated; asc/desc), **Group** (`Rows3`; Picker: **Due date** (default: Overdue / Today / Tomorrow / This week / Later / No date), Status, List, Priority, None), 1px divider, the view-type switcher: **list** (`List`), **board** (`Kanban`), **calendar** (`Calendar`) 32px icon buttons, the active one `--os-brand-deep` on `--os-brand-soft`. Right: the one blue **"Create task"** (`Plus`; opens the create-task modal, List picker defaulting to the last-used List, else Personal list) and the bordered "…" square: **Display** (Fields shown: Status, Assignees, Due date, Priority visible by default, plus List, Tags, Type, Estimate, Time tracked, Created; Show done tasks (off); Show subtasks (on); Solid status column (off)), **Export CSV** (rendered only when `can(viewer, "export", org)`: never for Guests, Agents or acting-as).
  - Under 1024 the filter panel becomes the 320px left drawer.
- **Body layout**:
  - **List view** (default): one `TableCard` per the design system: header row (checkbox column 44 wide, checkbox visible at rest at Comfortable), columns per Display (Title 15/500 first, Status pale chip + dot + word, Assignees avatar group 24 (multi-assignee, the viewer plus others), Due date, Priority `Flag`, List (`EntityTile size="xs"` + name, a link when the List is readable), `SlidersHorizontal` column settings pinned right). Inline header filter "All ▾" on Status and List. Group headers (44/36/32, `--os-surface-1`) with the bucket word 15/500 and the count; when grouped by Status the header is a pale `StatusChip`. Group order for Due date: Overdue, Today, Tomorrow, This week, Later, No date; empty groups collapse to one line; "+ Add task" ghost row last in every group (creates in Personal list with the group's due date preset; the group "No date" presets nothing). Rows: hairline, hover `--os-surface-hov`, click opens the task drawer, checkbox selects. Bulk bar after the first selection: "3 selected" · Set status · Set due date · Set priority · Mark done · ✕ (white, floating bottom-centre). Footer row: "Total records 37" left, "1 to 50" with ‹ › right; page size 50 (Picker on hover: 25 / 50 / 100).
  - **Board view**: kanban per design-system §5.3, columns = the Due date buckets when grouped by Due date (drag between columns reschedules: Overdue → Today sets due today; dropping on Later sets +7 days; dropping on No date clears), or one column per status name when grouped by Status (statuses across Lists are matched by name, case-insensitive; a task whose List lacks the target status cannot be dropped there: the column shows a "Not available for this List" 13px line during drag). Cards: title two-line clamp, up to three pale chips (priority glyph, due date, List), ID 12/500 left, avatars right. "+ Add task" ghost at each column bottom.
  - **Calendar view**: the board calendar renderer (`board-calendar-view.tsx`, spaces-lists unit restyled) over the viewer's tasks: month grid, week starts on `home.locale.weekStart`, drag to reschedule, click opens the drawer, "+" on a day creates in Personal list with that due date. Week / Month toggle as a segmented control in the toolbar left of the view switcher when Calendar is active.
  - **Filter panel** (`FilterPanel`, 272): heading "Filter tasks by" + "Clear all"; checkbox rows: Status (value picker of status names across the viewer's Lists), List, Space, Priority, Due date (Overdue / Today / This week / Next week / No date / Custom range), Tags, Type, Created by me (a switch), Includes subtasks (switch, default on). Footer "Save as view" text link → a 400 modal (name, "Set as default" switch) writing `home.work.savedFilters[]` `{ id, name, filters, sort, group, view, isDefault }` (settings-architecture §7.3: saved task filters move from `workwrk:task-saved-filters` localStorage to this key). The last used sort / group / view / fields per saved filter persists in `home.work.surface.{viewId}` (`viewId` = the saved filter id or `all`), written debounced 400ms and read on mount (settings-architecture §7.3's `TaskListSurface` row: the surface is this page now).
- **Side panel / drawer / modal**: the task drawer (task-detail unit; 520, URL `/item/[id]`, list dims to 92%, Expand animates to the page); the create-task modal; the "Save as view" modal (400); the bulk-bar pickers (`Picker`).
- **States**: loading = rail pulse + `TableCard` skeleton (header + 8 rows at the row height, 60/40/80% bars) with one 13px rotating value line; empty (no tasks at all) = four dots in a row, "Nothing assigned to you yet", link "Create a task" (opens the modal; the toolbar's blue button stays the only primary); filtered-empty = the inline 44/36 row "No results · Clear filters"; error = `OsEmptyView` restyled: "Couldn't load your tasks" + text link "Retry" (wired); read-only = never (every row is assigned to the viewer); denied = never here (a Guest reaches `/my-work`; `/my-work/personal` is the exception below); offline / session expired = shell prompt; rows keep last data, edits are queued and retried with the saving dot (`AutosaveIndicator` in the drawer header; inline cell edits show the 6px `saving` dot in the cell until saved, then nothing; failure = "Not saved, retrying" toast with Retry, never silent).
- **Keyboard**: ↑ ↓ rows, Enter opens the drawer, Space selects, `x` toggles the checkbox on the focused row, `⌘⇧K` create task, `f` opens Filter, Esc closes the drawer then the filter panel, `⌘⇧E` export when allowed (listed in `src/lib/shortcuts.ts`; advertised = working).
- **Data**: `GET /api/me/work?view=list|board|calendar&group=due|status|list|priority|none&sort=…&filters=…&cursor=&limit=50&done=0|1` (rebuilt): today the route reads `ownerId` only and buckets Today / Overdue / Next / Unscheduled with a `take: 600`; it widens to `OR: [{ ownerId }, { assigneeIds: { has } }]` (the rule `/api/me/items` already applies), returns `BoardItemRow` rows with `board` and `space` refs plus the rule-9 `context` (statuses, fields) per List, server-side grouping and cursor pagination, and drops the 600 cap. `PATCH /api/items/[id]` for inline edits (status, due, priority, assignees), `POST /api/boards/[personal]/items` for "+ Add task", `POST /api/items/bulk` (new: `{ ids[], patch }`) for the bulk bar, `GET /api/me/work/export.csv` (new, `export` action). Settings read: `home.work.savedFilters[]`, `home.work.surface.*`, `home.locale.*`, `density`, `home.ui.showUpcoming` (nothing here is upcoming).
- **Realtime**: `workwrk:item-created` / `workwrk:item-changed` events re-fetch the current page; the existing 12s board poller (`board-canvas.tsx:291-322`) is replaced on this page by a 30s poll of `GET /api/me/work?since=<updatedAt>` plus SSE `workwrk:items-changed` when the shell's RealtimeClient emits it (shell unit documents the event list); no full-page loader on view or group changes (client-side, the data is re-fetched with the skeleton only inside the card).
- **What changes vs today**: the 5,869-line `task-list-surface.tsx` and `task-reference-pages.tsx` are deleted with the legacy `Task` model (work-tasks #1, #14, #23): the in-memory views, the unpersisted Private / Pin flags, the "Wrap text" and "Show task locations" toggles that nothing read, the fake "Agents" section in the assignee menu, the decorative "Set up your work schedule" card, the "/ for commands" placeholder without slash commands, the third `TaskDetailModal` with dead Ask / Share, the AddLinks rows without handlers, and the doc-view textarea that never saved all go. `/tasks/today-overdue`'s dead Settings button and the not-even-disabled "Connect" buttons go (#16). Saved filters persist server-side (#14, critic #7). The "My Work" label is one page (#21). Every row is an Item, so a task created here appears in Everything, the drawer, the reminders bell and the Home widget (#1).
- **Open questions**: (1) Should "Created by me" tasks that are not assigned to me appear in My work by default? Recommendation: no; it is a filter switch, off by default. (2) Should My work offer a Gantt view? Recommendation: no; Gantt is a List view.

### `/my-work/personal`  (`src/app/(dashboard)/my-work/personal/page.tsx`, moved from `tasks/personal-list/page.tsx`)

- **Purpose**: your own private List for tasks that belong to no project; only you can see it.
- **Who sees it and entry points**: Owner, Admin, Member, Agent (never Guests: `notFound()`). Entry: sidebar "My work › Personal list"; the create-task modal's List picker ("Personal list" is the first row of the picker, above the Spaces, so a task can always be created without choosing a project: closes work-tasks 2.3 "no way to create a task without a List"); the "+ Add task" ghost rows on Home and My work create here; the 308 from `/tasks/personal-list`.
- **Top bar**: breadcrumb "Work › My work › Personal list". No back button.
- **Secondary sidebar**: Work hub; "My work › Personal list" active.
- **Page header stack**: exactly the List page's stack (spaces-lists unit): title row with `EntityTile size="lg"` neutral (`Lock` glyph) + "Personal list" 22/600; right: no Share button (the List has no grants and no owner row to show; a "Private to you" 12/500 `--os-ink-2` caption sits where the role chip would be); "…" with the List menu minus Sharing, Move, Delete and Automations (a personal List cannot be shared, moved or deleted; it is created on demand and lives with the user). Views row: the List's saved views as text-tab pills (List / Board / Calendar / Gantt self-heal via `ensureCoreListViews`, plus "+ View"). Toolbar: the List toolbar (Filter, Sort, Group, view switcher, "Create task" blue, "…" Display / Export).
- **Body layout**: `BoardCanvas` for the active view (`TABLE` default), rendered exactly as any List (spaces-lists unit's List page body). Nothing here is bespoke: the page is a thin server component that loads `getOrCreatePersonalBoard` and renders the shared List surface with `basePath="/my-work/personal"`.
- **Side panel / drawer / modal**: the task drawer; the create-task modal preselected to this List; the view-create popover (spaces-lists).
- **States**: loading = rail pulse + card skeleton; empty = the List's inline "No tasks yet · Add task" row inside the card (design-system §5.1: no illustration inside a card); error = "Couldn't load your Personal list" + Retry; read-only = never; denied = Guest 404; offline = as My work.
- **Keyboard**: the List page's shortcuts (spaces-lists unit).
- **Data**: `getOrCreatePersonalBoard(orgId, userId)` (`src/lib/board.ts`), `GET /api/boards/[id]/items`, the views API; settings read: `density`, the List's `Board.settings.defaultItemTypeId` (settings-architecture G24) for the create modal.
- **Realtime**: the List page's (spaces-lists).
- **What changes vs today**: URL moves; the dead `PersonalListReferencePage` (`task-reference-pages.tsx:50-66`) is deleted (work-tasks 1.6, #23); the breadcrumb-style header becomes the standard List header stack; the empty copy names the List ("No tasks yet").
- **Open questions**: none.

### `/inbox`  (`src/app/(dashboard)/inbox/page.tsx`, rebuilt)

- **Purpose**: everything that needs your attention, in one place: tasks assigned to you, mentions, comments, reminders, requests and things to know, with the thing itself open beside the list.
- **Who sees it and entry points**: everyone signed in (Guests receive only mentions, assignments, comments, replies, access granted or expiring; access §2.3). Entry: sidebar "Inbox" (count), the topbar bell popover "Open Inbox" (shell unit; the bell's 6px dot mirrors the unread count), Home widget footer, command palette "Inbox" (alias "inb"), the toast on a new notification (shell), notification emails ("Open in WorkwrK" deep links land on `/inbox?n=<id>` which selects that row), the 308s from `/me/mentions` (`?tab=mentions`) and `/assigned-comments` (`?tab=primary&type=task_comment`).
- **Top bar**: breadcrumb "Work › Inbox". No back button.
- **Secondary sidebar**: Work hub; "Inbox" active with the unread count.
- **Page header stack**:
  - Title row: "Inbox" 22/600. Right: nothing.
  - Views row (text-tab pills; these are server filter presets, never client state; the URL `?tab=` is the source): **Primary** (count of unread), **Other** (count), **Mentions**, **Snoozed**, **Cleared**. Default tab from `home.notifications.inboxView.defaultTab` (Primary). "Later" is renamed **Snoozed** (the word the action uses).
  - Toolbar 44: left **Filter** (`Funnel`, opens the 272 `FilterPanel` at the left of the split; the list stays 360 and the detail pane narrows) with checkbox rows by kind: Tasks (assigned, due, status), Mentions, Comments, Reminders, Requests and approvals, People and goals (KRAs, goals, reviews, KPIs), Announcements, Kudos and surveys, Automations, Talk; a "From" person picker (`GET /api/people/pick`); "Unread only" switch. **Sort** (Newest first / Oldest first; writes `inboxView.sortNewest`). No Group (grouping by date is an Inbox option). No view switcher (one renderer). Right: no blue button (nothing to create in an Inbox; the page has zero primaries, which is allowed: at most one), a secondary **"Mark all read"** (36px secondary, rendered only when the current tab has unread rows; typed confirm not needed: 5s Undo toast), and the bordered "…" square = **Inbox options** (a `Picker`-style popover 280 with switches: Group by date (on), Show everything in Other (off; when on, Other also lists Primary rows), Auto-clear read notifications after 7 / 14 / 30 days / Never (Never), Default tab (Primary / Other / Mentions), and one text link "Notification settings" → `openSettings("/account/notifications")` (My settings › Notifications; settings-architecture §4.3)). Every switch writes `home.notifications.inboxView` through `PATCH /api/preferences` with the inline "Saved" tick (settings-architecture §7.3: the Inbox gear writes this key; the top-level `{ inbox }` PATCH that the zod schema strips today is gone and `.strict()` would 400 it).
- **Body layout** (the split from design-system §4.5: list 360 on `--os-surface-1` left, detail fluid right, both under the toolbar, 8px gap, the list has its own scroll):
  - **List (360)**: when Group by date is on, sticky 11/600 uppercase date labels with the rule: Today, Yesterday, then one label per calendar day for the last 7 days ("Mon 8 Sep"), then one per month ("August"), computed in the viewer's time zone (fixes the "Last 7 days holds everything" bucket, work-tasks #15). Rows are the **Inbox row** (§3): 64px, `--os-surface` (unread) / `--os-surface-1` (read), hairline `--os-line-soft`; left a 20px kind glyph in `--os-ink-2` (one icon per kind, table below); line 1: title 15/500 when unread, 15/400 when read, `--os-ink`, single line ellipsis; right of line 1 the time 12/400 `--os-ink-2` ("9:41", "Mon", "8 Sep"); line 2: 13/400 `--os-ink-2` context ("Priya · in Q4 leads", "in Sales handbook"); a 6px `Dots unread` at the row's left edge when unread; selected row `--os-selected`. Hover reveals three 28px ghost icons at the right end of line 1: Mark read / Mark unread (`MailOpen` / `Mail`), Snooze (`Clock`, opens the `Picker` with Later today (in 3 hours) / Tomorrow 9am / Next week Monday 9am / Pick a date), Clear (`Check`: marks read and moves to Cleared; Undo toast). Row click selects it (URL `?n=<id>`), marks it read after 1.5s of being selected (or immediately when the target opens), and loads the detail pane. Multi-select: a checkbox appears on hover at the glyph position and whenever any row is selected; the bulk bar offers Mark read · Snooze · Clear · ✕. Footer of the list: infinite scroll with a cursor (`?cursor=`), "Load more" ghost row as the keyboard-accessible alternative; the total unread lives on the tab pill.
  - **Detail pane (fluid)**: shows the selected notification's target in place, so the user never leaves the Inbox to act:
    - Task kinds (`task_assigned`, `task_comment`, `task_due_today`, `task_overdue`, `task_status_changed`, `mention` on a task, `action_item`, `reminder` with an item): `BoardItemDetail` with `host="panel"` (the one prop name across the task page, the drawer and this pane, per the task-detail unit; the drawer body without the drawer chrome; comments scrolled to the referenced comment when `link` carries `#c-<id>`), header 48: "Sales › Q4 leads › Fix invoice PDF" 13px crumbs, right: Expand (`/item/[id]?returnTo=/inbox?tab=…`), Copy link, and the same Mark read / Snooze / Clear trio.
    - Doc and SOP mentions (`mention` with a doc or SOP link): a read-only excerpt card: `EntityTile` + title 16/600, the block that holds the mention (the excerpt `/api/me/mentions` already hydrates) 15/400 in a bordered card, and one button "Open" (secondary) → the doc or SOP page at `#b-<blockId>` with `returnTo`.
    - Everything else (kudos, announcements, surveys, candor, reviews, goals, KRAs, KPIs, policies, SOP published, automations, assets, tools, requests, Talk): a summary card: kind glyph 20px, title 16/600, message 15/400, sender avatar 24 + name 13px, time, one secondary button "Open {kind}" → `link` with `returnTo`. Access requests (`access.request.*`, new from access §5.6) add the three actions the access spec names: **Give edit · Give view · Decline** (32px secondary buttons; the first is not blue because the page has no primary), each calling `POST /api/access-requests/[id]/resolve`.
    - **Target the viewer can no longer open** (the task was deleted or moved to Trash, the List was restricted after the row was written, the Doc's share was revoked, the sender left and their DM is gone): the pane never 404s and never shows a locked object's contents. It renders the same summary card with the notification's own stored title and message (the row text is already written and is the viewer's own record of what happened), a 13/400 `--os-ink-2` line saying which case it is, in the user's words: "This task was deleted" · "You no longer have access to this" · "This was moved somewhere you can't see", the kind glyph in `--os-ink-3`, no "Open" button, and the three row actions (Mark read, Snooze, Clear) still work so the row can be cleared. The list row is not hidden and is not struck through: hiding it would make an unread count unclearable. The server decides this, not the client: `GET /api/notifications` returns `target: { readable: false, reason: "deleted" | "no_access" | "moved" }` per row after `canMany` over the row targets, so the same decision drives the pane, the "Open" button and the Enter key. This matches how `/activity` renders an unreadable target as plain text and how `/favorites` prunes unreadable rows: one behaviour across the unit.
    - Nothing selected: the quiet template, four dots in a row, "Pick a notification to see it here" (no link).
  - **Kind routing table** (the source of truth for glyph, label, tab; lives in `src/lib/inbox-kinds.ts` and is unit-tested against every `notification.create` call site's `type` literal, so an unrouted type fails the build instead of landing in Other with a snake_case label; fixes work-tasks #3):

    | `type` written by the app | Kind label (user words) | Glyph | Tab |
    |---|---|---|---|
    | `task_assigned` | Assigned to you | `UserPlus` | Primary |
    | `task_comment` | Comment on your task | `MessageSquare` | Primary |
    | `mention` | Mentioned you | `AtSign` | Primary and Mentions |
    | `task_due_today`, `task_overdue` | Due today / Overdue | `CalendarClock` | Primary |
    | `reminder` | Reminder | `Bell` | Primary |
    | `action_item` | Action item from a meeting | `ListChecks` | Primary |
    | `approval`, `boundary_request` | Needs your approval | `ShieldCheck` | Primary |
    | `access.request`, `access.granted`, `access.expiring` (new, access §5.6, §2.3) | Access request / Access granted / Access expiring | `KeyRound` | Primary |
    | `okr_assigned`, `okr_check_in_due`, `kra_assigned`, `kpi_score_due` | Goal assigned / Check-in due / KRA assigned / KPI score due | `Trophy` | Primary |
    | `review_cycle_opened`, `REVIEW` (normalised to `review`) | Review to complete | `ClipboardCheck` | Primary |
    | `SURVEY` (→ `survey`), `candor_session` | Survey / Candor session | `ClipboardList` | Primary |
    | `POLICY` (→ `policy`), `policy_published` | Policy to acknowledge | `ScrollText` | Primary |
    | `sop_published` | SOP updated | `BookOpen` | Other |
    | `task_status_changed` | Task status changed | `CircleDot` | Other |
    | `KUDOS` (→ `kudos`) | Kudos | `Heart` | Other |
    | `announcement` | Announcement | `Megaphone` | Other |
    | `automation`, `automation_limit` | Automation ran / Automation limit | `Zap` | Other |
    | `asset_assigned`, `tool_shared`, `tool_created` | Asset assigned / Tool shared | `Laptop` | Other |
    | `idea_update` | Idea updated | `Lightbulb` | Other (kept only until the Ideas migration lands; the writer is deleted with `/api/ideas`) |
    | `meeting_invite` | Meeting invite | `Video` | Primary |
    | `chat_message` | Talk message | `MessageCircle` | Other (Talk has its own unread; only DM mentions reach the Inbox, talk unit) |

    Uppercase types are normalised at write time (`KUDOS`, `SURVEY`, `REVIEW`, `POLICY` → lowercase) and once by a migration over existing rows. Doc and SOP mentions start writing `mention` notifications (link `/docs/[id]#b-<blockId>` or `/sops/[id]#b-<blockId>`) at mention time (the block editor's mention handler; docs-knowledge unit flagged), and a one-time backfill turns today's `/api/me/mentions` rows into notifications, so the Mentions tab reads one source: `GET /api/notifications?tab=mentions`. `/api/me/mentions` is then deleted.
- **Side panel / drawer / modal**: the `FilterPanel` (272 → 320 drawer under 1024); the Snooze `Picker` (date variant, 288); the Inbox options popover; the task detail in the pane (never a second drawer over the Inbox). "Open" links leave the page.
- **States**: loading = rail pulse + list skeleton (8 rows of two bars at 64px) + pane skeleton; empty (tab) = four dots in a row and one sentence per tab: Primary "You're all caught up", Other "Nothing else to read", Mentions "No one has mentioned you yet", Snoozed "Nothing snoozed", Cleared "Nothing cleared yet"; no link, no ClickUp tip card; filtered-empty = the inline "No results · Clear filters" row; error = the list shows "Couldn't load your Inbox" + text link "Retry" (wired) and the tab counts show "·" (never "Inbox Zero" on an error: work-tasks #15, critic #11); read-only = n/a; denied = never (every signed-in person has an Inbox); offline / session expired = shell prompt; rows keep last data, Mark read / Snooze / Clear are queued and retried (`AutosaveIndicator` semantics in the toolbar: a 6px `saving` dot beside the tab count while a write is pending).
- **Keyboard**: ↑ ↓ move selection, Enter opens the target's full page, `e` clears (mark read + Cleared), `u` marks unread, `s` opens Snooze, `⇧E` mark all read (confirm toast), `1` `2` `3` `4` `5` switch tabs, Esc deselects, `f` filter. All listed in `src/lib/shortcuts.ts` and the `?` overlay; the old "⇧1 to ⇧4" hints go.
- **Data**: `GET /api/notifications?tab=primary|other|mentions|snoozed|cleared&kinds=&from=&unread=1&sort=&cursor=&limit=40` (rebuilt: server-side tab routing from `inbox-kinds.ts`, cursor pagination replacing the `take: 50`, and `target.readable` per row from `canMany`); `GET /api/inbox/count` (the existing route at `src/app/api/inbox/count/route.ts`, kept as the ONE unread counter for the sidebar badge, the top-bar bell and the Home widget; it is rebuilt to count through `inbox-kinds.ts` so "unread" means the same thing as the Primary and Other tabs, and it keeps its snooze filter. No `?count=1` mode is added to `/api/notifications`: two counters for one badge is the bug, not the fix); `PATCH /api/notifications { ids[], read: true|false }` (unread is new), `{ ids[], snoozeUntil }` (exists), `{ markAllRead: true, tab }` (tab-scoped); `DELETE /api/notifications { allRead: true, olderThanDays }` for auto-clear (a daily cron row reads `inboxView.autoClearDays`; documented in `scripts/CRON-SETUP.md`); `GET /api/items/[id]` for the pane; `POST /api/access-requests/[id]/resolve` (access unit). Settings read: `home.notifications.inboxView` (groupByDate, showAllInOther, autoClearDays, defaultTab, sortNewest), `home.notifications.mutedUntil` (a slim 36px strip under the toolbar "Notifications muted until 6pm · Unmute" when set), `home.locale.timezone`.
- **Realtime**: SSE `workwrk:notif-changed` (shell RealtimeClient) prepends new rows and updates counts; the 45s poll stays as the fallback; focus / visibility re-fetch; the sidebar count and the bell dot update from the same event.
- **What changes vs today**: preferences persist (work-tasks #2, shell #3, critic #7); "Show All tab" becomes an honestly named "Show everything in Other" switch; the kind map covers every type the app writes (#3); "Assigned to me", "Unread" and "Reminders" filters work because they run server-side on the routing table (#15); errors surface (#15, critic #11); date groups are real days (#15); pagination past 50 (#15, critic #12); the ⇧1 to ⇧4 hints go (#15); "Fullscreen vs Inline" display mode goes (#15: two modes that rendered the same list); the decorative `Circle` lead icon becomes a real multi-select checkbox (#15); the "Clear" and "Mark read" duplication becomes three distinct actions (#15); the ClickUp "Pin your Favorites bar" tip goes (#15); the plain "Loading inbox…" text becomes skeletons (#11); Mentions from docs and SOPs arrive here (#14 merge); `/assigned-comments` becomes a filter (#4); per-type notification switches live in My settings › Notifications with the six existing keys (the settings unit lists the rest under "Show upcoming features"; work-tasks #15 item 14 is deferred there).
- **Open questions**: (1) Should Talk messages ever land in the Inbox? Recommendation: only direct mentions in DMs and channels the viewer is in, as `mention`; plain messages stay in Talk (talk unit to confirm). (2) Should "Mark all read" be per tab or global? Recommendation: per tab, with the Undo toast.

### `/favorites`  (`src/app/(dashboard)/favorites/page.tsx`, rebuilt)

- **Purpose**: everything you have starred, in one list, so you can find it or unstar it.
- **Who sees it and entry points**: Owner, Admin, Member, Agent; never Guests (§1 Access). Entry: the FAVORITES section's "See all favorites" row, which renders whenever the section renders; the toast shown the first time the viewer stars anything ("Starred · See all favorites"); command palette "Favorites". The section **label** is not an entry point: per design-system §4.2 a section label collapses its section and does nothing else, so one click target never carries two meanings.
- **Top bar**: breadcrumb "Work › Favorites". No back button.
- **Secondary sidebar**: Work hub; the FAVORITES section's "See all favorites" row is the active row (N200 pill); the section is expanded.
- **Page header stack**: title row "Favorites" 22/600; right nothing. Views row: does not render (one view). Toolbar: left **Filter** (`FilterPanel`: Kind checkboxes Spaces / Folders / Lists / Docs / Tables / Canvases / Files), **Sort** (Recently starred (default) / Name / Kind); no Group; no view switcher. Right: no blue button (starring happens on objects; zero primaries), a bordered "…" square with **Display** (Show location column, on; Show starred date, on). Both switches persist to `home.work.surface.favorites.viewOptions` (settings-architecture §7.3's per-surface view options key, the same family My work and Everything use), written debounced 400ms and read on mount. Nothing visible here is unpersisted.
- **Body layout**: one `TableCard`: columns Name (`EntityTile size="sm"` neutral + name 15/500, a link), Kind (12/500 neutral `Chip`: Space, Folder, List, Doc, Table, Canvas, File), Location (13/400 `--os-ink-2`, "Sales › Q4" as crumbs, links), Starred (12/400 relative time), and a 28px ghost `Star` (filled `--os-ink`) at the row end that unstars with a 5s Undo toast. Rows 44/36/32, hairlines, hover, click opens the object (a File opens in a new tab like the sidebar). Footer "Total records 14" (no pagination under 200; cursor above). The top-pinned chips (`TopPinsStrip`, shell unit) are not repeated here; a row's "…" offers "Pin to top" / "Unpin from top" (writes `/api/me/pins`) so both concepts are reachable from one list.
- **Side panel / drawer / modal**: the `FilterPanel`; no drawer (rows navigate).
- **States**: loading = rail pulse + card skeleton; empty = four dots in a row, "Nothing starred yet. Star a Space, List, Doc, Table, Canvas, Folder or File from its … menu." (no link); filtered-empty inline row; error = "Couldn't load your favorites" + Retry; read-only = n/a; denied = Guest 404 in the shell; offline = shell prompt.
- **Keyboard**: ↑ ↓, Enter opens, `s` unstars the focused row (Undo), `f` filter.
- **Data**: `GET /api/me/favorites` (new aggregate over the seven `favorite*Ids` preference keys, hydrated and filtered by `accessibleIds` per kind; unreadable ids are pruned from the preference on read), `POST /api/me/favorites/{kind} { id, on: false }` (exists) for unstar, `POST /api/me/pins`. Settings read: `density`, `home.work.surface.favorites.viewOptions`.
- **Realtime**: `workwrk:prefs-changed` (existing event) re-fetches; starring elsewhere updates the sidebar and this page from the same event.
- **What changes vs today**: the page stops being a pinboard of Sidekick chats (work-tasks 1.11, shell #14): those move to `/sidekick?pinned=1` (AI unit; the "Pinned" filter in Sidekick history) and the redirect table in §0 records it; the `OsTitleBar` with the fake `PEOPLE.bb` avatar and the dead Ask AI / Share / Invite trio goes (#7, shell #39); the "Cross-module starring is shipping soon" copy goes (starring shipped); the `fav__*` BEM CSS and gradient icons go (#24); the sidebar Favorites empty copy names all seven kinds (#22).
- **Open questions**: none.

### `/activity`  (`src/app/(dashboard)/activity/page.tsx`, rebuilt)

- **Purpose**: what happened recently: what you did, and, if you manage people, what your team did.
- **Who sees it and entry points**: Owner, Admin, Member, Agent; never Guests. Entry: sidebar "Activity", command palette "Activity" (the re-pointed "Open My Activity"), the block editor's activity link (`block-editor.tsx`), a person's profile "Activity" tab link (teams-people unit) → `/activity?view=team&person=<id>`.
- **Top bar**: breadcrumb "Work › Activity". No back button.
- **Secondary sidebar**: Work hub; "Activity" active.
- **Page header stack**: title row "Activity" 22/600. Views row (text-tab pills; the URL `?view=` is the source; a pill renders only when the viewer may use it): **Just me** (everyone), **My team** (viewers with reports: their whole chain), **Everyone** (People team, Owner, Admin). Toolbar: left **Filter** (`FilterPanel`: Type (from `GET /api/activity/types`, user words: Tasks, Docs, SOPs, Goals, People, Spaces and Lists, Kudos, Settings), Person (picker over the viewer's chain, rendered only on My team / Everyone), Date range (Today / 7 days / 30 days / Custom)), no Sort (newest first, fixed), no Group (days are fixed), no view switcher. Right: no blue button (nothing to create), "…" with **Export CSV** (`export` action; never Guests, Agents, acting-as).
- **Body layout**: one bordered card (`TableCard` without a header row): sticky day labels 11/600 uppercase with rule (Today, Yesterday, "Mon 8 Sep"), rows 44 (fixed; not density-driven, one line each): avatar 24 + sentence 15/400 in user words built from the verb ("Priya completed", "Dev commented on", "Anita moved") + the target as a link chip (neutral `Chip` with the kind glyph 12px + name; resolved from the lowercase `targetType` the app actually writes: `item` → `/item/[id]`, `board` → `/boards/[slug]`, `space` → `/spaces/[slug]`, `folder` → `/folders/[id]`, `doc` → `/docs/[id]`, `sop` → `/sops/[id]`, `okr` → `/okrs/[id]`, `kra` → `/kra-kpi?kra=`, `user` → `/people/[id]`, `kudos` → `/kudos`, `survey` → `/surveys/[id]`, `organization` → no link, plain text), then time 12/400 right. A target the viewer can no longer read renders as plain text (never a link that 404s). Footer "Total records 212 · 1 to 50 ‹ ›" (server pagination, exists in the API).
- **Side panel / drawer / modal**: `FilterPanel`; an `item` chip opens the task drawer (URL `/item/[id]`) rather than navigating, everything else navigates.
- **States**: loading = rail pulse + card skeleton; empty = four dots in a row, "Nothing yet. Your activity shows up here as you work." (Just me) / "Your team hasn't done anything in this range." (no link); filtered-empty inline row; error = "Couldn't load activity" + Retry (wired); read-only = n/a; denied = Guest 404; offline = shell prompt.
- **Keyboard**: ↑ ↓, Enter opens the target, `1` `2` `3` switch the views the viewer has, `f` filter.
- **Data**: `GET /api/activity?scope=my|team|all&type=&actorIds=&from=&to=&page=&limit=50` (exists; the silent downgrade at `api/activity/route.ts:24` becomes an explicit 403 `no_access` on `scope=team|all` for a viewer without reports, which the page never requests because it never renders those pills. No new app key is invented for this: `activity` is not an `AppEntry.key` and access §5.2.1 has no row for it, so the route gates on the `home` app key like every other Work-hub page and then asks the same question the "My team" pill asks, in the access model's own vocabulary: `scope=team` needs `useViewer().hasReports` (solid or dotted, any depth), `scope=all` needs the People team, Owner or Admin. `isManager` disappears; `accessibleUsers(viewer)` supplies the chain), `GET /api/activity/types` (new, the distinct lowercase families). Settings read: `home.locale.timezone`.
- **Realtime**: no "Live" dot (nothing bumps `rowVersion("activity")` today, work-tasks #8); the page re-fetches on focus / visibility and every 60s while visible; when the shell's SSE emits `workwrk:activity-changed` the poll stops (shell unit documents the event; until then the dot never renders).
- **What changes vs today**: `OsTitleBar` with fake BB / MK / SC "+8" avatars and the dead trio goes (#7, shell #39); Task chips stop linking to `/tasks?id=` (#8); every written `targetType` renders a chip because the map is lowercase (#8); ICs no longer see "My team" selected while getting "my" (#8); the dead "Explore modules" CTA goes (#8); `actfeed__*` BEM and per-verb hue colours go (#24); the page has a sidebar row (#13, shell #15).
- **Open questions**: none.

### `/everything`  (`src/app/(dashboard)/everything/page.tsx` + `everything-view.tsx`, kept and finished)

- **Purpose**: every task in every Space you can see, as one list, so you can find anything without knowing which List it is in; and, when you arrive from a Space or a Folder, every task inside it.

  URL contract (the whole set of params this page reads, so the redirects pointed here have a defined landing): `?space=<slug>` scopes to one Space, `?folder=<id>` scopes to one Folder (`space` and `folder` are also pre-filled into the Filter panel's Space and List rows, so the scope is visible and removable, and the title row adds the scope as a second crumb, see Page header stack); `?view=list|board|calendar` picks the view; `?group=`, `?sort=`, `?filters=`, `?cursor=`, `?done=0|1` mirror My work's. `view=gantt` is accepted and resolves to `view=list` (Gantt is a List view, never a cross-List one); `view=team` is accepted and resolves to `view=list&group=assignee` (that is what the old Space "team" view showed). An unknown value falls back to `list` rather than erroring. Params are the single source: nothing about the scope is client state.
- **Who sees it and entry points**: Owner, Admin, Member, Agent; never Guests (§1 Access). Entry: sidebar SPACES › "Everything", command palette "Everything", the task page's `BackButton` fallback when the task's List is unreadable, the Space Overview's "All tasks in this Space" link (`/everything?space=<slug>`, spaces-lists §2), the Folder page's "All tasks in this folder" link (`/everything?folder=<id>`), and the five redirects spec-spaces-lists §0 sends here (`/spaces/[slug]?view=list|board|calendar|gantt|team` and `/folders/[id]?view=list`), each of which this page honours through the URL contract above.
- **Top bar**: breadcrumb "Work › Everything", and "Work › Everything › {Space}" or "Work › Everything › {Space} › {Folder}" when the URL carries a scope (the scope crumbs are links back to `/spaces/[slug]` and `/folders/[id]`). No back button.
- **Secondary sidebar**: Work hub; "Everything" active (SPACES section) when there is no scope. With `?space=` or `?folder=` the Spaces tree's matching Space or Folder row is active instead and the tree is expanded to it, because that is where the user came from and where they expect to be (the shell's URL-derived rule reads the param).
- **Page header stack**: title row "Everything" 22/600, or the scope's name with a 13/400 `--os-ink-2` "All tasks in this Space" / "All tasks in this folder" caption beside it when scoped (the "· N items" suffix goes; the count is the card footer). Views row: **All** plus the viewer's saved filters for Everything (`home.work.everythingFilters[]`, same shape as My work's) and "+ View". Toolbar: **Filter** (`FilterPanel`: Space, List, Assignee (`GET /api/people/pick`), Status, Priority, Due date, Tags, Type, Created by, Includes subtasks; a `space` or `folder` param arrives pre-selected here and can be cleared, which drops the param from the URL), **Sort** (Created (newest, default) / Updated / Due date / Priority / Title), **Group** (**List** (default; header shows "Sales › Q4 leads" as `EntityTile size="xs"` + crumbs 15/500 + count) / Status / Assignee / Due date / None), divider, view switcher: **list** (`List`), **board** (`Kanban`), **calendar** (`Calendar`), the same three as My work and rendered by the same components, because the Space-wide list, board and calendar views redirect here and must land on something real. Right: the one blue **"Create task"** (the modal with its List picker, pre-selected to the scope's first writable List when scoped) and "…" with **Display** (Fields: Title, Status, Assignees, Due date, Priority visible by default; plus Space, List, Tags, Type, Created, Updated; Show done tasks (off); Show subtasks (on); Solid status column (off)) and **Export CSV** (`export` action).
- **Body layout**: one `TableCard` exactly as My work's list view, with these differences: the List column is always shown when not grouped by List; rows from Lists where the viewer holds Can view or Can comment render plain text cells (no inline edit, no drag, no checkbox actions beyond selection for export) and the row's "…" offers Open, Copy link only; rows from Can edit / Full access Lists edit inline. Per-List statuses render as the List's own pale chips (no grey "orphan" buckets: grouping by Status matches names across Lists and shows the List count under the header). Footer "Total records 1,284 · 1 to 50 ‹ ›" with cursor pagination and page size 50 / 100 (the 500 cap and the "500+" label go). Group headers collapse per user (`home.work.surface.everything`).
- **Side panel / drawer / modal**: the task drawer (URL `/item/[id]`, the list dims to 92%); the create-task modal; `FilterPanel`.
- **States**: loading = rail pulse + card skeleton; empty = four dots in a row, "No tasks in your Spaces yet", link "Create a task" (the toolbar button stays the only primary); filtered-empty inline row; error = "Couldn't load tasks" + Retry; read-only = per row as above, and when every readable List is Can view the toolbar still shows "Create task" only if the viewer holds Can edit somewhere (the modal's picker would otherwise be empty; then the primary is absent and the empty state says "You can view tasks here but not create them"); denied = Guest 404 in the shell (§1 Access); offline = shell prompt, edits queued.
- **Keyboard**: as My work.
- **Data**: `GET /api/me/everything?space=&folder=&view=&group=&sort=&filters=&cursor=&limit=50&done=0|1` (rebuilt from `listEverythingItems`; `space` and `folder` narrow the readable set server-side before paging, never client-side after it: `accessibleIds(viewer, "list", VIEW).readable` replaces the per-board `getBoardForReader` loop, cursor pagination replaces `EVERYTHING_CAP`, per-row `role` from `canMany` for the read-only decision, tags and comment counts batched), `PATCH /api/items/[id]`, `POST /api/items/bulk`, `GET /api/me/everything/export.csv` (new). Settings read: `home.work.everythingFilters[]`, `home.work.surface.everything`, `density`, `home.locale.*`.
- **Realtime**: `workwrk:item-created` / `workwrk:item-changed` re-fetch the current page; 30s poll `?since=` while visible.
- **What changes vs today**: the 500 cap and "500+" (work-tasks 1.10, critic #12); filters and saved views exist; the header becomes the standard stack; orphan grey status buckets go; the stale sidebar is fixed by the row (#12); "Everything" and "All Tasks" are one thing (#21); rows honour read-only mode (critic #4); the page gains the `space`, `folder` and `view` contract so the five Space-wide and Folder-wide views spec-spaces-lists §0 retires land here instead of nowhere, and a Space's tasks are rendered with each List's own statuses rather than the Space wizard palette (spaces-lists audit High #3).
- **Open questions**: none.

### `/assigned-comments`  (`src/app/(dashboard)/assigned-comments/page.tsx`, deleted; 308 → `/inbox?tab=primary&type=task_comment`)

- **Purpose**: none (redirect).
- **Who sees it and entry points**: old links only; the sidebar row and the My Wrk card link are gone.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: none. When comment assignment ships (task-detail unit adds the assign action to `CommentThread` and `ItemUpdate.assigneeId`), the writer creates a `comment_assigned` notification (Primary, glyph `MessageSquare`, label "Comment assigned to you") and the Inbox `FilterPanel` gains the row "Assigned comments"; the page never returns.
- **Realtime**: none.
- **What changes vs today**: a stub presented as a finished page, with a dead Filter pill and cosmetic Resolved / date / search controls, goes (work-tasks #4, critic #2).
- **Open questions**: none.

### `/me/mentions`  (`src/app/(dashboard)/me/mentions/page.tsx`, deleted; permanent 308 → `/inbox?tab=mentions`)

- **Purpose**: none (redirect; settings-architecture §7.1 1.30 and §8.4 already decided it).
- **Who sees it and entry points**: old links only.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: `/api/me/mentions` is deleted after the one-time backfill described under `/inbox` (doc and SOP mentions become `mention` notifications with block deep links).
- **Realtime**: none.
- **What changes vs today**: the orphan page with the dead trio, the hidden Retry and "Open notes" CTAs, and no read state goes (work-tasks 1.14, misc-apps 1.24, #14).
- **Open questions**: none.

### `/me/weekly-review`  (`src/app/(dashboard)/me/weekly-review/page.tsx` + `components/me/weekly-review-form.tsx`, kept and restyled)

- **Purpose**: your weekly check-in: how each of your KRAs went, your KPI numbers, what went well, what blocked you, and your plan for next week.
- **Who sees it and entry points**: Owner, Admin, Member, Agent (own review); never Guests (404). Entry: Home "Weekly review" widget; own profile's Reviews tab "Weekly review" (teams-people unit); the Inbox row `kpi_score_due` / review reminders; command palette "Weekly review"; the manager's view of a report's review lives on the report's profile (teams-people / goals units), never on this URL.
- **Top bar**: breadcrumb "Work › Home › Weekly review" (the Home crumb links). Title row carries `BackButton{fallbackHref="/home"}` labelled "Home".
- **Secondary sidebar**: Work hub; "Home" active.
- **Page header stack**: title row 48: `BackButton` + "Weekly review" 22/600; right: the `AutosaveIndicator` (saving / saved / "Not saved, retrying") and nothing else. Views row (text-tab pills, the URL `?week=YYYY-MM-DD` is the source): **This week**, **Last week**, then the previous 6 weeks as "8 Sep", "1 Sep"… overflowing into "•••" (gives the missing history, work-tasks 1.15 / misc-apps 1.25); a week with a submitted review shows a 6px success dot inside its pill beside the word. Toolbar: does not render (the page has no Filter / Sort and its one primary sits in the form footer; design-system §4.4 lists review pages among those where the views row and toolbar are not the list pattern; here the views row is kept because weeks are genuinely views).
- **Body layout** (720 column centred, form cards per design-system §5.4, 24px between cards):
  1. **Status strip** (a 44px row above the cards, not a banner): a pale `StatusChip` (Not started / In progress / Submitted / Reviewed by {manager} on {date}) + the week range 13/400 `--os-ink-2` + "Due Friday 6pm" when the org cadence sets one (settings-architecture §5.16 `reviewCadences`).
  2. **Your KRAs** card: one row per active KRA assignment: KRA title 15/500, weight 12/500 neutral chip, a 0 to 100 slider (step 5, 36px track, `--os-brand` fill, the value 14/500 to the right, `aria-valuetext` "70 percent"), and a one-line note input under it (36px). Empty: "No KRAs assigned yet. Ask your manager or the People team." (no raw path: fixes misc-apps #25).
  3. **Your KPIs** card: one row per KPI: title, target 13/400, a number input 36px with the unit as a suffix, last value 12/400 `--os-ink-2`.
  4. **Highlights**, **Blockers**, **Plan for next week**: one card each, a textarea min 3 rows auto-grow to 12.
  5. Footer under the last card (left-aligned per design-system §5.4 for pages): the one blue **"Submit for review"** (36px) when the review is a draft; **"Reopen"** (secondary) when submitted and not yet reviewed; nothing when reviewed (the strip says so). No "Save draft" button: every field autosaves on blur and 2s after the last keystroke with keepalive + retry, and the indicator in the title row shows it (data-integrity rule; the file's "no autosave" note is closed). A submitted review renders read-only (values as text, sliders disabled are not rendered: the slider becomes a 4px progress pill with the number).
  6. **Manager note** card (rendered only when the manager left one): avatar, name, note 15/400, date.
- **Side panel / drawer / modal**: none; Submit opens a 400 confirm ("Submit this week's review? You can reopen it until your manager reviews it.").
- **States**: loading = rail pulse + card skeletons; empty (no KRAs and no KPIs) = the cluster illustration, "Nothing to review yet", and the Highlights / Blockers / Plan cards still render so the heartbeat works without KRAs; error = "Couldn't load this week" + Retry; read-only = submitted or reviewed weeks; denied = Guest 404; offline / session expired = shell prompt; unsaved edits are kept in memory and retried (indicator "Not saved, retrying", then "Not saved" with Retry after the budget).
- **Keyboard**: ⌘Enter submits (with the confirm), ← → move between week pills when the views row is focused, Esc nothing.
- **Data**: `GET /api/me/weekly-review?week=` (exists: `/api/me/weekly-review` and `[id]`), `PATCH /api/me/weekly-review/[id]` autosave, `POST …/submit`, `POST …/reopen` (the goals unit owns the review-loop API; this page is its employee surface). Settings read: `home.locale.weekStart` (the week boundary), `settings.reviewCadences` (due day via `GET /api/settings` public fields).
- **Realtime**: none (manager review arrival is an Inbox row; the page re-fetches on focus).
- **What changes vs today**: `BackButton` and breadcrumb replace the "Today › Weekly review" crumb to a redirect (work-tasks #19, 1.15); the 2xl h1 becomes the 22/600 page title; the page gets a sidebar hub (#12, misc-apps 1.25); week history exists; autosave with a visible contract replaces explicit Save; the raw "/kra-kpi" path leaves the copy (misc-apps #25); the dead `components/today/my-alignment.tsx` entry is replaced by the Home widget (#23).
- **Open questions**: (1) Should the review be reachable one week back only, or for the whole history? Recommendation: 8 weeks in the pills, "•••" opens a month picker for older weeks.

### `/tasks`  (`src/app/(dashboard)/tasks/page.tsx`, deleted; 308 → `/home`)

- **Purpose**: none (redirect for the old My Wrk card grid).
- **Who sees it and entry points**: old links: command palette "My tasks G K" and "Open My Work" (both become "My work" → `/my-work`), the Activity feed's `/tasks?id=` chips (fixed in `/activity`), the `/tasks/[id]` back label (gone), the analytics tile (gone).
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: `home.taskCardLayout`, `home.taskCardLayoutV3`, `home.taskCardsHidden` keys are accepted and ignored for one release (settings-architecture §9.3's tolerance rule), then removed from the zod schema. The `mytasks-grid` CSS duplicated in `globals.css` and `os.css` and the undefined `dash-card-handle` class are deleted.
- **Realtime**: none.
- **What changes vs today**: see `/home`.
- **Open questions**: none.

### `/tasks/assigned-to-me`  (`src/app/(dashboard)/tasks/assigned-to-me/page.tsx`, deleted; 308 → `/my-work`)

- **Purpose**: none (redirect).
- **Who sees it and entry points**: old links; the sidebar child now points at `/my-work`.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: the legacy `Task` rows the page created are migrated to Items in the assignee's Personal list (§4), so nothing a person typed here is lost; `/api/tasks` (GET/POST), `/api/tasks/batch`, `/api/tasks/reorder-day`, `/api/tasks/[id]/comments` are deleted after the migration flip; `/api/custom-fields` `targetType: "TASK"` values are reported in the dry run and dropped only where no BOARD_ITEM field of the same name exists.
- **Realtime**: none.
- **What changes vs today**: the wrong-model surface (work-tasks 1.4, #1, #14) goes.
- **Open questions**: none.

### `/tasks/backlog`  (`src/app/(dashboard)/tasks/backlog/page.tsx`, deleted; 308 → `/my-work?group=due&bucket=nodate`)

- **Purpose**: none (redirect; the "No date" group of My work, expanded and scrolled into view, is the backlog).
- **Who sees it and entry points**: URL only today (work-tasks 1.8); `src/lib/products/catalog.ts:66` `landingHref` is re-pointed to `/my-work`.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: legacy rows migrated (§4); the `bklg__*` CSS family is deleted.
- **Realtime**: none.
- **What changes vs today**: the orphan page with fake avatars, `GRAD` icons, and dead "Retry" / "Plan a task" CTAs goes; bulk promote / archive exist in My work's bulk bar as Set due date / Mark done.
- **Open questions**: none.

### `/tasks/board`  (`src/app/(dashboard)/tasks/board/page.tsx`, deleted; 308 → `/my-work?view=board`)

- **Purpose**: none (redirect to My work's Board view).
- **Who sees it and entry points**: URL only today.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: legacy rows migrated; `spbd__*` CSS deleted. The workload strip the page showed is the Teams hub's `/team/workload` (teams-people unit).
- **Realtime**: none.
- **What changes vs today**: the orphan page goes.
- **Open questions**: none.

### `/tasks/calendar`  (`src/app/(dashboard)/tasks/calendar/page.tsx`, deleted; 308 → `/planner`)

- **Purpose**: none (redirect; the planner unit's one calendar shows the viewer's tasks with drag to reschedule, week start and time zone from `home.locale`).
- **Who sees it and entry points**: URL only today.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: legacy rows migrated; `tcal__*` CSS deleted; the UTC bucketing bug (critic #13) dies with the page.
- **Realtime**: none.
- **What changes vs today**: the orphan page goes; the Planner reads Items (planner unit; flagged, because `planner-week.tsx`, `planner-side-panel.tsx` and `planner-command-bar.tsx` call `/api/tasks` today).
- **Open questions**: none.

### `/tasks/gantt`  (`src/app/(dashboard)/tasks/gantt/page.tsx`, deleted; 308 → `/my-work`)

- **Purpose**: none (redirect).
- **Who sees it and entry points**: URL only today.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: legacy rows migrated; `gantt__*` CSS deleted. Gantt stays a List view (spaces-lists unit, `BoardCanvas` GANTT) and on Personal list.
- **Realtime**: none.
- **What changes vs today**: the orphan page goes.
- **Open questions**: none.

### `/tasks/personal-list`  (`src/app/(dashboard)/tasks/personal-list/page.tsx`, moved; 308 → `/my-work/personal`)

- **Purpose**: none (redirect to the moved page).
- **Who sees it and entry points**: old links; `basePath` in `BoardViewTabs` and the create-task modal's `LAST_LIST_KEY` fallback are re-pointed.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: none (the board and its Views are unchanged; only the URL moves).
- **Realtime**: none.
- **What changes vs today**: URL only.
- **Open questions**: none.

### `/tasks/sprint`  (`src/app/(dashboard)/tasks/sprint/page.tsx`, deleted; 308 → `/my-work`)

- **Purpose**: none (redirect).
- **Who sees it and entry points**: URL only today.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: legacy rows migrated; `sprint__*` CSS deleted. Real sprints are List-level (`CreateSprintModal`, spaces-lists unit); the hard-coded 14-day window, the dead "End sprint" / "Start next" buttons and the client-side burndown go.
- **Realtime**: none.
- **What changes vs today**: the orphan page goes.
- **Open questions**: none.

### `/tasks/today-overdue`  (`src/app/(dashboard)/tasks/today-overdue/page.tsx`, deleted; 308 → `/my-work`)

- **Purpose**: none (redirect; My work's default grouping is Overdue / Today / Tomorrow / This week / Later / No date, which is what this page showed on the wrong model).
- **Who sees it and entry points**: old sidebar child only.
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: legacy rows migrated. The "Delegated" tab's meaning (tasks I created and assigned to others) becomes the My work filter switch "Created by me" combined with Assignee ≠ me.
- **Realtime**: none.
- **What changes vs today**: the dead Settings button, the "Connect" buttons that were not even disabled, and the two "My Work" surfaces with the same name and different rows go (work-tasks #16).
- **Open questions**: none.

### `/tasks/[id]`  (`src/app/(dashboard)/tasks/[id]/page.tsx`, body replaced by a server redirect; → `/item/[id]`)

- **Purpose**: an old task link still opens the task.
- **Who sees it and entry points**: old links from the block editor's task block "Open" (`block-editor.tsx:3528`, re-pointed to `/item/[id]` for new blocks; old blocks keep the legacy id and pass through this page), old emails, bookmarks.
- **Top bar**: none rendered on a hit (the `redirect()` answers during render); on a miss the shell's chrome stays and the in-frame 404 renders inside it.
- **Secondary sidebar**: none on a hit; on a miss the Work hub sidebar stays as it is (the 404 renders inside the shell, `spec-shell` §2.4).
- **Page header stack**: none.
- **Body layout**: none on a hit. On a miss, `spec-shell` §2.4's one 404 body, unchanged and with no per-route copy: "We couldn't find that page", the text link "Search", and `BackButton{fallbackHref: hub.defaultHref, label: hub.label}`, which here resolves to `/home` labelled "Work".
- **Side panel / drawer / modal**: none.
- **States**: none of its own (a hit is a 307 from `redirect()`, a miss is the shell's 404).
- **Keyboard**: none.
- **Data**: this stays a **`page.tsx`**, a server component whose whole body is the lookup plus `redirect()` or `notFound()`. It is never a `route.ts`: Next forbids a `route.js` at the same segment level as a `page.js` (`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` line 39, "there **cannot** be a `route.js` file at the same route segment level as `page.js`"), so a handler beside the page would not build, and W0 needs the page to keep rendering the legacy detail until W4 flips it. Lookup: `prisma.item.findFirst({ where: { organizationId, metadata: { path: ["legacyTaskId"], equals: id } } })` after the migration; `redirect("/item/<item.id>")` with the query string preserved; `notFound()` otherwise. The page runs `gatePage`'s org scoping (rule 1) so a cross-org id is a 404 identical to a miss (access invariant 1).
- **What changes vs today**: the legacy full-page detail with its `tdt__*` hue CSS, `GRAD.bluePurple`, Critical / Medium priority words, a ±365-day scan to find the row, dead Attach / Emoji / Mention composer icons, a dead "More" button, a dead not-found CTA and a hard `router.push("/tasks")` back goes (work-tasks 1.7, #10, #17, #19). One task detail remains (task-detail unit).
- **Realtime**: none.
- **Open questions**: none.

### `/ideas`  (`src/app/(dashboard)/ideas/page.tsx`, deleted; 308 → `/boards/<ideas-list-slug>` when migrated, else `/templates?q=ideas`)

- **Purpose**: none (merge). Ideas become an ordinary List made from the **"Ideas board"** template in the Template Center (spaces-lists unit owns the template: statuses Submitted / Under review / Approved / Implemented / Rejected / Rewarded, a Number field "Votes" with a Rating-style upvote later if the field catalog adds one, a Category select Product / Process / Culture / Cost-cutting, Board view default). Reviewing ideas is then a matter of who holds Can edit on that List; the access spec already deletes `ideas.*` (§9).
- **Who sees it and entry points**: old links only (the page was URL-only, misc-apps 1.6).
- **Top bar**: none rendered (a 308 answers before anything paints).
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: none.
- **Side panel / drawer / modal**: none.
- **States**: none.
- **Keyboard**: none.
- **Data**: migration (§4): for each org with `Idea` rows, create the List "Ideas" in the org's first Space (the seeded "General" Space where it exists, settings-architecture §11.1) from the template, map `status` → the List statuses, `votes` → Votes, `category` → Category, `title` / `description` → task, `IdeaComment` → `ItemUpdate`; the submitter is the task owner; write `Item.metadata.legacyIdeaId`. A redirect map row `{ orgId, boardSlug }` lets `/ideas` 308 to the right List per org (a small `LegacyRedirect` table, also used by `/tasks/[id]` lookups if the metadata query proves slow). `/api/ideas*` and the `idea_update` notification writer are deleted after the flip.
- **Realtime**: none.
- **What changes vs today**: an orphan page with drag that 403s for employees, fake avatars, hidden CTAs, comments that could not be opened, and no keyboard alternative goes (misc-apps 1.6, High #5, #7, #13, #14). Nothing anyone typed is lost.
- **Open questions**: (1) Migrate every org's ideas into a List automatically, or only orgs that have at least one idea? Recommendation: only orgs with ideas; others get nothing and the redirect goes to the template.

### `/analytics`  (`src/app/(dashboard)/analytics/page.tsx` + `analytics/layout.tsx`, rebuilt; Teams hub)

- **Purpose**: how the people you manage are doing on their work: open, done and overdue tasks, hours logged, SOPs acknowledged, over a period.
- **Who sees it and entry points**: anyone with reports (their chain), the People team and Owner / Admin (the org), per access §5.2.1 `analytics`; never Guests. Entry: Teams sidebar **row 15, in the PERFORMANCE section** (label "Analytics", icon `LineChart`, href `/analytics`, gating = the rule above; the full row is specified in §1 and is a hard contract on the teams-people unit, §4), command palette "Analytics" (rendered through `visibleApps`), a link from `/team` overview (teams-people). The Settings Overview "AI usage" card no longer points here (settings-workspace unit, §5.1 there).
- **Top bar**: breadcrumb "Teams › Analytics". No back button.
- **Secondary sidebar**: Teams hub; "Analytics" active.
- **Page header stack**: title row "Analytics" 22/600; right nothing. Views row (text-tab pills, `?view=`): **My team** (the viewer's chain; rendered for anyone with reports), **Everyone** (People team, Owner, Admin only). Toolbar: **Filter** (`FilterPanel`: Period (This week / This month / Last 30 days (default) / This quarter / Custom), Department (Everyone view only), Person (chain picker)), no Sort, no Group, no view switcher. Right: no blue button (nothing to create), "…" with **Export CSV** (`export`: Admin for org-wide, otherwise the viewer's chain; never Guests, Agents, acting-as).
- **Body layout** (24px padding):
  1. **Stat tiles** row (a 5-up grid of bordered cards, radius 8, padding 16, title 13/500 `--os-ink-2`, value 22/600 `tnum`, a 12px delta vs the previous period as text "▲ 12%" in `--os-ink-2`, never coloured unless it means at risk (overdue up → `--os-danger-text` paired with the arrow); the dataviz skill's brand-neutral palette applies, semantic colour only where it means danger): Open tasks · Completed this period · Overdue · Hours logged · SOPs acknowledged.
  2. **Completed per week** chart card: a bar chart (dataviz skill, one neutral series, `--os-brand` for the current week only) over the period, with hover tooltips; 240px tall.
  3. **By person** `TableCard`: Person (avatar 24 + name), Open, Done, Overdue, Hours, SOP acks; sortable; rows 44/36/32; row click → `/people/[id]` (teams-people). Footer totals.
  4. **By List** `TableCard`: List (`EntityTile size="xs"` + Space › List), Open, Done, Overdue; row click → `/boards/[slug]`.
- **Side panel / drawer / modal**: `FilterPanel` only.
- **States**: loading = rail pulse + tile and card skeletons; empty (no reports produced anything in the period) = the 2×2 grid illustration, "No activity in this period" and the Period filter stays; error = "Couldn't load analytics" + Retry; read-only = n/a; denied = the shell's in-frame 404 for a Member without reports and for any Guest, per access §5.2.1 (a viewer who fails an app key's rule does not get the row and the route 404s) and §5.5 rule 2; the 404 is `spec-shell` §2.4's one page, "We couldn't find that page" with the "Search" link and `BackButton{fallbackHref: hub.defaultHref, label: hub.label}` (Teams › `/people` for a Member with no reports, per the Teams hub's role-derived `defaultHref`). No `LockedPage`: that component always carries "Request access" and belongs to a discoverable object with an owner, and there is nobody to ask for a manager chain; offline = shell prompt.
- **Keyboard**: `f` filter, `1` `2` views.
- **Data**: `GET /api/analytics?scope=team|org&from=&to=&departmentId=&personId=` (rebuilt on Items and the people the viewer can see: `accessibleIds(viewer, "person", VIEW)` for scope=team, the org for scope=org; the current route's SOP compliance and KPI averages are kept as inputs to "SOPs acknowledged"; the `Task`-based counts, `purchaseOrder`, financial and planning tiles go; `getTopPerformers` moves to the teams-performance unit's `/team/performance` when the AI Performance Manager ships), `GET /api/analytics/export.csv` (new). Settings read: `home.locale.weekStart`, `settings.work.capacity` (hours context).
- **Realtime**: none; re-fetch on focus.
- **What changes vs today**: six links to removed modules (`/procurement/pos`, `/financials`, `/financials/reports`, `/financials/statements`, `/planning/variance`, the Reports / Variance title-bar links) go (misc-apps High #2, critic #8); counts come from the server, not from five 200-row client fetches (misc-apps #20); the page calls `/api/analytics` at last (misc-apps 1.17 issue 4); `OsTitleBar` with the dead trio goes; the `ana__*` CSS goes; a sidebar row exists (misc-apps 1.17 issue 5); the layout's `requireManagerOrRedirect` becomes `gatePage("view", { type: "app", key: "analytics" })`, which 404s in the shell instead of bouncing to `/dashboard`; the five tiles that pointed at live destinations in other hubs are not replaced by links (each destination keeps its own rail hub and sidebar row, listed in §0) and the five that pointed at removed modules are gone.
- **Open questions**: (1) Keep the "Company health score" number the current API computes (KPI 50% + SOP compliance 30% + mood 20%)? Recommendation: no; it is an invented composite with no definition a customer can check. The five tiles are enough.

---

## 3. Shared components this unit introduces or requires

| Name | Lives at | Props (summary) | Used by |
|---|---|---|---|
| `HomeWidget` | `src/components/home/home-widget.tsx` | `{ title, icon, footer?: { label, href }, empty?: { arrangement, sentence, link? }, loading, error?: { retry }, children }`; renders the design-system §5.8 widget frame (60px tinted strip, radius 12, quiet empty block, inline "Couldn't load · Retry") | `/home` (six widgets); the spaces-lists unit may reuse it on the Space Overview |
| `WorkTaskRow` | `src/components/home/work-task-row.tsx` | `{ item, density, onComplete, onOpen, showList }`; the checkbox + title + List label + due chip + priority glyph row used inside the My work widget (a slim variant of the `TableCard` row, same content budget) | `/home` My work widget |
| `InboxRow` | `src/components/inbox/inbox-row.tsx` | `{ notification, kind, selected, unread, onSelect, onMarkRead, onMarkUnread, onSnooze, onClear, checkable }`; the 64px two-line split-list row from §2 `/inbox`; the Talk unit's thread list row shares its geometry (design-system §4.5 split pattern) | `/inbox`, the Home Inbox widget (compact one-line mode), the bell popover (shell unit, compact) |
| `InboxTargetPane` | `src/components/inbox/inbox-target-pane.tsx` | `{ notification }`; picks the task panel, the mention excerpt card, the access-request card or the summary card by kind | `/inbox` |
| `inbox-kinds.ts` | `src/lib/inbox-kinds.ts` | `KINDS: Record<NotificationType, { label, icon, tab, filterGroup }>` + `tabFor(type)`; unit-tested against every `notification.create` literal | `/api/notifications`, `/inbox`, the bell popover, the sidebar count |
| `ActivityRow` | `src/components/activity/activity-row.tsx` | `{ entry }`; sentence builder from the verb + lowercase `targetType` → chip link map | `/activity`, the profile Activity tab (teams-people) |
| `StatTile` | `src/components/ui/stat-tile.tsx` | `{ label, value, delta?, deltaMeaning?: "neutral" | "danger" }`; one primitive replacing the eight local `KpiTile` copies the audit found (misc-apps §4) | `/analytics`; offered to teams-performance and settings units |
| `BoardItemDetail host="panel"` | task-detail unit's component | `host` is the one prop name that unit uses across the page, the drawer and the panel; the `"panel"` value renders the drawer body without the drawer frame, inside the Inbox pane | `/inbox` (flagged to the task-detail unit) |
| `WeekPills` | `src/components/me/week-pills.tsx` | `{ weeks, active, onChange }`; the views-row pills for week navigation (text-tab pills with the submitted dot) | `/me/weekly-review`; offered to the planner unit (timesheets) |

Everything else is a design-system primitive: `TableCard`, `FilterPanel`, `Picker`, `StatusChip`, `Chip`, `EntityTile`, `BackButton`, `Dots`, `AutosaveIndicator`, `OsEmptyView` (restyled), `SegmentedControl`, the text-tab pills (`ViewTab`), the bulk bar, toasts.

---

## 4. Migration / build notes

### Order of work (each step ships alone; nothing here changes a save or load path blind)

| Step | Ships | Depends on |
|---|---|---|
| **W0 Redirects and rows** | `next.config.ts` 308s for `/today`, `/dashboard`, `/tasks`, `/tasks/assigned-to-me`, `/tasks/today-overdue`, `/tasks/personal-list`, `/tasks/backlog`, `/tasks/board`, `/tasks/calendar`, `/tasks/gantt`, `/tasks/sprint`, `/assigned-comments`, `/me/mentions` (the `/tasks/*` ones initially point at `/my-work` which W1 creates in the same release); every hard-coded `/today` re-pointed (list under `/today` above); the Work sidebar rows of §1 (with `matchPaths` until the shell unit's URL-derived rule lands; the rows themselves are the same either way); `GET /api/me/favorites` aggregate. **`/tasks/[id]` is not touched in W0**: it keeps its `page.tsx` and its current body, and W4 replaces that body with the lookup plus `redirect()`. There is never a `route.ts` beside it (Next forbids a `route.js` at the same segment level as a `page.js`, and a build error is not a migration step), and there is never a `?legacy=1` escape hatch, because the page is simply still the page until the day the Items exist to redirect to | nothing |
| **W1 Home and My work** | `/home` on `GET /api/me/home` (composed from existing helpers); `/my-work` on the rebuilt `GET /api/me/work` (assigneeIds, grouping, cursor) with List / Board / Calendar over the restyled board renderers; `/my-work/personal` (a file move); `POST /api/items/bulk`; the Work sidebar's `home.cards` reader plus its one-time key mapping; Home's widget switches on `home.work.surface.home`; saved filters on `home.work.*` | design-system steps 1 to 4 (tokens, type, shell, primitives: `TableCard`, `FilterPanel`, `Picker`); settings S0 (`.strict()` preferences with `home.work.*`, `home.cards`); the task-detail unit's intercepting-route drawer at `/item/[id]` for row clicks, with the `@drawer` slot mounted by `/home`, `/my-work` and `/everything` (until it lands, rows open `/item/[id]` as a page) |
| **W2 Inbox** | `inbox-kinds.ts` + the write-time normalisation of uppercase types + the one-time lowercase migration; rebuilt `GET/PATCH /api/notifications` (tabs, cursor, unread, tab-scoped mark-all); the split Inbox with the target pane; `home.notifications.inboxView` writes; doc and SOP mentions as notifications (docs-knowledge unit's block editor writes them; this unit ships the backfill script and deletes `/api/me/mentions` after it); the auto-clear cron row in `scripts/CRON-SETUP.md`; the access-request rows (once access step 3 ships `AccessRequest`) | settings S0 / S2 (the `inboxView` key and the Notifications page it links to); shell unit's SSE event names; task-detail unit's `host="panel"` |
| **W3 Everything, Favorites, Activity, Weekly review** | Everything on `accessibleIds` + cursor + filters + per-row role; Favorites as the real page (Sidekick pins handed to the AI unit's `/sidekick?pinned=1` in the same release so nothing is unreachable); Activity with the lowercase map, `GET /api/activity/types`, scope pills by role; Weekly review restyle with week pills and autosave | access step 1 (wrappers) for `accessibleIds` and `canMany`; goals unit's review API surface unchanged |
| **W4 Legacy task migration and deletions** | `scripts/migrate-legacy-tasks.ts`: dry-run report per org (counts, unmapped statuses, custom-field values with no BOARD_ITEM equivalent, tasks with no assignee and no creator), founder approval, then per-org transaction: every non-deleted `Task` → an Item in the assignee's (else creator's, else the org's first Owner's) Personal list with `metadata.legacyTaskId`, status by name (Planned → the List's first active status, In progress → the first "progress" status, Done → the first done status with `completedAt`), priority Critical → urgent, High → high, Medium → normal, Low → low, `dueAt`, `startAt`, description, labels → Tags (created when missing), `parentTaskId` → `parentItemId`, `TaskComment` → `ItemUpdate` with the original author and timestamp, `TASK` custom-field values → matching BOARD_ITEM fields on the Personal list (created from the TASK field definition when absent); row-count assertions (Items written = Tasks read, comments written = comments read); the report archived as an `ActivityLog` row `work.tasks_migrated`. Then: `/tasks/[id]` resolves; delete `tasks/*` pages, `task-list-surface.tsx`, `task-reference-pages.tsx`, `components/tasks/*`, `components/today/*`, `dashboard-content.tsx` and its tree, `OsItemDrawer` (`item-drawer.tsx`, and the demo `module-view` surfaces that open it), the five BEM CSS families (`bklg__`, `spbd__`, `tcal__`, `gantt__`, `sprint__`, `tdt__`, `fav__`, `actfeed__`, `mytasks-grid`, `dash-card-handle`, `mention-inbox*`, `ideas__`, `ana__`); `/api/tasks*` return 410 for one release then are deleted; `Task` and `TaskComment` tables are kept read-only for one release, then dropped with a `prisma db execute` file. Consumers re-pointed in the same release: `/analytics` (this unit), `workload-grid.tsx` and `/api/tasks/workload` (teams-people unit, `/team/workload`), `planner-week.tsx` / `planner-side-panel.tsx` / `planner-command-bar.tsx` / `/api/calendar/meetings` (planner unit), `performanceScoreService` (teams-performance unit), the block editor's task block (docs-knowledge unit: new blocks link Items), `/api/tasks/run-sla-check` (the escalation cron: the Threshold reader the settings spec defers; it moves to Items or is retired with the cron row) | W1 (the Personal list exists for every user); the four units named must accept their re-pointing in the same release (never leave a consumer on a 410) |
| **W5 Ideas merge** | the "Ideas board" template (spaces-lists unit); `scripts/migrate-ideas.ts` with the same dry-run / approval / assertion pattern; the `LegacyRedirect` rows; `/ideas` 308; delete `ideas/page.tsx`, `/api/ideas*`, the `idea_update` writer | W4's pattern; the template |
| **W6 Analytics** | the rebuilt `GET /api/analytics` on Items and `accessibleIds(person)`; the page in the Teams hub; `StatTile`; export | access step 3 (`gatePage` for app keys and the in-shell 404 for a failed app rule); W4 (Items are the only task model); **the Teams sidebar Analytics row landing first** (the exact row is in §1; without it W6 does not ship) |

W0 to W3 can ship in parallel with the access track's steps 0 to 2. W4 is the only step that touches user data at rest and is gated on the dry-run report and the founder's approval (data-integrity rule); it never ships in the same release as any change to the Item save path.

### What can ship independently

W0 (redirects, rows, the favorites aggregate) and W1's `/home` can ship before the design-system shell lands, on today's tokens, because they are new pages with no dependency on the header stack beyond `OsTitleBar` replacement; if they ship early they carry the new header components behind the same flag the design system's step 3 uses.

### What is blocked on another unit

- The task drawer as a Next intercepting route at `/item/[id]` (the `@drawer` slot this unit's list pages mount) and `host="panel"` (task-detail): until it lands, rows open the full page and the Inbox pane shows the summary card for tasks.
- Doc and SOP mention notifications at write time (docs-knowledge): until then the Mentions tab reads the backfill only.
- The Talk unit's decision on `chat_message` rows.
- **The Teams sidebar row for Analytics (a hard contract, not a hope).** The teams-people unit renders the row specified in §1 at its own row 15, in the PERFORMANCE section of its 20-row sidebar: label "Analytics", icon `LineChart`, href `/analytics`, gated on `app:analytics`, no count. Nothing renumbers. W6 does not ship before that row exists: a rebuilt page with no row is the orphan this unit exists to remove.
- **The Work sidebar override for Templates and Trash.** The spaces-lists unit specifies those two rows; this unit, as the hub owner, fixes their position at the tail of the personal block after Goals (§1). That unit is asked to note the override rather than restate "after Inbox", so engineers read one sidebar.
- **The `/everything` scope contract.** The spaces-lists unit redirects five Space and Folder views here; §2 `/everything` now defines `space`, `folder` and `view` (including the `gantt` and `team` fallbacks) as its URL contract, and `GET /api/me/everything` takes `space` and `folder`. Those redirects ship in W3 or later, never before.
- The planner unit's calendar reading Items; the goals unit's review-loop API and its Goals group rows (this unit prints their hrefs from spec-goals §1 and never the retired `?mine=1` forms); the spaces-lists unit's Ideas template, the List page body reused by Personal list.
- The shell unit's URL-derived highlighting, SSE event names, the `?` overlay and `src/lib/shortcuts.ts` (this unit registers its shortcuts there, with `⌘⇧K` as the quick-task chord and `G 1`…`8` for hub jumps), the re-login prompt.
- **The shell's Work-hub edits for the two landings** (settled, not open): `spec-shell` §1.3 gains a Home row and a My work row and loses the "no row labelled Home" paragraph; `ROUTE_HUB`'s `home` row gains `/home` and `/my-work` and drops `/today`, `/dashboard` and `/tasks`; the hub `defaultHref` becomes `/home`; `G H` opens `/home`. W0 ships the 308s in the same release, so neither URL is ever live without the other.
- The settings-workspace unit's CustomizePanel Home tab (the six widget keys) and the Settings Overview card re-point; the account-auth unit's tour copy.

### Data migrations (all idempotent SQL or scripts with dry runs; local DB is Neon, prod is aaPanel Postgres, `migrate dev` is broken by drift, so `prisma db execute` plus `prisma db pull`)

1. Notification type normalisation: `UPDATE "Notification" SET type = lower(type) WHERE type IN ('KUDOS','SURVEY','REVIEW','POLICY')`.
2. Mentions backfill: `/api/me/mentions`' EntityLink query → `Notification` rows (`type = 'mention'`, `link` with `#b-<blockId>`, `read = true` for links older than 30 days so nobody wakes up to 400 unread rows).
3. Legacy tasks → Items (W4), legacy ideas → Items (W5), both with per-org transactions and row-count assertions; `LegacyRedirect` table (`orgId`, `kind`, `legacyId`, `target`).
4. Preferences, three separate one-time reads, none of which lets an old value change the meaning of a new key:
   - **`home.cards` keeps its key and its owner** (the Work sidebar, settings-architecture §4.2). Its stored values are the CustomizePanel's old card keys, so they are mapped once to this sidebar's optional-row keys and then rewritten: `inbox` → dropped (Inbox is a fixed row and can never be hidden), `myWrk` → dropped (My work is fixed), `assignedComments` → dropped (the page is gone, §0), `draftsSent` → dropped (a coming-soon row that never existed, shell #13), `allSpaces` → `spaces`, `allTasks` → `everything`. Unknown keys are ignored. A person who never opened the panel has no row and gets the default (everything on). A person who did keeps the two choices that still mean something, and never lands on a Home with widgets hidden by a value they set for a sidebar.
   - **Home widgets start fresh on their own key**: `home.taskCardsHidden` (a hidden-list) is read once, inverted against the six widget keys where a name maps (`assigned` → `my-work`, `goals` → `goals`, `kras` → `weekly-review`; everything else in that list named a stub card that no longer exists) and written to `home.work.surface.home.viewOptions.widgets`; `home.taskCardLayout` and `home.taskCardLayoutV3` are read by nothing and are dropped. All three keys are then accepted and ignored for one release (settings-architecture §9.3 tolerance), then removed from the zod schema.
   - `workwrk:task-saved-filters` localStorage → `home.work.savedFilters[]` on first load (client-side, then the key is deleted).
5. No schema change to `Item` beyond the JSON `metadata.legacyTaskId` / `legacyIdeaId` keys; a GIN index on `Item.metadata` if the `/tasks/[id]` lookup measures above 20ms.

---

## 5. Checklist against the audit

`work-tasks.md` §3:

| # | Resolution |
|---|---|
| 1 Two task models | resolved by §2 `/my-work`, `/everything`, `/home` (Items only) and §4 W4 (legacy rows migrated, `/tasks/*` and `/api/tasks*` deleted, consumers re-pointed) |
| 2 Inbox settings never persist | resolved by §2 `/inbox` Inbox options → `home.notifications.inboxView` via `PATCH /api/preferences` (settings-architecture §4.3, §7.3) |
| 3 Inbox bucket map mis-keyed | resolved by `src/lib/inbox-kinds.ts` (§2 `/inbox` kind routing table) with the build-time completeness test |
| 4 `/assigned-comments` stub | resolved by §0 redirect and §2 `/assigned-comments` (Inbox filter; a future `comment_assigned` kind) |
| 5 My Wrk cards are stubs | resolved by §2 `/home` (six honest widgets on real APIs; every stub card and dead button removed) |
| 6 `home.cards` never read | resolved by §1 (the Work sidebar is the reader settings-architecture §4.2 names; the key switches the optional rows and sections, its old CustomizePanel values are mapped once in §4, and Home's widgets deliberately use a different key so one array never means two things) |
| 7 `OsTitleBar` dead trio, fake avatars | resolved on every route here (no `OsTitleBar`; the header stack; real avatar stacks only where an object has grants, which none of these personal pages do) |
| 8 `/activity` chips, live dot, scope downgrade, dead CTA | resolved by §2 `/activity` |
| 9 `/item/[id]` archive → `/home` | resolved for the `/home` half (the route exists); the push target is the task-detail unit's |
| 10 Four task-detail UIs | resolved by §2 `/tasks/[id]` (redirect) and §4 W4 (delete `TaskDetailModal`, `OsItemDrawer`); the drawer and page are the task-detail unit's one component |
| 11 Trash copy vs gate | resolved for the copy half (archive confirm names "Trash" and the Trash row renders for every Member per access §5.2.1); the Trash page gate is the spaces-lists unit's |
| 12 Stale sidebar on `/assigned-comments`, `/everything`, `/item/*`, `/me/*` | resolved by §1 (rows and `matchPaths` for every route; `/assigned-comments` and `/me/mentions` gone) |
| 13 Orphan routes | resolved by §0 (every orphan redirected, merged or given a row: `/favorites`, `/activity`, `/me/mentions`, `/tasks/{backlog,board,calendar,gantt,sprint}`, `/tasks/[id]`) |
| 14 `TaskListSurface` in-memory state and fakes | resolved by §4 W4 (deleted) and §2 `/my-work` (saved filters and view options persisted on `home.work.*`) |
| 15 Inbox errors, "Show All tab", "Last 7 days", no pagination, ⇧ hints, filters | resolved by §2 `/inbox` |
| 16 `/tasks/today-overdue` dead controls | resolved by §0 redirect and §2 `/my-work` |
| 17 `/tasks/[id]` scan, dead controls, hard back | resolved by §2 `/tasks/[id]` redirect handler and W4 |
| 18 `/today` → first Space | resolved by §2 `/home` |
| 19 No `BackButton` in the subsystem | resolved: `BackButton{fallbackHref}` on `/me/weekly-review`, and on the shell's 404 and error pages that this unit's misses land on (the shell owns that component and its `hub.defaultHref` rule); top-level pages need none; the task page's is the task-detail unit's |
| 20 Mixed loaders | resolved: rail pulse + skeletons on every route (§2 States) |
| 21 Naming | resolved by §1 naming canon |
| 22 HomeSidebar hover chevron, Favorites copy, pin icons, Drafts & Sent | resolved by §1 sidebar (visible chevrons, seven-kind copy, More menu deleted) |
| 23 Dead code | resolved by §4 W4 deletions |
| 24 Styling drift | resolved: every route on design-system tokens and primitives; BEM families deleted |
| 25 Mobile | resolved by §1 Mobile / narrow (within the shell unit's breakpoints) |

`misc-apps.md` §3: High #2 resolved by §2 `/analytics`; High #5 resolved for `/ideas` (§2, W5) and `/me/mentions` (§0); High #8 resolved by §2 `/dashboard` (tree deleted, palette re-pointed); Medium #14 resolved for `/me/mentions` (route gone) and `/ideas` (route gone); Medium #19 resolved for the `/analytics` half (the Settings card is the settings-workspace unit's, flagged); Medium #20 resolved for `/analytics` (server counts); Low #21 resolved for the routes here; Low #23 resolved for Me / My Profile in the Work sidebar (row removed; Teams owns the label); Low #25 resolved by §2 `/me/weekly-review`.

`shell.md` §4: #3 resolved (`/inbox`); #12 resolved (`home.cards` read); #13 resolved (More menu deleted); #14 resolved (`/favorites`); #15 resolved for `/ideas`, `/me/mentions`, `/activity` (the `/clock`, `/autopilot`, `/files`, `/loader-preview` halves belong to the planner, ai-automation, docs-knowledge and tools-misc units); #16 resolved (palette "Activity" → `/activity`); #17 resolved (`/home` exists); #29 resolved for Work / Today / Home, Me, My Wrk / My Work / My tasks (the rest belong to their hubs); #39 resolved for Favorites / Activity / Ideas (the other pages are other units').

`critic-gaps.json` topSystemicIssues: #1 resolved for this unit's orphans and rows (§0, §1), including `/analytics`, whose Teams sidebar row is written out in §1 as an exact row (row 15, PERFORMANCE, per the hub owner) and made a shipping precondition in §4 rather than left as a wish; #2 resolved on every route (no `OsTitleBar`, no fake avatars, no stub pages, no dead controls); #3 resolved (one task model, one landing, one mentions surface); #4 resolved (read-only rows in Everything; `gatePage` on every route against a key that exists in access §5.2.1, with the in-shell 404 as the one denial for a failed app rule on `/analytics`; `notFound()` for Guests on everything the `home` row does not grant; scope pills by role on `/activity`); #5 resolved for this unit's detail routes; #6 resolved (tokens only); #7 resolved (Inbox options, `home.cards`, saved filters, view options all persist); #8 resolved for `/analytics`; #9 resolved (§1 canon, and the last two-labels-one-URL case in this unit is gone: `/my-work` has one row and one name, and every section label is a collapse control rather than a second door); #10 resolved within the shell's breakpoints (§1); #11 resolved (Inbox and every widget surface errors with Retry; the 401 prompt is the shell unit's); #12 resolved (cursor pagination on Inbox, Everything, My work, Activity; client-side view and group switches; one aggregated Home call); #13 resolved (every bucket and date label uses `home.locale.timezone` and `weekStart`); #14 resolved (W4 deletion list); #15 resolved (no coming-soon controls remain on any route here: Drafts & Sent, the Agenda connect buttons, the "Set up your work schedule" card, the "Create Agent" row are gone; unbuilt notification switches sit behind "Show upcoming features" in My settings, settings unit).

Deferred, with reasons: per-type mute for the notification kinds beyond the six `notify-prefs.ts` keys (work-tasks #15 item 14) waits for the settings unit's Notifications page to add rows with readers, hidden behind "Show upcoming features" until then; the "Live" dot on `/activity` waits for a real SSE event; comment assignment waits for `ItemUpdate.assigneeId` (task-detail unit); the Tables-module `/embed` and Talk `chat_message` Inbox policy wait for their units' decisions.
