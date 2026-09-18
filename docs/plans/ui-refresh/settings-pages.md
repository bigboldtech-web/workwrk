# UI audit: Settings + Account subsystem

Audited 2026-09-10, read-only. Scope: every route under `src/app/(dashboard)/settings/**`, `src/app/(dashboard)/account/**`, plus `/organization`, `/people/me`, `/me/*`. All paths below are relative to `/Users/bigboldtechnologies/theywrk/`.

## 0. How the subsystem is wired (read this first)

### Shell / chrome
- `src/components/layout/os/os-shell.tsx:79` puts the whole app into **settings mode** whenever `pathname` starts with `/settings` or `/account`: the app rail, the hub sidebar and the ClickTopbar are all unmounted and the route renders inside a full-screen white `div.workwrk-os`. Command palette, item drawer, customize panel, create-task modal, My Work / Notepad panels are NOT mounted in settings mode (only ReminderTicker, CallDock, IncomingCallWatcher, RealtimeClient survive: os-shell.tsx:88-96).
- `src/app/(dashboard)/settings/layout.tsx` and `src/app/(dashboard)/account/layout.tsx` both wrap children in `SettingsShell` (`src/components/layout/os/settings-shell.tsx`).
- `SettingsShell` renders:
  - A 48px header: `Back` (`<Link href="/today">`, settings-shell.tsx:157-164), a non-clickable breadcrumb `"{org name} > Settings"` (fetched from `/api/settings`, :145-152), and an `X` close link to `/today` (:172-179). `Esc` also pushes `/today` (:136-142).
  - A fixed `w-[248px]` left nav titled "All settings" with two **doors** (settings-shell.tsx:53-125):
    - **Admin** (hidden entirely unless session `accessLevel` is `SUPER_ADMIN` or `COMPANY_ADMIN`, :27,:132,:190): Organization (Overview, Identity & profile, Locale & finance, Enabled modules, Apps, Tags & labels, Task types), People & structure (Members, Org structure, Reporting hierarchy, Roles & permissions), Governance (Audit log, Data & compliance, Defaults & locks), Platform (API keys, Calendar feeds, Integrations, Import / Export), Billing & performance (Plan & billing, Scoring & reviews).
    - **Personal** (everyone): Profile (`/account/profile`), Notifications (`/settings/notifications`), Appearance (`/account/appearance`), Security (`/account/security`).
  - Active row = `pathname.startsWith(href)` (exact for Overview). Rows without `href` would render a disabled "Soon" pill (:215-224) but none currently do.
- Server gating is per-route, not per-door: only `apps`, `audit`, `data`, `defaults`, `identity`, `tags` have a `layout.tsx` calling `requireOrgAdminOrRedirect()` (`src/lib/route-guard.ts:29-34`, redirects non-admins to `/dashboard`), and `structure/page.tsx:55-78` gates inline (renders a lock card). Every other Admin-door route (`/settings` overview, locale, modules, task-types, members, hierarchy, permissions, api, calendar, integrations, import-export, billing, scoring) is reachable by URL for any signed-in user and relies on client-side `canEdit` flags and API 403s.

### Entry points into Settings (how a user gets here)
| Entry | File | Target | Note |
|---|---|---|---|
| Profile menu (top-right avatar) "Settings" | `src/components/layout/os/profile-menu.tsx:202` | `/settings` | |
| Profile menu "Themes" | profile-menu.tsx:204 | `/settings?tab=themes` | `?tab` is ignored by `settings/page.tsx`; lands on Overview, not Appearance |
| Profile menu "Keyboard shortcuts" | profile-menu.tsx:205 | `/settings?tab=shortcuts` | no shortcuts page exists; lands on Overview |
| Profile menu "Notifications" | profile-menu.tsx:203 | `/inbox` | goes to Inbox, not notification prefs |
| Profile menu "My Profile" | profile-menu.tsx:201 | `/people/me` | |
| App rail bottom "Upgrade" | `src/components/layout/os/click-app-rail.tsx:193-200` | `/settings` | labelled Upgrade, lands on Overview not `/settings/billing` |
| Rail app "Settings" (alwaysPinned) | `src/components/layout/os/apps-catalog.tsx:1332-1335` | `/settings` | its own hub sidebar `SettingsSidebar` (:1135-1157) is only visible on `/build`, `/store`, `/tools`, `/assets`, `/trash` because `/settings` and `/account` immediately enter settings mode |
| Command palette "Settings" | `src/components/layout/os/command-palette.tsx:137` | `/settings` | |
| Keyboard `g` then `s` | `src/hooks/use-goto-nav.ts:23` | `/settings` | |
| Workspace menu "Upgrade" | `src/components/layout/os/workspace-menu.tsx:250` | `/settings/billing` | |
| Workspace menu "Manage members" and "Invite people" | workspace-menu.tsx:381,391 | `/settings/members` (both) | "Invite people" does not open the invite modal, just lands on Members |
| Board "..." menu "Default task type" | `src/components/layout/os/board-more-menu.tsx:428` | `/settings/task-types` | |
| Create-task modal type picker footer | `src/components/layout/os/create-task-modal.tsx:930` | `/settings/task-types` | |
| ModuleDisabled gate "Enable in Settings > Modules" | `src/components/layout/module-disabled.tsx:38` | `/settings/modules` | |
| Org chart "Org settings" | `src/app/(dashboard)/organization/org-chart-client.tsx:232` | `/settings` | |
| Org chart "fix in Members" | org-chart-client.tsx:270,282 | `/settings/members` | |
| People profile (self) "Edit personal info" | `src/app/(dashboard)/people/[id]/profile-client.tsx:1059` | `/account/profile` | |
| Tools / Assets / Integrations pages "Settings" nav-link | tools/page.tsx:147, assets/page.tsx:113, integrations/page.tsx:89 | `/settings` | |
| Admin setup checklist "Invite your team" | `src/components/admin-setup-checklist.tsx:100` | `/settings` | should be `/settings/members` |
| Admin setup checklist "Set up your company profile" and "Create departments" | admin-setup-checklist.tsx:65,72 | `/organization` | `/organization` is now the ORG CHART; company profile lives at `/settings/identity`, departments at `/people/departments` |
| Admin tour steps 1-3 | `src/lib/tour-content.tsx:22-40` | `/organization`, `/settings`, `/settings` | copy says "Organization page ... AI Assist", "Settings > Team", "Settings > Access Control": none of those labels exist any more |
| Team hub sidebar "Org chart" / "My Profile" | apps-catalog.tsx:1013,1017 | `/organization`, `/people/me` | |
| Today "My alignment" card | `src/components/today/my-alignment.tsx:262-296` | `/me/weekly-review` | |
| Nothing | | `/me/mentions` | no inbound link anywhere in `src` (URL-only) |

### Data plane summary
`/api/settings` GET (any session) returns org + `settings` JSON + usage; PATCH (COMPANY_ADMIN / SUPER_ADMIN / C_LEVEL, `src/app/api/settings/route.ts:126-129`) accepts `companyProfile` or `section` in `general | scoring | notifications | security | modules`. Only `general`, `scoring` and `companyProfile` have UI writers; `notifications` (org-level) and `security` (password policy / session timeout / org-wide 2FA) have NO UI writer anywhere.

---

## 1. Route inventory

Field key: **Reach** = how a user gets there. **Back** = back affordance and target. **Top bar** = what the chrome shows (in settings mode the only top bar is the SettingsShell header: `Back` -> /today, breadcrumb, `X` -> /today). **Sidebar** = SettingsShell nav (Admin door + Personal door as listed in section 0) unless stated. **State** = polished / rough / broken / stub.

