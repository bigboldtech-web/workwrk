# WorkwrK unified access model, proposal B: "Sharing first"

Author stance: Google Workspace / Notion class. Four org roles, everything else is a shareable object with one vocabulary, one dialog, one gate. Nothing to configure up front; a new org works on day one with defaults that match how a small business already thinks ("I shared the folder with Priya").

Date: 2026-09-11. Written against commit `6187227a` and the audit inventory in `ui-audit/access-model.md` and `ui-audit/settings-pages.md`. Every file path is repo-relative to `/Users/bigboldtechnologies/theywrk`.

---

## 0. The one-paragraph model

There are exactly two questions the product ever asks, and one function answers both:

1. **Who are you in this workspace?** Owner, Admin, Member or Guest. That is the whole org ladder. Seniority (C-level, VP, director, manager, team lead) is data on the org chart, not a permission. "Manager" is derived from `reportsTo`, never assigned.
2. **What is your level on this object?** Viewer, Commenter, Editor or Full access, computed from direct shares, group shares (Team, Department, Role holders, person Tag, Everyone), built-in rules (owner, task assignee, manager chain, channel member, SOP assignment) and inheritance down the container tree, with "Restricted" as the only way to stop inheritance.

`access(viewer, ref)` in `src/lib/access/` answers both. Nav, pages and APIs all call it. A person who can view but not edit sees the same page in read-only mode. A person who cannot open an object but is allowed to know it exists sees a "Request access" page. Everyone else gets the same 404 as for a thing that does not exist. There are no other outcomes.

---

## 1. Org roles

### 1.1 The four roles

| Role | What they can do | Who can grant it | Seat |
|---|---|---|---|
| **Owner** | Everything an Admin can, plus: transfer ownership, delete the workspace, manage billing and plan, manage the other Admins, hold the last-admin guarantee. Exactly one per workspace (a second Owner is allowed only during a transfer handshake). | Only the current Owner (transfer). Platform staff can reassign when the Owner is gone (back-office "reset tenant owner", new). | Paid |
| **Admin** | Full access on every object in the workspace (reads everything, can share anything, restore, export). Manages Members and Guests, Teams, Departments, org settings, modules, apps, integrations, API keys, audit log, security policy. Cannot touch billing, cannot remove the Owner, cannot demote themselves if they are the last Admin besides the Owner. | Owner or Admin. Promotion needs a typed confirmation; demotion of self needs a confirmation and a second Admin to exist. | Paid |
| **Member** | Sees the directory (name, avatar, title, department, email). Creates Spaces, Lists, Docs, Tables, Canvases, Goals, Teams and Talk channels where org policy allows (default: yes). Is Full access on what they create. Reaches any object shared with them, any object whose general access is "Everyone at {org}", and every person record the manager-chain rule gives them. Can share objects they hold Full access on, and objects they hold Editor on when the object's owner allows editors to share (default: on). | Owner or Admin invite; Members may invite Members when the org policy "Members can invite" is on (default: on, domain-locked). | Paid |
| **Guest** | Reaches only objects explicitly shared with them (directly, or through a Team they were put in). No directory, no "Everyone" grants, no discovery, no creating top-level objects, cannot own a Space, cannot be someone's manager, cannot be shared People data. Maximum level anywhere is Editor. Inside an object where they are Editor they can create tasks, docs, comments like anyone else. | Anyone who can share the object and holds the org policy "can invite guests" (default: Members and Admins). A Guest becomes a Member only by an Admin promoting them (consumes a seat). | Free, never counted |

Everything the old ladder expressed through seniority moves to one of three places:

- **Manager chain** (`User.managerId`, `UserDottedLine`): a manager holds Editor on the People record of every transitive report. Nothing to assign.
- **People shares**: the People tree (`people:org`, `people:department:<id>`, `people:user:<id>`) is a shareable object. "HR" is a person who holds Editor on `people:org`. "HR for Engineering" is a person who holds Editor on `people:department:eng`. A department head (`Department.headId`) holds Editor on their department's People node automatically. This is `HRSegment` done as a share instead of a dead model.
- **Object shares**: a Director who used to see "org-wide alignment" sees exactly what has been shared with them, plus the People subtree under them. The migration (section 8) creates those shares so nobody loses reach on day one.

### 1.2 Job titles carry no access

`Role` (the job-title library at `/people/roles`) keeps `level` as a display field renamed `seniority` in the UI. Assigning a Role never changes `orgRole`. The `roles-client.tsx:319` claim that a role "controls what its holders can see" is deleted. Role holders remain a **share target** ("everyone who holds the title Sales Rep"), which is the only access meaning a title has.

### 1.3 The Guest story, end to end

1. An Editor on the "Website redesign" List opens Share, types `ravi@agency.com`, picks "Can edit". The email is outside the org domain, so the dialog labels the row "Guest" and says "Guests only see what is shared with them and do not use a seat."
2. Ravi gets the invitation email; `/register?token=` creates a `User` with `orgRole = GUEST` and an `AccessGrant` on the List (replaces `api/spaces/[id]/invitations/route.ts:136` minting an `EMPLOYEE`).
3. Ravi's rail shows Work (his shared List under a bare "Shared with me" container), Docs (only docs he was shared), Talk only if he was added to a channel and the module is on. No Teams hub, no directory, no Settings beyond `/account/*`.
4. `@mention` in that List completes only people who also have access to that List. Search returns only objects he can view.
5. If a Member later adds Ravi to a Team, he inherits the Team's shares. If an Admin promotes him to Member, the Guest cap disappears and he sees the directory.

### 1.4 The Agent story

Two things called "agent" exist today and they are separated:

- **The `AGENT` rung** (frontline / external human): folded into **Member**. The only difference in the matrix was `tasks.delete: false`, which becomes "Editors on a List cannot delete tasks they do not own" (a List-level setting, off by default). Orgs that need a limited human use a Guest.
- **AI agents** (`Agent` model, automation actions, Sidekick): a **principal type**, not a role. An agent run carries `actingFor: userId`; `access()` resolves the agent's level as `min(level of actingFor, edit)`. Agents never hold Full access, never share, never read People data beyond what the acting user can, and every write is audited with `actorType: "agent"`. Org policy "AI agents may act on my behalf" (default: on for Members, off for Guests).

### 1.5 Platform staff

Unchanged: `PlatformAdmin` allowlist, admin host, never a tenant role. Add one action to the back-office: "Set workspace owner" for orgs whose Owner left, with audit.

---

## 2. Object roles and the object hierarchy

### 2.1 One vocabulary

| Level | Internal | What it means on any object |
|---|---|---|
| **Viewer** | `view` | Open, read, follow links, export what the object allows viewers to export. |
| **Commenter** | `comment` | Viewer, plus comments and updates on the object and its children (task threads, doc comments, whiteboard sticky comments). Never changes fields. |
| **Editor** | `edit` | Commenter, plus create and change content: tasks, fields, docs, rows, drawings, messages, subfolders and lists inside a container. Can share if the owner allows editors to share (default on). Cannot rename, move, delete, archive, change statuses or settings of the object itself. |
| **Full access** | `manage` | Editor, plus manage the object: rename, move, archive, delete, settings, statuses, views, sharing, transfer ownership. |

Plus one property that is not a level: **Owner** (`AccessNode.ownerId`). Exactly one per object; has Full access; is the only one who can transfer ownership; cannot be removed by a Full-access holder (last-owner guard fixes `space.ts:424-436`).

