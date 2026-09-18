# Naming canon: one label per destination

Cross-unit canon, Phase 3. Compiled 2026-09-12 from the 17 unit specs. This file settles `critic-gaps.json` topSystemicIssue #9 (naming drift) for the whole product.

**The rule.** One destination carries one label, spelled identically in every place it appears: the sidebar row, the page title, the last breadcrumb crumb, the `⌘K` search result, the Create menu row, notification copy, email copy and every inbound link. A row label that differs from its page title is drift, and drift is a bug.

**Where labels live.** `src/lib/nav/labels.ts` (shell: hubs, rows, page titles) and `src/lib/access/labels.ts` (roles: Owner, Admin, Member, Guest, Agent, People team, Full access, Can edit, Can comment, Can view). `SETTINGS_PAGES[key].label` is the single source for every settings page name. No screen hand-types a destination name.

**Writing rules that apply to every label below.** Sentence case. No em dashes, no double hyphens. The middle dot "·" is the metadata separator. Never a raw enum in a string a person can read (`EMPLOYEE`, `C_LEVEL`, `MANAGER`, `hr-admin`, `IN_REVIEW`, `ON_TRACK` never appear).

---

## 1. The rail: the eight hubs

Exact labels, maximum nine characters, no two starting with the same word.

| Canon | Order | Opens (`defaultHref`) | Replaces |
|---|---|---|---|
| **Work** | 1 | `/home` | Today, Home (as a hub name) |
| **Planner** | 2 | `/planner` | Calendar (as a hub name), Time |
| **AI** | 3 | `/sidekick` | Sidekick, Brain, AI Engine |
| **Talk** | 4 | `/tlk`, or `/announcements` when the Talk module is off | TLK, Room, Chat, Comms Hub |
| **Teams** | 5 | `/people` | People (as a hub name) |
| **Docs** | 6 | `/docs` | Knowledge, Library |
| **Tables** | 7 | `/tables` | Data, Sheets, Databases |
| **Settings** | 8 | `/settings` for Owner and Admin, `/settings/members` for the People team, `/account/profile` for everyone else | Admin, Console |

The rail carries hubs only. The "Invite" button, the "Upgrade" link and the "More" (⊞) launcher tile are gone; their jobs are the Workspace menu, `/settings/billing` and Search (⌘K) respectively.

---

## 2. The collisions the critic named, settled

Every row is one of the drift clusters in `critic-gaps.json` topSystemicIssue #9, plus the six "Templates", four "Trash", three "Integrations" and three "Favorites".

### 2.1 Work · Today · Home

| Canon | Destination | Replaces |
|---|---|---|
| **Work** | the rail hub | Today, Home, "My Wrk" as a hub |
| **Home** | `/home`, the Work hub landing and the first sidebar row | Today (URL, palette "Today G T", the weekly-review crumb), "My Wrk" (sidebar row and the `/tasks` page title), Dashboard (tour copy), "Open My Priorities" (palette), the first Space overview |
| **My work** | `/my-work`, the full list of tasks assigned to me | My Wrk, My Work (the top-bar panel, the `/tasks/today-overdue` panel title, the My Wrk card), My tasks (palette, the `/tasks/[id]` back label), All Tasks (the More menu), Assigned to me, Today & Overdue |
| **Personal list** | `/my-work/personal` | Personal List, "Personal" |
| **Everything** | `/everything` | All Tasks (the More menu target), "Everything · N items" |
| **Activity** | `/activity` | My Activity (palette), Activity feed |
| **My Activity** | retired outright | the `⌘K` command re-points to Activity |

"Assigned to me" survives only as prose inside `/my-work` (its empty-state sentence and the meaning of its default view pill). It is never a row, a tab or a destination name again.

### 2.2 Talk · TLK · Room

