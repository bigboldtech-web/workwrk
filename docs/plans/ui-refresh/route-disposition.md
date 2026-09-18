# Route disposition: every route in the app

Cross-unit canon, Phase 3. Compiled 2026-09-12 from the 17 unit specs, against `design-system.md` (look), `access-model-spec.md` (access) and `settings-architecture.md` (settings structure). One row per route in `route-list.txt`, plus every route a unit spec adds.

How to read it:

- **Disposition**: `keep` (same URL, rebuilt) · `keep (new)` (a route a unit adds) · `merge into X` (becomes a tab, view or section of X; old URL 308s) · `redirect to X` (308, page file deleted) · `remove` (deleted, with the target that keeps the destination reachable).
- **Hub**: which rail hub lights up, from `resolveHub(pathname)` over `ROUTE_HUB` (`spec-shell` §1.1). Hub and row are pure functions of the URL; nothing is sticky.
- **Sidebar row**: the one row that carries the active pill. "none" means no row is active, which is legal (the first row is never a fallback).
- **Back target**: the `BackButton{fallbackHref}` value, or "none (hub page)" where the breadcrumb and the sidebar are the way back. Full detail in `back-map.md`.
- **Access**: the gate in access-model vocabulary. "Member" means Owner, Admin and Member with the Agent flag included unless stated; Guests are named wherever they get anything.

Every redirect is a 308 in `next.config.ts` and is permanent unless a row says otherwise. Every destination that exists today stays reachable; no row removes one without naming where it went.

---

## 1. Work hub

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/home` | work-home | **keep (new)**: the one Work landing | Work | Home | none (hub page) | everyone signed in (`app: home`); a Guest sees the My work and Inbox widgets only |
| `/today` | work-home | **redirect to `/home`** (it redirected to the first Space, which is not a personal landing) | n/a | n/a | n/a | n/a |
| `/dashboard` | work-home | **redirect to `/home`** (duplicate redirect over a dead 653-line tree) | n/a | n/a | n/a | n/a |
| `/my-work` | work-home | **keep (new)**: every task assigned to me, over the Item model | Work | My work | none (hub page) | everyone signed in; every row is Can edit by the assignee rule |
| `/my-work/personal` | work-home | **keep (new)**, moved from `/tasks/personal-list` | Work | My work › Personal list | none (sidebar row) | Owner, Admin, Member, Agent; Guest 404 |
| `/inbox` | work-home | **keep**, rebuilt (tabs Primary, Other, Mentions) | Work | Inbox | none (hub page) | everyone signed in; a Guest gets only the kinds access §2.3 allows |
| `/activity` | work-home | **keep**, rebuilt | Work | Activity | none (hub page) | Owner, Admin, Member, Agent; Guest 404 |
| `/everything` | work-home | **keep**, header stack + server pagination | Work | Everything (first row of SPACES) | none (hub page) | Owner, Admin, Member, Agent; Guest 404 |
| `/favorites` | work-home | **keep**, content replaced: the real Favorites page (the pinned Sidekick chats move to `/sidekick?pinned=1`) | Work | See all favorites | none (hub page) | Owner, Admin, Member, Agent; Guest 404 |
| `/me/weekly-review` | work-home | **keep**, restyled | Work | Home | `/home` ("Home") | own people data; Guest 404 |
| `/me/mentions` | work-home | **redirect to `/inbox?tab=mentions`** (permanent) | n/a | n/a | n/a | n/a |
| `/assigned-comments` | work-home | **redirect to `/inbox?tab=primary&type=task_comment`** (a stub over a schema that does not exist) | n/a | n/a | n/a | n/a |
| `/item/[id]` | task-detail | **keep**: the one task page, and the one task drawer at the same URL | Work (or the drawer host's hub) | the task's List row in the Spaces tree; My work › Personal list for a personal task | `?returnTo=`, else parent task, else the List, else `/my-work/personal`, else `/home` | role resolved on `{type:"item"}`; no role = 404 (a task is never discoverable) |
| `/tasks` | work-home | **redirect to `/home`** (7 stub cards of 11, 15 dead buttons) | n/a | n/a | n/a | n/a |
| `/tasks/[id]` | work-home | **redirect to `/item/[id]`** of the migrated Item (lookup by `Item.metadata.legacyTaskId`); in-shell 404 when none | n/a | n/a | n/a | n/a |
| `/tasks/assigned-to-me` | work-home | **redirect to `/my-work`** | n/a | n/a | n/a | n/a |
| `/tasks/today-overdue` | work-home | **redirect to `/my-work`** (due-date grouping is the default) | n/a | n/a | n/a | n/a |
| `/tasks/personal-list` | work-home | **redirect to `/my-work/personal`** | n/a | n/a | n/a | n/a |
| `/tasks/backlog` | work-home | **redirect to `/my-work?group=due&bucket=nodate`** | n/a | n/a | n/a | n/a |
| `/tasks/board` | work-home | **redirect to `/my-work?view=board`** | n/a | n/a | n/a | n/a |
| `/tasks/gantt` | work-home | **redirect to `/my-work`** (Gantt is a List view; personal work has none) | n/a | n/a | n/a | n/a |
| `/tasks/sprint` | work-home | **redirect to `/my-work`** (a sprint is a List; created from the Space or Folder "…" › New › Sprint) | n/a | n/a | n/a | n/a |
| `/tasks/calendar` | work-home → planner | **redirect to `/planner`** (one calendar) | n/a | n/a | n/a | n/a |
| `/ideas` | work-home | **remove** → migrated to an "Ideas" List; 308 to `/boards/<slug>` when the org had ideas, else `/templates?q=ideas` | n/a | n/a | n/a | n/a |
| `/spaces` | spaces-lists | **keep**, rebuilt as the Spaces grid | Work | none (the SPACES section label renders active, no pill) | none (hub page) | every Member, their readable plus findable Spaces; Guests see only shared Spaces |
| `/spaces/[slug]` | spaces-lists | **keep**, `?view=` renamed `?tab=` (Overview · Tasks · Lists · Members · Settings) | Work | that Space's row, subtree expanded | `/spaces` ("Spaces"), always rendered | Can view and above; `containerOnly` and findable-no-role get `LockedPage`; not discoverable = 404 |
| `/folders/[id]` | spaces-lists | **keep**, tabs Contents · Tasks | Work | that Folder's row, ancestors expanded | the parent Folder, else the Space | Can view and above, direct or inherited; not discoverable = 404 |
| `/boards/[slug]` | spaces-lists | **keep** (a List); the route also accepts an id and 308s to the slug | Work | that List's row, or its active saved-view child row | the Folder, else the Space | Can view and above; assignee-only gets `LockedPage`; not discoverable = 404 |
| `/templates` | spaces-lists | **keep**, rebuilt as the one Template Center for every kind (Doc, Canvas, Starter kit, Task, List, Space) | Work | Templates | none (list page) | every Member; Guests 404. New `APP_RULES` key `templates` |
| `/trash` | spaces-lists | **keep**: the ONE Trash, type-filtered (`?type=space|folder|list|task|doc|canvas|table|file|form|contract`) | Work | Trash | none (list page) | every Member sees what they deleted or hold Full access on; Owner and Admin see the org trash and purge; Guests 404 |
| `/okrs` | goals | **keep**: Goals (My · Team · Company) | Work | Goals › My goals / Team goals / Company goals | none (hub page) | `app: goals`, every Member; Guests 404 |
| `/okrs/[id]` | goals | **keep**: the Goal page | Work | Goals › the view the goal belongs to | `/okrs?view=…` ("My goals" / "Team goals" / "Company goals") | owner Full; Contributors, manager chain and People team Can edit; everyone Can view on COMPANY goals; else 404 |
| `/goals` | goals | **keep (new)**: 308 to `/okrs` (a path the nav config referenced and that 404d) | n/a | n/a | n/a | n/a |

---

## 2. Planner hub

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/planner` | planner | **keep**: the one Calendar (page title "Calendar") | Planner | Calendar (Team calendar on `?calendar=team`) | none (hub page) | `app: planner`, every Member; Guests 404 |
| `/calendar` | planner | **redirect to `/planner`** (legacy links) | n/a | n/a | n/a | n/a |
| `/meetings` | planner | **keep**, re-parented to Planner, list rebuilt | Planner | Meetings | none (hub page) | `app: meetings` (new key; fallback `planner`), every Member; scoped to meetings you attend or created |
| `/meetings/[id]` | planner | **keep**, full page with editable details | Planner | Meetings | `/meetings` ("Meetings") | attendee Can edit (assignee rule), creator Full, Owner and Admin Full; everyone else 404 |
| `/timesheets` | planner | **keep**, rebuilt with hour entry, week navigation and approvals | Planner | Timesheets (Approvals on `?view=approvals`) | none (hub page) | `app: timesheets`, every Member (own); manager chain, People team and Admin for their people |
| `/clock` | planner | **keep**, rebuilt on the real punch API | Planner | Clock in/out | none (hub page) | `app: clock` (new key; fallback `planner`), every Member, Agents included; own punches only |

