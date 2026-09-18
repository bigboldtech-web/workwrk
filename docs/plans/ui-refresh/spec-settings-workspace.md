# Workspace settings (admin door) spec

Unit: every `/settings/*` route, the Settings hub's secondary surface (the settings list inside the takeover), the Workspace settings landing page, and the one gate that decides who opens any of it. My settings (`/account/*`) is a sibling unit and is referenced, never re-specified.

Written against `design-system.md` (look: tokens, sizes, components, motion), `access-model-spec.md` (access: roles, object roles, precedence, denial, the share dialog), `settings-architecture.md` (structure: which settings exist, where each lives, persistence, doors), `zoho-reference.md` (the founder-endorsed clean look) and the audit inventories `settings-pages.md` and `access-model.md`. Code references are at commit `6187227a`.

Written in the user's words. "Workspace settings" is the company's settings. "My settings" is yours. A "page" is one row in the settings list. A "tab" is a text-tab pill inside a page. "Back to app" returns you to the screen you came from.

Five tie-breaks applied, stated once so no engineer has to re-derive them. The last two are the Phase 3 cross-unit resolutions, settled against the other units and no longer open questions here.

1. **Chrome**: the design system's takeover wins. The rail and the navy top bar stay mounted; the takeover replaces only the secondary sidebar and the content. The shell unit already fixed this (`spec-shell.md` §2.8), and this spec matches it exactly.
2. **Structure**: `settings-architecture.md` wins. Two doors, fifteen Workspace pages, the tabs and persistence in its §5, the redirect list in its §8.4. The design system's §4.6 group names (You / Workspace / Governance / Billing & plan) are not used.
3. **Access**: `access-model-spec.md` wins. That means the People team **does** get read on four pages (`members`, `structure`, `access`, `scoring`, flag `peopleTeamRead`, access §2.1 and §6.6), which reverses `settings-architecture.md` §3.2's "no read tier". It is rendered by the access spec's read-only rule (§5.4: no disabled controls, values as text, one banner), and on those pages the People team still **edits** the people-data fields the access spec's §3.5 Membership (P) row gives them. Everyone else who is not Owner or Admin gets one of the two denial views in §1.4, and neither of them is a 404. The People team reads exactly four rows (`members`, `structure`, `access`, `scoring`) and edits exactly the `settings-architecture` §3.5 Membership (P) fields: job title, department, office, reports to, dotted lines, weekly capacity. Because access rule 14 leaves Overview undiscoverable for them, the Settings hub lands them on `/settings/members` rather than the Overview named in access §5.2.1; that is the settled cross-unit answer, carried to the access unit as a one-value change, not an open question in this spec.
4. **Look**: the design system wins on every figure that is look, because look is its subject. Four consequences here, each already written into §1 and §2 rather than left to be noticed: **no Close ✕ on the takeover bar** (one exit affordance, "← Back to app", plus `Esc`, which is also what `settings-pages` #24 asks for; a modal or drawer header still carries its own ✕, which is a different object with a different close target); the door sidebar is **264px with 20px icons**, not 248 with 16; a settings row is **48px minimum**, not 44; and the **Default accent row is deleted**, not hidden, in the same pull request as the design system's token sweep that removes the ten `data-accent` blocks, because a setting that changes nothing after the sweep is exactly what §1.8 forbids. Density's default is **Comfortable 44**, which the Appearance defaults row already carries, and which stays reversible from Identity without touching a token.
5. **Integrations stays at `/integrations`, for every Member**. The catalogue is not folded into `/automation/connections`: access §5.2.1 gives every Member the right to browse it and request a tool, Connections is Owner and Admin only, and a 308 would take a destination away from most of the workspace. `settings-architecture` §5.4 and §7.1 name `/integrations` as the surviving marketplace. The row belongs to the AI hub (section APPS); the page's content belongs to the tools unit; this unit only points at it, from the API & webhooks footer and the Apps footer. The four faked provider cards leave Connections and become real "Request this" cards on `/integrations`.

---

## 0. Scope

### Routes covered

| URL | File under `src/app` | Disposition |
|---|---|---|
| `/settings` | `(dashboard)/settings/page.tsx` | keep, rebuilt (Overview) |
| `/settings/identity` | `(dashboard)/settings/identity/page.tsx` (+ `layout.tsx` deleted) | keep, tabbed; absorbs `/settings/defaults` |
| `/settings/locale` | `(dashboard)/settings/locale/page.tsx` | keep, rebuilt (Locale & work week) |
| `/settings/apps` | `(dashboard)/settings/apps/page.tsx` (+ `layout.tsx` deleted) | keep, sectioned; absorbs `/settings/modules` |
| `/settings/members` | `(dashboard)/settings/members/page.tsx` | keep, rebuilt as a list page with a drawer |
| `/settings/structure` | `(dashboard)/settings/structure/page.tsx` | keep, tabbed |
| `/settings/access` | `(dashboard)/settings/access/page.tsx` (**new file**) | new; replaces `/settings/permissions` |
| `/settings/tasks` | `(dashboard)/settings/tasks/page.tsx` (**new file**) | new; absorbs `/settings/task-types` and `/settings/tags` |
| `/settings/scoring` | `(dashboard)/settings/scoring/page.tsx` | keep, fixed |
| `/settings/security` | `(dashboard)/settings/security/page.tsx` (**new file**) | new; the sign-in policy editor that does not exist today |
| `/settings/data` | `(dashboard)/settings/data/page.tsx` (+ `layout.tsx` deleted) | keep, tabbed; absorbs `/settings/import-export` |
| `/settings/audit` | `(dashboard)/settings/audit/page.tsx` (+ `layout.tsx` deleted) | keep, rebuilt as a list page with a drawer |
| `/settings/api` | `(dashboard)/settings/api/page.tsx` | keep, tabbed; absorbs `/settings/integrations` |
| `/settings/billing` | `(dashboard)/settings/billing/page.tsx` | keep, honest states |
| `/settings/all` | `(dashboard)/settings/all/page.tsx` (**new file**) | new; generated index |
| `/imports` | `(dashboard)/imports/page.tsx` | kept and rendered inside this takeover until S5; then route file deleted, 308 redirect |
| `/settings/modules` | `(dashboard)/settings/modules/page.tsx` | route file deleted, 308 redirect |
| `/settings/tags` | `(dashboard)/settings/tags/page.tsx` (+ `layout.tsx`) | route file deleted, 308 redirect; `tags-manager.tsx` moves and is rendered |
| `/settings/task-types` | `(dashboard)/settings/task-types/page.tsx` | route file deleted, 308 redirect |
| `/settings/defaults` | `(dashboard)/settings/defaults/page.tsx` (+ `layout.tsx`) | route file deleted, 308 redirect |
| `/settings/hierarchy` | `(dashboard)/settings/hierarchy/page.tsx` | route file deleted, 308 redirect |
| `/settings/permissions` | `(dashboard)/settings/permissions/page.tsx` | route file deleted, 308 redirect |
| `/settings/import-export` | `(dashboard)/settings/import-export/page.tsx` | route file deleted, 308 redirect |
| `/settings/integrations` | `(dashboard)/settings/integrations/page.tsx` | route file deleted, 308 redirect |
| `/settings/notifications` | `(dashboard)/settings/notifications/page.tsx` | route file deleted, 308 redirect to the personal door |
| `/settings/calendar` | `(dashboard)/settings/calendar/page.tsx` | route file deleted, 308 redirect to the personal door |
| `/settings/layout.tsx` | `(dashboard)/settings/layout.tsx` | rewritten: the one gate plus `SettingsShell door="workspace"` |

Discovered in the code and not on the unit's original list, claimed here: `/settings/calendar` (a stub page that the audit and `time.md` contradict each other about; §0 resolves it), `/imports` (whose end state is fixed in the table below) and the four new files above.

**`/imports`, in two phases, matching `spec-shell.md` §2.8 exactly so the two specs name one end state.** Phase 1 (S0 to S4): `/imports` keeps its own URL and renders inside this takeover, because `OsShell` keys the takeover on `SETTINGS_ROUTES` in `src/lib/nav/route-hub.ts` (`["/settings", "/account", "/imports"]`), the Data row declares `alsoActiveOn: ["/imports"]`, and the navy-bar breadcrumb reads `Settings › Workspace settings › Data › Import`. Its gate is the `data` page rule, called from `/imports`' own layout. Phase 2 (S5, when the Import tab ships): `/imports` becomes a 308 to `/settings/data?tab=import`, and the `SETTINGS_ROUTES` entry, the `alsoActiveOn` entry and the `ROUTE_HUB` row are deleted in the same commit. Nothing about `/imports` is left to a reader's judgement in either phase.

### Routes REMOVED / REDIRECTED / MERGED

Every destination stays reachable. All redirects are 308 in `next.config.ts`, permanent, not one release.

| Today | Target | Reason |
|---|---|---|
| `/settings/modules` | `/settings/apps#modules` | Two rows for one idea. Two module cards did not earn a page; the switch also renders on the `ModuleOff` screen for Owners and Admins (access §5.5 rule 5). |
| `/settings/tags` | `/settings/tasks?tab=tags` | The rendered page fabricates ten SAMPLE tags, reads a shape the API never returns, and its Delete never calls the API (`settings-pages` #1). The correct implementation beside it (`tags-manager.tsx`) becomes the tab body. |
| `/settings/task-types` | `/settings/tasks?tab=types` | Task types, tags and templates are one job: what a task can be. Also closes the "any employee can delete the org's task types" hole (`settings-pages` #2). |
| `/settings/defaults` | `/settings/identity?tab=appearance` | Org theme, density and the four locks are how the workspace looks (the accent row does not survive the move: §2 Identity › Appearance defaults); they belong beside the logo and the mission, not in a "Governance" page of their own (`settings-pages` #13). |
| `/settings/hierarchy` | `/organization` | Two org charts, the settings one with no cycle handling and silent team scoping (`settings-pages` #14). One chart, in Teams, with the "Edit reporting lines" mode the Teams unit builds. Structure › Org chart is a link card to it. The access spec (§3.5, §6.2) names `/settings/structure?tab=chart` as the target; the settings architecture names `/organization` and its tie-break owns redirect targets, so `/organization` it is, and `?tab=chart` resolves to the Structure tab that links there. **Settled cross-unit**, not a competing reading: the access unit carries the change. |
| `/settings/permissions` | `/settings/access` | 55 of 75 matrix cells enforce nothing (critic #7). The ten access toggles plus the explainer replace it; the 14 cells that really are enforced live on under a "Legacy" divider until access step 5 (§2.7). |
| `/settings/import-export` | `/settings/data?tab=import` | Two hubs for one job; the real exports were always on Data (`settings-pages` #12, #18). |
| `/imports` | `/settings/data?tab=import`, at S5 and not before | One import surface, not two. Until the Import tab ships, the URL stays live inside the takeover (see the two phases above), so the only working importer is never unreachable. `spec-shell.md` §2.8 owns the `SETTINGS_ROUTES` mechanism and deletes its three entries in the same commit as this redirect. |
| `/settings/integrations` | `/settings/api` | A menu page of stubs pointing at other stubs. **Integrations itself is kept**: the catalogue stays at `/integrations` as an AI hub sidebar row (section APPS, `Plug` icon) that **every Member** can open and request from, with connecting reserved to Owner and Admin, and it is linked from the API page footer and the Apps page footer. Only the settings hub of stubs dies. |
| `/settings/notifications` | `/account/notifications` | Personal preferences under a workspace URL. The reverse of today's redirect; the org-defaults section of `/api/settings` is retired because nothing reads it (`settings-architecture` open decision 6). |
| `/settings/calendar` | `/account/connections` | Resolves the critic's recorded contradiction: `time.md` is right that a full Google OAuth connect, callback, 5-minute sync cron and ICS token exist, and `settings-pages` is right that this page is a stub. The backend is **per user** (`CalendarSubscription`), so the surface is personal, not org. The Planner banner's success redirect `?connected=1` becomes `/account/connections?connected=google`. |
| `/settings?tab=themes` | `/account/preferences?tab=appearance` | The avatar menu's dead row (`settings-pages` #10). |
| `/settings?tab=shortcuts` | `/account/shortcuts` | Same. |
| Settings-hub sidebar (`SettingsSidebar`, `apps-catalog.tsx:1135-1157`) | deleted | It only ever rendered on `/build`, `/store`, `/tools`, `/assets`, `/trash`, and leaked onto Space pages through the sticky `activeAppKey` (critic missedSurfaces). Its rows re-parent per `settings-architecture` §7.1, into the AI hub's **APPS** section: **Build apps** (`/build`, `Hammer`, Owner and Admin), **Marketplace** (`/store`, Owner and Admin) and **Integrations** (`/integrations`, `Plug`, every Member browses, Owner and Admin connect). Tools and Assets go to Teams › Resourcing (every Member, and Tools keeps the `Wrench` glyph, which is why Build apps takes `Hammer`), Trash to Work (every Member). The section name is the AI hub's to set and it is APPS; the row label is "Build apps", the words `settings-architecture` §5.3 prints, so the footer link on `/settings/apps` and the AI sidebar row read the same. |
| Permission matrix page, `PERMISSION_MODULES`, `/api/permissions`, `Organization.settings.permissions` | deleted | Access §9. Each org's stored matrix is written into one `access.matrix_retired` audit row and offered as a one-time download on Data › Export, so nothing an admin configured disappears without a copy. |
| `OsTitleBar` on every settings page (audit, api, tags, task-types, calendar, security, data, scoring) | deleted from both doors | It renders an Ask AI / Share / Invite trio with no handlers and an always-filled amber star (`settings-pages` #3, critic #2). The takeover header is the only chrome. |
| In-page breadcrumbs (`Settings > Apps`, `Settings > Defaults & locks`, `Settings > Org structure`), the `OsTitleBar` "Settings" nav-link chips, and Scoring's "‹ Back to settings" link | deleted | Four back patterns on one screen family (`settings-pages` #24). One: the takeover header. |
| The ten-rung access-ladder prose on Structure | deleted | Hand-written prose that drifts from the real model. Replaced by the four-role strip with live counts (§2.6) and the one explainer on Access (§2.7). |
| `/settings/structure` link to bare `/account` | fixed | `/account` 308-redirects to `/account/profile` (`settings-pages` #18). |
| The "security score" card on `/account/security` | deleted | A made-up heuristic. Personal-door unit owns the change; listed here because this unit's Overview used to point at that page for policy. |

### Audit inventories consulted

`settings-pages.md` (whole document), `access-model.md` (§1.2, §1.3, §1.6, §1.8, §2.18, Broken #4, #9, #10, #14, #15, #17, #18, #19, #22, #24, #25, #26, #27, #31), `critic-gaps.json` (`topSystemicIssues`, `missedSurfaces`, `contradictions`), plus `design-system.md`, `access-model-spec.md`, `settings-architecture.md`, `zoho-reference.md`, `phase2-inputs.md`, `existing-direction.md`, `route-list.txt`, and the sibling `spec-shell.md` §2.8 for the takeover frame.

### Audit issue IDs this unit resolves

`settings-pages.md` §2: **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 30, 31, 32**. (28 `/me/mentions` and 29 "My Profile" never highlights belong to the Work and Teams units; 28 is listed in `settings-architecture` §7.1 and is carried there.)

`critic-gaps.json` `topSystemicIssues`: **#1** (nav chrome decoupled from the URL: the sticky `activeAppKey` is what leaked the Settings hub sidebar onto Space pages, and §1.1 and §1.2 make every settings row URL-derived), **#2** (fabricated and inert chrome), **#3** (duplicate surfaces: its evidence line names `settings-pages` #12, #14 and #18, all three merged here into Data, `/organization` and API & webhooks), **#4** (access fragmented), **#5** (back navigation), **#6** (five visual systems), **#7** (settings that do nothing), **#9** (naming drift), **#10** (desktop only), **#11** (errors swallowed, no session expiry), **#12** (hard caps and client-side paging: the 500-row member cap, the 100-row in-memory audit search and the client-side audit filters all become server cursors and server queries), **#13** (time, locale and money per surface: the locale page becomes the org half of one locale chain and finally reaches `next-intl`), **#14** (dead code: four orphan settings components wired or deleted), **#15** (copy hygiene: "Coming soon" rows go behind a preference).

**Deferred with a named owner**, so the inventory's own "what should exist" list (`settings-pages` §4) is answered rather than passed over: a **workspace statuses manager** and a **workspace custom fields manager**. Both are object-scoped in this product (per-List statuses, the 30-type field shelf on a List), so a workspace-level editor beside them would be a second source of truth for the same data. They belong to the **spaces-lists** unit and to the Template Center, where a List template already carries both; Task system states in plain words where they are edited today and links to the Template Center (§2 `/settings/tasks` › Templates). This unit does not build either.

`critic-gaps.json` `missedSurfaces`: the Settings hub sidebar leaking onto Space pages (deleted here). `contradictions`: `/settings/calendar` (resolved above), the `g` then `s` chord (removed from copy until `useGoToNav` is mounted; the shell unit owns the keyboard map).

`access-model.md` Broken items closed here: **#4** (SUPER_ADMIN offered in a tenant role select), **#9** (Space "Default permission" stored and unread, re-pointed to the share dialog), **#14**, **#15**, **#17**, **#18**, **#22**, **#24**, **#25**, **#26** (rail floors display-only), **#27**, **#31**.

---

## 1. Unit-level rules

### 1.1 Hub and sidebar

- **Rail hub active on every route here**: `Settings`, the last item in the rail's bottom cluster, `aria-current="page"`. It is `alwaysPinned` and never leaves the rail for anyone, including Guests; what it opens depends on the viewer.
- **Where the Settings hub lands, per viewer.** One table, read by the rail's `defaultHref` and by nothing else. Every row lands on a page the viewer can actually open, so clicking Settings never produces a denial as its first screen.

  | Viewer | Settings hub lands on | Why |
  |---|---|---|
  | Owner | `/settings` (Overview) | the whole door is theirs |
  | Admin, any scope or none | `/settings` (Overview) | Overview renders Owner-only cards with a lock glyph, so it is never a wall |
  | People team Member | `/settings/members` | the first Workspace page their `peopleTeamRead` flag opens |
  | Member, Agent | `/account/profile` (My settings › Profile) | the personal door is the door they have |
  | Guest | `/account/profile` | same; a Guest has a profile, a password and notifications |
  | Not signed in | `/login?callbackUrl=/settings` | §1.4 |

  **Settled cross-unit, stated once.** Access §5.2.1 lands the People team on Workspace › Overview. Access rule 14 in the same document makes Overview not discoverable for them (the `peopleTeamRead` flag covers four pages and Overview is not one), so the two lines disagree inside the access spec. This unit follows rule 14, which is the one the gate is built from, and lands the People team on Members, which keeps §5.2.1's intent (a Workspace landing, not the personal door). This is the decided answer, not a preference: the access unit carries it, and one value in `SETTINGS_PAGES` moves it again if that unit later widens `peopleTeamRead` to Overview.
- The rail and the navy top bar **stay mounted** on every `/settings/*` route. The `OsShell` settings-mode fork keeps unmounting the hub sidebar and mounting `SettingsShell`, but no longer unmounts the rail or the bar (`os-shell.tsx:79`).
- **Secondary surface**: the hub sidebar is replaced by the 264px settings list described in §1.2. The active row is derived from the URL only (`pathname` matched against the page table's `href` and `aliases`), never from a stored `activeAppKey`, never sticky. Exact match for `/settings`; prefix match for every other row; a `?tab=` never changes which row is active.
- **Top-bar breadcrumb** on every route here: `Settings › Workspace settings › {Page label}`. The first two crumbs are links (`/settings`); the last is plain text and is the registry label, never a hand-typed string. On a tabbed page the tab is **not** a crumb; the tab pill carries it.
- There is exactly one breadcrumb on screen. No page renders an in-page breadcrumb, an `OsTitleBar`, a "Settings" chip or a "Back to settings" link.

### 1.2 Hub sidebar contents (this unit owns the settings list)

Container per design system §4.6 and `spec-shell.md` §2.8: 264px, `--os-side-bg` (N50), `border-inline-end: 1px solid var(--os-line)`, its own scroll, rows inset 8px so pills have air.

- **Header (56px)**: no workspace switcher here (the takeover is already scoped to one workspace). One 36px filter input, full width, `--os-surface`, `1px solid var(--os-line-strong)`, radius 6, 16px `Search` glyph in `--os-ink-3`, placeholder "Find a setting", `⌘/` and `⌘K` focus it. Typing filters rows by label and by registry keyword, and lists matching **fields** beneath their page row as 32px secondary rows (13/400 `--os-ink-2`) that deep-link to the field anchor. Clearing restores the full list.
- **Rows (36px)** per design system §4.2: `padding-inline: 12px`, gap 12, one 20px Lucide icon at 1.5px stroke in `--os-ink-2`, label 15/400 `--os-ink`. Hover `--os-surface-hov`, radius 8. Active `--os-side-pill` (N200), label 15/500 `--os-ink`, icon `--os-ink`. No blue, no left bar, no transform, no counts on any row.
- **Group labels**: 11/600 uppercase +0.06em `--os-ink-2` with a 1px `--os-line` rule running from the label to the right edge, 24px top margin, 8px bottom. Not collapsible (the list is 15 rows).
- **Lock glyph**: a 16px `Lock` in `--os-ink-3` at the right of a row an Admin cannot open because they lack the scope. The row still navigates; it lands on the `AdminOnly` card. A lock is never a disabled row.
- **Footer**: none. No "Customize Sidebar" in the takeover (that footer belongs to the app's hub sidebars, memory `feedback_customize_sidebar`), no promotional cards.

| # | Group | Row label | Icon | href | Gate | Lock glyph when |
|---|---|---|---|---|---|---|
| 1 | (none) | Overview | `LayoutGrid` | `/settings` | Owner, Admin | never |
| 2 | WORKSPACE | Identity & culture | `Building2` | `/settings/identity` | Owner, Admin | never |
| 3 | WORKSPACE | Locale & work week | `Globe` | `/settings/locale` | Owner, Admin | never |
| 4 | WORKSPACE | Apps & modules | `Boxes` | `/settings/apps` | Owner, Admin | never |
| 5 | PEOPLE | Members | `Users` | `/settings/members` | Owner, Admin, People team (read + people fields) | never |
| 6 | PEOPLE | Structure | `Network` | `/settings/structure` | Owner, Admin, People team (read + job titles) | never |
| 7 | PEOPLE | Access | `ShieldCheck` | `/settings/access` | Owner, Admin, People team (read) | never |
| 8 | WORK | Task system | `Shapes` | `/settings/tasks` | Owner, Admin | never |
| 9 | WORK | Scoring & reviews | `BarChart3` | `/settings/scoring` | Owner, Admin, People team (read) | never |
| 10 | SECURITY & DATA | Security | `Shield` | `/settings/security` | Owner, or Admin with `security` | Admin without `security` |
| 11 | SECURITY & DATA | Data | `Database` | `/settings/data` | Owner, Admin (Retention purge and the Danger rows: Owner) | never |
| 12 | SECURITY & DATA | Audit log | `FileCheck` | `/settings/audit` | Owner, Admin | never |
| 13 | SECURITY & DATA | API & webhooks | `Key` | `/settings/api` | Owner, or Admin with `security` | Admin without `security` |
| 14 | BILLING | Plan & billing | `CreditCard` | `/settings/billing` | Owner, or Admin with `billing` | Admin without `billing` |
| 15 | (none, last) | All settings | `List` | `/settings/all` | Owner, Admin | never |

The People team sees rows 5, 6, 7 and 9 only, with no group labels other than PEOPLE and WORK, plus a first row "My settings" pointing at `/account/profile` so their list is never a four-row orphan. Nobody else ever sees this sidebar: a Member, Agent or Guest on a `/settings/*` URL, and the People team on a Workspace page outside their four, are inside the **My settings** sidebar looking at My settings › Profile with the Ask-an-admin strip above it, at the URL they typed (§1.4). No `/settings/*` URL ever 404s for a signed-in person, because the personal door shares the prefix (access §5.5 item 3).

The My settings list (owned by the personal-door unit, repeated here so the two lists can be read side by side): Profile, Preferences, Notifications, Security, Calendar & connections, Keyboard shortcuts, All settings. Flat, no groups. Owners and Admins reach it from the avatar menu's "My settings" row; the two doors never nest.

### 1.3 Naming canon

One label per destination, everywhere: sidebar row, page title, top-bar crumb, `⌘K` result, Overview card, and every inbound link. All three read `SETTINGS_PAGES[key].label`, so drift is impossible by construction (`settings-pages` #25).

| Canonical label | Replaces |
|---|---|
| Workspace settings | "Admin", "Admin door", "Organization settings", "Org settings", "Settings" (when it meant the admin door) |
| My settings | "Personal", "Personal door", "Account", "Account settings" |
| Overview | "Settings", "Settings home" |
| Identity & culture | "Identity & profile" (nav), "Identity & company profile" (page title), "Company profile", "Defaults & locks" (now a tab) |
| Locale & work week | "Locale & finance", "Locale" |
| Apps & modules | "Apps", "Enabled modules" (nav), "Modules" (page title) |
| Members | "Members", "Team", "People" (in a settings context) |
| Structure | "Org structure", "Organization structure", "Functions" (Departments), "Roles" (Job titles) |
| Access | "Roles & permissions", "Roles & Permissions", "Access Control", "Permissions", "Access levels" |
| Task system | "Task types", "Task Types", "Tags & labels" |
| Scoring & reviews | unchanged |
| Security | "Session & 2FA", "Password policy", "Org policy" |
| Data | "Data & compliance", "Import / Export", "Export" |
| Audit log | unchanged |
| API & webhooks | "API keys", "Integrations" (the settings row) |
| Plan & billing | "Billing", "Upgrade" (as a destination label) |
| All settings | the sidebar's own "All settings" heading, which is deleted as a heading |
| Departments | "Functions" |
| Job titles | "Roles" (in the org-structure sense; `Role.level` is relabelled "Seniority" and loses all access meaning) |
| People team | "HR", "HR admin", "hr-admin tier" |
| Sign-in policy | "Password policy" plus "Session & 2FA" as two separate cards |

Role words come from `src/lib/access/labels.ts` and are never a raw enum: Owner, Admin, Member, Guest, Agent, People team; Full access, Can edit, Can comment, Can view. `EMPLOYEE`, `C_LEVEL`, `MANAGER`, `hr-admin`, `org-admin` never appear in any string a user can read.

### 1.4 Access

One gate, one file, one convention.

- `src/app/(dashboard)/settings/layout.tsx` resolves the page key from `x-workwrk-path` (stamped by `src/proxy.ts`, which already inspects `req.nextUrl.pathname` at line 124) and calls `gatePage("view", { type: "settings", page })`. The rule table is `SETTINGS_PAGES` in `src/lib/access/settings.ts`, the only file allowed to hold settings role logic. One row per page: `{ door, key, label, href, group, icon, gate, aliases, tabs }`.
- Belt and braces: every Owner-or-scope page (`security`, `api`, `billing`) also calls `gateSettingsPage(key)` in its own server component, so a missing header can never widen access.
- The six per-route layouts (`apps`, `audit`, `data`, `defaults`, `identity`, `tags`) and the inline lock card in `structure/page.tsx:55-78` are deleted. `route-guard.ts` has no importer under `settings/` afterwards.

**Two denial views, not one, exactly as access §5.5 item 3 and access rule 14 define them.** `AdminOnly` is for one case only: an Admin on an Owner-only page without the matching scope. Everyone else who cannot open a Workspace page gets the **Ask-an-admin strip** over My settings › Profile at the URL they typed. **Nothing under `/settings/*` ever 404s for a signed-in person**, because the personal door shares the prefix. This matches `spec-shell.md` §2.8 word for word.

| Viewer | Outcome on any `/settings/*` URL |
|---|---|
| Owner | full page |
| Admin | full page, except `security`, `api`, `billing` without the matching scope |
| Admin without the page's scope | `AdminOnly` card at the same URL, naming the Owners, inside the Workspace door with the settings list still beside it |
| People team Member on `members`, `structure`, `access`, `scoring` | the page in read-only mode (§1.4), with the people-data fields editable |
| People team Member on any other Workspace page | My settings › Profile at the same URL, with the Ask-an-admin strip above it |
| Member or Agent | the same |
| Guest | the same. A Guest is never 404'd out of `/settings/*` and never sees a Workspace page's contents either; they see their own Profile with the strip |
| Not signed in | `/login?callbackUrl=<current>`, the only redirect in the system |

**1. The `AdminOnly` card** (one member of the `LockedPage` / `ModuleOff` / `AppOff` / `AdminOnly` family in `src/components/access/`), rendered inside the **Workspace** door at the unchanged URL, with the settings list still showing and that row carrying its lock glyph:

- 20px page icon from the page table in `--os-ink-2`, the page label 16/600, then one sentence 15/400 `--os-ink-2` naming Owners only, because this view only ever appears to an Admin: "Billing is managed by workspace Owners." Up to five 24px avatars with `mailto:` links beneath, real people from `GET /api/access/admins`, never a fabricated stack, and one 14/500 text link "Ask an Owner" that opens the same mailto.
- `BackButton{fallbackHref="/settings"}` labelled "Back to Overview", 28px ghost in the title row.
- No "Request access" (a settings page is not a shareable object), no disabled controls, no page content behind a blur.

**2. The Ask-an-admin strip**, rendered inside the **My settings** door above the normal **My settings › Profile** content, at the unchanged Workspace URL:

- One 44px strip under the takeover header, `--os-brand-soft` fill, radius 8, 16px `Info` glyph, 14/400 `--os-ink`: "{Page label} is part of Workspace settings, which {first three Owner and Admin names} look after. Ask them if you need something changed." Up to five 24px avatars with `mailto:` links at the right, real people from `GET /api/access/admins`.
- Beneath it, the person's own Profile page, fully working. The strip is an explanation, not a wall: the viewer is never left on a dead screen, and nothing about the Workspace page is revealed beyond its label.
- The strip needs no `BackButton` (access §6.4): the page under it is a destination.
- The sidebar beside it is the **My settings** list, not the Workspace list, so nothing about the Workspace door's shape leaks.

A settings decision **never redirects** and never 404s. `/dashboard`, `/people/me` and `/team/reviews` as denial targets are deleted.

**Every org write API** calls `requireCan("manage", { type: "settings", page })` with the page that owns it: `PATCH /api/settings`, `PATCH /api/org/preferences`, `/api/keys`, `/api/scim-tokens`, `/api/products/installations`, `/api/item-types*`, `/api/tags*`, `/api/offices*`, `/api/webhooks`, `/api/audit-log/export`, `/api/billing/*`, `POST /api/org/sign-out-everyone`. C_LEVEL's stray PATCH of `/api/settings` (`settings/route.ts:123`) ends because C_LEVEL no longer exists. `/api/item-types` gains the gate it never had. `/api/audit` moves from `isManager` to the page rule. `PATCH /api/users/[id]` validates every body key against the per-field table (`settings-architecture` §9.2a) and returns 403 `field_forbidden` naming the field, never a silent drop.

**Read-only viewer** (People team on their four pages), per access §5.4: no control the role cannot use is rendered, ever. Values render as text at the same position and size the control would occupy (a switch becomes "On" / "Off" 15/400 `--os-ink`; a select becomes its label; a table row menu is absent). One slim banner under the page header, 36px, `--os-brand-soft` fill, 13/400 `--os-ink`, 16px `Info` glyph: "You can look and keep people information up to date. Ask an Owner or Admin to change settings." The fields they may edit (job title, department, office, reports to, dotted lines, weekly capacity) render as live controls in the same table and drawer as for an Admin.

### 1.5 Back and close

- **One exit affordance, not two.** The takeover bar carries "← Back to app" at the left and **nothing at its right**: the Close ✕ is deleted (design system §4.6, tie-break 4, and `settings-pages` #24, which counted four back patterns on one screen family). "← Back to app" and `Esc` both call `closeSettings()` from `src/lib/settings-nav.ts`: `returnTo` (written by `openSettings(href)` into `sessionStorage["workwrk:settings:return"]`) when it exists and is not itself a settings route; else `lastAppPath` from shell context (mirrored to `sessionStorage["workwrk:shell:last-app-path"]`); else `/today`. A hard-coded `router.push("/today")` inside settings chrome is an ESLint error. A **modal or drawer** inside the door keeps its own ✕ in its own header: that ✕ closes one layer back to the page beneath it, which is a different object with a different target, and deleting it would leave a dialog with no visible way out.
- `Esc` closes the top layer first: a picker, then a dialog, then a drawer, then the dirty guard, and only then leaves the door. The shell's single `LayerStack` listener owns this; no settings page registers its own `keydown`.
- Inside a door, sidebar rows, tabs and breadcrumb crumbs are ordinary `router.push`. Browser Back walks settings pages and does not jump out of the door.
- Detail routes inside this unit: there are none. Every "detail" is a 520px drawer over its list (a member, an audit row, an API key, a webhook) whose close target is the list, with the list's own URL plus `?row={id}` so Copy link works. The **one drawer that is not a record** is Task system's 360px "Recommended types" browser: it carries no `?row=`, because there is no record to link to, and its close affordance and close target are written out in §2 rather than inherited from this rule. `BackButton{fallbackHref}` is not used inside the doors (`settings-architecture` §8.3); it is used on the `AdminOnly` card, the one full-page denial view here, and the Ask-an-admin strip needs none because the page under it is a destination (access §6.4).
- **Dirty guard**: `useDirtyGuard(isDirty)` from `src/hooks/use-dirty-guard.ts`. While dirty, `beforeunload` prompts and every in-door navigation (sidebar row, tab, crumb, Back to app, Esc) opens a 400px confirm "Save your changes?" with `[Keep editing]` `[Discard]` `[Save changes]`, primary right. A failed save keeps the form dirty and re-arms the guard. Registered by the Save-bar pages only: Identity (Profile, Culture), Locale & work week, Members › Invite rules, Security (Sign-in policy, Single sign-on), Data › Retention & privacy, Scoring & reviews (per section). Autosave rows never make a page dirty.

### 1.6 Mobile and narrow

The first settings surface with a breakpoint, and the only one in this refresh.

- **Below 900px**: the 264px settings list is replaced by a 36px "Pages" select in the takeover header, immediately to the right of "← Back to app" (the bar's right side stays empty at every width, per tie-break 4); it lists the same rows in the same order with the same group labels as `optgroup`s, and lock glyphs as a trailing "· Owners only". The content column takes the full width with 16px padding.
- **Below 900px**: every table scrolls inside its own card (`overflow-x: auto` on `TableCard`), the body never scrolls horizontally; the filter side panel becomes a 320px drawer from the left; row drawers go full-screen with their own header.
- **Below 1024px**: the top bar's breadcrumb shows the last two crumbs only and the bar search becomes an icon (shell rule).
- Tabs wrap to a second line rather than overflowing; past two lines the overflow goes into a "•••" menu.
- No hover-only affordance anywhere in this unit: every row action is a visible 28px ghost icon or lives in the row's "…" menu (this deletes the hover-only Task-type card actions and the hover-only Tag delete).

### 1.7 The page pattern in this unit

Two layouts, no third. Both sit on `--os-canvas` with 24px padding, under the takeover header.

**List page** (Members, Guests, Teams, Pending invites, Departments, Job titles, Offices, Task types, Tags, API keys, Webhooks, SCIM tokens, Audit log, Recent exports). Content column **1120px max**, the card fluid inside it (`spec-shell.md` §2.8 reconciles the two widths: "the 760px form column and the 1120px list column"). Below 1120 the column is fluid with the takeover's 24px padding; below 900 it is fluid with 16px and the card scrolls inside itself (§1.6).

1. Title row 48: title 22/600 `--os-ink`; right, ghost page actions only.
2. Views row 36: text-tab pills for the page's tabs (15/400 `--os-ink-2`, 32px, radius 6; active `--os-surface-2` + 15/500 `--os-ink`). Not rendered when a page has one tab.
3. Toolbar 44, no bottom border: left `Filter` (16px `Funnel` + label, 36px toggle chip, becomes `--os-surface-2` and reads "Filter · 2" when the panel is open) and `Sort` (`ArrowUpDown`); a 1px 20px divider; no view-type switcher (one renderer per list, except Structure › Org chart which is a link card, not a view). Right: **the one blue button** for that tab (or none, per the rule below), 36px, and then a bordered 36px "…" square for secondary actions.

   **`Sort` and `Filter` are never named without their contents.** `Sort` is a 220px `Picker` menu of named orders with a check on the active one, it applies server-side, it survives a tab change only within the same tab, and its default is stated per tab in §2. `Filter` opens the 272px panel whose checkbox rows are listed per tab in §2. A page in §2 that names `Filter` or `Sort` without listing its rows or its orders is incomplete, and every one of them lists them.
4. 8px gap, then `TableCard`: bordered white card, radius 8, N50 header row, 13/500 `--os-ink-2` labels, checkbox column where bulk actions exist, inline "All ▾" filter on the first text column, pinned `SlidersHorizontal` column-settings button, 44px rows at Comfortable, hairlines, no zebra, footer inside the card with "Total members 42" left and "1 to 40 ‹ ›" right.
5. Row click opens the 520px drawer. Never a second page.

**Form page** (Overview, Identity, Locale, Apps, Access, Security, Scoring, Data, Billing, All settings):

1. Title row 48: title 22/600; optional 13/400 `--os-ink-2` subtitle only when it adds information (never a restatement of the title).
2. Views row 36 when the page has tabs.
3. Content column **760px max** (`spec-shell.md` §2.8), cards stacked with **24px** gaps. Card, exactly per design system §5.4, which wins on look: `--os-surface`, `1px solid var(--os-line)`, radius 8, **24px padding**, title 16/600, optional 13/400 description, **at most five fields**, **16px between fields**, **560px wide**, left-aligned in the column. A card that needs a sixth field is two cards.

   **The one width deviation, stated rather than implied.** A card whose body is a `TableCard` or a list of full-width rows takes the whole 760 instead of 560, because a table or a row of label plus control truncates at 560: Apps › Rail apps, Apps › Modules, Access cards 2 and 3, Scoring › Score weights and Performance bands, Data › Retention & privacy, Data › Recent exports, Security › Provisioning, Identity › Appearance defaults. Every card that is a stack of labelled inputs (Identity › Profile and Culture, Locale, Security › Sign-in policy, Billing) is 560. Nothing between the two values exists.
4. Field: label above 13/500 `--os-ink`, helper 13/400 `--os-ink-2`, "(required)" as a word not a red asterisk, input 36px radius 6 with `--os-line-strong` border, focus ring 2px `--os-focus` plus a 3px `--os-focus-halo`.
5. Autosave rows: **48px minimum**, which is the design system §5.4 figure and wins over `settings-architecture` §10.2's 44 because a row height is look (tie-break 4). `label · helper` left, control right, `--os-line-soft` separators, a 12/500 `--os-success-text` "Saved ✓" that fades after 2 seconds, a toast with Retry on failure and the control reverts.
6. Save-bar pages: a 56px sticky bar at the bottom of the content column, `--os-surface`, 1px top border, "Unsaved changes" 13/400 `--os-ink-2` left, `[Discard]` ghost and `[Save changes]` primary right, visible only when dirty, one request per section.
7. Danger zone is always the last card: `1px solid var(--os-danger-border)`, title in `--os-danger-text`, destructive ghost buttons, typed confirmation for anything org-level.

**One primary per page, and the primary belongs to the active tab.** On a tabbed page the toolbar's blue button is a property of the tab, not of the page, and `SettingsPage` takes `primary` per tab so two can never render. Three rules settle every case in §2:

1. A tab whose body carries a **Save bar** has **no toolbar primary**. The Save bar's `[Save changes]` is that tab's one blue button. This covers Members › Pending invites (Invite rules), Identity › Profile and Culture, Locale, Security › Sign-in policy and Single sign-on, Data › Retention & privacy, and Scoring.
2. A tab may have **no primary at all**, and that is a finished answer, not an omission: Structure › Org chart, Task system › Templates, Data › Export, Data › Trash, Audit log, Access, Overview. Those tabs' toolbars carry the bordered "…" square and nothing blue.
3. When a page offers the same action from two places (a card button and a comparison card, say), the **card that the viewer's current plan or state makes actionable** keeps the primary treatment and the other is secondary. §2 `/settings/billing` is the one page where this arises and it is written out there.

### 1.8 Persistence rule

If it renders, it persists, and something reads it. Every control in §2 names its store, its writer and its reader. Missing a reader: the row renders only under My settings › Preferences › "Show upcoming features" (off by default), disabled, captioned "Coming soon" or "Not enforced yet". Missing a read or a write path: not rendered at all. `localStorage` never holds anything shown in a door. Every org write logs `settings.updated.{section}` with the changed keys; consecutive edits by one actor on one key within 60 seconds collapse into one audit row at write time.

### 1.9 States, on every route here

| State | What renders |
|---|---|
| Loading | Route transition: the rail logo dots pulse after 200ms and the content shows skeletons at the exact row heights (60/40/80% widths, one 1.6s opacity pulse) plus one 13/400 `--os-ink-2` value line under the first skeleton. In-card: `--os-skeleton` bars. No `Loader2`, no "Loading…" string, no full-screen overlay anywhere in this unit. |
| Empty | Quiet: a 96px four-dot line drawing in `--os-line-strong`, one sentence 15/400 `--os-ink-2`, at most one 14/500 `--os-brand-deep` text link. The illustration family is the design system's: a row of four dots for lists and tables, a cluster with a connecting line for the org chart and roles, a vertical stack for exports and audit rows. The page's blue button stays the only primary; the empty state never adds a second. |
| Filtered empty | An inline 44px row inside the card: "No results · Clear filters", 15/400 `--os-ink-2`, the second half a text link. No illustration. |
| Error | `ErrorState` in place of the content: one sentence, a wired `[Retry]` secondary button that re-runs the same fetch, and the raw reason behind a "Details" disclosure for support. **A Save-bar page never renders an empty form after a failed GET** (`useSettingsSection(section)` returns `{ status: "error" }` and the form is replaced), so Save can never overwrite live values with empty strings. This is Identity's live data-loss bug (`identity/page.tsx:56,70`). |
| Read-only | Only for the People team on `members`, `structure`, `access`, `scoring`: §1.4. Nowhere else, because nobody else who cannot edit can open the page. |
| Denied | Two views, one convention (§1.4): the `AdminOnly` card at the same URL for an Admin on an Owner-only page without the scope, and the Ask-an-admin strip over My settings › Profile at the same URL for a Member, Agent, Guest, or the People team on a page outside their four. Never a 404, never a redirect. |
| Offline / session expired | The shell's session-expired dialog (`spec-shell.md` §2.15) on any 401: "Your session expired. Sign in to keep your changes." with `[Sign in]` primary, opened over the page so a dirty form is not lost; the form re-submits after a successful re-auth. Offline: the autosave tick becomes "Not saved, retrying" in `--os-danger-text` per the `AutosaveIndicator` contract and the Save bar stays dirty. |

### 1.10 Keyboard, on every route here

`⌘K` and `⌘/` focus the settings list filter (the global palette is unmounted in settings mode). `Esc` per §1.5. `Tab` order is header, list, content, Save bar. In a table: `↑` `↓` move the row focus, `Enter` opens the row drawer, `Space` toggles the row checkbox, `⌘A` selects the page of rows when a checkbox column exists. In a drawer: `Esc` closes, `⌘Enter` saves where a Save bar exists. Every icon-only button carries a tooltip and an `aria-label`.

### 1.11 Registry and search

`src/lib/settings-registry.ts` holds one `SettingEntry` per rendered field: `{ id, label, keywords[], door, page, tab?, href }`. It carries no gate (the gate is the page's, read from `SETTINGS_PAGES[page].gate`), which keeps the "no role logic outside `src/lib/access/`" lint rule intact. Three search surfaces, one index: the sidebar filter, the Overview search field, and the `⌘K` palette "Settings" group outside the door. A vitest unit test renders each page's field list and asserts every rendered field id exists in the registry, that its `href` resolves to a page in the page table, and that a grep-able reader key exists for its store. Arriving with a hash scrolls the card into view and pulses its border once (150ms, no transform).

---

## 2. Route specs

Every block below inherits §1. Only differences are stated. Where a heading has nothing route-specific it says so rather than being omitted.

**Every route's Data heading opens with its home in `settings-architecture.md`**, so the mapping from a page to the document that decides what settings it holds is mechanical rather than re-derived. The whole map, in one place as well, for anyone reading only this paragraph:

| Route | Home | Route | Home |
|---|---|---|---|
| `/settings` | `settings-architecture` §5.1 | `/settings/security` | §5.9 |
| `/settings/identity` | §5.2 | `/settings/data` | §5.10 |
| `/settings/apps` | §5.3 | `/settings/audit` | §5.12 |
| `/settings/members` | §5.5 | `/settings/api` | §5.13 |
| `/settings/structure` | §5.6 | `/settings/billing` | §5.14 |
| `/settings/access` | §5.7 | `/settings/locale` | §5.15 |
| `/settings/tasks` | §5.8 | `/settings/scoring` | §5.16 |
| `/settings/all` | §5.17 | the ten redirects and `/imports` | §7 (disposition) and §8.4 (redirect list) |

---

### `/settings`  (`src/app/(dashboard)/settings/page.tsx`)

- **Purpose**: the one place an admin lands to see the state of the workspace and get to the setting they want in one click.
- **Who sees it**: Owner and Admin. People team, Member, Agent and Guest: the Ask-an-admin strip over My settings › Profile at this URL (§1.4); never a 404. **Entry points**: rail Settings hub (Owner and Admin land here per §1.1); avatar menu › "Workspace settings"; workspace menu; `⌘K` › "Workspace settings"; the takeover sidebar's Overview row; the top-bar crumb "Workspace settings"; deep link. The rail "Upgrade" link no longer lands here (it goes to `/settings/billing`), and the Tools, Assets and Integrations pages no longer carry a "Settings" nav-link at all.
- **Top bar**: left ‹ ›, breadcrumb `Settings › Workspace settings › Overview` (last crumb plain, the other two links). Centre: the bar search, which inside a door opens the settings filter. Right: "+", bell, help, avatar, unchanged.
- **Secondary sidebar**: the settings list, Overview row active (exact match), all groups expanded.
- **Page header stack**: title **"Overview"** 22/600, which is `SETTINGS_PAGES.overview.label` and therefore the same word the sidebar row, the last breadcrumb crumb, the `⌘K` result and every inbound link use (§1.3). Subtitle 13/400 `--os-ink-2` `{Org} · {Plan} · {N} members · {M} guests` from `GET /api/settings` usage plus the Members count strip, which is where the workspace's name actually belongs. Breadcrumb `Settings › Workspace settings › Overview`, so the door's name is on screen once, above the title, and never competes with it. **Deviation, stated**: `settings-architecture` §5.1 titles this page "Workspace settings". That would put two labels on one destination and break §1.3's by-construction rule on the door's first route, so the registry label wins here; the door name is not lost, it is the crumb. No views row (one view). Toolbar: **no toolbar row**; the search field is the first element of the body, because a search field is not a filter chip. Zero blue buttons on this page: the primary action of an overview is to leave it.
- **Body layout**, in reading order:
  1. **Search field**, 480px (full width under 900px), 36px, `Search` glyph, placeholder "Search settings". Backed by the registry (§1.11). Results render as a 36px row list grouped by page: page label 11/600 uppercase, then rows `field label` 15/400 with the tab name 13/400 `--os-ink-2` at the right; `Enter` opens the first result's deep link. Results replace the card grid while the field has text.
  2. **Set up {Org}** card, first-run only, until all four steps are done or it is dismissed. Four rows, each 44px: a `quad-steps` glyph (filled when done), the step label 15/400, and a 28px ghost "Open" at the right. Steps and their done-conditions, each derived from data and never "ticked when visited": "Add your logo and mission" → `/settings/identity` (done when `logo` or `companyProfile.mission` or one core value exists); "Invite your team" → `/settings/members?invite=1` (done at two or more active members); "Create departments" → `/settings/structure?tab=departments` (done at one or more); "Turn on Talk or Tables" → `/settings/apps#modules` (done when any module is active; caption "both are optional"). One line under the steps: "Security: two-factor is required for admins by default. Review in Security." Dismiss writes `Organization.settings.console.setupDismissedAt`; the card then collapses to a single 44px "Setup complete" row that can be dismissed for good. The two localStorage dismissal keys (`twrk-checklist-dismissed`, `workwrk-setup-checklist-dismissed`) are deleted.
  3. **One card per sidebar page**, fourteen, in the sidebar's order and grouped by the sidebar's group labels, in a responsive grid (three across above 1120, two above 900, one below). These are **link tiles, not form cards**, so the §1.7 card metrics (24px padding, 560px, five fields) do not apply to them and are not meant to: bordered, radius 8, **16px padding**, hover `--os-surface-hov`, the whole tile a link, no controls inside. Overview is the one page in this unit with no form cards at all. Contents: 20px page icon in a 32px `--os-brand-soft` tile, page label 16/600, one 13/400 `--os-ink-2` line, then **two live values** 14/400 with the number at 500. The values, so nothing is decorative:

     | Card | Two live values |
     |---|---|
     | Identity & culture | "{N} core values", "Mission set" / "No mission yet" |
     | Locale & work week | "{Time zone}", "{Currency} · fiscal year starts {Month}" |
     | Apps & modules | "{N} of 2 modules on", "{N} apps hidden" |
     | Members | "{N} members · {M} guests", "{N} pending invites" |
     | Structure | "{N} departments", "{N} job titles · {N} offices" |
     | Access | "New Spaces: {toggle 2 value}", "Guest invites: {toggle 5 value}" |
     | Task system | "{N} task types", "{N} tags" |
     | Scoring & reviews | "{Cadence}", "Weights sum to {N}" |
     | Security | "Two-factor: {audience}", "Idle timeout {N} minutes" |
     | Data | "Trash kept {N} days", "Last export {relative date}" |
     | Audit log | "{N} events in the last 7 days", "Kept {N} days" |
     | API & webhooks | "{N} active keys", "{N} webhooks" |
     | Plan & billing | "{Plan} · {status}", "{N} of {M} seats" |
     | All settings | "{N} settings", "across {N} pages" |

     An Owner-only page an Admin cannot open renders as the same card with a 16px `Lock` and the second value replaced by "Owners only"; clicking it opens the `AdminOnly` card, which is honest and one click, not a dead tile. **No card links to `/settings`** (today "Locale & finance" and "Plan & billing" both do, `settings/page.tsx:112,123`), and **no card leaves the door** (today three Usage cards jump to `/people`, `/sops` and `/analytics` with no way back); usage lives on Members and Plan & billing.
- **Side panel / drawer / modal**: none.
- **States**: loading, skeleton cards in the grid shape. Empty: unreachable (there is always a page list). Error: the whole card grid is replaced by `ErrorState` with a **wired** Retry (today `cta="Retry"` is passed with no handler so no button renders, `empty-view.tsx:41`). Read-only: n/a (the People team does not see Overview). Denied and offline per §1.4 and §1.9.
- **Keyboard**: `⌘K` or `⌘/` focuses the page search field when this page is open rather than the sidebar filter; `↓` moves into the results; `Enter` opens.
- **Data**: home `settings-architecture` §5.1. `GET /api/settings` (org, settings JSON, usage), `GET /api/org/preferences` (hidden app count), `GET /api/users?scope=all&limit=1` for counts (or the counts the settings endpoint already returns), `GET /api/products/installations`, `GET /api/access/admins` for both denial views (§1.4). Reads `Organization.settings.console.setupDismissedAt`, `settings.retention.*`, `settings.security.mfaRequired`, `settings.access.*`. Writes only `PATCH /api/settings { section: "console" }` on dismiss. **New**: the counts endpoint may be a single `GET /api/settings/overview` returning every card's two values in one round trip; fourteen separate fetches is the thing to avoid.
- **Realtime**: none. The page re-reads on mount and on the existing `workwrk:prefs-changed` event.
- **What changes vs today**: self-links fixed; the card grid covers every page instead of roughly half; the legacy `reviewFrequency` and the default `{kpi, manager, peer, self, sopCompliance}` weights vocabulary disappear from the Scoring cards (`settings-pages` #31); the two Security cards stop sending admins to a read-only personal page and point at the real editor (#5); the Usage cards stop leaving the door; the error state gains a Retry (#20); the h1 goes from 16px bold to 22/600 (#22); the setup checklist's targets are corrected and its ticks become data-derived (#17).
- **Open questions**: none.

---

### `/settings/identity`  (`src/app/(dashboard)/settings/identity/page.tsx`)

- **Purpose**: what the company is called, what it stands for, and how the workspace looks by default.
- **Who sees it**: Owner and Admin; the Danger zone tab is Owner only. Entry: sidebar row; Overview card; first-run step 1; admin tour step 1; workspace menu › "Delete workspace" (`?tab=danger`).
- **Top bar**: breadcrumb `Settings › Workspace settings › Identity & culture`.
- **Secondary sidebar**: Identity & culture active.
- **Page header stack**: title "Identity & culture"; subtitle "Your workspace name, your mission, and the defaults everyone starts with." Views row: four text-tab pills, **Profile · Culture · Appearance defaults · Danger zone**, `?tab=` on load, `router.replace` on change, default `profile`. Toolbar: none; Profile and Culture are Save-bar pages, Appearance defaults autosaves, Danger zone has its own buttons.
- **Body layout**:

  **Tab: Profile** (Save bar, one `PATCH /api/settings { section: "profile" }`)

  | Card | Field | Default | Control | Persists | Validation |
  |---|---|---|---|---|---|
  | Workspace | Logo | none | 64px preview tile plus `[Upload]` and `[Remove]` secondary buttons; autosaves on pick, outside the Save bar | `Organization.logo` via `POST` / `DELETE /api/settings/logo` | PNG, JPG, SVG, WEBP; 2MB; client and server both check |
  | Workspace | Workspace name | from signup | text input, 360px | `Organization.name` | required; an empty value is a field error under the input ("Workspace name is required"), never a silent server-side `if (data.name)` skip |
  | Workspace | Primary email domain | the first Owner's email domain | text input, 280px, prefixed "@" | `Organization.domain` | hostname format; used by invitations, Invite rules and the sign-in domains mirror; changing it shows "Existing invitations keep the old domain" |
  | About the business | Industry | empty | picker over a fixed list with "Other" and free text | `settings.industry`, **read by** the one org-context block that every AI prompt already builds (KRA generation, SOP drafting, Sidekick), beside mission, vision and about, and by the first-run template suggestions on `/templates`. The reader ships in the same change as the writer, per §1.8 | |
  | About the business | Business type | empty | picker: Services, Product, Retail, Manufacturing, Non-profit, Other | `settings.businessType` | read on the Overview today and **never written**; this is its writer |
  | About the business | Team size | empty | picker: 1 to 10, 11 to 50, 51 to 200, 201 to 1000, 1000+ | `settings.teamSize` | same |
  | Branding | Logo mark, email header, custom domain (no accent or brand colour: the token sweep leaves one brand, tie-break 4) | none | the wired fields of the orphan `components/settings/branding-manager.tsx` | `settings.branding.*`, **read by** three surfaces, each named so the row cannot go cosmetic: the sign-in screen for this workspace's domain, the header of every transactional email the product sends (invitation, reset, digest, review reminder) in `src/emails/`, and the public view of a shared link. The Enterprise `whiteLabel` flag is the **gate**, not the reader, and a gate is never accepted in place of one (§1.8) | **rendered only for orgs with the Enterprise `whiteLabel` flag**; otherwise one 48px row "Custom branding is available on Enterprise" with a text link to Plan & billing. If the three readers are not wired when the flag ships, the whole card sits behind "Show upcoming features" instead |

  **Tab: Culture** (Save bar, `section: "culture"`)

  | Field | Default | Control | Persists | Read by |
  |---|---|---|---|---|
  | Mission | empty | textarea, 4 rows, auto-grow to 12, 600 chars | `settings.companyProfile.mission` | the splash, the route loader caption, AI KRA generation |
  | Vision | empty | textarea, 4 rows | `companyProfile.vision` | AI KRA generation |
  | About | empty | textarea, 4 rows | `companyProfile.about` | AI KRA generation |
  | Core values | empty | chip list: 24px `Chip`s with a 12px ✕, one 36px input below with "Add" on Enter or the button, case-insensitive dedupe, drag to reorder, max 12 | `companyProfile.values[]` | the splash rotation, the loader caption, Kudos categories |
  | Welcome splash | Every app open | segmented control, three segments: **Every app open · First open each day · Off** | `companyProfile.splash` | `MissionSplash` (shell) |

  A 13/400 `--os-ink-2` line under Core values: "Values show on the welcome splash and when someone gives kudos." Never a preview card that fakes the splash.

  **Tab: Appearance defaults** (autosave per row, `PATCH /api/org/preferences`)

  | Row | Default | Control | Persists |
  |---|---|---|---|
  | Default theme | Light | segmented control Light · Dark · System | `OrgPreference.themeDefault` |
  | Default chrome | Navy | segmented control Navy · Light | `OrgPreference.chromeDefault` (new key) |
  | Default density | Comfortable | segmented control Comfortable · Cozy · Compact | `OrgPreference.densityDefault` |
  | Lock these for everyone | all off | four switches: Theme, Density, Rail labels, Home cards | `OrgPreference.lockedKeys[]` written only from `src/lib/preferences-locks.ts` dot-paths (`theme.appearance`, `density`, `sidebar.iconsOnly`, `home.cards`) |

  **There is no Default accent row.** It is deleted, not hidden, in the same pull request as the design system's token sweep that removes the ten `data-accent` blocks (tie-break 4): after the sweep the product paints one brand, a swatch picker would change nothing on screen, and §1.8 does not allow a control that persists a value nothing reads. `OrgPreference.themeDefault.accent` and the per-person accent are normalised to `workwrk` on read and stop being written; the column is dropped in the same release's data step, so no org keeps a stored choice it cannot see. **Default density stays, and its default is Comfortable 44**, matching the design system's default rather than the old Cozy, which is the one Appearance-defaults value this resolution changes and which any workspace can move back from this row without a token change.

  A locked key greys the matching row in My settings › Preferences **and** in the Customize panel with a 16px `Lock` and "Set by your workspace", which is what the current help text admits is missing (`defaults/page.tsx:344-347`). One text link at the bottom: "See how this looks for you" → `/account/preferences?tab=appearance`.

  **Tab: Danger zone** (Owner only; for an Admin the tab renders and the content is the `AdminOnly` card with the Owners named)

  | Action | Control | Persists |
  |---|---|---|
  | Transfer ownership | `[Transfer ownership]` destructive-ghost, opens a 560px modal: a people picker over `GET /api/people/pick`, a checkbox "Also remove me as an Owner", and a confirm line naming the Owners who remain | `PATCH /api/users/[id]` `orgRole` → OWNER; last-Owner guard; bumps both `tokenVersion`s; audit `org_role.changed` |
  | Delete workspace | `[Delete workspace]` destructive, opens a 400px confirm requiring the workspace name typed exactly, listing what goes and the 14-day restore window | `POST /api/organizations/delete` (exists, no UI today); `POST /api/organizations/restore` within 14 days |

- **Side panel / drawer / modal**: Transfer ownership 560px modal; Delete workspace 400px confirm. Pickers inside them are `position:absolute` children, never portalled.
- **States**: loading, skeleton cards. Empty: n/a. Error: **the form is replaced by `ErrorState` with Retry**; the Save bar is not rendered, so a failed GET can never be saved as empty strings over live values. Read-only: n/a. Denied per §1.4. Session expired per §1.9.
- **Keyboard**: `⌘Enter` saves from any field on a Save-bar tab; `Enter` in the Core values input adds the value.
- **Data**: home `settings-architecture` §5.2. `GET /api/settings`; `PATCH /api/settings { section: "profile" | "culture" }` (`.strict()` zod, unknown keys are a 400 naming them); `POST` / `DELETE /api/settings/logo`; `GET` / `PATCH /api/org/preferences`; `POST /api/organizations/delete`, `/restore`; `PATCH /api/users/[id]` for the transfer. Reads `ProductInstallation` only for the Enterprise flags. `GET /api/organization/culture` (the existing splash endpoint) keeps its shape.
- **Realtime**: on save, dispatch `workwrk:prefs-changed` so the splash, loader captions and Customize panel pick up new values without a reload.
- **What changes vs today**: the two sequential PATCHes (`general` then `companyProfile`) become one per tab; the blank-form-overwrites-live-data path is closed; `businessType` and `teamSize` gain their writer; domain gains validation; mission and about textareas go from 2 rows to 4 with auto-grow; `/settings/defaults` is absorbed as a tab and the two accent vocabularies end together with the accent row itself; the C_LEVEL mismatch between layout, page and API disappears with C_LEVEL; the page title stops being "Identity & company profile" while the nav says "Identity & profile".
- **Open questions**: the splash default. This spec keeps "Every app open" as the current behaviour so the founder's ask is preserved, while the design system recommends "First open each day" and the shell already builds both. One answer sets `seedOrgDefaults`.

---

### `/settings/locale`  (`src/app/(dashboard)/settings/locale/page.tsx`)

- **Purpose**: the company's time zone, money, week and language, which everything else falls back to.
- **Who sees it**: Owner and Admin. Entry: sidebar row; Overview card; a text link from Identity › Profile.
- **Top bar**: breadcrumb `… › Locale & work week`.
- **Secondary sidebar**: Locale & work week active.
- **Page header stack**: title "Locale & work week"; subtitle "Defaults for dates, money and the working week. Each person can override the first four in their own settings." No views row. No toolbar. Save bar at the bottom (`section: "locale"`).
- **Body layout**: three cards, 760px column.

  | Card | Field | Default | Control | Persists | Read by |
  |---|---|---|---|---|---|
  | Region | Time zone | detected at org creation, else `Asia/Kolkata` | searchable picker over the **full IANA list** with a "Use this device's time zone" row at the top; the current value always renders even if it is outside any short list | `settings.timezone` | reminder and digest crons, due-date bucketing, new people's effective locale |
  | Region | Currency | INR | searchable picker over the **full ISO 4217 list**, showing code, symbol and name | `settings.currency` | every money format in the product |
  | Region | Default language | English | picker over the 18 wired catalogs in `src/i18n/config.ts` with native names | `settings.language` | **`src/i18n/request.ts`**: the resolution order becomes user `home.locale.language` → org `settings.language` → `NEXT_LOCALE` cookie → `accept-language` → `en`. This is what makes the setting real; today it is stored and read by nothing. Any existing saved value other than `en` is normalised once with an audit note |
  | Dates and the week | Week starts on | Monday | segmented control Monday · Sunday | `settings.locale.weekStart` | Planner, DatePlanner, board calendar, timesheets, which disagree today |
  | Dates and the week | Date format | DMY | segmented control DMY · MDY · YMD with a live example ("31/12/2026") | `settings.locale.dateFormat` | the one `formatDate` helper |
  | Dates and the week | Time format | 24h | segmented control 24h · 12h with a live example | `settings.locale.timeFormat` | same |
  | The working week | Fiscal year starts in | April | month picker, 1 to 12, stored as a **number** | `settings.fiscalYearStart` | fiscal periods, review cadences, the Overview card. The `"MM-01"` string writer is removed and existing string values migrate on read |
  | The working week | Working days | Mon to Fri | seven 32px toggle chips | `settings.work.capacity.workingDays` | Workload, Team views, capacity maths |
  | The working week | Default weekly capacity | 40 hours | number input, 1 to 80, suffix "hours" | `settings.work.capacity.weeklyHours` | Workload; per person it is overridden in the Members drawer, which replaces the `workwrk:team-workload:v1` localStorage value |

  A 13/400 line under the Region card: "People can pick their own time zone, language and formats in My settings." with a text link to `/account/preferences?tab=locale`.
- **Side panel / drawer / modal**: none; the three pickers are `Picker` popovers (280px, search shown because every list is over 6 items).
- **States**: per §1.9. Error replaces the form (no blank-form save). Loading: skeleton rows.
- **Keyboard**: `⌘Enter` saves; type-ahead inside every picker.
- **Data**: home `settings-architecture` §5.15. `GET /api/settings`; `PATCH /api/settings { section: "locale" }`. `getEffectivePreferences` merges `home.locale` the way `theme` merges: defaults → org → user → locked keys re-stamped.
- **Realtime**: none; a change takes effect on the next render for the org and on the next request for the crons.
- **What changes vs today**: 9 time zones become the IANA list, 8 currencies become ISO 4217, 6 languages become the 18 that actually have catalogs and the value finally reaches `next-intl`; the fiscal representation stops disagreeing with the Overview card; week start, date format, time format and the working week arrive, which is the org half of the "time and locale handled differently per surface" systemic issue; the contradictory subtitle ("Shared with Identity & profile") goes; the page gains a dirty guard.
- **Open questions**: none.

---

### `/settings/apps`  (`src/app/(dashboard)/settings/apps/page.tsx`)

- **Purpose**: which parts of WorkwrK this company uses, and what everyone sees in the left rail.
- **Who sees it**: Owner and Admin. Entry: sidebar row; Overview card; first-run step 4; the `ModuleOff` screen's "Manage modules" link for Admins; `/settings/modules` redirect with the `#modules` anchor.
- **Top bar**: breadcrumb `… › Apps & modules`.
- **Secondary sidebar**: Apps & modules active.
- **Page header stack**: title "Apps & modules"; subtitle "Turn capabilities on, and decide what shows in everyone's rail." No views row (this page uses anchored sections, not tabs, because `#modules` must keep working as a redirect target). Toolbar: one 44px row with, left, nothing, and right, a bordered "…" square holding "Reset rail to the default order". No blue button: every control here autosaves.
- **Body layout**: three sections with 11/600 uppercase labels and a rule, in this order.

  **1. Modules** (anchor `#modules`). One bordered card per `MODULES` entry in `src/lib/modules.ts` (Talk, Tables today), full width of the 760px column:
  - 20px icon in a 32px neutral tile, name 16/600, "Competes with {Slack + Zoom}" 13/400 `--os-ink-2`, the blurb 13/400 on the next line, an "Included in {plan}" or "Add-on" `Chip` at the right of the title row, and a `Switch` at the far right of the card.
  - When on: a 14/500 `--os-brand-deep` text link "Open Talk" and one live value, "{N} channels" or "{N} tables".
  - Turning off opens a 400px confirm with the access spec's copy verbatim: "Turning this off locks {N} channels for everyone until it is turned on again. Nothing is deleted." `[Cancel]` and `[Turn off]` destructive.
  - Persists through `POST` / `DELETE /api/products/installations` (`ProductInstallation`), optimistic with revert, dispatching `workwrk:prefs-changed`.
  - The same switch renders on the `ModuleOff` screen for Owners and Admins so an admin never has to leave the thing they were trying to open. A module that is off renders its rail icon dim with a 6px "Off" dot **for Owners and Admins only**; nobody else sees the hub at all.

  **2. Rail apps**. One `TableCard`, rows 44, grouped into two labelled groups:
  - Group "Rail hubs" (the 8: Work, Planner, AI, Talk, Teams, Docs, Tables, Settings).
  - Group "Apps inside hubs" (the folded keys), each captioned "in {Hub} sidebar" so hiding Goals reads as removing a sidebar row, not deleting a feature.
  - Columns: drag handle (`Dots grip`), 20px app icon, name 15/500 plus the caption 13/400 `--os-ink-2`, **Who can see it** (a `Picker` select: **Everyone · Members with reports · Admins**, the access model's three floors, replacing "Everyone / Managers and up / HR and org admins / Org admins only"), **Show in rail** (`Switch`), and `↑` `↓` 28px ghost buttons as the keyboard and touch alternative to dragging.
  - `alwaysPinned` rows (Work, Settings) render the floor as text and no switch, with a 12/500 "Always available" `Chip`.
  - **Before a save that narrows access**, a 400px confirm: "{N} people lose access to {app}." with the count computed from `accessibleUsers` and a "See who" disclosure listing up to ten names. This is the graft that keeps a careless floor from locking a department out.
  - The caption "these settings are display only" is **deleted**, because floors and hides become real: `visibleApps` and `gatePage` read the same `APP_RULES` row, so a hidden app's routes lock, not just its icon (access rule 2). A one-time migration report lists orgs whose display-only config would now block someone, and the enforcement flip ships after a week of logged would-be denials.
  - Persists `OrgPreference.sidebarDefault.apps` (shape unchanged) through `PATCH /api/org/preferences`, per row, debounced 400ms, with the existing honest check that the response really contains the saved `apps` array. Only the changed row's controls disable while its write is in flight, never the whole table (today every control disables on every PATCH).

  **3. Automations**. One card: a `Switch` "Pause all automations" writing `settings.work.automationsPaused` (read by the automation runner) with the current run quota beside it ("{N} of {M} runs this month"), and three 14/500 text links: Health, Usage, Logs (`/automation/health`, `/usage`, `/logs`), which gives those orphan pages a door until the AI hub sidebar lists them.

  Footer, three text links, spelled exactly as the AI hub's APPS section spells them: "Build apps" → `/build`, "Marketplace" → `/store`, "Integrations" → `/integrations`. The first two are Owner and Admin, the same audience as this page. Integrations is the one row on the list every Member can open, so the link is not hidden here either; it simply never opens something this page's viewer lacks.
- **Side panel / drawer / modal**: the two confirms above. No drawer.
- **States**: loading, skeleton rows in the table shape. Empty: unreachable. Error: the app table falls back to the catalog with a toast today; instead the table is replaced by `ErrorState` with Retry, because a catalog fallback silently misrepresents the org's saved order. Read-only: n/a. Denied per §1.4.
- **Keyboard**: `↑` `↓` with the row focused move a row (the buttons are the same action); `Space` toggles "Show in rail"; drag is never the only way.
- **Data**: home `settings-architecture` §5.3. `GET` / `PATCH /api/org/preferences`; `GET` `POST` `DELETE /api/products/installations`; `GET /api/settings` for `automationsPaused` and the quota; **new** `POST /api/access/impact { app, floor }` returning `{ count, sample: [{id,name,avatar}] }` for the "N people lose access" preview, backed by `accessibleUsers`.
- **Realtime**: `workwrk:prefs-changed` so the rail updates for the admin immediately; other people's rails update on their next request.
- **What changes vs today**: `/settings/modules` folds in; one undifferentiated 30-row column becomes two labelled groups with captions; four legacy tier floors become the access model's three; display-only becomes enforced with a preview, a report and a logged week; the whole-table disable becomes per-row; the in-page breadcrumb and the 19px `#0073EA` h1 go; "Reset to default order" arrives; `ModuleDisabledScreen` stops sending admins to another page to flip one switch.
- **Open questions**: none. The enforcement flip is sequenced, not optional.

---

### `/settings/members`  (`src/app/(dashboard)/settings/members/page.tsx`)

- **Purpose**: everyone who works here, what they can do, and who they report to.
- **Who sees it**: Owner and Admin (full); People team (read-only chrome, people fields editable, per §1.4). Entry: sidebar row; Overview card; workspace menu › "Manage members"; workspace menu › "Invite people" → `?invite=1` opens the invite modal on load; org chart › "fix in Members" → `?filter=unlinked`; first-run step 2; admin tour step 2; Structure's four-role strip counters → `?filter=role:admin` and friends.
- **Top bar**: breadcrumb `… › Members`.
- **Secondary sidebar**: Members active.
- **Page header stack**: title "Members"; the **count strip** sits at the **right of the 48px title row**, not on a line of its own: five 13/400 items separated by "·" with the numbers at 500, "Owners 2 · Admins 4 · Members 38 · Guests 3 (free) · People team 2", each a link that applies the matching filter. Below 1120px it wraps under the title and the title row grows to 72. **Deviation, stated**: design system §4.4 rule 1 says no description line under the title. This is not a description; it is five live filter links that answer "how many Owners do we have" on the page that owns the answer, and putting them in the title row keeps the 48 / 36 / 44 stack intact at full width. Views row: four text-tab pills, **People · Guests · Teams · Pending invites**, `?tab=`, default `people`. These are server filter presets, never client state.

  **Toolbar, per tab.** Left on every tab: `Filter` and `Sort`. Right, the one blue button, which is a property of the tab (§1.7):

  | Tab | The one blue button | `Sort` orders (default first) | "…" square |
  |---|---|---|---|
  | People | `[+ Invite]` (36px, `Plus`), opens the invite modal | Name A to Z, Name Z to A, Role, Department, Job title, Status, Last active, Joined newest first | "Export members (CSV)" and "Import people (CSV)", both jumping to `/settings/data` |
  | Guests | `[+ Invite guest]`, the same modal with the role fixed to Guest, so an address inside the allowed domains is invited as a Guest too rather than flipped to Member. It renders only when access toggle 5 is not "Nobody"; when it is, the tab has **no** blue button and one 13/400 line above the card says "Guest invites are turned off in Access." with a text link | Name A to Z, Added by, Last active, Expires soonest | "Export guests (CSV)" |
  | Teams | `[+ New team]`, the 560px create modal | Name A to Z, Members most first, Lead | none; the square is absent rather than empty |
  | Pending invites | **none.** The Invite rules card below carries the tab's one blue button in its Save bar (§1.7 rule 1) | Sent newest first, Sent oldest first, Expires soonest, Email A to Z, Role | "Invite people", which switches to the People tab and opens the invite modal, and "Revoke all expired" |
- **Body layout**:

  **Filter side panel** (272px, inside the content, the table narrows with a 220ms tween): heading "Filter people by", a 36px search input, then 36px checkbox rows. On People: Role, Department, Office, Job title, Status, **No manager**, **People team**, **Inactive 30+ days**. On Guests: Added by, Shared on (a Space or List picker), Expiring in 30 days, Never signed in. On Teams: Lead, Has no members. On Pending invites: Role, Invited by, Status (Pending, Expired), Outside the allowed domains. Checking a row expands its value control beneath it. "Clear all" text link at the right of the heading when anything is active; "Save as view" is **not** offered here (settings lists have fixed tabs).

  **Tab: People**. `TableCard`, 44px rows, checkbox column visible at Comfortable, server cursor pagination, footer "Total members 42 · Guests 3" left and "1 to 50 ‹ ›" right.

  | Column | Content | Default |
  |---|---|---|
  | ☐ | row checkbox | on |
  | Person | 24px avatar, name 15/500, email 13/400 `--os-ink-2` beneath at Comfortable only; the cell is the drawer trigger; a 16px `ExternalLink` ghost on hover and always at Cozy opens `/people/[id]` | on |
  | Role | `Chip` with the role word from `labels.ts` | on |
  | Agent | a 6px dot plus "Agent" when true, blank otherwise | on |
  | Job title | text or "·" | on |
  | Department | name or "·" | on |
  | Reports to | name or "·" | on |
  | People team | a 18px checkbox, live for Owner and Admin | on |
  | Status | `StatusChip` pale: Active (neutral), Deactivated (danger) | on |
  | Last active | relative date, absolute on hover | on |
  | ⋯ | row menu | on |

  The column set and its order are access §6.2's, unchanged: Person, Role, Agent, Job title, Department, Reports to, People team, Status, Last active, row menu. **There is no Teams column**: team membership shows in the row drawer and on the Teams tab, which is the access spec's rule and also what keeps the row inside the content-height budget. Office is not a column either; it is a drawer field and a filter. The column-settings menu can hide any of the nine for the viewer, and all nine are on by default, so a fresh admin sees the whole answer.

  Inline header filter ("All ▾") on Person and on Role. Row menu: "Open profile", "Copy email", "Admin scopes…" (Admin rows, Owner only), "Deactivate", "Remove from workspace" (destructive ghost).

  **Row drawer**, 520px, own 48px header (avatar, name, "Open profile ↗", ✕), autosave per field with the inline tick. Fields, and who may write each one (the last column is where the same field is written by people who never open this door):

  | Field | Control | Persists | This door | Also written from Teams by |
  |---|---|---|---|---|
  | Role | select: Owner (offered only to Owners), Admin, Member, Guest | `User.orgRole` (mirrors `accessLevel` during the transition) via `PATCH /api/users/[id]` with a value whitelist; to or from Owner and self-demotion open a confirm naming the remaining Owners; last-Owner guard; the target's `tokenVersion` is bumped so it lands on their next request | Owner for Owner, Admin for the rest | nobody |
  | Admin scopes | two checkboxes, Billing and Security and integrations; visible on Admin rows only | `User.adminScopes[]` | Owner | nobody |
  | Agent | switch; visible on Member rows only; clears itself if the role changes away from Member; refuses if the person has reports ("Move {N} reports first") | `User.isAgent` | Owner, Admin | nobody |
  | People team | checkbox | `settings.access.peopleTeam` via `PATCH /api/settings { section: "access" }` | Owner, Admin | nobody |
  | Job title | picker over `Role` rows, with the seniority as a 12/400 hint that changes nothing | `User.roleId` | Owner, Admin | manager chain, People team at `/people/[id]` |
  | Department | picker | `User.departmentId` | Owner, Admin | same |
  | Office | picker | `User.officeId` | Owner, Admin | same |
  | Reports to | people picker over `GET /api/people/pick` (whole directory, never scoped by the caller's report tree), server-side cycle check, Agents excluded | `User.managerId` | Owner, Admin | People team at `/people/[id]` and `/organization` edit mode |
  | Dotted-line managers | multi people picker | `UserDottedLine` rows | Owner, Admin | manager chain, People team |
  | Weekly capacity | number input, blank means the org default, suffix "hours" | `User.weeklyCapacityHours` (new column) | Owner, Admin | manager chain, People team |
  | Status | `[Deactivate]` / `[Reactivate]` destructive-ghost | `User.status` | Owner, Admin | nobody; SCIM writes it unattended |
  | Danger | `[Remove from workspace]` destructive-ghost | `DELETE /api/users/[id]` | Owner, Admin | nobody |

  **Transfer dialog** (560px), opened by Deactivate and by Remove: lists the Spaces, Lists, Docs, Tables and open tasks the person owns with counts, and one transferee picker **preselected to their manager, else to the acting admin**, and the admin may pick anyone in the directory (access invariant 13 and §6.2, verbatim). The **unattended** paths are the ones that fall back to an Owner: SCIM deprovisioning and the retention cron use the person's manager, else the first Owner, because there is no acting admin to fall back to. The two paths are different on purpose and the dialog says so in one 13/400 line: "If this happens through your identity provider instead, their manager takes over." Remove additionally requires the person's name typed. Writes one `membership.changed` audit row naming the transferee. No object is ever left ownerless.

  **Bulk bar**, floating bottom-centre, 48px, white, appearing 150ms after the first checkbox: "3 selected", then ghost actions "Change department", "Add to team", "Deactivate", and ✕.

  **Tab: Guests**. Same card. Columns: Guest (avatar, name, email), Shared objects (a count that opens a popover listing them), Added by, Last active, Expires, ⋯ (menu: "Convert to Member" for Admins, consuming a seat; "Remove", which revokes every grant and transfers anything the Guest created inside a shared container **to that container's `ownerId`, and when the container has no live owner, to the removing Admin**, per access §2.3 and invariant 13, so the fallback can never end in nothing). Empty until the Guest tier lands: the quiet empty state with "No guests yet" and one line, "Guests are people outside your company who can only see what you share with them." Until then, Space email invites carry the honest copy "this creates a member account".

  **Tab: Teams**. Columns: Name, `@alias`, Lead, Members (count), Shared on (count with a popover). One blue `[+ New team]` in the toolbar for this tab, a 560px create modal (name, alias, lead picker, members picker). Ships with access step 4.

  **Tab: Pending invites**. Above the table, one **Invite rules** card (560px, Save bar, `section: "users"`). This tab's one blue button is that Save bar's `[Save changes]`, so the toolbar carries no primary while this tab is active; sending an invite from here is "Invite people" in the "…" square, which switches to the People tab and opens the modal. Fields:

  | Field | Default | Control | Persists | Enforced by |
  |---|---|---|---|---|
  | Allowed email domains | the org domain | chip input, seeded from `Organization.domain` | `settings.users.allowedDomains[]` | `POST /api/invitations` (already domain-locks), signup, SCIM, and the read-only mirror on Security › Sign-in policy |
  | Anyone with an allowed-domain email joins as a Member | off | switch | `settings.users.autoJoin` | the signup route |
  | Default role for invites | Member | select Admin · Member · Guest | `settings.users.inviteDefaultRole` | the invite modal preselect; an outside-domain address is always a Guest |
  | Add new members to these Spaces | none | multi picker over Spaces | `settings.users.defaultSpaceIds[]` | on accept, one Can edit grant per Space |
  | Invitation expiry | 7 days | number input | `settings.users.inviteExpiryDays` | invitation create |

  One caption line, not a control: "Members are invited by Owners and Admins. Guests can be invited by anyone with Full access on a Space, List or Doc." with a text link to Access. There is no "who can invite Members" select: it is a fixed rule (`org.invite_member`) and the ten toggles are the cap.

  Table columns: Email, Role, Invited to (the object, for Guest invites), Invited by, Sent, Expires, Status (`StatusChip`: Pending neutral, Expired warning), ⋯ (Resend, Copy link, Revoke).

  **Invite modal** (560px, opened by the blue button or `?invite=1`): a multi-email input (comma, space or newline separated, chips with per-row validation), Role select (Admin offered to Owners and Admins only; choosing Member reveals an "Agent (frontline caps)" checkbox), Department picker, Reports to picker, optional Job title picker. Rows whose address is outside the allowed domains flip to Guest automatically with a 13/400 caption beneath. Footer: `[Cancel]` ghost, `[Send invites]` primary.
- **Side panel / drawer / modal**: filter panel 272; row drawer 520; transfer dialog 560; invite modal 560; create-team modal 560; confirms 400. No stacked modals: the transfer dialog opens from the drawer only after the drawer's own confirm closes.
- **States**: loading, `TableCard` skeleton rows. Empty (People): unreachable, there is always the viewer. Empty (Guests, Teams, Pending): the quiet template with one sentence and one text link. Filtered empty: the inline "No results · Clear filters" row. Error: the card is replaced by `ErrorState` with Retry; the red banner goes. Read-only (People team): role, Agent, People team, scopes, status, `[+ Invite]`, `[+ Invite guest]`, `[+ New team]` and the Invite rules Save bar are absent, so this page has **no blue button at all** for them; job title, department, office, reports to, dotted lines and capacity stay live; the banner from §1.4 sits under the header. Denied, offline per §1.9.
- **Keyboard**: `↑` `↓` `Enter` `Space` per §1.10; `⌘Enter` in the invite modal sends.
- **Data**: home `settings-architecture` §5.5. `GET /api/users?scope=all&cursor=` (org-wide for anyone who can open the page, so the silent team-scope coercion at `api/users/route.ts:50-54` ends and cannot mislabel a team as the org); `PATCH /api/users/[id]` (per-field whitelist, `tokenVersion` bump, Owner guards); `DELETE /api/users/[id]` (moves from `isManager` to the page rule); `GET /api/people/pick?q=` for every picker; `GET` `POST` `DELETE /api/invitations`; `PATCH /api/settings { section: "users" | "access" }`; `GET /api/departments`, `/api/roles`, `/api/offices` for the pickers; Teams API with access step 4.
- **Realtime**: none. A role change lands on the target's next request because of the `tokenVersion` bump, so the UI never has to promise "at their next sign-in".
- **What changes vs today**: the team-scope mislabel ends; the 5-column overflowing table becomes a bordered card with a horizontal scroll of its own and a drawer for the rest; person rows link to profiles; department, office, job title, teams, status, People team and capacity arrive; the 500-row `<select>` with no search becomes the one picker; pagination arrives; SUPER_ADMIN never appears in a role select; the last-Owner rule is explained in the confirm instead of appearing as a 403 string; deactivation and removal stop leaving objects ownerless; the invite modal stops being the only way to learn the domain rules.
- **Open questions**: none here. Whether a Member may ever invite an in-domain Member is the access spec's D3 and is a one-value change to `org.invite_member`; this page has room for the caption line it would replace.

---

### `/settings/structure`  (`src/app/(dashboard)/settings/structure/page.tsx`)

- **Purpose**: the shape of the company: departments, job titles, offices, and where the org chart lives.
- **Who sees it**: Owner and Admin (full); People team (read-only chrome, Job titles editable, per §1.4). Entry: sidebar row; Overview card; first-run step 3; the org chart's "Org settings" link; `/settings/hierarchy` redirect (lands on `?tab=chart`).
- **Top bar**: breadcrumb `… › Structure`.
- **Secondary sidebar**: Structure active.
- **Page header stack**: title "Structure"; no subtitle. Views row: **Departments · Job titles · Offices · Org chart**, `?tab=`, default `departments`. Toolbar per tab: left `Filter` and `Sort` on the three list tabs; right one blue button per tab, `[+ New department]`, `[+ New job title]`, `[+ New office]`, and **no button** on Org chart.

  `Sort` orders, default first. Departments: Name A to Z, Name Z to A, Members most first, Head. Job titles: Name A to Z, People most first, Seniority, Created newest first. Offices: Name A to Z, City, Members most first.
- **Body layout**:

  **The four-role strip is the first element of the body**, below the toolbar, not a band between the title row and the views row: the design system's header stack is title 48, views 36, toolbar 44, then content, in that order, and nothing is inserted into it (§4.4). The strip is therefore a `wide` card at the top of the content column on all four tabs: 72px, bordered, five counters in a row, each a link that opens Members filtered ("Owners {N}", "Admins {N}", "Members {N}", "Guests {N}", "People team {N}"), one sentence under each number from `src/lib/access/labels.ts` at 13/400 `--os-ink-2` ("Runs the company account", "Runs the workspace", "Works here", "Outside your company, sees only what is shared", "Looks after everyone's people information"), and one 14/500 text link at the right, "How access works" → `/settings/access`.

  **Why it is here at all, and why it is not prose.** `settings-architecture` §5.6 puts the strip on this page, and that document owns settings structure, so it stays. Access §6.2 and §6.5 put the **full prose explainer** as card 1 of `/settings/access` and describe Structure as linking to it. Both hold at once because the two surfaces carry different things: Access carries the explanation, Structure carries the live counts plus one line each. Neither renders the other's content, so the "explainer exists twice" reading is closed by construction. The hand-written ten-rung ladder is deleted.

  **Tab: Departments**. The same component `/people/departments` renders, as a `TableCard`: Name, Head (avatar + name), Parent, Members (count), ⋯ (Rename, Change head, Move, Delete with a confirm naming where its people go). Create modal 560: Name, Head picker, Parent picker. Persists `Department` via `/api/departments` (gate: Owner and Admin).

  **Tab: Job titles**. The same component `/people/roles` renders as a `TableCard`: Name, Seniority (a `Chip`, display only), People (count), Created, ⋯ (Rename, Change seniority, Archive). The copy that claims the level controls access is deleted (`access-model` Broken #20): one caption under the title, "Job titles describe the work. They never change what someone can open." Persists `Role` via `/api/roles` (gate: Owner and Admin plus the People team, which is why this tab stays live for them).

  **Tab: Offices**. Real CRUD replacing the "Coming soon" tile: `TableCard` with Name, City, Country, Time zone, Headquarters (a single-select radio column), Members (count), ⋯ (Edit, Delete). Create and edit modal 560: Name, City, Country picker, Time zone picker, "This is the headquarters" checkbox. Persists `Office` via `/api/offices` (the model and API already exist).

  **Tab: Org chart**. Not an embed: one bordered card, 96px illustration (the cluster arrangement), one sentence "Your reporting lines live in the org chart, with the people directory beside them.", one 14/500 text link "Open the org chart" → `/organization` (canonical, cycle-safe, with an "Edit reporting lines" mode for Owner, Admin and the People team), and beneath it one live line: "No manager: {N} people · fix in Members" linking to `/settings/members?filter=unlinked`. One chart, one place.
- **Side panel / drawer / modal**: filter panel 272 on the three list tabs, heading "Filter {departments | job titles | offices} by", a 36px search input, then 36px checkbox rows. Departments: Head (people picker), Parent department, Empty (no members). Job titles: Seniority, Archived, Unused (nobody holds it). Offices: Country, Headquarters only, Empty (no members). Create and edit modals 560; delete confirms 400 (a department delete names where its people go, and never deletes people).
- **States**: loading, skeleton rows. Empty per tab: the quiet template, "No departments yet" / "No job titles yet" / "No offices yet", each with one text link that opens the same create modal as the blue button (the link is the second affordance, not a second primary). Error: `ErrorState` with Retry. Read-only (People team): Job titles stays live; Departments and Offices render as text with no row menus and no blue button; the banner sits under the header. Denied, offline per §1.9.
- **Keyboard**: per §1.10.
- **Data**: home `settings-architecture` §5.6. `GET` `POST` `PATCH` `DELETE /api/departments`, `/api/roles`, `/api/offices`; `GET /api/users?scope=all` for the counters and the "No manager" count; `GET /api/settings` for the People team list.
- **Realtime**: none.
- **What changes vs today**: the four tiles become four tabs with real content; Offices stops being a stub; the tier ladder prose goes; the bare `/account` link is fixed by the personal door's redirect; leaving the door to reach Functions and Roles stops (the same components render here, and the People hub keeps its own copies for the People team); the in-page breadcrumb and the 19px hex-icon h1 go; `/settings/hierarchy` folds in.
- **Open questions**: none.

---

### `/settings/access`  (`src/app/(dashboard)/settings/access/page.tsx`, new)

- **Purpose**: the handful of switches that decide how sharing works for the whole company, and one page that explains the model in plain words.
- **Who sees it**: Owner and Admin (full); People team (read-only). Entry: sidebar row; Overview card; `/settings/permissions` redirect; Structure's "How access works" link; Members › Invite rules caption link; admin tour step 3; the share dialog's "Who can do this" footer link for Admins.
- **Top bar**: breadcrumb `… › Access`.
- **Secondary sidebar**: Access active.
- **Page header stack**: title "Access"; subtitle "Who can create, share and invite. A small team never needs to change these." No views row. Toolbar: none. Every row autosaves, so there is no Save bar and **no blue button**; `[Lock it down]` is a secondary button inside card 3.
- **Body layout**: three cards in the 760px column, autosave per row with the inline tick, and an **"Enforced at: {route}"** tooltip on every row read from `ENFORCED_AT` so no row can go cosmetic the way 55 matrix cells did.

  **Card 1, How access works**: the access spec's §13 help copy as prose, 15/400 in the 720px reading measure, with the live counts inline (Owners, Admins, Members, Guests, People team) and two text links, "Manage people" → Members and "See who can open what" → the share dialog's Check access tab on any object. No illustration, no video slot.

  **Card 2, Access** (toggles 1 to 8, `settings.access.*`, one zod schema owned by `src/lib/access/settings.ts`). Each row is 48px minimum: label 14/500, one-line effect 13/400 `--os-ink-2`, control right.

  | # | Row label | Control | Default | Effect line |
  |---|---|---|---|---|
  | 1 | Who can create Spaces and Teams | select: Everyone · Admins only | Everyone | "Agents and Guests never create Spaces." |
  | 2 | New Spaces start as | select: Open to everyone as Can edit · Open as Can view · Private | Open as Can edit | "The person creating it can change this in Share." |
  | 3 | People can find Spaces they are not in and ask for access | switch | On | "They see the name and the owner, never the contents." |
  | 4 | People with Can edit can share | switch | On | "They can only share at their own level or below." |
  | 5 | Who can invite Guests | select: Anyone with Full access · Admins only · Nobody | Anyone with Full access | "Guests never use a paid seat." |
  | 6 | People team | people and department multi picker | empty | "They keep everyone's people information up to date and can look at Members, Structure, Access and Scoring." |
  | 7 | Who can publish SOPs and policies | select: Editors · Admins and the People team | Editors | |
  | 8 | Who can delete Spaces, Folders, Lists, Docs and Tables | select: Full access holders · Admins only | Full access holders | "Deleting always goes to Trash first." |

  **Card 3, Guests and links** (toggles 9 and 10): "Guest access expires after" (select Never · 30 days · 90 days, default Never) and "Public links" (select Off · View only, default Off, with the effect line "Anyone with the link can read. Never more than read."). Beneath the two rows, one secondary `[Lock it down]` button: a 560px confirm listing exactly what changes, row by row, with the current and new value side by side (toggle 2 to Private, 3 off, 5 to Admins only, 7 to Admins and the People team, 8 to Admins only, public links off, guest expiry 30 days), `[Cancel]` and `[Lock it down]`. Reversible row by row afterwards; writes one `access.preset.lockdown` audit row.

  **Legacy divider** (transitional, until access step 5 lands): an 11/600 uppercase "LEGACY" label with a rule, one 13/400 line "These are the only rules from the old permissions grid that are actually enforced. They become part of the model above.", then a small table of exactly **14 rows**, one per enforced cell, with the roles that exist in the transition (Owner, Admin, Member, Agent) as columns: `people.create`, `sops.create`, `sops.edit`, `sops.publish`, `sops.delete`, `policies.create`, `kras.create`, `kras.edit`, `kras.delete`, `kras.assign`, `assets.create`, `assets.edit`, `assets.delete`, `announcements.create`. Every other cell of the old matrix is gone on day one, and each org's stored matrix is written into one `access.matrix_retired` audit row and offered as a one-time download on Data › Export.

  **Open access requests**, last: when any are open, a 44px row "Open requests ({N})" linking to the Inbox filter that lists them. Not rendered at zero.
- **Side panel / drawer / modal**: the Lock it down confirm 560; the People team picker is a `Picker` popover with search.
- **States**: loading, skeleton rows. Empty: n/a. Error: `ErrorState` with Retry. Read-only (People team): every switch and select renders as its value in text, the People team row lists the members as avatars, `[Lock it down]` is absent, the banner sits under the header. Denied, offline per §1.9.
- **Keyboard**: per §1.10; `Space` toggles a focused switch.
- **Data**: home `settings-architecture` §5.7. `GET` `PATCH /api/settings { section: "access" }`, schema and defaults from `src/lib/access/settings.ts`; `GET /api/people/pick` for the People team picker; `GET /api/access/requests?status=open` for the count; `ENFORCED_AT` for the tooltips; `GET /api/audit?type=access.*` is not read here (the Audit page owns it). `/api/permissions` and `Organization.settings.permissions` are deleted.
- **Realtime**: none; a toggle change applies on the next `can()` call, which is every request.
- **What changes vs today**: a 16-module, ~100-capability, 10-column checkbox matrix in which 55 of 75 cells did nothing becomes ten switches with an enforcement point named on each; the black `accent-zinc-900` checkboxes go; the silent loss of dirty edits goes (nothing is dirty, everything autosaves); the PPMS-out-of-scope modules in the matrix (Assets, Tools, Surveys, Ideas, Announcements, Policies) stop being presented as configurable; the People team becomes a named thing instead of an HR rung.
- **Open questions**: none. The ten toggles are the cap; an eleventh is an access-spec decision.

---

### `/settings/tasks`  (`src/app/(dashboard)/settings/tasks/page.tsx`, new)

- **Purpose**: what a task can be: its types, its tags, and the templates people start from.
- **Who sees it**: Owner and Admin. Entry: sidebar row; Overview card; the board "…" menu's "Manage types" link beside its own default-type select; the create-task modal's type-picker footer (Admins only, hidden otherwise); `/settings/task-types` and `/settings/tags` redirects.
- **Top bar**: breadcrumb `… › Task system`.
- **Secondary sidebar**: Task system active.
- **Page header stack**: title "Task system"; no subtitle. Views row: **Task types · Tags · Templates**, `?tab=`, default `types`. Toolbar: left `Filter` (Tags tab only, rows Type and Archived) and `Sort`; right the one blue button per tab, `[+ New type]`, `[+ New tag]`, and **no button** on Templates.

  `Sort` orders, default first. Task types: Name A to Z, Name Z to A, Used by most first, Built-in first, Created newest first. Tags: Name A to Z, Used on most first, Created newest first. Templates has no `Sort` (it is two rows and a link card, not a list).
- **Body layout**:

  **Tab: Task types**. `TableCard`: Icon (20px), Name (singular, 15/500) with the plural 13/400 beneath, Built-in or Custom (`Chip`), **Default** (a single-select radio column, one row only), Used by ("{N} lists"), ⋯ (Rename, Change icon, Set as default, Delete for custom types only, with a confirm naming how many tasks carry it and what they become). Above the card, one 13/400 caption: "{N} of 20 custom types used." Create and edit modal 560 on the shared `ui/dialog` (the hand-rolled `fixed inset-0` overlay is deleted): singular name (16 chars), plural (16 chars), description (100 chars), and an icon grid with search. A **"Recommended types" drawer** (360px, opened by the 14/500 text link "Browse recommended types" beside the caption) lists the library with per-row `[Add]`, a 36px search field and category chips; it is a drawer so it never competes with the table for width. **Its close affordance and close target, because §1.5's row-drawer rule does not cover it**: the drawer has its own 48px header with the title "Recommended types" 16/600 and a 32px ghost ✕ at the right; ✕, `Esc` and a click outside all close it back to the Task types tab at the same URL, with focus returned to the text link that opened it and any type added while it was open already in the table behind. It is the one drawer in this unit with **no `?row=`**, deliberately: there is no single record to link to, so a URL would promise a deep link that means nothing. The list behind it does not dim, because nothing is being edited. Persists `ItemType` via `/api/item-types*`, **which gain the settings gate they never had**; the org default writes `settings.work.defaultItemTypeId`.

  A 13/400 line under the card: "A List can have its own default type. Set it in the List's ••• menu." A List's own default is object-scoped (`Board.settings.defaultItemTypeId`) and is never edited here.

  **Tab: Tags**. The body is `tags-manager.tsx`, moved to `src/app/(dashboard)/settings/tasks/tags-manager.tsx` and restyled on `--os-*` tokens, rendered as a `TableCard`: Colour (a 16px swatch from the eight user hues), Name 15/500, Type (`Chip`), Used on ("{N} items", from `_count.assignments`), Archived (`StatusChip`), ⋯ (Rename, Change colour, Archive, Delete with a confirm naming the item count). Create modal 560: name, type select, colour from the eight hues. Persists `Tag` via `/api/tags*` against the real `{ type, _count.assignments }` shape. The page that fabricated ten SAMPLE tags, sent a `category` the API ignores, and never called `DELETE` is deleted outright, and with it the two sequential `prompt()` dialogs. `useToast` in the manager becomes `useOsToast`.

  **Tab: Templates**. One bordered link card, not a second builder: 96px illustration (the stack arrangement), "Templates live in the Template Center." and one 14/500 text link "Open the Template Center" → `/templates?scope=workspace`. Plus one 44px row: "Default task type for new lists: {type}" with a picker writing `settings.work.defaultItemTypeId`, which is the same value the Task types tab's Default column sets, shown here because this is where an admin looks for it.

  Beneath it, one bordered card answering the two things an admin coming from Monday, ClickUp or Workday looks for on this page and does not find (`settings-pages` §4, "should exist but does not"): **statuses** and **custom fields**. Title "Statuses and fields", one 15/400 line, "Both belong to a List, so each team can run its own way: open a List, then its ••• menu › Statuses or Fields.", one second line, "A List template carries both, so a company-wide default is a template you apply.", and one 14/500 text link "Open the Template Center" → `/templates?scope=workspace&type=list`. **No controls**: this unit does not build a workspace statuses manager or a workspace custom-fields manager, because a second editor for object-scoped data is a second source of truth. The owning unit is **spaces-lists** (the List ••• menu) with the Template Center as the workspace-level answer, and §0 records the deferral with that owner. The card is a real answer at the place the question is asked, not a "coming soon" row.
- **Side panel / drawer / modal**: Recommended types drawer 360; create and edit modals 560; delete confirms 400; filter panel 272 on Tags.
- **States**: loading, skeleton rows. Empty (Types): unreachable, built-ins always exist. Empty (Tags): the quiet template, "No tags yet", one sentence "Tags are labels you can put on anything and filter by." and one text link that opens the create modal. **Never SAMPLE data, in any state, including an API error.** Error: `ErrorState` with Retry. Read-only: n/a. Denied, offline per §1.9.
- **Keyboard**: per §1.10; `Enter` in the create modal saves.
- **Data**: home `settings-architecture` §5.8. `GET` `POST` `PATCH` `DELETE /api/item-types` and `/api/item-types/[id]` (all four gain `requireCan("manage", { type: "settings", page: "tasks" })`); `GET` `POST` `PATCH` `DELETE /api/tags` and `/api/tags/[id]`; `PATCH /api/settings { section: "work" }` for the default type.
- **Realtime**: none; the create-task modal re-reads types on open.
- **What changes vs today**: the fabricated tag page is deleted and the correct manager is finally rendered; task types gain authorisation at the page and at all three API verbs; the hand-rolled modal becomes `ui/dialog`; hover-only card actions become a visible row menu, which also fixes touch; the `OsTitleBar` with its dead trio and amber star goes; the two pages become one with three tabs, and both old URLs keep working.
- **Open questions**: none.

---

### `/settings/scoring`  (`src/app/(dashboard)/settings/scoring/page.tsx`)

- **Purpose**: how often people are reviewed, what a score is made of, and what the bands mean.
- **Who sees it**: Owner and Admin (full); People team (read-only). Entry: sidebar row; Overview card (one card now, not three); a link from `/reviews` for Admins.
- **Top bar**: breadcrumb `… › Scoring & reviews`.
- **Secondary sidebar**: Scoring & reviews active.
- **Page header stack**: title "Scoring & reviews"; subtitle "How reviews run and how scores are worked out." No views row (the four sections are cards, not tabs, because an admin sets them together). Toolbar: none; each section owns its own Save bar region, and the page-level sticky Save bar saves whichever sections are dirty in one request per section.
- **Body layout**: four cards, 760px column, each with its own dirty state and its own "Reset to defaults" ghost in the card header (a confirm names what returns to what).

  Every card names its reader, per §1.8, because a scoring number nothing consumes is exactly the "settings that do nothing" failure this refresh is correcting. Where a named reader is not wired by the end of S3, that card ships behind "Show upcoming features" with "Not enforced yet" until it is, and the verification is one grep per key in the S3 review.

  1. **Review cadence**: four rows, Weekly, Monthly, Quarterly, Annual. Each row: a `Switch`, an anchor control (day of week, day of month, month of quarter, month of year) as a `Picker`, "Remind {N} days before" as a number input, and an "Open the cycle automatically" checkbox. Persists `settings.reviewCadences`. **Read by** the review-cycle opener: the `/reviews` launch action, which offers the next due cycle and its dates, and the cadence cron row in `scripts/CRON-SETUP.md` that opens a cycle when "Open the cycle automatically" is on and sends the "Remind {N} days before" notification.
  2. **Score weights**: four rows, KPI, SOP compliance, Behavioural, Peer, each a slider plus a number input, and a live "Total {N}%" line that turns `--os-danger-text` with the words "Must add up to 100" when it does not. Save is refused while the total is not 100, with the error on the total line, not in a toast. Persists `settings.scoreWeights`. **Read by** the review scoring engine that computes a person's score on `/reviews/[id]` and on their profile, and by the talent grid at `/talent`, which plots the same number on its performance axis. The legacy `{kpi, manager, peer, self, sopCompliance}` shape migrates on read to these four keys, which is why the Overview card can stop printing a vocabulary this page does not edit.
  3. **Performance bands**: an **add and remove** row list (today it is a fixed five). Each row: a label input, a min and a max number input, and a colour select over the **semantic set only** (Success, Warning, Danger, Info, Neutral) rendered as a pale `StatusChip` preview, plus a 28px ghost ✕. `[+ Add band]` ghost row last. Bands must not overlap; an overlap is a field error on the offending row. Persists `settings.scoringBands`. **Read by** the band renderer, which is one helper with three call sites: the score chip on a review, the score line on `/people/[id]`, and the cell labels of the 9-box at `/talent`. This replaces a `<input type="color">` fed colour **words** ("green", "lime") from the API defaults that it cannot render.
  4. **Behavioural anchors**: five label inputs. Rendered **only under "Show upcoming features"**, disabled, captioned "Coming soon: the review form does not read these yet." The values are kept, not deleted.

  Footer, outside the cards: one 14/500 text link "Open the talent grid" → `/talent`, so the 9-box keeps a door from settings.
- **Side panel / drawer / modal**: the "Reset to defaults" confirm 400.
- **States**: loading, skeleton cards (not the bare "Loading…" string). Empty: n/a. Error: the form is replaced by `ErrorState` with Retry; no blank-form save. Read-only (People team): every input renders as text, the sliders as a labelled bar, no Save bar, no Reset, the banner under the header. Denied, offline per §1.9.
- **Keyboard**: `⌘Enter` saves the focused section; arrow keys move a focused slider in steps of 1, `Shift` plus arrow in steps of 5.
- **Data**: home `settings-architecture` §5.16. `GET /api/settings`; `PATCH /api/settings { section: "scoring" }`, one request per dirty section, never two sequential PATCHes.
- **Realtime**: none.
- **What changes vs today**: the black `bg-zinc-900` Save becomes the brand primary; bands can be added and removed and their colours are values the control can render; unsaved edits are guarded instead of silently lost; there is no read-only-by-403 path any more because nobody who cannot edit can open the page, except the People team who get the proper read-only rendering; the bare "Loading…" string, the `OsTitleBar` and the third back pattern ("‹ Back to settings") all go; the `C.pink / C.purple / C.indigo` icon tint names go with the colour sweep.
- **Open questions**: whether the People team should be able to **edit** cadences, since they run the cycles. This spec gives them read here and the launch action at `/reviews`, per the access spec §9. Changing it is one `gate` value.

---

### `/settings/security`  (`src/app/(dashboard)/settings/security/page.tsx`, new)

- **Purpose**: how people sign in to this workspace.
- **Who sees it**: Owner, or an Admin holding the `security` scope. Every other Admin: the `AdminOnly` card naming the Owners. People team, Member, Agent and Guest: the Ask-an-admin strip over My settings › Profile at this URL (§1.4); never a 404. Entry: sidebar row (with a lock glyph for Admins without the scope); Overview card; My settings › Security's "Workspace sign-in policy" text link, which renders only for Owners and `security` Admins.
- **Top bar**: breadcrumb `… › Security`.
- **Secondary sidebar**: Security active.
- **Page header stack**: title "Security"; subtitle "How people sign in to {Org}. Changes apply at their next sign-in." Views row: **Sign-in policy · Single sign-on · Provisioning**, `?tab=`, default `signin`. Toolbar: none; Sign-in policy and Single sign-on are Save-bar tabs, Provisioning is a list with one blue `[+ Generate token]`.
- **Body layout**:

  **Tab: Sign-in policy** (Save bar, `section: "security"`). Nothing on this tab is described as already wired; today only `src/lib/password-policy.ts` reads `Organization.settings.security`, `src/lib/auth.ts` hard-codes `maxAge: 12h` and `updateAge: 30m` and gates MFA on `process.env.ENFORCE_MFA_AT_LOGIN`, and `src/lib/login-throttle.ts` is an in-process `Map` with `MAX_FAILS = 8` and `LOCK_MS = 15 min` and no org lookup. Every row below names the reader that makes it true.

  | Card | Field | Default | Control | Persists | Read by |
  |---|---|---|---|---|---|
  | Passwords | Minimum length | 8 | number input, 8 to 64 | `settings.security.minPasswordLength` | `password-policy.ts` at signup, invite accept, reset and change-password (wired today) |
  | Passwords | Require an uppercase letter | on | switch | `.requireUppercase` | same |
  | Passwords | Require a number | on | switch | `.requireNumbers` | same |
  | Passwords | Require a symbol | off | switch | `.requireSymbol` (new key) | same |
  | Passwords | Password expires after | 0, meaning never | number input with the helper "0 = never" | `.passwordMaxAgeDays` | the credentials `authorize` compares `User.passwordChangedAt` (new column, written by every password write) and signs in with a `mustChangePassword` claim; `src/proxy.ts` then allows only `/account/security?change=1` and the sign-out route |
  | Sessions | Signed out after being idle for | 720 minutes | number input, 30 to 1440 | `.sessionIdleMinutes` (replaces the stale `sessionTimeout` display value of 30 that nothing reads) | the `jwt` callback stamps `idleUntil` on each refresh and returns `null` past it; NextAuth's static `maxAge` stays 12h as the ceiling and the org value can only narrow it |
  | Sessions | Signed out after | 30 days | number input | `.sessionMaxDays` | the same callback, comparing the token's `iat` |
  | Two-factor | Require two-factor for | Admins | segmented control: **Nobody · Admins · Everyone** | `.mfaRequired` (replaces the boolean `twoFactorEnabled`, migrated on read: `true` → `everyone`) | `authorize` loads the org policy after the password verifies; in the audience and enrolled means the code is required (today's path); in the audience and not enrolled means sign-in succeeds with a `mustEnrolMfa` claim and `proxy.ts` allows only `/account/security?enrol=1`. `ENFORCE_MFA_AT_LOGIN` stays the env floor: false turns every audience into "enrolled users only", exactly today's behaviour. "Everyone" includes Guests |
  | Two-factor | (live value, not a field) | | one 13/400 line "{N} of {M} admins enrolled" with a text link that opens Members filtered | | |
  | Failed sign-ins | Lock the account after | 8 attempts | number input | `.lockoutThreshold` | `recordLoginFailure(key, policy)` and `loginLockRemaining(key, policy)` take the policy as an argument; `authorize` resolves the user row by email before recording a failure, so the org policy is known for a real account and unknown emails use the defaults |
  | Failed sign-ins | for | 15 minutes | number input | `.lockoutMinutes` | same |
  | Sign-in domains | Allowed domains | the org domain | **read-only** chips with one 14/500 text link "Manage in Members › Invite rules" | mirror of `settings.users.allowedDomains` | login |
  | Danger zone | Sign everyone out | | `[Sign out all devices]` destructive, 400px confirm requiring "SIGN OUT" typed, with the line "Everyone, including you, signs in again." | **new** `POST /api/org/sign-out-everyone`, bumping `tokenVersion` for every user; audit `security.sign_out_all` | |

  The defaults are the code's current constants, so shipping the editor changes nothing on day one.

  **Tab: Single sign-on** (Save bar). SAML over `IdentityProvider`: Enabled switch, Issuer, Sign-in URL, Sign-out URL, Certificate (textarea), an attribute map (four rows: email, first name, last name, department), a "Create accounts on first sign-in" switch (JIT), and `settings.security.ssoEnforced` ("Require SSO: people cannot sign in with a password", with the line "Owners keep a password path, and every use of it is logged"). Beside it, a read-only service-provider card (ACS URL, metadata URL, entity ID) with copy buttons. **The whole tab renders only under "Show upcoming features"** until the SAML login route is verified end to end; without the preference the tab is not in the tab row at all. An "Enterprise" `Chip` sits beside the tab label when it is shown.

  **Tab: Provisioning**. `TableCard` of SCIM tokens: Name, Prefix, Created by, Created, Last used, Expires, ⋯ (Revoke, with a confirm). Blue `[+ Generate token]` opens a 560px modal (name, expiry) and then a reveal-once dialog with a copy button and a `[Done, I have saved it]` confirm; the token is never shown again. Above the table, a read-only card with the SCIM base URL and a copy button. Persists `ScimToken` via `/api/scim-tokens` (exists). Below the table, one card stating the rules in plain words, because they are load-bearing: "People created by your identity provider arrive as Members. Owner, Admin and Agent are set here, never by the provider. An address outside your allowed domains is refused. Removing someone there deactivates them here and moves what they owned to their manager." A SCIM deprovision that would remove the last Owner is refused and appears in the Audit log.
- **Side panel / drawer / modal**: generate-token modal 560; reveal-once dialog 560; revoke confirm 400; sign-out-everyone confirm 400.
- **States**: loading, skeleton cards. Empty (Provisioning): the quiet template, "No provisioning tokens yet", one sentence, one text link that opens the same modal. Error: the form is replaced by `ErrorState` with Retry. Read-only: n/a; there is no read tier on this page. Denied: the `AdminOnly` card naming Owners, which is the common case for an Admin without the scope, so its copy is written for that ("Security is managed by workspace Owners. Ask {names} if you need this changed."). Offline per §1.9.
- **Keyboard**: `⌘Enter` saves; the typed confirmations accept `Enter` only when the text matches.
- **Data**: home `settings-architecture` §5.9. `GET` `PATCH /api/settings { section: "security" }`; `GET` `POST` `DELETE /api/scim-tokens`; `GET /api/users?scope=all&filter=admins` for the enrolment count; **new** `POST /api/org/sign-out-everyone`; `IdentityProvider` CRUD behind the upcoming-features flag. New column `User.passwordChangedAt`.
- **Realtime**: none. A policy change lands on each person's next token refresh, which the subtitle states.
- **What changes vs today**: this page does not exist. The Overview cards that sent admins to a **read-only** personal page to "configure" password policy and session and 2FA now point here; the read-only Workspace policy card on `/account/security` is retired in favour of this editor, with the rules a Member actually needs printed inline under their own Password and Two-factor rows.
- **Open questions**: none. The SSO tab stays hidden until a verified end-to-end SAML sign-in exists; shipping it earlier recreates exactly the surface-without-backend failure the audit found on `/settings/calendar`.

---

### `/settings/data`  (`src/app/(dashboard)/settings/data/page.tsx`)

- **Purpose**: get your data out, bring data in, decide how long things are kept, and find what was deleted.
- **Who sees it**: Owner and Admin; the retention purge rows and the one-time matrix download are Owner only. Entry: sidebar row; Overview card; `/settings/import-export` redirect; the Access page's "download the previous permissions grid" link; `/trash`'s "Retention settings" link.
- **Top bar**: breadcrumb `… › Data`.
- **Secondary sidebar**: Data active.
- **Page header stack**: title "Data"; no subtitle. Views row: **Export · Import · Retention & privacy · Trash**, `?tab=`, default `export`. Toolbar: none on Export, Retention and Trash. On Import, right, **one button and one only**, `[Import {N} people]`, which renders in the toolbar once a file is staged and `N` is known, and is absent before that (a disabled primary is never rendered, design system §0.11 and §5.4). Before a file is chosen the tab's own card carries `[Choose file]` as a secondary button, which is not a primary and does not compete. There is no second button after the staging grid.
- **Body layout**:

  **Tab: Export**. One card of rows, 48px each: label 14/500, a 13/400 line ("Everything in this workspace as a ZIP", "Every person with their department, title and manager"), "Last exported by {name}, {relative date}" 13/400 `--os-ink-2` when there is one, and a `[Download]` secondary button at the right that shows the `Dots pending` glyph while the blob is fetched. Rows: Full workspace (ZIP), People (CSV), Timesheets (CSV), Audit log (CSV). Under a **"Legacy"** divider, Purchase orders (CSV) and Invoices (CSV), rendered **only when the org actually holds one or more `PurchaseOrder` or `Invoice` rows**: finance is outside the product scope, but an org's own data stays downloadable. After access step 8, one more legacy row: "Previous permissions grid (JSON)", a one-time download of the retired matrix.

  Below, a **Recent exports** `TableCard`: When, Who, What, Size, from the `data.exported` audit rows each download writes. Empty until the first export, with the quiet template.

  **Tab: Import**. The `/imports` hub content rendered here (the route keeps working and gains the door breadcrumb): one card per importer. **People (CSV)** is the only live one: `[Choose file]` as the card's secondary button, then a staging grid (a `TableCard` of the parsed rows with a per-row status chip and inline fixes) and a "{N} rows will be created, {N} skipped" line. The action itself is the toolbar's `[Import {N} people]` described in the header stack above, and it exists once: the card never repeats it. Competitor importers (ClickUp, Monday, Asana, Trello) render **only under "Show upcoming features"**, disabled, captioned "Coming soon". Below, an **Import history** `TableCard`: When, Who, What, Rows, Result. Ships only after a real run of `/api/people/bulk-import`, which has no caller today.

  **Tab: Retention & privacy**. Autosave rows.

  | Row | Default | Control | Persists | Reader |
  |---|---|---|---|---|
  | Keep deleted items in Trash for | 60 days | number input, suffix "days" | `settings.retention.trashDays` | the purge cron, added as one row to `scripts/CRON-SETUP.md` in the same change |
  | Keep the audit log for | 365 days | number input | `settings.retention.auditDays` | the same cron |
  | People can export their own data | on | switch | `settings.data.selfExport` | `/api/me/export` |
  | AI features for everyone | on | switch | `settings.data.aiEnabled` | the AI entitlement resolver |
  | Consent and data requests | | the wired rows of the orphan `components/settings/privacy-controls.tsx` (consent record, data subject export, erase request) | `settings.data.privacy.*` | the DSR routes |
  | Bring your own AI key | off | the orphan `byok-manager.tsx` flow | `OrgSecret` | **rendered only for orgs with the Enterprise `byok` flag**; the API page's AI keys tab is the same surface and links here |

  The two retention rows render **only together with the purge cron that reads them**; until that cron row exists they are behind "Show upcoming features" with "Not enforced yet".

  **Tab: Trash**. One bordered link card: 96px illustration (the stack arrangement), "Deleted Spaces, Lists, Docs and tasks wait here for {N} days.", one 14/500 text link "Open Trash" → `/trash` (which is also a Work hub sidebar row for every Member, scoped to what they could delete), and one live line "{N} items in Trash".
- **Side panel / drawer / modal**: the import staging grid is a 960px modal at 90vh when the file has more than 50 rows, and inline otherwise; delete and purge confirms 400 with typed confirmation for anything org-level.
- **States**: loading, skeleton rows. Empty (Recent exports, Import history): the quiet template with one sentence. Error: per card, `ErrorState` with Retry; a failed download shows a toast naming the reason (the existing 401, 403, 503 and zero-byte guards are kept and their messages surfaced, not swallowed). Read-only: n/a. Denied, offline per §1.9.
- **Keyboard**: per §1.10.
- **Data**: home `settings-architecture` §5.10. the existing export routes (full ZIP, people, timesheets, audit, PO, invoices); `GET /api/audit?type=data.exported` for Recent exports; `POST /api/people/bulk-import`; `GET` `PATCH /api/settings { section: "retention" | "data" }`; `GET /api/trash?count=1`. Every download writes `data.exported`; every import writes `data.imported`.
- **Realtime**: none.
- **What changes vs today**: `/settings/import-export` folds in and the two hubs for one job become one page; the finance exports stop being presented to orgs that have no finance data; retention finally exists, with its cron; the export log answers "who took a copy of this"; the orphan privacy and BYOK components get their home; the `OsTitleBar` with its dead trio goes.
- **Open questions**: none. Webhooks and the competitor importers ship only after an end-to-end run; that sequencing is in §4, not a question.

---

### `/settings/audit`  (`src/app/(dashboard)/settings/audit/page.tsx`)

- **Purpose**: what happened in this workspace, who did it, and what changed.
- **Who sees it**: Owner and Admin. Entry: sidebar row; Overview card; the Data page's "Audit log (CSV)" export row; the API page's footer link.
- **Top bar**: breadcrumb `… › Audit log`.
- **Secondary sidebar**: Audit log active.
- **Page header stack**: title "Audit log"; no subtitle. Views row: **All · Access · Security · Data · Settings**, mapped to server-side type families, `?tab=`, default `all`. Toolbar: left `Filter` and `Sort` (Newest first, Oldest first); right one bordered "…" square holding "Export (CSV)" and "Retention settings" (→ Data). **No blue button**: nothing is created here.
- **Body layout**:
  - A 36px search input sits at the **left of the toolbar row, before `Filter`**, 320px, placeholder "Search events", debounced 300ms and sent to the server as `?q=` (today it filters only the 100 rows already in memory). **Deviation, stated**: design system §4.4 keeps the toolbar left for Filter, Sort, Group and the view switcher and puts search on the top bar. Inside a door the top-bar search is the settings filter and cannot also search events (`spec-shell.md` §2.8), so this page needs a field of its own, and the toolbar is the only row in the stack that takes controls. It is the one page in this unit that carries one, because it is the one page whose rows are text rather than named records.
  - **Filter side panel** (272px): Type (checkbox rows built from `GET /api/audit/types`, the whole set, not the types that happened to appear on the first page), Actor (a searchable people picker), Severity (Info, Warning, Critical), Date range (Today, 7 days, 30 days, 90 days, Custom).
  - `TableCard`, 44px rows: **Time** (absolute on hover, relative in the cell, `tnum`), **Actor** (20px avatar plus name; "API key {prefix}", "Agent {name}" or "System" with a 16px glyph when `actorType` is not `user`), **Event** (the human sentence from the event map, never the raw key), **Target** (the object name, a link when it still exists), **Severity** (pale `StatusChip`). Footer: "Total events {N}" and "1 to 50 ‹ ›" with cursor pagination.
  - **Row click opens a 520px drawer**: the human sentence 16/600, then Time, Actor (with `actorType` and `actingFor` when a key or an agent did it), IP and user agent when recorded, Target with a link, and a **before and after** block rendering the `oldValue` → `newValue` diff the API already returns, as two columns of key and value with changed keys at 500 weight. Footer: "Copy event ID".
  - The four KPI tiles are **deleted**: the "Today" tile counted only the rows in view, which is a statistic that lies.
  - Export honours **every active filter, including the actor** (today it honours type and range only).
- **Events the rebuild writes**, so the Access tab is not empty: `org_role.changed`, `access.granted`, `access.changed`, `access.revoked`, `access.request.created`, `access.request.granted`, `access.request.declined`, `access.preset.lockdown`, `membership.changed`, `visibility.changed`, `settings.updated.{section}` (exists), `security.policy.updated`, `security.sign_out_all`, `data.exported`, `data.imported`, `permissions.updated` (transition only), `access.matrix_retired`, and `access.denied` sampled once per viewer per target per 10 minutes. Every row carries `actorType`.
- **Side panel / drawer / modal**: filter panel 272; row drawer 520.
- **States**: loading, skeleton rows. Empty: the quiet template, "No events yet". Filtered empty: the inline "No results · Clear filters" row. Error: `ErrorState` with Retry. Read-only: n/a (reading is the whole page). Denied, offline per §1.9.
- **Keyboard**: `↑` `↓` move, `Enter` opens the drawer, `Esc` closes it; `⌘F` focuses the search field.
- **Data**: home `settings-architecture` §5.12. `GET /api/audit?cursor=&q=&type=&actor=&severity=&from=&to=` (the tier check moves from `isManager` to the page rule); **new** `GET /api/audit/types`; `GET /api/audit-log/export` with every filter.
- **Realtime**: none. A "{N} new events" pill appears at the top of the card when a poll (60s, only while the tab is visible and the first page is showing) finds newer rows; clicking it prepends them. Never auto-scrolls.
- **What changes vs today**: rows become clickable and carry the diff the API already returns; search moves to the server; type chips come from the whole set; export stops ignoring the actor filter; the misleading KPI tiles go; the `OsTitleBar` and its nav-link chips go; the legacy BEM `.adt` styling is replaced by `TableCard`.
- **Open questions**: none.

---

### `/settings/api`  (`src/app/(dashboard)/settings/api/page.tsx`)

- **Purpose**: keys and hooks for anything that talks to WorkwrK from outside.
- **Who sees it**: Owner, or an Admin holding the `security` scope; an Admin without it gets the `AdminOnly` card, and everyone else gets the Ask-an-admin strip over My settings › Profile (§1.4). Entry: sidebar row (lock glyph for Admins without the scope); Overview card; `/settings/integrations` redirect; the Audit page's footer link.
- **Top bar**: breadcrumb `… › API & webhooks`.
- **Secondary sidebar**: API & webhooks active.
- **Page header stack**: title "API & webhooks"; subtitle "Keys and hooks for anything that connects to {Org}." Views row: **API keys · Webhooks**, plus **AI keys** only for orgs with the Enterprise `byok` flag. Toolbar: left `Filter` and `Sort`; right one blue button per tab, `[+ Generate key]`, `[+ New webhook]`, and **no button** on AI keys (its card owns `[Test connection]` and `[Remove]`, both secondary).

  `Filter` panel rows, 272px. API keys: Scope (Read, Write, Admin), Status (Active, Revoked), Created by, Unused for 90 days. Webhooks: Status (Active, Failing, Disabled), Event. `Sort` orders, default first. API keys: Created newest first, Last used newest first, Name A to Z, Status. Webhooks: Last delivery newest first, URL A to Z, Status.
- **Body layout**:

  **Tab: API keys**. One 44px warning row above the card, `--os-warning-bg`, 16px `TriangleAlert`, 13/400: "A key acts as the person who made it and never gets more than they have. Revoking a key takes effect immediately." `TableCard`: Name 15/500, Prefix (mono 13px with a copy button), Scopes (`Chip`s: Read, Write, Admin), Rate limit ("{N}/min · {N}/day"), Last used (relative, with the absolute date on hover), Created by, Status (`StatusChip`: Active, Revoked), ⋯ (Edit rate limits, Revoke). A "Hide revoked keys" checkbox in the column-settings menu, **on by default**, so revoked keys stop accumulating in the list forever. Row click opens a 520px drawer with the name, the rate-limit inputs (editable, autosave), the scopes rendered as text with the line "Scopes cannot be changed after a key is made. Make a new key instead.", the creator, and `[Revoke]` destructive-ghost. Generate dialog 560 (name, three scope cards with their blurbs), then a reveal-once dialog with a copy button and `[Done, I have saved it]`. Persists `ApiKey` via `/api/keys`.

  **Tab: Webhooks**. `TableCard`: URL (truncated, copy button), Events (`Chip`s), Status (Active, Failing, Disabled), Last delivery (relative plus the response code), ⋯ (Send test, Disable, Delete). Create modal 560: URL, an event multi-select, and a reveal-once signing secret. A failing hook's row shows the last error in its drawer with the last five deliveries. Persists `WebhookSubscription` via `/api/webhooks` (the route directory exists). **This tab renders only after an end-to-end delivery has been verified**; until then it is absent from the tab row, not present and broken.

  **Tab: AI keys** (Enterprise `byok` flag only). The wired `byok-manager.tsx` flow: provider select, key input (write-only, shown as `••••` after saving), `[Test connection]`, `[Remove]`. Persists `OrgSecret`.

  Footer under every tab: one 14/500 text link **"Integrations"** → `/integrations`, the canon label (`naming-canon` §2.13), never "Browse the app marketplace", which named a third thing. The page is kept, not folded into Connections: it is the AI hub's APPS row that every Member can browse and request from, and only connecting is Owner and Admin. `/automation/connections` is a different page with a different audience and is not linked from here.
- **Side panel / drawer / modal**: row drawers 520; generate and create modals 560; reveal-once dialogs 560; revoke and delete confirms 400.
- **States**: loading, skeleton rows. Empty: the quiet template plus one text link that opens the same generate dialog as the blue button. Error: `ErrorState` with Retry (today an inline warning row). Read-only: n/a. Denied: the `AdminOnly` card naming Owners. Offline per §1.9.
- **Keyboard**: per §1.10.
- **Data**: home `settings-architecture` §5.13. `GET` `POST` `DELETE /api/keys`, `PATCH /api/keys/[id]` for rate limits; `GET` `POST` `PATCH` `DELETE /api/webhooks`; `OrgSecret` routes for AI keys. All on the page rule (Owner or `security`).
- **What changes vs today**: the page gains a server gate instead of an "Admins only" notice over a reachable page; rate limits become editable; revoked keys are hidden by default; the four KPI tiles, the `OsTitleBar` dead trio and the BEM `.apk__nav-link` chips go; `/settings/integrations` folds in and the circular hub-of-hubs (Integrations → Calendar stub → Integrations) is gone.
- **Realtime**: none.
- **Open questions**: none.

---

### `/settings/billing`  (`src/app/(dashboard)/settings/billing/page.tsx`)

- **Purpose**: what this workspace is on, what it is using, and how to change it.
- **Who sees it**: Owner, or an Admin holding the `billing` scope; an Admin without it gets the `AdminOnly` card, and everyone else gets the Ask-an-admin strip over My settings › Profile (§1.4). Entry: sidebar row (lock glyph); Overview card; workspace menu › "Upgrade"; the rail's "Upgrade" link, which now points here and renders only for Owners and `billing` Admins on non-Enterprise plans; a "Custom branding is on Enterprise" link from Identity.
- **Top bar**: breadcrumb `… › Plan & billing`.
- **Secondary sidebar**: Plan & billing active.
- **Page header stack**: title "Plan & billing"; no subtitle. Views row: **Plan · Invoices**, and the Invoices tab renders only when Stripe invoices are reachable. Toolbar: none.

  **Which button is blue, in three cases, so an engineer never has to choose.** This page can show a plan card and a plan comparison at once, and only one of them is ever the primary:

  | Case | The one primary | Everything else |
  |---|---|---|
  | Stripe portal configured (the normal case) | `[Manage billing]` in the plan card | every `[Choose {plan}]` in the comparison is **secondary**, including the recommended one; changing plan goes through the portal |
  | Stripe portal not configured, checkout is | `[Choose {plan}]` on the recommended card | the plan card shows the mailto line and no button |
  | Neither configured | none. The page has zero blue buttons | the plan card shows the mailto line; the comparison section is absent |
- **Body layout**:
  1. **Plan card**: plan name 16/600 with a `StatusChip` (Trial warning, Active success, Past due danger), the renewal or trial-end date 13/400, and at the right either `[Manage billing]` primary (opening the Stripe portal through `POST /api/billing/portal`) or, **when Stripe is not configured**, one 14/400 line "Billing is handled by our team. Email billing@workwrk.com" with a `mailto:` link. Never a button that returns a 503.
  2. **Usage card**: four rows, each a label, a 4px linear progress bar, and "{used} of {limit}": Members (Guests excluded, with "Guests are free" as the helper), Guests (the soft cap, shown as "{N} of {M} guest seats" only when a cap is set; passing it never blocks), Storage, AI queries **this billing period** (today the bar counts `aiQueries` rows for all time while the Overview card claims the period).
  3. **Plan comparison**, rendered only when `POST /api/billing/checkout` exists: three bordered cards with the feature lines and one `[Choose {plan}]` per card. Their treatment follows the table above: **secondary on every card whenever `[Manage billing]` renders**, and primary on the recommended card only in the case where `[Manage billing]` does not. Until checkout exists this section is absent, not a disabled table.
  4. **Invoices tab**: `TableCard` of Date, Number, Amount, Status, Download. Absent when unreachable.
- **Side panel / drawer / modal**: none; the Stripe portal is a redirect out and back.
- **States**: loading, skeleton cards. Empty: n/a. **Error: `ErrorState` with Retry**, which fixes the permanent "Loading billing…" a failed fetch produces today. Read-only: n/a. Denied: the `AdminOnly` card naming Owners. Offline per §1.9.
- **Keyboard**: per §1.10.
- **Data**: home `settings-architecture` §5.14. `GET /api/billing` (plan, status, usage, limits); `POST /api/billing/portal`; `POST /api/billing/checkout` when it exists; `PLAN_LIMITS` in `src/lib/plan-limits.ts`, which gains a `guests` column so guests can be counted without being charged.
- **Realtime**: none.
- **What changes vs today**: `useToast` becomes `useOsToast`, ending the two-toast-systems split in this subsystem; the AI usage bar becomes period-scoped; the permanent loader on failure becomes a retryable error; the Upgrade entry points land on a page that has an upgrade path or an honest sentence instead of a 503.
- **Open questions**: none.

---

### `/settings/all`  (`src/app/(dashboard)/settings/all/page.tsx`, new)

- **Purpose**: every workspace setting on one page, so an admin can find one by name.
- **Who sees it**: Owner and Admin (the rows are filtered by each page's gate, so an Admin without a scope sees those pages' rows marked "Owners only" and cannot follow them into an editor). Entry: the last sidebar row; the Overview search's "See all settings" footer link; `⌘K`.
- **Top bar**: breadcrumb `… › All settings`.
- **Secondary sidebar**: All settings active.
- **Page header stack**: title "All settings"; subtitle "{N} settings across {N} pages." No views row. Toolbar: a 36px search field only (it filters the list in place). No blue button.
- **Body layout**: generated from the registry, grouped by sidebar group and then by page. Each page is an 11/600 uppercase heading with a rule and a 14/500 link to the page; beneath it, one 32px row per `SettingEntry`: the field label 15/400, the tab name 13/400 `--os-ink-2` at the right, the whole row a link to `href` (which includes the `?tab=` and the `#anchor`, so arriving scrolls the card into view and pulses its border once). **No controls of any kind on this page**: it is an index.
- **Side panel / drawer / modal**: none.
- **States**: loading, skeleton rows. Empty: unreachable. Filtered empty: the inline "No results · Clear search" row. Error: `ErrorState` with Retry (the registry is local, so the only failure is the page-gate fetch). Read-only: n/a. Denied, offline per §1.9.
- **Keyboard**: `⌘K` or `⌘/` focuses the search; `↓` into the list; `Enter` opens.
- **Data**: home `settings-architecture` §5.17. `src/lib/settings-registry.ts` and `SETTINGS_PAGES`; no fetch beyond the session.
- **Realtime**: none.
- **What changes vs today**: this page does not exist; today a setting can only be found by remembering which of twenty-one rows it was under.
- **Open questions**: none.

---

### Redirect routes

Ten URLs stay addressable and render nothing of their own, and an eleventh (`/imports`) joins them at S5. Each is a 308 in `next.config.ts` (permanent, not one release) and its route file is deleted. The template headings are answered once for all of them, each one filled rather than merged, then each URL states its target, the entry points that still point at it, and what a person who had it bookmarked experiences.

- **Purpose**: keep every bookmark, email link and hard-coded path in the code working while the destination moves.
- **Who sees it**: anyone who had the old URL. The redirect happens before the gate, so the gate then runs on the **target** page and the viewer sees that page's normal outcome: the full page, the `AdminOnly` card for an Admin without the scope, or the Ask-an-admin strip over My settings › Profile for everyone else. Never a 404 (§1.4). A redirect therefore leaks nothing about the target, because every viewer reaches it and the target decides.
- **Top bar**: none of its own. The navy bar paints once, already showing the **target's** breadcrumb; the old label never appears in a crumb.
- **Secondary sidebar**: none of its own. The settings list paints with the **target's** row active, so a redirect never flashes a row that is about to change.
- **Page header stack**: none of its own. The target's title row, views row and toolbar are the first header stack drawn.
- **Body layout**: none. The URL has no body; the browser is at the target before paint. Where the target is a tab or an anchor, the `?tab=` or `#hash` is part of the redirect target, so arrival is on the right tab with no second navigation.
- **Side panel / drawer / modal**: none.
- **States**: none of its own. The target owns all six. The one exception worth naming: a signed-out person hitting an old URL is sent to `/login?callbackUrl=<old URL>`, and after signing in the 308 runs, so they land on the target rather than on the login page's default.
- **Keyboard**: none.
- **Data**: none. The redirect is static configuration in `next.config.ts`, not a server component, so it costs no round trip and no database read.
- **Realtime**: none.
- **What changes vs today**: each of these is a page today, and each one's entry points move in the same change (the per-URL "entry points" line below names them, file by file).
- **Open questions**: none.

Each URL below is one route block. Every heading above applies to it unchanged; only the target, the entry points and the arrival differ. "Entry points" lists what still points at the old URL today and is repointed in the same commit; the redirect is the net underneath, not the plan.

#### `/settings/modules`  (`src/app/(dashboard)/settings/modules/page.tsx`, deleted)
308 to `/settings/apps#modules`. Arrival: Apps & modules, scrolled to the Modules section with its card border pulsed once. Reason: two module cards did not earn a page, and the switch also renders on the `ModuleOff` screen.
- **Entry points repointed in the same commit**: the settings list row (deleted), the Overview card (now Apps & modules), `module-disabled.tsx`'s "Manage modules" link, `command-palette.tsx`'s Settings group entry, and the `SETTINGS_PAGES` alias row, which keeps `/settings/modules` resolving to the `apps` page key so the sidebar highlight is right during the redirect.

#### `/settings/tags`  (`src/app/(dashboard)/settings/tags/page.tsx` and `layout.tsx`, deleted)
308 to `/settings/tasks?tab=tags`. Arrival: Task system on the Tags tab, showing real tags from `/api/tags`, never the ten SAMPLE rows. `tags-manager.tsx` moves to `settings/tasks/tags-manager.tsx` and is finally rendered.
- **Entry points repointed**: the settings list row (deleted), the Overview card, the tag picker's "Manage tags" footer link on task detail and board filters, and `command-palette.tsx`.

#### `/settings/task-types`  (`src/app/(dashboard)/settings/task-types/page.tsx`, deleted)
308 to `/settings/tasks?tab=types`. Arrival: Task system on the Task types tab, now gated at the page and at all three API verbs.
- **Entry points repointed**: the settings list row (deleted), the Overview card, `board-more-menu.tsx`'s "Manage types", `create-task-modal.tsx`'s type-picker footer (Admins only), and `command-palette.tsx`.

#### `/settings/defaults`  (`src/app/(dashboard)/settings/defaults/page.tsx` and `layout.tsx`, deleted)
308 to `/settings/identity?tab=appearance`. Arrival: Identity & culture on the Appearance defaults tab, with no accent row on either side of the door and locks that really grey the personal rows.
- **Entry points repointed**: the settings list row (deleted), the Overview card, the Customize panel's "Set defaults for everyone" link, `/account/preferences`'s "Set by your workspace" lock helper, and `command-palette.tsx`.

#### `/settings/hierarchy`  (`src/app/(dashboard)/settings/hierarchy/page.tsx`, deleted)
308 to `/organization`. Arrival: the one org chart, in the Teams hub, in the normal shell with the rail and the hub sidebar. Leaving the door is intended: the chart is a work surface, not a setting. Structure › Org chart links to the same place as a link card, so `/settings/structure?tab=chart` still lands somewhere real, and the chart carries the "Edit reporting lines" mode the Teams unit builds. **Settled cross-unit against the access spec**, which named `/settings/structure?tab=chart`: a redirect target is settings structure, so `settings-architecture` §7.1 and §8.4 own it. The access unit carries the one-line change.
- **Entry points repointed**: the settings list row (deleted), the Overview Structure card, `org-chart-client.tsx`'s "Org settings" link, `admin-setup-checklist.tsx` step 3, `tour-content.tsx`, and the Teams hub sidebar row.

#### `/settings/permissions`  (`src/app/(dashboard)/settings/permissions/page.tsx`, deleted)
308 to `/settings/access`. Arrival: the explainer, the ten toggles, Lock it down, and the fourteen still-enforced legacy rows under a Legacy divider until access step 5. The stored matrix is downloadable once from Data › Export.
- **Entry points repointed**: the settings list row (deleted), the Overview card, Structure's "How access works" link, the share dialog's "Who can do this" footer link for Admins, `tour-content.tsx` step 3, and `command-palette.tsx`.

#### `/settings/import-export`  (`src/app/(dashboard)/settings/import-export/page.tsx`, deleted)
308 to `/settings/data?tab=import`. Arrival: Data on the Import tab, where the real exports already lived on the sibling tab.
- **Entry points repointed**: the settings list row (deleted), the Overview card, the Members "…" square's "Import people (CSV)" and "Export members (CSV)" rows, and `command-palette.tsx`.

#### `/settings/integrations`  (`src/app/(dashboard)/settings/integrations/page.tsx`, deleted)
308 to `/settings/api`. Arrival: API & webhooks, whose footer carries the "Integrations" link to `/integrations`, the page that is kept and moves to the AI hub's APPS section for every Member. The circular hub-of-hubs is gone; the catalogue is not.
- **Entry points repointed**: the settings list row (deleted), the Overview card, the `/integrations` marketplace page's "Settings" nav-link (deleted outright with `OsTitleBar`), the Tools and Assets pages' "Settings" chips (deleted), and `command-palette.tsx`.

#### `/settings/notifications`  (`src/app/(dashboard)/settings/notifications/page.tsx`, deleted)
308 to `/account/notifications`, the reverse of today's redirect. Arrival: My settings › Notifications, the same switches under the personal door plus quiet hours, mute-until, the muted list and desktop. The org-defaults section of `/api/settings` is retired because nothing reads it.
- **Entry points repointed**: `profile-menu.tsx`'s Notifications row, the bell popover's "Notification settings" link, every notification email footer, and `command-palette.tsx`.

#### `/settings/calendar`  (`src/app/(dashboard)/settings/calendar/page.tsx`, deleted)
308 to `/account/connections`. Arrival: My settings › Calendar & connections, where the real per-user Google Calendar connect, the calendar picker and the ICS token live. The Planner banner's success redirect becomes `/account/connections?connected=google` and is read rather than ignored.
- **Entry points repointed**: the settings list row (deleted), the Planner connect banner and its `?connected=` return URL, the Timesheets "sync my calendar" link, `profile-menu.tsx`, and `command-palette.tsx`.

#### `/imports`  (`src/app/(dashboard)/imports/page.tsx`, deleted at S5)
308 to `/settings/data?tab=import`, and only at S5, when the Import tab exists. Arrival: Data on the Import tab, with the People (CSV) importer that was the page's only working content. Until S5 this URL is not a redirect at all: it renders inside the takeover through `SETTINGS_ROUTES` with the Data row active and the breadcrumb `Settings › Workspace settings › Data › Import` (§0, `spec-shell.md` §2.8). The 308, the `SETTINGS_ROUTES` entry, the Data row's `alsoActiveOn` entry and the `ROUTE_HUB` row are one commit, so the two specs can never be half-applied.
- **Entry points repointed**: the Data page's Import tab itself, the Members "…" square's "Import people (CSV)", the first-run card, and any `/imports` link in `command-palette.tsx`.

Two more redirects in the same change belong to the personal door and are listed for completeness because this unit's links point at them: `/account` → `/account/profile` (which fixes the Structure page's 404 link) and `/account/appearance` → `/account/preferences?tab=appearance`. Two query-string redirects come from the avatar menu: `/settings?tab=themes` → `/account/preferences?tab=appearance` and `/settings?tab=shortcuts` → `/account/shortcuts`.

The redirects are the net, not the plan: every hard-coded settings path in `profile-menu.tsx`, `workspace-menu.tsx`, `click-app-rail.tsx`, `command-palette.tsx`, `board-more-menu.tsx`, `create-task-modal.tsx`, `module-disabled.tsx`, `org-chart-client.tsx`, `admin-setup-checklist.tsx`, `tour-content.tsx`, the Planner connect banner and the Tools, Assets and Integrations pages is updated in the same change.

---

## 3. Shared components this unit introduces or requires

Everything else comes from `design-system.md` §5 unchanged (`TableCard`, `FilterPanel`, `Picker`, `Chip`, `StatusChip`, `Button`, `SegmentedControl`, `Switch`, `Dialog`, `Dots`, `AutosaveIndicator`, `OsEmptyView`, `Kbd`, `Tooltip`, `EntityTile`, `BackButton`). The list below is what this unit adds or needs changed.

| Name | Lives in | Props | Used by |
|---|---|---|---|
| `SettingsShell` (changed) | `src/components/layout/os/settings-shell.tsx` | `{ door: "me" \| "workspace"; children }` | every `/settings/*` and `/account/*` route. Renders the 48px takeover bar ("← Back to app" 32px ghost left, nothing at the right: no Close ✕, per §1.5), the 264px N50 list with 20px row icons with its filter field, and the content area. Below 900px the list becomes a "Pages" select in the bar. Reads `SETTINGS_PAGES` for its rows; holds no role logic of its own. |
| `SettingsPage` | `src/components/settings/settings-page.tsx` | `{ pageKey, tabs?, primary?, secondaryMenu?, children }` | every page in §2. Renders the title row from `SETTINGS_PAGES[pageKey].label`, the optional text-tab pills wired to `?tab=`, and the toolbar with the one primary and the bordered "…" square. Enforces "one blue button per page" by construction: `primary` is a single node. |
| `SettingsCard` | `src/components/settings/settings-card.tsx` | `{ title, description?, danger?, wide?, children, id? }` | every form page. Bordered card, radius 8, **24px padding**, at most five fields, 16px between fields, 24px between cards, **560px wide** (design system §5.4); `wide` is the only escape and takes the full 760 column for the nine table-bodied and row-list cards named in §1.7. `danger` swaps the border to `--os-danger-border` and the title to `--os-danger-text`. `id` is the hash anchor and owns the one-time 150ms border pulse. A lint test asserts no page passes `wide` outside that list. |
| `SettingsRow` | `src/components/settings/settings-row.tsx` | `{ label, helper?, control, savedAt?, readOnlyValue?, lock?, enforcedAt? }` | every autosave row. 48px minimum, label 14/500 and helper 13/400 left, control right, the 12/500 "Saved ✓" tick that fades after 2s, the `Lock` glyph with "Set by your workspace", the "Enforced at: {route}" tooltip, and the `readOnlyValue` that replaces the control entirely in read-only mode so no disabled control is ever rendered. |
| `SaveBar` | `src/components/settings/save-bar.tsx` | `{ dirty, saving, onDiscard, onSave }` | Identity, Locale, Members › Invite rules, Security, Data › Retention, Scoring. 56px sticky, appears only when dirty, one request per section, disabled while saving with the `Dots pending` glyph in the primary. |
| `useDirtyGuard` | `src/hooks/use-dirty-guard.ts` (a shared hook, not settings-only) | `(isDirty: boolean) => void` | every Save-bar page here, and outside the doors the form builder and the automation workflow builder, which track dirty state today and guard nothing. |
| `useSettingsSection` | `src/hooks/use-settings-section.ts` | `(section) => { status, data, error, retry, save }` | every form page. Implements the fetch-failure rule once: on a failed GET it returns `status: "error"` and the page renders `ErrorState` instead of the form, so Save can never overwrite live values with empty strings. |
| `AdminOnly` | `src/components/access/admin-only.tsx` (access unit owns the family) | `{ page, owners, scope }` | the gate, for **one** case: an Admin on an Owner-only page without the scope. Renders inside the Workspace door at the unchanged URL with `BackButton{fallbackHref="/settings"}`. One member of `LockedPage` / `ModuleOff` / `AppOff` / `AdminOnly` / `AskAnAdminStrip`. This unit supplies the copy and the page icon; the access unit owns the component. |
| `AskAnAdminStrip` | `src/components/access/ask-an-admin-strip.tsx` (access unit owns the family) | `{ pageLabel, admins }` | the gate, for every other denied viewer: a Member, Agent or Guest on any Workspace page, and the People team on a page outside their four. A 44px `--os-brand-soft` strip rendered **above My settings › Profile**, inside the My settings door, at the Workspace URL the person typed. No `BackButton` (the page under it is a destination), no disabled controls, and no 404 anywhere under `/settings/*` (access §5.5 item 3, `spec-shell.md` §2.8). |
| `ErrorState` | `src/components/ui/error-state.tsx` | `{ title?, message, onRetry, details? }` | every route here. The wired-Retry replacement for `OsEmptyView cta="Retry"` with no handler. Shared with every other unit. |
| `settings-registry` | `src/lib/settings-registry.ts` | `SettingEntry[]` and `findSettings(q)` | the sidebar filter, the Overview search, `/settings/all`, the `⌘K` Settings group. No gate field. |
| `settings-nav` | `src/lib/settings-nav.ts` | `openSettings(href)`, `closeSettings()` | every inbound link in the app and the takeover's "← Back to app" and `Esc` (there is no ✕). |
| `preferences-locks` | `src/lib/preferences-locks.ts` | the five lock dot-paths | Identity › Appearance defaults (the only writer of `lockedKeys`), My settings › Preferences and the Customize panel (the readers that grey a row). |
| `accents` | `src/lib/accents.ts` | the read-time normaliser, no list and no picker | nothing renders it: it exists only so a stored accent, org or personal, resolves to `workwrk` until the column is dropped. Deleted outright when the design system's token sweep lands. |
| `SETTINGS_PAGES` | `src/lib/access/settings.ts` (access unit owns the file) | `{ door, key, label, href, group, icon, gate, aliases, tabs }` per page | the gate, the sidebar, the breadcrumb, the registry, `⌘K`. This unit supplies the label, href, group, icon, aliases and tabs columns; the access unit owns the `gate` column. One table, two concerns, one file. |

---

## 4. Migration and build notes

Order follows `settings-architecture.md` §12 (S0 to S7) and names the access-track dependency for each step. Every step ships alone and leaves the product working.

| Step | Ships | Blocked on |
|---|---|---|
| **S0 Chassis** | `SETTINGS_PAGES` label, href, group, icon, alias and tab columns; `settings-registry.ts` plus its unit test; `SettingsShell door=`; `SettingsPage` / `SettingsCard` / `SettingsRow` / `SaveBar`; `settings-nav.ts` and `OsShell.lastAppPath`; `useDirtyGuard`; `useSettingsSection`; `ErrorState`; `.strict()` on `/api/preferences` and every `/api/settings` section; `accents.ts` and `preferences-locks.ts`; the fifteen redirects that ship at S0 and every hard-coded path updated (`/imports` is the sixteenth and waits for S5, §0); deletion of `OsTitleBar`, in-page breadcrumbs, nav-link chips and "‹ Back to settings" inside both doors; `SettingsSidebar` deleted and its five rows re-parented; the lint rule against `router.push("/today")` in settings chrome. | nothing. Can start immediately and in parallel with access steps 0 to 2. |
| **S1 Door gate** | `settings/layout.tsx` calling `gatePage("view", { type: "settings", page })`; the six per-route layouts and the Structure lock card deleted; both denial views (the `AdminOnly` card for an Admin without a scope, the Ask-an-admin strip over My settings › Profile for everyone else, and no 404 anywhere under `/settings/*`) plus the People team read rule; the rail Settings hub's `defaultHref` from the per-viewer landing table in §1.1; every org write API on the page rule; C_LEVEL's `/api/settings` write removed; `PATCH /api/users/[id]` on the per-field table; `/api/item-types*` gated at last. Runs its **first week with `SETTINGS_GATE_LOG_ONLY=true`**, logging every would-be denial, so the customer who relied on a manager or a C_LEVEL reaching a page is found in a log, not a ticket. | access step 0 (the engine) and step 1 (the wrappers). If access slips, S1 can ship with a temporary `orgRoleOf(accessLevel)` inside `src/lib/access/settings.ts`, still the one allowed directory, and swap later. |
| **S2 Personal door** | owned by the My settings unit. Listed here because this unit's cross-links point at it. | S0 |
| **S3 Workspace re-parents** | Overview, Identity & culture (absorbing Defaults), Locale & work week, Apps & modules (absorbing Modules, with the `ModuleOff` switch and the dim Off icon), Task system (rendering `tags-manager`, gating item types), Structure (four-role strip, Offices CRUD, the chart link card), Data (tabs, Legacy divider, export log), Audit (tabs, drawer, server search, `/api/audit/types`), API & webhooks (keys tab only), Plan & billing, Scoring, `/settings/all`; the Access page in its transitional form (explainer plus the fourteen legacy rows); the setup checklist and the tour re-pointed. | S1 |
| **S4 Members** | one additive SQL file applied with `prisma db execute` (`User.weeklyCapacityHours`, `User.presenceStatus`, `User.presenceUntil`; `migrate dev` is broken by drift on this project); Members as list plus drawer plus filter panel plus cursor pagination, with the role whitelist, the Owner guards, the `tokenVersion` bump, the transfer dialog, Last active, `?filter=unlinked` and the Invite rules card; every picker on `GET /api/people/pick`. Every reader tolerates a missing column so the code can land before the migration. | S3; access step 3 for the pick endpoint and the Owner guards. |
| **S5 New editors** | Security › Sign-in policy fully wired (`password-policy.ts` gains symbol and max age with `User.passwordChangedAt`; `login-throttle.ts` takes the policy as an argument; `auth.ts` gains the `idleUntil` and `iat` checks and the MFA audience with `mustEnrolMfa`; `proxy.ts` gains the enrolment and change-password holds; the env stays the floor); Sign everyone out; the Provisioning tab with the SCIM rules; Retention & privacy **with its purge cron row added to `scripts/CRON-SETUP.md` in the same change**; Identity › Danger zone; Branding and BYOK behind their Enterprise flags. Webhooks and the Import tab ship only after a real end-to-end run; the Import tab's commit is also the one that 308s `/imports` and deletes its `SETTINGS_ROUTES`, `alsoActiveOn` and `ROUTE_HUB` entries together (§0); the SSO tab stays behind "Show upcoming features" until a verified SAML sign-in exists. | S3. Verify `ENFORCE_MFA_AT_LOGIN=true` with org `mfaRequired = "admins"` against an un-enrolled Admin **and** an enrolled Member before shipping. |
| **S6 Access surfaces** | `/settings/access` with the ten toggles, Lock it down and the Enforced-at tooltips; Members › Guests and Teams tabs, the People team column and the Admin scopes menu; the Owner and Admin split switched on (`SETTINGS_OWNER_SPLIT=true`) **after the access pre-flight report names each org's Owner and the founder approves**; the `/settings/permissions` redirect made final; the matrix exported to `access.matrix_retired` and offered on Data › Export. | access steps 4 and 5. |
| **S7 Enforcement flips** | rail floors and hides become real gates, with the "N people lose access" preview, the one-time migration report and a week of logged would-be denials first; the unenforced matrix cells gone for good; `route-guard.ts` and the 25 hand-copied tier lists deleted. | S6; access steps 6 to 8. |

**Can ship independently of every other unit**: S0, S3 (except the parts that read access counts), S5. **Blocked on the access unit**: S1, S4, S6, S7. **Blocked on the shell unit**: the takeover frame changes in S0 (rail and bar stay mounted, `lastAppPath`, the `LayerStack` Esc order) land in the shell's step 3; until then `SettingsShell` keeps unmounting the rail and the only visible difference is the breadcrumb.

**Data migrations**, all of them small:
- One additive SQL file: `User.weeklyCapacityHours Int?`, `User.presenceStatus String?`, `User.presenceUntil DateTime?`, `User.passwordChangedAt DateTime?`. Applied with `prisma db execute` on prod, confirmed with `prisma db pull`.
- Read-time migrations, no write: `settings.security.twoFactorEnabled: true` → `mfaRequired: "everyone"`; `settings.fiscalYearStart: "04-01"` → `4`; the legacy `scoreWeights` five-key shape → the four keys the page edits; every `data-accent` value, not only the purple family → `workwrk`, since the row that set them is gone; `OrgPreference.densityDefault` unset → Comfortable.
- One-time writes, each with a dry-run report before it runs: stored user-status hexes remapped to the eight hues; `Organization.settings.permissions` written into one `access.matrix_retired` audit row and then deleted; every localStorage key in `settings-architecture` §7.3 read once on next sign-in and written to its server key (presence, mute-until, quick tools, sidebar width and collapsed, desktop notifications, saved filters, workload capacity), then the key is removed.
- `settings.notifications` (org defaults) is retired: the section is removed from the API and nothing reads it. The stored object is left in place rather than deleted, so re-adding the card later with its reader loses nothing.

**Sequencing risks to respect**: do not ship the Apps enforcement flip (S7) before its logged week; do not ship the Security tab (S5) before the MFA matrix is verified against a real un-enrolled Admin; do not ship the Owner and Admin split (S6) before the pre-flight report is approved, because today every COMPANY_ADMIN can open Billing; do not ship Webhooks, Import or SSO before an end-to-end run, because a visible form over an unverified backend is the exact failure this refresh is correcting.

---

## 5. Checklist against the audit

`settings-pages.md` §2, one line each.

| # | Status |
|---|---|
| 1 Tags page fabricates SAMPLE data | resolved by `/settings/tasks` › Tags, which renders `tags-manager.tsx` against the real `{ type, _count.assignments }` shape; the fabricating page is deleted and no state, including an API error, ever shows invented rows |
| 2 Task types have no authorisation | resolved by §1.4 (the one gate) and `/settings/tasks`, where all four `/api/item-types*` verbs gain `requireCan("manage", { type: "settings", page: "tasks" })` |
| 3 `OsTitleBar` dead trio on settings pages | resolved by §0 and §1.1: `OsTitleBar` is removed from both doors; the takeover header is the only chrome |
| 4 Overview self-links | resolved by `/settings`, where every card links to its own page and no card links to `/settings` or leaves the door |
| 5 Security cards send admins to a read-only page | resolved by `/settings/security`, the editor that did not exist; the Overview cards point here |
| 6 Seven of twenty-one routes gated | resolved by §1.4: one gate in one layout from one page table, with the six per-route layouts and the inline lock card deleted |
| 7 Scoring has no read-only mode | resolved by §1.4: nobody who cannot edit can open it, except the People team, who get the access spec's read-only rendering with no disabled controls |
| 8 Back, Close and Esc always go to `/today` | resolved by §1.5: one exit affordance ("← Back to app", no Close ✕) plus `Esc`, both through `closeSettings()` with `returnTo`, then `lastAppPath`, then `/today`, and a lint rule against the hard-coded push |
| 9 Identity layout, page and API disagree on C_LEVEL | resolved by §1.4: C_LEVEL no longer exists and the stray `/api/settings` write is removed |
| 10 Avatar-menu dead rows | resolved by §0's redirect table and the shell unit's avatar menu: Themes becomes an inline segmented control, Shortcuts opens `/account/shortcuts`, Notifications opens `/account/notifications` |
| 11 "Upgrade" lands on Overview | resolved by `/settings/billing`, which the rail and workspace-menu links now target, with an honest state when Stripe is not configured |
| 12 Calendar, Integrations and Import-export stubs | resolved by §0: Calendar moves to the personal door where its real per-user backend is, the **settings** Integrations hub folds into API & webhooks while the catalogue at `/integrations` is kept for every Member, Import-export folds into Data |
| 13 Accent vocabulary drift | resolved by deletion: the design system's token sweep removes the ten `data-accent` blocks, so the Default accent row goes with them (tie-break 4) and `src/lib/accents.ts` shrinks to the one-value normaliser that rewrites every stored accent, purple family included, to `workwrk` on read |
| 14 Two org charts | resolved by `/settings/hierarchy` → `/organization` and Structure › Org chart as a link card to the same place |
| 15 Locale lists and fiscal representation | resolved by `/settings/locale`: full IANA and ISO lists, a numeric fiscal month, and the language value finally read by `src/i18n/request.ts` |
| 16 Members team-scope mislabel, overflow, no profile links | resolved by `/settings/members`: org-wide data because the page is gated by role, a bordered card that scrolls inside itself, profile links, and the drawer for everything the table cannot hold |
| 17 Checklist and tour targets | resolved by `/settings`'s first-run card (four steps, data-derived ticks, correct targets) and the tour re-pointed to Identity, Members and Access |
| 18 Bare `/account` link 404s | resolved by the `/account` → `/account/profile` redirect |
| 19 Loader mix | resolved by §1.9: the rail-logo route loader plus skeletons everywhere; no `Loader2`, no "Loading…" string in this unit |
| 20 Error states without recovery | resolved by §1.9 and `ErrorState`: every error has a wired Retry, and `useSettingsSection` stops a failed GET from producing a saveable blank form |
| 21 Audit rows not clickable, client-side search | resolved by `/settings/audit`: a 520px drawer with the before-and-after diff, server-side `?q=`, full type list, and export that honours the actor |
| 22 h1 size mix | resolved by §1.7: title 22/600 on every page in this unit |
| 23 Primary button colours | resolved by §1.7 and the design system: `--os-brand` only, no `bg-zinc-900`, no `accent-zinc-900`, no raw hex |
| 24 Four back patterns | resolved by §0 and §1.5: one, and it is "← Back to app" (the Close ✕ goes with the other three) |
| 25 Label drift | resolved by §1.3 and the registry: sidebar row, page title and breadcrumb all render `SETTINGS_PAGES[key].label` |
| 26 Two toast systems | resolved by `useOsToast` everywhere, including Billing and the tags manager |
| 27 Task-types hand-rolled modal | resolved by `/settings/tasks`, which uses the shared `ui/dialog` and visible row actions |
| 28 `/me/mentions` orphan | deferred to the Work unit; `settings-architecture` §7.1 carries the 308 to `/inbox?tab=mentions` |
| 29 "My Profile" never highlights | deferred to the Teams unit (the sidebar's active rule) |
| 30 Dead Settings hub sidebar | resolved by §0: `SettingsSidebar` deleted, `matchPaths` shrunk to `/settings` and `/account`, and its five rows re-parented, which also ends the sticky-sidebar leak onto Space pages |
| 31 Overview scoring cards show legacy fields | resolved by `/settings` (one Scoring card with two live values) and `/settings/scoring` (the legacy weight shape migrated on read) |
| 32 Matrix modules outside the product scope | resolved by `/settings/access`: the matrix is deleted, its fourteen enforced cells become gate rules, and the rest is exported and retired |
| §4 "should exist but does not": statuses manager | **deferred** to the spaces-lists unit and the Template Center, because statuses are object-scoped (per-List) and a workspace editor beside them would be a second source of truth. `/settings/tasks` › Templates answers it in plain words with a link, so the question has a destination rather than silence (§0) |
| §4 "should exist but does not": custom fields manager | **deferred** to the same owner for the same reason (the 30-type field shelf lives on a List). Same card, same link (§0) |

`critic-gaps.json` `topSystemicIssues`.

| # | Status |
|---|---|
| #1 Nav chrome decoupled from the URL | resolved for this unit: the settings list's active row is matched from `pathname` against `SETTINGS_PAGES` `href` and `aliases` on every render (§1.1, §1.2), the stored `activeAppKey` is never read here, and `SettingsSidebar`, whose sticky key leaked the Settings sidebar onto Space pages, is deleted with `matchPaths` shrunk to `/settings` and `/account` (§0) |
| #2 Fabricated and inert chrome | resolved: `OsTitleBar` removed from both doors, SAMPLE tags deleted, hard-coded avatar stacks replaced by real people from `GET /api/access/admins`, every `OsEmptyView cta` without a handler replaced by `ErrorState` with a wired Retry |
| #3 Duplicate surfaces | resolved for the three the evidence line names by number: `settings-pages` #12 and #18 (Import-export and Data were two hubs for one job) merge into `/settings/data`, and #14 (two org charts) merges into `/organization` with Structure › Org chart as a link card. Integrations, the third door for one idea, folds into API & webhooks. Every merged URL keeps a 308 |
| #4 Access fragmented | resolved for this unit: one gate, one page table, the access model's own denial convention unchanged (the `AdminOnly` card for an Admin without a scope, the Ask-an-admin strip over My settings › Profile for everyone else, never a redirect and never a 404), every org write API on the page rule, the per-field write table on the person record, the People team's read defined instead of implied. The object-level half belongs to the access unit |
| #5 Back navigation | resolved: `closeSettings()` with the origin rule, one back affordance, `BackButton{fallbackHref}` on the one full-page view here (the `AdminOnly` card; the Ask-an-admin strip sits over a destination and needs none, access §6.4) |
| #6 Five visual systems | resolved for this unit: the legacy BEM families (`.adt`, `.apk`, `.tgm`, `.cli`, `.acs`), the third 19px hex-icon sub-style and the hand-rolled overlay all go; one card, one row, one table, one dialog, one toast |
| #7 Settings that do nothing | resolved: every row in §2 names a store, a writer and a reader; rail floors become enforced; the org security policy gains its editor and its readers; "Default language" reaches `next-intl`; `businessType` and `teamSize` gain a writer; the seven localStorage-only values move to server keys; behavioural anchors, the retention rows before their cron, the competitor importers and SSO sit behind "Show upcoming features" instead of pretending |
| #9 Naming drift | resolved for this unit by §1.3 and the registry |
| #10 Desktop only | partly resolved: §1.6 gives this unit the product's first real breakpoint at 900px, plus visible row actions instead of hover-only reveals and `↑` `↓` buttons beside every drag handle. The rest of the shell is the shell unit's |
| #11 Errors swallowed, no session expiry | resolved for this unit: `ErrorState` with Retry, the fetch-failure rule, and the shell's session-expired dialog opened over a dirty form rather than a silent degrade |
| #12 Hard caps and client-side paging | resolved for this unit: Members moves from a 500-row cap to `GET /api/users?scope=all&cursor=` with a real footer pager, Audit moves from 100 rows filtered in memory to a server cursor with `?q=`, `?type=`, `?actor=`, `?severity=` and a date range, its type list comes from `GET /api/audit/types` rather than from whatever landed on page one, and export honours every active filter. No list in this unit truncates silently |
| #13 Time, locale and money per surface | partly resolved: `/settings/locale` becomes the org half of one chain (org → user → formatter) and finally feeds `src/i18n/request.ts`. The surfaces that disagree about week start and UTC bucketing are fixed in their own units, reading these values |
| #14 Dead code and stale registries | resolved for this unit: `branding-manager`, `byok-manager` and `privacy-controls` are wired behind their flags, `tags-manager` is rendered, `sop-category-manager` is deleted (SOP folders are managed at `/sops/manage`), `PERMISSION_MODULES` and `/api/permissions` are deleted, `SettingsSidebar` is deleted |
| #15 Copy hygiene | resolved for this unit: "Coming soon" rows hide behind the preference, no em dashes or double hyphens in any string, no developer instructions, and the stale header comments in `settings-shell.tsx` are rewritten with the file |
| `missedSurfaces`: Settings hub sidebar leaking onto Space pages | resolved: the component is deleted and `matchPaths` shrink |
| `missedSurfaces`: cookie consent banner inside the app | deferred to the shell unit, which moves it to the marketing and auth layouts |
| `contradictions`: `/settings/calendar` | resolved in §0: the backend is real and per user, so the surface moves to the personal door rather than being deleted or surfaced org-wide |
| `contradictions`: the `g` then `s` chord | resolved: removed from every copy string until `useGoToNav` is mounted, which is the shell unit's keyboard map |

`access-model.md` Broken items: **#4** (SUPER_ADMIN in a tenant role select) by the Members role whitelist; **#9** (Space default permission stored and unread) by pointing it at the share dialog's "Everyone at {org}" row, referenced not duplicated; **#14**, **#15**, **#17**, **#18**, **#22**, **#24**, **#25** by §1.4 and `/settings/members`; **#26** (rail floors display only) by `/settings/apps`; **#27** (audit gaps) by `/settings/audit`; **#31** by the Members transfer dialog.

**Decisions that must hold, and do**: task assignment still grants item access (untouched here); non-guest Members still write content (untouched); a List or Folder still shares on its own (the share dialog, referenced in §2 and never rebuilt in a door); the rail stays access-derived with no pin API anywhere in this unit; Talk and Tables stay `ProductInstallation`-gated and their switch lives on one page; the Talent 9-box stays at `/talent` with a link from Scoring & reviews; the "Customize Sidebar" footer stays in the app's hub sidebars and is not moved into a settings page.
