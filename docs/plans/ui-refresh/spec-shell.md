# Shell spec

Unit: the frame around every `(dashboard)` route. Rail, secondary-sidebar framework, top bar, URL-derived highlighting, back and close convention, loaders, error and empty framework, session expiry, cookie consent scope, dark mode, i18n and RTL, keyboard map, narrow-width behaviour, Coming-soon policy, and the shell-level overlays (search palette, Create menu, bell, avatar menu, workspace menu, help menu, shortcuts overlay, Customize panel, session-expired dialog, splash, the three personal-capture overlays (reminder, notepad, voice note), confirm and prompt dialogs, toasts, timer pill, call dock).

Written against `design-system.md` (look), `access-model-spec.md` (access), `settings-architecture.md` (settings). Code references are at commit `6187227a` unless stated. Hub sidebar CONTENTS are owned by the hub units; this document fixes the container and the rules every hub's rows obey.

Written in the user's words: "hub" is what the rail icon opens, "sidebar" is the grey column, "the bar" is the navy top bar, "Search" is ⌘K, "the + button" is Create.

---

## 0. Scope

### Routes covered

The shell has no content routes. It owns these files and the frame every dashboard page renders inside:

| URL / surface | File |
|---|---|
| every `(dashboard)/*` route (the frame) | `src/app/(dashboard)/layout.tsx`, `src/components/layout/os/os-shell.tsx`, `click-app-rail.tsx`, `click-sidebar.tsx`, `click-topbar.tsx`, `shell-context.tsx`, `src/lib/rail-apps.ts`, `apps-catalog.tsx` (hub entries and `FOLDED_INTO_HUB` only) |
| route transition loader | `src/app/(dashboard)/loading.tsx` |
| in-shell error boundary | `src/app/(dashboard)/error.tsx` |
| in-shell 404 | `src/app/(dashboard)/not-found.tsx` |
| root 404 (unknown top-level path on the app host) | `src/app/not-found.tsx` |
| last-resort boundary | `src/app/global-error.tsx` |
| settings takeover frame (`/settings/*`, `/account/*` container only) | `src/components/layout/os/settings-shell.tsx` (contents: settings unit per `settings-architecture.md`) |
| `/loader-preview` | `src/app/loader-preview/page.tsx` |
| overlays with no URL | `command-palette.tsx`, `create-menu.tsx`, `notifications-popover.tsx`, `reminders-bell.tsx`, `reminder-ticker.tsx`, `reminder-popover.tsx`, `notepad-panel.tsx`, `voice-capture-popover.tsx`, `my-work-panel.tsx`, `profile-menu.tsx`, `workspace-menu.tsx`, `customize-panel.tsx`, `apps-more-popover.tsx`, `set-status-modal.tsx`, `active-timer-pill.tsx`, `top-pins-strip.tsx`, `calendar-peek.tsx`, `planner-modal.tsx`, `item-drawer.tsx`, `quick-capture.tsx`, `theme-applier.tsx`, `toast.tsx`, `src/components/ui/toast.tsx`, `src/components/ui/dialog-provider.tsx`, `src/components/tour-provider.tsx`, `src/components/ui/back-button.tsx`, `src/components/system/go-back-button.tsx`, `src/components/brand/mission-splash.tsx`, `dots-loader.tsx`, `value-loader.tsx`, `src/hooks/use-goto-nav.ts`, `src/components/layout/consent-banner.tsx`, `consent-provider.tsx`, `providers.tsx` |

### Frames this unit does not own (named so no frame is orphaned)

The shell is the `(dashboard)` frame only. The other four frames in `src/app` are assigned here so route coverage has no hole:

| Frame | Owner | What this spec still contributes |
|---|---|---|
| `(auth)` layout (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/welcome`) | account and auth unit (`spec-account-auth.md`) | the cookie consent banner mounts here (§1.13) and the signed-out 404 renders here (§2.5). Nothing else. |
| `(admin)` host layout (`/admin`, `/admin/companies`, `/admin/companies/[id]`, `/admin/staff`, `/admin/analytics`, `/admin/appsumo`) | back-office unit (`spec-admin-backoffice.md`) | the inline lime "Restricted" page is replaced by the `LockedPage` family per access spec §6.4; `/admin/analytics` and `/admin/appsumo` are the two routes no inventory audited (critic `missedRoutes`) and the back-office unit owns them. The `(dashboard)` rail, sidebar and bar never render on the admin host. |
| `(public)` layout (`/meet/[code]`, `/run/[token]`, `/share/doc/[token]`, `/share/sop/[token]`, `/sign/[token]`) | the unit that owns the shared object (Talk, Process, Docs, Process, Docs respectively) | nothing; a public token page has no shell, no rail and no session. Tokens carry at most Can view (access spec §12 public-link policy). |
| `(public)` `/forms/[id]/respond` (change request T1, landed in Phase 5 stage A) | Tables and Forms unit (`spec-tables-forms.md`) | nothing; no shell, no session required to READ the form. The one public page whose purpose is a write: the link itself carries Can view, and Submit requires sign-in (access invariant 19) until founder decision D16's per-form switch ships. It rides on the edge gate's path exception (`src/lib/nav/public-app-paths.ts`), because its first segment is an app prefix. |
| `/embed/forms/[id]`, `/embed/tables/[id]` | Tables and Forms unit (`spec-tables-forms.md`) | nothing; an embed renders the object alone with no chrome. |

`src/app/icon.tsx`, `apple-icon.tsx` and `opengraph-image.tsx` (critic `missedRoutes`) belong to the marketing unit's brand pass; the shell only asserts that they draw the four dots from the brand hexes, not from `--os-dot-*` (edge runtime has no CSS variables).

### Routes and surfaces in this unit that are REMOVED / REDIRECTED / MERGED

Every destination stays reachable; the target is named.

| Today | Disposition | Target and reason |
|---|---|---|
| Rail "More" launcher tile (`apps-more-popover.tsx`) | merged | Search (⌘K) "Apps" group, which lists every hub and every folded app the viewer may open (`visibleApps`). The design system removes the ⊞ tile; the launcher's job survives in the palette and every folded app also has a hub-sidebar row (§1.2). Component deleted. |
| Rail "Invite" button | merged | Workspace menu › "Invite people" (renders only when `can(viewer, "invite_member", org)`), and Settings › Members. |
| Rail "Upgrade" link (`/settings`) | merged | Workspace menu › "Upgrade" → `/settings/billing`, Owners and `billing`-scope Admins on non-Enterprise plans only. The rail carries hubs only. |
| Hover-preview of hub sidebars (`previewAppKey`) | removed | Rail icons show a tooltip; the sidebar follows the URL only (§1.1). Preview was the second source of the sticky-sidebar bug. |
| Sticky `activeAppKey` (localStorage `workwrk:os:active-app`), `lens`, `recent-apps` as nav state | removed | Hub and row are derived from the URL (§1.1). `recent-apps` survives only as the palette's Recent section (localStorage ephemera, not navigation state). |
| Top bar quick-tool icon row + profile-menu "Personal Tools" pins (`workwrk:os:profile-tool-pins:v2`) | merged | The one "+" Create menu on the bar (§2.10). Pins are retired; `sidebar.quickTools` is not shipped (flagged to the settings spec, §4). |
| `MyWorkPanel` (`my-work-panel.tsx`, 380px right slide-over fed by `GET /api/me/work`, opened from the quick-tool icon, the profile menu and the palette command "Open My Work") | merged | **Work › My work (`/my-work`)**, which is the same data as a page with the same name (§1.3). The panel is a second door to one destination and the canon allows one. Every entry point survives: the rail's Work hub (which lands on `/home`, one row above), the palette's JUMP TO "My work" row, and the Work sidebar's "My work" row. `GET /api/me/work` stays; the work and home unit decides whether `/my-work` keeps it or serves the same buckets from its own loader. Component deleted, the palette's "Open My Work" command deleted (it is a JUMP TO row now). |
| `CreateSprintModal` (`os-shell.tsx:122`) | re-parented | The Work unit (sprints belong to a List's menu, not to the shell). It is not mounted in the frame and is not in the Create menu; it opens from the List "…" menu the Work unit specifies. Until the Work unit lands it stays mounted unchanged. |
| `QuickCaptureHandler` (`⌘⇧N`, `os-shell.tsx:119`) | replaced | The chord goes (browser-reserved on Windows, §1.8) and the component goes with it. Its job, "make a note in one keystroke from anywhere", is the Create menu's **Notepad** row (§2.20) and the palette's CREATE › Notepad row; the Notepad panel opens with a fresh note when it is opened with no note selected, so nothing is lost. |
| `DialogProvider` (`(dashboard)/layout.tsx:77`, the app-wide `useConfirm` / `usePrompt` used by 68 files) | kept, restyled | Stays mounted at the dashboard root. Its confirm and prompt dialogs become 400px Radix modals on design-system §5.5 anatomy (header 56 with ✕, body 24, footer 64, Cancel ghost left of one primary; destructive confirms use `--os-danger-solid`), register a layer so Esc is the shell's single listener (§1.5), and read tokens only. No behaviour change; 68 call sites are untouched. |
| `TourProvider` (`(dashboard)/layout.tsx:78`, auto-launches `ADMIN_TOUR_STEPS` / `EMPLOYEE_TOUR_STEPS` on first login) | kept, disarmed | Stays mounted so the onboarding unit can rewrite the steps, but **never auto-launches from the shell**: the shell renders it only when `TOUR_STEPS.length > 0` and only on an explicit "Take the tour" from the Help menu (§2.13). The stale steps in `src/lib/tour-content.tsx` point at chrome this spec deletes (the More tile, the quick-tool row); the onboarding unit rewrites or empties them (`shell.md` #31). |
| `ScreenProtection` (`(dashboard)/layout.tsx`, renders `null`) | removed | Dead code; also listed below. |
| Top bar calendar glyph + `PlannerModal` peek | removed from the bar | Planner hub (rail). The Planner unit decides whether a week-peek survives inside its hub; the bar has no second calendar door. |
| Top bar Ask AI pill (`ask-ai-button.tsx`) | merged | ⌘J opens the Ask AI panel; the page-header "Ask AI" slot (design system §4.4); the palette's "Ask AI about…" row. No AI button on the bar. |
| Notifications bell + Reminders bell + Inbox glyph (three badges) | merged | One bell (§2.11) with Inbox and Reminders tabs; `/inbox` stays the full page (Work unit). |
| `TopPinsStrip` (`/api/me/pins`) | merged | Work hub sidebar FAVORITES section; pins are favorites. Strip deleted; `/api/me/pins` rows migrate into favorites (Work unit owns the API). |
| Profile menu "Trash" | moved | Work hub sidebar row "Trash" for every Member (settings spec §7.1a). |
| Profile menu "Themes" → `/settings?tab=themes`, "Keyboard shortcuts" → `/settings?tab=shortcuts`, "Notifications" → `/inbox`, "Settings" → `/settings` | rewired | Theme is an inline segmented control in the avatar menu; Keyboard shortcuts → the `?` overlay and `/account/shortcuts`; Notifications → `/account/notifications`; Settings → "My settings" (`/account/profile`) and "Workspace settings" (`/settings`, Owner and Admin). Redirects for the two `?tab=` URLs are the settings spec's (§8.4). |
| Set status modal (localStorage presence, "For Cashkr Team") | rewired | Writes `User.presenceStatus` / `presenceUntil` via `PATCH /api/users/[id]` (settings spec §4.4); org name from the session; expiry enforced server-side. |
| Mute notifications (localStorage) | rewired | `home.notifications.mutedUntil` via `PATCH /api/preferences`; honoured by `shouldNotify`. |
| Reminder popover (`reminder-popover.tsx`), Notepad panel (`notepad-panel.tsx`), Voice note popover (`voice-capture-popover.tsx`) | kept, respecified | All three are live destinations and all three stay, opened from the one Create menu (§2.10) and the palette's CREATE section. They are specified in §2.19, §2.20 and §2.21 so the token sweep (hard-coded `#0073EA`, `#FB5A6F`, `#FBE9AE`), the loader sweep (`Loader2`) and the one-Esc rule have a surface to land on. The `workwrk:tool` window-event plumbing is replaced by the `LayerStack` (§2.1). |
| Two accent pickers (`customize-panel.tsx` and `/account/preferences`) | removed | No accent control anywhere: one blue is the system (design system §1.4 rule 1, §10 decision 6). Hard dependency, named so it is not forgotten: design system §8.5 step 1 deletes the ten `data-accent` CSS blocks and normalises every stored `OrgPreference`/`UserPreference` accent to `blue`, which makes the settings spec's surviving Accent row on `/account/preferences` (settings spec §4.2, seven keys from `src/lib/accents.ts`) decorative. That row is therefore **deleted in the same PR**, not hidden, and settings open decision 5 / Phase 2 Q4 is answered by the token PR being load-bearing. Flagged to the settings spec. If the founder keeps accents, the deletion of the two pickers stands and the accent lives only on `/account/preferences` against a restored `data-accent` block. |
| Legacy `item-drawer.tsx` (demo-era, fabricated updates) | removed | `BoardItemDetail` drawer (Work unit) is the one task drawer. Its three callers (`kanban.tsx`, `main-table.tsx`, `calendar.tsx` module demos) are deleted with it (Work unit confirms). |
| `SettingsSidebar` hub sidebar (`apps-catalog.tsx:1208`) | removed | Settings is a takeover; its rows are re-parented per settings spec §7.1 (Build, Store, Integrations → AI hub; Tools, Assets → Teams; Trash → Work). |
| `/loader-preview` (public, outside auth) | removed | Deleted. The loader family is documented in the design system §5.15; a dev gallery, if wanted, lives in Storybook, not a public route. |
| `useGoToNav` (never mounted) | replaced | `src/lib/shortcuts.ts` registry (§1.8), mounted once in `OsShell`. |
| `ui/toast.tsx` `ToastProvider` in the dashboard layout | removed | `useOsToast` is the one toast (bottom-left). `ui/toast` stays only if marketing uses it; otherwise deleted. |
| `components/system/go-back-button.tsx` | merged | `ui/back-button.tsx` `BackButton{fallbackHref}` with a label. |
| `MissionSplash` 10-minute navigation re-trigger | removed | Splash policy §1.6: boot only, per the org setting. |
| `ValueLoader` in `loading.tsx` and in-panel spinners (`Loader2`, "Loading…") | replaced | Skeletons plus one value line; the rail logo pulse is the route loader (§1.6). |
| `ScreenProtection` (renders null), `TopbarPopoverButton`, `kudos/candor/surveys-popover.tsx` (unmounted) | removed | Dead code. Culture doors are the Teams unit's. |
| `html.night` theme, `ThemeProvider defaultTheme="dark"` in `providers.tsx` | removed | One `ThemeApplier`; default Light (§1.9). |
| Cookie consent banner inside the authenticated app | moved | Marketing and `(auth)` layouts only (§1.10). |
| `⌘B` sidebar toggle, `⌘1..9` hub jumps, `⌘⇧N` quick capture, "⌥T" label, "G T" hints | replaced | The keyboard map in §1.8 (every advertised chord is delivered by Chrome, Safari, Firefox and Edge on macOS and Windows). |

### Audit inventories consulted

`shell.md`, `misc-apps.md`, `critic-gaps.json`, plus `settings-pages.md` §0 by reference through `settings-architecture.md`.

### Audit issue IDs this unit resolves

`shell.md` §4: High 1, 2 (framework rule; page-level deletions by owning units), 5, 6, 7, 8, 9, 10, 11 (the framework half: launcher, URL highlighting, folded-app rows); Medium 12, 13 (rule), 14 (rule), 15 (`/loader-preview`), 16, 18, 19, 21, 22 (shortcut label), 24, 25, 26, 27, 28, 29 (shell labels, including the My Work and My profile collisions), 30, 31 (the shell half: the tour never auto-launches and has one door), 32, 38, 39 (framework rule); Low 35, 36, 37, 41, 42, 44. §0.1's mounted-overlay inventory: the three personal-capture overlays (`my-work-panel`, `notepad-panel`, `reminder-popover`, `voice-capture-popover`) and the four un-disposed shell mounts (`CreateSprintModal`, `QuickCaptureHandler`, `DialogProvider`, `TourProvider`), each given a disposition in the table below and, where kept, a route block in §2.
`misc-apps.md` §0 (navigation for unmatched routes), §3 #4 (dead trio, framework rule), #13 (fake avatars, framework rule), #14 (hidden empty-state CTAs, framework rule), #21 (loader inconsistency), §4 back navigation and loader conventions.
`critic-gaps.json` topSystemicIssues: #1 (navigation decoupled from the URL, folded apps unreachable), #2 (fabricated chrome, the framework half), #5 (back convention), #6 (the shell half of the five visual systems), #10 (desktop-only shell, tablet behaviour), #11 (errors swallowed, no 401 handling), #13 (locale resolution and RTL of the shell), #15 (Coming-soon controls, stale shell comments). `missedSurfaces`: session expiry, cookie banner in the app, i18n/RTL, keyboard system, RealtimeClient behaviour, Settings sidebar leaking onto non-settings routes, root not-found without chrome. `contradictions`: More launcher contents, URL-driven highlighting, g-chords, rail width, Settings hub sidebar visibility, dark mode.

---

## 1. Unit-level rules

### 1.1 Hub + sidebar: URL-derived, never sticky

**The rule.** The active hub and the active sidebar row are pure functions of `location.pathname + location.search`. Nothing about navigation is stored in localStorage or shell context. `activeAppKey`, `previewAppKey`, `setActiveApp`, `lens` and the `workwrk:os:active-app` key are deleted from `shell-context.tsx`.

**Hub resolution** (`resolveHub(pathname): HubKey`, in `src/lib/nav/route-hub.ts`, pure, unit-tested):

1. `/settings/*` and `/account/*` → `settings`.
2. Longest-prefix match over `ROUTE_HUB`, a table with one row per route directory under `src/app/(dashboard)`. A prefix matches when `pathname === prefix` or `pathname.startsWith(prefix + "/")`. Longest prefix wins, so `/docs/trash` and `/docs` both resolve to Docs, and `/people/me` resolves like `/people`.
3. No match → `home` (Work) with no sidebar row active. A test asserts every directory in `route-list.txt` under `(dashboard)` has a row; adding a route without a row fails CI.

`ROUTE_HUB` (the complete table; "disposition" names the unit that may later redirect the route, which only removes the row):

| Hub | Prefixes |
|---|---|
| `home` (Work) | `/home`, `/my-work`, `/inbox`, `/everything`, `/item`, `/spaces`, `/folders`, `/boards`, `/okrs`, `/trash`, `/templates`, `/me/weekly-review`, `/me/mentions` (redirects to `/inbox?tab=mentions`, settings spec §8.4), `/assigned-comments` (Work unit disposition), `/activity` (Work unit), `/marketing` (misc unit disposition; until then Work) |
| `planner` | `/planner`, `/calendar`, `/timesheets`, `/meetings` (Planner unit disposition), `/clock` (Planner unit disposition) |
| `ai` | `/sidekick`, `/ai`, `/agents`, `/automation`, `/autopilot` (AI unit disposition), `/build`, `/store`, `/integrations`, `/favorites` (pinned AI chats; AI unit renames) |
| `chat` (Talk) | `/tlk`, `/announcements` |
| `teams` | `/team`, `/people`, `/organization`, `/kra-kpi`, `/reviews`, `/talent`, `/candor`, `/kudos`, `/surveys`, `/analytics`, `/tools`, `/assets`, `/ideas` (Teams unit disposition) |
| `docs` | `/docs`, `/library`, `/files` (Docs unit merges into Library), `/canvas`, `/notetaker`, `/sops`, `/process-runs`, `/policies`, `/agreements` |
| `tables` | `/tables`, `/forms` |
| `settings` | `/settings`, `/account`, `/imports` (§2.8 gives the mechanism; settings spec §5.10 folds it into Data › Import and the row is removed here when it does) |

Three prefixes left the `home` row and one is confirmed to stay. `/today`, `/dashboard` and `/tasks` are 308s into `/home` and `/my-work` (work and home unit), and a 308 never needs a `ROUTE_HUB` row because it is resolved before the hub is; the CI completeness test reads the redirect table alongside the route list so a redirected directory does not fail it. `/templates` stays a Work row: the Docs unit's change request S1, which asked to move the prefix to `docs`, is declined (§5), the page is owned by the spaces and lists unit, and the Docs hub reaches doc templates through `/templates?kind=doc` rather than through a hub of its own.

`AppEntry.matchPaths` is deleted; `ROUTE_HUB` replaces it. `findAppForPath` is deleted. Folded apps carry `hubKey` instead of `offRail` so the catalog says where each app's rows live.

**Sidebar row resolution** (`resolveActiveRow(rows, pathname, search)`, shared by every hub sidebar through the `SidebarRow` primitive, §3): every row declares `href` and `match: "exact" | "prefix"` (default `prefix`). A row with a query string (`/okrs?mine=1`) matches only when every declared param equals the current one. The active row is the matching row with the longest `href`; ties go to the row declared first. Exactly one row is active or none; the first row is never a fallback. Rows never take an `active` prop.

**Rail highlight**: `aria-current="page"` and the white pill on `resolveHub(pathname)`. When the resolved hub is hidden from this viewer (rule 2 of the access model, or the module is off), the page is a `<ModuleOff>` / `<AppOff>` view (access spec §5.5) and no rail item is highlighted.

**Rail click** navigates to the hub's `defaultHref` (Work: `/home`; Planner: `/planner`; AI: `/sidekick`; Talk: `/tlk`, or `/announcements` when the Talk module is off; Teams: `/people`; Docs: `/docs`; Tables: `/tables`; Settings: `/settings` for Owner and Admin, `/account/profile` for everyone else per settings spec §2.3). Clicking the already-active hub reopens a collapsed sidebar and otherwise does nothing.

Three of those eight are settled against an earlier draft of this table and are written out so nobody re-derives them:

- **Work opens `/home`**, not `/today`. The work and home unit builds two destinations with two labels, Home (`/home`, the quiet widget page) and My work (`/my-work`, the full list of tasks assigned to you), and 308s `/today` and `/dashboard` into `/home`. Two URLs carrying two labels do not break the one-label-per-destination rule; the rule this spec used to cite was written against a `/today` that was itself a redirect into the first Space (§1.3).
- **Teams opens `/people`** (the Directory), not `/team`. `/team` is gated on having reports, so a rail pill pointed at it would land a plain Member on a denial as their first screen. Access spec §5.2.1 gives every Member the Directory, so `/people` is the one URL that is safe for everyone and the rail stays a static table with no viewer branching. **My team** is row 2 of the Teams hub sidebar, and every notification whose subject belongs on `/team` links straight there rather than through the rail.
- **Talk is the one conditional `defaultHref` in the table**, and it is conditional on module state only: `/tlk` when the Talk module is on, `/announcements` when it is off, because Announcements is not module-gated and the hub must stay reachable. Two consequences: `visibleApps` keeps the chat hub when the Talk module is on **or** the viewer may see the folded `announcements` app, and with the module off the Talk sidebar renders the Announcements row alone (§1.2 rule 3). `ROUTE_HUB` itself never branches on module state; it stays a pure static table, and the branch lives in `defaultHref` alone.

### 1.2 Hub sidebar container (the rules every hub obeys)

Hub units fill the rows; the shell renders the container. The container (`HubSidebar`, `src/components/layout/os/hub-sidebar.tsx`) accepts a `SidebarSpec` from the hub unit:

```ts
type SidebarSpec = {
  hub: HubKey;
  create?: CreateAction[] | "global";     // the header "+" (see below)
  sections: SidebarSection[];             // in order; hub units may reorder personal-first
  searchable?: boolean;                   // default: true when total rows > 12
};
type SidebarSection = {
  key: string; label?: string;            // label omitted = the top, unlabelled personal block
  collapsible?: boolean;                   // default true when labelled
  hideWhenEmpty?: boolean;                 // FAVORITES uses this
  rows: SidebarRowSpec[] | { loader: () => Promise<SidebarRowSpec[]> };   // async sections show skeleton rows
  emptyLine?: string;                      // one quiet sentence when a loaded section has no rows
};
type SidebarRowSpec = {
  key: string; label: string; href: string; match?: "exact" | "prefix";
  icon?: LucideIcon | { tile: EntityTileProps };
  count?: number | (() => Promise<number>); dot?: "unread" | null;
  children?: SidebarRowSpec[];             // tree rows; indent 20 per level
  menu?: MenuItemSpec[];                   // the single "…" on hover
  locked?: boolean;                        // findable Space with no role: grey + lock, opens LockedPage
  gate?: AppKey;                           // row renders only when visibleApps includes the key
};
```

Rules:

1. **Gating is by `visibleApps` only.** A row with `gate` renders when `can(viewer, "view", { type: "app", key })` is true (access spec §5.2.1 and settings spec §7.1a). No row reads `accessLevel`, `useRole`, `canAccessTier` or a tier Set; the ESLint rule from the access spec applies to `src/components/layout/os/**`.
2. **Order inside a hub**: unlabelled personal block first (Work: Home, My work, Inbox; Docs: My docs, Shared with me), then FAVORITES when non-empty, then the hub's labelled sections. Hub units define the labels; the shell defines the look (11/600 uppercase, +0.06em, `--os-ink-2`, 1px `--os-line` rule to the right edge, 24px top margin, 8px bottom).
3. **Folded apps are sections or rows, never separate sidebars.** `FOLDED_INTO_HUB` (`apps-catalog.tsx:1422`) holds exactly **19** keys, and this is the list, in the file's order, with the hub each one moves to per settings spec §7.1a: `goals` (Work), `timesheets` (Planner), `library` (Docs), `clips` (Docs), `sops` (Docs), `policies` (Docs), `agreements` (Docs), `reviews` (Teams), `candor` (Teams), `kudos` (Teams), `surveys` (Teams), `announcements` (Talk), `forms` (Tables), `automation` (AI), `tools` (Teams), `assets` (Teams), `build` (AI), `store` (AI), `trash` (Work). The five keys that today fold into Settings (`tools`, `assets`, `build`, `store`, `trash`) are re-parented by that table, which is why `SettingsSidebar` can be deleted. Four more destinations behave like folded apps but are routes rather than catalog keys, so they are not in the 19 and must not be counted against `FOLDED_INTO_HUB`: `/talent`, `/analytics` and `/team/rollup` (Teams) and `/integrations` (AI); access spec §5.2.1 gives each its own `APP_RULES` row and this spec's `ROUTE_HUB` (§1.1) gives each its hub. A CI test asserts the 19 keys in the file equal the 19 listed here and that every one has a `hubKey`; settings spec §7.1a's count of "20" is superseded by the file. `LibrarySidebar`, `FormsSidebar`, `ClipsSidebar`, `GoalsSidebar`, `TimesheetsSidebar`, `linksSidebar(...)` and their `createActions` are deleted; the hub units re-declare what survives.
4. **Counts and dots**: a count is 12/500 `--os-ink-2` right-aligned (`--os-ink-strong` on the active pill); an unread dot is the `Dots unread` variant at the row's right when `count` is absent. Counts come from the row's loader, refreshed by the SSE events named in §1.11, never by per-row polling.
5. **Hover reveals one "…"** (32px ghost icon, `MoreHorizontal`) at the row's right; Star, "+", Rename, Share, Mute and the rest live inside it. No three-icon hover clusters. The star inside the menu writes favorites. **This is the one rule for the row menu and it is stated only here** (design system §4.2 wins on look, and §1.16 no longer repeats it). Hover-reveal is safe because the button is always in the tab order and `:focus-visible` reveals it at full opacity, and because `@media (hover: none)` renders it at rest on touch and other coarse pointers. Hover-only discoverability (`shell.md` Low 38) is a finding about the sidebar's **search field and collapse chevron**, not about this menu; those two are always visible (§1.16).
6. **Section empty**: one line `emptyLine` 13/400 `--os-ink-2`, 36px, no card, no illustration ("No favorites yet", "No Spaces shared with you yet"). Sidebar sections never render `OsEmptyView`.
7. **Section error**: one 36px line "Couldn't load {section} · Try again" with the link wired to the loader; the sidebar never renders empty on a failed fetch (§1.7).
8. **Section loading**: three skeleton rows (36px, bars 60/40/80%) for at most the first load; never a spinner.
9. **Header "+"**: one 32px ghost icon button (`Plus`) at the right of the workspace switcher row; tooltip "New in {Hub}". `create: "global"` (Work) opens the same Create menu as the bar's "+" (§2.10). A list of `CreateAction`s with one entry fires it; two or more open a `MenuList`. Each action carries `gate` (an `Action` + `ObjectRef` or an org action) and renders only when allowed. No "+" when the viewer can create nothing here.
10. **Searchable**: the in-place filter input (36px, white, `--os-line-strong`, magnifier 16px, placeholder "Search {Hub}…", ✕ when non-empty) renders under the header only when the tree exceeds 12 rows; it filters rows by label in place and never navigates. It is not the global Search.
11. **Persisted state** (settings spec §9.2): `sidebar.width` (240 to 320, default 264, debounced 500ms), `sidebar.collapsed`, `sidebar.sectionsOrder` (per hub, keyed `{hub}.{section}`), `sidebar.collapsedSections[]` (new key, flagged to the settings spec), all via `PATCH /api/preferences`, never localStorage. `sidebar.iconsOnly` is dropped with the icons-only option (settings spec open decision 14: drop).
12. **Locked rows** (findable Spaces the viewer holds nothing on, access rule 14): label in `--os-ink-3` with a 16px `Lock` glyph, click opens the `LockedPage` at the Space URL. Folders and Lists render only as container labels above something the viewer holds (access spec §5.3).

### 1.3 Naming canon (shell-owned labels)

| Destination | The one label | Replaces |
|---|---|---|
| The first rail hub | **Work** | Today, Home (as a hub name) |
| Work hub landing (`/home`) | **Home** | Today, Dashboard, the first Space overview, "My Wrk" as a landing |
| The full list of tasks assigned to you (`/my-work`) | **My work** (design system open decision 8) | My Wrk, My Work panel, My tasks, All Tasks, Assigned to me, Today & Overdue |
| Your own person record (`/people/me`) | **My profile** | Me, My Profile, My KRAs & KPIs, my profile |
| `/inbox` and the bell's first tab | **Inbox** | Notifications (the bell's tooltip says "Notifications", its content is "Inbox" and "Reminders") |
| The bar's magnifier field and ⌘K | **Search** | Command palette, Jump to |
| The bar's "+" | **Create** | Quick tools, Personal Tools, quick task icon |
| The AI panel and ⌘J | **Ask AI** | Brain, Sidekick, AI Engine, Super Agent |
| The personal settings door | **My settings** | Settings, Personal, Account |
| The org settings door | **Workspace settings** | Settings, Admin |
| Starred objects | **Favorites** | Pins, Top pins, Starred |
| The comms hub | **Talk** | TLK, Room, Chat |
| The rail hubs | Work, Planner, AI, Talk, Teams, Docs, Tables, Settings (exact labels; max 9 characters) | Home, Sidekick, Chat, People |
| Sidebar footer | **Customize Sidebar** (kept per memory) | Customize navigation |
| Deleted objects | **Trash** (one, Work hub row) | Recycle bin, Archived, Contracts Trash, Notes trash |
| Help door | **Help** | Support, ? |
| Sign out | **Log out** | Sign out |