| Canon | Destination | Replaces |
|---|---|---|
| **Talk** | the hub, the module, the page | TLK, Room, Chat, Comms Hub, "TLK, talk with your team" |
| **Call** | a real-time voice or video session. Verbs: Start a call, Join call, Leave call. Kinds: Audio call, Video call | huddle, TalkTok, "In call", "Start TalkTok" |
| **Call dock** | the floating call window | CallDock, floating huddle |
| **Guest link** | the link outsiders use | guest call link, call link, instant call |
| **Guest call** | the public page at `/meet/[code]` | guest door |
| **Private channel** | a channel not open to everyone (created with "Restricted: only people you add") | did not exist |
| **Group** | a DM with several people | group chat, group DM |
| **Message** box | what you write in | composer |
| **Thread** | a reply chain | side sheet |
| **Close** | hiding a DM without deleting history | close conversation |
| **Announcements** | `/announcements` | Announce (the folded app label), Broadcast |

The URL stays `/tlk`; a URL is not a label. `workwrk:room:*` localStorage keys are renamed `workwrk:talk:*`.

### 2.3 Board · List

| Canon | Replaces |
|---|---|
| **List** | Board, "List (Board)", "New Board" (`NewBoardDialog`), the Space Board tab's "board" |
| **view** (saved view) | tab, view tab. "Board view" is the kanban renderer of a List, never an object |
| **Sprint** | Sprint board, Sprint list. A Sprint is a List with a start and end date, never a separate object |
| **New list** / **New folder** / **New Space** | Create Board, Create List, Add List |

`Space` and `Folder` are unchanged and were never in drift.

### 2.4 Task · Item · row

| Canon | Replaces |
|---|---|
| **Task** | Item, row ("Archive row", "created this row", "renamed row"), Board item, "Task" as the legacy `/tasks/[id]` object |
| **Create task** | Quick task, New task, Create Task, "+ Task", Add Task, New item. The modal title becomes "Create {Type}" when a non-default type is chosen |
| **Assignees** | Owner (on a task; the first assignee is still the DRI in data) |
| **Due date**, **Start date** | Dates |
| **Priority**: Urgent · High · Normal · Low · None | the legacy Critical / Medium set |
| **Type** | Task Type, task type chip |
| **Estimate** | Time estimate |
| **Time tracked** | Track time |
| **Tags** | Labels |
| **KRA / KPI** | Alignment (the taupe chip) |
| **Watchers** | Followers |
| **Subtasks**, **Checklist**, **Attachments**, **Related** | "Relate items or add dependencies", "Linked attachments/relations" |
| **Comments**, **Activity** | Updates, Activity strip |
| **Archive** (reversible) / **Delete** (to Trash) | "Archive row", `?hard=1` |
| **Move to list…** | Move to |
| **Copy link** | Copy share link |

### 2.5 Doc · Note · Page

| Canon | Destination | Replaces |
|---|---|---|
| **Doc** | the object and its hub rows | Note, Page, Untitled note, New Doc, New page, Notes |
| **sub-doc** | a doc nested under another doc | child page, nested note |
| **Notepad** | the personal sticky note in the Create menu | kept on purpose: it is a different thing (owner-only, never shared) |
| **Views on `/docs`**: All · Recent · Mine · Shared with me · Favorites | All Docs, My Docs, Created by me, Private, Meeting Notes, Archived |
| **Library** | **retired as a word.** It named a page, a sidebar and an app key. The page redirects to `/docs`, the sidebar is deleted, and the key survives only as an internal gate name for `/files`. Breadcrumbs, menus and search never print it |

### 2.6 Canvas · Whiteboard

| Canon | Replaces |
|---|---|
| **Canvas** | Whiteboard, Whiteboards, Canvases gallery, Mind Map (the mind-map tile creates the same object) |
| **Canvases** | the list page at `/canvas` |

The internal `Whiteboard` model and `/api/whiteboards` are untouched; `/whiteboards*` keeps redirecting to `/canvas*`.

### 2.7 Database · Table · Sheet

| Canon | Replaces |
|---|---|
| **Table** | Sheet, New sheet, Spreadsheet, Untitled spreadsheet, Database, Worksheet, "CSV → Database", "Table (monday)" |
| **Untitled table** | Untitled spreadsheet (both existed) |
| **Column** and **Row** | field (when talking about a table) |
| **Field** | question (the form builder only) |
| **Form** | pinned, no drift today |
| **Response** | Submission, Submissions (`formSubmission` stays the model name and is never shown) |
| **Goes to** | Send to board, Send to table, Target. It is the user's word for what the access model calls the form's **anchor**; "anchor" is never printed |
| **Import a CSV** | Import CSV, CSV → Database, Upload |

