# WorkwrK UI/UX Audit: Access control + permissions system

Audit date: 2026-09-10. Read-only inventory of the access architecture, every route/surface that exposes it, and what is broken, inconsistent, or missing. All paths are repo-relative to `/Users/bigboldtechnologies/theywrk`.

---

## 0. Executive summary

WorkwrK does not have one access model. It has **at least seven overlapping systems**, written in different phases, that disagree about what a role can do:

| # | System | Where | Vocabulary | Enforced by |
|---|--------|-------|------------|-------------|
| 1 | **Org access ladder** (`AccessLevel` enum, 10 values) | `prisma/schema.prisma:618`, `User.accessLevel` | SUPER_ADMIN, COMPANY_ADMIN, C_LEVEL, VP, DIRECTOR, MANAGER, TEAM_LEAD, HR, EMPLOYEE, AGENT | ~25 hand-copied `Set([...])` tier lists across lib/, app/, components/ |
| 2 | **Permission matrix** (16 modules x ~75 actions x 10 levels) | `src/lib/permissions.ts`, stored in `Organization.settings.permissions`, edited at `/settings/permissions` | "kras.create", "sops.publish"... | Only 12 API files call `requirePermission`/`hasPermission`; 19 client files. Most modules in the matrix gate nothing. |
| 3 | **Central resolver** `resolveAccess(viewer, resource)` | `src/lib/access.ts` | read / edit / admin / none | Pages: `/boards/[slug]`, `/folders/[id]`, `/people/[id]`, `/team/*`; API: `/api/folders/[id]/members`, `/api/boards` (create), `/api/me/access`. |
| 4 | **Legacy container gates** | `src/lib/space.ts`, `src/lib/board.ts`, `src/lib/folder.ts`, `src/lib/doc-access.ts` | boolean helpers (`getBoardForReader`, `canEditBoard`, `canContributeBoard`, `canEditSpace`, `canContributeSpace`, `folderReadable`, `folderVisibleTo`, `docAccessible`) | ~55 API routes (items, boards, spaces, folders, tables, whiteboards, files, favorites, search) |
| 5 | **Rail tiers** (3 tiers) + org rail config | `src/components/layout/os/access-tiers.ts`, `src/lib/rail-apps.ts`, `apps-catalog.tsx requiredAccess` | manager / hr-admin / org-admin | Display-only for the rail; server gates are separate (`page-gates.ts`, `route-guard.ts`) and do not always match the catalog |
| 6 | **Container ACLs** | `SpaceMember`, `FolderMember`, `BoardMember` (all `SpaceRole`: OWNER/ADMIN/MEMBER/GUEST) + `Visibility` (PRIVATE/WORKSPACE/ORG) on Space/Folder/Board | Three share dialogs, three role label vocabularies for the same enum | Systems 3 and 4 interpret the same rows differently |
| 7 | **Side ACLs** | `SOPFolderAccess` (VIEWER/EDITOR/OWNER, `src/lib/sop-access.ts`), `HRSegment` (`src/lib/hr-segment.ts`, no UI, no API), `ConversationMember` (Talk), `ApiKey.scopes` (READ/WRITE/ADMIN), `ScimToken`, `PlatformAdmin` allowlist, enterprise feature flags, plan limits | each its own | each its own |