Two label questions the canon settles outright, because other units inherit them. The first is not a collision at all once the two destinations are separated; the second is:

- **Home and My work are two rows, two labels, two URLs.** Design system §4.2 and §1.2 rule 2 write the Work personal block as "Home, My work, Inbox", and that is exactly what ships: **Home** (`/home`, the quiet widget page), **My work** (`/my-work`, the full assigned list) and **Inbox** (`/inbox`). An earlier draft of this section deleted the Home row on the grounds that one destination may carry one label; that reading was wrong here, because these are two destinations. It was written against a `/today` that was itself a redirect into the first Space, which really was one destination wearing two names. The rail hub above the block is labelled **Work** and its `defaultHref` is `/home`, so "go home" is the rail click and "go to my work" is one row below it. `/today` and `/dashboard` are 308s into `/home` (work and home unit) and carry no shell label. The Space overview that design system open decision 8 keeps "one sidebar row away" is a row in the SPACES tree, not a personal row.
- **`/people/me` is "My profile" everywhere**, including the avatar menu (§2.12) and the Teams sidebar. It is a Teams-hub route, and a Guest never sees the Teams hub (access spec §2.3), so for a Guest the avatar menu's My profile row points at `/account/profile` (My settings › Profile) instead; the label does not change, the destination does. Teams unit owns the page.

Labels come from `src/lib/nav/labels.ts` (shell) and `src/lib/access/labels.ts` (roles); hub sidebars import them.

### 1.4 Access

The frame renders for every signed-in person whose status is **Active**. A **Deactivated** person cannot sign in at all, so the frame never has to handle them mid-session beyond §1.10 (a deactivation during a session arrives as a `tokenVersion` bump and lands on the Session-expired dialog). Active and Deactivated are the only two words the access model uses (access spec §2.1 and settings spec §9.2a), and they are the only two this spec uses.

The `UserStatus` enum in `prisma/schema.prisma:609` carries four more values, which are employment states and not access states. They map for the frame as: `ACTIVE`, `PROBATION`, `ON_LEAVE`, `PIP`, `NOTICE_PERIOD` are all **Active** (a person on leave or on notice still opens the app), and `INACTIVE` is **Deactivated**. Nothing in the shell reads the enum; `/api/boot` returns `viewer.active: boolean` and that is the only thing the frame sees. Flagged to the access spec: its precedence rule 1 says "status not ACTIVE or PROBATION", which would lock out a person on leave; it should read "not Active" against this mapping.

What differs by role is only which hubs and rows exist:

| Viewer | Rail | Bar | Sidebar |
|---|---|---|---|
| Owner, Admin | every hub the org has not hidden; Settings opens Workspace settings | full | full |
| Member (Agent included) | every hub the org allows for Members (`visibleApps`); Settings opens My settings | full; "+" hides Space creation for Agents; no Export anywhere | full minus rows gated to reports, People team or Admin |
| Member with reports, People team | as Member plus the Teams rows their rule allows | full | plus those rows |
| Guest | Work always; Docs, Tables, Talk only when something is shared there and the module is on; Settings (My settings) | Search returns only readable objects; "+" offers Task only when they hold Can edit on a List; no Invite | only the objects they hold, as bare container labels (access spec §2.3) |