`Fields` is the canon for a List's custom properties (replacing Columns, Custom Fields, Properties); the Table renderer's own panel keeps the word "Columns" inside its title "Columns shown", because there the object really is a column.

### 2.8 Departments · Functions

| Canon | Destination | Replaces |
|---|---|---|
| **Departments** | `/people/departments` and Settings › Structure › Departments | Functions, "Functions (Departments)", Function (dialog, toasts, the Job title picker), org units |
| **Job titles** | `/people/roles` | Roles, Roles library, Role definition, Job title library |
| **Job title** | `/people/roles/[id]` (the page title is the title itself) | Role definition, Role workspace, Role page |
| **Seniority** | the `Role.level` field, display only | Level, Access level on a job title |
| **Skills** | `/people/skills` | Skills matrix, Skills taxonomy |
| **Org chart** | `/organization` | Organization, Reporting hierarchy, Hierarchy (`/settings/hierarchy`), Org structure |
| **Directory** | `/people` | People, Who's who, All people |
| **Reports to** | `User.managerId` | Manager, Reporting manager, Reports To |
| **Dotted-line manager** | `UserDottedLine` | Dotted, Matrix manager |

"Role" survives in one vocabulary only: access. Owner, Admin, Member and Guest are **org roles**; Full access, Can edit, Can comment and Can view are **object roles**. The word never names a job title again.

### 2.9 Contracts · Agreements

| Canon | Destination | Replaces |
|---|---|---|
| **Contracts** | `/agreements` (the URL keeps its name) | Agreement(s), envelope, All contracts |
| **Contract template** | `/agreements?view=templates` | "Template" alone inside Contracts |
| **Party**, **Signer** | the people on a contract | recipient, counterparty |
| **Send for signature** | the action | Send to signers |
| **Signing link** | the per-party link | Copy view link, Signing links |

### 2.10 Marketplace · Store

| Canon | Destination | Replaces |
|---|---|---|
| **Marketplace** | `/store` (the path keeps its name; a URL is not a label) | Store, Product Store, App marketplace |
| **Build apps** | `/build` | Build, Vibe ("Built with Vibe"), Studio |
| **Integrations** | `/integrations`: the catalogue of other people's tools every Member browses and can request | Connect apps, Integrations marketplace, App marketplace |
| **Connections** | `/automation/connections`: where automations send things, today the webhook | Integrations (as a name for this page), Connectors, Providers |

The word **install** leaves the product. A module is **turned on** or **turned off**; a connector is **connected**; an app you built is **published**. "Install" survives only in the API path `/api/products/installations`, which nobody reads.

### 2.11 Templates: six become one

| Canon | Destination | Replaces (the six) |
|---|---|---|
| **Templates** | `/templates`, the one Template Center for every kind (Doc, Canvas, Starter kit, Task, List, Space) | 1. the legacy "Workspace templates" page (`/api/workspace-templates`, whose bundles become the "Starter kits" kind); 2. the three hardcoded doc-template cards on `/docs`; 3. `note-templates.tsx` as a separate list; 4. the "From template" submenu's hardcoded entries; 5. `/api/item-templates` behind the create-task modal footer (re-pointed to `/api/template-center?kind=TASK`); 6. the Space quick-start tiles |
| **Template** | one saved template | "Starter kit" is one **kind** of template, not a separate concept |
| **Browse templates** | the verb phrase on menu rows that open the Template Center scoped to a container | Browse, Use a template |
| **Save as template** | the action on a container (needs Full access on the source) | Save template, Make template |

Two things are **not** "Templates" in this sense and never link from `/templates`: **Contract templates** (`/agreements?view=templates`, a contract is not a workspace object) and **Templates** in the AI hub (`/automation/templates`, automation recipes). Each keeps its own label inside its own hub, and neither is reachable from the Template Center.

