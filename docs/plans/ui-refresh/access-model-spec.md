# WorkwrK access model: the definitive spec

Date: 2026-09-11. Status: synthesized from a judged panel of three proposals (Simple ladder, Role templates, Sharing first) against the audit inventory (`access-model.md`, `settings-pages.md`, `critic-gaps.json` #4 and #7), the direction docs (`existing-direction.md`, `phase2-inputs.md`, `zoho-reference.md`) and the code at commit `6187227a` in `/Users/bigboldtechnologies/theywrk`. Every file path below is repo-relative unless it starts with `/private/tmp`.

Base: **Simple ladder** (winner with two of three judges and the highest tally). Grafted: eleven items from Role templates and Sharing first that the judges flagged, with conflicts between grafts resolved in section 0.3. Nothing in this document is a proposal; it is the contract the Phase 3 surface specs reference by role and object-role name.

---

## 0. Decision record

### 0.1 Why Simple ladder is the base

It is the only model a 20-person firm runs without opening a settings page and the only one whose whole story fits in one sentence: "You see the Spaces you're added to; whoever adds you picks view, comment or edit; your manager and the People team see your people stuff." Four org roles plus an Agent flag, one four-rung object ladder used by every dialog, managers derived from `reportsTo` (already a recursive CTE in `src/lib/reporting-line.ts` and `src/lib/team.ts`), HR as a picked People team instead of a rung, eight org toggles, the 79-cell matrix deleted with every cell mapped to a gate rule, one `can()` called by nav, page and API, a real Guest, read-only mode, one denial convention. Every locked decision holds.

Role templates lost on the founder lens (six roles, custom clones, a 34-row editor, HR Admin and Manager as assigned roles, no Comment level). Sharing first lost on blast radius (AccessNode rows with materialized paths for ~20 kinds against a schema where `migrate dev` is already broken by drift) and on asking a small business to "share the People scope" instead of "add Sunita to the People team".

### 0.2 Grafts adopted (source in brackets)

| # | Graft | Where it lands |
|---|---|---|
| G1 | The C3 wrapper pivot: every legacy helper becomes a one-line delegate to `can()` / `accessibleIds()` before any call-site edit, so pages and APIs agree by construction on day one. Merge only with the golden test file. [Role templates] | §10 step 1 |
| G2 | AI agents, API keys and crons act AS a person, never as an Owner-equivalent system viewer. `Viewer.actingAs` capped at `min(actingFor live level, EDIT)`; ADMIN scope only for Owner/Admin creators; tokenVersion bump kills keys and agent runs; every such write audited with `actorType`. [Sharing first + Role templates] | §2.5, §4 rule 12 |
| G3 | Define the Team model (`Team` + `TeamMember` with `@alias` and a lead); widen `GrantSubject` to USER, TEAM, DEPARTMENT, ROLE, TAG, EVERYONE so goal audiences become ordinary grants. [Sharing first] | §3.2, §3.4 |
| G4 | Discoverability per node ("findable"), inherited as a ceiling, default on for Spaces and public channels only, never Folders or Lists, never Guests, exposed through one peek endpoint. Org switch stays as the master off. [Sharing first] | §4 rule 14, §5.4 |
| G5 | Reach-preservation grants in the backfill: explicit FULL for the Space owner on every PRIVATE Board; EVERYONE grants for org-visible standalone Docs (VIEW), Whiteboards and org-wide Tables (EDIT). [Sharing first] | §10 step 4 |
| G6 | Behavioral parity job before the read-path flip: `scripts/access-audit.ts` nightly, zero mismatches for a week is the flip criterion. [Sharing first] | §10 step 2 |
| G7 | ESLint rule forbidding `accessLevel` reads, `isManager/isOrgAdmin/hasRole` and member-table imports outside `src/lib/access/`. [Sharing first + Role templates] | §10 step 0 |
| G8 | Domain-locked invites everywhere; `AccessGrant.expiresAt` now; signed file URLs minted only after `can(view, file)`. [Sharing first] | §2.3, §3.2, §11 |
| G9 | One-click "Lock it down" preset on `/settings/access`. [Role templates] | §7.4 |
| G10 | Admin never silently owns: delete or transfer of an object the Admin does not own is a confirmed act that writes an `access.*` audit row naming the displaced owner; an Admin bypassing the last-Full guard logs the same way. [Role templates] | §6.1, §11 |
| G11 | From the IT/Ops lens: two or more Owners with a last-Owner guard; Agent flag kept for frontline staff; DMs and private channels evaluated before the Admin short-circuit; `accessibleIds` returns two typed sets; People team as a Members-table column; pre-flight Owner report and tokenVersion bump on role change; a small fixed Admin scope split (Billing, Security and integrations) delegable per Admin; "Enforced at" tooltips backed by golden fixtures; Guests excluded from `checkPlanLimit("users")`; Apps floor kept as an enforced role list; denial-log sampling per viewer per target per 10 minutes. [IT judge, sourced from all three] | §2.1, §2.4, §4, §5.2, §6.2, §7.2, §10 |
| G12 | From the lead-engineer lens: `can()` split into a facts loader and a pure resolver so the golden suite runs in node with no database; `User.accessLevel` and the JWT claim kept as a written mirror for two releases; container member tables stay the user-grant store while `AccessGrant` is additive first; archived cap; batched `POST /api/access/check`; grant expiry and a public-link policy that never exceeds VIEW. [lead engineer, sourced from all three] | §5.1, §4 rule 12, §10 |

### 0.3 Conflicts between grafts, resolved

| Conflict | Resolution |
|---|---|
| Simple ladder toggle 3 (one org switch exposes Space, Folder and List names) vs Sharing first per-node findable | Per-node `findable` on Spaces and public channels only; Folders and Lists are never shown locked (they appear only as container labels when the viewer holds something inside). Org toggle 3 becomes the master switch and the default for new Spaces. Default on for Members, never Guests. |
| New Spaces default: Simple ladder "Open to everyone as Can edit" vs Sharing first "Restricted, findable" | Open as Can edit (zero-config small firm). The onboarding wizard asks one question ("Is your work open by default?") and the Lock it down preset flips it. Listed as open decision D1. |
| Exactly one workspace Owner (Sharing first) vs one or more (Simple ladder) | One or more, at least one always, last-Owner guard, platform-staff reset from `/admin`. |
| Agent folded into Member/Guest (Sharing first) vs Agent flag (Simple ladder, Role templates) | Agent flag on a Member. A warehouse worker is an employee and keeps the directory. |
| Guest ceiling: Can manage on Lists (Role templates) vs Can edit everywhere (Simple ladder, Sharing first) | Can edit everywhere; FULL only on objects the Guest created, which still excludes sharing. A client who must run a List gets a Member seat. Open decision D5. |
| Crons and AI as an Owner-equivalent system viewer (Simple ladder) vs acting-as principal (others) | Acting-as principal, always. `viewerForSystem` does not exist. |
| Storage: one big backfill of four member tables into `AccessGrant` (Simple ladder) vs additive-first (lead engineer) | Additive-first. `AccessGrant` holds new subject kinds and new object kinds from day one; the facts loader unions `SpaceMember`/`FolderMember`/`BoardMember` (enum-mapped) with `AccessGrant`; container user rows migrate in the last step. Reach-preservation rows (G5) are written into `AccessGrant`, so they exist from the first flip. |
| Denial log sampling: 1 in 10 per user per hour (Sharing first) vs per viewer per target per 10 minutes (Role templates) | Per viewer per target per 10 minutes: a polling LockedPage cannot flood the feed and a real person hitting a wall is recorded once. |
| Space owner pierces a PRIVATE List (today, `board.ts:645-651`) vs Restricted stops inheritance for everyone but the object owner and org Admins | Restricted stops inheritance (ClickUp private lists). Existing reach is preserved by G5 explicit grants, visible in the dialog for owners to tighten. Open decision D7. |
| Admin separation of duties: not supported (Simple ladder) vs Owner-only tier (founder graft) vs four per-Admin scopes (IT judge) | Owner-only tier for billing, API keys, SSO/SCIM, security policy, delete workspace. Plus two delegable Admin scopes an Owner can switch on per Admin: Billing, Security and integrations. Workspace and People are always part of Admin. This gives "a billing admin who is not a people admin" only if the founder wants it; open decision D4 recommends shipping it hidden in the Admin row menu. |
| Vocabulary: Full access / Can edit / Can comment / Can view (Simple ladder) vs Viewer / Commenter / Editor / Full access (Sharing first) vs Owner / Can manage / Can edit / Can view (Role templates) | Full access, Can edit, Can comment, Can view. This is ClickUp's own set (Full, Edit, Comment, View), which satisfies the parity mandate, and the founder's Zoho-clean frame carries it. "Owner" is a pinned row property, not a level. |
| Who invites Members: Owner/Admin only (Simple ladder) vs Members within domain (Sharing first) | Owner/Admin only for Members (seats cost money) as the default of one Invite-rules setting on the Members page (§2.8), which also carries the in-domain alternative; anyone with Full access on an object invites Guests, domain-locked, under toggle 5. Open decision D3. |

---

## 1. The whole model on one screen

```
ORG ROLE (per person, one of four)          OBJECT ROLE (per person or group, per object)
  Owner   runs the company account            Full access   manage, share, delete, transfer
  Admin   runs the workspace                  Can edit      create and change content
  Member  works here                          Can comment   discuss, never change
  Guest   outside, sees only what is shared   Can view      read only
  + Agent flag on a Member (frontline caps)
  + People team (a list of Members, org setting)

RELATIONSHIPS THAT GRANT WITHOUT A ROW        ONE GATE
  assigned to a task   -> Can edit on it        can(viewer, action, object)
  reports to you       -> people data           called by nav, page, API, search, cron
  on the People team   -> people data           returns { allowed, role, via, discoverable }
  created it           -> Full access on it

ACCESS FLOWS DOWN: Space -> Folder -> List -> Item, Doc, Table, Channel
  Direct shares ADD. Nothing subtracts except "Restricted" (stop inheriting).
  Highest role from any source wins, then Guest, Agent, acting-as and archived caps apply.
```

### 1.1 Principles the model must never violate

1. **One vocabulary.** Four org roles, four object roles, the same labels in every dialog, list, chip and API response. No second ladder, no per-module role names.
2. **One authority.** `can()` in `src/lib/access/` is the only function allowed to answer "may this person do this". Nav, page, API, search, export, cron and agents all call it. A grep for `accessLevel` in `src/` outside `src/lib/access/` returns zero after migration, enforced by ESLint.
3. **Additive only.** Effective role is the maximum of every source. The only narrowing is the object-level Restricted switch, which stops inheritance from the parent; it never removes a direct grant.
4. **Relationships are rules, not rows.** Assignment, manager chain, People team, creator, channel membership, SOP assignment are computed at read time. No cleanup job when a task is reassigned or the org chart changes.
5. **Discoverable is separate from accessible.** A person may know an object exists (kind, name, icon, owner) without reading it. Un-discoverable objects 404. Reads never 403.
6. **Read-only mode, never dead controls.** A page renders the controls the viewer's role allows and nothing else.
7. **Nothing is decorative.** Every switch on `/settings/access`, every share level and every gate rule names its enforcement point and has a golden test.
8. **Least privilege for non-humans.** Keys, agents and crons act for a person and never exceed that person's live level.
9. **Zero training.** A new admin explains the model to a new hire in one sentence.

---

## 2. Org roles

### 2.1 The four roles, the Agent flag, the People team

| Role | Who | Can | Cannot | Granted by |
|---|---|---|---|---|
| **Owner** | Account holder. One or more per org, at least one always. | Everything an Admin can, plus: billing and plan, delete workspace, transfer ownership, promote or demote Admins and Owners, API keys, SSO/SCIM, security policy, delegate Admin scopes. | Read another person's Notepad, DMs or private channels they are not in. | Another Owner. First Owner = the org creator (today's first `COMPANY_ADMIN`). Platform staff can reset the last Owner from `/admin` (new back-office action). |
| **Admin** | Runs the workspace day to day (ops lead, IT, HR head in a small firm). | Full access on every Space, Folder, List, Doc, Table, Whiteboard, SOP folder, Policy, Contract and public Channel in the org. Invite and remove Members and Guests. Set anyone's role except Owner. Members, Apps, Modules, Task types, Tags, Identity, Locale, Audit log, Data export, Defaults, Access settings, org chart edit. Everyone's people data. | Owner-only pages unless an Owner delegated the scope (Billing; Security and integrations). Promote to Owner. Read Notepads, DMs or private channels they are not in. Silently own: delete or transfer of an object they do not own is a confirmed, audited act (G10). | Owner or Admin. |
| **Member** | An employee. Default for anyone invited from the company domain. | Create Spaces (toggle 1), Docs, Tables, Whiteboards, Teams; hold any object role; see the directory card of every Member; see org-open Spaces; see own people data; if they have reports, see and edit the people data of their whole chain; use every core module; be on the People team. | Any Workspace settings page (Personal pages only). Other people's people data unless manager chain or People team. Invite Members, unless the Invite rules card (§2.8) opens in-domain invites to Members. | Owner or Admin (invite or role change), or SCIM/SAML provisioning (§2.7). |
| **Guest** | Outside the company: client, contractor, vendor, candidate. | Only objects explicitly shared with them (directly or via a Team they are in), at the given role up to Can edit. See names and avatars of people on the same shared objects. Talk channels they are added to. | Directory, org chart, org-open Spaces, org search, Docs/Tables/Teams hubs, Planner team views, creating Spaces, inviting anyone, Full access on anything they did not create, exports, discovery. Never counts as a seat. | Anyone with Full access on an object (toggle 5 can restrict to Admins). Any outside-domain email typed by a Member is always a Guest (G8). Admin converts Guest to Member. |
| **Agent flag** | A Member with frontline limits (support agent, warehouse, field, kiosk). | Everything a Member can, except the caps. | Create Spaces, delete anything, export, hold Full access (clamped to Can edit), be a manager. | Owner or Admin toggles it on the Members page. |
| **People team** | Members picked in toggle 6 (people and/or a department). Not a role. | Edit everyone's people data; Full on Policies, Contracts, Reviews, Surveys, Assets org-wide; publish under toggle 7. Read-only on four Workspace settings pages (`members`, `structure`, `access`, `scoring`, the `peopleTeamRead` flag in §6.6); on those pages they edit exactly the people-data fields (job titles on Structure, and job title, department, office, reports to, dotted lines and capacity in the Members drawer, §3.5). | Change any Workspace setting: roles, Agent flag, status, Admin scopes, the ten toggles, apps, modules, identity, billing, security. | Owner or Admin on `/settings/access` or the Members-table column. |

**Admin scopes (delegable, Owner sets, G11):** `adminScopes: ("billing" | "security")[]` on the User row. `billing` opens `/settings/billing`; `security` opens API keys, SSO/SCIM and the security policy page. Default empty. Shown in the Admin row's menu on the Members page, not as columns. Owners hold both implicitly.

**Mapping from today's `AccessLevel` enum** (`prisma/schema.prisma:618`):

