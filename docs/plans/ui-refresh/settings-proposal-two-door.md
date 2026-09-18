# WorkwrK Settings architecture proposal: "Two doors"

Author stance: two separate full-screen settings takeovers. **My Settings** is everything a person changes about themselves. **Workspace Settings** is everything an org admin configures. Each has its own sidebar, its own entry point and its own gate. Every settings or account page that exists today is mapped to exactly one door, or explicitly merged or removed in the disposition table (section 3). Nothing visible is cosmetic (section 5).

Date: 2026-09-11. Grounded in the code at `src/app/(dashboard)/settings/**`, `src/app/(dashboard)/account/**`, `src/components/layout/os/settings-shell.tsx`, `src/lib/preferences.ts`, `src/app/api/settings/route.ts`, `src/app/api/preferences/route.ts`, `src/app/api/org/preferences/route.ts`, `prisma/schema.prisma`, and the audit inventories (`settings-pages.md`, `access-model.md`, `critic-gaps.json`, `existing-direction.md`, `phase2-inputs.md`, `zoho-reference.md`).

Writing rule honoured: no em dashes, no double hyphens.

---

## 0. The one-paragraph pitch

A new employee should never see a settings page that is not about them. An admin should never hunt for the org switch inside a list of personal toggles. So: the avatar menu opens **My Settings** (6 pages, everyone). The rail's Settings hub opens **Workspace Settings** (14 pages, SUPER_ADMIN and COMPANY_ADMIN only; the hub icon itself is hidden from everyone else). One server gate in `settings/layout.tsx` replaces the seven-of-twenty-one patchwork. One persistence rule replaces localStorage-only state: if a control renders inside either door, its value lives in the database and round-trips through one of four API surfaces. One back rule: Back, Close and Esc return to where the user came from, never to a hard-coded `/today`.