### 1.1 `/settings` (Overview)
- File: `src/app/(dashboard)/settings/page.tsx`
- Purpose: card-grid hub; each card shows 2-4 live values and deep-links to the editing page.
- Reach: profile menu "Settings", rail "Settings", rail "Upgrade", command palette, `g s`, "Settings" nav-links on several pages. Admin nav row "Overview".
- Back: shell header only (`/today`). No BackButton.
- Top bar: shell header. Page h1 "Overview" 16px bold + subtitle `"{org} · N of 2 modules on · plan X"`.
- Sidebar: full SettingsShell nav (Admin door only if admin; overview row is under the Admin door, so a non-admin who lands here by URL sees a page with no matching nav row).
- Controls / cards (page.tsx:96-265):
  - Organization: "Identity & profile" -> `/settings/identity`; "Locale & finance" -> **`/settings`** (self-link, page.tsx:112) even though `/settings/locale` exists; "Plan & billing" -> **`/settings`** (self-link, :123) even though `/settings/billing` exists.
  - Product & integrations: Modules -> `/settings/modules`; Tags & labels -> `/settings/tags`; Task types -> `/settings/task-types`; API keys -> `/settings/api`; Calendar feeds -> `/settings/calendar`.
  - Scoring & reviews: three cards ("Review cadence", "Score weights", "Performance bands") all -> `/settings/scoring`. "Frequency" shows `reviewFrequency` (a legacy field the scoring page no longer edits). "Score weights" prints the first 3 keys of `scoreWeights`, which for a never-saved org is the API default `{kpi, manager, peer, self, sopCompliance}` (settings/route.ts:80-82), a different vocabulary from the scoring page's `kpi / sopCompliance / behavioral / peer`.
  - Security & compliance: "Password policy" and "Session & 2FA" both -> **`/account/security`**, which only *displays* org policy read-only (see 1.24); there is no page that edits it. "Audit log" -> `/settings/audit`.
  - Usage: People -> `/people`, Knowledge -> `/sops`, AI usage -> `/analytics` (all leave settings mode with no way back except browser).
  - Missing cards: Apps, Members, Org structure, Hierarchy, Permissions, Data & compliance, Defaults & locks, Integrations, Import/Export, Notifications, Appearance, Profile. The hub covers roughly half of the nav.
- Loading: `ValueLoader` (brand). Error: `OsEmptyView` with `cta="Retry"` but no `onCta`/`ctaHref`, so the CTA is hidden (empty-view.tsx:41): error state has no recovery action.
- Server gate: none. Any employee can open it by URL; `/api/settings` GET is open to any session.
- State: **rough** (works, but self-links, stale field vocab, incomplete coverage).

### 1.2 `/settings/identity` (Identity & company profile)
- Files: `settings/identity/page.tsx`, `settings/identity/layout.tsx` (server gate `requireOrgAdminOrRedirect`).
- Purpose: org name, primary domain, logo, and the company profile (industry, mission, vision, about, core values) that feeds the mission/values loader splash and AI KRA generation.
- Reach: Admin nav "Identity & profile"; Overview card.
- Back: shell header only. Inline text link to `/settings/locale` (page.tsx:166).
- Top bar: shell header. h1 20px "Identity & company profile" with Building2 icon.
- Controls: Logo Upload/Replace + Remove (POST/DELETE `/api/settings/logo`, saves instantly, client-validates type + 2MB); Organization name (text); Primary domain (text); Industry (text); Mission, Vision, About (textareas rows=2); Core values (chip list, add on Enter / Add button, remove X, case-insensitive dedupe); one "Save changes" button at the bottom that fires two sequential PATCHes (`section:"general"` then `companyProfile`, :82-108). Toast on success/failure via `useOsToast`.
- Access mismatch: layout redirects everyone except SUPER_ADMIN / COMPANY_ADMIN, but page `canEdit` also includes `C_LEVEL` (:45) and the API PATCH accepts C_LEVEL. C_LEVEL can never reach the page it is allowed to edit.
- Issues: no dirty-state indicator, no unsaved-changes guard on Back/Esc; `Save` sends the general PATCH even if only profile changed (and `data.name` empty string is silently ignored server-side because `if (data.name)`); domain has no format validation; textareas rows=2 for mission/about are cramped; on `/api/settings` failure the form silently loads blank (`blank()`, :56,:70) with no error surfaced, and Save would then overwrite real values with empty strings.
- Loading: `Loader2` + "Loading settings…". Empty state: n/a.
- State: **polished** (functionally the best-wired page here), with the C_LEVEL gate inconsistency.

### 1.3 `/settings/locale` (Locale & finance)
- File: `settings/locale/page.tsx`. No layout gate.
- Purpose: org timezone, currency, fiscal year start, default language.
- Reach: Admin nav "Locale & finance"; text link from Identity. The Overview card that should point here self-links to `/settings`.
- Back: shell header only.
- Top bar: shell header. h1 20px "Locale & finance".
- Controls: 4 native `<select>`s (Timezone: 9 fixed zones; Currency: 8 codes; Fiscal year start: 4 options; Default language: 6) + "Save changes" (PATCH `section:"general"`). `canEdit` = COMPANY_ADMIN / SUPER_ADMIN / C_LEVEL (matches API).
- Issues: timezone list is 9 entries (no search, no IANA list, no "detect"); org saved with any other zone (API default is `Asia/Kolkata` / `INR`, settings/route.ts:71-72) shows the first option or a blank select because the value is not in the list; `fiscalYearStart` is normalised to `"MM-01"` strings (:49-57) while the API default and the Overview card treat it as a number ("Month 4"), so Overview shows `Month 04-01` after a save; "Default language" saves but nothing in the app reads `settings.language` (no i18n) so it is a cosmetic setting; no dirty indicator; page subtitle says "Shared with Identity & profile" while Identity says locale is intentionally NOT there (contradictory copy).
- Loading: `Loader2`.
- Server gate: none (non-admins see disabled selects).
- State: **rough**.

### 1.4 `/settings/modules` (Enabled modules)
- File: `settings/modules/page.tsx`. No layout gate.
- Purpose: toggle premium modules (Talk, Tables) on/off via ProductInstallation.
- Reach: Admin nav "Enabled modules"; Overview "Modules" card; ModuleDisabled gate page.
- Back: shell header only.
- Top bar: shell header. h1 20px "Modules" (nav says "Enabled modules": label drift).
- Controls: one row per `MODULES` entry (2 rows) with label, "competes with" pill, blurb, and a `Switch` (POST/DELETE `/api/products/installations`, optimistic with revert, dispatches `workwrk:prefs-changed`). Admin-only edit; others read-only.
- Issues: with only two modules the page is mostly whitespace; no link to the module itself after enabling; no indication of billing impact; no layout gate (harmless, API is admin-gated).
- Loading: `Loader2`.
- State: **polished** but thin.

### 1.5 `/settings/apps` (Apps: rail access + order)
- Files: `settings/apps/page.tsx`, `settings/apps/layout.tsx` (org-admin gate).
- Purpose: org-wide left-rail config: order (drag or up/down), hide/show switch, per-app access floor select. Writes `OrgPreference.sidebarDefault.apps` via PATCH `/api/org/preferences` on every change.
- Reach: Admin nav "Apps". Not on the Overview hub.
- Back: shell header, plus an in-page breadcrumb `Settings > Apps` (page.tsx:242-246) that links to `/settings` (duplicates the shell breadcrumb, which is NOT clickable).
- Top bar: shell header. h1 19px with `#0073EA` icon.
- Controls per row: drag handle, icon, label, "Always available" lock pill (alwaysPinned), category + baseline tier caption, floor `<select>` (Everyone / Managers and up / HR and org admins / Org admins only), Move up / Move down buttons, visibility `Switch`. Saves on every change with toast; verifies the response actually persisted `apps` (:150-152, honest data-integrity check).
- Issues: the whole list is one long undifferentiated column (30+ apps) with no category grouping or search; `saving` disables every control during each PATCH so rapid reorders feel sticky; hidden/floored apps are display-only (routes still reachable), which the page says in small grey text; h1/breadcrumb style (19px + `#0073EA` hex) differs from the 20px zinc pages.
- Loading: `Loader2`. Error: falls back to pure catalog + toast.
- State: **polished**.