The single most consequential finding: **pages gate through system 3 (access.ts) while the data APIs those pages fetch from gate through system 4 (board.ts)**, and the two disagree on BoardMember grants, PRIVATE boards, Space ADMIN rights, and MEMBER write rights. A user can be granted a List through the Share dialog and then get a 404 on the page (Broken #1), or open a page and have every fetch inside it 404 (Broken #2).

Everything an admin can configure lives in a Settings "Admin door" that is hidden for non-admins but, for most of its pages, not server-gated: managers can URL-navigate into `/settings/permissions`, `/settings/members`, `/settings/hierarchy`, `/settings/modules`, `/settings/billing`, `/settings/api` and see the full org matrix / their team as read-only disabled controls.

---

## 1. Architecture map

### 1.1 The org ladder: `AccessLevel`

`prisma/schema.prisma:618-629`
```
enum AccessLevel { SUPER_ADMIN COMPANY_ADMIN C_LEVEL VP DIRECTOR MANAGER TEAM_LEAD EMPLOYEE AGENT HR }
```
Stored on `User.accessLevel` (`schema.prisma:478`), `Invitation.accessLevel` (`:634`), and, confusingly, as `Role.level` (`schema.prisma:881`), which means a job title ("Senior Engineer") also carries an access level, but assigning a Role to a user does **not** change `User.accessLevel` (`src/app/api/users/[id]/route.ts:191-202` only writes the fields sent; `roleId` and `accessLevel` are independent). So "Role" means two different things: the governance matrix column (`/settings/permissions` header says "Roles & Permissions") and the job-title library (`/people/roles`).

There are **three different published lists** of this enum:
- `src/lib/permissions.ts:20-31` `ACCESS_LEVELS` (10 entries, with descriptions; includes SUPER_ADMIN and COMPANY_ADMIN; order: Super, Admin, C-Level, VP, Director, **HR**, Manager, Team Lead, Employee, Agent).
- `src/lib/access-levels.ts:39-48` `ACCESS_LEVELS` (8 entries; deliberately excludes the two admin tiers; order: C-Level, VP, Director, Manager, Team Lead, **HR**, Employee, Agent). Comment at `:11-16` explains admins are "granted manually", yet `/settings/members` and `InviteModal` use the OTHER list and DO offer COMPANY_ADMIN in a dropdown (`settings/members/page.tsx:230`, `invite-modal.tsx:61` filters only SUPER_ADMIN).
- `src/app/(dashboard)/settings/structure/page.tsx:32-43` `TIERS` (hand-written prose per rung; prepends the admin tiers; claims Director "manages departments, roles and offices" and HR "members, departments, reviews and policies", which the matrix defaults partly contradict: HR default `organization.edit:false`, Director `settings.editGeneral:true`).

HR's position in the ladder changes per list (above Manager in permissions.ts, below Team Lead in access-levels.ts, above Manager in structure page, rank 3 of 8 in roles-client `LEVEL_RANK`).

### 1.2 Tier sets: 25+ hand-copied definitions

Every one of these is a separately maintained `Set`/array of level strings. They mostly agree today; two do not.

| File:line | Name | Members |
|---|---|---|
| `src/lib/access.ts:68-70` | ORG_ADMIN / DIRECTOR / MANAGER_LEVELS | admin2 / +C_LEVEL,VP,DIRECTOR / +MANAGER,TEAM_LEAD,HR |
| `src/components/layout/os/access-tiers.ts:14-23` | MANAGER / HR_ADMIN / ORG_ADMIN | manager8 / SUPER,COMPANY,HR / admin2 |
| `src/lib/page-gates.ts:18-22` | MANAGER_LEVELS / HR_ADMIN_LEVELS | same as above |
| `src/lib/alignment-scope.ts:16-29` | ORG_WIDE_ALIGNMENT (admin2+C_LEVEL,VP,DIRECTOR,HR) / ORG_ADMIN / HR_ADMIN | note: **HR is org-wide for alignment data but not "director+" in access.ts** |
| `src/lib/api-helpers.ts:56-77` | isManager / isOrgAdmin | manager8 / admin2 |
| `src/lib/route-guard.ts:12-13` | EMPLOYEE_LEVELS / ORG_ADMIN_LEVELS | EMPLOYEE,AGENT / admin2 |
| `src/lib/space.ts:14` | ADMIN_ACCESS_LEVELS | admin2 |
| `src/lib/board.ts:29` | ADMIN_LEVELS | admin2 |
| `src/lib/folder.ts:13` | ADMIN_LEVELS | admin2 |
| `src/hooks/use-role.ts:6-22` | MANAGER_ROLES / **ADMIN_ROLES** | manager8 / **SUPER, COMPANY, C_LEVEL, HR** (drifts: `isAdmin` is true for C-Level and HR; used by `people/[id]/profile-client.tsx:696`, `dept-workspace-banner.tsx:24`) |
| `src/components/layout/os/settings-shell.tsx:27` | ORG_ADMIN_LEVELS | admin2 |
| `src/app/(dashboard)/settings/structure/page.tsx:25` | ADMIN_LEVELS | admin2 |
| `src/app/(dashboard)/settings/members/page.tsx:18-20` | MANAGER_SIDE | manager8 |
| `src/app/(dashboard)/people/roles/[id]/page.tsx:20` | MANAGER_LEVELS | manager8 |
| `src/app/api/users/[id]/route.ts:146,170-172` | isAdmin / MANAGER_TIER | admin2 / manager8 |
| `src/app/api/settings/route.ts:123` | inline | **admin2 + C_LEVEL** (C-Level may PATCH org settings incl. security policy) |
| `src/app/(dashboard)/settings/locale/page.tsx:68` | canEdit | admin2 + C_LEVEL (matches the API, not the Admin door) |
| `src/app/api/org/preferences/route.ts:13` | ORG_ADMIN_LEVELS | admin2 |
| `src/app/api/products/installations/route.ts:74,163` | inline | admin2 |
| `src/app/api/keys/route.ts:31` | "Only admins" | (isOrgAdmin) |
| `src/lib/api-auth.ts:161` | API-key scopes granted | ADMIN scope only when creator is admin |
| `src/lib/role-defaults.ts:195-204` | tierIdsFor | executive = C_LEVEL,VP,DIRECTOR,admin2; leadership = MANAGER,TEAM_LEAD,HR |
| `src/components/layout/os/apps-catalog.tsx:992` | DIRECTOR_LEVELS | admin2 + C_LEVEL,VP,DIRECTOR |
| `src/app/(dashboard)/spaces/[slug]/page.tsx:211` | isAdmin inline | admin2 |
| `src/lib/automation/hub-access.ts:39-43` | admin/manager/member | via access.ts |
| `src/app/api/weekly-reviews/[id]/manager-review/route.ts:16`, `kpi-records/[id]/manager-review/route.ts:14`, `cron/run-due-agents/route.ts:23`, `autopilot/workflows/route.ts:24`, `team/members-work/route.ts:72` | inline ORG_ADMIN | admin2 |

`grep -c "isOrgAdmin(session)\|isManager(session)\|hasRole(session"` over `src/app/api` = **220** call sites, plus 29 inline `accessLevel ===` comparisons. The permission matrix (system 2) is consulted in only 12 API files.

### 1.3 The permission matrix (`src/lib/permissions.ts`)

- 16 modules: people, organization, kras, sops, reviews, okrs, tasks, meetings, policies, announcements, assets, surveys, ideas, analytics, tools, settings (`:37-197`).
- Defaults per tier: `fullAccess` (both admins), `executiveAccess` (C_LEVEL/VP/DIRECTOR), `hrAccess`, `managerAccess` (MANAGER + TEAM_LEAD identical), `employeeAccess`, `agentAccess` (`:226-307`).
- `checkPermission()` (`:317-332`): protected admins always true; custom matrix override; fall back to defaults; unknown = false.
- Storage: `Organization.settings.permissions` (JSON), PATCH `/api/permissions` (`src/app/api/permissions/route.ts:26-77`, sanitizes to known modules/actions, admin-only). GET is open to every authed user and cached 60s (`:20-22`).
- Client: `src/hooks/use-permission.ts` (module-level cache, never invalidated after save except `invalidatePermissionCache()` which nothing calls; the Permissions page does not call it, so other open tabs/components keep the stale matrix until reload), `src/hooks/use-role.ts` (`canManagePeople`, `canManageSOPs`, `canPublishSOPs`, `canManageReviews`, `canManageKRAs`, `canInvite`, `canViewAnalytics`).

**Which matrix cells are actually enforced server-side** (from grep of `requirePermission`/`hasPermission` in `src/app/api`):
- people.create (invitations POST)
- sops.create / edit / publish / delete
- policies.create
- kras.create / edit / delete / assign
- assets.create / edit / delete (+ dynamic `action`)
- announcements.create

Everything else in the grid is **cosmetic**: `people.view/edit/delete/bulkActions`, all of `organization.*`, `reviews.*`, `okrs.*` (goals use `alignment-scope.ts` instead), all of `tasks.*` (Items use board.ts), `meetings.*`, `surveys.*`, `ideas.*` (Ideas not on rail), `analytics.*` (page gated by `requireManagerOrRedirect`, not the matrix), `tools.*` (page gated manager, catalog says hr-admin), `settings.*` including `manageAccessControl` (the Permissions page itself gates on `PROTECTED_ADMIN_ROLES`, not on this cell). An admin can untick "Manage access control" for C-Level and nothing changes; tick "Edit general settings" for Employee and nothing changes.

Modules that exist in the product but have **no row** in the matrix: Spaces/Folders/Lists (the whole work OS), Docs, Tables, Talk, Whiteboards/Canvas, Files/Library, Automation, Forms, Timesheets, Planner/Calendar, Agreements/Contracts, Kudos, Candor, Trash, Audit log, API keys, Modules, Apps (rail config), Templates.

### 1.4 Central resolver (`src/lib/access.ts`)

`resolveAccess(viewer, ref)` returns `{permission: read|edit|admin|none, reason}`. Resource types: module, space, folder, board, doc, item, user, weekly-review, kra (`:29-38`).

- `resolveModule` (`:97-125`): static tier decisions; "people" is read for everyone with a reason string only.
- `resolveSpace` (`:129-150`): org admin -> admin; OWNER/ADMIN -> edit; MEMBER/GUEST -> **read**; ORG visibility -> read; else none. (WORKSPACE visibility is not a grant; only membership is.)
- `resolveFolder` (`:158-199`): org admin; direct FolderMember; folder owner -> edit; ancestor FolderMember (8 hops, one query per hop); PRIVATE -> none; else space.
- `resolveBoard` (`:201-227`): org admin; no container -> none; **never reads `BoardMember`**; folder or space decision; PRIVATE board demotes read -> none.
- `resolveDoc` (`:234-265`): NOTEPAD owner-only (even admins are denied, contrary to the "org admin override" comment above it at `:242`, because the admin check happens first at `:242` and returns admin... wait: `:242` returns admin BEFORE the NOTEPAD check at `:248`, so admins DO get admin on someone else's notepad here, while `doc-access.ts:74-81` says owner-only "regardless of access level". The two doc gates disagree on admin read-around of personal notepads).
- `resolveItem` (`:267-284`): inherits board; item owner gets edit even when board is read.
- `resolveUser` (`:286-319`): self edit; org admin; director sees tree; manager sees effective tree (solid + dotted); HR segment; else read (minimal).
- `resolveWeeklyReview`, `resolveKra` (`:321-359`): manager+ can edit any KRA in the org.
- `requireAccess` (`:410-421`) has a comment "Phase 6b can write to an AuditLog row here for denied access": no denial is audited anywhere.

### 1.5 Legacy container gates

`src/lib/space.ts`
- `listSpacesForUser` (`:71-144`): admin all; else ORG visibility OR member OR (opt) folder-grant containers.
- `visibleSpaceIds` (`:156-186`): the "full read" set used by files/search/tables/whiteboards; deliberately excludes folder grants (leak trap comment `:166-171`).
- `getSpaceForReader` (`:194-204`): admin; ORG; any member row (GUEST included).
- `canEditSpace` (`:210-217`): admin; OWNER/ADMIN. Used for: members add/remove/role, invitations, PATCH space (name, visibility, modules), folder create/update, boards create.
- `canContributeSpace` (`:225-232`): admin; any non-GUEST member.
- `addSpaceMember` upsert / `removeSpaceMember` (`:424-436`): **no last-OWNER guard, no self-demotion guard, an ADMIN can remove or demote the OWNER**.

`src/lib/board.ts`
- `getBoardForReader` (`:605-665`): admin; **direct BoardMember (any role) -> read**; PRIVATE folder and not folder owner -> null (**ignores FolderMember grants**); ORG board -> read; PRIVATE board -> owner, Space **OWNER only**, or BoardMember; else Space reader.
- `canEditBoard` (`:672-705`): admin; board owner; PRIVATE: BoardMember OWNER/ADMIN or Space OWNER; else `canEditSpace`.
- `canContributeBoard` (`:716-747`): admin; board owner; non-GUEST BoardMember; PRIVATE -> false; else non-GUEST SpaceMember.
- `canReadBoard` = wrapper.

`src/lib/folder.ts`
- `folderVisibleTo` (`:21-29`): PRIVATE only owner/admin (ignores FolderMember, by design per its own comment).
- `folderAccessForSpace` (`:48-71`): full / scoped / none for the sidebar.
- `folderReadable` (`:171-207`): mirrors the resolver.
- `updateFolder` (`:360-386`) has **no `visibility` field**: a folder's Private flag is set only at creation (`new-folder-dialog.tsx:212`, `api/folders/route.ts:71`) and can never be changed afterwards from any UI or API.

`src/lib/doc-access.ts`: fourth gate for Docs; patches board-in-folder reads (`:27-39`).

### 1.6 Where systems 3 and 4 disagree (same rows, different answers)

| Scenario | Page (access.ts) | Data API (board.ts / space.ts) | Consequence |
|---|---|---|---|
| User added directly to a List via ShareBoardDialog, not a Space member, Space is WORKSPACE | `resolveBoard` -> `resolveSpace` -> **none** (`access.ts:218-221`) | `getBoardForReader` -> **read** via directGrant (`board.ts:623-627`) | `/boards/[slug]` 404s (`boards/[slug]/page.tsx:68`) although the dialog promises "Anyone you add below gets access to this list, even without access to the Space" (`share-board-dialog.tsx:294`). Sidebar also hides it (sidebar tree is space-membership based). |
| Space ADMIN opens a PRIVATE board in that Space | edit (Space ADMIN = edit, PRIVATE only demotes read) | `getBoardForReader` PRIVATE branch accepts Space **OWNER only** (`board.ts:645-651`) -> null | Page renders; `/api/boards/[id]/items` returns 404 -> empty/broken board. |
| Folder-only grantee (FolderMember on a PRIVATE folder) opens a board in it | `resolveFolder` grant -> read | `getBoardForReader` private-folder cascade only checks `folder.ownerId` (`board.ts:632-637`) -> null | Page renders, items API 404. `doc-access.ts` patched Docs for this exact hole (`:24-39`) but Items were not patched. |
| Space MEMBER wants to edit a task | `resolveSpace` -> **read**; `resolveItem` -> read unless item owner | `canContributeBoard` -> non-GUEST SpaceMember **writes** (`board.ts:740-746`) | The resolver's `canEdit` says no while the item API says yes. `/api/folders/[id]/members` POST uses `canEdit` (resolver) so a Space MEMBER cannot share a folder but CAN create items in it. |
| GUEST who owns an item | edit ("you own this item", `access.ts:280-282`) | `canContributeBoard` GUEST -> false | Resolver would allow, API denies. |
| Space with `visibility: ORG`, non-member wants to contribute | read | `canContributeBoard` requires a SpaceMember row -> false | ORG-visible spaces are read-only for non-members with no UI explaining that. |
| Schema comment on `BoardMember` (`schema.prisma:4364-4365`): "MEMBER/GUEST are read-only at the API gate" | | `canContributeBoard` says MEMBER writes | The schema's own doc is stale. |

### 1.7 Rail tiers, org rail config, modules

- `access-tiers.ts`: three tiers, `canAccessTier()`.
- `apps-catalog.tsx` `requiredAccess` per app (`:1170-1342`): teams=manager; reviews, candor, announcements, kudos, surveys, tools, assets, policies, agreements, trash = hr-admin; automation = manager; everything else open. `offRail` folds 17 apps into 8 hubs (`:1350-1359`).
- Hub sidebars re-gate their links: `TeamsSidebar` (`:994-1049`) hides Rollup below director and Culture/Review cycles below hr-admin; `DocsSidebar` hides Policies/Contracts below hr-admin (`docs-sidebar.tsx:166-167`); `ChatSidebar` hides Announcements (`chat-sidebar.tsx:268`); `SettingsSidebar` hides Tools/Assets/Trash below hr-admin (`apps-catalog.tsx:1151-1153`); `AiSidebar` hides Automation below manager (`:968`).
- `rail-apps.ts` `visibleRailApps` (`:134-179`): catalog minus org `hidden`, minus `offRail`, minus inactive modules, filtered by catalog baseline then org `minAccess` floor; last-ditch fallback ignores org config if the result is empty.
- Org config lives at `OrgPreference.sidebarDefault.apps` (`schema.prisma:4629-4638`), edited at `/settings/apps`, PATCH `/api/org/preferences` (admin2). Comment in `rail-apps.ts:18-20` and the page itself: **hidden/minAccess are display-level only; routes stay reachable by URL**.
- Modules: `src/lib/modules.ts` (Talk, Tables) -> `ProductInstallation` ACTIVE rows; `entitlements.ts` `isModuleActive`; `getSessionAndModule` (`api-helpers.ts:25-42`) 403s module APIs; `/tlk` and `/tables` layouts gate routes. Toggle at `/settings/modules`.
- `apps-more-popover.tsx:59-82` uses `railApps` (governed); `command-palette.tsx:235` indexes `APPS` directly with no `canAccessApp` filter, so palette search can surface apps the org hid or the tier cannot reach.

### 1.8 Page gates vs catalog tiers

Four different gating idioms coexist:
1. `page-gates.ts`: `requireManagerPage()` (redirects employees to `/people/me`), `requireHrAdminPage()` (redirects managers to `/team/reviews`), `requireGoalsPage`, `requireGoalPage`.
2. `route-guard.ts`: `requireManagerOrRedirect("/dashboard")`, `requireOrgAdminOrRedirect("/dashboard")` (default redirect target `/dashboard` is a route not on the rail; Home is `/today`).
3. Inline session checks in the page (`settings/structure/page.tsx:60-78` renders a lock card; `people/roles/[id]/page.tsx:35` computes `canEdit` and renders read-only).
4. Nothing (client `useRole()` disables controls).

| Route | Catalog tier | Server gate | Match? |
|---|---|---|---|
| /team, /people, /organization, /kra-kpi, /people/roles, /people/departments, /people/skills | manager | `requireManagerPage` | yes |
| /reviews, /reviews/[id] | hr-admin | `requireHrAdminPage` | yes |
| /tools, /assets | **hr-admin** | `requireManagerOrRedirect` (**manager**) | **no**: any manager can URL-navigate; rail hides it from them |
| /talent, /analytics, /integrations, /ai, /process-runs | (folded) | `requireManagerOrRedirect` | n/a |
| /trash | hr-admin | **none** (API `isManager`) | **no** |
| /kudos, /surveys | hr-admin | **none**; `/api/kudos`, `/api/surveys` GET have no tier check | **no**: employees can open both by URL |
| /candor | hr-admin | none (API: GET open, POST manager) | no |
| /announcements | hr-admin | none (create via matrix) | no |
| /policies, /agreements | hr-admin | none (agreements API isManager; policies create via matrix) | no |
| /settings/apps, /audit, /data, /defaults, /identity, /tags | admin door | `requireOrgAdminOrRedirect` | yes |
| /settings/permissions, /members, /hierarchy, /modules, /billing, /api, /locale, /scoring, /task-types, /integrations, /import-export, /calendar, /notifications | admin door (nav hidden) | **none** | **no**: reachable by URL, rendered read-only |
| /settings/structure | admin door | inline lock card | yes (different pattern) |
| /people/roles/[id] | manager | inline `canEdit`, page readable by employees (intended: "read own JD") | intended |
| /admin/* | platform staff | `(admin)/layout.tsx` + `proxy.ts` host split | yes |

### 1.9 Platform admin (staff back-office)

- `PlatformAdmin` table (`schema.prisma:602-607`): email allowlist, decoupled from tenant `accessLevel`.
- `src/proxy.ts:128-154`: when `ADMIN_HOST` is set, `/admin` and `/api/admin` answer only on that host; other paths on the admin host redirect to `/admin`. Off when env unset (then `/admin` resolves on the app host too, still gated by the layout).
- `(admin)/layout.tsx:29-67`: no session -> `/login?callbackUrl=/admin`; non-staff -> hard-coded dark "Restricted" page (inline styles, `#d4ff2e` lime accent, not the design system).
- `AdminShell` (`admin-shell.tsx`) uses `bg-background text-foreground`, red accent, a different token system from the OS shell.
- Staff can: change plan, status (ACTIVE/TRIAL/SUSPENDED/CANCELLED), toggle enterprise flags (byok/whiteLabel/customDomain) per company (`api/admin/companies/[id]/route.ts:53-106`); manage the allowlist (`/admin/staff`, last-staff guard). No impersonation, no tenant-admin reset, no "make this user COMPANY_ADMIN" from the back office.

### 1.10 Side ACL systems

- **SOP folders**: `SOPFolderAccess` VIEWER/EDITOR/OWNER (`schema.prisma:1557-1576`), `sop-access.ts` recursive CTE inheritance, admin-only management via `/api/sop-folders/[id]/access` (`isOrgAdmin` even for GET) and `components/sops/folder-manager.tsx` (Save-access button, atomic replace). A completely separate vocabulary (Viewer/Editor/Owner) from Space/Folder/Board (Guest/Member/Admin/Owner); the resolver knows nothing about it.
- **HR segments**: `HRSegment` model + `hr-segment.ts` + `hrCanReadUser` used by `resolveUser`. **No API route, no UI** (`grep hRSegment src/app` = 0 hits). Since an HR user with zero segments matches nothing (`hr-segment.ts:125`), and no segment can be created, the HR branch of `resolveUser` is dead code. HR reaches people through `ORG_WIDE_ALIGNMENT_LEVELS` instead (`/api/users` `:38`).
- **Talk**: `ConversationMember` and guest door, own gates (out of scope here).
- **API keys**: `ApiKey.scopes` READ/WRITE/ADMIN (`settings/api/page.tsx:30-47`); admin-only management (`api/keys/route.ts:31`); an org admin's key may carry ADMIN (`api-auth.ts:161`).
- **SCIM tokens**: `/api/scim-tokens` admin-only, `/api/scim` provisioning exists; **no Settings UI** links to it (identity page is name/domain/logo/mission only; `identity/layout.tsx` comment says "Identity (SAML / SCIM)" but the page has no SAML/SCIM controls).
- **Enterprise features** (`enterprise-features.ts`) and **plan limits** (`plan-limits.ts`): staff-controlled; only `users` limit is enforced on user create.
- **Security policy** (minPasswordLength, requireUppercase, requireNumbers, sessionTimeout, twoFactorEnabled) lives in `Organization.settings.security`, PATCHable via `/api/settings` by admin2 + C_LEVEL, but the only surfaces are the read-only "Org policy" card on the personal `/account/security` page (`:182-190`) and two Settings-overview cards that **link to `/account/security`** (`settings/page.tsx:210,221`), a personal page, so there is no admin editor for the org security policy.

### 1.11 Session

`src/lib/auth.ts:297-387`: `accessLevel` is copied into the JWT at sign-in and refreshed from the DB on token refresh (`:337-368`, checks `deletedAt`, `status`, `tokenVersion`). Changing someone's level in `/settings/members` takes effect on their next token refresh; there is no "user must re-login" notice. The dashboard layout gate is client-side (`(dashboard)/layout.tsx:30-34`), with an optional edge cookie-presence gate (`proxy.ts:189-201`, `AUTH_EDGE_GATE`).

---

## 2. Route inventory

Conventions used below: "Rail" = left app rail (8 hubs). "SettingsShell" = the full-screen settings takeover (`settings-shell.tsx`) with its own top bar (Back -> `/today`, breadcrumb "{Org} > Settings", Close X -> `/today`, Esc -> `/today`) and a 248px left nav split into an **Admin door** (hidden for non-admin2) and a **Personal door**. Inside SettingsShell there is no OS top bar, no rail, no per-page BackButton; each page is a plain scrolling `<main>`.

### 2.1 `/settings` (Settings overview)
- **File**: `src/app/(dashboard)/settings/page.tsx`
- **Purpose**: card grid hub (Organization / Product & integrations / Scoring & reviews / Security & compliance / Usage).
- **Reachable from**: rail Settings hub (`alwaysPinned`), workspace menu, SettingsShell nav "Overview".
- **Back**: SettingsShell "Back" (`/today`) and X; no page BackButton.
- **Top bar**: SettingsShell bar only.
- **Sidebar**: Admin door groups (Organization, People & structure, Governance, Platform, Billing & performance) + Personal door (Profile, Notifications, Appearance, Security).
- **Controls**: 14 link cards. Access-relevant cards: "Password policy" and "Session & 2FA" both link to **`/account/security`** (personal page, read-only policy) instead of an admin editor; "Locale & finance" and "Plan & billing" cards link to `/settings` itself (`:112,123`), a no-op; "People" card links to `/people` (leaves settings); "AI usage" links to `/analytics`.
- **UI state**: polished visually (uses `--os-*` via `.settings`/`.setcard` in os.css) but with dead links.
- **Issues**: self-linking cards; security policy has no editor; no server gate, so a manager who URL-navigates sees the whole card grid with org plan, usage and security policy values (`/api/settings` GET is open to any authed user).
- **Loader**: `ValueLoader` (brand values) via `.settings__loading`. Error: `OsEmptyView` with Retry (Retry CTA not wired to `load`).

### 2.2 `/settings/permissions` ("Roles & Permissions")
- **File**: `src/app/(dashboard)/settings/permissions/page.tsx`
- **Purpose**: the org permission matrix grid (modules x actions x 10 access-level columns).
- **Reachable from**: SettingsShell Admin door > People & structure > "Roles & permissions"; link from `/settings/structure` explainer.
- **Back**: SettingsShell only.
- **Top bar**: SettingsShell only.
- **Controls**: 16 collapsible `<details>` modules (kras, sops, people, reviews open by default); each a table with a Capability column and 10 columns (Super, Admin, C-Lvl, VP, Dir, HR, Mgr, Lead, Emp, Agent); native checkboxes; Super/Admin columns show a lock icon; sticky Save bar (admin only) with "Unsaved changes" and a result banner.
- **UI state**: rough. Native checkboxes (`accent-zinc-900`), `<details>` disclosure, zinc palette, `text-[20px]` H1 while `/settings/members` uses `text-[16px]` and `/settings/apps` uses `text-[19px]`.
- **Issues**:
  - ~55 of ~75 cells save but **enforce nothing** (see 1.3). No indication which capabilities are live.
  - Module list is the 2025 pre-PPMS product (meetings, ideas, surveys, analytics, tools) and omits the whole Spaces/Lists/Docs/Tables/Talk work OS.
  - "Manage access control (this page)" cell does not control this page.
  - No per-column explanation of what a tier is (tooltip only via `title`).
  - No search, no "reset to defaults", no diff vs defaults, no audit entry on save (`/api/permissions` PATCH does not `logActivity`).
  - Saving does not call `invalidatePermissionCache()`, so `useRole()` consumers on other pages keep the old matrix until reload.
  - Not server-gated: managers see the full grid disabled.
  - Table needs `overflow-x-auto` inside each module; at narrow widths the sticky first column overlaps.
  - Loader is a `Loader2` spinner + text, not the `ValueLoader`/`DotsLoader` used elsewhere.
  - TEAM_LEAD and MANAGER have identical defaults; nothing explains why both columns exist.

### 2.3 `/settings/members`
- **File**: `src/app/(dashboard)/settings/members/page.tsx`
- **Purpose**: list everyone; set Access level and Reports-to per person; invite; revoke pending invites.
- **Reachable from**: Admin door > People & structure > Members; `/settings/hierarchy` link; workspace menu (`workspace-menu.tsx:381,391`).
- **Back**: SettingsShell only.
- **Controls**: Invite button (admin2 only) -> `InviteModal`; two count chips ("N managers & admins", "N members"); search; table (Person, Access level `<select>` of all 10 levels incl. SUPER_ADMIN and COMPANY_ADMIN, Reports to `<select>`, Reports count, KRAs count); Pending invites table with Revoke.
- **UI state**: rough-to-polished; native selects; H1 `text-[16px]`.
- **Issues**:
  - Access-level select offers **SUPER_ADMIN** (the "system owner, granted by WorkwrK staff" per `access-levels.ts:11-16`). An org admin can promote anyone to SUPER_ADMIN and it saves (`users/[id]/route.ts:191` allows `accessLevel` with no value whitelist).
  - Last-admin guard exists only for COMPANY_ADMIN demotion (`:182-189`), not for SUPER_ADMIN, and a COMPANY_ADMIN can demote **themselves** as long as one other admin exists (locks them out of the Admin door immediately on next token refresh, with no confirm).
  - Data source is `/api/users?scope=all` which silently returns **team scope** for non-org-wide callers (`api/users/route.ts:50`), so a MANAGER who URL-navigates here sees only their reports, labelled as the whole org.
  - Reports-to select lists every user with no cycle check (A reports to B reports to A is accepted; `getTeamUserIds` CTE would loop on `UNION` dedupe but the tree UI at `/settings/hierarchy` would drop both as non-roots).
  - Changing a level gives no "takes effect on next sign-in" hint; no confirmation for promotion to an admin tier.
  - The "Access level" column is the only place to change a level; the People directory profile does not expose it.
  - No empty state when the org has one user (table with one row), no bulk actions, no export, no filter by level (the API supports `?accessLevel=`).
  - Not server-gated.

### 2.4 `/settings/hierarchy`
- **File**: `src/app/(dashboard)/settings/hierarchy/page.tsx`
- **Purpose**: read-only reporting tree from `User.managerId` (solid lines only; dotted lines from `UserDottedLine` are not shown though the resolver uses them).
- **Reachable from**: Admin door > People & structure > Reporting hierarchy.
- **Controls**: expand/collapse chevrons (top two levels open); level chip per node; "N reports" counters; link to Members.
- **UI state**: rough (plain nested divs; no search, no avatars beyond initials, no org-chart link although `/organization` exists).
- **Issues**: duplicates `/organization` (org chart, manager-gated) with a different renderer; no dotted lines; users whose manager is soft-deleted appear as roots; team-scoped for managers (same API caveat); not server-gated; `Loader2` spinner.

### 2.5 `/settings/structure`
- **File**: `src/app/(dashboard)/settings/structure/page.tsx` (server component)
- **Purpose**: explainer hub: Functions, Roles, Access levels (read-only ladder with live head-counts), Offices (Coming soon).
- **Reachable from**: Admin door > People & structure > Org structure.
- **Back**: breadcrumb "Settings > Org structure" (link) + SettingsShell.
- **Controls**: 3 link tiles + 1 dashed "Coming soon" tile; numbered 10-rung list with "Admin door" badge and per-rung prose.
- **UI state**: polished, on-token (`var(--os-brand)` gradients, `#0073EA`).
- **Issues**: the prose per rung (`:33-42`) is hand-written and not derived from the matrix (e.g. says Director manages departments/roles/offices; the matrix default for DIRECTOR is `executiveAccess` with `organization: allTrue` so it happens to be true, but HR is described as managing "policies" while `hrAccess.policies` is allTrue and `organization.edit:false`, and nothing here updates if an admin edits the matrix). Uses inline lock card for non-admins rather than the shared redirect pattern. Offices tile is a stub.

### 2.6 `/settings/apps` (rail config)
- **File**: `src/app/(dashboard)/settings/apps/page.tsx`, gate `apps/layout.tsx` (`requireOrgAdminOrRedirect`).
- **Purpose**: org-wide rail order, hide/show per app, per-app minimum access tier floor.
- **Reachable from**: Admin door > Organization > Apps.
- **Back**: breadcrumb "Settings > Apps" + SettingsShell.
- **Controls**: draggable rows (HTML5 DnD) with grip, up/down buttons, `<select>` floor (Everyone / Managers and up / HR and org admins / Org admins only), `Switch` visible; alwaysPinned rows (Work, Settings) locked with "Always available" badge; baseline tier shown as "Baseline: Managers+".
- **UI state**: polished, on-token; autosaves per change with toast; integrity check that the `apps` key persisted (`:150-152`).
- **Issues**:
  - The list shows **every catalog app including the 17 `offRail` ones** (`orderedCatalogForAdmin` filters only `hideFromCatalog`, `rail-apps.ts:196`), so an admin can reorder/hide "Goals", "Kudos", "Policies" that are not rail icons at all; hiding them removes them from the More launcher only, nothing tells the admin that.
  - Setting a floor of "Org admins only" on **Settings** is blocked (alwaysPinned) but on **Teams** it would hide the hub from managers while `/team` stays reachable by URL and the Teams sidebar still renders on `/people/[id]`; the page's own footnote admits this.
  - The floor select and the `Switch` do not disable while `saving` is false but a drag is in flight; rapid drags can interleave PATCHes (last write wins, whole `apps` object).
  - No "reset to default order".
  - Native `<select>` styled with inline `style` (`:331`), inconsistent with `ui/` primitives.

### 2.7 `/settings/modules`
- **File**: `src/app/(dashboard)/settings/modules/page.tsx`
- **Purpose**: toggle premium modules (Talk, Tables) org-wide.
- **Reachable from**: Admin door > Organization > Enabled modules; overview "Modules" card.
- **Controls**: one `Switch` per module; optimistic flip; toast.
- **UI state**: polished; on-token.
- **Issues**: not server-gated (managers see disabled switches); turning a module off does not warn that Talk channels/Tables data become unreachable (the route layouts 403/redirect); no per-tier or per-team enablement (module on = everyone). Overview card says "Team size" under Modules for no reason.

### 2.8 `/settings/defaults` (Defaults & locks)
- **File**: `src/app/(dashboard)/settings/defaults/page.tsx`, gated by `defaults/layout.tsx`.
- **Purpose**: org default theme/accent/density + `lockedKeys` toggles (theme, density, sidebar layout, home cards).
- **Controls**: 3 appearance cards, 7 accent swatches, density segmented control, 4 lock switches.
- **UI state**: polished.
- **Issues (access-relevant)**: the only "lock" concept in the product is cosmetic (theme/density/sidebar/home cards). `OrgPreference.lockedKeys` was designed for "compliance-critical surfaces (e.g. sidebar.pinned.kra-kpi)" (`schema.prisma:4626-4628`) but pinning was removed, so no access lock exists. The page copy admits Density and Sidebar locks "are not greyed out yet" in the Customize panel.

### 2.9 `/settings/audit`
- **File**: `src/app/(dashboard)/settings/audit/page.tsx`, gated by `audit/layout.tsx` (admin2).
- **Purpose**: org ActivityLog feed with type/actor/date filters, JSONL export.
- **Reachable from**: Admin door > Governance > Audit log; overview "Audit log" card.
- **Top bar**: uses `OsTitleBar` (the OS-page title bar) **inside** SettingsShell, the only settings page that does, so it renders a second header with "Settings" and "API keys" nav-links.
- **Controls**: Export, range chips, type chips, actor filter, search, Load more.
- **UI state**: polished (custom `adt__` CSS, KPI tiles, `ValueLoader`).
- **Issues**: no access-specific events are guaranteed to exist: `/api/permissions` PATCH, space/board/folder member changes, visibility changes, access-level changes via `/api/users/[id]` do not call `logActivity`/`logAuditEvent` (invitations do). The marketing page promises "every read, write, export, share logged with IP and device"; denied-access events are never written (`access.ts:417`). API is `isManager` (`api/audit/route.ts:24`) while the page is admin2, so a manager can hit the API directly.

### 2.10 `/settings/data` (Data & compliance)
- **File**: `src/app/(dashboard)/settings/data/page.tsx`, gated admin2.
- **Purpose**: exports (all/people/timesheets/POs/invoices/audit) + links to `/imports` and `/trash`.
- **Issues**: exports are the most sensitive read in the product and are only gated by tier; no export log entry surfaced to the user.

### 2.11 `/settings/identity`
- Gated admin2 (`identity/layout.tsx`). Org name/domain/logo/mission/values. The layout comment says "Identity (SAML / SCIM)" but **no SSO/SCIM controls exist anywhere in the UI** although `IdentityProvider`, `ScimToken`, `/api/scim`, `/api/scim-tokens` exist. The domain field is what locks invitations to a company domain (`api/invitations/route.ts:57-73`).

### 2.12 `/settings/api` (API keys)
- **File**: `src/app/(dashboard)/settings/api/page.tsx`, **not server-gated**; client `canManage` = admin2 (`:73-74`); API admin-only.
- **Controls**: create key with scopes READ/WRITE/ADMIN, revoke.
- **Issues**: a manager URL-navigating sees the key list UI in read-only (the GET is admin-only so it errors/empties); ADMIN scope means an API key inherits full org admin with no per-module scoping.

### 2.13 `/settings/billing`, `/settings/locale`, `/settings/scoring`, `/settings/task-types`, `/settings/tags`, `/settings/calendar`, `/settings/integrations`, `/settings/import-export`, `/settings/notifications`
- Adjacent Admin-door pages. Gating: tags gated admin2 by layout; the rest have no server gate. `locale` allows C_LEVEL to edit (matching `/api/settings` PATCH) while the Admin door nav is hidden from C_LEVEL, so a C-Level user can edit locale only by typing the URL. `calendar` is a "Coming soon" stub. `integrations` (`/settings/integrations`) is distinct from `/integrations` (manager-gated app page).

### 2.14 `/account/security` (Personal door)
- **File**: `src/app/(dashboard)/account/security/page.tsx`
- **Purpose**: personal password/MFA + read-only "Org policy" card (min length, uppercase, numbers, session timeout, MFA required) + recent security activity.
- **Reachable from**: Personal door > Security; Settings overview "Password policy" and "Session & 2FA" cards (mislabelled as admin settings).
- **Issues**: the org policy is displayed here but nowhere editable; `twoFactorEnabled` ("MFA required org-wide") is shown but enforcement of org-wide MFA is not part of the login flow audited here (out of scope to verify further).

### 2.15 `/people/roles` (job-title library)
- **File**: `src/app/(dashboard)/people/roles/page.tsx` + `roles-client.tsx`; gate `requireManagerPage`.
- **Reachable from**: Teams hub sidebar > People > Roles; `/settings/structure` "Roles" tile; Teams "+" > New role (`?new=1`).
- **Back**: breadcrumb "Teams / Roles" (Link to `/team`); no BackButton (list page).
- **Top bar**: OS top bar (Teams hub) with Directory / Departments / Skills / New role buttons in-page.
- **Controls**: KPI tiles, search, "Unfilled only" checkbox, level chips (C-Suite, VPs, Directors, Managers, Team leads, ICs, Agents, HR, Company admin, Super admin, Other), role cards with delete.
- **UI state**: polished (custom `rls__` CSS, `ValueLoader`).
- **Issues**: `Role.level` is an `AccessLevel` but assigning a role does not set the holder's access level; the empty-state copy claims "Each role gets an access level that controls what its holders can see" (`roles-client.tsx:319`), which is false. Quick-add creates a role at EMPLOYEE level then navigates to the detail page. Any manager can create roles at C_LEVEL/COMPANY_ADMIN level (`api/roles/route.ts:53-64` accepts any `level` string; Prisma will reject unknown values but accepts COMPANY_ADMIN/SUPER_ADMIN).

### 2.16 `/people/roles/[id]` (Role definition)
- **File**: `src/app/(dashboard)/people/roles/[id]/page.tsx` + `role-workspace.tsx`.
- **Reachable from**: role card; `/people/me` link; direct URL (readable by employees, read-only).
- **Back**: `BackButton fallbackHref="/people/roles"` (correct convention) + breadcrumb.
- **Controls**: Overview / Instances views; level pill in the title; KRAs/KPIs/SOPs/areas/boundaries/thresholds (governance content, not access).
- **Issues**: the level pill shows the raw enum (`role.level` uppercase, `:166`); editing the level is inside `role-workspace` and again does not touch holders' `User.accessLevel`. Non-editors get emails stripped (good) but the page still lists every holder.

### 2.17 `/sops/manage` (SOP folders + folder access)
- **File**: `src/app/(dashboard)/sops/manage/page.tsx` -> `components/sops/folder-manager.tsx`.
- **Purpose**: CRUD SOP folders; per-folder access list with Viewer/Editor/Owner.
- **Reachable from**: Docs hub > SOPs section (manage link); `/sops` page.
- **Controls**: folder list with "N users" badge; drill-in access panel; per-user checkbox + role select; "Save access" (atomic replace).
- **UI state**: rough (uses the old `ui/` Card/Badge/Button set, not the OS shell styles).
- **Issues**: a fourth sharing vocabulary (Viewer/Editor/Owner) alongside Space/Folder/Board dialogs; admin-only even to view who has access (`api/sop-folders/[id]/access/route.ts:18`) so a folder OWNER (the role that "also manages access" per the UI copy at `:326`) cannot actually open this panel; `/api/sop-folders/[id]/access` GET/PATCH ignore the OWNER role entirely.

### 2.18 Share surfaces (dialogs, not routes)

**ShareSpaceDialog** (`share-space-dialog.tsx`)
- Opened from: `/spaces/[slug]` title-row "Share" (`SpaceShareButton`, rendered for **every** reader, `spaces/[slug]/page.tsx:612`), the About card members strip "Manage" (`space-members-strip.tsx`), sidebar Space "..." > "Sharing & Permissions" (`space-more-menu.tsx:521-532`, toasts "Open the Space to manage sharing" when no handler).
- Controls: Visibility cards (Private "Only invited members" / Workspace "Members + org admins" / Org-wide); Add people tabs (People search, Departments "Add all", Offices "Add all", Invite by email with Guest/Member/Admin role + pending invites list with copy/resend/revoke); Members list with role select (Owner/Admin/Member/Guest) and remove X.
- Issues:
  - **No read-only mode**: a MEMBER/GUEST sees every control; every click 403s with a toast ("Forbidden").
  - The **People search candidate list comes from `/api/users?scope=all`**, which returns only the caller's report tree for MANAGER/TEAM_LEAD/EMPLOYEE (`api/users/route.ts:50`). A Space OWNER who is an EMPLOYEE sees only themselves in "Add people"; a Manager sees only their reports. Department/Office "Add all" is computed client-side from the same truncated list, so "Add all" adds only the subset they can see. This silently breaks sharing for every non-executive space owner.
  - Role select has no descriptions; "Workspace" visibility blurb "Members + org admins" is wrong for a folder-grantee and does not mention WORKSPACE is effectively the same as PRIVATE for non-members (both require a membership row; `getSpaceForReader` treats them identically at `space.ts:201-203`). Nothing in the product distinguishes PRIVATE from WORKSPACE at read time except the sidebar lock icon and the `Make Private` toggle label.
  - Any ADMIN can demote/remove the OWNER; the OWNER can remove themselves; no last-owner guard (`space.ts:432-436`).
  - Email invite creates an **org-level EMPLOYEE account** (`api/spaces/[id]/invitations/route.ts:136,159`) with full org membership (ORG-visible spaces, directory read, Docs, Tables...), although the dialog frames it as joining "this Space". There is no true guest/external account; the marketing page promises "Free guest accounts... never count toward seat billing".
  - Departments tab fetches `/api/departments` which is manager-only (`api/departments/route.ts:25`), so employees get an empty "No departments configured yet" state, which is a lie.

**ShareBoardDialog** (`share-board-dialog.tsx`)
- Opened from: board page Share (`board-share-button.tsx`), space page per-board "Share" link (`share-board-button.tsx`), board "..." > "Sharing & Permissions" (toasts "Share coming soon" when no handler, `board-more-menu.tsx:453`).
- Controls: Visibility cards ("Inherit Space" / "Private" / "Org-wide"), Add people search, Members list with role select (Owner / Can manage / Can edit / View only).
- Issues: same read-only gap; same truncated candidate list; the description "Anyone you add below gets access to this list, even without access to the Space" is **false for the page** (Broken #1); role labels differ from the Space dialog for the same enum.

**ShareFolderDialog** (`share-folder-dialog.tsx`)
- Opened from: folder "..." > "Sharing & Permissions" (`folder-more-menu.tsx:468-472`).
- Controls: Add people search with a role select before adding (Admin "Can edit + manage access" / Can edit / Can view); Shared-with list.
- Issues: OWNER role is hidden and rendered as "Admin" (`:296`), so an existing OWNER row silently shows as Admin and changing it demotes them; folder visibility (Private) cannot be changed here or anywhere after creation; the empty state says "Space members already have access" which is false for a PRIVATE folder; write requires resolver `canEdit` (Space OWNER/ADMIN, folder owner, folder ADMIN/OWNER) while the folder "..." menu is visible to every reader.

**Visibility toggles at create time**: NewSpaceDialog "Make Private" + "Default permission" select (Full edit / Edit / Comment / View) (`new-space-dialog.tsx:272-296`); NewFolderDialog "Make private"; NewBoardDialog / CreateListModal "private". The Space "Default permission" is stored in `Space.settings.defaultPermission` and **read by nothing** (`grep defaultPermission` finds only the dialog and the storage comment). It is a dead control shown on every Space creation.

**Space "..." menu** (`space-more-menu.tsx:462-533`): "Make Private" / "Make workspace-visible" toggle (WORKSPACE<->PRIVATE only; ORG only via the dialog); "Hide from sidebar" toasts "coming soon"; "Sharing & Permissions" at the bottom.

### 2.19 `/admin` (platform back-office)
- **Files**: `src/app/(admin)/layout.tsx`, `admin-shell.tsx`, `admin/page.tsx`, `admin/companies/page.tsx`, `admin/companies/[id]/page.tsx`, `admin/appsumo/page.tsx`, `admin/analytics/page.tsx`, `admin/staff/page.tsx`.
- **Reachable from**: URL only (admin host); no link from the app. Non-staff see a dark inline "Restricted" page with a lime accent (`layout.tsx:36-66`).
- **Back**: none in the shell; company detail has a ghost "back" button pushing `/admin/companies` (`companies/[id]/page.tsx:76`).
- **Top bar**: "WorkwrK Staff · Platform back-office" + email.
- **Sidebar**: Dashboard, Companies, AppSumo Codes, Analytics, Platform Staff; Log out.
- **Controls (staff page)**: add by email + name; list with remove (last-staff guard).
- **Controls (company detail)**: plan select (STARTER/GROWTH/SCALE/ENTERPRISE), status select incl. SUSPENDED, enterprise feature toggles (byok/whiteLabel/customDomain), gated to Enterprise.
- **UI state**: rough; uses the pre-OS `ui/` component set and `bg-background/text-muted` tokens, red accent; dark mode assumptions; not the Monday-clean OS style.
- **Issues**: no impersonation/support view; no way to reset a tenant's last COMPANY_ADMIN; suspended orgs: enforcement of `status` on login not verified here.

### 2.20 `/api/me/access` (debug endpoint)
- `?resource=board:<id>` returns the resolver decision + reason. Useful for support; no UI. Its `MODULE_NAMES` list (`route.ts:20-23`) omits `team/kpi-reviews` which `access.ts:43` defines.

### 2.21 `/features/access` (marketing)
- `src/app/(marketing)/features/access/page.tsx`. Claims: "Predefined roles (Admin, Manager, IC, Guest) + unlimited custom roles, granular per-hub per-action permissions", SAML SSO + SCIM (Okta, Azure AD...), scoped sharing with auto-expire, tamper-evident audit log with IP/device, data residency, free guest accounts. Reality: fixed 10-rung enum, no custom roles, no guest account type, no SSO UI, no share expiry, partial audit. Uses a **violet** gradient (`hue="violet"`) against the brand rule "no purple".

---

## 3. Broken / confusing

Severity: high = wrong outcome or security/UX trap; medium = dead/cosmetic control or clearly misleading; low = polish/consistency.

1. **[high] Direct List share does not open the List.** `ShareBoardDialog` adds a `BoardMember`; `/boards/[slug]/page.tsx:68` gates with `canRead` -> `resolveBoard` (`access.ts:201-227`) which never reads `BoardMember`. A non-Space-member who was shared a List gets `notFound()`. The dialog text at `share-board-dialog.tsx:294` promises the opposite. The sidebar tree also never lists it.
2. **[high] Page and data gates disagree (two access systems).** Pages use `access.ts`; item/board/table/file APIs use `board.ts`/`space.ts`. Divergences: Space ADMIN on a PRIVATE board (page OK, items 404, `board.ts:645-651`); FolderMember grantee on a PRIVATE folder's board (page OK, items 404, `board.ts:632-637`); Space MEMBER write rights (resolver read, API write); GUEST item owner (resolver edit, API deny). Every combination is reachable from the share dialogs.
3. **[high] "Add people" pickers are truncated by the caller's report tree.** All three share dialogs and `InviteModal` fetch `/api/users?scope=all` which downgrades non-org-wide callers to team scope (`api/users/route.ts:50-54`). An EMPLOYEE-level Space owner can share with nobody; a Manager only with their reports; "Add all" for a department adds only the visible subset. No error, no hint.
4. **[high] Org admin can grant SUPER_ADMIN, and self-demote without confirmation.** `/settings/members` select includes SUPER_ADMIN (`members/page.tsx:230`); `api/users/[id]/route.ts:191` accepts any enum value; the last-admin guard covers only COMPANY_ADMIN.
5. **[high] Rail tiers are not the permission.** Catalog `requiredAccess: "hr-admin"` on trash, kudos, candor, surveys, announcements, policies, agreements has **no page gate**; tools/assets are catalog hr-admin but server manager. `/settings/apps` floors are display-only by design. Managers and employees reach all of these by URL (kudos/surveys APIs have no tier check at all).
6. **[high] Space-level email invite silently creates a full org EMPLOYEE.** `api/spaces/[id]/invitations/route.ts:136,159`. Labelled as joining a Space; grants org-wide directory, ORG spaces, Docs, Tables, Talk.
7. **[medium] ~55 of ~75 permission-matrix cells enforce nothing** (section 1.3). The grid gives admins a false sense of control; the matrix also omits every work-OS module (Spaces/Lists/Docs/Tables/Talk).
8. **[medium] Share dialogs have no read-only state.** `SpaceShareButton` renders for every reader (`spaces/[slug]/page.tsx:612`); dialogs accept clicks and surface 403 toasts. Folder "..." Sharing item likewise.
9. **[medium] "Default permission" on Space creation is dead.** Stored in `settings.defaultPermission`, read by nothing (`new-space-dialog.tsx:272-282`, `space.ts:251`).
10. **[medium] Folder visibility is immutable after creation.** `updateFolder` has no `visibility`; no UI toggle; the only way to un-private a folder is to recreate it.
11. **[medium] Three role vocabularies for one enum + a fourth for SOP folders.** Space: Owner/Admin/Member/Guest; Board: Owner/Can manage/Can edit/View only; Folder: Admin/Can edit/Can view (Owner hidden); SOP: Viewer/Editor/Owner. No dialog explains what Member vs Guest can do; `resolveSpace` treats both as read while `canContributeSpace` lets Member write.
12. **[medium] WORKSPACE vs PRIVATE visibility are indistinguishable at read time** (`space.ts:194-204`), yet the UI presents three tiers with different blurbs. The "Make Private" toggle only changes a lock icon.
13. **[medium] Space ADMIN can remove/demote the OWNER; no last-owner guard; owner can remove self** (`space.ts:424-436`, `share-space-dialog.tsx:316-355`).
14. **[medium] Admin-door pages are not server-gated** (`/settings/permissions`, `/members`, `/hierarchy`, `/modules`, `/billing`, `/api`, `/locale`, `/scoring`, `/task-types`, `/integrations`, `/import-export`, `/notifications`, `/settings` overview). Non-admins get disabled controls and, on Members/Hierarchy, a team-scoped list mislabelled as the org.
15. **[medium] `useRole().isAdmin` includes C_LEVEL and HR** (`use-role.ts:17-22`) while every server admin gate is admin2. `/api/settings` PATCH and `/settings/locale` also let C_LEVEL edit org settings although the Admin door is hidden from C_LEVEL.
16. **[medium] HR segments exist only as dead code.** `HRSegment` + `hrCanReadUser` wired into `resolveUser` (`access.ts:312-314`) but no API/UI; an HR user with zero segments matches nobody there. HR actually reaches people through `ORG_WIDE_ALIGNMENT_LEVELS`.
17. **[medium] Security policy has no admin editor.** Settings overview cards "Password policy" / "Session & 2FA" link to the personal `/account/security` page which renders the policy read-only.
18. **[medium] SSO/SCIM promised (marketing, identity layout comment) but no UI.** `/api/scim`, `/api/scim-tokens`, `IdentityProvider` exist; nothing in Settings exposes them.
19. **[medium] Access changes are not audited.** `/api/permissions` PATCH, `/api/users/[id]` accessLevel changes, space/board/folder member and visibility changes write no ActivityLog; denied access is never logged (`access.ts:417`). The audit page and marketing claim otherwise.
20. **[medium] Job-title Role vs access Role.** `Role.level` is an `AccessLevel` but assigning a role never changes `User.accessLevel`; `/settings/permissions` is titled "Roles & Permissions"; roles empty state claims roles control what holders can see (`roles-client.tsx:319`); managers can create roles at COMPANY_ADMIN level.
21. **[medium] SOP folder OWNER cannot manage access.** UI copy says Owner "also manages access" (`folder-manager.tsx:326`) but `/api/sop-folders/[id]/access` is `isOrgAdmin` for GET and PATCH.
22. **[medium] `usePermission` cache never invalidated after saving the matrix** (`use-permission.ts:30-32` exported but uncalled; permissions page does not call it).
23. **[low] Three published access-level lists with different orders and HR placement** (`permissions.ts:20-31`, `access-levels.ts:39-48`, `structure/page.tsx:32-43`); `labelForAccessLevel` renders "Company Admin" from the enum in some places, "Admin"/"Super" short codes in the matrix header, "C-Suite"/"IC" in roles.
24. **[low] `route-guard.ts` redirects to `/dashboard`**, a route not on the rail (Home is `/today`); `page-gates.ts` redirects employees to `/people/me` and managers to `/team/reviews`. Two redirect conventions.
25. **[low] Settings overview cards self-link** ("Locale & finance", "Plan & billing" -> `/settings`); Retry CTA on error not wired.
26. **[low] `/settings/apps` lists offRail apps as if they were rail icons**; hiding them affects only the More launcher; command palette ignores org hidden/tier config (`command-palette.tsx:235`).
27. **[low] Audit page renders `OsTitleBar` inside SettingsShell**, producing a second header, unlike every other settings page.
28. **[low] Admin back-office styling** is a different design system (old `ui/`, red accent, dark "Restricted" page with `#d4ff2e`).
29. **[low] Marketing access page uses a violet gradient**, violating the brand palette rule.
30. **[low] `/api/me/access` module list drifts from `access.ts` (missing `team/kpi-reviews`).**
31. **[low] Reports-to select allows cycles; hierarchy view is solid-line only** while the resolver also honours dotted lines.
32. **[low] `resolveDoc` vs `docAccessible` disagree on admin read-around of personal NOTEPAD docs** (`access.ts:242-252` grants admin first; `doc-access.ts:74-81` denies everyone but the owner).

---

## 4. Cross-cutting conventions observed

- **Back navigation**: Settings pages rely on SettingsShell's "Back" and "X" (both `/today`, Esc too); no per-page BackButton. Some pages add a text breadcrumb ("Settings > Apps") that links to `/settings` (apps, defaults, structure); others (permissions, members, hierarchy, modules) have none. `/people/roles/[id]` follows the app-wide `BackButton fallbackHref` convention; the admin back-office uses `router.push` ghost buttons. Redirect targets on denial differ: `/dashboard` (route-guard), `/people/me` or `/team/reviews` (page-gates), inline lock card (structure), `/login` (admin).
- **Loaders**: mixed. `ValueLoader` (brand values) on settings overview, audit, roles; `Loader2` spinner + "Loading ..." text on permissions, members, hierarchy, apps, modules, defaults, staff; `DotsLoader` fallback in the dashboard boot; share dialogs use plain "Loading..." text.
- **Empty / error states**: settings overview and audit use `OsEmptyView`; permissions/members/hierarchy have inline zinc text or none (members shows an empty table for a one-person org); share dialogs have inline grey sentences; error handling is toast-only in dialogs and apps/modules/defaults pages, banner on permissions, red box on members. Departments tab in the Space dialog shows "No departments configured yet" when the API actually 403'd.
- **Style consistency**: the OS shell and settings overview/audit/apps/defaults/structure are on `--os-*` tokens and brand blue `#0073EA`, flat, Monday-clean. Permissions, members, hierarchy, modules are Tailwind zinc with native form controls and `accent-zinc-900` checkboxes (black accent, not brand blue); H1 sizes vary (16px / 19px / 20px). Share dialogs use `border-zinc-900 ring-zinc-900` black selected states and `bg-zinc-900` tab pills (black accent) but brand-blue buttons. SOP folder manager and the admin back-office use the legacy `ui/` Card/Badge/Button set. `useConfirm` dialogs are used consistently for destructive member removal.
- **Mobile / responsive**: SettingsShell has a fixed 248px nav with no breakpoint (`settings-shell.tsx:185`); the permissions grid is a 11-column table inside `overflow-x-auto` per module; members table has no responsive treatment; share dialogs are fixed `max-w-[520px]` with absolute dropdowns; `os.css` has 135 `@media` rules but the settings pages in this subsystem use almost no `sm:`/`md:` utilities (6 hits across permissions/members/apps combined). Effectively desktop-only.
- **Feedback**: autosave-with-toast (apps, modules, defaults) vs explicit Save bar (permissions, SOP access) vs per-row optimistic PATCH (members). No consistency rule.
- **Copy**: uses en/em dashes and "..." in UI strings throughout (`"Loading permissions…"`, `"You need Company Admin to make changes — this view is read-only."`), against the project's no-double-dash writing rule.

---

## 5. Access notes (who can see/do what)

- **Platform staff** (PlatformAdmin email): `/admin/*` only; cannot enter a tenant. Tenant admins cannot enter `/admin`.
- **SUPER_ADMIN / COMPANY_ADMIN**: everything in the org (resolver "admin" on every resource; every legacy gate short-circuits; matrix always true; Admin door; `/api/permissions` PATCH; `/api/org/preferences` PATCH; module toggles; API keys; SCIM tokens; exports; audit). Only COMPANY_ADMIN has a last-admin guard.
- **C_LEVEL / VP / DIRECTOR**: org-wide alignment data (`ORG_WIDE_ALIGNMENT_LEVELS`), whole directory (`/api/users` scope=all), `resolveUser` edit on their report tree, Rollup, matrix `executiveAccess`; **no Admin door** yet C_LEVEL may PATCH `/api/settings` (locale, security policy, company profile) and `useRole().isAdmin` is true for C_LEVEL.
- **HR**: manager tier everywhere + `hr-admin` rail tier (review cycles, culture apps, tools/assets, policies/contracts, trash) + org-wide alignment scope; `hrAccess` matrix; `isAdmin` true in `use-role`. HR segments unusable.
- **MANAGER / TEAM_LEAD**: identical everywhere (Teams hub, `/api/users` team scope, `canTouchUserAlignment` on their tree, matrix `managerAccess`, automation manager role, create users/roles/departments/offices, delete users (`api/users/[id]` DELETE is `isManager`)). Cannot see the whole directory, which breaks their share pickers.
- **EMPLOYEE / AGENT**: Door 1 (`/people/me`), own goals, any ORG-visible Space, Spaces/Folders/Boards they are members of; can create Spaces (become OWNER) but can only share with themselves (picker truncation); can reach hr-admin-tier pages by URL where no page gate exists (trash, kudos, surveys, candor, announcements, policies, agreements) and every Admin-door settings page that lacks a layout gate (read-only). AGENT differs from EMPLOYEE only in matrix defaults (`tasks.delete:false`).
- **Container roles**: OWNER = ADMIN for everything except that only OWNER pierces a PRIVATE board in board.ts; MEMBER reads (resolver) or writes content (board.ts); GUEST reads. A Space ADMIN can remove the OWNER. Board OWNER/ADMIN manage that board; a FolderMember ADMIN/OWNER can share the folder; folder owner has edit.
- **Inconsistencies** (see section 1.6 and Broken 1-6, 15, 16): two resolvers; report-tree-scoped user lists inside share pickers; C_LEVEL/HR "admin" in the client hook only; rail tier != page gate; matrix cells unenforced; Space email invites mint org employees.

---

## 6. Settings notes (configurable vs should be)

**Configurable today (admin2 only unless noted)**
- Permission matrix cells (16 legacy modules) at `/settings/permissions` (mostly unenforced).
- Per-person access level and reporting manager at `/settings/members`; invite with level/department/role/manager.
- Rail order / hidden apps / per-app tier floor at `/settings/apps` (display only).
- Premium modules on/off at `/settings/modules`.
- Theme/density/sidebar/home-card defaults and locks at `/settings/defaults`.
- Per-Space visibility (3 values) + members/roles + department/office bulk add + email invites (Space OWNER/ADMIN or admin2).
- Per-Board visibility + members/roles (board owner, BoardMember OWNER/ADMIN, Space OWNER, admin2).
- Per-Folder members/roles (folder owner/ADMIN/OWNER, Space OWNER/ADMIN, admin2); folder Private only at creation.
- SOP folder access lists with Viewer/Editor/Owner (admin2 only).
- API keys with READ/WRITE/ADMIN scopes; SCIM tokens (API only).
- Company domain (locks invites to that domain) at `/settings/identity`.
- Plan / status / enterprise flags (platform staff only).

**Should be configurable but is not**
- Custom roles or renaming/reordering the ladder (fixed enum; the structure page says so explicitly).
- Default visibility for new Spaces/Folders/Lists; whether members may create Spaces; whether employees may create org-wide (ORG) spaces.
- Who may invite (matrix `people.create` exists but the rail "Invite" button and modal are shown to everyone; the API enforces).
- Guest / external account type with no org-wide access and no seat; share-link expiry.
- Org security policy editor (password rules, session timeout, org-wide MFA).
- SSO (SAML) and SCIM setup in Settings.
- Which Admin-door pages a "billing admin" or "people admin" may reach (one flat admin2 tier).
- Per-module permissions for the actual work OS (Spaces/Lists/Docs/Tables/Talk/Automation): who can create/delete/share/export.
- Effective-permission viewer ("what can Priya see, and why"): `/api/me/access` has the reasons but no UI, and only for the caller.
- HR segments (model exists, no UI).
- Audit of permission/membership changes; denied-access log; retention settings.
- Folder visibility after creation; Space "Default permission" (stored, unused).
- Last-owner and self-demotion protections for Spaces; explicit ownership transfer.
- Whether hidden rail apps are also blocked (today: never).

---

## 7. What a clean "any business can adopt this" model would need

1. **One authority.** Delete the parallel gates: make `board.ts`/`space.ts`/`folder.ts`/`doc-access.ts`/`sop-access.ts` thin wrappers over a single resolver that knows SpaceMember, FolderMember, BoardMember, Visibility, ownership and the org tier, and returns `read | comment | edit | manage | admin`. Every page and every API call the same function. Add a `contribute` level so "Member can write content but not manage" is a first-class answer instead of two functions disagreeing.
2. **One tier ladder, one source.** A single `tiers.ts` exporting the ordered enum, labels, short labels, descriptions and the three derived sets; delete the 25 copies. Decide where HR sits and whether TEAM_LEAD is distinct from MANAGER (today it is not).
3. **Separate the three concepts the UI conflates**: (a) org tier = which doors open (Admin door, Teams cockpit, own profile); (b) job title = KRA/KPI/SOP template, no access meaning; (c) container role = per Space/Folder/List. Rename `/settings/permissions` to "Access levels" and `/people/roles` to "Job titles" or make Role assignment actually set the tier.
4. **One sharing vocabulary and one dialog** for Space/Folder/List/SOP folder/Doc: "Can view / Can edit / Can manage / Owner", the same order, the same blurbs, a read-only mode, an "inherited from Space" row, a last-owner guard and explicit "Transfer ownership". Kill WORKSPACE-vs-PRIVATE as separate tiers or make WORKSPACE mean something (e.g. everyone in the org can *find* it and request access).
5. **Full-directory pickers.** People pickers must list the whole org (name/avatar/department only) regardless of the caller's tier; scope restrictions belong to *what data* a manager can read, not *whom* they can share with.
6. **Real guests.** A GUEST account type at the org level: no directory, no ORG spaces, only explicit grants, no seat. Space email invites should create that, not EMPLOYEE.
7. **Enforce or remove.** Every matrix cell either has a server call site or is deleted; rebuild the matrix around the actual product surface (Spaces, Lists, Docs, Tables, Talk, Goals, People, Automation, Settings) with 4-6 verbs each. Show "enforced" state and a diff-from-default; audit every save.
8. **Rail tier == page gate.** Derive the server gate from the catalog entry (one `requiredAccess` read by both the rail and a shared layout guard) so hiding an app is the permission, and org floors set at `/settings/apps` are enforced, not decorative.
9. **Admin door gating in one layout** (`settings/layout.tsx`) with a proper "This area is for admins" card, and sub-tiers if needed (billing admin, people admin).
10. **Explainability**: a "Check access" panel (who can see this Space/List, and why) built on `resolveAccess`'s `reason` strings, exposed on every share dialog and on a person's profile for admins.
11. **Audit everything about access**: tier changes, matrix saves, membership and visibility changes, denials; show them in `/settings/audit` under an "Access" filter.
12. **Security policy + SSO/SCIM + guest/share-link expiry** as real Admin-door pages, or remove the marketing claims.