---

## 3. AI hub

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/sidekick` | ai-automation | **keep**, rebuilt; labelled **Ask AI** everywhere (URL unchanged) | AI | Ask AI (a CHATS row on `?session=`) | none (hub page); `/sidekick?view=all` backs to `/sidekick` ("Ask AI") | `app: ai`, every Member; sessions are the viewer's own and nobody reads another person's chats; Guests 404 |
| `/ai` | ai-automation | **redirect to `/sidekick`** (static prompt playground, no backend) | n/a | n/a | n/a | n/a |
| `/agents` | ai-automation | **keep**, rebuilt on the real `/api/agents` endpoints | AI | Agents | none (hub page) | read: every Member; add, enable, pause, schedule, run, remove: Owner and Admin (`settings.manageIntegrations`) |
| `/autopilot` | ai-automation | **redirect to `/automation/workflows`** (static duplicate of the real hub) | n/a | n/a | n/a | n/a |
| `/automation` | ai-automation | **keep (new)**: 308 to `/automation/workflows` (the hub's natural address 404s today) | n/a | n/a | n/a | n/a |
| `/automation/workflows` | ai-automation | **keep**, list-page header stack + `TableCard` | AI | Workflows | none (hub page) | `app: automation`, every Member (Can view the list); create = any Member |
| `/automation/workflows/[id]` | ai-automation | **keep**, dirty guard, responsive Details panel, version history | AI | Workflows | `/automation/workflows` ("Workflows") | creator Full, Owner and Admin Full; other Members read-only with the View-only banner |
| `/automation/templates` | ai-automation | **keep**, restyled | AI | Templates | none (hub page) | `app: automation`, every Member |
| `/automation/logs` | ai-automation | **keep**, real pagination, resolved trigger names | AI | Logs | none (hub page) | `app: automation`, every Member |
| `/automation/health` | ai-automation | **keep**, window selector added | AI | Health | none (hub page) | `app: automation`, every Member |
| `/automation/usage` | ai-automation | **keep**, honest limit copy | AI | Usage | none (hub page) | `app: automation`, every Member; the Top people table is Owner and Admin only |
| `/automation/connections` | ai-automation | **keep**, rebuilt around the one working connector (the webhook) | AI | Connections | none (hub page) | Owner and Admin (`settings.manageIntegrations`); a Member gets `LockedPage` at the same URL |
| `/store` | tools-misc (page), ai-automation (row) | **keep** as **Marketplace**, rebuilt on the real module registry; the path stays `/store` | AI | Marketplace | none (list page) | `app: store`, every Member browses; turning modules on and off is Owner and Admin; Guests 404 |
| `/integrations` | tools-misc (page), ai-automation (row) | **keep** (the earlier proposal to 308 it into `/automation/connections` is withdrawn; see `consistency-report.md` C3) | AI | Integrations | none (list page) | `app: integrations`, every Member browses the catalogue; connecting needs `settings.manageIntegrations` |
| `/build` | tools-misc (page), ai-automation (row) | **keep** as **Build apps**, rebuilt | AI | Build apps | none (list page) | `app: build`, Owner and Admin; everyone else 404 (never `AppOff`) |
| `/build/[slug]` | tools-misc | **keep**, rebuilt (the dynamic Tailwind classes that never compile go) | AI | Build apps | `/build` ("Build apps") | Owner and Admin |
| `/sidekick/history` | ai-automation | **remove** (never existed; a dead sidebar link) → the CHATS section and `/sidekick?view=all` | n/a | n/a | n/a | n/a |
| `/sidekick/prompts` | ai-automation | **remove** (never existed) → the starter prompts on the Ask AI landing | n/a | n/a | n/a | n/a |

---

## 4. Talk hub

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/tlk` | talk | **keep**, rebuilt as Talk home (Unread · Threads · Mentions); the auto-redirect into the newest conversation ends | Talk | Unread / Threads / Mentions per `?view=` | none (hub page) | module on; every Member; Guests when they hold a channel |
| `/tlk/[id]` | talk | **keep**: one conversation (`?thread=`, `?m=`, `?call=`) | Talk | that conversation's row (STARRED, CHANNELS or DIRECT MESSAGES) | `/tlk` ("Talk") | members Can edit; creator Full; private channels and DMs have no Admin read-around; a findable public channel I am not in gets `LockedPage` with "Join channel"; a private channel or DM 404s |
| `/announcements` | talk | **keep**; always in the Talk hub, module on or off | Talk | Announcements | none (hub page) | `app: announcements`, every Member; never Guests |
| `/announcements/[id]` | talk | **keep (new)**: a 520 drawer over the list, a full page from a notification or deep link | Talk | Announcements | `/announcements` ("Announcements") | as the list; the drawer owns the page primary while open |
| `/room`, `/room/:id`, `/chat`, `/chat/:id` | talk | **keep** as permanent 308s to `/tlk` and `/tlk/:id` (stored notification links) | n/a | n/a | n/a | n/a |