The rail and every sidebar row call `visibleApps(viewer)` from `/api/boot` (§1.12), the same function `gatePage` uses, so a hub icon and its route never disagree (closes `shell.md` §3.5 and critic #4's nav half).

**A hidden or floored app is absent, for everyone, with no exception.** The access model is the deciding doc and it says the list row is absent whenever the decision is `app-off` or `module-off` (access spec §5.3), so `visibleApps` never returns the key and the rail never renders a nav item for it. That keeps "a hub icon and its route never disagree" literally true.

**The one hub that is not its own module: Talk.** A hub key is absent when the hub has nothing in it, which is not the same test as "the module is off". `visibleApps` returns the `chat` key when the Talk module is on **or** the viewer may see the folded `announcements` app, because Announcements is not module-gated and lives in that hub; with the module off the hub is still real, its `defaultHref` is `/announcements` (§1.1) and its sidebar renders the Announcements row alone. `visibleRailApps` is written against that two-part test rather than against the module switch. This is a rule about which apps a hub contains, not a widening of the module rule: `/tlk` itself still renders `<ModuleOff>` with the switch, and a viewer who may see neither chat nor announcements has no Talk hub at all.

The settings spec's G20 ("an off premium module's rail icon renders dim with an Off dot for Owners and Admins") is honoured without widening `visibleApps`, because what G20 actually asks for is a one-click way for an admin to turn the module back on. The resolution:

- `/api/boot` returns a second, separate list, `manageableOffModules: AppKey[]`, non-empty only for Owners, Admins and `security`-scope Admins, holding the premium modules (Talk, Tables) the org has switched off. It is a settings affordance, not navigation.
- The `Rail` renders those below the hub list as **off-module tiles**: the hub's icon and label at 40% `--os-chrome-fg-2`, a 6px `--os-line-strong` dot at the icon's top-right, `aria-disabled="true"`, never `aria-current`, excluded from the `G n` numbering and from arrow-key traversal (they come after the hubs in the tab order), tooltip "Talk is off · Turn it on in Settings".
- Click navigates to the hub URL, which renders `<ModuleOff>` with the on/off switch, exactly as access spec §5.3 and example K describe. The switch is on that page; the rail only points at it.
- Apps hidden or floored by the Apps config get **no** tile, for anyone including Admins, because their control is a different page (`/settings/apps`) and a floor is a deliberate org choice rather than a switch someone forgot. Access spec §5.5 item 6 already sends Admins there from `<AppOff>`.

Flagged to the settings spec: its §5.3 line "`visibleRailApps` gains `viewerCanManageModules`" is implemented as this separate `manageableOffModules` list, not by returning the key from `visibleApps`.

Read-only mode inside the frame: none; the frame has no content controls. Denial: the shell never redirects on denial. The one denial redirect in the system is `/login?callbackUrl=<current>` when the session is absent (access spec §5.5). Everything else renders `LockedPage`, `ModuleOff`, `AppOff`, `AdminOnly` or the in-shell 404 at the same URL with the rail, sidebar and bar intact. The app has exactly one other redirect and it is not a denial: `!setupCompleted` sends a signed-in person to `/onboard` at boot (§1.12). It is declared here so the invariant reads correctly: **no denial ever redirects; two boot conditions do, and they are sign-in and finish-setup.**

### 1.5 Back and close: the whole-app convention

Three mechanisms, three jobs: the bar's ‹ › for history, the breadcrumb for hierarchy, the sidebar pill for where you are.

| Situation | Control | Target |
|---|---|---|
| Any full page reached from a list (doc, SOP, goal, review, role, person, canvas, sheet, form builder, meeting, campaign) | `BackButton{fallbackHref, label}` in the title row, 28px ghost, `ArrowLeft` + parent name 13/500 | browser back when the in-app history stack (`navStack`, §2.1) has an entry; otherwise `fallbackHref` = the natural parent. Bare `router.back()`, `history.back()`, `router.push(parent)` buttons and text-link "← All …" are forbidden by lint (`no-restricted-syntax` on `history.back(` and `router.back(` outside `ui/back-button.tsx`). |
| Task, table row, person drawer | ✕ (32px ghost) in the drawer header, Esc | closes the drawer and replaces the URL with the list's URL (`router.replace`); the list underneath never reloaded |
| Drawer "Expand" | ⤢ | animates into the page (`/item/[id]`); its `BackButton` fallback is the list |
| Modal | Cancel, ✕, Esc, outside click | close; dirty forms confirm (Save / Discard / Keep editing, 400 modal) |
| Popover, menu, picker | Esc, outside click | close |
| Settings takeover | "← Back to app", Esc (no ✕ on the takeover bar, §2.8) | `closeSettings()`: `returnTo` if set and not a settings route, else `lastAppPath`, else `/home` (settings spec §8.3). Never a hard-coded destination beyond that last fallback. |
| Locked, ModuleOff, AppOff, 404, error pages | `BackButton{fallbackHref}` | the hub's `defaultHref` when nothing better is known |
| Esc anywhere | the shell's single window listener | **Esc closes the most recently registered layer in the `LayerStack` (§2.1), and nothing else.** One rule, no kind ordering, no z-index tie-break: a popover opened from inside a modal was registered after the modal, so Esc closes the popover and a second Esc closes the modal, even though `--os-z-popover 50` sits below `--os-z-modal 60`. Toasts and the offline strip are not layers and Esc never touches them; the splash is a layer and any key, not only Esc, skips it. A layer may refuse to close (the Session-expired dialog, §2.15; a dirty form, which opens its confirm as a new layer instead). Components never register their own Esc listeners; they register a layer. The five hand-rolled `keydown` listeners in `my-work-panel.tsx`, `notepad-panel.tsx`, `reminder-popover.tsx`, `voice-capture-popover.tsx` and `set-status-modal.tsx` are deleted with this rule. |
| `/item/[id]` archive | | returns to the List, else `/everything`. Today's hard-coded fallback was a dead `/home` href; `/home` is now a real route, so the fix is the fallback chain above rather than a deletion of the string |

The bar's ‹ › read `navStack`; the crumbs read the page's declared breadcrumb (§2.1). Every drawer has its page's URL so Copy link always works.

### 1.6 Loaders: one vocabulary

| Moment | What renders | Where the YBRG dots are |
|---|---|---|
| Boot (session resolving, `/api/boot` in flight) | full-screen `--os-chrome-bg` navy (`#1B2537` in every chrome variant). After 200ms the four-dot logo (28px) centred, dots pulsing. No text. | logo |
| Splash (per org setting `companyProfile.splash`) | on the same navy: dots 12px rising Y B R G (600ms, 80ms stagger), mission 16/400 white 72%, one rotating value 14/400, 1.2s hold, 160ms fade, skippable by any key or click. Never on navigation. The 10-minute re-trigger is gone. | splash |
| Route transition | after 200ms pending: the rail logo's dots pulse (900ms loop, 120ms stagger) and the content area renders `loading.tsx` (§2.2): skeleton header + skeleton rows + one 13/400 `--os-ink-2` value line. Rail, sidebar, bar stay interactive. No overlay, no progress line. | logo |
| Panel, popover, sidebar section, drawer body | `Skeleton` bars at the row height, 60/40/80%, 1.6s opacity pulse; no dots, no spinner, no "Loading…" text | none |
| Button in flight | `Dots pending` 16px monochrome replaces the icon; label and width preserved | none (monochrome) |
| Autosave | `AutosaveIndicator` states per design system §5.17 | none |

`DotsLoader` survives in exactly two consumers: `src/components/brand/logo.tsx` (rail logo at rest and pulsing, also the boot mark) and `mission-splash.tsx`. `ValueLoader` becomes `<ValueLine/>`: one text line, no dots, rendered only inside `loading.tsx` and long-running empty panels. `Loader2` and the string "Loading…" are lint errors under `src/components/layout/os/**` and `src/app/(dashboard)/**` after the sweep.

Splash setting: `Organization.settings.companyProfile.splash` = `every-open` (default, the founder's ask; "open" means a cold boot of the app, never a client navigation) · `first-open-daily` · `off` (settings spec §5.2, open decision 4). The shell reads it from `/api/boot`. `sessionStorage["workwrk:splash:shown"]` and `localStorage["workwrk:splash:day"]` implement the two throttles; they are ephemera, not settings. An org with no mission and no values never shows the splash.

### 1.7 Errors and empties: the framework

- **No swallowed fetch.** Every shell fetch goes through `apiFetch` (`src/lib/api-client.ts`): it returns `{ ok, data } | { ok: false, status, error }`, dispatches `workwrk:session-expired` on 401 (§1.10), `workwrk:offline` on network failure, and never resolves to an empty array on error. `catch(() => {})` and `catch(() => setRows([]))` are lint errors in the shell.
- **One empty primitive**: `OsEmptyView` restyled per design system §5.8 (four-dot line art by context, one sentence, at most one text link). Its `action` prop is required to be either `undefined` (no link) or `{ label, onClick | href }`; passing a bare `cta` string is a type error, so a CTA can never be silently hidden (closes `misc-apps.md` #14 and `shell.md` §3.3).
- **One error primitive**: `<ErrorState what="tasks" onRetry={refetch} reference={digest} />` = `OsEmptyView variant="error"`: four dots in a row, sentence "Couldn't load {what}", text link "Try again" (always wired), 12px reference id when present. Used by `error.tsx`, drawers, panels, popovers and any page body. Sidebar sections use the one-line form (§1.2 rule 7).
- **Toasts** (`useOsToast`, bottom-left, design system §5.7) for transient failures of a write: "Couldn't save. Try again" with the Retry action wired. Never for validation, never for a failed read (reads render `ErrorState` in place).
- **Offline**: a 32px `--os-warning-bg` strip under the bar, "You're offline. Changes will save when you reconnect." with a 16px `WifiOff`; shown on `workwrk:offline` or `navigator.onLine === false`, hidden on reconnect. Pollers pause while offline. `AutosaveIndicator` handles per-surface retry.
- **Shell chrome failures**: if `/api/boot` fails, the boot screen becomes an `ErrorState` on navy ("Couldn't open WorkwrK", Try again, and a "Log out" text link) instead of a blank. If a sidebar section fails, only that section shows the one-line error.

### 1.8 Keyboard map (advertised = working)

One registry, `src/lib/shortcuts.ts`, is the source for the window listener, every tooltip's kbd hint, the `?` overlay and `/account/shortcuts`. A chord is listed only if it is delivered to the page by Chrome, Safari, Firefox and Edge on macOS and Windows (the list below was checked against each browser's reserved set; `⌘T`, `⌘⇧N`, `⌘1..9`, `⌘W`, `⌘N` are reserved and never advertised). `⌘` reads as `Ctrl` on Windows and Linux in every label.

Global (the shell's single `keydown` listener; ignored while the target is an input, textarea, select or `contentEditable`, except ⌘K and Esc):

| Chord | Does | Scope note |
|---|---|---|
| `⌘K` | opens Search (the palette); inside a settings door it opens the door filter | works in inputs |
| `⌘⇧K` | Create task (the quick-task modal) | |
| `⌘J` | Ask AI panel (toggle); Members only, never advertised to Guests | |
| `⌘\` | collapse or expand the sidebar (replaces `⌘B`, which is bold in editors) | |
| `⌘/` | focus the settings filter (inside a door); elsewhere opens the shortcuts overlay | |
| `?` | shortcuts overlay | not in inputs |
| `G` then `1`…`8` | jump to the Nth rail hub in the org's order (the rail tooltip shows "G 1") | 1.5s window, not in inputs |
| `G` then `I` | Inbox (`/inbox`) | |
| `G` then `H` | Home (`/home`) | |
| `Esc` | closes the top layer | works in inputs (closes the layer that contains the input) |
| `↑ ↓ ↵` inside the rail (when focused) | move between hubs, open | `aria-current` on the active hub |

**Two chords the design system printed differently, settled in this spec's favour and no longer open.** Design system §4.3 and §4.7 printed `⌘T` and `⌘1..8`; both are browser-reserved, so advertising them would break the one rule this section exists to enforce, and the design system now prints `⌘⇧K` and `G 1..8` with the four peer specs (task detail, work and home, spaces and lists, goals) following. The shell owns `src/lib/shortcuts.ts`, which is the single source for the window listener, every tooltip hint, the `?` overlay and `/account/shortcuts`, so there is exactly one place the change lands.

1. `⌘1..8` for hub jumps is `G 1..8`. Chrome and Safari on macOS switch tabs on ⌘digit (`shell.md` High 8).
2. `⌘T` for quick task is `⌘⇧K`. `⌘T` opens a new tab in Chrome, Safari, Firefox and Edge on both platforms and is not deliverable to the page. `⌘⇧K` is free everywhere on the checked list and is what the registry, every tooltip, the `?` overlay and `/account/shortcuts` advertise. `⌘⇧N` (today's quick capture) goes for the same reason: it opens an incognito or private window on Windows. The button label is unchanged and stays **Create task**; only the chord beside it moves.
 Page-scoped chords (doc `⌘L`/`⌘D`, sheet `⌘F`/`⌘H`, list `↑↓ ↵`, drawer `⌘↵` save) are registered by the page via `useShortcut({ scope: "page", ... })` and appear in the overlay under "On this page"; the overlay shows only what is registered right now, so it can never advertise a dead chord. Every icon-only control's tooltip shows its chord from the registry (design system §5.13).

### 1.9 Dark mode, chrome and density policy

- Theme is `theme.appearance` = Light (default) · Dark · System, a segmented control in the avatar menu and My settings › Preferences; `ThemeApplier` writes `data-theme`, the `.dark` class and `color-scheme`. `providers.tsx` `ThemeProvider defaultTheme="dark"`, the `night` theme and `NightModeSync` are deleted. Dark ships behind the existing preference; the founder reviews the `#0C0F14` frame once before it is promoted (design system open decision 10).
- Chrome is `theme.chrome` = Navy (default) · Light (new key, flagged to the settings spec; lockable by `lockedKeys`). `ThemeApplier` writes `html[data-chrome]`. The Chrome control is exposed in the avatar menu and Preferences only after the navy QA pass (design system §8.5 step 8); until then the key exists and the control is hidden.
- Density is `density` = Comfortable 44 (default) · Cozy 36 · Compact 32, written as `html[data-density]`; `src/lib/density.ts` and `workwrk:density` are deleted; the boot flash (compact then cozy) ends because density comes from `/api/boot` before first paint. **The value a new org gets is Comfortable 44.** Design system §3.2 and open decision 2 win on this because density is a look value and design-system.md is the deciding doc on look; settings spec §5.2's Appearance-defaults row, which ships the org default as Cozy, is superseded, and that row's default changes to Comfortable in the same PR. Flagged to the settings spec. The three-step preference means the founder can flip the org default from Settings › Identity › Appearance defaults without a token change, so nothing is one-way.
- High contrast: `[data-contrast="high"]` from `home.ui.contrast` (later, Preferences); not in the first release.
- Marketing is light only.

### 1.10 Session expiry and 401

Today nothing intercepts a 401 mid-session (critic missedSurfaces). The rule:

1. `apiFetch` and `RealtimeClient` dispatch `workwrk:session-expired` on any 401 (or an SSE 401 close). The shell mounts one `SessionExpiredDialog` (§2.15) and stops every poller and SSE reconnect.
2. `useSession().status === "unauthenticated"` in `(dashboard)/layout.tsx` redirects to `/login?callbackUrl=<pathname+search>` (today the callback is dropped).
3. Editors (doc, notepad, canvas, tables, task drawer) subscribe to the event and flush their in-memory draft to `localStorage["workwrk:draft:{kind}:{id}"]` before the redirect; on the next mount with a draft they offer "Restore unsaved changes" (data-integrity rule). The restore UI is each editor's; the flush hook `useDraftOnExpiry` is the shell's.
4. Idle warning: `/api/boot` and the SSE `session` event carry `idleUntil`; two minutes before it the shell shows one toast "You'll be signed out in 2 minutes" with an action "Stay signed in" that calls `GET /api/me` (which refreshes the token). Absent when the org has no idle timeout.
5. Sign-out-all (`tokenVersion` bump) surfaces as the same dialog with the sentence "You were signed out on every device."

### 1.11 Realtime and polling

`RealtimeClient` (one SSE connection per tab, `/api/realtime`) is the source for live chrome; polling is the fallback only while SSE is disconnected. Events the shell consumes (names are the contract for the hub units):

| Event | Shell consumer |
|---|---|
| `notif.changed { unread }` | bell dot, Work rail dot, Inbox row count |
| `reminder.due { id }` | bell dot, Reminders tab, the ticker card |
| `talk.unread { conversationId, unread }` | Talk rail dot, Talk sidebar row dots |
| `timer.started / timer.stopped { session }` | timer pill |
| `call.incoming / call.ended` | incoming-call toast, call dock |
| `access.changed { objectType, objectId }` | sidebar tree re-fetch for that object's section; `POST /api/access/check` cache invalidation |
| `prefs.changed` | shell re-reads effective preferences (theme, density, sidebar) |
| `session.idle { idleUntil }` | idle warning |

Reconnect: exponential backoff 1s → 30s with jitter; while disconnected the shell polls `GET /api/boot?counts=1` every 60s for counts only. The five independent pollers today (items 12s, timer 15s, calls 15s, notifications 45s, reminders 60s) are replaced by these events plus that one fallback poll.

### 1.12 Boot

`(dashboard)/layout.tsx` calls one endpoint after the session resolves: `GET /api/boot` (new, §2.1 Data) returning viewer, visible apps, effective preferences, org identity and culture, counts and `setupCompleted`. `/api/setup`, `/api/preferences`, `/api/organization/culture` and `/api/inbox/count` are no longer called at boot. The shell renders only when boot succeeds (§1.7 for failure).

`!setupCompleted` → `/onboard` (onboarding unit). This is the **declared carve-out** from §1.4's one-redirect invariant, and the two are consistent because the invariant is about denial: no `can()` decision ever redirects. Boot has exactly two redirects, both about who you are rather than what you may open: no session → `/login?callbackUrl=<current>`, and a signed-in person whose org has not finished setup → `/onboard`. A boot fetch failure is not a redirect (it renders the boot `ErrorState`, §1.7), and today's behaviour of treating a failed `/api/setup` as "setup complete" ends: a failed boot never silently sends anyone to `/onboard` or past it.

### 1.13 Cookie consent scope

`ConsentProvider` and `ConsentBanner` are mounted in `src/app/(marketing)/layout.tsx` and `src/app/(auth)/layout.tsx` only; `providers.tsx` no longer mounts them. Inside the authenticated app no banner ever renders: the app sets only strictly necessary cookies, and consent for anything else was decided on the marketing host. In-app, "Privacy & cookies" in the Help menu opens the consent preferences dialog (the same `ConsentProvider` UI, mounted lazily) so a person can change their choice without leaving the app.

### 1.14 i18n and RTL

- Locale resolution, in order: `home.locale.language` (user, from `/api/boot`) → `settings.language` (org) → `NEXT_LOCALE` cookie → `Accept-Language` → `en`. On sign-in and on any change of the two preferences the shell writes `NEXT_LOCALE` so `src/i18n/request.ts` (server) and the client agree; `request.ts` gains the two preference reads.
- The shell's own strings (rail labels, bar, menus, overlays, empty and error sentences, shortcuts overlay) move to `messages/{locale}.json` under the `shell` namespace in the shell PR. Content pages migrate in their units; until then they render English.
- The dead `components/bento/locale-switcher.tsx` is deleted; the only language control is My settings › Preferences › Language & region.
- RTL (`ar`, `he`): the root layout already sets `dir`. The shell uses logical properties only (`inset-inline-start`, `padding-inline`, `border-inline-end`, `margin-inline`); `left/right` in `src/components/layout/os/**` is a stylelint error. Chevrons and the back arrow flip with `rtl:rotate-180`; the rail sits at inline-start (the right edge in RTL); the sidebar follows; drawers open from inline-end; the breadcrumb reads right to left with "‹" separators mirrored; the Filter panel sits at inline-start; toasts sit at inline-start bottom.
- Long strings: rail labels clamp to 2 lines of 10/500 with the full label in the tooltip; sidebar rows ellipsis; buttons never wrap; the breadcrumb truncates each crumb at 160px.

### 1.15 "Coming soon" policy

Never an inert control. A capability whose backend is not wired is either absent, or (only when `home.ui.showUpcoming` is on) rendered as `<ComingSoonRow label>`: a 36px non-interactive line (`<div>`, not a button, not focusable), label 14/400 `--os-ink-3`, a neutral `Chip` "Coming soon" at the right, tooltip "Not built yet". No handler, no toast, no disabled button. The dead "Ask AI / Share / Invite" trio in `OsTitleBar`, the default filled star and the `people` fake-avatar props are deleted from `title-bar.tsx`; `OsTitleBar` becomes the design system's `OsPageHeader` and takes only real props (`title`, `tile`, `back`, `actions`, `askAi` gated on entitlement, `people` from `GET /api/access/grants`). A control with no handler is a type error (`onClick | href` required on `Button` when rendered as an action).

### 1.16 Narrow widths (desktop and tablet; a mobile shell is a later unit)

| Width | Rail | Sidebar | Bar | Content |
|---|---|---|---|---|
| ≥ 1280 | 64 | 264 (240 to 320) | breadcrumb full (collapse past 4 levels), Search 400 | as designed |
| 1024 to 1279 | 64 | 264 | breadcrumb full, Search 240 | Filter panel 272 inline |
| 768 to 1023 | 64 | overlay drawer 320 from inline-start, opened by a 32px `Menu` button that replaces ‹ › at the bar's left; closes on row click, Esc, outside click; `sidebar.collapsed` ignored | last two crumbs only; Search is a 32px magnifier icon that opens the palette | Filter panel is a 320 drawer; task drawer 100% width; modals 100% minus 24px |
| < 768 | same as tablet, not tuned | | | body never scrolls horizontally; wide tables scroll inside their card |

The settings takeover (§2.8) has its own breakpoint and it is the only one below 1024: at **< 900px the 264px settings list collapses to a "Pages" select** in the takeover's own 48px bar, next to "← Back to app" (settings spec §8.1). The rail and the navy bar behave exactly as the table above says at every width, so between 768 and 900 a person sees the rail, the `Menu` button in place of ‹ ›, and the Pages select; the takeover has no overlay drawer because it has no hub sidebar to overlay.

**Discoverability of the small controls.** The sidebar's collapse chevron and the sidebar resize handle are always rendered at 40% opacity and go to 100% on hover or focus, because they are the only way to get the sidebar back and `shell.md` Low 38 is about exactly those two. The row "…" is hover-reveal, once, by §1.2 rule 5 (always tab-reachable, revealed by `:focus-visible`, and rendered at rest under `@media (hover: none)`); this section does not restate it. Drag (sidebar resize, section reorder) has keyboard and menu alternatives (arrow keys on the resize handle; "Move up / Move down" in the section "…").

---

## 2. Route specs

**Two stated conventions, so this file can be read side by side with the other nine specs.**

1. **Overlay blocks substitute one heading.** §2.9 to §2.21 are overlays with no URL: they have no top bar, no secondary sidebar, no page header stack and no body layout of their own, because they render inside the frame §2.1 already specifies. For those blocks the template's four layout headings (Top bar / Secondary sidebar / Page header stack / Body layout) are replaced by one heading, **Anatomy**, which carries the overlay's width, ground, radius, shadow, header, rows and footer in reading order. Every other template heading (Purpose, Who sees it and entry points, Side panel / drawer / modal, States, Keyboard, Data, Realtime, What changes vs today, Open questions) is present and filled. The substitution is declared here once instead of in each block.
2. **Every block fills every heading, including the six states.** Where a heading genuinely does not apply the block writes "none" or "n/a" with the reason, never silence. The six states are loading, empty, error, read-only, denied, offline or session-expired, and each is written on its own even when the answer is "cannot happen here, because …". Two answers recur and are defined once:
   - **read-only**, everywhere in this unit, is "n/a: the frame and its overlays carry no object content, so no object role changes what renders. Access changes which rows exist (§1.4), not whether a control is live."
   - **session-expired**, everywhere in this unit, is "the Session-expired dialog (§2.15) takes the screen; this surface is left as it was and is inert behind it", unless the block says otherwise.

### 2.1 The frame: every `(dashboard)` route (`src/app/(dashboard)/layout.tsx`, `os-shell.tsx`, `click-app-rail.tsx`, `hub-sidebar.tsx`, `click-topbar.tsx`, `shell-context.tsx`)

- **Purpose**: the frame you see on every page: the navy rail with the eight hubs on the left, the grey sidebar for the hub you are in, the navy bar with where you are, Search, Create, the bell and your avatar.
- **Who sees it and entry points**: every signed-in person (§1.4). Entry: any dashboard URL after sign-in; `/login` callback; email deep links; the marketing "Log in" button.
- **Top bar** (`--os-top-h` 48, `--os-chrome-bg`, one row, spans the width to the right of the rail; no bottom border in navy, `1px --os-line` in the light flip):
  - Left, from 12px: **‹ ›** two 32px icon buttons (`ChevronLeft`, `ChevronRight`, `--os-chrome-fg-2`, hover `--os-chrome-hov` pill radius 6; 40% opacity and `aria-disabled` when `navStack` has no entry in that direction; tooltips "Back" and "Forward"). Then the **breadcrumb**: crumbs 14/400 `--os-chrome-fg-2`, "›" separators at 50%, last crumb 14/500 `--os-chrome-fg` and not clickable; each crumb ellipsis at 160px; past 4 levels the middle crumbs collapse into one "…" crumb that opens a `MenuList` of the hidden crumbs. `EntityTile size="xs"` only on the Space crumb. The first crumb is always the hub label from `resolveHub`. Pages declare the rest with `<Breadcrumb items={[{ label, href, tile? }]} />` (a client component that writes into shell context and clears on unmount).

**The fallback, defined.** A page that declares nothing gets `Hub › {ROUTE_TITLES[prefix]}`. `ROUTE_TITLES` is a second constant in `src/lib/nav/route-hub.ts` (`Record<string, string>`, the same longest-prefix match as `ROUTE_HUB`, one row per route directory under `src/app/(dashboard)`), it holds the canon label for every static route, and it is what `resolveCrumbFallback(pathname)` reads. Three rules make it safe for every other unit to depend on:

1. Every static route (no dynamic segment) has a row, and its value is the canon label from §1.3 where one exists; hub units add their rows in the same PR as their sidebar. The CI test that asserts every `(dashboard)` directory in `route-list.txt` has a `ROUTE_HUB` row asserts a `ROUTE_TITLES` row at the same time.
2. Every route with a **dynamic segment** (`/boards/[slug]`, `/docs/[id]`, `/people/[id]`, `/item/[id]`) must render `<Breadcrumb items/>`, because no static table can know the object's name. `ROUTE_TITLES` carries the container label for those prefixes only (`/docs` → "Docs"), and a dynamic route that declares nothing renders `Hub › {container label}` with no object crumb, which is a bug a lint rule catches: a `page.tsx` under a directory whose path contains `[` and that does not import `Breadcrumb` is an ESLint error.
3. `ROUTE_TITLES` never holds a role check, a count or a fetched value. It is strings.

`resolveHub`, `ROUTE_HUB`, `ROUTE_TITLES`, `resolveActiveRow` and `resolveCrumbFallback` ship together in §4 step 1 (no visual change), so every unit's pages have the fallback before any unit writes a page header. Examples: `Work › Sales › Q4 › Website redesign › Fix invoice PDF`; `Docs › Library › Onboarding guide`; `Teams › People › Priya Menon`; `Settings › Workspace settings › Members`; `Talk › #design`. The breadcrumb absorbs the ClickUp location bar; no page renders a second location row or its own crumb (`me/weekly-review`'s inline crumb goes).
  - Centre: **Search** field, 400px (240 under 1280, icon under 1024), 32px, `--os-chrome-field` bg, `1px --os-chrome-line`, radius 6, 16px magnifier, placeholder "Search or jump to…" in `--os-chrome-field-ph`, kbd "⌘K" at the right 12px `--os-chrome-fg-2`. Click or ⌘K opens the palette (§2.9). It is a button styled as a field; typing never happens in the bar.
  - Right, to 12px, gap 4, every hit area 32px, icons 20px `--os-chrome-fg-2`, hover `--os-chrome-hov` pill radius 6, tooltip + `aria-label` on each: **Timer pill** (renders only while a timer is running: 32px pill `--os-chrome-field` bg, `Dots live` 6px, elapsed `mm:ss` 12/500 tnum, task name ellipsis 120px, a 24px ✕ "Stop"), **"+" Create** (`Plus`; opens §2.10; tooltip "Create · ⌘K to search"), **Bell** (`Bell`; a 6px `--os-chrome-attention` dot with a 2px `--os-chrome-bg` ring when Inbox has unread or a reminder is due; opens §2.11; tooltip "Notifications"), **Help** (`CircleHelp`; opens §2.13), **Avatar** (28px, initials 11/500 on N200 with N700 text or the photo, 8px `--os-chrome-presence` dot bottom-right; away `--os-warning-solid`, offline `--os-line-strong`; opens §2.12; tooltip "{Name} · {status}"). No solid blue button, no icon row, no calendar, no Ask AI, no inbox glyph, no workspace switcher on the bar.
  - **Timer pill: a flagged addition to the bar.** Design system §4.3 lists four items in the right cluster ("+", bell, Help, avatar) and the pill is a fifth. It is added deliberately, because it re-parents `active-timer-pill.tsx` (today its own floating element with its own 15s poller) into the one place the frame already carries live personal state, and because a running timer must be visible and stoppable from every page. It is conditional, so the default bar is still the design system's four. Flagged to the design system as a fifth right-cluster slot, `timer`, rendered before "+".
  - **What the pill's click does, in every case.** The pill's body is a link to the running task's own URL with the drawer open; the 24px ✕ is a separate button that stops the timer and never navigates. Because §1.5 requires a drawer to close to a list URL, the pill always navigates to the task's List first and opens the drawer over it: click → `router.push('/boards/{listSlug}?item={itemId}')`, which is the same URL the List page produces when a row is clicked, so ✕ and Esc close to `/boards/{listSlug}` with a real list underneath. When the viewer is already on that list the drawer opens in place with no navigation. When the timer's task sits on a List the viewer can no longer read (access changed mid-session), the pill's body is not a link: it shows the elapsed time and the ✕ only, with the tooltip "You no longer have access to this task", and stopping still works because a timer is the viewer's own record.
- **Rail** (`--os-rail-w` 64, `--os-chrome-bg`, flush to the viewport edge, no radius, no border, never scrolls; the floating `rounded-xl` card and `overflow-y-auto` go):
  - Top: the four-dot logo mark 28px wide, 16px from the top, brand hexes (`--os-dot-*`, the only consumer outside the splash). Click = Work hub. Pulses as the route loader (§1.6). `aria-label "WorkwrK, go to Work"`.
  - Items, in the admin's order from `OrgPreference.sidebarDefault.apps` (default Work, Planner, AI, Talk, Teams, Docs, Tables), filtered by `visibleApps`, 56px tall each, 8px gap, full width: 20px Lucide icon (`Home`, `Calendar`, `Sparkles`, `MessageCircle`, `Users`, `FileText`, `Table2`) centred in a 40×40 pill area, label 10/500 (`text-rail`) 2px below, up to 2 lines. Rest: icon and label `--os-chrome-fg-2`. Hover: `--os-chrome-hov` 40×40 pill radius 8, icon and label `--os-chrome-fg`. Active: `--os-chrome-pill` (white) 40×40 pill radius 8, icon `--os-chrome-pill-fg` (navy), label `--os-chrome-fg` at 500, `aria-current="page"`. No left bar, no blue, no transform. Tooltip: "{Label} · G {n}".
  - Attention dot: 6px `--os-chrome-attention` at the icon's top-right with a 2px `--os-chrome-bg` ring; Work when Inbox has unread, Talk when any conversation is unread. No numeric badges.
  - Bottom cluster: **Settings** hub (`Settings` icon, same anatomy, pinned last, `alwaysPinned`; opens `/settings` for Owner and Admin, `/account/profile` for everyone else). Nothing else at the bottom: the avatar is on the bar (one avatar in the app; the design system names it in both places, and the bar is where Zoho puts it), Invite and Upgrade moved to the workspace menu, the More tile is gone.
  - Off premium module for Owners and Admins: the hub icon renders at 40% with a 6px `--os-line-strong` "Off" dot and tooltip "Talk is off · Turn on in Settings"; click opens `<ModuleOff>` at the hub URL with the switch (access spec example K). Members never see it.
  - Keyboard: the rail is a `nav` with `role="list"`; ↑↓ move focus, ↵ opens, `G n` jumps.
  - Sidebar collapsed: a 24px circular chevron button (`ChevronRight`, `--os-surface`, `1px --os-line`, `--os-shadow-pop`) sits on the rail's right edge 16px from the bottom; click or `⌘\` reopens.
- **Secondary sidebar** (`--os-side-w` 264, `--os-side-bg` N50 in both chrome variants, `border-inline-end: 1px solid var(--os-line)`, no radius, no floating card):
  - Header 56px: **workspace switcher** = `EntityTile size="sm"` neutral with the org's logo or initials + org name 15/500 `--os-ink` + `ChevronDown` 16px, in a hover `--os-surface-hov` pill radius 6, opens §2.14; right: the hub **"+"** per §1.2 rule 9 (32px ghost `Plus`).
  - Under the header, only when the hub tree exceeds 12 rows: the in-place filter input (§1.2 rule 10).
  - Rows 36px in `.os-row`, inset 8px from the edges, `padding-inline 12`, gap 12, icon 20px `--os-ink-2` or `EntityTile sm` neutral, label 15/400 `--os-ink`, count 12/500 `--os-ink-2` right; hover `--os-surface-hov` radius 8; active `--os-side-pill` N200 pill radius 8, label 15/500 `--os-ink`, icon `--os-ink`, count `--os-ink-strong`. Tree children indent 20px per level, no guide lines, chevron 16px on parent rows. One "…" on hover.
  - Section labels per §1.2 rule 2; a 16px chevron appears on hover at the label's left to collapse; state persisted.
  - Footer 44px, `border-top 1px --os-line`: **Customize Sidebar** ghost button, 13/500 `--os-ink-2`, 16px `SlidersHorizontal`, full width; opens §2.16.
  - Collapse: the 24px circular chevron (`ChevronLeft`) on the sidebar's outer edge 16px from the bottom (Zoho ref 1), always visible at 40%, 100% on hover; `⌘\`; `sidebar.collapsed` persisted. Collapsing tweens width to 0 in 220ms; the content widens.
  - Resize: a 12px invisible handle on the outer edge (cursor `col-resize`, 2px `--os-line-strong` line while dragging, arrow keys ±12, double-click resets 264), `sidebar.width` persisted debounced.
  - Nothing promotional, no cards, no tips, no "Popular Wikis", no hard-coded empty cards (hub units replace them with `emptyLine`).
- **Page header stack**: not the shell's; every list page renders `OsPageHeader` + `OsViewsRow` + `OsToolbar` per design system §4.4 (the primitives are shared components this unit ships, §3). The shell guarantees 176px of chrome above the first data pixel on a multi-view list page and 96px on a doc page.
- **Body layout** (reading order, left to right, top to bottom): rail 64 · sidebar 264 · [bar 48 over the content column] · content column (`<main>` white `--os-canvas`, `overflow-y: auto`, no radius, no border; the zinc-100 gutters and `p-1.5` go) · optional Ask AI panel 360 at inline-end (`--os-surface`, `border-inline-start 1px --os-line`, own 48px header "Ask AI" + ✕; pushes content, never overlays; `sidekickOpen` persisted per session only). Below the bar when offline: the 32px offline strip (§1.7). Bottom-right: the call dock region 320×64 (renders only in a call); bottom-left: toasts (max 3). The ReminderTicker's persistent cards are replaced by toasts: a due reminder is a toast with "Open" and "Snooze" (8s, then it stays in the bell's Reminders tab).
- **Landmarks and skip links** (the frame is four nav regions deep, so a keyboard user must be able to step over them): the first focusable element in the DOM is a visually hidden "Skip to content" link that becomes visible on focus as a 36px `--os-surface` pill at the top-left of the content column and moves focus to `<main id="main">`; a second skip link, "Skip to sidebar", follows it and targets the hub sidebar. The landmark map is fixed and every region is labelled, so a screen-reader user can jump by landmark instead of tabbing: `<nav aria-label="Hubs">` (rail), `<nav aria-label="{Hub} sidebar">` (secondary sidebar), `<header aria-label="Page bar">` (top bar, with the breadcrumb inside its own `<nav aria-label="Breadcrumb">` as an `<ol>`), `<main id="main" tabindex="-1">` (content), `<aside aria-label="Ask AI">` (the AI panel), `<div role="region" aria-label="Notifications" aria-live="polite">` (the toast region), `<div role="region" aria-label="Call">` (the call dock). Tab order is DOM order: skip links, rail, sidebar, bar, content, panel. On every client navigation the shell moves focus to `<main>` and announces the new page title through a visually hidden `aria-live="polite"` line, so a route change is not silent.
- **Side panel / drawer / modal used here**: Ask AI panel (360, ⌘J, ✕/Esc); task drawer (Work unit, 520, closes to the list URL); Search palette (§2.9); Create menu (§2.10); bell popover (§2.11); avatar menu (§2.12); Help menu (§2.13); workspace menu (§2.14); Session-expired dialog (§2.15); Customize panel (§2.16); shortcuts overlay (§2.17); mission splash (§2.18); Reminder dialog (§2.19); Notepad panel (§2.20); Voice note popover (§2.21); Set status modal (400, from the avatar menu); confirm and prompt dialogs (400, `DialogProvider`, `useConfirm` / `usePrompt`, used by 68 files across every unit); Quick task modal (Work unit, 720, `⌘⇧K`); Create List modal (Work unit, 560); Create Sprint modal (Work unit, 560, from a List menu, not mounted by the frame); Template Center (Work unit, 960). Nothing else is mounted in the frame: `MyWorkPanel` is merged into `/my-work`, `QuickCaptureHandler` is replaced by the Create menu's Notepad row, `OsItemDrawer`, `AppsMorePopover`, `TopPinsStrip` and `ScreenProtection` are deleted (§0). `TourProvider` stays mounted but renders nothing until the Help menu's "Take the tour" is used and the onboarding unit has registered steps. The `LayerStack` in shell context orders them; the z-index scale is `--os-z-sidebar 10`, `--os-z-bar 20`, `--os-z-panel 30`, `--os-z-drawer 40`, `--os-z-popover 50`, `--os-z-modal 60`, `--os-z-toast 70`, `--os-z-splash 80`; every overlay is a Radix `Dialog` (modal) or `Popover` (non-modal) so focus is trapped and returned; hand-rolled overlays are deleted.
- **States**: loading = boot navy + logo, then splash per setting (§1.6); empty = never (a viewer always has Work and Settings; a Guest with nothing shared sees Work › Home's empty state); error = boot `ErrorState` on navy with Try again and Log out (§1.7); read-only = n/a (no content controls in the frame); denied = n/a (the frame never denies; pages do); offline / session-expired = the offline strip; the Session-expired dialog (§2.15).
- **Keyboard**: the global map in §1.8.
- **Data**: `GET /api/boot` (new): `{ setupCompleted, viewer: { id, orgRole, isAgent, active, adminScopes, hasReports, peopleTeam, name, avatar, presenceStatus, presenceUntil }, apps: AppKey[] (visibleApps), manageableOffModules: AppKey[] (§1.4, empty for everyone but Owners and Admins), prefs: EffectivePreferences (theme, density, sidebar, home.ui, home.locale, home.notifications.mutedUntil), org: { id, name, logo, plan, culture: { mission, values, splash } }, counts: { inboxUnread, remindersDue, talkUnread }, timer: ActiveTimer | null, session: { idleUntil | null } }`; `PATCH /api/preferences` (sidebar.*, theme.*, density, home.ui.*, home.notifications.mutedUntil); `PATCH /api/users/[id]` (presence); `GET /api/realtime` (SSE, §1.11); `POST /api/access/check` for any chrome outside a gated page. Settings read: `OrgPreference.sidebarDefault.apps`, `lockedKeys`, `companyProfile.splash`, the preference keys above.
- **Realtime**: §1.11.
- **What changes vs today**: three floating cards on zinc-100 → one navy bar; 60px rounded rail with Invite/Upgrade/More → 64px flush rail with hubs and Settings only; sticky `activeAppKey` + hover preview → URL-derived (`shell.md` High 11, critic #1); `⌘B`/`⌘1..9`/`⌘⇧N`/"⌥T"/"G T" → the §1.8 map (High 8, Medium 22); four badges → one bell (Low 35); five pollers → SSE + one fallback (Low 36); localStorage presence/mute/pins/width → server (High 6, 7); `TopPinsStrip` → Favorites (Low 37); hover-only search/collapse → always visible (Low 38); global button reset workarounds → the reset is removed from `os.css` and `Button` owns its chrome; stale `os-shell.tsx` header comment deleted (critic #15); `/api/setup` + prefs + culture + count at boot → `/api/boot`; `p-1.5` gutters and rounded main → flush; two toasts → one; eight hand-rolled overlays → Radix layers with one Esc (Low 44, Medium 25).
- **Open questions**: (1) Avatar on the bar (this spec) or on the rail's bottom (design system §4.1 also lists it)? Recommendation: the bar, one avatar, matching Zoho ref 1. The two keyboard questions that stood here, `G 1..8` against `⌘1..8` and `⌘⇧K` against `⌘T`, are **closed**: both were the same decision, "advertised equals working" (§1.8), and both resolve in this spec's favour, so the design system and the four peer specs print `⌘⇧K` and `G 1..8` and nothing is left for the founder to arbitrate.

### 2.2 Route loader (`src/app/(dashboard)/loading.tsx`)

- **Purpose**: what you see for the half-second while the next page loads.
- **Who sees it**: everyone; entry: every client navigation whose page suspends past 200ms.
- **Top bar**: unchanged (stays interactive); the breadcrumb keeps the previous page's crumbs until the new page declares its own.
- **Secondary sidebar**: unchanged, the new URL's row already active.
- **Page header stack**: skeleton title row (a 22px-tall bar 40% wide at 48px), skeleton views row (three 32px pills), skeleton toolbar (two 36px chips left, one 36px block right).
- **Body layout**: eight skeleton rows at `--os-row-h`, bars 60/40/80%, `--os-skeleton`, radius 4, 1.6s opacity pulse; under the first row one 13/400 `--os-ink-2` `<ValueLine/>` with the org's rotating value (or nothing when the org has none). The rail logo pulses (§1.6). Nothing blocks input.
- **Side panel / drawer / modal**: none.
- **States**: loading = this surface is the loading state (skeletons, rail pulse, value line). Empty = n/a: a loader has no data to be empty of; a page that resolves to nothing renders its own empty state, not this one. Error = n/a here and it is deliberate: a page that throws during load unmounts this file and renders `error.tsx` (§2.3); a page that finds nothing renders `not-found.tsx` (§2.4); this file never shows an error, so it can never get stuck showing one. Read-only = n/a (§2 convention 2). Denied = n/a: the gate runs on the server before the page streams, so a denied route renders `LockedPage`, `ModuleOff`, `AppOff` or the in-shell 404 rather than passing through here; a slow gate check shows these skeletons first, which confirms nothing because it is the same skeleton for every route. Offline = the offline strip (§1.7) sits above the skeletons, and a navigation attempted offline still renders them until the page resolves from cache or the strip explains why it will not. Session-expired = the §2.15 dialog takes the screen and the skeletons stop pulsing behind it. `prefers-reduced-motion`: static bars, static logo.
- **Keyboard**: global map.
- **Data**: the value from `/api/boot` culture (no fetch here).
- **Realtime**: none.
- **What changes vs today**: `ValueLoader` dots centred in the canvas → skeletons + one line; the 200ms delay before the rail pulse prevents flashes on fast routes (critic #12's "flash the full-page ValueLoader on every click").
- **Open questions**: none.

### 2.3 In-shell error boundary (`src/app/(dashboard)/error.tsx`)

- **Purpose**: the page you see when a page breaks, so you can try again or go somewhere safe.
- **Who sees it**: everyone; entry: any render or data error inside a page.
- **Top bar**: unchanged; breadcrumb = Hub › (last known crumbs).
- **Secondary sidebar**: unchanged.
- **Page header stack**: none (the boundary renders a centred block).
- **Body layout**: `ErrorState` centred, 64px top margin: four-dot line art (row), sentence "This page couldn't load" 15/400 `--os-ink-2`, text link "Try again" (`reset()`), then a second line 13/400 `--os-ink-3` "Reference {digest}" when present; `BackButton{fallbackHref: hub.defaultHref, label: hub.label}` below. In development only, the message in a 13px mono block. No "All spaces", no "Home" buttons, no zinc-900 pill.
- **Side panel / drawer / modal**: none.
- **States**: error = this surface. Loading = n/a: a boundary renders after the failure, never before. Empty = n/a: an empty page is a page's own state, not a failure. Read-only = n/a (§2 convention 2). Denied = n/a and enforced: a denial is a decision, not an exception, so `gatePage` never throws; if a page throws a raw 403 from an API instead of rendering its denial view, that is a bug in the page and this boundary shows "This page couldn't load" rather than leaking the reason. Offline = the offline strip (§1.7) sits above this block, and "Try again" is the same wired `reset()`. Session-expired = the §2.15 dialog takes the screen; a 401 is intercepted by `apiFetch` (§1.10) before it can reach this boundary, so "you were signed out" is never rendered as "something broke".
- **Keyboard**: global map; `Enter` on the focused "Try again".
- **Data**: none. `console.error` stays; the digest is also sent to `POST /api/client-errors` (new, fire-and-forget, `{ digest, pathname, userAgent }`) so shell errors are visible in the audit trail.
- **Realtime**: none.
- **What changes vs today**: three buttons and a red icon tile → the quiet `ErrorState`; the `Home` → `/today` link replaced by `BackButton`.
- **Open questions**: none.

### 2.4 In-shell 404 (`src/app/(dashboard)/not-found.tsx`)

- **Purpose**: "that page isn't here", inside the app, with a way back.
- **Who sees it**: everyone; entry: an unknown dashboard path, a not-discoverable object (`notFound()` from `gatePage`), a deleted object.
- **Top bar**: unchanged; breadcrumb = Hub › Not found.
- **Secondary sidebar**: the resolved hub's sidebar with no row active.
- **Page header stack**: none.
- **Body layout**: `OsEmptyView` (row arrangement): sentence "We couldn't find that page" 15/400, one text link "Search" (opens the palette), `BackButton{fallbackHref: hub.defaultHref, label: hub.label}`. No "Browse spaces", no "We haven't built this yet" (a 404 is a 404, never a roadmap claim).
- **Side panel / drawer / modal**: none.
- **States**: loading = n/a: this page renders from the URL and the boot payload, with no fetch of its own, so it paints at once. Empty = n/a: the page IS the empty answer. Error = n/a: there is nothing here that can fail; a throw inside the 404 page falls through to `error.tsx` (§2.3). Read-only = n/a (§2 convention 2). **Denied = this page IS the denial view for one of the two denial shapes, and the copy must not change between them.** Access spec §5.3 renders `notFound()` for "no role and not discoverable", so a Member who guesses a Space id, a Guest on any route outside their shared objects, and a person whose access was revoked all land here and see exactly the same sentence, the same link and the same `BackButton` as someone who typed a misspelled URL. That identity is the point: a 404 that differed from a real 404 would confirm the object exists. Nothing here ever renders an object name, an owner, a count or a "you need access" hint; the surfaces that do are `LockedPage` (discoverable) and `ModuleOff` / `AppOff` (rule 2), which are different components at different URLs. Offline = the offline strip (§1.7) sits under the bar above this page, because an unreachable page and an unreachable network look the same to a person and the strip is what tells them apart; the "Search" link still opens the palette, which works offline on its empty-query sections (§2.9). Session-expired = the §2.15 dialog takes the screen; a 404 caused by a lapsed session is common (the server cannot see the viewer's grants), and the dialog is what explains it, so the 404 stays behind it and is re-evaluated after sign-in.
- **Keyboard**: global map; `Enter` on the focused "Search" link opens the palette.
- **Data**: none.
- **Realtime**: none.
- **What changes vs today**: copy, three pills → one link + BackButton; `GoBackButton` deleted.
- **Open questions**: none.

### 2.5 Root 404 (`src/app/not-found.tsx`)

- **Purpose**: an unknown top-level path on the app host (e.g. `/goals`, `/reports`, `/signup`) still lands inside the app for a signed-in person.
- **Who sees it**: everyone; entry: any path Next cannot match.
- **Top bar**: on the app host and signed in, the navy bar as §2.1, breadcrumb `Work › Not found` (the hub falls back to Work because an unmatched path resolves to `home`, §1.1 rule 3). On the marketing host: the marketing header (marketing unit). Signed out on the app host: the `(auth)` layout's header, which is the wordmark alone.
- **Secondary sidebar**: signed in on the app host, the Work hub sidebar with no row active. Marketing host and signed out: none.
- **Page header stack**: none (a centred block, as §2.4).
- **Body layout**: on the app host and signed in, the same `OsEmptyView` as §2.4, reached by delegating to `(dashboard)/not-found` (a `notFound()` inside the dashboard layout is what most unknown app paths hit once `src/proxy.ts` routes every non-marketing, non-auth, non-public path into the `(dashboard)` group). On the marketing host, the marketing shell's 404 (marketing unit). Signed out on the app host, the `(auth)` layout's 404: the same sentence, and "Log in" as the one text link in place of "Search". The chrome-less zinc page goes.
- **Side panel / drawer / modal**: none.
- **States**: as §2.4 for every state, with two additions. Denied = same identity rule, and it matters more here because this file is what an unauthenticated deep link hits: a signed-out person sees the `(auth)` 404 with "Log in" and never learns whether the path exists. Session-expired = signed out is not the same as expired; a session that lapses while this page is open shows the §2.15 dialog like anywhere else, and a person who was never signed in gets the "Log in" variant with no dialog.
- **Keyboard**: global map when signed in on the app host (the palette opens from the "Search" link and `⌘K`); on the marketing host and the signed-out variant there is no global map, only `Enter` on the focused link.
- **Data**: none.
- **Realtime**: none.
- **What changes vs today**: chrome-less page → in-shell 404, marketing 404, or `(auth)` 404 by host and session.
- **Open questions**: none.

### 2.6 Last-resort boundary (`src/app/global-error.tsx`)

- **Purpose**: the one page that renders when the root layout itself fails.
- **Who sees it**: everyone, rarely.
- **Top bar**: none. This file replaces the root layout, so there is no rail, sidebar, bar or app CSS; that is the whole point of it.
- **Secondary sidebar**: none.
- **Page header stack**: none.
- **Body layout**: inline-styled (it cannot rely on app CSS): white ground, the four dots as inline SVG in a literal grey (`#D0D5DD`, the sRGB value of `--os-line-strong`, written out because no stylesheet has loaded), "Something went wrong" 16/600, one 14px sentence, "Try again" as a bordered button, "Reference {digest}" 12px. No brand hexes (the brand-dot quarantine exempts `brand/**` only; this file draws grey dots). Every value is hard-coded on purpose and this is the one file exempt from the raw-hex lint (design system §1.6), noted in the lint config so nobody "fixes" it into a token it cannot read.
- **Side panel / drawer / modal**: none.
- **States**: error = this surface. Loading = n/a (it renders after a failure). Empty = n/a. Read-only = n/a (§2 convention 2). Denied = n/a: there is no gate left to run, and the page never names a route or an object, so it confirms nothing. Offline = the same block, with the sentence "Try again when you're back online" substituted when `navigator.onLine === false`; there is no offline strip here because the strip is a shell component. Session-expired = n/a: the §2.15 dialog lives in the shell that just failed, so a lapsed session at this depth reads as "Try again", and the button re-requests the page, which redirects to `/login?callbackUrl=<current>` on the server.
- **Keyboard**: Enter on the focused "Try again". No global map (the registry is a shell component).
- **Data**: the digest to `POST /api/client-errors` when `fetch` is available; wrapped so a failed report never re-throws.
- **Realtime**: none.
- **What changes vs today**: copy and the grey four-dot mark; otherwise kept.
- **Open questions**: none.

### 2.7 `/loader-preview` (`src/app/loader-preview/page.tsx`)

- **Purpose**: none for users; a dev gallery that is publicly reachable today.
- **Who sees it and entry points**: today, anyone on the internet: the route sits outside the auth gate and `proxy.ts` allows it. After this spec, nobody.
- **Disposition**: removed (§0). The route file is deleted and `proxy.ts` no longer lists it. Nothing is lost and no redirect is owed, because the page has no user destination: it is a gallery of loader variants, every one of which is documented in design system §5.15 and rendered in Storybook if the team wants a gallery. The one thing it did that mattered, exposing the loader copy to review, is replaced by the splash and value copy living in Settings › Identity › Culture (settings spec §5.2).
- **Top bar / Secondary sidebar / Page header stack / Body layout / Side panel**: none; the route is gone.
- **States**: all six are n/a for the same reason, and it is worth writing once: a deleted route has no states. A request to `/loader-preview` after the deletion is an unknown path and therefore §2.5's root 404, which for a signed-out visitor is the `(auth)` 404 with "Log in", so a public URL that leaks today becomes a page that says nothing tomorrow.
- **Keyboard / Data / Realtime**: none.
- **What changes vs today**: a publicly reachable internal gallery is deleted (`shell.md` Medium 15, Low 40).
- **Open questions**: none.

### 2.8 Settings takeover frame (`/settings/*`, `/account/*`; `settings-shell.tsx`)

- **Purpose**: the full-screen settings view with a way back to where you were. Contents are the settings unit's (`settings-architecture.md` §4, §5, §8.1); this block fixes what the shell contributes.
- **Who sees it**: everyone (My settings); Owner and Admin (Workspace settings); entry: rail Settings, avatar menu, workspace menu, deep links, ⌘K "Settings" group.
- **Top bar**: the rail and the navy bar **stay** (design system §4.6 wins on look over the settings spec's §8.1 line that "rail, hub sidebar and top bar unmount"). The takeover replaces only the sidebar and the content column.
  - **The numbers, reconciled once, so an engineer has one set.** Every one of these is a look value, so the design system is the deciding doc on all of them and the settings spec's §8.1 and §10.2 numbers are superseded. The list: settings door sidebar **264px** (settings spec says 248) with **20px** row icons (settings spec says 16), sidebar rows **36px** (settings spec says 32), group labels **11/600 uppercase +0.06em `--os-ink-2` with a 1px `--os-line` rule to the right edge** (settings spec says 12/590), and settings content rows a **48px minimum** (settings spec §10.2 says 44; design system §5.4 wins). Everything else in settings §8.1 stands as written, because it is structure rather than look: the N50 ground, the "Find a setting" filter field at the top with `⌘/`, group labels on the Workspace door only, the active row as an N200 pill at 500 weight and never blue, lock glyphs on Owner-only rows that still navigate to the `AdminOnly` card, `<main>` with 24px padding, the 760px form column and the 1120px list column.
  - **One exit affordance, not two, and one back affordance, not two.** Keeping the navy bar would otherwise put the bar's ‹ and the takeover's "← Back to app" side by side meaning different things, and a ✕ beside "← Back to app" would be a third control doing the second one's job. The rule: the takeover's 48px white bar carries **"← Back to app"** (32px ghost, `ArrowLeft` + label, left) and **nothing at the right**; that one control plus **Esc** is the whole way out, and both call `closeSettings()` (settings spec §8.3). The ✕ that settings spec §8.1 put at the right of the takeover bar is deleted, which is also what settings audit issue 24 asks for; design system §4.6 wins. A **modal** inside settings still carries its own ✕, because a modal is a different object with a different close target (§5.5 anatomy), and nothing in this rule touches it. The navy bar's ‹ › keep their one job, browser history, and inside a door that means walking back through settings pages; when `navStack` has no entry they are at 40% and `aria-disabled` as everywhere else. They never exit the door, and "← Back to app" never walks history. Two controls, two jobs, stated in their tooltips: "Back" and "Back to app".
  - **The clickable breadcrumb is kept, and it lives on the navy bar.** Settings spec §8.1 puts a clickable breadcrumb inside the takeover's white bar; this spec moves it up into the one breadcrumb the app has rather than dropping it. The navy bar reads `Settings › {Door} › {Page}` (for example `Settings › Workspace settings › Members`, `Settings › My settings › Preferences`), every crumb but the last is a link, the first crumb opens the door's landing and the last is the registry label, exactly as settings §8.2 requires. The takeover's white bar therefore carries no breadcrumb of its own; there is never a second location row (design system §4.3).
  - Search on the navy bar opens the **door filter**, not the global palette, while a door is open; `⌘K` and `⌘/` do the same (settings spec §8.2, "inside a door ⌘K opens the door search"). The placeholder changes to "Find a setting" so the field never lies about what it will search.
- **Secondary sidebar**: replaced by the settings list above; the rail shows Settings active.
- **Narrow widths** (the one breakpoint §1.16 does not cover with its own table): below **900px** the 264px settings list collapses to a "Pages" select rendered in the takeover's white bar to the right of "← Back to app" (settings spec §8.1; there is no ✕ on that bar, §2.8); the select lists the same rows in the same groups, shows the lock glyphs, and navigates on change. The rail, the navy bar and the §1.16 rules for them are unchanged at every width, so between 768 and 900 a person sees the rail, the `Menu` button in place of ‹ ›, the last two crumbs, and the Pages select. There is no overlay drawer here because there is no hub sidebar to overlay. Settings tables scroll inside their card; the 760px form column becomes fluid with 16px padding.
- **`/imports`: how a route outside `/settings/*` renders inside the takeover.** `/imports` is a `(dashboard)` route (`src/app/(dashboard)/imports`) and settings spec §5.10 keeps it working with the door breadcrumb until it folds into Data › Import. The mechanism, so this is buildable rather than asserted: the takeover is not keyed on the URL prefix, it is keyed on one exported constant, `SETTINGS_ROUTES` in `src/lib/nav/route-hub.ts` (`["/settings", "/account", "/imports"]`), which is also what `resolveHub` rule 1 reads and what `lastAppPath` excludes. `OsShell` renders `SettingsShell` when `SETTINGS_ROUTES` matches, so `/imports` gets the white 48px bar, the 264px settings list (with Data highlighted, because its row declares `href: "/settings/data"` and `match: "prefix"` plus an `alsoActiveOn: ["/imports"]` entry) and the navy bar breadcrumb `Settings › Workspace settings › Data › Import`. Its page gate is the `data` settings page rule (access spec §6.6), called from `/imports`' own layout rather than from the settings layout. When settings §5.10 lands, `/imports` becomes a 308 to `/settings/data?tab=import`, the `SETTINGS_ROUTES` entry and the `alsoActiveOn` entry are deleted together, and the `ROUTE_HUB` row goes with them. This is the only member of `SETTINGS_ROUTES` outside the two door prefixes and the constant exists so a second one can never be added by accident: a test asserts the array has exactly these three entries.
- **Page header stack**: settings pages use the settings spec's title 22/600 and text-tab pills; no `OsTitleBar`, no in-page breadcrumb (settings spec §8.3).
- **Body layout**: settings unit.
- **Side panel / drawer / modal**: the settings unit's drawers (520) and dialogs; Esc closes a drawer or dialog first, then triggers the dirty guard, then leaves (settings spec §8.3).
- **States**: loading = route skeleton (§2.2) inside the takeover, with the settings list already painted from the boot payload. Empty = per page. Error = per page with `ErrorState` and a wired Retry; a failed GET never renders an empty form, so Save cannot overwrite live values with blanks (settings spec §8.6). Read-only = two real cases and neither is a disabled control: the People team sees the four `peopleTeamRead` pages with only the people-data fields writable (access spec §6.6), and any viewer sees a locked preference row greyed with "Set by your workspace" (settings spec §5.2 `lockedKeys`). Denied = the `AdminOnly` card at the same URL for an Admin on an Owner-only page, the Ask-an-admin strip over My settings › Profile for a Member, Guest or Agent on any Workspace page, and never a 404, because the personal door shares the `/settings` prefix (access spec §5.5 item 3). Offline = the offline strip (§1.7) sits under the navy bar above the takeover's white bar; autosaving controls queue and toast the offline message, Save-bar pages keep the form dirty and the Save button says "Couldn't save. Try again" rather than clearing. Session-expired = §2.15, with the dirty-form draft flushed by `useDraftOnExpiry` (§1.10) so a half-written Culture or Identity form survives.
- **Keyboard**: `⌘K` and `⌘/` focus the door filter; Esc per above; the global map otherwise.
- **Data**: `openSettings(href)` / `closeSettings()` from `src/lib/settings-nav.ts`; `lastAppPath` in shell context mirrored to `sessionStorage["workwrk:shell:last-app-path"]` (settings spec §8.3). The shell writes `lastAppPath` on every non-settings pathname change.
- **Realtime**: `prefs.changed`.
- **What changes vs today**: Back/✕/Esc → `/today` (`settings-shell.tsx:136-179`) becomes the origin rule, and the ✕ goes with it (one exit affordance plus Esc); the hidden-vs-shown rail question is settled (rail and bar stay, the settings spec's "rail unmounts" is superseded); the takeover's numbers are reconciled to the design system (door sidebar 264 with 20px icons, sidebar rows 36, group labels 11/600 uppercase, settings content rows 48 minimum) and the takeover bar's ✕ is deleted; the in-takeover breadcrumb moves up to the navy bar so there is one breadcrumb and one "back to app"; `SettingsSidebar` hub sidebar deleted; the two-door nav is the settings spec's list; `/imports` gets a named mechanism instead of an assertion.
- **Open questions**: none (the settings spec's open decision 11 on one list versus two doors is theirs).

### 2.9 Search palette (no URL; overlay; `command-palette.tsx`)

- **Purpose**: find anything or jump anywhere by typing.
- **Who sees it**: everyone; entry: the bar's Search field, `⌘K`, the 404 page's "Search" link, the Create menu's footer "Search for more…".
- **Anatomy**: Radix Dialog, **640px** wide, top 12vh, `--os-surface`, radius 12, `--os-shadow-modal`, `--os-scrim`. 640 is the one width in this unit outside the design system's modal size set (400 / 560 / 720 / 960, §4.5 and §5.5) and it is **flagged as a deliberate deviation**, not an oversight: the palette is a search surface rather than a form, 560 cuts the container path ("Sales › Q4 › Website redesign") off two-line rows, and 720 makes a mostly empty list dominate the page. Requested of the design system as a sixth, search-only size token, `--os-modal-search: 640`, used by this surface and nothing else; if the design system refuses it, the palette takes 720 and the deviation disappears. Header: one 44px input (16px magnifier, placeholder "Search or type a command…", 14/400, ✕ clears, kbd "esc" right). Under it a chip row (32px, `Chip` toggles, single-select): All · Tasks · Docs · People · Spaces & Lists · Apps · Settings. Body: sections with 11/600 uppercase labels, rows 36 in `MenuList` (16px glyph identical to the object's list glyph: `EntityTile xs` for Spaces/Lists/Docs, 20px avatar for people, a pale `StatusChip` dot for tasks, Lucide for apps and settings; label 14/400; secondary 13/400 `--os-ink-2` for the container path "Sales › Q4"; right-aligned kbd for commands). Footer 36px: "↑↓ move · ↵ open · ⌘↵ open in new tab · esc close" 12/500 `--os-ink-3`, real hints only.
- **Empty query**: RECENT (last 5 opened objects and apps, localStorage ephemera), JUMP TO (**Home** (`/home`, `G H`), **My work** (`/my-work`) and **Inbox** (`/inbox`, `G I`) first, then the eight hubs, then every folded app the viewer may open, in rail order; this is the launcher, and the three personal rows at the top are what replace the deleted My Work panel's palette command "Open My Work", §0), CREATE (Task ⌘⇧K, Doc, List, Reminder, Notepad, Voice note; gated like §2.10), MY SETTINGS entries that match nothing yet are hidden.
- **Typing (≥ 2 chars, 180ms debounce)**: results from `GET /api/search?q=&types=` (server-filtered by `accessibleIds`; Guests get only readable objects), grouped TASKS · DOCS · PEOPLE · SPACES & LISTS · APPS (name match on `visibleApps`) · SETTINGS (registry entries from `src/lib/settings-registry.ts`, Workspace entries only for Owner and Admin) · ACTIONS ("Create task named '{q}'", "Ask AI about '{q}'" when the AI hub is visible). Live task rows show their real status chip (today every live task shows "todo", `command-palette.tsx:325`).
- **Removed**: source tabs Gmail / Drive / SharePoint (no connector exists; they return when a connector does, as rows under an INTEGRATIONS section), the "Apps" source tab that filtered nothing, the Filter and Sort controls, the gear with no handler, "Tab for actions", the decorative ←/→, "G T"-style hints on navigate rows (replaced by the real `G n` from the registry), the "Open My Activity" → `/dashboard` command, the "Open My Work" command (it is the JUMP TO row "My work" now, §0), `AskAiButton` in the header (the "Ask AI about…" row replaces it).
- **Side panel / drawer / modal used here**: the palette opens things and closes itself first, so nothing stacks on it: a CREATE row opens the quick-task modal (720), the Create List modal (560), the Reminder dialog (§2.19), the Notepad panel (§2.20) or the Voice note popover (§2.21); an object row navigates, opening the task drawer over its list where the object is a task.
- **States**: loading = three skeleton rows under the section that is fetching. Empty = one line "No results for '{q}'" plus the CREATE and ACTIONS rows, so the dead end always offers a next step. Error = one line "Search isn't available right now · Try again" (wired). Read-only = n/a (§2 convention 2). Denied = n/a as a view, and that is the security property: results are filtered on the server by `accessibleIds`, so an object the viewer cannot read is absent rather than locked, and the palette never renders `LockedPage`; a findable Space the viewer holds nothing on is the one exception and appears as a locked row with a lock glyph that opens the `LockedPage` at its URL (access spec §5.3). Offline = the empty-query sections (RECENT, JUMP TO, CREATE) still work because they read boot data, and the results area shows one line "You're offline. Search needs a connection." Session-expired = the §2.15 dialog takes the screen and the palette closes with it.
- **Keyboard**: ↑↓ ↵ ⌘↵ esc; type-ahead; the chips via ← → when the input is empty.
- **Data**: `GET /api/search` (exists; gains `types` and `accessibleIds` filtering per the access spec), `visibleApps` from boot, the settings registry (client bundle, gated by page rule), `POST /api/docs` for quick doc.
- **Realtime**: none.
- **What changes vs today**: 700px with five decorative controls → 640 with one input, one chip row, real sections; folded apps become reachable (critic #1; `shell.md` Medium 21, 16).
- **Open questions**: none.

### 2.10 Create menu (no URL; the bar's "+"; `create-menu.tsx`)

- **Purpose**: make something new from anywhere.
- **Who sees it**: everyone; rows gated. Entry: the bar's "+", the Work hub sidebar "+" (`create: "global"`), the palette's CREATE section.
- **Anatomy**: `MenuList` popover 280px under the "+" (radius 8, `--os-shadow-pop`, padding 4), rows 36 with 16px icon, label 14/400, kbd right: **Task** (`CheckSquare`, ⌘⇧K, opens the quick-task modal; a Guest sees it only with Can edit on at least one List) · **Doc** (`FileText`, `POST /api/docs` then navigate) · **List** (`ListTodo`, Create List modal with a Space picker; needs `create_child` on any Space) · **Reminder** (`AlarmClock`, the Reminder dialog, §2.19) · **Notepad** (`NotebookPen`, the Notepad panel, §2.20) · **Voice note** (`Mic`, the Voice note popover, §2.21; the row is absent, never disabled, when the browser has no Web Speech API) · separator · **From template…** (`LayoutTemplate`, Template Center; Members only) · **Space** (`Building2`, New Space dialog; `org.create_space`, never Agents or Guests) · separator · **Ask AI** (`Sparkles`, ⌘J; only when the AI hub is visible). No "Super Agent · Hot", no AI free-text input, no "Import" (Data › Import), no "Customize your sidebar", no Sprint (Work unit's List menu).
- **Side panel / drawer / modal used here**: Task → the quick-task modal (Work unit, 720); List → the Create List modal (Work unit, 560); Reminder → the Reminder dialog (§2.19, 400); Notepad → the Notepad panel (§2.20, 440); Voice note → the Voice note popover (§2.21, 360); From template → the Template Center (Work unit, 960); Space → the New Space dialog (Spaces unit, 560); Ask AI → the Ask AI panel (360, §2.1). Doc creates and navigates with no overlay. The menu closes before the next layer opens, so the `LayerStack` never holds a menu under a modal.
- **States**: loading = n/a: every row and every gate comes from the boot payload, so the menu opens fully formed. Empty = a viewer who can create nothing here never sees the "+" at all: the button hides, it is never rendered disabled (this is the Guest-with-no-Can-edit case, and the Agent case for Space). Error = a failed create toasts "Couldn't create {thing}. Try again" with the Retry wired to the same call; the menu has already closed, so the toast is the whole report. Read-only = n/a (§2 convention 2). Denied = rows are absent, never greyed; a row that appears always works, which is the rule that lets a person trust the "+". Offline = the menu opens (it needs no network), and any row that writes shows the offline toast instead of a half-created object; Notepad still opens and its draft is kept locally until the connection returns. Session-expired = the §2.15 dialog takes the screen and the menu closes.
- **Keyboard**: ↑↓ ↵ esc; each row's chord is the registry's.
- **Data**: `POST /api/docs`, the Work unit's task and list modals, `POST /api/reminders`, `POST /api/spaces`; gates from `POST /api/access/check` cached per boot (`org.create_space`, `create_child` on any Space) and `visibleApps`.
- **Realtime**: none.
- **What changes vs today**: the Home sidebar's 12-row menu with a taupe input, "⌥T", a static Super Agent link and two coming-soon rows → one 8-row menu on the bar; quick-tool icons and profile pins folded in (`shell.md` Medium 22, High 2 for the trio).
- **Open questions**: none.

### 2.11 Bell popover (no URL; `notifications-popover.tsx` + `reminders-bell.tsx` merged)

- **Purpose**: what needs your attention: things people did that involve you, and reminders you set.
- **Who sees it**: everyone (Guests: only object notifications, access spec §2.3). Entry: the bell, a due-reminder toast's "Open".
- **Anatomy**: Radix Popover 400px, max-height 70vh, `--os-surface`, radius 8, `--os-shadow-pop`. Header 44px: "Notifications" 16/600 left; right: "Mark all read" text link 13/500 (Inbox tab only) and a 32px ghost `Settings2` → `/account/notifications`. Under it text-tab pills 14: **Inbox** (count 12/500 when unread) · **Reminders** (count when due). Rows 44px: Inbox row = 24px avatar or object tile, one line 14/400 (`--os-ink`, 500 when unread) "Priya mentioned you in Fix invoice PDF", meta 12/400 `--os-ink-2` "Sales › Q4 · 5m", an unread `Dots` at the left; hover reveals "Mark read" and "Snooze" as 28px ghost icons; click opens the object (drawer on its list page, or the page). Reminder row = 20px `AlarmClock`, title, "Due 3:00 pm"; hover "Done" and "Snooze" (1h · Tomorrow 9am · Pick…). Footer 36px: text link "Open Inbox" → `/inbox` (Inbox tab) or "New reminder" (Reminders tab, opens the Reminder dialog, §2.19). Max 20 rows; "See all in Inbox".
- **Badge**: the 6px dot on the bell only; counts live inside.
- **Mute**: `home.notifications.mutedUntil` silences the chime, the desktop alert and the toast; the dot and rows are unaffected (the misleading trailing chevron on the mute row goes).
- **Side panel / drawer / modal used here**: the Reminder dialog (§2.19) from the footer's "New reminder"; the "Snooze · Pick…" row opens a `Picker` date and time popover as a child of this popover (absolutely positioned, never a body portal, per the picker-in-dialog rule); a row click closes the popover and opens the task drawer over its list (Work unit) or navigates to the object's page.
- **States**: loading = three skeleton rows. Empty = "You're all caught up" 14/400 `--os-ink-2` centred, no illustration (a popover is too small for one) and no action. Error = "Couldn't load notifications · Try again", wired to the same fetch. Read-only = n/a (§2 convention 2). Denied = n/a as a view; the list is filtered on the server, so a notification about an object the viewer has since lost access to is absent rather than locked, and a row that survives always opens. A Guest sees only object notifications (access spec §2.3), so the Inbox tab may be empty for them and the Reminders tab still works. Offline = the last fetched rows stay, with one 13/400 `--os-ink-2` line "You're offline. This may be out of date." above them; Mark read, Done and Snooze queue and toast the offline message. Session-expired = the §2.15 dialog takes the screen and the popover closes.
- **Keyboard**: ↑↓ ↵ esc; `Tab` between the tabs.
- **Data**: `GET /api/inbox?limit=20`, `PATCH /api/inbox/[id]` (read, snooze), `POST /api/inbox/read-all`, `GET /api/reminders?state=due|upcoming`, `PATCH /api/reminders/[id]` (done, snooze); counts from boot and SSE.
- **Realtime**: `notif.changed`, `reminder.due`; the 45s poll only while SSE is down.
- **What changes vs today**: three bells and an inbox glyph → one bell; the ticker's persistent bottom-right cards → toasts + the Reminders tab; badge "99+"/"9+" → a dot; "Loading…" text → skeleton; mute stops lying about what it mutes (`shell.md` High 7, Low 35).
- **Open questions**: none.

### 2.12 Avatar menu (no URL; `profile-menu.tsx`)

- **Purpose**: you: status, your settings, theme, help, log out.
- **Who sees it**: everyone. Entry: the bar's avatar.
- **Anatomy**: `MenuList` popover 280px, radius 8, `--os-shadow-pop`. Header 56px: 36px avatar with the real presence dot, name 14/500, second line 13/400 `--os-ink-2` = status emoji + label ("Active", "In a meeting until 3 pm") or the email when no status. Rows 36 with 16px icons, in this order: **Set status…** (`SmilePlus`; opens the Set status modal: text, emoji picker, presets In a meeting / Focusing / Out sick / On vacation, "Clear after" select 30 min / 1 h / Today / This week / Never; writes `User.presenceStatus`, `presenceUntil`; the org name comes from the session) · **Mute notifications** (`BellOff`; submenu 1 hour · Until tomorrow · Until I turn it back on; when muted the row reads "Muted until 9:00 am · Unmute") · separator · **My profile** (`CircleUser` → `/people/me` for Owners, Admins and Members; **for a Guest the same row points at `/account/profile`**, because `/people/me` resolves into the Teams hub and a Guest never sees Teams, access spec §2.3; a Guest has a directory card but no people data, so the personal door is the honest destination and the label stays "My profile" per §1.3) · **My settings** (`Settings` → `/account/profile` via `openSettings`; for a Guest this row and My profile would then share a destination, so a Guest sees **My profile** only and the My settings row is absent) · **Workspace settings** (`Building2` → `/settings`; Owner and Admin only) · separator · **Theme** (an inline `SegmentedControl` Light · Dark · System writing `theme.appearance`; greyed with a lock when `theme.appearance` is in `lockedKeys`) · **Chrome** (Navy · Light, `theme.chrome`; rendered only after step 8 of the design-system order) · separator · **Keyboard shortcuts** (`Keyboard`; opens the `?` overlay; kbd "?") · **Help** (`CircleHelp`; opens §2.13's rows inline as a submenu) · separator · **Log out** (`LogOut`; `signOut({ callbackUrl: "/login" })`). No Personal Tools, no pins, no Trash, no "Notifications → /inbox".
- **Side panel / drawer / modal used here**: the Set status modal (400) from "Set status…"; a submenu (`MenuList`, 200) from "Mute notifications"; the shortcuts overlay (§2.17, 560) from "Keyboard shortcuts"; the Help rows inline as a submenu (§2.13); nothing else. The menu closes before a modal opens.
- **States**: loading = n/a: every value comes from the session and the boot payload. Empty = n/a: the menu always has rows. Error = a failed presence, mute or theme write toasts "Couldn't save. Try again" with Retry wired and **reverts the control**, so what is shown is always what is stored. Read-only = n/a as an object rule; the one read-only case is a locked preference, where Theme or Chrome renders greyed with a lock glyph and "Set by your workspace" (`lockedKeys`, settings spec §5.2) rather than as a live control that would be overwritten. Denied = rows are absent, never greyed: Workspace settings for anyone but Owner and Admin, My settings for a Guest (above), and Chrome until design-system step 8. Offline = the menu opens and every write toasts the offline message and reverts; Log out still works, because signing out is a client action and the server-side `tokenVersion` bump retries on reconnect. Session-expired = the §2.15 dialog takes the screen and the menu closes; Log out from that state is the dialog's "Sign in again".
- **Keyboard**: ↑↓ ↵ esc; ← → inside the segmented controls.
- **Data**: `PATCH /api/users/[id]` (presence), `PATCH /api/preferences` (`theme.*`, `home.notifications.mutedUntil`), session.
- **Realtime**: `prefs.changed`.
- **What changes vs today**: always-green dot → real presence; localStorage status and mute → server; dead Themes and Shortcuts rows → working; "Settings" → two doors; Personal Tools list and pins removed; Trash removed (`shell.md` High 6, 7, 9; Medium 19).
- **Open questions**: none.

### 2.13 Help menu (no URL; new, `help-menu.tsx`)

- **Purpose**: where to get help.
- **Who sees it**: everyone. Entry: the bar's "?" and the avatar menu's Help row.
- **Anatomy**: `MenuList` 240px: **Help center** (`BookOpen`, external, the documentation.ai site) · **Keyboard shortcuts** (`?`) · **What's new** (`Sparkles`, external `/changelog` on the marketing host; rendered only while that page exists) · **Privacy & cookies** (`Shield`; opens the consent preferences dialog, §1.13) · separator · **Contact support** (`Mail`; `mailto:support@workwrk.com`). "Take the tour" renders only when the onboarding unit registers rewritten tour steps (`TOUR_STEPS.length > 0`); the stale tour never auto-launches from the shell.
- **Side panel / drawer / modal used here**: the shortcuts overlay (§2.17, 560); the consent preferences dialog (560, the `ConsentProvider` UI mounted lazily, §1.13); the product tour (`TourProvider`, only from "Take the tour" and only when steps exist, §0). Help center, What's new and Contact support leave the app in a new tab or the mail client.
- **States**: loading = n/a: the rows are static. Empty = n/a: the menu always has Help center, Keyboard shortcuts, Privacy & cookies and Contact support; only What's new and Take the tour are conditional, and a conditional row is absent rather than disabled (§1.15). Error = a failed `window.open` (a popup blocker) toasts "Couldn't open Help. Copy the link" with the URL as the toast action; nothing else here can fail. Read-only = n/a (§2 convention 2). Denied = n/a: every row is available to every signed-in person including Guests, because help is never gated. Offline = the menu opens; Help center, What's new and Contact support show the offline toast rather than a dead tab, and Keyboard shortcuts and Privacy & cookies still work because both are local. Session-expired = the §2.15 dialog takes the screen and the menu closes.
- **Keyboard**: ↑↓ ↵ esc; `?` from anywhere reaches the shortcuts overlay without opening this menu.
- **Data**: none. The Help center URL and the changelog URL are two constants in `src/lib/nav/labels.ts`.
- **Realtime**: none.
- **What changes vs today**: `window.open("https://workwrk.com/help")` from the avatar menu → a Help door on the bar; the consent dialog gets an in-app entry; the tour stops auto-launching and becomes a row here (`shell.md` #31).
- **Open questions**: the Help center URL (documentation.ai project "Workwrk") is assumed public.

### 2.14 Workspace menu (no URL; `workspace-menu.tsx`, opened from the sidebar header)

- **Purpose**: the company account: switch, invite, manage, upgrade.
- **Who sees it**: everyone; rows gated. Entry: the sidebar header's workspace switcher.
- **Anatomy**: `MenuList` 300px. Header 64px: `EntityTile md` with logo, org name 15/500, second line 13/400 `--os-ink-2` "{plan} · {N} members" (Guests see the name only). Rows 36: **Invite people** (`UserPlus` → `/settings/members?invite=1` via `openSettings`; `can(viewer, "invite_member", org)`) · **Manage members** (`Users` → `/settings/members`; Owner and Admin) · **Workspace settings** (`Settings` → `/settings`; Owner and Admin) · **Upgrade** (`ArrowUpCircle` → `/settings/billing`; Owners and `billing` Admins on non-Enterprise plans) · separator · SWITCH WORKSPACE label with one row per other org the person belongs to (`EntityTile sm` + name; click hard-navigates to `/home` in that org) · **Create workspace** (`Plus`; the existing prompt dialog). No "Apps", no "Automations" (both toasted "coming soon"), no "Templates" (Template Center is in Create), no "Delete workspace" (Identity › Danger zone).
- **Side panel / drawer / modal used here**: "Create workspace" opens a 400px prompt dialog (`DialogProvider`); "Invite people" and "Manage members" leave for the settings takeover through `openSettings`, so no modal opens here; nothing else.
- **States**: loading = the SWITCH WORKSPACE list shows three skeleton rows on first open, everything above it is instant from the boot payload. Empty = no other workspaces means the SWITCH section is absent entirely, not an empty label under a heading. Error = "Couldn't load workspaces · Try again" as one line in place of the switch list; the rest of the menu still works. Read-only = n/a (§2 convention 2). Denied = gated rows are absent, never greyed (Invite people without `invite_member`, Manage members and Workspace settings for anyone but Owner and Admin, Upgrade for anyone but an Owner or a `billing`-scope Admin and never on Enterprise); a Guest sees the org name and nothing else. Offline = the menu opens from cached boot data, the switch rows and Create workspace toast the offline message. Session-expired = the §2.15 dialog takes the screen and the menu closes.
- **Keyboard**: ↑↓ ↵ esc.
- **Data**: session (org, plan), `GET /api/me/workspaces` (exists as the switcher's source), `POST /api/organizations` (create); gates from boot.
- **Realtime**: none.
- **What changes vs today**: two coming-soon toasts and a Templates row removed; Invite opens the invite modal on load; Upgrade has one target; the menu moves from the bar's left to the sidebar header (`shell.md` Medium 18, 19; Low 42).
- **Open questions**: none.

### 2.15 Session-expired dialog (no URL; new, `session-expired-dialog.tsx`)

- **Purpose**: tell you plainly that you have been signed out, and get you back without losing work.
- **Who sees it**: anyone whose session lapses mid-use (idle timeout, absolute lifetime, sign-out-everywhere, deactivation).
- **Anatomy**: 400 modal, not dismissable by Esc or outside click, no ✕. Title 16/600 "You've been signed out", body 14/400 "Sign in again to keep working. Anything you were typing has been kept on this device." (the second sentence only when a draft was flushed), one primary "Sign in again" → `/login?callbackUrl=<current>`. A second sentence variant for sign-out-all: "You were signed out on every device."
- **How "everything else is inert" is built, so the dialog does not hide itself from a screen reader**: the shell renders the whole app inside `<div id="app-root">` and the dialog is a Radix `Dialog` **portalled to `document.body`, outside `#app-root`**. While it is open the shell sets `inert` and `aria-hidden="true"` on `#app-root` only (never on `body`, never on the portal container), which removes the frame from the accessibility tree and from the tab order while leaving the dialog fully exposed. Radix's own focus trap keeps Tab inside the dialog and returns focus on close. This is the only time the shell is inert, and it is the only place `aria-hidden` is written by the shell; the rest of the app relies on Radix's per-overlay handling. Visually the frame stays on screen behind the `--os-scrim` so a person can see where they were. Every poller and the SSE connection are stopped in the same tick.
- **Side panel / drawer / modal used here**: none. This dialog is the top layer by definition; the `LayerStack` closes and refuses every other layer while it is open, so nothing can stack on it and nothing can appear under it.
- **States**: the dialog is one state by design, because an expired session has nothing to load, nothing to be empty of and nothing to deny. Loading = n/a. Empty = n/a. Error = n/a: the only action is a link to `/login`, which the browser performs; a failure there is the login page's problem. Read-only = n/a (§2 convention 2). Denied = n/a: the dialog is what a denied session looks like. Offline = the offline strip renders above the scrim and the body gains a second sentence "You're offline. Sign in when you're back." with the primary still live, because the browser may reconnect between the message and the click.
- **Keyboard**: Enter activates the primary; Tab is trapped; Esc does nothing and is the one place in the app where Esc is deliberately inert (§1.5).
- **Data**: the `workwrk:session-expired` event; `useDraftOnExpiry` flushes editor drafts (§1.10).
- **Realtime**: SSE closed.
- **What changes vs today**: nothing existed; empty sidebars and "Inbox Zero" on a lapsed JWT end (critic #11).
- **Open questions**: none.

### 2.16 Customize panel (no URL; `customize-panel.tsx`, from the sidebar footer)

- **Purpose**: make the sidebar and the look yours.
- **Who sees it**: everyone. Entry: the sidebar footer "Customize Sidebar", the palette's "Customize sidebar" row.
- **Anatomy**: Radix Dialog **560** (the design system's modal size set, §5.5; the earlier 440 is dropped so this unit has exactly one flagged width deviation, the palette's 640). Header 56: title "Customize" 16/600, description 13/400 `--os-ink-2` "Changes save as you make them", **✕ 32px ghost at the right**. **No footer**: every control writes immediately through `PATCH /api/preferences` and shows the design system's inline "Saved ✓" 12/500 `--os-success-text` tick that fades after 2s (§5.4), so there is no Save and no Cancel to offer and a footer would be a lie about what Cancel would undo. Close affordances, all three: the ✕, Esc (the top layer, §1.5) and an outside click; no dirty guard, because nothing is ever unsaved. Body padding 24: three settings rows 48px (label 14/500, control right): **Theme** (`SegmentedControl` Light · Dark · System), **Chrome** (Navy · Light; after step 8), **Density** (Comfortable · Cozy · Compact; "Tables use Compact" helper); each greyed with a lock and "Set by your workspace" when locked. Then a SIDEBAR SECTIONS card: one row per section of the current hub (drag handle `Dots grip`, label, a `Switch` to show/hide; "Move up / Move down" in a row "…" for keyboard users); sections marked required by the hub (Work's personal block) have no switch. Footer: "More in My settings › Preferences" text link. No accents, no icons-only, no Home cards tab (the Work unit decides where `home.cards` is edited, per settings spec §4.2 "shown here AND in the Customize panel": if the Work unit keeps `home.cards`, its rows appear as a HOME CARDS card here, written to the same key), no "Create section" coming-soon row.
- **Side panel / drawer / modal used here**: none. The "More in My settings › Preferences" link closes this dialog and opens the settings takeover through `openSettings`, so the two never stack.
- **States**: loading = n/a in practice: every row renders from the boot preferences, which are already in memory when the dialog opens. Empty = n/a: Theme, Chrome and Density always exist, and the SIDEBAR SECTIONS card always has at least one section because a hub with no sections has no sidebar. Error = a failed write toasts "Couldn't save. Try again" with Retry and **reverts the control**, so the dialog never shows a setting the server did not take. Read-only = the locked case, and it is real: a control whose key is in `OrgPreference.lockedKeys` renders greyed with a lock glyph and "Set by your workspace", not hidden, because a person needs to know why they cannot change it. Denied = n/a: every signed-in person may customise their own sidebar, Guests included. Offline = the dialog opens and each write toasts the offline message and reverts; nothing is queued, because a half-applied appearance is worse than no change. Session-expired = the §2.15 dialog takes the screen and this one closes.
- **Keyboard**: Tab, ← → in segmented controls, Space on switches, Esc closes, and the section list's "Move up / Move down" live in each row's "…" so reordering never requires a drag.
- **Data**: `PATCH /api/preferences` (`theme.appearance`, `theme.chrome`, `density`, `sidebar.sectionsOrder`, `sidebar.hiddenSections`), `lockedKeys` from boot.
- **Realtime**: `prefs.changed`.
- **What changes vs today**: four tabs with 11 accents, icons-only, a dead Home tab and a disabled "Create section" → one 560 dialog with three segmented controls and the section list (`shell.md` High 10, Medium 12, 13); the accent picker's twin on `/account/preferences` goes in the same PR (§0).
- **Open questions**: none.

### 2.17 Keyboard shortcuts overlay (no URL; new, `shortcuts-overlay.tsx`)

- **Purpose**: every shortcut that works right now, in one place.
- **Who sees it**: everyone. Entry: `?`, `⌘/` outside a door, the avatar and Help menus; `/account/shortcuts` renders the same table as a page (settings spec §4.6).
- **Anatomy**: Radix Dialog 560, title "Keyboard shortcuts", two-column table of `kbd` + description grouped GLOBAL · NAVIGATE (`G` chords) · ON THIS PAGE (page-registered chords, absent when none) · IN LISTS AND EDITORS (the units' registered chords); a footer line "⌘ is Ctrl on Windows and Linux". Rendered from `src/lib/shortcuts.ts` only; nothing hand-written.
- **Side panel / drawer / modal used here**: none.
- **States**: loading = n/a: the registry is a client module, so the table paints with the dialog. Empty = the ON THIS PAGE group is absent when the current page registers nothing, and that absence is the feature: the overlay shows only what works right now, so it can never advertise a dead chord (`shell.md` High 9 and Medium 22 are both about advertised-but-dead chords). The overlay as a whole is never empty, because GLOBAL always has rows. Error = n/a: nothing is fetched. Read-only = n/a (§2 convention 2): the overlay is a reference, it has no controls. Denied = rows whose `when` predicate is false for this viewer are absent, so a Guest never sees `⌘J` (Ask AI) and an Agent never sees a chord for an action they are capped out of. Offline = unchanged; everything here is local. Session-expired = the §2.15 dialog takes the screen and this one closes.
- **Keyboard**: Esc closes; `?` and `⌘/` open it; the table itself is not interactive.
- **Data**: `src/lib/shortcuts.ts` only.
- **Realtime**: none.
- **What changes vs today**: no surface existed (`shell.md` High 9).
- **Open questions**: none.

### 2.18 Mission splash (no URL; `mission-splash.tsx`)

- **Purpose**: the company's mission and one value as the app opens.
- **Who sees it**: everyone in an org with a mission or values, per `companyProfile.splash`.
- **Anatomy**: design system §5.15 exactly: full screen `#1B2537`, dots 12px rising Y B R G, eyebrow 11/600 uppercase 50% white "{Org} · Our mission" or "We live by", the line 22 to 32px/600 white (values in white too; the YBRG value colours go, colour stays on the dots), 1.2s hold, 160ms fade, "Click or press Esc to skip" 12px at 40%, the bottom progress line removed (one loader per screen). `role="status"`, `aria-live="polite"`; skippable by any key or click; `prefers-reduced-motion` renders it static for 1.2s.
- **Side panel / drawer / modal used here**: none. The splash is the top layer while it holds and refuses every other layer, so nothing opens behind it.
- **States**: loading = the splash IS the boot loading state, layered over the navy boot screen, which is why it never restarts across the boot-to-ready swap. Empty = it renders nothing at all when the org has neither a mission nor values, when the setting is `off`, or when the daily or session throttle has already fired; an empty splash is never shown, because a blank navy screen reads as a hang. Error = a failed culture read is not an error state here: the splash simply does not render and boot continues (a missing mission must never block the app). Read-only = n/a (§2 convention 2). Denied = n/a: culture is org-wide and every signed-in person sees it, Guests included, which is deliberate because the mission is what the founder wants every person who opens the app to read. Offline = a cold boot offline has no boot payload and therefore no splash; the boot `ErrorState` (§1.7) is what renders. Session-expired = n/a: the splash only exists at boot, and the §2.15 dialog only exists after it.
- **Keyboard**: any key skips, Esc included. **Data**: culture from boot. **Realtime**: none.
- **What changes vs today**: 1.6s + 380ms and every 10 minutes on navigation → 1.2s + 160ms at boot only; the org logo no longer replaces the dots (the dots are the brand moment; the logo lives in the eyebrow as text).
- **Open questions**: the default of `companyProfile.splash` (`every-open` per the settings spec's open decision 4 versus `first-open-daily` per design system open decision 5). This spec ships the settings spec's default and the design system's motion; the founder can flip the default in Settings › Identity › Culture.

### 2.19 Reminder dialog (no URL; `reminder-popover.tsx` rewritten)

- **Purpose**: set yourself a reminder in about five seconds, from anywhere, without leaving the page you are on.
- **Who sees it and entry points**: everyone, Guests included (a reminder is personal and touches no object). Entry: Create menu › Reminder (§2.10), the palette's CREATE › Reminder row (§2.9), the bell's Reminders tab footer "New reminder" (§2.11), and a task's "…" menu › Remind me (Work unit, which passes the task as the reminder's subject).
- **Anatomy**: Radix Dialog **400** (design system §5.5, the confirm size, which is what this is: one field and a time), centred, `--os-surface`, radius 12, `--os-shadow-modal`, `--os-scrim`. It is a centred dialog, not a popover anchored to the bell, because it opens from four places and only one of them is the bell. Header 56: 16px `AlarmClock` in `--os-ink-2` (never a red glyph; the hard-coded `#FB5A6F` goes), title "New reminder" 16/600, ✕ 32px ghost right. Body 24, fields 16 apart: (1) one 36px text input, autofocus, placeholder "Remind me to…", `Enter` submits; (2) a row of three 32px `Chip` presets, "In 1 hour", "This evening", "Tomorrow 9am", the selected one `--os-surface-2`; (3) a 36px date-and-time `Picker` (the design-system picker, never a native `datetime-local`), which the presets write into so the two controls never disagree; (4) one 36px row with a `Switch` and the label "Also email me", default off, remembered per user in `home.notifications.reminderEmail`. When the dialog was opened from a task, a fifth read-only row above the input shows the task's `EntityTile xs` and title with a ✕ to detach it. Footer 64: "Cancel" ghost left of the one primary "Set reminder" (`--os-brand`, 36px, disabled until the title is non-empty, `Dots pending` replacing nothing and preserving the label while saving, per §1.6).
- **Side panel / drawer / modal used here**: the date-and-time `Picker` opens as an absolutely positioned child of the dialog, never a body portal (the picker-in-dialog rule).
- **States**: loading = n/a: the dialog opens with defaults computed on the client. Empty = n/a: it is a create form. Error = a failed `POST /api/reminders` keeps the dialog open, keeps every value, and shows a 13/400 `--os-danger-text` line under the footer "Couldn't set the reminder. Try again", with the primary live; a past time is a field error on the picker ("Pick a time in the future"), not a toast. Read-only = n/a (§2 convention 2). Denied = n/a: a reminder is the viewer's own row, so there is nothing to deny; when the dialog carries a task the viewer has lost access to, the task row is dropped with one line "That task isn't available any more" and the reminder is still created as a plain one. Offline = the dialog opens, and "Set reminder" shows the offline toast and keeps the dialog open rather than creating a reminder that will never fire. Session-expired = §2.15 takes the screen; the typed title is flushed by `useDraftOnExpiry` and restored when the dialog is next opened.
- **Keyboard**: `Enter` in the title submits; Tab through the four controls; ← → move between the preset chips; Esc closes (the top layer, §1.5), with a confirm only when the title is non-empty.
- **Data**: `POST /api/reminders { title, remindAt, notifyEmail, entityType?, entityId? }` (exists); `PATCH /api/preferences` for `home.notifications.reminderEmail`; the viewer's time zone from `home.locale.timezone` (settings spec §4.2), which is what makes "Tomorrow 9am" mean 9am where the person is.
- **Realtime**: none on create; the reminder later arrives through `reminder.due` (§1.11).
- **What changes vs today**: a hand-rolled overlay at `z-[95]` with its own Esc listener, hard-coded `#0073EA` and `#FB5A6F`, a native `datetime-local` and a `Loader2` spinner → a 400 Radix dialog on tokens, in the `LayerStack`, with the design-system picker and the `Dots pending` button state; the reminder is now reachable from four named doors instead of a quick-tool icon that no longer exists.
- **Open questions**: none.

### 2.20 Notepad panel (no URL; `notepad-panel.tsx`)

- **Purpose**: your own private notes, one keystroke away, on top of whatever page you are on.
- **Who sees it and entry points**: everyone, Guests included; a Notepad is owner-only with no grants and no Admin read-around (access spec §3.3, "Notepad (Doc entityType NOTEPAD) owner only"). Entry: Create menu › Notepad (§2.10), the palette's CREATE › Notepad row, and the Docs hub's "My notes" row (Docs unit, which opens this panel rather than a page). The `⌘⇧N` chord that opened a note today is gone (§1.8) and this panel is where its job lands (§0).
- **Anatomy**: a right slide-over **440** wide, full height under the navy bar, `--os-surface`, `border-inline-start: 1px solid var(--os-line)`, `--os-shadow-modal`, radius 0, no scrim; the content dims to 92% as every drawer does (design system §4.5). It is a `Drawer`, not a `Dialog`, so a person can still read the page behind it. Header 48: back ‹ (32px ghost, list view only), title "Notes" 16/600 or the note's title when one is open, the `AutosaveIndicator` dot (design system §5.17) and a 32px ghost `Plus` "New note", ✕ right. Two views inside one panel: **list**, rows 36 in `.os-row` with a 16px `FileText` in `--os-ink-2`, title 15/500 truncated, second line 13/400 `--os-ink-2` excerpt, right-aligned relative time 12/500, hover reveals one "…" (Rename, Duplicate, Delete); and **editor**, the BlockNote canvas at `--os-t-prose` 15/24 in the full panel width with 20px padding, debounced autosave. Opening the panel with no note ever created opens the editor on a fresh note directly, so "new note in one action" survives the loss of `⌘⇧N`. The hard-coded `#FBE9AE` yellow header goes; a note is white like every other surface.
- **Side panel / drawer / modal used here**: the Delete row opens the 400 confirm dialog (`DialogProvider`); the editor's own slash menu and link popover are the Docs unit's and are absolutely positioned children of the panel.
- **States**: loading = the list shows three 36px skeleton rows; the editor shows a skeleton paragraph block, never the `Loader2` spinner the dynamic import uses today. Empty = the quiet empty view (design system §5.8, stack arrangement): "Your notes are private to you", one text link "New note". Error = `ErrorState` inside the panel, "Couldn't load your notes · Try again", wired; a failed **save** never uses that pattern, it drives the `AutosaveIndicator` to its failed state with the words "Not saved, retrying" (§1.6 and the data-integrity rule), and the text stays in the editor. Read-only = n/a in the object sense: a Notepad has exactly one viewer and they always hold Full access. Denied = n/a: there is nothing here that belongs to anyone else, and a Notepad id that is not yours 404s at the API. Offline = the panel opens, the list serves what was fetched, the editor keeps typing into the local draft and the `AutosaveIndicator` says "Not saved, retrying" until the connection returns; nothing is lost and nothing is silently dropped. Session-expired = §2.15 takes the screen; `useDraftOnExpiry` flushes the open note to `localStorage["workwrk:draft:notepad:{id}"]` and the panel offers "Restore unsaved changes" on the next mount.
- **Keyboard**: Esc closes the panel (the top layer, §1.5, and the panel's own window listener is deleted); ‹ returns to the list; the editor's own chords are the Docs unit's and appear in the `?` overlay under ON THIS PAGE while the panel is open.
- **Data**: `GET /api/docs?entityType=NOTEPAD&entityId={me}` (list), `GET /api/docs/{id}`, `POST /api/docs` (create), `PATCH /api/docs/{id}` (autosave), `DELETE /api/docs/{id}`; all through `apiFetch` (§1.7) so a 401 raises the session-expired event instead of emptying the list.
- **Realtime**: none. A Notepad has one viewer, so there is nothing to reconcile.
- **What changes vs today**: a hand-rolled `z-[91]` slide-over with its own Esc listener, a `#FBE9AE` header and two `Loader2` spinners → a 440 `Drawer` in the `LayerStack` on tokens, with skeletons, the `AutosaveIndicator` contract and a real empty state; `⌘⇧N`'s job moves here with a door in the Create menu and the palette.
- **Open questions**: none.

### 2.21 Voice note popover (no URL; `voice-capture-popover.tsx`)

- **Purpose**: say it instead of typing it, then keep it as a note or turn it into a task.
- **Who sees it and entry points**: everyone whose browser has the Web Speech API; where it does not, the row is **absent**, never disabled (§1.15), and no tooltip promises it later. Entry: Create menu › Voice note (§2.10) and the palette's CREATE › Voice note row.
- **Anatomy**: Radix Popover **360**, anchored under the bar's "+", `--os-surface`, radius 8, `--os-shadow-pop`, no scrim (a popover, because recording is a short act over the page you are on, not a room you enter). Header 44: 16px `Mic`, title "Voice note" 16/600, ✕ 32px ghost right. Body 16: a 32px status line, "Listening…" with the `Dots live` variant while recording and "Tap to start" at rest; the transcript in a 160px-max scrolling block, final text `--os-ink` 14/400 and interim text `--os-ink-3` in the same size so a person can see what is still being guessed; a 12/500 `--os-ink-2` line "Stays on your device until you save it", which is true (the Web Speech API is the browser's) and is the sentence that makes people comfortable using it. Controls row 36: the one primary is the record toggle (`Mic` to start, `Square` "Stop" while recording), then ghost "Retry" (`RotateCcw`) once there is a transcript. Footer 44, only once there is a transcript: three text links, **Save as note** (creates a NOTEPAD doc and opens it in the Notepad panel, §2.20), **Create task** (opens the quick-task modal with the transcript **prefilled as the title**, Work unit) and **Copy**. The clipboard hop this does today, copying the transcript and then opening a modal with no prefill, is deleted: the Work unit's quick-task modal takes a `title` prop.
- **Side panel / drawer / modal used here**: Save as note opens the Notepad panel (§2.20); Create task opens the quick-task modal (Work unit, 720). This popover closes first in both cases.
- **States**: loading = n/a: recording starts on the click, with no fetch. Empty = at rest the body is the status line and the prompt sentence, with the record button as the one action. Error = a denied microphone permission renders one 13/400 `--os-danger-text` line in place of the transcript, "WorkwrK can't hear your microphone. Allow it in your browser settings", with the record button still live so a person can retry after allowing it; a recognition error shows "Couldn't catch that · Try again" and keeps whatever was already transcribed. A failed **Save as note** toasts with Retry and keeps the transcript in the popover, so speech is never lost to a network failure. Read-only = n/a (§2 convention 2). Denied = n/a: a voice note belongs to the speaker until they save it, and where it is saved (a Notepad, a task on a List) is gated by that destination's own rule, so Create task is absent for a viewer with Can edit on no List, exactly as the Create menu's Task row is. Offline = recording and transcription still work (they are local), Copy works, and Save as note and Create task show the offline toast and keep the transcript. Session-expired = §2.15 takes the screen; the transcript is flushed by `useDraftOnExpiry` and offered back on the next open.
- **Keyboard**: Space toggles recording while the popover has focus and the caret is not in a field; Esc stops recording and closes (the top layer, §1.5; the panel's own listener is deleted); Tab reaches the three footer links.
- **Data**: `POST /api/docs` (NOTEPAD doc for Save as note); the Work unit's quick-task modal for Create task; `navigator.clipboard.writeText` for Copy. No audio is uploaded and no transcript is sent anywhere until one of the three actions is used; that is what the body line promises.
- **Realtime**: none.
- **What changes vs today**: a hand-rolled `z-[95]` panel with its own Esc listener and hard-coded hexes → a 360 Radix popover in the `LayerStack` on tokens; the clipboard-then-open-modal workaround is replaced by a real prefill; the browser-support case becomes an absent row instead of a surprise toast.
- **Open questions**: none.

---

## 3. Shared components this unit introduces or requires

| Component | Lives in | Props (summary) | Used by |
|---|---|---|---|
| `Shell` (`OsShell` rewritten) | `src/components/layout/os/os-shell.tsx` | children | `(dashboard)/layout.tsx` |
| `Rail` | `src/components/layout/os/rail.tsx` | `apps: AppKey[]` (from `visibleApps`, navigation), `active: HubKey`, `dots: Partial<Record<HubKey, boolean>>`, `manageableOffModules: AppKey[]` (the §1.4 admin-only off-module tiles, `aria-disabled`, outside `G n` numbering and never `aria-current`) | Shell |
| `Logo` (rail mark + route pulse) | `src/components/brand/logo.tsx` | `size`, `pulsing` | Rail, boot screen |
| `HubSidebar`, `SidebarSection`, `SidebarRow`, `SidebarTreeRow`, `SidebarEmptyLine`, `SidebarErrorLine` | `src/components/layout/os/hub-sidebar/` | `SidebarSpec` (§1.2) | every hub unit's sidebar |
| `resolveHub`, `ROUTE_HUB`, `ROUTE_TITLES`, `resolveCrumbFallback`, `resolveActiveRow`, `SETTINGS_ROUTES` | `src/lib/nav/route-hub.ts` | pure functions and two constant tables; `ROUTE_TITLES` is the breadcrumb fallback every unit's pages depend on (§2.1) and `SETTINGS_ROUTES` is what puts `/imports` inside the takeover (§2.8) | Rail, HubSidebar, TopBar breadcrumb, OsShell, tests |
| `TopBar`, `Breadcrumb` (provider + declaration component), `NavHistory` (`navStack`, ‹ ›) | `src/components/layout/os/top-bar/` | `items`, `search`, `right` | Shell, every page (`<Breadcrumb items/>`) |
| `LayerStack` (in shell context) + `useLayer(kind)` | `shell-context.tsx` | registers an open overlay; Esc closes the top | palette, drawers, modals, panels, popovers, splash |
| `ShortcutRegistry`, `useShortcut`, `SHORTCUTS` | `src/lib/shortcuts.ts` | `{ id, keys, label, scope, when, run }` | shell listener, tooltips, overlay, `/account/shortcuts` |
| `apiFetch`, `useShellQuery` | `src/lib/api-client.ts` | typed result, 401 and offline events | every shell fetch; hub units are encouraged to adopt it |
| `SessionExpiredDialog`, `useDraftOnExpiry` | `src/components/layout/os/session-expired-dialog.tsx`, `src/hooks/use-draft-on-expiry.ts` | | Shell; editors |
| `OfflineStrip` | `src/components/layout/os/offline-strip.tsx` | | Shell |
| `ErrorState` (= `OsEmptyView variant="error"`) | `src/components/layout/os/empty-view.tsx` | `what`, `onRetry`, `reference` | error.tsx, panels, pages |
| `ComingSoonRow` | `src/components/ui/coming-soon-row.tsx` | `label` | any unit under `showUpcoming` |
| `OsPageHeader`, `OsViewsRow`, `OsToolbar` (replacing `OsTitleBar`) | `src/components/layout/os/page-header/` | per design system §4.4; no dead trio, no fake people | every list and detail page |
| `ValueLine` (replacing `ValueLoader`) | `src/components/brand/value-line.tsx` | | loading.tsx |
| `SkeletonPage`, `SkeletonRows` | `src/components/ui/skeleton.tsx` | `rows`, `header` | loading.tsx, panels |
| `HelpMenu`, `ShortcutsOverlay`, `BellPopover`, `CreateMenu`, `AvatarMenu`, `WorkspaceMenu`, `CustomizePanel`, `SetStatusModal` | `src/components/layout/os/` | | Shell |
| `ReminderDialog` (`reminder-popover.tsx` rewritten), `NotepadPanel`, `VoiceNotePopover` (`voice-capture-popover.tsx` rewritten) | `src/components/layout/os/` | no props; each registers a layer and opens from the Create menu and the palette | Shell (§2.19, §2.20, §2.21) |
| `SkipLinks` | `src/components/layout/os/skip-links.tsx` | none; renders "Skip to content" and "Skip to sidebar" as the first two focusable elements | Shell (§2.1 landmarks) |
| `DialogProvider` (`useConfirm`, `usePrompt`) | `src/components/ui/dialog-provider.tsx` (kept, restyled onto design-system §5.5 modal anatomy and the `LayerStack`) | `confirm({ title, body, confirmLabel, destructive })`, `prompt({ title, label, value })` | 68 files across every unit; mounted once at the dashboard root |
| `TourProvider` | `src/components/tour-provider.tsx` (kept, disarmed; never auto-launches) | `steps` from the onboarding unit; renders nothing while `steps.length === 0` | Help menu's "Take the tour" only |
| `BackButton` | `src/components/ui/back-button.tsx` (kept; `navStack`-aware) | `fallbackHref`, `label` | every full page and locked view |
| `Drawer` container | `src/components/ui/drawer.tsx` | `width`, `url`, dims the list to 92% | Work, Tables, Teams drawers |

Deleted: `apps-more-popover.tsx`, `top-pins-strip.tsx`, `calendar-peek.tsx`, `ask-ai-button.tsx` (bar use), `item-drawer.tsx`, `topbar-popover-button.tsx`, `kudos/candor/surveys-popover.tsx`, `reminder-ticker.tsx` (toast + tab), `active-timer-pill.tsx` (folded into TopBar), `my-work-panel.tsx` (merged into `/my-work`, §0), `quick-capture.tsx` (chord and component, §0), `security/screen-protection.tsx` (renders null), `go-back-button.tsx`, `use-goto-nav.ts`, `access-tiers.ts` (access step 8), `src/lib/density.ts`, `bento/locale-switcher.tsx`, `ui/toast.tsx` provider in the app, `loader-preview/`.

Re-parented rather than deleted: `create-sprint-modal.tsx` moves to the Work unit's List menu and stops being mounted by the frame (§0).

---

## 4. Migration / build notes

Order (each step ships alone; nothing here changes a save or load path):

1. **Nav truth** (no visual change): `src/lib/nav/route-hub.ts` with `ROUTE_HUB`, `ROUTE_TITLES`, `SETTINGS_ROUTES` and the completeness tests (every `(dashboard)` directory has a row in both tables; `SETTINGS_ROUTES` has exactly three entries; `FOLDED_INTO_HUB` has exactly the 19 keys in §1.2 rule 3); `resolveHub`, `resolveCrumbFallback` and `resolveActiveRow` wired into the existing rail, sidebar and breadcrumb; `activeAppKey`, `previewAppKey`, hover preview, `findAppForPath`, `matchPaths` deleted. Ships with the existing look. **Every other unit is blocked on this step for its breadcrumbs**, so it goes first and alone. Closes critic #1's highlight half.
2. **Folded apps reachable**: the palette JUMP TO group lists `visibleApps` (hubs and folded); `AppsMorePopover` deleted; hub units add their folded rows using `SidebarRow` (blocked on each hub unit for contents; the container ships here with today's `HomeSidebar` etc. adapted). Closes critic #1's launcher half.
3. **`apiFetch` + session expiry + offline** (`src/lib/api-client.ts`, `SessionExpiredDialog`, `OfflineStrip`, `useDraftOnExpiry`), the `LayerStack` and the one Esc, the shortcut registry with the §1.8 map and the overlay, `/api/boot`. Independent of the visual PRs. Closes critic #11 and the keyboard gap.
4. **Shell look** (design system §8.5 step 3, after tokens step 1 and type step 2): rail 64 navy flush with the logo pulse; sidebar 264 with the N200 pill, conditional search, chevron collapse, footer; bar 48 with breadcrumb, Search, "+", bell, help, avatar; `OsTitleBar` → the three-row header primitives; logical properties; `data-chrome` attribute. Blocked on the parity answer (design system open decision 3) only for the page-header stack, not for the frame.
5. **Overlays on tokens**: bell (merged), Create menu, avatar menu (presence and mute to server, needs the settings migration for `presenceStatus`/`presenceUntil`), workspace menu, help menu, Customize panel at 560 with Theme/Chrome/Density and no footer, Set status modal, **Reminder dialog (§2.19), Notepad panel (§2.20), Voice note popover (§2.21)**, and `DialogProvider`'s confirm and prompt onto the 400 modal anatomy. The three personal-capture overlays are where the hard-coded `#0073EA` / `#FB5A6F` / `#FBE9AE`, the four hand-rolled Esc listeners and the last shell `Loader2` spinners actually live, so this step is what lets the lint rules in step 6 be turned on as errors. `MyWorkPanel` and `QuickCaptureHandler` are deleted in this step, after the Create menu and the palette's CREATE and JUMP TO sections exist to carry their jobs. Blocked on settings S2/S4 for the preference keys and the two `User` columns.
6. **Loaders and errors**: `loading.tsx` skeletons + `ValueLine`, `ErrorState`, `OsEmptyView` action typing, `ComingSoonRow`, splash policy and the org setting (settings S3 for the row), deletion of `Loader2`/"Loading…" in the shell, lint rules.
7. **Consent scope, dark default, i18n**: banner moved to marketing and auth layouts; `ThemeProvider` default light and `night` deleted; `NEXT_LOCALE` written from preferences; shell strings into `messages/*.json` `shell` namespace; RTL lint. Independent.
8. **Tablet breakpoints** (§1.16) plus the settings takeover's own 900px breakpoint (§2.8). Independent, after step 4.
9. **Accessibility pass**: `SkipLinks`, the landmark map and labels, focus-to-`<main>` and the `aria-live` page-title announcement on navigation (§2.1); the `inert` + `aria-hidden` mechanism on `#app-root` for the Session-expired dialog (§2.15). Independent of every visual PR and testable with a keyboard alone.

Data migrations this unit needs (all owned elsewhere, listed so nothing is forgotten): `User.presenceStatus`, `User.presenceUntil` (settings S4); `UserPreference.sidebar.{width, collapsed, collapsedSections, hiddenSections}` and `theme.chrome` as JSON keys (settings S2; two new keys flagged); `home.notifications.reminderEmail` (new key, §2.19, flagged to the settings spec); `companyProfile.splash` (settings S3); `/api/me/pins` rows into favorites (Work unit). Preference normalisations from design system §8.5 step 1, **all three of them, in that one PR**: stored `data-accent` → `blue`, `iconsOnly` → `false`, and **density `compact` → 32, `cozy` → 36, with the default becoming `comfortable` 44** on `OrgPreference.densityDefault` and on every `UserPreference.density` that was never set by the person. The density line is the one that changes what a new org sees (§1.9), so it is called out in the PR description alongside the demo account's purple theme.

Blocked on other units: hub sidebar contents (each hub unit), the task drawer and quick-task modal (Work), the settings takeover contents (settings), the access engine's `visibleApps` and `POST /api/access/check` (access step 0 to 3; until then `visibleApps` wraps today's `visibleRailApps` per access step 1's wrapper rule).

Never in this unit: a second dev server or `next build` beside the founder's `pnpm dev`; any change to autosave retry or keepalive behaviour.

---

## 5. Checklist against the audit

`shell.md` §4:

| # | Disposition |
|---|---|
| 1 `⌘B` collapses the sidebar while typing | resolved by §1.8 (`⌘\`, editable-target guard, one listener) |
| 2 `OsTitleBar` trio inert | resolved by §1.15 (`OsPageHeader` with real props only); per-page deletions by owning units |
| 3 Inbox prefs never persist | deferred to the settings spec §7.3 (`home.notifications.inboxView`) and the Work unit's Inbox page |
| 4 AI sidebar History/Prompts 404 | deferred to the AI unit; the container rule (§1.2) forbids rows without routes: a test asserts every `SidebarRowSpec.href` matches `ROUTE_HUB` |
| 5 Legacy item drawer | resolved by §0 (deleted; `BoardItemDetail` is the drawer) |
| 6 Presence local-only, "For Cashkr Team" | resolved by §2.12 |
| 7 Mute local-only, misleading chevron | resolved by §2.11, §2.12 |
| 8 `⌘1..9` browser-reserved | resolved by §1.8 (`G n`) |
| 9 Themes / Keyboard shortcuts rows dead | resolved by §2.12, §2.17 |
| 10 Two accent pickers | resolved by §2.16 (no accents; one Theme control) with settings spec §4.2 |
| 11 Folded apps unreachable | resolved by §1.2 rule 3, §2.9 JUMP TO, §4 step 2 |
| 12 CustomizePanel Home tab, Create section stub | resolved by §2.16 |
| 13 Home More menu stubs | deferred to the Work unit; the rule is §1.15 |
| 14 `/favorites` naming collision | resolved for the shell by §1.3 (Favorites = one list); route rename by the AI unit |
| 15 Orphaned routes incl. `/loader-preview` | `/loader-preview` resolved by §2.7; the others mapped in `ROUTE_HUB` (§1.1) with dispositions by their units |
| 16 Palette "Open My Activity" → `/dashboard` | resolved by §2.9 |
| 17 `/item/[id]` archive → a dead `/home` href | resolved by §1.5 (the List, else `/everything`; the work and home unit applies) |
| 18 Workspace menu coming-soon toasts, Invite target | resolved by §2.14 |
| 19 Upgrade targets differ, Notifications → `/inbox` | resolved by §2.14, §2.12 |
| 20 Brain panel dead controls | deferred to the AI unit; the Ask AI panel container (360, ⌘J) is §2.1 |
| 21 Palette decorative controls | resolved by §2.9 |
| 22 Create menu AI input, "⌥T", Super Agent | resolved by §2.10 |
| 23 Create-task modal taupe, Minimize | deferred to the Work unit (design system deletes taupe) |
| 24 Loader inconsistency | resolved by §1.6 |
| 25 Two toasts, hand-rolled overlays | resolved by §0, §2.1 LayerStack |
| 26 Dark mode `!important`, `html.night` | resolved by §1.9 with design system §1.5 |
| 27 Hard-coded `#0073EA` in 20 shell files | resolved by the token sweep (design system §8.5 step 5) and the raw-hex lint; the shell rewrite in §4 step 4 reads chrome tokens only |
| 28 Dead old-shell CSS, stale comments, unused `lens` | resolved by §0 and §4 step 1 |
| 29 Label drift | resolved for shell labels by §1.3, including the two collisions the canon now settles outright: My Wrk / My Work / My tasks all become **My work** at `/my-work` (and the duplicate My Work panel is merged there, §0), Today and Dashboard become **Home** at `/home`, and Me / My Profile / My KRAs & KPIs become **My profile** at `/people/me`, with the Guest destination named |
| 30 Trash gating inconsistency | resolved by §0 (Trash row in Work) with settings spec §7.1a |
| 31 Stale product tour | resolved for the shell by §0 (`TourProvider` kept but disarmed: no auto-launch, renders nothing while `TOUR_STEPS.length === 0`) and §2.13 (the one door is "Take the tour" in the Help menu); rewriting the steps is deferred to the onboarding unit |
| 32 Boot density mismatch | resolved by §1.9, §1.12 |
| 33 `?mine=1` unread, Popular Wikis placeholder | deferred to the Tables/Docs units; the container forbids static placeholder cards (§1.2 rule 6) |
| 34 `os.css` 34k lines | deferred to the design-system migration (§8.5) |
| 35 Badge caps and stale comment | resolved by §2.11 (dots, no counts on badges) |
| 36 Five pollers | resolved by §1.11 |
| 37 TopPinsStrip | resolved by §0 |
| 38 Hover-only Search/Collapse | resolved by §1.16 (the sidebar's collapse chevron and resize handle are always rendered at 40%, 100% on hover or focus); the row "…" stays hover-reveal by §1.2 rule 5, which is now the single statement of that rule (design system §4.2 wins on look) and carries the focus and coarse-pointer guarantees |
| 39 Default filled star, fake avatars | resolved by §1.15 |
| 40 `loader-preview` copy | resolved by §2.7 (deleted) |
| 41 `useOsToast` no-ops outside its provider | resolved by mounting the one provider at the dashboard root (§2.1) |
| 42 Upgrade on Enterprise | resolved by §2.14 |
| 43 `/spaces` empty copy points at Home "+" | deferred to the Work unit |
| 44 Stacked Esc handlers | resolved by §1.5, §2.1 LayerStack |

`misc-apps.md` §3: #4 dead trio and #13 fake avatars resolved by §1.15 (framework); #14 hidden CTAs resolved by §1.7 (typed `action`); #21 loader mix resolved by §1.6; §0 stale-hub sidebar on unmatched routes resolved by §1.1; §4 back conventions resolved by §1.5 (units apply `BackButton`).

`critic-gaps.json`: #1 resolved by §1.1, §1.2, §2.9; #2 (framework half) by §1.15, §1.7; #5 by §1.5; #6 (shell half) by §2.1 on tokens, one toast, one overlay system, one loader vocabulary; #10 by §1.16 (tablet, plus the takeover's 900px breakpoint; a mobile shell is a later unit); #11 by §1.7, §1.10, §2.15; #13 by §1.14; #15 by §1.15 and the deleted comments; missedSurfaces (session expiry, consent scope, i18n/RTL, keyboard system, RealtimeClient, Settings sidebar leak, root not-found) by §1.10, §1.13, §1.14, §1.8, §1.11, §0 and §2.5; missedRoutes (`/admin/analytics`, `/admin/appsumo`, `global-error.tsx`, the generated icon and OG routes, the `/whiteboards` redirect pair) assigned by §0's "Frames this unit does not own" table and §2.6; contradictions (launcher, URL highlighting, g-chords, rail width, Settings sidebar, dark mode) settled by §0, §1.1, §1.8, §2.1, §0 and §1.9.

Cross-document conflicts this unit resolves rather than inherits (each names the deciding doc and the superseded line, so no engineer has to arbitrate):

| Conflict | Where | Resolution |
|---|---|---|
| Off premium module: dimmed rail icon (settings G20) vs absent list row (access §5.3) | §1.4 | Access wins on what `visibleApps` returns (absent for everyone). G20's need is met by a separate `manageableOffModules` list rendered as `aria-disabled` off-module tiles below the hubs, Owners and Admins only, clicking through to `<ModuleOff>` where the switch lives. Settings §5.3's "`visibleRailApps` gains `viewerCanManageModules`" is implemented as that list. |
| Settings takeover: 248 / 16px icons / 32 / 12-590 / 44 rows (settings §8.1, §10.2) vs 264 / 20px icons / 36 / 11-600 / 48 rows (design system §4.6, §5.4) | §2.8 | Design system wins on every one, because all five are look: door sidebar 264 with 20px icons, sidebar rows 36, group labels 11/600 uppercase, settings content rows 48 minimum. The settings numbers are superseded; everything else in settings §8.1 stands. |
| Settings takeover bar: a Close ✕ at the right (settings §8.1) vs nothing at the right (design system §4.6) | §2.8 | Design system wins. The takeover bar carries "← Back to app" and nothing else; that control plus Esc is the whole exit, which is also what settings audit issue 24 asks for. A modal inside settings keeps its own ✕: a modal is a different object with a different close target. |
| Settings takeover: "rail, hub sidebar and top bar unmount" (settings §8.1) vs "the rail and top bar stay" (design system §4.6) | §2.8 | Design system wins: rail and navy bar stay, only the sidebar and content are replaced; and because they stay, the takeover's in-file breadcrumb moves up to the navy bar and the takeover keeps one back affordance ("Back to app") distinct from the bar's history ‹ ›. |
| Density default: Comfortable 44 (design system §3.2, decision 2) vs Cozy (settings §5.2 Appearance defaults) | §1.9, §4 | Design system wins (density is a look value). New orgs ship Comfortable; the settings row's default changes with it in the same PR, and the normalisation is in the §8.5 step 1 migration list. |
| Accent: no accents anywhere (design system §1.4, decision 6) vs the Accent row still on `/account/preferences` (settings §4.2, pending Phase 2 Q4) | §0 | The token PR deletes the ten `data-accent` blocks, which would leave that row decorative and break "every visible setting persists"; the row is therefore deleted in the same PR, not hidden, and the dependency is named so it is not missed. |
| Row "…" hover-reveal (design system §4.2, §1.2 rule 5) vs "no hover-only affordance in the shell" (§1.16) | §1.2 rule 5, §1.16 | Design system wins on look: the row "…" is hover-reveal, with focus-visible and coarse-pointer guarantees. §1.16 now covers only the sidebar collapse chevron and resize handle, which is what `shell.md` Low 38 was actually about. |
| Keyboard: `⌘1..8` and `⌘T` (design system §4.3, §4.7) vs `G 1..8` and `⌘⇧K` (§1.8) | §1.8, §2.1 | Settled in this spec's favour and closed. `⌘T` opens a new tab and `⌘`+digit switches tabs in Chrome, Safari, Firefox and Edge on both platforms, so advertising them would break the advertised-equals-working rule the keyboard section exists to enforce. The shell owns `src/lib/shortcuts.ts`, the single source for the listener, every tooltip hint, the `?` overlay and `/account/shortcuts`; design system §4.3 and §4.7 and the four peer specs (task detail, work and home, spaces and lists, goals) print `⌘⇧K`. The button label stays "Create task". |
| `/templates`: the Work hub with the page owned by spaces and lists (§1.1) vs the Docs hub via change request S1 (docs and knowledge) | §1.1, §5 | **S1 is declined.** The shell owns `ROUTE_HUB` and has not accepted the move; three specs place the row in Work against one that moves it; and four of the six template kinds (Task, List, Space, Starter kit) are Work objects. `/templates` stays in Work and the page is owned by the spaces and lists unit. The docs and knowledge unit drops its CONTENT row 9 and reaches doc templates from the Docs header "+" and the "Browse templates" row, both pointing at `/templates?kind=doc`; Settings › Task system › Templates keeps its link card at `/templates?kind=task`. |
| Work landing: `/today` canonised as "My work" with no row labelled Home (§1.3) vs `/home` and `/my-work` as two destinations (work and home) | §1.1, §1.3 | Work and home wins: two URLs carrying two labels do not break the one-label-per-destination rule, and this spec's rule was written against a `/today` that was itself a redirect into the first Space. §1.3 gains Home and My work as two rows, the "no row labelled Home" paragraph is deleted, the `ROUTE_HUB` home row gains `/home` and `/my-work` and loses `/today`, `/dashboard` and `/tasks`, `defaultHref` becomes `/home`, and `G H` opens `/home`. |
| Teams `defaultHref`: `/team` (§1.1) vs `/people` (teams and people) | §1.1 | `/people`, one URL for everyone. `/team` is gated on having reports, so the rail pill would land a plain Member on a denial as their first screen; the Directory is the one Teams page access §5.2.1 gives every Member, so the pill can never land anyone on a locked page and the rail stays a static table. My team is row 2 of the hub sidebar and every notification that belongs on `/team` links straight there. One word changes in this spec's table. |
| Talk `defaultHref`: a single `/tlk` (§1.1) vs `/tlk` or `/announcements` by module state (talk) | §1.1, §1.4 | The conditional stands, and it is the only conditional `defaultHref` in the table, because Announcements is not module-gated and the hub must stay reachable. Two consequences: `visibleRailApps` keeps the chat hub when the module is on **or** the viewer may see the folded announcements app, and with the module off the Talk sidebar renders the Announcements row alone. `ROUTE_HUB` itself stays a pure static table and never branches on module state. |
| Person status vocabulary: `ACTIVE or PROBATION` (access rule 1) vs Active / Deactivated (access §2.1, settings §9.2a) | §1.4 | The shell speaks only Active and Deactivated, `/api/boot` returns `viewer.active`, and the four legacy `UserStatus` values map explicitly; access rule 1's wording is flagged back because as written it locks out a person on leave. |
| One redirect (access §5.5) vs the boot redirect to `/onboard` (§1.12) | §1.4, §1.12 | The invariant is about denial. No `can()` decision ever redirects; boot has two redirects, sign-in and finish-setup, and both are declared. |