`/templates` lives in the **Work** hub with a row in the Work sidebar's personal block. Settings › Task system › Templates is a link card pointing at `/templates?kind=task`; the Docs header "+" carries "Browse templates" pointing at `/templates?kind=doc`.

### 2.12 Trash: four become one

| Canon | Destination | Replaces (the four) |
|---|---|---|
| **Trash** | `/trash`, one page, one label, in the **Work** hub, filtered by `?type=` | 1. the org Trash at `/trash`; 2. the notes trash at `/docs/trash` (308 to `/trash?type=doc`); 3. the Docs "Archived" view (`/docs?view=archived`, same 308); 4. the Contracts "Trash" view (`/agreements?view=trash` → `/trash?type=contract`) |
| **`?type=` values** | space · folder · list · task · doc · canvas · table · **form** · file · **contract** | Form and Contract are added to the filter; Form because forms become deletable for the first time, Contract because the Contracts trash view merges in |
| **Delete permanently** | the destructive action, **inside Trash only** | Delete forever, Purge |
| **Archive** (verb) | making a container inactive but restorable | Hide, Close (for containers) |

There is **no second Trash row** in any other hub sidebar. The Docs sidebar's Trash row and the Tables hub's proposed Trash row both point at the same `/trash` with a pre-set `?type=`; the Tables hub carries no row at all and reaches it from the toolbar "…". **Deleted rows inside a table** are not app Trash: they stay in that table's own Data › Trash dialog (60 days, restore in place), because a row has no page, no name and no location outside its table.

### 2.13 Integrations: three doors become two, each with one job

| Canon | Destination | Who | Replaces |
|---|---|---|---|
| **Integrations** | `/integrations` (AI hub) | every Member browses; connecting needs Owner or Admin | the `/settings/integrations` hub of stubs (308 to `/settings/api`), "App marketplace", "Connect apps" |
| **Connections** | `/automation/connections` (AI hub) | Owner and Admin | the four fake provider Connect buttons, "Integrations" as a name for this page |
| **API & webhooks** | `/settings/api` | Owner, or Admin with the `security` scope | "Integrations" (the settings sidebar row), "API keys" |
| **Calendar & connections** | `/account/connections` | every signed-in person | Calendar integrations, Calendar feeds, Calendar, External calendars, `/settings/calendar` |

Neither AI page repeats the other's rows: the four providers the old Connections page faked (WhatsApp, Gmail, Google Calendar, Slack) are deleted from it and live on `/integrations` as real "Request this" cards.

### 2.14 Favorites: three become one

| Canon | Destination | Replaces (the three) |
|---|---|---|
| **Favorites** | the FAVORITES section in a hub sidebar, plus the page at `/favorites` | 1. "Favorites" the Sidekick-pins page (the chats move to `/sidekick?pinned=1`); 2. "Top pins" (`TopPinsStrip` and `/api/me/pins`, whose rows migrate into favorites and whose strip is deleted); 3. "Starred" |
| **Add to favorites** / **Remove from favorites** | the menu row on every object | Favorite, Star, Pin, Favorite › Sidebar, Favorite › Top |
| **Star** | the verb on the icon's tooltip only | |
| **See all favorites** | the ghost row at the end of the Work sidebar's FAVORITES section, which opens `/favorites` | |

A task is **not** a favourite kind. Favorites covers Spaces, Folders, Lists, Docs, Tables, Canvases and Files. The "Favorite" row in the task menu was a toast stub and is deleted; a task you care about is in My work.

"Pinned to top" survives as a different, shell-level feature name and never uses the word Favorites. "Pin view" is a personal ordering of saved-view tabs and likewise never says Favorites.

### 2.15 Reviews: five things, five names

"Review" as a bare word is never a label again.