---

## 5. Teams hub

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/people` | teams-people | **keep**, rebuilt as the Directory list page. It is the Teams hub `defaultHref` | Teams | Directory | none (hub page) | every Member (`person_card` VIEW org-wide); Guests 404 |
| `/people/[id]` | teams-people | **keep**: the person record, a drawer over the Directory and a full page on Expand or deep link | Teams | Directory (My profile when the id is the viewer's) | `/people` ("Directory") | every Member for the directory card; people-data tabs for self, manager chain, People team, Owner and Admin |
| `/people/me` | teams-people | **keep** as a server redirect to `/people/{sessionUserId}` | Teams | My profile | `/people` ("Directory") | every Member; a Guest's own record is `/account/profile` |
| `/people/departments` | teams-people | **keep**, rebuilt as the Departments list page | Teams | Departments | none (hub page) | every Member reads; Owner and Admin write |
| `/people/roles` | teams-people | **keep**, rebuilt as the Job titles list page | Teams | Job titles | none (hub page) | every Member reads; Owner, Admin and People team write |
| `/people/roles/[id]` | teams-people | **keep**, rebuilt as the Job title page (720 column) | Teams | Job titles | `/people/roles` ("Job titles") | every Member reads (View-only banner); Owner, Admin, People team write |
| `/people/skills` | teams-people | **keep**, rebuilt with a real write path | Teams | Skills | none (hub page) | every Member; ratings only for people the viewer holds `person` VIEW on |
| `/organization` | teams-people | **keep** as THE org chart; gains "Edit reporting lines" | Teams | Org chart | none (hub page) | every Member; edit for Owner, Admin, People team |
| `/team` | teams-people | **keep**, rebuilt as "My team" | Teams | My team | none (hub page) | `app: team` (new key): anyone with reports, People team, Owner, Admin. A Member with no reports gets `LockedPage` ("Nobody reports to you yet"), no Request access |
| `/team/workload` | teams-people | **keep**, rebuilt with persisted settings and real counting | Teams | Workload | none (hub page) | `app: workload` (new key), same rule as `/team` |
| `/analytics` | work-home (page), teams-people (row) | **keep**, rebuilt on the task (Item) model and re-parented from Work to Teams | Teams | Analytics | none (hub page) | `app: analytics`: anyone with reports over their chain, People team, Owner, Admin; everyone else 404 |
| `/kra-kpi` | goals | **keep**: KRAs & KPIs by job title | Teams | KRAs & KPIs | none (hub page) | `app: kra-kpi` (new key): every Member reads; Owner, Admin, People team edit |
| `/kra-kpi/review` | goals | **merge into `/team/kpi-reviews`** (permanent 308, `?period=` carried): two manager KPI workflows for one job | n/a | n/a | n/a | n/a |
| `/team/alignment` | goals | **keep**: Alignment ("My reports" view) | Teams | Alignment | none (hub page) | `app: alignment` (new key): anyone with reports over their chain, People team, Admin |
| `/team/rollup` | goals | **keep** the route; the sidebar row is removed and it becomes the **Sub-teams** view of Alignment | Teams | Alignment | none (view of a hub page) | `app: rollup`, same rule as Alignment |
| `/team/kpi-reviews` | goals | **keep**, relabelled **KPI reviews**; absorbs `/kra-kpi/review` | Teams | KPI reviews | none (hub page) | `app: kpi-reviews` (new key), same rule as Alignment |
| `/team/reviews` | teams-performance | **keep**, rebuilt as the Weekly reviews queue with a decision drawer | Teams | Weekly reviews | none (hub page) | `app: weekly-reviews` (new key): anyone with reports, People team, Owner, Admin; a Member with no reports gets the in-shell 404 and writes their own at `/me/weekly-review` |
| `/reviews` | teams-performance | **keep**, rebuilt as the Review cycles list page | Teams | Review cycles | none (hub page) | `app: reviews`: anyone with reports over their chain, People team, Owner, Admin |
| `/reviews/[id]` | teams-performance | **keep**, rebuilt; sections derived from the viewer's role; the gate opens to subjects and reviewers | Teams | Review cycles | `/reviews` ("Review cycles"); `/people/me` ("My profile") for a subject who cannot open `/reviews` | subject, reviewer, manager chain above a subject, People team, Owner, Admin; everyone else 404 |
| `/talent` | teams-performance | **keep at `/talent`** (hard constraint), rebuilt: neutral grid, real period picker, no GET that writes | Teams | Talent (9-box) | none (hub page) | `app: talent`: anyone with reports over their chain, People team, Owner, Admin; population always filtered by `can(view, person)` |
| `/candor` | teams-performance | **keep**, rebuilt with two views (To answer · Sessions) | Teams | Candor | none (hub page) | `app: candor`: anyone with reports, People team, Admin, plus any Member invited to a session |
| `/candor/[id]` | teams-performance | **keep**, rebuilt; all three faces get detail-page chrome | Teams | Candor | `/candor` ("Candor") | session owner, People team, Owner, Admin, plus anyone in scope while it is Open; else 404 |
| `/kudos` | teams-performance | **keep**, rebuilt; the give path is mounted at last | Teams | Kudos | none (hub page) | `app: kudos`, every Member; Guests 404 |
| `/surveys` | teams-performance | **keep**, rebuilt with two views (To answer · All surveys) | Teams | Surveys | none (hub page) | `app: surveys`: Admin and People team create and read results; every targeted Member responds |
| `/surveys/[id]` | teams-performance | **keep**, rebuilt as Respond + Results | Teams | Surveys | `/surveys` ("Surveys") | anyone in the audience while Open or after responding; creator, People team, Owner, Admin at any time; else 404 |
| `/tools` | tools-misc | **keep**, re-parented from the Settings sidebar to Teams › Resourcing | Teams | Tools | none (list page) | `app: tools`, every Member (the tools shared with them); Admin all; Guests 404 |
| `/assets` | tools-misc | **keep**, re-parented to Teams › Resourcing | Teams | Assets | none (list page) | `app: assets`: anyone with reports, People team, Admin. A Member without reports has no row and gets the in-shell 404; their own kit is the Assets tab of `/people/me` |

---

## 6. Docs hub

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/docs` | docs-knowledge | **keep**, rebuilt (views All · Recent · Mine · Shared with me) | Docs | All docs (or the `?view=` row) | none (list page) | `app: docs`, every Member; a Guest only when a doc is shared |
| `/docs/[id]` | docs-knowledge | **keep**, rebuilt editor | Docs | the doc's row in the DOCS tree | parent sub-doc, else the anchor page, else `/docs` | object ladder on `{type:"doc"}`; Lock page resolves everyone below Full to Can comment; not discoverable = 404 |
| `/docs/trash` | docs-knowledge | **redirect to `/trash?type=doc`** (one Trash for the whole app). `/docs?view=archived` redirects the same way | n/a | n/a | n/a | n/a |
| `/library` | docs-knowledge | **redirect to `/docs`**; `?tab=notes`→`/docs`, `?tab=whiteboards`→`/canvas`, `?tab=files`→`/files`, `?tab=tables`→`/tables`. The `library` catalog key survives as the gate name for `/files` only | n/a | n/a | n/a | n/a |
| `/canvas` | docs-knowledge | **keep** | Docs | Canvases | none (list page) | `app: docs`, every Member |
| `/canvas/[id]` | docs-knowledge | **keep** | Docs | Canvases | the anchor Space page when `spaceId` is set, else `/canvas` ("Canvases") | object ladder on `{type:"whiteboard"}`; role select offers Can view, Can edit, Full access only |
| `/files` | docs-knowledge | **keep**, folder-aware | Docs | Files (or the active folder row) | none (list page; the breadcrumb carries the folder path) | `app: library`, every Member; a Guest only when a folder or file is shared |
| `/notetaker` | docs-knowledge | **keep**, one label "Notetaker" | Docs | Notetaker | none (list page) | `app: clips` **and** the AI module on; every Member; Guests never |
| `/whiteboards`, `/whiteboards/:id` | docs-knowledge | **keep** as the existing `next.config.ts` redirects to `/canvas` and `/canvas/:id` | n/a | n/a | n/a | n/a |
| `/sops` | process | **keep** | Docs | SOPs | none (list page) | every Member; Guests 404 |
| `/sops/[id]` | process | **keep**, one page for all four kinds (`?edit=1` for edit mode) | Docs | SOPs | `/sops` ("SOPs") | folder ladder, author Full on own drafts, assignee Can view plus acknowledge; no role = 404 |
| `/sops/new` | process | **keep** as the kind chooser; `?type=` 308s to the per-kind URL and no row is pre-created | Docs | SOPs | `/sops` ("SOPs") | every Member; Guests 404 |
| `/sops/new/text` | process | **keep** (Written) | Docs | SOPs | `/sops` ("SOPs") | every Member |
| `/sops/new/steps` | process | **keep (new)** (Step-by-step; today `?type=STEPS`) | Docs | SOPs | `/sops` ("SOPs") | every Member |
| `/sops/new/checklist` | process | **keep** (Checklist) | Docs | SOPs | `/sops` ("SOPs") | every Member |
| `/sops/new/record` | process | **keep** (Recording); the "load unpacked" developer copy goes | Docs | SOPs | `/sops` ("SOPs") | every Member |
| `/sops/new/text?id=X`, `/sops/new/checklist?id=X` | process | **redirect to `/sops/X?edit=1`** (a "new" URL was used to edit) | n/a | n/a | n/a | n/a |
| `/sops/my-sops` | process | **keep** | Docs | My SOPs | none (list page) | every Member; a Guest with at least one assignment |
| `/sops/compliance` | process | **keep** | Docs | SOP compliance | none (list page) | anyone with reports, People team, Owner, Admin; everyone else the in-shell 404 |
| `/sops/manage` | process | **keep**, page title **Organize** | Docs | SOPs | `/sops` ("SOPs") | Owner, Admin, People team; a Member with Full on a folder sees that subtree; everyone else 404 |
| `/process-runs` | process | **keep** as **Run history**; the `requireManagerOrRedirect` layout is deleted | Docs | Run history | none (list page) | every Member (My runs); Team runs for anyone with reports; All runs for People team, Owner, Admin |
| `/policies` | process | **keep** | Docs | Policies | none (list page) | every Member (published and assigned); Drafts and Archived views for Owner, Admin, People team |
| `/policies/[id]` | process | **keep** | Docs | Policies | `/policies` ("Policies") | published or assigned: Can view plus acknowledge; Owner, Admin, People team: Full. No read-only banner (there is nothing to request) |
| `/policies/[id]/compliance` | process | **keep** as **Acknowledgements** | Docs | Policies | `/policies/[id]` (the policy title) | Owner, Admin, People team; anyone with reports over their chain; everyone else 404 |
| `/policies/compliance` | process | **keep** as **Policy compliance** | Docs | Policy compliance | none (list page) | anyone with reports, People team, Owner, Admin; everyone else 404 |
| `/agreements` | process | **keep** as **Contracts** (`?view=templates` is the Contract templates view) | Docs | Contracts / Contract templates | none (list page) | Owner, Admin, People team; a Member who is a party reaches their own from `/people/me` and the signing email |
| `/agreements/[id]` | process | **keep** | Docs | Contracts / Contract templates | `/agreements` ("Contracts") or `/agreements?view=templates` ("Contract templates") | Owner, Admin, People team Full; a party who is a Member Can view their own; else 404 |
| `/agreements?view=trash` | process | **redirect to `/trash?type=contract`** (the view was never implemented) | n/a | n/a | n/a | n/a |