Mapping from today's enums, applied everywhere: `GUEST -> view`, `MEMBER -> edit`, `ADMIN -> manage`, `OWNER -> manage + ownerId`, SOP `VIEWER -> view`, `EDITOR -> edit`, `OWNER -> manage`. The old `SpaceRole` and `SOPFolderRole` enums and the three dialog label sets die.

### 2.2 Share targets (principals)

| Principal | Source | Notes |
|---|---|---|
| Person | `User` | The only principal a Guest can be. |
| Team | new `Team` + `TeamMember` | Ad-hoc, has an `@alias`, a lead (Full access on the Team object), created by Members. |
| Department | `User.departmentId` | Resolved live; new hires inherit, leavers drop. |
| Role holders | `User.roleId` | "Everyone titled X". |
| Tag holders | `TagAssignment(entityType USER)` | Existing person-tag primitive. |
| Everyone at {org} | all Members, Admins, Owner | **Never Guests.** This is the "general access" row. |
| Reports of {person} | manager chain | Built-in; appears in the dialog as a read-only "via reporting line" row on People objects only. |

Group principals are what keep the grant table small at Fortune-500 scale: sharing a Space with "Engineering" is one row, not 800.

### 2.3 Objects and inheritance

Every shareable thing gets an `AccessNode` row: `(kind, id, orgId, parentKind, parentId, path, ownerId, restricted, findable, archivedAt)`. `path` is the materialized ancestor chain (`space:S/folder:F/list:L`), maintained on create and move, so the gate reads grants for the whole chain in one query.

Inheritance is **downward, additive, most-permissive wins**. A grant on a parent covers every descendant at the same level. A grant on a child never flows up; the ancestor is shown as a bare container ("shared with you", no other children listed), which is how a List shared on its own and a Folder shared on its own already behave for the sidebar.

**Restricted** (`restricted = true`) is the one switch that stops inheritance: the object honours only its own grants, its owner, its built-in rules and org Admins. It replaces `Visibility.PRIVATE` on Space, Folder and Board. On a top-level Space "Restricted" is meaningless (no parent) and the dialog hides it; a Space's reach is purely its general-access row, which collapses the indistinguishable `PRIVATE` vs `WORKSPACE` pair (`space.ts:194-204`).

**General access** replaces `Visibility.ORG`: a grant whose principal is Everyone, at Viewer, Commenter or Editor. The dead "Default permission" select on Space creation (`new-space-dialog.tsx:272`) becomes exactly this row and is therefore enforced.

**Findable** (`findable`) is discoverability, separate from access: when on, Members who have no access still see the object in search and in the sidebar with a lock, and get the request-access page. Default: on for Spaces and Talk channels, off for everything else, forced off under a non-findable ancestor and always off for Guests. "Findable" reveals only the object's kind, name, icon and owner name, never content, counts or child names.

