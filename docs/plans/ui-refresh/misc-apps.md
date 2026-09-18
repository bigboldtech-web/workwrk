# UI/UX audit: "Remaining apps" subsystem

Scope: /kudos, /candor, /surveys, /ideas, /imports, /integrations, /store, /build, /trash, /tools, /assets, /analytics, /dashboard, /marketing (in-app), /me/*, /meetings, plus adjacent routes found under `src/app/(dashboard)` that belong to the same features (/docs/trash, /people/me, /settings/integrations). Read-only audit, 2026-09-10. All paths are relative to `/Users/bigboldtechnologies/theywrk/`.

---

## 0. How navigation works for these routes (context for every entry below)

The shell is `src/components/layout/os/os-shell.tsx`: topbar (`click-topbar.tsx`) + 60px app rail (`click-app-rail.tsx`) + secondary sidebar (`click-sidebar.tsx`) + main. `/settings/*` and `/account/*` render in a full-screen "settings mode" with their own `SettingsShell` (os-shell.tsx:79).

Rail hubs are defined in `src/components/layout/os/apps-catalog.tsx:1170-1342`. The 8 real rail icons are `home` (label "Work"), `planner`, `ai`, `chat` ("Talk", premium), `teams` (manager+), `docs`, `tables` (premium), `settings`. Everything else is `offRail` and folded into a hub (apps-catalog.tsx:1350-1359):

| In-scope app key | Folded into | Sidebar row that links to it | Sidebar gate |
|---|---|---|---|
| candor, kudos, surveys | Teams | TeamsSidebar "Culture" section (apps-catalog.tsx:1037-1046) | `hr-admin` tier only |
| tools, assets, build, store, trash | Settings | SettingsSidebar "Operations" section (apps-catalog.tsx:1147-1154) | build/store: everyone; tools/assets/trash: `hr-admin` |

Rail highlight is driven by `matchPaths` (apps-catalog.tsx:1380-1388). Teams matches `/candor`, `/kudos`, `/surveys`; Settings matches `/tools`, `/assets`, `/build`, `/store`, `/trash`. **No hub matches** `/ideas`, `/imports`, `/integrations`, `/analytics`, `/marketing`, `/meetings`, `/me/*`, `/docs/trash` (Docs matches `/docs` prefix so `/docs/trash` does highlight Docs). On an unmatched route the sidebar keeps whatever app was last active or falls back to Home (click-sidebar.tsx:84-90), so the user sees a sidebar unrelated to the page.

Other discovery surfaces checked:
- Command palette (`command-palette.tsx:131-152`): only `/store` ("Marketplace") and `/integrations` ("Connect apps") from this scope; `/dashboard` appears as "Open My Activity" (which then redirects to /today).
- `g`-then-letter shortcuts (`src/hooks/use-goto-nav.ts:16-31`): `g d` → /dashboard, `g m` → /meetings, `g a` → /analytics.
- Profile menu (`profile-menu.tsx:201-253`): "My Profile" → /people/me, "Trash" → /trash (shown to every access level).
- Home "+" global CreateMenu footer (`create-menu.tsx:398`): "Import" → /imports.
- Apps launcher (`apps-more-popover.tsx`) lists `railApps` grouped by category; folded apps still appear there because `railApps` is the access-filtered catalog (the launcher shows offRail apps the rail does not).

Topbar culture popovers (`kudos-popover.tsx`, `candor-popover.tsx`, `surveys-popover.tsx`), `KudosFab` and `KudosModal` are **not mounted anywhere** (grep for `OsKudosPopover|OsCandorPopover|OsSurveysPopover|KudosFab|KudosModal` returns only their own files). `topbar-popover-button.tsx` is likewise unused. See §2.

---

## 1. Route inventory

Field key: **Reach** = how a user gets there; **Back** = back-button presence/target; **Topbar** = page-header elements (all pages also get the global shell topbar: workspace switcher, calendar peek, ⌘K search, Ask AI pill, pinned tools, notifications, reminders, inbox, avatar); **Sidebar** = secondary column when active; **Controls** = every option/control; **State** = polished / rough / broken / stub.

### 1.1 `/kudos` — Kudos feed
File: `src/app/(dashboard)/kudos/page.tsx`
- **Purpose**: org-wide peer-recognition feed with KPI strip, search, company-value filter chips, Recent/Earlier sections.
- **Reach**: Teams hub → sidebar "Culture › Kudos" (hr-admin only, apps-catalog.tsx:1042); launcher card "Kudos" (hr-admin); unmounted popover links; dead dashboard-content link. Everyone else: URL only.
- **Back**: none (list page). No `BackButton`.
- **Topbar**: `OsTitleBar` title "Kudos", starred, description "N kudos · N this week · N reactions", actions: `People` link (→ /people), primary "Send kudos"; plus the default `Ask AI` / `Share` / `Invite` trio.
- **Sidebar**: TeamsSidebar (manager tier) or, for an employee who lands via URL, TeamsSidebar collapsed to just "My Profile" (apps-catalog.tsx:1000-1006).
- **Controls**: search input; "Clear" button; value chips ("All values" + one per value seen in data); KPI tiles (Kudos given / This week / Reactions / Top receiver, display only); kudos cards show reaction counts (display only, `kud__card-reaction` spans, no click handler) and a `ChevronRight` arrow with no link.
- **State**: **broken** as a feature (see issues), page chrome itself is polished.
- **Issues**:
  1. **No way to give kudos anywhere in the mounted app.** "Send kudos" button only toasts `"Send kudos from any person's profile page"` (kudos/page.tsx:144); the profile page (`people/[id]/profile-client.tsx:1348-1362`) has a Kudos *tab* that lists received kudos but no give control (grep for give/send kudos in profile-client: none). The three composers that POST `/api/kudos` (`kudos-popover.tsx:70`, `kudos-modal.tsx:116`) and `KudosFab` are not imported anywhere. Latest commit `6187227a` edited `kudos-modal.tsx` values but the modal is unreachable.
  2. Empty-state CTA "Send kudos" has no `onCta`/`ctaHref` so `OsEmptyView` hides it (empty-view.tsx:40); empty state has no action.
  3. Error-state "Retry" CTA also has no handler → hidden; user sees the error with nothing to click.
  4. Reaction chips on cards are read-only here while `KudosReactions` (interactive) exists and is used on the profile tab, so the same kudos is reactable on one surface and not the other.
  5. Card `ChevronRight` arrow implies drill-in; nothing happens on click (no per-kudos route exists).
  6. Ask AI / Share / Invite in the title bar are dead buttons (title-bar.tsx:89-111, no onClick). Applies to every page using default `OsTitleBar` props; listed once here, flagged "[dead trio]" below.
  7. Hard-coded `VALUE_HUE` map (Customer First/Ownership/…) predates org-configurable values; org values from `useCultureValues` get hashed colors while the six legacy names get fixed ones (kudos/page.tsx:54-66).
  8. Stats are computed client-side over the first 50 rows (`?limit=50`), so "Kudos given all time" and "Top receiver" are wrong once an org exceeds 50 kudos.

### 1.2 `/candor` — Candor sessions list
File: `src/app/(dashboard)/candor/page.tsx`
- **Purpose**: anonymous-feedback sessions grouped by status (Active/Draft/Closed) with KPI strip, privacy banner, search, status filter.
- **Reach**: Teams → "Culture › Candor" (hr-admin sidebar); `/surveys` title-bar link "Candor"; launcher (hr-admin). Employees: URL only (the popover that would surface active sessions is unmounted).
- **Back**: none.
- **Topbar**: `OsTitleBar` "Candor" + description + actions `People` link, primary "New Candor" (quickAdd creates "Untitled Candor" draft and routes to `/candor/[id]`); [dead trio].
- **Sidebar**: TeamsSidebar.
- **Controls**: search; status filter chips (All/Active/Draft/Closed with counts); per-card `Launch` (owner + DRAFT), `Close` (owner + ACTIVE), `View` link; KPI tiles (display).
- **State**: polished.
- **Issues**:
  1. Empty-state CTA "New Candor" has no `onCta` → hidden; the only create path is the header button.
  2. Error "Retry" hidden (no handler).
  3. Sidebar gate is `hr-admin` (apps-catalog.tsx:1037) but the API lets any `isManager` create sessions (api/candor/route.ts:65) and the page's `quickAdd` handles 403 with "Manager access required". A plain manager can create Candor via URL but has no nav to it.
  4. Employees who *can* respond (API returns ACTIVE org/department sessions to them, api/candor/route.ts:28-37) have no in-app entry point at all; the list page they land on is a manager-styled dashboard ("Drafts", "Closed", "New Candor") that doesn't fit a respondent.
  5. [dead trio].

### 1.3 `/candor/[id]` — Candor session detail
File: `src/app/(dashboard)/candor/[id]/page.tsx`
- **Purpose**: three faces on one route: owner+DRAFT editor; owner+ACTIVE/CLOSED results; respondent+ACTIVE anonymous form.
- **Reach**: `/candor` card "View"; after quickAdd; unmounted candor popover.
- **Back**: yes, custom `<Link href="/candor">← All sessions</Link>` in title-bar actions (line 136) plus "Back to Candor" in every blank/thanks state. Not the shared `BackButton`/`fallbackHref` convention.
- **Topbar**: `OsTitleBar` title = session title, description = status label, `showStandardActions={false}` (no dead trio here).
- **Sidebar**: TeamsSidebar.
- **Controls (editor)**: Title, Description, "Who can respond" select (Everyone / department list from `/api/departments`), prompts list (text input, type select Open text / Rating 1-5 / Start-Stop-Continue, move up/down, remove, "Add prompt"), "Save draft", "Launch session".
- **Controls (results)**: status chip, scope chip, launched/closed dates, "Close session" (ACTIVE), per-prompt aggregated answers / rating distribution.
- **Controls (respond)**: per-prompt textarea / 1-5 chips / SSC three textareas; "Submit anonymously".
- **State**: polished.
- **Issues**:
  1. Detail loads by fetching the whole `/api/candor` list and `.find(id)` (line 111-115); no GET-by-id, so a closed department session the user can't see reads as "not available" with no distinction from a bad id.
  2. "Already responded" guard is `localStorage` only (line 198-201); switching browser lets a user respond twice, and clearing storage resets it. Documented as intentional for anonymity but the copy "You've already responded" is unreliable.
  3. Editor has no delete/discard for a draft session anywhere (list or detail); an accidental "New Candor" leaves an "Untitled Candor" draft forever.
  4. Owner can't reopen a closed session; no edit after launch.

### 1.4 `/surveys` — Pulse surveys list
File: `src/app/(dashboard)/surveys/page.tsx`, builder `surveys/_components/survey-builder.tsx`
- **Purpose**: pulse surveys grouped by status, KPI strip, search, status filter, create dialog.
- **Reach**: Teams → "Culture › Surveys" (hr-admin sidebar); launcher; survey notifications link to `/surveys` (api/pulse-surveys/route.ts:202,208); unmounted surveys popover + dead dashboard widgets link here.
- **Back**: none.
- **Topbar**: `OsTitleBar` "Surveys" + description (includes avg rate) + actions: `Candor` link, `People` link, primary "New pulse" (opens `SurveyBuilder`); [dead trio].
- **Sidebar**: TeamsSidebar.
- **Controls**: search; status chips; KPI tiles; per-card `Launch` (DRAFT), `Close` (ACTIVE), `View`; participation bar. Builder dialog: Title; questions (text, type chips Rating/NPS/Yes-No/Single/Multi/Free text, options editor with min 2, add/remove question, drag-handle icon); Audience chips (Everyone / By office / By department / By tag + a disabled "Specific people · Coming soon" pill); Anonymous switch; Repeat select (One-off/Weekly/Biweekly/Monthly/Quarterly); Close date; Cancel / "Publish survey".
- **State**: polished (builder is the best-built dialog in scope).
- **Issues**:
  1. **Launch/Close buttons render for every viewer** (SurveyCard, lines 260-269) with no owner/manager check, unlike Candor's `isOwner` gating. An employee sees "Launch"/"Close" and gets a toast "Couldn't launch" (API 403). Cosmetic control.
  2. Builder says "Publishing sends this to the audience right away" and creates ACTIVE, yet the list still has a DRAFT status/filter/KPI and a "Launch" action; DRAFT can only arise from elsewhere (cron rotation). Confusing dual model.
  3. Drag handle (`GripVertical`) in the builder is decorative; no reorder implemented.
  4. Error "Retry" CTA hidden (no handler). Empty-state CTA works (`onCta` provided).
  5. Employees reach here from the notification but see a manager dashboard (KPI strip, Drafts, avg rate). The card "View" is the only relevant action.
  6. "Specific people" audience is a disabled pill inside an otherwise active chip row: honest but reads as a broken control.
  7. [dead trio].

### 1.5 `/surveys/[id]` — Survey respond + results
File: `src/app/(dashboard)/surveys/[id]/page.tsx`
- **Purpose**: respond (audience) / results (manager) with tab switch when both apply; edit via builder.
- **Reach**: `/surveys` card "View"; unmounted popover rows.
- **Back**: yes, custom `<Link href="/surveys">← All surveys</Link>` (line 177). Not `BackButton`.
- **Topbar**: custom header (not `OsTitleBar`): title, status pill, Anonymous/Attributed pill, question count, closes date, "Edit" (managers), Respond/Results tabs.
- **Sidebar**: TeamsSidebar.
- **Controls**: question fields (star scale 1-5, NPS 0-10, Yes/No chips, radio rows, checkbox rows, textarea); "Submit response"/"Update response"; results: stat tiles (Responses, Participation, NPS), "Export CSV" (`<a href=/api/pulse-surveys/[id]/responses/export>`, disabled look when 0), per-question bars / text responses; Edit → `SurveyBuilder` in edit mode.
- **State**: polished.
- **Issues**:
  1. Loading state is a bare `Loader2` spinner + "Loading survey…" (line 142), not the `ValueLoader` used by the list page: two loader conventions inside one feature.
  2. Header is hand-rolled Tailwind with `--os-*` tokens while the list page uses `OsTitleBar` + BEM `.srv__*` classes; the two pages don't look like siblings.
  3. Non-manager viewer with `hasResponded` on a CLOSED survey sees "Your answers" read-only, fine; but a manager in-audience who already responded lands on Results and must click "Respond" to see their own answers (line 129-132), no hint.
  4. Export link is an `<a>` that is visually disabled via `pointer-events-none`; still focusable via tab? `tabIndex=-1` is applied, OK.

### 1.6 `/ideas` — Ideas board
File: `src/app/(dashboard)/ideas/page.tsx`
- **Purpose**: Product-Hunt-style upvote + 4-column status kanban (Submitted → Under review → Approved → Implemented) with Rewarded/Rejected archive strip and inline composer.
- **Reach**: **URL only (orphaned).** Not in any rail hub `matchPaths`, no sidebar row, no command-palette entry, no create-menu row, no launcher card (catalog.ts:488 is a demo `stubModule` used by the Store grid, whose cards have no link). Only mention is copy in `first-run-welcome.tsx:41` ("Announcements, kudos, ideas.").
- **Back**: none.
- **Topbar**: `OsTitleBar` "Ideas", description, **fake people avatars** `PEOPLE.bb/sc/mk` + "+9" (catalog.ts:79-88 static fixtures), actions: sort toggle Top/New, primary "Share an idea"; [dead trio].
- **Sidebar**: whatever hub was last active (no match) — usually Home.
- **Controls**: composer (title, description, Submit, close); Top/New sort; per-card upvote toggle; drag-and-drop between columns (`draggable`, `onDrop` → PATCH status); archive strip lists titles only.
- **State**: rough.
- **Issues**:
  1. Orphaned route; nobody can find it. Either wire into Teams › Culture (with Kudos/Candor/Surveys) or remove.
  2. **Every user can drag cards** across status columns; API rejects non-managers with 403 (api/ideas/[id]/route.ts:70) → optimistic move then toast "Couldn't move idea" and reload. Cosmetic control for employees.
  3. Hard-coded fake avatar stack in the title bar (`people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]} morePeople={9}`) shows initials of people who don't exist in the org.
  4. Empty-state CTA "Share an idea" and error "Retry" both hidden (no handlers).
  5. Comments count is shown (`_count.comments`) but there is no way to open or add comments; no idea detail route.
  6. No way to reach REJECTED/REWARDED states from the board (only the 4 pipeline columns are drop targets) and archive items are plain text, not clickable.
  7. No category picker in the composer though the API accepts `category` and the empty state advertises "Product / Process / Culture / Cost-cutting" chips.
  8. Drag-and-drop has no keyboard/touch alternative.

### 1.7 `/imports` — Imports hub
File: `src/app/(dashboard)/imports/page.tsx` (server component, static)
- **Purpose**: landing for "Import"; two cards (CSV → Database → `/tables`, People CSV → `/people`) and "Coming soon" chips (ClickUp, Asana, Trello, Excel, Google Sheets).
- **Reach**: Home "+" CreateMenu footer "Import" (create-menu.tsx:398); Settings › Data governance card (settings/data/page.tsx:100); Settings › Import/Export card (settings/import-export/page.tsx:13).
- **Back**: none.
- **Topbar**: `OsTitleBar` "Imports" (passes `iconGradient=""`), description; [dead trio].
- **Sidebar**: unmatched → stale hub.
- **Controls**: two link cards, five decorative "coming soon" pills.
- **State**: **stub** (deep-links only; file comment admits TODO for inline import).
- **Issues**:
  1. Neither card lands on an importer: `/tables` and `/people` are list pages; the user must find the import button there. Copy even says "then use its Import button".
  2. Not matched by any hub; sidebar shows unrelated content.
  3. Two Settings surfaces (`/settings/data` and `/settings/import-export`) both point here; duplicated entry points with different copy.
  4. [dead trio].

### 1.8 `/integrations` — Integrations marketplace (preview)
Files: `integrations/page.tsx`, `integrations/layout.tsx` (`requireManagerOrRedirect`)
- **Purpose**: browsable catalog of 15 planned connectors, all "Coming soon".
- **Reach**: ⌘K "Connect apps" command and clicking a connectable source tab (Gmail etc.) in the palette (command-palette.tsx:151, 685); `/settings/calendar` link; `/settings/integrations` card.
- **Back**: none.
- **Topbar**: `OsTitleBar` "Integrations", description "15 connectors on the roadmap · none available yet · demand-driven"; actions: `Settings` link, `Calendar` link (→ /settings/calendar); [dead trio].
- **Sidebar**: unmatched → stale hub.
- **Controls**: KPI tiles (Catalog / Categories / Status=Preview), info banner, search, category chips, cards with a static "Coming soon" span.
- **State**: **stub** (honest, well-labelled).
- **Issues**:
  1. Employees are redirected to `/dashboard` (→ /today) by the layout with no message; the ⌘K "Connect apps" command is visible to employees and silently bounces.
  2. `/settings/integrations` card labelled "App marketplace: Slack, GitHub, Jira, Drive and more" links here while the *actual* marketplace is `/store`; and `/store` also lists 9 "integrations" with an active-looking Install button. Three overlapping integration surfaces.
  3. The inline info banner uses inline styles rather than a shared banner component.
  4. [dead trio].

### 1.9 `/settings/integrations` — Settings hub card page
File: `src/app/(dashboard)/settings/integrations/page.tsx` (server, static)
- **Purpose**: three link cards: Calendar feeds (/settings/calendar), App marketplace (/integrations), API keys (/settings/api).
- **Reach**: Settings shell sidebar (not audited here).
- **Back**: SettingsShell chrome.
- **State**: polished but thin.
- **Issues**: duplicates `/integrations`'s header links; "App marketplace" label points at the preview page, not `/store`.

### 1.10 `/store` — Marketplace
File: `src/app/(dashboard)/store/page.tsx`
- **Purpose**: app + integration marketplace grid with hero, category filters, Install/Installed buttons.
- **Reach**: Settings hub sidebar "Operations › Marketplace" (everyone); ⌘K "Marketplace"; `CatalogStubPage` back links.
- **Back**: none.
- **Topbar**: `OsTitleBar` "Marketplace", description "Apps, agents, and integrations. Install on-demand. Workspace-scoped.", fake people `PEOPLE.bb, PEOPLE.mk` +3; [dead trio].
- **Sidebar**: SettingsSidebar (Workspace settings, Account · Security, Operations list).
- **Controls**: 13 category filter buttons + "Integrations"; per-card "Install" / "Installed" buttons; tier badge (core/plus/suite/free).
- **State**: **stub / misleading** (looks live, is entirely static).
- **Issues**:
  1. `Install` and `Installed` buttons have **no onClick** (lines 224-233). Nothing installs. The real install path is Settings → Modules (`lib/modules.ts`, `/settings/modules`) which the store never mentions.
  2. Data source is `getAllModules()` from the **demo fixture catalog** (`catalog.ts`, includes CRM, Helpdesk, ITSM, Legal, Financials etc. that were removed from the product per PPMS scope) and a hard-coded `INSTALLED` set (lines 55-61) unrelated to `ProductInstallation`. "N apps installed" is fabricated.
  3. Hero claims "50+ integrations supported" while `/integrations` says "none available yet".
  4. Fake people avatars in the title bar.
  5. Category taxonomy (Sales, Support, IT, Legal, Finance, Engineering) contradicts the PPMS positioning.
  6. `CatalogStubPage` (products/catalog-stub-page.tsx) says "Back to Product Store" and links to `/studio`, which does not exist; its "Notify me" button is disabled. It is only reachable for `COMING_SOON` product slugs, of which the catalog currently has none, so it is effectively dead code with violet styling that violates the palette rule.
  7. [dead trio].

### 1.11 `/build` — Build apps list
File: `src/app/(dashboard)/build/page.tsx`
- **Purpose**: AI-generated custom apps catalog (`/api/build/apps`).
- **Reach**: Settings sidebar "Operations › Build apps" (everyone); launcher "Build".
- **Back**: none.
- **Topbar**: `OsTitleBar` "Build", description; actions: `Agents` link (→ /agents), primary "Generate app"; [dead trio].
- **Sidebar**: SettingsSidebar.
- **Controls**: KPI tiles (Apps / Published / Drafts / Templates "— coming soon"); search; status chips All/Published/Draft; "Show archived" checkbox; app cards (link to `/build/[slug]`).
- **State**: rough.
- **Issues**:
  1. "Generate app" only toasts "Use the prompt panel in Sidekick to scaffold a new app" (line 106); no create flow on the page. Empty-state CTA hidden (no handler). There is no visible way to build an app from Build.
  2. "Show archived" toggle never reveals anything: `GET /api/build/apps` excludes ARCHIVED server-side (api/build/apps/route.ts:24), so the checkbox is dead.
  3. "Templates: — coming soon" KPI tile is a placeholder inside a stats strip.
  4. Error "Retry" hidden.
  5. Placement under Settings › Operations alongside Marketplace/Tools/Assets/Trash is arbitrary; Build is a maker tool, not an ops/admin surface.
  6. [dead trio].

### 1.12 `/build/[slug]` — Generated app
File: `src/app/(dashboard)/build/[slug]/page.tsx`
- **Purpose**: renders one generated app's rows in `BoardView` (Table/Kanban/Calendar/Gallery), add/edit/delete rows, archive app.
- **Reach**: `/build` card.
- **Back**: yes, `<Link href="/build">← All apps</Link>` (line 130). Not `BackButton`.
- **Topbar**: none of the OS chrome; a hand-rolled header (icon tile, "Built with Vibe" pill, title, description, slug/row count, "New row" button, archive trash icon).
- **Sidebar**: SettingsSidebar.
- **Controls**: "New row" modal (per-field inputs), BoardView inline edit / bulk change / bulk delete, "Archive app" (confirm), error banner.
- **State**: rough.
- **Issues**:
  1. Icon tile uses dynamic Tailwind classes `bg-${app.hue}-100 text-${app.hue}-600` (line 136) which Tailwind cannot generate at build time; the tile renders unstyled for any hue.
  2. Header is Tailwind-only (`text-2xl`, `rounded-2xl`, `#0073EA` literals) with dark-mode classes, unlike every sibling page's `OsTitleBar` + tokens.
  3. Loading state is `Loader2` spinner, not `ValueLoader`.
  4. 404 silently `router.push("/build")` with no toast.
  5. Row identity is array index; bulk operations re-fetch after each step. Fragile but works.
  6. `CellValue` component (lines 247-277) is unused dead code.
  7. "Built with Vibe" pill references a product name not used elsewhere.

### 1.13 `/trash` — Org recycle bin
File: `src/app/(dashboard)/trash/page.tsx`
- **Purpose**: 60-day recoverable deleted items (Spaces, Lists, Tasks, docs, SOPs, tables, files, policies, contracts): Restore / Delete forever.
- **Reach**: Settings sidebar "Operations › Trash" (hr-admin only); **profile menu "Trash" (every access level)**; Settings › Data governance card; launcher "Trash" (hr-admin).
- **Back**: none.
- **Topbar**: `OsTitleBar` "Trash", `showStandardActions={false}`, description "N items · auto-deleted 60 days after deletion".
- **Sidebar**: SettingsSidebar.
- **Controls**: per-row "Restore", "Delete" (confirm); days-left badge.
- **State**: polished but mixed style.
- **Issues**:
  1. Profile menu shows "Trash" to employees; API is `isManager`-gated (api/trash/route.ts:14) so employees see an error empty-state "Manager access required." Nav shows a door the user can't open.
  2. Gate inconsistency: sidebar/catalog say `hr-admin`, API says `isManager`; a manager can use `/trash` via the profile menu but has no sidebar row.
  3. Loading is a bare `Loader2` + "Loading…" text; empty state is a bespoke dashed box instead of `OsEmptyView`; body is Tailwind (`max-w-4xl`, `divide-zinc-100`) while siblings use BEM `.tls__/.ast__` classes. Three conventions in one page family.
  4. Parallel trash surfaces: `/docs/trash` (notes only, separate), Contracts sidebar "Trash" (`/agreements?view=trash`), Docs sidebar "Archived" view. Four places for deleted things.
  5. No search, filter by type, or bulk restore/empty.

### 1.14 `/docs/trash` — Notes trash
File: `src/app/(dashboard)/docs/trash/page.tsx`
- **Purpose**: archived notes (`/api/docs?archived=1`) with restore.
- **Reach**: **URL only.** DocsSidebar offers an "Archived" view (`/docs?view=archived`, docs-sidebar.tsx:125) which shows the same data inside `/docs`; nothing links to `/docs/trash`.
- **Back**: "Back to notes" link (→ /docs) styled as a `docs__new` button.
- **Topbar**: `OsTitleBar` "Trash" (same title as org Trash); [dead trio].
- **Sidebar**: DocsSidebar (matches `/docs` prefix).
- **Controls**: search, per-row Restore.
- **State**: rough / redundant.
- **Issues**: duplicate of the Docs "Archived" view; both CTAs ("Retry", "Open notes") hidden for lack of handlers; no permanent delete; title collides with `/trash`.

### 1.15 `/tools` — Tools & credentials
Files: `tools/page.tsx`, `tools/layout.tsx` (`requireManagerOrRedirect`)
- **Purpose**: org SaaS tool catalog grouped by category, with shared credentials (username/password/API key/notes) in a detail modal.
- **Reach**: Settings sidebar "Operations › Tools & SaaS" (hr-admin); launcher "Tools" (hr-admin, sidebar label "Tools & subscriptions").
- **Back**: none. Detail is a modal.
- **Topbar**: `OsTitleBar` "Tools", description "N tools · N categories · N with shared creds"; actions: `Settings` link, primary "Add tool" (two sequential `prompt` dialogs: name, URL); [dead trio].
- **Sidebar**: SettingsSidebar.
- **Controls**: KPI tiles (Tools / Categories / With creds / Shared to me); search; category chips; tool cards (click → modal; external-link icon); modal: pencil "Edit credentials", Username/Password/API key/Notes fields, show/hide + copy per secret, "Open website".
- **State**: rough.
- **Issues**:
  1. Three different labels for one page: "Tools & SaaS" (Settings sidebar), "Tools & subscriptions" (catalog sidebar), "Tools" (page title).
  2. "Add tool" uses two chained prompt dialogs and always sets category "Uncategorized"; there is no way to set category, description or icon afterwards (modal only edits credentials). Category chips therefore mostly show "Uncategorized".
  3. No sharing UI: the data model has `shares` and the KPI "With creds / shared access" counts them, but nothing on the page lets an admin share a tool with a person; the `/api/tools/[id]/share` route exists with no caller in this page.
  4. No delete tool control though `DELETE /api/tools/[id]` exists.
  5. Access mismatch: layout admits any manager, but `GET /api/tools` returns the full catalog only to SUPER_ADMIN/COMPANY_ADMIN/C_LEVEL/HR and only "shared with me" to others (api/tools/route.ts:13-26). A MANAGER passes the page gate and sees an empty/partial catalog with admin-style KPI tiles.
  6. Employees can have tools shared with them (credentials included) but have no route to see them (layout redirects them).
  7. Credentials modal is Tailwind (`max-w-md`, `#0073EA` literal) while the page body is BEM; detail modal is `fixed inset-0 z-[120]` hand-rolled, not `ui/dialog`.
  8. [dead trio].

### 1.16 `/assets` — Asset register
Files: `assets/page.tsx`, `assets/layout.tsx` (`requireManagerOrRedirect`), `asset-form-dialog.tsx`, `assign-dialog.tsx`, `asset-row-menu.tsx`, `types.ts`
- **Purpose**: fixed-asset register: stats, status filters, dense table, per-row "…" menu (Edit / Assign / Unassign / Change status / Check-out log (soon) / Delete).
- **Reach**: Settings sidebar "Operations › Assets" (hr-admin); launcher "Assets" (label "Assets & equipment"); tour step 7 (tour-content.tsx:69); Product catalog `workwrk-assets` pathPrefix.
- **Back**: none.
- **Topbar**: `OsTitleBar` "Asset register", description; actions: `Settings` link, primary "Add asset"; [dead trio].
- **Sidebar**: SettingsSidebar.
- **Controls**: stat tiles; search; status chips (All / Available / Assigned / In repair / Retired / Lost / Warranty soon); table; row menu; Add/Edit dialog (name, type, condition, brand, model, serial, IMEI, purchase date/cost, warranty, status (edit only), notes); Assign dialog (people search, Unassign).
- **State**: polished (best-wired page in scope: real dialogs, `useConfirm`, 403 toasts).
- **Issues**:
  1. Three labels: "Assets" / "Assets & equipment" / "Asset register".
  2. Loading state is plain text "Loading…" (line 142), not `ValueLoader`; error is a bare div.
  3. Page injects a `<style>` block (lines 122-135) to override `os.css`; column layout collapses to a single column under 1100px with no responsive row design.
  4. `fmtMoney` hard-codes "USD" while Marketing pages hard-code "₹"; no org currency.
  5. "Check-out log" menu item is a permanently disabled "Soon" row.
  6. Uses the `ui/toast` `useToast` (success/error) while sibling pages use `useOsToast` (single string); two toast systems.
  7. Product catalog marks `workwrk-assets` as a PLUS module `defaultEnabled:false` (products/catalog.ts:168-182) but there is no installation gate on the route or rail; the module concept is not enforced here.
  8. Employees can see their own assets only via the profile "Assets" tab; no `/my-assets` (acknowledged in layout comment).
  9. [dead trio].

### 1.17 `/analytics` — Analytics hub
Files: `analytics/page.tsx`, `analytics/layout.tsx` (`requireManagerOrRedirect`)
- **Purpose**: cross-module counts (tasks, headcount, POs, SOPs, timesheets) as link tiles in three sections.
- **Reach**: Settings Overview "Usage › AI usage" card (settings/page.tsx:257, labelled AI usage); `g a` shortcut. Not in any hub, sidebar, palette or launcher.
- **Back**: none.
- **Topbar**: `OsTitleBar` "Analytics", description; actions: `Reports` (→ /financials/reports), `Variance` (→ /planning/variance), `Compliance` (→ /sops/compliance); [dead trio].
- **Sidebar**: unmatched → stale hub.
- **Controls**: 10 link tiles.
- **State**: **broken**.
- **Issues**:
  1. **Six dead links to removed modules**: `/procurement/pos`, `/financials`, `/financials/reports`, `/financials/statements`, `/planning/variance` (tiles) and the `Reports` / `Variance` title-bar links. None of `financials`, `planning`, `procurement` exist under `src/app/(dashboard)` → 404. The entire "Finance" section is dead.
  2. Counts are computed by fetching up to 200 rows from five list endpoints and counting client-side; wrong past 200 items, and `/api/purchase-orders` is a leftover from the removed Procurement module.
  3. Reached from a Settings card titled "AI usage" whose description is "Sidekick + agent queries", but the page has no AI metrics.
  4. There is a separate `/api/analytics` (manager-gated) that this page never calls.
  5. Not in any nav; effectively orphaned except via the mislabelled Settings card.
  6. Loading shows "…" in tile values; no error empty state (bare div).
  7. [dead trio].

### 1.18 `/dashboard` — redirect
Files: `dashboard/page.tsx` (redirect → /today), `dashboard/dashboard-content.tsx` (653 lines, **not imported anywhere**)
- **Reach**: ⌘K "Open My Activity" (command-palette.tsx:146), `g d`, route-guard default redirect target, auth flows (welcome, verify-email, setup), tour step "Your Dashboard" (tour-content.tsx:101), marketing nav `bento-nav.tsx:95`.
- **State**: redirect works; **dead-code tree**.
- **Issues**:
  1. `dashboard-content.tsx` and its exclusive dependencies (`components/dashboard/employee-dashboard.tsx`, `manager-dashboard.tsx`, `dept-workspace-banner.tsx`, `dept-home.ts`, `ai-signals.tsx`, `autonomous-digest.tsx`, `birthday-card.tsx`, `dashboard-okrs.tsx`, `announcements-banner.tsx`, `page-header.tsx`, `admin-setup-checklist.tsx`, `onboarding-checklist.tsx`, `/api/dashboard`) are unreachable. They contain the only "Recent Kudos", "Surveys waiting for you" and dept-workspace-banner surfaces, i.e. the employee entry points to Kudos/Surveys died with the dashboard.
  2. ⌘K label "Open My Activity" and tour copy "The dashboard is your home… recent kudos" describe a page that no longer exists.
  3. `dept-home.ts` routes to `/crm`, `/dev`, `/itsm`, `/helpdesk`, `/legal`, `/procurement`: all removed.

### 1.19 `/marketing` — Marketing hub
File: `src/app/(dashboard)/marketing/page.tsx`
- **Purpose**: campaign KPI strip, four launch tiles (Campaigns / Content / Events / Reports), featured campaigns, channel mix.
- **Reach**: **URL only.** Only `dept-home.ts` (dead) and the product catalog `pathPrefix` reference it. No hub `matchPaths`, no sidebar, no palette, no launcher (`workwrk-campaigns` isn't a rail app).
- **Back**: none.
- **Topbar**: `OsTitleBar` "Marketing", description, fake people `PEOPLE.bb/mk/an` +3; actions: Campaigns / Content / Events links, primary "New campaign" (creates "Untitled campaign" and reloads, no navigation); [dead trio].
- **Sidebar**: unmatched → stale hub.
- **Controls**: KPI tiles (Active / Budget / Spent / Goal hit); 4 launch tiles ("Reports" tile links to `/marketing/campaigns`, there is no reports page); campaign tiles → `/marketing/[id]`; channel chips (display).
- **State**: rough (visually rich, structurally orphaned).
- **Issues**:
  1. Orphaned; the whole Marketing suite is unreachable from nav. Per memory the PPMS scope removed Marketing from the rail; the pages were left behind.
  2. "Reports" launch tile advertises "performance & ROI dashboards" and links to the campaigns list.
  3. Fake avatars in title bar. Currency hard-coded "₹" with Indian lakh/crore formatting (line 75-80).
  4. Empty-state CTA "New campaign" and error "Retry" hidden.
  5. Product catalog marks it PLUS `defaultEnabled:false` but no route gate (any org member can use it).
  6. API (`resolveSuiteContext`) only checks session; any employee can create/patch campaigns.
  7. Name collision with the public `(marketing)` route group; `src/components/marketing/*` is the public site, not this app.
  8. [dead trio].

### 1.20 `/marketing/campaigns` — Campaigns list
File: `marketing/campaigns/page.tsx`
- **Reach**: `/marketing` tiles/links; `/marketing/events` and `/marketing/[id]`.
- **Back**: yes, a `<button onClick={() => history.back()}>← Marketing</button>` (line 205). **Bare `history.back()`**, violates the "no bare router.back, use BackButton{fallbackHref}" convention; on a fresh tab it leaves the app.
- **Topbar**: `OsTitleBar` "Campaigns", fake avatars, actions: back, Content, Events, "New campaign"; [dead trio].
- **Controls**: status pipeline bar (5 segments, display); search; status chips; sort tabs (Recent / A–Z / Spend / Goal %); rows with Launch/Pause/Resume/Complete quick actions; "Clear filters".
- **State**: rough.
- **Issues**: bare `history.back()`; Cancelled status has no chip/segment; empty/error CTAs hidden; quick-action buttons visible to all (API ungated so they work, but no permission model); fake avatars; ₹ hard-coded.

### 1.21 `/marketing/content` — Content library
File: `marketing/content/page.tsx`
- **Reach**: `/marketing` links.
- **Back**: **none** (no back button, no nav links; the only sibling without them).
- **Topbar**: **not `OsTitleBar`**; hand-rolled `.lib__head` with gradient icon tile (the pattern OsTitleBar explicitly removed), title "Content library", search, "New piece" (single `prompt` for title; always BLOG_POST/IDEA).
- **Controls**: type chips; cards with status pill, channel, scheduled/published dates, Brief/Draft/Live external links.
- **State**: rough.
- **Issues**: no back/nav (dead end); no edit at all (status, type, channel, URLs, dates can never be set from the UI, so status pill is stuck at "Idea" and links never appear); loading is plain text; error is a bare div; inconsistent header.

### 1.22 `/marketing/events` — Events
File: `marketing/events/page.tsx`
- **Reach**: `/marketing` links.
- **Back**: bare `history.back()` button (line 249), same violation as campaigns.
- **Topbar**: `OsTitleBar` "Events", fake avatars, actions: back, Campaigns, Content, "New event"; [dead trio].
- **Controls**: featured next-event hero (links to `/marketing/events#id`, i.e. itself); KPI tiles; search; format chips; grouped rows (This week / This month / Later / Past) with registration and spend bars, "Page" external link.
- **State**: rough.
- **Issues**: no event detail or edit (name is "Untitled event" forever; dates/capacity/format can't be set from UI, so "Next up" hero never appears for UI-created events); hero card links to an anchor on the same page; empty/error CTAs hidden; ₹ hard-coded; "Spent" KPI labelled with a `MapPin` icon.

### 1.23 `/marketing/[id]` — Campaign detail
File: `marketing/[id]/page.tsx`
- **Reach**: campaign tiles/rows.
- **Back**: yes, `router.push("/marketing")` button (line 216). Not `BackButton`.
- **Topbar**: `OsTitleBar` title = campaign name, description "Status · channel"; actions: back, "Copy link", **"More" (`MoreHorizontal`) button with no handler** (line 222); [dead trio].
- **Controls**: inline title/description edit (blur to save); lifecycle stepper (click to set status); scoreboard tiles; properties (Status pill opens `OsPickerPopover`, others read-only); quick actions (Approve / Launch / Resume / Pause / Mark complete / Copy share link); "Activity: coming soon" panel.
- **State**: rough.
- **Issues**: dead "More" button; budget, spent, channel, goal, dates are read-only (no way to set them anywhere in the suite, so scoreboard rings are always 0/"—" for UI-created campaigns); detail loads by fetching the full list and `.find` (no GET-by-id); "Activity coming soon" placeholder panel; not-found state's "Back to Marketing" CTA hidden (no handler).

### 1.24 `/me/mentions` — Mentions inbox
File: `src/app/(dashboard)/me/mentions/page.tsx`
- **Purpose**: @-mentions across notes and SOPs, each row deep-links to the block.
- **Reach**: **URL only (orphaned).** `/inbox` has a "Mentions" filter (inbox/page.tsx:351) that is the live equivalent.
- **Back**: none.
- **Topbar**: `OsTitleBar` "Mentions"; [dead trio].
- **Sidebar**: unmatched → stale hub.
- **State**: rough / redundant.
- **Issues**: orphaned duplicate of Inbox › Mentions; both CTAs ("Retry", "Open notes") hidden; no unread/read state, no dismiss.

### 1.25 `/me/weekly-review` — Weekly review
Files: `me/weekly-review/page.tsx` (server), `components/me/weekly-review-form.tsx`
- **Purpose**: mandatory weekly heartbeat: KRA progress sliders, KPI snapshot inputs, Highlights/Blockers/Plan, Save draft / Submit / Reopen; manager status banner.
- **Reach**: Today › My Alignment panel links (my-alignment.tsx:262-296); own profile "Reviews" tab "My weekly review" (profile-client.tsx:1369).
- **Back**: breadcrumb "Today › Weekly review" (`Link` to /today). Not `BackButton`.
- **Topbar**: none of the OS chrome; page-level `h1` "Weekly review" + week range subtitle inside `px-8 py-6 max-w-[920px]`.
- **Sidebar**: unmatched (`/me` not in Home matchPaths) → stale hub, usually Home.
- **Controls**: per-KRA range slider (0-100 step 5) + note; per-KPI number input; three textareas; Save draft; Submit for review; Reopen to edit.
- **State**: polished functionally, plain visually.
- **Issues**: not highlighted under the Work hub although it is a personal Work surface; empty KRA state tells the user to "Add one from /kra-kpi" (raw path in copy; employees can't access /kra-kpi); no history of past weeks; no autosave (explicit Save only, acknowledged in file); slider has no accessible value label beyond the % text; error is a tiny red line.

### 1.26 `/people/me` — redirect
File: `people/me/page.tsx` → `redirect(/people/${user.id})`.
- **Reach**: Home sidebar "Me" (apps-catalog.tsx:884), Teams sidebar "My Profile", Goals sidebar "My KRAs & KPIs", profile menu "My Profile", page-gate redirect target.
- **State**: works. Note: four different labels ("Me", "My Profile", "My KRAs & KPIs", "My Profile") for the same destination; the Home label carries a `TODO(rename)` (apps-catalog.tsx:439).

### 1.27 `/meetings` — Meetings list
File: `src/app/(dashboard)/meetings/page.tsx`
- **Purpose**: agenda-first list: "Next up" hero, Later today / This week / Upcoming / Past 30 days.
- **Reach**: `g m` shortcut; notetaker "recent meetings" links; doc block-editor meeting embed "Open". **No hub, sidebar, palette or launcher entry**; the Planner hub's matchPaths are `/calendar, /planner, /timesheets` only, and neither Planner nor Today links to /meetings.
- **Back**: none.
- **Topbar**: `OsTitleBar` "Meetings", fake avatars `PEOPLE.bb/sc/pr` +9, action "New meeting" (creates "Untitled meeting" ADHOC at next hour then **`window.location.href`** full reload to the detail); [dead trio].
- **Sidebar**: unmatched → stale hub.
- **Controls**: hero card (Join / Join call), meeting cards.
- **State**: rough (orphaned, fake data in chrome).
- **Issues**: effectively orphaned; fake avatars; full page reload on create instead of `router.push`; empty/error CTAs hidden; `useNoopRouter` leftover; API lists every org meeting to every member (api/meetings/route.ts:18) with no attendee scoping.

### 1.28 `/meetings/[id]` — Meeting room
File: `src/app/(dashboard)/meetings/[id]/page.tsx`
- **Purpose**: notes editor (voice-to-text, AI summary, paste transcript, 2.5s autosave) + sidebar cards (agenda, attendees, decisions, action items) + call dock integration + delete.
- **Reach**: list, notetaker, doc embeds, `?call=1` deep link.
- **Back**: yes, icon-only `router.push("/meetings")` button (line 559). Not `BackButton`.
- **Topbar**: no OS chrome; bespoke `.mtgr__head` with type chip, live/completed badge, date, duration, inline-editable title, "Join call" / "In call", "Guest link", "Delete".
- **Sidebar**: unmatched → stale hub.
- **Controls**: Voice record / AI summary / Paste transcript; notes textarea; agenda textarea (blur save); attendees list (read-only, **no add/remove**); decisions add/remove; action items add (title, assignee select, deadline) / toggle / convert to task / delete; delete meeting confirm modal.
- **State**: rough-to-polished (rich, but chrome diverges from the OS shell).
- **Issues**: cannot edit type, date/time, duration or meeting URL after creation, and cannot add attendees (so "Untitled meeting" created from the list can never have attendees; action-item assignee select falls back to the whole org); delete is permanent (no Trash); hand-rolled `Modal` instead of `ui/dialog`; no error state on fetch failure (console.error only, page shows "Meeting not found"); fetch of previous meeting for follow-ups calls the list endpoint with no limit.

---

## 2. Unmounted culture components (dead code that would have been the employee doors)

| Component | File | Would have provided | Status |
|---|---|---|---|
| `OsKudosPopover` | `layout/os/kudos-popover.tsx` | Give kudos + recent feed from the topbar; hard-codes a **different** value list ("Customer obsession", "Bias for action"…, line 26) than KudosModal/org values | not imported |
| `OsCandorPopover` | `layout/os/candor-popover.tsx` | Employees' list of active anonymous sessions to respond to | not imported |
| `OsSurveysPopover` | `layout/os/surveys-popover.tsx` | Employees' pending/taken surveys | not imported |
| `KudosModal` | `components/kudos/kudos-modal.tsx` | Give kudos dialog using org values (`useCultureValues`) | not imported (edited in HEAD commit) |
| `KudosFab` | `components/kudos/kudos-fab.tsx` | Floating heart button | not imported |
| `TopbarPopoverButton` | `layout/os/topbar-popover-button.tsx` | Host for the three popovers | not imported |
| `DashboardContent` + `EmployeeDashboard` | see §1.18 | "Recent kudos", "Surveys waiting for you" | not imported |

Net effect: Kudos cannot be given; Candor and Surveys have no respondent entry point other than a notification link to the manager-styled `/surveys` list.

---

## 3. Broken / confusing (consolidated, ranked)

**High**
1. Kudos has no give path in the mounted UI; "Send kudos" toasts a false instruction (kudos/page.tsx:144; profile has no give control).
2. `/analytics` links to six non-existent routes (`/financials*`, `/planning/variance`, `/procurement/pos`) → 404s (analytics/page.tsx:98,115-118,132-133).
3. `/store` Install/Installed buttons do nothing and the catalog + "installed" set are demo fixtures (store/page.tsx:55-61, 224-233); real module install lives in Settings → Modules and is never referenced.
4. `OsTitleBar` "Ask AI / Share / Invite" are dead buttons on ~20 pages in scope (title-bar.tsx:89-111).
5. Orphaned routes with no navigation: `/ideas`, `/marketing/*` (5 pages), `/meetings` (+detail, only `g m`/notetaker), `/me/mentions`, `/docs/trash`. The whole Marketing suite and Ideas are invisible.
6. Employees have no in-app entry to Candor/Survey responding; the components that provided it are unmounted (§2). Survey notification links to the manager-flavoured `/surveys` list, not the survey.
7. Cosmetic controls that fail on 403 for employees: Surveys Launch/Close (surveys/page.tsx:260-269), Ideas drag-to-status (ideas/page.tsx:242), profile-menu Trash (profile-menu.tsx:252 vs api/trash/route.ts:14).
8. `dashboard-content.tsx` and ~12 dependent components + `/api/dashboard` are dead code, yet ⌘K "Open My Activity" and the product tour still describe that dashboard.

**Medium**
9. Access-gate inconsistency: Culture sidebar rows are `hr-admin` while Candor/Surveys APIs allow any manager; Tools/Assets/Trash sidebar rows are `hr-admin` while layouts admit any manager and `/api/tools` further narrows to admins. Managers reach pages by URL with no nav; or reach pages and see filtered/empty data with admin KPI strips.
10. Build "Generate app" only toasts; "Show archived" is dead (server filters ARCHIVED); no create flow (build/page.tsx:106,144; api/build/apps/route.ts:24).
11. Marketing suite: no edit for budget/spend/goal/dates/channel (campaign), type/status/channel/urls (content), dates/capacity/format (events); "Reports" tile links to campaigns; dead "More" button on detail; bare `history.back()` on two pages.
12. Tools: no category/description/delete/share controls though APIs exist; three different labels; chained prompt dialogs for create.
13. Fake `PEOPLE` avatar fixtures in title bars on Ideas, Store, Marketing (×3), Meetings (catalog.ts:79-88).
14. Empty-state and error-state CTAs are hidden on most pages because `cta` is passed without `onCta`/`ctaHref` (kudos, candor, ideas, build, marketing ×3, meetings, mentions, docs/trash, surveys error, campaign not-found). Users see "Couldn't load" with no retry.
15. `/meetings` create uses `window.location.href` (full reload); Meeting detail can't edit time/type/duration/attendees; delete is permanent.
16. Multiple trash/archive surfaces: `/trash`, `/docs/trash`, Docs "Archived" view, Contracts "Trash" view.
17. Three overlapping integration surfaces (`/integrations` preview, `/store` "Integrations" filter with Install buttons, `/settings/integrations` cards) with contradictory claims ("none available yet" vs "50+ integrations supported").
18. `/build/[slug]` icon uses dynamic Tailwind class names that never compile (line 136).
19. Settings Overview card "AI usage" links to `/analytics`, which has no AI metrics (settings/page.tsx:257).
20. Candor/Survey/Ideas/Kudos stats are computed client-side over capped lists (50/200 rows).

**Low**
21. Loader inconsistency inside single features: `ValueLoader` on lists vs `Loader2` spinner (surveys/[id], build/[slug], trash) vs plain "Loading…" text (assets, marketing/content).
22. Currency hard-coding: "USD" (assets) vs "₹" + lakh/crore (marketing).
23. Label drift for one destination: Me / My Profile / My KRAs & KPIs (people/me); Tools & SaaS / Tools & subscriptions / Tools; Assets / Assets & equipment / Asset register; Trash (org) vs Trash (notes).
24. `CatalogStubPage` links to `/studio` (missing), uses violet palette, disabled "Notify me"; only reachable for COMING_SOON slugs (none today).
25. Weekly review empty copy exposes a raw path ("/kra-kpi") employees can't open.
26. Survey builder drag handle is decorative; "Specific people · Coming soon" disabled pill inside an active chip row.
27. Assets page injects a `<style>` tag to override shared CSS; Marketing/Content uses the gradient icon-tile header that `OsTitleBar` removed.

---

## 4. Cross-cutting conventions observed

**Back navigation**: no page in scope uses the shared `BackButton{fallbackHref}` convention. Patterns seen: custom `<Link href="/parent">← All …</Link>` in title-bar actions (candor/[id], surveys/[id], build/[slug]); `router.push("/parent")` buttons (marketing/[id], meetings/[id]); bare `history.back()` (marketing/campaigns:205, marketing/events:249, forbidden by project convention); breadcrumb link (me/weekly-review); none on list pages. Candor's blank/thanks states also carry their own "Back to Candor" CTA.

**Loader**: three conventions. `ValueLoader` (brand dots + rotating company value, `components/brand/value-loader.tsx`) on kudos, candor, surveys list, ideas, build list, marketing hub/campaigns/events/detail, meetings list/detail, mentions, docs/trash. Lucide `Loader2` spinner on surveys/[id], build/[slug], trash. Plain text "Loading…" on assets and marketing/content. Title bars also show "Loading…" in the description while lists load.

**Empty / error states**: `OsEmptyView` (empty-view.tsx) is the intended primitive and deliberately hides its CTA unless `onCta`/`ctaHref` is passed; most pages pass only `cta`, so empty and error states lose their button. Error states reuse `OsEmptyView` with `GRAD.redPink` and the raw error string ("HTTP 500"). Assets, analytics, marketing/content show errors as an unstyled div. Surveys/[id] and trash use bespoke panels. "No match" states are inline one-liners per page (`.kud__no-match`, `.cnd__no-match` …), each restyled.

**Style consistency**: the page family is built on `OsTitleBar` (white header, star, title, description, actions) + a per-page BEM block in `src/app/(dashboard)/os.css` (34k lines: `.kud__*`, `.cnd__*`, `.cnd-d__*`, `.srv__*`, `.ideas__*`, `.ing__*`, `.os-mkt*`, `.bld__*`, `.tls__*`, `.ast__*`, `.ana__*`, `.mkt__*`, `.cmps__*`, `.evts__*`, `.camp__*`, `.lib__*`, `.mtg*`, `.mention-inbox*`). Every page re-implements the same `KpiTile` component locally (kudos, candor, surveys, integrations, build, tools, marketing ×3) with a hue accent bar, each using different accent colours. Tokens: pages use `--os-*` (`--os-brand`, `--os-c-*`, `--os-ink-*`, `--os-surface-1`, `--os-line`) but mix in the `C.*` hex palette from `catalog.ts` and hard-coded `#0073EA` / `#E2445C`. Drift: trash, build/[slug], tools modal, assets dialogs, surveys/[id], weekly-review are Tailwind-only with `zinc-*` classes and dark-mode variants; marketing/content and meetings/[id] use bespoke headers; catalog-stub-page is violet. Per-status hue coding (orange=active, green=closed, darkgray=draft) is consistent across Candor/Surveys/Build, but Marketing uses `C.yellow`/`C.brown` pipeline colours and Ideas uses blue/orange/green columns, contrary to the "single accent, Monday-clean" preference. Toasts: `useOsToast` (string) on most pages vs `ui/toast` `useToast` (title+description, success/error) in assets dialogs and kudos modal.

**Mobile / responsive**: the OS shell (`os-shell.tsx`) has no mobile mode: rail is fixed 60px, sidebar 200-320px, no breakpoints in `click-app-rail.tsx`/`click-sidebar.tsx`; the responsive rules in `app-shell.css:1482-1560` target the old `.app-sidebar` shell, not the current one. `os.css` has only grid-collapse media queries for some KPI strips (`.kud__kpis`, `.cnd__kpis`, `.ideas__board`, `.ana__grid` at 900-1100px); assets collapses its table to one column at 1100px with no row redesign; marketing/meetings/tools grids have none. Effectively desktop-only.

---

## 5. Access notes

Tier ladder: `access-tiers.ts` (`manager` = TEAM_LEAD…C_LEVEL, HR, admins; `hr-admin` = HR + COMPANY_ADMIN + SUPER_ADMIN; `org-admin` = the two admin tiers). Server page gates: `requireManagerOrRedirect` (route-guard.ts, redirects EMPLOYEE/AGENT to `/dashboard` → /today) on `/integrations`, `/tools`, `/assets`, `/analytics`. Everything else in scope has **no page gate**; visibility relies on the API.

| Route | Rail/sidebar visibility | Page gate | API behaviour | Inconsistency |
|---|---|---|---|---|
| /kudos | hr-admin sidebar | none | any member reads/creates | sidebar hides a feature everyone may use; no give UI |
| /candor, /candor/[id] | hr-admin sidebar | none | any member reads active org/dept sessions + responds; `isManager` creates/edits | managers can create but have no nav; employees can respond but have no nav |
| /surveys, /surveys/[id] | hr-admin sidebar | none | any member reads audience surveys; `isManager` creates/edits/results | list shows Launch/Close to everyone |
| /ideas | none | none | any member reads/votes/submits; `isManager` changes status | drag exposed to all |
| /imports | Home "+" (everyone), Settings data (admin) | none | n/a | fine |
| /integrations | ⌘K (everyone) | manager | manager | employees bounced silently |
| /store, /build | Settings sidebar (everyone) | none | build: any member reads/creates | store install is fake anyway |
| /build/[slug] | via list | none | any member edits/archives any org app | no ownership model |
| /trash | hr-admin sidebar + profile menu (everyone) | none | `isManager` | employees hit 403 screen |
| /tools | hr-admin sidebar | manager | full list: SUPER_ADMIN/COMPANY_ADMIN/C_LEVEL/HR; others: shared-only; write: `isManager` | manager passes gate, sees partial data; employees with shared creds have no page |
| /assets | hr-admin sidebar | manager | `requirePermission` + scope all/team/own | fine; employees only via profile tab |
| /analytics | Settings "AI usage" card (admin view) | manager | page never calls `/api/analytics` | mislabelled entry |
| /marketing/* | none | none | session only (`resolveSuiteContext`) | any employee can create/patch campaigns/content/events |
| /meetings, /[id] | none | none | any member lists **all** org meetings and can edit/delete any | no attendee/owner scoping |
| /me/mentions, /me/weekly-review, /people/me | Today/profile links | session | own data | fine |
| /docs/trash | none | none | own archived docs | fine |

Product-catalog "PLUS, defaultEnabled:false" flags on `workwrk-assets` and `workwrk-campaigns` are not enforced anywhere (only Talk/Tables are real modules per `lib/modules.ts`).

---

## 6. Settings notes

**Configurable today (affecting this subsystem)**
- Rail app visibility/order/min-access per org: Settings → Admin → Apps (`OrgPreference.sidebarDefault.apps`, rail-apps.ts). Because every in-scope app is `offRail`, hiding it there only removes it from the launcher; the sidebar rows in TeamsSidebar/SettingsSidebar are hard-coded and ignore that config.
- Company values (drive Kudos chips, `ValueLoader` captions): Settings → Identity (`org.settings.companyProfile`).
- Premium modules (Talk/Tables only): Settings → Modules.
- Survey-level: audience, anonymity, repeat, close date (in builder).
- Candor-level: scope (org/department), prompts.
- Personal: sidebar width (localStorage), profile-tool pins, sidebar section order.

**Should be configurable but isn't**
- Org currency (assets USD vs marketing ₹ are hard-coded).
- Trash retention (60 days hard-coded in trash/page.tsx:40 and API).
- Kudos: which values are selectable, whether kudos are public, reaction emoji set; per-person notification prefs exist in API (`shouldNotify`) but no kudos-specific setting surface.
- Ideas: pipeline stages/labels, who may review, reward flow.
- Survey defaults (anonymous by default, reminder cadence) and who can build surveys (sidebar says HR-admin, API says manager).
- Tools: categories list, who can view credentials (currently a hard-coded role list in the API), sharing UI.
- Assets: types/conditions/statuses (hard-coded enums in `assets/types.ts`), warranty warning window (60d hard-coded), check-in/out.
- Marketing/Meetings: nothing is configurable and neither has an on/off switch despite catalog "module" flags.
- Analytics: no way to choose which metrics/modules appear; dead finance tiles can't be hidden.
- Store: nothing on the page maps to real installation state.

**Recommended consolidation for the redesign**
- Collapse Culture (Kudos, Candor, Surveys, Ideas) into one hub with an employee door (respond/give) and a manager door (create/results); mount a single kudos composer.
- Move Tools/Assets/Trash into a coherent Admin › Operations area with one label each; add `/my-tools`, keep profile › Assets.
- Delete or gate: `/analytics` finance tiles, `/store` fixtures, `/marketing` suite, `/meetings` (or attach it to Planner), `/me/mentions`, `/docs/trash`, `dashboard-content` tree, `catalog-stub-page`, `dept-home`.
- Replace the dead `OsTitleBar` trio with real handlers or remove; standardise `BackButton{fallbackHref}`, `ValueLoader`, `OsEmptyView` with a wired CTA, and one `KpiTile` primitive.