### 1.6 `/settings/tags` (Tags & labels)
- Files: `settings/tags/page.tsx` (the rendered page), `settings/tags/layout.tsx` (org-admin gate), `settings/tags/tags-manager.tsx` (**orphaned**, imported by nothing).
- Purpose: org tag taxonomy.
- Reach: Admin nav "Tags & labels"; Overview card.
- Back: shell header; OsTitleBar action link "Settings" -> `/settings`.
- Top bar: shell header + `OsTitleBar` "Tags" with amber star and dead standard buttons (see cross-cutting). KPI strip (Tags / Categories / Total usage / Archived), search, "Show archived" checkbox, category chips, grouped tag chips.
- Controls: "New tag" (two sequential `prompt` dialogs: name, then category, :63-83); per-tag Delete (trash icon).
- **Broken (high)**:
  - Data-shape mismatch: page expects `{category, usageCount}` (page.tsx:22) but `/api/tags` returns `{type, _count.assignments}` (`src/app/api/tags/route.ts:51-63`), so every real tag renders with `category: undefined` and no count; `grouped` keys become `undefined`.
  - **Fabricated data**: when the API returns an empty list, or errors, the page shows `SAMPLE` (10 fake tags "Engineering", "Q1 launch", "EMEA"...) as if real (page.tsx:30-41, :55-59). This violates the no-fabricated-data rule.
  - Create posts `{name, category, color}` but the API reads `type` (defaults to `CUSTOM`) and ignores `category`; on non-OK it appends a local fake row with toast "Tag created (local — API not wired yet)" (:72-76).
  - Delete never calls `DELETE /api/tags/[id]`; it only removes the row locally and toasts "Tag deleted" (:85-89). Reload brings the tag back.
  - No edit / rename / archive / colour affordance even though the API supports PATCH.
  - Meanwhile `tags-manager.tsx` is a complete, correctly wired manager (types, create/edit/archive/delete against the real API) that is never rendered. It uses the OTHER design system (`ui/card`, `ui/button`, `ui/badge`, `useToast`).
- Empty state: `OsEmptyView` with `cta="New tag"` but no handler, so the CTA is hidden; but this state is unreachable anyway because SAMPLE fills in.
- Loading: `ValueLoader`.
- State: **broken**.

### 1.7 `/settings/task-types` (Task types)
- File: `settings/task-types/page.tsx`. No layout gate.
- Purpose: manage Item types (built-in + custom), pick default, add from recommended library.
- Reach: Admin nav "Task types"; Overview card; board "..." menu "Default task type"; create-task modal picker footer.
- Back: shell header; OsTitleBar action link "Settings" -> `/settings`.
- Top bar: shell header + `OsTitleBar` "Task Types" (amber star + dead Ask AI/Share/Invite) with usage caption `"N of 20 custom types used"`, "New type" button.
- Controls: Active types grid (hover-reveal Set default star, Delete trash for non-built-in); Recommended section with search + category chips + per-card "Add"; Create modal (hand-rolled `fixed inset-0` overlay, NOT the shared `ui/dialog`) with icon grid, singular/plural (16 char), description (100 char).
- Issues: **no authz anywhere**: no layout gate, no `canEdit`, and `/api/item-types` POST and `/api/item-types/[id]` PATCH/DELETE have no role check (`src/app/api/item-types/route.ts:33`, `[id]/route.ts:18,55`), so any EMPLOYEE can delete the org's custom task types by URL; hover-only action buttons are invisible on touch; a page under Admin door that is not admin-only; Create modal is a bespoke overlay (inconsistent with Radix `ui/dialog` used by API keys and MFA).
- Loading: `Loader2` in section. Empty: "Nothing to add" text.
- State: **rough** (works; access hole).

### 1.8 `/settings/members` (Members)
- File: `settings/members/page.tsx`. No layout gate.
- Purpose: list people, set access level and reporting manager, invite, revoke pending invites.
- Reach: Admin nav "Members"; workspace menu "Manage members" and "Invite people"; org chart "fix in Members"; hierarchy page text link.
- Back: shell header only.
- Top bar: shell header. h1 16px bold "Members" (smaller than the 20px sibling pages) + "Invite" brand button (admin only).
- Controls: two count pills (managers & admins / members), search box, table (Person, Access level `<select>`, Reports to `<select>` of all members, Reports count, KRAs count), per-row optimistic PATCH `/api/users/[id]`; Pending invites table (Email, Access level, Invited, Status Pending/Expired, Revoke) only when there are invites; `InviteModal`.
- Issues: for non-org-wide callers `/api/users?scope=all` is silently coerced to team scope (`src/app/api/users/route.ts:51-56`), so a MANAGER opening this URL sees only their team labelled as "Members" with counts that look org-wide; table has no `overflow-x` wrapper (5 columns + two selects overflow at narrow widths); no pagination (limit=500); no per-person link to `/people/[id]`; no department / role / status columns even though `/api/users/[id]` PATCH accepts `departmentId/roleId/status`; error banner is generic; nothing tells the admin that demoting the last COMPANY_ADMIN is blocked until the API 403 text appears; "Reports to" select lists up to 500 names with no search.
- Loading: `Loader2`. Empty: "No people match".
- State: **rough**.

### 1.9 `/settings/structure` (Org structure)
- File: `settings/structure/page.tsx` (server component, inline admin gate rendering a lock card for non-admins).
- Purpose: hub tiles to Functions (`/people/departments`), Roles (`/people/roles`), Access levels (anchor `#levels`), Offices (**Coming soon** placeholder), plus a read-only explainer of the 10-tier access ladder with live head-counts.
- Reach: Admin nav "Org structure". Not on Overview.
- Back: shell header, plus in-page breadcrumb `Settings > Org structure` (:100-104).
- Top bar: shell header. h1 19px with `#0073EA` icon.
- Controls: 3 link tiles, 1 disabled dashed tile ("Offices · Coming soon"), tier list (numbered, "Admin door" pill, people count). Text links to `/settings/permissions`, `/account/profile` and a bare **`/account`** (:209) which has no page (404 in settings mode).
- Issues: tiles to Functions/Roles leave settings mode into the People hub with no return path; Offices is a stub even though the model/API exist; `/account` link 404s; tier descriptions are hand-written prose that can drift from the permission matrix.
- Loading: SSR (no loader). Error: n/a.
- State: **polished** hub with one **stub** tile and one broken link.

### 1.10 `/settings/hierarchy` (Reporting hierarchy)
- File: `settings/hierarchy/page.tsx`. No layout gate.
- Purpose: read-only tree of `User.managerId`, built client-side from `/api/users?scope=all&limit=500`.
- Reach: Admin nav "Reporting hierarchy". Not on Overview.
- Back: shell header; text link to `/settings/members`.
- Top bar: shell header. h1 20px "Hierarchy" (nav says "Reporting hierarchy").
- Controls: expand/collapse chevrons (top two levels open by default). No editing.
- Issues: duplicates `/organization` (org chart) with less information (no role/department, no cycle detection: a manager loop makes both users vanish, whereas org-chart-client.tsx:77-104 sweeps them into "Not linked"); managers get a team-scoped tree silently; no server gate; no link to the person's profile; no search.
- Loading: `Loader2`. Empty: "No people yet."
- State: **rough** (redundant).

