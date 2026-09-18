# UI/UX audit: Teams, People, Org, KRA/KPI, Reviews, Goals

Subsystem: people-ops (Teams hub + Goals). Read-only code audit of every route under `src/app/(dashboard)/{team,people,organization,kra-kpi,reviews,talent,okrs}` plus the folded `/goals` reference, the Teams/Goals sidebars in `src/components/layout/os/apps-catalog.tsx`, `src/components/okrs/*`, `src/components/team/*`, and the dialogs they mount. All paths below are relative to `/Users/bigboldtechnologies/theywrk/`.

Legend for UI state: polished (consistent with the Teams chrome + design system), rough (works but chrome/copy/pattern drift), broken (a primary flow fails), stub (placeholder or no data path).

---

## 0. How this subsystem is wired into the shell

### Rail hub + sidebars (apps-catalog.tsx)

| App key | Label | Rail? | matchPaths | requiredAccess | Sidebar | "+" |
|---|---|---|---|---|---|---|
| `teams` (line 1192) | Teams | yes (defaultPinned) | `/team, /people, /organization, /kra-kpi, /reviews, /talent, /candor, /kudos, /surveys` | `manager` | `TeamsSidebar` (994) | `TeamsCreateMenu` (teams-create-menu.tsx) |
| `goals` (1226) | Goals | NO: folded into Work via `FOLDED_INTO_HUB` (1350-1359, `offRail = true`) | `/okrs, /goals` | none | `GoalsSidebar` (1101) | "New Goal" → `/okrs?new=1` |
| `reviews` (1245) | Review cycles | NO: folded into Teams | `/reviews` | `hr-admin` | `linksSidebar([Review cycles /reviews, Talent (9-box) /talent])` | "Start review cycle" → `/reviews?new=1`, gated `manager` (1249) |
| `home` (1172) | Work | yes, alwaysPinned | includes `/okrs, /goals` (1173) | none | `HomeSidebar` (489): "Me" → `/people/me` (884), "Goals" → `/okrs` (889) | global create menu |