| Canon | Destination | Replaces |
|---|---|---|
| **Weekly reviews** | `/team/reviews`, the manager's queue | Reviews (the sidebar row, page title and breadcrumb), Team reviews, Review queue |
| **Weekly review** | `/me/weekly-review`, the employee's own | My weekly review, My review (on the profile Reviews tab), Weekly heartbeat |
| **Review cycles** | `/reviews`, the list of appraisal cycles | Reviews (the catalog label), Performance reviews, Appraisals |
| **My review** | the subject's section of a cycle | Self assessment, Self-Assessment |
| **Manager review** | the reviewer's form for one person | Team Reviews (the tab), Manager assessment |
| **Calibration** | the calibration section of a cycle | In calibration, Calibrate (the step keeps the short word) |
| **Peer feedback** | the peer section | 360 feedback |
| **KPI reviews** | `/team/kpi-reviews`, the manager's monthly KPI job | KPI approvals, KPI review, KPI review cycle, `/kra-kpi/review` |
| **Alignment** | `/team/alignment` | Alignment board, Team alignment |
| **Sub-teams** | `/team/rollup`, a view of Alignment | Rollup, director rollup |
| **Talent (9-box)** | `/talent`, the sidebar row | Talent grid, 9 box, Succession |
| **Talent** | the `/talent` page title | |

### 2.16 Sidekick · Brain · AI

| Canon | Destination | Replaces |
|---|---|---|
| **Ask AI** | the assistant everywhere: the `/sidekick` page, the ⌘J panel, the page-header slot, the palette row, the Create-menu row, the task and canvas entry points | Sidekick, Brain, "Ask the Brain", "Ask Sidekick", AI Engine, Super Agent, "Super Agent · Hot", Create with AI |
| **Agents** | `/agents`. One row is an agent: an AI teammate that does a job on a schedule | Hire, Hired, AI teammates |
| **Workflows** | `/automation/workflows`. One row is an automation | Autopilot, Rules, Automations (as a page name), Manage |
| **Automation** | the sidebar section label and the breadcrumb crumb | Automation Hub, Autopilot |
| **New automation** | the blue button on Workflows | New rule, Create workflow, "+ Automation" |
| **Alert level** | the workflow field | Severity, "Severity (for Health)" |
| **Archive** | what the chat and workflow destructive action actually does | Delete (the word the UI used while the API archived) |

"Sidekick" survives only in the URL `/sidekick` and in internals (`ChatSession`, `/api/sidekick/*`). No user-visible string says it.

### 2.17 Clips · Notetaker

| Canon | Destination | Replaces |
|---|---|---|
| **Notetaker** | `/notetaker`, the page and the Docs sidebar row | Clips, All Clips, My Clips, AI Notetaker, `/clips` (a dead href) |
| **Meeting note** | what Notetaker produces (saved as a Meeting) | clip, transcript result |

The `clips` catalog key survives as the internal gate name for `/notetaker` and is never printed.

### 2.18 Me · My Profile

| Canon | Destination | Replaces |
|---|---|---|
| **My profile** | `/people/me` (a server redirect to `/people/{me}`): the Teams sidebar row and the avatar-menu row | Me (the Work sidebar row), My Profile, "My KRAs & KPIs" (as a name for the whole page), career home, the "My Profile" eyebrow |
| **My KRAs & KPIs** | `/people/me?tab=kras`: the Work sidebar's jump-out row and the tab itself | Me, My Profile › KRAs & KPIs, My alignment |
| **Person** / the person's name | `/people/[id]` | Profile, Career home, Person card |
| **Profile** | `/account/profile`, inside My settings | My Profile (which belongs to `/people/me`), Personal info, Edit personal info |

Two labels, two URLs, no collision: **My profile** is the person record, **Profile** is the personal settings page, **My KRAs & KPIs** is a tab of the first. For a **Guest** the avatar menu's "My profile" row points at `/account/profile` instead, because a Guest never sees the Teams hub. The label does not change; the destination does.

---

## 3. Shell chrome