### 1.11 `/settings/permissions` (Roles & permissions)
- File: `settings/permissions/page.tsx`. No layout gate (API PATCH is admin-gated; GET open).
- Purpose: modules x actions x access-level checkbox matrix (`PERMISSION_MODULES`, 16 modules), saved wholesale via PATCH `/api/permissions`.
- Reach: Admin nav "Roles & permissions"; Structure page text link. Not on Overview.
- Back: shell header only.
- Top bar: shell header. h1 20px "Roles & Permissions" (title-case inconsistency vs sentence-case nav).
- Controls: `<details>` per module (kras/sops/people/reviews open by default), sticky-left "Capability" column, 10 level columns with abbreviations (Super/Admin/C-Lvl/VP/Dir/HR/Mgr/Lead/Emp/Agent), lock icons for the two protected roles, checkboxes (`accent-zinc-900`), sticky bottom bar with "Save changes" + "Unsaved changes" + ok/err banner (admins only).
- Issues: no "reset to defaults", no per-row "select all"; abbreviations only explained via `title` tooltips; no search across ~100 capabilities; navigating away with dirty state loses edits silently (Back/Esc/nav rows); the 16 permission modules include "Assets", "Tools & Credentials", "Surveys", "Ideas", "Announcements", "Policies" which no longer match the rail/product scope (PPMS pivot); checkbox accent is black while every other control is brand blue.
- Loading: `Loader2`.
- State: **polished** functionally, rough UX.

### 1.12 `/settings/audit` (Audit log)
- Files: `settings/audit/page.tsx`, `settings/audit/layout.tsx` (org-admin gate).
- Purpose: org-wide ActivityLog feed with filters and signed JSONL export.
- Reach: Admin nav "Audit log"; Overview card; Import/Export hub "Audit log"; API keys page nav-link.
- Back: shell header; OsTitleBar action links "Settings" -> `/settings` and "API keys" -> `/settings/api`.
- Top bar: shell header + `OsTitleBar` "Audit log" with amber star and dead Ask AI / Share / Invite buttons; actions: Export, Settings, API keys.
- Controls: 4 KPI tiles (Today / Warnings / Critical / In view), search (client-side over loaded rows only), range chips (All / 24h / 7d / 30d / 90d), type chips (from first unfiltered page), actor chip (set by clicking an actor), row list with severity accent, "Load more" cursor pagination, Export (GET `/api/audit-log/export`, honours type + range, not actor).
- Issues: search only filters the 100 rows in memory; KPI "Today" counts only rows in view (misleading as a stat); each row has a `ChevronRight` arrow but rows are not clickable (no detail / old-new value diff even though the API returns `oldValue/newValue`); type chips are derived only from the first page so rarer types never appear; export ignores actor filter.
- Loading: `ValueLoader`. Error/empty: `OsEmptyView` (no CTA).
- State: **polished** (legacy BEM styling).

### 1.13 `/settings/data` (Data & compliance)
- Files: `settings/data/page.tsx`, `settings/data/layout.tsx` (org-admin gate).
- Purpose: real export downloads (full ZIP, people CSV, timesheets, purchase orders, invoices, audit CSV) + links to `/imports` and `/trash`.
- Reach: Admin nav "Data & compliance". Not on Overview.
- Back: shell header only.
- Top bar: shell header + `OsTitleBar` "Data & compliance" (`showInvite={false}` but Ask AI / Share dead buttons + amber star still render).
- Controls: 6 export buttons (fetch -> blob -> anchor download, filename from Content-Disposition, 0-byte guard, 401/403/503 messages), 2 governance link cards (leave settings mode).
- Issues: "Purchase orders" and "Invoices" exports exist although Finance was removed from the product scope (PPMS pivot); overlaps with `/settings/import-export` (two hubs for the same thing); no retention settings despite the subtitle "manage retention"; no export history / audit of who exported.
- Loading: per-button spinner. Empty: n/a.
- State: **polished**.

### 1.14 `/settings/defaults` (Defaults & locks)
- Files: `settings/defaults/page.tsx`, `settings/defaults/layout.tsx` (org-admin gate).
- Purpose: org default theme (Light/Dark/Auto), accent (7 brand-safe swatches), density (Compact/Cozy), and 4 lock switches (Theme, Density, Sidebar layout, Home cards) writing `OrgPreference` via PATCH `/api/org/preferences`.
- Reach: Admin nav "Defaults & locks". Not on Overview.
- Back: shell header, plus in-page breadcrumb `Settings > Defaults & locks`; text link to `/account/appearance`.
- Top bar: shell header. h1 19px with `#0073EA` icon.
- Controls: 3 theme cards, 7 accent buttons, density segmented control, 4 `Switch` locks. Save-on-change with toast, revert-by-reload on failure.
- Issues: help text admits Density and Sidebar locks are enforced but their controls are "not greyed out yet" in the Customize panel (:344-347); accent vocabulary (7 keys) differs from the personal Appearance page (10 keys incl. banned purple/pink/violet/indigo) so an org default of `workwrk` cannot be selected personally and vice-versa; every control is disabled while any PATCH is in flight; hard-coded hex/inline styles instead of tokens.
- Loading: `Loader2`.
- State: **polished**.

### 1.15 `/settings/api` (API keys)
- File: `settings/api/page.tsx`. No layout gate (page shows "Admins only" notice for non-admins; API is admin-gated).
- Purpose: list / mint / revoke org API keys (`/api/keys`).
- Reach: Admin nav "API keys"; Overview card; Integrations hub card; Audit page nav-link.
- Back: shell header; OsTitleBar action links "Settings" -> `/settings`, "Audit" -> `/settings/audit`.
- Top bar: shell header + `OsTitleBar` "API keys" with amber star and dead Ask AI / Share / Invite; "Generate key" primary.
- Controls: 4 KPI tiles (Active / In use / Stale / Revoked), warning callout, search, table (Name, prefix copy button, scope pills, Last used with tooltip, Created, Revoke trash), Generate dialog (Radix `ui/dialog`: name, READ/WRITE/ADMIN scope cards), Reveal-once dialog (copy, "Done — I've saved it"), confirm dialog on revoke.
- Issues: no rate-limit editing even though rows carry `rateLimitPerMinute/Day`; no scope editing after creation; revoked keys stay in the list forever with no "hide revoked"; `Link` nav-links styled as BEM `.apk__nav-link` (legacy chrome).
- Loading: `ValueLoader`. Empty: `OsEmptyView` with working "Generate key" CTA. Error: inline warning row.
- State: **polished**.

### 1.16 `/settings/calendar` (Calendar feeds)
- File: `settings/calendar/page.tsx`. No gate. Static.
- Purpose: **stub**. Five provider cards (Google, Outlook, iCloud, Fastmail, ICS) each labelled "Coming soon"; copy explains there is no calendar-OAuth backend.
- Reach: Admin nav "Calendar feeds"; Overview card ("Subscribe external calendars; publish org feeds" - overpromises); Integrations hub card ("Connect Google, Outlook, iCloud or ICS feeds" - overpromises); `/integrations` marketplace nav-link.
- Back: shell header; OsTitleBar links "Settings" -> `/settings`, "Integrations" -> `/integrations` (leaves settings mode).
- Top bar: shell header + `OsTitleBar` "Calendar integrations" (title differs from nav "Calendar feeds") with amber star + dead Ask AI / Share / Invite.
- Controls: none functional.
- State: **stub**. Consider removing from nav until real, or fold into Integrations.