| Object | Kind key | Parent (inherits from) | Built-in rules on top of shares | Notes |
|---|---|---|---|---|
| Space | `space` | none | owner | Top-level container. Members may create (policy). |
| Folder | `folder` | Space or Folder | owner | Restricted supported (today's PRIVATE folder). `updateFolder` gains `restricted` and `findable` (fixes immutable-visibility, audit #10). |
| List (Board) | `list` | Folder or Space | owner | Restricted supported. Direct share is the "share a List without the Space" decision. |
| Task (Item) | `item` | List | owner (creator) at manage on the row only; **assignee** at Editor on the row; watcher at Commenter | Items are not independently shareable in v1 (share = assign or share the List). Subtasks inherit the parent item. |
| Doc | `doc` | its anchor: Space / Folder / List / Item; standalone: none | creator = owner; `NOTEPAD` docs: owner only, **including Admins** (adopt `doc-access.ts:74-81`, drop `access.ts:242`) | Standalone docs default Restricted with owner only (today they are org-visible; migration adds an Everyone Viewer row to preserve reach, section 8). |
| Table (DataTable) | `table` | Space (via `spaceId`) or none | creator = owner | `isPublic` stays as the public-embed switch, separate from access. |
| Canvas (Whiteboard) | `canvas` | Space or none | creator = owner | Today "edit access is org-wide"; migration adds Everyone Editor for existing rows. |
| Library folder / File | `file-folder`, `file` | Space folder (`spaceFolderId`) or Space or none | uploader = owner | Files inherit their folder; signed URLs are issued only after `access >= view`. |
| SOP folder | `sop-folder` | SOP folder or none | owner | Replaces `SOPFolderAccess`; same dialog as everything else, so a folder Owner can finally manage access (audit #21). Unfoldered SOPs live under an implicit `sop-folder:root` with Everyone Viewer, preserving today's "null folder = org-visible". |
| SOP | `sop` | SOP folder | author = owner; `SOPAssignment` = Viewer (published only) | Drafts visible to Editors and the author only. |
| Policy | `policy` | `policy:root` (Everyone Viewer when PUBLISHED) | `PolicyAssignment` = Viewer even when unpublished for ack | Editing needs Editor on `policy:root` (Admins, People Editors). |
| Contract (Agreement) | `contract` | `contract:root` (Restricted) | `AgreementParty` users = Viewer | Admins and explicit shares only. |
| Goal (OKR) | `goal` | none | owner = manage; `GoalAssignee` audience (USER, DEPARTMENT, ROLE, TAG) = Editor for check-ins; `COMPANY` level = Everyone Viewer; manager chain = Editor on reports' goals | The existing `goal-audience.ts` rows are already shares with the same principal kinds; they become `AccessGrant` rows on `goal:<id>`. |
| KRA / KPI definition | `kra` | `kra:library` (Everyone Viewer) | Editor on `people:org` edits | Needed org-wide for tagging work to KRAs. |
| Person record | `person` | `people:department:<dept>` under `people:org` | self = Viewer on the whole record, Editor on profile fields; solid manager chain (depth 6) = Editor; dotted line = Editor (matches today; org toggle can lower it to Viewer); `Department.headId` = Editor on the department node | The record has two layers: **card** (name, avatar, title, department, email, phone opt-in) which every Member can view, and **work record** (KRA assignments, KPI records, weekly reviews, review results, timesheets, assets, 9-box placement) which follows the rules above. |
| Review cycle | `review-cycle` | `people:org` | subject = Viewer of own review; recorded reviewer = Editor of that review | Launch / finalize / delete need Full access on `people:org` (Admins, or a People Editor with the "run review cycles" setting). |
| Talk channel / group / DM | `channel` | none | `ConversationMember` = Editor (post); channel creator = owner | Public channel: `findable` on + self-serve join grants Editor. Private: Restricted. DMs: members only, not shareable. |
| Team | `team` | none | members = Viewer of the Team page; lead = Full access | A Team is also a principal. |
| Workspace | `workspace` | none | Owner and Admin = Full access; Members = Viewer with capability verbs from policy (create Space, invite, create Team, create channel) | Everything under Settings > Workspace gates on this one node. |
| Module | `module:<talk\|tables>` | workspace | inactive `ProductInstallation` = none for everyone | Cap applied to every object of that module. |

Announcements, Kudos, Surveys, Candor, Tools, Assets, Analytics, Trash: none of these need their own ACL. Announcements target an audience (already `targetAudience`) and are Everyone Viewer; posting needs Editor on `people:org` or `workspace` manage. Kudos: everyone gives, everyone sees (that is the point). Surveys: create needs People Editor, respond is by audience. Tools and Assets: assets are rows in a People-owned list (`people:org` Editor manages, each assignee views their own). Trash: you see what you could manage. Analytics: aggregates over what you can view.

---

## 3. Precedence: the ordered resolution rules

`access(viewer, ref)` runs these in order and returns the first terminal answer or the maximum of the additive ones. `reason` and `via` are always filled so the UI can explain the answer.

1. **Org boundary.** The object's `orgId` must equal the viewer's active org and the viewer must be `status ACTIVE`, not deleted. Otherwise `none` ("not found"). Cross-org is never a 403, always a 404.
2. **Module cap.** If the object belongs to a premium module whose `ProductInstallation` is not `ACTIVE`, `none` for everyone including Admins ("module is off"). Admins get the enable link on the page.
3. **Personal objects.** `NOTEPAD` docs and per-user preference objects: `manage` for the owner, `none` for everyone else, including Owner and Admin.
4. **Org role override.** Owner and Admin: `manage` on everything else. Terminal.
5. **Object owner.** `AccessNode.ownerId === viewer` gives `manage`. Terminal.
6. **Additive grants.** Collect every candidate level and take the maximum:
   a. Direct grant to the viewer on the object.
   b. Group grants on the object for any principal the viewer expands to (Teams, Department, Role, Tags, Everyone if not a Guest).
   c. Built-in rules for the object kind (task assignee, watcher, channel member, SOP or policy assignment, goal audience, manager chain, department head, self).
   d. **Inherited**: unless the object is `restricted`, the result of steps 6a to 6c evaluated on each ancestor in `path`, nearest first (a nearer ancestor's Restricted flag stops the walk there).
7. **Guest cap.** If the viewer is a Guest, `min(level, edit)`.
8. **Archived cap.** If the object or any ancestor is archived, `min(level, view)` for everyone except `manage` holders (who can restore).
9. **Discover.** If the level is `none`, the viewer is not a Guest, and the object and all its ancestors are `findable`, return `discover`.
10. **Verbs.** Attach the verb set for the kind and level, adjusted by org policy and object settings (`editorsCanShare`, `editorsCanDeleteOthersTasks`, `commentersCanExport`).

Rank: `none < discover < view < comment < edit < manage`.

### 3.1 Worked examples

**A. A Guest shared on a List.** Ravi (Guest) has a direct grant `edit` on `list:L` inside Space S (which he has no grant on). Step 1 ok, 2 ok (core), 3 n/a, 4 no, 5 no, 6a `edit`, 6b nothing (Guests do not expand to Everyone), 6c nothing, 6d: S is not Restricted but Ravi has nothing on S, so inherited is `none`. Max = `edit`. Step 7 keeps `edit`. Result: `edit` via "shared with you on Website redesign". His sidebar shows S as a bare container with only L under it; `/boards/[slug]` opens (fixes Broken #1); `/api/boards/L/items` writes succeed (fixes Broken #2); `/spaces/S` is a 404 for him (S is not findable to Guests). @mentions in L complete only L's members.

**B. A Member assigned a task in a Space they are not in.** Meera (Member) is assigned `item:T` in `list:L` in Space S; S is Restricted with no grant for Meera. On `item:T`: 6c assignee rule gives `edit`. Result `edit` on T ("assigned to you"). On `list:L`: no grant, not findable (default off for lists), result `none` for the List page, but `/item/T` renders with a breadcrumb that shows "Website redesign" as plain text (name comes from the item's own `via` payload, which the rule exposes because the assignee can already see the task's list name in the task itself). Her My Work shows T. If S has `findable` on, the breadcrumb link to S resolves to the request-access page. This matches the decision "assigning a task grants the assignee access to that item" and does not widen it to the List (invariant 9.4).

**C. A manager viewing a report's KRAs.** Arjun manages Priya (solid line). On `person:priya`: 6c manager chain gives `edit` on the work record. He sees her KRAs, records KPI values, writes her weekly review comments. On `person:priya` for someone two levels down: same rule, depth 6, `edit`. The Teams hub appears for Arjun because `listAccessible(viewer, "person")` returns more than himself. The Talent 9-box page renders the intersection of his People scope with the cycle. Nothing was configured.

**D. HR admin vs department head.** Sana holds `edit` on `people:org` (created by the migration from her old `HR` rung, or by an Admin sharing "People: whole organization" with her in the Members page). Dev is `Department.headId` of Engineering and manages nobody directly. On `person:priya` (Engineering): Sana gets `edit` via inheritance from `people:org`; Dev gets `edit` via the department-head rule on `people:department:eng`. On `person:kim` (Finance): Sana `edit`; Dev `view` of the card only (every Member sees the card), `none` on the work record. On `review-cycle:Q3` launch: Sana needs `manage` on `people:org`, which she has only if an Admin granted Full access rather than Editor; the dialog explains "Full access on People lets this person launch review cycles and export people data." Dev cannot launch. On `/settings/members`: neither, that is `workspace` manage. On `/reviews` (cycle administration): Sana yes, Dev sees the cycles in read-only mode with his department's people only.

**E. Space Full access vs a Restricted List inside it.** Nia has `manage` on Space S. `list:L` inside S is Restricted and she has no grant on L. Step 6d stops at L because L is Restricted, so Nia's answer is `none` (or `discover` if L is findable). This is a deliberate change from `board.ts:645-651` where a Space OWNER pierced a PRIVATE board; the migration grants the Space owner an explicit `manage` on every existing PRIVATE board so nobody loses access on day one (section 8). Admins still see everything (step 4). This matches ClickUp private lists and Notion restricted pages.

---

## 4. The single gate

### 4.1 Signature and location

New folder `src/lib/access/` (the existing `src/lib/access.ts` is renamed to `src/lib/access/legacy-resolver.ts` during migration and then deleted).

```ts
// src/lib/access/index.ts
export type Level = "none" | "discover" | "view" | "comment" | "edit" | "manage";
export type Kind =
  | "workspace" | "module" | "space" | "folder" | "list" | "item" | "doc" | "table"
  | "canvas" | "file-folder" | "file" | "sop-folder" | "sop" | "policy" | "contract"
  | "goal" | "kra" | "people-scope" | "person" | "review-cycle" | "channel" | "team";
export interface Ref { kind: Kind; id: string }
export type Verb =
  | "share" | "rename" | "move" | "archive" | "delete" | "settings" | "export"
  | "create-child" | "comment" | "edit-content" | "delete-others-content"
  | "create-space" | "invite-member" | "invite-guest" | "create-team" | "create-channel"
  | "launch-review" | "record-kpi" | "transfer-ownership";
export interface Viewer {
  userId: string; organizationId: string; orgRole: "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
  /** set when an AI agent or API key acts for the user */
  actingAs?: { type: "agent" | "api-key"; id: string; cap: Level };
}
export interface Decision {
  level: Level;
  verbs: ReadonlySet<Verb>;
  reason: string;                                   // "shared with you as Editor"
  via?: { kind: Kind; id: string; name: string };   // the ancestor or rule that granted it
  owner?: { id: string; name: string };
  requestable: boolean;                             // true when level === "discover"
}

export async function access(viewer: Viewer, ref: Ref): Promise<Decision>;
export async function accessMany(viewer: Viewer, refs: Ref[]): Promise<Map<string, Decision>>;
export function meets(d: Decision, need: Level): boolean;
export function can(d: Decision, verb: Verb): boolean;

/** Ids of every object of `kind` the viewer can reach at >= `need`, as SQL-able sets
 *  (direct + group + built-in + inherited via path prefix). Feeds sidebars, search, lists. */
export async function listAccessible(viewer: Viewer, kind: Kind, need?: Level, opts?: { under?: Ref }): Promise<AccessibleSet>;

/** Throws AccessError { ref, need, have, requestable } */
export async function requireLevel(viewer: Viewer, ref: Ref, need: Level): Promise<Decision>;
```

Supporting files: `levels.ts` (rank, labels, blurbs, the one copy of the vocabulary used by every UI), `principals.ts` (`expandPrincipals(viewer)`: user, team ids, department id, role id, tag ids, `EVERYONE` unless Guest; cached per request), `nodes.ts` (AccessNode read/write, `path` maintenance on create and move), `grants.ts` (AccessGrant CRUD, always audited, last-owner and self-demotion guards), `rules/<kind>.ts` (one file per kind returning built-in candidate levels), `requests.ts` (access requests), `viewer.ts` (`viewerFromSession(session)`; `viewerFromApiKey(key)` caps by scope; `viewerForAgent(run)`), `errors.ts`, `server.ts` (page and API adapters), and `index.test.ts` with a parity suite against every row of audit section 1.6.

Per-request caching: `accessMany` is the workhorse; the sidebar, a List page and its items call it once with all refs. Within a request, `principals` and every loaded `AccessNode` are memoized on the session object (same WeakMap pattern as `api-helpers.ts:103`). Resolution cost is two indexed queries: nodes by `path` prefix, grants by `(subjectKind, subjectId) IN chain AND (principalKind, principalId) IN viewerPrincipals`.

### 4.2 How nav, page and API call it

**Nav (rail, hub sidebars, More launcher, command palette).** The catalog's `requiredAccess` tier is replaced by `access: Ref | (viewer) => Ref` per app and per sidebar link, e.g. Teams hub `{kind:"people-scope", id:"org"}` with a `need: "view-beyond-self"` predicate (`listAccessible(viewer,"person").size > 1`); Reviews `people-scope:org >= edit`; Settings admin door `workspace >= manage`; Talk `module:talk >= view`. `visibleRailApps` calls `accessMany` once with every app ref. The org's Apps page keeps order and hide; **hide is now real**: a hidden app's routes render the "turned off by your admin" AccessView. The per-app "floor" select is deleted (there are no tiers). The command palette filters through the same list, closing `command-palette.tsx:235`.

**Pages.** One server helper, used by every route that shows an object:

```ts
// src/lib/access/server.ts
export async function gatePage(ref: Ref, need: Level = "view"): Promise<{ viewer; decision }>
```
It never redirects (except unauthenticated to `/login`). It returns the decision when `level >= need`. When `level === "discover"` it renders `<RequestAccessView>`; when `none` it calls `notFound()`; when the level is below `need` but at least `view`, it still returns and the page renders in read-only mode (section 4.4). Every page passes `decision` into its client tree through `<AccessProvider>` so controls can ask `useAccess()` without a fetch. `page-gates.ts` and `route-guard.ts` are deleted; `settings/layout.tsx` calls `gatePage({kind:"workspace"}, "manage")` for the admin group and nothing for `/account/*`, which is the one layout gate the audit asked for (#14).

**APIs.** `gateApi(session, ref, need)` returns `{ viewer, decision } | NextResponse`. Convention: `none -> 404 {error:"not_found"}`; `discover -> 403 {error:"no_access", requestable:true, ref}`; below `need` -> `403 {error:"insufficient", need, have, ref}`; module off -> `403 {error:"module_off", module}`. The `useApi` client wrapper turns `insufficient` into one toast ("You need edit access to do that") and `no_access` into the request-access sheet. `getSessionAndModule` folds into `gateApi` through the module cap. `hasRole / isManager / isOrgAdmin` in `api-helpers.ts` become `viewer.orgRole` checks and are only legal inside `src/lib/access/`; an ESLint rule forbids importing them elsewhere.

**Lists and search.** Every endpoint that returns many objects (`/api/spaces`, `/api/boards`, `/api/docs`, `/api/tables`, `/api/files`, `/api/search`, `/api/whiteboards`, `/api/entity-links`, `/api/users`) builds its `where` from `listAccessible`. `visibleSpaceIds` survives, renamed `fullyReadableSpaceIds`, defined as "Spaces where the viewer holds `>= view` on the Space node itself" and used exactly where it is used today (section 9.1).

### 4.3 Discoverable vs accessible

- `findable` on the node, defaulting per kind (section 2.3), inherited as a ceiling (a child cannot be findable if its parent is not).
- `discover` is a real level below `view`: search shows the row with a lock and the owner's name; the sidebar shows locked rows only for Spaces and public channels (lists and folders never appear locked, to keep trees clean); opening gives `<RequestAccessView>`.
- The API for a `discover` object returns only `{ kind, id, name, icon, owner: {name}, requestable: true }` from one endpoint (`GET /api/access/peek?ref=`), nothing else. No child counts, no descriptions.
- Guests never get `discover`.

### 4.4 Read-only mode

There is no page an employee can open and get a 403 on. If `gatePage` returns `view` or `comment` where the page has editing chrome, the page renders with:

- Every mutating control **hidden**, not disabled: no "+ Task", no field editors (cells render as text), no Share button (replaced by "Who has access" which opens the same dialog read-only), no "..." items that write, no drag handles, no bulk bar. `<Gated verb="edit-content">` wrappers around each control read `useAccess()`; the wrapper renders nothing when the verb is absent. Commenters keep the comment composer only.
- One slim banner under the content header: "You can view this List. Ask {owner} for edit access." with a "Request edit access" button (opens the request sheet). The banner is dismissible per object per session.
- Data endpoints return the same payloads; write endpoints are never called because the controls are gone; if a stale tab calls one, the API returns `insufficient` and the toast explains.

This replaces every disabled-control pattern in the audit (surveys Launch, ideas drag, share dialogs, profile-menu Trash, settings pages rendered read-only for managers).

### 4.5 Denial convention (the one)

| Situation | Page | API | Nav |
|---|---|---|---|
| Unauthenticated | redirect `/login?callbackUrl=` | 401 | n/a |
| Object does not exist, other org, `none` and not findable | `notFound()` (the app-host 404 with OS chrome) | 404 | never listed |
| `discover` | `<RequestAccessView>` (200) | 403 `no_access` + peek | listed locked (Spaces, channels, search) |
| `view`/`comment` on an editing page | read-only mode | 403 `insufficient` on writes | listed normally |
| Module off | `<ModuleOffView>` (200), Admins see the enable button | 403 `module_off` | hub hidden |
| App hidden by admin | `<AppOffView>` (200) | 403 `app_off` | hidden |
| Settings admin area, non-admin | `<AdminOnlyView>` inside SettingsShell (200) | 403 `insufficient` | admin group hidden |

No `/dashboard`, `/people/me`, `/team/reviews` redirects. `BackButton{fallbackHref}` sits on every AccessView.

---

## 5. The UI

### 5.1 One share dialog: `src/components/access/share-dialog.tsx`

Opened from: every object's "Share" button (content header, right side, next to Ask AI), every "..." menu "Share", the sidebar row hover "..." on Space/Folder/List, the Talk channel header, the Goal page, the SOP folder row, the Person page (as "Who can see this record", People objects only). Props: `ref`, `mode: "manage" | "readonly"`, chosen from `useAccess(ref).can("share")`. Replaces `share-space-dialog.tsx`, `share-board-dialog.tsx`, `share-folder-dialog.tsx`, `components/sops/folder-manager.tsx` access panel, and the Goals sharing panel.

Layout (centred modal 560, Zoho-clean: title, one search field, one list, one footer):

1. **Title**: "Share {name}" with the object's `EntityTile`. Read-only mode: "Who has access to {name}".
2. **Add row**: one search input "Add people, teams or departments" (Members only; Guests and read-only mode do not get it). Results come from `GET /api/access/principals?q=` which returns the **whole directory** (name, avatar, department) plus Teams, Departments, Role holders, Tags; never scoped by the caller's report tree (fixes Broken #3). An email that is not a member offers "Invite {email} as Guest" or "as Member" according to org policy and domain. A level select sits to the right of the input: Viewer / Commenter / Editor / Full access, with one-line blurbs from `levels.ts`. Enter adds. An optional "Notify" checkbox with a message field (default on, as Drive).
3. **People with access**: rows of avatar, name, secondary line, level select on the right. Order: Owner (pinned, level shows "Owner", menu offers "Transfer ownership" and nothing else), then direct grants, then group grants (a Team row shows its member count and expands), then **inherited rows greyed** with "via {ancestor name}" and a link; inherited rows cannot be changed here, the link opens the ancestor's dialog. Built-in rows ("Managers of these people", "Assignees of tasks") appear as one informational row each. Each editable row's menu: change level, Remove, and for a person "Make owner". Removing yourself asks for confirmation. The last Full-access holder besides the owner cannot be removed if the owner is deactivated (guard in `grants.ts`).
4. **General access** (one row with a select): "Restricted: only people added above" or "Everyone at {org}: Viewer / Commenter / Editor". Below it, a small "Findable by everyone" switch (hidden for Guests, forced off when the parent is not findable; tooltip explains). For a non-top-level container a third option appears first: "Inherits from {parent}" (the default), and choosing "Restricted" is what sets `restricted = true`; the copy says "Stops access from {parent}. Only the people listed here, admins and you."
5. **Footer**: "Copy link" (left), a gear that opens a two-toggle popover ("Editors can share", "Editors can delete tasks they did not create") and "Pending requests (2)" when there are access requests, and "Done" (right). No Save button; every change is immediate with an undo toast.

Read-only mode shows sections 1, 3 (levels as text), 4 (as text) and the footer's Copy link and "Request {next level} access". Guests see only themselves, the owner, and the general-access text "Shared with you".

Vocabulary rules: the four level labels and blurbs come from `levels.ts` and nowhere else. No "Can manage", "Member", "Guest role", "Admin" as object levels anywhere.

### 5.2 Members & roles page: `/settings/members`

Gated by `workspace >= manage` through the settings layout. Tabs: **People**, **Guests**, **Teams**, **Pending invites**.

People table (Zoho card table, hairline rows): Person, Role (select: Owner shown as text, Admin / Member; a typed-confirmation modal for promotion to Admin; self-demotion asks and requires another Admin), Reports to (searchable picker, cycle check), Department, Teams (chips), Status. Row menu: Open profile, Share People scope with this person (opens the share dialog on `people-scope:org` prefilled with them), Convert to Guest, Deactivate. Filters: role, department, team. A count strip: Owner 1, Admins N, Members N, Guests N (free).

Guests table: Guest, Shared objects (count with popover listing them), Added by, Last active. Row menu: Promote to Member, Remove (revokes every grant).

Teams tab: create Team (name, `@alias`, lead, members), edit, delete. A Team row shows what it is shared on.

Pending invites: as today, plus the role (Member / Guest) and "Invited to" (object) columns.

Right rail on this page: **Check access** panel: pick a person and paste an object link; shows the decision, level, verbs and the `via` chain in plain words ("Priya can edit Website redesign because she is in Team Marketing, which has Editor on Marketing Space"). Built on `access()` reasons; also reachable from any share dialog footer as "Check someone's access".

`/settings/hierarchy` merges into `/organization` (the org chart), which becomes a Teams-hub page for anyone with People scope beyond self and a settings link for Admins. `/settings/structure` becomes a plain explainer of the four roles and the People scope with live counts; `/settings/permissions` is deleted (section 6).

### 5.3 Per-object "Who has access"

Every content header shows an avatar stack (real people this time: the first five direct grants and the owner, from `GET /api/access/grants?ref=`), clicking opens the share dialog in the mode the viewer is entitled to. The fake `PEOPLE` avatars in `OsTitleBar` are removed. A lock glyph next to the name means Restricted; a globe glyph means Everyone at {org} has access; a hover tooltip states the general-access sentence.

### 5.4 Request access flow

`<RequestAccessView>` (page) and the request sheet (from banners and locked rows): shows kind, name, owner; a level choice (Viewer or Editor; Commenter where the kind supports it) and an optional message; "Request access". `POST /api/access/requests` creates an `AccessRequest` (one open request per person per object; repeat presses re-notify at most once per 24h). The owner and every Full-access holder get an inbox notification "Priya requested edit access to Website redesign" with Approve as Viewer / Approve as requested / Deny inline. Approve writes an `AccessGrant` through `grants.ts` (audited) and notifies the requester. The share dialog shows the pending list in its footer. Org policy can turn requests off entirely (default on).

### 5.5 Where "management" lives

Object-scoped settings (statuses, views, sharing, task types default, automations) stay in the object's "..." menu and never in global Settings, as the Phase 2 brief requires. Settings > Workspace > **Access** is the only global access page (section 7).

---

## 6. Disposition of the permission matrix

The matrix (`src/lib/permissions.ts`, `Organization.settings.permissions`, `/settings/permissions`, `/api/permissions`, `use-permission.ts`, `hasPermission`, `requirePermission`) is **deleted in full**. Nothing in a sharing-first model is a per-tier checkbox; every cell either becomes a share level on an object, a verb derived from a level, an org policy toggle, or is dropped because the module is out of scope. The table lists all 79 cells.

Legend for "Enforced by": `obj(kind, level)` = `access()` level on that object kind; `verb` = a verb attached by `access()`; `policy` = an org toggle in Settings > Workspace > Access; `deleted` = no equivalent, feature not in scope or the cell never meant anything.

| Module.action | Today | Disposition | Enforced by |
|---|---|---|---|
| people.view | cosmetic | replaced | `obj(person, view)`: card for every Member; work record by manager chain, department head, People shares |
| people.create | enforced (invitations) | replaced | `policy: membersCanInvite` + `verb invite-member / invite-guest` on `workspace` |
| people.edit | cosmetic | replaced | `obj(person, edit)`; profile fields self-editable |
| people.delete | cosmetic | replaced | `obj(workspace, manage)` (deactivate is admin-only) |
| people.bulkActions | cosmetic | replaced | `obj(people-scope, edit)` on the scope the bulk action targets |
| organization.view | cosmetic | replaced | org chart visible to anyone with People scope beyond self; card-level chart for all Members |
| organization.edit | cosmetic | replaced | `obj(workspace, manage)` (Identity page) |
| organization.manageDepartments | cosmetic | replaced | `obj(workspace, manage)`; department head edits their own department's description |
| organization.manageRoles | cosmetic | replaced | `obj(workspace, manage)` or `obj(people-scope:org, edit)` (job-title library) |
| organization.manageOffices | cosmetic | deleted | Offices is a "Coming soon" stub; re-add as `workspace manage` when built |
| kras.view | cosmetic | replaced | `obj(kra, view)`: library is Everyone Viewer |
| kras.create | enforced | replaced | `obj(people-scope:org, edit)`; managers may create KRAs scoped to their reports (`obj(person, edit)`) |
| kras.edit | enforced | replaced | same as create |
| kras.delete | enforced | replaced | `obj(people-scope:org, manage)` |
| kras.assign | enforced | replaced | `obj(person, edit)` on the assignee |
| kras.recordKpi | cosmetic | replaced | `verb record-kpi`: self on own KPIs, `obj(person, edit)` for others |
| kras.aiGenerate | cosmetic | replaced | same gate as kras.create; AI is a helper, not a permission |
| sops.view | cosmetic | replaced | `obj(sop, view)` via SOP folder shares and assignment |
| sops.create | enforced | replaced | `obj(sop-folder, edit)` on the target folder (`sop-folder:root` Editor = policy `membersCanCreateSops`, default on) |
| sops.edit | enforced | replaced | `obj(sop, edit)` |
| sops.publish | enforced | replaced | `obj(sop-folder, manage)` of the folder or SOP owner |
| sops.delete | enforced | replaced | `obj(sop, manage)` |
| sops.assign | cosmetic | replaced | `obj(person, edit)` on each assignee, `obj(sop, view)` on the SOP |
| sops.aiGenerate | cosmetic | replaced | same as sops.create |
| reviews.view | cosmetic | replaced | `obj(review-cycle, view)`: subjects see own, reviewers theirs, People Editors all |
| reviews.create | cosmetic | replaced | `verb launch-review` = `obj(people-scope:org, manage)` |
| reviews.launch | cosmetic | replaced | same |
| reviews.finalize | cosmetic | replaced | same |
| reviews.delete | cosmetic | replaced | `obj(workspace, manage)` |
| okrs.view | cosmetic | replaced | `obj(goal, view)` (audience, COMPANY level, manager chain) |
| okrs.create | cosmetic | replaced | `policy: membersCanCreateGoals` (default on) |
| okrs.edit | cosmetic | replaced | `obj(goal, edit)` |
| okrs.delete | cosmetic | replaced | `obj(goal, manage)` (owner, manager chain, Admin), same shape as `canDeleteGoal` |
| okrs.checkIn | cosmetic | replaced | `obj(goal, edit)` for audience members |
| tasks.view | cosmetic | replaced | `obj(item, view)` via List inheritance and assignment |
| tasks.create | cosmetic | replaced | `obj(list, edit)` (`verb create-child`) |
| tasks.edit | cosmetic | replaced | `obj(item, edit)` |
| tasks.delete | cosmetic | replaced | `obj(item, manage)` for the creator, `obj(list, manage)`, or `verb delete-others-content` when the List setting allows Editors |
| tasks.assignToOthers | cosmetic | replaced | `obj(item, edit)`; assignee picker lists people who can view the List plus the directory (Members) |
| meetings.view | cosmetic | deleted | Meetings is an orphan route; if revived it is `obj(item)` on a List of type Meeting |
| meetings.create | cosmetic | deleted | same |
| meetings.edit | cosmetic | deleted | same |
| meetings.delete | cosmetic | deleted | same |
| policies.view | cosmetic | replaced | `obj(policy, view)`: published = Everyone, assignment = Viewer |
| policies.create | enforced | replaced | `obj(policy:root, edit)` (Admins and People Editors) |
| policies.edit | cosmetic | replaced | `obj(policy, edit)` |
| policies.delete | cosmetic | replaced | `obj(policy, manage)` |
| policies.publish | cosmetic | replaced | `obj(policy:root, manage)` |
| announcements.view | cosmetic | replaced | audience rows on the announcement (Everyone by default) |
| announcements.create | enforced | replaced | `obj(people-scope:org, edit)` or `obj(workspace, manage)`; a manager may post to their reports (`obj(people-scope:<subtree>, edit)`) |
| announcements.edit | cosmetic | replaced | author (owner) or same as create |
| announcements.delete | cosmetic | replaced | same |
| assets.view | cosmetic | replaced | `obj(people-scope:org, view)` for the whole register |
| assets.viewOwn | cosmetic | replaced | built-in: assignee = Viewer of their asset rows |
| assets.create | enforced | replaced | `obj(people-scope:org, edit)` |
| assets.edit | enforced | replaced | same |
| assets.delete | enforced | replaced | `obj(people-scope:org, manage)` |
| assets.assign | cosmetic | replaced | `obj(people-scope:org, edit)` and `obj(person, view)` on the assignee |
| surveys.view | cosmetic | replaced | audience rows (respondents) + `obj(people-scope:org, edit)` (authors) |
| surveys.create | cosmetic | replaced | `obj(people-scope:org, edit)` |
| surveys.respond | cosmetic | replaced | audience membership |
| surveys.viewResults | cosmetic | replaced | survey owner or `obj(people-scope:org, edit)` |
| ideas.view | cosmetic | deleted | Ideas is off the rail; revive as a List template |
| ideas.submit | cosmetic | deleted | same |
| ideas.review | cosmetic | deleted | same |
| ideas.delete | cosmetic | deleted | same |
| analytics.view | cosmetic | replaced | page renders aggregates over `listAccessible(person)`; visible when scope beyond self |
| analytics.viewOrgWide | cosmetic | replaced | `obj(people-scope:org, view)` |
| analytics.export | cosmetic | replaced | `verb export` on the scope (`policy: exportsNeedAdmin`, default on) |
| tools.view | cosmetic | deleted | Tools & credentials is out of PPMS scope; if kept, it is a Table with a share dialog |
| tools.create | cosmetic | deleted | same |
| tools.edit | cosmetic | deleted | same |
| tools.delete | cosmetic | deleted | same |
| tools.share | cosmetic | deleted | same |
| settings.viewGeneral | cosmetic | replaced | Settings overview is `obj(workspace, view)` for Members (read-only, name/plan only); admin group needs `manage` |
| settings.editGeneral | cosmetic | replaced | `obj(workspace, manage)` (the C_LEVEL leak at `api/settings/route.ts:123` closes) |
| settings.manageBilling | cosmetic | replaced | Owner only (`verb manage-billing` on `workspace`) |
| settings.manageIntegrations | cosmetic | replaced | `obj(workspace, manage)` |
| settings.manageAccessControl | cosmetic | deleted | the page it referred to no longer exists; sharing is per object, org policies are `workspace manage` |

Tally: 63 replaced, 16 deleted, 0 kept as matrix cells. The 20 cells that were enforced today all have a named successor gate, so no enforcement is lost.

---

## 7. Org-level settings the model needs

One page: Settings > Workspace > **Access** (gated `workspace manage`), autosave rows, grouped:

**Creating**
- Who can create Spaces: Everyone / Admins only. Default: Everyone.
- Who can create Teams: Everyone / Admins only. Default: Everyone.
- Who can create Talk channels (when Talk is on): Everyone / Admins only. Default: Everyone.
- New Spaces start as: Restricted (only the creator) / Everyone at {org} can view / Everyone at {org} can edit. Default: **Restricted**, with "Findable by everyone" on so people can find and request. (Small orgs may flip to "Everyone can edit" in one click; the onboarding wizard asks this as "Is your work open by default?")

**Inviting**
- Members can invite Members: on / off. Default: on, limited to the org domain when a domain is set (`Organization.domain`), Admins can invite any domain.
- Members can invite Guests: on / off. Default: on.
- Allow Guests at all: on / off. Default: on.
- Guest link expiry: never / 30 / 90 days. Default: never (the share dialog can set per-grant `expiresAt` regardless).

**Sharing**
- Editors can share: on / off (the org default for the per-object toggle). Default: on.
- Access requests: on / off. Default: on.
- Public links ("anyone with the link"): off / Viewer only. Default: off. (Reserves the public-share primitive from the plans; Tables `isPublic` and SOP `shareToken` migrate under it.)

**People data**
- Managers see their reports' work record: always on (informational row).
- Dotted-line managers get: Editor / Viewer. Default: Editor (parity with today).
- Department heads see their department's work record: on / off. Default: on.
- Directory visible to all Members: on (informational; Guests never).
- Exports of people data need an Admin: on / off. Default: on.

**Automation and API**
- AI agents may act on a person's behalf: on / off. Default: on.
- API keys may hold Full access: on / off. Default: off (keys default to Editor cap).

**Security** (moved here from nowhere; the org security policy finally gets its editor): password minimum length, require uppercase, require numbers, session idle timeout, require MFA for everyone / for Admins only / off. Writes `Organization.settings.security`, which the auth flow already reads.

Defaults for a brand-new org, in one sentence: the creator is Owner; anyone can create and invite within the domain; new Spaces are private to their creator but findable; editors can share; guests are free and allowed; managers see their reports; nothing else is on.

---

## 8. Migration from the seven systems

### 8.1 Data (one Prisma migration, one backfill script, reversible for a release)

New tables:

```prisma
enum OrgRole { OWNER ADMIN MEMBER GUEST }
enum AccessLevelV2 { VIEW COMMENT EDIT MANAGE }
enum PrincipalKind { USER TEAM DEPARTMENT ROLE TAG EVERYONE }

model AccessNode {
  kind        String
  id          String
  organizationId String
  parentKind  String?
  parentId    String?
  path        String          // "space:S/folder:F/list:L"
  ownerId     String?
  restricted  Boolean @default(false)
  findable    Boolean @default(false)
  archivedAt  DateTime?
  @@id([kind, id])
  @@index([organizationId, kind])
  @@index([organizationId, path])
  @@index([ownerId])
}

model AccessGrant {
  id            String @id @default(cuid())
  organizationId String
  subjectKind   String
  subjectId     String
  principalKind PrincipalKind
  principalId   String?        // null for EVERYONE
  level         AccessLevelV2
  grantedById   String?
  expiresAt     DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([subjectKind, subjectId, principalKind, principalId])
  @@index([organizationId, subjectKind, subjectId])
  @@index([principalKind, principalId])
}

model AccessRequest { id, organizationId, subjectKind, subjectId, requesterId, level, message, status (PENDING|APPROVED|DENIED), decidedById, decidedAt, createdAt; @@unique([subjectKind, subjectId, requesterId, status]) }

model Team { id, organizationId, name, alias, description, leadId, createdAt, updatedAt; @@unique([organizationId, alias]) }
model TeamMember { teamId, userId, createdAt; @@id([teamId, userId]); @@index([userId]) }
```

Columns: `User.orgRole OrgRole @default(MEMBER)`; `Invitation.orgRole`; `Organization.settings.access` JSON for the policies. `User.accessLevel`, `SpaceMember`, `FolderMember`, `BoardMember`, `SOPFolderAccess`, `HRSegment`, `Space/Folder/Board.visibility` are **kept for one release** (read by nothing after step 8.2.4) and dropped in the following one.

Backfill (`scripts/access-backfill.ts`, idempotent, per org, in a transaction per org):

1. `orgRole`: `SUPER_ADMIN` and the oldest `COMPANY_ADMIN` -> the org's Owner (if several SUPER_ADMINs exist, the oldest is Owner, the rest Admin); other `COMPANY_ADMIN` -> ADMIN; everything else -> MEMBER. No existing user becomes a Guest automatically (there are no real guests today).
2. `AccessNode` rows for every Space, Folder, Board, Doc, DataTable, Whiteboard, FileFolder, SOPFolder, SOP, Policy, Agreement, OKR, Conversation, plus synthetic roots (`people-scope:org`, `people-scope:department:<id>`, `sop-folder:root`, `policy:root`, `contract:root`, `kra:library`, `workspace:<orgId>`). `ownerId` from the existing `ownerId`/`createdById`; `path` computed from `spaceId`/`folderId`/`parentFolderId`/`entityType`.
3. Visibility: `PRIVATE` -> `restricted = true`; `WORKSPACE` -> nothing; `ORG` -> `AccessGrant(EVERYONE, VIEW)` on that node. Spaces: `findable = true` for all (today every Space is at least a name to org-wide readers through `listSpacesForUser` only when ORG, so set `findable = (visibility === ORG)` to be conservative; the onboarding tip suggests turning it on).
4. Membership rows -> grants: `SpaceMember/FolderMember/BoardMember` `OWNER` -> `MANAGE` (and `ownerId` if the node has none), `ADMIN -> MANAGE`, `MEMBER -> EDIT`, `GUEST -> VIEW`. `SOPFolderAccess` `VIEWER/EDITOR/OWNER -> VIEW/EDIT/MANAGE`.
5. **Reach preservation**: for every PRIVATE board, grant its Space's OWNER `MANAGE` explicitly (section 3.1 E). For every standalone Doc, Whiteboard and unscoped DataTable, `EVERYONE VIEW` (docs) or `EVERYONE EDIT` (whiteboards, tables), matching today's org-wide behaviour, so nothing disappears; owners can tighten afterwards.
6. Seniority -> People shares: `HR -> people-scope:org EDIT`; `C_LEVEL, VP, DIRECTOR -> people-scope:org VIEW` (they had org-wide read through `ORG_WIDE_ALIGNMENT_LEVELS` and edit on their tree, which the manager chain still gives). `MANAGER`, `TEAM_LEAD` get nothing (their reach was always the report tree). `Department.headId` needs no row (built-in rule).
7. `GoalAssignee` rows -> grants on `goal:<id>` (`USER/DEPARTMENT/ROLE/TAG -> EDIT`); COMPANY-level goals -> `EVERYONE VIEW`.
8. `ConversationMember` stays as the membership table (Talk needs `lastReadAt`, `notifyLevel`); the channel rule reads it. Public channels get `findable = true`.
9. Delete `Organization.settings.permissions` (export it to the audit log first as one `access.matrix_retired` event so nothing is silently lost).
10. Write one `access.migrated` ActivityLog row per org with counts.

### 8.2 Code, in order (each step ships alone and is verifiable)

1. **Land the gate behind a flag.** `src/lib/access/*` with the parity test suite (`index.test.ts` encodes every row of audit section 1.6 as a fixture and asserts the intended answer). `ACCESS_V2` env flag; when off, `access()` delegates to the legacy resolver plus board/space/folder helpers so the new API surface exists without behaviour change. Add `AccessNode` maintenance hooks to `createSpace/createFolder/createBoard/updateFolder/moveBoard/createDoc/...` so nodes stay in sync from this step on.
2. **Run the backfill in staging, then prod**, with the flag off. Add a nightly consistency cron (`scripts/access-audit.ts`) that diffs the legacy answer and the v2 answer for a sample of (user, object) pairs and reports mismatches; zero mismatches for a week is the flip criterion.
3. **Flip pages.** Replace `page-gates.ts`, `route-guard.ts` and inline session checks with `gatePage`. Delete the four redirect targets. Ship `AccessProvider`, `useAccess`, `<Gated>` and the AccessViews. `settings/layout.tsx` gets the one admin gate.
4. **Flip APIs.** Replace the 220 `isOrgAdmin/isManager/hasRole` calls and the 80 legacy-gate files with `gateApi` and `listAccessible`. `board.ts`, `space.ts`, `folder.ts`, `doc-access.ts`, `sop-access.ts` shrink to CRUD; their gate functions become one-line wrappers over `access()` for a release, then are deleted. `alignment-scope.ts` becomes `listAccessible(viewer,"person")`. `/api/users` returns the directory for every Member (`scope=team` stays as a filter, never a cap). Kill `getSessionAndModule` in favour of the module cap.
5. **One dialog.** Ship `share-dialog.tsx`, `/api/access/{grants,principals,peek,requests}`, wire every entry point, delete the three dialogs, the SOP access panel, the Goals sharing panel and the `Visibility` toggles in the "..." menus (replaced by the dialog's general-access row). Space email invites create Guests.
6. **Members & roles.** Rebuild `/settings/members` (section 5.2), delete `/settings/permissions`, `/api/permissions`, `permissions.ts`, `use-permission.ts`, `use-role.ts` (replace `useRole()` consumers with `useAccess`), `access-levels.ts`, `access-tiers.ts`, the `requiredAccess` fields, the Apps floor select, `HRSegment`, `hr-segment.ts`.
7. **Settings > Access** page with the policies and the security editor; audit every grant, request, role change, policy change (`grants.ts` is the only writer, so this is one place).
8. **Drop legacy columns and tables** one release later; remove the flag.

### 8.3 What breaks, and the answer

- **JWT claim.** `accessLevel` in the session becomes `orgRole`. Token refresh already re-reads the user (`auth.ts:337-368`), so a role change lands on the next refresh; the Members page says so inline.
- **`useRole().isAdmin` consumers** (17 files) that treated C_LEVEL and HR as admins: they now ask `useAccess({kind:"workspace"})` or the People scope; C-level users lose the accidental `/api/settings` PATCH (`route.ts:123`), which is the intended fix.
- **API keys.** `ApiKey.scopes` READ/WRITE/ADMIN map to caps `view/edit/manage`; a key acts as its creator and can never exceed the creator's current level. Existing ADMIN keys created by an Admin keep working.
- **Space OWNER piercing PRIVATE boards** changes semantics; covered by the explicit grant in 8.1.5.
- **Role.level** is display-only; the roles page copy changes; `api/roles/route.ts:53` stops accepting admin levels (there are none).
- **Marketing claims** ("custom roles", "granular per-hub per-action") must be rewritten to the sharing story; the violet gradient goes with them.
- **Standalone docs** that were org-visible stay org-visible through the migration grant, but owners now see that row in the dialog and may remove it; that is the point.
- **Search, Library, Files, Tables, Whiteboards, entity-links** keep `fullyReadableSpaceIds` semantics and gain folder-grant and direct-list-grant paths only where the audit already added them (`accessibleFolderIds`), through `listAccessible`.
- **Talk and Tables** keep their module gate; the check moves inside `access()` so a disabled module also hides shared docs that embed a table.

---

## 9. Security invariants and risks

### 9.1 Invariants (each one has a test in `index.test.ts`)

1. **Org boundary first.** No rule runs before the org check; cross-org refs are 404, never 403, never `discover`.
2. **`fullyReadableSpaceIds` stays "Space-node view or better only."** Folder grants, List grants and item assignment never widen it. Content endpoints that fan out to space-scoped rows (files, search, tables, whiteboards, entity-links) use it exactly as today; folder and list grantees reach their own subtree only through `listAccessible(kind, under: ref)`.
3. **Guests never see the directory.** `expandPrincipals` never adds `EVERYONE` for a Guest; `/api/access/principals` and `/api/users` return an empty list for Guests; @mention and assignee pickers for Guests are limited to people with access to the current object; Guests never get `discover`; Guests are never valid principals for People objects.
4. **Assignment grants the row, not the List.** The assignee rule fires only on `item` refs; `list` refs ignore it; the item payload carries the list name but the list endpoint stays 404.
5. **Restricted stops inheritance for everyone except org Admins and the object owner.** No Full-access ancestor pierces.
6. **Personal notepads are owner-only, Admins included** (adopt the stricter of the two disagreeing gates).
7. **Level never exceeds the acting human.** Agents and API keys are capped by `actingFor`'s live level and by their own cap; a revoked user's keys and agents die with them (`tokenVersion` bump also invalidates keys).
8. **Last-owner and last-admin guards** in `grants.ts` and the role setter: an org always has an Owner; an object always has a reachable owner (deactivating a user transfers their owned objects to their manager, else to the Owner, with an audit row).
9. **Every grant, request decision, role change and policy change writes an ActivityLog row** (`access.grant`, `access.revoke`, `access.request`, `access.role`, `access.policy`) with actor, subject, principal, before and after; denied writes log `access.denied` sampled (1 in 10 per user per hour) to keep the log useful.
10. **`discover` leaks name, kind, icon and owner name only**, from one endpoint, and only for findable chains; child counts and descriptions are never returned below `view`.
11. **Signed file URLs are minted only after `access(file) >= view`**, never from a list payload.
12. **Module cap beats everything**, including Admin override, so a disabled module cannot leak through search or embeds.
13. **Invitations are domain-locked for Members**; only Admins invite outside the domain as Members; outside-domain invites from Members are always Guests.
14. **Public links are off by default** and never exceed Viewer; every public token is an `AccessGrant` with `principalKind = EVERYONE`-style sentinel `PUBLIC`, revocable from the dialog, and logged on use.

### 9.2 Risks and mitigations

- **Flattening seniority loses reach for executives.** Mitigated by the migration's People-scope grants (8.1.6) and the Check-access panel; the residual risk is a Director who expected to *edit* a peer's team's KRAs; they request access, which is the model working.
- **Grant table growth at Fortune-500 scale.** Group principals keep rows near the number of sharing decisions, not people; `path` prefix queries and the two indexes keep resolution to two round trips; `accessMany` batches. A per-request memo plus a short-lived (30s) per-user principal cache in Redis is the next lever if needed.
- **Materialized `path` drift on moves.** Single writer (`nodes.ts`) with a transaction that rewrites descendants; the nightly consistency cron re-derives paths and alerts on drift.
- **Owners who leave.** Invariant 8 plus the back-office "set workspace owner".
- **Semantics change for Space owners on private lists.** Explicit migration grants; release note; the dialog shows the row so it is visible, not magic.
- **"Where do I control who can create SOPs?"** The old matrix answered with a checkbox; the new answer is "share the SOP folder" plus one policy toggle. The Access settings page carries a short "How access works" explainer with the four sentences from section 0, and the empty Permissions URL redirects there.
- **Dual-run window.** Two systems answering for a release; the flag plus the parity cron make disagreement visible before the flip, and the flip is one env change to revert.
- **Talk channel semantics.** Public channels as findable+self-join is a new capability; keep private channels Restricted and DMs unshareable so nothing widens by accident.
- **Read-only mode hides controls that some users are used to seeing disabled.** That is the intended UX; the banner names the owner and offers the request path, which the old disabled controls never did.
- **Per-object Findable defaults** could surprise an org that considers even Space names sensitive; the migration sets `findable` only where the object was already ORG-visible, and the policy row lets an Admin turn findability off org-wide.

---

## 10. Summary for the decision

- Roles: Owner, Admin, Member, Guest. Seniority is org-chart data. Managers are derived from `reportsTo`. HR is "Editor on People".
- Objects: everything shareable with Viewer / Commenter / Editor / Full access, one Owner, downward additive inheritance, "Restricted" to stop it, "Everyone at {org}" as general access, "Findable" for discovery.
- Gate: `access(viewer, ref)` in `src/lib/access/`, called by nav (`listAccessible`), pages (`gatePage`, read-only mode, one AccessView family) and APIs (`gateApi`, 404 / 403 codes). No redirects on denial.
- UI: one share dialog, one Members & roles page with Teams and Guests, a Check-access panel, avatar stacks that are real, one request-access flow.
- Matrix: deleted; 63 cells map to a named object level or policy, 16 are out-of-scope modules.
- Migration: eight data steps and eight code steps, flag-gated, with a parity cron before the flip.
