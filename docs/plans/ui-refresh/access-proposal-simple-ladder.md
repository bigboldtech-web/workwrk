# WorkwrK unified access model: the Simple Ladder

Proposal date: 2026-09-11. Stance: Monday/Zoho-class simplicity. Four org roles, one object ladder, one gate, at most eight org toggles. Written against the real code at `/Users/bigboldtechnologies/theywrk` (commit 6187227a) and the audit inventory in `ui-audit/access-model.md`, `ui-audit/settings-pages.md` and `ui-audit/critic-gaps.json` (systemic issues #4 and #7).

Every path below is repo-relative unless it starts with `/private/tmp`.

---

## 0. The whole model on one screen

```
ORG ROLE (per person, one of four)        OBJECT ROLE (per person or group, per object)
  Owner   runs the company account          Full access   manage, share, delete, transfer
  Admin   runs the workspace                Can edit      create and change content
  Member  works here                        Can comment   discuss, never change
  Guest   outside, sees only what is shared Can view      read only
  + Agent flag on a Member (frontline caps)

RELATIONSHIPS THAT GRANT WITHOUT A ROW      ONE GATE
  assigned to a task  -> Can edit on it     can(viewer, action, object)
  reports to you      -> people data          called by nav, page, API, search
  on the People team  -> people data          returns { allowed, role, via, discoverable }
  created it          -> Full access on it

ACCESS FLOWS DOWN: Space -> Folder -> List -> Item, Doc, Table
  Direct shares ADD. Nothing ever subtracts except "Restricted" (stop inheriting).
  Highest role from any source wins, then Guest/Agent caps apply.
```

The rest of this document is the contract behind that box.

---

## 1. Principles the model must never violate

1. One vocabulary. Four org roles, four object roles, the same labels in every dialog, list, chip and API response. No second ladder, no per-module role names.
2. One authority. `can()` is the only function allowed to answer "may this person do this". Nav, page, API, search, export and cron all call it. A grep for `accessLevel ===` in `src/` must return zero after migration.
3. Additive only. A person's effective role on an object is the maximum of every source (org role, direct grant, group grant, relationship, inheritance). The only narrowing is the object-level "Restricted" switch, which stops inheritance from the parent; it never removes a direct grant.
4. Relationships are rules, not rows. Being assigned a task, managing someone, or being on the People team grants access by computation at read time. Nothing has to remember to write a grant row when a task is reassigned or an org chart changes.
5. Discoverable is separate from accessible. A person may know an object exists (name, owner, Request access) without reading it. Un-discoverable objects 404. Nothing 403s on a read.
6. Read-only mode, never dead controls. A page renders the controls the viewer's role allows and nothing else. A View-only person sees a document, not a document with twelve disabled buttons.
7. Zero training. A new admin must be able to explain the whole model in one sentence to a new hire: "You see the Spaces you're added to; whoever adds you picks view, comment or edit; your manager and HR can see your people stuff."

---

## 2. Org roles

### 2.1 The four roles and the Agent flag

| Role | Who it is | Can do | Cannot do | Granted by |
|---|---|---|---|---|
| **Owner** | The account holder. One or more per org, at least one always. | Everything an Admin can, plus: billing and plan, delete the workspace, transfer ownership, promote or demote Admins, manage API keys and SCIM, security policy. | Read someone else's Notepad or private DMs. | Another Owner. The first Owner is the person who created the org (today `COMPANY_ADMIN` on signup). Platform staff can reset the last Owner from `/admin` (new back-office action). |
| **Admin** | Runs the workspace day to day (ops lead, IT, HR head in a small company). | Full access on every Space, Folder, List, Doc, Table, SOP folder, Policy, Contract and public Channel in the org. Invite and remove Members and Guests. Set anyone's role except Owner. Members page, Apps, Modules, Task types, Tags, Identity, Locale, Audit log, Data export, Defaults, Access settings. Everyone's people data. | Billing, delete workspace, promote to Owner, API keys, SCIM, security policy (Owner only). Read Notepads or DMs they are not in. | Owner or Admin. |
| **Member** | An employee. The default for everyone invited from inside the company domain. | Create Spaces (org toggle), Docs, Tables; be granted any object role; see the directory (name, avatar, title, department, email); see org-open Spaces; see their own people data; if they have direct reports, see and edit their reports' people data (whole chain below them); use every core module the org has on. | Any Settings page except Personal ones. Anyone else's people data unless they manage them or are on the People team. | Owner or Admin (via invite or role change). |
| **Guest** | Someone outside the company: client, contractor, vendor, candidate. | Only the objects explicitly shared with them, at the object role given. Comment and edit where granted. See the names and avatars of people who are on the same shared objects. Talk channels they are added to. | Directory, org chart, org-open Spaces, Search across the org, Docs hub, Tables hub, Teams hub, Planner team views, creating Spaces, inviting anyone, Full access on anything they did not create, exports. Never counts as a seat. | Anyone with Full access on an object may invite a Guest to that object (org toggle can restrict to Admins). An Admin can convert a Guest to a Member. |
| **Agent flag** | A Member with frontline limits (support agent, warehouse staff, field worker, shared kiosk login). | Everything a Member can, except the caps. | Create Spaces, delete anything (tasks, docs, rows), export, hold Full access (capped at Can edit), be a manager. | Owner or Admin toggles it on the Members page. |

Mapping from today's ten-rung `AccessLevel` enum (`prisma/schema.prisma:618`):

| Today | Becomes | Notes |
|---|---|---|
| SUPER_ADMIN | Owner | Platform-staff-granted concept is retired; staff act through `/admin`, never through a tenant role. |
| COMPANY_ADMIN | Owner if the org's first admin, else Admin | Backfill rule: the earliest-created COMPANY_ADMIN in each org becomes Owner; the rest become Admin. Admin can promote later. |
| C_LEVEL, VP, DIRECTOR | Member | Seniority is a job title, not a permission. Their reach over people data comes from the report tree, which for a CEO is the whole org. If an executive needs Settings, make them Admin. |
| HR | Member, auto-added to the People team | People team is an org setting (section 8), not a role. |
| MANAGER, TEAM_LEAD | Member | "Manager" is derived: `hasReports(user)`. Today these two tiers are identical everywhere anyway (audit 1.3). |
| EMPLOYEE | Member | |
| AGENT | Member + Agent flag | Today AGENT differs from EMPLOYEE only in `tasks.delete:false`. |
| (none) | Guest | New. Space email invites today mint a full EMPLOYEE (`src/app/api/spaces/[id]/invitations/route.ts:136,159`); they will mint a Guest. |

Job titles (`Role.level`, `/people/roles`) lose their access meaning. `Role.level` is renamed to `Role.seniority` (display only) or dropped; assigning a job title never changes a person's org role. The roles-client empty state that claims otherwise (`roles-client.tsx:319`) is rewritten.

### 2.2 Why no HR role, no Manager role

Every audit finding about HR comes from HR being a rung: it sits in a different place in three lists, `useRole().isAdmin` is true for HR on the client but not the server, HR segments are dead code. In the Simple Ladder HR is a Member on the People team. The People team is the answer to "who, besides the manager chain and Admins, sees everyone's people data". For a 12-person company it is empty and Admins do it. For a 400-person company it is the HR department. Same rule, no rung.

Managers are the same story. Whether you are a manager is a fact about the org chart (`User.managerId` plus `UserDottedLine`), not a role an admin remembers to set. Change the org chart, the access follows.

### 2.3 The Guest story

A Guest is a real account type, which the marketing page promises and the product lacks (audit 2.21). Rules:

- Invited from the share dialog of any object by anyone holding Full access on it (org toggle 5 can restrict to Admins). Invitation carries `orgRole = GUEST`, the object and the object role.
- On accept, the Guest lands directly on the shared object. Their rail shows only the hubs that contain something shared with them (Work if a Space, Folder or List; Docs if a Doc; Tables if a Table and the module is on; Talk if a Channel and the module is on). Settings shows only the Personal section.
- The Guest's sidebar tree is exactly the objects they can read, each shown inside its container as a bare label (the same "scoped" rendering `folderAccessForSpace` already produces for folder-only grantees).
- Search returns only objects they can read. The people picker (for @mentions and assignment) lists only Members who share at least one object with them.
- A Guest can be granted Can view, Can comment or Can edit. Never Full access, except on objects they created themselves (a Doc they wrote), and even then they cannot share it with anyone new; a Member with Full access on the container does the sharing.
- Guests are listed on `/settings/members` in a Guests tab with "Shared objects: N" and two actions: Remove (revokes every grant) and Convert to Member (Admin only).
- Guests never count toward seats.

### 2.4 The Agent story

An Agent is a Member with caps applied after resolution (section 4, rule 10). The only surfaces that change are: no "New Space" affordance, no delete actions in menus, no Export buttons, role selects that offer them Full access are clamped to Can edit. Nothing else in the product knows the flag exists. The `AGENT` matrix column dies with the matrix.

---

## 3. Object roles and the object hierarchy

### 3.1 The one ladder

| Object role | Label in UI | Grants |
|---|---|---|
| FULL | Full access | Everything below plus: rename, settings, statuses and fields, share and change roles, restrict or open, move, archive, delete, transfer ownership, invite Guests to it. |
| EDIT | Can edit | Create and change content: tasks, subtasks, comments, doc text, table rows and columns, SOP steps, whiteboard shapes, files. Create child objects (a List inside a Folder they can edit). Share at their own level or below if org toggle 4 is on. |
| COMMENT | Can comment | Read everything, add comments and reactions, acknowledge SOPs and Policies, respond to Forms. Never change content. |
| VIEW | Can view | Read only. |

Plus an `ownerId` on every container (already exists on Space, Folder, Board, Doc via `createdById`, DataTable via `createdById`), which is not a role: the owner always has Full access and is the person whose access cannot be removed by anyone except themselves (transfer) or an Owner/Admin.

Mapping today's enums:

| Today | Table | Becomes |
|---|---|---|
| `SpaceRole.OWNER` | SpaceMember, FolderMember, BoardMember | FULL (and `ownerId` if unset) |
| `SpaceRole.ADMIN` | same | FULL |
| `SpaceRole.MEMBER` | same | EDIT (matches `canContributeBoard` and the 2026-09-09 decision that Members write) |
| `SpaceRole.GUEST` | same | VIEW |
| `SOPFolderRole.VIEWER` | SOPFolderAccess | VIEW |
| `SOPFolderRole.EDITOR` | SOPFolderAccess | EDIT |
| `SOPFolderRole.OWNER` | SOPFolderAccess | FULL |
| `Visibility.ORG` on Space | Space.visibility | an `EVERYONE` grant on the Space with role = `Space.settings.defaultPermission` mapped (Full edit -> EDIT, Edit -> EDIT, Comment -> COMMENT, View -> VIEW), default EDIT |
| `Visibility.WORKSPACE` on Space | | no EVERYONE grant (today WORKSPACE and PRIVATE are indistinguishable at read time, `space.ts:194-204`) |
| `Visibility.PRIVATE` on Space | | no EVERYONE grant |
| `Visibility.ORG` on Board | Board.visibility | an EVERYONE grant on the List with role VIEW |
| `Visibility.PRIVATE` on Folder or Board | | `restricted = true` on that object |
| `Visibility.WORKSPACE` on Folder or Board | | `restricted = false` (inherits) |

COMMENT is new. It exists because "can discuss but not change" is the most common ask from a Guest-facing business (client reviews a deliverable) and because Docs already promise it in their share modal copy.

### 3.2 Storage: one grant table

```prisma
enum OrgRole   { OWNER ADMIN MEMBER GUEST }
enum ObjectRole { FULL EDIT COMMENT VIEW }
enum GrantSubject { USER DEPARTMENT TEAM EVERYONE }
enum GrantObject  { SPACE FOLDER LIST DOC TABLE SOP_FOLDER CHANNEL }

model AccessGrant {
  id          String       @id @default(cuid())
  organizationId String
  objectType  GrantObject
  objectId    String
  subjectType GrantSubject
  subjectId   String?      // null when EVERYONE
  role        ObjectRole
  grantedById String?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  @@unique([objectType, objectId, subjectType, subjectId])
  @@index([organizationId, subjectType, subjectId])
  @@index([objectType, objectId])
}

model AccessRequest {
  id           String   @id @default(cuid())
  organizationId String
  objectType   GrantObject
  objectId     String
  requesterId  String
  requestedRole ObjectRole @default(VIEW)
  message      String?
  status       String   @default("PENDING") // PENDING | GRANTED | DECLINED | EXPIRED
  resolvedById String?
  resolvedAt   DateTime?
  createdAt    DateTime @default(now())
  @@unique([objectType, objectId, requesterId, status])
  @@index([organizationId, status])
}

// On User
orgRole   OrgRole  @default(MEMBER)
isAgent   Boolean  @default(false)

// On Space, Folder, Board, Doc, DataTable, SOPFolder
restricted Boolean @default(false)   // true = do not inherit from parent
```

`SpaceMember`, `FolderMember`, `BoardMember`, `SOPFolderAccess`, `Space.visibility`, `Folder.visibility`, `Board.visibility`, `User.accessLevel`, `Invitation.accessLevel`, `HRSegment`, `Organization.settings.permissions` are all retired at the end of the migration (section 9). `ConversationMember` stays because it also carries read state and notify level; membership in it is what the gate reads for Talk.

Items have no grants. A task's access is its List's access plus the assignee and creator rules.

### 3.3 The hierarchy and what inherits from what

```
Org
 └─ Space                       grants: users, departments, teams, EVERYONE
     ├─ Folder (nested ≤ 6)      inherits Space unless restricted; own grants add
     │   └─ List                 inherits Folder unless restricted; own grants add
     │       └─ Item             inherits List; + assignee/creator rule; no grants
     ├─ List (no folder)         inherits Space unless restricted; own grants add
     ├─ Doc anchored to Space/Folder/List/Item   inherits the anchor; own grants add
     ├─ Table anchored to Space  inherits the Space; own grants add
     └─ Channel linked to Space  inherits the Space (Can edit and up may post; View may read)
 Standalone Doc                 creator FULL; EVERYONE grant optional; own grants
 Standalone Table               creator FULL; EVERYONE VIEW by default (today's "org-wide table"); own grants
 Notepad (Doc entityType NOTEPAD) owner only, no grants, no Admin read-around
 SOP folder (nested)            inherits parent SOP folder unless restricted; own grants; unfoldered SOPs = EVERYONE VIEW (published only)
 Policy                         Admin + People team FULL; assigned people COMMENT (acknowledge); published = EVERYONE VIEW when org-wide
 Contract (Agreement)           Admin + People team FULL; parties VIEW; nobody else
 Goal (OKR)                     no grants; computed from audience (goal-audience.ts) + manager chain + People team + Admin; COMPANY level = EVERYONE VIEW
 KRA / KPI definitions          EVERYONE VIEW (needed for tagging); Admin + People team EDIT; managers EDIT for their chain's assignments
 Person (people data)           self EDIT; manager chain EDIT; People team EDIT; Admin FULL; every Member VIEW on the directory card only
 Channel (Talk, no Space)       ConversationMember = member; public channel = EVERYONE VIEW+post; DM = members only, no Admin read-around
 App / hub                      computed from org role, module state, relationships and the Apps floor
 Org settings page              Owner/Admin per page (section 6.5)
```

Rules for every container:

- **Inherit down.** A grant on a Space applies to every Folder, List, Item, Doc and Table inside it unless a descendant is Restricted. A grant on a Folder applies to its subtree. A grant lower never leaks upward: a person shared on a List sees the Space and Folder as a bare container label so the breadcrumb and sidebar make sense, and nothing else in them.
- **Add, never subtract.** A direct grant is a floor, not a ceiling. If Priya has Can view on a Space and Can edit on one List inside it, she edits that List and views the rest. If she has Can edit on the Space and someone gives her Can view on a List, she still edits that List (the max wins). The share dialog shows this ("Priya already has Can edit from Space Marketing") and never offers a lower role as if it would take effect.
- **Restricted.** A container with `restricted = true` ignores its parent's grants. Its own grants, its owner, and Owners/Admins still reach it. Restricting is a Full-access action and never affects direct grants already on the object. This replaces "Make private" with a word that says what it does. Un-restricting is the same switch; today a private Folder can never be un-privated (audit Broken #10).
- **EVERYONE grants** are just grants whose subject is everyone in the org (Members only, never Guests). "Open this Space to everyone at Acme as Can edit" is one row. Org toggle 2 sets the default for new Spaces.
- **Department and Team grants** resolve to their current members at read time (the same live resolution `goal-audience.ts` already uses). New hire in the department: has access. Leaver: gone. No "Add all" that copies 40 user rows.

### 3.4 People data, defined

"People data" means everything on a person's profile beyond the directory card: KRAs and weights, KPI records, weekly reviews, review cycles and scores, goals assigned to them, timesheets, assets assigned, compensation and contract fields when those exist, the Talent 9-box position, performance snapshots, onboarding state, notes by managers.

Who reads and edits it:

| Viewer | Directory card (name, avatar, title, dept, email, manager) | People data |
|---|---|---|
| Self | EDIT (own profile) | VIEW own, EDIT the self-service parts (self review, KPI self-record, goal check-in) |
| Manager chain (any manager above, solid or dotted, unlimited depth) | VIEW | EDIT |
| People team member | VIEW everyone | EDIT everyone |
| Owner / Admin | VIEW everyone | FULL everyone (includes delete, export, role changes) |
| Other Members | VIEW | none |
| Guests | only people sharing an object with them, name and avatar only | none |

The Teams hub, `/talent`, `/team/*`, `/reviews`, `/analytics`, `/organization` all render for anyone with at least one report, anyone on the People team, and Owners/Admins, scoped by the same rule: a manager sees their chain, People team and Admins see the org. Nothing is hidden by tier; it is scoped by relationship. The Talent 9-box stays exactly where it is, with the population filtered by `can(viewer, "view", person)`.

### 3.5 Talk channels

- Talk is a premium module. When it is off for the org, `can()` returns `none` for every CHANNEL object and the Talk hub is absent; no per-route special case.
- Public channels: an EVERYONE grant at EDIT (post). Joining creates the ConversationMember row for read state.
- Private channels and group DMs: ConversationMember rows are the grant, role EDIT for everyone in it; the creator is FULL (rename, add, remove).
- Space-linked channels (`Conversation.spaceId`): inherit the Space. Can edit and up on the Space may post; Can view and Can comment may read; Full access on the Space is Full on the channel.
- Owners and Admins do not get read-around on DMs or private channels they are not in. They can see that a channel exists, its name and member count in an admin list, and can archive it. This is the one place the "Admin has Full on everything" rule bends, on purpose, and it is stated in the Access settings page.
- Guests join only channels they are explicitly added to and cannot start DMs with Members who do not share an object with them.

---

## 4. Precedence: the ordered resolution rules

`can(viewer, action, object)` computes the viewer's effective role on the object, then checks the action against that role and any caps. The order below is the whole algorithm; earlier rules short-circuit only where marked.

| # | Rule | Result |
|---|---|---|
| 1 | Viewer is not signed in, is soft-deleted, has status other than ACTIVE or PROBATION, or the object is not in the viewer's org. **Short-circuit.** | none, not discoverable |
| 2 | The object's module is off for the org (Talk channel, Table) or the app is hidden for the viewer's role by the Apps floor. **Short-circuit.** | none, not discoverable |
| 3 | Object has an owner-only hard rule: Notepad docs, DMs and private channels the viewer is not in, another person's personal Settings. **Short-circuit.** | none unless viewer is the owner or member, in which case FULL (Notepad) or EDIT (DM) |
| 4 | Viewer is org Owner or Admin. **Short-circuit.** | FULL, via "org admin" |
| 5 | Viewer is the object's `ownerId` / `createdById`. | FULL, via "owner" |
| 6 | Direct USER grant on this object. | that role, via "shared with you" |
| 7 | DEPARTMENT or TEAM grant on this object where the viewer is a current member. | that role, via "shared with {dept}" |
| 8 | EVERYONE grant on this object (Members only; never Guests). | that role, via "open to everyone" |
| 9 | Relationship rules for this object type: task assignee or creator -> EDIT on the Item and VIEW-for-context on its List; goal audience member -> VIEW (owner EDIT); manager chain over the subject person -> EDIT on people data; People team -> EDIT on people data; SOP author -> EDIT on own drafts; contract party -> VIEW. | that role, via "assigned to you" / "you manage them" / "People team" |
| 10 | Inheritance: unless the object is Restricted, apply rules 5 to 9 to the parent, then the grandparent, up to the Space (max 8 hops, one query for the whole ancestor chain). | the highest role found, via "inherited from {ancestor}" |
| 11 | Take the **maximum** of every role produced by rules 5 to 10. | effective role |
| 12 | Caps: Guest -> at most EDIT, and FULL only on objects they created (rule 5), which still excludes sharing; Agent -> at most EDIT, and the actions `delete`, `export`, `create_space` are always denied. Caps never lower a role below what rule 5 gives on the viewer's own object except for share. | capped role |
| 13 | Action check: `view` needs VIEW; `comment` needs COMMENT; `edit`, `create_child` need EDIT; `share` needs FULL, or EDIT with org toggle 4 (and then only at EDIT or below); `manage`, `restrict`, `move`, `archive`, `transfer` need FULL; `delete` needs FULL and org toggle 8; `export` needs EDIT for the object and is denied to Guests and Agents; `invite_guest` needs FULL and org toggle 5. | allowed / denied |
| 14 | Discoverability (computed when the role is none): true if org toggle 3 is on and the object is a Space, Folder or List in the viewer's org and the viewer is a Member; true if the viewer has a role on any descendant (they see the ancestor as a container label); true if the viewer was ever an assignee of an Item inside it; otherwise false. | discoverable flag |

Reads of a whole list (sidebar tree, search, "Everything", Library) do not call rule 1 to 14 per row. They call `accessibleIds(viewer, objectType, minRole)`, which runs the same rules as set arithmetic in three queries (grants by subject, ancestors, relationship joins) and returns ids. This replaces `visibleSpaceIds`, `listSpacesForUser`, `folderAccessForSpace`, `accessibleFolderIds`, `sopVisibilityWhere` and the item OR-clauses in `/api/me/items`.

### 4.1 Worked examples

**A Guest shared on a List.** Ravi (Guest) is added to List "Website redesign" with Can edit. The List sits in Folder "Q4" in Space "Marketing", neither restricted, neither shared with Ravi.
- `can(Ravi, "edit", List)`: rule 6 -> EDIT. Cap rule 12: Guest, EDIT is allowed. Allowed.
- `can(Ravi, "view", Folder Q4)`: rules 5 to 9 give nothing; rule 10 does not apply upward. Role none. Rule 14: Ravi has a role on a descendant, so discoverable = true. The sidebar shows "Marketing > Q4" as grey container labels with only "Website redesign" under them. The Folder page, if opened, renders the locked page: "You have access to 1 list in this folder."
- `can(Ravi, "share", List)`: rule 13 needs FULL, Ravi is EDIT and a Guest (toggle 4 does not apply to Guests). Denied. The share button is replaced by a "Can edit" chip; clicking it shows who has access, read-only.
- `can(Ravi, "view", Item in the List)`: rule 10 inherits EDIT from the List. Allowed. Ravi can create tasks and assign them only to people who also have a role on this List (the assignee picker is filtered by `accessibleUsers(List)`).
- Directory, Docs hub, Teams hub, org-open Spaces: rule 8 excludes Guests, rule 2 hides the hubs. Not discoverable.

**A Member assigned a task in a Space they are not in.** Maya (Member) is assigned Item "Fix invoice PDF" in List "Backlog" in restricted Space "Finance".
- `can(Maya, "edit", Item)`: rule 9 -> EDIT via "assigned to you". Allowed. She sees the task in My work, opens it in the drawer at `/item/[id]`, edits fields, comments, completes it. This preserves the 2026-09-09 decision and the existing owner short-circuit in `src/app/api/items/[id]/route.ts:30`.
- `can(Maya, "view", List Backlog)`: rule 9 gives VIEW-for-context, which means the gate returns role none for the List's content but `discoverable = true` with `context: { name, statuses, fields }` so the drawer can render the status pill and field labels of her one task. Opening `/boards/backlog` shows the locked page: "You can see 1 task here because it's assigned to you. Ask Finance's owner for access to the whole list." with Request access.
- `can(Maya, "view", Space Finance)`: none, discoverable true (descendant context). Sidebar: "Finance" as a grey label with nothing under it unless she has other grants.
- When the task is reassigned away from her, the rule stops matching on the next request. No cleanup job.

**A manager viewing a report's KRAs.** Dev reports to Anita; Anita reports to Karan (CEO). Neither Anita nor Karan is an Admin.
- `can(Anita, "edit", person Dev)`: rule 9, Anita is in Dev's manager chain -> EDIT. She opens `/people/[dev]`, sees KRAs, records KPI reviews, writes his weekly review, sees him in her Talent 9-box.
- `can(Karan, "edit", person Dev)`: rule 9, Karan is above Anita in the chain -> EDIT. Skip-level works with no "director tier".
- `can(Dev, "view", person Anita)`: rule 9 does not match (Dev is below), no other rule -> directory card only (VIEW on the card is a separate object, "person-card", which every Member has). Anita's KRAs are not discoverable to Dev; her profile page renders the card and "Reports to", nothing else.
- `can(Anita, "view", person Priya)` where Priya is in Sales: none. Anita's Teams hub lists only her chain.

**An HR admin versus a department head.** Sunita is on the People team (org setting) and is a plain Member; Rahul heads Engineering (40 reports across 3 levels) and is a plain Member.
- Sunita: rule 9 People team -> EDIT on every person's people data in the org. Her Teams hub shows the whole org; `/reviews` lets her create and launch cycles for anyone; `/talent` shows the org 9-box; `/policies` and `/agreements` are FULL for her (section 3.3). She does not see `/settings/*` Admin pages, billing, Apps or Modules; she is not an Admin.
- Rahul: rule 9 manager chain -> EDIT on his 40 people only. `/reviews` lets him run reviews for his chain; `/talent` shows his 40. He cannot open Sunita's people data, nor Sales'. He can be given Full access on any Space like anyone else.
- If the company wants Rahul to also manage Settings, an Owner makes him Admin. The model never needs a "Director" concept.

---

## 5. The single gate

### 5.1 Location and shape

`src/lib/access/` (new directory), replacing `src/lib/access.ts`, `access-levels.ts`, `permissions.ts`, `page-gates.ts`, `route-guard.ts`, `alignment-scope.ts`, `hr-segment.ts`, `sop-access.ts`, `doc-access.ts`, the gate halves of `space.ts`, `board.ts`, `folder.ts`, `src/components/layout/os/access-tiers.ts`, `src/hooks/use-role.ts`, `src/hooks/use-permission.ts`.

```ts
// src/lib/access/index.ts
export type OrgRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
export type ObjectRole = "FULL" | "EDIT" | "COMMENT" | "VIEW";

export type Action =
  | "view" | "comment" | "edit" | "create_child" | "share" | "invite_guest"
  | "manage" | "restrict" | "move" | "archive" | "delete" | "transfer" | "export";

export type ObjectRef =
  | { type: "space" | "folder" | "list" | "item" | "doc" | "table" | "whiteboard"
          | "sop" | "sop_folder" | "policy" | "contract" | "goal" | "kra" | "channel"; id: string }
  | { type: "person"; id: string }          // people data of that user
  | { type: "person_card"; id: string }     // directory card only
  | { type: "app"; key: string }            // rail hub or folded app, by AppEntry.key
  | { type: "settings"; page: SettingsPage } // one Admin settings page
  | { type: "org"; action: OrgAction };      // create_space, invite_member, invite_guest, manage_members...

export interface Viewer {
  userId: string;
  organizationId: string;
  orgRole: OrgRole;
  isAgent: boolean;
  // Optional, filled lazily by the gate and cached per request:
  reportTree?: Set<string>;  peopleTeam?: boolean; departmentIds?: string[]; teamIds?: string[];
}

export interface Decision {
  allowed: boolean;
  role: ObjectRole | "none";
  via: "org-admin" | "owner" | "shared" | "department" | "team" | "everyone"
     | "assigned" | "manager-chain" | "people-team" | "inherited" | "module-off" | "none";
  viaObject?: { type: string; id: string; name: string }; // the ancestor that granted, for the UI
  reason: string;            // one plain sentence for the locked page and the audit log
  discoverable: boolean;
  context?: Record<string, unknown>; // e.g. the List's statuses/fields for an assignee-only viewer
}

export function can(viewer: Viewer, action: Action, object: ObjectRef): Promise<Decision>;
export function canMany(viewer: Viewer, action: Action, objects: ObjectRef[]): Promise<Map<string, Decision>>;
export function accessibleIds(viewer: Viewer, type: ObjectRef["type"], minRole: ObjectRole): Promise<Set<string>>;
export function accessibleUsers(object: ObjectRef): Promise<Array<{ userId: string; role: ObjectRole; via: Decision["via"] }>>; // "who has access"
export function explain(viewer: Viewer, object: ObjectRef): Promise<Decision[]>; // every source, for the Check access panel

// Server helpers, the only two ways to enforce:
export async function requireCan(action: Action, object: ObjectRef): Promise<{ viewer: Viewer; decision: Decision }>;
//   API: throws AccessError(404) when !discoverable, AccessError(403, { reason, requestAccess }) otherwise.
export async function gatePage(action: Action, object: ObjectRef): Promise<{ viewer: Viewer; decision: Decision }>;
//   Page: notFound() when !discoverable; returns the decision (page renders locked or read-only mode) otherwise.

// Client:
export function useAccess(): Decision;            // from <AccessProvider> the page wraps its body in
export function useViewer(): Viewer;              // orgRole, isAgent, hasReports, peopleTeam from the session
```

`Viewer` is built once per request by `viewerFromSession()` from the JWT (`orgRole`, `isAgent` are added to the token next to `id` and `organizationId`; `accessLevel` is removed from the token at the end of migration). Everything else the gate needs (report tree, People team membership, department ids) is loaded lazily and memoised on the `Viewer` object for the life of the request, the same per-request `WeakMap` trick `api-helpers.ts:103` already uses for the matrix.

Implementation notes that matter for correctness and speed:

- Ancestor chain in one query. A recursive CTE on `Folder.parentFolderId` and the Space id (the pattern `sop-access.ts:27` already uses) returns the chain and the `restricted` flags; grants for the viewer across the whole chain are fetched in one `AccessGrant.findMany` with `objectId IN chain`. Today's `resolveFolder` loops eight `findUnique` calls.
- `accessibleIds` for Spaces = Spaces with a USER/DEPARTMENT/TEAM/EVERYONE grant for the viewer, union Spaces the viewer owns, union (as container labels only) Spaces that contain something in the viewer's accessible Folders, Lists, or assigned Items. The two flavours ("full read" and "container label") are returned as two sets, exactly the distinction `visibleSpaceIds` vs `listSpacesForUser({ includeFolderContainers })` draws today, so the leak trap in `space.ts:165-171` is preserved by the API's type, not by a comment.
- Denials are logged: `requireCan` and `gatePage` write an `ActivityLog` row `access.denied` with the reason when the object was discoverable (a real person hit a wall), never when it was a random id probe (noise). Grants, role changes, restrict toggles and org role changes write `access.granted`, `access.changed`, `access.revoked`, `org_role.changed`. This closes audit Broken #19.

### 5.2 Who calls it

| Layer | Call | Replaces |
|---|---|---|
| Rail and hub sidebars | `visibleApps(viewer, orgAppsConfig, activeModules)` in `src/lib/rail-apps.ts`, which is `can(viewer, "view", { type: "app", key })` per catalog entry. The rule table lives in the gate: Work, Planner, Docs = any Member; Teams = Member with reports, People team, or Admin, and every Member for Directory and Org chart rows; Talk, Tables = module on and not a Guest unless something is shared; AI = Member; Settings = everyone (Personal), Admin section = Owner/Admin. `AppEntry.requiredAccess` is deleted; the folded links inside hub sidebars call the same function with the folded app key. | `access-tiers.ts`, `canAccessApp`, the per-sidebar re-gating in `apps-catalog.tsx:994-1153`, `docs-sidebar.tsx:166`, `chat-sidebar.tsx:268` |
| Command palette, More launcher, search | filter through `visibleApps` and `accessibleIds` | `command-palette.tsx:235` indexing raw `APPS` |
| Server page | `const { viewer, decision } = await gatePage("view", { type: "list", id })` at the top of the server component; render `<AccessProvider value={decision}>`; render `<LockedPage decision />` when `decision.role === "none"`. | `canRead`/`resolveAccess` in `/boards/[slug]`, `/folders/[id]`, `/people/[id]`, `/team/*`; `requireManagerPage`, `requireHrAdminPage`, `requireManagerOrRedirect`, `requireOrgAdminOrRedirect`; inline lock card on `/settings/structure`; unguarded settings pages |
| Settings layouts | one `src/app/(dashboard)/settings/layout.tsx` calls `gatePage("view", { type: "settings", page })` derived from the pathname; the per-page `layout.tsx` gate files (apps, audit, data, defaults, identity, tags) are deleted | 6 layout gates plus 14 ungated pages |
| API route | `const { viewer } = await requireCan("edit", { type: "item", id })` first line after parsing params. List endpoints use `accessibleIds`. | 220 `isOrgAdmin/isManager/hasRole` calls, 29 inline level compares, `getBoardForReader` (17 files), `getSpaceForReader` (36), `canEditSpace` (23), `docAccessible` (21), `canEditBoard` (9), `canContributeBoard` (3), `canContributeSpace` (3), `folderReadable` (3), `folderVisibleTo` (5), `visibleSpaceIds` (6), `sopVisibilityWhere` (2), `canWriteToFolder` (4), `requirePermission` (16), `hasPermission` (3), `canTouchUserAlignment` (11), `canSeeGoal` (7, becomes the goal branch inside the gate) |
| Cron and agents | `viewerForSystem(orgId)` returns an Owner-equivalent system viewer; every cron write still goes through `requireCan` so a future per-object rule applies to automation too | inline `ORG_ADMIN` checks in `cron/run-due-agents`, `autopilot/workflows` |
| Client components | `useAccess().role` for render decisions; never a session-level role check for object UI. `useViewer()` only for org-level chrome (New Space button, Invite button, Admin settings section). | `useRole()` (16 files), `usePermissions()` (2), `session.user.accessLevel` reads in components |

### 5.3 Discoverable versus accessible, in the UI

| Decision | List row (sidebar, search, Library) | Page | API |
|---|---|---|---|
| role ≥ VIEW | normal row | normal page in read-only, comment, edit or full mode | 200 |
| role none, discoverable | grey row with a lock glyph and the name; click opens the locked page | `<LockedPage>`: object icon and name, owner avatar, one sentence from `decision.reason`, one primary button "Request access" (with a View / Edit choice and an optional message), one text link "Back". The URL stays. The shell, rail, sidebar and breadcrumb stay. | 403 `{ error: "no_access", reason, object: { type, id, name }, owner: { id, name }, requestAccess: true }` |
| role none, not discoverable | absent | `notFound()` (the standard 404 page inside the shell) | 404 `{ error: "not_found" }` |

The distinction is what stops the two failure modes the audit found: a shared List that 404s its page (Broken #1) and a page that renders while every fetch inside it 404s (Broken #2). Page and API call the same function with the same object, so they agree by construction.

### 5.4 Read-only mode

Every page wraps its body in `<AccessProvider value={decision}>`. Components read `useAccess()` and render by role:

| Role | What renders | What does not render |
|---|---|---|
| VIEW | Content, filters, sort, group, search, views switcher, export if allowed, Copy link, a "Can view" chip where the Share button would be (click: who has access, read-only) | Every create, edit, drag, inline-edit, delete, share, settings, rename, "+" affordance; field cells are plain text; the comment composer |
| COMMENT | VIEW plus the comment composer, reactions, acknowledge buttons, form responder | Same as VIEW otherwise; chip reads "Can comment" |
| EDIT | Content controls: add task, inline edit, drag, subtasks, attachments, doc editor, table cells, new List inside a Folder; a "Can edit" chip or, if toggle 4 is on, a Share button that opens the dialog in "add people at Can edit or below" mode | Object settings, statuses and fields editor, rename, restrict, delete, transfer, Full-access role option in the picker |
| FULL | Everything, Share button, object "..." menu in full | nothing hidden |

Rules for implementers: a control that the role cannot use is not rendered, not disabled. The one exception is "Soon" rows that are not access-related, which follow the separate coming-soon policy. Field cells in VIEW mode show a lock cursor and a tooltip "View only. Ask {owner} for edit access." on hover, with the owner name from `decision.viaObject` or the object owner.

`SpaceShareButton` rendered for every reader (`spaces/[slug]/page.tsx:612`), share dialogs that 403 on click, survey Launch/Close, ideas drag, automation mutations, profile-menu Trash, New policy and New contract for employees: all become role-gated renders through `useAccess()` and `useViewer()`.

### 5.5 Denial and redirect: the one convention

There is exactly one behaviour on denial and it never redirects:

1. Not signed in: `/login?callbackUrl=<current>` (the only redirect in the system).
2. Signed in, object not discoverable: 404 page inside the shell.
3. Signed in, object discoverable but no role: the LockedPage at the same URL.
4. Signed in, has a role but not this action: the action is not rendered (read-only mode). If reached anyway (stale tab, direct API call), the API returns 403 with the reason and the client shows one toast: "You need Can edit for that. Ask {owner}." with a Request access action.

`/dashboard`, `/people/me`, `/team/reviews` as denial targets are deleted. A Member typing `/settings/billing` sees the LockedPage ("Billing is managed by workspace Owners", owner avatars, Request access disabled with "Ask an Owner"), not a bounce to a page they did not ask for.

### 5.6 Request access flow

1. LockedPage or 403 toast -> "Request access" -> choose View or Edit (Comment is offered for Docs), optional message -> `POST /api/access-requests` creates an `AccessRequest` (one open request per person per object; a repeat re-sends the notification, no duplicate row).
2. Every Full-access holder of the object (direct, inherited from the nearest ancestor that has explicit Full holders, then the owner, then Admins if none) gets an Inbox row: "Maya requested Can edit on Backlog · Give edit · Give view · Decline". One click writes the `AccessGrant`, resolves the request, notifies Maya, logs `access.granted`.
3. Maya's LockedPage polls (the existing 45 s notifications poller) and turns into the real page when granted. The Inbox row for the requester says "Anita gave you Can edit on Backlog".
4. Requests expire after 14 days (cron, existing reminder cron pattern). An Admin can see open requests on the object's Who has access panel and on `/settings/access`.

---

## 6. The UI

### 6.1 One share dialog

One component, `src/components/access/share-dialog.tsx`, opened from every object's Share button and "..." > "Share" (Space, Folder, List, Doc, Table, Whiteboard, SOP folder, Channel). It replaces `share-space-dialog.tsx`, `share-board-dialog.tsx`, `share-folder-dialog.tsx`, `components/sops/folder-manager.tsx`'s access panel, and the Docs share modal.

Layout (Zoho-clean: white card, one primary, hairline rows, 36 px inputs):

```
Share "Website redesign"                                          [x]
[ Search people, departments, teams, or type an email        ] [Can edit v] [Add]

Everyone at Acme            [ No access v ]     <- the EVERYONE grant; hidden for Guests' view
Inherits from Space "Marketing"   (Restrict)    <- toggle; when restricted: "Restricted. Only people below."

People with access
  Anita Rao        Owner                       (Transfer)
  Dev Kumar        Can edit   v   x
  Sales (dept)     Can view   v   x
  Priya Menon      Can edit   · from Space Marketing   -> link          <- inherited rows, read-only, grouped last
  Ravi (guest)     Can comment v  x   GUEST chip

[Copy link]                                     Open requests (1) ->
```

Behaviour:
- **Picker** searches the whole org directory (name, avatar, department) for any Member with Full or Edit access, regardless of their org chart position. This is the fix for audit Broken #3: the picker calls `GET /api/people/pick?q=`, a new endpoint that returns directory cards for every active Member and Guest-visible people, never scoped by report tree. Report-tree scoping stays on people data, not on whom you can share with. Departments and Teams appear as rows with a member count; adding one creates one DEPARTMENT/TEAM grant, never N user rows.
- **Typing an email** that is not in the org offers "Invite as guest" (role picker limited to View, Comment, Edit) when `can(viewer, "invite_guest", object)`; an Owner/Admin also sees "Invite as member".
- **Role select** offers Can view, Can comment, Can edit, Full access, each with a one-line blurb on hover (the four blurbs in section 3.1). Full access is absent for Guests and for Agents (clamped). An EDIT-holder sharing under toggle 4 sees only View, Comment, Edit.
- **Inherited rows** show the role and "from Space X" with a link; they cannot be edited here, and a direct grant added for the same person shows both with "Effective: Can edit" (the max).
- **Owner row** is pinned first, cannot be removed or demoted; "Transfer" (Full holders only, confirm dialog) makes someone else the owner and leaves the previous owner at Full access.
- **Last Full guard**: removing or demoting the last Full-access holder is refused with "Give someone else Full access first." Removing yourself is allowed only if another Full holder remains; the confirm names them.
- **Read-only mode**: for VIEW, COMMENT and (without toggle 4) EDIT viewers, the same dialog opens with the list and no controls, titled "Who has access", plus one line "Ask Anita Rao to change access" with a Request button.
- **Everyone row** is offered only on Spaces, standalone Docs, Tables and SOP folders. On a List or Folder the row reads "Inherits from Space" instead; opening a nested object to everyone means opening its Space, which is what a user expects.
- Every change autosaves per row with an inline tick and writes the audit row. No Save button.

### 6.2 Members page (`/settings/members`, Owner/Admin)

Table, bordered card, hairline rows, inline column filter (Zoho reference):

| Person | Role | Agent | Reports to | People team | Status | ... |
|---|---|---|---|---|---|---|

- **Role** select: Owner (Owners only may set it), Admin, Member, Guest. Changing to or from Owner and demoting yourself open a confirm that names the remaining Owners; the last Owner cannot be demoted. A change bumps the target's `tokenVersion` so it takes effect on their next request, not their next login (audit 1.11).
- **Agent** switch: Members only.
- **Reports to**: directory picker with cycle detection (A cannot report to B if B is in A's chain).
- **People team**: checkbox that writes org toggle 6 (the People team list). Shown as a column so the answer to "who is HR here" is on the same page as everything else about people.
- **Invite** (Admin+): email, role (Admin, Member, Guest), department, reports to, optional job title. The KRA/SOP "entry gate" stays as an onboarding step after acceptance, not an invite blocker.
- **Guests tab**: every Guest, "Shared objects: N" (click: list), Remove, Convert to Member.
- **Pending invites tab**: resend, revoke.
- Everything logs to the audit feed under an "Access" filter.

`/settings/hierarchy` is folded into `/organization` (org chart), which gets a "Edit reporting lines" mode for Admins; the duplicate renderer is deleted. `/settings/structure`'s access-level explainer is replaced by a four-row explainer of the org roles with live head counts, and its link to "Roles & permissions" now points at `/settings/access`.

### 6.3 Per-object "Who has access"

The share dialog's list is the answer; there is no second surface. Two additions for Admins:

- **Check access** tab inside the dialog (Owner/Admin only): pick any person, see `explain(viewer, object)` rendered as a short chain: "Can edit · shared directly on this List by Anita on 4 Sep. Also: Can view inherited from Space Marketing (open to everyone)." This exposes the reasons `resolveAccess` already computes but nobody can see (audit 6, "effective-permission viewer").
- **Open requests** link showing pending AccessRequests for this object with Give view / Give edit / Decline.

### 6.4 Access settings page (`/settings/access`)

Replaces `/settings/permissions`. One card per toggle from section 8, autosaving switches and selects with an inline tick, a short line under each saying what it changes and who it affects. A second card, "How access works", is the section 0 box as prose with the four role blurbs and the four object role blurbs. A link to Members. Nothing else.

### 6.5 Settings pages and who opens them

Every settings route is an object `{ type: "settings", page }` with a fixed rule in the gate:

| Owner only | Owner and Admin | Everyone (Personal) |
|---|---|---|
| billing, api (keys), security policy (new page: password rules, session length, org MFA, replacing the read-only card on `/account/security`), identity > SSO/SCIM (new section), delete workspace | overview, identity, locale, modules, apps, tags, task-types, members, access, organization (chart), audit, data, defaults, import-export, calendar, integrations, scoring, notifications (org defaults) | account/profile, account/appearance, account/security (own password, MFA, sessions), account/notifications |

One `settings/layout.tsx` gate; the Admin section of the settings nav is built from the same rule so nav and gate cannot drift. C_LEVEL's stray ability to PATCH `/api/settings` (`settings/route.ts:123`, `locale/page.tsx:68`) ends because C_LEVEL no longer exists.

---

## 7. Disposition of the permission matrix

The matrix (`src/lib/permissions.ts`, 16 modules, 79 cells, stored in `Organization.settings.permissions`, edited at `/settings/permissions`) is deleted in full. `checkPermission`, `hasPermission`, `requirePermission`, `getEffectivePermissions`, `use-permission.ts`, `/api/permissions`, `PROTECTED_ADMIN_ROLES`, `DEFAULT_PERMISSIONS` and the page are removed. Orgs' stored matrices are ignored and then dropped from `settings` by the migration. Below, every cell and what enforces the same intent afterwards. "Gate rule" means a fixed rule inside `can()`; "toggle N" refers to section 8; "deleted" means the capability has no separate control anymore because the object ladder covers it or the feature is off the rail.

| Module | Action | Enforced today? | Disposition |
|---|---|---|---|
| people | view | no | Gate rule: directory card VIEW for every Member; never Guests. |
| people | create | yes (invitations POST) | Gate rule: `org.invite_member` = Owner/Admin. `org.invite_guest` = Full holder on an object, toggle 5. |
| people | edit | no | Gate rule: people data EDIT = self (self-service parts), manager chain, People team; FULL = Admin. |
| people | delete | no | Gate rule: Owner/Admin only (today `api/users/[id]` DELETE is `isManager`, which is a bug). |
| people | bulkActions | no | Gate rule: same as edit, scoped by `accessibleIds(person)`. |
| organization | view | no | Gate rule: org chart VIEW for every Member. |
| organization | edit | no | Settings page rule: identity = Owner/Admin. |
| organization | manageDepartments | no | Gate rule: Owner/Admin. (Today managers can create departments; ends.) |
| organization | manageRoles | no | Gate rule: job titles = Owner/Admin + People team. |
| organization | manageOffices | no | Gate rule: Owner/Admin. |
| kras | view | no | Gate rule: KRA definitions VIEW for every Member. |
| kras | create / edit / delete | yes | Gate rule: Owner/Admin + People team EDIT (delete Admin only). |
| kras | assign | yes | Gate rule: EDIT on the target person (manager chain, People team, Admin). |
| kras | recordKpi | no | Gate rule: self on own KPIs; EDIT on the person for manager records. |
| kras | aiGenerate | no | Deleted as a permission; follows kras.create. |
| sops | view | no | Object ladder: SOP folder VIEW; unfoldered published = EVERYONE. |
| sops | create / edit | yes | Object ladder: EDIT on the SOP folder; unfoldered = any Member (creator FULL). |
| sops | publish | yes | Toggle 7. |
| sops | delete | yes | Object ladder: FULL on the folder, toggle 8. |
| sops | assign | no | Gate rule: EDIT on the target person. |
| sops | aiGenerate | no | Deleted; follows sops.create. |
| reviews | view | no | Gate rule: subject self; manager chain; People team; Admin. |
| reviews | create / launch / finalize | no | Gate rule: manager chain for their chain; People team and Admin org-wide. |
| reviews | delete | no | Gate rule: Admin. |
| okrs | view | no | Gate rule: goal audience (existing `canSeeGoal` logic moved into the gate); COMPANY level = everyone. |
| okrs | create / edit | no | Gate rule: any Member creates own goals; manager chain, People team, Admin create for others; owner EDIT. |
| okrs | delete | no | Gate rule: owner or Admin. |
| okrs | checkIn | no | Gate rule: owner and assignees. |
| tasks | view / create / edit | no (Items use board.ts) | Object ladder on the List and Item; assignee rule. |
| tasks | delete | no | Object ladder: EDIT on the List deletes own-created tasks; FULL deletes any; Agents never. |
| tasks | assignToOthers | no | Gate rule: EDIT on the List may assign to anyone with a role on the List. |
| meetings | view / create / edit / delete | no | Deleted. Meetings is an orphan route; if it returns, it is a List item type and follows the ladder. |
| policies | view | no | Gate rule: published and assigned to you, or org-wide published = VIEW; Admin + People team FULL. |
| policies | create | yes | Gate rule: Admin + People team. |
| policies | edit / delete | no | Gate rule: Admin + People team; delete Admin. |
| policies | publish | no | Toggle 7. |
| announcements | view | no | Gate rule: every Member; Guests never. |
| announcements | create | yes | Gate rule: Admin + People team; plus FULL on a Space for Space-scoped announcements. |
| announcements | edit / delete | no | Gate rule: author or Admin. |
| assets | view | no | Gate rule: Admin + People team org-wide; manager chain for their people. |
| assets | viewOwn | no | Gate rule: self. |
| assets | create / edit / delete | yes | Gate rule: Admin + People team (delete Admin). |
| assets | assign | no | Gate rule: EDIT on the target person. |
| surveys | view | no | Gate rule: respondents see surveys targeted at them; Admin + People team see all. |
| surveys | create | no | Gate rule: Admin + People team. |
| surveys | respond | no | Gate rule: targeted respondent. |
| surveys | viewResults | no | Gate rule: creator, Admin, People team. |
| ideas | view / submit / review / delete | no | Deleted. Ideas is off the rail; if revived it is a List. |
| analytics | view | no (page is manager-gated) | Gate rule: anyone with reports (their chain), People team and Admin (org). |
| analytics | viewOrgWide | no | Gate rule: People team and Admin. |
| analytics | export | no | Gate rule: `export` action; Guests and Agents never; Admin for org-wide. |
| tools | view | no | Gate rule: every Member sees tools shared with them (tools become a Table-like object with the ladder); Admin all. |
| tools | create / edit / delete / share | no | Object ladder on the Tools object; Admin FULL. |
| settings | viewGeneral / editGeneral | no | Settings page rule (section 6.5). |
| settings | manageBilling | no | Settings page rule: Owner. |
| settings | manageIntegrations | no | Settings page rule: Owner/Admin. |
| settings | manageAccessControl | no (page gated by PROTECTED_ADMIN_ROLES) | Settings page rule: Owner/Admin on `/settings/access`; Members page Owner/Admin; role Owner only by Owners. |

Count: 79 cells. 18 are enforced today by a `requirePermission` call site (people.create, sops.create/edit/publish/delete, policies.create, kras.create/edit/delete/assign, assets.create/edit/delete plus its dynamic action, announcements.create) and each of those becomes a gate rule at the same call site. 8 are deleted outright (meetings x4, ideas x4). 53 become gate rules or object-ladder checks with a real call site. Zero remain as configurable cells.

What an admin loses: the ability to, for example, give C-Level "Manage integrations" but not "Manage billing". What they gain: every switch they can see does something. The three toggles that carry real configurability (who publishes, who deletes, who invites guests) survive as org toggles.

---

## 8. Org-level toggles and defaults for a new org

Exactly eight, all on `/settings/access`, all stored in `Organization.settings.access` as a flat typed object validated by one zod schema (so nothing is silently stripped the way Inbox prefs are today):

| # | Toggle | Options | Default (new org) | Effect in the gate |
|---|---|---|---|---|
| 1 | Who can create Spaces | Everyone · Admins only | Everyone | `org.create_space`; Agents and Guests never. |
| 2 | New Spaces start as | Open to everyone as Can edit · Open as Can view · Private | Open as Can edit | The EVERYONE grant written on Space creation. Creator can change it in the dialog. |
| 3 | Members can find private Spaces and request access | On · Off | On | Rule 14 discoverability for Spaces, Folders, Lists. |
| 4 | Editors can share | On · Off | On | `share` at EDIT (View/Comment/Edit only). Off = Full holders only. |
| 5 | Who can invite Guests | Anyone with Full access · Admins only · Nobody | Anyone with Full access | `invite_guest`. "Nobody" hides the email path in the dialog. |
| 6 | People team | Pick people and/or a department | Empty | Rule 9 People team on people data; Policies, Contracts, Reviews, Surveys, Assets org-wide. |
| 7 | Who can publish SOPs and Policies | Editors · Admins and People team only | Editors | `publish` on SOP and Policy. |
| 8 | Who can delete Spaces, Folders, Lists, Docs and Tables | Full access holders · Admins only | Full access holders | `delete` on containers. Items are not affected (List EDIT/FULL rule). |

Existing, kept, and now enforced rather than decorative:

- **Apps** (`/settings/apps`): order, hide, floor. Floor options become Everyone · Members with reports · Admins. A hidden app or a floor is enforced by rule 2 of the gate, so a hidden app's routes lock, not just its icon. `alwaysPinned` stays for Work and Settings.
- **Modules** (`/settings/modules`): Talk and Tables. Rule 2. The page gains one line under an off switch: "Turning this off locks N channels / N tables for everyone until it is turned on again. Nothing is deleted."
- **Security policy** (new page, Owner): password rules, session length, org-wide MFA. Not an access toggle; listed here because the audit found it has no editor.

Defaults for a fresh org, together: the creator is Owner; every invite is a Member; Spaces are open to everyone as Can edit; anyone can create a Space; editors can share; anyone with Full access can bring a client in as a Guest; no People team until someone is picked; editors publish SOPs; Full holders delete. A three-person company never opens `/settings/access`. A 400-person company flips 1, 2, 5 and 7 and picks a People team, and that is the whole configuration.

---

## 9. Migration from today's seven systems

Ordered so the product works after every step, so pages and APIs never disagree during the transition, and so no user data is lost (memory: data integrity paramount). Local DB is Neon and prod is aaPanel Postgres; `migrate dev` is broken by drift, so every schema step ships as an idempotent SQL file applied with `prisma db execute` plus a `prisma db pull` check.

### Step 0: the gate reads the old tables

Build `src/lib/access/` with `can()`, `accessibleIds()`, `accessibleUsers()`, `explain()`, `requireCan()`, `gatePage()`, `useAccess()`, `useViewer()`. Internally it reads today's schema: `User.accessLevel` mapped through `orgRoleOf(accessLevel)` (section 2.1 table), `SpaceMember`/`FolderMember`/`BoardMember`/`SOPFolderAccess` mapped through the section 3.1 table, `Visibility` mapped to EVERYONE grants and `restricted`, `HRSegment` ignored, People team = users with accessLevel HR until toggle 6 exists. Add vitest coverage for every worked example in section 4.1 and every row of the section 1.6 disagreement table in the audit, asserting the new single answer. Nothing else changes; zero user-visible effect.

Also in step 0: add `orgRole` and `isAgent` to the JWT (computed from accessLevel at sign-in and refresh) so client chrome can read them before the column exists.

### Step 1: pages and APIs call the gate (the disagreement dies)

File by file, replace the legacy calls with `gatePage`/`requireCan`/`accessibleIds`, in this order because each group is self-contained and testable:

1. Work OS: `/boards/[slug]`, `/folders/[id]`, `/spaces/[slug]`, `/item/[id]`, and the item, board, view, space, folder, favorites, search, whiteboard, files, tables, docs APIs (the 36 `getSpaceForReader`, 17 `getBoardForReader`, 23 `canEditSpace`, 21 `docAccessible`, 9 `canEditBoard` files). This fixes Broken #1 and #2 on the day it lands.
2. People and alignment: `/people/*`, `/team/*`, `/talent`, `/reviews`, `/analytics`, `/organization`, `/kra-kpi`, goals, KRAs, KPI records, weekly reviews, timesheets (the 11 `canTouchUserAlignment`, 7 `canSeeGoal`, 9 `requireManagerPage`, 3 `requireHrAdminPage` files). Directory listing (`/api/users`) stops downgrading scope; people data endpoints scope by `accessibleIds(person)`.
3. Knowledge: SOPs, SOP folders, Policies, Agreements, Announcements, Kudos, Surveys, Candor, Trash (the catalog "hr-admin" pages with no server gate).
4. Settings: one `settings/layout.tsx`; delete the six per-page layout gates; `/api/settings` PATCH per-section rule; `/api/users/[id]` role changes with the Owner guards and a role whitelist (fixes Broken #4).
5. Admin and platform: API keys, SCIM, org preferences, product installations, exports, audit API (currently `isManager` while the page is admin).
6. Nav: `rail-apps.ts` and every hub sidebar through `visibleApps`; command palette and More launcher through the same; delete `access-tiers.ts` and `AppEntry.requiredAccess`.

Each file's PR deletes the legacy import it replaced. `isManager` (120 files) gets a temporary shim `isManager = viewer.hasReports || viewer.peopleTeam || isAdmin` marked `@deprecated` so the count can drop to zero over the step without a big-bang.

### Step 2: the people picker and read-only mode

- `GET /api/people/pick` (whole directory, cards only; Guests get their co-member subset). All pickers (share, assignee, invite, mention, reports-to) use it.
- `<AccessProvider>` on every object page; the five component families that show dead controls (share buttons, create/delete menus, drag handles, inline editors, settings menus) switch to `useAccess()`.
- `LockedPage`, the 403 toast, `AccessRequest` model and inbox rows.

### Step 3: schema

One SQL file, idempotent, applied in a transaction:

1. Create enums `OrgRole`, `ObjectRole`, `GrantSubject`, `GrantObject`; tables `AccessGrant`, `AccessRequest`; columns `User.orgRole`, `User.isAgent`, `restricted` on Space, Folder, Board, Doc, DataTable, SOPFolder; `Organization.settings.access` defaults; `Invitation.orgRole`.
2. Backfill `User.orgRole` and `isAgent` from `accessLevel` (section 2.1 table; earliest COMPANY_ADMIN per org becomes OWNER, verified by a pre-flight report listing every org and its chosen Owner for the founder to eyeball).
3. Backfill `AccessGrant` from `SpaceMember`, `FolderMember`, `BoardMember`, `SOPFolderAccess` (section 3.1 table); `EVERYONE` rows from `Space.visibility = ORG` (role from `settings.defaultPermission`) and `Board.visibility = ORG` (VIEW); `restricted` from `Folder.visibility = PRIVATE` and `Board.visibility = PRIVATE`; set `Space.ownerId`/`Folder.ownerId`/`Board.ownerId` from the OWNER member row where null.
4. People team (toggle 6) seeded with every user whose accessLevel was HR.
5. Row-count assertions: grants written = member rows read; every org has exactly one or more OWNER; no user without orgRole.

The gate switches to the new tables behind a single env flag (`ACCESS_V2_TABLES=true`) that is turned on after the backfill is verified, and can be turned off (the old tables are untouched until step 5).

### Step 4: UI on the new model

Members page, Access settings page, the one share dialog (delete the three old dialogs and the SOP folder manager access panel), Guests tab and Guest invitation flow (Space email invites mint Guests), org chart edit mode (delete `/settings/hierarchy`), Security policy page, Check access tab. Rewrite the copy on `/settings/structure`, the roles empty state, the tour, welcome email and the marketing `/features/access` page to describe the four roles (and drop the violet gradient).

### Step 5: delete

`src/lib/access.ts`, `access-levels.ts`, `permissions.ts`, `role-defaults.ts`'s `tierIdsFor` (starter KRAs pick by hasReports instead), `page-gates.ts`, `route-guard.ts`, `alignment-scope.ts`, `hr-segment.ts`, `sop-access.ts`, `doc-access.ts`, the gate functions in `space.ts`/`board.ts`/`folder.ts`, `access-tiers.ts`, `use-role.ts`, `use-permission.ts`, `/api/permissions`, `/api/me/access` (replaced by `explain`), `/settings/permissions`, `/settings/hierarchy`, the three share dialogs, `share-board-button`/`space-share-button` variants, every hand-copied tier `Set`. Drop columns `User.accessLevel`, `Invitation.accessLevel`, `Role.level`, `Space/Folder/Board.visibility`, tables `SpaceMember`, `FolderMember`, `BoardMember`, `SOPFolderAccess`, `HRSegment`, enum `AccessLevel`, `SpaceRole`, `SOPFolderRole`, `Visibility`; strip `settings.permissions` from every org. Remove `accessLevel` from the JWT. Assert `grep -rn "accessLevel" src` returns zero.

### What breaks and how it is handled

| Break | Handling |
|---|---|
| Sessions issued before step 0 lack `orgRole` in the JWT | The token refresh path (`auth.ts:337-368`) already re-reads the user; `viewerFromSession` falls back to `orgRoleOf(accessLevel)` until step 5. |
| C_LEVEL/VP/DIRECTOR users lose org-wide people data unless they sit at the top of the org chart | Pre-flight report lists every such user whose report tree is not the whole org; the founder decides per person: make Admin, add to People team, or accept the narrower scope. Default: add to People team. |
| MANAGER/TEAM_LEAD users with zero reports lose the Teams hub | Same report; usually the org chart is wrong and the fix is `reportsTo`. |
| Managers who could create departments, offices, users and delete users (`isManager` on those routes) lose it | Intended; listed in the release note. |
| API keys with ADMIN scope | Re-scoped to the creator's current org role; an ADMIN-scope key whose creator is now a Member is downgraded to WRITE and its owner notified. |
| Space-scoped invitations in flight (`Invitation.spaceId` with `accessLevel = EMPLOYEE`) | Accepted as Member if the email matches the org domain, else Guest; the invite email is not re-sent. |
| `Role.level` used by the roles page level chips and `LEVEL_RANK` | Chips read `seniority` (a plain string) or are removed; no access meaning. |
| Orgs with a customised matrix | Nothing to map; the export at `/settings/data` gains a one-time "previous permission matrix.json" download for the record. |
| Third-party docs on documentation.ai describing access levels | Rewritten in step 4 (publish via subagent, nav last, per memory). |

---

## 10. Security invariants and risks

### 10.1 Invariants (tests exist for each)

1. **Full-read sets never widen by lower grants.** `accessibleIds(viewer, "space", VIEW)` returns only Spaces with a Space-level source (grant, everyone, owner, admin). Container labels come from a second, typed return (`containerOnly: Set<string>`) that content endpoints cannot accidentally use. This is the `visibleSpaceIds` leak trap (`space.ts:165-171`) made structural.
2. **Guests never see the directory.** `person_card` VIEW for a Guest is true only for users in `accessibleUsers()` of an object the Guest has a role on. `/api/people/pick`, `/api/users`, @mention search, assignee pickers, Talk DM search all go through it. Test: a Guest with one List sees at most the people on that List.
3. **Guests never hold Full access on anything they did not create, and never share.** Cap rule 12; the share dialog and `/api/access-grants` both enforce it.
4. **Restricted stops inheritance, never removes a direct grant.** Test: restrict a Folder, a person with a direct List grant inside it still reads the List.
5. **Reads never 403.** `requireCan` returns 404 for `!discoverable`; discoverability never confirms the existence of an object the viewer has no relationship to (rule 14 requires a Member and toggle 3, or a descendant relationship).
6. **Notepads and DMs have no Admin read-around.** Rule 3 precedes rule 4. Test: Owner cannot fetch another user's NOTEPAD doc or a DM they are not in.
7. **At least one Owner per org, always.** DB-level trigger or app-level transaction guard on `User.orgRole` updates and deletes; platform staff reset path in `/admin` for the recovery case.
8. **Last Full holder guard on every object.** `/api/access-grants` DELETE/PATCH refuses to leave an object with zero Full holders unless an Owner/Admin does it (they remain Full by rule 4).
9. **Module off means none.** Rule 2 is inside `can()`, so no route, cron or search path can reach a Talk or Tables object while the module is off.
10. **Page and API agree.** Every page test renders with the same `ObjectRef` its data fetches use; a lint rule forbids importing `prisma` in a page or route file that does not import `requireCan`/`gatePage`/`accessibleIds`.
11. **Every access change is audited.** Grants, role changes, restrict toggles, org role changes, Guest invites, requests granted or declined, and discoverable denials write `ActivityLog` rows with actor, target, before and after.
12. **Org scoping is checked before any rule.** Rule 1 compares `object.organizationId` to the viewer's; cross-org ids are `not_found`.

### 10.2 Risks and how the design answers them

| Risk | Answer |
|---|---|
| "Only four roles" is too coarse for a 400-person company that wants a billing admin separate from a people admin. | Owner holds billing; Admin holds people. The People team gives HR org-wide people data without Settings. The one remaining ask, "Admin without Members page", is not supported and is a deliberate simplicity trade. Revisit only if real customers ask. |
| Executives lose org-wide people data when the org chart is incomplete. | Pre-flight report and the People team as the default fix. The org chart becomes load-bearing, which is what a PPMS wants. |
| The `isManager` shim (120 files) lingers. | Step 1 has an explicit count-to-zero exit criterion; the shim is `@deprecated` and lint-flagged. |
| Backfilling grants from four tables could double-count or lose a row. | Row-count assertions and a diff report in step 3; the old tables stay until step 5; the env flag flips the read path back in seconds. |
| Department and Team grants resolve at read time, so a person moved between departments gains or loses access with no visible event. | The Check access tab and the audit entry on department change ("Dev moved to Sales: access changed on N objects") make it visible; this is the same behaviour goals already have. |
| Discoverability leaks names of private Spaces. | Toggle 3, on by default for zero-friction adoption, off for orgs that care; only Members, never Guests; only Space, Folder, List names, never content or member lists. |
| Performance: the gate does a CTE plus one grant query plus relationship checks per call; pages call it once, but list endpoints used to call `getBoardForReader` per row. | `accessibleIds` is set arithmetic in three queries; per-request memoisation on the `Viewer`; indexes on `AccessGrant(organizationId, subjectType, subjectId)` and `(objectType, objectId)`. Budget: one page load resolves in under 20 ms of DB time at 5k grants. |
| Talk private channels bend the Admin-is-Full rule, which a support engineer may find surprising. | Stated on `/settings/access` and in the Admin channel list ("You can archive, not read"). |
| Old share links and bookmarks to `/settings/permissions`, `/settings/hierarchy`. | Redirects to `/settings/access` and `/organization` for one release. |
| The parity mandate (2026-06-05) says match ClickUp's share dialog; this dialog is Notion/Zoho-shaped. | The ClickUp dialog has the same rows (people, role select, inherited) in a busier frame; the founder's Zoho reference (2026-09-11) endorses the calmer frame. Flag for the founder in the design phase, not a blocker. |

---

## 11. Audit findings, each answered

| Finding (access-model.md §3) | Answer in this proposal |
|---|---|
| 1 Direct List share does not open the List | One gate for page and API; rule 6 on the List; container labels in the sidebar (§5.3). |
| 2 Page and data gates disagree | §5.2: same function, same ObjectRef, lint rule. |
| 3 Pickers truncated by report tree | `/api/people/pick`, whole directory for Members (§6.1). |
| 4 Admin can grant SUPER_ADMIN, self-demote silently | Four roles, Owner-only promotion, last-Owner guard, confirm naming remaining Owners, tokenVersion bump (§6.2). |
| 5 Rail tiers are not the permission | `visibleApps` and page gates share rule 2; hide and floor are enforced (§8). |
| 6 Space email invite mints an EMPLOYEE | Mints a Guest (§2.3). |
| 7 55 of 75 matrix cells enforce nothing | Matrix deleted; every cell mapped (§7). |
| 8 Share dialogs have no read-only state | One dialog with a read-only mode (§6.1). |
| 9 Space "Default permission" is dead | Becomes the EVERYONE grant's role (§3.1, toggle 2). |
| 10 Folder visibility immutable | `restricted` toggle on every container, both directions (§3.3). |
| 11 Three role vocabularies plus SOP's fourth | One ladder, one dialog (§3.1). |
| 12 WORKSPACE vs PRIVATE indistinguishable | Both become "no EVERYONE grant"; "Restricted" is the only narrowing word (§3.1). |
| 13 Space ADMIN can remove OWNER, no last-owner guard | `ownerId` is not a role; last Full guard; transfer flow (§6.1). |
| 14 Admin-door pages not server-gated | One settings layout gate (§6.5). |
| 15 `useRole().isAdmin` includes C_LEVEL and HR | Hook deleted; `useViewer().orgRole` (§5.2). |
| 16 HR segments dead code | Deleted; People team setting (§8 toggle 6). |
| 17 Security policy has no editor | Owner page (§6.5). |
| 18 SSO/SCIM promised, no UI | Owner section on Identity (§6.5). |
| 19 Access changes not audited | Invariant 11. |
| 20 Job-title Role vs access Role | `Role.level` dropped; titles have no access meaning (§2.1). |
| 21 SOP folder OWNER cannot manage access | SOP folder = FULL on the object, same dialog (§3.3). |
| 22 Permission cache never invalidated | No client cache; `useAccess` comes from the server decision on the page (§5.4). |
| 23 Three published access-level lists | One `OrgRole` enum with four labels in `src/lib/access/labels.ts`. |
| 24 Two redirect conventions | One convention, no redirects on denial (§5.5). |
| 31 Reports-to cycles | Cycle check in the Members picker (§6.2). |
| 32 Notepad admin read-around disagreement | Rule 3 before rule 4; owner-only (§4). |
| Settings-pages #7: Inbox prefs stripped by zod | Not access, but the same fix pattern: one typed schema per settings section, and `settings.access` is defined that way from day one (§8). |
