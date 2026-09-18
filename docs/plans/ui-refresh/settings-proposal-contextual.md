# Settings architecture proposal: Contextual settings

Stance: settings live where the thing is. A Space is configured on the Space, a List on the List, notifications in the Inbox, a module on the hub it gates, task types and tags in the Work hub's manage panel. The org admin area keeps only true org-level items (identity, members and access, security, billing, audit, data). The settings sidebar shrinks to six rows for admins and four for everyone else. Nothing that exists today is removed without a redirect or a re-parent listed in section 3.

Sources read: the audit inventories (`settings-pages.md`, `access-model.md`, `critic-gaps.json` issues #4 and #7), `existing-direction.md`, `phase2-inputs.md`, `zoho-reference.md`, and the live code under `src/app/(dashboard)/settings/*`, `src/app/(dashboard)/account/*`, `src/components/layout/os/settings-shell.tsx`, `src/app/api/settings/route.ts`, `src/app/api/preferences/route.ts`, `src/app/api/org/preferences/route.ts`, `src/lib/preferences.ts`, `src/lib/access-levels.ts`, `src/components/layout/os/access-tiers.ts`, `src/lib/route-guard.ts`, the Space and List "•••" menus, and the Prisma models for Organization, User, UserPreference, OrgPreference, EmailPreference, Space, Folder, Board, SpaceMember, FolderMember, BoardMember, ProductInstallation.

One-liner: every setting has exactly one home, the home is the thing it configures, and the org admin area is a six-page takeover for org-level truth only.

---

## 0. The three rules this design is built on

1. **One home per setting.** A setting appears in exactly one place. Other surfaces may link to it (a "Default task type" row in List settings links to Work › Manage › Task types) but never duplicate the control. The Overview card grid of today, which repeats values and self-links, is gone.
2. **Where the thing is.** If a setting scopes to an object (Space, Folder, List, Doc, Table, Channel) it lives on that object's "•••" › Settings panel. If it scopes to a hub's content model (task types, tags, templates, SOP folders, review cadence, calendar connections) it lives in that hub's Manage panel. If it scopes to one person it lives under the avatar (My account) or the Inbox gear. Only settings that scope to the organisation as a legal or billing entity live in Admin.
3. **Nothing visible is cosmetic.** Every control on every settings surface writes to a server store and is read by at least one consumer. A control with no consumer is deleted or hidden behind the "Show upcoming features" preference (Phase 2 brief Q15 default). Device-only UI state (collapsed sidebar, zoom, dismissed banners) may stay in localStorage but is never presented as a setting.

---

## 1. Doors: entry points and who sees each

| # | Door | Where it is | Opens | Who sees it |
|---|---|---|---|---|
| D1 | **Object settings** | "•••" menu on a Space, Folder, List, Doc, Table, Talk channel (sidebar tree, page title row, breadcrumb chevron) › **Settings** | Right drawer `ObjectSettingsPanel` (520px) on the object's own URL with `?panel=settings&tab=...` | Everyone who can read the object. Read-only rendering for anyone without `manage` on it (see 5.4). |
| D2 | **Hub Manage** | Last row of every hub's secondary sidebar, directly above the "Customize Sidebar" footer, labelled **Manage** with a sliders icon | Full page at `/{hub}/manage` inside the normal shell (rail + sidebar + top bar), with text tabs per section | Everyone. Sections inside the page are individually gated: hidden when the viewer cannot even read that config, read-only when they can read but not change. |
| D3 | **Inbox preferences** | Inbox top-right gear (already rendered in the Inbox chrome) and the bell popover footer "Notification preferences" | Full page `/inbox/preferences` inside the normal shell | Everyone. Admin-only "Organisation defaults" section appears at the bottom for org admins. |
| D4 | **Customize Sidebar** | The existing footer button in every secondary sidebar (memory: must stay) | The existing `CustomizePanel`, now with an admin-only tab strip: Appearance, Sidebar, **Rail for everyone** (admins), **Defaults and locks** (admins) | Everyone; the two admin tabs render only for org admins. |
| D5 | **My account** | Avatar menu (top-right) › My account; also the rail Settings icon for non-admins | Settings takeover at `/account/*` with a four-row sidebar: Profile, Preferences, Security, Notifications (Notifications is a link that opens D3 and returns) | Everyone. |
| D6 | **Admin** | Rail hub "Settings" (alwaysPinned stays; for non-admins it resolves to `/account`), avatar menu › Admin, workspace menu › Admin, `⌘K` "Admin" | Settings takeover at `/settings/*` with a six-row sidebar: Identity, Members, Security, Billing, Audit, Data, plus a footer row "My account" | Org admins only (SUPER_ADMIN, COMPANY_ADMIN). Server-gated once in `settings/layout.tsx`. Non-admins hitting any `/settings/*` URL are redirected to `/account` with a toast "That area is for admins". |
| D7 | **Module gate** | The rail icon of a premium module that is off (Talk, Tables). Visible to org admins even when the module is off, rendered dim with an "Off" dot | `ModuleDisabledScreen` with the on/off switch on the screen itself | Org admins. Non-admins never see an off module's rail icon. |
| D8 | **Search** | `⌘K` command palette | Every setting is indexed (label, synonyms, location) by a `SETTINGS_INDEX` registry; picking a result opens its home (panel, page or takeover) | Everyone; results are filtered by the same gate the home uses. |
| D9 | **All settings** | Footer row of both takeover sidebars and avatar menu › All settings | `/settings/all` (admins) or `/account/all` (everyone): a generated index page listing every setting with its home, grouped by door, searchable | Everyone (their own gated subset). This is the safety net for discoverability once settings are distributed. |

Entry-point fixes to the surfaces that link into settings today (all from `settings-pages.md` §0):

- Profile menu "Settings" → **Admin** for admins, **My account** for others. "Themes" → opens D4 (Customize) on the Appearance tab. "Keyboard shortcuts" → opens the shortcut overlay (`?`), a new small modal listing the working chords (Phase 2 brief 4.6); the dead `?tab=shortcuts` query is retired. "Notifications" → `/inbox/preferences`. "My Profile" → `/people/me` unchanged.
- Rail bottom "Upgrade" → `/settings/billing` for admins; hidden for everyone else (a non-admin cannot upgrade).
- Workspace menu "Manage members" → `/settings/members`; "Invite people" → `/settings/members?invite=1` which opens the invite modal on load.
- Board "•••" › "Default task type" → List settings panel › Defaults tab (the row there links to Work › Manage › Task types for the library).
- Create-task modal type picker footer "Manage types" → `/work/manage?tab=types`.
- `ModuleDisabled` "Enable in Settings › Modules" → the switch is on the screen (D7); the link text goes away.
- Org chart "Org settings" → `/settings/identity`; "fix in Members" → `/settings/members?focus={userId}`.
- People profile (self) "Edit personal info" → `/account/profile` unchanged.
- Tools / Assets / Integrations page "Settings" nav-link → removed (they now live in a hub sidebar; the shell breadcrumb is the way back).
- Admin setup checklist: "Set up your company profile" → `/settings/identity`; "Create departments" → `/people/departments`; "Invite your team" → `/settings/members?invite=1`. Tour steps 1 to 3 re-pointed to Identity, Members, Members › Access levels with matching copy.
- Structure page link to bare `/account` → `/account` now renders (redirects to `/account/profile`).

---

## 2. Information architecture

Legend for "Who": **Admin** = SUPER_ADMIN or COMPANY_ADMIN. **HR admin** = Admin + HR. **Manager** = MANAGER_LEVELS set. **Object manager** = resolver level `manage` on that object (OWNER/ADMIN of the Space, Folder, List; List owner; Admin). **Self** = the user. Every "Where" is a real store; section 5 defines the API shape for each.

### 2.0 The tree

```
IN CONTEXT (normal shell, no takeover)
├─ Object › ••• › Settings                    [D1]
│   ├─ Space:  General · Sharing · Views and modules · Defaults · Danger
│   ├─ Folder: General · Sharing · Danger
│   ├─ List:   General · Sharing · Statuses · Fields · Defaults · Danger
│   ├─ Doc:    Sharing · Info
│   ├─ Table:  Sharing · Info · Danger
│   └─ Channel: existing Talk channel settings sheet (unchanged, renamed "Settings")
├─ Hub › Manage                               [D2]
│   ├─ Work › Manage:    Task types · Tags · Templates · Saved filters · Trash
│   ├─ Planner › Manage: Calendar connections · Time and week
│   ├─ Talk › Manage:    Module · Announcements
│   ├─ Docs › Manage:    SOP folders and access · SOP categories · Publishing
│   ├─ Teams › Manage:   Departments · Job titles · Offices · Reporting lines · Reviews and scoring · Workload capacity · Tools · Assets
│   ├─ Tables › Manage:  Module · Forms
│   └─ AI › Manage:      AI keys · Automations · Connections · Build · Store
├─ Inbox › gear › Notification preferences    [D3]   /inbox/preferences
├─ Customize Sidebar (footer)                 [D4]   Appearance · Sidebar · Rail for everyone (admin) · Defaults and locks (admin)
│
TAKEOVER (settings mode)
├─ My account                                 [D5]   /account/profile · /account/preferences · /account/security · (Notifications → D3)
└─ Admin (org admins only)                    [D6]   /settings/identity · /settings/members · /settings/security · /settings/billing · /settings/audit · /settings/data
    └─ footer: My account · All settings
```

### 2.1 Object settings panel (D1)

One component, `ObjectSettingsPanel`, with a tab strip whose tabs depend on the object kind. Opens as a right drawer on the object's own route; URL gains `?panel=settings&tab=sharing` so it is deep-linkable and browser Back closes it. Header: `EntityTile lg` + object name + kind caption + close. Every toggle and select autosaves with an inline "Saved" tick; text fields save on blur; the only explicit Save button in the panel is the Statuses editor (it is a batch edit). Read-only mode: when the viewer lacks `manage`, every control renders disabled with a one-line banner "You can view these settings. Ask {owner name} to change them."

The existing dialogs are re-parented as tabs, not rewritten: `ShareSpaceDialog`, `ShareBoardDialog`, `ShareFolderDialog` (unified in 5.4), `board-status-editor.tsx`, `field-shelf.tsx`, `space-modules-modal.tsx`, the color and icon picker.

#### Space › Settings

| Tab | Field | Default | Where it persists | Who |
|---|---|---|---|---|
| General | Name | required | `Space.name` | Object manager |
| General | Description | empty | `Space.description` | Object manager |
| General | Icon and colour | first letter, neutral | `Space.icon`, `Space.color` (colour picker offers the muted 8-set from Phase 2 brief 3.3, no semantic hues) | Object manager |
| General | Slug (read-only, copy) | generated | `Space.slug` | read-only |
| Sharing | Visibility: Private (invited only) / Org-wide (anyone in the org can open) | Private | `Space.visibility` (PRIVATE or ORG; WORKSPACE retired, see 5.4) | Object manager |
| Sharing | New members join as: Can edit / View only | Can edit | `Space.settings.defaultRole` = MEMBER or GUEST, read by `addSpaceMember` and the Space invite route as the default role. This is the "Default permission" control that exists today with no reader; it is wired, not removed. | Object manager |
| Sharing | Members list with role select (Owner / Can manage / Can edit / View only), remove, Add people (full-directory picker), Add by department, Invite by email as Guest | owner only | `SpaceMember` rows; invites via `/api/spaces/[id]/invitations` creating a GUEST org account (5.4) | Object manager (Owner row protected: last-owner guard, Transfer ownership action) |
| Sharing | Who can see this and why (read-only explainer built from `resolveAccess` reasons: "12 members, org admins, and anyone in the org because visibility is Org-wide") | | computed | everyone |
| Views and modules | Enabled tabs for this Space (Overview, List, Board, Calendar, Docs, Tables, Whiteboards, Files) | all on | `Space.settings.modules[]` (already written by `space-modules-modal.tsx`, already read by the Space page) | Object manager |
| Views and modules | Hidden views | none | `Space.settings.hiddenViews[]` (already read by `SpaceViewTabs`) | Object manager |
| Defaults | Default List statuses for new Lists in this Space | canonical trio | `Space.settings.defaultStatuses` (new key; read by List create) | Object manager |
| Defaults | Default task type for new Lists | org default | `Space.settings.defaultItemTypeId` (new; read by List create and by the create-task modal when the List has none) | Object manager |
| Defaults | New Lists and Folders are private by default | off | `Space.settings.privateByDefault` (new; read by the New List and New Folder dialogs to pre-tick "Make private") | Object manager |
| Danger | Archive, Move, Duplicate, Delete (typed confirmation) | | existing endpoints (`DELETE /api/spaces/[id]`, `/move`, duplicate) | Object manager (Delete: Owner or Admin) |

Automations stays a reserved slot in the "•••" menu (Phase 2 brief 4.6), not a tab, until the in-context automations modal ships.

#### Folder › Settings

| Tab | Field | Default | Where | Who |
|---|---|---|---|---|
| General | Name, Description, Icon and colour | | `Folder.name/description/icon/color` | Object manager |
| Sharing | Private folder (toggle; on = only members below plus Space owners and admins) | inherits (off) | `Folder.visibility` PRIVATE or WORKSPACE. **`updateFolder` gains a `visibility` field**; today it is immutable after creation (access-model #10). | Object manager |
| Sharing | Members (same unified list as Space; role labels identical; Owner row shown as Owner, never rendered as Admin) | | `FolderMember` rows | Object manager |
| Sharing | Inherited access row: "Everyone with access to {Space} can also open this folder" (only when not private) | | computed | everyone |
| Danger | Archive, Move, Delete | | existing | Object manager |

#### List › Settings

| Tab | Field | Default | Where | Who |
|---|---|---|---|---|
| General | Name, Description, Colour, Icon | | `Board.name/description/color/icon` | Object manager |
| General | List info (kind, item count, created, owner) | | read-only | everyone |
| Sharing | Visibility: Inherit from Space / Private / Org-wide | Inherit | `Board.visibility` | Object manager |
| Sharing | Members (Owner / Can manage / Can edit / View only), Add people (full directory) | | `BoardMember` rows. Sharing a List alone works end to end because the page gate and the data gate become one resolver (5.4). | Object manager |
| Statuses | The existing `board-status-editor` (groups Active / Done / Closed, colours from the muted set, reorder, rename, explicit Save) | canonical trio or Space default | `Board.statuses` | Object manager |
| Fields | The existing `field-shelf` (toggle field visibility, add custom fields, reorder) | | `Board.schema` | Object manager |
| Defaults | Default task type for this List (select from the org library; "Manage types" link → Work › Manage › Task types) | Space default or org default | `Board.settings.defaultItemTypeId` (new; read by create-task modal and quick-add) | Object manager |
| Defaults | Default assignee: none / creator | none | `Board.settings.defaultAssignee` (new; read by item create) | Object manager |
| Defaults | Default view when opening | List | `Board.settings.defaultViewId` (read by `/boards/[slug]` redirect) | Object manager |
| Danger | Archive, Move, Duplicate, Delete | | existing | Object manager |

"Email to List" and "Imports" remain "•••" rows hidden behind "Show upcoming features" until their backends exist.

#### Doc › Settings, Table › Settings, Channel › Settings

Docs keep the existing share modal (permission levels) as the Sharing tab plus an Info tab (owner, created, word count, location). Tables get Sharing (inherits the container) plus Info and a Danger tab (archive, delete). Talk channels keep their existing settings sheet; the "•••" label becomes "Settings" for consistency. No new fields are introduced for these three; the point is the same door in the same place.

### 2.2 Hub Manage pages (D2)

Route `/{hub}/manage` in the normal shell. Page header uses the Zoho stack (6.1): title "Manage {hub}", text tabs per section, one toolbar row, one blue primary. Each tab is a section listed below. Gate column: "hidden" means the tab is not rendered for that viewer; "read-only" means rendered disabled with the banner from 2.1.

#### Work › Manage (`/work/manage`)

| Tab | Content and fields | Default | Where | Who |
|---|---|---|---|---|
| Task types | Active types grid (built-in + custom, up to 20 custom), set org default (star), edit (name, plural, icon, description), delete custom with usage count; Recommended library with search and Add. Create modal uses `ui/dialog`. | built-ins + default "Task" | `ItemType` rows; org default in `ItemType.isDefault` | Admin edit; everyone read-only (they pick types daily). **`/api/item-types` POST/PATCH/DELETE gain `isOrgAdmin`** (settings-pages #2). |
| Tags | Renders the already-correct `tags-manager.tsx` (types, create, rename, colour, archive, delete, usage counts) restyled to the OS tokens. The `SAMPLE` fabricated data and the local-only create/delete of `settings/tags/page.tsx` are deleted. | none | `Tag` rows (`type` CUSTOM for task labels; dimensional types admin-only) | Everyone can create CUSTOM tags (as today, from the tag picker too); rename, archive, delete, dimensional types: Admin. |
| Templates | The Template Center's manage view (org templates: rename, delete, set audience) | seeds | `Template` rows | Manager edit; everyone read-only |
| Saved filters | The user's saved task filters (name, rules, which List or Everything), rename, delete, share to Space (later) | none | new `SavedFilter` model `{id, userId, organizationId, boardId?, name, rules Json, createdAt}` replacing the localStorage `workwrk:task-saved-filters` key | Self |
| Trash | The existing `/trash` page embedded as a tab (Spaces, Folders, Lists, tasks, docs; restore, purge) | | existing trash API | Manager (`/trash` gate aligned: page and API both `isManager`) |

Deep links: `/settings/task-types` → `/work/manage?tab=types`; `/settings/tags` → `/work/manage?tab=tags`; `/trash` stays as an alias that renders the Trash tab.

#### Planner › Manage (`/planner/manage`)

| Tab | Content | Default | Where | Who |
|---|---|---|---|---|
| Calendar connections | Google Calendar: Connect / Connected as {email} / Disconnect, last sync, sync direction (read-only for now); ICS feed URL for "My tasks" with token rotate; Outlook, iCloud, Fastmail listed only under "Show upcoming features" | not connected | existing Google OAuth routes and 5-minute cron (time.md §6); `CalendarConnection` rows; ICS token on the user | Self |
| Time and week | Personal: week starts on (Sunday / Monday), time format (12h / 24h), working hours (start, end, days). These are the per-user fields the Planner, Timesheets and calendar bucketing read so all surfaces agree on week start. | Monday, 24h, 09:00 to 18:00 Mon to Fri | `User.weekStart`, `User.timeFormat`, `User.workingHours Json` (new columns; see 5.2). Org default lives in Admin › Identity › Region. | Self (org default: Admin) |

Deep link: `/settings/calendar` → `/planner/manage?tab=calendar`; the Google OAuth success redirect lands here and `?connected=1` shows a toast.

#### Talk › Manage (`/tlk/manage`)

| Tab | Content | Default | Where | Who |
|---|---|---|---|---|
| Module | Talk on/off switch with the billing line ("included in {plan}" or "adds N seats"), competes-with caption, and a warning listing what becomes unreachable when off (channels, huddles, call history) | off for new orgs | `ProductInstallation` via `POST/DELETE /api/products/installations` | Admin (hidden for others; when the module is off this tab is the `ModuleDisabledScreen`, D7) |
| Announcements | Who can post announcements (HR admins / Managers / Everyone), default channel for announcements | HR admins | `Organization.settings.talk.announcementsPosters`, read by `/api/announcements` POST (replaces the unenforced matrix cell `announcements.create`) | HR admin |

#### Docs › Manage (`/docs/manage`)

| Tab | Content | Default | Where | Who |
|---|---|---|---|---|
| SOP folders and access | The existing `folder-manager.tsx` (folders, per-folder access Viewer / Editor / Owner) restyled; folder OWNER can manage that folder's access (API fixed, access-model #21) | | `SOPFolder`, `SOPFolderAccess` | Admin and folder Owner |
| SOP categories | The orphan `sop-category-manager.tsx` rendered (create, rename, colour, archive) | seeds | `SOPCategory` | HR admin |
| Publishing | Who can publish SOPs (HR admins / Managers), acknowledgement required by default (on/off), acknowledgement window (days) | HR admins, on, 7 | `Organization.settings.sops` read by the SOP publish route (replaces matrix cells `sops.publish`, kept enforced) | HR admin |

`/sops/manage` becomes an alias of `?tab=folders`.

#### Teams › Manage (`/team/manage`)

| Tab | Content | Default | Where | Who |
|---|---|---|---|---|
| Departments | Existing `/people/departments` page as a tab (create, rename, head, parent) | | `Department` | Manager |
| Job titles | Existing `/people/roles` (renamed Job titles; level pill removed from the card; `Role.level` no longer offered as COMPANY_ADMIN or SUPER_ADMIN) | | `Role` | Manager |
| Offices | New small CRUD on the existing `Office` model and API (name, address, timezone, members count) replacing the "Coming soon" tile | none | `Office`, `User.officeId` | HR admin |
| Reporting lines | The org chart (`/organization`) with inline "Reports to" editing for admins and managers (search picker, cycle check, dotted lines shown), "Not linked" sweep | | `User.managerId`, `UserDottedLine` | Admin edits anyone; Manager edits within their tree; everyone at manager tier reads their tree |
| Reviews and scoring | The four sections of today's `/settings/scoring` (cadences, weights summing to 100, bands with add and remove and a colour from the semantic set, behavioural anchors) plus a link to Talent 9-box (`/talent`) and Review cycles (`/reviews`) | API defaults | `Organization.settings` scoring keys via `PATCH /api/settings {section:"scoring"}` | HR admin edit (matches who runs reviews); Manager read-only; hidden for employees |
| Workload capacity | Per-person weekly hours and working days used by Workload and Team views | 40h | new `User.weeklyCapacityHours` (replaces localStorage `workwrk:team-workload:v1`) | Manager for their reports; HR admin for anyone; Self read |
| Tools | Existing `/tools` page (SaaS and subscriptions register) | | existing | HR admin (page gate raised from manager to hr-admin to match the catalog) |
| Assets | Existing `/assets` page | | existing | HR admin (same alignment) |

Deep links: `/settings/scoring` → `/team/manage?tab=reviews`; `/settings/hierarchy` and `/organization` → `/team/manage?tab=reporting` (the org chart keeps `/organization` as an alias); `/people/departments`, `/people/roles`, `/tools`, `/assets` keep their URLs and render inside the tab.

#### Tables › Manage (`/tables/manage`)

| Tab | Content | Default | Where | Who |
|---|---|---|---|---|
| Module | Tables on/off (same pattern as Talk) | off for new orgs | `ProductInstallation` | Admin |
| Forms | Existing Forms list (public link expiry default, branding defaults for new forms) | | `Form` rows; defaults in `Organization.settings.forms` | Manager |

#### AI › Manage (`/ai/manage`)

| Tab | Content | Default | Where | Who |
|---|---|---|---|---|
| AI keys | The orphan `byok-manager.tsx` (bring your own key; shown only when the enterprise `byok` flag is on, otherwise a one-line "Included with your plan") | platform key | `OrgSecret` | Admin |
| Automations | Workspace kill switch (pause all automations), run quota display, link to health, usage and logs pages (giving those three orphan pages a sidebar home) | on | `Organization.settings.automation.paused`, read by the automation runner | Admin |
| Connections | Existing `/integrations` marketplace page as a tab (honest "demand-driven" copy) | | existing | Manager |
| Build, Store | Existing `/build` and `/store` pages as tabs | | existing | Manager |

Deep links: `/integrations`, `/build`, `/store`, `/settings/integrations` → the matching tab.

### 2.3 Inbox › Notification preferences (D3, `/inbox/preferences`)

| Section | Field | Default | Where | Who |
|---|---|---|---|---|
| In-app | Task assigned, @mentions, comments on my tasks, status changes, due-date reminders, kudos (6 switches, all live today) | all on | `UserPreference.home.notifications.inbox` (existing, enforced by `notify-prefs.ts`) | Self |
| In-app | Mute all in-app notifications until (off / 1h / today / custom) | off | `UserPreference.home.notifications.muteUntil` (new; replaces localStorage `workwrk:os:muted-notifs`; read by the bell and the inbox poller) | Self |
| In-app | Desktop notifications on this device (browser permission; labelled "this device only") | off | browser `Notification` permission plus the existing `desktop-notifications-pref` key. This is the one deliberately device-scoped toggle and says so. | Self |
| Inbox behaviour | Group by date, show cleared, auto-clear read after N days, default tab | grouped, hidden, 7, Primary | `UserPreference.home.notifications.inboxView` (**the zod schema in `/api/preferences` gains this key; today the Inbox sends a top-level `inbox` object that the schema strips**, critic #7) | Self |
| Email | Master switch; Task assigned; Kudos; KRA assigned; Review due; SOP update; Mentions, Comments, Status, Due and Daily digest appear only under "Show upcoming features" until their senders exist | on | `UserPreference.home.notifications.email` plus write-through to `EmailPreference` for the five legacy keys (kept for the senders that read it; retire once senders read the preference JSON) | Self |
| Per-object mutes | List of muted Spaces, Lists and Docs with unmute; muting happens from the object's "•••" › Mute | none | `UserPreference.home.notifications.muted[]` `{kind,id}` (new; read by `notify-prefs.ts`) | Self |
| Organisation defaults (admins only, bottom) | Default in-app and email switches for new members, digest cadence (daily / weekly / off), reminder frequency | on, daily | `Organization.settings.notifications` via `PATCH /api/settings {section:"notifications"}` (the section exists with no writer today; new members are seeded from it) | Admin |

### 2.4 Customize Sidebar panel (D4)

Kept as the founder asked. Tabs:

| Tab | Field | Default | Where | Who |
|---|---|---|---|---|
| Appearance | Theme: Light / Dark / System | System | `UserPreference.theme.appearance` | Self (greyed with a lock caption when the org locked `theme.appearance`) |
| Appearance | Accent (from one shared `ACCENTS` list in `src/lib/accents.ts`: workwrk blue, black, teal, orange, bronze, mint; purple, violet, pink, indigo, grape deleted; if the founder takes Q4's one-blue default the picker hides itself when the list has one entry) | workwrk | `UserPreference.theme.accent` | Self (lockable) |
| Appearance | Density: Compact / Cozy | Cozy | `UserPreference.density` (the stray localStorage `workwrk:density` key is deleted) | Self (lockable) |
| Sidebar | Rail labels: Labels / Icons only (Phase 2 brief drops icons-only; keep until that decision lands) | Labels | `UserPreference.sidebar.iconsOnly` | Self (lockable) |
| Sidebar | Sidebar width (the drag handle writes here too) | 244 | `UserPreference.sidebar.width` (new key; replaces localStorage `workwrk:os:sidebar-width`, kept as a cache only) | Self |
| Sidebar | Section order (Favorites, Spaces, ...) | default | `UserPreference.sidebar.sectionsOrder` | Self |
| Sidebar | Home cards shown | all | `UserPreference.home.cards` (**the Home page must read this key**; today nothing consumes it, critic #7. If Home lands on My work per Q7, the cards become the My work cards and this control moves there; either way it gets a reader or is deleted.) | Self (lockable) |
| Sidebar | Quick tools in the profile menu | default set | `UserPreference.sidebar.toolPins` (new; replaces localStorage `workwrk:os:profile-tool-pins:v2`) | Self |
| Rail for everyone (admin) | The current `/settings/apps` page as a tab: order (drag, up, down), show or hide, access floor (Everyone / Managers and up / HR and org admins / Org admins only), grouped by category, search, "Reset to default". Off-rail apps are listed under their hub with the caption "shown in the {hub} sidebar". | catalog order | `OrgPreference.sidebarDefault.apps` via `PATCH /api/org/preferences` | Admin |
| Defaults and locks (admin) | Org default theme, accent (same list), density; lock switches for theme, density, sidebar layout, home cards; "Apply to everyone now" (resets user overrides for locked keys) | Light, workwrk, Cozy, no locks | `OrgPreference.themeDefault/densityDefault/lockedKeys` | Admin |

The floor set in "Rail for everyone" becomes a real gate: a shared `requireAppAccess(appKey)` reads the catalog `requiredAccess` and the org `minAccess` floor and is called by every gated route layout, so hiding an app is the permission (access-model §7 point 8).

### 2.5 My account takeover (D5, `/account/*`)

Sidebar rows: Profile, Preferences, Security, Notifications (link to D3). Footer: All settings.

#### `/account/profile`

| Field | Default | Where | Who |
|---|---|---|---|
| Photo (upload, remove) | initials | `User.avatar` via `/api/users/[id]/avatar` | Self |
| First name, Last name | | `User.firstName/lastName` via `PATCH /api/users/[id]` | Self |
| Phone | empty | `User.phone` (API already accepts it) | Self |
| Date of birth (optional, visibility: managers only) | empty | `User.dateOfBirth` | Self |
| Email (read-only, "Change" opens a verify-new-address flow) | | `User.email` via new `POST /api/me/change-email` (sends verify link; swaps on confirm) | Self |
| Access level, Job title, Department, Office, Reports to (read-only chips with "Managed by your admin"; link to `/people/me` for the career profile) | | read-only | |
| Danger: Leave organisation / Delete my account (typed confirmation; blocked for the last admin) | | existing `/api/me/delete` gets its first UI | Self |

#### `/account/preferences`

| Field | Default | Where | Who |
|---|---|---|---|
| Language (the 11 wired `next-intl` catalogs; RTL for ar and he) | org default | `User.language` (new column; root layout reads it; the org "Default language" becomes a real default for new members) | Self |
| Timezone (IANA searchable list, "Use device timezone" toggle) | org default | `User.timezone` (new; read by reminders cron, due-date bucketing, calendar) | Self |
| Date format, Number format | org default | `User.dateFormat`, `User.numberFormat` (new) | Self |
| Week starts on, Time format, Working hours | org default | same columns as Planner › Manage › Time and week (that tab and this page render the same form component; one home rule is satisfied because Planner's tab is the only place the *working hours* editor renders, and this page links to it for those three fields) | Self |
| Appearance shortcut: "Theme, accent and density live in Customize Sidebar" with an Open button | | | |
| Show upcoming features (reveals "Coming soon" rows across the product) | off | `UserPreference.home.showUpcoming` (new) | Self |
| Keyboard shortcuts (opens the overlay) | | | |

#### `/account/security`

Existing page kept: email verified, two-factor (enrol, disable, backup codes), change password, sign out of all devices, recent security activity. Changes: the "Org policy" card is read-only for everyone and shows a "Change policy" link for admins to `/settings/security`; the raw enum label is replaced with the tier label from the single `tiers.ts`; the security score heuristic is removed (no consumer, no meaning); load error renders a proper `OsEmptyView` with Retry; a Sessions list (device, last seen, revoke) replaces the bare nuke button once `Session` rows exist (until then the button stays).

### 2.6 Admin takeover (D6, `/settings/*`)

Sidebar rows in order: **Identity, Members, Security, Billing, Audit, Data.** Footer: My account, All settings. `/settings` (bare) redirects to `/settings/identity`. One server gate in `settings/layout.tsx` (`requireOrgAdminOrRedirect("/account")`) replaces the seven per-route layouts and the inline lock card. C_LEVEL is removed from the `/api/settings` PATCH allow-list so the API and the door agree (access-model #15); C-level keeps read.

#### `/settings/identity` (tabs: Organisation, Region, Brand)

| Tab | Field | Default | Where | Who |
|---|---|---|---|---|
| Organisation | Logo (upload, remove) | none | `Organization.logo` | Admin |
| Organisation | Name | | `Organization.name` | Admin |
| Organisation | Primary domain (validated hostname; "People signing up with this domain can request to join": on/off) | none, off | `Organization.domain`, `settings.domainJoin` (new; read by signup) | Admin |
| Organisation | Industry, Team size, Business type (the two fields the Overview read but nothing wrote) | | `settings.industry/teamSize/businessType` | Admin |
| Organisation | Mission, Vision, About (textareas, 4 rows), Core values (chips) | | `settings.companyProfile` (feeds the splash loader and AI KRA generation) | Admin |
| Region | Timezone (IANA searchable), Currency (full ISO list), Fiscal year starts (month, stored as a number 1 to 12, the Overview "Month 04-01" bug goes away), Week starts on, Date format, Default language for new members | Asia/Kolkata, INR, 4, Monday, DD MMM YYYY, en | `settings.timezone/currency/fiscalYearStart/weekStart/dateFormat/language` via `{section:"region"}` (the `general` section is split into `identity` and `region` with zod) | Admin |
| Brand | The orphan `branding-manager.tsx` (login page logo, email header, custom domain) shown only when the enterprise `whiteLabel` flag is on; otherwise one line "Available on Enterprise" | | `settings.branding` | Admin |

#### `/settings/members` (tabs: People, Invitations, Access levels)

| Tab | Content | Where | Who |
|---|---|---|---|
| People | Bordered table: person (link to `/people/[id]`), email, job title, department, access level (select: the eight levels from `access-levels.ts` plus COMPANY_ADMIN; SUPER_ADMIN never offered; promotion to COMPANY_ADMIN and self-demotion get a confirm; last-admin guard for both admin tiers), reports to (searchable picker with cycle check), status, last active; filters by level and department; search; cursor pagination; row "•••": deactivate, reactivate, remove from organisation (typed confirm; hands over owned Spaces). Data source is `/api/users?scope=all` which, for an admin, is genuinely org-wide; the silent team-scope coercion never applies here because the page is admin-only. | `User` via `PATCH /api/users/[id]` (accessLevel whitelist added), `DELETE /api/users/[id]` | Admin |
| Invitations | Pending and expired invites (email, level, invited by, sent, resend, revoke), Invite button (opens `InviteModal`; `?invite=1` opens it on load), "Who can invite" (Admins / Managers / Everyone) | `Invitation`; `settings.invites.who` read by `/api/invitations` POST (replaces the matrix cell `people.create`, which stays enforced through this setting) | Admin |
| Access levels | One ordered list of the ten tiers from a single `src/lib/tiers.ts` (label, short label, description, head-count, what doors it opens), followed by the enforced capability grid: only rows with a server call site remain (people: invite, deactivate; kras: create, edit, delete, assign; sops: create, edit, publish, delete; announcements: post; assets: create, edit, delete). Every cell shows an "Enforced" tick. Save calls `invalidatePermissionCache()` and writes an audit row. "Reset to defaults" per module. Diff-from-default highlighted. | `Organization.settings.permissions` via `PATCH /api/permissions` | Admin (matrix); everyone can read the tier list (it is the explainer employees need) |

The unenforced 55 cells and the six out-of-scope modules (meetings, surveys, ideas, analytics, tools, policies rows that gate nothing) are removed from the grid and from `PERMISSION_MODULES`; their governing rules move to the contextual settings named above (announcement posters, SOP publishers, who can invite) which are read by the routes that used to consult the matrix.

#### `/settings/security` (tabs: Policy, Sign-in, API keys)

| Tab | Field | Default | Where | Who |
|---|---|---|---|---|
| Policy | Minimum password length (8 to 64), require uppercase, require number, require symbol, password expiry (off / 90 / 180 days), idle session timeout (minutes; default matches the live 12h), require MFA for everyone (on/off; when on, members without MFA are forced to enrol at next sign-in), allowed email domains for sign-in | 8, on, on, off, off, 720, off | `settings.security` via `{section:"security"}` (the section exists with no writer today; **the password-change and login routes read it**: `lib/password-policy` already exists per the auth memory and is pointed at these values) | Admin |
| Sign-in | SSO (SAML) provider: Add (metadata URL or XML, entity ID, ACS URL shown), test, enforce SSO for everyone; SCIM provisioning: enable, generate token (shown once), base URL shown, revoke | none | `IdentityProvider`, `ScimToken` via existing `/api/scim-tokens` and a new `/api/identity-providers` | Admin (visible on Enterprise plan; otherwise a one-line "Available on Enterprise") |
| API keys | Existing API keys page (list, generate with scope, reveal once, revoke, rate limit per minute and day editable, hide revoked toggle) | | `ApiKey` via `/api/keys` | Admin |
| API keys | Webhooks (subscriptions, deliveries) shown only under "Show upcoming features" until the UI exists | | `WebhookSubscription` | Admin |

#### `/settings/billing` (tabs: Plan, Modules, Usage)

| Tab | Content | Where | Who |
|---|---|---|---|
| Plan | Current plan, status, renewal, "Manage billing" (Stripe portal) or, when Stripe is not configured, a "Contact us to change plan" mailto; plan comparison table with per-tier CTAs | `Organization.plan`, Stripe | Admin |
| Modules | Read-only summary of Talk and Tables (on/off, seats, cost line) with "Manage on the {hub}" links to D7. No switch here (one home rule; the switch lives on the hub). | `ProductInstallation` | Admin |
| Usage | Seats used of limit, storage, AI queries this billing period (period-scoped, not all-time), API calls | counts | Admin |

#### `/settings/audit`

Existing page with: server-side search (`?q=`), an "Access" type group (tier changes, matrix saves, membership and visibility changes, denied access), clickable rows opening a detail drawer with old and new values, type chips from a `/api/audit/types` endpoint (not the first page), export honouring every active filter, and audit rows written by `/api/permissions` PATCH, `/api/users/[id]` accessLevel changes, Space, Folder and Board member and visibility changes, and `requireAccess` denials. Page gate and API gate both Admin.

#### `/settings/data` (tabs: Import, Export, Retention, Privacy, Danger zone)

| Tab | Content | Where | Who |
|---|---|---|---|
| Import | The existing `/imports` hub (CSV for tasks, people; competitor importers under "Show upcoming features"), import history with status; the People CSV path gets its real importer UI calling `/api/people/bulk-import` (which has no caller today) | existing | Admin |
| Export | Full workspace ZIP, People CSV, Timesheets CSV, Audit CSV. Purchase orders and Invoices exports removed (Finance is out of scope). Export history (who, what, when) written to the audit log. | existing routes | Admin |
| Retention | Trash retention (days before purge; default 60, the number the delete confirms already promise), audit log retention, closed-task archive after N days (off) | `settings.retention` (new section; read by the trash purge cron and the audit export) | Admin |
| Privacy | The orphan `privacy-controls.tsx` (data residency display, DSR export for a person, consent records) | existing models | Admin |
| Danger zone | Delete organisation (typed name confirmation, 14-day restore window via the existing `/api/organizations/delete` and `/restore`) | existing | Admin (COMPANY_ADMIN only) |

---

## 3. Disposition table

Every route, page, component and setting the audit found, with its fate. "Redirect" means the old URL 301s to the new home so bookmarks, emails and tour links keep working.

### 3.1 Routes and pages

| Existing | Disposition | New home | Reason |
|---|---|---|---|
| `/settings` (Overview card grid) | **Remove** page; `/settings` redirects to `/settings/identity` (admins) or `/account` (others) | D6, D5 | Duplicates values, self-links, incomplete coverage; the All settings index (D9) replaces its discovery job |
| `/settings/identity` | **Keep** as Admin › Identity › Organisation; C_LEVEL gate resolved to Admin only | D6 | True org-level |
| `/settings/locale` | **Merge** into Admin › Identity › Region; redirect | D6 | Same entity; IANA list, full currency list, numeric fiscal month; "Default language" becomes a real default for new members |
| `/settings/modules` | **Move** switches to the module's hub (Talk › Manage › Module, Tables › Manage › Module, and the `ModuleDisabledScreen`); read-only summary in Billing › Modules; redirect to `/settings/billing?tab=modules` | D7, D2 | Module toggles belong on the hub they gate |
| `/settings/apps` | **Move** to Customize Sidebar › Rail for everyone (admin tab); redirect opens the panel (`?customize=rail`) | D4 | Rail config belongs where the rail is customised; floors become enforced |
| `/settings/tags` | **Replace** with `tags-manager.tsx` under Work › Manage › Tags; delete the SAMPLE data page; redirect | D2 | Fabricated data, local-only create and delete; the correct component was orphaned |
| `/settings/tags/tags-manager.tsx` (orphan) | **Wire** (see above) | D2 | It is the working implementation |
| `/settings/task-types` | **Move** to Work › Manage › Task types; add admin gate on page and API; `ui/dialog` for create; redirect | D2 | Work-hub content model; access hole closed |
| `/settings/members` | **Keep** as Admin › Members › People; fixes listed in 2.6 | D6 | True org-level |
| `/settings/structure` | **Dissolve**: Functions → Teams › Manage › Departments; Roles → Teams › Manage › Job titles; Access levels explainer → Admin › Members › Access levels; Offices → Teams › Manage › Offices (built); redirect to `/settings/members?tab=levels` | D2, D6 | A hub-of-links page with one stub and one broken link |
| `/settings/hierarchy` | **Merge** into Teams › Manage › Reporting lines (the org chart gains inline editing); redirect | D2 | Duplicate of `/organization` with less information and no cycle handling |
| `/organization` | **Keep** URL as alias of Teams › Manage › Reporting lines | D2 | Re-parent, never remove |
| `/settings/permissions` | **Rebuild** as Admin › Members › Access levels with enforced cells only; redirect | D6 | 55 of 75 cells enforce nothing; module list is pre-PPMS |
| `/settings/audit` | **Keep** as Admin › Audit with the fixes in 2.6 | D6 | True org-level |
| `/settings/data` | **Keep** as Admin › Data, absorbing Import / Export, Retention, Privacy, Danger zone | D6 | True org-level |
| `/settings/defaults` | **Move** to Customize Sidebar › Defaults and locks (admin tab); accent vocabulary unified; redirect opens the panel | D4 | Locks belong beside the controls they lock |
| `/settings/api` | **Move** to Admin › Security › API keys; server gate via the single layout; redirect | D6 | Keys are an org security concern |
| `/settings/calendar` | **Move** to Planner › Manage › Calendar connections, showing the real Google OAuth state (time.md contradicts the page's "no backend" copy); Outlook, iCloud, Fastmail behind "Show upcoming features"; redirect | D2 | Calendar sync belongs to Planner |
| `/settings/integrations` | **Remove**; redirect to `/ai/manage?tab=connections` | D2 | A menu page for stubs |
| `/settings/import-export` | **Merge** into Admin › Data (Import and Export tabs); redirect | D6 | Duplicate of Data & compliance |
| `/settings/billing` | **Keep** as Admin › Billing; one toast system; plan comparison; period-scoped usage | D6 | True org-level |
| `/settings/scoring` | **Move** to Teams › Manage › Reviews and scoring; HR admin edit, manager read-only, brand-blue Save, bands add and remove, colour from the semantic set; redirect | D2 | Review configuration belongs with the people who run reviews |
| `/settings/notifications` | **Move** to `/inbox/preferences`; redirect | D3 | Notification prefs belong in the Inbox |
| `/account/profile` | **Keep** with phone, DOB, email change, danger zone | D5 | Personal |
| `/account/appearance` | **Merge** into Customize Sidebar › Appearance; `/account/preferences` links to it; redirect opens the panel | D4 | One appearance surface; the page duplicated the panel with a different accent list |
| `/account/security` | **Keep** with the fixes in 2.5 | D5 | Personal |
| `/account/notifications` | **Redirect** to `/inbox/preferences` | D3 | |
| `/account` (bare, 404 today) | **Add** redirect to `/account/profile` | D5 | Broken link target |
| `/people/me` | **Keep**; Teams sidebar highlight fixed by matching `/people/{sessionUserId}` | | |
| `/me/weekly-review` | **Keep**; gets `BackButton fallbackHref="/today"` and Work hub highlight | | Out of settings scope, listed for completeness |
| `/me/mentions` | **Redirect** to `/inbox?tab=mentions` | | Orphan duplicate of Inbox › Mentions |
| Settings hub sidebar (`SettingsSidebar` in `apps-catalog.tsx`: Workspace settings, Marketplace, Trash, Tools, Assets, Build, Store) | **Retire** the sidebar; Trash → Work › Manage › Trash; Tools, Assets → Teams › Manage; Marketplace (`/integrations`), Build, Store → AI › Manage | D2 | The Settings hub is the Admin takeover; its old sidebar only ever rendered on five stray routes |
| `/tools`, `/assets` | **Keep** URLs; render as Teams › Manage tabs; page gate raised to hr-admin to match the catalog | D2 | |
| `/build`, `/store`, `/integrations` | **Keep** URLs; render as AI › Manage tabs | D2 | |
| `/trash` | **Keep** URL; renders Work › Manage › Trash; page gate added (`isManager`, matching the API) | D2 | |
| `/talent` (Talent 9-box) | **Keep**, untouched, reachable from Teams sidebar › Performance and linked from Reviews and scoring | | Must remain reachable |
| `/sops/manage` | **Keep** URL as alias of Docs › Manage › SOP folders | D2 | |
| `/people/departments`, `/people/roles` | **Keep** URLs; render as Teams › Manage tabs | D2 | |
| `/planner` "Connect Google Calendar" banner | **Keep**; success redirect lands on Planner › Manage › Calendar connections | D2 | |
| Orphan `branding-manager.tsx` | **Wire** as Admin › Identity › Brand (Enterprise flag) | D6 | Real setting with no page |
| Orphan `byok-manager.tsx` | **Wire** as AI › Manage › AI keys (Enterprise flag) | D2 | |
| Orphan `privacy-controls.tsx` | **Wire** as Admin › Data › Privacy | D6 | |
| Orphan `sop-category-manager.tsx` | **Wire** as Docs › Manage › SOP categories | D2 | |
| `SettingsShell` (`settings-shell.tsx`) | **Rewrite**: doors replaced by the two small sidebars (Admin six rows, My account four rows), Back returns to origin (4.3), filter field at the top, responsive collapse below 900px | D5, D6 | |
| Seven per-route `layout.tsx` gates plus the inline lock card | **Replace** with one gate in `settings/layout.tsx` | D6 | 14 admin pages had no server gate |
| Profile menu "Themes", "Keyboard shortcuts", "Notifications" rows | **Re-point** (section 1) | | Dead query params, wrong target |
| Admin setup checklist and tour steps | **Re-point** (section 1) | | Stale targets |
| `route-guard.ts` redirect to `/dashboard`, `page-gates.ts` redirects to `/people/me` and `/team/reviews` | **Unify**: one `denied()` helper that redirects to the viewer's own home (`/account` for settings, `/people/me` for people pages) with a toast reason | | Four denial redirects |

### 3.2 Settings the audit found cosmetic, unenforced or localStorage-only

| Setting | Today | Disposition |
|---|---|---|
| Inbox preferences (group, show cleared, default tab) | Sent as top-level `inbox`, stripped by the zod schema | **Wire**: `home.notifications.inboxView` added to the schema; Inbox reads `effective.home.notifications.inboxView` |
| `CustomizePanel` Home cards (`home.cards`) | Written, never read | **Wire** to the Home / My work card renderer, or delete the control if Q7 removes cards; never keep it unread |
| Space "Default permission" (`settings.defaultPermission`) | Stored, read by nothing | **Wire** as Space › Sharing › "New members join as" (`settings.defaultRole`), read by `addSpaceMember` and Space invites; the old key is migrated |
| Wizard-selected views, private and pinned views | Cosmetic | **Wire**: wizard views create `View` rows; private view = `View.ownerId` with visibility flag read by the view tab list; pinned = `UserPreference.home.pinnedViewIds` read by the tab strip. Or hide behind "Show upcoming features" until wired; never a live-looking toggle |
| Behavioural anchors | Saved, not read by scoring | **Wire** into the review form labels (they are the 1 to 5 scale captions) |
| Escalation thresholds (`role-workspace.tsx`) | Saved, not read | **Wire** to the KPI review loop reminder cron or hide behind "Show upcoming features" |
| Permission matrix, 55 unenforced cells | Saved, ignored | **Remove** from the grid; their intent moves to the contextual rules in 2.2 and 2.6 which routes actually read |
| Rail hide and floor | Display only | **Enforce** via `requireAppAccess(appKey)` in every gated layout |
| Org security policy | No editor | **Editor** at Admin › Security › Policy; login and change-password read it |
| Org notification defaults | No editor | **Editor** at Inbox preferences › Organisation defaults; seeds new members |
| "Default language" (org) | Stored, unused | **Wire** as default for `User.language`; the root layout reads the user value |
| `businessType`, `teamSize` | Read, never written | **Editor** at Admin › Identity › Organisation |
| Presence (`workwrk:os:presence`) | localStorage | **Server**: `UserPreference.talk.presence` (status, until) so teammates see it |
| Mute notifications (`workwrk:os:muted-notifs`) | localStorage | **Server**: `home.notifications.muteUntil` |
| Quick-tool pins (`workwrk:os:profile-tool-pins:v2`) | localStorage | **Server**: `sidebar.toolPins` |
| Sidebar width (`workwrk:os:sidebar-width`) | localStorage | **Server**: `sidebar.width`; localStorage kept only as a first-paint cache |
| Density (`workwrk:density`) | localStorage duplicate | **Delete** the key; server `UserPreference.density` is the truth |
| Workload capacity (`workwrk:team-workload:v1`) | localStorage | **Server**: `User.weeklyCapacityHours` edited at Teams › Manage › Workload capacity |
| Saved task filters (`workwrk:task-saved-filters`) | localStorage | **Server**: `SavedFilter` model, managed at Work › Manage › Saved filters |
| `TaskListSurface` views and options, pivot results | in memory | Views → `View` rows; pivot config → `Table.settings.pivots[]` (Tables plan already lists pivots) |
| Desktop notification permission (`desktop-notifications-pref`) | localStorage | **Keep** in the browser, labelled "this device only" (it is a browser permission) |
| Sidebar collapsed, active app, recent apps, icon recents, doc tabs, docs pages-open, split ratio, sheet zoom, dismissed banners and checklists, tour completed, mission rotate index | localStorage | **Keep** as device state under 5.1 rule 1; none is presented as a setting. `ACTIVE_APP_KEY` stops driving the rail highlight (URL does), per critic #1, but that is outside this spec |
| Dirty-state guards (form builder, automation builder, permissions, scoring, identity) | none | **Add** `useDirtyGuard` (4.5) to every explicit-Save form |
| Two accent vocabularies | personal 10 keys incl. purple family; org 7 keys | **One** `ACCENTS` list without the purple family |
| Two toast systems, hand-rolled task-type modal | | `useOsToast` and `ui/dialog` everywhere in settings |
| `OsTitleBar` dead trio and amber star on settings pages | | Settings pages use the Zoho header stack (6.1), not `OsTitleBar` |

---

## 4. Navigation

### 4.1 Structure

- **In-context panels (D1)** are drawers on the object's route. Tabs inside the drawer are text tabs. The drawer never navigates; links inside it that lead elsewhere (Manage types, Change policy) open in the same tab and remember the object so Back returns to the drawer (4.3).
- **Hub Manage pages (D2)** are normal-shell pages. The hub sidebar shows the Manage row highlighted; the page's text tabs are the sections. The top-bar breadcrumb reads `{Hub} › Manage › {Tab}`.
- **Takeovers (D5, D6)** keep the full-screen settings mode the Phase 2 brief fixes, but the left list is six rows (Admin) or four rows (My account), a filter field above the rows, and a footer with All settings and (for admins) My account. A viewer in Admin can jump to My account and back without leaving settings mode.
- **Search**: the takeover filter field and the `⌘K` palette both query `SETTINGS_INDEX`, a registry each settings surface registers into: `{ id, label, keywords[], door, path | opener, gate }`. The palette shows "Settings › Admin › Security › Policy" style results. The `/settings/all` and `/account/all` pages render the same registry as a grouped list.

### 4.2 Deep links

Every settings home has a URL:

- Object panel: `{objectUrl}?panel=settings&tab={general|sharing|statuses|fields|defaults|danger}`.
- Hub Manage: `/{hub}/manage?tab={key}`.
- Customize panel: `{anyUrl}?customize={appearance|sidebar|rail|defaults}`.
- Inbox preferences: `/inbox/preferences#section`.
- Takeovers: `/settings/{page}?tab={key}` and `/account/{page}`.

Every old URL from 3.1 redirects with the tab preserved (`/settings/task-types` → `/work/manage?tab=types`). Redirects live in `next.config.ts` where possible and in a `settings-redirects.ts` map for the query-param cases.

### 4.3 Back and Close rule (must return to origin)

- Any code path that enters settings mode calls `openSettings(href)` from `src/lib/settings-nav.ts`. It stores `{ returnTo: location.pathname + location.search, at: Date.now() }` in `sessionStorage` under `workwrk:settings:return` and then navigates.
- In settings mode, Back, the X and Esc all call `closeSettings()`: if `returnTo` exists and is not itself a settings route, `router.push(returnTo)`; otherwise fall back to the `BackButton{fallbackHref:"/today"}` behaviour (history back when there is history, else the fallback). Deep links from email have no origin and land on the fallback.
- Sidebar rows inside the takeover do not touch `returnTo`, so a user who came from a List's "Default task type" row, visited three admin pages, and presses Back lands on that List.
- Drawers (D1) close with Esc, X, or browser Back (the `?panel` query is pushed as a history entry). Closing returns focus to the "•••" trigger.
- Hub Manage pages are ordinary routes: the top-bar back arrow and the breadcrumb handle them; the Manage row stays highlighted.
- Rule for engineers: never `router.push("/today")` from settings chrome again; every exit goes through `closeSettings()`.

### 4.4 Dirty-state guard

- Autosave surfaces (toggles, selects, colour pickers, the members list) are never dirty; they show an inline "Saved" tick for 1.5s and a red "Not saved, retry" chip on failure that re-sends on click.
- Text-heavy forms (Identity, Region, Security policy, Access levels grid, Statuses editor, Reviews and scoring sections, Profile) use a sticky save bar that appears only when dirty ("Unsaved changes · Save · Discard").
- Every such form calls `useDirtyGuard(isDirty)`. The hook intercepts: `closeSettings()`, takeover sidebar rows, hub sidebar links, rail clicks, drawer close, tab switches inside a Manage page or panel, and `beforeunload`. It shows a 400px modal "Discard changes?" with Keep editing / Discard / Save. There is no silent loss anywhere in settings.

### 4.5 Read-only mode

Every settings surface has a read-only rendering; nothing 403s on click. The gate value comes with the data (`canEdit` from the resolver on objects, tier check on hub tabs and admin pages), the controls render disabled, and a single banner at the top explains who can change it. Share pickers list the whole directory (name, avatar, department) regardless of the caller's tier (access-model §7 point 5); the `/api/users?scope=all` coercion is replaced by a dedicated `/api/directory` endpoint that returns minimal fields to everyone.

---

## 5. Persistence rule

**Rule: nothing visible is cosmetic.** Every control on a settings surface has (a) a server store, (b) at least one consumer that reads it, and (c) an audit row when the scope is org or object management. A control failing any of the three is deleted or hidden behind "Show upcoming features". Device state is the one exception and is never rendered as a setting.

### 5.1 Classes of setting and where each lives

| Class | Examples | Store | Write API | Read by |
|---|---|---|---|---|
| 1. Device state (not a setting) | sidebar collapsed, active app, recents, zoom, split ratio, dismissed banners, tour done, doc tabs | localStorage only | none | the component that owns it |
| 2. Personal preference | theme, accent, density, sidebar width and sections, tool pins, notification switches, mute, muted objects, inbox view, show upcoming, talk presence, saved filters | `UserPreference` (JSON columns `sidebar`, `home`, `theme`, `density`, plus a new `talk` JSON column) and the new `SavedFilter` model | `PATCH /api/preferences` (zod extended with every key named in section 2; unknown keys rejected with a 400 that names them, never stripped silently) | `getEffectivePreferences` (merge: defaults → org defaults → user → locked keys re-stamped) |
| 3. Personal identity and locale | name, avatar, phone, DOB, email, language, timezone, date and number format, week start, time format, working hours, weekly capacity | typed columns on `User` (new: `language`, `timezone`, `dateFormat`, `numberFormat`, `weekStart`, `timeFormat`, `workingHours Json`, `weeklyCapacityHours`) | `PATCH /api/users/[id]` (self for identity and locale; manager or HR admin for capacity), `POST /api/me/change-email` | reminders cron, calendar and Planner bucketing, Workload, root layout locale, email templates |
| 4. Personal security | MFA, password, sessions | `User.mfa*`, `tokenVersion`, (later) `Session` | existing `/api/me/*` | auth |
| 5. Membership and scope | access level, reports to, dotted lines, department, job title, office, status | `User.accessLevel/managerId/departmentId/roleId/officeId/status`, `UserDottedLine` | `PATCH /api/users/[id]` (admin for level; manager in line for managerId) | every gate |
| 6. Object settings | Space, Folder, List name, icon, colour, visibility, members, statuses, fields, defaults, modules | typed columns plus a zod-typed `settings` JSON per model (`SpaceSettings { defaultRole, modules, hiddenViews, defaultStatuses, defaultItemTypeId, privateByDefault }`, `BoardSettings { defaultItemTypeId, defaultAssignee, defaultViewId }`), `SpaceMember`, `FolderMember`, `BoardMember` | `PATCH /api/spaces/[id]`, `/api/folders/[id]` (gains `visibility`), `/api/boards/[id]`; members via the existing `/members` sub-routes | the single resolver (5.4), create dialogs, tab strips |
| 7. Hub content model | task types, tags, templates, SOP folders and categories, departments, job titles, offices, calendar connections, forms defaults | their own models (`ItemType`, `Tag`, `Template`, `SOPFolder`, `SOPCategory`, `Department`, `Role`, `Office`, `CalendarConnection`, `Form`) | their existing routes with the role checks listed in 2.2 added | create modals, pickers, SOP publish |
| 8. Hub rules | announcement posters, SOP publishers and acknowledgement, automations paused, forms defaults, review cadences and scoring | `Organization.settings.{talk,sops,automation,forms}` and the scoring keys | `PATCH /api/settings { section, data }` with one zod schema per section; sections: `identity`, `region`, `security`, `notifications`, `scoring`, `retention`, `privacy`, `talk`, `sops`, `automation`, `forms`, `invites`, `companyProfile` | the routes that used to consult the matrix |
| 9. Org identity and policy | name, logo, domain, profile, region, security policy, notification defaults, retention, privacy, invite policy, branding | `Organization` columns and `settings` sections | same | login, signup, crons, exports, splash |
| 10. Org navigation and appearance defaults | rail order, hidden, floors; theme, accent, density defaults; locked keys | `OrgPreference` | `PATCH /api/org/preferences` | `visibleRailApps`, `requireAppAccess`, `getEffectivePreferences` |
| 11. Entitlements | modules on or off, plan, enterprise flags | `ProductInstallation`, `Organization.plan`, staff-set flags | `/api/products/installations` (admin), staff back-office | route layouts, rail, billing |
| 12. Access matrix (enforced subset) | the ~15 cells with call sites | `Organization.settings.permissions` | `PATCH /api/permissions` (audits, invalidates cache) | `requirePermission` in those routes |

### 5.2 API shape conventions

- **Partial PATCH, full response.** Every settings write is `PATCH` with a partial body validated by zod; the response is the full effective object so the client can replace state without a second fetch. Unknown keys are a 400 naming the key.
- **Gate in one place per resource.** Object routes call `resolveAccess` and require `manage` for settings writes and `contribute` for content writes. Org routes call `isOrgAdmin` or the specific tier from `tiers.ts`. No inline `Set([...])` copies; the 25 lists collapse into `src/lib/tiers.ts` exporting `TIERS` (ordered), `MANAGER_LEVELS`, `HR_ADMIN_LEVELS`, `ORG_ADMIN_LEVELS`, `labelFor`, `describe`.
- **Audit everything org and management scoped.** `logAuditEvent` on every class 5 to 12 write with `{ type, targetType, targetId, keys, oldValue, newValue }`; denials in `requireAccess` write `access.denied`.
- **Autosave contract.** Autosave controls debounce 300ms, send the partial, apply optimistically, revert on failure with the retry chip. Explicit-Save forms send one PATCH per form, never two sequential ones (Identity today sends `general` then `companyProfile`; the new `identity` section carries both).
- **Migrations.** New `User` columns, the `UserPreference.talk` column, `Folder` visibility update (no schema change), `SavedFilter` model, `CalendarConnection` if not present. Local uses `prisma migrate dev`; prod uses `prisma db execute` per the drift note in memory. Each migration ships behind a read-tolerant code path (missing column → default) so the deploy order is safe.

### 5.3 The "Show upcoming features" preference

`UserPreference.home.showUpcoming` (default off). Any row whose backend is missing renders only when it is on, with a "Coming soon" chip and no interactive control. This is how the honesty rule and the simplicity rule coexist without dead toggles (Phase 2 brief Q15 default). The list of rows behind it: email Mentions, Comments, Status, Due, Daily digest; Outlook, iCloud, Fastmail calendars; Webhooks UI; Email to List; List Imports; competitor importers; wizard private and pinned views until wired.

### 5.4 Access decisions that this design depends on (and must hold)

- **One resolver.** `resolveAccess` returns `none | read | contribute | manage | admin` and is called by pages and data APIs alike; `board.ts`, `space.ts`, `folder.ts`, `doc-access.ts` become thin wrappers. This is what makes "share a List on its own" open the page and its items, and what gives every panel its read-only flag. The decisions that must hold are encoded as: assigning a task grants `read` on the item and its List to the assignee; a non-guest Space or List member has `contribute`; `manage` requires OWNER or ADMIN on the object, the object's owner, or org admin; a BoardMember grant is additive (Can edit = MEMBER = contribute, View only = GUEST = read) and needs no Space membership; a FolderMember grant is additive and inherited downward.
- **One sharing vocabulary.** Owner / Can manage / Can edit / View only, in that order, with the same one-line blurb everywhere, mapped to OWNER / ADMIN / MEMBER / GUEST. SOP folders adopt the same labels (Viewer → View only, Editor → Can edit, Owner → Owner).
- **Visibility simplified.** Space visibility is Private or Org-wide; WORKSPACE is read as Private (the two are indistinguishable at read time today). Folder and List keep Inherit / Private / Org-wide.
- **Real guests.** Space and List email invites create a GUEST-tier account (new `AccessLevel` value or a flag on `User`) with no directory, no Org-wide Spaces, no seat; the invite dialog says so. Until that lands, the invite copy says "creates a member account" honestly.
- **Rail tier is the gate.** `requireAppAccess(appKey)` in every gated route layout reads catalog `requiredAccess` and the org floor.
- **Admin door in one layout.** `settings/layout.tsx` is the only gate for `/settings/*`.

---

## 6. How it looks

The Zoho reference (`zoho-reference.md`) is applied below the chrome: white canvas, one page title, text-tab views, one toolbar row with the single blue primary on the right, bordered white cards with hairline rows, quiet empty states. Brand stays blue `#0073EA`; no Zoho coral or purple. Tokens are `--os-*` only; no hex in components.

### 6.1 Settings list page (example: Admin › Members › People; also Work › Manage › Tags, Audit, API keys)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Back   Acme › Admin                                              ⌕  Filter │  takeover header 48px
├──────────────┬───────────────────────────────────────────────────────────────┤
│ Identity     │  Members                                    20/590 title      │  24px top padding
│ Members  ●   │  People   Invitations   Access levels        text tabs        │  active tab = grey pill, 590 weight
│ Security     │                                                               │
│ Billing      │  [Filter ▾] [Sort ▾] │ Level ▾  Department ▾      [+ Invite]  │  toolbar 40px, one blue primary
│ Audit        │  ┌───────────────────────────────────────────────────────────┐│
│ Data         │  │ Person          Title      Department  Level    Reports to ││  card: 1px N200 border, radius 8
│              │  ├───────────────────────────────────────────────────────────┤│  header 32px N50, 12/590 N500
│              │  │ ◯ Priya Nair    Designer   Product     Employee  A. Shah  ││  rows 36px, hairline separators
│              │  │ ◯ Arjun Shah    Manager    Product     Manager   R. Iyer  ││  no zebra, no bold cells
│              │  │ …                                                          ││
│              │  ├───────────────────────────────────────────────────────────┤│
│              │  │ 48 people                                    1 to 40 ‹ ›   ││  footer: totals left, pager right
│ ─────────────│  └───────────────────────────────────────────────────────────┘│
│ My account   │                                                               │
│ All settings │                                                               │
└──────────────┴───────────────────────────────────────────────────────────────┘
```

- Title 20/590 N800; tabs 14/400 N600, active 14/590 on an N100 pill; toolbar chips 32px bordered; the only blue is the primary button and focus rings.
- Filter opens a bordered side panel inside the content (Zoho pattern): search box plus checkbox rows; the table narrows.
- Selects in cells are borderless until hover, 32px; row "•••" on hover reveals actions.
- Empty state: 96px four-dot line art in N300, one 14px N500 sentence, one text link ("Invite someone").
- Sidebar rows 32px, 14px, icon 16px N500, active N100 pill with 590 weight; group rule lines only between the main rows and the footer.

### 6.2 Settings form page (example: Admin › Security › Policy; also Identity, Region, Profile, Preferences, Reviews and scoring)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Back   Acme › Admin                                                        │
├──────────────┬───────────────────────────────────────────────────────────────┤
│ …            │  Security                                                     │
│ Security ●   │  Policy   Sign-in   API keys                                  │
│ …            │                                                               │
│              │  ┌ Passwords ─────────────────────────────────────────────────┐│  card title 16/590, 16px padding
│              │  │ Minimum length            [ 8  ]  characters               ││  label above, 36px input, max 5 fields per card
│              │  │ Require an uppercase letter          ( ● ) Saved ✓         ││  toggles autosave with inline tick
│              │  │ Require a number                     ( ● )                 ││
│              │  │ Require a symbol                     (   )                 ││
│              │  │ Password expires after    [ Never      ▾ ]                 ││
│              │  └────────────────────────────────────────────────────────────┘│
│              │  ┌ Sessions ──────────────────────────────────────────────────┐│
│              │  │ Sign out after inactivity [ 12 hours   ▾ ]                 ││
│              │  │ Require two-factor for everyone      (   )                 ││
│              │  │   Members without it will be asked to set it up next time  ││  13px N500 helper
│              │  └────────────────────────────────────────────────────────────┘│
│              │  ┌ Sign-in domains ───────────────────────────────────────────┐│
│              │  │ acme.com  ×   [ add a domain           ]                   ││
│              │  └────────────────────────────────────────────────────────────┘│
│              │                                                               │
│              │  ┌ Danger zone ───────────────────────────────────────────────┐│  red hairline border, at the bottom only
│              │  │ Sign everyone out           [ Sign out all devices ]       ││  outline red button; typed confirm
│              │  └────────────────────────────────────────────────────────────┘│
├──────────────┴───────────────────────────────────────────────────────────────┤
│                                  Unsaved changes      [ Discard ]  [ Save ]  │  sticky bar, only when dirty
└──────────────────────────────────────────────────────────────────────────────┘
```

- Content column max 720px, 24px padding, cards 16px inside, 16px gap between cards.
- One primary per form (the Save bar); toggles and selects autosave and show "Saved ✓" beside the control for 1.5s.
- Read-only mode: same layout, controls disabled, a single N50 banner under the tabs: "You can view these settings. Only org admins can change them."
- The object panel (D1) uses the same card and control styles inside a 520px drawer, with the tabs under the drawer header and the danger card last.
- Hub Manage pages use the list page layout for Task types, Tags, Templates, Saved filters, Departments, Job titles, Offices, Tools, Assets, API keys, and the form layout for Reviews and scoring, Publishing, Module, Time and week.

---

## 7. New-org defaults and the first-run path

### 7.1 Defaults written at org creation (one `seedOrgDefaults(orgId)`)

| Setting | Default |
|---|---|
| Modules | Talk off, Tables off (premium, admin turns on from the hub) |
| Rail | catalog order, nothing hidden, no floors beyond the catalog baseline |
| Appearance defaults | Light, workwrk blue, Cozy; no locks |
| Region | timezone from the signup browser, currency by country, fiscal month 4 (India) or 1, week starts Monday, date format by locale, language en |
| Security policy | min length 8, uppercase and number required, no expiry, idle timeout 720 minutes, MFA not required (the `ENFORCE_MFA_AT_LOGIN` env behaviour is unchanged) |
| Notifications | all in-app on, email master on with Task assigned and Kudos on, digest daily |
| Invites | Admins and managers can invite; domain join off |
| Retention | Trash 60 days, audit log 365 days, closed-task archive off |
| Announcements | HR admins post |
| SOPs | HR admins publish, acknowledgement required, 7 days |
| Automations | on |
| Task types | built-ins, default "Task" |
| Tags | none (no SAMPLE ever) |
| First Space | "General", Org-wide, new members join as Can edit, all tabs on, canonical statuses |
| Access matrix | defaults from `role-defaults.ts` for the enforced cells only |

New members are seeded from the org notification defaults and region defaults into their `User` locale columns and `UserPreference`.

### 7.2 First-run path (admin)

1. Signup creates the org and the first Space with the defaults above; the admin lands on Work › General (or My work per Q7).
2. The setup checklist (existing `admin-setup-checklist.tsx`, re-pointed) shows four steps in order, each a single deep link: **Add your logo and mission** (`/settings/identity`), **Invite your team** (`/settings/members?invite=1`), **Create departments** (`/team/manage?tab=departments`), **Turn on Talk or Tables** (`/tlk`, `/tables`, which show the D7 switch). Each step ticks itself from the real data (logo present, at least one invite, at least one department, any module active). Dismissed state is server-side (`OrgPreference.homeDefault.checklistDismissedAt`), not localStorage, so it does not reappear on another device.
3. The mission splash shows on first open per day (Phase 2 brief Q3 default); the Identity page is where the admin edits what it shows.
4. Nothing in first run asks for a permission matrix, a scoring model or a security policy; those are discovered later through search, All settings, or the surface that needs them (the first review cycle launch links to Reviews and scoring).

### 7.3 First-run path (member)

1. Invite email → set password → optional MFA (if required) → lands on the first Space they were added to.
2. A one-time hint on the avatar: "Your profile and preferences are here"; dismissed state server-side.
3. No settings step is mandatory. Timezone is taken from the browser on first sign-in and stored on the user; the Preferences page shows "Using your device timezone" until changed.

---

## 8. Risks

1. **Discoverability of distributed settings.** An admin who expects a single settings tree may not guess that task types are under Work › Manage. Mitigations: `SETTINGS_INDEX` powering `⌘K` and the takeover filter; the generated All settings index page (D9); every old URL redirects; the Admin sidebar footer links to All settings. This is the risk that decides whether the stance works, and the mitigations are part of the spec, not optional.
2. **Two places that look like the same thing.** Billing › Modules (summary) versus the hub switch, Preferences › Time and week versus Planner › Manage. The one-home rule is explicit in section 0 and each secondary surface renders links and read-only values only; code review should reject a second control.
3. **Resolver unification is a large, cross-cutting change.** Collapsing four gates into one touches ~55 API routes and the sharing dialogs. Ship it first, behind a flag that logs disagreements between old and new decisions for a week before switching, so no user loses access silently (data integrity mandate).
4. **Enforcing rail floors and matrix cleanup changes real behaviour.** Apps that were reachable by URL stop being reachable; unenforced matrix cells disappear and are replaced by contextual rules with different defaults. Communicate in the changelog and seed the contextual rules from each org's current matrix values where a mapping exists (for example `announcements.create` → announcement posters).
5. **Schema migrations on a drifted prod database.** New `User` columns, `UserPreference.talk`, `SavedFilter`, `CalendarConnection`. Use `prisma db execute` on prod per the memory note; every reader tolerates a missing column.
6. **Parity mandate.** The object settings drawer and the hub Manage pages are new surfaces. They are modelled on ClickUp's Space settings modal, List settings, and the Workspace › Settings pages, so they are re-parenting, not invention, but the founder should confirm per Phase 2 brief Q1 before pixels move.
7. **Takeover versus in-place.** Admin and My account remain a takeover (fixed shape in the brief); everything else is in place. Users may feel two modes. Mitigation: identical header stack, identical cards and controls, and the origin-returning Back so the takeover never strands anyone.
8. **Real guests are a prerequisite for honest sharing copy.** Until the GUEST account type exists, the invite dialog must say "creates a member account" and the marketing claim about free guests stays untrue.
9. **Accent and Home-cards decisions are open (Q4, Q7).** The spec ships one accent list and a wired Home cards control either way, but the founder's answers change what those two controls show.
10. **Mobile.** The takeover sidebar collapses below 900px into a top tab strip; the object drawer becomes full-screen; Manage pages inherit the shell's responsive work, which does not exist yet. Settings should not be the first mobile surface, but the layouts above degrade rather than break.
11. **Audit volume.** Auditing every autosave toggle can flood the log. Debounce per key and collapse consecutive edits by the same actor on the same key within 60 seconds into one row.