| Canon | Destination | Replaces |
|---|---|---|
| **Search** | the top bar's centre field and ⌘K | Command palette, Jump to |
| **Create** | the top bar's "+" | Quick tools, Personal Tools, quick task icon |
| **Inbox** | `/inbox` and the bell's first tab | Notifications (the avatar-menu row, which now goes to My settings › Notifications) |
| **Reminders** | the bell's second tab | alarm, Reminder (as a place) |
| **Mentions** | `/inbox?tab=mentions` | Mentions inbox (`/me/mentions`) |
| **Help** | the "?" menu | Support |
| **Log out** | the avatar-menu row | Sign out, Sign Out |
| **Log in** | the verb, the button and the page title | Sign in, "Sign in →", Welcome back |
| **Start free** | the CTA that opens `/signup` | Register, Create account, Sign up, Start your free trial |
| **Join {Org}** | the `/join` page title and button | Join team, Accept invitation, Register |
| **Set up {Org}** | `/onboard` | Setup, Onboarding, Get started, Welcome |
| **Switch workspace** | the workspace-menu action | Switch org, Change organization |
| **Customize Sidebar** | the one sidebar footer button | Customize navigation |
| **My settings** | the personal door | Settings, Personal, Account, Account settings |
| **Workspace settings** | the org door | Settings (when it meant the admin door), Admin, Organization settings, Org settings |

---

## 4. Settings pages

Every label below is `SETTINGS_PAGES[key].label` and is read by the sidebar row, the page title, the breadcrumb crumb, the `⌘K` result and every Overview card.

| Canon | Route | Replaces |
|---|---|---|
| **Overview** | `/settings` | Settings, Settings home |
| **Identity & culture** | `/settings/identity` | Identity & profile, Identity & company profile, Company profile, Defaults & locks (now a tab) |
| **Locale & work week** | `/settings/locale` | Locale & finance, Locale |
| **Apps & modules** | `/settings/apps` | Apps, Enabled modules, Modules |
| **Members** | `/settings/members` | Team, People (in a settings context) |
| **Structure** | `/settings/structure` | Org structure, Organization structure |
| **Access** | `/settings/access` | Roles & permissions, Access Control, Permissions, Access levels |
| **Task system** | `/settings/tasks` | Task types, Tags & labels |
| **Scoring & reviews** | `/settings/scoring` | unchanged |
| **Security** | `/settings/security` | Session & 2FA, Password policy, Org policy |
| **Data** | `/settings/data` | Data & compliance, Import / Export, Export |
| **Audit log** | `/settings/audit` | unchanged |
| **API & webhooks** | `/settings/api` | API keys, Integrations (the settings row) |
| **Plan & billing** | `/settings/billing` | Billing, Upgrade (as a destination) |
| **All settings** | `/settings/all` and `/account/all` | the sidebar's own "All settings" heading, which is deleted as a heading |
| **Profile** | `/account/profile` | (see §2.18) |
| **Preferences** | `/account/preferences` | Appearance, Themes, Display |
| **Notifications** | `/account/notifications` | |
| **Security** | `/account/security` (page title) | "Account · Security" |
| **Calendar & connections** | `/account/connections` | (see §2.13) |
| **Keyboard shortcuts** | `/account/shortcuts` | Shortcuts |

Plus the vocabulary these pages carry: **People team** (replacing HR, HR admin, hr-admin tier), **Sign-in policy** (replacing Password policy plus Session & 2FA as two cards), **Two step verification** (replacing 2FA, MFA, Two-factor auth, Authenticator app; `MFA` never appears in a user-facing string), **Backup codes** (replacing Recovery codes, One-time codes), **Log out everywhere** (replacing Sign out of all devices).

---

## 5. Access vocabulary (never varied, anywhere)

Four org roles, four object roles, two states, one flag, one team. Every dialog, chip, list, menu and API response uses these exact words.