### 1.17 `/settings/integrations` (Integrations)
- File: `settings/integrations/page.tsx`. Server component, static. No gate.
- Purpose: 3 link cards: Calendar feeds (`/settings/calendar`, a stub), App marketplace (`/integrations`, which itself says "none available yet · demand-driven"), API keys (`/settings/api`).
- Reach: Admin nav "Integrations". Not on Overview.
- Back: shell header only.
- Top bar: shell header. h1 20px "Integrations".
- Issues: two of three cards lead to stubs; copy "Connect WorkwrK to the tools your team already uses" is not true yet; duplicates `/integrations` (marketplace page in the normal shell) which links back to `/settings` and `/settings/calendar` (circular hub-of-hubs).
- State: **stub** (a menu page for stubs).

### 1.18 `/settings/import-export` (Import / Export)
- File: `settings/import-export/page.tsx`. Server component, static. No gate.
- Purpose: 2 link cards: Import data (`/imports`), Audit log export (`/settings/audit`).
- Reach: Admin nav "Import / Export". Not on Overview.
- Back: shell header only.
- Top bar: shell header. h1 20px "Import / Export".
- Issues: redundant with `/settings/data` (which has the real exports and the same `/imports` link); "Export" section points to the audit page rather than the export hub; the two pages should be one.
- State: **stub** (navigation-only, duplicate).

### 1.19 `/settings/billing` (Plan & billing)
- File: `settings/billing/page.tsx`. No layout gate.
- Purpose: read-only plan + status + 3 usage bars against `PLAN_LIMITS`; "Manage billing" opens Stripe portal (POST `/api/billing/portal`; returns 503 "Stripe not configured" when env missing).
- Reach: Admin nav "Plan & billing"; workspace menu "Upgrade". Overview "Plan & billing" card self-links to `/settings` instead of here; rail "Upgrade" goes to `/settings`.
- Back: shell header only.
- Top bar: shell header. h1 20px "Plan & billing".
- Controls: "Manage billing" (admins) or read-only note.
- Issues: uses `useToast` from `components/ui/toast` (`toast.error("Billing", …)`) while every sibling uses `useOsToast` (two toast systems); no plan comparison / upgrade path in-app (the "Upgrade" entry points land on a page with no upgrade action unless Stripe is configured); usage bar for AI queries counts `aiQueries` rows all-time, not "this billing period" as the Overview card claims; on fetch failure `data` stays `null` so it shows "Loading billing…" forever.
- Loading: `Loader2` (also the permanent error state).
- State: **rough**.

### 1.20 `/settings/scoring` (Scoring & reviews)
- File: `settings/scoring/page.tsx`. No layout gate, no client `canEdit` (any user can edit fields and hit Save; API returns 403 for non-admin/C-level).
- Purpose: 4 editable sections persisted per-section via PATCH `section:"scoring"`: Review cadences (weekly/monthly/quarterly/annual: Switch, anchor number, reminder lead days, auto-open checkbox), Score weights (4 sliders + number inputs, must sum to 100), Performance bands (colour picker, label, min, max), Behavioral anchors (5 labels).
- Reach: Admin nav "Scoring & reviews"; three Overview cards.
- Back: shell header, PLUS an in-page "< Back to settings" link (page.tsx:95-97) - a third back pattern.
- Top bar: shell header + `OsTitleBar` "Scoring & reviews" (`starred={false}`, `showInvite={false}`, but dead Ask AI / Share still render).
- Controls: as above; each section has its own Save / "Reset to defaults" / banner.
- Issues: the primary Save button is **black** (`bg-zinc-900`, :163) unlike the brand-blue Save on every other settings page; bands cannot be added/removed (fixed 5 rows) and the API default band colours are words ("green","lime") that the `<input type=color>` cannot display (:358 falls back to grey); "Reset to defaults" marks dirty but does not save (fine) yet gives no confirmation; no read-only mode for non-admins (they can edit, then get "Insufficient permissions"); unsaved edits in one section are lost silently on navigation; section icon tints use `C.pink / C.purple / C.indigo` names (now aliased to brand vars in catalog.ts:53-56 but the naming survives the banned-hue sweep); loading state renders a bare "Loading…" string; the legacy `reviewFrequency` field shown on Overview is not editable here.
- State: **rough**.

### 1.21 `/settings/notifications` (Notifications, personal)
- File: `settings/notifications/page.tsx`. No gate (per-user).
- Purpose: the single per-user notification preferences page (Personal door) reconciling two stores: `UserPreference.home.notifications` (`/api/preferences`) and `EmailPreference` (`/api/email-preferences`).
- Reach: Personal nav "Notifications"; redirect from `/account/notifications`. NOT reachable from the bell popover, Inbox, or the profile menu (whose "Notifications" row goes to `/inbox`).
- Back: shell header only.
- Top bar: shell header. h1 16px bold "Notifications".
- Controls: Inbox section (6 switches, all live); Email > Task & activity (master switch + 6 rows, only "Task assigned" and "Kudos" live; Mentions/Comments/Status/Due show a "Soon" pill); Email > Workflow & HR (KRA, Review, SOP live; Daily digest "Soon"). Kudos email switch writes both stores in lockstep. Save-on-change with optimistic revert.
- Issues: lives under `/settings/*` while its siblings live under `/account/*` (URL inconsistency); 4 of 10 email rows are "Soon"; no push / desktop / mobile channel; no quiet hours; no per-Space/Board mute; "Changes save automatically" but no per-row saved indicator; org-level notification defaults (`settings.notifications` in `/api/settings`) have no UI.
- Loading: `Loader2`.
- State: **polished** (honest-Soon) but incomplete.

### 1.22 `/account/profile` (Profile)
- File: `account/profile/page.tsx`. Per-user.
- Purpose: own avatar (POST/DELETE `/api/users/[id]/avatar`), first/last name (PATCH `/api/users/[id]`), read-only email + access level / role / department chips.
- Reach: Personal nav "Profile"; people profile (self) "Edit personal info"; Structure page text link.
- Back: shell header only.
- Top bar: shell header. h1 20px "Profile".
- Controls: Change photo / Remove; First name; Last name; Email (read-only, "managed by your administrator"); chips; "Save changes" (**black** `bg-zinc-900`, :310).
- Issues: only 2 editable fields though the API accepts `phone`, `dateOfBirth`; no timezone / locale / language per user; no link to the richer `/people/me` career profile; on `/api/me` failure `me` becomes `{}` and the page renders an empty form with a Save button disabled but no error message; email change flow absent; the inputs are wrapped in bordered divs (a workaround for the `.workwrk-os input` reset, :11-13) while Identity uses bare bordered inputs (two input patterns).
- Loading: `Loader2`.
- State: **rough**.

### 1.23 `/account/appearance` (Appearance)
- File: `account/appearance/page.tsx`. Per-user.
- Purpose: theme (Light/Dark/Auto), accent (10 swatches), density (Compact/Cozy) via PATCH `/api/preferences`, then `router.refresh()`.
- Reach: Personal nav "Appearance"; Defaults page text link. Profile menu "Themes" goes to `/settings?tab=themes` (wrong).
- Back: shell header only.
- Top bar: shell header. h1 20px "Appearance".
- Controls: 3 theme cards, 10 accent buttons, density segmented control. Save-on-change with toast.
- Issues: accent list includes `purple`, `pink`, `violet`, `indigo` (banned hues per the design system; the org Defaults page deliberately excludes them) and lacks the `workwrk` brand-blue key that is the org default, so a user cannot pick the brand accent here; default accent fallback `mint` vs org default `workwrk`; no indication when a control is org-locked (Defaults & locks) - the switch still appears live and the change silently reverts on next load; no font-size / reduced-motion / sidebar-icons-only options (those live in the Customize panel, which is unmounted in settings mode); active ring is `ring-zinc-900` (black) not brand.
- Loading: `Loader2`.
- State: **rough**.

