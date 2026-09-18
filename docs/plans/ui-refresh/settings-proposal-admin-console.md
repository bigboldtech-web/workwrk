# Settings proposal: the Admin console

Stance: Zoho One / Google Admin class console. The Settings hub lands on a card grid; each card is a section that drills into Zoho-style list pages (title, text tabs, toolbar, bordered table) and form pages (bordered cards, labels above, one primary). Personal preferences leave the console entirely and live in a compact tabbed modal opened from the avatar menu. Every setting is findable by name from one search box. Nothing visible is cosmetic: if it renders, it persists and it is enforced, or it does not render.

Author: settings architect C (admin console stance). Date: 2026-09-11. Inputs: `settings-pages.md`, `access-model.md`, `critic-gaps.json` (#4 access fragmentation, #7 settings that do nothing), `existing-direction.md`, `phase2-inputs.md`, `zoho-reference.md`, plus the live code under `src/app/(dashboard)/settings`, `src/app/(dashboard)/account`, `src/components/layout/os/settings-shell.tsx`, `src/app/api/settings/route.ts`, `src/app/api/preferences/route.ts`, `src/app/api/org/preferences/route.ts`, `src/lib/preferences.ts`, `prisma/schema.prisma`.

Writing rule honoured: no em dashes, no double hyphens in prose.

---

## 0. One-page summary

| Question | Answer |
|---|---|
| What is Settings? | An **Admin console** for the organisation. Eight sections: Users, Security, Apps & modules, Structure, Work defaults, Data, Billing, Audit. |
| Where do my own preferences go? | A **Preferences modal** from the avatar menu (⌘,), four text tabs: Profile, Security, Notifications, Appearance. Never inside the console. |
| Who sees the console? | Console **edit** tier: SUPER_ADMIN, COMPANY_ADMIN. Console **read** tier: C_LEVEL, VP, DIRECTOR, HR (Users, Structure, Work defaults, Audit visible read-only with a banner; Security, Billing, Data hidden). Everyone else: the Settings hub shows their Preferences full page plus "Settings are managed by {admins}". One server gate in `settings/layout.tsx`. |
| How do I find a setting? | Search box on the console home and at the top of the console sidebar; the ⌘K palette indexes the same registry for console users. Every setting has a stable deep link with an anchor. |
| What happens to today's 24 settings/account routes? | Every one is re-parented, merged or redirected. Full disposition table in section 3. Old URLs redirect. No destination is lost; the Talent 9-box stays at `/talent` under Teams. |
| Persistence rule | If a control renders, it writes to the database and something reads it back. Storage class per setting is fixed in section 5. localStorage is allowed for zero device-only keys that appear in Settings. |
| Look | Zoho reference applied: page title, text-tab views, one toolbar row with Filter (side panel) and Sort on the left and the one blue primary on the right, bordered white table with hairline rows and footer totals; form pages are bordered cards, max five fields each, sticky save bar only when dirty. Brand blue `#0073EA` only; navy chrome is the console header. |

---

## 1. Doors and entry points

### 1.1 The three doors

| Door | What opens | Who sees it | Notes |
|---|---|---|---|
| **Rail hub "Settings"** (alwaysPinned, bottom of rail) | Console home `/settings` for console edit/read tiers. For everyone else: `/settings` renders the Preferences panel full page with an "Ask an admin" strip listing the org admins (names, avatars, mailto). | Everyone | The rail stays access-derived; the hub is never hidden because every user gets a useful landing. |
| **Avatar menu → "Preferences"** (shortcut ⌘,) | The Preferences modal, Profile tab. Menu rows "Themes" and "Notifications" open the same modal on the Appearance and Notifications tabs. "Keyboard shortcuts" opens the shortcuts overlay (a new overlay listing the real chords; replaces the dead `?tab=shortcuts` link). "My Profile" stays → `/people/me`. "Settings" row stays → `/settings` and is labelled "Admin console" for console tiers, hidden for others (they reach `/settings` through the rail anyway). | Everyone | Replaces `/settings?tab=themes` and `/settings?tab=shortcuts` which land on Overview today. |
| **Contextual links** | Deep links straight into a console page with a `from` origin recorded (see 4.3). | Per link | Board "…" → Default task type → `/settings/work/task-types`; create-task type picker footer → same; ModuleDisabled gate → `/settings/apps/modules`; workspace menu "Manage members" → `/settings/users/members`, "Invite people" → `/settings/users/members?invite=1` (opens the invite modal); rail "Upgrade" and workspace menu "Upgrade" → `/settings/billing/plan`; org chart "Org settings" → `/settings/structure/profile`, "fix in Members" → `/settings/users/members?filter=unlinked`; admin setup checklist → the new first-run checklist targets (section 7); tour steps 1 to 3 rewritten to the new labels. |

### 1.2 Console access function (one source of truth)

```ts
// src/lib/console-access.ts (new; replaces the 25 hand-copied tier sets for Settings)
export type ConsoleAccess = "edit" | "read" | "none";
export function consoleAccess(level: string): ConsoleAccess {
  if (level === "SUPER_ADMIN" || level === "COMPANY_ADMIN") return "edit";
  if (["C_LEVEL", "VP", "DIRECTOR", "HR"].includes(level)) return "read";
  return "none";
}
export const CONSOLE_SECTIONS = {
  users:     { read: true  },  // read tier may open
  structure: { read: true  },
  work:      { read: true  },
  audit:     { read: true  },
  security:  { read: false },  // edit tier only
  apps:      { read: false },
  data:      { read: false },
  billing:   { read: false },
} as const;
```

- `settings/layout.tsx` (server) calls `requireConsole(section)`: `none` → render the Preferences full page (not a redirect, so the URL stays honest and the user is not bounced to `/dashboard`); `read` on a hidden section → the same "This area is for admins" card, with the admin names. Denial redirects are gone; there is one denial card.
- `/api/settings` PATCH tier becomes exactly `consoleAccess(level) === "edit"`. C_LEVEL loses org-settings write (today it can PATCH locale, security policy and the company profile by URL only). Listed in risks.
- The per-route `layout.tsx` gates (apps, audit, data, defaults, identity, tags) are deleted; the section gate replaces them. No console page is reachable without going through it.
- Read tier pages render every control disabled with a top banner "Read-only. Company admins can change these settings." No control ever 403s on click because disabled controls do not fire.

### 1.3 Entry-point disposition (every inbound link today)

| Today | New target |
|---|---|
| Profile menu "Settings" → `/settings` | Keep (console home or Preferences full page by tier). |
| Profile menu "Themes" → `/settings?tab=themes` | Preferences modal, Appearance tab. |
| Profile menu "Keyboard shortcuts" → `/settings?tab=shortcuts` | Shortcuts overlay (`?` key also opens it). |
| Profile menu "Notifications" → `/inbox` | Preferences modal, Notifications tab. The Inbox keeps its own gear for inbox view options. |
| Rail bottom "Upgrade" → `/settings` | `/settings/billing/plan`. Rendered only for the edit tier; otherwise the slot is empty. |
| Workspace menu "Upgrade" → `/settings/billing` | `/settings/billing/plan`. |
| Workspace menu "Manage members" / "Invite people" → `/settings/members` | `/settings/users/members` and `/settings/users/members?invite=1`. |
| Board "…" Default task type, create-task footer → `/settings/task-types` | `/settings/work/task-types`. |
| ModuleDisabled → `/settings/modules` | `/settings/apps/modules`. |
| Org chart "Org settings" → `/settings` | `/settings/structure/profile`. |
| Org chart "fix in Members" → `/settings/members` | `/settings/users/members?filter=unlinked`. |
| People profile (self) "Edit personal info" → `/account/profile` | Opens the Preferences modal on Profile (route `/account/profile` still resolves; see 4.5). |
| Tools / Assets / Integrations "Settings" nav-link → `/settings` | Keep. |
| Admin setup checklist "Invite your team" → `/settings` | `/settings/users/members?invite=1`. "Set up your company profile" → `/settings/structure/profile`. "Create departments" → `/settings/structure/departments`. |
| Tour steps 1 to 3 | Rewritten: "Company profile" (Structure), "Invite your team" (Users), "Access levels" (Users → Access levels). |
| Team hub "Org chart" → `/organization`, "My Profile" → `/people/me` | Unchanged (not settings). |
| Today "My alignment" → `/me/weekly-review` | Unchanged (not settings). |
| `/me/mentions` (URL only) | Redirect to `/inbox?tab=mentions`. |
| Command palette "Settings", `g s` chord | Palette row kept; the `g` chords are dead code (`useGoToNav` has no importer) and are removed from copy. |

---

## 2. Information architecture

### 2.1 The tree

URL scheme: `/settings` (home) → `/settings/{section}` (redirects to the section's first page; there is no second hub) → `/settings/{section}/{page}`. Anchors (`#invite-rules`) address a card inside a form page. The console sidebar lists all eight sections with their pages; the home card grid is the only hub.

```
/settings                                   Console home (card grid + search + first-run checklist)
├─ users/                                   USERS
│  ├─ members                               list: every person, drawer edit
│  ├─ invitations                           list: pending/expired invites + Invite rules card
│  ├─ access-levels                         list: the 10-rung ladder → detail: enforced capabilities
│  └─ reporting                             org-chart renderer with edit (replaces /settings/hierarchy)
├─ security/                                SECURITY
│  ├─ sign-in                               form: password policy, sessions, MFA, lockout, allowed domains
│  ├─ sso                                   form: SAML (IdentityProvider)
│  ├─ scim                                  list: SCIM tokens
│  ├─ api-keys                              list: API keys (+ rate limits)
│  └─ webhooks                              list: webhook subscriptions
├─ apps/                                    APPS & MODULES
│  ├─ modules                               list: premium modules on/off
│  ├─ rail                                  list: rail hubs + folded apps: visible / minimum access / order
│  └─ integrations                          list: connectors with real status (Google Calendar today)
├─ structure/                               STRUCTURE
│  ├─ profile                               form: name, logo, domain, industry, business type, size, mission, vision, about, values
│  ├─ locale                                form: timezone, currency, fiscal year, week start, date/time format, language
│  ├─ departments                           list: Department rows
│  ├─ job-titles                            list: Role rows (links to /people/roles/[id] for the definition)
│  └─ offices                               list: Office rows
├─ work/                                    WORK DEFAULTS
│  ├─ spaces                                form: Space creation and sharing defaults (enforced)
│  ├─ task-types                            list: ItemType rows + recommended drawer
│  ├─ tags                                  list: Tag rows (real API, rename/recolor/archive)
│  ├─ performance                           form: review cadences, score weights, bands, anchors
│  ├─ capacity                              form: default weekly hours, working days
│  ├─ notifications                         form: org notification defaults + locks
│  └─ appearance                            form: org theme/density defaults + locks
├─ data/                                    DATA
│  ├─ import                                list: import jobs + start import
│  ├─ export                                list: export types + export history
│  ├─ retention                             form: trash/audit/activity retention, privacy, AI data use (BYOK)
│  └─ danger                                form: transfer ownership, delete organisation
├─ billing/                                 BILLING
│  ├─ plan                                  cards: current plan, comparison, upgrade / manage
│  ├─ usage                                 stat rows: seats, SOPs, AI queries (period), storage, modules
│  └─ invoices                              list: invoices (Stripe) or honest empty state
└─ audit/                                   AUDIT
   └─ log                                   list with text tabs: All / Access / Security / Data / Settings; row drawer with old→new
```

Below the card grid on the home page, two more rows keep the folded Settings-hub apps reachable without pretending they are settings:

- **Inventories** (hr-admin and up): Tools & SaaS (`/tools`), Assets (`/assets`). These open in the normal shell with the Settings hub sidebar, unchanged.
- **Also in Settings**: Build apps (`/build`), Marketplace (`/store`), Trash (`/trash`), Template Center (`/templates`), Org chart (`/organization`). Plain link chips.

### 2.2 Console home

- Title "Settings", subtitle `{org name} · {plan} · {N} members`.
- Search field (480px) "Search settings", results list grouped by section, Enter opens the deep link, Esc clears. Backed by the settings registry (2.4).
- Eight cards in a 4 × 2 grid (2 × 4 below 1100px). Card: 20px Lucide icon, title, one line, three or four page links, one live figure (Users: "42 members · 3 pending"; Security: "MFA required for admins · SSO off"; Apps: "2 modules on"; Structure: "6 departments · 2 offices"; Work: "8 task types · 41 tags"; Data: "Last export 3 days ago"; Billing: "Growth · 42 of 100 seats"; Audit: "128 events today"). Read tier sees only the four readable cards.
- First-run checklist card (section 7) until every step is done or it is dismissed (dismissal persisted in `Organization.settings.console.setupDismissedAt`, not localStorage).
- No self-links, no "Coming soon" cards.

### 2.3 Every page: fields, defaults, storage, who

Legend. **Who**: E = console edit tier; R = console read tier sees it read-only; M = manager may edit within their report tree via the existing API rule; S = SUPER_ADMIN only. **Store**: `Org.settings.x` = `Organization.settings` JSON key `x`; `OrgPref` = `OrgPreference`; rows = relational table. Autosave = switches, selects and pickers save on change with a "Saved" tick; Form = text-heavy card with a sticky save bar when dirty.

#### USERS

**Members** `/settings/users/members` (list, Autosave in the drawer)

| Field | Default | Store | Who |
|---|---|---|---|
| Table columns: Person, Email, Access level, Job title, Department, Manager, Status, Last active | | `User` rows via `GET /api/users?scope=all` (console tiers always get org scope; the silent team-scope coercion is removed for console callers) | E, R |
| Filter panel: Access level, Department, Office, Status, "No manager" | | query | E, R |
| Access level (select; SUPER_ADMIN offered only when the caller is SUPER_ADMIN; last-admin guard for both admin tiers; self-demotion requires a typed confirm) | EMPLOYEE | `User.accessLevel` via `PATCH /api/users/[id]` | E |
| Job title (Role picker; shows the role's suggested access level as a hint, never changes access silently) | none | `User.roleId` | E, M |
| Department | none | `User.departmentId` | E, M |
| Office | none | `User.officeId` | E, M |
| Reports to (searchable; cycle check server-side) | none | `User.managerId` | E, M |
| Dotted-line managers (multi) | none | `UserDottedLine` rows | E, M |
| Weekly capacity hours (override; blank = org default) | blank | `User.weeklyCapacityHours` (new nullable Int) | E, M |
| Status Active / Suspended | Active | `User.status` | E |
| Deactivate, Remove (asks where to transfer owned Spaces and tasks) | | `DELETE /api/users/[id]` | E |
| Toolbar: Invite (opens invite modal), Export CSV, Import CSV (→ Data › Import) | | | E |

**Invitations** `/settings/users/invitations` (list + one Form card)

| Field | Default | Store | Who |
|---|---|---|---|
| Table: Email, Access level, Invited by, Sent, Expires, Status; Resend, Revoke, Copy link | | `Invitation` rows via `/api/invitations` | E |
| Invite rules card: Allowed email domains (chips) | the org domain | `Org.settings.users.allowedDomains` (read by `/api/invitations`, which already locks to the domain) | E |
| Auto-join: anyone with an allowed-domain email can join as EMPLOYEE | off | `Org.settings.users.autoJoin` (read by signup) | E |
| Who can invite: Admins / Managers and up / Everyone | Managers and up | `Org.settings.users.whoCanInvite` (replaces the matrix cell `people.create`; enforced in `/api/invitations` POST and hides the Invite button below the threshold) | E |
| Default access level for invites | EMPLOYEE | `Org.settings.users.inviteDefaultLevel` | E |
| Add new members to these Spaces | none | `Org.settings.users.defaultSpaceIds` (applied on accept) | E |
| Invitation expiry days | 7 | `Org.settings.users.inviteExpiryDays` | E |

**Access levels** `/settings/users/access-levels` (list → detail)

| Field | Default | Store | Who |
|---|---|---|---|
| Ladder table: Level, Short label, People, Opens (Console edit / Console read / Teams cockpit / Own profile), Description | from one exported `TIERS` array in `src/lib/tiers.ts` (new; the three published lists collapse into it, HR placed once) | code | E, R |
| Level detail: capability checkboxes grouped by product module, **only cells with a server call site**: People (invite: replaced by Invite rules; edit others' details; remove), KRAs (create, edit, delete, assign), SOPs (create, edit, publish, delete), Policies (create), Announcements (create), Assets (create, edit, delete), plus new enforced cells the rebuild adds: Spaces (create, create org-wide, delete), Docs (create, delete), Automation (manage), Data (export) | `permissions.ts` defaults | `Org.settings.permissions` via `PATCH /api/permissions` (sanitizer pruned to the enforced list; save calls `invalidatePermissionCache()` and writes `permissions.updated` to the audit log) | E |
| "Reset to defaults" per level; diff-from-default badge | | | E |
| Protected rows (SUPER_ADMIN, COMPANY_ADMIN) locked | | | |

Cells that enforce nothing today (`people.view/bulkActions`, all `organization.*`, `reviews.*`, `okrs.*`, `tasks.*`, `meetings.*`, `surveys.*`, `ideas.*`, `analytics.*`, `tools.*`, `settings.*`) are removed from the UI and the sanitizer. Nothing is silently kept.

**Reporting lines** `/settings/users/reporting`

- The `/organization` org-chart renderer (`org-chart-client.tsx`) embedded with `mode="edit"`: node click opens the member drawer on "Reports to"; cycle detection and the "Not linked" sweep come with it. Solid and dotted lines both drawn. Replaces `/settings/hierarchy` (which had no cycle handling and no editing). Store: `User.managerId`, `UserDottedLine`. Who: E, M.

#### SECURITY (edit tier only)

**Sign-in policy** `/settings/security/sign-in` (Form)

| Field | Default | Store | Enforced by |
|---|---|---|---|
| Minimum password length | 8 | `Org.settings.security.minPasswordLength` | `password-policy` lib at set/change/reset |
| Require uppercase / numbers / symbol | on / on / off | `.requireUppercase`, `.requireNumbers`, `.requireSymbol` | same |
| Password max age (days, 0 = never) | 0 | `.passwordMaxAgeDays` | login callback flags `mustChangePassword` |
| Idle session timeout (minutes) | 720 | `.sessionIdleMinutes` (replaces `sessionTimeout`) | auth `maxAge` + idle check |
| Absolute session lifetime (days) | 30 | `.sessionMaxDays` | auth |
| Require MFA: Nobody / Admins / Everyone | Admins | `.mfaRequired` (replaces boolean `twoFactorEnabled`) | login flow (`ENFORCE_MFA_AT_LOGIN` env stays as the global switch; the org value narrows it) |
| Lockout after N failed attempts / for N minutes | 5 / 15 | `.lockoutThreshold`, `.lockoutMinutes` | brute-force lockout lib |
| Allowed sign-in domains (chips) | org domain | `Org.settings.users.allowedDomains` (shared with Invite rules; shown here read-only with a link) | login |
| Action: "Sign everyone out" (typed confirm) | | new `POST /api/org/sign-out-everyone` (bumps `tokenVersion` for every user) | |

**Single sign-on** `/settings/security/sso` (Form, plan chip: Enterprise)

| Field | Default | Store |
|---|---|---|
| SAML enabled | off | `IdentityProvider.enabled` via `/api/identity-providers` |
| Issuer (entity ID), SSO URL, SLO URL, x509 certificate | blank | `IdentityProvider.issuer / ssoUrl / sloUrl / certificate` |
| Attribute map: email, firstName, lastName, department, accessLevel | Okta defaults | `IdentityProvider.attributeMap` |
| Just-in-time provisioning | on | `IdentityProvider.jitProvision` |
| Enforce SSO (disable password sign-in for non-admins) | off | `Org.settings.security.ssoEnforced` (login flow) |
| Service-provider details card (ACS URL, metadata URL, entity ID) read-only with copy | | derived |

**Provisioning (SCIM)** `/settings/security/scim` (list): Name, Prefix, Created by, Last used, Expires, Revoke; Generate dialog reveals the token once; base URL card. Store: `ScimToken` via `/api/scim-tokens`.

**API keys** `/settings/security/api-keys` (list): existing page rebuilt in the list anatomy. Adds: rate limit per minute / per day editable in the row drawer (`ApiKey.rateLimitPerMinute/Day`), "Hide revoked" filter on by default, scopes immutable after creation (stated in the drawer). Store: `ApiKey` via `/api/keys`.

**Webhooks** `/settings/security/webhooks` (list): URL, Events, Active, Last delivery, Failures; create dialog reveals the signing secret once. Store: `WebhookSubscription` via `/api/webhooks`. Ships only after the route is verified end to end (risk list).

#### APPS & MODULES (edit tier only)

**Modules** `/settings/apps/modules` (list, Autosave)

| Field | Default | Store |
|---|---|---|
| Row per `MODULES` entry: name, competes with, blurb, status switch, "Open" link when on, "Included in {plan}" or "Add-on" chip | off for new orgs | `ProductInstallation` via `/api/products/installations` |
| Turning off → confirm listing what becomes unreachable (channels, sheets) | | |

**Rail apps** `/settings/apps/rail` (list, Autosave)

| Field | Default | Store | Enforced by |
|---|---|---|---|
| Group "Rail hubs": the 8 hubs; Group "Apps inside hubs": the folded apps, each with its hub name | catalog order | `OrgPref.sidebarDefault.apps.order` | rail |
| Visible switch | on | `.apps.hidden` | rail, More launcher, **and** a shared `requireAppAccess(appKey)` layout gate so a hidden app is really unreachable (the display-only caveat is removed) |
| Minimum access: Everyone / Managers and up / HR and admins / Admins | catalog baseline | `.apps.minAccess` | same gate; the catalog `requiredAccess` and the org floor are read by one function used by the rail, the sidebar and the route layouts |
| Reorder: drag, or up/down | | `.apps.order` | |
| "Reset to default order" | | | |
| alwaysPinned rows (Work, Settings) locked | | | |

**Integrations** `/settings/apps/integrations` (list)

| Row | Status today | Store |
|---|---|---|
| Google Calendar (org-level "Allow members to connect Google Calendar" switch + per-user connect lives in the Preferences modal) | backend exists (OAuth connect/callback, cron, ICS token per `time.md`) | `Org.settings.apps.calendarSync.google` |
| App marketplace → `/integrations` | link | |
| Outlook, iCloud, Fastmail, ICS feeds | not built: **not rendered** unless the user's "Show upcoming features" preference is on, then rendered disabled with "Planned" | |

#### STRUCTURE

**Company profile** `/settings/structure/profile` (Form)

| Field | Default | Store | Who |
|---|---|---|---|
| Logo (upload / remove, 2MB) | none | `Organization.logo` via `/api/settings/logo` | E |
| Organisation name | from signup | `Organization.name` | E |
| Primary domain (validated hostname) | from signup email | `Organization.domain` | E |
| Industry (select from a fixed list + Other) | blank | `Org.settings.industry` | E |
| Business type (select) | blank | `Org.settings.businessType` (read on the old Overview, never written; now written) | E |
| Team size (select) | blank | `Org.settings.teamSize` | E |
| Mission, Vision, About (textareas, 4 rows) | blank | `Org.settings.companyProfile` | E |
| Core values (chips) | blank | `Org.settings.companyProfile.values` (feeds the mission splash and Kudos) | E |

One PATCH (`section: "profile"`) replaces the two sequential PATCHes; empty name is rejected with a field error rather than silently ignored. On fetch failure the form does not render blank: it shows the retry state (so Save can never overwrite live values with empty strings).

**Locale & finance** `/settings/structure/locale` (Form)

| Field | Default | Store | Read by |
|---|---|---|---|
| Timezone (searchable IANA list, "Detect" button) | detected at org creation, else `Asia/Kolkata` | `Org.settings.timezone` | date bucketing (timesheets, calendars), reminders cron |
| Currency (ISO list, 21 currencies from the i18n doc) | INR | `Org.settings.currency` | money formatting (assets, budgets) |
| Fiscal year starts in (month select, 1..12) | 4 | `Org.settings.fiscalYearStart` (number; the `"MM-01"` writer is removed) | fiscal periods, review cadences |
| Week starts on (Monday / Sunday) | Monday | `Org.settings.weekStart` (new) | Planner, DatePlanner, board calendar, timesheets (today split Sunday/Monday) |
| Date format (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD) | DD/MM/YYYY | `Org.settings.dateFormat` (new) | one `formatDate` helper |
| Time format (12h / 24h) | 12h | `Org.settings.timeFormat` (new) | same |
| Default language (18 locales) | en | `Org.settings.language` | root layout locale resolution when the user has no personal language (next-intl is wired; this makes the field real) |

**Departments** `/settings/structure/departments` (list): Name, Head, Parent, Members, Created; create / rename / set head / archive. Store: `Department` via `/api/departments`. Who: E, HR. The Teams-hub page `/people/departments` stays as the browse view and gets a "Manage" link for console tiers.

**Job titles** `/settings/structure/job-titles` (list): Title, Suggested access level, Holders, KRAs, Definition link (→ `/people/roles/[id]`); create / rename / archive. The "roles control what holders can see" copy is deleted; the level column is labelled "Suggested access level" and the member drawer shows it as a hint when a title is assigned. Store: `Role` via `/api/roles`. Who: E, HR. `/people/roles` stays as the Teams-hub library.

**Offices** `/settings/structure/offices` (list): Name, City, Country, Timezone, Headquarters, Members; create / edit / delete. Store: `Office` via `/api/offices`. Who: E, HR. Was a "Coming soon" tile although model and API exist.

#### WORK DEFAULTS

**Spaces & sharing** `/settings/work/spaces` (Form; every row enforced)

| Field | Default | Store | Enforced in |
|---|---|---|---|
| New Spaces are: Private / Workspace / Org-wide | Workspace | `Org.settings.work.spaces.defaultVisibility` | `new-space-dialog` preselect + `POST /api/spaces` default |
| Who can create Spaces: Everyone / Managers and up / Admins | Everyone | `.whoCanCreate` | `POST /api/spaces`, "+" menu |
| Who can create Org-wide Spaces | Admins | `.whoCanCreateOrgWide` | `POST /api/spaces`, visibility picker |
| Default permission for new Space members: Can edit / Can view | Can edit | `.defaultMemberRole` (MEMBER or GUEST); replaces the dead `Space.settings.defaultPermission` control, which is removed from the New Space dialog | `addSpaceMember` when no explicit role |
| Members can share Lists and Folders outside the Space | on | `.allowObjectSharing` | share dialogs + `/api/boards/[id]/members`, `/api/folders/[id]/members` |
| Guests can comment | off | `.guestsCanComment` | item-updates gate |
| Public share links | on | `.publicLinks` | share-link routes (kill switch) |
| Share link expiry (days, 0 = never) | 0 | `.linkExpiryDays` | share-link routes |
| Require last owner: prevent removing the last Space owner | always on, informational | code | `removeSpaceMember` guard (new) |

**Task types** `/settings/work/task-types` (list): Name (singular/plural), Icon, Built-in / Custom, Default star, Used by; "New type" uses the shared `ui/dialog`; Recommended library in a side drawer. Store: `ItemType` via `/api/item-types` (POST/PATCH/DELETE gain the console edit check; the access hole closes). Who: E.

**Tags** `/settings/work/tags` (list): built on the orphan `tags-manager.tsx` logic against the real API shape (`type`, `_count.assignments`): Name, Type, Colour, Usage, Archived; create / rename / recolour / archive / delete; "Show archived" filter. SAMPLE data deleted. Store: `Tag` via `/api/tags`. Who: E.

**Performance & reviews** `/settings/work/performance` (Form, one card per block, one save bar)

| Field | Default | Store | Who |
|---|---|---|---|
| Review cadences: Weekly / Monthly / Quarterly / Annual, each: enabled, anchor day, reminder lead days, auto-open | current defaults | `Org.settings.reviewCadences` | E, R(HR) |
| Score weights: KPI / SOP compliance / Behavioural / Peer, sum 100 | current defaults; the legacy `{kpi, manager, peer, self, sopCompliance}` default is migrated to the four keys the page edits | `Org.settings.scoreWeights` | E |
| Performance bands: add / remove rows, label, min, max, colour from the 8-colour muted set (word colours like "lime" migrated to hex) | 5 bands | `Org.settings.scoringBands` | E |
| Behavioural anchors (5 labels) | current | `Org.settings.behavioralAnchors`, **wired** into the review form labels (`review-detail-client`) or removed; the spec wires them | E |
| Talent 9-box: link "Open Talent grid" → `/talent` | | | |
| Legacy `reviewFrequency` | removed from UI; API keeps reading it derived from the enabled cadence | | |

**Capacity** `/settings/work/capacity` (Form): Default weekly capacity hours (40), Working days (Mon to Fri checkboxes), Workload view counts (Estimates / Task count). Store: `Org.settings.work.capacity`; per-person override on the member drawer. Replaces the `workwrk:team-workload:v1` localStorage store. Who: E.

**Notification defaults** `/settings/work/notifications` (Form, Autosave rows): the same switch keys as the personal Notifications tab (inbox × 6, email × 5 live), shown as "Default for new members" with a lock icon per row ("Members cannot turn this off"). Daily digest send time (09:00 org timezone). Store: `Org.settings.notifications` (exists, had no UI) using the same key names as `UserPreference.notifications`; `notify-prefs.ts` resolves org default → user override → locked keys. Who: E.

**Appearance defaults** `/settings/work/appearance` (Form, Autosave): Theme (Light / Dark / System), Accent (brand blue only; the picker is retired per phase2 Q4 default, so this is a single locked value shown as "WorkwrK blue"), Density (Compact / Cozy), Locks: Theme, Density, Sidebar layout, Home cards. Store: `OrgPref.themeDefault / densityDefault / lockedKeys`. Locked keys grey the matching rows in the Preferences modal and in the Customize Sidebar panel (both already receive `effective.lockedKeys`). Who: E.

#### DATA (edit tier only)

**Import** `/settings/data/import` (list): Jobs table (Type, File, Rows, Status, Started by, Errors); "Start import" → People CSV (wired to `/api/people/bulk-import` with a staging grid and column mapping), Tasks CSV. The `/imports` page content moves here; `/imports` redirects. Store: import job rows (a small `ImportJob` model if none exists; otherwise ActivityLog `data.import`).

**Export** `/settings/data/export` (list): rows Full workspace ZIP, People CSV, Timesheets CSV, Audit CSV, each with Last exported by / at and a Download button; Purchase orders and Invoices exports removed (Finance is out of the PPMS scope). Export history table below (from `ActivityLog` type `data.export`, written on every download). Store: `ActivityLog`.

**Retention & privacy** `/settings/data/retention` (Form)

| Field | Default | Store | Enforced by |
|---|---|---|---|
| Trash retention (days) | 30 | `Org.settings.data.trashDays` | trash purge cron |
| Audit log retention (days) | 365 | `.auditDays` | audit prune cron |
| Members may export their own data | on | `.selfExport` | `/api/me/export` |
| Product analytics / consent (from the orphan `privacy-controls.tsx`) | off | `.privacy.*` | consent provider |
| AI: use your own API key (BYOK, Enterprise flag) | off | `OrgSecret` via the orphan `byok-manager.tsx` flow | AI routes |
| AI: allow AI features for members | on | `Org.settings.data.aiEnabled` | AI routes + rail |

**Danger zone** `/settings/data/danger` (Form, S only): Transfer ownership (pick another admin; sets them SUPER_ADMIN, demotes self to COMPANY_ADMIN), Delete organisation (typed confirm, 14-day restore window using `/api/organizations/delete` and `/restore`).

#### BILLING (edit tier only)

**Plan** `/settings/billing/plan`: current plan and status card; four plan cards from `PLAN_LIMITS` (STARTER / GROWTH / SCALE / ENTERPRISE) with limits and "Upgrade" → `POST /api/billing/checkout`, "Manage billing" → portal. When Stripe env is missing the page shows "Billing is handled by our team. Email billing@workwrk.com" instead of a 503 toast. Store: `Organization.plan`, `Subscription`.

**Usage** `/settings/billing/usage`: Seats used / limit, SOPs, AI queries **this billing period** (the all-time count is fixed), Storage, Active modules. Read-only.

**Invoices** `/settings/billing/invoices` (list): Number, Date, Amount, Status, PDF, from Stripe; honest empty state "Invoices appear here once billing is active".

#### AUDIT

**Activity log** `/settings/audit/log` (list, R may view)

- Text tabs: All / Access / Security / Data / Settings (tab = server-side type family filter).
- Filter side panel: Type (from a server-provided type list, not the first page), Actor (searchable), Severity, Date range. Search is server-side (`?q=`).
- Table: Time, Actor, Event, Target, Severity; row click opens a drawer with description, metadata, and old → new value diff (the API already returns them).
- Export honours every active filter including actor.
- New events written by the rebuild: `access.level.changed`, `permissions.updated`, `membership.changed` (Space / Folder / List), `visibility.changed`, `settings.updated.{section}` (exists), `data.exported`, `security.policy.updated`, `access.denied` (sampled 1 in 10 per actor per hour).
- KPI tiles removed (the "Today" tile counted only the loaded page).

### 2.4 The settings registry (search-first)

```ts
// src/lib/settings-registry.ts
export interface SettingEntry {
  id: string;                 // "security.sign-in.mfaRequired"
  label: string;              // "Require two-factor authentication"
  keywords: string[];         // ["2fa", "mfa", "authenticator"]
  section: ConsoleSection;    // "security"
  href: string;               // "/settings/security/sign-in#mfa"
  tier: "edit" | "read";      // minimum console tier that can open it
  personal?: boolean;         // lives in the Preferences modal; href = "?prefs=notifications#quietHours"
}
```

- Every field in 2.3 and every row in the Preferences modal is one entry. Pages register their entries next to their form schema so the two cannot drift (a unit test asserts every rendered field id exists in the registry).
- Search UI: console home field, console sidebar field (filters the nav and shows field-level matches beneath), ⌘K palette group "Settings" for console tiers (personal entries for everyone).
- Arriving with a hash scrolls to the card and pulses its border once (150ms, no transform).

### 2.5 The Preferences modal (personal, everyone)

Opened from the avatar menu ("Preferences", ⌘,), from the rail for non-console users (full page variant), and from any `?prefs={tab}` query on any route (so deep links and the old `/account/*` URLs work). 720 × min(80vh) centred `ui/dialog`, title "Preferences", text tabs: **Profile · Security · Notifications · Appearance**. Autosave rows; the two text forms (Profile names, password) use inline Save. Locked rows show a lock and "Managed by your admin".

| Tab | Field | Default | Store |
|---|---|---|---|
| Profile | Photo (upload / remove) | none | `User.avatar` via `/api/users/[id]/avatar` |
| Profile | First name, Last name | from invite | `User.firstName/lastName` |
| Profile | Email (read-only, "managed by your administrator"; SSO orgs say "managed by {IdP}") | | |
| Profile | Phone, Date of birth | blank | `User.phone`, `User.dateOfBirth` (API already accepts) |
| Profile | Job title, Department, Manager, Access level (read-only chips with labels, not raw enums) | | |
| Profile | Timezone (searchable; "Use organisation default") | org | `UserPreference.locale.timezone` (new JSON key) |
| Profile | Language | org | `UserPreference.locale.language` (read by root layout) |
| Profile | Week starts on, Date format, Time format | org | `UserPreference.locale.*` |
| Profile | Google Calendar: Connect / Disconnect (only when the org allows it) | | existing OAuth flow |
| Profile | "View full profile" → `/people/me` | | |
| Security | Email verified (Resend) | | `User.emailVerifiedAt` |
| Security | Two-factor authentication (Enrol / Turn off, QR, backup codes) | off | `User.mfaEnabled/mfaSecret/mfaBackupCodes` |
| Security | Change password (dialog; validated against the org policy, with the rules listed) | | `User.passwordHash` |
| Security | Sign out of all devices | | `POST /api/me/sign-out-everywhere` |
| Security | Recent security activity (10 rows) | | `GET /api/me/security-activity` |
| Security | Organisation policy summary (min length, MFA rule, idle timeout) read-only, "Managed by your admin" | | `GET /api/settings` security block (the only personal read of it) |
| Security | Danger: Delete my account (typed confirm; hidden for the last admin) | | `POST /api/me/delete` |
| Notifications | Inbox: 6 switches (assigned, mentioned, comment, status change, due soon, kudos) | on | `UserPreference.notifications.inbox` |
| Notifications | Email: Task assigned, Kudos, KRA, Review, SOP (live); Mentions, Comments, Status, Due, Daily digest only when "Show upcoming features" is on, rendered disabled with "Planned" | on | `UserPreference.notifications.email` + `EmailPreference` (kudos writes both, as today, until EmailPreference is folded in) |
| Notifications | Desktop notifications (browser permission + switch) | off | `UserPreference.notifications.desktop` (replaces `desktop-notifications-pref` localStorage) |
| Notifications | Quiet hours (start / end, org timezone) | off | `UserPreference.notifications.quietHours`, honoured by `notify-prefs.ts` for email and desktop |
| Notifications | Muted items (list with unmute) | none | `UserPreference.notifications.muted` (replaces `workwrk:os:muted-notifs`) |
| Appearance | Theme: Light / Dark / System | Light (or org default) | `UserPreference.theme.appearance` |
| Appearance | Accent: WorkwrK blue (single value; row hidden entirely once the picker is retired) | workwrk | `UserPreference.theme.accent` |
| Appearance | Density: Compact / Cozy | cozy (or org default) | `UserPreference.density` (the `workwrk:density` localStorage mirror is deleted) |
| Appearance | Sidebar: show labels / icons only; width "Reset" | labels | `UserPreference.sidebar.iconsOnly`, `.width`, `.collapsed` (replaces `workwrk:os:icons-only`, `sidebar-width`, `sidebar-collapsed`) |
| Appearance | Home cards (checkbox list) | all | `UserPreference.home.cards`, and the Home page **reads it** (today never read) |
| Appearance | Quick tools in the avatar menu (checkbox list) | default set | `UserPreference.sidebar.quickTools` (replaces `workwrk:os:profile-tool-pins:v2`) |
| Appearance | Reduced motion | system | `UserPreference.ui.reducedMotion` |
| Appearance | Show upcoming features | off | `UserPreference.ui.showUpcoming` (the honesty-vs-simplicity switch from phase2 Q15) |
| Footer | Keyboard shortcuts (opens overlay), Log out | | |

The "Customize Sidebar" footer panel stays (founder rule) and becomes a thin popover over the same Appearance rows (theme, density, sidebar, home cards). Both write `UserPreference`; there is one source.

---

## 3. Disposition table

Every existing settings/account page, every folded Settings-hub route, every orphan component, and every setting the audit found cosmetic or localStorage-only.

### 3.1 Routes

| Today | Disposition | New home | Reason |
|---|---|---|---|
| `/settings` Overview | **Rebuild** | Console home (card grid + search + checklist) | Self-links, stale vocab, half coverage. |
| `/settings/identity` | **Merge** | Structure › Company profile | Plus business type / team size (read but never written today); single PATCH; no blank-form overwrite. |
| `/settings/locale` | **Merge** | Structure › Locale & finance | IANA list, numeric fiscal month, week start / date / time format added, language made real. |
| `/settings/modules` | **Move** | Apps & modules › Modules | Adds consequences confirm and plan chip. |
| `/settings/apps` | **Move + enforce** | Apps & modules › Rail apps | Grouped by hub; hide/floor become a real route gate. |
| `/settings/tags` (+ orphan `tags-manager.tsx`) | **Replace** | Work defaults › Tags, built on the orphan manager's real API calls | Page fabricates SAMPLE data, never deletes, wrong field names. |
| `/settings/task-types` | **Move + gate** | Work defaults › Task types | Closes the any-employee-can-delete hole (API role check + section gate); shared dialog. |
| `/settings/members` | **Rebuild** | Users › Members (list + drawer) | Org scope guaranteed, more columns, cycle check, admin guards, profile links, overflow fixed. |
| `/settings/structure` | **Split** | Ladder → Users › Access levels; tiles → Structure › Departments / Job titles / Offices; the `#levels` anchor → `/settings/users/access-levels` | Hub-of-hubs with a stub tile and a 404 link (`/account`). |
| `/settings/hierarchy` | **Merge** | Users › Reporting lines (org-chart renderer, edit mode) | Duplicate of `/organization` with fewer safeguards. |
| `/settings/permissions` | **Replace** | Users › Access levels → level detail | 55 of 75 cells enforce nothing; pruned to enforced cells, cache invalidated, audited. |
| `/settings/audit` | **Rebuild** | Audit › Activity log | Server-side search and filters, row drawer with diff, export honours actor, KPI tiles dropped, `OsTitleBar` removed. |
| `/settings/data` | **Split** | Data › Export (downloads + history), Data › Retention & privacy (the promised retention settings), Trash link | PO / Invoice exports removed (scope). |
| `/settings/defaults` | **Move** | Work defaults › Appearance defaults | Accent list unified (single brand blue); locks enforced in the modal and the Customize panel. |
| `/settings/api` | **Move** | Security › API keys | Rate limits editable, hide revoked, list anatomy. |
| `/settings/calendar` (stub) | **Remove page**; keep the capability | Apps & modules › Integrations row "Google Calendar" (org switch) + Preferences › Profile "Connect Google Calendar" (per user); other providers hidden behind "Show upcoming features" | Page was a five-card "Coming soon"; the Google backend exists and lands its `?connected=1` redirect here today, so the redirect target becomes `/settings?prefs=profile#calendar`. |
| `/settings/integrations` (menu of stubs) | **Remove page** | Apps & modules › Integrations (one honest list) | Circular hub-of-hubs. |
| `/settings/import-export` | **Remove page** | Data › Import, Data › Export | Duplicate of Data & compliance. |
| `/settings/billing` | **Rebuild** | Billing › Plan / Usage / Invoices | Upgrade path in-app, period-scoped usage, honest no-Stripe state, single toast system. |
| `/settings/scoring` | **Move** | Work defaults › Performance & reviews | Read-only mode for R, brand button, bands add/remove, hex colours, anchors wired, one save bar with dirty guard. |
| `/settings/notifications` (personal) | **Move** | Preferences modal › Notifications | Personal setting living under the admin prefix; plus desktop, quiet hours, muted items. |
| `/account/profile` | **Move** | Preferences modal › Profile | Adds phone, DOB, timezone, language, formats, calendar connect. |
| `/account/appearance` | **Move** | Preferences modal › Appearance | Banned hues removed; org locks greyed; sidebar and home cards join it. |
| `/account/security` | **Move** | Preferences modal › Security | Org policy stays read-only here (and gets its real editor under Security › Sign-in policy); raw enum and raw error strings fixed. |
| `/account/notifications` (redirect) | **Redirect** | `/settings?prefs=notifications` | |
| `/account` (bare, 404) | **Redirect** | `/settings?prefs=profile` | Linked from the old structure page. |
| `/account/*` prefix | **Keep as deep-link aliases** | Each `/account/{tab}` rewrites to `/settings?prefs={tab}` | Old bookmarks keep working; no full-page duplicates of the modal. |
| `/organization` (org chart) | **Keep** under Teams | Structure card links to it; Users › Reporting lines reuses its renderer | Not a settings page. |
| `/people/me` | **Keep** | Preferences › Profile "View full profile" | Teams sidebar active-match fixed to `startsWith("/people/")` plus own id. |
| `/me/weekly-review` | **Keep** | untouched | Not settings. |
| `/me/mentions` (orphan) | **Redirect** | `/inbox?tab=mentions` | Duplicate of Inbox › Mentions. |
| `/people/departments`, `/people/roles`, `/people/roles/[id]`, `/people/skills` | **Keep** under Teams | Console list pages link out to them; they gain "Manage in Settings" for console tiers | Browse (Teams) vs manage (Console). |
| `/talent` (9-box) | **Keep** under Teams | Linked from Work defaults › Performance | Must remain reachable; it is. |
| `/build`, `/store` | **Keep** in normal shell | "Also in Settings" row on the console home; Apps & modules card secondary links | Not settings; still reachable. |
| `/tools`, `/assets` | **Keep** in normal shell | "Inventories" row on the console home (hr-admin+) | Operational inventories, not configuration. Server gate aligned to the catalog tier (hr-admin) via `requireAppAccess`. |
| `/trash` | **Keep** | Data card link + "Also in Settings" row | Gate aligned to catalog tier. |
| `/imports` | **Redirect** | Data › Import | Content moves. |
| `/integrations` (marketplace) | **Keep** | Linked from Apps & modules › Integrations | Demand-driven marketplace stays where it is. |
| `/templates` (Template Center) | **Keep** | "Also in Settings" row | |
| Settings hub sidebar (`SettingsSidebar` in apps-catalog) | **Rewrite** | Rows: Admin console (`/settings`), Preferences (opens modal), Inventories (Tools, Assets), Build apps, Marketplace, Trash | Its "Account · Security" row and sticky rendering on non-settings routes go away with the URL-driven sidebar fix (out of scope here, noted). |
| `SettingsShell` (two doors) | **Replace** | `ConsoleShell` (section 4) | Origin-aware back, clickable breadcrumb, search, single gate. |

### 3.2 Orphan components

| Component | Disposition |
|---|---|
| `settings/tags/tags-manager.tsx` | Absorbed into Work defaults › Tags, restyled on `--os-*` tokens. |
| `components/settings/branding-manager.tsx` | Absorbed: logo → Company profile; white-label fields (Enterprise flag) → Company profile "Branding" card, shown only when the flag is on. |
| `components/settings/byok-manager.tsx` | Absorbed into Data › Retention & privacy "AI data use" card (Enterprise flag). |
| `components/settings/privacy-controls.tsx` | Absorbed into Data › Retention & privacy. |
| `components/settings/sop-category-manager.tsx` | Stays with SOPs (`/sops/manage`), linked from Work defaults card as "SOP folders & categories". Not duplicated in the console. |
| `components/settings/sop-folders-tags-manager.tsx` | Unchanged (`/sops/manage`). |
| `admin-setup-checklist.tsx`, `tour-content.tsx` | Rewritten to the new targets (section 7). |

### 3.3 Settings that do nothing today

| Setting | Today | Disposition |
|---|---|---|
| Org security policy (`settings.security`) | No editor; shown read-only on the personal page; unenforced | Security › Sign-in policy, enforced at password set/change, login, session. |
| Org notification defaults (`settings.notifications`) | No UI | Work defaults › Notification defaults, resolved by `notify-prefs.ts`. |
| Space "Default permission" on New Space dialog | Stored, read by nothing | Control removed from the dialog; org-level "Default permission for new Space members" enforced in `addSpaceMember`. |
| `Default language` | Saved, unread | Read by root layout locale resolution; personal override in Preferences. |
| `businessType`, `teamSize` | Read on Overview, never written | Written from Company profile. |
| Legacy `reviewFrequency` | Shown on Overview, not editable | Removed from UI; derived from cadences. |
| Score weights default vocabulary (`manager`, `self`) | Differs from the page | Migrated on read to the four edited keys. |
| Behavioural anchors | Saved, ignored by reviews | Wired into review form labels (or removed if the reviews rebuild drops them; spec says wire). |
| Rail hide / minimum access | Display-only | Enforced by `requireAppAccess` layout gate. |
| Permission-matrix cells with no call site (~55) | Cosmetic | Removed from UI and sanitizer. |
| Matrix `people.create` | Enforced but duplicated by a visible-to-all Invite button | Replaced by Invite rules "Who can invite" and the button hides below the threshold. |
| Inbox prefs (`showAll`, `groupByDate`, `sortNewest`, `mode`) | PATCHed as `{inbox}`, stripped by the zod schema, so never saved | `inbox` key added to the preferences schema and `EffectivePreferences`; stored under `UserPreference.home.inbox`. |
| `home.cards` (Customize panel) | Saved, never read | Home reads it. |
| Density / sidebar locks | Enforced server-side, not greyed | Greyed in the Preferences modal and the Customize panel from `effective.lockedKeys`. |
| Personal accent list (purple / pink / violet / indigo, no `workwrk`) | Cannot pick the org default | Single brand blue; the row is removed once the picker is retired. |
| "Soon" email rows (Mentions, Comments, Status, Due, Daily digest) | Disabled rows always visible | Hidden unless "Show upcoming features" is on. |
| Offices "Coming soon" tile | Model + API exist | Structure › Offices, real. |
| SSO / SCIM (marketing promise, layout comment) | No UI | Security › Single sign-on, Security › Provisioning. |
| API key rate limits | Rows carry them, no editor | Editable in the key drawer. |
| Webhooks (mentioned on API keys page) | No UI | Security › Webhooks. |
| Retention (Data page subtitle "manage retention") | Nothing | Data › Retention & privacy, consumed by the purge crons. |
| Export history / who exported | Nothing | Data › Export history from `ActivityLog`. |
| Phone / DOB / per-user timezone | API accepts, Profile omits | Preferences › Profile. |
| Email change | Absent | Stays absent, stated honestly ("managed by your administrator"); admins change it from the member drawer (new field, audited). |
| Session / device list | Only a nuke button | Nuke button kept; device list is a reserved slot (needs a Session table), not rendered. |
| Danger zone (delete account, delete org) | APIs exist, no UI | Preferences › Security (account), Data › Danger zone (org). |
| HR segments (`HRSegment`) | Dead code, no UI | Not surfaced in this pass; the `resolveUser` HR branch is documented as reserved. Listed in risks. |
| Keyboard shortcuts page | Link to nothing | Overlay listing the real chords; dead `g` chords removed from copy. |

### 3.4 localStorage-only state (every key found in `src`)

Rule: a key may stay in localStorage only if it is device-specific by nature **and** never appears in Settings. Everything a user would expect to follow them moves to `UserPreference`.

| Key | Today | Disposition |
|---|---|---|
| `workwrk:os:presence` | Custom presence status, invisible to others | `User.presenceStatus` + `presenceUntil` (new columns); shown to teammates in Talk and the directory. |
| `workwrk:os:muted-notifs` | Muted entities | `UserPreference.notifications.muted`; listed in Preferences › Notifications. |
| `workwrk:os:profile-tool-pins:v2` | Quick tools pinned in the avatar menu | `UserPreference.sidebar.quickTools`; Preferences › Appearance. |
| `workwrk:os:sidebar-width`, `workwrk:os:sidebar-collapsed`, `workwrk:os:icons-only` | Sidebar layout | `UserPreference.sidebar.width / collapsed / iconsOnly` (iconsOnly already exists server-side; the mirror is deleted). |
| `workwrk:density` | Duplicate of `UserPreference.density` | Deleted. |
| `workwrk:task-saved-filters` | My Tasks saved filters | `UserPreference.home.savedFilters` (board saved filters already persist on the view). |
| `workwrk:team-workload:v1` | Per-person capacity typed by the manager | `User.weeklyCapacityHours` (manager-set in the member drawer) + org default. |
| `desktop-notifications-pref` | Desktop switch | `UserPreference.notifications.desktop`. |
| `workwrk:ai:saved-prompts` | Saved prompts | `UserPreference.ai.savedPrompts` (they are content the user expects to keep). |
| `workwrk:sidebar:pinned` | Pre-access-rail pinning leftovers | Deleted (pinning is gone). |
| `workwrk:os:active-app`, `workwrk:os:recent-apps`, `workwrk:sidebar:recent`, `workwrk:os:lens`, `workwrk:icon-recents`, `workwrk:create-task:last-list` | Recents / last-used | Allowed to stay (ephemeral navigation memory; not shown in Settings). `active-app` is a separate bug (sticky sidebar) outside this spec. |
| `workwrk:docs:splitRatio`, `workwrk:doc-tabs`, `workwrk:sheet-zoom:{id}`, `workwrk:room:fmtbar`, `workwrk:room:sections` | Per-surface layout | Allowed to stay (device layout). |
| `workwrk:notif-banner:dismissed-v1`, `planner:connectBannerDismissed`, `workwrk:overview:customize-dismissed`, `twrk-checklist-dismissed`, `workwrk-setup-checklist-dismissed`, `workwrk.firstRunWelcome.v1`, `wwk_mission_rotate_idx` | Dismissals | Dismissals of org-level setup move to `Org.settings.console.setupDismissedAt` (admin checklist) and `UserPreference.ui.dismissed[]` (personal banners) so they survive a new browser; the mission rotation index stays. |

---

## 4. Navigation

### 4.1 The ConsoleShell (replaces SettingsShell)

Full-screen takeover kept (founder constraint: "Settings is a full-screen takeover with a way back to the app").

- **Header, 48px, navy chrome** (`--os-brand-rail` navy, white text; the only place navy appears if the light-chrome shell variant wins): left "← Back to app" (origin-aware, 4.3), then a clickable breadcrumb `{Org} › Settings › Users › Members` (every crumb except the last is a link), centre nothing, right: search field (320px, "Search settings", ⌘/ focuses it), then X (close, same target as Back). The four dots logo at the far left.
- **Sidebar, 248px, N50**: filter field on top (same registry search; filters the nav and shows field matches), then eight section groups in console order, each with its pages as 32px rows, 14px text, 16px Lucide icon, active row N100 pill + 590 weight. Read tier sees the four readable sections only. Below the groups: "Preferences" row (opens the modal) so a console user never hunts for personal settings.
- **Content**: white canvas, 24px padding, max width 1120px for lists, 760px column for forms.
- Mobile / narrow (< 900px): the sidebar collapses to a "Sections" sheet opened from the breadcrumb; tables scroll inside their card. This is the first settings surface with a breakpoint.

### 4.2 Search

- One registry (2.4), three doors: console home field, sidebar filter, ⌘K palette group.
- Result row: label, section › page path in N500, tier chip for read-only entries. Enter navigates and pulses the target card.

### 4.3 Back / close rule: always return to the origin

- `OsShell` keeps `lastAppPath` (the last pathname outside `/settings`) in shell context, mirrored to `sessionStorage` so a hard refresh inside the console still knows where it came from.
- "Back to app", X and Esc all do `router.push(lastAppPath ?? "/today")`. No fixed `/today`.
- Inside the console, every page gets `BackButton{fallbackHref}` semantics through the breadcrumb: browser back when the previous history entry is inside the console, otherwise the parent crumb. The in-page "Settings › X" breadcrumbs, `OsTitleBar` "Settings" chips and "< Back to settings" links are all deleted; one pattern.
- Esc inside a drawer or modal closes that layer first; Esc on a page with a dirty form triggers the guard (4.4); Esc on a clean page leaves the console.
- The Preferences modal closes to exactly where it was opened (it is a layer, not a route), and `?prefs=` is removed from the URL on close.

### 4.4 Dirty-state guard

- Autosave rows (switch, select, picker, chips) are never dirty; they show a 1.5s "Saved" tick in the row and a toast only on failure (with Retry).
- Form pages (text inputs, textareas, multi-field cards) track `isDirty`; a sticky save bar appears at the bottom of the content column only when dirty: "Unsaved changes · Discard · Save changes".
- `useDirtyGuard(isDirty)` intercepts: sidebar links, breadcrumb, Back / X / Esc, browser `beforeunload`, and the Next router (`router.push` wrapped in the ConsoleShell). It opens a 400px confirm: "Save your changes?" with Save / Discard / Keep editing. This covers Permissions (now Access levels), Performance, Company profile, Locale, Sign-in policy, SSO, Spaces & sharing, Retention.
- Save failures keep the form dirty and show the field or banner error; the guard stays armed.

### 4.5 Deep links and redirects

`next.config.ts` redirects (308) so every historic URL lands on its new home:

| From | To |
|---|---|
| `/settings/identity` | `/settings/structure/profile` |
| `/settings/locale` | `/settings/structure/locale` |
| `/settings/modules` | `/settings/apps/modules` |
| `/settings/apps` | `/settings/apps/rail` |
| `/settings/tags` | `/settings/work/tags` |
| `/settings/task-types` | `/settings/work/task-types` |
| `/settings/members` | `/settings/users/members` |
| `/settings/structure` | `/settings/structure/departments`; `#levels` → `/settings/users/access-levels` |
| `/settings/hierarchy` | `/settings/users/reporting` |
| `/settings/permissions` | `/settings/users/access-levels` |
| `/settings/audit` | `/settings/audit/log` |
| `/settings/data` | `/settings/data/export` |
| `/settings/defaults` | `/settings/work/appearance` |
| `/settings/api` | `/settings/security/api-keys` |
| `/settings/calendar` | `/settings/apps/integrations` (`?connected=1` → `/settings?prefs=profile#calendar`) |
| `/settings/integrations` | `/settings/apps/integrations` |
| `/settings/import-export` | `/settings/data/export` |
| `/settings/billing` | `/settings/billing/plan` |
| `/settings/scoring` | `/settings/work/performance` |
| `/settings/notifications` | `/settings?prefs=notifications` |
| `/account`, `/account/profile`, `/account/appearance`, `/account/security`, `/account/notifications` | `/settings?prefs={profile,appearance,security,notifications}` |
| `/imports` | `/settings/data/import` |
| `/me/mentions` | `/inbox?tab=mentions` |
| `/settings?tab=themes`, `/settings?tab=shortcuts` | `/settings?prefs=appearance`, `/settings?shortcuts=1` |

`?prefs={tab}` and `?invite=1` and `?filter=` are the only query contracts; every field has a hash anchor.

---

## 5. Persistence rule and API shape

### 5.1 The rule

**If it renders, it persists, and something reads it.** Concretely:

1. Every control in the console and the Preferences modal maps to exactly one storage class below. A PR that adds a control must add the registry entry, the storage key and the reader in the same change (a test walks the registry and asserts a reader exists by grep-able key).
2. No control is rendered for a backend that does not exist. Unbuilt options are hidden behind the personal "Show upcoming features" preference and, when shown, are disabled with "Planned".
3. localStorage holds only device-local layout and recents (3.4). Nothing shown in Settings reads or writes it.
4. Every write is audited with `settings.updated.{section}` (org) or is silent for personal preferences except security events.
5. Reads are effective values: org default → user override → org locks re-stamped (already the merge order in `preferences.ts`; extended to notifications and locale).

### 5.2 Storage classes

| Class | Table / column | What lives there | Writer API |
|---|---|---|---|
| **Org config** | `Organization.settings` JSON, namespaced keys | `companyProfile`, `industry`, `businessType`, `teamSize`, `timezone`, `currency`, `fiscalYearStart`, `weekStart`, `dateFormat`, `timeFormat`, `language`, `security.*`, `notifications.*`, `permissions`, `reviewCadences`, `scoreWeights`, `scoringBands`, `behavioralAnchors`, `users.*` (invite rules), `work.spaces.*`, `work.capacity.*`, `apps.calendarSync.*`, `data.*`, `console.*` | `PATCH /api/settings` `{ section, data }` with one zod schema per section (`profile`, `locale`, `security`, `notifications`, `users`, `work`, `scoring`, `data`, `console`); unknown keys rejected; the `general` and `modules` sections are retired |
| **Org shell defaults** | `OrgPreference` | `sidebarDefault.apps` (rail), `themeDefault`, `densityDefault`, `homeDefault`, `lockedKeys` | `PATCH /api/org/preferences` (unchanged) |
| **Org entitlements** | `ProductInstallation` | modules on/off | `POST/DELETE /api/products/installations` |
| **Org rows** | `User`, `Invitation`, `UserDottedLine`, `Department`, `Role`, `Office`, `ItemType`, `Tag`, `ApiKey`, `ScimToken`, `IdentityProvider`, `WebhookSubscription`, `Subscription` | list pages | existing REST routes; role checks aligned to `consoleAccess` and the manager rule |
| **Personal** | `UserPreference` JSON columns, namespaced: `sidebar.{iconsOnly,width,collapsed,quickTools,sectionsOrder}`, `home.{cards,order,favorites…,inbox,savedFilters}`, `theme.{appearance,accent}`, `density`, plus new top-level JSON keys inside `home` until columns are promoted: `home.notifications`, `home.locale`, `home.ui`, `home.ai` | everything in the Preferences modal that is not an account credential | `PATCH /api/preferences` with the zod schema extended by `inbox`, `notifications`, `locale`, `ui`, `ai`, `sidebar.width/collapsed/quickTools`, `home.savedFilters` |
| **Personal (email channel)** | `EmailPreference` | KRA / review / SOP / kudos / digest email switches | `/api/email-preferences`; folded into `UserPreference.notifications.email` in a follow-up |
| **Account** | `User` columns | names, avatar, phone, DOB, MFA, password, tokenVersion, `presenceStatus`, `weeklyCapacityHours` | `/api/users/[id]`, `/api/me/*` |
| **Audit** | `ActivityLog` | every org write, exports, access changes | `logAuditEvent` |

Migration footprint: one additive migration (`User.weeklyCapacityHours Int?`, `User.presenceStatus String?`, `User.presenceUntil DateTime?`), applied with `prisma db execute` per the drift note; everything else is JSON keys inside existing columns. Column promotion for `UserPreference.notifications/locale/ui` is optional and later.

### 5.3 API conventions

- Org writes: `PATCH /api/settings { section, data }` → `{ ok, settings }` (the fresh section), 400 with `issues[]` on schema failure, 403 only for non-edit tiers (the UI never lets them try).
- Personal writes: `PATCH /api/preferences { …partial }` → `{ effective }`; the client re-renders from `effective` so locks are always reflected.
- List pages: cursor pagination (`?cursor=&limit=50`), server-side `q`, filter params mirrored in the URL so a filtered list is shareable.
- Every list row drawer saves per field (Autosave) and returns the updated row.
- One toast system (`useOsToast`); Billing's `ui/toast` use is removed.

---

## 6. How it looks

Applied from `zoho-reference.md` with the brand rules from `phase2-inputs.md` (blue `#0073EA` only, cool neutrals, 14px base, borders over shadows).

### 6.1 Console list page (Members as the example)

```
┌ navy header: ●●●● {Org} › Settings › Users › Members        [Search settings ⌘/]  ✕ ┐
│ N50 sidebar 248 │ white canvas, 24px padding                                        │
│ [filter field]  │ Members                                    (20/590)               │
│ USERS           │ All members · Admins · Managers · Pending invites · No manager    │
│  Members  ●     │  (text tabs, 14px, active = N100 pill + 590)                      │
│  Invitations    │ [⛉ Filter] [⇅ Sort]  ·············  [Export ▾] [+ Invite]          │
│  Access levels  │ ┌ filter panel 260 ┐ ┌ bordered card, radius 8, 1px N200 ──────┐ │
│  Reporting lines│ │ Filter members   │ │ ☐ Person      Email     Access  Dept  ⚙ │ │
│ SECURITY        │ │ [search]         │ │ ─ hairline rows, 36px, 14px, no zebra ─ │ │
│  Sign-in policy │ │ ☐ Access level ▾ │ │ ○ Priya S.   priya@…   Manager  Eng     │ │
│  …              │ │ ☐ Department ▾   │ │ ○ Ravi K.    ravi@…    Employee Sales   │ │
│                 │ │ ☐ Status         │ │ ……                                      │ │
│                 │ └──────────────────┘ │ Total 42                  1 to 40  ‹ › │ │
│ Preferences     │                      └────────────────────────────────────────┘ │
```

- Title 20/590 N800; description line 13/400 N500 only when it adds information.
- Text-tab views: plain 14px N600 text, active = N100 rounded-6 pill with 590 weight; overflow into "•••". Tabs are saved views (server filter presets), not client state.
- Toolbar 40px: Filter (toggles the side panel; pill when active), Sort, a hairline divider, view switcher only where a list has more than one renderer (Reporting lines: chart / table). Right: one solid blue primary, optional split arrow, then a bordered "•••" square for secondary actions.
- Filter side panel inside the content column (260px, bordered card): search field, then checkbox rows 36px. The table narrows; no popover soup.
- Table: bordered white card, 32px N50 header with 12/590 N500 labels, checkbox column, inline header filter on the first text column, column-settings gear pinned right, 36px rows, hairline separators, no zebra, hover N50, no hover chrome; footer inside the card: "Total N" left, range + chevrons right.
- Row click opens a 520px right drawer (own header: title, "Open profile ↗", close); never a second page.
- Empty state: 96px four-dot line drawing in N300, one 16/590 sentence, one 13px N500 line, one primary only when wired ("Invite your first teammate").
- Read tier: same page, banner row above the toolbar (blue-50 bg, blue-700 text: "Read-only. Company admins can change these settings."), primary button absent, drawers read-only.

### 6.2 Console form page (Sign-in policy as the example)

```
Sign-in policy                                            (20/590)
How people sign in to {Org}. Changes apply on next sign-in.   (13 N500)

┌ Passwords ─────────────────────────────────────────────┐
│ Minimum length            [ 8  ]                        │  ≤ 5 fields per card,
│ Require uppercase         (●  )   Require numbers (●  ) │  labels above or left at 160px,
│ Require a symbol          (  ○)                         │  36px inputs, radius 6, N300 border
│ Password max age (days)   [ 0  ]  0 = never             │
└─────────────────────────────────────────────────────────┘
┌ Sessions ──────────────────────────────────────────────┐
│ Idle timeout (minutes)    [ 720 ]                       │
│ Absolute lifetime (days)  [ 30  ]                       │
│ [Sign everyone out]  ghost, opens typed confirm         │
└─────────────────────────────────────────────────────────┘
┌ Two-factor authentication ─────────────────────────────┐
│ Require MFA for   ( ) Nobody  (●) Admins  ( ) Everyone  │
│ 12 of 14 admins enrolled · view                         │
└─────────────────────────────────────────────────────────┘
┌ Failed sign-ins ───────────────────────────────────────┐
│ Lock after [ 5 ] attempts for [ 15 ] minutes            │
└─────────────────────────────────────────────────────────┘
                                   ┌ sticky bar (only when dirty) ┐
                                   │ Unsaved changes  Discard  [Save changes] │
```

- Cards: white, 1px N200, radius 8, 16px padding, 16/590 card title, 24px gap between cards; content column 760px.
- Switches and selects inside a form card still autosave only on pages marked Autosave; on Form pages every control feeds the single save bar so one Save writes one section.
- Danger zone: last card, N200 border with a danger-text title, destructive button is the only red on the page, typed confirmation for org-level actions.
- Help text 13px N500 under the field, never a tooltip icon.
- Locked (personal side): row greyed, lock icon, "Managed by your admin".

### 6.3 Console home card

Bordered card, radius 8, 20px icon in blue-50 tile, 16/590 title, 13px N500 line, then three or four 14px link rows (chevron right on hover only), then a 12/590 N500 live figure at the bottom. Hover = N50 background. Grid gap 16px.

### 6.4 Preferences modal

`ui/dialog` 720px, title "Preferences" 16/590, text tabs (same style as list-page views) under the title, content 24px padding with the same bordered cards (max 5 rows), Autosave rows with "Saved" tick, footer: Keyboard shortcuts (ghost), Log out (ghost, danger text). Pickers inside it are absolute-positioned children (dialog rule).

### 6.5 Tokens and copy

- Only `--os-*` tokens; no raw hex in the console (the current 19px + `#0073EA` sub-style, black primaries and `accent-zinc-900` checkboxes are gone; checked controls use `--os-brand`).
- Loaders: `ValueLoader` for route transitions only; skeleton rows inside tables and cards. No `Loader2`, no "Loading…" strings.
- Copy: sentence case, no em dashes, no ellipsis characters, labels identical in the sidebar, the page title and the breadcrumb (label drift list #25 closed by the registry: the page title is the registry label).

---

## 7. New-org defaults and the first-run path

### 7.1 Defaults written at org creation (all in one `createOrganization` transaction)

| Setting | Default |
|---|---|
| Timezone | detected from the signup browser, else `Asia/Kolkata` |
| Currency | from country, else INR |
| Fiscal year start | 4 (April); 1 when country is US/UK/EU |
| Week start / date / time | Monday / DD/MM/YYYY / 12h |
| Language | en |
| Modules | Talk off, Tables off (premium, per modular architecture) |
| Rail | catalog order, nothing hidden, catalog baseline floors |
| Invite rules | allowed domain = signup domain; auto-join off; who can invite = Managers and up; default level EMPLOYEE; expiry 7 days |
| Sign-in policy | min 8, uppercase + numbers, no max age, idle 720 min, lifetime 30 days, MFA required for admins, lockout 5 / 15 |
| SSO / SCIM | off / no tokens |
| Spaces & sharing | new Spaces Workspace-visible; everyone may create Spaces; only admins create Org-wide; new members Can edit; object sharing on; guests cannot comment; public links on, no expiry |
| Task types | built-ins only (Task, Bug, Milestone…) with Task as default |
| Tags | none |
| Performance | quarterly cadence on, weekly heartbeat on, weights 40/20/30/10, five bands, default anchors |
| Capacity | 40 h, Mon to Fri |
| Notifications | all inbox on; email: assigned, kudos, KRA, review, SOP on; no locks |
| Appearance defaults | Light, brand blue, cozy, no locks |
| Retention | trash 30 days, audit 365 days, self-export on, AI on, BYOK off |
| Plan | STARTER, status TRIAL (as today) |
| Console | `setupDismissedAt` null (checklist shown) |

The first user is SUPER_ADMIN (organisation owner); the second admin they promote is COMPANY_ADMIN.

### 7.2 First-run path (replaces `admin-setup-checklist` targets and tour steps 1 to 3)

The console home shows a "Set up {Org}" card until all six are done or the owner dismisses it. Each step is derived from data, not from a stored flag, so it can never lie:

1. **Complete your company profile** (done when name, logo or domain, and at least one value exist) → `/settings/structure/profile`.
2. **Check locale** (done once the locale section has been saved once) → `/settings/structure/locale`.
3. **Invite your team** (done when ≥ 2 active members) → `/settings/users/members?invite=1`.
4. **Create your structure** (done when ≥ 1 department) → `/settings/structure/departments`.
5. **Review sign-in security** (done when the security section has been saved once or MFA is enrolled by the owner) → `/settings/security/sign-in`.
6. **Decide on modules** (done when the modules page has been visited once, recorded in `console.modulesReviewedAt`) → `/settings/apps/modules`.

Dismiss writes `Organization.settings.console.setupDismissedAt`. The non-admin first run is untouched (welcome, mission splash policy per phase2 Q3).

---

## 8. Risks

1. **Tier change for C_LEVEL.** Today C_LEVEL can PATCH org settings (locale, security policy, profile) by URL. The console makes C_LEVEL read-only. If the founder wants C-suite to edit, the fix is one line in `consoleAccess`, but it must be a decision, not drift.
2. **Enforcing rail hide / floor can lock people out.** Making hidden apps really unreachable is the point, but an admin who hid "Teams" for managers today did so with no consequence; after the change managers lose `/team`. Mitigation: a one-time migration report listing orgs whose current config would block anyone, and the Rail apps page shows "N people lose access" before saving a floor.
3. **Pruning the permission matrix removes visible options.** Admins who ticked cosmetic cells will see them vanish. Mitigation: release note plus the "Enforced" framing; the sanitizer drops unknown keys silently today anyway.
4. **Migration on a drifted production database.** Three new `User` columns need `prisma db execute`; JSON-key changes need none. Capacity and presence can ship behind a flag if the migration slips.
5. **URL scheme change.** Twenty-four redirects plus the `?prefs=` contract; any external doc (documentation.ai) linking old paths must be updated in the same release. Redirects are 308 so bookmarks survive.
6. **Modal versus deep link.** A modal is the wrong container for a narrow screen and for screen readers arriving from a link. Mitigation: `/settings` for non-console users renders the same panel full page, and the modal degrades to full page below 720px.
7. **Webhooks and Import pages depend on routes not verified end to end** (`/api/webhooks/[integrationId]`, `/api/people/bulk-import`). Ship those two pages only after a real run; do not stub them.
8. **Language becoming real.** Reading `Org.settings.language` in the root layout switches copy for whole orgs that saved a non-English value years ago as a cosmetic field. Mitigation: migrate any saved value other than `en` to `en` once, with an audit note.
9. **Space default-member permission enforcement** changes what "Member" means for orgs that set Can view: existing rows are untouched, only new memberships get GUEST. Document on the page.
10. **Locks greyed in the Preferences modal** rely on `effective.lockedKeys` names matching the new namespaced keys (`theme.appearance`, `density`, `sidebar.iconsOnly`, `home.cards.*`); the Defaults page must write the same dot-paths. One constants file for lock keys.
11. **Guests, HR segments, device sessions, custom roles** are not in this spec. The console leaves reserved (hidden) slots: Users › Guests, Users › HR segments, Security › Devices, Users › Custom roles. They are listed here so nobody adds "Coming soon" rows for them.
12. **Scale of the rebuild**: 8 sections, 27 pages, one modal, one shell, one registry, three API schema extensions, ~10 enforcement hooks. Sequence: ConsoleShell + gate + registry + redirects (week 1), Users + Structure (week 2), Security + Work defaults (week 3), Data + Billing + Audit + Preferences modal (week 4), localStorage migration and enforcement hooks (week 5). Old pages stay behind redirects until each new page ships, so nothing is unreachable mid-way.
13. **Navy console header** commits to the Zoho chrome variant before the shell decision is made. If the light shell wins, the header takes the light tokens; nothing else in the console changes.