**TeamsSidebar items** (manager tier, apps-catalog.tsx:1008-1047):
- Overview `/team`, My Profile `/people/me`
- People: Directory `/people`, Org chart `/organization`, Roles `/people/roles`
- Alignment: KRAs & KPIs `/kra-kpi`, Alignment board `/team/alignment`
- Performance: Reviews `/team/reviews`, KPI approvals `/team/kpi-reviews`, Rollup `/team/rollup` (only `DIRECTOR_LEVELS`, 992), Workload `/team/workload`, Review cycles `/reviews` (only hr-admin; active for `/reviews` and `/talent`)
- Culture (hr-admin only): Candor, Kudos, Surveys (out of this audit's scope)
- Below manager tier the whole sidebar collapses to a single "My Profile" row (1000-1006).

**Not in any sidebar**: `/people/departments`, `/people/skills`, `/kra-kpi/review`, `/talent` (Talent only in the folded reviews linksSidebar), `/okrs?team=1`, `/okrs?level=company` (only in the folded GoalsSidebar), `/reviews/[id]`, `/people/roles/[id]`, `/okrs/[id]`, `/team/workload` is in the sidebar but not in the Overview shortcut cards.

**Sidebar selection does not follow the URL.** `click-sidebar.tsx:89` renders `getApp(activeAppKey) ?? findAppForPath(pathname) ?? APPS[0]`. `activeAppKey` is set only by clicking a rail icon (`click-app-rail.tsx:81`), a More-popover tile (`apps-more-popover.tsx:95`), or Cmd+1..9, and is persisted in localStorage (`shell-context.tsx:252, 278`). There is no `usePathname` effect in `shell-context.tsx` that re-derives the hub from the route. Consequences for this subsystem:
- A deep link (notification, kudos card, Team pulse card, goal link in a doc) into `/people/[id]`, `/okrs/[id]`, `/reviews/[id]` keeps whichever hub the user last clicked; the Teams sidebar appears only after clicking the Teams rail icon.
- `/okrs` renders with the **Home** sidebar when reached from Home → Goals, but with the **Goals** sidebar (My / Team / Company Goals) when reached from the More launcher. Two different secondary navs for the same page.
- `/reviews` and `/talent` similarly show either the Teams sidebar or the two-row "Review cycles / Talent" sidebar depending on entry point.
- `findAppForPath` skips `offRail` apps (1384-1387), so by route the Goals and Review-cycles sidebars can never be selected.

**`/goals` does not exist.** It is referenced in `matchPaths` (1173, 1227) and in the Home sidebar active check (889) but there is no `src/app/(dashboard)/goals` directory: the path 404s.

### Top bar (global, `click-topbar.tsx`)
Workspace switcher, Search card (⌘K), Ask AI pill (⌘J), ActiveTimerPill, pinned quick tools (task/doc/etc.), NotificationsBell, RemindersBell, Inbox link, profile avatar. Same on every route here; no page injects into it.

Pages built on the legacy `OsTitleBar` (`title-bar.tsx`) get a second, page-level title row: amber star + title + description + avatar stack + page actions + an "Ask AI / Share / Invite" trio. **The trio has no onClick handlers** (title-bar.tsx:89-111); on every page below that uses OsTitleBar those three buttons are dead. Pages: `/people/departments`, `/people/skills`, `/talent`, `/reviews`, `/kra-kpi/review`, `/okrs`.

### Teams "+" create menu (teams-create-menu.tsx)
People: Invite person → `/settings/members?invite=1`; New role → `/people/roles?new=1` (fires the quick-add prompt once). Alignment: New KRA → `/kra-kpi?new=1` (opens KraDialog); **New KPI → `/kra-kpi` with no `?new`, and that page has no KPI create control** (KPIs are created on the role page) so the row is effectively dead; New SOP → `/sops/new`. Performance: Start review cycle → `/reviews?new=1` (page is hr-admin gated; a MANAGER gets bounced to `/team/reviews` with no message, page-gates.ts:52-57).

### Access gates in play (three-door model)
- `requireManagerPage` (page-gates.ts:45) → employees bounce to `/people/me`. Used by `/team`, `/people`, `/people/roles`, `/people/departments`, `/people/skills`, `/organization`, `/kra-kpi`, `/kra-kpi/review`.
- `resolveAccess({type:"module"})` (access.ts:101-125) → non-manager bounce to `/today`. Used by `/team/alignment`, `/team/reviews`, `/team/kpi-reviews`, `/team/workload` (reuses the `team/alignment` module name). `/team/rollup` bounces to `/team/alignment`.
- `requireHrAdminPage` (page-gates.ts:52) → managers to `/team/reviews`, employees to `/people/me`. Used by `/reviews`, `/reviews/[id]`.
- `requireManagerOrRedirect` (lib/route-guard.ts:15, default `/dashboard` → `/today`). Used by `/talent/layout.tsx` only.
- `requireGoalsPage` / `requireGoalPage` (page-gates.ts:70-95) for `/okrs` and `/okrs/[id]`.
- `resolveAccess({type:"user"})` for `/people/[id]` → `notFound()` when none.
- `MANAGER_LEVELS` is redefined in six files (page-gates.ts:18, access.ts:70, access-tiers.ts:15, people/roles/[id]/page.tsx:20, components/okrs/create-goal-modal.tsx:48, reviews/[id]/review-detail-client.tsx:245).

---

## 1. Route inventory

### 1.1 `/team` : Teams Overview
- File: `src/app/(dashboard)/team/page.tsx` (server, `requireManagerPage`), `src/components/team/team-pulse.tsx`, `src/components/team/ui.tsx`.
- Reached from: Teams rail icon (defaultHref) and TeamsSidebar → Overview. Employees never see it (bounced to `/people/me`).
- Back: none (hub root). Header: "Teams" eyebrow, blue icon tile, "Overview", "{n} people · {n} roles".
- Sidebar when active: TeamsSidebar (Overview highlighted).
- Controls: 4 `TeamStatTile` links (People → `/people`, Roles → `/people/roles`, KRAs → `/kra-kpi`, KPIs → `/kra-kpi`); "Needs your attention" queue rows (weekly reviews → `/team/reviews`, KPI records → `/team/kpi-reviews`, people with no KRAs → `/kra-kpi`); "Team pulse" cards from `GET /api/team/members-work` (avatar/name link → profile, Not done / Done counts, %, StatusDistribution bar, up to 3 "Working on" items → `/item/[id]`, recent activity, "…" menu: View profile, Email (mailto), Open their latest task); three shortcut cards (People / Alignment / Performance; Rollup only for directors).
- States: queue "You're all caught up."; pulse loading = `Loader2` spinner; pulse error text; pulse empty "No teammates visible to you yet".
- UI state: polished.
- Issues:
  - Tile scoping is inconsistent: People/KRAs/KPIs are tree-scoped for door-2 managers but `Roles` is always org-wide (`prisma.role.count` at line 47 vs `peopleWhere` at 39-43).
  - KRAs and KPIs tiles both go to `/kra-kpi` (no KPI-specific surface).
  - "N people have no KRAs yet" links to the role library, not to those people.
  - Performance shortcut card omits Workload although the sidebar has it.
  - TeamPulse uses a `Loader2` spinner while the rest of the app uses `ValueLoader`.

### 1.2 `/team/alignment` : Alignment board
- Files: `team/alignment/page.tsx` (server, module gate → `/today`), `team/alignment/team-alignment-board.tsx` (client).
- Reached from: TeamsSidebar → Alignment board; Overview shortcut; `/team/rollup` header "Alignment" button; rollup bounce.
- Back: none; breadcrumb "Teams / Alignment board". Header actions: "Rollup" (→ `/team/rollup`, shown to everyone including sub-director managers whose click bounces straight back here, page.tsx:60), "Reviews" (→ `/team/reviews`).
- Controls: 4 stat tiles (Reports, Active KRAs, Avg KPI compliance, Avg SOP read-rate); filter chips All / Dotted-line / Review to action / SOP overdue; sort select Name / KPI compliance / SOP read-rate / Review status; per-report card: KRAs (top 2 with weights), KPI compliance, SOP read-rate, This week's review; inline **Approve / Request changes** when SUBMITTED + "Open review →" (→ `/team/reviews`, the whole queue); amber "KRA weights total N%, not 100%" strip; red "N mandatory SOPs pending" strip; chevron → `/people/[id]`.
- States: "No reports yet" bordered empty; "No reports match this filter."
- UI state: **broken** (inline approval) / otherwise polished.
- Issues:
  - **BROKEN**: `ReviewActions` sends `POST /api/weekly-reviews/[id]/manager-review` (team-alignment-board.tsx:198-202) but the route only exports `PATCH` (`api/weekly-reviews/[id]/manager-review/route.ts:23`). Every Approve / Request changes click on this board fails with 405 and shows "Couldn't save". The sibling `/team/reviews` client uses PATCH correctly.
  - Inline Request changes has no notes field (the queue page has one) so a manager cannot say what to change from here.
  - Active filter chip style is black (`bg-zinc-900`, line 88) while the Directory uses brand blue; the sort control is a native `<select>` in a bordered label.
  - `Metric` / `complianceTone` are duplicated in `team/rollup/page.tsx` (`SubMetric`, `tone`) with different thresholds from `pctColor` in `components/team/ui.tsx` (80/50 here vs 90/70/50 there).

### 1.3 `/team/reviews` : Reviews (weekly review queue)
- Files: `team/reviews/page.tsx` (server, module `team/reviews` → `/today`), `components/team/team-reviews-client.tsx`.
- Reached from: TeamsSidebar → Reviews; Overview queue + shortcut; Alignment board header + "Open review →"; hr-admin bounce target.
- Back: none; breadcrumb "Teams / Reviews" (red icon tile).
- Controls: error banner with dismiss; "Awaiting your review · N" expandable cards (KRA progress rows, KPI snapshots, Highlights / Blockers / Plan, "Notes to {first name}" textarea, Request changes, Approve); "Recently acted" cards (Approved / Changes chip + manager notes).
- States: "Inbox zero." empty; acted section hidden when empty.
- UI state: rough.
- Issues:
  - KRA progress and KPI snapshot rows print raw ids in monospace (`kp.kraId` line 181, `k.kpiId` line 197) instead of names.
  - Scope: `listReviewsForManager` filters `managerId` only (weekly-review.ts:236-240) = direct reports; `/team/kpi-reviews` and the Overview badge use the recursive effective tree (kpi-record.ts:107). A director sees KPI approvals from grand-reports but weekly reviews only from directs.
  - No search / filter / period navigation; no per-review page; nothing links to the person.
  - Name collision: "Reviews" (this), "Review cycles" (`/reviews`), "KPI review" (`/kra-kpi/review`), "KPI review cycle" (link label on `/kra-kpi`), "KPI approvals" (`/team/kpi-reviews`).

### 1.4 `/team/kpi-reviews` : KPI approvals
- Files: `team/kpi-reviews/page.tsx` (module `team/kpi-reviews`), `components/team/kpi-reviews-client.tsx`.
- Reached from: TeamsSidebar → KPI approvals; Overview queue + shortcut.
- Back: none; breadcrumb "Teams / KPI approvals" (amber icon).
- Controls: pending card (initials, name, "KPI · period", score %, actual / target, submitter notes, optional note textarea, Request changes, Approve → `PATCH /api/kpi-records/[id]/manager-review`); Recently acted list.
- States: "Inbox zero." empty; error banner.
- UI state: polished (mirrors 1.3).
- Issues: no link to the person or the KPI definition; no period filter; competes with `/kra-kpi/review` where the manager types actuals directly (two manager KPI workflows with no explanation of when to use which).

### 1.5 `/team/rollup` : Rollup (director+)
- File: `team/rollup/page.tsx` (server; module `team/rollup`, non-directors → `/team/alignment`).
- Reached from: TeamsSidebar → Rollup (directors only); Overview shortcut (directors only); Alignment header button (everyone, see 1.2).
- Back: none; breadcrumb "Teams / Rollup"; header action "Alignment".
- Controls: 4 stat tiles; 2 weekly-review tiles; Sub-teams cards (manager initials, "N direct reports", own-review badge, Dotted chip, chevron → `/people/[id]`, 4 metrics); Direct ICs rows (review chip, KPI %, SOP %, chevron → profile).
- States: "No reports yet" empty.
- UI state: polished.
- Issues: subtitle says "two levels below you" (line 60) while the section header says metrics cover direct reports only (line 97); sub-team card links to the manager's profile, not to that manager's alignment view; duplicated metric/chip components (see 1.2); HR is org-wide elsewhere but excluded from `DIRECTOR_LEVELS` so HR never gets Rollup.

### 1.6 `/team/workload` : Workload
- Files: `team/workload/page.tsx` (server; module `team/alignment` gate, then `redirect("/team")` when `teamIds.length <= 1`), `team-workload-view.tsx` (client wrapper around `WorkloadGrid`).
- Reached from: TeamsSidebar → Workload only.
- Back: none. Header is a different chrome: compact board-style row "Workload · N people" (`px-4 pt-1.5`, 14px title, no breadcrumb, no icon tile) unlike every sibling Teams page.
- Controls: whatever `WorkloadGrid` exposes (capacity settings, week navigation); settings persisted to `localStorage` key `workwrk:team-workload:v1` only; open item → `/item/[id]`.
- States: no explicit empty state (an empty grid); silent redirect to `/team` when the manager has no reports (no message).
- UI state: rough (chrome drift).
- Issues: chrome inconsistency; settings not shared across devices; silent bounce; not in Overview shortcuts.

### 1.7 `/people` : Directory
- Files: `people/page.tsx` (`requireManagerPage`), `people/directory-client.tsx`.
- Reached from: TeamsSidebar → Directory; Overview People tile + shortcut; Org chart / Roles header buttons; profile breadcrumb.
- Back: none; breadcrumb "Teams / Directory"; header actions Org chart, Roles.
- Controls: stat tiles Headcount / Departments / New (90d); search; status tabs All / Active / New / Former; sort select (A–Z, Recently joined, Longest tenure, Most reports); department chips (All + per dept with count); tag chips (union) + Clear tags; grouped sections per department; `PersonCard` → `/people/[id]` (avatar, name, New badge, role, dept chip, office city, tenure · reports, up to 4 tags, "Reports to"); Former tab: greyed `FormerPersonCard` with "Removed {date}" and **Restore** (`DELETE /api/users/[id]?restore=true`).
- States: `ValueLoader`; error text; "No teammates yet" (copy says invite from Workspace settings but there is no link or button); "No one matches these filters." + Clear; former empty copy.
- UI state: polished.
- Issues:
  - "Active" tab is functionally identical to "All" now that lifecycle statuses were dropped (profile edit only offers ACTIVE, profile-client.tsx:1169-1177).
  - No Invite CTA on the page itself (only via the sidebar "+" → `/settings/members?invite=1`).
  - Departments and Skills pages are not linked from here (only from Roles).
  - Filter state is not in the URL (not shareable / not restored on back).
  - Active department chip mixes `border-zinc-900` with brand-blue background (line 260/264).

### 1.8 `/people/me` : My profile (redirect)
- File: `people/me/page.tsx` → `redirect("/people/{id}")`.
- Reached from: Home sidebar "Me", TeamsSidebar "My Profile", GoalsSidebar "My KRAs & KPIs", employee bounce target.
- Issue: TeamsSidebar highlights "My Profile" with `pathname === "/people/me"` (apps-catalog.tsx:1012) which is never true after the redirect, so the row is never active in the Teams sidebar. HomeSidebar does it right via `meId` (496-497).

### 1.9 `/people/[id]` : Person career home (self / manage / peer)
- Files: `people/[id]/page.tsx` (server; `resolveAccess({type:"user"})`, mode = self | manage | peer), `profile-client.tsx` (1540 lines), `manage-alignment-dialog.tsx`, `remove-person-dialog.tsx`; mounts `MonthlyKpiRecorder`, `TagPicker`, `KudosReactions`.
- Reached from: Directory cards, Org chart rows, Team pulse, Alignment/Rollup chevrons, Skills holders, Talent people, role holder chips, `/people/me`, Direct Reports tab, in-app mentions.
- Back: **manage mode**: `BackButton fallbackHref="/people"` + breadcrumb Teams / Directory / Name (line 993-998). **Self mode**: no back, eyebrow "My Profile". **Peer mode**: no back, no breadcrumb, a single card. Loading: `Skeleton`. Not found: "Person not found" + "Go back" (`router.push` to `/today` or `/people`).
- Header card controls: avatar with upload (self/manage, not removed); name; manage: Message (creates DM → `/tlk/[id]`), Edit profile (dialog), "…" (Remove from company / Restore to company); self: "Edit personal info" → `/account/profile`; chips: status, Removed date, access level; role link → `/people/roles/[id]`; email / phone / department / "Reports to"; `TagPicker` (editable in manage).
- Edit profile dialog: Department, Role, Access Level (admin-only; disabled select still rendered for non-admins with "(admin only)" hint), Reports To (manager-tier users), Status (ACTIVE + "(legacy)" current value), Date of Birth, Office; autosave (1200 ms) + `AutosaveIndicator` + Close / Done.
- RemovePersonDialog: handover summary (`GET /api/users/[id]/handover`), no-manager warning, optional "Reassign open work to" picker (`POST handover`), Remove (soft delete).
- Sections: Role (JD card, "View role definition"); KRAs & KPIs (`AlignmentSection`: weight total + period, **Manage alignment** (manage only) → `ManageAlignmentDialog` (Seed from role; KRA list with editable weight cell + remove; add KRA select + weight; SOP list + remove; add SOP), **Record my numbers / Record numbers** toggles `MonthlyKpiRecorder`; per-KRA card with role chip or "No job title", KPI rows: north-star star, name, description, direction icon, Shared chip, health dot, latest value · period, target, record status chip / "Not recorded"); Goals (`GoalsSection`: quarter, "All goals" → `/okrs?mine=1` or `/okrs`, "Set a goal" → `/okrs?new=1`, goal cards → `/okrs/[id]` with KR rows and "Auto · from KPI"); manage-only Composite Score card + `ScoreBreakdown`, Performance Trend bar chart, 4 stat tiles (Avg KPI Score, Active KRAs, Avg Mood, Review Score).
- Tabs (`ViewTabStrip`): Reviews (self: "My weekly review" → `/me/weekly-review`; review-cycle result cards, not links), KPI history, Skills, Kudos (count badge), Check-ins, Assets, Direct Reports (only if any; clickable `div` cards).
- UI state: rough (functional but sprawling and mixed).
- Issues:
  - **Skills tab is a stub**: reads `user.skills` but nothing in the product creates `UserSkill` rows; `/api/skills` is GET-only (`api/skills/route.ts:18`) and no page or dialog posts skills. Always "No skills added yet".
  - **Check-ins tab is a stub**: `checkIns` exist in the API payload but no dashboard page or component calls `/api/check-ins`, so "No check-ins yet" is permanent and the "Avg Mood" tile always reads N/A.
  - Review-cycle result cards (line 1379-1404) are not links; the person cannot open the review.
  - Direct Reports cards are `div onClick` (not links; no keyboard access, no hover affordance beyond border).
  - Three component systems on one page: shadcn `Card/Badge/Progress/Tabs`, Teams `TeamStatTile/StatusChip`, plus hand-rolled cards. Score colors use `text-emerald-600 / amber-500 / red-500` while `pctColor` uses hex tokens.
  - Peer mode: no back affordance and nothing tells the viewer why the page is thin.
  - "Status" chip always shows ACTIVE for everyone (lifecycle states retired) so it carries no information.
  - `MessagePersonButton` is rendered twice in code paths (peer + manage) with identical styling; fine, but self mode has no "Share profile" or similar.
  - Access Level select shown disabled to non-admins (cosmetic control).

### 1.10 `/people/roles` : Roles library
- Files: `people/roles/page.tsx` (`requireManagerPage`), `roles-client.tsx`. CSS family `rls__` in `(dashboard)/os.css` (58 rules).
- Reached from: TeamsSidebar → Roles; Overview Roles tile + shortcut; Directory / Org chart / Departments / Skills header buttons; `/kra-kpi` empty CTA; Teams "+" New role (`?new=1`).
- Back: none; breadcrumb "Teams / Roles"; header actions Directory, Departments, Skills, **New role** (prompt dialog "Role title?" → `POST /api/roles` with `level: "EMPLOYEE"` → navigates to the new role page).
- Controls: stat tiles Roles defined / Headcount / Unfilled / Levels; search; "Unfilled only" checkbox; level chips (All levels + per level with counts); grouped level sections (pill, title, counts, headcount) of `RoleCard` → `/people/roles/[id]` (title, trash icon, holder count, level chip, dept chip, "Open position", description).
- States: `ValueLoader`; error `OsEmptyView` "Retry" **without `onCta`** (CTA is hidden by `OsEmptyView`, empty-view.tsx:39-40, so there is no retry); empty `OsEmptyView` "New role" **without `onCta`** (hidden; the only create path is the header button); "No roles match these filters." + Clear filters.
- UI state: rough.
- Issues: header/tiles are Tailwind Teams chrome while toolbar/chips/cards are BEM `rls__` (two systems on one page); delete icon is always rendered (zinc-300) even when holders > 0 (click → toast "reassign them first"); quick-add silently creates an EMPLOYEE-level role; the page and `/kra-kpi` are two near-identical role lists.

### 1.11 `/people/roles/[id]` : Role definition
- Files: `people/roles/[id]/page.tsx` (server; session only, `canEdit = MANAGER_LEVELS`), `role-workspace.tsx` (1280 lines); mounts `KraDialog`, `KpiDialog`, `KraPicker`, `ConfirmDialog`.
- Reached from: Roles cards, `/kra-kpi` role rows and search hits, profile role links, KRA role chips, quick-add.
- Back: `BackButton fallbackHref="/people/roles"` + breadcrumb "Roles / {Department}" (page.tsx:153-160). Note: employees can open this page (their JD) but the "Roles" crumb bounces them to `/people/me`.
- Header: `EntityTile` + title + level chip + **`ChevronDown` icon that opens nothing** (page.tsx:167).
- View tabs: Overview | Instances (`?view=instances`).
- Overview cards and controls:
  - Identity & scope: Title input (autosave 700 ms, "Saving… / Saved"), Mission textarea, Function picker (MorePortal menu: No function, departments, "Manage functions…" → `/people/departments`), Level picker (MenuList of `ACCESS_LEVELS` minus AGENT) with helper copy, People count, **Delete role** (blocked when holders > 0; `ConfirmDialog`).
  - Ownership boundary: Owns (rename pencil, delete X with confirm, inline "Add an owned area…"), Can request (+ → `AddBoundary` modal: search, pick, "New area…" with owner role select; row hover "Request" → note modal → `POST /api/role-boundaries/request`), Cannot touch (+ same picker).
  - KRAs & KPIs: `KraPicker` "Attach existing" (PATCH roleId), **Add KRA** (KraDialog: role locked, name, description, category, weight), weight total chip, per-KRA "…" (Edit KRA, Add KPI, Detach from job title, Delete KRA), KPI rows (north-star, name, unit / shared hint / baseline, description, direction icon, healthy line or "no baseline yet", Owned / Shared chip, "…" Edit KPI / Delete KPI), "+ Add KPI" footer (KpiDialog: name, unit, frequency, type, ownership, formula, baseline, target, direction, north-star, description); "People with this job title" chips → profile, amber "missing N of M" + **Seed** (`POST /api/users/[id]/seed-alignment`).
  - Escalation thresholds: "+" → inline add (label, trigger, value, unit) / hover delete. Copy: "These drive automation".
  - SOPs: read-only list of SOPs linked through KRAs → `/sops/[id]`; no add.
- Instances tab: "New instance" (Scope select incl. "+ New scope…" → name + dimension; Person select of ACTIVE users), rows with "Apply definition" (seed) + hover delete.
- UI state: polished but dense.
- Issues: dead chevron in the header; thresholds are stored but nothing consumes them (Automation Hub deferred), so the setting is not enforced; SOP card has no add path; "Instances / Scopes" vocabulary is explained nowhere else in the product; Request and AddBoundary use a custom fixed overlay while deletes use `ConfirmDialog` and KRAs use Radix dialogs (three modal styles); non-managers get read-only mode with no explanation.

### 1.12 `/people/departments` : Departments (a.k.a. Functions)
- Files: `people/departments/page.tsx` (`requireManagerPage`), `departments-client.tsx` (880 lines). CSS `dept__` (87 rules).
- Reached from: Roles / Skills header buttons, role Function picker "Manage functions…", direct URL. **Not in any sidebar.**
- Back: `OsTitleBar` action "← People" that calls bare `history.back()` (line 306), which goes wherever the user came from (label is wrong when arriving from Roles/Skills) and violates the BackButton convention.
- Header: OsTitleBar with star, description, **fabricated avatar stack** `PEOPLE.bb / sc / mk` + "+N" computed as `stats.total - 3` (lines 302-303; `PEOPLE` is a sample pool in `catalog.ts:79-88`), actions Roles, Skills, **New department** (permission `organization.manageDepartments` via `checkPermission`), plus the dead Ask AI / Share / Invite trio.
- Controls: 4 KPI tiles (Departments, Headcount, With head, Vacant head); search; Tree / Grid toggle; Expand all / Collapse all; tree rows (chevron, color stripe, name, description, head avatar + "Head" tag or "No head", direct count, "N total", "N subs", "…" → Edit function / Add sub-department / Delete); grid cards (stripe, name, headcount, "…", description, head, sub list); `DeptDialog` (Name, Description, Color swatches (8, CSS vars), Department head searchable picker, Parent department picker; Cancel / Create function | Save changes).
- States: `ValueLoader`; error `OsEmptyView` with working Retry; empty `OsEmptyView` "New department" (hidden when `!canManage`); "No departments match" + Clear search.
- UI state: rough (legacy chrome, fake avatars).
- Issues: three names for one entity across the subsystem (page "Departments", dialog/toasts "Function", role page "Function", settings hub "Functions (Departments)"); fake avatar stack; dead trio; bare `history.back()`; orphaned from navigation; permission-matrix gating here vs tier gating for Roles.

### 1.13 `/people/skills` : Skills matrix
- Files: `people/skills/page.tsx` (`requireManagerPage`), `skills-client.tsx`. CSS `skl__` (104 rules).
- Reached from: Roles / Departments header buttons, direct URL. **Not in any sidebar.**
- Back: "← People" via bare `history.back()` (line 128).
- Header: OsTitleBar with **hard-coded fake avatars** `PEOPLE.bb / sc / mk` and `morePeople={4}` (lines 124-125), actions Departments, Roles, dead trio.
- Controls: 4 KPI tiles (Skills tracked, Total holders, Expert-level, Coverage gaps); search; tabs All / Expert / Gaps; sort select (Most holders / Highest rated / A–Z); two-column matrix: left skill list (tone tag, gap tag, rating bar, holder count), right detail (ring, self / manager / holders bars, "Top rated holders" → `/people/[id]`).
- States: `ValueLoader`; error `OsEmptyView` "Retry" **without handler** (hidden); empty `OsEmptyView` "Open my profile" **without handler** (hidden), copy claims "Once people add skills to their profile and rate themselves" but no such control exists anywhere.
- UI state: **stub** (there is no data path: `/api/skills` is GET-only and no UI writes `UserSkill`).
- Issues: permanent empty state in practice; misleading copy; `C.pink` in the avatar palette (line 36) is a banned hue; dead CTAs; fake avatars; bare back.

### 1.14 `/organization` : Org chart
- Files: `organization/page.tsx` (`requireManagerPage`), `org-chart-client.tsx`.
- Reached from: TeamsSidebar → Org chart; Overview shortcut; Directory header button.
- Back: none; breadcrumb "Teams / Org chart"; subtitle switches between "{org} full reporting hierarchy" and "Your reporting tree" by access level; header actions Directory, **Org settings → `/settings`** (root, not `/settings/structure` or `/settings/hierarchy`).
- Controls: 4 stat tiles (People "N reporting", Departments, Offices "HQ: …", Roles); `TeamCard` "Reporting hierarchy" with "All people →" link; collapsible indented tree (depth ≥ 2 seeded collapsed; toggle chevrons), first 8 roots then "+N more top-level → see all people" (goes to the Directory, which is not a tree); "Not linked to a manager" group with "fix in Members" link → `/settings/members`.
- States: error text; loading is plain text "Loading hierarchy…" (not `ValueLoader`); "No hierarchy yet" with Members link.
- UI state: polished (but simple).
- Issues: it is an indented list, not a chart (no lanes, zoom, or department view); duplicates Settings → Hierarchy (read-only tree built from the same `/api/users`); `roles` and `offices` are fetched only for tile counts; "Org settings" lands on the settings root.

### 1.15 `/kra-kpi` : KRAs & KPIs (job-title picker)
- Files: `kra-kpi/page.tsx` (`requireManagerPage`, Suspense), `workspace-client.tsx`; mounts `KraDialog`.
- Reached from: TeamsSidebar → KRAs & KPIs; Overview tiles/queue/shortcut; Teams "+" New KRA / New KPI; goal linked-work fallback; `/kra-kpi/review` header.
- Back: none; breadcrumb "Teams / KRAs & KPIs"; description paragraph; header actions **KPI review cycle** (→ `/kra-kpi/review`), **Reviews** (→ `/reviews`, hr-admin gated: managers bounce to `/team/reviews`), **New KRA** (KraDialog).
- Controls: stat tiles Job titles / KRAs / KPI gauges / Needs a job title ("admin-only view" sub when orphans are hidden); search (matches roles + KRA/KPI names → "Inside job titles" jump list → role page or `#orphans`); roles grouped by department (`RoleRow`: level chip, people count, "No KRAs yet" or "N KRAs · M KPIs", "weight 100%" / amber "weight N%"); Orphans section (`OrphanRow`: "Attach to {suggested role}", job-title select + Attach, "Not a KRA" delete with confirm).
- States: loading is plain text "Loading…" (line 292); error `OsEmptyView` Retry (works); empty "Create roles" → `/people/roles?new=1`; "Nothing matches".
- UI state: polished.
- Issues: no KPI creation here although the Teams "+" menu sends "New KPI" here; the "Reviews" link is gated above most viewers of this page; `?new=1` auto-open uses a one-shot ref (repeat "+" clicks while mounted do nothing, unlike `/reviews` which uses an armed latch); this page and `/people/roles` are two role lists with different chrome and different grouping (department vs level).

### 1.16 `/kra-kpi/review` : KPI review (manager records actuals)
- Files: `kra-kpi/review/page.tsx` (`requireManagerPage`), `review-client.tsx`. CSS `review__`, `review-person`, `krar__`.
- Reached from: `/kra-kpi` header "KPI review cycle" only (plus URL). **Not in any sidebar.**
- Back: none. Header: OsTitleBar "KPI review", description "N direct reports · {Month Year}", actions "KRA library" (→ `/kra-kpi`), static month label pill, dead trio.
- Controls: left rail of **direct** reports (`GET /api/users?managerId=me`) with status dot (done / partial / empty), avatar, name, role; right pane per subject: header, per-KPI card (KRA name, KPI name, score chip colored by Settings → Scoring bands, Target (disabled input), Actual (number), Manager notes textarea), footer "N / M KPIs scored for {month}" + **Save (N)** (sequential `POST /api/kpi-records` per draft; drafts persisted in localStorage); legend (dots + bands).
- States: error text; loading is inline-styled text (line 336); "You don't have any direct reports"; "Pick a teammate from the left."; "{first} doesn't have any KRAs/KPIs assigned".
- UI state: rough.
- Issues: status dots are computed only for subjects already fetched (line 300-312), so every not-yet-clicked report shows the red "Not started" dot regardless of truth; no period switch (always current month) although the file header still describes a week / month / quarter toggle; scope is direct reports only (not the tree used elsewhere); per-KPI POST loop has no per-row error surfacing; title "KPI review" vs sidebar "KPI approvals" vs link label "KPI review cycle"; inline styles + BEM + OsTitleBar chrome; orphaned from navigation.

### 1.17 `/reviews` : Review cycles (HR admin)
- Files: `reviews/page.tsx` (`requireHrAdminPage`, Suspense), `reviews-client.tsx`, `new-review-dialog.tsx`. CSS `rvw__` (92 rules).
- Reached from: TeamsSidebar → Review cycles (hr-admin only); `/kra-kpi` and `/talent` header links; Teams "+" Start review cycle (`?new=1`, armed latch, `router.replace` strips the param); More launcher "Review cycles".
- Back: none. Header: OsTitleBar "Review cycles" with **fabricated avatars** `PEOPLE.bb / mk / pr` and `morePeople={5}` (lines 200-201), actions KRA/KPI, Talent, **New cycle**, dead trio.
- Controls: `FeaturedCycle` hero (Featured tag, status, type chip, name, period + "N days until close", 4-step flow Draft → Active → In calibration → Completed, **Launch cycle** (DRAFT, `POST /launch`), **Move to {next}** (raw status PATCH, no confirm), "Open cycle →", progress ring, Total / Completed / Remaining); 4 KPI tiles (Active, Draft, Completed, Progress); search; status chips (multi-select); `CycleRow` → `/reviews/[id]` with inline Launch on DRAFT.
- `NewReviewCycleDialog`: Type (Monthly pulse, Quarterly, Annual appraisal, Probation, PIP) with hints, Name (auto-seeded), Starts / Ends (auto-filled), Create cycle; 403 copy "Only HR can create review cycles." Custom fixed overlay (not the shared Dialog).
- States: `ValueLoader`; error `OsEmptyView` Retry (works); "No review cycles yet" with chips + New cycle; "No other cycles match."
- UI state: rough (legacy chrome).
- Issues: fake avatar stack; dead trio; CANCELLED status exists (`STATUS_LABELS`) but there is no way to cancel a cycle; status advance has no confirmation and no explanation of what "In calibration" unlocks; `Loader2` used as the static ACTIVE status glyph (lines 291, 390); the create action is offered to managers who are then bounced; hr-admin only means a manager never sees cycle status at all.

### 1.18 `/reviews/[id]` : Review cycle detail
- Files: `reviews/[id]/page.tsx` (**`requireHrAdminPage`**), `review-detail-client.tsx` (1512 lines). CSS `rvwd__`; body uses shadcn `Card / Tabs / Badge / Dialog / Select`.
- Reached from: cycle rows and hero "Open cycle"; review-cycle cron notifications; direct URL.
- Back: "← Review cycles" button that does `router.push("/reviews")` (line 659), not `BackButton`. Not found: "Back to review cycles" button.
- Header (`rvwd__hero`): status, type, dates, name, progress bar + %, 5 stats (Total, Self done, Mgr done, Calibrated, Completed), DRAFT launch banner + **Launch cycle** (manager tier).
- Tabs: **My Review** (status badge + autosave indicator; Auto-Populated Metrics (Avg KPI, SOP Compliance, OKR Progress); "Your OKRs this period"; Rate Your KRA Performance (1-5 buttons + achievements per KRA); Self-Reflection (3 textareas); Save Draft / Submit Self-Assessment; completed results card + **Generate appraisal letter**), **Team Reviews** (list → per-person form: status, KPI/SOP scores, self-assessment preview, peer feedback preview, Behavioral Assessment 5 × 1-5 with anchors, Overall Manager Comments, Outcome Recommendation select (Promotion Eligible, Hike Eligible, Status Quo, PIP Required), autosave, Save Draft / Submit Manager Review; per-row appraisal letter + Assign peers icons), **Peer Feedback** (requests → dialog: strengths, improvements, collaboration 1-5, comments), **Calibration** (warning, distribution bars, table KPI / Self / Mgr / Peer / Composite / Calibrated / Outcome / Adjust, **Finalize All Outcomes**), **Dashboard** (5 stats, Pending Actions list). Dialogs: Peer Feedback, Assign Peer Reviewers (checkbox list of all users), Adjust Calibration Score (0-120 + justification), Appraisal Letter (preview + Download as HTML).
- UI state: **broken for its intended audience** / rough.
- Issues:
  - **Gate mismatch**: the page hosts the employee self-assessment and the manager review form, yet `requireHrAdminPage` blocks everyone below HR admin; managers land on `/team/reviews` (weekly queue) and employees on `/people/me`, neither of which contains the review-cycle forms. The DRAFT launch banner even checks `MANAGER_TIER` (line 245-261) as if managers could get here.
  - **Behavioral anchors are hard-coded** (`behavioralLabels`, lines 249-255) and ignore Settings → Scoring & reviews "Behavioral anchors" (`settings/scoring/page.tsx`, `api/settings/route.ts` write `behavioralAnchors`; nothing here reads them).
  - Dark-theme leftovers: `text-green-400`, `text-blue-400`, `text-orange-400`, `text-[color:var(--accent-strong)]`, `bg-[rgba(212,255,46,0.12)]` lime badge (lines 162-176, 730, 738, 1029, 1036-1037, 1049-1051, 1283-1286). Visibly off the Monday-clean palette.
  - Every fetch uses `catch {}` (lines 328-382); failures render as permanent "Loading..." or empty cards with no error state.
  - Outcome select omits `EXIT_RECOMMENDATION` although `getOutcomeBadge` renders it (line 186).
  - Team list rows are `div onClick` (not links); Assign-peers list is the whole org, unscoped.
  - Calibration table (9 columns) has no horizontal scroll container.
  - Back is `router.push`, losing history.

### 1.19 `/talent` : Talent (9-box)
- Files: `talent/layout.tsx` (`requireManagerOrRedirect` from `lib/route-guard.ts`, redirect `/dashboard` → `/today`), `talent/page.tsx` (602 lines). CSS `tal__` + extensive inline styles.
- Reached from: `/reviews` header "Talent" link; folded reviews linksSidebar (only after opening Review cycles from the More launcher); URL. TeamsSidebar highlights "Review cycles" when on `/talent`.
- Back: none. Header: OsTitleBar "Talent", description, actions People (→ `/people`), Reviews (→ `/reviews`), **New assessment**, dead trio.
- Controls: 4 KPI tiles (Stars, Future leaders, Core players, At risk); Period select ("All periods" + distinct periods) + "N assessed"; **Auto-place from scores** (`GET /api/talent-assessment?auto=true&period=…`, a GET that writes rows); **New**; 9-box grid (cells with label, count, up to 5 initials, "+N"; click → detail); detail panel (box tag, long label, count, person rows → `/people/[id]` with action text, period, **Reassess** button nested inside the Link); `PlaceModal` (Person: filter input + `<select size=4>`, Placement mini 9-box, Period free-text ("2026-08"), Action free-text, Notes, Cancel / Place person; 403 copy "Only managers can place people on the 9-box.").
- States: `ValueLoader`; error `OsEmptyView` Retry (works); empty "Place first person" (works).
- UI state: rough.
- Issues: uses `C.purple`, `C.indigo`, `C.pink` for box colors and avatar palette (lines 67-73, banned hues); period is free text; "Auto-place" is a GET with side effects; nested interactive elements (button inside Link); heavy inline styling; gate library differs from every sibling (`route-guard` vs `page-gates`) and tier differs from its parent nav (manager vs hr-admin); dead trio.

### 1.20 `/okrs` (+ `?mine=1`, `?team=1`, `?level=company`, `?new=1`) : Goals
- Files: `okrs/page.tsx` (`requireGoalsPage`, any signed-in user), `okrs-client.tsx` (696 lines); `components/okrs/create-goal-modal.tsx`, `goal-audience-picker.tsx`, `goal-owner-picker.tsx`, `goal-row-more-menu.tsx`. CSS `okrs__`, `okrs-stat`, `okr-row`, `okr-person`.
- Reached from: Home sidebar "Goals" (→ `/okrs`), GoalsSidebar (folded: My Goals `?mine=1`, Team Goals `?team=1` (manager), Company Goals `?level=company`), profile "All goals" / "Set a goal", Goals "+" (`?new=1`), More launcher.
- Back: none. Header: OsTitleBar titled Goals / My Goals / Team Goals / Company Goals; description counts; action **New goal**; dead trio.
- Controls: `?mine=1` filter chip with X → `/okrs`; 4 `StatTile`s (Average progress with bar, On track, **Need attention** (clickable div toggles attention filter), Completed); `?team=1`: "By person / By level" toggle, `PersonRollupCard` (avatar, name, "N goals · N% avg · Nh effort · N open tasks · last moved", "Needs a nudge" flag, verdict pill, expands to rows); level sections Company / Department / Individual with per-section **New goal**; `GoalRow` (trophy, title, level chip (mine only), status pill (inline style), "Ends {date}" or quarter, cadence label, effort pill, audience avatar stack, owner avatar or "No owner yet", progress track + % or an unmeasured dash placeholder, "…" menu and right-click: Open, Edit goal, Assign owner, Copy link, Delete goal (gated by API flags)).
- `CreateGoalModal` (create + edit): Goal name, Owner (`GoalOwnerPicker`, managers only), Level (Company / Department / Individual; non-managers locked to Individual), Contributors (`GoalAudiencePicker`: people, departments, roles, **tags**), Start / End date, Quarter (free text), Check-in cadence (Weekly / Biweekly / Monthly / None), Description; Cancel / Create goal | Save changes.
- States: `ValueLoader`; error `OsEmptyView` Retry (works); empty (mine) "No goals assigned to you"; empty (all) with chips; "No {level} goals yet. Add one →"; team "No goals across your team yet."
- UI state: polished-ish.
- Issues:
  - **Team Goals and Company Goals views have no reachable nav entry** for a user who arrived through the Home sidebar; only the folded `GoalsSidebar` links them, and it renders only after choosing Goals in the More launcher (see section 0). There is also no in-page switcher between All / Mine / Team / Company (only the `mine` chip).
  - Two different sidebars for the same URL depending on entry point.
  - No exit chip for `?team=1` or `?level=company` (only `mine` has one); the title changes but nothing else signals the filter.
  - Quarter is a free-text field next to real dates (un-validated, redundant).
  - Status pill, cadence label and effort pill are inline-styled (lines 567-591) while the rest is BEM.
  - "Need attention" tile is a `div` with `role="button"` rather than a button.
  - Audience picker offers Tags (`TAG` type) while the helper copy and product notes talk about people / departments / roles only.

### 1.21 `/okrs/[id]` : Goal detail
- Files: `okrs/[id]/page.tsx` (server; `requireGoalPage` → 404 when not visible), `goal-targets.tsx`, `okr-checkin-modal.tsx`, `goal-detail-menu.tsx`, `goal-assessment.tsx`, `goal-effort.tsx`, `okr-linked-work.tsx`, `components/okrs/okr-audience.tsx`. CSS `okrd__`, `okrd-card`.
- Reached from: goal rows, profile goal cards, "Cascades" links, copy-link URLs, review-cycle self tab (no link there, text only).
- Back: "← All Goals" is a plain `Link` to `/okrs` (line 253), so the `?mine=1` / `?team=1` list context is lost; not `BackButton`.
- Hero: progress ring (or an unmeasured dash placeholder), title + "…" menu (`GoalDetailMenu`, also right-click on the hero: Edit goal / Assign owner / Copy link / Delete goal → `/okrs`), description, chips (level, status, quarter, dates, cadence or "No check-in reminders"), Due date, Owner, Contributors (`OkrAudience`: avatar stack + count + picker for editors).
- Cards: stale warning; **Targets** (`GoalTargets`: "+ Add" → composer (Target name, Start, Target, Unit); rows → `OkrCheckInModal` (progress, Start / Current / Target, Decrease | Increase, amount, preview, Note, Save update; derived targets show the KPI notice; non-editors see the owner/manager copy); row "…" Check in / View target, Delete target); Timeline (check-ins); Cascades from / to; **On track?** (`GoalAssessment`: verdict pill, pace line, headline, reasons, "Next:" recommendation, AI/heuristic footnote); **Effort** (`GoalEffort`: Hours logged, Tasks done, In progress, Last moved, "Who's driving it"); Linked work (`OkrLinkedWork`: KRAs / Spaces / Boards / Canvases via `LinkExistingPicker`, open + remove).
- States: empty copy per card; assessment / effort "Assessing… / Loading effort…" and "Couldn't load…" text.
- UI state: polished.
- Issues: hard back link; `GoalAssessment` and `GoalEffort` are entirely inline-styled (no CSS family, no tokens beyond fallbacks); a parent goal cannot be chosen anywhere in the UI ("Cascades from" is display-only; the create/edit modal has no parent field); custom fields intentionally omitted (comment at line 455).

### 1.22 `/goals` : dead path
- No route. Referenced by `matchPaths` (apps-catalog.tsx:1173, 1227) and the Home sidebar active check (889). Visiting it 404s.

### 1.23 `/me/weekly-review` : Weekly review (employee side of 1.3)
- File: `me/weekly-review/page.tsx`, `components/me/weekly-review-form.tsx`.
- Reached from: profile Reviews tab "My weekly review" (self mode); notifications.
- Back: none; breadcrumb "Today / Weekly review" (goes to `/today`, not to the profile it came from). Header is `text-2xl` (larger than every Teams page).
- Controls: KRA progress sliders, KPI inputs, Highlights / Blockers / Plan, Save draft / Submit for review / Reopen to edit; status banner.
- Issue: out of the Teams hub entirely, so the employee never sees the manager decision except on this page; scale drift.

### Related settings surfaces (for context, not audited in depth)
`/settings/members` (invite, access level, reports-to), `/settings/hierarchy` (read-only reporting tree, duplicates `/organization`), `/settings/structure` (admin hub: Functions, Roles, Offices, Levels), `/settings/scoring` (review cadences, composite weights, performance bands, behavioral anchors), `/settings/permissions` (matrix incl. `organization.manageDepartments`), `/settings/identity` (mission / values), `/settings/apps` (rail visibility per app).

---

## 2. Broken / confusing (ranked)

### High
1. **Alignment board inline approval always fails.** `POST` to a `PATCH`-only route. `team/alignment/team-alignment-board.tsx:198` vs `api/weekly-reviews/[id]/manager-review/route.ts:23`.
2. **Review-cycle detail is HR-admin gated but hosts the employee self-assessment and manager review forms.** Non-HR users cannot complete the review the cron notifies them about. `reviews/[id]/page.tsx:10`, `review-detail-client.tsx:708-715, 245-261`.
3. **Team Goals / Company Goals are unreachable through the rendered sidebar.** Goals app is `offRail`; the Home sidebar links only `/okrs`; `GoalsSidebar` renders only via the More launcher. `apps-catalog.tsx:889, 1101-1118, 1350-1359, 1380-1388`; `click-sidebar.tsx:89`.
4. **Secondary sidebar does not follow the route.** `activeAppKey` is click-committed and persisted; deep links keep the previous hub's sidebar; `/okrs`, `/reviews`, `/talent` get different sidebars by entry point. `click-sidebar.tsx:89`, `shell-context.tsx:252-278`.
5. **Skills page and profile Skills / Check-ins tabs have no write path.** `/api/skills` is GET-only, no UI posts skills or daily check-ins; the pages are permanent empty states with copy that promises otherwise. `skills-client.tsx:186-192`, `api/skills/route.ts:18`, `profile-client.tsx:1437-1511`.
6. **Fabricated avatar stacks with hard-coded "+N"** on Departments, Skills and Review cycles headers. `departments-client.tsx:302-303`, `skills-client.tsx:124-125`, `reviews-client.tsx:200-201`, `catalog.ts:79-88`.

### Medium
7. `OsTitleBar` "Ask AI / Share / Invite" buttons have no handlers on 6 pages in this subsystem. `title-bar.tsx:89-111`.
8. Access-gate drift: four bounce targets (`/people/me`, `/today`, `/team/alignment`, `/dashboard`), three gate helpers; `/talent` is manager-tier via `route-guard` while its parent `/reviews` is hr-admin; "Start review cycle" create action is manager-tier but the page is hr-admin. `page-gates.ts`, `access.ts:101-125`, `route-guard.ts:15`, `talent/layout.tsx`, `apps-catalog.tsx:1249`.
9. Weekly review queue prints raw KRA / KPI ids. `team-reviews-client.tsx:181, 197`.
10. Behavioral anchors setting is saved but ignored by the manager review form. `review-detail-client.tsx:249-255` vs `settings/scoring/page.tsx`.
11. Escalation thresholds on roles are stored but nothing consumes them; copy says "These drive automation". `role-workspace.tsx:1139-1183`.
12. Role detail header `ChevronDown` opens nothing. `people/roles/[id]/page.tsx:167`.
13. Roles and Skills error / empty `OsEmptyView` CTAs have no handler and are therefore hidden (no Retry, no create). `roles-client.tsx:311, 315-321`; `skills-client.tsx:182, 186-192`.
14. Departments and Skills "← People" use bare `history.back()` (wrong label, violates BackButton convention). `departments-client.tsx:306`, `skills-client.tsx:128`.
15. Naming collisions: Reviews / Review cycles / KPI review / KPI review cycle / KPI approvals; Departments vs Functions.
16. Weekly review queue is direct-reports only while KPI approvals and the Overview badge use the recursive tree. `weekly-review.ts:232-240` vs `kpi-record.ts:102-108`.
17. Teams "+" → "New KPI" lands on a page with no KPI create control. `teams-create-menu.tsx:27`.
18. `/kra-kpi` header "Reviews" link (and Alignment board "Rollup" button) are visible to viewers who get bounced when they click. `workspace-client.tsx:219`, `team/alignment/page.tsx:60`.
19. `/goals` is referenced in nav config but has no route (404). `apps-catalog.tsx:1173, 1227, 889`.
20. Two competing manager KPI workflows (`/kra-kpi/review` types actuals; `/team/kpi-reviews` approves submissions) with no guidance.
21. Review detail carries dark-theme leftovers (`green-400`, lime `--accent-strong` badge, `blue-400`). `review-detail-client.tsx:162-176, 730, 1036, 1283`.
22. Talent uses purple / indigo / pink, a free-text period, and a GET with side effects. `talent/page.tsx:67-73, 155, 532-539`.
23. `/team/workload` chrome differs from every sibling; silent redirect when no reports; settings only in localStorage. `team/workload/page.tsx:49, 140-148`; `team-workload-view.tsx:23`.
24. Overview "Roles" tile is org-wide while its neighbours are tree-scoped. `team/page.tsx:47`.
25. TeamsSidebar "My Profile" is never highlighted (matches the literal `/people/me`). `apps-catalog.tsx:1012`.
26. Departments, Skills and KPI review are orphaned from navigation (only in-page header buttons).
27. Goal detail "All Goals" is a hard link that drops the list context. `okrs/[id]/page.tsx:253`.
28. KPI review status dots are wrong until each person is opened; no period switch. `review-client.tsx:300-312, 78-81`.
29. Directory "Active" tab duplicates "All"; empty-state invite copy has no link. `directory-client.tsx:245, 330-333`.
30. Profile page mixes three component systems; review result cards are not links; Direct Reports cards are `div onClick`. `profile-client.tsx:1379-1404, 1522-1526`.
31. Review cycles: no cancel path though CANCELLED exists; status advance has no confirm; `Loader2` used as a static status glyph. `reviews-client.tsx:43-50, 291, 344-347`.
32. Manager review outcome select lacks EXIT_RECOMMENDATION that the badge renderer supports. `review-detail-client.tsx:1101-1104, 186`.
33. Role detail is readable by employees but its "Roles" breadcrumb bounces them. `people/roles/[id]/page.tsx:154` + `page-gates.ts:47`.

### Low
34. Org chart is an indented list; "+N more" goes to the Directory; "Org settings" goes to `/settings` root. `org-chart-client.tsx:232, 262`.
35. Loading-state drift: plain text (Org chart, KRA/KPI, KPI review), `Loader2` (Team pulse), `Skeleton` (profile), pulse boxes (review detail), `ValueLoader` elsewhere.
36. Two "active chip" styles (black on Alignment board vs brand blue on Directory). `team-alignment-board.tsx:88`, `directory-client.tsx:246`.
37. Goal "Quarter" free text beside real dates. `create-goal-modal.tsx:291`.
38. Inline styles in Talent, GoalAssessment, GoalEffort, goal row pills.
39. "Instances / Scopes" and "Escalation thresholds" concepts unexplained on the role page.
40. `/me/weekly-review` header scale (`text-2xl`) and Today breadcrumb differ from the hub.
41. Rollup subtitle contradicts its own footnote. `team/rollup/page.tsx:60, 97`.
42. Three modal styles on the role page (custom overlay, ConfirmDialog, Radix dialog).
43. `MANAGER_LEVELS` duplicated in six files.

---

## 3. Cross-cutting conventions observed

### Back navigation
- `BackButton{fallbackHref}` (the documented convention) is used on exactly two surfaces: `/people/[id]` in manage mode (`fallbackHref="/people"`) and `/people/roles/[id]` (`fallbackHref="/people/roles"`).
- Teams-chrome list pages rely on the "Teams /" breadcrumb link instead of a back button.
- Bare `history.back()` labelled "People" on Departments and Skills.
- `router.push("/reviews")` on review-cycle detail; plain `Link` "All Goals" on goal detail; nothing on Workload, Talent, KPI review, Goals list, self/peer profile.

### Loader
- Route transitions: `(dashboard)/loading.tsx` renders `ValueLoader` (mission/values loader).
- In-page: `ValueLoader` on Directory, Roles, Skills, Departments, Talent, Review cycles, Goals list; plain text on Org chart / KRA-KPI / KPI review; `Loader2` in Team pulse; `Skeleton` on profile; grey pulse blocks on review detail.

### Empty / error states
- Teams-chrome pages: bordered `rounded-xl` centered text blocks (consistent).
- BEM pages: `OsEmptyView` (gradient icon square + title + subtitle + chips + CTA). `OsEmptyView` hides the CTA when no `onCta`/`ctaHref` is passed, which silently removed Retry / create buttons on Roles and Skills.
- Queues: "Inbox zero." card.
- Review detail: errors swallowed, no error UI at all.

### Style consistency
- Three chrome systems coexist in this one subsystem:
  1. **Teams chrome** (breadcrumb + 36 px icon tile + `TeamStatTile` / `TeamCard` / Tailwind, brand blue `#0073EA`, zinc neutrals): `/team/*` except Workload, `/people`, `/people/[id]`, `/organization`, `/kra-kpi`, headers of `/people/roles` and `/people/roles/[id]`.
  2. **Legacy OsTitleBar + BEM CSS in os.css** (`rls__`, `skl__`, `dept__`, `tal__`, `rvw__`, `rvwd__`, `krar__` / `review__`, `okrs__`, `okrd__`): star icon, fake avatar stacks, dead action trio, `--os-*` tokens used properly but with page-specific gradients (`GRAD.*`) and accents.
  3. **shadcn cards** on the profile body and review detail, with dark-era colour classes.
- Brand palette: mostly `#0073EA` / `var(--os-brand)`; taupe `TAUPE.soft` for KRA accents; teal / amber / green tile accents; purple / indigo / pink on Talent (banned); lime accent variable on review detail.
- Chips: `StatusChip` on profile, ad-hoc `rounded` spans elsewhere, BEM chips on legacy pages.
- Typography mostly follows the 14 px base, but review detail uses 11 px labels and `font-mono` scores; `/me/weekly-review` uses `text-2xl`.

### Mobile / responsive
- os.css has responsive rules for the BEM families only: KPI tile strips collapse to 2 columns at ≤900-1100 px, `skl__matrix` and `tal__grid-wrap` go single column, `rvw__hero` stacks, `dept__` hides secondary columns at ≤768 px.
- Teams-chrome pages use `grid-cols-2 lg:grid-cols-4` for tiles and `md:grid-cols-2` for cards (acceptable), but header action rows (`/people/roles` has title + 4 buttons in one non-wrapping flex row; Alignment board has 2) will overflow narrow widths.
- Wide tables with no `overflow-x` container: review-cycle Calibration (9 columns). Workload grid is desktop-first. The 9-box and PlaceModal are not tuned for touch (`<select size=4>`).
- Nothing in this subsystem adapts the secondary sidebar for mobile beyond the global shell behaviour.

---

## 4. Access notes

- Door 1 (EMPLOYEE / AGENT): Teams rail icon hidden (`requiredAccess: "manager"`); every management page bounces to `/people/me` or `/today`; they reach their career home via the Home sidebar "Me", can read `/people/roles/[id]` (own JD), `/okrs` (own + audience + company goals, `?mine=1`), `/okrs/[id]` (canSeeGoal), `/me/weekly-review`. They cannot reach `/reviews/[id]` to fill a self-assessment (High #2).
- Door 2 (TEAM_LEAD, MANAGER, DIRECTOR, VP, C_LEVEL, HR, admins): Teams hub scoped to the recursive report tree for Overview / KPI approvals / Workload / Alignment (via `getTeamAlignment`) but direct reports only for the weekly review queue and KPI review; Rollup for DIRECTOR+ (HR excluded); goal edit for report tree; talent placement.
- Door 3 (COMPANY_ADMIN, SUPER_ADMIN, C_LEVEL, VP, DIRECTOR, HR): org-wide directory / org chart / KRA library / goals; delete goals of others only for SUPER_ADMIN / COMPANY_ADMIN.
- HR admin (SUPER_ADMIN, COMPANY_ADMIN, HR): `/reviews`, `/reviews/[id]`, Culture links.
- Inconsistencies: `/talent` gate library and tier differ from `/reviews`; create actions offered above the page's own tier; Departments CRUD gated by the permission matrix while Roles / KRAs are tier-gated; role page readable by employees but its parent list is not; `MANAGER_LEVELS` copied in six places; HR is org-wide everywhere except Rollup; `/people/[id]` "peer" mode shows nothing performance-shaped but the same viewer can see a peer's goals via `/okrs` audience rules (different visibility model for the same person).

## 5. Settings notes

**Configurable today**
- Settings → Scoring & reviews: review cadences, composite score weights (must sum to 100), performance bands (used by KPI review chip colours and 9-box auto-place), behavioral anchors (stored, unused).
- Settings → Members: invite, access level, reports-to (this is where org chart edits happen).
- Settings → Structure: Functions / Roles / Offices / Levels (read-only ladder).
- Settings → Permissions: matrix; `organization.manageDepartments` is the only matrix key consulted in this subsystem.
- Settings → Apps: rail visibility / floor / order per app (Teams hub can be hidden or floored by tier).
- Team Workload capacity settings: `localStorage` only.
- Goal check-in cadence per goal (Weekly / Biweekly / Monthly / None).
- Per-role: KRA templates, weights, KPI definitions, ownership boundaries, thresholds, instances.

**Should be configurable but is not (or is not enforced)**
- Behavioral anchors (saved, hard-coded in the review form).
- Escalation thresholds (saved, nothing fires).
- KRA weight sum = 100 (only warned on role page, alignment board and KRA picker; assignment PUT caps at 100 but seeding can leave a person under 100).
- Weekly review cadence and whether it is mandatory (copy says mandatory; there is no setting and no manager control over frequency).
- KPI review period (locked to the current month; no back-fill of previous months from the manager page).
- Which tiers may create Company / Department goals (hard-coded manager tier in `create-goal-modal.tsx:48`).
- Review outcome options, hike bands and the appraisal-letter template (hard-coded in the API / client).
- 9-box labels, box colours, period format (free text).
- Goal "Quarter" (free text; should derive from dates or a fiscal calendar setting).
- Team pulse "working on" limit, Directory default sort / grouping, Org chart default depth.
- Which manager queue scope applies (direct vs recursive) so the two review queues agree.
- Talent / review cycle gates (who may run cycles) are code constants, not permission-matrix keys.