### 1.24 `/account/security` (Security)
- Files: `account/security/page.tsx`, `change-password-modal.tsx`, `mfa-modal.tsx`. Per-user.
- Purpose: personal security posture + read-only org policy + sessions + recent security activity.
- Reach: Personal nav "Security"; Overview "Password policy" and "Session & 2FA" cards; Settings-hub sidebar "Account · Security" (visible only on /build,/store,/tools,/assets,/trash).
- Back: shell header; OsTitleBar action link "Settings" -> `/settings`.
- Top bar: shell header + `OsTitleBar` "Account · Security" with amber star and dead Ask AI / Share / Invite buttons.
- Controls: Security score card (50 base +25 verified +25 MFA); "Your posture" rows: Email verified (Resend -> `/api/auth/request-verify`), Two-factor auth (Enable -> `MfaEnrollDialog` QR + code + backup codes; Turn off -> `MfaDisableDialog`), Password (Change -> `ChangePasswordDialog` -> POST `/api/me/change-password`), Access level (display); "Org policy" 5 read-only rows; "Sessions": "Sign out of all devices" (POST `/api/me/sign-out-everywhere`, then `signOut`); "Recent security activity" list from `/api/me/security-activity`.
- Issues: the Overview hub sends admins here to configure "Password policy" and "Session & 2FA" but the section is read-only for everyone; there is no admin UI for the `security` section the API supports; the org policy values (min length, uppercase, numbers, session timeout, org-wide MFA) are displayed but nothing enforces them at password-change or login time (not verified in this audit beyond the absence of a writer); the security score is a made-up heuristic; "Sessions" shows no device list, just a nuke button; `loadError` is dumped as raw text (`me 401`); the raw `accessLevel` enum (`EMPLOYEE`) is shown instead of the label; page title "Account · Security" differs from nav "Security".
- Loading: description "Loading…" + "Loading…" text in activity. Error: raw string.
- State: **polished** functionally (real MFA / password / sign-out-all), rough copy/chrome.

### 1.25 `/account/notifications`
- File: `account/notifications/page.tsx`: `redirect("/settings/notifications")`. Fine, but leaves `/account/*` as the only Personal-door prefix with a hole.
- State: n/a (redirect).

### 1.26 `/account` (bare)
- No `page.tsx`. Linked from `settings/structure/page.tsx:209` ("Personal door (/account)"). Renders the 404 inside settings mode.
- State: **broken** link target.

### 1.27 `/organization` (Org chart)
- Files: `organization/page.tsx` (server, `requireManagerPage()` -> employees redirected to `/people/me`), `organization/org-chart-client.tsx`.
- Purpose: reporting-hierarchy tree with stat tiles (People / Departments / Offices / Roles); collapsible nodes; "Not linked to a manager" sweep for cycles.
- Reach: Team hub sidebar "Org chart"; `/team` page card; People directory "Org chart" button; admin setup checklist (as a wrong target for "company profile" and "departments"); admin tour step 1 (wrong: describes a company-profile editor with "AI Assist" that no longer lives here).
- Back: in-page breadcrumb `Teams / Org chart` (link to `/team`). No BackButton. Normal shell (rail + Team sidebar + topbar) - NOT settings mode.
- Top bar: normal ClickTopbar. Header actions: "Directory" -> `/people`, "Org settings" -> `/settings`.
- Sidebar: Team hub (Overview, My Profile, Directory, Org chart, Roles, KRAs & KPIs, Alignment board, Performance...).
- Controls: expand/collapse; node click -> `/people/[id]`; "All people" link; shows only the first 8 top-level roots with "+N more" link.
- Issues: for non-org-wide managers the header says "Your reporting tree" (good) but the stat tiles still say "People N" as if org-wide; duplicates `/settings/hierarchy`; the `Offices` tile counts a model with no directory UI; the page is titled "Org chart" while the route is `/organization` and history (tour/checklist) still treats it as the company-profile page.
- Loading: "Loading hierarchy…" text. Error: bordered text.
- State: **polished**.

### 1.28 `/people/me`
- File: `people/me/page.tsx`: resolves session, `redirect('/people/{id}')`. The career profile (`/people/[id]` in self mode) has the "Edit personal info" -> `/account/profile` link.
- Reach: profile menu "My Profile"; Team hub sidebar "My Profile"; employee redirect target for manager-gated pages.
- State: n/a (redirect). Note: the Team sidebar marks it active only when `pathname === "/people/me"`, which is never true after the redirect, so "My Profile" never highlights.

### 1.29 `/me/weekly-review`
- Files: `me/weekly-review/page.tsx` (SSR, auto-creates DRAFT), `src/components/me/weekly-review-form.tsx`.
- Purpose: mandatory weekly heartbeat: KRA progress sliders, KPI snapshot inputs, Highlights / Blockers / Plan textareas, Save draft / Submit for review / Reopen.
- Reach: Today "My alignment" card; people profile (self) link. Normal shell.
- Back: in-page breadcrumb `Today > Weekly review` (link to `/today`). No BackButton.
- Top bar: normal topbar. h1 2xl (larger than every settings h1).
- Sidebar: whichever hub matched (`/me/*` is in no `matchPaths`, so the rail shows no active app and the sidebar falls back to Home/Work).
- State: **polished** (out of settings scope but part of `/me`).

### 1.30 `/me/mentions`
- File: `me/mentions/page.tsx`.
- Purpose: list of @-mentions of me across notes and SOPs, linking to the block anchor.
- Reach: **URL-only** - no `href` to `/me/mentions` exists in `src` (the Inbox has its own @Mentions tab instead).
- Back: none. `OsTitleBar` "Mentions" with amber star + dead Ask AI / Share / Invite. Error and empty states carry `cta="Retry"` / `cta="Open notes"` without handlers, so no CTA renders.
- State: **rough / orphaned** (duplicate of Inbox > Mentions).

### 1.31 Orphaned settings components (not routed)
- `src/components/settings/branding-manager.tsx`, `byok-manager.tsx`, `privacy-controls.tsx`, `sop-category-manager.tsx`: imported by nothing. Branding / BYOK (bring-your-own-AI-key) / privacy controls are real settings that have no page. `sop-folders-tags-manager.tsx` is used by `/sops/manage` only.
- `src/app/(dashboard)/settings/tags/tags-manager.tsx`: the correct Tags implementation, never rendered (see 1.6).

---

## 2. Broken / confusing (ranked)

