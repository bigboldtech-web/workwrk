# WorkwrK unified access model, proposal C: Role templates

Stance: a small set of capability bundles (Org Admin, HR Admin, Manager, Employee, Guest, Agent) that an org can clone into custom roles, object sharing (Owner / Can manage / Can edit / Can view) layered on top, and one policy engine that resolves capability + object grant + manager chain in a fixed precedence. The permission matrix survives only as the editor of those bundles, and every cell in it is either enforced by a named gate or deleted. Target: 200 to 2000 seats, zero training for the admin who sets it up, ClickUp-grade fundamentals for the security reviewer who audits it.

Date: 2026-09-11. Repo: `/Users/bigboldtechnologies/theywrk`. All file paths are repo-relative. Written against the audit inventory (`access-model.md`, `settings-pages.md`, `critic-gaps.json` issues #4 and #7) and the code as it is at `6187227a`.

---

## 0. One-page summary

| Today (seven systems) | Proposed (one engine, three inputs) |
|---|---|
| 10-rung `AccessLevel` enum, 25 hand-copied tier sets | 6 system roles + org-cloned custom roles; each role is a list of capabilities; one `caps` set on the viewer |
| Permission matrix (16 modules, 79 cells, ~20 enforced) | 34 capabilities, each with exactly one server enforcement point; the matrix page becomes the role editor |
| `access.ts` (pages) vs `board.ts`/`space.ts`/`folder.ts`/`doc-access.ts`/`sop-access.ts` (APIs) | `src/lib/authz/*`: `resolve()` is the only decision function; the old helpers become wrappers, then are deleted |
| SpaceMember / FolderMember / BoardMember / SOPFolderAccess / ConversationMember, three label vocabularies | Same tables, one enum meaning, one vocabulary: Owner, Can manage, Can edit, Can view |
| PRIVATE / WORKSPACE / ORG (two of them identical at read time) | Private / Discoverable / Open, each with a distinct read-time meaning (`discover` is a real decision level) |
| Rail tiers (`manager` / `hr-admin` / `org-admin`) display-only, four redirect idioms | Nav, page and API all read the same decision; hidden is the permission; one denial convention (404 or in-place locked view, never a redirect) |
| Manager tree via `reportsTo`, HR segments dead | Manager chain stays as the third input for people data; HR Admin = org-wide people capability; HRSegment deleted |
| No guest account; Space email invite mints an EMPLOYEE | Guest and Agent are real roles with hard ceilings; Space email invite creates a Guest |

Three inputs, one order:

1. Capability (from the viewer's org role): does this person get to do this kind of thing at all.
2. Object grant (direct or inherited): what level does this person hold on this object.
3. Manager chain: for people data only, is the target inside my reporting tree.

The engine returns `{ level, reason, via, requestable }`. Everything (rail, sidebar, page, API, share dialog, "Check access" panel) renders from that one answer.

---

## 1. Concepts and vocabulary

### 1.1 Three things that were conflated, now separated

| Concept | What it answers | Stored where | Edited where |
|---|---|---|---|
| **Org role** (capability bundle) | Which doors open: can you invite, run reviews, see the directory, change settings | `OrgRole` (new) + `User.orgRoleId` | Settings > Members & roles |
| **Job title** (`Role` model, `/people/roles`) | What the person is accountable for: KRAs, KPIs, SOPs, ownership areas | unchanged | Teams > Roles, renamed "Job titles" |
| **Object role** (share level) | What you can do to this Space / Folder / List / Doc / Table / SOP folder / Channel | `SpaceMember`, `FolderMember`, `BoardMember`, `ConversationMember`, `ObjectGrant` (new, for leaf objects), `SOPFolderAccess` migrated into `ObjectGrant` | The one Share dialog |

`Role.level` (job title carrying an `AccessLevel`) is dropped. A job title never changes anyone's access. The `/people/roles` empty-state copy that claims otherwise is deleted.

### 1.2 Decision levels

`none < discover < view < edit < manage < owner`

| Level | Meaning | Object-role label |
|---|---|---|
| `none` | Does not exist for this viewer. Pages 404, lists omit it, search omits it. | |
| `discover` | Can see that it exists (name, icon, owner, member count) and can request access. Cannot open it. | |
| `view` | Open and read everything inside; comment where comments exist. | Can view |
| `edit` | Create and change content inside (tasks, updates, docs, rows, messages). Cannot rename, delete, restructure, or change sharing beyond their own level. | Can edit |
| `manage` | Everything in edit plus rename, settings, statuses, fields, views, archive, share at any level up to manage. | Can manage |
| `owner` | Everything in manage plus delete, transfer ownership, and see Private children. Exactly one Owner per container is not enforced; at least one is. | Owner |

Mapping onto the existing `SpaceRole` enum (no schema change): `OWNER = owner`, `ADMIN = manage`, `MEMBER = edit`, `GUEST = view`. The enum names stay in the database; the UI never shows them. `SOPFolderRole` is retired: `VIEWER = view`, `EDITOR = edit`, `OWNER = owner`.

Comment-only access is not a separate level in v1. "Can view" includes commenting on objects that have comment threads (items, docs). If the founder wants a strict view-no-comment level later it slots in between `view` and `edit` without touching precedence.

### 1.3 Visibility (general access) per container

| Value (DB) | Label in UI | Non-members get | Members get |
|---|---|---|---|
| `PRIVATE` | Private | `none` | their grant |
| `WORKSPACE` | Discoverable | `discover` (listed with a lock, can request access) | their grant |
| `ORG` | Open to everyone | the container's `defaultPermission` (`view` or `edit`, org-wide setting picks the default) | their grant, never lower than the default |

This gives `WORKSPACE` a meaning it lacks today (audit 3.12) without a data migration. `Space.settings.defaultPermission` becomes enforced (audit 3.9): it is the level an Open container hands to non-members and the level a newly added member gets when the sharer does not pick one. Allowed values collapse from four (Full edit / Edit / Comment / View) to two (`edit` / `view`).

Visibility exists on Space, Folder and List (Board) as today. Folder visibility becomes editable after creation (audit 3.10) through the Share dialog's General access control.

---

## 2. Org roles

### 2.1 The six system roles

Every org has these six. They cannot be deleted; their capability lists can be edited (except Org Admin, which is fixed so an org cannot lock itself out). An org can clone any of them into a custom role ("Executive", "Finance lead", "Contractor") and edit the clone.

| Role | Who it is for | Who can grant it | Ceiling on object roles | Seat |
|---|---|---|---|---|
| **Org Admin** | The people who run the workspace: founder, IT, ops lead | Org Admin only; last Org Admin cannot be demoted or deactivated; self-demotion needs typed confirmation | none (implicit `manage` everywhere, `owner` on nothing they do not own) | yes |
| **HR Admin** | People operations: sees and edits people data org-wide, runs reviews and culture programs, no workspace settings | Org Admin | Owner | yes |
| **Manager** | Anyone with reports. People data for their tree, full work OS, can invite | Org Admin, HR Admin | Owner | yes |
| **Employee** | Everyone else on payroll | Org Admin, HR Admin, Manager (Manager may only invite as Employee or Guest) | Owner | yes |
| **Guest** | External collaborators: clients, vendors, auditors, contractors on one project | Anyone with `people.inviteGuest` (default: Manager and above; org toggle can open it to Employees) | Can edit; never Owner or Can manage on a Space; may be Can manage on a List or Folder | no |
| **Agent** | Restricted workers: frontline staff, BPO agents, kiosk users, and non-human principals (API keys, AI agents) | Org Admin, HR Admin | Can edit; cannot create Spaces, Folders or Lists at top level | yes (humans), no (principals) |

Why six and not ten: TEAM_LEAD and MANAGER have identical defaults everywhere today; C_LEVEL, VP and DIRECTOR differ from MANAGER only in org-wide alignment/directory reach and the Rollup page. Seniority is a job-title fact, not a permission. Orgs that want executives to see the whole org clone Manager into "Executive" and tick three capabilities (`people.viewOrg`, `alignment.viewOrg`, `analytics.viewOrg`). The migration does this automatically for orgs that have C_LEVEL/VP/DIRECTOR users (section 8).

SUPER_ADMIN is not a tenant role. Platform staff already live in `PlatformAdmin`; the tenant UI stops offering SUPER_ADMIN anywhere (audit 3.4). Existing SUPER_ADMIN users migrate to Org Admin.

### 2.2 Capability catalogue

Thirty-four capabilities. Each has exactly one server enforcement point (the gate), one nav consumer (the rail, a sidebar section, or a Settings row), and appears in the role editor under an area heading. Defaults per system role: A = Org Admin, H = HR Admin, M = Manager, E = Employee, G = Guest, X = Agent.

| Area | Capability | What it unlocks | Enforced at | A | H | M | E | G | X |
|---|---|---|---|---|---|---|---|---|---|
| Work | `work.createSpace` | Create a Space (becomes its Owner) | `POST /api/spaces` | y | y | y | y | n | n |
| Work | `work.createOpenSpace` | Set a Space to Open to everyone | `PATCH /api/spaces/[id]` visibility, `POST /api/spaces` | y | y | y | n | n | n |
| Work | `work.shareExternal` | Share any object with a Guest | Share dialog add-guest path, `POST .../members` when target is Guest | y | y | y | n | n | n |
| Work | `work.manageTemplates` | Create/edit org templates and task types | `/api/template-center` writes, `/api/item-types*` writes | y | y | y | n | n | n |
| Work | `work.manageTags` | Create/rename/archive org tags | `/api/tags*` writes | y | y | y | n | n | n |
| Work | `work.trash` | Open Trash, restore and purge for objects they can manage | `/trash`, `/api/trash*` | y | y | y | y | n | n |
| People | `people.viewDirectory` | See the org directory (name, avatar, title, department) and use the full-org people picker | `GET /api/directory` (new), `/people` | y | y | y | y | n | n |
| People | `people.viewTree` | Open profiles, KRAs, KPIs, reviews, timesheets, goals of people in my reporting tree | `resolve(user)` chain rule | y | y | y | n | n | n |
| People | `people.viewOrg` | Same, for everyone in the org | `resolve(user)` | y | y | n | n | n | n |
| People | `people.editProfiles` | Edit employment fields (title, department, manager, office, status) for people I can view | `PATCH /api/users/[id]` non-self fields | y | y | y (tree) | n | n | n |
| People | `people.invite` | Invite members as Employee, Manager (HR Admin+) or Agent | `POST /api/invitations`, `POST /api/users` | y | y | y | n | n | n |
| People | `people.inviteGuest` | Invite a Guest by email | `POST /api/invitations` with role Guest, Space email invite | y | y | y | n | n | n |
| People | `people.deactivate` | Deactivate or delete people | `DELETE /api/users/[id]`, status PATCH | y | y | n | n | n | n |
| People | `people.assignRoles` | Change someone's org role (never above your own) | `PATCH /api/users/[id]` orgRoleId | y | y | n | n | n | n |
| People | `people.manageStructure` | Departments, offices, job titles | `/api/departments*`, `/api/offices*`, `/api/roles*` writes | y | y | n | n | n | n |
| Alignment | `alignment.manage` | Create/edit/delete/assign KRAs and KPIs for people I can view | `/api/kras*`, `/api/kpis*`, `/api/kra-assignments*` writes | y | y | y (tree) | n | n | n |
| Alignment | `alignment.viewOrg` | Read alignment data org-wide (Rollup, org KRA library) | `visibleAlignmentUserIds`, `/team/rollup` | y | y | n | n | n | n |
| Alignment | `goals.create` | Create goals | `POST /api/okrs` | y | y | y | y | n | n |
| Alignment | `reviews.run` | Create, launch, close review cycles; see cycle results for people I can view | `/api/reviews*` cycle writes, `/reviews` | y | y | n | n | n | n |
| Alignment | `reviews.finalize` | Write manager reviews and finalize for my tree | `.../manager-review` routes | y | y | y | n | n | n |
| Knowledge | `knowledge.createSop` | Create SOPs (draft) | `POST /api/sops*` | y | y | y | n | n | n |
| Knowledge | `knowledge.publishSop` | Publish and assign SOPs | `PATCH /api/sops/[id]` status, `/api/sop-assignments` | y | y | y | n | n | n |
| Knowledge | `knowledge.managePolicies` | Policies and Contracts: create, publish, assign, see acknowledgements | `/api/policies*`, `/api/agreements*` writes and admin reads | y | y | n | n | n | n |
| Culture | `culture.run` | Announcements, surveys, candor, kudos administration (create, launch, close, see results) | `/api/announcements*`, `/api/surveys*`, `/api/candor*` admin writes | y | y | n | n | n | n |
| Assets | `assets.manage` | Tools and Assets registry (everyone always sees their own) | `/api/assets*`, `/api/tools*` writes and org-wide reads | y | y | n | n | n | n |
| Talk | `talk.createChannel` | Create channels (DMs are always allowed between people who can see each other) | `POST /api/conversations` kind=channel | y | y | y | y | n | n |
| Talk | `talk.announce` | Post to the org announcement channel | announcements POST | y | y | n | n | n | n |
| Automation | `automation.manage` | Create and edit automations on objects they can manage | `/api/automation*` writes | y | y | y | n | n | n |
| Analytics | `analytics.view` | Analytics pages, scoped by `people.viewTree` / `people.viewOrg` | `/analytics`, `/api/analytics*` | y | y | y | n | n | n |
| Settings | `settings.workspace` | Identity, locale, apps, modules, defaults, task types, security policy | `/settings/{identity,locale,apps,modules,defaults,security}` + APIs | y | n | n | n | n | n |
| Settings | `settings.roles` | Members & roles page: edit role bundles, create custom roles | `/settings/members` roles tab, `/api/org-roles*` | y | n | n | n | n | n |
| Settings | `settings.billing` | Plan, invoices, Stripe portal | `/settings/billing`, `/api/billing*` | y | n | n | n | n | n |
| Settings | `settings.integrations` | API keys, SCIM, SSO, calendar feeds | `/settings/api`, `/api/keys*`, `/api/scim-tokens*` | y | n | n | n | n | n |
| Settings | `data.export` | Data & compliance exports, audit log | `/settings/data`, `/settings/audit`, `/api/audit*`, `/api/export*` | y | y (people exports only) | n | n | n | n |

Implicit for every authenticated role, not editable: `self.*` (own profile, own goals, own reviews, own timesheets, own notepad, own notifications), `work.contribute` inside objects where they hold `edit`, module use once the org has the module on (Talk/Tables entitlement is org-level, not per role).

Org Admin also carries the implicit `org.admin` flag: `manage` on every object in the org (never `owner`, so ownership transfer and deletion of someone else's Space are explicit acts logged under their name), plus the Admin door. It is not a capability in the editor; it is the definition of the role.

### 2.3 The Guest story

A Guest is a person outside the company who needs to work on something specific.

- Created by: the Share dialog's "Invite by email" (default role Guest), or Members & roles > Invite > Guest. Requires `people.inviteGuest`. The Space email invite route (`api/spaces/[id]/invitations/route.ts:136,159`) stops minting EMPLOYEE (audit 3.6).
- Sees: only objects explicitly shared with them (List, Folder, Doc, Table, Whiteboard, Channel, or a Space at up to Can edit), plus the items assigned to them, plus the containers of those objects as bare shells (name only). Their Work sidebar has one section, "Shared with me". Their rail shows Work, Docs (if a doc is shared), Talk (if a conversation includes them and the module is on), Tables (same), Settings (personal only).
- Never sees: the directory, Open spaces, Discoverable spaces, announcements, goals of others, people pages, Teams, Planner team views, the More launcher's folded apps.
- People picker: only people who already share an object with them (co-members of the same List/Folder/Space/Channel). No emails shown.
- Can be assigned a task only inside a List they can see; assigning a task to a Guest who cannot see the List prompts the assigner to share the List first (the assign-grants-access rule still holds, but the UI makes the share explicit for guests).
- Ceiling: Can edit on Spaces; Can manage on Lists and Folders (a client can run their own project list). Never Owner of anything except objects they created inside a container they can edit (their own doc, their own task).
- Billing: not a seat. `checkPlanLimit("users")` excludes Guests; a separate soft cap `guests` per plan.
- Conversion: HR Admin or Org Admin changes the role to Employee; grants stay, directory opens.
- Removal: deactivating a Guest removes them from every member table (already cascades) and revokes their session via `tokenVersion`.

### 2.4 The Agent story

Agent means "does assigned work, configures nothing". Two kinds share the role because they need the same ceiling:

- Human agents: frontline staff, support agents, field workers, a BPO team. They log in, see My Work and the Lists they were added to, create tasks inside those Lists, comment, log time, acknowledge SOPs and policies, complete their reviews. They cannot create Spaces, Folders or Lists at the Space level (only tasks and docs inside a List they can edit), cannot invite, cannot see the directory beyond co-members, cannot create channels. Rail: Work, Planner, Docs, Talk (if on), Settings (personal).
- Non-human principals: API keys and AI agents act as an Agent principal bound to the creating user's capability set (intersection), so a key can never do more than its creator and never more than Agent allows unless the creator is Org Admin and explicitly picks the `ADMIN` scope (existing `ApiKey.scopes`). `api-auth.ts:161` already gates ADMIN scope to admins; it now also stamps the principal's caps at request time.

Agent is the role a customer picks for the 800 seats that must not be able to reorganise the workspace. It is what makes a 2000-seat rollout safe without a hundred custom roles.

### 2.5 Role editor rules

- Custom roles are clones: pick a base, name it, tick or untick capabilities. The base is remembered so "Reset to Manager defaults" works.
- A user can only grant a role whose capability set is a subset of their own (`people.assignRoles` plus the subset rule). Org Admin is exempt from the subset rule but not from the last-admin guard.
- Editing a role writes an `ActivityLog` row (type `access.role_changed`, old/new capability diff) and bumps `OrgRole.version`; the server-side caps cache keys on `(orgId, roleId, version)` so the change is live within one request, no re-login. The JWT carries `orgRoleId` only.
- Ceilings (section 2.1) are properties of the system base, inherited by clones: a clone of Guest is still a guest for the ceiling and seat rules.

---

## 3. Object roles and the object hierarchy

### 3.1 Objects and where their grants live

| Object | Container | Grant table | Visibility field | Inherits from |
|---|---|---|---|---|
| Space | org | `SpaceMember` | `Space.visibility` | nothing (org role + org-admin only) |
| Folder | Space or Folder | `FolderMember` | `Folder.visibility` | parent Folder, then Space |
| List (Board) | Space or Folder | `BoardMember` | `Board.visibility` | Folder, then Space |
| Item (task) | List | none; assignee/creator rule | none | List |
| Doc | Space / Folder / List / Item / Notepad / standalone | `ObjectGrant(type=doc)` (new) for standalone and for direct shares; anchored docs inherit | none | anchor |
| Table (DataTable) | Space or standalone | `ObjectGrant(type=table)` | none | Space |
| Whiteboard | Space or standalone | `ObjectGrant(type=whiteboard)` | none | Space |
| SOP folder | SOP folder tree | `ObjectGrant(type=sopFolder)` (migrated from `SOPFolderAccess`) | none; unfoldered SOPs are Open | parent SOP folder |
| SOP | SOP folder | none; author gets owner | none | SOP folder |
| Policy / Contract | org | none; audience (department/role/person) decides `view`; `knowledge.managePolicies` decides `manage` | none | org |
| Goal (OKR) | org | `GoalAssignee` audience (existing) | `level` COMPANY/TEAM/PERSONAL | owner + audience + chain |
| KRA / KPI / Review / Timesheet | a person | none; chain rule | none | the person |
| Person (profile) | org | none; chain rule | none | org |
| Channel / DM (Conversation) | org | `ConversationMember` (existing); channels get a `visibility` (Open / Private) | `Conversation.visibility` (new column) | nothing |
| Automation | the object it runs on | none | none | object (`manage`) |

`ObjectGrant` is one new table: `(id, organizationId, objectType, objectId, userId, role SpaceRole, invitedBy, createdAt)` with `@@unique([objectType, objectId, userId])` and `@@index([userId])`. It exists so Docs, Tables, Whiteboards and SOP folders can be shared with the same dialog and the same enum without four more member tables. The three container tables stay as they are (indexed, working, covered by tests).

### 3.2 Inheritance rules

1. Grants flow downward and are additive. A grant on a Space covers every Folder, List, Item, Doc, Table and Whiteboard inside it. A grant on a Folder covers its subtree. Nothing ever revokes what a parent gave, except rule 3.
2. The highest level among all applicable grants wins.
3. A Private child (`visibility = PRIVATE`) stops inheritance of `view`/`edit`/`manage` from its parent's members. It remains reachable by: its own grantees, its owner (`ownerId`), the parent container's Owners (not Managers), and Org Admins. This resolves the `board.ts` vs `access.ts` disagreement on Space ADMIN (audit 1.6 row 2) in favour of "owners see everything in their house, managers do not pierce private children".
4. Items inherit their List, with two exceptions: any assignee (`ownerId` or `assigneeIds`) and the creator hold at least `edit` on the item, regardless of List access (decision already made; `api/items/[id]/route.ts:27-31` keeps working). Item access implies `discover` on the List (name, statuses, fields needed to render that item) but not `view` of other items.
5. A child can be Open while its parent is Private (a public List inside a private Space). Then the child hands out its `defaultPermission` to everyone, and the parent shows as a bare shell to them. This is today's `board.visibility = ORG` behaviour, kept.
6. Docs anchored to an item inherit the item (so an assignee reads the task's doc). Personal Notepad docs are owner-only for everyone including Org Admins (`doc-access.ts:74-81` wins over `access.ts:242`).
7. Conversations: channel members hold their `ConversationMember` role; Open channels give `view` + `edit` (post) to every non-guest member of the org; DMs are `manage` for participants and `none` for everyone else, Org Admins included.
8. People data: `self = owner` on own profile, goals, reviews, timesheets, KRAs. Manager chain (solid + dotted, `getEffectiveReportTree`) plus `people.viewTree` gives `edit` on employment and alignment data of the tree. `people.viewOrg` gives the same org-wide. Peers get a minimal-profile `view` (name, avatar, title, department) only if they hold `people.viewDirectory`; guests and agents see only co-members.

### 3.3 Direct-share rules

- Who can share: anyone holding `manage` or `owner` on the object can share at any level up to their own. Anyone holding `edit` can share at `view` or `edit` (ClickUp default; an org toggle "Only managers can share" restricts this to `manage`+).
- Sharing to a Guest additionally requires `work.shareExternal`.
- Sharing a List or Folder never shares the Space; the Space appears to the grantee as a shell (decision already made; the page gate now honours it, fixing audit 3.1).
- Ownership: one explicit "Transfer ownership" action, Owner or Org Admin only, with confirmation. Removing or demoting the last Owner is refused server-side (audit 3.13). Self-removal by the last Owner is refused with "Transfer ownership first".
- Department and Office bulk-add stay in the dialog, computed server-side from the full directory (audit 3.3), not from the caller's truncated list.

---

## 4. Precedence: the ordered resolution rules

`resolve(viewer, target)` evaluates these in order and stops at the first rule that produces a final answer; rules marked "collect" contribute a candidate level and continue. The result is the maximum collected level, then capped by the viewer's role ceiling, then annotated.

| # | Rule | Effect |
|---|---|---|
| P0 | Not signed in, or target not in viewer's org, or target soft-deleted and viewer lacks `work.trash` | `none` (final) |
| P1 | Target belongs to a premium module the org has not turned on | `none`, `via: "module-off"` (final; page shows ModuleDisabled, API 403) |
| P2 | Target is a personal object (Notepad doc, DM) and viewer is not a participant | `none` (final; Org Admin is not exempt) |
| P3 | Viewer is Org Admin | `manage` (final for everything except: `owner` on objects they own; people data where they get `manage`; and P2) |
| P4 | Viewer holds a capability that the target type requires to exist at all (`people.viewDirectory` for directory, `settings.*` for settings pages, `reviews.run` for review cycles, `assets.manage` for org-wide assets, `knowledge.managePolicies` for policy admin) | missing capability: `none` (final). Present: collect the capability's implied level (usually `view` or `manage`) |
| P5 | Direct grant on the target (`SpaceMember` / `FolderMember` / `BoardMember` / `ObjectGrant` / `ConversationMember`) | collect its level |
| P6 | Ownership: `ownerId`/`createdById` on Space, Folder, List, Doc, Table, Whiteboard, SOP, Goal; item assignee or creator | collect `owner` for containers and docs, `edit` for items |
| P7 | Inherited grant: walk up the container chain (Folder ancestors, then Space); each ancestor grant contributes its level unless a Private node on the path stops it (rule 3.2.3); a parent Owner always contributes `manage` on private children | collect |
| P8 | Visibility: target or the nearest non-private ancestor is Open and viewer is not Guest: collect its `defaultPermission` (`view` or `edit`); Discoverable: collect `discover` | collect |
| P9 | People-data chain: target is a person or a person-owned record (KRA assignment, KPI record, review, timesheet, goal): self gives `owner`; `people.viewOrg` gives `edit`; `people.viewTree` and target in effective tree gives `edit`; goal audience membership gives `view`; peer with `people.viewDirectory` gives minimal `view` | collect |
| P10 | Ceiling: Guest capped at `edit` on Spaces and `manage` on Lists/Folders; Agent capped at `edit` everywhere and `none` on create-container actions; all roles capped at `owner` | cap |
| P11 | Nothing collected | `none`, but if the nearest visible ancestor is Discoverable: `discover` with `requestable: true` |

Ties are impossible because the answer is a max, not a first-match. Denial always returns the reason of the highest rule that was evaluated, so "Check access" can explain "no grant on this List; Space is Private; you are not in the Space".

### 4.1 Worked examples

**A. A Guest shared on a List (Can edit) inside a Private Space.**
P0 pass, P1 pass (core), P2 n/a, P3 no, P4 n/a (Lists need no capability), P5 collects `edit` from `BoardMember`, P6 no, P7 walks to the Space: no grant, Space is Private, contributes nothing, P8 nothing, P9 n/a, P10 Guest cap on a List is `manage` so `edit` stands. Result: `edit` on the List and every item in it. The Space resolves separately: P5 none, P7 n/a, P8 Private, P11 `none`, but the sidebar tree builder asks for "containers of my grants" and renders the Space as a shell. Directory: Guest sees only the List's other members. Page `/boards/[slug]` renders in full edit mode. This is audit Broken #1 fixed by construction, because page and API call the same function.

**B. An Employee assigned a task in a Space they are not a member of (Space Discoverable).**
Item: P6 collects `edit` (assignee). Result `edit` on the item. The item appears in My Work and opens in the drawer and at `/item/[id]`. List: P5 none, P7 none, P8 Discoverable collects `discover`, plus the engine adds "has items assigned" so the List page renders in scoped mode: only items where the viewer is assignee, a banner "You can see tasks assigned to you. Request access to see the whole list." with a Request access button. Sidebar shows the List under "Shared with me", the Space as a locked shell. Creating a new task in that List: refused (`edit` on the item is not `edit` on the List).

**C. A Manager viewing a direct report's KRAs.**
Target `user:<report>`. P3 no, P4: `people.viewTree` present, P5 n/a, P9: report is in the manager's effective tree, collects `edit`. Result `edit`: the profile, KRA assignments, KPI records, weekly reviews and timesheets render editable; `alignment.manage` (Manager default true) allows creating KRA assignments for that person. Same manager opening a peer's profile: P9 collects only minimal `view`; `/people/[peer]` renders the card (name, title, department) and no KRA/KPI/review sections, no 404, no 403. A Team Lead who was migrated to Manager gets the same, which is what the code already does for TEAM_LEAD.

**D. HR Admin versus a department head.**
HR Admin (system role) opening any employee: P4 `people.viewOrg`, P9 collects `edit`. They can edit employment fields, KRAs, reviews, deactivate (`people.deactivate`). They cannot open `/settings/identity` (P4: `settings.workspace` missing, `none`, in-place locked card). They do not automatically see any Space content: Spaces resolve through P5 to P8 like anyone else. The department head, on a custom "Executive" clone (Manager + `people.viewOrg` + `alignment.viewOrg` + `analytics.viewOrg`): sees everyone's alignment data org-wide but cannot deactivate people or run review cycles (`people.deactivate`, `reviews.run` unticked), and owns their department's Space because they created it. Where both can edit the same KRA assignment, the last write wins and both writes land in the audit log with actor and old/new values; neither can outrank the other on people data because people data has no Owner other than self.

**E. Rail floor set by the admin.**
Settings > Apps sets Teams to "Managers and up" (stored as a role list). `resolve(viewer, {type:"app", key:"teams"})`: P3 Org Admin `manage`; otherwise P4 the app's required capability (`people.viewTree`) and the org floor (viewer's role in the floor list). An Employee URL-navigating to `/team`: `none`, the page renders the AccessRequired card in place. Hidden is now the permission (audit rec 8).

---

## 5. The single gate

### 5.1 Module layout

```
src/lib/authz/
  capabilities.ts     the 34 capability keys, labels, area, default per system role, enforcement note
  roles.ts            OrgRole load/cache, viewerFromSession(), ceilings
  levels.ts           Level enum, meets(), max(), labels for the UI
  resolve.ts          resolve(viewer, target) : the engine (sections 3 and 4)
  where.ts            accessibleWhere(viewer, type) and accessibleIds(): Prisma filters for list endpoints
  gate.ts             gatePage(), gateApi(), AccessDenied error class
  audit.ts            logAccessChange(), logDenial()
  index.ts            re-exports
```

`src/lib/access.ts`, `space.ts` (the access functions only), `board.ts` (`getBoardForReader`, `canEditBoard`, `canContributeBoard`, `canReadBoard`), `folder.ts` (`folderVisibleTo`, `folderAccessForSpace`, `folderReadable`, `accessibleFolderIds`, `spaceIdsWithFolderGrant`), `doc-access.ts`, `sop-access.ts` (`sopVisibilityWhere`, `canWriteToFolder`), `alignment-scope.ts` (`canTouchUserAlignment`, `visibleAlignmentUserIds`), `hr-segment.ts`, `page-gates.ts`, `route-guard.ts`, `access-tiers.ts`, `permissions.ts` (`checkPermission`), `api-helpers.ts` (`isManager`, `isOrgAdmin`, `hasRole`, `hasPermission`, `requirePermission`), `use-role.ts`, `use-permission.ts`: every one of these becomes a one-line wrapper over `authz` in migration step 2 and is deleted in step 6.

### 5.2 Signatures

```ts
// levels.ts
export type Level = "none" | "discover" | "view" | "edit" | "manage" | "owner";
export function meets(have: Level, need: Level): boolean;

// capabilities.ts
export type Capability = "work.createSpace" | ... | "data.export";   // 34 literals
export const CAPABILITIES: Record<Capability, { area: string; label: string; blurb: string; enforcedAt: string }>;
export const SYSTEM_ROLES: Record<"orgAdmin"|"hrAdmin"|"manager"|"employee"|"guest"|"agent", { label: string; caps: Capability[]; ceiling: Level; seat: boolean }>;

// roles.ts
export interface Viewer {
  userId: string;
  organizationId: string;
  roleId: string;
  roleBase: keyof typeof SYSTEM_ROLES;      // for ceilings and seat rules
  isOrgAdmin: boolean;
  caps: ReadonlySet<Capability>;
}
export async function viewerFromSession(session: Session): Promise<Viewer>;   // cached per request + (orgId, roleId, version)
export function viewerFromApiKey(key: ApiKeyRow): Promise<Viewer>;           // Agent-capped principal

// resolve.ts
export type Target =
  | { type: "space" | "folder" | "list" | "item" | "doc" | "table" | "whiteboard" | "sopFolder" | "sop"
          | "policy" | "goal" | "kra" | "kpiRecord" | "review" | "timesheet" | "user" | "conversation" | "automation";
      id: string }
  | { type: "app"; key: string }                       // rail hub or folded app key from apps-catalog
  | { type: "settings"; section: SettingsSection }     // one entry per Settings nav row
  | { type: "capability"; key: Capability };           // "may this viewer do X at all"

export interface Decision {
  level: Level;
  reason: string;                 // human sentence, safe to show to the viewer
  via: "org-admin" | "capability" | "grant" | "owner" | "inherited" | "visibility" | "assignee" | "chain" | "module-off" | "none";
  sourceType?: Target["type"];    // where the winning grant lives (e.g. "space" for an inherited grant)
  sourceId?: string;
  requestable: boolean;           // true when level is discover and the object accepts access requests
  scoped?: { itemIds?: string[]; folderIds?: string[] };   // partial visibility (assigned items, folder-only grants)
}
export async function resolve(viewer: Viewer, target: Target): Promise<Decision>;
export async function resolveMany(viewer: Viewer, targets: Target[]): Promise<Decision[]>;   // batched, one query per table

// where.ts
export async function accessibleIds(viewer: Viewer, type: "space"|"folder"|"list"|"doc"|"table"|"whiteboard"|"sopFolder"|"conversation",
                                    candidateIds?: string[], need?: Level /* default "view" */): Promise<Set<string>>;
export async function accessibleWhere(viewer: Viewer, type: ..., need?: Level): Promise<Prisma.XWhereInput>;

// gate.ts
export class AccessDenied extends Error { constructor(public decision: Decision, public need: Level) }
export async function gateApi(session, need: Level, target: Target): Promise<{ viewer: Viewer; decision: Decision } | NextResponse>;
export async function gatePage(need: Level, target: Target): Promise<{ viewer: Viewer; decision: Decision }>;   // notFound() or renders AccessRequired
```

### 5.3 How nav, page and API call it

**Nav (rail, hub sidebars, More launcher, command palette, Settings nav).** `/api/preferences` (already the channel for `activeModules`) adds `viewer: { roleId, roleBase, caps: string[] }` and `appAccess: Record<appKey, Level>` computed server-side with `resolveMany` over every catalog app and Settings section. `visibleRailApps()` keeps its shape but filters on `appAccess[app.key] !== "none"` instead of `canAccessApp` + `orgFloor`. `apps-catalog.tsx` replaces `requiredAccess: AccessTier` with `requiredCap?: Capability`; hub sidebars replace their `canAccessTier(...)` calls with `useCan(cap)`. The command palette indexes the same filtered list (audit 3.26). The Settings nav renders from `SETTINGS_SECTIONS` (section 7) and `appAccess`.

**Page.** Every server page or layout that renders a gated surface calls `gatePage(need, target)` once and passes `decision` into its client tree through `<AccessProvider decision>`. Client components call `useAccess()` to get the level and `useCan("edit")` to decide whether a control is live. Object pages: `boards/[slug]/page.tsx` calls `gatePage("view", {type:"list", id})` and reads `decision.scoped` for the assigned-items mode. Area pages: `settings/layout.tsx` calls `gatePage("view", {type:"settings", section})` per route via the section map; `/team`, `/reviews`, `/tools`, `/assets`, `/trash`, `/kudos`, `/surveys`, `/candor`, `/announcements`, `/policies`, `/agreements`, `/analytics`, `/talent`, `/automation` each call `gatePage("view", {type:"app", key})`, which is the one place the fourteen unguarded routes get their guard (audit 1.8, 3.5, 3.14).

**API.** Every handler starts with `const g = await gateApi(session, need, target); if (g instanceof NextResponse) return g;`. List endpoints use `accessibleWhere` / `accessibleIds` instead of `visibleSpaceIds` (which becomes an alias with the same full-read semantics). Mutations that change access (member add/remove/role change, visibility change, ownership transfer, role assignment, role edit, capability edit) call `logAccessChange()`; every `AccessDenied` calls `logDenial()` (sampled at 1 per viewer per target per 10 minutes so a polling client cannot flood the log).

**Client hook.** `useAccess(target)` posts to `POST /api/access/check { targets: Target[] }` (batched, replaces `/api/me/access`) and is cached per target for the page lifetime; the Share dialog, the "Check access" panel and any component outside a gated page use it. `invalidateAccess()` is dispatched on the existing `workwrk:prefs-changed` event so a role edit or share change refreshes open surfaces (audit 3.22).

### 5.4 Discoverable versus accessible

`discover` is a first-class level so that "you can see it exists" and "you can open it" are different answers from the same function:

- Sidebar and Space directory list Discoverable spaces and lists with a lock glyph and member count; clicking opens the LockedView (section 5.5) rather than a 404.
- Search returns Discoverable containers by name only, never their contents.
- Open containers are fully accessible at their default level and appear like any member container.
- Private containers are `none`: absent from every list, 404 on direct URL. The only exception is the shell rendering of a container that holds something the viewer was granted (a List, a Folder, an assigned item), where the engine returns `discover` with `via: "inherited"` and `requestable` per the container's setting.

### 5.5 Read-only mode and the one denial convention

There is one convention. Nothing redirects except an unauthenticated request going to `/login`.

| Situation | Page | API |
|---|---|---|
| `none` on an object | `notFound()`: the standard 404 page. Never confirms existence. | 404 `{ error: "Not found" }` |
| `discover` on an object | 200, `LockedView`: the object's name and icon, owner avatar, "You don't have access to this {list}", a Request access button (if `requestable`), and a Back link. No content. | 403 `{ error, code: "no_access", requestable: true }` |
| `view` but the action needs `edit`/`manage` | 200, the real page in read-only mode | 403 `{ error, code: "insufficient_level", have: "view", need: "edit" }` |
| Missing capability for an area (Teams, Settings section, Reviews, Trash) | 200, `AccessRequired` card in place of the page body: "This area is for {roles that have it}. Ask an admin if you need it." | 403 `{ error, code: "missing_capability", capability }` |
| Module off | 200, existing `ModuleDisabled` screen | 403 `{ error, code: "module_off" }` |

Read-only mode is a rendering rule, enforced by `useCan()` in shared primitives, not by each page:

- Mutation controls that the viewer cannot use are not rendered: no "+ Add task", no drag handles, no inline editors, no Share button, no "..." items that mutate. The shell keeps the Share entry as "Who has access" (read mode of the same dialog).
- Exactly one affordance explains the state: a slim banner under the content header, "View only. Ask {owner name} for edit access." with a Request access button that opens an access request at the next level up. No 403 toasts are reachable by clicking.
- Form pages under Settings never render editable fields the viewer cannot save: fields render as static text with the same layout.
- Table cells, doc editors, sheet grids and canvases mount in their existing read-only variants (`readOnly` props already exist on `BoardItemDetail`, the block editor, the sheet grid and the canvas).

Both pages and APIs read `decision.level`; a control that the page hides can never be hit by a client that the API would then 403, and a client that bypasses the page hits the API and gets the coded error.

### 5.6 Request access flow

New table `AccessRequest (id, organizationId, requesterId, objectType, objectId, requestedLevel, message?, status PENDING|GRANTED|DECLINED, decidedById?, decidedAt?, createdAt)` with `@@unique([requesterId, objectType, objectId, status])` for pending.

- Requester: from LockedView or the read-only banner, one click, optional message. Toast "Request sent to {owner}". Duplicate pending requests are merged.
- Approvers: every holder of `manage`/`owner` on the object (and Org Admins) gets an Inbox item (Primary tab) with Grant view / Grant edit / Decline inline. Granting writes the grant through the same member endpoint, logs `access.request_granted`, and notifies the requester.
- Org toggle "Allow access requests" (default on). When off, `requestable` is always false and LockedView shows the owner's name only.
- Auto-expire: 14 days, then DECLINED by cron (add a row to the existing crontab documentation, `scripts/CRON-SETUP.md`).

---

## 6. UI surfaces

### 6.1 The one Share dialog

One component, `src/components/access/share-dialog.tsx`, replaces `share-space-dialog.tsx`, `share-board-dialog.tsx`, `share-folder-dialog.tsx`, `components/docs/doc-share-modal.tsx` and the access panel of `components/sops/folder-manager.tsx`. It takes `target: Target` and renders from `resolve` + a `GET /api/access/members?type=&id=` payload. Reference for layout: ClickUp's Sharing & Permissions modal (Mobbin: search "clickup sharing permissions"), styled per the Zoho-clean direction (white card, hairline rows, one blue primary).

Structure, top to bottom:

1. Header: `EntityTile` + object name + "in {parent}" breadcrumb text.
2. **General access** (containers and channels only): one select with three rows, each with a one-line blurb: Private ("Only people added below"), Discoverable ("Everyone in {org} can find it and request access"), Open to everyone ("Everyone in {org} can {view / edit}"), and for Open a second select "Everyone can: View / Edit". This is where Folder visibility becomes editable and where the Space "Make Private" toggle from the "..." menu lands.
3. **Add people**: one search input backed by `GET /api/directory` (full org for anyone with `people.viewDirectory`, co-members for Guests and Agents), rows show avatar, name, title, department, current access if any. A level menu beside the input (default: the container's `defaultPermission`). Tabs: People, Departments, Offices (bulk add resolved server-side), Invite by email (creates a Guest unless the inviter picks Employee and holds `people.invite`; shows "Guests don't use a seat").
4. **People with access**: grouped list. Direct grants first, each with a level menu (Owner, Can manage, Can edit, Can view, with blurbs from `levels.ts`) and a remove X. Then "Inherited from {Space name}" rows with the source chip and a "Manage in {Space}" link instead of a menu. Then one static line "Org admins can always manage this" (hidden for Guests since they cannot see who admins are). Owner rows show a "Transfer" action for owners.
5. Footer: "Copy link", and for objects with `manage`+ a "Check access" link that opens the panel in 6.3.

Behaviour rules:
- Read mode when the viewer's level is below `edit` (or below `manage` when the org toggle "Only managers can share" is on): every control renders as text, the header says "Who has access", and the only button is Request access when applicable. Audit 3.8 closed.
- The level menu never offers a level above the viewer's own.
- Last-owner removal and self-removal by the last owner are refused inline with the server's message.
- Every change is optimistic with revert and writes an audit row.
- Pickers are `position:absolute` children of the dialog (project rule), no portal.

Vocabulary, everywhere: Owner, Can manage, Can edit, Can view. Blurbs, verbatim, used in the dialog, the role editor and the tooltip on the read-only banner:

- Owner: "Full control, including delete and transfer."
- Can manage: "Change settings, fields, statuses and sharing."
- Can edit: "Add and change tasks, docs and rows."
- Can view: "Open and comment, but not change."

### 6.2 Members & roles (Settings > Workspace > Members & roles)

One page at `/settings/members` with three tabs. It absorbs `/settings/permissions` (the matrix page), `/settings/hierarchy` (merged into `/organization`, which stays under Teams), and the Guest list that does not exist today.

- **Members**: table (Person, Role select, Reports to, Department, Title, Status, Last active). Role select lists the org's roles the viewer may grant (subset rule). Changing to or from Org Admin needs confirmation; demoting the last Org Admin is blocked with the reason. Filters: role, department, status. Invite button opens the existing `InviteModal` with the role select swapped for org roles (SUPER_ADMIN gone). The data source is `GET /api/directory?admin=1`, which is org-wide for anyone who can open the page (P4: `settings.roles` or `people.assignRoles`); the silent team-scope downgrade is gone because this page is no longer reachable without the capability.
- **Guests**: every Guest, what they have access to (count with a popover listing objects), invited by, last active, Convert to Employee, Remove.
- **Roles**: the role editor. Left column lists the six system roles and the org's custom roles with member counts; "New role" clones a selected one. Right side is the matrix, reshaped: rows are capabilities grouped by area (Work, People, Alignment, Knowledge, Culture, Assets, Talk, Automation, Analytics, Settings), columns are roles, cells are brand-blue checkboxes, Org Admin column locked. Each row has an info tooltip with the blurb and "Enforced at: {gate}" so nothing in it is decorative. Sticky save bar with a diff count; unsaved-changes guard on navigation (`beforeunload` + route-change confirm); "Reset to {base} defaults" per custom role; every save logs an audit row and bumps the role version. Ceilings (Guest, Agent) show as locked rows with the reason.

`/settings/permissions` redirects to `/settings/members?tab=roles`. The `/settings/structure` access-ladder explainer is deleted; its Functions / Job titles / Offices tiles move to the Members page header links.

### 6.3 Per-object "Who has access" and "Check access"

- "Who has access" is the Share dialog in read mode, reachable from every object's "..." menu and from the topbar Share entry (the dead `OsTitleBar` Share becomes this).
- "Check access": inside the dialog for `manage`+ holders, and on a person's profile for `people.assignRoles` holders. Pick a person, get the decision: level chip, the `reason` sentence, and the source ("Can edit, inherited from Space Marketing, added by Priya on 3 Sep"). It is `resolve()` for another viewer, exposed as `POST /api/access/check { asUserId }`, gated by `manage` on the object or `people.assignRoles`.

### 6.4 Denial and redirect behaviour

Section 5.5 is the whole convention. Concretely this deletes: `page-gates.ts` redirects to `/people/me` and `/team/reviews`, `route-guard.ts` redirects to `/dashboard`, the inline lock card on `/settings/structure`, and the `(admin)/layout.tsx` inline "Restricted" page (replaced by the same `AccessRequired` card on the admin host). `notFound()` and `AccessRequired` are the only two outcomes.

### 6.5 Settings surfaces the model needs

Under the merged Settings IA (phase2-inputs 4.7), all new rows sit in the Workspace group:

- **Members & roles** (6.2).
- **Sharing & guests**: default visibility for new Spaces (Private / Discoverable / Open, default Open), default permission for Open containers (view / edit, default edit), who can create Spaces (role multi-select, default all seat roles), who can create Open spaces, allow guests (default on), who can invite guests, only managers can share (default off), allow access requests (default on), access request expiry (14 days).
- **Security policy**: the editor that does not exist today for `Organization.settings.security` (min password length, uppercase, numbers, session timeout, org-wide MFA required), gated by `settings.workspace`. The `/account/security` "Org policy" card links here for admins and stays read-only for everyone else. The two Overview cards that point at the personal page are repointed.
- **Apps in rail**: floor select changes from a tier to a role multi-select ("Visible to: Org Admin, HR Admin, Manager"); hidden and floors are enforced by `resolve({type:"app"})`. The page lists rail hubs only; folded apps are configured inside their hub's row as sub-rows.
- **Audit log**: gains an "Access" type filter fed by the new `access.*` event types.

Defaults for a new org: creator is Org Admin; every invite defaults to Employee; new Spaces are Open with edit (a five-person company should never have to share anything); guests on, invitable by Manager and above; access requests on; only-managers-can-share off; Talk and Tables off (unchanged). A "Lock it down" preset on the Sharing & guests page flips new Spaces to Private, Open spaces to view, guests to HR Admin+, sharing to managers only, for the 1500-seat customer's security lead.

Settings honesty items from critic issue #7 that this model touches, each with its fix: Space `defaultPermission` (enforced, 1.3); rail hide/floor (enforced, 6.5); security policy (editor, 6.5); `Role.level` (removed); `HRSegment` (deleted); matrix cells (section 7); dirty-state guard on the role editor (6.2). The Inbox-prefs zod strip, presence/mute/pins/sidebar-width localStorage-only state, and the CustomizePanel `home.cards` are preferences, not access, and belong to the preferences proposal; this spec only asks that `/api/preferences` gain the `viewer` and `appAccess` fields.

---

## 7. Disposition of the permission matrix

Every cell of `PERMISSION_MODULES` (`src/lib/permissions.ts:37-197`), 79 cells. "Capability" means the cell survives as that capability in the role editor and is enforced at the gate listed in 2.2. "Object role" means the decision moves to `resolve()` on the object and the cell is deleted. "Always" means every authenticated seat role has it implicitly and the cell is deleted. "Deleted" means the module is not in the product surface.

| Module.action | Disposition | Enforced by |
|---|---|---|
| people.view | Capability `people.viewDirectory` | `GET /api/directory`, `/people` |
| people.create | Capability `people.invite` | `POST /api/invitations`, `POST /api/users` |
| people.edit | Capability `people.editProfiles` (tree-scoped for Manager) | `PATCH /api/users/[id]` + P9 |
| people.delete | Capability `people.deactivate` | `DELETE /api/users/[id]`, status PATCH |
| people.bulkActions | Merged into `people.editProfiles` + `alignment.manage` | bulk endpoints |
| organization.view | Always (org chart follows P9 scope) | `/organization` |
| organization.edit | Capability `settings.workspace` | `PATCH /api/settings` companyProfile |
| organization.manageDepartments | Capability `people.manageStructure` | `/api/departments*` |
| organization.manageRoles | Merged into `people.manageStructure` (job titles) | `/api/roles*` |
| organization.manageOffices | Merged into `people.manageStructure` | `/api/offices*` |
| kras.view | Always, scoped by P9 | `visibleAlignmentUserIds` via `accessibleWhere` |
| kras.create | Capability `alignment.manage` | `POST /api/kras` |
| kras.edit | Merged into `alignment.manage` | `PATCH /api/kras/[id]` |
| kras.delete | Merged into `alignment.manage` | `DELETE /api/kras/[id]` |
| kras.assign | Merged into `alignment.manage` | `/api/kra-assignments` |
| kras.recordKpi | Always (self) or P9 (tree) | `POST /api/kpi-records` |
| kras.aiGenerate | Merged into `alignment.manage` | AI KRA routes |
| sops.view | Object role on SOP folder | `resolve(sopFolder)` |
| sops.create | Capability `knowledge.createSop` | `POST /api/sops*` |
| sops.edit | Object role (`edit` on folder, `owner` as author) | `PATCH /api/sops/[id]` |
| sops.publish | Capability `knowledge.publishSop` | status PATCH |
| sops.delete | Object role (`manage` on folder or author) | `DELETE /api/sops/[id]` |
| sops.assign | Merged into `knowledge.publishSop` | `/api/sop-assignments` |
| sops.aiGenerate | Merged into `knowledge.createSop` | AI SOP routes |
| reviews.view | Always (self) or P9 | review GETs |
| reviews.create | Capability `reviews.run` | cycle POST |
| reviews.launch | Merged into `reviews.run` | cycle launch |
| reviews.finalize | Capability `reviews.finalize` (tree) | manager-review routes |
| reviews.delete | Merged into `reviews.run` | cycle DELETE |
| okrs.view | Object role (owner + audience + P9) | `canSeeGoal` folded into `resolve(goal)` |
| okrs.create | Capability `goals.create` | `POST /api/okrs` |
| okrs.edit | Object role | `resolve(goal)` edit |
| okrs.delete | Object role (`owner`, tree via P9, Org Admin) | `DELETE /api/okrs/[id]` |
| okrs.checkIn | Object role (`edit`) | check-in POST |
| tasks.view | Object role | `resolve(item)` |
| tasks.create | Object role (`edit` on List) | `POST /api/boards/[id]/items` |
| tasks.edit | Object role | `PATCH /api/items/[id]` |
| tasks.delete | Object role (`edit` on List, or assignee) | `DELETE /api/items/[id]` |
| tasks.assignToOthers | Object role (`edit` on List); Agent ceiling keeps agents inside their Lists | items PATCH |
| meetings.view / create / edit / delete | Deleted (Meetings is not on the rail; if revived, object role) | |
| policies.view | Object audience (assignment) | `resolve(policy)` |
| policies.create | Capability `knowledge.managePolicies` | `POST /api/policies` |
| policies.edit | Merged into `knowledge.managePolicies` | `PATCH /api/policies/[id]` |
| policies.delete | Merged into `knowledge.managePolicies` | `DELETE /api/policies/[id]` |
| policies.publish | Merged into `knowledge.managePolicies` | publish route |
| announcements.view | Always | `GET /api/announcements` |
| announcements.create | Capability `talk.announce` | `POST /api/announcements` |
| announcements.edit | Merged into `talk.announce` (author or capability) | PATCH |
| announcements.delete | Merged into `talk.announce` | DELETE |
| assets.view | Capability `assets.manage` | `GET /api/assets` org-wide |
| assets.viewOwn | Always | `GET /api/assets?mine=1` |
| assets.create | Merged into `assets.manage` | POST |
| assets.edit | Merged into `assets.manage` | PATCH |
| assets.delete | Merged into `assets.manage` | DELETE |
| assets.assign | Merged into `assets.manage` | assign route |
| surveys.view | Always (assigned surveys) | `GET /api/surveys` |
| surveys.create | Capability `culture.run` | `POST /api/surveys` |
| surveys.respond | Always | response POST |
| surveys.viewResults | Merged into `culture.run` | results GET |
| ideas.view / submit / review / delete | Deleted (Ideas is an orphan route) | |
| analytics.view | Capability `analytics.view` | `/analytics` page + API |
| analytics.viewOrgWide | Merged: `analytics.view` scoped by `people.viewOrg` | analytics API scope |
| analytics.export | Merged into `data.export` | export routes |
| tools.view | Always (own) | `GET /api/tools?mine=1` |
| tools.create | Merged into `assets.manage` | POST |
| tools.edit | Merged into `assets.manage` | PATCH |
| tools.delete | Merged into `assets.manage` | DELETE |
| tools.share | Merged into `assets.manage` | share route |
| settings.viewGeneral | Always (Settings overview shows what you can reach) | `settings/layout.tsx` |
| settings.editGeneral | Capability `settings.workspace` | identity/locale/apps/modules/defaults APIs |
| settings.manageBilling | Capability `settings.billing` | `/api/billing*` |
| settings.manageIntegrations | Capability `settings.integrations` | `/api/keys*`, `/api/scim-tokens*` |
| settings.manageAccessControl | Capability `settings.roles` | `/api/org-roles*`, Members & roles page |

Tally: 24 cells become or merge into a named capability with a gate, 15 become object-role decisions, 14 become "always", 8 are deleted with their module, and 18 are merges into a capability already counted. Nothing in the editor is cosmetic; 22 new capabilities that the old matrix never had (Spaces, guests, templates, tags, trash, Talk channels, automation, roles, data export) fill the gap the audit called out in 1.3.

`Organization.settings.permissions` is read one last time by the migration (section 8) to seed custom overrides, then ignored and dropped.

---

## 8. Migration

### 8.1 Data

Step D1. Add `OrgRole` (`id, organizationId, key, name, base, caps String[], version Int, isSystem Boolean, createdAt, updatedAt`, `@@unique([organizationId, key])`), `User.orgRoleId String?`, `Invitation.orgRoleId String?`, `ObjectGrant`, `AccessRequest`, `Conversation.visibility`. Keep `User.accessLevel` and `Invitation.accessLevel` for two releases as denormalised mirrors (written from the role's base on every role change) so anything not yet migrated keeps working.

Step D2. Backfill script `scripts/migrate-access-roles.ts` (run with `prisma db execute` semantics per the drift note in memory, never `migrate dev`):
- Create the six system roles per org.
- Map users: `SUPER_ADMIN`, `COMPANY_ADMIN` to Org Admin; `HR` to HR Admin; `MANAGER`, `TEAM_LEAD` to Manager; `EMPLOYEE` to Employee; `AGENT` to Agent; `C_LEVEL`, `VP`, `DIRECTOR` to a custom role "Executive" (Manager + `people.viewOrg` + `alignment.viewOrg` + `analytics.viewOrg`) created only in orgs that have such users.
- Read `Organization.settings.permissions` and, for the 24 surviving cells, apply any explicit override to the mapped role's caps (an untick on `sops.publish` for MANAGER unticks `knowledge.publishSop` on Manager). Log every applied override.
- Migrate `SOPFolderAccess` rows into `ObjectGrant(type=sopFolder)` with the enum mapping; keep the old table until step C6.
- Copy `Space.settings.defaultPermission` into the two-value form (`Full edit`/`Edit` to `edit`, `Comment`/`View` to `view`, missing to org default `edit`).
- Verify: every user has an `orgRoleId`; every org has at least one Org Admin; print orgs where the last Org Admin is deactivated for manual fix.

Step D3. Drop `Role.level`, `HRSegment`, `SOPFolderAccess`, `SOPFolderRole`, `Organization.settings.permissions`, `User.accessLevel`, `Invitation.accessLevel` in the release after C6.

### 8.2 Code, in order

C1. Land `src/lib/authz/*` beside the old code, no call sites yet. Golden test file `authz/resolve.test.ts` encodes every row of audit table 1.6 and the four worked examples as fixtures, plus the `visibleSpaceIds` leak-trap case, plus last-owner and ceiling cases. Vitest, in-memory Prisma fixtures like the Tables suite.

C2. Session: `auth.ts` JWT gains `orgRoleId`; `viewerFromSession` loads caps by `(orgId, roleId, version)` with a 60 s in-process cache. `/api/preferences` returns `viewer` and `appAccess`. Bump `tokenVersion` org-wide once at deploy so every JWT refreshes.

C3. Turn the old helpers into wrappers: `resolveAccess` maps `Decision.level` back to `read|edit|admin|none`; `getBoardForReader`, `canEditBoard`, `canContributeBoard`, `getSpaceForReader`, `canEditSpace`, `canContributeSpace`, `folderReadable`, `docAccessible`, `sopVisibilityWhere`, `canWriteToFolder`, `canTouchUserAlignment`, `visibleAlignmentUserIds`, `visibleSpaceIds`, `isManager`, `isOrgAdmin`, `hasPermission`, `requirePermission`, `canAccessTier`, `checkPermission` all delegate. At this point pages and APIs agree by construction (Broken #1 and #2 close), with zero call-site edits. Run the golden tests and the existing 602 vitest tests.

C4. Gates: add `gatePage`/`gateApi` calls to the fourteen unguarded Settings routes, the eleven unguarded app routes, the Talk and Tables layouts (module check moves inside P1), and the `(admin)` layout. Replace `requirePermission(session, module, action)` at its 13 call sites with `gateApi(session, "view", {type:"capability", key})`. Replace the 220 `isOrgAdmin(session)`/`isManager(session)` sites in batches by area, each batch behind the golden tests; the wrappers keep the app correct between batches.

C5. UI: `AccessProvider` + `useCan`; the Share dialog (replaces five); `LockedView` and `AccessRequired`; read-only banner; Members & roles page with the role editor; Sharing & guests and Security policy settings pages; Apps page floor select; `apps-catalog.tsx` `requiredCap`; directory endpoint and picker swap in `InviteModal`; Guest and Agent rail/sidebar variants; Inbox access-request card; audit log Access filter.

C6. Delete: `access.ts`, `access-tiers.ts`, `page-gates.ts`, `route-guard.ts`, `alignment-scope.ts`, `hr-segment.ts`, `sop-access.ts`, `doc-access.ts`, the access halves of `space.ts`/`board.ts`/`folder.ts`, `permissions.ts`, `use-role.ts`, `use-permission.ts`, `/api/permissions`, `/api/me/access`, `/settings/permissions`, `/settings/hierarchy`, `/settings/structure`, `share-*-dialog.tsx` x3, `doc-share-modal.tsx`, the SOP folder access panel, and the 25 tier sets. Then D3.

### 8.3 What breaks and how it is handled

| Break | Handling |
|---|---|
| JWT shape changes | `tokenVersion` bump forces refresh; `accessLevel` stays in the token for two releases |
| `useRole()` consumers (17 client files) | wrapper keeps the old booleans computed from caps until C6 |
| `PERMISSION_MODULES` importers (13 API files, the matrix page) | C4 replaces them; page redirects |
| `OrgAppsConfig.minAccess` tier strings | `parseOrgAppsConfig` maps `manager` to `[orgAdmin, hrAdmin, manager, executive]`, `hr-admin` to `[orgAdmin, hrAdmin]`, `org-admin` to `[orgAdmin]` once, then writes the role-id form |
| Users at C_LEVEL/VP/DIRECTOR | get the Executive clone; Rollup and org-wide alignment keep working |
| Space email invitees who are today EMPLOYEE | stay Employee (no retroactive downgrade); new invites are Guests |
| `Role.level` in the job-title UI | the pill is removed; the level chips on `/people/roles` become title groupings by department |
| `/api/users?scope=all` team-scope downgrade | replaced by `/api/directory` (full org, minimal fields) and `/api/users` scoped by P9 for full records |
| Third-party API keys with ADMIN scope | unchanged; READ/WRITE keys now resolve as Agent-capped principals, which may narrow a key that previously acted with its creator's manager reach; release note + audit query for affected keys |
| Existing PRIVATE boards readable by Space ADMIN through `access.ts` | now `none` for Space Can manage (rule 3.2.3); Owners unaffected; release note |
| Existing GUEST-role members who own items | keep `edit` on their items (P6) which is a widening from `canContributeBoard`; matches the assignee rule |

Sequencing risk control: C3 is the pivot. It is one PR, mechanical, and leaves the app functionally identical except for the disagreements the audit already listed as bugs. Everything after it is incremental behind a working app.

---

## 9. Security invariants and risks

### 9.1 Invariants (each has a golden test)

1. `accessibleIds(viewer, "space")` returns only spaces the viewer holds `view`+ on; folder, list and item grants never widen it (the `visibleSpaceIds` leak trap, `space.ts:165-171`, preserved by name and by test). Files, search, tables, whiteboards and entity links keep reading from it.
2. Guests and Agents never receive the org directory: `GET /api/directory` returns co-members only; no endpoint returns emails to a Guest; department and office bulk-add are refused for Guest callers.
3. Guests never resolve above `none` on Open or Discoverable containers, announcements, goals, people, or Talk channels they are not members of, regardless of visibility.
4. Org Admin is `manage`, not `owner`, and is `none` on personal Notepads and DMs. Reading a DM for compliance is a `data.export` act, logged, not a browse.
5. The last Org Admin of an org cannot be demoted, deactivated or deleted; self-demotion requires a second Org Admin and typed confirmation.
6. The last Owner of a Space, Folder, List, Doc, Table or Whiteboard cannot be removed or demoted; ownership transfer is explicit and logged.
7. A grantor can never grant a level above their own on the object, nor a role whose caps exceed their own.
8. Private stops inheritance for Can manage and below; Owners and Org Admins pierce it; nothing else does.
9. Page and API answers are the same function; there is no second resolver. A lint rule forbids importing `prisma` inside `src/app/**` route handlers that touch `SpaceMember`, `FolderMember`, `BoardMember`, `ObjectGrant`, `ConversationMember` or `User.orgRoleId` outside `src/lib/authz`.
10. Denials never confirm existence: `none` is 404 with a body identical to a real 404.
11. Every access change (role assignment, role edit, grant add/remove/change, visibility change, ownership transfer, access request decision, guest invite, API key mint) writes an `ActivityLog` row with actor, target, old and new values; sampled denials are logged.
12. API keys and AI agents can never exceed the intersection of their creator's caps and the Agent ceiling unless the creator is Org Admin and chose ADMIN scope.
13. Module off is decided before any object rule; a bookmarked Talk or Tables URL cannot bypass the entitlement.
14. `SUPER_ADMIN` never appears in any tenant UI or API input; platform staff are `PlatformAdmin` rows only.

### 9.2 Risks

1. **Parity regressions in C3.** The wrappers must reproduce today's behaviour except where the audit called it a bug. Mitigation: the golden suite is written from the audit's tables before C1 merges, and C3 is not merged until it is green together with the existing 602 tests.
2. **Query cost of `resolve()` on deep trees.** `resolveFolder` today does one query per ancestor (up to 8). Mitigation: `resolveMany` batches by table; add `Folder.pathIds String[]` (materialised ancestor list, maintained on move) so an inherited-grant lookup is one `IN` query. Per-request memo on the viewer object.
3. **Losing the seniority ladder surprises customers.** A CEO who was C_LEVEL now holds a custom role named Executive. Mitigation: migration creates it with the same reach; the Members page shows "Migrated from C-Level" in a one-time banner; the tour copy is updated.
4. **Guest ceiling versus existing GUEST-role rows.** Today GUEST is a container role for internal people, not an org role. After migration an internal Employee with a `GUEST` member row is simply "Can view", unaffected. The only new restriction applies to accounts whose org role is Guest, which do not exist yet.
5. **Read-only mode needs every mutation control behind `useCan`.** The audit lists ~10 surfaces that render 403-able controls. Mitigation: shared primitives (`Button`, `MenuItem`, the create menus, `BoardItemDetail`, sheet grid, block editor, canvas) accept the provider's level; a page that forgets is caught by the API's coded 403 plus the denial log, which becomes a weekly report during rollout.
6. **Founder's exact-parity mandate.** The Share dialog and the role editor are visible UI; the ClickUp Sharing & Permissions modal and the ClickUp "Custom roles" page are the references to pull from Mobbin before designing, per memory `feedback_clickup_exact_parity`. This spec fixes behaviour and vocabulary; the pixels follow the reference.
7. **Agent ambiguity.** Two prior definitions ("external agents", "limited frontline"). This spec picks "restricted worker or principal" and documents it in the role editor blurb; if the founder wants external agents to be Guests instead, the mapping in D2 changes one line.
8. **Access requests create inbox load for owners of Open-by-default spaces.** Open containers never generate requests (everyone already has the default level); only Discoverable and read-only cases do. The 14-day expiry and merge-duplicates rules bound the volume.
9. **Two releases of dual-write (`accessLevel` mirror).** Any new code that reads `accessLevel` during that window is a regression waiting to happen. Mitigation: the lint rule in invariant 9 also forbids `accessLevel` reads outside `src/lib/authz` from C3 onward.
10. **Custom roles proliferating at 2000 seats.** The subset rule and the six-base design keep the editor small; the Roles tab shows member counts so unused clones are obvious; no per-object custom roles exist, which is the line that keeps the model explainable.

---

## Appendix A. Files touched, by step

- New: `src/lib/authz/{capabilities,roles,levels,resolve,where,gate,audit,index}.ts`, `src/lib/authz/resolve.test.ts`, `src/components/access/{share-dialog,locked-view,access-required,access-provider,check-access-panel,read-only-banner}.tsx`, `src/app/api/access/{check,members,requests}/route.ts`, `src/app/api/directory/route.ts`, `src/app/api/org-roles/route.ts`, `src/app/(dashboard)/settings/members/{page,members-tab,guests-tab,roles-tab}.tsx`, `src/app/(dashboard)/settings/sharing/page.tsx`, `src/app/(dashboard)/settings/security/page.tsx`, `scripts/migrate-access-roles.ts`, Prisma models `OrgRole`, `ObjectGrant`, `AccessRequest`.
- Changed: `prisma/schema.prisma`, `src/lib/auth.ts`, `src/app/api/preferences/route.ts`, `src/lib/rail-apps.ts`, `src/components/layout/os/apps-catalog.tsx` and the hub sidebars, `src/components/layout/os/settings-shell.tsx`, `src/app/(dashboard)/settings/layout.tsx`, `src/app/(dashboard)/settings/apps/page.tsx`, `src/components/layout/os/invite-modal.tsx`, `src/app/api/spaces/[id]/invitations/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/keys/*`, `src/lib/api-auth.ts`, `src/lib/plan-limits.ts`, every route handler listed in 8.2 C4, `src/app/(dashboard)/boards/[slug]/page.tsx`, `folders/[id]/page.tsx`, `spaces/[slug]/page.tsx`, `people/[id]/page.tsx`.
- Deleted (C6): listed in 8.2.

## Appendix B. Level and label reference for engineers

| Level | `SpaceRole` | Share dialog | Role editor ceiling label | API `have`/`need` value |
|---|---|---|---|---|
| owner | OWNER | Owner | "Full control" | `owner` |
| manage | ADMIN | Can manage | "Manage" | `manage` |
| edit | MEMBER | Can edit | "Edit" | `edit` |
| view | GUEST | Can view | "View" | `view` |
| discover | (no row) | (not offered) | | `discover` |
| none | (no row) | (not offered) | | `none` |