Why two doors and not one merged list (the Phase 2 brief's Q8 default): the audit's biggest settings failures are access failures (14 admin pages with no server gate, employees seeing disabled admin controls, C_LEVEL editing org settings by URL). A single list needs per-row gating and read-only rendering on every admin page. Two doors need one gate. That is the simpler thing to build and the simpler thing to explain: "your settings" versus "the company's settings" is a distinction every business already understands.

---

## 1. Doors and entry points

### 1.1 Door 1: My Settings (`/account/*`)

| | |
|---|---|
| Who | every signed-in member, every access level including AGENT and GUEST-type accounts |
| Route prefix | `/account/*` (already the Personal prefix; `/settings/notifications` moves here) |
| Shell | `SettingsShell` variant `door="me"`: header "Back to app" + breadcrumb `{First name} › My settings › {Page}`, 248px sidebar, white content |
| Gate | signed-in session only (`requireSessionUser()` in `account/layout.tsx`) |
| Rail | no rail entry; the rail is for hubs |

Entry points (all existing entries are re-pointed, none removed):

| Entry | Today | Proposed |
|---|---|---|
| Avatar menu "Settings" | `/settings` | "My settings" → `/account/profile` |
| Avatar menu "Notifications" | `/inbox` | `/account/notifications` (Inbox keeps its own bell) |
| Avatar menu "Themes" | `/settings?tab=themes` (dead) | inline Light / Dark / System segmented control in the menu, persisted; "More appearance…" → `/account/preferences#appearance` |
| Avatar menu "Keyboard shortcuts" | `/settings?tab=shortcuts` (dead) | `/account/shortcuts`; also the `?` overlay |
| Avatar menu "My Profile" | `/people/me` | unchanged (career profile stays in Teams) |
| People profile (self) "Edit personal info" | `/account/profile` | unchanged |
| `/account/security` links from Overview cards | admin lands on a personal page | those Overview cards now point to Workspace › Security |
| Planner "Connect Google Calendar" banner success redirect | `/settings/calendar?connected=1` (stub) | `/account/connections?connected=google` |
| `/account` (bare) | 404 | redirect → `/account/profile` |

### 1.2 Door 2: Workspace Settings (`/settings/*`)

| | |
|---|---|
| Who | SUPER_ADMIN, COMPANY_ADMIN only (the `ORG_ADMIN_LEVELS` set; single source after section 5.4) |
| Route prefix | `/settings/*` |
| Shell | `SettingsShell` variant `door="workspace"`: header "Back to app" + breadcrumb `{Org name} › Workspace settings › {Page}`, 248px sidebar with group labels |
| Gate | `settings/layout.tsx` calls `requireWorkspaceAdmin()`. Non-admins get a 403 page inside the shell ("Workspace settings are managed by your admins. Ask {first admin name}." with a "Go to my settings" button), never a redirect to `/dashboard`. Every `/api/settings`, `/api/org/preferences`, `/api/permissions`, `/api/keys`, `/api/scim-tokens`, `/api/products/installations`, `/api/item-types`, `/api/tags` write uses the same set. C_LEVEL loses its API-only write to `/api/settings` (it was never in the door; this closes the mismatch). |
| Rail | the existing `settings` AppEntry keeps `alwaysPinned` but gains `requiredAccess: "org-admin"`; `visibleRailApps` already filters by catalog baseline before the alwaysPinned escape hatch is needed, so the hub disappears for non-admins. `home` remains the guaranteed never-empty rail entry. |

Entry points:

| Entry | Today | Proposed |
|---|---|---|
| Rail "Settings" hub | `/settings` (its hub sidebar is dead in settings mode) | `/settings` (Overview); the `SettingsSidebar` component in apps-catalog is deleted (its rows are re-parented, see 3.3) |
| Avatar menu | no admin row | "Workspace settings" row, admins only, → `/settings` |
| Rail bottom "Upgrade" | `/settings` Overview | `/settings/billing`, rendered only for admins on non-Enterprise plans |
| Workspace menu "Upgrade" | `/settings/billing` | unchanged |
| Workspace menu "Manage members" | `/settings/members` | unchanged |
| Workspace menu "Invite people" | `/settings/members` | `/settings/members?invite=1` opens the invite modal on load |
| Workspace menu "Delete workspace" | dialog | moves to Workspace › Identity › Danger zone; the menu row deep-links there |
| Board "…" "Default task type" and create-task type picker footer | `/settings/task-types` | `/settings/tasks?tab=types` (old URL redirects) |
| ModuleDisabled gate "Enable in Settings › Modules" | `/settings/modules` | `/settings/apps#modules` (old URL redirects); non-admins see "Ask an admin to enable Talk" with no link |
| Org chart "Org settings", "fix in Members" | `/settings`, `/settings/members` | `/settings/structure?tab=chart`, `/settings/members` |
| Admin setup checklist | `/organization`, `/settings` | correct targets (7.2) |
| Admin tour steps 1 to 3 | `/organization`, `/settings` with stale labels | `/settings/identity`, `/settings/members`, `/settings/permissions`, copy rewritten |
| Command palette "Settings" | `/settings` | two entries: "My settings" (everyone), "Workspace settings" (admins). The palette filters by `canAccessApp` (fixes the leak in `command-palette.tsx:235`). |
| Tools / Assets / Integrations pages "Settings" nav-link | `/settings` | removed from Tools and Assets (they move to Teams); Integrations page links to `/settings/api` |

### 1.3 What each door is NOT

- Object-scoped settings (a Space's visibility, a List's statuses, a Folder's sharing, a Doc's permissions) stay in the object's "…" menu and dialogs. They never appear in either door. The share dialogs get the read-only mode and the full-directory picker the access audit asks for, but that is the sharing spec's job, not this one.
- Manager work (a report's department, role, manager, KRAs) stays in the Teams hub on the person's profile. Managers do not get a reduced Members page; `/settings/members` is admin-only and the manager path is Teams › Directory › person.
- Talent 9-box, Reviews, Kudos, Surveys, Candor, Announcements: Teams and Talk hub content, untouched by this spec. `/talent` remains reachable from the Teams sidebar row "Talent (9-box)" (`apps-catalog.tsx:1105`, `:1324`) and from Reviews. Not a setting.

---

## 2. Information architecture

Every page lists its fields as: **Field** · default · persists at · who changes it · notes. "admin" means SUPER_ADMIN or COMPANY_ADMIN. "self" means the signed-in user for their own row. Autosave (A) means the control writes on change with an inline "Saved" tick; Save bar (S) means the page collects edits and a sticky bar appears only when dirty.

### 2.1 Door 1: My Settings

Sidebar (flat list, no group labels, Zoho row style):

```
My settings
  Profile                 /account/profile
  Preferences             /account/preferences
  Notifications           /account/notifications
  Security                /account/security
  Calendar & connections  /account/connections
  Keyboard shortcuts      /account/shortcuts
```

#### 2.1.1 Profile (`/account/profile`) · Save bar

| Field | Default | Persists | Who | Notes |
|---|---|---|---|---|
| Photo | none (initials) | `User.avatar` via `POST/DELETE /api/users/[id]/avatar` | self | uploads save instantly (A), the rest of the form is S |
| First name, Last name | from invite | `User.firstName/lastName` via `PATCH /api/users/[id]` | self | required |
| Phone | empty | `User.phone` | self | API already accepts it, page never exposed it |
| Date of birth | empty | `User.dateOfBirth` | self | shown to self and managers only |
| Email | from invite | `User.email` | read-only | caption "Managed by your workspace admin". No fake "change" control until an email-change flow exists |
| Job title, Department, Access level, Reports to | read-only chips | `User.roleId/departmentId/accessLevel/managerId` | admin (Members), manager (Teams) | chips link to `/people/me`; labels via `labelForAccessLevel` (never the raw enum) |
| Danger zone: Delete my account | | `POST /api/me/delete` (exists, no UI today) | self | typed confirmation "DELETE"; refused with a clear message for the last COMPANY_ADMIN |

#### 2.1.2 Preferences (`/account/preferences`) · Autosave; text tabs Appearance | Language & region | Sidebar

Appearance tab:

| Field | Default | Persists | Who | Notes |
|---|---|---|---|---|
| Theme | Light | `UserPreference.theme.appearance` (LIGHT/DARK/AUTO) | self | greyed with "Set by your workspace" when `theme.appearance` is in `OrgPreference.lockedKeys` |
| Accent | workwrk (brand blue) | `UserPreference.theme.accent` | self | ONE vocabulary shared with Workspace › Identity › Appearance defaults: `workwrk, black, blue, teal, mint, orange, bronze`. Purple, violet, pink, indigo are deleted from the picker and normalised to `workwrk` on read (`ThemeApplier`). Founder may later cut this to blue only (Phase 2 Q4); the row then disappears, nothing else changes |
| Density | Cozy | `UserPreference.density` | self | the `workwrk:density` localStorage key in `lib/density.ts` is removed; the applier reads effective prefs |
| Reduced motion | follows OS | `UserPreference.theme.reducedMotion` (new key inside the existing JSON) | self | `ThemeApplier` sets `data-reduced-motion` |
| Show upcoming features | off | `UserPreference.theme.showUpcoming` (new key) | self | reveals rows marked "Coming soon" across both doors (Phase 2 brief Q15 default) |

Language & region tab (new; the audit found no per-user timezone anywhere):

| Field | Default | Persists | Who | Notes |
|---|---|---|---|---|
| Language | workspace default | `UserPreference.locale.language` | self | list = the 11 `messages/*.json` catalogs; wires to `src/i18n/request.ts` so the setting is real |
| Time zone | auto-detected on first sign-in, else workspace default | `UserPreference.locale.timezone` (IANA) | self | searchable IANA list with "Use device time zone" |
| Week starts on | workspace default | `UserPreference.locale.weekStart` (`MON`/`SUN`) | self | consumed by Planner, DatePlanner, board calendar, timesheets (today they disagree) |
| Date format, Time format | workspace default | `UserPreference.locale.dateFormat` / `.timeFormat` | self | `DMY`/`MDY`/`YMD`; `12h`/`24h` |

`UserPreference.locale` is a new `Json?` column (one additive migration). Until the migration lands on prod the page is not shipped; no half-persisted state.

Sidebar tab:

| Field | Default | Persists | Who | Notes |
|---|---|---|---|---|
| Sidebar width | 260 | `UserPreference.sidebar.width` (new key) | self | replaces the `workwrk:os:sidebar-width` localStorage key in `click-sidebar.tsx`; drag still writes it, debounced 500ms |
| Start collapsed | off | `UserPreference.sidebar.collapsed` (new key) | self | replaces `workwrk:os:sidebar-collapsed` |
| Icons only rail | off | `UserPreference.sidebar.iconsOnly` (exists) | self | the Phase 2 brief proposes dropping this option; if kept it persists here. Greyed when `sidebar.iconsOnly` is locked |
| Section order, Home cards | catalog order, all on | `UserPreference.sidebar.sectionsOrder`, `UserPreference.home.cards` | self | shown here AND in the Customize Sidebar panel; the panel stays (memory `feedback_customize_sidebar`) and both write the same keys. `home.cards` must be read by the Work sidebar / Space overview or the row is removed (audit: never read today). Decision: read it. |

#### 2.1.3 Notifications (`/account/notifications`) · Autosave; text tabs Inbox | Email | Desktop

| Field | Default | Persists | Who | Notes |
|---|---|---|---|---|
| Inbox: Task assigned, @Mentions, Comments, Status changes, Due reminders, Kudos | all on | `UserPreference.notifications.inbox.{key}` | self | keys unchanged from `notify-prefs.ts`; the object moves from `home.notifications` to a new `notifications Json?` column with a one-time copy in the same migration as `locale` |
| Inbox display: Show all in Other, group by date, auto-clear read after N days | as today | `UserPreference.notifications.inboxView` | self | replaces the Inbox gear that PATCHes `{inbox}` which the zod schema strips (the audit's "Inbox prefs stripped" bug) |
| Mute all notifications until | off | `UserPreference.notifications.mutedUntil` (ISO or null) | self | the profile-menu "Mute notifications" toggle writes this instead of `workwrk:os:muted-notifs`; `notify-prefs.shouldNotify` honours it |
| Email: master switch, Task assigned, Kudos | on | `UserPreference.notifications.email.{key}` (Kudos also `EmailPreference.kudosNotifications`) | self | rows whose sender does not exist (Mentions, Comments, Status, Due, Daily digest) are hidden unless "Show upcoming features" is on; then they render disabled with "Coming soon" |
| Email: KRA & KPI updates, Review reminders, SOP updates | on | `EmailPreference` columns via `PATCH /api/email-preferences` | self | unchanged |
| Desktop: Browser notifications | off | `UserPreference.notifications.desktop` + browser permission | self | replaces `desktop-notifications-pref` localStorage in `use-desktop-notifications.ts`; the row shows the browser permission state and a "Re-request" action |

#### 2.1.4 Security (`/account/security`) · mixed

| Field | Default | Persists | Who | Notes |
|---|---|---|---|---|
| Email verified | from signup | `User.emailVerifiedAt` | self (Resend) | unchanged |
| Two-factor (TOTP) | off unless org requires | `User.mfaEnabled/mfaSecret/mfaBackupCodes` | self | Enable / Turn off / Regenerate backup codes. When Workspace › Security requires MFA, "Turn off" is disabled with "Required by your workspace" |
| Password | | `POST /api/me/change-password` | self | validated with `validatePassword(policyFromOrgSettings())`, so the org policy is enforced at change time, not only at signup |
| Sessions | | `POST /api/me/sign-out-everywhere` | self | "Sign out everywhere". A device list is hidden until a session table exists (upcoming) |
| Recent security activity | | `GET /api/me/security-activity` | read | unchanged |
| Workspace policy (read-only card) | | `Organization.settings.security` | read | rows: min length, uppercase, numbers, idle timeout, MFA required. Caption for admins: "Edit in Workspace settings › Security" (link); for others: "Set by your workspace admin" |
| Presence | Active | `UserPreference.shell.presence` (new key) | self | the profile-menu presence picker writes here instead of `workwrk:os:presence`; Talk reads it |

The made-up "security score" is removed (fabricated heuristic).

#### 2.1.5 Calendar & connections (`/account/connections`) · Autosave

| Field | Default | Persists | Who | Notes |
|---|---|---|---|---|
| Google Calendar | not connected | `CalendarSubscription` rows (per user, `provider: GOOGLE`) via `/api/integrations/google-calendar/*` | self | Connect (OAuth), choose calendars, Disconnect (deletes GCAL tasks + subscriptions, as the API already does). This is the real backend the audit's `time.md` found; `/settings/calendar` was the stub |
| Personal ICS feed | none | `/api/calendar/ics/token` | self | "Create feed URL", copy, rotate |
| Outlook, iCloud, Fastmail | | none | | hidden unless "Show upcoming features"; then "Coming soon" |

#### 2.1.6 Keyboard shortcuts (`/account/shortcuts`) · read-only

A reference table of chords that actually work (⌘K search, ⌘J, ⌘B, ⌘⇧K, ⌘⇧N quick capture, ⌘1 to 9, doc ⌘L/⌘D, sheet ⌘F/⌘H). The dead `g` chords are not listed until `use-goto-nav` is mounted. The same table renders in the `?` overlay. No settings persist here; it exists so the avatar-menu row has a destination.

### 2.2 Door 2: Workspace Settings

Sidebar (group labels in 12px uppercase with a rule, Zoho style):

```
Workspace settings
  Overview                  /settings
WORKSPACE
  Identity & culture        /settings/identity      tabs: Profile | Culture | Appearance defaults | Danger zone
  Locale & finance          /settings/locale
  Apps & modules            /settings/apps          sections: Modules, Rail apps
PEOPLE
  Members                   /settings/members       tabs: All | Admins | Pending invites | Deactivated
  Structure                 /settings/structure     tabs: Departments | Roles | Offices | Org chart
  Access & permissions      /settings/permissions   tabs: Access levels | Permissions | Sharing defaults
WORK
  Task system               /settings/tasks         tabs: Task types | Tags | Templates
  Scoring & reviews         /settings/scoring
SECURITY & DATA
  Security                  /settings/security      tabs: Policy | Single sign-on | Provisioning (SCIM)
  Data                      /settings/data          tabs: Export | Import | Retention | Trash
  Audit log                 /settings/audit
  API & webhooks            /settings/api           tabs: API keys | Webhooks
BILLING
  Plan & billing            /settings/billing
```

#### 2.2.1 Overview (`/settings`)

A card grid, one card per sidebar page, each showing two live values and linking to its page (no self-links). The first-run setup checklist (7.2) renders above the grid until complete, then collapses to a "Setup complete" line. Cards for Usage link inside the door (`/settings/members`, `/settings/billing`), not out to `/people` or `/analytics`.

#### 2.2.2 Identity & culture (`/settings/identity`) · Save bar per tab

Profile tab:

| Field | Default | Persists | Who |
|---|---|---|---|
| Logo | none | `Organization.logo` via `/api/settings/logo` (A) | admin |
| Workspace name | from signup | `Organization.name` (`section: general`) | admin |
| Primary email domain | from first admin's email | `Organization.domain` | admin; used by invitations and by Security › "Allow sign-up with this domain" |
| Industry, Business type, Team size | empty | `Organization.settings.industry/businessType/teamSize` | admin; `businessType`/`teamSize` are read by Overview today and never written; now written here |

Culture tab:

| Field | Default | Persists | Who |
|---|---|---|---|
| Mission, Vision, About | empty | `Organization.settings.companyProfile.*` | admin |
| Core values (chips) | empty | `companyProfile.values[]` | admin; feeds the loader, the splash, Kudos |
| Welcome splash | "Every app open" (current behaviour, 10 min throttle) | `companyProfile.splash` = `every-open` / `first-open-daily` / `off` | admin; makes the loader-friction question (Phase 2 Q3) an org choice instead of a founder-only call; default preserves what the founder asked for |

Appearance defaults tab (absorbs `/settings/defaults`):

| Field | Default | Persists | Who |
|---|---|---|---|
| Default theme, accent, density | Light, workwrk, Cozy | `OrgPreference.themeDefault`, `densityDefault` via `PATCH /api/org/preferences` (A) | admin |
| Lock theme / density / sidebar layout / home cards | all unlocked | `OrgPreference.lockedKeys` (A) | admin; locked keys render greyed in My Settings › Preferences AND in the Customize panel (the audit found the panel does not grey them yet; that is fixed in the same change) |

Danger zone tab:

| Field | Persists | Who |
|---|---|---|
| Transfer ownership (make another member COMPANY_ADMIN, then optionally demote self) | `PATCH /api/users/[id]` | admin; explicit confirm "You will lose access to Workspace settings" |
| Delete workspace | `POST /api/organizations/delete` (exists) | COMPANY_ADMIN only; typed confirmation of the workspace name; 14-day restore via `/api/organizations/restore` |

#### 2.2.3 Locale & finance (`/settings/locale`) · Save bar

| Field | Default | Persists | Who | Notes |
|---|---|---|---|---|
| Time zone | detected from the first admin at signup, else `Asia/Kolkata` | `settings.timezone` (IANA) | admin | searchable full IANA list; a saved value outside the list can no longer render blank |
| Currency | `INR` | `settings.currency` (ISO 4217) | admin | full ISO list |
| Fiscal year starts | April | `settings.fiscalYearStart` (integer month 1 to 12) | admin | ONE representation; the `"MM-01"` string form is migrated on read and rewritten on save |
| Default language | `en` | `settings.language` | admin | now consumed: new users' effective locale falls back to it (`getEffectivePreferences` merges `locale` like theme) |
| Week starts on, Date format, Time format | Monday, DMY, 24h | `settings.locale.weekStart/dateFormat/timeFormat` | admin | org defaults under the personal overrides |

#### 2.2.4 Apps & modules (`/settings/apps`) · Autosave

Section Modules (absorbs `/settings/modules`): one bordered card per `MODULES` entry (Talk, Tables): name, one line, "competes with" caption, a Switch. Persists as `ProductInstallation` via `POST/DELETE /api/products/installations`. Turning a module off shows a confirm that names what becomes unreachable. Links "Open Talk" / "Open Tables" appear when on.

Section Rail apps: the existing order / hide / floor table, grouped by hub with the folded apps listed under their hub and labelled "in {Hub} sidebar", so an admin understands that hiding Goals removes a sidebar row, not a rail icon. Persists as `OrgPreference.sidebarDefault.apps` (unchanged shape). Change: the per-app floor and hidden flag become **enforced** by a shared `requireAppAccess(appKey)` layout guard derived from the catalog entry plus the org config (access-model §7 item 8). The caption "display only" is deleted because it stops being true. "Reset to default order" button added. Footer links: Build apps (`/build`), Marketplace (`/store`) (re-parented from the dead Settings hub sidebar).

#### 2.2.5 Members (`/settings/members`) · row-level autosave + modals

Zoho list page: title "Members", text tabs All | Admins | Pending invites | Deactivated, toolbar Filter (department, access level, status) + Sort left, one blue "Invite" right, bordered table with footer "Total members N · 1 to 50 ‹ ›" (server pagination, `?cursor`).

| Column / control | Persists | Who | Notes |
|---|---|---|---|
| Person (avatar, name, email) | | | row click → `/people/[id]` |
| Access level (select) | `User.accessLevel` via `PATCH /api/users/[id]` | admin | options = the 8 `access-levels.ts` values plus COMPANY_ADMIN; SUPER_ADMIN is never offered (API value whitelist added). Promotion to COMPANY_ADMIN and self-demotion each confirm. Caption after save: "Takes effect at their next sign-in" (JWT refresh) |
| Department, Job title (selects) | `User.departmentId/roleId` | admin | API already accepts; page never exposed |
| Reports to (searchable picker) | `User.managerId` | admin | cycle check added server-side |
| Status | `User.status` | admin | Deactivate / Reactivate; Remove = existing `DELETE /api/users/[id]` with typed confirm |
| Bulk bar | same APIs | admin | change level, department, deactivate |
| Invite modal | `POST /api/invitations` | admin (and anyone the matrix cell `people.create` allows, which stays enforced) | fields unchanged: emails, access level, department, role, manager; domain mismatch warning |
| Pending invites tab | `GET/DELETE /api/invitations` | admin | resend, revoke, copy link |

Data source is `/api/users?scope=all`, which for admins is the org. Because the page is admin-gated, the silent team-scope coercion can no longer mislabel a manager's team as the org.

#### 2.2.6 Structure (`/settings/structure`) · tabs

| Tab | What | Persists | Who |
|---|---|---|---|
| Departments | the existing departments manager (same component as `/people/departments`), rendered inside the door | `Department` via `/api/departments` | admin here; managers keep `/people/departments` in Teams |
| Roles (job titles) | the existing roles list (same component as `/people/roles`); the "level" field is relabelled "Seniority band" and its copy stops claiming it controls access (access-model Broken #20) | `Role` | admin here; managers keep `/people/roles` |
| Offices | real CRUD (name, address, city, country, time zone, HQ flag) | `Office` via `/api/offices` (exists, "Coming soon" tile today) | admin |
| Org chart | embeds the `/organization` chart client (canonical, cycle-safe); `/settings/hierarchy` redirects here | read | admin |

#### 2.2.7 Access & permissions (`/settings/permissions`) · tabs

Access levels tab: the 10-rung ladder rendered from ONE module (`src/lib/tiers.ts`, section 5.4) with label, one-line description, live head-count and the three derived tiers (manager / hr-admin / org-admin) shown as badges. Read-only. Replaces the hand-written prose in `structure/page.tsx`.

Permissions tab (Save bar): the matrix rebuilt honestly.

| Rule | Detail |
|---|---|
| Only enforced cells render | today's live set: `people.create`, `sops.create/edit/publish/delete`, `kras.create/edit/delete/assign`, `announcements.create`, `policies.create`, `assets.create/edit/delete`. Unenforced modules (meetings, surveys, ideas, analytics, tools, settings, organization, reviews, okrs, tasks) are hidden; with "Show upcoming features" they render disabled with "Not enforced yet". As each gains a server call site it flips to live. This is the "enforce or remove" rule from access-model §7.7 |
| Columns | the 8 editable levels; SUPER_ADMIN and COMPANY_ADMIN are shown as a single locked "Admins: always" column |
| Controls | per-row "all / none", "Reset to defaults", "Show changes from default" diff, search |
| Persistence | `Organization.settings.permissions` via `PATCH /api/permissions`; the save calls `invalidatePermissionCache()` and writes an ActivityLog row `permissions.update` |

Sharing defaults tab (Autosave; new, fixes the dead "Default permission" control and the unconfigurable defaults):

| Field | Default | Persists | Notes |
|---|---|---|---|
| New Spaces are | Workspace-visible | `settings.workspaceDefaults.spaceVisibility` (`PRIVATE`/`WORKSPACE`/`ORG`) | read by `NewSpaceDialog` as the preselected option |
| New Folders / Lists inherit their parent | on | `settings.workspaceDefaults.inheritVisibility` | read by `NewFolderDialog`, `NewBoardDialog` |
| Who can create Spaces | Everyone except guests | `settings.workspaceDefaults.spaceCreators` (`everyone`/`managers`/`admins`) | enforced in `POST /api/spaces` |
| Who can invite people | Admins and managers | mirrors the matrix cell `people.create` | one control, two readers |
| Space "Default permission" (Full edit / Edit / Comment / View) | | REMOVED from `NewSpaceDialog` | stored but read by nothing (`space.ts:251`); removed until a comment-only level exists in the resolver |

#### 2.2.8 Task system (`/settings/tasks`) · tabs

| Tab | What | Persists | Who |
|---|---|---|---|
| Task types | the existing page body, with the create modal moved onto `ui/dialog`, actions visible (not hover-only), and a "Default type" select | `ItemType` via `/api/item-types*`, which gain the admin gate they lack today; default type in `settings.workspaceDefaults.defaultItemTypeId` | admin |
| Tags | render the already-wired `settings/tags/tags-manager.tsx` (types, create, rename, colour, archive, delete against the real API); delete `settings/tags/page.tsx` and its fabricated SAMPLE data | `Tag` via `/api/tags*` | admin |
| Templates | link card to the Template Center (`/templates`) filtered to workspace templates; no duplicate UI | | |

Old URLs `/settings/task-types` and `/settings/tags` redirect to the tabs.

#### 2.2.9 Scoring & reviews (`/settings/scoring`) · Save bar per section

Kept as one page (it is the alignment engine's configuration). Changes: read-only mode is unnecessary (door is gated); primary button becomes the brand `Button`; bands become add / remove rows with colours from the semantic token set (`success`, `info`, `warning`, `danger`, `neutral`) instead of colour words the input cannot render; "Reset to defaults" confirms; dirty-state guard applies per section. Behavioral anchors are hidden behind "Show upcoming features" until the review form reads them (the audit found them ignored). The legacy `reviewFrequency` card on Overview is replaced by the cadence summary.

Persists: `Organization.settings.{reviewCadences, scoreWeights, scoringBands, behavioralAnchors}` via `PATCH /api/settings {section:"scoring"}`, admin only.

#### 2.2.10 Security (`/settings/security`) · tabs

Policy tab (Save bar; the editor the audit says does not exist):

| Field | Default | Persists | Enforced by |
|---|---|---|---|
| Minimum password length | 8 (floor 8) | `settings.security.minPasswordLength` | `lib/password-policy.ts` at signup, invite accept, reset, and (new) change-password |
| Require uppercase, Require number | on, on | `settings.security.requireUppercase/requireNumbers` | same |
| Idle session timeout | 12 hours | `settings.security.sessionTimeoutMinutes` | the idle-session check in `lib/auth.ts` reads the org value, bounded 30 min to 24 h (today the 30 shown is a stale default; the real value is the env-driven 12 h) |
| Require two-factor for everyone | off | `settings.security.twoFactorEnabled` | the MFA-at-login gate reads `env ENFORCE_MFA_AT_LOGIN OR org.twoFactorEnabled`; members without MFA are routed to enrolment at next sign-in |
| Allow sign-up with `@{domain}` (auto-join) | off | `settings.security.domainAutoJoin` | signup route; requires `Organization.domain` set in Identity |

Single sign-on tab: SAML configuration form over `IdentityProvider` (issuer, SSO URL, SLO URL, certificate, attribute map, JIT provisioning toggle). Ships only when the SAML login route is verified end to end; until then the tab is hidden unless "Show upcoming features" (honesty rule, and it removes the marketing overpromise from the product surface).

Provisioning (SCIM) tab: mint / revoke SCIM tokens (`/api/scim-tokens` exists; reveal-once pattern copied from API keys). Ships now.

#### 2.2.11 Data (`/settings/data`) · tabs

| Tab | What | Persists / API |
|---|---|---|
| Export | full workspace ZIP, People CSV, Timesheets CSV, Audit CSV (the existing buttons). Purchase orders and Invoices exports are removed (Finance is out of PPMS scope). Each export writes an ActivityLog row and the tab lists "Recent exports" from it | existing export routes |
| Import | link cards to `/imports` (People CSV, ClickUp / Asana / Trello / Monday importers as they exist) plus import history | existing |
| Retention | Trash auto-purge after N days (default 30), Audit log retention (default 365 days) | `settings.retention.{trashDays, auditDays}`; ships only together with the cron that reads them (one of the 21 installed crons gains the job). Not shown until wired |
| Trash | link card to `/trash` (route unchanged, re-parented from the dead Settings hub sidebar) | |

`/settings/import-export` redirects to `/settings/data?tab=import`.

#### 2.2.12 Audit log (`/settings/audit`)

Kept. Changes: `OsTitleBar` removed (the shell header is the header), rows open a detail drawer showing `oldValue` / `newValue`, an "Access" filter chip (tier changes, matrix saves, membership and visibility changes, which start being logged), server-side search, export honours every active filter, `/api/audit-log` tier aligned to admin2.

#### 2.2.13 API & webhooks (`/settings/api`) · tabs

| Tab | What | API |
|---|---|---|
| API keys | existing list / mint / revoke, plus "Hide revoked", rate-limit and scope edit on a row drawer | `/api/keys` |
| Webhooks | list / create / test / disable subscriptions (`WebhookSubscription` and `/api/webhooks` exist; the keys page already mentions webhooks) | `/api/webhooks` |

`/settings/integrations` redirects here; the marketplace (`/integrations`, "demand-driven") is linked from the tab footer. `/settings/calendar` redirects to My Settings › Calendar & connections (calendar sync is per person, not per org).

#### 2.2.14 Plan & billing (`/settings/billing`)

Plan card (name, status, renewal), usage bars (members, storage, AI queries for the current period), "Manage billing" (Stripe portal). When Stripe is not configured the button is replaced by "Contact us to change plan" (mailto), never a button that 503s. Plan comparison table is added when checkout exists; until then hidden. `useToast` replaced by `useOsToast`.

---

## 3. Disposition table

Every existing page, component and cosmetic or localStorage-only setting. Verbs: **keep** (same URL, fixed), **move** (new URL, old URL 301s), **merge** (becomes a tab or section; old URL redirects to it), **wire** (existing control gains persistence or enforcement), **remove** (deleted, with reason).

### 3.1 Routes

| Today | Disposition | Reason |
|---|---|---|
| `/settings` Overview | keep, rebuilt: one card per page, no self-links, checklist on first run, `OsEmptyView` Retry wired | audit 1.1, #4, #20 |
| `/settings/identity` | keep as Identity & culture › Profile + Culture tabs; C_LEVEL removed from page and API `canEdit` | audit 1.2, #9 |
| `/settings/locale` | keep; full IANA and ISO lists; one `fiscalYearStart` representation; language now consumed | audit 1.3, #15 |
| `/settings/modules` | merge → `/settings/apps#modules` | two thin pages become one Apps & modules page |
| `/settings/apps` | keep; grouped by hub; floors enforced; reset order | audit 1.5, access #26, §7.8 |
| `/settings/tags` (page.tsx) | remove page; merge Tags → `/settings/tasks?tab=tags` rendering `tags-manager.tsx` | fabricated SAMPLE data, wrong API shape, no-op delete (audit #1) |
| `/settings/tags/tags-manager.tsx` | wire: becomes the rendered Tags tab (restyled to the door's form kit) | it is the correct implementation |
| `/settings/task-types` | merge → `/settings/tasks?tab=types`; API gains admin gate | audit #2 |
| `/settings/members` | keep; tabs, columns, pagination, whitelist, confirms | audit 1.8, access #4 |
| `/settings/structure` | keep as tabbed Structure; `/account` link fixed; Offices real; tier prose replaced by `tiers.ts` | audit 1.9, #18 |
| `/settings/hierarchy` | merge → `/settings/structure?tab=chart` (embeds `/organization` client) | duplicate of the org chart with fewer safeguards (audit #14) |
| `/settings/permissions` | keep as Access & permissions › Permissions tab; enforced-only cells; reset; diff; audit; cache invalidation | access §1.3, #7, #22 |
| `/settings/audit` | keep; title bar removed; detail drawer; Access filter; server search | audit 1.12, #21, access #19, #27 |
| `/settings/data` | keep as Data › Export tab; PO and Invoice exports removed; export log | audit 1.13 |
| `/settings/defaults` | merge → `/settings/identity?tab=appearance` | it is the org side of Appearance; one accent vocabulary |
| `/settings/api` | keep as API & webhooks › API keys; title bar and BEM nav-links removed | audit 1.15 |
| `/settings/calendar` | move → `/account/connections` (personal Google Calendar + ICS) | the backend is per-user (`CalendarSubscription.userId`); the org page was a stub (critic contradiction on `/settings/calendar`) |
| `/settings/integrations` | merge → `/settings/api` footer link + `/integrations` marketplace | hub-of-stubs (audit 1.17) |
| `/settings/import-export` | merge → `/settings/data?tab=import` | duplicate of Data (audit #12, 1.18) |
| `/settings/billing` | keep; honest no-Stripe state; one toast system; period-scoped AI count | audit 1.19, #11 |
| `/settings/scoring` | keep; brand button; band rows; anchors behind upcoming; dirty guard | audit 1.20, #7 |
| `/settings/notifications` | move → `/account/notifications` (reverse of today's redirect) | personal setting under the org prefix (audit 1.21) |
| `/account/profile` | keep; phone, DOB, danger zone; one input pattern; error state | audit 1.22 |
| `/account/appearance` | merge → `/account/preferences?tab=appearance` | one Preferences page holds appearance, locale and sidebar |
| `/account/security` | keep; score removed; presence persisted; policy card links to the editor | audit 1.24, access #17 |
| `/account/notifications` | keep as the real page (was a redirect) | |
| `/account` (bare) | wire: redirect → `/account/profile` | 404 inside settings mode (audit 1.26) |
| `/organization` (org chart) | keep in Teams hub; also embedded in Structure › Org chart | canonical chart |
| `/people/me` | keep; Teams sidebar "My Profile" active-state fixed to match `/people/[id]` when id = self | audit #29 |
| `/me/weekly-review` | keep in Work; not a setting | out of scope |
| `/me/mentions` | remove route; redirect → `/inbox?tab=mentions` | orphan duplicate of Inbox › Mentions (audit #28) |
| `/talent` | keep, unchanged, reachable from Teams sidebar and Reviews | hard constraint |
| `/build`, `/store` | keep; linked from Apps & modules footer | re-parented from the deleted Settings hub sidebar |
| `/tools`, `/assets` | keep; linked from a new "Resourcing" section in the Teams hub sidebar (hr-admin) | they are people provisioning, not settings; they were only under Settings because the hub needed a sidebar |
| `/trash` | keep; linked from Data › Trash tab | re-parented |
| `SettingsSidebar` (`apps-catalog.tsx:1208`) | remove component | never visible on settings routes; its five rows are re-parented above |

### 3.2 Orphaned settings components

| Component | Disposition |
|---|---|
| `components/settings/branding-manager.tsx` | remove; logo lives in Identity, accent defaults in Appearance defaults; white-label is a staff-side enterprise flag |
| `components/settings/byok-manager.tsx` | keep on disk, hidden behind the enterprise `byok` flag; surfaces as an "AI keys" tab under API & webhooks only for orgs with the flag (backend exists per `enterprise-features.ts`) |
| `components/settings/privacy-controls.tsx` | remove; its intent (data export, delete account) is covered by Profile › Danger zone and Data |
| `components/settings/sop-category-manager.tsx` | remove; SOP folders are managed at `/sops/manage` |
| `admin-setup-checklist.tsx` | wire: becomes the Overview checklist with correct targets (7.2) |
| `tour-content.tsx` steps 1 to 3 | wire: targets and copy updated |

### 3.3 Cosmetic, unenforced and localStorage-only settings

Rule applied: if a value is presented to the user as a preference or a setting (it has a label, a toggle, or a "remembered" promise), it persists server-side. Pure UI ephemera that no one would call a setting (a dismissed banner, the last zoom level of one sheet, which doc tabs are open) may stay in localStorage, and none of it renders inside either door.

| Setting / state | Today | Disposition |
|---|---|---|
| Inbox display prefs (`showAll` etc.) | PATCH `{inbox}` stripped by the zod schema | wire → `UserPreference.notifications.inboxView`; schema extended; Notifications › Inbox |
| `home.cards` (Customize panel) | saved, never read | wire: the Work sidebar and Space overview read it; shown in Preferences › Sidebar and in the panel |
| Space "Default permission" | stored, unread | remove from `NewSpaceDialog` until a comment level exists; Sharing defaults tab replaces it |
| Wizard-selected views, private / pinned views | unenforced | out of this spec (board views); flagged to the work-OS spec |
| Behavioral anchors | saved, ignored by scoring | hide behind "Show upcoming features" until read |
| Escalation thresholds (role workspace) | ignored | out of this spec (Teams); flagged |
| ~55 unenforced matrix cells | saved, no effect | hide until enforced (2.2.7) |
| Rail hide / floor | display only | wire: enforced by the shared app layout guard (2.2.4) |
| Org security policy | no editor | wire: Security › Policy (2.2.10) |
| Org notification defaults (`settings.notifications`) | API section, no UI, no reader | remove the section from the API; personal defaults are the product's defaults. Re-add only when a reader exists |
| Default language | saved, unused | wire: org fallback for the personal locale (2.2.3, 2.1.2) |
| `businessType`, `teamSize` | read on Overview, never written | wire: Identity › Profile |
| Presence (`workwrk:os:presence`) | localStorage | wire → `UserPreference.shell.presence` |
| Mute notifications (`workwrk:os:muted-notifs`) | localStorage | wire → `UserPreference.notifications.mutedUntil` |
| Quick-tool pins (`workwrk:os:profile-tool-pins:v2`) | localStorage | wire → `UserPreference.shell.toolPins[]` |
| Sidebar width (`workwrk:os:sidebar-width`) | localStorage | wire → `UserPreference.sidebar.width` |
| Sidebar collapsed (`workwrk:os:sidebar-collapsed`) | localStorage | wire → `UserPreference.sidebar.collapsed` |
| Icons-only (`workwrk:os:icons-only`) | localStorage mirror of a persisted key | remove the mirror; read effective prefs |
| Density (`workwrk:density`, `lib/density.ts`) | localStorage | remove the mirror; `UserPreference.density` is the source |
| Desktop notifications (`desktop-notifications-pref`) | localStorage | wire → `UserPreference.notifications.desktop` |
| Saved task filters (`workwrk:task-saved-filters`) | localStorage | wire → `UserPreference.work.savedFilters[]` (new key; shown on the My Work filter menu, not in a door) |
| Team workload capacity (`workwrk:team-workload:v1`) | localStorage, per viewer | wire → `User.weeklyCapacityHours` (new column, managers set it on the person profile); a per-viewer copy of someone else's capacity is wrong by construction |
| TaskListSurface views and options, pivot results | in memory | out of this spec (work OS views); flagged |
| Active app (`workwrk:os:active-app`), lens, recent apps | localStorage | keep in localStorage but re-derived from the URL (the navigation spec's job); not a setting |
| Sidebar pinned / recent (`lib/sidebar-prefs.ts`) | localStorage, legacy pinning | remove (pinning is gone; must not return) |
| Doc tabs, doc split ratio, docs pages-open, sheet zoom, icon recents, create-task last list, AI saved prompts, Room sections / format bar, dismissed banners (notification, overview customize, planner connect, setup checklist, first-run welcome, tour completed) | localStorage | keep in localStorage: ephemera, never rendered as settings. AI saved prompts move server-side when the AI hub gets a prompts library |
| Accent vocabulary (10 personal keys with purple / pink / violet / indigo vs 7 org keys) | two lists | wire: one list in `lib/accents.ts` used by both doors and the Customize panel; banned hues removed and normalised on read |
| Dirty-state guards (Identity, Permissions, Scoring, and in this spec every Save-bar page) | none | wire: `useDirtyGuard` (4.5) |
| Four denial redirects (`/dashboard`, `/people/me`, `/team/reviews`, lock card) | inconsistent | wire: settings door 403 card (1.2); `route-guard.ts` default target changed from `/dashboard` to `/today`; the Teams door gates keep their own targets (they are not settings) |
| Profile-menu Themes / Shortcuts / Notifications rows | dead or wrong | wire (1.1) |
| Rail "Upgrade" | Overview | wire → `/settings/billing`, admins only |
| Three settings back patterns + `OsTitleBar` dead trio on settings pages | inconsistent | remove all in-page breadcrumbs, `OsTitleBar` usages and nav-link chips inside both doors; the shell header is the only chrome (4.3) |

---

## 4. Navigation

### 4.1 Shell

`SettingsShell` takes `door: "me" | "workspace"` and renders:

- Header, 48px, white, 1px bottom border: `[← Back to app]` · `{Org or first name} › {Door label} › {Page}` (last crumb is the page title, updates per route) · spacer · `[×]`.
- Sidebar, 248px, N50 ground: a filter field on top ("Find a setting"), then rows 32px with a 16px icon, group labels 12px uppercase with a rule (Workspace door only), active row = N100 pill + 590 weight, never blue.
- Content: `<main>` with 24px padding, max content width 880px for forms, full width for list pages.
- Responsive: below 900px the sidebar collapses to a top "Pages" select; the shell has no breakpoints today (audit §3).

The `OsShell` settings-mode fork (`os-shell.tsx:79`) stays: rail, hub sidebar and topbar unmount; `ReminderTicker`, `CallDock`, `IncomingCallWatcher`, `RealtimeClient` stay mounted.

### 4.2 Search

The sidebar filter field searches two indexes: page titles, and a per-page `settingsIndex` export listing `{ id, label, keywords, tab? }` for every field. Results render as "Page › Field" rows; selecting one navigates to `/{page}?tab={tab}#{id}` and the field row flashes once. Both doors index only their own pages. `⌘K` inside a door also opens this search (the global palette is unmounted in settings mode).

### 4.3 Back and Close: the origin rule

- On first entry into settings mode the shell records `returnTo` = the previous in-app pathname (from `document.referrer` on the same host, or the `?from=` param the avatar menu and rail append). Stored in `sessionStorage["workwrk:settings:return-to"]` for the duration of the settings session.
- "Back to app", the `×` and `Esc` all call `leaveSettings()`: if `returnTo` exists and is not a settings route, `router.push(returnTo)`; else `/today`. Never `history.back()` through settings pages.
- Inside a door, sidebar rows and tabs use normal `router.push`, so the browser Back button walks settings pages; that is expected and does not exit the door.
- Every page inside a door has **no** in-page breadcrumb, `OsTitleBar`, "Settings" chip or "‹ Back to settings" link. The shell header is the single back affordance (this deletes the four patterns the audit counted).
- `BackButton{fallbackHref}` is not used inside the doors (the shell owns it); it stays on every non-settings detail route as the app convention requires.

### 4.4 Deep links

- Every page, tab and field is addressable: `/settings/tasks?tab=tags`, `/account/preferences?tab=locale#timezone`. Tabs read `?tab` on load and write it with `router.replace` on change so reloads and shared links land on the right tab.
- Old URLs are 301 redirects in `next.config.ts` (`/settings/modules`, `/settings/tags`, `/settings/task-types`, `/settings/hierarchy`, `/settings/defaults`, `/settings/calendar`, `/settings/integrations`, `/settings/import-export`, `/settings/notifications`, `/account/appearance`, `/account`, `/me/mentions`).
- Cross-door links are explicit: My Settings › Security's policy card links to Workspace › Security (admins only); Workspace › Identity › Appearance defaults links to My Settings › Preferences.
- A non-admin who follows a `/settings/*` deep link sees the 403 card (1.2) with the admin's name, not a bounce.

### 4.5 Dirty-state guard

- `useDirtyGuard(isDirty)`: while dirty, (a) `beforeunload` prompts, (b) the shell's Back / Close / Esc and sidebar rows open a confirm "Discard unsaved changes?" with Keep editing / Discard, (c) tab switches inside a tabbed page behave the same.
- Only Save-bar pages register. Autosave controls never make a page dirty; they show an inline "Saved" tick (or "Couldn't save · Retry", and the control reverts).
- The sticky Save bar appears only when dirty: `[Unsaved changes]  [Discard] [Save changes]`, brand `Button`, disabled while saving.

---

## 5. Persistence rule

**Nothing visible is cosmetic.** A control renders inside a door only if (1) a read path returns its current value, (2) a write path stores it, and (3) at least one consumer reads it. If (3) is missing the control is hidden behind "Show upcoming features" and renders disabled with "Coming soon" (or "Not enforced yet" for permission cells). If (1) or (2) is missing it does not render at all.

### 5.1 Where each class persists

| Class | Store | Read | Write | Who |
|---|---|---|---|---|
| Personal identity (name, phone, DOB, avatar) | `User` columns | `GET /api/me` | `PATCH /api/users/[id]` (self path), avatar routes | self |
| Personal security | `User.mfa*`, `tokenVersion`, `emailVerifiedAt` | `GET /api/me`, `/api/me/security-activity` | the existing `/api/me/*` security routes | self |
| Personal preferences (theme, density, locale, sidebar, notifications, shell, work) | `UserPreference` (`theme`, `density`, `sidebar`, `home` existing; `locale`, `notifications`, `shell`, `work` new `Json?` columns) | `GET /api/preferences` (effective) | `PATCH /api/preferences` | self; org `lockedKeys` win |
| Personal email channels | `EmailPreference` | `GET /api/email-preferences` | `PATCH /api/email-preferences` | self |
| Personal connections | `CalendarSubscription`, ICS token | `/api/integrations/google-calendar`, `/api/calendar/ics/token` | same | self |
| Membership (access level, department, role, manager, office, status, capacity) | `User` columns | `GET /api/users` | `PATCH /api/users/[id]` (admin path) | admin; managers via Teams |
| Org preferences (rail apps, theme defaults, density default, locked keys, home defaults) | `OrgPreference` | `GET /api/org/preferences` | `PATCH /api/org/preferences` | admin |
| Org settings (identity, culture, locale, security policy, scoring, permissions, workspace defaults, retention) | `Organization.settings` JSON, `Organization.name/domain/logo` | `GET /api/settings` (admins get everything; non-admins get only `organization` public fields + `security` policy summary + `companyProfile`, the culture the loader needs) | `PATCH /api/settings {section, data}` with a zod schema per section | admin |
| Modules | `ProductInstallation` | `/api/preferences` (`modules.activeAppKeys`) | `POST/DELETE /api/products/installations` | admin |
| Structure | `Department`, `Role`, `Office` | their APIs | their APIs | admin (managers for departments/roles in Teams as today) |
| Task system | `ItemType`, `Tag`, `Template` | their APIs | their APIs, admin-gated | admin |
| Platform credentials | `ApiKey`, `ScimToken`, `WebhookSubscription`, `IdentityProvider` | their APIs | their APIs | admin |
| Billing | `Subscription`, Stripe | `/api/billing/*` | Stripe portal | admin |
| Object-scoped (Space / Folder / List / Doc) | `Space.settings`, member tables | object APIs | object APIs | object owners; never in a door |

### 5.2 API shape

`PATCH /api/settings` keeps its `{ section, data }` envelope but every section gets a zod schema (today `security`, `notifications` and `general` accept any object). Sections after this spec: `general` (name, domain), `profile` (industry, businessType, teamSize), `culture` (companyProfile), `locale`, `security`, `scoring`, `workspaceDefaults`, `retention`. `notifications` and `modules` sections are removed (no reader; modules moved to ProductInstallation long ago). Every section write logs `settings.update.{section}` with changed keys (already does).

`PATCH /api/preferences` schema grows `locale`, `notifications` (with `inbox`, `inboxView`, `email`, `mutedUntil`, `desktop`), `shell` (`presence`, `toolPins`), `work` (`savedFilters`), and `sidebar.width` / `sidebar.collapsed`. `home.notifications` is read as a fallback for one release, then dropped. The `pinned` key stays accepted and ignored.

`getEffectivePreferences` merges `locale` like `theme`: defaults → org (`settings.language`, `settings.timezone`, `settings.locale.*`) → user → locked keys.

All autosave writes are debounced 400ms per key and retried once; failures toast and revert. All Save-bar writes are one request per section.

### 5.3 Migration

One additive Prisma migration: `UserPreference.locale Json?`, `.notifications Json?`, `.shell Json?`, `.work Json?`; `User.weeklyCapacityHours Int?`. A data step copies `home.notifications` into `notifications`. Local uses Neon, prod uses aaPanel Postgres with drift (memory): the migration is applied with `prisma db execute` on prod, and the pages that depend on the new columns ship behind the migration, not before.

### 5.4 One tier ladder

`src/lib/tiers.ts` exports the ordered enum, labels, short labels, descriptions, and the three derived sets (`MANAGER_LEVELS`, `HR_ADMIN_LEVELS`, `ORG_ADMIN_LEVELS`), plus `isOrgAdmin(level)`, `isManager(level)`. `access-levels.ts`, `access-tiers.ts`, `permissions.ts ACCESS_LEVELS`, `route-guard.ts`, `page-gates.ts`, `settings-shell.tsx`, `api/org/preferences`, `api/settings`, `use-role.ts` and the other 20 hand-copied sets import from it. HR sits above MANAGER in one place. `use-role().isAdmin` becomes admin2 only. This is a prerequisite for the door gate to be trustworthy, and it is a mechanical refactor.

---

## 6. How it looks (Zoho reference applied)

Chrome: both doors use the light chrome variant (white shell, N50 sidebar, grey active pill). The navy chrome from the Zoho reference belongs to the main app rail and top bar; a settings takeover is a white canvas with a slim header, which is exactly Zoho's own settings pattern. Blue appears only on the one primary button per page, checked controls and links.

### 6.1 Settings list page (Members, Task types, Tags, API keys, Webhooks, Pending invites, Audit log)

```
Members                                              20px / 590, 28px top padding
All   Admins   Pending invites   Deactivated         text tabs, 14px, active = 590 on N100 pill, no underline
[⊟ Filter] [↕ Sort]  |  … (view icons only when >1)             [ + Invite ]  blue, 36px, right
┌───────────────────────────────────────────────────────────────────────────────┐  bordered card, radius 8, N200
│ ☐  Person              Access level   Department   Reports to   Status   ⚙ │  header 32px, N50, 12/590 N500
│ ☐  Priya Nair          Manager ▾      Product      Arjun        Active     │  rows 36px, hairline N200, no zebra
│ ☐  …                                                                         │
│ Total members 42                                             1 to 40  ‹ › │  footer in the card
└───────────────────────────────────────────────────────────────────────────────┘
```

Filter opens a bordered panel on the left inside the content (search box + checkbox rows); the table narrows. Bulk bar floats at the bottom when rows are checked. Empty state: N300 four-dot line illustration, one sentence, one text-link action.

### 6.2 Settings form page (Identity, Locale, Security policy, Scoring, Profile, Preferences)

```
Identity & culture                                   20px / 590
Profile   Culture   Appearance defaults   Danger zone   text tabs
One-line description in 13px N500.

┌ Workspace ─────────────────────────────────────┐   bordered card, 16px padding, max 5 fields
│ Logo          [ ● ] Replace  Remove             │   labels above, 36px inputs, radius 6
│ Workspace name [ Acme Ltd                     ] │
│ Primary domain [ acme.com                     ] │  helper 13px N500 under the field
└────────────────────────────────────────────────┘
┌ About the business ────────────────────────────┐
│ Industry [ ▾ ]   Business type [ ▾ ]   Team size [ ▾ ] │
└────────────────────────────────────────────────┘
                                                     …
┌ Danger zone ───────────────────────────────────┐   1px danger border, last card, own tab where long
│ Delete workspace                    [ Delete ]  │   red outline button, typed confirmation
└────────────────────────────────────────────────┘

[ Unsaved changes ]                    [Discard] [Save changes]   sticky bar, appears only when dirty
```

Autosave rows (toggles, selects) sit in the same cards as `label · helper · control` rows 44px tall with a right-aligned Switch and a transient "Saved" tick. Locked rows show a lock glyph and "Set by your workspace". Loading uses the `ValueLoader` route loader once; inside a page, skeleton bars in N100. Errors render `OsEmptyView` with a wired Retry.

Type: 20 / 16 / 14 / 13 / 12 from the Phase 2 scale, no half-pixel sizes, no 11px. Buttons: the tokenised `ui/button` only; no `bg-zinc-900` primaries, no hex. Dialogs: Radix `ui/dialog` only (Task types' hand-rolled overlay goes). Toasts: `useOsToast` only.

---

## 7. New-org defaults and first run

### 7.1 Defaults written at org creation

| Setting | Default |
|---|---|
| Modules | Talk off, Tables off (memory: new orgs OFF) |
| Rail apps | catalog order, nothing hidden, no floors |
| Theme / accent / density defaults | Light, workwrk, Cozy; no locked keys |
| Locale | time zone detected from the creating admin's browser, currency from the country of that zone (INR for India, else USD), fiscal year April for India else January, language `en`, week starts Monday, DMY / 24h |
| Security policy | 8 chars, uppercase on, number on, idle 12 h, MFA not required, domain auto-join off |
| Workspace defaults | new Spaces Workspace-visible, inherit on, Spaces creatable by everyone except guests, invites by admins and managers |
| Permissions | `role-defaults` tier defaults, unchanged |
| Scoring | existing API defaults (cadences, weights, bands) |
| Retention | trash 30 days, audit 365 days |
| Personal (each new user) | theme follows org default, locale follows org, all inbox notifications on, email master on, desktop off, presence Active |

### 7.2 First-run path (admin)

The Overview checklist replaces `admin-setup-checklist.tsx` and reads real data to tick itself:

1. Name and logo your workspace → Identity › Profile (ticks when `logo` or a non-default name exists)
2. Add your mission and values → Identity › Culture (ticks when `companyProfile.values.length > 0`)
3. Set time zone and currency → Locale (ticks when the admin has saved the page once, `settings.localeConfirmedAt`)
4. Invite your team → Members?invite=1 (ticks at 2+ active members)
5. Create departments → Structure › Departments (ticks at 1+ department)
6. Turn on the modules you need → Apps & modules (ticks when visited)
7. Review who can do what → Access & permissions (ticks when visited)
8. Optional: require two-factor → Security (ticks when on)

Each step is one click into the exact tab and field. The checklist collapses to a single "Setup complete" line and can be dismissed (server-side flag `settings.setupDismissedAt`, not localStorage, so it does not reappear on another device).

First run for a member: nothing. Their My Settings work with defaults; the only prompt they ever see is the MFA enrolment when the workspace requires it.

---

## 8. Risks

1. **Access change for C_LEVEL and managers.** C_LEVEL loses its API-only write to org settings; managers lose read-only URL access to Members / Hierarchy / Permissions. Both are corrections, but a customer who relied on a C-level editing locale by URL will notice. Mitigation: the 403 card names the admins; release note.
2. **Rail floors become real gates.** Turning `hidden` / `minAccess` from display-only into enforced layout guards can lock out users whose org config was set carelessly while it was decorative. Mitigation: on first deploy, log would-be denials for a week before enforcing; `home` and `settings` stay exempt.
3. **Prod migration drift.** The new `UserPreference` columns need `prisma db execute` on prod (memory: `migrate dev` is broken by drift). Pages that need them must not ship before the columns exist; the notifications key move needs the data copy in the same window or `notify-prefs` reads nothing.
4. **Session timeout and org-wide MFA move from env flags to org settings.** `lib/auth.ts` currently keys on `ENFORCE_MFA_AT_LOGIN` and a fixed idle window. Reading org values per request adds a lookup on token refresh; must be cached, and the env flag must remain as a global floor.
5. **Hiding unenforced matrix cells looks like feature loss** to an admin who ticked them. Mitigation: the "Show upcoming features" preference reveals them with "Not enforced yet", and the rebuild note explains that they never did anything.
6. **More `/api/preferences` writes** once presence, mute, pins, sidebar width and collapsed state persist server-side. Debounce per key and coalesce; sidebar drag writes at most twice a second.
7. **Two doors means two places to look** for a setting whose owner is ambiguous (accent: personal or org default?). Mitigation: cross-links in both places and the search index covering both doors for admins.
8. **Splash policy as an org setting** softens the founder's "always on" ask into a default. If that is unacceptable the row is removed and the default stays; nothing else depends on it.
9. **SSO tab.** The SAML login route is not verified in this audit; shipping the editor before the login path works would recreate the "surface without backend" failure. It stays hidden until verified.
10. **Redirect sprawl.** Twelve old URLs redirect. Bookmarks, the tour, the checklist, `ModuleDisabled`, `board-more-menu`, `create-task-modal`, `workspace-menu`, `profile-menu`, `click-app-rail` and `command-palette` all carry hard-coded settings paths and must be updated in the same change; the redirects are the safety net, not the plan.
11. **Scope.** Fourteen admin pages plus six personal pages, one migration, one tier refactor and an enforcement change is several weeks. Sequencing that keeps every step shippable: (a) `tiers.ts` + door gate + redirects + shell origin rule; (b) My Settings pages on existing columns (Profile, Security, Shortcuts, Notifications minus new keys); (c) migration + Preferences + the localStorage moves; (d) Workspace pages that are re-parenting (Apps & modules, Task system, Data, Structure, Access levels tab); (e) new editors (Security policy, Sharing defaults, Offices, Webhooks, SCIM); (f) enforcement flips (rail floors, matrix hide).