---

## 7. Tables hub

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/tables` | tables-forms | **keep**, rebuilt as the list page | Tables | All tables | none (list page) | module on; `app: tables`, every Member; a Guest only when a table is shared; module off = `ModuleOff` |
| `/tables/[id]` | tables-forms | **keep**, rebuilt: named and typed columns, menu bar, status bar; the bottom sheet tab bar goes | Tables | that table's row in TABLES | the table's Space page when `spaceId` is set, else `/tables` ("Tables") | object ladder on `{type:"table"}`; Can view renders a read-only grid with the View-only banner; not discoverable = 404 |
| `/forms` | tables-forms | **keep**, rebuilt; `FormsSidebar` and `?mine=1` go | Tables | All forms | none (list page) | `app: forms`, every Member; a Guest only when the anchor is shared |
| `/forms/[id]` | tables-forms | **keep**, rebuilt builder with a dirty guard | Tables | that form's row in FORMS, else All forms | the destination List's board, else the destination table, else `/forms` ("Forms") | inherits the anchor; creator keeps Full access for the life of the form |
| `/forms/[id]/respond` | tables-forms | **keep at the same URL**, moved from `(dashboard)` to `(public)` so a stranger is not bounced to `/login` | none (no shell) | none | none by design; a signed-in visitor gets one "Open in WorkwrK" text link | public link on and org toggle 10 = "View only" renders for anyone; otherwise a session with Can comment or above on the anchor; else the neutral invalid-link card. Submit requires sign-in until the founder answers the open question |
| `/embed/forms/[id]` | tables-forms | **keep**, no shell | none | none | none by design | as above; module off = the neutral invalid-link card |
| `/embed/tables/[id]` | tables-forms | **keep**, no shell; `[object Object]` formula rendering fixed | none | none | none by design | as above |
| `/imports` | tables-forms → settings-workspace | **keep** at its URL through S4, rendered inside the settings takeover; **then redirect to `/settings/data?tab=import`** at S5. The CSV-into-a-table path becomes an in-place dialog on `/tables` and `/tables/[id]` so a plain Member keeps it | Settings (takeover) | Data (`alsoActiveOn: ["/imports"]`) | the takeover's "← Back to app" | the `data` settings page rule (Owner and Admin); a Member sees the Ask-an-admin strip naming the in-table importer |

---

## 8. Settings hub (Workspace door)

Every route here renders inside the settings takeover: the rail and the navy top bar stay, the sidebar and content are replaced. Breadcrumb `Settings › Workspace settings › {Page}`. No route under `/settings/*` ever 404s for a signed-in person.

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/settings` | settings-workspace | **keep**, rebuilt as Overview (one card per page, registry search, first-run card) | Settings | Overview | "← Back to app" (`closeSettings()`) | Owner, Admin |
| `/settings/identity` | settings-workspace | **keep**, tabs Profile · Culture · Appearance defaults · Danger zone; absorbs `/settings/defaults` | Settings | Identity & culture | as above | Owner, Admin; Danger zone Owner only |
| `/settings/locale` | settings-workspace | **keep** as Locale & work week | Settings | Locale & work week | as above | Owner, Admin |
| `/settings/apps` | settings-workspace | **keep**, sections Modules · Rail apps · Automations; absorbs `/settings/modules` | Settings | Apps & modules | as above | Owner, Admin |
| `/settings/members` | settings-workspace | **keep**, tabs People · Guests · Teams · Pending invites | Settings | Members | as above | Owner, Admin; People team read plus the people-data fields |
| `/settings/structure` | settings-workspace | **keep**, tabs Departments · Job titles · Offices · Org chart (a link card to `/organization`) | Settings | Structure | as above | Owner, Admin; People team read plus job titles |
| `/settings/access` | settings-workspace | **keep (new)**: the explainer, the ten toggles, Guests and links, Lock it down | Settings | Access | as above | Owner, Admin; People team read |
| `/settings/tasks` | settings-workspace | **keep (new)**: tabs Task types · Tags · Templates; absorbs `/settings/task-types` and `/settings/tags` | Settings | Task system | as above | Owner, Admin |
| `/settings/scoring` | settings-workspace | **keep**, fixed | Settings | Scoring & reviews | as above | Owner, Admin; People team read |
| `/settings/security` | settings-workspace | **keep (new)**: tabs Sign-in policy · Single sign-on · Provisioning (SCIM) | Settings | Security | as above | Owner, or Admin with the `security` scope; other Admins get the `AdminOnly` card |
| `/settings/data` | settings-workspace | **keep**, tabs Export · Import · Retention & privacy · Trash; absorbs `/settings/import-export` | Settings | Data | as above | Owner, Admin; Retention purge and Danger rows Owner |
| `/settings/audit` | settings-workspace | **keep**, rebuilt as a list page with a drawer | Settings | Audit log | as above | Owner, Admin |
| `/settings/api` | settings-workspace | **keep**, tabs API keys · Webhooks · AI keys; absorbs `/settings/integrations` | Settings | API & webhooks | as above | Owner, or Admin with the `security` scope |
| `/settings/billing` | settings-workspace | **keep**, honest no-Stripe state | Settings | Plan & billing | as above | Owner, or Admin with the `billing` scope |
| `/settings/all` | settings-workspace | **keep (new)**: the generated index | Settings | All settings | as above | Owner, Admin |
| `/settings/modules` | settings-workspace | **redirect to `/settings/apps#modules`** | n/a | n/a | n/a | n/a |
| `/settings/tags` | settings-workspace | **redirect to `/settings/tasks?tab=tags`** (the rendered page fabricates SAMPLE data; `tags-manager.tsx` becomes the tab body) | n/a | n/a | n/a | n/a |
| `/settings/task-types` | settings-workspace | **redirect to `/settings/tasks?tab=types`** | n/a | n/a | n/a | n/a |
| `/settings/defaults` | settings-workspace | **redirect to `/settings/identity?tab=appearance`** | n/a | n/a | n/a | n/a |
| `/settings/hierarchy` | settings-workspace | **redirect to `/organization`** (one org chart, in Teams) | n/a | n/a | n/a | n/a |
| `/settings/permissions` | settings-workspace | **redirect to `/settings/access`** (55 of 75 matrix cells enforce nothing) | n/a | n/a | n/a | n/a |
| `/settings/import-export` | settings-workspace | **redirect to `/settings/data?tab=import`** | n/a | n/a | n/a | n/a |
| `/settings/integrations` | settings-workspace | **redirect to `/settings/api`** (the marketplace stays at `/integrations` in the AI hub) | n/a | n/a | n/a | n/a |
| `/settings/notifications` | settings-workspace | **redirect to `/account/notifications`** | n/a | n/a | n/a | n/a |
| `/settings/calendar` | settings-workspace / planner | **redirect to `/account/connections`** (the backend is per user); `?connected=1` becomes `?connected=google` | n/a | n/a | n/a | n/a |
| `/settings?tab=themes` | settings-workspace | **redirect to `/account/preferences?tab=appearance`** | n/a | n/a | n/a | n/a |
| `/settings?tab=shortcuts` | settings-workspace | **redirect to `/account/shortcuts`** | n/a | n/a | n/a | n/a |

---

## 9. Settings hub (My settings door)

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/account` | account-auth | **keep (new)**: 308 to `/account/profile` (a bare door prefix must land somewhere) | n/a | n/a | n/a | n/a |
| `/account/profile` | account-auth | **keep**; phone, date of birth, danger zone; the security-score card goes | Settings | Profile | "← Back to app" (`closeSettings()`) | every signed-in person, Guests included |
| `/account/preferences` | account-auth | **keep (new)**: tabs Appearance · Language & region · Sidebar; absorbs `/account/appearance` | Settings | Preferences | as above | every signed-in person |
| `/account/appearance` | account-auth | **redirect to `/account/preferences?tab=appearance`** | n/a | n/a | n/a | n/a |
| `/account/notifications` | account-auth | **keep**: stops being a redirect and becomes the real page (Inbox · Email · Desktop) | Settings | Notifications | as above | every signed-in person |
| `/account/security` | account-auth | **keep**; presence persisted; the invented security score deleted | Settings | Security | as above | every signed-in person |
| `/account/connections` | account-auth (page), planner (Calendar card) | **keep (new)**: Google Calendar, the personal feed, `?connected=google` | Settings | Calendar & connections | as above | every signed-in person |
| `/account/shortcuts` | account-auth | **keep (new)**: rendered from the one shortcut registry | Settings | Keyboard shortcuts | as above | every signed-in person |
| `/account/all` | account-auth | **keep (new)**: the generated index | Settings | All settings | as above | every signed-in person |

---

## 10. Auth and onboarding (no shell)

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/login` | account-auth | **keep**; title "Log in" | none | none | none (entry point) | anyone. A signed-in visitor sees a strip, never a silent redirect |
| `/signup` | account-auth | **keep (new)**: the self-serve half of `register`; CTA "Start free" | none | none | text link "Already have a workspace? Log in" | anyone. Added to `APP_PREFIXES` and `AUTH_PUBLIC_PREFIXES` |
| `/join` | account-auth | **keep (new)**: the invitation half; shows the org, the inviter, the role and the message | none | none | text link "Not you? Log in with a different account" | anyone holding an invite token. Added to both proxy lists |
| `/register` | account-auth | **redirect to `/signup`**; `/register?token=X` → `/join?token=X` | n/a | n/a | n/a | n/a |
| `/forgot-password` | account-auth | **keep** | none | none | none (entry point) | anyone |
| `/reset-password` | account-auth | **keep** | none | none | text link "Back to log in" | anyone holding a reset token |
| `/verify-email` | account-auth | **keep** | none | none | text link "Back to log in" | anyone holding a verification token |
| `/welcome` | account-auth | **redirect to `/onboard`** (its three steps persisted nothing; `pages.newUser` is deleted from `authOptions`) | n/a | n/a | n/a | n/a |
| `/setup` | account-auth | **redirect to `/onboard`** (two wizards wrote one flag) | n/a | n/a | n/a | n/a |
| `/onboard` | account-auth | **keep**: the one wizard, "Set up {Org}". It is an offer, not a gate: the dashboard no longer redirects on `!setupCompleted` | none (own full-screen layout) | none | in-wizard "Back"; "Finish later" writes `setupDismissedAt` and goes to `/home` | Owner and Admin of an org with setup not completed or dismissed; anyone else gets the "Nothing to set up" card at the same URL |

---

## 11. Public token pages (no shell, no session)

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/meet/[code]` | talk | **keep**: the guest call door, phone-first | none | none | none; after leaving, a "You left the call" card with Rejoin | anyone holding the code |
| `/run/[token]` | process | **keep**: run a Checklist SOP from a link | none | none | none by design | anyone holding the token; unknown, expired or cancelled = the public 404 card |
| `/share/doc/[token]` | docs-knowledge | **keep** | none | none | **none, deliberately**: a shell-less page opened by someone who may have no account; the browser's own back is the way out | live token and org toggle 10 = "View only"; otherwise "This link is invalid or has been turned off." |
| `/share/sop/[token]` | process | **keep**; tokens minted before this ships stay live (the migration sets toggle 10 to "View only" for orgs holding one) | none | none | none by design | as above |
| `/sign/[token]` | process | **keep**: the contract signing page | none | none | none by design | anyone holding the token; voided or cancelled = the public 404 card |

---

## 12. Staff back-office (`admin.workwrk.com`, reduced shell: no rail)

| Route | Unit | Disposition | Hub | Sidebar row | Back target | Access |
|---|---|---|---|---|---|---|
| `/admin` | admin-backoffice | **keep**, rebuilt as Overview | none (no rail) | Overview | none (top-level) | Platform staff only |
| `/admin/companies` | admin-backoffice | **keep**, rebuilt as the Companies list page | none | Companies | none (top-level) | Platform staff |
| `/admin/companies/[id]` | admin-backoffice | **keep**: a 520 drawer over the list and a full page from a deep link, same URL; absorbs the quick-edit dialog | none | Companies | `/admin/companies` ("Companies") | Platform staff |
| `/admin/staff` | admin-backoffice | **keep** | none | Staff | none (top-level) | Platform staff |
| `/admin/analytics` | admin-backoffice | **keep**, rebuilt on honest numbers (never audited before; critic `missedRoutes`) | none | Analytics | none (top-level) | Platform staff |
| `/admin/appsumo` | admin-backoffice | **keep**, rebuilt as a list with an Import codes modal (never audited before) | none | AppSumo codes | none (top-level) | Platform staff |
| `/admin/audit` | admin-backoffice | **keep (new)**: Staff activity, the readable staff log | none | Staff activity | none (top-level) | Platform staff |

---

## 13. Removed with no successor page

| Route | Unit | Disposition |
|---|---|---|
| `/loader-preview` | shell / tools-misc / account-auth | **remove**, no redirect: a public unauthenticated dev gallery. The loader family is specified in `design-system.md` §5.15 and §5.16; the gallery becomes a Vitest snapshot plus a `NODE_ENV !== "production"` page under `src/app/(dev)/loader-preview` |
| `/marketing` | tools-misc | **remove**: 308 to `/spaces/{slug}` of the Space the importer created (marker `Space.metadata.legacySource = "marketing"`); before the import runs, 307 to `/settings/data?tab=import&legacy=marketing` for Owner and Admin and the in-shell 404 for everyone else |
| `/marketing/campaigns` | tools-misc | **remove** → the migrated Space's **Campaigns** List (`/boards/{slug}`) |
| `/marketing/content` | tools-misc | **remove** → the migrated Space's **Content** List |
| `/marketing/events` | tools-misc | **remove** → the migrated Space's **Events** List |
| `/marketing/[id]` | tools-misc | **remove** → `/item/{Campaign.customFields.migratedItemId}` when migrated, else as `/marketing` |

---

## 14. Shell-owned files with no URL of their own

Named so route coverage has no hole. Full blocks in `spec-shell` §2.

| File | Disposition |
|---|---|
| `src/app/(dashboard)/loading.tsx` | keep, rebuilt: skeleton header + rows + one value line. No overlay, no `ValueLoader` |
| `src/app/(dashboard)/error.tsx` | keep, rebuilt as `ErrorState` with a wired Retry and the digest as a reference id |
| `src/app/(dashboard)/not-found.tsx` | keep: the in-shell 404, one sentence, one "Search" text link, `BackButton{fallbackHref: hub.defaultHref}` |
| `src/app/not-found.tsx` | keep, rebuilt: the root 404 for unknown top-level paths on the app host, currently a chrome-less zinc page (critic `missedSurfaces`) |
| `src/app/global-error.tsx` | keep, restyled: the last-resort boundary (critic `missedRoutes`) |
| `src/app/icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx` | **Phase 4** (marketing brand pass). The shell asserts only that they draw the four dots from the brand hexes, because the edge runtime has no CSS variables |

---

## 15. Marketing site: Phase 4

The entire `(marketing)` route group is **Phase 4** and is not specified by any Phase 3 unit. It is listed here so no route is unaccounted for, and it keeps its own light-only chrome, its own underline nav and the consent banner (which no longer mounts inside the app).

`/(marketing)`, `/about`, `/blog`, `/blog/[slug]`, `/changelog`, `/compare`, `/contact`, `/cookies`, `/customers`, `/demo`, `/developers`, `/do-not-sell`, `/faq`, `/features`, `/features/access`, `/features/ai-engine`, `/features/analytics`, `/features/integrations`, `/features/kpis`, `/features/kras`, `/features/kudos`, `/features/okrs`, `/features/people`, `/features/reviews`, `/features/sops`, `/features/tasks`, `/help-center`, `/industries`, `/industries/healthcare`, `/industries/logistics`, `/industries/manufacturing`, `/industries/real-estate`, `/industries/sales`, `/industries/services`, `/industries/technology`, `/partners`, `/pricing`, `/privacy`, `/security`, `/terms`.

Two Phase 3 dependencies the marketing unit must honour when it lands, both already decided here: every "Start free" CTA points at `/signup` (not the 404 at `/signup` today, and not `/register`), and the consent banner mounts in `(marketing)/layout.tsx` and `(auth)/layout.tsx` only.

---

## 16. New `APP_RULES` rows the units add

`access-model-spec.md` §5.2.1 says "a key with no row does not render and its route 404s". Nine keys are named by unit specs and are not yet in the printed table. They are listed here in one place so access migration step 3 adds them together; every one is written in the access spec's own vocabulary and adds no new concept.

| Key | Route | Hub | Who sees the row and opens the route | Guest | Raised by |
|---|---|---|---|---|---|
| `templates` | `/templates` | Work | every Member browses and applies; "Save as template" needs Full access on the source; Owner, Admin and the creator delete a "Made here" template | none | spaces-lists |
| `team` | `/team` | Teams | anyone with reports (solid or dotted, any depth) over their chain; People team and Admin over the org | none | teams-people |
| `workload` | `/team/workload` | Teams | as `team` | none | teams-people |
| `weekly-reviews` | `/team/reviews` | Teams | as `team` | none | teams-performance |
| `kra-kpi` | `/kra-kpi` | Teams | every Member reads the definitions; Owner, Admin and People team create and edit | none | goals |
| `alignment` | `/team/alignment` | Teams | anyone with reports (their chain); People team and Admin (org) | none | goals |
| `kpi-reviews` | `/team/kpi-reviews` | Teams | as `alignment` | none | goals |
| `meetings` | `/meetings` | Planner | every Member (Agents included); content scoped to meetings the viewer attends or created; Owner and Admin org-wide | none | planner |
| `clock` | `/clock` | Planner | every Member (Agents included); own punches only | none | planner |

Fallback if the access unit declines `meetings` and `clock`: both routes gate on the `planner` key, since the rows live in the Planner sidebar and the audience is identical.

Two wording changes to existing rows, also for step 3: the `clips` row reads "module `ai` on; every Member" (Notetaker cannot produce anything without the AI module), and the `settings.manageIntegrations` gate rule's call-site list gains `/api/agents/*`.

---

## 17. Routes no spec covers

Everything under `(dashboard)`, `(auth)`, `(public)`, `embed`, `onboard` and `setup` has an owning unit above. What is left:

1. **The entire `(marketing)` group** (40 routes, §15) is **Phase 4**. No Phase 3 unit specifies it.
2. **`/whiteboards` and `/whiteboards/:id`** are `next.config.ts` redirects to `/canvas` and `/canvas/:id` with no page file. `docs-knowledge` §0 keeps them in one line and gives them no route block; that is sufficient, but they are flagged because no inventory ever mentioned them (critic `missedRoutes`).
3. **`src/app/icon.tsx`, `src/app/apple-icon.tsx`, `src/app/opengraph-image.tsx`** are generated brand assets with no unit spec. `spec-shell` §0 hands them to the marketing unit's brand pass: **Phase 4**. The OG copy "The operating system for teams that mean business" has never been reviewed against the current positioning.
4. **`/(dev)/loader-preview`** is created by `account-auth` as a `NODE_ENV !== "production"` replacement for the deleted public route. No unit specifies its contents beyond "the loader family from `design-system.md` §5.15 and §5.16".