| Canon | Never |
|---|---|
| **Owner · Admin · Member · Guest** | SUPER_ADMIN, COMPANY_ADMIN, C_LEVEL, VP, DIRECTOR, HR, MANAGER, TEAM_LEAD, EMPLOYEE, AGENT, org-admin, hr-admin, tier |
| **Agent** (a flag on a Member) | a fifth role |
| **People team** | HR, HR admin |
| **Full access · Can edit · Can comment · Can view** | Owner/Admin/Member/Guest on an object, Editor, Viewer, Contributor, Full edit |
| **Share** | Sharing & Permissions, Members (as a dialog name), Manage access |
| **Who has access** | the read-only Share dialog |
| **Restricted** | Private (on Folders, Lists, Channels and SOP folders) |
| **Everyone at {org}** | Org-wide, Workspace-visible, Public (inside the org) |
| **Findable by everyone** | discoverable, searchable |
| **Request access** | Ask for access, Request permission |
| **Active · Deactivated** (a person) | Inactive, Disabled, Suspended (as a person state) |
| **Removed** (a person) | Former, Terminated, Offboarded |
| **Invite** | Add person (the menu row keeps "Invite person" as a verb phrase; the Directory button reads "Invite") |
| **Import people** | People CSV, Bulk import, Employee import |

Blurbs, verbatim, wherever a role select appears: Full access "Change settings, sharing, delete and transfer." · Can edit "Add and change tasks, docs and rows." · Can comment "Read and discuss, never change." · Can view "Read only."

---

## 6. Status words

One vocabulary per object, sentence case, rendered as a pale `StatusChip` with a 6px dot.

| Object | Statuses |
|---|---|
| SOP, policy | Draft · In review · Approved · Published · Archived |
| Review cycle | Draft · Active · In calibration · Completed · Cancelled |
| One person's review | Not started · Self review done · Manager review done · Calibrated · Completed |
| Weekly review | Waiting on you · Approved · Changes requested · Draft |
| Candor session, Survey | Draft · **Open** · Closed (the database value `ACTIVE` is untouched; an employee reads "Open" as "you can answer this") |
| Goal | On track · At risk · Off track · Completed (replacing Behind, Slipping, "Needs a nudge") |
| Company | Active · Trial · Suspended · Cancelled (staff console) |

Process verbs: **Acknowledge** (past tense "Acknowledged on {date}") replaces Mark as read, Ack, Attest. **Start run** / **Continue run** for a Checklist SOP; **Present** replaces "Walk through" for the read-only stepper on other kinds. **Assign** and **Assignee** replace "Assign to People" and "recipients".

---

## 7. Staff console (`admin.workwrk.com`)

| Canon | Replaces |
|---|---|
| **Staff console** | WorkwrK Admin, "WorkwrK Staff · Platform back-office", the back-office, admin panel |
| **Overview** | Dashboard, Admin Dashboard, "Platform overview and subscriber management" |
| **Companies** | Subscriber Companies, orgs, tenants |
| **a company** (one row) | organization, org, subscriber, tenant |
| **their workspace** (what a company uses) | their org, their account, their instance |
| **Analytics** | Platform Analytics |
| **AppSumo codes** | AppSumo Codes, Lifetime deals |
| **Staff** | Platform Staff, the platform-staff allowlist, WorkwrK employees |
| **Staff activity** | new |
| **Plan · Seats · Modules · Enterprise add-ons** | tier, user cap, licence count, premium modules, products, installations, ClickApps, enterprise feature flags |
| **WorkwrK Support** | the actor name written into a customer's audit log for a staff change; never an employee's name |

Elsewhere in the product the tenant is a **workspace**; here the row is a **company** and the thing it uses is **their workspace**. Those two words are the whole vocabulary.

---

## 8. Labels retired outright

No destination carries these words anywhere in the product after Phase 3:

Today · My Wrk · All Tasks · Assigned Comments · Drafts & Sent · TLK · Room · TalkTok · huddle · Announce · Board (as an object) · Whiteboard · Database · Sheet · Spreadsheet · Note (as an object) · Page (as an object) · Library · Clips · My Clips · AI Notetaker · Sidekick (in UI) · Brain · AI Engine · Super Agent · Autopilot · Rules · Store (as a label) · Vibe · Studio · Functions · Roles (as job titles) · Agreements (as a label) · Recycle bin · Archived (as a place) · Pins · Top pins · Starred · Me (as a row) · Ideas (as a page) · Marketing (as an app) · Instant call · Install · HR · hr-admin · tier · Severity · Followers · Alignment (as a task field).