| # | Sev | Where | What |
|---|---|---|---|
| 1 | high | `/settings/tags` (`settings/tags/page.tsx:30-59,63-89`) | Shows fabricated SAMPLE tags when the org has none or the API errors; reads `category/usageCount` that the API never returns (`api/tags/route.ts:51-63`); Create sends `category` (ignored, saved as CUSTOM) and falls back to a local fake row; Delete never calls the API. The wired `tags-manager.tsx` beside it is unused. |
| 2 | high | `/settings/task-types` + `/api/item-types*` | No server gate, no `canEdit`, no API role check: any employee can create/delete org task types and change the default. |
| 3 | high | `OsTitleBar` on audit, api, tags, task-types, calendar, security, mentions, data, scoring (`title-bar.tsx:86-116`) | Standard "Ask AI", "Share", "Invite" buttons have no `onClick` and render on settings pages by default; an amber "starred" icon appears beside settings titles. |
| 4 | high | `/settings` Overview (`settings/page.tsx:112,123`) | "Locale & finance" and "Plan & billing" cards link to `/settings` (themselves) although `/settings/locale` and `/settings/billing` exist. |
| 5 | high | `/settings` Overview "Password policy" / "Session & 2FA" (`settings/page.tsx:210,221`) -> `/account/security` | Sends admins to a read-only page; there is no UI that writes the `security` section the API supports (`api/settings/route.ts:227-238`). Policy values shown are unenforced defaults. |
| 6 | high | Admin door gating (`settings-shell.tsx:190` vs per-route layouts) | Nav hides the Admin door for non-admins but only 7 of 21 admin routes are server-gated; `/settings`, locale, modules, members, hierarchy, permissions, api, billing, scoring, calendar, integrations, import-export, task-types open by URL for any employee (Members/Hierarchy then silently show team-scoped data). |
| 7 | high | `/settings/scoring` (`scoring/page.tsx`) | No read-only mode for non-admins (edit, then 403); black primary button; band colours from API defaults are words the colour input cannot render; unsaved section edits lost on nav. |
| 8 | medium | `SettingsShell` Back / Close / Esc (`settings-shell.tsx:136-179`) | Always `/today`, never history. A user who came from a board's "Default task type" or the workspace menu cannot return to where they were. Contradicts the `BackButton{fallbackHref}` convention used on detail routes. |
| 9 | medium | `/settings/identity` layout vs page (`identity/layout.tsx:7` vs `identity/page.tsx:45`) | C_LEVEL may PATCH via API and is `canEdit` on the page but the layout redirects them to `/dashboard`. |
| 10 | medium | Profile menu (`profile-menu.tsx:203-205`) | "Themes" -> `/settings?tab=themes` and "Keyboard shortcuts" -> `/settings?tab=shortcuts` both land on Overview (no tab handling, no shortcuts page); "Notifications" -> `/inbox` not the prefs page. |
| 11 | medium | Rail "Upgrade" (`click-app-rail.tsx:193`) and Overview | "Upgrade" lands on `/settings` Overview; `/settings/billing` has no upgrade action unless Stripe is configured (503 "Stripe not configured"). |
| 12 | medium | `/settings/calendar`, `/settings/integrations`, `/settings/import-export` | Three nav rows that are stubs / link-only pages; Overview + Integrations copy overpromises ("Subscribe external calendars", "Connect Google, Outlook…"). Import/Export duplicates Data & compliance. |
| 13 | medium | Accent vocab drift (`account/appearance/page.tsx:22-33` vs `settings/defaults/page.tsx:40-48`) | Personal list has banned hues (purple/pink/violet/indigo) and no `workwrk` key; org list has `workwrk` and drops those. Org default cannot be chosen personally; locked controls are not greyed on Appearance. |
| 14 | medium | `/settings/hierarchy` vs `/organization` | Two org-chart pages; the settings one has no cycle handling, no role/department, and is team-scoped for managers without saying so. |
| 15 | medium | `/settings/locale` (`locale/page.tsx:17-29,49-57`) | 9 timezones / 8 currencies; a saved value outside the list shows wrong; `fiscalYearStart` written as "MM-01" while the API/Overview treat it as a month number; "Default language" is stored but unused (no i18n). |
| 16 | medium | `/settings/members` | For managers `scope=all` is coerced to team (`api/users/route.ts:51-56`) yet the page presents org-wide counts and labels; table overflows horizontally; no link to person profiles; "Reports to" select has 500 options without search. |
| 17 | medium | Onboarding surfaces (`admin-setup-checklist.tsx:65,72,100`, `tour-content.tsx:22-40`) | Point to `/organization` for company profile/departments and to `/settings` for "Team" / "Access Control"; labels no longer exist. |
| 18 | medium | `/settings/structure:209` | Links to bare `/account` which has no page (404 inside settings mode). |
| 19 | medium | Loaders | Settings pages mostly use `Loader2` spinner + "Loading…" text (identity, locale, modules, apps, members, permissions, hierarchy, billing, defaults, notifications, appearance, profile, task-types) or a bare string (scoring, security), while the product convention since 2026-09-08 is `ValueLoader` (used only on overview, audit, api, tags, mentions). |
| 20 | medium | Error states without recovery | Overview and Mentions pass `cta="Retry"` to `OsEmptyView` without `onCta`, so no Retry renders; Identity/Locale/Apps/Defaults silently substitute defaults on fetch failure (Identity's blank form would overwrite live values on Save); Billing shows "Loading…" forever on failure. |
| 21 | medium | `/settings/audit` rows (`audit/page.tsx:335-358`) | Each row has a chevron but is not clickable; no detail view even though `oldValue/newValue` are returned; search is client-side over the loaded page only. |
| 22 | low | Header size inconsistency | h1 is 16px bold (Overview, Members, Notifications), 20px semibold (Identity, Locale, Modules, Permissions, Hierarchy, Billing, Profile, Appearance, Integrations, Import/Export), 19px + hex icon (Apps, Defaults, Structure), OsTitleBar 16px (Audit, API, Tags, Task types, Calendar, Data, Scoring, Security). |
| 23 | low | Primary button colour | Brand blue on most pages; black (`bg-zinc-900`) on Scoring and Profile; checkbox accent black on Permissions; API keys and MFA dialogs use hex `#0073EA` / `#0060B9` instead of `--os-brand`. |
| 24 | low | Three back/breadcrumb patterns inside one shell | Shell breadcrumb (non-clickable) + in-page `Settings > X` breadcrumb (Apps, Defaults, Structure) + OsTitleBar "Settings" nav-link chips (Audit, API, Tags, Task types, Calendar, Security) + "< Back to settings" (Scoring). |
| 25 | low | Label drift nav vs page title | Enabled modules / Modules; Reporting hierarchy / Hierarchy; Calendar feeds / Calendar integrations; Security / Account · Security; Roles & permissions / Roles & Permissions; Task types / Task Types; Identity & profile / Identity & company profile. |
| 26 | low | Two toast systems | `useOsToast` everywhere except Billing (`ui/toast` `toast.error`) and the orphaned tags-manager. |
| 27 | low | Task-types Create modal | Hand-rolled `fixed inset-0` overlay instead of shared `ui/dialog`; hover-only action buttons on type cards. |
| 28 | low | `/me/mentions` | Orphan route duplicating Inbox > Mentions; dead-CTA empty states. |
| 29 | low | Team sidebar "My Profile" | `active` compares to `/people/me`, which redirects to `/people/[id]`, so it never highlights. |
| 30 | low | Settings hub sidebar in normal shell (`apps-catalog.tsx:1135-1157`) | Exists but is only visible on /build, /store, /tools, /assets, /trash; the "Settings" rail app's own sidebar is effectively dead for settings routes. |
| 31 | low | Overview scoring cards (`settings/page.tsx:186-202`) | Show legacy `reviewFrequency` and the first 3 keys of a default `scoreWeights` object whose keys (`manager`, `self`) the scoring page does not edit. |
| 32 | low | Permissions matrix modules | Includes Assets / Tools & Credentials / Surveys / Ideas / Announcements / Policies which are outside the PPMS scope. |

---

## 3. Cross-cutting conventions

### Back navigation
- Inside settings mode the ONLY chrome back is the SettingsShell header `Back` (a `<Link href="/today">`) and the `X` (same target); `Esc` pushes `/today`. Nothing uses the `BackButton{fallbackHref}` primitive (`src/components/ui/back-button.tsx`) that the rest of the app standardised on (history-aware, falls back to parent). Result: entering settings from a board, the workspace menu or the create-task modal cannot return to that context.
- Several pages add their own return affordance (Apps/Defaults/Structure breadcrumb to `/settings`; Audit/API/Tags/Task types/Calendar/Security `OsTitleBar` "Settings" chip; Scoring "< Back to settings"), so there are four patterns on one screen family.
- The shell breadcrumb "{Org} > Settings" is not clickable and never shows the current page.
- `/organization` and `/me/weekly-review` use in-page text breadcrumbs (`Teams / Org chart`, `Today > Weekly review`), not `BackButton`.

### Loader
- Product convention (memory, commit 2026-09-08): `ValueLoader` (brand dots + rotating company value). In this subsystem: `ValueLoader` on Overview, Audit, API keys, Tags, Mentions; `Loader2` spinner + "Loading…" on 13 pages; bare text on Scoring, Security activity, Org chart. Route transitions get `(dashboard)/loading.tsx` (`ValueLoader`), which renders inside the SettingsShell `main` because the shell is in the layout.

### Empty / error states
- `OsEmptyView` (icon tile + title + subtitle + chips + optional CTA) on Overview error, Audit, API keys, Tags, Mentions. CTA only renders with a handler (Overview/Mentions/Tags pass none, so no Retry).
- Inline grey text ("No people yet.", "Nothing to add", "No recent activity yet.") elsewhere. Members error = red banner; Security error = raw string; Billing failure = permanent loader; Identity/Locale/Apps/Defaults/Notifications swap in defaults (Apps/Defaults/Notifications toast, Identity/Locale silent).
- No page has an unsaved-changes guard; Permissions and Scoring lose dirty edits silently.

### Style consistency
- Two visual systems coexist under one shell:
  1. Tailwind "zinc + `--os-brand`" form pages (Identity, Locale, Modules, Members, Permissions, Hierarchy, Billing, Notifications, Profile, Appearance, Integrations, Import/Export) - flat, white cards, `rounded-xl border-zinc-200`, brand-blue buttons. Closest to the Monday-clean target.
  2. Legacy BEM `os.css` pages (`.adt`, `.apk`, `.tgm`, `.cli`, `.acs`, `.mention-inbox`, root rule os.css:12667) with `OsTitleBar` + 4-tile KPI strips + nav-link chips: Audit, API keys, Tags, Calendar, Security, Mentions. Data & compliance and Scoring use `OsTitleBar` but Tailwind bodies (hybrid).
  3. A third sub-style on Apps / Defaults / Structure: 19px h1, `#0073EA` hex icons, inline `style` borders/shadows, in-page breadcrumbs.
- Tokens: `--os-brand` used on most buttons; hex `#0073EA`/`#0060B9`/`#E2445C` in Apps, Defaults, Structure, API dialogs, MFA/password dialogs (the portal dialogs justify it: they render outside `.workwrk-os`). Black primaries on Scoring + Profile; `C.pink/purple/indigo` names on Scoring icons (aliased to brand vars by catalog.ts:53-56).
- Type scale: h1 16 / 19 / 20 / 2xl across the family; body 13-14.5px mixed.
- Dark mode: SettingsShell hard-codes `bg-white text-zinc-900 border-zinc-200`; it survives only through the `:root.dark .workwrk-os .bg-white:not(button)` catch-alls (os.css:31756-31763). Defaults page inline `background:#fff` / `#f4f4f5` and Apps `select` inline `background:#fff` bypass those catch-alls.
- Inputs: `.workwrk-os input` reset strips borders (os.css:152-155, `@layer base`); Profile wraps inputs in bordered divs, Identity/Locale/Members put the border on the input via utilities (works because utilities beat the layered reset). Two patterns for the same control.
- Two toast systems (`useOsToast` vs `ui/toast`), two dialog systems (Radix `ui/dialog` vs hand-rolled overlay in Task types), two confirm/prompt helpers used consistently (`useConfirm`/`usePrompt`).

### Mobile / responsive
- `SettingsShell` has no breakpoint: fixed 248px nav + content side by side at every width; no hamburger, no collapse (settings-shell.tsx:185). The header is 48px with text "Back".
- No `@media` rules exist for any settings BEM block (`.apk/.adt/.tgm/.cli/.acs/.settings/.setcard`); the 4-tile KPI grids stay 4-up. `.settings__grid` is `auto-fill minmax(280px)` so the Overview cards reflow.
- Members table and Permissions matrix are wide; Permissions has `overflow-x-auto`, Members does not (body would scroll horizontally).
- Task-types and Structure grids use `sm:grid-cols-2`; Defaults/Appearance use fixed `grid-cols-3`.
- Touch: hover-only actions on Task types cards; drag-reorder on Apps (has up/down fallback).

### Access model observed
- Ladder: SUPER_ADMIN, COMPANY_ADMIN, C_LEVEL, VP, DIRECTOR, HR, MANAGER, TEAM_LEAD, EMPLOYEE, AGENT (`src/lib/permissions.ts:21-30`). Tiers: manager / hr-admin / org-admin (`src/components/layout/os/access-tiers.ts`).
- Admin door (nav) = org-admin. Server gates = org-admin on identity/apps/audit/data/defaults/tags/structure only. API writers: `/api/settings` PATCH = org-admin + C_LEVEL; `/api/org/preferences` PATCH, `/api/keys`, `/api/products/installations`, `/api/permissions` PATCH, `/api/tags` dimensional types, `/api/tags/[id]` = org-admin; `/api/users/[id]` accessLevel = org-admin, managerId etc. = manager in reporting line; `/api/item-types*` = any member; `/api/invitations` GET = any member.
- `/organization` = manager tier (employees bounced to `/people/me`). `/settings` Overview and the Personal door = any member.

---

## 4. Settings notes: what is configurable vs what should be

Configurable today (wired): org name/domain/logo/company profile + values; timezone/currency/fiscal/language (org); premium modules; rail app order/visibility/floor; task types; members' access level + manager; invites; permission matrix; audit export; data exports; org theme/accent/density defaults + 4 locks; API keys; Stripe portal hand-off; review cadences / score weights / bands / anchors; personal inbox + email notification switches; personal name/avatar; personal theme/accent/density; MFA, password, sign-out-all.

Exists in the data plane or code but has NO UI: org security policy (`settings.security`: min length, uppercase, numbers, session timeout, org-wide 2FA); org notification defaults (`settings.notifications`); `businessType` / `teamSize` (read on Overview, never written); Offices directory (model + API, "Coming soon" tile); branding manager, BYOK AI keys, privacy controls (orphan components); tag rename/archive/colour (orphan tags-manager); API key rate limits / scope edits; SSO/SAML/SCIM (identity layout comment mentions it, page has nothing); user phone / DOB / personal timezone (API accepts, Profile omits); email change; session/device list; org-level default task type per Space; retention windows (Data page subtitle promises "manage retention").

Should exist for a Monday/ClickUp/Workday-class Settings but does not: workspace-level Spaces/Boards defaults, custom fields manager, statuses manager, SSO, domain-capture / auto-join rules (domain is stored, nothing uses it beyond a hint), user deprovisioning flow from Members (remove is only on the person profile), roles (job titles) management inside Settings (lives at `/people/roles`), departments inside Settings (lives at `/people/departments`), per-user timezone / week start / date format, keyboard-shortcut reference (profile menu links to one that doesn't exist), an actual plan/upgrade page, a real Integrations catalog, calendar sync, webhooks UI (API keys page mentions webhooks), an "Account > Danger zone" (delete account / leave org; `/api/me/delete` and `/api/organizations/delete` exist with no UI).