| Today | Becomes | Notes |
|---|---|---|
| SUPER_ADMIN | Owner | Platform staff act only through `PlatformAdmin` and `/admin`. The tenant UI never offers SUPER_ADMIN again (fixes audit Broken #4). |
| COMPANY_ADMIN | Owner if the org's earliest-created admin, else Admin | Pre-flight report lists the chosen Owner per org for approval before backfill. |
| C_LEVEL, VP, DIRECTOR | Member | Seniority is a job title. Their people reach comes from the report tree. Pre-flight report lists each such user whose tree is not the whole org; default fix is People team (open decision D6). |
| HR | Member, auto-added to the People team | |
| MANAGER, TEAM_LEAD | Member | "Manager" = `hasReports(user)`. The two tiers are identical everywhere today (audit 1.3). |
| EMPLOYEE | Member | |
| AGENT | Member + Agent flag | Today AGENT differs from EMPLOYEE only in `tasks.delete:false`. |
| (none) | Guest | New. Space email invites mint Guests instead of EMPLOYEE (`api/spaces/[id]/invitations/route.ts:136,159`). |

`Role.level` (job titles at `/people/roles`) loses all access meaning: renamed `seniority`, display only. Assigning a title never changes `orgRole`. The `roles-client.tsx:319` claim is deleted.

### 2.2 Why no HR rung and no Manager rung

HR being a rung is the source of three audit findings (its position differs per list, `useRole().isAdmin` is true for HR on the client only, `HRSegment` is dead code with zero hits under `src/app`). HR is a Member on the People team. A 12-person firm leaves it empty and Admins do it; a 400-person firm picks the HR department. Same rule, no rung.

Manager is a fact about the org chart (`User.managerId` plus `UserDottedLine`), not something an admin remembers to set. Change the chart, access follows.

### 2.3 The Guest story

- Invited from the share dialog by anyone with Full access on the object (toggle 5). An outside-domain email typed by a Member is always a Guest; only Owners and Admins may invite outside the domain as Members. `Invitation` carries `orgRole = GUEST`, the object and the object role.
- On accept the Guest lands on the shared object. Rail shows Work always (its My work view lists the Guest's assigned items across every shared object; that is where "my tasks" lives for a Guest) plus Docs, Tables and Talk only when something is shared there and, for the two modules, the module is on. Planner, Teams and AI are never shown to a Guest. Settings shows only the Personal section (`/account/*`).
- Sidebar tree: exactly the objects they can read, inside their containers as bare labels (the scoped rendering `folderAccessForSpace` already produces).
- Search returns only readable objects. People pickers list only Members sharing at least one object with them.
- Roles: Can view, Can comment, Can edit. Never Full access except on objects they created, and even then they cannot share.
- `/settings/members` Guests tab: "Shared objects: N", Remove (revokes every grant), Promote to Member (Admin only, consumes a seat).
- **Remove** revokes every grant and, in the same transaction, transfers every object the Guest created and holds FULL on (tasks, docs, lists inside a shared container) to the nearest container's `ownerId`, else to the removing Admin; nothing is deleted, one `access.revoked` audit row lists the transferred objects. Promote to Member keeps everything as is.
- Never a seat: excluded from `checkPlanLimit("users")`. `LimitType` in `src/lib/plan-limits.ts` gains `guests` and `PLAN_LIMITS[plan]` in `plan-limits-data.ts` gains a `guests` column (STARTER, GROWTH, SCALE, ENTERPRISE; launch value 99999 on every plan so the column exists without a pricing decision). The cap is soft: at the cap the invite still succeeds, the Members count strip shows "N of M guest seats" and the Owners get one email; `checkPlanLimit("guests")` returns `{ allowed: true, soft: true }` past the cap and never blocks.
- Guest grants may carry `expiresAt`; the org can set a default guest expiry (§8, Guests and links card).
- **Own record.** A Guest has a directory card, never people data (no KRAs, reviews, goals, timesheets or assets are ever attached to a GUEST user; the people-data routes 404 for a Guest subject). Self: VIEW own card, EDIT name, avatar, phone, password and MFA on `/account/*`. Other Guests see nothing about them.
- **Inbox.** Guests receive notifications only for objects they hold: mentions, assignments, comments, replies, access granted or expiring. Never announcements, digests, kudos or org notices.
- **Org MFA policy.** "Require MFA for: Everyone" includes Guests (they hold client work); "Admins" excludes them. Enrolment is on `/account/security` like anyone else.

### 2.4 The Agent story

A Member with caps applied after resolution (§4 rule 12). Surfaces that change: no New Space affordance, no delete actions in menus, no Export buttons, role selects clamp Full access to Can edit, cannot be picked as someone's manager. Nothing else knows the flag exists.

- **Setting the flag.** The invite modal's role select offers Admin, Member, Guest; choosing Member reveals an "Agent (frontline caps)" checkbox that writes `Invitation.isAgent`, copied to `User.isAgent` on accept, so a frontline hire never spends a day as an uncapped Member. The Members drawer switch (Owner/Admin) is the second place. SCIM and SAML never set it (§2.7).
- **Flag and role.** `isAgent` is meaningful only while `orgRole = MEMBER`. `PATCH /api/users/[id]` clears `isAgent` in the same write whenever `orgRole` changes to ADMIN, OWNER or GUEST, and refuses `isAgent = true` on any non-Member (400 `agent_requires_member`); both paths write one `org_role.changed` audit row. The Members page renders the Agent switch only on Member rows. Agent+Admin, Agent+Owner and Agent+Guest therefore cannot exist. An Agent may be on the People team (it is a Member); the People team rule then applies to them like anyone else.
- **Cannot be a manager.** Enforced at `PATCH /api/users/[id]` (`managerId` and `UserDottedLine` writes refuse a target whose `isAgent` is true, 400 `agent_cannot_manage`), at the SCIM `manager` attribute (same check), and cosmetically in the Reports-to picker, which excludes Agents. Flipping the Agent switch on someone who already has reports is refused until the reports are re-parented ("Move N reports first").
- **The three always-denied actions** are `ENFORCED_AT` keys with golden cases: `cap.agent.delete` (every container and item DELETE route), `cap.agent.export` (every export route and the Export buttons), `cap.agent.create_space` (`POST /api/spaces`, `POST /api/teams`).
- **What is not capped.** Talk (channels, DMs, huddles) exactly as a Member; Notepad; the Mission splash; Kudos; the personal "Download my data" on `/account/profile`, which is a personal right and not the `export` action.

### 2.5 Non-human principals (G2)

API keys, AI agents (`Agent` model, autonomous runs, Sidekick) and crons never hold a role of their own. They carry `Viewer.actingAs = { type: "api-key" | "agent" | "cron", id, cap }` and resolve as `min(actingFor's live level, cap)`:

- API key: `actingFor = ApiKey.createdById`. `cap = EDIT` for READ/WRITE scopes; `cap = FULL` only when the key holds ADMIN scope and the creator is currently Owner or Admin (`api-auth.ts:161` already gates minting; the gate re-checks at request time). A key whose creator was demoted is downgraded on the next request and the owner notified.
- AI agent run: `actingFor` = the person who triggered it, or for autonomous runs the agent's `createdById`; `cap = EDIT`. Agents never share, never export, never read people data beyond the acting user.
- Cron: `actingFor` = the object owner for per-object work (reminders, due-date rollups), else the org's first Owner with `cap = VIEW` for read-only aggregation and `cap = EDIT` for the specific write the cron exists for. No cron path holds FULL.
- A `tokenVersion` bump on the acting user kills their keys and agent runs (`api-auth.ts` and the agent runner check it).
- Every write by a non-human principal writes `ActivityLog.actorType` (`user | api-key | agent | cron`) plus `actingForId`.

### 2.6 Platform staff

Unchanged: `PlatformAdmin` allowlist, admin host, never a tenant role. One new back-office action: "Set workspace Owner" for orgs whose Owners are gone, with audit.

### 2.7 Provisioned people (SCIM and SAML JIT)

`/api/scim/v2/Users` and `Groups` exist today; `Users` creates with the schema default `accessLevel` and `Groups` "members" writes `User.departmentId`. The model fixes what a provisioned person is:

- **Lands as Member**, `isAgent = false`, not on the People team, `adminScopes = []`. SCIM never mints Owner, Guest or Agent. An optional `roles` attribute in the SSO attribute map may carry `admin` or `member` only; anything else is ignored and logged. Owner is set by an Owner on the Members page, never by an IdP.
- **Domain lock applies.** A provisioned email outside `settings.users.allowedDomains` is refused (SCIM 400 `invalidValue`, SAML JIT sign-in refused with "Ask your admin to add {domain}"). SCIM cannot create Guests.
- **Groups push** maps to `User.departmentId` (today) and, once Teams exist (§3.4), to `TeamMember` rows when the group name matches a Team `@alias`. It never touches `orgRole`, `managerId` or grants.
- **Deprovisioning** (`active = false` or DELETE) is a deactivation: `status = INACTIVE`, `tokenVersion` bump, and the invariant-13 transfer of owned objects to their manager, else the first Owner (the automated-path fallback), with `actorType: "scim"` on the audit row. Reactivation restores nothing automatically; the objects stay with the transferee.
- **SAML JIT** creates the user exactly as SCIM create does, then signs them in. `settings.security.ssoEnforced` makes password sign-in refuse for every non-Owner (Owners keep a break-glass password path, logged).

### 2.8 Who invites Members

`org.invite_member` reads one setting, `settings.users.whoCanInviteMembers` (`"owners_admins"` default, or `"members_in_domain"`), which lives on the Members page's Invite rules card (settings spec §5.5), not on `/settings/access`; the ten access toggles stay the cap. Under `members_in_domain` a Member may invite an in-domain address as a Member; outside-domain addresses stay Guests for everyone but Owners and Admins (invariant 17). Enforced at `POST /api/invitations`, key `org.invite_member` in `ENFORCED_AT`; the Invite button and the workspace-menu row render only when `can(viewer, "invite_member", org)` is true. D3 keeps the default at Owners and Admins.

---

## 3. Object roles and the object hierarchy

### 3.1 The one ladder

| Object role | Label | Grants |
|---|---|---|
| FULL | Full access | Everything below plus rename, settings, statuses and fields, share and change roles, restrict or open, findable, move, archive, delete (toggle 8), transfer ownership, invite Guests (toggle 5). |
| EDIT | Can edit | Create and change content: tasks, subtasks, comments, doc text, table rows and columns, SOP steps, whiteboard shapes, files; create child objects (a List inside a Folder). Share at own level or below when toggle 4 is on. |
| COMMENT | Can comment | Read everything; comments, reactions, acknowledge SOPs and Policies, respond to Forms. Never changes content. |
| VIEW | Can view | Read only. |

Plus `ownerId` on every container (exists today as `ownerId` or `createdById` on Space, Folder, Board, Doc, DataTable, Whiteboard). The owner is not a role: always FULL, pinned first in the dialog, cannot be removed by anyone except themselves (transfer) or an Owner/Admin (confirmed, audited).

Blurbs, verbatim, used everywhere: Full access "Change settings, sharing, delete and transfer." Can edit "Add and change tasks, docs and rows." Can comment "Read and discuss, never change." Can view "Read only."

Mapping today's enums:

| Today | Becomes |
|---|---|
| `SpaceRole.OWNER` (SpaceMember, FolderMember, BoardMember) | FULL, and `ownerId` if unset |
| `SpaceRole.ADMIN` | FULL |
| `SpaceRole.MEMBER` | EDIT (matches `canContributeBoard` and the 2026-09-09 decision that Members write) |
| `SpaceRole.GUEST` | VIEW |
| `SOPFolderRole.VIEWER / EDITOR / OWNER` | VIEW / EDIT / FULL |
| `Visibility.ORG` on Space | an EVERYONE grant on the Space at the role `Space.settings.defaultPermission` maps to (Full edit or Edit to EDIT, Comment to COMMENT, View to VIEW; missing = EDIT). The dead "Default permission" select (audit Broken #9) becomes this row and is therefore enforced. |
| `Visibility.WORKSPACE` on Space | no EVERYONE grant (today indistinguishable from PRIVATE at read time, `space.ts:194-204`) |
| `Visibility.PRIVATE` on Space | no EVERYONE grant |
| `Visibility.ORG` on Board | an EVERYONE grant on the List at VIEW |
| `Visibility.PRIVATE` on Folder or Board | `restricted = true` |
| `Visibility.WORKSPACE` on Folder or Board | `restricted = false` |

COMMENT is new and stays (open decision D8): it is the first ask of any client-review business and the Docs share modal copy already promises it.

### 3.2 Storage

```prisma
enum OrgRole      { OWNER ADMIN MEMBER GUEST }
enum ObjectRole   { FULL EDIT COMMENT VIEW }
enum GrantSubject { USER TEAM DEPARTMENT OFFICE ROLE TAG EVERYONE }
enum GrantObject  { SPACE FOLDER LIST DOC TABLE WHITEBOARD FILE_FOLDER SOP_FOLDER CHANNEL GOAL TOOL }

model AccessGrant {
  id             String       @id @default(cuid())
  organizationId String
  objectType     GrantObject
  objectId       String
  subjectType    GrantSubject
  subjectId      String?      // null when EVERYONE
  role           ObjectRole
  grantedById    String?
  expiresAt      DateTime?    // G8: guest links can expire later without a second migration
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  @@unique([objectType, objectId, subjectType, subjectId])
  @@index([organizationId, subjectType, subjectId])
  @@index([objectType, objectId])
  @@index([expiresAt])
}

model AccessRequest {
  id             String     @id @default(cuid())
  organizationId String
  objectType     GrantObject
  objectId       String
  requesterId    String
  requestedRole  ObjectRole @default(VIEW)
  message        String?
  status         String     @default("PENDING") // PENDING | GRANTED | DECLINED | EXPIRED
  resolvedById   String?
  resolvedAt     DateTime?
  createdAt      DateTime   @default(now())
  @@unique([objectType, objectId, requesterId, status])
  @@index([organizationId, status])
}

model Team {                                   // G3
  id             String   @id @default(cuid())
  organizationId String
  name           String
  alias          String   // "@design"
  description    String?
  leadId         String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([organizationId, alias])
}
model TeamMember { teamId String; userId String; createdAt DateTime @default(now()); @@id([teamId, userId]); @@index([userId]) }

// On User
orgRole     OrgRole   @default(MEMBER)
isAgent     Boolean   @default(false)
adminScopes String[]  @default([])   // "billing" | "security"

// On Invitation
orgRole     OrgRole   @default(MEMBER)
isAgent     Boolean   @default(false)   // §2.4: set at invite time, copied to User on accept

// On Space, Folder, Board, Doc, DataTable, Whiteboard, SOPFolder, FileFolder
restricted  Boolean   @default(false)   // true = do not inherit from parent

// On Space, Conversation only
findable    Boolean   @default(true)    // G4: discoverable to Members when they hold nothing on it

// On ActivityLog
actorType   String    @default("user")  // user | api-key | agent | cron | scim
actingForId String?
```

`OFFICE` is a group subject because `User.officeId` is live the way `departmentId` is; it replaces the Offices "Add all" tab that today copies user rows. `TOOL` is a grant object because Tools are shared with people today (`tools.view` "tools shared with them"). Objects not in `GrantObject` (item, sop, policy, contract, kra, person, team, survey, asset, announcement, review_cycle, automation, form, template, timesheet, kudos, candor) have no grant rows: their access is a relationship rule or inheritance (§3.3).

`Organization.settings.access` is one flat object validated by one zod schema (§8). `Organization.settings.security` gets its editor (§7.5).

Sequencing (G12): `AccessGrant` is additive first. It holds TEAM, DEPARTMENT, ROLE, TAG and EVERYONE subjects, all DOC, TABLE, WHITEBOARD, FILE_FOLDER, CHANNEL and GOAL objects, the reach-preservation rows and `SOPFolderAccess` (moved early because its vocabulary is the outlier). `SpaceMember`, `FolderMember`, `BoardMember` remain the USER-grant store for containers under the enum mapping until §10 step 7; the facts loader unions both sources. `ConversationMember` stays (it carries read state and notify level) and is what the gate reads for Talk membership. `GoalAssignee` stays the goal-audience store until step 7, read by the goal relationship rule.

Retired at the end (§10 step 8): `User.accessLevel`, `Invitation.accessLevel`, `Role.level`, `Space/Folder/Board.visibility`, `SpaceMember`, `FolderMember`, `BoardMember`, `SOPFolderAccess`, `HRSegment`, `GoalAssignee`, enums `AccessLevel`, `SpaceRole`, `SOPFolderRole`, `Visibility`, `Organization.settings.permissions`.

Items have no grants. A task's access is its List's access plus the assignee and creator rules.

### 3.3 The hierarchy and inheritance

```
Org
 └─ Space                          grants: users, teams, departments, roles, tags, EVERYONE; findable
     ├─ Folder (nested ≤ 6)         inherits Space unless restricted; own grants add; never findable
     │   └─ List                    inherits Folder unless restricted; own grants add; never findable
     │       └─ Item                inherits List; + assignee/creator rule; no grants
     ├─ List (no folder)            inherits Space unless restricted
     ├─ Doc anchored to Space/Folder/List/Item   inherits the anchor; own grants add
     ├─ Table anchored to Space     inherits the Space; own grants add
     ├─ Whiteboard anchored to Space  inherits the Space; own grants add
     ├─ Library folder / File       inherits its Space folder; signed URLs only after can(view, file)
     └─ Channel linked to Space     inherits the Space (EDIT+ may post; VIEW/COMMENT may read)
 Standalone Doc                    creator FULL; EVERYONE grant optional (migration writes VIEW for today's org-visible docs)
 Standalone Table / Whiteboard     creator FULL; EVERYONE EDIT by migration for today's org-wide rows; owners tighten later
 Notepad (Doc entityType NOTEPAD)  owner only, no grants, no Admin read-around
 SOP folder (nested)               inherits parent SOP folder unless restricted; unfoldered published SOPs = EVERYONE VIEW
 SOP                               author FULL on own drafts; folder rules; SOPAssignment = VIEW (published)
 Policy                            Admin + People team FULL; assigned people COMMENT (acknowledge); published org-wide = EVERYONE VIEW
 Contract (Agreement)              Admin + People team FULL; parties VIEW; nobody else
 Goal (OKR)                        owner FULL; audience grants (USER/DEPARTMENT/ROLE/TAG) EDIT for check-ins; COMPANY level = EVERYONE VIEW; manager chain EDIT on reports' goals; People team EDIT
 KRA / KPI definitions             EVERYONE VIEW (needed for tagging); Admin + People team EDIT; managers EDIT for their chain's assignments
 Person (people data)              self EDIT (self-service parts); manager chain EDIT; People team EDIT; Admin FULL; every Member VIEW on the directory card only
 Team                              members VIEW the Team page; lead FULL; Admin FULL
 Channel (Talk, no Space)          ConversationMember = EDIT; public channel = EVERYONE EDIT + findable + self-join; private = restricted; DM = members only, no Admin read-around
 Tool                              creator FULL; grants (USER/TEAM/DEPARTMENT/OFFICE/ROLE/TAG/EVERYONE); Admin FULL; a Member with no grant sees nothing
 Asset                             Admin + People team FULL; the assigned person VIEW (viewOwn); the assignee's manager chain VIEW; nobody else
 Survey                            creator FULL; Admin + People team FULL; targeted respondents COMMENT (respond); results = creator, Admin, People team
 Announcement                      author FULL; Admin + People team FULL; org-wide = EVERYONE VIEW (never Guests); Space-scoped = VIEW for anyone with VIEW on the Space
 Review cycle                      Admin + People team FULL; the launching manager FULL for their chain; subject self VIEW own; manager chain EDIT on their reports' reviews
 Automation workflow               creator FULL; Admin FULL; every Member VIEW the list; runs act as the creator (§2.5, cap EDIT), so a workflow never reaches beyond its creator
 Form                              anchored to a Table (Tables module, rule 2); inherits the Table; creator FULL; responding = COMMENT for anyone the form is shared with, or the public-link rule under toggle 10
 Template (Template Center)        creator FULL; Admin FULL; every Member VIEW (apply); Guests never
 Timesheet                         people data of its owner: resolves as { type: "person", id: ownerId } (self EDIT own entries; manager chain EDIT to approve; People team EDIT; Admin FULL)
 Kudos                             every Member EDIT (give, react); giver and Admin FULL (delete); Guests never
 Candor session                    anyone with reports FULL for sessions over their chain; People team and Admin FULL org-wide; participants COMMENT (respond)
 App / hub                         computed from org role, module state, relationships and the Apps floor (§5.2.1)
 Org settings page                 Owner-only / Owner+Admin(+scope) / Personal, plus People team read on four pages (§6.6)
```

Rules for every container:

- **Inherit down.** A grant on a Space applies to everything inside unless a descendant is Restricted. A grant lower never leaks upward: a person shared on a List sees the Space and Folder as bare container labels (breadcrumb and sidebar make sense) and nothing else in them.
- **Add, never subtract.** A direct grant is a floor. Priya with Can view on the Space and Can edit on one List edits that List and views the rest. The dialog shows "Priya already has Can edit from Space Marketing" and never offers a lower role as if it would take effect.
- **Restricted** (`restricted = true`) ignores the parent's grants. Its own grants, its `ownerId` and org Owners/Admins still reach it. A Space Full holder does not pierce a Restricted List inside it (G5 preserves today's Space-owner reach with explicit rows). Restricting is a Full action, never affects existing direct grants, and is reversible (today a private Folder can never be un-privated, audit Broken #10).
- **Findable** (`findable`, Spaces and public channels only) is discoverability: Members with no role see the name, icon and owner and can request access. Inherited as a ceiling: a Space-linked channel cannot be findable if its Space is not. Never for Guests. Master switch = toggle 3.
- **Archived** caps everyone at VIEW except FULL holders, who can restore.
- **EVERYONE grants** are grants whose subject is every Member (never Guests). "Open this Space to everyone at Acme as Can edit" is one row. Toggle 2 sets the default for new Spaces.
- **Team, Department, Office, Role, Tag grants** resolve to current members at read time (the live resolution `goal-audience.ts` already does). New hire in the department: has access. Leaver: gone. No "Add all" that copies 40 user rows.
- **Creating a List or Folder is content, not management.** `create_child` needs EDIT on the parent (Space or Folder): a Member with Can edit on a Space creates Lists and Folders in it and becomes their owner (FULL on the new object); an Agent may too (only Spaces are barred to Agents); a Guest with Can edit on a shared Folder may create a List inside it and owns it without being able to share it. Rename, settings, restrict, move and delete of the container stay FULL. This is a deliberate change from today's `POST /api/boards` and `POST /api/folders`, which call `canEditSpace` (Space OWNER/ADMIN); it is decision D15, an expected mismatch in the step 2 parity report, and a golden test.
- **Expired grants** (`expiresAt < now`) are ignored by the loader and shown greyed in the dialog with "Expired, renew".

### 3.4 Group principals (G3)

| Principal | Source | Notes |
|---|---|---|
| Person | `User` | The only principal a Guest can be. |
| Team | `Team` + `TeamMember` | Ad-hoc, `@alias`, a lead (Full on the Team object). Members create when toggle 1 allows Space creation; Admins always. |
| Department | `User.departmentId` | Live. |
| Office | `User.officeId` | Live. Replaces the share dialog's Offices "Add all" tab, which copied the visible subset of user rows. |
| Role holders | `User.roleId` | "Everyone titled Sales Rep". The only access meaning a job title keeps. |
| Tag holders | `TagAssignment(entityType USER)` | Existing person-tag primitive. |
| Everyone at {org} | all Owners, Admins, Members | Never Guests. |
| Reports of {person} | manager chain | Built-in rule; shown as a read-only "via reporting line" row on people objects only. |

Group principals are what keep the grant table near the number of sharing decisions at Fortune-500 scale.

### 3.5 People data, defined

Everything on a person beyond the directory card: KRAs and weights, KPI records, weekly reviews, review cycles and scores, goals assigned, timesheets, assets, compensation and contract fields when they exist, Talent 9-box position, performance snapshots, onboarding state, manager notes.

| Viewer | Directory card (name, avatar, title, dept, office, email, manager) | People data |
|---|---|---|
| Self | VIEW; EDIT the personal fields only (name, avatar, phone, date of birth, presence); title, department, office, reports to and role are read-only chips | VIEW own; EDIT the self-service parts (self review, KPI self-record, goal check-in, own timesheet entries) |
| Manager chain (solid or dotted, unlimited depth) | VIEW | EDIT (people data); never the membership fields below |
| People team member | VIEW everyone | EDIT everyone, plus the membership fields marked P below |
| Owner / Admin | VIEW everyone | FULL (delete, export, role changes) |
| Other Members | VIEW | none |
| Guests | only people sharing an object with them, name and avatar only | none |

The directory card is a read surface; who may write each field is fixed per field, because everything lands on `PATCH /api/users/[id]`:

| Field group | Fields | Self | Manager chain | People team | Owner / Admin |
|---|---|---|---|---|---|
| Personal | `firstName`, `lastName`, `avatar`, `phone`, `dateOfBirth`, `presenceStatus`, `presenceUntil` | write | read (DOB and phone visible) | read | write |
| Membership (P) | `roleId` (job title), `departmentId`, `officeId`, `managerId`, `UserDottedLine`, `weeklyCapacityHours` | read | read (today a manager in the reporting line may write these; that ends, org structure is not people data) | write | write |
| Membership (A) | `status` (deactivate, reactivate), `isAgent` | read | none | read | write (Owner guards) |
| Role | `orgRole` (Owner only by Owners), `adminScopes` (Owner only) | read | none | read | Owner: all; Admin: `orgRole` except Owner |
| Identity | `email` | read | read | read | read (no email-change flow exists; nobody writes it) |

The route implements this as one whitelist per viewer relationship computed from `can()` (`explain()` gives the relationship); a field outside the caller's whitelist is a 403 `field_forbidden` naming the field, never a silent drop. Self writes on Personal fields need no `can()` call beyond rule 1. Every write to Membership (A) and Role bumps the target's `tokenVersion`.

The Teams hub, `/talent`, `/team/*`, `/reviews`, `/analytics`, `/organization` render for anyone with at least one report, anyone on the People team, and Owners/Admins, scoped by the same rule. Nothing is hidden by tier. **The Talent 9-box stays at `/talent` with its population filtered by `can(viewer, "view", person)`.** `/team/rollup` follows the same rule (anyone with reports over their chain; People team and Admins over the org), replacing the `DIRECTOR_LEVELS` set at `apps-catalog.tsx:1061`. `/settings/hierarchy` redirects to `/settings/structure?tab=chart` (settings spec §5.6), which embeds the `/organization` chart client with an "Edit reporting lines" mode for Admins; `/organization` stays the Teams-hub canonical chart. Edits from either place go through the Membership (P) whitelist above.

### 3.6 Talk

- Talk is a premium module. Off for the org means `can()` returns none for every CHANNEL object and the hub is absent (rule 2, before the Admin short-circuit).
- Public channels: EVERYONE EDIT, `findable = true`, self-join creates the `ConversationMember` row for read state.
- Private channels and group DMs: `ConversationMember` rows are the grant at EDIT; creator FULL.
- Space-linked channels (`Conversation.spaceId`) inherit the Space.
- Owners and Admins get no read-around on DMs or private channels they are not in (rule 3 precedes rule 4). They see name and member count in an admin list and can archive (`org.archive_channel`, logged). A compliance read is an explicit, Owner-only, logged data-export act, never a browse.
- Guests join only channels they are added to and cannot DM Members who share nothing with them.

---

## 4. Precedence: the ordered resolution rules

`can(viewer, action, object)` computes the viewer's effective role, then checks the action against that role and the caps. This table is the whole algorithm; earlier rules short-circuit only where marked.

| # | Rule | Result |
|---|---|---|
| 1 | Viewer not signed in, soft-deleted, status not ACTIVE or PROBATION, or object not in the viewer's org. **Short-circuit.** | none, not discoverable (404 body identical to a real 404) |
| 2 | Object's module is off for the org (Talk, Tables), or the object's app is hidden or floored for the viewer by the Apps config. **Short-circuit.** Beats the Admin rule so a disabled module cannot leak through search, embeds or bookmarks. Fires before the object row is loaded: the decision is about the module or app key, never about the object, so it confirms nothing about any id. | none, `via: "module-off"` or `"app-off"`. `discoverable = true` for Owners, Admins and Members (the module or app is a known thing they may ask about), `false` for Guests and cross-org. The hub layout renders `<ModuleOff>` / `<AppOff>` from the app-level decision before any object lookup (Admins get the enable switch, Members get "Ask an admin" with Owner/Admin avatars, no object name); the API returns 403 `module_off` / `app_off` with only the module or app key in the body; sidebar, search, embeds and bookmarks show nothing. See §5.3 and example K. |
| 3 | Owner-only hard rule: Notepad docs, DMs and private channels the viewer is not in, another person's personal settings. **Short-circuit.** | owner or member: FULL (Notepad) or EDIT (DM); everyone else none, Owners and Admins included |
| 4 | Viewer is org Owner or Admin. **Short-circuit.** For `{type:"settings"}` objects the page table in §7.6 applies instead (Owner-only pages and Admin scopes). | FULL, via "org admin" |
| 5 | Viewer is the object's `ownerId` / `createdById`. | FULL, via "owner" |
| 6 | Direct USER grant on this object, not expired. | that role, via "shared with you" |
| 7 | TEAM, DEPARTMENT, OFFICE, ROLE or TAG grant on this object where the viewer is a current member. | that role, via "shared with {group}" |
| 8 | EVERYONE grant on this object (Members only; never Guests). | that role, via "open to everyone" |
| 9 | Relationship rules for the type: Item assignee or creator = EDIT on the Item plus VIEW-for-context on its List (statuses, fields, name only); goal audience = EDIT for check-ins, owner FULL; manager chain over the subject person = EDIT on people data; People team = EDIT on people data; SOP author = EDIT on own drafts; SOP or Policy assignee = VIEW (COMMENT for acknowledgement); contract party = VIEW; channel member = EDIT; Team member = VIEW on the Team; department head = nothing extra (open decision D10 keeps it out). | that role, via "assigned to you" / "you manage them" / "People team" |
| 10 | Inheritance: unless the object is Restricted, apply rules 5 to 9 to the parent, then upward to the Space (max 8 hops, one CTE query for the whole chain). A Restricted ancestor stops the walk there. | highest role found, via "inherited from {ancestor}" |
| 11 | Take the **maximum** of every role produced by rules 5 to 10. | effective role |
| 12 | Caps, in this order: **Guest** at most EDIT, FULL only on own creations (rule 5) and never `share`; **Agent** at most EDIT and `delete`, `export`, `create_space` always denied; **acting-as** (`viewer.actingAs`) at most `min(actingFor's live level, cap)`; **archived** (object or any ancestor) at most VIEW unless the uncapped role was FULL (restore allowed). | capped role |
| 13 | Action check: `view` needs VIEW; `comment` needs COMMENT; `edit`, `create_child` need EDIT (`create_child` on a Space or Folder creates Lists and Folders, D15; on a List creates Items); `share` needs FULL, or EDIT with toggle 4 (then only View, Comment, Edit); `manage`, `restrict`, `findable`, `move`, `archive`, `transfer` need FULL; `delete` needs FULL and toggle 8; `export` needs EDIT and is denied to Guests, Agents and acting-as principals; `invite_guest` needs FULL and toggle 5; `publish` (SOP, Policy) needs EDIT or, under toggle 7, Admin or People team. | allowed / denied |
| 14 | Discoverability (computed only when the role is none): true if the viewer is a Member (never a Guest), toggle 3 is on, the object is a Space or public channel with `findable = true` and every ancestor is findable; true if the viewer holds a role on any descendant (container label); true if the viewer is an assignee of an Item inside; otherwise false. Folders and Lists are never findable on their own. For `{ type: "settings" }` refs: true for Owners and Admins on every Workspace page (an Admin without the scope gets the `AdminOnly` card, example H), true for the People team on the four `peopleTeamRead` pages, false for everyone else; a not-discoverable settings ref is the one place the layout does not call `notFound()`: `/settings/*` is a shared URL space with the personal door, so the settings layout renders My settings › Profile with the Ask-an-admin strip at the same URL (§5.5 item 3). For `{ type: "app" }` and module-off refs see rule 2. | discoverable flag |

Whole-list reads (sidebar tree, search, Everything, Library) do not call rules 1 to 14 per row. They call `accessibleIds(viewer, type, minRole)`, which runs the same rules as set arithmetic in three queries and returns **two typed sets**: `readable` (objects with a source at the object's own level or above) and `containerOnly` (ancestors shown as labels because the viewer holds something inside). Content endpoints (files, search, tables, whiteboards, entity links) may only consume `readable`; the `visibleSpaceIds` leak trap (`space.ts:165-171`) becomes a type, not a comment.

### 4.1 Worked examples

**A. A Guest shared on a List.** Ravi (Guest) is added to List "Website redesign" with Can edit. The List sits in Folder "Q4" in Space "Marketing", neither restricted, neither shared with Ravi.
- `can(Ravi, "edit", List)`: rule 6 EDIT; cap 12 allows EDIT. Allowed.
- `can(Ravi, "view", Folder Q4)`: nothing in 5 to 9; no upward inheritance. Role none; rule 14: descendant role, discoverable as a container label. Sidebar: "Marketing > Q4" grey labels with only "Website redesign" under them. Folder page renders LockedPage: "You have access to 1 list in this folder."
- `can(Ravi, "share", List)`: needs FULL; Ravi is EDIT and a Guest (toggle 4 never applies to Guests). Denied. Share button is replaced by a "Can edit" chip that opens "Who has access" read-only.
- `can(Ravi, "view", Item)`: rule 10 inherits EDIT. He creates tasks and assigns only to people with a role on this List.
- Directory, Docs hub, org-open Spaces: rule 8 excludes Guests, rule 2 hides hubs. Not discoverable. `/spaces/marketing` is a 404 for him even though Marketing is findable (Guests never discover).

**B. A Member assigned a task in a Space they are not in.** Maya (Member) is assigned Item "Fix invoice PDF" in List "Backlog" in Space "Finance", which has no EVERYONE grant.
- `can(Maya, "edit", Item)`: rule 9 EDIT via "assigned to you". She sees it in My work, opens `/item/[id]`, edits fields, comments, completes. Preserves `api/items/[id]/route.ts:27-31`.
- `can(Maya, "view", List Backlog)`: rule 9 VIEW-for-context: role none for content, `discoverable = true` with `context: { name, statuses, fields }` so the drawer renders the status pill. `/boards/backlog` shows LockedPage: "You can see 1 task here because it's assigned to you. Ask Finance's owner for access to the whole list." plus Request access. Creating a new task in Backlog is refused (EDIT on the item is not EDIT on the List).
- `can(Maya, "view", Space Finance)`: none; discoverable via descendant. Grey label.
- Reassignment away from her stops the rule on the next request. No cleanup job.

**C. A manager viewing a report's KRAs.** Dev reports to Anita; Anita to Karan (CEO). Neither is an Admin.
- `can(Anita, "edit", person Dev)`: rule 9 manager chain EDIT. KRAs, KPI reviews, weekly review, Dev in her 9-box.
- `can(Karan, "edit", person Dev)`: rule 9 skip-level EDIT. No Director tier needed.
- `can(Dev, "view", person Anita)`: no match; `person_card` VIEW only. Her KRAs are not discoverable to Dev.
- `can(Anita, "view", person Priya)` in Sales: none. Anita's Teams hub lists her chain only.

**D. People team versus a department head.** Sunita is on the People team (plain Member); Rahul heads Engineering (40 reports, 3 levels, plain Member).
- Sunita: rule 9 People team EDIT on every person. Teams hub shows the org; `/reviews` lets her launch cycles for anyone; `/talent` shows the org 9-box; Policies and Contracts FULL. No Admin settings pages.
- Rahul: rule 9 manager chain EDIT on his 40. `/reviews` for his chain; `/talent` shows his 40. He cannot open Sunita's people data or Sales'. He can hold Full access on any Space like anyone.
- If the company wants Rahul in Settings, an Owner makes him Admin.

**E. Space Full holder versus a Restricted List.** Nia has Full on Space S. List L inside S is Restricted and she has no grant on L.
- `can(Nia, "view", L)`: rules 5 to 9 nothing; rule 10 stops at L because L is Restricted. none; rule 14: Lists are never findable, so a 404 unless she holds something inside it. This is a deliberate change from `board.ts:645-651` (Space OWNER pierced PRIVATE boards). The backfill writes Nia an explicit FULL grant on every existing PRIVATE Board she owned the Space of (G5), so nothing disappears on flip day; the row is visible in the dialog.

**F. An API key after its creator was demoted.** Key K (WRITE scope) was created by Omar when he was Admin; Omar is now a Member with Can view on Space S.
- Request with K: `viewer = { userId: omar, actingAs: { type: "api-key", cap: EDIT } }`. `can(K, "edit", List in S)`: rule 4 no (Omar is a Member); rule 10 inherits VIEW from S; cap 12 `min(VIEW, EDIT) = VIEW`. 403 `insufficient`. The audit row carries `actorType: "api-key", actingForId: omar`.
- If Omar's `tokenVersion` is bumped (deactivation, password change, sign-out-all), K dies with it.

**G. An archived Folder.** Folder F is archived; Priya has Can edit inherited from the Space.
- `can(Priya, "edit", List in F)`: rule 10 EDIT; cap 12 archived: `min(EDIT, VIEW) = VIEW`. Read-only mode with the banner "Archived. Ask {owner} to restore." A FULL holder keeps FULL and sees Restore.

**H. An Admin opening Billing.** Ken is Admin with `adminScopes = []`.
- `can(Ken, "view", { type: "settings", page: "billing" })`: rule 4 defers to the settings table: billing is Owner-only unless scope `billing`. none, discoverable (settings pages are always discoverable to Admins). LockedPage: "Billing is managed by workspace Owners." with Owner avatars and a disabled Request access ("Ask an Owner"). No bounce to `/dashboard`.

**I. A Member types an outside email into the share dialog.** Toggle 5 is "Anyone with Full access"; the org domain is `acme.com`; Zoe (Member, Full on List L) types `sam@agency.io`.
- `can(Zoe, "invite_guest", L)`: FULL and toggle 5. Allowed. The row is labelled Guest; "Invite as member" is absent because Zoe is not Owner/Admin and the domain does not match. The invitation carries `orgRole = GUEST`, object L, Can edit, and `expiresAt` from the Guests and links card if set.

**J. A shared Folder inside an unshared Space.** Tom (Member) is added to Folder "Client X" with Can edit. The Folder sits in Space "Agency" (no EVERYONE grant, `findable = false`, Tom holds nothing on it) and contains Lists "Brief" and "Deliverables" plus a Restricted List "Rates" that has its own grants (Tom not among them).
- `can(Tom, "edit", Folder Client X)`: rule 6 EDIT via "shared with you". Folder page renders in edit mode: he creates Lists inside it (`create_child` needs EDIT, D15) and owns what he creates.
- `can(Tom, "edit", List Brief)`: rules 5 to 9 nothing on the List; rule 10 walks up one hop to the Folder, finds EDIT, `via: "inherited"`, `viaObject: Folder Client X`. Same for Deliverables and every Item in them.
- `can(Tom, "view", List Rates)`: rule 10 stops at Rates because it is Restricted; none; rule 14: Lists are never findable and he holds nothing inside; not discoverable; `/boards/rates` is a 404 for him and the List is absent from the sidebar under Client X.
- `can(Tom, "view", Space Agency)`: rules 5 to 9 nothing (no EVERYONE grant); none; rule 14: he holds a role on a descendant, so discoverable as a container label. Sidebar: "Agency" as a grey label with only "Client X" under it; `/spaces/agency` renders LockedPage: "You have access to 1 folder in this space." Space-level things (Space docs, Space channel, other Folders) are absent.
- `accessibleIds(Tom, "space", VIEW)`: `readable = {}`, `containerOnly = { Agency }`. Space-scoped search, files, tables and whiteboards consume `readable` only, so nothing in Agency outside Client X reaches him (invariant 2). `accessibleIds(Tom, "folder", VIEW).readable = { Client X }`; `accessibleIds(Tom, "list", VIEW).readable = { Brief, Deliverables }`.
- `can(Tom, "share", Folder Client X)`: EDIT and toggle 4 on: allowed at View, Comment, Edit only; the picker is the whole directory. If the Folder's owner later restricts the Folder, Tom's direct grant is unaffected (add, never subtract).

**K. A premium module turned off.** Talk is off for Acme (`ProductInstallation` absent). Ken is Admin, Maya is a Member, Ravi is a Guest who was once added to channel #client-x. Each opens a bookmark `/tlk/c/client-x`, then searches "client-x", then calls `GET /api/conversations/client-x`.
- Rail: the Talk hub is absent for all three (`visibleApps` calls `can(viewer, "view", { type: "app", key: "chat" })`, rule 2 returns none).
- Bookmark: the `/tlk` layout calls `gatePage("view", { type: "app", key: "chat" })` before any page code runs. Ken: none, `via: "module-off"`, discoverable; `<ModuleOff module="Talk">` renders with the on/off switch (the same control as `/settings/apps#modules`) and "Turning this on unlocks N channels"; no channel name is shown because no channel was loaded. Maya: same page without the switch: "Talk is turned off. Ask {Owner and Admin avatars} to turn it on." Ravi: not discoverable (Guests never), `notFound()`.
- Search: `accessibleIds(viewer, "channel", VIEW)` returns empty sets for all three because rule 2 runs as set arithmetic first; the palette and search index show no Talk rows. Embeds of a channel in a Doc render "Talk is off" for Ken and Maya and nothing for Ravi.
- API: `requireCan("view", { type: "channel", id: "client-x" })` short-circuits at rule 2 before `loadFacts` reads the Conversation row: Ken and Maya get 403 `{ error: "module_off", module: "chat" }` (no object fields; the same body for a channel id that does not exist); Ravi gets 404 `{ error: "not_found" }`. Invariant 14 holds because the 403 is about the module, not the id.
- Ken flips the switch: the next request resolves normally; his Full on public channels and his no-read-around on DMs (rule 3) both return at once. No grant was touched while the module was off.

---

## 5. The single gate

### 5.1 Location and shape

`src/lib/access/` (new directory) replaces `src/lib/access.ts`, `access-levels.ts`, `permissions.ts`, `page-gates.ts`, `route-guard.ts`, `alignment-scope.ts`, `hr-segment.ts`, `sop-access.ts`, `doc-access.ts`, the gate halves of `space.ts`, `board.ts`, `folder.ts`, `src/components/layout/os/access-tiers.ts`, `src/hooks/use-role.ts`, `src/hooks/use-permission.ts`.

```
src/lib/access/
  types.ts        OrgRole, ObjectRole, Action, ObjectRef, Viewer, Decision, AccessFacts
  labels.ts       the ONE copy of role labels and blurbs for every UI
  facts.ts        loadFacts(viewer, ref): Promise<AccessFacts>   (all Prisma reads live here)
  resolve.ts      decide(facts, action): Decision                 (pure, no I/O)
  ids.ts          accessibleIds(viewer, type, minRole): Promise<{ readable, containerOnly }>
  users.ts        accessibleUsers(ref), explain(viewer, ref)
  viewer.ts       viewerFromSession(), viewerFromApiKey(), viewerForAgentRun(), viewerForCron()
  gate.ts         requireCan() for APIs, gatePage() for pages, AccessError
  grants.ts       the only writer of AccessGrant and member rows; guards; audit
  requests.ts     AccessRequest flow
  audit.ts        logAccessChange(), logDenial() (sampled)
  settings.ts     zod schema for Organization.settings.access + defaults + Lock it down preset,
                  plus SETTINGS_PAGE_GATES: Record<SettingsPageKey, PageGate> (the role half of the settings page table, §6.6)
                  and APP_RULES: Record<AppKey, AppRule> (§5.2.1)
  enforcement.ts  ENFORCED_AT: Record<Action | ToggleKey | RuleKey | CapKey, string>  (route or function name; every ObjectRef type has at least one key)
  index.ts
  resolve.test.ts golden suite: every row of audit table 1.6, every worked example A to K, every invariant in §11, the §3.5 field table, the §5.2.1 app table
```

File ownership with the settings spec: `src/lib/settings/pages.ts` (settings spec §3.1) declares `SettingsPageKey` and the presentation half of each page (label, href, group, tabs); `src/lib/access/settings.ts` holds `SETTINGS_PAGE_GATES`, typed `Record<SettingsPageKey, ...>` so a page added without a gate fails to compile. `pages.ts` imports its gate from `src/lib/access/` for the nav; nothing under `src/lib/settings/` reads a role, which keeps the G7 lint rule intact. There is one table split across two files by concern, not two tables.

```ts
export type OrgRole    = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
export type ObjectRole = "FULL" | "EDIT" | "COMMENT" | "VIEW";
export type Action =
  | "view" | "comment" | "edit" | "create_child" | "share" | "invite_guest" | "publish"
  | "manage" | "restrict" | "findable" | "move" | "archive" | "delete" | "transfer" | "export";

export type ObjectRef =
  | { type: "space" | "folder" | "list" | "item" | "doc" | "table" | "whiteboard" | "file_folder" | "file"
          | "sop" | "sop_folder" | "policy" | "contract" | "goal" | "kra" | "channel" | "team"
          | "tool" | "asset" | "survey" | "announcement" | "review_cycle" | "automation" | "form"
          | "template" | "timesheet" | "kudos" | "candor"; id: string }   // every §3.3 row; §9 rows resolve to one of these
  | { type: "person"; id: string }            // people data of that user (timesheet, asset-of and review-of resolve here)
  | { type: "person_card"; id: string }       // directory card only
  | { type: "app"; key: AppKey }              // rail hub or folded app, by AppEntry.key (§5.2.1)
  | { type: "settings"; page: SettingsPageKey }  // one Workspace settings page (key from src/lib/settings/pages.ts)
  | { type: "org"; action: OrgAction };       // create_space, invite_member, invite_guest, create_team, create_automation, archive_channel, export_people ...

export interface Viewer {
  userId: string; organizationId: string; orgRole: OrgRole; isAgent: boolean; adminScopes: ("billing" | "security")[];
  actingAs?: { type: "api-key" | "agent" | "cron"; id: string; cap: ObjectRole };
  // lazily loaded, memoised per request:
  reportTree?: Set<string>; peopleTeam?: boolean; departmentId?: string | null; officeId?: string | null; roleId?: string | null; teamIds?: string[]; tagIds?: string[];
}

export interface AccessFacts {          // everything decide() needs, nothing else
  viewer: Viewer;
  object: { type; id; organizationId; ownerId; restricted; findable; archived; moduleKey?; appKey? };
  chain: Array<{ type; id; name; ownerId; restricted; findable; archived }>;   // nearest first, up to the Space
  grants: Array<{ objectType; objectId; subjectType; subjectId; role; expiresAt }>;   // for object + chain, viewer's principals only, plus EVERYONE
  relationships: { isAssignee; isCreator; managesSubject; peopleTeam; isConversationMember; isSopAssignee; isPolicyAssignee; isContractParty; isGoalAudience; isTeamMember };
  org: { access: AccessSettings; activeModules: Set<string>; apps: OrgAppsConfig; peopleTeamIds: string[] };
}

export interface Decision {
  allowed: boolean;
  role: ObjectRole | "none";
  via: "org-admin" | "owner" | "shared" | "team" | "department" | "office" | "role" | "tag" | "everyone"
     | "assigned" | "manager-chain" | "people-team" | "inherited" | "module-off" | "app-off" | "none";
  viaObject?: { type: string; id: string; name: string };
  reason: string;                 // one plain sentence for LockedPage and the audit log
  discoverable: boolean;
  context?: Record<string, unknown>;   // e.g. a List's statuses and fields for an assignee-only viewer
  enforcedAt: string;             // the route or function that owns this action, for the tooltip
}

export function decide(facts: AccessFacts, action: Action): Decision;                      // pure
export async function loadFacts(viewer: Viewer, ref: ObjectRef): Promise<AccessFacts>;
export async function can(viewer: Viewer, action: Action, ref: ObjectRef): Promise<Decision>;   // decide(await loadFacts())
export async function canMany(viewer: Viewer, action: Action, refs: ObjectRef[]): Promise<Map<string, Decision>>;
export async function accessibleIds(viewer: Viewer, type: ObjectRef["type"], minRole: ObjectRole): Promise<{ readable: Set<string>; containerOnly: Set<string> }>;
export async function accessibleUsers(ref: ObjectRef): Promise<Array<{ userId: string; role: ObjectRole; via: Decision["via"] }>>;
export async function explain(viewer: Viewer, ref: ObjectRef): Promise<Decision[]>;        // every source, for Check access

export async function requireCan(action: Action, ref: ObjectRef): Promise<{ viewer: Viewer; decision: Decision }>;
//   API: throws AccessError(404) when !discoverable; AccessError(403, { reason, requestAccess }) otherwise.
export async function gatePage(action: Action, ref: ObjectRef): Promise<{ viewer: Viewer; decision: Decision }>;
//   Page: notFound() when !discoverable; returns the decision otherwise (page renders locked or read-only).

// Client
export function useAccess(): Decision;   // from <AccessProvider> the page wraps its body in
export function useViewer(): Viewer;     // orgRole, isAgent, adminScopes, hasReports, peopleTeam from the session
```

Why the split (G12): `vitest.config.ts` is node-only over `src/lib/**/*.test.ts` and touches no database, so `decide()` over an `AccessFacts` struct is what the golden suite exercises with no mocking layer. `loadFacts()` is covered by the parity job (§10 step 2) and by a small integration suite run against the local Postgres.

Implementation notes:

- Ancestor chain in one query: a recursive CTE on `Folder.parentFolderId` and the Space id (the pattern `sop-access.ts` already uses) returns the chain with `restricted`, `findable`, `archivedAt`; grants for the viewer's principals across the chain come from one `AccessGrant.findMany` with `objectId IN chain` unioned with the mapped member tables during the transition. Today `resolveFolder` loops up to eight `findUnique` calls.
- `Viewer` is built once per request by `viewerFromSession()` from the JWT (`orgRole`, `isAgent`, `adminScopes` are added next to `id` and `organizationId`; `accessLevel` stays as a written mirror for two releases). Report tree, People team, department, teams and tags load lazily and memoise on the Viewer for the request (the WeakMap trick `api-helpers.ts:103` already uses).
- `enforcement.ts` maps every `Action`, toggle and rule to a route or function name; a test asserts every member of the `Action` union and every toggle key appears in at least one golden case and in `ENFORCED_AT`. Nothing can go cosmetic the way 55 matrix cells did.
- Denials are logged: `requireCan` and `gatePage` write `access.denied` with the reason when the object was discoverable (a real person hit a wall), sampled to one row per viewer per target per 10 minutes, never for random id probes. Grants, role changes, restrict and findable toggles, org-role changes, Guest invites, request decisions and non-human writes log `access.granted`, `access.changed`, `access.revoked`, `org_role.changed`, `access.request.*` with actor, `actorType`, target, before and after (closes audit Broken #19).

### 5.2 Who calls it

| Layer | Call | Replaces |
|---|---|---|
| Rail and hub sidebars | `visibleApps(viewer, orgAppsConfig, activeModules)` in `src/lib/rail-apps.ts` = `can(viewer, "view", { type: "app", key })` per catalog entry, hubs and folded keys alike, from the one `APP_RULES` table in §5.2.1. Apps floor (Everyone / Members with reports / Admins) and hide are enforced by rule 2. `AppEntry.requiredAccess` is deleted; folded links inside hub sidebars call the same function with the folded key. | `access-tiers.ts`, `canAccessApp`, the per-sidebar re-gating in `apps-catalog.tsx` (lines 312, 1025, 1061 `DIRECTOR_LEVELS`, 1102, 1109, 1176, 1212, 1225), `docs-sidebar.tsx:166`, `chat-sidebar.tsx:268` |
| Command palette, More launcher, search | filter through `visibleApps` and `accessibleIds` | `command-palette.tsx:235` indexing raw `APPS` |
| Server page | `const { viewer, decision } = await gatePage("view", { type: "list", id })` at the top; render `<AccessProvider value={decision}>`; `<LockedPage decision />` when `decision.role === "none"`. | `canRead`/`resolveAccess` in `/boards/[slug]`, `/folders/[id]`, `/people/[id]`, `/team/*`; `requireManagerPage` (8 files), `requireHrAdminPage` (2), `requireManagerOrRedirect` (7), `requireOrgAdminOrRedirect` (8); inline lock card on `/settings/structure`; the 14 ungated settings pages and 11 ungated app pages |
| Settings layout | one `src/app/(dashboard)/settings/layout.tsx` calls `gatePage("view", { type: "settings", page })` from the pathname; the six per-page `layout.tsx` gates (apps, audit, data, defaults, identity, tags) are deleted | 6 layout gates plus 14 ungated pages |
| API route | `const { viewer } = await requireCan("edit", { type: "item", id })` first line after parsing params. List endpoints use `accessibleIds(...).readable`. | 220 `isOrgAdmin/isManager/hasRole` sites in 133 files, 23 inline level compares, `getBoardForReader` (17 files), `getSpaceForReader` (36), `canEditSpace` (23), `docAccessible` (21), `getSessionAndModule` (19), `canEditBoard` (9), `canContributeBoard` (3), `canContributeSpace` (3), `folderReadable` (3), `folderVisibleTo` (5), `visibleSpaceIds` (6), `sopVisibilityWhere` (2), `canWriteToFolder` (4), `requirePermission`/`hasPermission` (13), `canTouchUserAlignment` (11), `canSeeGoal` (7) |
| Cron and agents | `viewerForCron(orgId, actingForId, cap)`, `viewerForAgentRun(run)`; every write goes through `requireCan` | inline `ORG_ADMIN` checks in `cron/run-due-agents`, `autopilot/workflows`, `team/members-work` |
| Client components | `useAccess().role` for object UI; `useViewer()` only for org-level chrome (New Space, Invite, Admin settings section). Components outside a gated page post to `POST /api/access/check { targets[] }` (batched, page-lifetime cache invalidated on the existing `workwrk:prefs-changed` event). | `useRole()` (16 files), `usePermissions()` (2), every `session.user.accessLevel` read in components |

#### 5.2.1 The app rule table (`APP_RULES` in `src/lib/access/settings.ts`)

One row per `AppEntry.key` in `apps-catalog.tsx`: the 8 hubs, the 19 keys in `FOLDED_INTO_HUB`, and the three Teams-hub pages that are routes rather than catalog entries. "Member" means Owner, Admin and Member (Agents included unless said otherwise); Guests are named where they get anything. Rule 2's module and Apps-config checks run first for every row. The page under each key calls `gatePage("view", { type: "app", key })` in its layout, so the row and the route cannot disagree.

| Key | Hub | Who sees the row and opens the route | What a Guest gets |
|---|---|---|---|
| `home` (Work) | hub | everyone signed in; `alwaysPinned` | yes: My work over shared objects, Inbox |
| `planner` | hub | every Member | none (a Guest's items live in Work › My work) |
| `chat` (Talk) | hub | module on; every Member | only when a channel is shared with them |
| `docs` | hub | every Member | only when a Doc, SOP or Policy is shared |
| `teams` | hub | every Member: Directory, Org chart, My profile always; the people-ops rows below by their own rule | none |
| `tables` | hub | module on; every Member | only when a Table or Form is shared |
| `ai` | hub | every Member (Sidekick, agents, automation list) | none |
| `settings` | hub | everyone signed in; `alwaysPinned`; lands on Workspace › Overview for Owner, Admin, People team, else on My settings › Profile | Personal section only |
| `goals` | Work | every Member (own goals, audience goals, COMPANY goals) | none |
| `timesheets` | Work / Planner | every Member (own); approvals for anyone with reports, People team, Admin | none |
| `library` | Docs | every Member; content scoped by `accessibleIds(file_folder)` | shared files only |
| `clips` | Docs | every Member; content scoped like Docs | none |
| `sops` | Docs | every Member; content scoped by `accessibleIds(sop_folder)` | assigned SOPs only |
| `policies` | Docs | every Member (published and assigned); Admin + People team manage | none |
| `agreements` (Contracts) | Docs | Admin + People team; a Member who is a party sees their own on `/people/me` | none |
| `reviews` (Review cycles) | Teams | anyone with reports (their chain); People team and Admin (org); a subject sees their own review from their profile | none |
| `talent` (9-box) | Teams | anyone with reports (their chain); People team and Admin (org). Hard constraint: stays at `/talent` | none |
| `analytics` | Teams | anyone with reports (their chain); People team and Admin (org) | none |
| `rollup` (`/team/rollup`) | Teams | anyone with reports (their chain); People team and Admin (org); replaces `DIRECTOR_LEVELS` | none |
| `candor` | Teams | anyone with reports (run sessions over their chain); People team and Admin (org); every Member as a participant when invited to a session | none |
| `kudos` | Teams | every Member (give, receive, feed); Admin deletes | none |
| `surveys` | Teams | Admin + People team (create, results); every targeted Member (respond, from Inbox and the row) | none |
| `tools` | Teams › Resourcing | every Member (sees the Tools shared with them; empty state "No tools shared with you yet"); Admin manages all. The settings spec's "Admin + People team" for this row must widen to this. | none |
| `assets` | Teams › Resourcing | anyone with reports (their people's assets); People team and Admin (org). A Member without reports sees their own assets on `/people/me`, not here | none |
| `announcements` | Talk | every Member reads; Admin + People team create org-wide; Full on a Space creates Space-scoped | none |
| `forms` | Tables | module on; every Member; content scoped by the anchoring Table | shared forms only |
| `automation` | AI | every Member sees the list and their own workflows (create needs `org.create_automation` = any Member; Agents included); Owner/Admin see and manage all. Replaces `AutomationRole` in `hub-access.ts` | none |
| `build` | AI | Owner and Admin | none |
| `store` (Marketplace) | AI | every Member browses; installing needs the `settings.apps` page rule (Owner/Admin) | none |
| `integrations` (`/integrations`) | AI | every Member browses the catalog; connecting an integration needs `settings.manageIntegrations` (Owner/Admin, or `security` scope where it mints credentials) | none |
| `trash` | Work (row) and Data › Trash (link) | every Member: sees and restores items they own or hold FULL on (`accessibleIds(type, FULL)` per source); Owner and Admin see the org trash and purge. This is what lets a Member restore a List they deleted; today `/api/trash` is `isManager` | none |

A key with no row does not render and its route 404s, which the `enforcement.ts` completeness test asserts against `APPS`.

### 5.3 Discoverable versus accessible, in the UI

| Decision | List row (sidebar, search, Library) | Page | API |
|---|---|---|---|
| role ≥ VIEW | normal row | normal page in read-only, comment, edit or full mode | 200 |
| role none, discoverable | Spaces and public channels: grey row with a lock glyph and the name. Folders and Lists: only as container labels above something the viewer holds. Click opens the locked page. | `<LockedPage>`: icon and name, owner avatar, one sentence from `decision.reason`, one primary "Request access" (View / Edit choice, Comment for Docs, optional message), one text link Back. URL stays. Shell, rail, sidebar, breadcrumb stay. | 403 `{ error: "no_access", reason, object: { type, id, name }, owner: { id, name }, requestAccess: true }` |
| role none, not discoverable | absent | `notFound()` (the standard 404 inside the shell) | 404 `{ error: "not_found" }` |
| role none, `via: "module-off"` or `"app-off"` (rule 2) | absent | the hub layout renders `<ModuleOff>` / `<AppOff>` from the app-level decision before any object is loaded: Owners and Admins get the on/off switch or a link to `/settings/apps`, Members get "Ask an admin" with Owner/Admin avatars; Guests get `notFound()`. Never an object name. | 403 `{ error: "module_off", module }` or `{ error: "app_off", app }`, no object fields, identical for ids that do not exist; Guests 404 |
| role none, `{ type: "settings" }`, not discoverable | Workspace pages absent from the settings nav | My settings › Profile at the same URL with the Ask-an-admin strip (the settings variant of LockedPage, §6.4) | 403 `{ error: "no_access", page }` on the org write APIs |

The peek payload (`GET /api/access/peek?type=&id=`) returns only `{ kind, name, icon, owner: { name } }`, never counts, descriptions or children (G4). Page and API call the same function with the same `ObjectRef`, so they agree by construction (closes audit Broken #1 and #2).

### 5.4 Read-only mode

Every object page wraps its body in `<AccessProvider value={decision}>`. Components read `useAccess()`:

| Role | Renders | Does not render |
|---|---|---|
| VIEW | Content, filters, sort, group, search, view switcher, Copy link, export if allowed, a "Can view" chip where Share would be (click: Who has access, read-only) | every create, edit, drag, inline-edit, delete, share, settings, rename, "+" affordance; field cells are plain text; comment composer |
| COMMENT | VIEW plus comment composer, reactions, acknowledge buttons, form responder; chip reads "Can comment" | as VIEW otherwise |
| EDIT | content controls (add task, inline edit, drag, subtasks, attachments, doc editor, table cells, new List inside a Folder); a "Can edit" chip or, under toggle 4, a Share button in "add at Can edit or below" mode | object settings, statuses and fields editor, rename, restrict, findable, delete, transfer, Full access in the picker |
| FULL | everything | nothing hidden |

A control the role cannot use is not rendered, not disabled. One slim banner under the header in VIEW and COMMENT: "View only. Ask {owner} for edit access." with Request. Field cells show a lock cursor on hover. Existing `readOnly` props on `BoardItemDetail`, the block editor, the sheet grid and the canvas are the mount targets.

This retires every disabled-control pattern the audit lists: `SpaceShareButton` rendered for every reader (`spaces/[slug]/page.tsx:612`), share dialogs that 403 on click, survey Launch/Close, ideas drag, automation mutations, profile-menu Trash, New policy and New contract for employees, settings pages rendered read-only to managers.

### 5.5 Denial and redirect: the one convention

1. Not signed in: `/login?callbackUrl=<current>` (the only redirect in the system).
2. Signed in, object not discoverable: 404 page inside the shell.
3. Signed in, discoverable, no role: LockedPage at the same URL. Settings variants of the same component: `AdminOnly` for an Admin on an Owner-only page without the scope (example H); the Ask-an-admin strip over My settings › Profile for a Member, Guest or Agent on any Workspace page, and for the People team on a page without `peopleTeamRead` (settings spec §3.3). Nothing under `/settings/*` ever 404s for a signed-in person, because the personal door shares the prefix.
4. Signed in, has a role but not this action: the action is not rendered. If reached anyway (stale tab, direct API call) the API returns 403 with the reason and the client shows one toast: "You need Can edit for that. Ask {owner}." with Request access.
5. Module off: rule 2 fires on the app key before any object is loaded. `<ModuleOff>` from the hub layout: Owners and Admins see the on/off switch, Members see "Ask an admin" with avatars, Guests get the 404 page. API 403 `module_off` with only the module key (Guests 404). Search, sidebar, embeds: absent. The object is never named, so nothing is confirmed (example K).
6. App hidden or floored by the Apps config: exactly as 5 with `<AppOff>` and 403 `app_off`; Admins see a link to `/settings/apps` instead of a switch.

`/dashboard`, `/people/me`, `/team/reviews` as denial targets are deleted. `BackButton{fallbackHref}` sits on every locked view.

### 5.6 Request access flow

1. LockedPage or 403 toast, choose View or Edit (Comment for Docs), optional message, `POST /api/access-requests` creates one open `AccessRequest` per person per object (a repeat re-notifies at most once per 24h).
2. Every Full holder of the object (direct, then nearest ancestor with explicit Full holders, then the owner, then Admins) gets an Inbox row "Maya requested Can edit on Backlog · Give edit · Give view · Decline". One click writes the grant through `grants.ts`, resolves the request, notifies Maya, logs `access.request.granted`.
3. Maya's LockedPage polls (existing 45 s notifications poller) and becomes the real page when granted.
4. Requests expire after 14 days (cron row added to `scripts/CRON-SETUP.md`). Open requests show in the dialog footer and on `/settings/access`. Toggle: requests on/off is not a separate switch; toggle 3 off means nothing is discoverable, so nothing is requestable.

---

## 6. UI surfaces

Visual frame: Zoho-clean per `zoho-reference.md` (white card, hairline rows, 36 px inputs, one blue primary, no black selected states). Rows mirror ClickUp's Sharing and Permissions modal for the parity mandate (open decision D9).

### 6.1 One share dialog

`src/components/access/share-dialog.tsx`, opened from every object's Share button, "..." > Share, sidebar row hover, Talk channel header, Goal page, SOP folder row, and the Person page as "Who can see this record". Replaces `share-space-dialog.tsx`, `share-board-dialog.tsx`, `share-folder-dialog.tsx`, `components/sops/folder-manager.tsx`'s access panel, the Docs share modal and the Goals sharing panel.

```
Share "Website redesign"                                          [x]
[ Add people, teams, departments, or type an email  ] [Can edit v] [Add]

Everyone at Acme            [ No access v ]     <- EVERYONE row (Spaces, standalone Docs, Tables, Whiteboards, SOP folders, public channels)
Inherits from Space "Marketing"   (Restrict)    <- Folder, List, anchored objects; when restricted: "Restricted. Only people below."
Findable by everyone        [on]                <- Spaces and public channels only; hidden when toggle 3 is off or parent is not findable

People with access
  Anita Rao        Owner                       (Transfer)
  Dev Kumar        Can edit   v   x
  @design (team)   Can view   v   x   12 people
  Sales (dept)     Can view   v   x
  Priya Menon      Can edit   · from Space Marketing  -> link      <- inherited rows, read-only, grouped last
  Ravi (guest)     Can comment v  x   GUEST · expires 30 Nov

[Copy link]                    Check access ·  Open requests (1) ->
```

Behaviour:
- **Picker** searches the whole directory (name, avatar, department) for any Member with Full or Edit access, regardless of org-chart position, via `GET /api/people/pick?q=` (never scoped by report tree; fixes audit Broken #3). Teams, Departments, Role holders and Tags appear as rows with a member count; adding one creates one grant. Guests and read-only viewers get no picker.
- **Typing an email** not in the org offers "Invite as guest" (View, Comment, Edit) when `can(viewer, "invite_guest", object)`; "Invite as member" appears only for Owners/Admins, and only for in-domain addresses unless the inviter is Owner/Admin.
- **Role select** offers Can view, Can comment, Can edit, Full access with the four blurbs. Full access is absent for Guests and Agents. An EDIT holder under toggle 4 sees View, Comment, Edit. The menu never offers a level above the viewer's own.
- **Inherited rows** show role and "from {ancestor}" with a link; a direct grant for the same person shows "Effective: Can edit" (the max).
- **Owner row** pinned first, cannot be removed or demoted; "Transfer" (Full holders, confirm) makes someone else owner and leaves the previous owner at Full. An Admin who is not the owner transferring or deleting sees a confirm naming the displaced owner and an audit row is written (G10).
- **Last Full guard**: removing or demoting the last Full holder is refused ("Give someone else Full access first"). Self-removal allowed only if another Full holder remains; the confirm names them. An Owner/Admin bypass is logged.
- **Expiry**: a per-row "expires" date for Guest rows; default from the Guests and links card.
- **Read-only mode**: for VIEW, COMMENT and (without toggle 4) EDIT viewers the same dialog opens as "Who has access" with no controls and one line "Ask Anita Rao to change access" with Request. Guests see themselves, the owner and "Shared with you".
- **Check access** tab (Full holders and Admins): pick a person, see `explain()` as a short chain: "Can edit · shared directly on this List by Anita on 4 Sep. Also: Can view inherited from Space Marketing (open to everyone)." Also on a person's profile for Admins.
- Every change autosaves per row with an inline tick and an audit row. No Save button. Pickers are `position:absolute` children of the dialog (project rule), no portal.
- Every content header shows a real avatar stack (first five direct grants plus the owner) from `GET /api/access/grants?type=&id=`; the fake `OsTitleBar` avatars go. A lock glyph means Restricted; a globe means Everyone at {org}.

Every other sharing surface in the inventory (`access-model.md` §2.18) has one disposition:

| Surface today | Disposition |
|---|---|
| `NewSpaceDialog` "Make Private" + "Default permission" select | one line "Open to everyone at {org} as Can edit (change later in Share)" preselected from toggle 2; the select goes (settings spec §6.2) |
| `NewFolderDialog` "Make private", `NewBoardDialog` "Make Private", `CreateListModal` "Make private" | kept as one switch relabelled "Restricted: only people you add" with the Restricted blurb; writes `restricted = true` at creation (today `visibility: "PRIVATE"`). Nothing else changes at creation; sharing happens in the dialog afterwards |
| Space "…" menu "Make Private" / "Make workspace-visible" | deleted; the Everyone at {org} row in the share dialog (No access = private) is the one control |
| Space "…" menu "Hide from sidebar" (coming-soon toast) | deleted from the access surface; hiding is a personal sidebar preference and belongs to the settings spec (`sidebar.*` keys), never an access change |
| Space "…" menu "Sharing & Permissions" | opens the one dialog |
| `space-members-strip` "Manage" and the avatar stack | the stack is the real one above; Manage opens the one dialog (read-only mode for non-Full viewers) |
| `ShareSpaceDialog` Departments and Offices "Add all" | gone; a Department or Office is a picker row that writes one live group grant (§3.4) |
| `ShareSpaceDialog` Invite-by-email role select Guest/Member/Admin | Guest only for Members (invariant 17); "Invite as member" for Owners and Admins on in-domain addresses; Admin is never minted from a share dialog |
| `SpaceShareButton` rendered for every reader (`spaces/[slug]/page.tsx:612`) and the inline `isAdmin` at `:211` | the page calls `gatePage("view", space)` and renders from `useAccess().role`; the button becomes the role chip below FULL |

### 6.2 Members page (`/settings/members`, Owner and Admin; People team read plus the people-data fields)

Zoho card table, hairline rows, inline column filter. Tabs: **People**, **Guests**, **Teams**, **Pending invites**. The look, drawer, filter panel and pagination are the settings spec's (§5.5); this section fixes what the roles may do on it.

People columns: Person, Role, Agent, Job title, Department, Reports to, **People team**, Status, Last active, row menu. Team membership shows in the row drawer and on the Teams tab, not as a column.
- **Role** select: Owner (Owners only may set it), Admin, Member, Guest. To or from Owner, and self-demotion, open a confirm naming the remaining Owners; the last Owner cannot be demoted. Any change bumps the target's `tokenVersion` so it lands on the next request, not the next token refresh.
- **Agent** switch: rendered on Member rows only; also settable at invite time (§2.4).
- **Reports to**: directory picker with cycle detection; Agents excluded (§2.4). People team may write it (Membership P, §3.5).
- **People team**: checkbox writing toggle 6, as a column so "who is HR here" is answerable on the same page (G11).
- Row menu for Admins (Owner sees it): "Admin scopes: Billing, Security and integrations" (open decision D4).
- **Invite** (Owner/Admin, or any Member under `members_in_domain`, §2.8): email, role (Admin, Member, Guest; Admin offered to Owners and Admins only), Agent checkbox under Member, department, reports to, optional job title. Outside-domain email defaults the role to Guest. The KRA/SOP entry gate stays as an onboarding step after acceptance.
- Count strip: Owners N, Admins N, Members N, Guests N (free; "N of M guest seats" when the soft cap is set).
- Guests tab: Guest, Shared objects (count with popover), Added by, Last active, Expires, Promote to Member, Remove (with the §2.3 transfer of the Guest's own objects).
- Deactivate and Remove open the transfer dialog preselected to their manager, else the acting admin; the admin may pick anyone (invariant 13).
- Teams tab: create Team (name, `@alias`, lead, members), edit, delete; a Team row shows what it is shared on.
- Pending invites: resend, revoke, plus Role and "Invited to" columns.
- Data source is `GET /api/users?scope=all`, which is org-wide for anyone who can open this page (the silent team-scope downgrade at `api/users/route.ts:50-54` ends because the page is gated by role, not reachable by URL).

`/settings/hierarchy` redirects to `/settings/structure?tab=chart` (the org chart client with Edit reporting lines mode for Admins; `/organization` in Teams renders the same client). `/settings/structure` keeps Departments, Job titles, Offices and Org chart (settings spec §5.6); its hand-written ten-rung ladder prose is deleted and the four-role explainer with live head counts is card 1 of `/settings/access` (§6.5), linked from Structure. `/settings/permissions` redirects to `/settings/access`.

### 6.3 Per-object "Who has access"

The share dialog's list is the answer; there is no second surface (§6.1 covers read-only mode, Check access and Open requests).

### 6.4 Denial views

`LockedPage`, `ModuleOff`, `AppOff`, the settings `AdminOnly` card and the settings Ask-an-admin strip are one component family in `src/components/access/`, each with `BackButton{fallbackHref}` (the strip sits above My settings › Profile and needs none). The `(admin)/layout.tsx` inline lime "Restricted" page is replaced by the same family on the admin host. Which variant a settings URL shows is fixed by rule 14 and §5.5 item 3.

### 6.5 Access settings page (`/settings/access`, Owner and Admin; People team read)

Replaces `/settings/permissions`. Three cards:
1. **How access works**: the §13 explainer as prose, with live counts (Owners, Admins, Members, Guests, People team) and links to Members.
2. **Access** (§8 toggles 1 to 8): autosaving switches and selects with an inline tick; a one-line effect under each; an "Enforced at: {route}" tooltip on every row; a "Lock it down" button (§7.4).
3. **Guests and links** (§8 rows 9 and 10).

Nothing else. Security policy is its own Owner page (§7.5).

### 6.6 Settings pages and who opens them

Every settings route is `{ type: "settings", page }` with a fixed rule in `SETTINGS_PAGE_GATES` (`src/lib/access/settings.ts`, keyed by `SettingsPageKey` from `src/lib/settings/pages.ts`, §5.1). The settings spec (two doors: My settings `/account/*`, Workspace settings `/settings/*`) decides grouping, tabs and look; the gate is by page key and cannot drift from the nav because the nav is built from the same table. The page keys are the settings spec's, listed here so the gate names nothing the nav lacks:

| Gate | Page keys (route) |
|---|---|
| Owner, or Admin with the named scope | `billing` (`/settings/billing`; `billing` scope). `security` (`/settings/security`, tabs Sign-in policy, Single sign-on, Provisioning (SCIM); `security` scope; §7.5). `api` (`/settings/api`, tabs API keys, Webhooks, AI keys; `security` scope). Owner only, no scope: Identity › Danger zone (transfer ownership, delete workspace) and Data › Retention purge. |
| Owner and Admin | `overview` (`/settings`), `identity` (`/settings/identity`: Profile, Culture, Appearance defaults, Danger zone), `locale`, `apps` (`/settings/apps`: Modules, Rail apps, Automations), `members`, `structure` (Departments, Job titles, Offices, Org chart), `access`, `tasks` (`/settings/tasks`: Task types, Tags, Templates; today `/api/item-types` is ungated, audit settings #2), `data` (`/settings/data`: Export, Import, Retention and privacy, Trash), `audit`, `scoring` |
| plus People team read (`peopleTeamRead: true`) | `members`, `structure`, `access`, `scoring`; on Structure › Job titles and in the Members drawer the People team edits the §3.5 Membership (P) fields |
| Everyone (Personal, `/account/*`) | `account/profile`, `account/preferences` (Appearance, Language and region, Sidebar), `account/notifications`, `account/security` (own password, MFA, sessions, presence; the org policy as a read-only card with "Edit in Workspace settings › Security" for Owners and `security`-scope Admins), `account/connections` (calendar), `account/shortcuts` |

Retired keys and where they go (308 redirects for one release): `modules` → `apps#modules`; `tags`, `task-types` → `tasks`; `defaults` → `identity?tab=appearance`; `import-export` → `data?tab=import`; `calendar` → `account/connections`; `integrations` → `api` (the `/integrations` marketplace is an AI-hub page, §5.2.1); `notifications` (org defaults) → retired, personal notifications at `account/notifications`; `permissions` → `access`; `hierarchy` → `structure?tab=chart`; `account/appearance` → `account/preferences?tab=appearance`. SSO and SCIM live on `security`, not on `identity`.

Every org write API names its page: `PATCH /api/settings`, `PATCH /api/org/preferences`, `/api/keys`, `/api/scim-tokens`, `/api/products/installations`, `/api/item-types*`, `/api/tags*`, `/api/offices*`, `/api/webhooks`, `/api/audit-log/export`, `/api/billing/*` call `requireCan("manage", { type: "settings", page })`. C_LEVEL's stray ability to PATCH `/api/settings` (`settings/route.ts:123`, `locale/page.tsx:68`) ends because C_LEVEL no longer exists. `/api/audit` moves from `isManager` to the page's rule.

---

## 7. Org-level configuration

### 7.1 Apps (`/settings/apps`), kept and now enforced

Order, hide, floor. Floor options: Everyone · Members with reports · Admins. A hidden app or a floor is enforced by rule 2, so a hidden app's routes lock, not just its icon. The page lists rail hubs only; folded apps are sub-rows under their hub (G11). `alwaysPinned` stays for Work and Settings.

### 7.2 Modules (`/settings/apps#modules`), kept

Talk and Tables, as the Modules section of the Apps page (`/settings/modules` redirects). Rule 2. The off switch gains: "Turning this off locks N channels / N tables for everyone until it is turned on again. Nothing is deleted." The same switch renders on `<ModuleOff>` for Owners and Admins (example K).

### 7.3 Access toggles

See §8.

### 7.4 Lock it down (G9)

One button on `/settings/access` with a confirm listing exactly what changes: toggle 2 to Private, toggle 3 off, toggle 5 to Admins only, toggle 7 to Admins and People team, toggle 8 to Admins only, public links off, guest expiry 30 days. Reversible row by row. Writes one `access.preset.lockdown` audit row.

### 7.5 Security policy (`/settings/security` › Sign-in policy; Owner or `security` scope)

What the code does today, so nothing here is described as already wired: only `src/lib/password-policy.ts` reads `Organization.settings.security` (min length, uppercase, numbers, at signup, invite accept and reset). `src/lib/auth.ts` hard-codes `maxAge: 12h` and `updateAge: 30m` (`:259-266`) and gates MFA on `process.env.ENFORCE_MFA_AT_LOGIN` plus the user's own `mfaEnabled` (`:125`). `src/lib/login-throttle.ts` is an in-process `Map` keyed by `ip|email` with `MAX_FAILS = 8`, `WINDOW_MS` and `LOCK_MS` = 15 min, no org lookup. The stale `sessionTimeout: 30` display value on `/account/security` is read by nothing.

The editor writes `settings.security` (one zod section, `.strict()`), and each field names the new wiring that makes it true:

| Field | Default | Enforced by (new unless marked) |
|---|---|---|
| Minimum password length, require uppercase, require numbers | 8, on, on | `password-policy.ts` (exists), plus `POST /api/me/change-password` |
| Require symbol | off | `password-policy.ts` |
| Password max age (days, 0 = never) | 0 | `authorize()` sets `mustChangePassword` when `passwordChangedAt + maxAge < now`; the app routes to change-password |
| Idle session timeout (minutes) | 720 | `jwt` callback: on refresh, compare `lastActivityAt` in the token against the org value (cached in the token, re-read on `updateAge`); expired = sign out. `session.maxAge` becomes the absolute lifetime below |
| Absolute session lifetime (days) | 30 | `session.maxAge` from the org value, read once per sign-in |
| Require MFA for: Nobody · Admins · Everyone (Everyone includes Guests, §2.3) | Admins | `authorize()`: `ENFORCE_MFA_AT_LOGIN` stays the env floor; the org value is the audience; a person in the audience without MFA is routed to enrolment at next sign-in, not refused |
| Lock out after N failed attempts for N minutes | 8 / 15 (the code's values, so shipping the editor changes nothing) | `login-throttle.ts` gains `thresholdFor(orgId)`: `authorize()` resolves the org from the email once per attempt (a 60 s memo per email), passes `{ maxFails, lockMs }` to `recordLoginFailure`; the bucket stays keyed `ip|email`, so the lockout-DoS property holds; the store moves to Postgres (`LoginAttempt` table) when a second app instance exists, not before |
| Allowed sign-in domains | the org domain | read-only mirror of `settings.users.allowedDomains` with a link to Invite rules |
| Enforce SSO | off | `authorize()` refuses password sign-in for non-Owners when on (§2.7); hidden until SAML is verified end to end |
| Sign everyone out | | `POST /api/org/sign-out-everyone` bumps `tokenVersion` for every user; audit `security.sign_out_all` |

The read-only Workspace policy card on `/account/security` stays (rows: min length, MFA rule, idle timeout) and links to this page for Owners and `security`-scope Admins; it is not replaced. The two Settings overview cards that point at the personal page are repointed here. `settings.security.twoFactorEnabled: true` migrates on read to `mfaRequired: "everyone"`.

### 7.6 Settings page rules

See §6.6.

---

## 8. Org toggles and defaults for a new org

Stored in `Organization.settings.access` as one flat typed object validated by one zod schema (nothing silently stripped the way Inbox prefs are today).

| # | Toggle | Options | Default | Effect (enforced at) |
|---|---|---|---|---|
| 1 | Who can create Spaces and Teams | Everyone · Admins only | Everyone | `org.create_space`, `org.create_team`; Agents and Guests never (`POST /api/spaces`, `POST /api/teams`) |
| 2 | New Spaces start as | Open to everyone as Can edit · Open as Can view · Private | Open as Can edit | the EVERYONE grant written on Space creation; creator can change it in the dialog (`POST /api/spaces`) |
| 3 | Members can find Spaces they're not in and request access | On · Off | On | master switch for rule 14 and the default `findable` for new Spaces; Guests never (`gatePage`, `GET /api/access/peek`) |
| 4 | Editors can share | On · Off | On | `share` at EDIT (View, Comment, Edit only); off = Full holders only (`POST /api/access-grants`) |
| 5 | Who can invite Guests | Anyone with Full access · Admins only · Nobody | Anyone with Full access | `invite_guest`; Nobody hides the email path (`POST /api/invitations`, Space invite route) |
| 6 | People team | Pick people and/or a department | Empty | rule 9 People team on people data; Policies, Contracts, Reviews, Surveys, Assets org-wide (`can(person)`, review and policy routes) |
| 7 | Who can publish SOPs and Policies | Editors · Admins and People team only | Editors | `publish` (SOP and Policy status PATCH) |
| 8 | Who can delete Spaces, Folders, Lists, Docs, Tables | Full access holders · Admins only | Full access holders | `delete` on containers; Items follow the List rule (container DELETE routes) |
| 9 | Guest access expires after | Never · 30 · 90 days | Never | default `expiresAt` on Guest grants; the dialog can set per row (`grants.ts`) |
| 10 | Public links ("anyone with the link") | Off · View only | Off | reserves the public-share primitive; `SOP.shareToken` and `DataTable.isPublic` fold under it later; never exceeds VIEW, revocable from the dialog, logged on use |

Defaults for a fresh org, together: the creator is Owner; every in-domain invite is a Member; Spaces are open to everyone as Can edit and findable; anyone can create a Space; editors can share; anyone with Full access can bring a client in as a Guest; no People team until someone is picked; editors publish; Full holders delete; guest access never expires; public links off. A three-person company never opens `/settings/access`. A 400-person company flips 1, 2, 5 and 7, picks a People team and is done. A 1,500-seat security lead clicks Lock it down.

---

## 9. Disposition of the permission matrix

`src/lib/permissions.ts` (16 modules, 79 cells, stored in `Organization.settings.permissions`, edited at `/settings/permissions`) is deleted in full: `checkPermission`, `hasPermission`, `requirePermission`, `getEffectivePermissions`, `use-permission.ts`, `/api/permissions`, `PROTECTED_ADMIN_ROLES`, `DEFAULT_PERMISSIONS`, the page. Each org's stored matrix is exported into one `access.matrix_retired` ActivityLog row before the column is dropped. "Gate rule" = fixed rule inside `can()`; "toggle N" = §8; "deleted" = the ladder covers it or the feature is off the rail.

| Module | Action | Enforced today? | Disposition (enforced at) |
|---|---|---|---|
| people | view | no | Gate rule: `person_card` VIEW for every Member; never Guests (`GET /api/people/pick`, `/people`) |
| people | create | yes (invitations POST, `hasPermission`) | Gate rule: `org.invite_member` = Owner/Admin, or any Member for in-domain addresses under `settings.users.whoCanInviteMembers` (§2.8); `invite_guest` = Full holder, toggle 5 (`POST /api/invitations`) |
| people | edit | no | Gate rule: the §3.5 field table (Personal = self and Admin; Membership P = People team and Admin; Membership A and Role = Owner/Admin with Owner guards); people data EDIT = self (self-service), manager chain, People team; FULL = Admin (`PATCH /api/users/[id]`, per-field whitelist) |
| people | delete | no | Gate rule: Owner/Admin only; today `DELETE /api/users/[id]` is `isManager`, a bug (`DELETE /api/users/[id]`) |
| people | bulkActions | no | Gate rule: as edit, scoped by `accessibleIds(person)` (bulk routes) |
| organization | view | no | Gate rule: org chart VIEW for every Member (`/organization`) |
| organization | edit | no | Settings rule: identity = Owner/Admin (`PATCH /api/settings`) |
| organization | manageDepartments | no | Gate rule: Owner/Admin (managers lose it) (`/api/departments*`) |
| organization | manageRoles | no | Gate rule: job titles = Owner/Admin + People team (`/api/roles*`) |
| organization | manageOffices | no | Gate rule: Owner/Admin (`/api/offices*`) |
| kras | view | no | Gate rule: KRA definitions VIEW for every Member (`GET /api/kras`) |
| kras | create / edit / delete | yes | Gate rule: Owner/Admin + People team EDIT; delete Admin (`/api/kras*`) |
| kras | assign | yes | Gate rule: EDIT on the target person (`/api/kra-assignments`) |
| kras | recordKpi | no | Gate rule: self on own KPIs; EDIT on the person for manager records (`POST /api/kpi-records`) |
| kras | aiGenerate | no | Deleted as a permission; follows kras.create |
| sops | view | no | Object ladder: SOP folder VIEW; unfoldered published = EVERYONE (`sopVisibilityWhere` wrapper then `accessibleIds`) |
| sops | create / edit | yes | Object ladder: EDIT on the SOP folder; unfoldered = any Member, creator FULL (`POST/PATCH /api/sops*`) |
| sops | publish | yes | Toggle 7 (`PATCH /api/sops/[id]` status) |
| sops | delete | yes | Object ladder: FULL on the folder or author, toggle 8 (`DELETE /api/sops/[id]`) |
| sops | assign | no | Gate rule: EDIT on the target person (`/api/sop-assignments`) |
| sops | aiGenerate | no | Deleted; follows sops.create |
| reviews | view | no | Gate rule: subject self; manager chain; People team; Admin (review GETs) |
| reviews | create / launch / finalize | no | Gate rule: manager chain for their chain; People team and Admin org-wide (`/api/reviews*`, manager-review routes) |
| reviews | delete | no | Gate rule: Admin (cycle DELETE) |
| okrs | view | no | Gate rule: goal audience (`canSeeGoal` folded into the goal branch), COMPANY = everyone (`GET /api/okrs`) |
| okrs | create / edit | no | Gate rule: any Member creates own goals; manager chain, People team, Admin create for others; owner EDIT (`/api/okrs*`) |
| okrs | delete | no | Gate rule: owner or Admin (`DELETE /api/okrs/[id]`) |
| okrs | checkIn | no | Gate rule: owner and audience (check-in POST) |
| tasks | view / create / edit | no (Items use board.ts) | Object ladder on List and Item; assignee rule (`/api/boards/[id]/items`, `/api/items/[id]`) |
| tasks | delete | no | Object ladder: EDIT on the List deletes own-created tasks; FULL deletes any; Agents never (`DELETE /api/items/[id]`) |
| tasks | assignToOthers | no | Gate rule: EDIT on the List may assign to anyone with a role on the List (items PATCH) |
| meetings | view / create / edit / delete | no | Deleted. Orphan route; if revived it is a List item type |
| policies | view | no | Gate rule: published and assigned = VIEW/COMMENT; org-wide published = EVERYONE VIEW; Admin + People team FULL (`GET /api/policies`) |
| policies | create | yes | Gate rule: Admin + People team (`POST /api/policies`) |
| policies | edit / delete | no | Gate rule: Admin + People team; delete Admin (`/api/policies/[id]`) |
| policies | publish | no | Toggle 7 (publish route) |
| announcements | view | no | Gate rule: every Member; Guests never (`GET /api/announcements`) |
| announcements | create | yes | Gate rule: Admin + People team; FULL on a Space for Space-scoped (`POST /api/announcements`) |
| announcements | edit / delete | no | Gate rule: author or Admin |
| assets | view | no | Gate rule: Admin + People team org-wide; manager chain for their people (`GET /api/assets`). The Teams-hub Resourcing row follows this rule (§5.2.1), not "Admin + People team" alone |
| assets | viewOwn | no | Gate rule: self (`GET /api/assets?mine=1`) |
| assets | create / edit / delete | yes | Gate rule: Admin + People team; delete Admin (`/api/assets*`) |
| assets | assign | no | Gate rule: EDIT on the target person (assign route) |
| surveys | view | no | Gate rule: targeted respondents; Admin + People team all (`GET /api/surveys`) |
| surveys | create | no | Gate rule: Admin + People team (`POST /api/surveys`) |
| surveys | respond | no | Gate rule: targeted respondent (response POST) |
| surveys | viewResults | no | Gate rule: creator, Admin, People team (results GET) |
| ideas | view / submit / review / delete | no | Deleted. Off the rail; revive as a List |
| analytics | view | no (manager page gate) | Gate rule: anyone with reports (their chain), People team and Admin (`/analytics`, `/api/analytics*`) |
| analytics | viewOrgWide | no | Gate rule: People team and Admin |
| analytics | export | no | Gate rule: `export`; Guests, Agents and acting-as never; Admin for org-wide (export routes) |
| tools | view | no | Gate rule: every Member sees tools shared with them (`accessibleIds(viewer, "tool", VIEW)`); Admin all (`GET /api/tools`). The Teams-hub Resourcing row renders for every Member (§5.2.1) |
| tools | create / edit / delete / share | no | Object ladder on `{ type: "tool" }` (`GrantObject.TOOL`); creator FULL; Admin FULL; `share` through the one dialog (`/api/tools*`) |
| settings | viewGeneral / editGeneral | no | Settings page rule §6.6 (`settings/layout.tsx`, `PATCH /api/settings`) |
| settings | manageBilling | no | Settings page rule: Owner or `billing` scope (`/settings/billing`, `/api/billing*`) |
| settings | manageIntegrations | no | Settings page rule: Owner or `security` scope for API keys, webhooks and SCIM (`/api/keys*`, `/api/webhooks*`, `/api/scim-tokens*`); Owner/Admin to connect or install an integration or Marketplace app (`POST /api/integrations/*`, `/api/products/installations`); browsing `/integrations` and `/store` is every Member (§5.2.1) |
| settings | manageAccessControl | no (page gated by `PROTECTED_ADMIN_ROLES`) | Settings page rule: Owner/Admin on `/settings/access` and Members; Owner role only by Owners (`PATCH /api/users/[id]`, `PATCH /api/settings` access section) |

Count: 79 cells. 14 are enforced today, at 20 call sites (18 `requirePermission` calls plus two `hasPermission` calls in `POST /api/invitations`), and become gate rules at the same call sites. The 14, named so the settings spec's transitional Legacy grid and the golden suite list the same cells: `people.create`; `kras.create`, `kras.edit`, `kras.delete` (each also called from `/api/kpis` and `/api/kras/orphans`), `kras.assign`; `sops.create` (also `/api/sops/record`), `sops.edit`, `sops.publish`, `sops.delete`; `policies.create`; `announcements.create`; `assets.create`, `assets.edit` (the dynamic `action` in `/api/assets/[id]` resolves to edit), `assets.delete`. 8 deleted outright (meetings x4, ideas x4). 57 become gate rules or ladder checks with a named call site. Zero remain as configurable cells. What an admin loses: giving C-Level "Manage integrations" but not "Manage billing". What they gain: every switch they see does something.

---

## 10. Migration order

Ordered so the product works after every step, pages and APIs never disagree during the transition, and no user data is lost. Local DB is Neon, prod is aaPanel Postgres, `migrate dev` is broken by drift, so every schema step ships as an idempotent SQL file applied with `prisma db execute` plus a `prisma db pull` check. Never run a second dev server or `next build` while the founder's `pnpm dev` is live.

**Step 0: engine over the old tables, golden tests, mirrors, lint.**
`src/lib/access/` with `decide()`, `loadFacts()`, `can()`, `accessibleIds()`, `accessibleUsers()`, `explain()`, `requireCan()`, `gatePage()`, `useAccess()`, `useViewer()`. `loadFacts` reads today's schema: `User.accessLevel` through `orgRoleOf()` (§2.1 table), member tables through the §3.1 mapping, `Visibility` to EVERYONE and `restricted`, `HRSegment` ignored, People team = users at HR until toggle 6 exists. `resolve.test.ts` encodes every row of audit table 1.6, worked examples A to K, the §3.5 field table, the §5.2.1 app table and every §11 invariant as `AccessFacts` fixtures. JWT gains `orgRole`, `isAgent`, `adminScopes` computed from `accessLevel`; `accessLevel` stays in the token and on the User row as a written mirror for two releases (derived from `orgRole + isAgent` on every role change). ESLint rule (G7): no `accessLevel` reads, no `isManager/isOrgAdmin/hasRole`, no `SpaceMember/FolderMember/BoardMember/SOPFolderAccess/AccessGrant` imports outside `src/lib/access/`; legacy files are allow-listed until deleted. `enforcement.ts` and its completeness test.

**Step 1: the pivot PR (G1).** With zero call-site edits, turn these into one-line delegates over `can()` / `accessibleIds()`: `resolveAccess`, `requireAccess`, `canRead`, `canEdit`, `getBoardForReader`, `canEditBoard`, `canContributeBoard`, `canReadBoard`, `getSpaceForReader`, `canEditSpace`, `canContributeSpace`, `visibleSpaceIds` (returns `readable` only), `listSpacesForUser`, `folderReadable`, `folderVisibleTo`, `folderAccessForSpace`, `accessibleFolderIds`, `docAccessible`, `sopVisibilityWhere`, `canWriteToFolder`, `canTouchUserAlignment`, `visibleAlignmentUserIds`, `canEditOkrOwner`, `canDeleteGoal`, `canSeeGoal`, `isManager` (= hasReports or peopleTeam or Admin), `isOrgAdmin`, `hasRole`, `hasPermission`, `requirePermission`, `checkPermission`, `canAccessTier`, `requireManagerPage`, `requireHrAdminPage`, `requireManagerOrRedirect`, `requireOrgAdminOrRedirect`, `getSessionAndModule`, `useRole()`. Pages and APIs agree by construction the day it lands (audit Broken #1 and #2 close). Merge only with the golden suite and the existing 602 vitest tests green. The only behaviour changes are the disagreements the audit already called bugs.

**Step 2: parity job (G6).** `scripts/access-audit.ts` runs nightly in staging and prod with `ACCESS_V2_TABLES` off: for a sample of (user, object) pairs it diffs the pre-pivot legacy answer (kept in `legacy-resolver.ts` for this purpose) against `can()` and writes a report. Zero unexpected mismatches for a week is the criterion for step 4's flip. Expected mismatches are the 1.6 rows plus the decisions this spec makes on purpose, listed by name: D15 (`create_child` on a Space or Folder at EDIT, today `canEditSpace`), Trash for every Member over their own objects (today `isManager`), `DELETE /api/users/[id]` to Owner/Admin (today `isManager`), Rollup for anyone with reports (today `DIRECTOR_LEVELS`), manager-review routes for the manager chain and People team (today inline `ORG_ADMIN_LEVELS`), the Space-owner pierce of Restricted Lists (D7, covered by G5 rows), and Membership (P) fields no longer writable by the manager chain (§3.5).

**Step 3: gates, denial, read-only, pickers.** `gatePage` on the 14 ungated settings pages, the 11 ungated app pages (trash, kudos, surveys, candor, announcements, policies, agreements, tools, assets, talent, analytics), each against its §5.2.1 row, the Talk and Tables layouts (module check moves inside rule 2), the `(admin)` layout. One `settings/layout.tsx`; delete the six per-page gates. Delete the four redirect targets. `LockedPage`, `ModuleOff`, `AppOff`, `AdminOnly`, the 403 toast, `<AccessProvider>`, `useAccess()`. `GET /api/people/pick`, `POST /api/access/check`, `GET /api/access/peek`, `AccessRequest` table and inbox rows (this is the one schema item pulled forward; it is additive). `/api/users/[id]` role changes gain the Owner guards, a role whitelist and the `tokenVersion` bump (fixes Broken #4).

**Step 4: schema and backfill, flag-gated.** One idempotent SQL file in a transaction: enums, `AccessGrant`, `Team`, `TeamMember`, `User.orgRole/isAgent/adminScopes`, `Invitation.orgRole`, `restricted` and `findable` columns, `ActivityLog.actorType/actingForId`, `settings.access` defaults. Backfill script per org, in a transaction per org:
1. Pre-flight report (G11): per org, the chosen Owner (earliest `COMPANY_ADMIN`), every `SUPER_ADMIN`, every C_LEVEL/VP/DIRECTOR whose report tree is not the whole org, every MANAGER/TEAM_LEAD with zero reports, every ADMIN-scope API key whose creator would not be Owner/Admin. The founder approves before the write.
2. `orgRole`, `isAgent` from `accessLevel`; People team seeded with HR users.
3. `AccessGrant` rows: `SOPFolderAccess` (mapped); EVERYONE from `Space.visibility = ORG` (role from `settings.defaultPermission`) and `Board.visibility = ORG` (VIEW); `restricted` from PRIVATE Folders and Boards; `findable = (visibility === ORG)` on Spaces (conservative; toggle 3 default applies to new Spaces); `Space/Folder/Board.ownerId` from the OWNER member row where null.
4. Reach preservation (G5): explicit FULL for the Space owner on every PRIVATE Board; EVERYONE VIEW on every org-visible standalone Doc; EVERYONE EDIT on org-wide Whiteboards and unscoped Tables.
5. Row-count assertions: grants written = rows read; every org has one or more Owners; no user without `orgRole`; report diff archived as an `access.migrated` ActivityLog row.
Container user rows stay in `SpaceMember`/`FolderMember`/`BoardMember`. `ACCESS_V2_TABLES=true` switches the loader to union `AccessGrant` with the mapped member tables and to read `orgRole` instead of `accessLevel`; it can be turned off in seconds. Flip only after step 2's criterion is met.

**Step 5: UI on the new model.** The share dialog (delete the three dialogs, the SOP access panel, the Docs share modal, the Goals sharing panel, the create-time switches relabelled per §6.1), Members page with Guests and Teams tabs and the People team column, the Agent checkbox in the invite modal, `/settings/access` with Lock it down and Enforced-at tooltips, `/settings/security` (Sign-in policy with the §7.5 wiring, SSO, SCIM), Guest invitation flow (Space email invites mint Guests; in-flight `Invitation` rows with `spaceId` accept as Member if in-domain else Guest), org chart edit mode on `/settings/structure?tab=chart` (redirect `/settings/hierarchy`), Check access, real avatar stacks, deactivation and Guest removal transfer owned objects to the manager, else the acting admin (the first Owner on automated paths) with an audit row, signed file URLs only after `can(view, file)`. Delete the ladder prose on `/settings/structure`; rewrite the roles empty state, the tour, the welcome email, the documentation.ai pages (publish via subagent, nav last) and the marketing `/features/access` page (drop the violet gradient, describe four roles).

**Step 6: call-site cleanup to zero.** Replace the wrappers' 220 API sites, 122 legacy-gate files and 16 `useRole()` files with direct `requireCan`/`gatePage`/`accessibleIds`/`useAccess` calls in batches by area (Work OS, People and alignment, Knowledge, Settings, Admin and platform, Nav), each batch behind the golden tests. `rail-apps.ts` and every hub sidebar through `visibleApps`; command palette and More launcher through the same; delete `AppEntry.requiredAccess`. Exit criterion: the ESLint allow-list is empty.

**Step 7: container rows and goals into `AccessGrant`.** Migrate `SpaceMember`/`FolderMember`/`BoardMember` user rows and `GoalAssignee` rows into `AccessGrant` with row-count assertions; `grants.ts` becomes the only writer; the loader stops reading the old tables. Old tables untouched for one release.

**Step 8: delete.** `src/lib/access.ts`, `legacy-resolver.ts`, `access-levels.ts`, `permissions.ts`, `role-defaults.ts`'s `tierIdsFor` (starter KRAs pick by hasReports), `page-gates.ts`, `route-guard.ts`, `alignment-scope.ts`, `hr-segment.ts`, `sop-access.ts`, `doc-access.ts`, the gate halves of `space.ts`/`board.ts`/`folder.ts`, `access-tiers.ts`, `use-role.ts`, `use-permission.ts`, `/api/permissions`, `/api/me/access`, `/settings/permissions`, `/settings/hierarchy` (redirects stay one release), the three share dialogs, every hand-copied tier Set. Drop columns `User.accessLevel`, `Invitation.accessLevel`, `Role.level`, `Space/Folder/Board.visibility`; tables `SpaceMember`, `FolderMember`, `BoardMember`, `SOPFolderAccess`, `HRSegment`, `GoalAssignee`; enums `AccessLevel`, `SpaceRole`, `SOPFolderRole`, `Visibility`; strip `settings.permissions` after the `access.matrix_retired` export. Remove `accessLevel` from the JWT. Assert `grep -rn accessLevel src` returns zero.

### 10.1 What breaks and how it is handled

| Break | Handling |
|---|---|
| Sessions issued before step 0 lack `orgRole` | Token refresh (`auth.ts:337-368`) re-reads the user; `viewerFromSession` falls back to `orgRoleOf(accessLevel)` until step 8. A one-time org-wide `tokenVersion` bump at step 4 forces refresh. |
| C_LEVEL/VP/DIRECTOR lose org-wide people data unless at the top of the chart | Pre-flight report; founder decides per person: Admin, People team, or narrower scope. Default: People team (D6). |
| MANAGER/TEAM_LEAD with zero reports lose the Teams hub | Same report; usually the chart is wrong and the fix is `reportsTo`. |
| Managers who could create departments, offices, users and delete users | Intended; release note. |
| API keys with ADMIN scope whose creator is no longer Owner/Admin | Downgraded to EDIT cap on the next request; owner notified; listed in the pre-flight report. |
| Space owner piercing PRIVATE boards | Explicit FULL grants (G5); visible in the dialog; release note (D7). |
| `Role.level` in roles-page chips and `LEVEL_RANK` | chips read `seniority`; no access meaning. |
| Orgs with a customised matrix | Nothing to map; `access.matrix_retired` row plus a one-time "previous permission matrix.json" download on `/settings/data`. |
| `useRole().isAdmin` true for C_LEVEL and HR on the client | wrapper computes from `orgRole` in step 1; C-level loses the accidental `/api/settings` PATCH, which is the fix. |
| Bookmarks to `/settings/permissions`, `/settings/hierarchy` | Redirects to `/settings/access` and `/settings/structure?tab=chart` for one release. |
| Members with Can edit on a Space can now create Lists and Folders in it (D15) | Intended (content, not management); release note; the Space owner who wants to stop it drops the Everyone row to Can comment or Can view. |
| Members see Trash for their own objects; managers lose the org trash | Intended; Owners and Admins keep the org view and purge. |
| Managers in the reporting line lose the write on department, job title, office and reports-to | Intended (§3.5 Membership P is People team and Admin); the manager asks the People team or an Admin; release note. |
| Old GUEST-role member rows held by internal people | They are simply Can view; only accounts whose `orgRole` is GUEST get the Guest caps, and none exist before step 5. |

---

## 11. Security invariants (each has a golden test in `resolve.test.ts`)

1. **Org scoping first.** Rule 1 runs before any other; cross-org ids are 404 with a body identical to a real 404, never 403, never discoverable.
2. **Full-read sets never widen by lower grants.** `accessibleIds(viewer, "space", VIEW).readable` contains only Spaces with a Space-level source; container labels come from `containerOnly`, which content endpoints cannot consume. The `visibleSpaceIds` leak trap (`space.ts:165-171`) is enforced by the return type.
3. **Guests never see the directory.** `person_card` VIEW for a Guest is true only for users in `accessibleUsers()` of an object the Guest holds. `/api/people/pick`, `/api/users`, @mention, assignee pickers and Talk DM search all go through it. Guests never expand to EVERYONE and never get discoverability.
4. **Guests never hold Full access on anything they did not create, and never share.** Cap rule 12; the dialog and `grants.ts` both refuse.
5. **Assignment grants the row, not the List.** The assignee rule fires only on `item` refs; the List gets VIEW-for-context (name, statuses, fields) and stays locked.
6. **Restricted stops inheritance for everyone except the object owner and org Owners/Admins.** No Full-access ancestor pierces. A direct grant on a Restricted object still works.
7. **Notepads, DMs and private channels have no Admin read-around.** Rule 3 precedes rule 4. A compliance read is an explicit Owner-only export act that is logged.
8. **Module off means none, before Admin.** Rule 2 precedes rule 4; no route, cron, search, embed or bookmark can reach a Talk or Tables object while the module is off.
9. **Non-human principals never exceed the acting human.** `actingAs` cap is `min(actingFor's live level, cap)`; a revoked user's `tokenVersion` bump kills their keys and agent runs; every such write carries `actorType`.
10. **At least one Owner per org, always.** Transaction guard on `orgRole` updates and deletes; platform-staff reset path.
11. **Last Full holder guard on every object.** Refused unless an Owner/Admin does it, in which case it is logged with the displaced holder's name.
12. **Admin never silently owns.** Delete or transfer of an object the Admin does not own is a confirmed act with an audit row naming the owner.
13. **Deactivating or removing a person transfers their owned objects**, and no object is left ownerless: the transfer dialog preselects their manager, else the acting admin, and the admin may pick anyone; automated paths (SCIM deprovisioning, a cron) use their manager, else the first Owner. Removing a Guest transfers what the Guest created to the nearest container's owner, else the removing admin (§2.3). Every transfer writes one audit row naming the transferee.
14. **Reads never 403 about an object.** `requireCan` returns 404 for `!discoverable`; discoverability never confirms an object the viewer has no relationship to (needs a findable chain plus toggle 3 plus Member, or a descendant relationship). The rule-2 403s (`module_off`, `app_off`) are the one 403 class on a read and are about the module or app key, never the id: they are returned before the object row is loaded and have the same body for ids that do not exist (example K).
15. **Page and API agree.** Same function, same `ObjectRef`; the ESLint rule forbids member-table and `accessLevel` reads outside `src/lib/access/`.
16. **Every access change is audited**, and denials on discoverable objects are logged sampled per viewer per target per 10 minutes.
17. **Invitations are domain-locked.** An outside-domain email from a Member is always a Guest; only Owners/Admins invite outside the domain as Members.
18. **Signed file URLs are minted only after `can(viewer, "view", file)`**, never from list payloads.
19. **Public links are off by default and never exceed VIEW**; every public token is revocable from the dialog and logged on use.
20. **Grant expiry is honoured by the loader**, not by a cleanup job; an expired row contributes nothing.
21. **Nothing configurable is decorative.** Every `Action`, toggle and rule key appears in `ENFORCED_AT` and in at least one golden case; the test fails otherwise.
22. **SUPER_ADMIN never appears in any tenant UI or API input.** Platform staff are `PlatformAdmin` rows only.

---

## 12. Risks and how the design answers them

| Risk | Answer |
|---|---|
| Four roles are too coarse for a 400-person firm wanting a billing admin separate from a people admin. | Owner-only tier plus two delegable Admin scopes (Billing; Security and integrations). Workspace and People stay bundled in Admin on purpose. Revisit only if real customers ask (D4). |
| Executives lose org-wide people data when the org chart is incomplete. | Pre-flight report and People team as the default fix. The chart becomes load-bearing, which is what a PPMS wants. |
| The wrapper layer lingers and hides call sites that never migrated. | Step 6's exit criterion is an empty ESLint allow-list; the wrappers are `@deprecated` and CI-flagged. |
| Backfill double-counts or loses a row. | Row-count assertions, per-org transactions, the additive-first sequencing (container user rows move last), old tables untouched until step 8, env flag flips the read path back in seconds. |
| The flip changes an answer nobody predicted. | Nightly parity job with a week of zero unexpected mismatches before the flip. |
| Department, Team, Role and Tag grants change access with no visible event when a person moves. | Check access tab and an audit entry on department/team/role/tag change ("Dev moved to Sales: access changed on N objects"); goals already behave this way. |
| Findable Spaces leak names of private work. | Members only, never Guests; Spaces and public channels only; kind, name, icon, owner only; master switch; Lock it down turns it off; the backfill sets findable only where the Space was already ORG-visible. |
| Performance: CTE plus grants plus relationship checks per call. | One page load resolves once; list endpoints use `accessibleIds` (three queries); per-request memo on the Viewer; indexes on `AccessGrant(organizationId, subjectType, subjectId)` and `(objectType, objectId)`. Budget: under 20 ms of DB time per page at 5k grants. Next lever if needed: a 30 s per-user principal cache. |
| Talk private channels bend "Admin has Full on everything". | Stated on `/settings/access` and in the Admin channel list ("You can archive, not read"). |
| Space owners lose reach into Restricted Lists going forward. | Existing reach preserved by explicit rows; the new rule matches ClickUp private lists; release note (D7). |
| Read-only mode needs every mutation control behind `useAccess`. | Shared primitives (Button, MenuItem, create menus, `BoardItemDetail`, sheet grid, block editor, canvas) accept the provider's role; a page that forgets is caught by the coded 403 plus the denial log, reviewed weekly during rollout. |
| The exact-parity mandate (2026-06-05) versus the Zoho-clean frame. | Rows match ClickUp's modal; frame follows the founder's 2026-09-11 Zoho endorsement; screenshot to the founder before build (D9). |
| Dual-write window for `accessLevel`. | Two releases, ESLint forbids reads outside `src/lib/access/` from step 0. |
| Access requests flood owners of open Spaces. | Open containers never generate requests (everyone already has the default level); merge-duplicates and 14-day expiry bound the volume. |
| Team model adds a settings surface. | One tab on Members; Teams are also a rail-independent share target that `existing-direction.md` already lists as planned ("ad-hoc Teams with @alias"). |

---

## 13. How access works (help-center copy, one page, for a non-technical admin)

**Who's who in your workspace**

Everyone in WorkwrK is one of four things.

- **Owner**: the person who set the workspace up, and anyone they name. Owners handle billing, security settings and who else is an Owner. You need at least one.
- **Admin**: runs the workspace day to day. Admins can open every Space, invite people, change anyone's role except Owners, and use every Settings page except billing and security (an Owner can hand those two to a specific Admin).
- **Member**: everyone on your team. Members see the company directory, the Spaces they've been added to, and any Space that's been opened to the whole company. If someone reports to a Member, that Member can see and update their people information (goals, reviews, KPIs).
- **Guest**: someone outside your company, like a client or a contractor. Guests only see what you share with them. They don't see your directory or anything else, and they don't use a paid seat.

Two extras you might use:

- **Agent** is a switch on a Member for frontline staff (support, warehouse, field teams). They work like anyone else but can't create Spaces, delete things or export data.
- **People team** is a list of Members who look after everyone's people information, whatever their job title. That's usually HR. They can also open the Members, Structure, Access and Scoring pages in Settings to look things up and keep job titles, departments and reporting lines right, but they can't change roles or switches. Pick them under Settings, Access.

**How sharing works**

Everything you make (a Space, a Folder, a List, a Doc, a Table) can be shared. When you share, you pick one of four levels:

- **Full access**: can change settings, share with others, delete.
- **Can edit**: can add and change tasks, docs and rows.
- **Can comment**: can read and discuss, but not change.
- **Can view**: can read only.

Sharing flows downwards. Share a Space and everyone you added can use every Folder and List inside it. Share one List and they get just that List; they'll see the Space's name above it so they know where they are, and nothing else.

Adding someone never takes anything away from them. If they already have Can edit from the Space and you add them to a List as Can view, they still have Can edit. The share dialog tells you.

If you want a Folder or List to stop taking its access from the Space, turn on **Restricted** in its share dialog. Then only the people listed on it (plus Admins) can open it.

You can share with a person, a **Team** you've set up, a whole **Department**, everyone with a **job title**, or **Everyone at your company**. When people join or leave a department, their access follows automatically.

**Three things that just happen**

- If you assign someone a task, they can open and update that task even if they don't have the List.
- If someone reports to you (directly or further down), you can see and update their people information.
- If you created something, you have Full access to it.

**Finding things you don't have**

If a Space is set to "findable", people in your company who don't have access can see its name and ask for access. Whoever has Full access gets the request in their Inbox and can approve it in one click. You can turn this off for the whole company under Settings, Access.

**What a locked page looks like**

If you open something you can't use, you'll see the item's name, who owns it, and a Request access button. You'll never be bounced somewhere else, and you'll never see buttons you can't press: if you can only view something, the page simply shows it without the editing tools.

**The settings that matter**

Under Settings, Access there are ten switches. A small team never needs to touch them. The defaults are: anyone can create a Space, new Spaces are open to everyone at your company as Can edit, people can find Spaces they're not in and ask, editors can share, anyone with Full access can invite a Guest, and no one is on the People team yet. Larger companies usually set new Spaces to Private, limit Guest invites to Admins, and pick a People team. There's a **Lock it down** button that does the strict version in one click.

**Where to check "who can see this"**

Open any item's Share dialog. The list shows everyone with access and where it comes from ("from Space Marketing", "shared directly", "assigned to you"). Admins can also pick a person and see exactly why they can or can't open something.

---

## 14. Enforcement map: every existing gate and what replaces it

| Existing gate (file) | Used by | Step 1 wrapper | Final replacement |
|---|---|---|---|
| `resolveAccess`, `requireAccess`, `canRead`, `canEdit` (`src/lib/access.ts`) | 13 importers: `/boards/[slug]`, `/folders/[id]`, `/people/[id]`, `/team/*`, `/api/folders/[id]/members`, `/api/boards` create, `/api/me/access`, `automation/hub-access.ts` | maps `Decision.role` to `read/edit/admin/none` | `gatePage` / `requireCan` with the same `ObjectRef`; `/api/me/access` deleted in favour of `explain()` |
| `isOrgAdmin`, `isDirectorOrAbove`, `isManagerOrAbove` (`access.ts:68-80`) | inside access.ts | `viewer.orgRole` checks | deleted with the file |
| `getSpaceForReader` (`space.ts:194-204`) | 36 files | `can(viewer, "view", space)` | `requireCan("view", { type: "space" })` |
| `canEditSpace` (`space.ts:210-217`) | 23 files (members, invitations, PATCH space, folder create, boards create) | `can(viewer, "manage", space)` for members, invitations and PATCH space; `can(viewer, "create_child", space)` for `POST /api/boards:119` and `POST /api/folders:60` (D15; an expected step 2 mismatch) | `requireCan("manage", space)` and `requireCan("create_child", space or folder)` respectively |
| `canContributeSpace` (`space.ts:225-232`) | 3 files | `can(viewer, "edit", space)` | `requireCan("edit", space)` |
| `visibleSpaceIds` (`space.ts:156-186`) | 6 files (files, search, tables, whiteboards, entity-links) | `accessibleIds(viewer, "space", VIEW).readable` | same, named at the call site |
| `listSpacesForUser` (`space.ts:71-144`) | sidebar | `accessibleIds(...).readable ∪ containerOnly` typed | same |
| `addSpaceMember` / `removeSpaceMember` (`space.ts:424-436`) | share dialog API | routed through `grants.ts` with last-Full guard and audit | `grants.ts` only writer |
| `getBoardForReader` (`board.ts:605-665`) | 17 files (items, views, boards, docs) | `can(viewer, "view", list)` | `requireCan("view", { type: "list" })` |
| `canEditBoard` (`board.ts:672-705`) | 9 files | `can(viewer, "manage", list)` | `requireCan("manage", list)` |
| `canContributeBoard` (`board.ts:716-747`) | 3 files (items) | `can(viewer, "edit", list)` | `requireCan("edit", list)` or `requireCan("edit", item)` for the assignee path |
| `canReadBoard` (`board.ts`) | legacy | alias of the above | deleted |
| item owner short-circuit (`api/items/[id]/route.ts:27-31`) | items API | unchanged; expressed by rule 9 | `requireCan("edit", { type: "item" })` |
| `folderReadable` (`folder.ts:171-207`) | 3 files | `can(viewer, "view", folder)` | `requireCan("view", folder)` |
| `folderVisibleTo` (`folder.ts:21-29`) | 5 files (sidebar predicates) | `accessibleIds(viewer, "folder", VIEW)` | same |
| `folderAccessForSpace`, `accessibleFolderIds`, `spaceIdsWithFolderGrant` (`folder.ts:48-120`) | sidebar tree | `accessibleIds(viewer, "folder", VIEW)` with `containerOnly` | same |
| `updateFolder` (no `visibility` field, `folder.ts:360-386`) | folder PATCH | gains `restricted` | `restrict` action through `grants.ts` |
| `docAccessible` (`doc-access.ts`) | 21 files (docs list, GET/PUT/DELETE, search) | `can(viewer, "view", doc)` (anchor resolution moves into `loadFacts`) | `requireCan("view", { type: "doc" })`; NOTEPAD = rule 3 |
| `resolveDoc` admin read-around (`access.ts:242`) | pages | rule 3 wins (owner only) | deleted |
| `sopVisibilityWhere` (`sop-access.ts:40`) | 2 files | `accessibleIds(viewer, "sop_folder", VIEW)` where clause | same |
| `canWriteToFolder` (`sop-access.ts:80`) | 4 files | `can(viewer, "edit", sop_folder)` | `requireCan("edit", sop_folder)` |
| `SOPFolderAccess` management (`/api/sop-folders/[id]/access`, `isOrgAdmin`) | folder-manager | `requireCan("share", sop_folder)` (FULL holders, not only Admins; fixes Broken #21) | the one share dialog |
| `canTouchUserAlignment`, `visibleAlignmentUserIds`, `canEditOkrOwner`, `canDeleteGoal`, `isOrgWideAlignment` (`alignment-scope.ts`) | 11 files (users, KRAs, KPI records, weekly reviews, timesheets, goals) | `can(viewer, "edit", { type: "person" })`, `accessibleIds(viewer, "person", EDIT)` | same |
| `canSeeGoal` (`goal-audience.ts`) | 7 files | goal branch inside `decide()` (audience via `GoalAssignee` until step 7, then grants) | `requireCan("view", { type: "goal" })` |
| `hrCanReadUser` (`hr-segment.ts`) | `resolveUser` | ignored (dead code) | deleted; People team |
| `hasRole`, `isManager`, `isOrgAdmin` (`api-helpers.ts:56-77`) | 220 sites in 133 API files | `isManager` = hasReports or peopleTeam or Admin; `isOrgAdmin` = Owner or Admin; `@deprecated`, lint-flagged | replaced per site by `requireCan` on the real object |
| 23 inline `accessLevel ===` compares (e.g. `api/settings/route.ts:123`, `users/[id]/route.ts:146,170`) | scattered | rewritten to `viewer.orgRole` in step 1 | `requireCan` |
| `hasPermission`, `requirePermission`, `checkPermission`, `getOrgPermissionMatrix` (`api-helpers.ts:103-147`, `permissions.ts`) | 13 API files | wrapper maps the 18 live cells to gate rules (§9) | matrix deleted |
| `usePermissions` (`use-permission.ts`), `useRole` (`use-role.ts`) | 2 and 16 client files | booleans computed from `useViewer()` | `useAccess()` / `useViewer()` |
| `canAccessTier`, `MANAGER_LEVELS`, `HR_ADMIN_LEVELS`, `ORG_ADMIN_LEVELS` (`access-tiers.ts`) | `apps-catalog.tsx` (7 files) | `can(viewer, "view", { type: "app", key })` | `visibleApps`; file deleted |
| `canAccessApp`, `AppEntry.requiredAccess` (`apps-catalog.tsx:155`, entries at 1267 to 1410) | rail, sidebars, create actions | derived from the gate's app rule table | field deleted |
| `visibleRailApps`, `orgFloor` (`rail-apps.ts:134-179`) | rail, More launcher | `visibleApps` | same; floor enforced by rule 2 |
| `command-palette.tsx:235` raw `APPS` | palette | `visibleApps` | same |
| `requireManagerPage`, `requireHrAdminPage`, `requireGoalsPage`, `requireGoalPage` (`page-gates.ts`) | 8 + 2 + goals pages | `gatePage("view", { type: "app" or "goal" })` | file deleted |
| `requireManagerOrRedirect`, `requireOrgAdminOrRedirect` (`route-guard.ts`) | 7 + 8 files (talent, analytics, integrations, ai, process-runs, tools, assets; settings apps/audit/data/defaults/identity/tags) | `gatePage` | file deleted; settings gates fold into `settings/layout.tsx` |
| inline lock card (`settings/structure/page.tsx:60-78`), inline `canEdit` (`people/roles/[id]/page.tsx:35`) | two pages | `gatePage` + read-only mode | same |
| `settings-shell.tsx:27` Admin-door nav split | settings nav | built from `settings.ts` page table | same |
| `getSessionAndModule`, `isModuleActive` (`api-helpers.ts:25-42`, `entitlements.ts`) | 19 + 5 files, `/tlk` and `/tables` layouts | rule 2 inside `can()`; `getActiveModuleAppKeys` feeds `org.activeModules` | `requireCan` on the channel or table; `entitlements.ts` stays as the module fact source |
| `api-auth.ts:161` ADMIN scope gate | API key minting | unchanged for minting; `viewerFromApiKey` applies the acting-as cap at request time | same |
| `api/users/route.ts:50-54` team-scope downgrade | share pickers, Members page | `GET /api/people/pick` (whole directory, cards only) for pickers; `/api/users` scoped by `accessibleIds(person)` for full records | same |
| `api/spaces/[id]/invitations/route.ts:136,159` EMPLOYEE mint | Space email invite | mints `orgRole = GUEST` (Member only for Owner/Admin inviters, in-domain) | same |
| `ORG_WIDE_ALIGNMENT_LEVELS` (`alignment-scope.ts:16`), `tierIdsFor` (`role-defaults.ts:195`) | users API, starter KRAs | People team + Admin; starter tiers by hasReports | deleted |
| `PlatformAdmin` gate (`(admin)/layout.tsx`, `proxy.ts`) | staff back-office | unchanged | unchanged, plus "Set workspace Owner" |
| `resolveAutomationContext`, `canManageAutomations`, `AutomationRole` (`src/lib/automation/hub-access.ts:39-43`) | every `/api/automation/*` route | `role = "admin"` for Owner/Admin, `"manager"` for hasReports or People team, else `"member"` (no behaviour change) | `requireCan("view" / "edit" / "manage", { type: "automation", id })` per workflow and `requireCan("create_automation", org)`; `AutomationRole` deleted |
| inline `ORG_ADMIN_LEVELS` (`weekly-reviews/[id]/manager-review/route.ts:16`, `kpi-records/[id]/manager-review/route.ts:14`) | manager review approve and request-changes | `viewer.orgRole` check (no behaviour change) | `requireCan("edit", { type: "person", id: subjectId })` (manager chain, People team, Admin); an expected step 2 mismatch |
| `DIRECTOR_LEVELS` Rollup row (`apps-catalog.tsx:1061,1098`) and the `/team/rollup` page redirect to `/team/alignment` | Teams sidebar, rollup page | `can(viewer, "view", { type: "app", key: "rollup" })` | `visibleApps` row `rollup` (§5.2.1): anyone with reports over their chain, People team and Admins over the org; the redirect goes |
| inline `isAdmin` + `spaceMember` read (`spaces/[slug]/page.tsx:211`) and `SpaceShareButton` for every reader (`:612`) | Space page | `gatePage("view", space)` decision | `useAccess().role` drives the header (§6.1 table) |
| `isManager` on `/api/trash` and `/api/trash/[id]` | trash page, restore, purge | `accessibleIds(viewer, type, FULL)` per source for the list; `requireCan("manage", ref)` for restore; Owner/Admin for purge (an expected step 2 mismatch) | same; `trash` row in §5.2.1 |
| `isManager` on `POST /api/candor` and the manager-only list | Candor | anyone with reports for their chain; People team and Admin org-wide | `requireCan("manage", { type: "candor", id })` and `create_candor` on the org |
| `/api/scim/v2/Users` (schema-default `accessLevel`), `/api/scim/v2/Groups` (writes `departmentId`) | IdP provisioning | unchanged; the created user resolves as Member through `orgRoleOf` | §2.7: Member, `isAgent = false`, domain lock, `roles` attribute limited to admin or member, `active = false` runs the invariant-13 transfer with `actorType: "scim"` |
| Talk guest door (`/api/calls/guest-token`, `/meet/[code]`) | outside participants in a call or huddle | unchanged: a signed, expiring per-call code minted by a channel member yields a random LiveKit identity, never a `Viewer`, never a user row | stays outside `can()` on purpose: a call is not an object with a role and the guest holds nothing after it ends. Listed in `ENFORCED_AT` as `talk.call_link` (the code signature and the 24 h expiry are the enforcement). Not governed by toggle 10, which is about object share links; a later "Call links: Off" switch would be the eleventh toggle and needs a founder decision |

---

## 15. Audit findings, each answered

| Finding (`access-model.md` §3) | Answer |
|---|---|
| 1 Direct List share does not open the List | One gate for page and API; rule 6 on the List; container labels in the sidebar (§5.3). |
| 2 Page and data gates disagree | Step 1 wrappers make them the same function on day one; lint rule (§10, §11.15). |
| 3 Pickers truncated by report tree | `GET /api/people/pick`, whole directory for Members (§6.1). |
| 4 Admin can grant SUPER_ADMIN, self-demote silently | Four roles, Owner-only promotion, last-Owner guard, confirm naming remaining Owners, tokenVersion bump (§6.2). |
| 5 Rail tiers are not the permission | `visibleApps` and page gates share rule 2; hide and floor are enforced (§7.1). |
| 6 Space email invite mints an EMPLOYEE | Mints a Guest, domain-locked (§2.3). |
| 7 55 of 75 matrix cells enforce nothing | Matrix deleted; every cell mapped with its enforcement point (§9). |
| 8 Share dialogs have no read-only state | One dialog with a read-only mode (§6.1). |
| 9 Space "Default permission" is dead | Becomes the EVERYONE grant's role (§3.1, toggle 2). |
| 10 Folder visibility immutable | `restricted` toggle on every container, both directions (§3.3). |
| 11 Three role vocabularies plus SOP's fourth | One ladder, one dialog, one `labels.ts` (§3.1). |
| 12 WORKSPACE vs PRIVATE indistinguishable | Both become "no EVERYONE grant"; Restricted and Findable are the only words (§3.1). |
| 13 Space ADMIN can remove OWNER, no last-owner guard | `ownerId` is a property; last-Full guard; transfer flow; Admin bypass logged (§6.1). |
| 14 Admin-door pages not server-gated | One settings layout gate from the page table (§6.6). |
| 15 `useRole().isAdmin` includes C_LEVEL and HR | Hook deleted; `useViewer().orgRole` (§5.2). |
| 16 HR segments dead code | Deleted; People team (toggle 6). |
| 17 Security policy has no editor | `/settings/security` › Sign-in policy, Owner or `security` scope, with the auth wiring each field needs named (§7.5); the read-only card on `/account/security` stays and links to it. |
| 18 SSO/SCIM promised, no UI | `/settings/security` › Single sign-on and Provisioning (SCIM) tabs (§6.6); provisioned people are defined in §2.7. |
| 19 Access changes not audited | Invariant 16; `actorType` on every row. |
| 20 Job-title Role vs access Role | `Role.level` becomes display-only `seniority` (§2.1). |
| 21 SOP folder OWNER cannot manage access | FULL on the SOP folder shares through the one dialog (§14). |
| 22 Permission cache never invalidated | No client matrix; `useAccess` comes from the server decision; batched check cache invalidates on `workwrk:prefs-changed` (§5.2). |
| 23 Three published access-level lists | One `OrgRole` enum with four labels in `labels.ts`. |
| 24 Two redirect conventions | One convention, no redirects on denial (§5.5). |
| 25 to 30 (settings self-links, offRail rows on Apps, audit double header, admin styling, marketing violet, `/api/me/access` drift) | Apps page lists hubs with folded sub-rows (§7.1); `/api/me/access` deleted; marketing rewritten (§10 step 5); the others belong to the settings and design specs. |
| 31 Reports-to cycles | Cycle check in the Members picker (§6.2). |
| 32 Notepad admin read-around disagreement | Rule 3 before rule 4; owner-only (§4). |
| critic #7: Space default permission, rail hide/floor, security policy editor, matrix cells, dirty state | Enforced (§3.1, §7.1, §7.5, §9); `/settings/access` autosaves per row so there is no dirty state to lose; `settings.access` is zod-typed from day one. Inbox prefs, presence, mute, pins, sidebar width, capacity and saved filters are preferences and belong to the settings spec, which must follow the same one-typed-schema-per-section rule. |

---

## 16. Open decisions for the founder (with recommendations)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | What a new Space starts as | Open to everyone as Can edit (Simple ladder) · Private but findable (Sharing first) | Open as Can edit. A three-person company should never have to share anything. The onboarding wizard asks one question ("Is your work open by default?") and Lock it down flips it for corporates. |
| D2 | Findable Spaces on by default for Members | On · Off | On. It exposes kind, name, icon and owner name only, never for Guests, and the master switch is one click. Without it a new hire cannot ask for anything. |
| D3 | Who may invite Members | Owners and Admins only · Any Member within the company domain | Owners and Admins only as the default of `settings.users.whoCanInviteMembers` on the Members page's Invite rules card (§2.8); the alternative is the second option of that one setting, not an access toggle. Members cost seats; Guests are free and any Full holder can bring one in under toggle 5. Revisit if onboarding friction shows up in a 20-person pilot. |
| D4 | Admin separation of duties | None (Owner holds billing and security) · Two delegable scopes per Admin (Billing; Security and integrations) · Four scopes incl. People and Workspace | Ship the two scopes, shown only inside the Admin row's menu with the default off. A 300-person firm gets a billing admin without a role editor; a 20-person firm never sees it. |
| D5 | Guest ceiling | Can edit everywhere · Can manage on Lists and Folders (a client runs their own List) | Can edit everywhere. A client who needs to manage a List gets a Member seat; it keeps "Guests never share" true. |
| D6 | Migrated C_LEVEL/VP/DIRECTOR whose report tree is not the whole org | Add to People team · Make Admin · Accept narrower scope | People team by default, per the pre-flight report the founder approves per org. Admin only where the person already runs Settings today. |
| D7 | Space Full holders piercing a Restricted List going forward | Never (ClickUp private lists) · Space owner only (today's `board.ts:645`) | Never. Existing reach is preserved by explicit grants written on flip day and visible in the dialog. |
| D8 | Ship Can comment in v1 | Yes · Defer (three levels) | Yes. Client-review businesses ask for it first, the Docs share modal already promises it, and dropping it later is harder than adding it now. |
| D9 | Share dialog frame | Zoho-clean white card with ClickUp's rows · Pixel-copy ClickUp's Sharing and Permissions modal | Zoho-clean frame, ClickUp rows. Send the founder one screenshot before build per the parity mandate. |
| D10 | Dotted-line managers and department heads | Dotted = Can edit (today's parity), department head gets nothing extra · add a toggle | Keep parity, no toggle. Ten switches is the cap; a department head who needs everyone in the department picks them as Full on the department's Space or joins the People team. |
| D11 | Flip criterion | One week of zero unexpected parity mismatches · Ship on green golden tests alone | One week. The data-integrity mandate makes the parity job non-negotiable, and it costs one cron row. |
| D12 | Public channels self-join in Talk | Findable and self-join (Slack default) · Invite only | Findable and self-join for public channels; private channels and DMs unchanged. |
| D13 | Keep the Agent flag | Keep · Fold into Guest | Keep. A warehouse worker is an employee and must keep the directory and their own people data. |
| D14 | `Role.level` on job titles | Keep as display-only "seniority" · Drop the field | Keep as display-only seniority for the roles page chips; the column loses its enum type in step 8. |
| D15 | Creating a List or Folder inside a Space or Folder | Content: Can edit on the parent creates (ClickUp Members create lists) · Management: Full access on the parent (today's `canEditSpace`) | Content. The must-hold decision says Members write content and management is rename, settings and delete; a new List is content and its creator owns it. A Space owner who wants a tidy Space sets the Everyone row to Can comment. Golden test and an expected parity mismatch (§3.3, §10 step 2). |
| D16 | Trash for Members | Every Member restores their own deleted objects (own or Full) and Owners/Admins see the org trash · Owners/Admins only (settings spec §7.1 as written) | Every Member over their own. A Member who deletes their own List by mistake must not need an Admin to get it back; Full holders can delete under toggle 8, so they must be able to restore. Purge stays Owner/Admin. |
| D17 | Tools and Assets rows in the Teams hub | Tools for every Member and Assets for anyone with reports, People team and Admins (§5.2.1, matching §9) · both rows Admin + People team only (settings spec §7.1) | The §5.2.1 rule. A tool shared with a Member is useless if they cannot open the Tools page, and a manager who assigns a laptop needs to see it. The settings spec's Resourcing section keeps its place; only its gate widens. |
