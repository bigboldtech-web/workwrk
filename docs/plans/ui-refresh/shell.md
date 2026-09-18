# WorkwrK UI audit: OS shell chrome

Audited 2026-09-10 (read-only). Scope: the app shell that wraps every `(dashboard)` page: left icon rail, secondary sidebar + every hub Sidebar, top bar (workspace switcher, planner peek, search/command palette, Ask AI, quick tools, notifications bell, reminders bell, inbox link, avatar/presence/profile menu), the "+" create menus, item drawer, create-task modal, customize panel, More launcher, loaders (DotsLoader / ValueLoader / MissionSplash), BackButton + back convention, toasts/dialogs, design tokens in `os.css`, and `(dashboard)/layout.tsx`.

All paths are relative to `/Users/bigboldtechnologies/theywrk`. Line numbers are from the files as read on 2026-09-10.

---

## 0. Shell anatomy (what renders where)

```
(dashboard)/layout.tsx           boot gate: session -> /api/setup -> OsShell; MissionSplash always mounted
  OsShell (os-shell.tsx)
    OsShellProvider (shell-context.tsx)    all shell state; localStorage + /api/preferences
    OsToastProvider (os/toast.tsx)          bottom-centre dark pill toasts
    ThemeApplier                            data-theme / .dark / data-accent / data-density on <html>
    ReminderTicker                          fires + surfaces due reminders (bottom-right cards)
    CallDock, IncomingCallWatcher, RealtimeClient (SSE)
    settingsMode? (/settings|/account)  -> bare white takeover; SettingsShell supplied by the route layouts
    else:
      ClickTopbar                           h-8 topbar, 3 floating cards
      TopPinsStrip                          "Favorite -> Top" chip row (renders only when pins exist)
      ClickAppRail (60px)                   access-derived rail, "More" launcher, Invite, Upgrade
      ClickSidebar (200-320px)              active/previewed hub Sidebar + header "+" + Customize footer
      AppsMorePopover                       launcher grid
      <main>                                page
      OsSidekickPanel                       right-dock "Brain"
      OsCommandPalette, OsItemDrawer, CustomizePanel, SetStatusModal, QuickCaptureHandler,
      CreateTaskModal, CreateListModal, CreateSprintModal, MyWorkPanel, NotepadPanel,
      ReminderPopover, VoiceCapturePopover, TemplateCenter
```

Outer wrappers in `(dashboard)/layout.tsx:76-105`: `ToastProvider` (ui/toast, top-right cards), `DialogProvider` (confirm/prompt), `TourProvider` (auto-launch product tour on first login), `ScreenProtection` (renders `null`, `src/components/security/screen-protection.tsx`).

### 0.1 Boot sequence (`src/app/(dashboard)/layout.tsx`)
- `useSession()`: `unauthenticated` -> render `null` and `router.push("/login")` (l.30-34, 73).
- `authenticated` -> `fetch("/api/setup")`; `!setupCompleted` -> `/onboard`; fetch failure is treated as "setup complete" (l.36-49).
- Until `ready`, a fixed full-screen dark radial gradient (`BOOT_BG`, l.18) is painted; `DotsLoader` appears only after 650 ms (l.64-71, 96).
- `MissionSplash` is mounted outside the ready fork so it never restarts (l.102).
- Density is applied from **localStorage** (`getInitialDensity()`, default `"compact"`, `src/lib/density.ts:6-10`) before `ThemeApplier` later overwrites `data-density` from server prefs (default `"cozy"`, `src/lib/preferences.ts:154`). Two sources of truth; a brief compact->cozy flip on every boot when the user never chose.

### 0.2 Shell state (`shell-context.tsx`)
localStorage keys (l.218-227): lens, active-app, sidebar-collapsed, recent-apps, icons-only, profile-tool-pins:v2, presence, muted-notifs. Only `iconsOnly` is reconciled with the server (l.324-327); everything else is per-browser only.

Global keyboard handler (l.527-572), listens on `window`, **no editable-target guard**:
- `⌘⇧K` quick task, `⌘K` palette, `⌘J` Brain, `⌘B` toggle sidebar, `⌘1..9` jump to Nth rail app, `Esc` closes palette + item drawer.
- `⌘B` will fire while the caret is inside a doc/notepad editor (bold) and collapse the sidebar; no `isContentEditable`/`tagName` check (contrast `quick-capture.tsx:29-33`, which does guard `⌘⇧N`).
- `⌘1..9` are reserved by Chrome/Safari for tab switching on macOS and are not delivered to the page; the rail tooltips advertise them (`click-app-rail.tsx:118,129`). Same class of bug as the retired `⌘T` (comment at l.531-534).
- `lens` ("me"/"we") state + setter exist (l.199-200, 367-370) but nothing in the app reads them.

Rail resolution (l.489-503, `src/lib/rail-apps.ts`): catalog minus org `hidden`, filtered by catalog `requiredAccess`, then org `minAccess` floor, minus `offRail` (folded) apps, minus premium modules not ACTIVE, ordered by org `order`. `alwaysPinned` = `home`, `settings`.

---

## 1. Routes and surfaces

Legend for **UI state**: polished / rough / broken / stub. "Reachable from" lists every shell entry point found.

### 1.1 Shell-level system routes

#### `(dashboard)/layout.tsx` boot gate + `loading.tsx` + `error.tsx` + `not-found.tsx`
- Purpose: auth/setup gate; route-transition loader; error boundary; in-shell 404.
- `loading.tsx` (l.10-16): centred `ValueLoader size=40` inside the canvas slot (rail + sidebar stay mounted). polished.
- `error.tsx` (l.24-71): "This page couldn't load" + digest + dev-only message; buttons: Try again (`reset()`), All spaces (`/spaces`), Home (`/today`). polished. Note `Home` resolves to `/today` which itself redirects to the first Space.
- `not-found.tsx` (l.10-44): "We haven't built this yet"; Back home (`/today`), Browse spaces, `GoBackButton` (history-aware, fallback `/today`). polished.
- Issues: boot gate hits `/api/setup` on every mount of the dashboard layout; MissionSplash covers everything for ~2 s (see 3.3).

#### `/today` (`src/app/(dashboard)/today/page.tsx`)
- Purpose: Home hub landing; server redirect to the viewer's first Space (earliest `createdAt`) else `/spaces` (l.15-41).
- Reachable from: rail "Work" (`defaultHref: "/today"`, `apps-catalog.tsx:1172`), error/not-found "Home", SettingsShell Back/Close/Esc, workspace switch, palette "Today" (G T), reminder ticker "Open" for personal reminders.
- Back: n/a (redirect). Top bar: full shell. Sidebar: Home (see 2.1).
- UI state: polished (redirect). Issue: labelled "Today"/"Home"/"Work" in different places (rail says **Work**, palette says **Today**, error page says **Home**); "first Space" is not configurable.

#### `/dashboard` (`dashboard/page.tsx`)
- Redirect to `/today` (l.3-5). Reachable from: command palette "Open My Activity" (`command-palette.tsx:146`, alias `act`) and 5 other in-app links. stub/legacy. Issue: palette label says "My Activity" but lands on Today/first Space.

#### `/everything` (`everything/page.tsx`)
- Purpose: org-wide All Tasks list (newest 500), read-only rows open `/item/[id]`. Reachable: Home sidebar "Everything" (`apps-catalog.tsx:888`), item-page back fallback. No back button (top-level). polished. Header count "500+" cap.

#### `/item/[id]` (`item/[id]/page.tsx`)
- Purpose: full-page task detail (BoardItemDetail, `layout="page"`).
- Reachable: Reminders bell rows (`reminders-bell.tsx:179`), ReminderTicker "Open" (`reminder-ticker.tsx:122`), Everything rows, item drawer "Open as page" (drawer links to `/${moduleId}/${itemId}` which is `/tasks/<id>`, not `/item/<id>`; `item-drawer.tsx:346`).
- Back button: yes, hand-rolled (`window.history.length > 1 ? router.back() : router.push(board ? /boards/slug : /everything)`, l.84-95); error state has a second "Go back" (l.119). Does **not** use `ui/back-button.tsx`.
- Controls: board crumb link, Archive (confirm dialog) -> `router.push(board ? /boards/slug : "/home")` (l.75). **`/home` does not exist** (no `src/app/(dashboard)/home`) -> in-shell 404 when board is null.
- Loading: `Loader2` + "Loading…" (l.108), not the brand loader. Error: SearchX empty state. UI: polished body, rough chrome.

#### `/favorites` (`favorites/page.tsx`)
- Purpose: **pinned Sidekick chats** (cards) + recent chats; despite the name it is not the 7-kind favorites the sidebar shows.
- Reachable: **URL only** (only appears in Home `matchPaths`, `apps-catalog.tsx:1173`; zero inbound links).
- Chrome: `OsTitleBar` with hardcoded `people={[PEOPLE.bb]}` (fake presence avatar, l.100) and the dead Ask AI/Share/Invite trio (see 3.6). Loading: ValueLoader. Empty: OsEmptyView "Cross-module starring is shipping soon". UI: rough/orphan. Naming collision with sidebar Favorites + TopPinsStrip.

#### `/activity` (`activity/page.tsx`)
- Org activity feed, scope pills My/Team/Org. Reachable only from `dashboard-content.tsx` and `block-editor.tsx` links; in Home `matchPaths` but no sidebar item. OsTitleBar (dead trio). rough/orphan.

#### `/files` (`files/page.tsx`)
- Generic drive (folder tree + grid + upload). Reachable only from `dashboard-content.tsx`; in Home `matchPaths`; the Docs hub links `/library?tab=files` instead. Two file surfaces. rough/orphan.

#### `/me/mentions` (`me/mentions/page.tsx`)
- Mentions inbox for notes/SOPs. **Zero inbound links** (URL only). OsTitleBar; error state CTA "Retry" has no handler (l.69: `cta="Retry"` without `onCta` -> OsEmptyView hides it, so the error state has no retry). rough/orphan.

#### `/me/weekly-review` (`me/weekly-review/page.tsx`)
- Weekly review form; breadcrumb "Today > Weekly review" (l.61-64) is the only shell-adjacent breadcrumb pattern in the app. Reachable from 2 in-app links. polished.

#### `/spaces` (`spaces/page.tsx`)
- Spaces gallery; reachable from Home "More" menu "All Spaces" (`apps-catalog.tsx:283`), error/not-found. No create control on the page ("Create one from the sidebar's + button", l.40). rough (comment says "Phase 2 stub").

#### `/inbox` (`inbox/page.tsx`)
- Purpose: notification inbox (Primary/Other/Later/Cleared).
- Reachable: topbar Inbox glyph (`click-topbar.tsx:168-175`), Home sidebar "Inbox" (`apps-catalog.tsx:885`), profile menu "Notifications" (`profile-menu.tsx:203`), notifications popover "Open Inbox", palette "Inbox" (G I / `inb`).
- Controls: tabs, Filter pill, Settings (opens `InboxSettingsPanel`), Clear all, per-row mark read/snooze.
- **Broken**: `InboxSettingsPanel` toggles (Show All tab / Group by date / Sort newest / fullscreen mode) call `savePref` which `PATCH /api/preferences { inbox: next }` (l.113-121). The route's zod `patchSchema` has no top-level `inbox` key (`src/app/api/preferences/route.ts:37-92`) so it is stripped; `loadPrefs` reads `effective.inbox` (l.100-106) which `getEffectivePreferences` never returns. Toggles reset on reload.
- UI: polished body; settings panel cosmetic.

#### `/assigned-comments` (`assigned-comments/page.tsx`)
- Reachable: Home sidebar (`apps-catalog.tsx:886`). Both tabs always render the empty state ("Comment-assignment schema does not exist yet", l.8-9). Filter/Resolved/date/search controls filter nothing. Own 40px header bar (not OsTitleBar). **stub**.

#### `/tasks` My Wrk + `/tasks/assigned-to-me`, `/tasks/today-overdue`, `/tasks/personal-list`
- Reachable: Home sidebar tree "My Wrk" (expand chevron only visible on hover, `apps-catalog.tsx:304-373`), palette "My tasks" (G K / `mw`), Home More "All Tasks" (`/tasks`).
- Shell notes: label "My Wrk" (sidebar) vs "My Work" (quick-tool panel, palette command) vs "My tasks" (palette nav) for three different surfaces. Calendar-connect row inside My Wrk has a disabled "Connect · Coming soon" button (`tasks/page.tsx:934-941`).

#### `/okrs` Goals
- Reachable: Home sidebar "Goals" (`apps-catalog.tsx:889`), folded Goals app sidebar links `?mine=1|team=1|level=company` (honoured by `okrs/page.tsx:24-26`), palette. Note Home `matchPaths` includes `/goals` which has no route.

#### `/people/me` "Me"
- Home sidebar first row labelled **"Me"** (`PROFILE_NAV_LABEL`, `apps-catalog.tsx:440`, TODO(rename)); Teams sidebar calls the same route "My Profile"; Goals sidebar calls it "My KRAs & KPIs"; profile menu "My Profile". Four labels for one route.

#### `/planner`, `/timesheets`, `/calendar`
- Planner hub (`apps-catalog.tsx:1178`): sidebar = Planner, Timesheets (`CalendarSidebar`, l.942-951, no active states). `/calendar` is a redirect to `/planner` (`calendar/page.tsx`). Topbar calendar glyph opens `PlannerModal` (1100px popup of the same week grid) except on `/planner` where the click is a no-op (`calendar-peek.tsx:21`).

#### `/sidekick`, `/sidekick/history`, `/sidekick/prompts`, `/agents`, `/automation/*`
- AI hub (`apps-catalog.tsx:1182`). Sidebar rows (l.955-980): Ask Sidekick, **History (`/sidekick/history`) -> 404**, **Prompts (`/sidekick/prompts`) -> 404** (only `sidekick/page.tsx` exists), Agents, and for managers Workflows/Templates/Connections. Rows have no `active` prop so nothing highlights.
- `/agents`: static `AGENTS` mock array with fabricated metrics (`agents/page.tsx:390-428`), OsTitleBar with fake `PEOPLE`. **stub**. Reached also by Create menu "Super Agent · Hot" (`create-menu.tsx:338-349`).
- `/sidekick` page duplicates the Brain panel as a full page; `?session=` links from `/favorites` cards (`favorites/page.tsx:149`) are not read by a `get("session")` (page uses history.replaceState comment, l.75) -- unverified whether the session opens.

#### `/tlk`, `/announcements`, `/people` (Talk hub)
- Talk hub (`apps-catalog.tsx:1186`), premium module; `/tlk/layout.tsx` renders `ModuleDisabledScreen` when off. Sidebar (`chat-sidebar.tsx:245-500`): find box, Directory (`/people`), Announcements (hr-admin), New message + New call link (instant meeting, copies guest URL), Starred, Channels (collapsible, Join), Direct messages (close-on-hover X), message search results. polished.

#### `/docs`, `/library`, `/notetaker`, `/sops`, `/policies`, `/agreements` (Docs hub)
- Docs hub (`apps-catalog.tsx:1197`). Sidebar (`docs-sidebar.tsx`): All/My/Shared/Private/Meeting/Archived (`?view=`), Content (Notes/Canvases/Files -> `/library?tab=`, Clips -> `/notetaker`), Process (SOPs, Policies*, Contracts* hr-admin), Favorites (empty card), Pages tree (Notion-style, context menu, "New page"), **Popular Wikis: permanent static empty card** (l.199-200). Row heights h-8/h-7 mixed; 14px vs Home sidebar 13px.
- `/notetaker` matchPaths include `/clips` which has no route.

#### `/tables`, `/forms` (Tables hub)
- Tables hub (`apps-catalog.tsx:1202`), premium module gated by `tables/layout.tsx`. Sidebar (`tables-sidebar.tsx`): New sheet (promptless create), Sheets list with right-click Rename/Delete, All tables, Forms. polished. `/forms?mine=1` (folded FormsSidebar) is not read by the forms page (0 matches) -> "My Forms" = "All Forms".

#### `/team`, `/people`, `/organization`, `/kra-kpi`, `/team/*`, `/reviews`, `/candor`, `/kudos`, `/surveys` (Teams hub)
- Teams hub (`apps-catalog.tsx:1192`, `requiredAccess: "manager"`). Sidebar (`TeamsSidebar`, l.994-1049): below manager tier shows only "My Profile"; managers get Overview, My Profile, People (Directory, Org chart, Roles), Alignment (KRAs & KPIs, Alignment board), Performance (Reviews, KPI approvals, Rollup [director+], Workload, Review cycles [hr-admin]), Culture (Candor, Kudos, Surveys [hr-admin]). Custom "+" = `TeamsCreateMenu` (Invite person -> `/settings/members?invite=1` **param not read by members page**; New role `?new=1` ok; New KRA `?new=1` ok; New KPI -> `/kra-kpi` plain; New SOP; Start review cycle `?new=1` ok).
- `/organization` is server-gated `requireManagerPage()` -> employees redirected to `/people/me`.

#### `/settings`, `/settings/*`, `/account/*` (Settings takeover)
- Rail "Settings" (alwaysPinned) -> `/settings`. Rail "Upgrade" link -> `/settings` overview (`click-app-rail.tsx:193-200`), whereas workspace menu "Upgrade" -> `/settings/billing` (`workspace-menu.tsx:249-257`).
- In settings mode the rail/sidebar/topbar disappear; `SettingsShell` (`settings-shell.tsx`) supplies: header (Back -> `/today`, breadcrumb "Org > Settings", Close X -> `/today`, `Esc` -> `/today` l.136-142), left nav with two doors: Admin (SUPER_ADMIN/COMPANY_ADMIN only, l.27) and Personal (Profile `/account/profile`, Notifications `/settings/notifications`, Appearance `/account/appearance`, Security `/account/security`).
- When the Settings **hub sidebar** (rail, outside takeover) is previewed it shows: Workspace settings, Account · Security, Operations: Build apps, Marketplace, Tools*, Assets*, Trash* (hr-admin) (`SettingsSidebar`, `apps-catalog.tsx:1136-1157`). It is only ever visible via hover-preview because clicking Settings enters the takeover.
- Profile menu "Themes" -> `/settings?tab=themes`, "Keyboard shortcuts" -> `/settings?tab=shortcuts` (`profile-menu.tsx:204-205`); `settings/page.tsx` never reads `tab`; **there is no keyboard-shortcuts surface anywhere**.
- `/account/appearance` duplicates CustomizePanel > Themes with a **different accent list** (`account/appearance/page.tsx:22-33`: has `purple`, lacks `workwrk`/`grape`, fallback `mint`) while `ThemeApplier` rewrites `purple` -> `workwrk` (`theme-applier.tsx:79`). Picking "Purple" there silently paints brand blue.
- `/settings/apps`: the org rail editor (order / hide / minAccess), admin only.

#### `/trash`
- Reachable: profile menu "Trash" (everyone, `profile-menu.tsx:252`) and Settings hub sidebar (hr-admin only). Page shows "Manager access required." error state for non-managers (`trash/page.tsx:53`). Loading: Loader2 text. Uses OsTitleBar with `showStandardActions={false}` (one of the few that hides the dead trio).

#### `/build`, `/store`, `/tools`, `/assets`
- Settings hub "Operations". `/store` is a static catalog (INSTALLED set hardcoded, `store/page.tsx:178-184`) -- stub. `/build` KPI tile "Templates — coming soon" (l.118). `/tools` real.

#### `/templates`, `/imports`, `/integrations`
- `/templates`: workspace menu "Templates" (`workspace-menu.tsx:299`); plain custom `.tmpl` CSS, "Loading…" text. rough.
- `/imports`: Create menu "Import" (`create-menu.tsx:398`); two real CSV paths + "Coming soon" chips. OsTitleBar with `iconGradient=""` (dead prop) and dead trio. rough.
- `/integrations`: palette source tabs Gmail/Drive/SharePoint and "Connect apps" command route here; the page itself is "Coming soon" (`integrations/page.tsx:9,158`).

#### `/clock`, `/ideas`, `/autopilot`
- **Zero inbound links** (URL only). `/autopilot` is a static stub with sample rules (`autopilot/page.tsx:431-490`). `/clock` and `/ideas` are real but unreachable from chrome.

#### `/loader-preview` (`src/app/loader-preview/page.tsx`)
- Dev-only DotsLoader gallery. Lives **outside** `(dashboard)` and `(auth)` groups -> no session gate, no shell; publicly reachable. Copy describes an animation ("converge and orbit") the CSS does not do (`dots-loader.css` is a simple bounce).

### 1.2 Non-URL shell surfaces (modals, panels, popovers)

#### Command palette (`command-palette.tsx`)
- Opened by: topbar search card (`click-topbar.tsx:123-134`), `⌘K`. Portal to body, `z-50`, 700px.
- Header: input, `AskAiButton` (hands query to Brain), ESC chip. Source tabs: All / WorkwrK / Gmail / Google Drive / SharePoint / Apps (l.156-169). Gmail/Drive/SharePoint are `connectable` and route to `/integrations` (Coming soon); "Apps" tab sets `sourceKey` which is never used in filtering (dead). Type chips Tasks/Docs/People/Commands + "···" (Actions). Filter (Any / Active tasks / Documents) and Sort (Created date has no sorter, l.198-203).
- Body: empty query = recents (rail apps) + quick actions + NAVIGATE + COMMANDS; typing = live `/api/search` (>=2 chars, 180 ms) + discovery rows. Live tasks always show status "todo" (l.325). Footer: "←/→" decorative, "Press / for commands" works, **"Tab for actions" does nothing**, gear "Search settings" button has no handler (l.917-919).
- Quick actions all wired (task, doc, notepad, reminder, notetaker, announcement, timesheets). `NAVIGATE` shortcuts "G T" etc. are displayed but no G-chord handler exists anywhere. UI: polished visually; several decorative affordances.

#### Brain panel (`sidekick-panel.tsx`)
- Opened by: topbar AskAiButton (`⌘J`), palette Ask AI, `workwrk:os:ask-sidekick` event (empty views), item page "Ask AI". Right dock `.os-sk` with its own token rebinding for dark (os.css 1557-1569).
- Controls: New chat, History (search + grouped list), model pill "Max" (**dead**, l.341-345), More "…" (**dead**, l.350-352), Collapse. Composer: Attach "+" (**dead**, l.513-515), "All sources ▾" (**static span**, l.516-520), Send. Greeting Suggested/Featured/Search rows only paste text into the input; "Generate an image", "Search the web", "Deep search" are not capabilities of `/api/sidekick/chat/stream`. Loading: "Loading…" text; streaming typing dots. UI: polished visuals, several placeholder controls.

#### Item drawer (`item-drawer.tsx`) — legacy
- Opened via `openItemDrawer` only from legacy `kanban.tsx`, `main-table.tsx`, `calendar.tsx` (module-view demo surfaces). Right sheet 660px, `os-drawer` CSS.
- Dead controls: Pin/Star (l.326), Expand for non-detail modules (l.355), More "…" (l.357), Owner "Assign" (l.521), "Set date" (l.541), Labels "+" (l.553), composer Attach/Emoji/Mention (l.637-639), "Attach a file" (l.667), "Add sub-item" (l.685). Tabs Files/Sub-items are static ("Sub-items coming soon", l.683).
- Non-task modules render **fabricated sample updates** ("Sarah Cohen", "Maya Kapoor", l.287-296) and a disabled composer "Updates not wired for this module yet".
- Task status options Planned/In progress/Done (l.45-49) do not match per-Space workflow statuses used by the create-task modal. "Open as page" links `/tasks/<id>` not `/item/<id>`. UI: **broken/stub** (demo-era).

#### Create-task modal (`create-task-modal.tsx`)
- Opened by: `⌘⇧K`, topbar Quick task icon, profile menu, palette "Create task", Create menu "Task", Planner "+", voice capture "Create task", TemplateCenter TASK hand-off, board "+ Task" (preselect).
- Header: Select List (route-derived / last used / picker grouped by Space), Task type picker (+ "Manage task types" link), Minimize (**just closes**, l.939) and Close. Body: name (Enter creates), description with decorative "AI" wand hint (l.972-977), extras (Time estimate, Dependencies = static sentence l.1026-1030, Subtasks, Checklist), staged attachments. Toolbar: Status (Space palette), Assignee (people picker), Due (start/due + quick picks + calendar; today cell is red-500), Priority, Tags (create inline), Alignment (KPI-first/KRA), "…" extras. Footer: Templates (Use / Create instantly / Save / Update), Attach (Upload + Dropbox/OneDrive/Box/Google Drive/New Google Doc = paste-a-link prompts, l.564-597), Followers, error/notice text, split Create button (Create and open / start another / duplicate).
- Style: entire modal uses the **taupe** accent (`TAUPE`, `#a78b80`, `#c39b8c`, `#9d7d70`) for checks, focus rings and the primary button (l.201, 217, 897, 1143, 1363, 1436) -- deliberate per `ui/accent.ts` but visually disconnected from the blue shell. Create menu "Task" row shows shortcut "⌥T" (`create-menu.tsx:303`) while the real chord is `⌘⇧K` (`profile-tools.ts:31`). UI: polished, feature-rich; drift + a few decorative bits. No responsive layout (`max-w-[750px]`, popovers `w-[440px]`).

#### Create menu ("+" on Home sidebar, `create-menu.tsx`)
- Rows: AI input ("Describe anything to create" -> Enter opens create-task, l.288-294, v1), Task ⌥T, List, Sprint, Space (proxies Home `newAction` -> NewSpaceDialog), Create with AI (-> `/sidekick`), Super Agent "Hot" (-> `/agents` static mock), Build: Doc / Form / Canvas / Database (inline name + Space step, real POSTs), Customize your sidebar, Import (`/imports`), Templates (TemplateCenter). Uses `MorePortal` below anchor, `w-312`.
- Per-hub "+": Planner (New task), AI (New chat `/sidekick?new=1`), Talk (menu: New message / New channel), Teams (custom TeamsCreateMenu), Docs (New doc event), Tables (New sheet `?new=1`), Settings hub (no "+"). Folded apps' `createActions` (Library, Forms, Goals, Timesheets, SOPs, Contracts, Reviews) are unreachable because their sidebars never show (see 3.5).

#### Customize panel (`customize-panel.tsx`)
- Opened by: sidebar footer "Customize Sidebar" (`click-sidebar.tsx:297-306`), Home More menu "Customize", Create menu "Customize your sidebar", AppsMore "Customize navigation". Radix Dialog 440px, tabs Appearance / Home / Sections / Themes.
- Appearance: Icons only vs Icons & Labels (persists `sidebar.iconsOnly`, l.591-599). Home: checkboxes Inbox (always on), Assigned Comments, My Wrk, Drafts & Sent, All Spaces, All Tasks -> `home.cards` which **nothing renders** (only `settings/defaults` lock paths reference it) -> cosmetic. Sections: drag-reorder/hide Favorites & Spaces (works, HomeSidebar reads `sectionsOrder`), "Create section" **disabled "coming soon"** (l.691-699). Themes: Light/Dark/Auto + 11 accents (persist + `workwrk:prefs-changed`). Locked keys disable rows. Inline `--os-brand: #0073EA` override on the dialog (l.551) so the picker itself never re-tints.

#### More launcher (`apps-more-popover.tsx`)
- Opened by rail "More" tile. Search, Recent (<=5), grouped by category, "Customize navigation" footer. Uses `railApps` so folded apps (Library, Forms, Clips, Goals, Timesheets, SOPs, Policies, Contracts, Reviews, Candor, Kudos, Surveys, Announcements, Tools, Assets, Build, Store, Trash, Automation) are **absent**, contradicting the catalog comment that folded apps stay "reachable by the More launcher" (`apps-catalog.tsx:1344-1347`). File header comment still describes pin toggles that were removed. Copy "Everything you have access to" is false for folded apps.

#### Workspace menu (`workspace-menu.tsx`)
- Anchored to the top-left org chip. Header: logo/initials, name, member count, plan, Upgrade link (`/settings/billing`). Tabs Settings / People. Manage: Apps (**toast "coming soon"**), Templates (`/templates`), Automations (**toast "coming soon"**). Switch Workspaces (real, hard-navigates to `/today`), Create Workspace (prompt dialog), Delete workspace (COMPANY_ADMIN/SUPER_ADMIN, two-key confirm, portaled). People tab: Manage members, Invite people -> both `/settings/members` (does not open the InviteModal that the rail already has). Uses `ui/toast` (top-right) unlike the rest of the shell.

#### Profile menu (`profile-menu.tsx`)
- Header avatar (brand bg) with **always-green dot** (l.155) regardless of status; topbar dot is amber for any non-Online status (`click-topbar.tsx:52-54`). Rows: Set status, Mute notifications (checkbox row with a trailing chevron that implies a submenu, l.194), My Profile, Settings, Notifications (-> `/inbox`, not `/settings/notifications`), Themes (`?tab=themes` ignored), Keyboard shortcuts (`?tab=shortcuts`, no such page), Help (external), Personal Tools (10 rows with pin toggles -> topbar quick icons; pins are localStorage only), Trash (everyone; 403 for non-managers), Log out (NextAuth signOut).

#### Set status modal (`set-status-modal.tsx`)
- Free text + emoji toggle (only toggles between none and "😀", l.114), presets (In a meeting / Focusing / Sick / Vacation). Section label **"For Cashkr Team" hardcoded** (l.129). Saves to localStorage only (`shell-context.tsx:516-519`); no API; `expiresAt` is computed but never enforced (no timer resets to Online); nobody else can see the status. Uses hardcoded `#0073EA`.

#### Notifications bell + popover (`notifications-popover.tsx`)
- Badge from `/api/inbox/count` every 45 s (comment says 25 s, l.257 vs 368) + focus/visibility + SSE `workwrk:notif-changed`. Popover portaled (`os-notif` CSS, tokenised). Mark one/all read, desktop-alert enable, "Open Inbox". Toast on new item while focused via `ui/toast`. Mute (localStorage) only suppresses popup/chime/toast, never the badge (comment l.265). Loading state is text "Loading…" with a bell icon.

#### Reminders bell (`reminders-bell.tsx`) + ReminderTicker (`reminder-ticker.tsx`) + Reminder popover (`reminder-popover.tsx`)
- Bell: Fired / Overdue / Today / Upcoming / Recently done groups; Snooze 1h / Done on hover; "New" dispatches the reminder tool; badge caps at "9+" (notifications bell caps at "99+"). Polls 60 s.
- Ticker: persistent bottom-right cards (`z-[130]`), Open / Snooze (10m, 1h, tomorrow 9am) / Dismiss / Dismiss all; polls `/api/reminders/tick` every 60 s; mounted above the settings fork.
- Popover: title, quick chips (In 1 hour / This evening / Tomorrow 9am), datetime-local, "Also email me", uses hardcoded `#0073EA`/`#FB5A6F`.
- Three reminder surfaces + Inbox bell + Talk unread = four separate badge systems in a 32px topbar.

#### My Work panel (`my-work-panel.tsx`), Notepad panel (`notepad-panel.tsx`), Voice capture (`voice-capture-popover.tsx`)
- All opened by `workwrk:tool` window events from topbar quick icons / profile menu / palette. Right slide-overs `z-[91]` (380px / 440px) with `Loader2` spinners. Notepad header hardcoded `#FBE9AE` yellow (l.209). Voice: Web Speech API, Save as note (NOTEPAD doc), Create task (copies transcript to clipboard then opens the modal because the modal has no title prefill, l.127-136), Copy. All Esc-closable; My Work and Notepad also register their own window keydown listeners for Esc (stacking with the shell's Esc handler).

#### Invite modal (`invite-modal.tsx`)
- Opened by rail "Invite" (every user, no client gate) and Settings > Members. Emails chip input with company-domain lock, access level (all but SUPER_ADMIN), department/role/manager, message. Radix Dialog with brand-token buttons. polished.

#### Planner modal (`planner-modal.tsx`), TopPinsStrip (`top-pins-strip.tsx`), ActiveTimerPill (`active-timer-pill.tsx`)
- PlannerModal: 1100px × 82vh overlay of `PlannerWeek embedded`. TopPinsStrip: unlabeled chip row under the topbar, remove-on-hover only; feeds from `/api/me/pins`. ActiveTimerPill: polls `/api/timers/active` every 15 s for every user; red pill with stop.

#### Template Center, Create List / Create Sprint modals
- Mounted at shell level (`os-shell.tsx:121-127`); opened from Create menu and tree menus. Not audited in depth here (List/Board subsystem).

---

## 2. Rail + secondary sidebar detail

### 2.1 Rail (`click-app-rail.tsx`)
- 60px dark column (`--os-brand-rail`), rounded-xl card, scrollable `nav` (os-no-scrollbar), icon 28×28 with white active pill, 10px 2-line labels (hidden in icons-only), hover preview of the hub sidebar after 180 ms, click commits + navigates `defaultHref`. Footer: Invite (modal), Upgrade (`/settings`, shown even on ENTERPRISE).
- Rail hubs in catalog order: Work (`/today`), Planner, AI, Talk*, Teams (manager), Docs, Tables*, Settings; (* premium modules). Admin order/hide/floor from `/settings/apps`.
- Issues: `⌘1..9` tooltips (browser-reserved); `title` strips a trailing ".." from labels (legacy); no keyboard focus ring override needed (global focus-visible ring exists, os.css:168).

### 2.2 Secondary sidebar (`click-sidebar.tsx`)
- Header: hub title (15px), hover-revealed Search + Collapse (`«`) buttons (`w-0 opacity-0` until hover, l.233/242), "+" button with inline styles to beat the global button reset (l.265-271). Body: `app.Sidebar`. Footer: "Customize Sidebar" (keep per memory note). Resize handle (drag / double-click reset / arrow keys), width in localStorage.
- Search filters only the Home Spaces list, Docs Pages tree, Tables list, Talk conversations (via `useSidebarSearch`); other sidebars ignore it.
- Collapsed state returns `null`; reopen by clicking any rail icon or `⌘B`. No collapsed rail affordance to reopen.

### 2.3 Home sidebar (`HomeSidebar`, `apps-catalog.tsx:489-938`)
Rows: Me (`/people/me`), Inbox, Assigned Comments, My Wrk (tree: Assigned to me [orange icon], Today & Overdue [blue icon], Personal List), Everything, Goals, More (menu: Drafts & Sent **disabled coming soon** with decorative pin icon, All Spaces, All Tasks, Customize). Then sections in `sectionsOrder`: Favorites (7 kinds, count, unstar on hover, grouped sub-labels when >6) and Spaces (header "+", drag-reorder, `SpaceTreeRow`, "New Space"). Dialogs co-hosted: NewSpace, NewBoard, NewFolder, ShareSpace. Errors are swallowed (`catch(() => {})`) -> silent empty lists; no error state; no loading state for Spaces/Favorites.

### 2.4 Other hub sidebars
| Hub | Component | Rows | Notes |
|---|---|---|---|
| Planner | `CalendarSidebar` l.942 | Planner, Timesheets | no active state, both use Calendar icon |
| AI | `AiSidebar` l.955 | Ask Sidekick, History (404), Prompts (404), Agents, [manager] Workflows/Templates/Connections | first 4 rows never highlight |
| Talk | `ChatSidebar` | see 1.1 | polished |
| Teams | `TeamsSidebar` l.994 | tiered, see 1.1 | polished |
| Docs | `DocsSidebar` | see 1.1 | Popular Wikis static |
| Tables | `TablesSidebar` | see 1.1 | polished |
| Settings | `SettingsSidebar` l.1136 | Workspace settings, Account · Security, Build apps, Marketplace, Tools*, Assets*, Trash* | only visible on hover-preview |
| **Dead (folded, never rendered)** | `LibrarySidebar` l.1054, `FormsSidebar` l.1071, `ClipsSidebar` l.1086, `GoalsSidebar` l.1101, `TimesheetsSidebar` l.1122, `linksSidebar(...)` for reviews/candor/announcements/kudos/surveys/tools/assets/sops/policies/agreements/build/store/automation/trash | static "Favorites: Star an item to see it here", "Approvals: No pending approvals" placeholders | `offRail` apps are excluded from rail **and** launcher (`rail-apps.ts:159`), and `findAppForPath` skips them, so these sidebars and their `createActions` are unreachable |

---

## 3. Cross-cutting conventions

### 3.1 Back navigation
- Canonical component: `src/components/ui/back-button.tsx` — `history.length > 1 ? router.back() : router.push(fallbackHref)`; icon-only default; token colours. Used in only 4 route files: `forms/[id]/respond`, `people/[id]/profile-client`, `people/roles/[id]`, `components/docs/block-doc-editor.tsx`.
- Second implementation: `src/components/system/go-back-button.tsx` (same rule, "Go back" label, used by both not-found pages).
- Hand-rolled copies: `item/[id]/page.tsx:84-95, 119`.
- Bare `history.back()` (dead-ends in new tabs): `people/departments/departments-client.tsx:306`, `people/skills/skills-client.tsx:128`, `marketing/campaigns/page.tsx:205`, `marketing/events/page.tsx:249`.
- SettingsShell Back / Close / Esc all go to `/today` (not history) (`settings-shell.tsx:136-142, 157-179`); the profile menu opens Settings from any page and "Back" loses that page.
- Top bar has **no breadcrumb**; `.os-top__crumbs` CSS (os.css:640-652) belongs to the removed old shell. `/me/weekly-review` renders its own "Today > Weekly review" crumb.
- Modals/panels: Esc closes (each registers its own window listener; the shell handler also closes palette/drawer).

### 3.2 Loaders
- Route transition: `(dashboard)/loading.tsx` -> `ValueLoader` (dots + rotating company value).
- Boot: dark `BOOT_BG` + `DotsLoader` after 650 ms (`layout.tsx:96`), then `MissionSplash` (1.6 s hold + 380 ms fade, `mission-splash.tsx:19-20`), re-shown on navigation at most every 10 min (l.21), click/Esc to skip, `z-index: 100000`. Renders nothing if the org has no mission/values.
- In-panel/in-page: `Loader2` spinner in 151 files, plain "Loading…" text in 114 files, `ValueLoader` in 44, `DotsLoader` in 4, `Skeleton` in 5. Shell panels (My Work, Notepad, Reminder, Brain history, notifications popover, workspace menu, item page, trash, templates) all use `Loader2`/text, not the brand loader.

### 3.3 Empty / error states
- Pages: `OsEmptyView` (`empty-view.tsx`, `.os-empty` CSS, gradient art via `GRAD.*` legacy) with optional CTA (hidden when it has no handler; `me/mentions` error therefore loses its Retry).
- Sidebars: three separate empty primitives (`apps-catalog.tsx EmptyState` l.414, `docs-sidebar.tsx EmptyCard` l.236, `tables-sidebar.tsx EmptyCard` l.245) with different paddings/radii.
- Popovers: inline copy ("You're all caught up", "No reminders", "No chats yet").
- Errors: dashboard `error.tsx` is good; but the shell's own fetches swallow failures (`catch {}` in HomeSidebar spaces/favorites/prefs, shell-context prefs, TopPinsStrip, ActiveTimerPill, notifications) so a failed API shows an **empty** sidebar with no retry.
- Module-off state: `ModuleDisabledScreen` (Talk/Tables) is a clean tokenised card.

### 3.4 Style / tokens
- `os.css` (34,235 lines, 1.4 MB, imported by `(dashboard)/layout.tsx:14`) defines on `:root, .workwrk-os` (l.35-135): brand (`--os-brand #0073EA`, `-hover`, `-soft`, `-deep`, `-dark`, `-rail #1A2C4A`, `-ink`), status palette `--os-c-*` (purple/pink/indigo/lime are legacy aliases to brand/red/deep/sage), surfaces `--os-canvas/-surface/-surface-1..3/-surface-hov/-row-hov`, lines, ink 1-4, radii `--os-r-xs..xl/pill`, shadows `card/pop/rest`, layout `--os-rail-w 60px --os-side-w 260px --os-top-h 32px --os-title-h 40px --os-tabs-h --os-filter-h`, density `--os-page-pad --os-card-pad --os-row-h 28 --os-row-h-lg 32 --os-control-h 26 --os-control-h-sm 22 --os-popover-w`, `--os-font` (Figtree), base 14px. **No type-scale tokens** (only base size), no spacing scale, no z-index scale.
- Accent overrides `:root[data-accent=...]` (l.200-209) for 10 accents; `workwrk` = base tokens.
- Dark mode = `:root.dark .workwrk-os .<tailwind utility> { … !important }` catch-alls (~143 `:root.dark` rules, 155 `!important`; e.g. l.31756-31764) plus per-component `dark:bg-[#14171D]`, `dark:border-[#2A2F38]` literal hexes (command palette, panels, dialogs). Only `.os-sk` and `accent=black` rebind tokens properly (l.1557-1569, 31803-31811). `ThemeApplier` writes both `data-theme` and `.dark`; `globals.css` also has an `html.night` OLED theme that nothing in the shell toggles.
- Shell components are Tailwind `zinc-*` + literal hexes rather than `--os-*` consumers: `#0073EA` hardcoded in 20 shell files (reminder ticker ×4, set-status ×2, reminder popover ×2, teams-create-menu, sidebar-create-menu, reminders-bell, planner-*…), `#FB5A6F`, `#22C55E`/`#F59E0B` presence dots, `#FBE9AE` notepad. Accent picker therefore does not repaint these.
- Competing accents inside the shell: brand blue (tokens), **taupe** (`ui/accent.ts`: create-task modal, create menu inputs/buttons, teams create menu) and the sidekick/title-bar `BloomMark` gradient; `OsTitleBar`/`OsEmptyView` still take `iconGradient` (legacy `GRAD.*` gradients rendered on empty-view art).
- Radii: `rounded-md/lg/xl/2xl/[14px]/[13px]/full` mixed across topbar cards (rounded-lg + rounded-full search), rail `rounded-xl`, sidebar `rounded-[14px]`, main `rounded-xl`, drawer 16px, dialogs `rounded-xl`, create-task `rounded-2xl`.
- Type sizes in chrome: rail 10px, Home sidebar rows 13px, Docs/Tables/Talk sidebar rows 14px, topbar 13.5/14px, palette rows 14.5px, popover captions 11.5/12/12.5px; memory rule "14px base, 10px floor, text-xs=13px" is only loosely followed.
- Dead CSS from the removed old shell: `.os-shell`, `.os-rail`, `.os-top*`, `.os-side__scroll[data-icons-only]` (os.css:211-219 targets classes that no longer exist; icons-only now only hides `RailLabel`), `.os-canvas`. `os-shell.tsx:16-18` still says the old `topbar.tsx`/`sidebar.tsx` are "untouched" -- the files are gone.
- Global reset `.workwrk-os button { background:none; border:none; padding:0 }` (@layer base) forces inline-style workarounds (sidebar "+", SettingsShell links-as-buttons, `.os-portal-panel` mirror rule).
- Toasts: two systems. `OsToastProvider` (bottom-centre, dark pill, 3.2 s, Undo, `os-toast` CSS tokenised) vs `ui/ToastProvider` (top-right, colour-coded via `--signal-*` tokens, 4 s, actions). Shell chrome uses both (NotificationsBell + WorkspaceMenu -> ui; everything else -> os). Dialogs: Radix `ui/dialog.tsx` (white/`#14171D` literal) + `DialogProvider` confirm/prompt; but SetStatusModal, PlannerModal, ReminderPopover, MyWork/Notepad panels, DeleteWorkspaceModal, the item drawer and the create-task modal each hand-roll their own overlay/focus/Esc handling (no focus trap, inconsistent z-index: 50/80/90/95/100/120/130/100000).

### 3.5 Access model (nav vs enforcement)
- Nav gates: catalog `requiredAccess` (Teams=manager; reviews/candor/announcements/kudos/surveys/tools/assets/policies/agreements/trash=hr-admin; automation=manager) + per-sidebar `canAccessTier` rows + per-CreateAction `requiredAccess`. Org admin can only tighten via `/settings/apps`.
- Server gates exist only for Teams surfaces (`src/lib/page-gates.ts`: `requireManagerPage` -> `/people/me`, `requireHrAdminPage`), Goals (session only), modules (Talk/Tables layouts). Other hidden routes rely on API 403s (Trash: "Manager access required." error state; `/spaces` visibility filter) -> three different denial UX patterns (redirect / error card / 404).
- Inconsistencies: SettingsShell Admin door = SUPER_ADMIN/COMPANY_ADMIN (`settings-shell.tsx:27`) while the rail's Settings hub sidebar shows Tools/Assets/Trash to **HR** (hr-admin tier) who then cannot see the Admin door. Profile menu "Trash" is shown to everyone. Rail "Invite" is shown to everyone (server decides). `/organization` redirects employees but the Talk sidebar's "Directory" (`/people`) has no catalog gate.
- Rail hidden/minAccess are display-level only (documented in `rail-apps.ts:18-22`); routes stay URL-reachable.

### 3.6 Shared page chrome (`title-bar.tsx`)
`OsTitleBar` renders by default an **Ask AI / Share / Invite** button trio with **no onClick handlers** (l.89-111) on every page that uses it (Favorites, Mentions, Tools, Activity, Sidekick, Agents, Autopilot, Ideas, Clock, Notetaker, Build, Library, Store, Imports, Settings hub, …) unless `showStandardActions={false}` (Trash does). Also renders a filled amber star by default (`starred = true`, l.50) that means nothing, and legacy `people`/`morePeople` avatars fed from a fake `PEOPLE` catalog on several pages.

### 3.7 Mobile / responsive
- Zero Tailwind breakpoints in `os-shell.tsx`, `click-topbar.tsx`, `click-sidebar.tsx`, `click-app-rail.tsx`, `settings-shell.tsx`, `command-palette.tsx`, `customize-panel.tsx`, `item-drawer.tsx` (create-task has 2 incidental). Layout is `h-screen p-1.5` with a fixed 60px rail + 200-320px sidebar + 520px/44vw search card; no hamburger, no auto-collapse, no touch affordances. `@media` rules in os.css exist only for page KPI grids (e.g. l.4821, 5292, 6501). Panels cap at `max-w-[92vw]` but the shell itself does not adapt: desktop-only.

### 3.8 Keyboard / a11y
- Good: focus-visible ring (os.css:168-173), aria labels on most icon buttons, resizable sidebar keyboard support, `role="dialog"`/`aria-modal` on palette and status modal.
- Gaps: no focus trap in hand-rolled overlays; `MissionSplash` is a click-to-dismiss `role="status"` overlay that steals the whole screen; hover-only reveal of sidebar Search/Collapse buttons and the My Wrk expand chevron (keyboard users get them via focus-visible, pointer users must discover by hover); tooltips advertise dead shortcuts (`⌘1..9`, "⌥T", "G T").

---

## 4. Broken / confusing (ranked)

### High
1. **Global `⌘B` collapses the sidebar while typing in editors.** `shell-context.tsx:544-551` has no editable-target guard; `⌘B` = bold in BlockNote/TipTap; the window listener still fires. (Plausible: needs a manual check that editors do not `stopPropagation`; grep found none.)
2. **`OsTitleBar` Ask AI / Share / Invite buttons are inert** on ~15 pages (`title-bar.tsx:89-111`).
3. **Inbox "Customize Inbox" toggles never persist**: PATCH `{inbox}` is stripped by `patchSchema` (`api/preferences/route.ts:37-92`); `effective.inbox` never exists (`inbox/page.tsx:100-121`).
4. **AI hub sidebar "History" and "Prompts" link to 404s** (`apps-catalog.tsx:964-965`; only `sidekick/page.tsx` exists).
5. **Item drawer is a demo-era surface**: fabricated updates for non-task modules, 9 dead controls, "coming soon" tab, status set mismatch, wrong "Open as page" route (`item-drawer.tsx:287-296, 326-357, 521-553, 637-685`).
6. **Presence status is local-only and never expires**; hardcoded "For Cashkr Team" (`set-status-modal.tsx:129`; `shell-context.tsx:516-519`); profile-menu dot always green (`profile-menu.tsx:155`).
7. **Mute notifications is local-only and only silences the popup**; badge/inbox unaffected; row has a misleading trailing chevron (`profile-menu.tsx:179-195`).
8. **Rail `⌘1..9` shortcuts are browser-reserved** (`click-app-rail.tsx:118`, `shell-context.tsx:552-564`) -> advertised but (very likely) never delivered in Chrome/Safari.
9. **Profile menu "Themes" and "Keyboard shortcuts" go to `/settings?tab=…` which ignores `tab`; no shortcuts page exists** (`profile-menu.tsx:204-205`).
10. **Two divergent accent pickers** (`customize-panel.tsx:62-76` vs `account/appearance/page.tsx:22-33`) with different keys/defaults; `purple` silently normalised to `workwrk` (`theme-applier.tsx:79`).
11. **Folded apps are unreachable from rail *and* launcher** although the catalog promises launcher/search reachability (`apps-catalog.tsx:1344-1359`, `rail-apps.ts:159`); their sidebars and `createActions` (Library, Forms, Goals, Timesheets, SOPs ×4 kinds, Contracts, Review cycles, Clips) are dead code; folded routes get no hub highlight if the hub's `matchPaths` misses them.

### Medium
12. CustomizePanel "Home" tab edits `home.cards` that no component renders; "Create section" disabled coming-soon (`customize-panel.tsx:605-633, 691-699`).
13. Home More menu: "Drafts & Sent" disabled coming-soon; pin icons decorative (`apps-catalog.tsx:282-284`).
14. `/favorites` is orphaned and is actually "pinned Sidekick chats" (naming collision with sidebar Favorites and Top pins).
15. Orphaned routes: `/clock`, `/ideas`, `/autopilot` (static stub), `/me/mentions` (0 inbound); `/files`, `/activity` reachable only from dashboard-content/block-editor; `/loader-preview` public and outside auth.
16. Palette command "Open My Activity" -> `/dashboard` -> `/today` (`command-palette.tsx:146`).
17. `/item/[id]` archive fallback pushes `/home` (nonexistent) (`item/[id]/page.tsx:75`).
18. Workspace menu "Apps"/"Automations" toast coming-soon; "Invite people" -> members page instead of InviteModal (`workspace-menu.tsx:298-300, 385-393`). Teams create "Invite person" -> `/settings/members?invite=1`, param unread.
19. Upgrade targets differ: rail -> `/settings`, workspace menu -> `/settings/billing`; profile "Notifications" -> `/inbox` while `/settings/notifications` exists.
20. Brain panel dead controls: model pill "Max", "…", Attach "+", static "All sources"; Featured/Search rows promise unsupported capabilities (`sidekick-panel.tsx:341-352, 429-453, 513-520`).
21. Palette: Gmail/Drive/SharePoint tabs route to a coming-soon page; "Apps" source tab filters nothing; gear button dead; "Tab for actions" and ←/→ hints decorative; "G T/G I/G K/G M" chords have no handler; "Created date" sort inert.
22. Create menu: AI input just opens the task modal; "⌥T" wrong shortcut; "Super Agent · Hot" -> static mock page.
23. Create-task modal: taupe accent drift; Minimize = close; decorative "AI" hint; Dependencies is a sentence; external attach = paste-a-link prompts.
24. Loader inconsistency (ValueLoader 44 / Loader2 151 / "Loading…" 114 / DotsLoader 4 / Skeleton 5 files); shell panels use spinners.
25. Two toast systems mixed inside the shell; ~8 hand-rolled overlays with inconsistent z-index and no focus trap.
26. Dark mode via `!important` utility overrides + literal hex `dark:` classes; brand tokens not rebound; `html.night` theme unreachable.
27. Hardcoded `#0073EA` in 20 shell files defeats the accent picker.
28. Dead old-shell CSS + stale comments; `.os-side__scroll[data-icons-only]` targets nothing; `TopbarPopoverButton`, `ScreenProtection`, `lens` state unused.
29. Label drift: Work/Today/Home; Me/My Profile/My KRAs & KPIs; My Wrk/My Work/My tasks; Canvas/Whiteboard; Clips/Notetaker; Talk/Room/TLK; Marketplace/Store; Contracts/Agreements.
30. Trash reachable by everyone via profile menu but manager-gated (error state), hr-admin-gated in sidebar; Admin door (settings-shell) stricter than hr-admin rows in the rail Settings sidebar.
31. Product tour auto-launches with stale content (Settings → Team, Access Control, Organization "AI Assist" — `/organization` is now the manager-only org chart; company profile lives at `/settings/identity`) (`src/lib/tour-content.tsx:12-40`).
32. Boot density mismatch: local default `compact` vs server default `cozy` (`lib/density.ts:9`, `lib/preferences.ts:154`).
33. `/forms?mine=1`, `/notetaker?mine=1` params unread (dead sidebars anyway); Docs "Popular Wikis" permanent placeholder.
34. `os.css` is 34k lines / 1.4 MB loaded on every dashboard page; page-specific BEM blocks (`.fav`, `.tmpl`, `.mention-inbox`, `.ntk__`, `.bklg__`…) live in the shell stylesheet.

### Low
35. Notifications badge "99+" vs reminders "9+"; NotificationsBell comment says 25 s, code 45 s.
36. ActiveTimerPill polls every 15 s for every user; ChatSidebar/NotificationsBell/RemindersBell/ReminderTicker each poll independently despite SSE.
37. TopPinsStrip row is unlabeled and only removable on hover; Favorites section grouping threshold (>6) is a magic number.
38. Sidebar Search/Collapse buttons are `w-0 opacity-0` until hover (discoverability).
39. `OsTitleBar` default filled star means nothing; fake `PEOPLE` avatars on Favorites/Library/Store/Sidekick/Agents/Notetaker/Ideas.
40. `loader-preview` copy describes an animation the CSS doesn't do.
41. `useOsToast` silently no-ops outside its provider.
42. Rail "Upgrade" shows on ENTERPRISE; workspace menu hides it.
43. `/spaces` empty copy points at a sidebar "+" that only exists in the Home hub.
44. Escape handlers stack (shell + every panel) — pressing Esc with the Brain and a panel open closes several things at once.

---

## 5. Access notes
- Rail/sidebar visibility is **display-only**: catalog `requiredAccess` ∩ org `/settings/apps` config (hide / order / minAccess floor) ∩ premium-module entitlement; `home` and `settings` always present. Routes remain URL-reachable; enforcement is per-page (`page-gates.ts` for Teams; module layouts for Talk/Tables; API 403 elsewhere).
- Tiers: manager = TEAM_LEAD…C_LEVEL/HR/admins; hr-admin = HR/COMPANY_ADMIN/SUPER_ADMIN; org-admin = COMPANY_ADMIN/SUPER_ADMIN (`access-tiers.ts`). Teams sidebar adds a director tier (Rollup). SettingsShell Admin door uses org-admin; Workspace delete uses org-admin.
- Inconsistencies: HR sees Tools/Assets/Trash in the rail Settings sidebar but not the Settings Admin door; Trash is in the profile menu for every user (403 error state for non-managers); Invite button shown to everyone; `/people` (Directory) linked from Talk for everyone while Teams hub is manager-gated; denial UX varies (redirect to `/people/me`, error card, in-shell 404).
- Everything server-filters by access level; Today picks org-admin-wide vs member-visible Spaces.
- Personal state (presence, mute, quick-tool pins, sidebar width, collapsed, recents, active hub) is per-browser localStorage; only `iconsOnly`, `sectionsOrder`, theme, density, favorites, pins, notification prefs are server-side.

## 6. Settings notes
**Configurable today**: org rail order/hidden/minAccess (`/settings/apps`, admin); org defaults + locked keys (`/settings/defaults`); rail icons-only (CustomizePanel, server); sidebar sections order/hide (Favorites, Spaces); Home cards (persisted, unused); theme appearance + accent (CustomizePanel Themes **and** `/account/appearance`, divergent); density (`/account/appearance` server + local `workwrk:density`); topbar quick-tool pins (profile menu, localStorage only); presence + mute (localStorage only); sidebar width (localStorage); notification inbox/email prefs (`/settings/notifications`); Inbox prefs (broken); premium modules (`/settings/modules`); mission/values feeding loaders (`/settings/identity`).

**Should be configurable but isn't**: keyboard shortcuts (advertised, no page, hardcoded chords); default landing page (Home = first Space by `createdAt`); MissionSplash frequency / opt-out (fixed 10-min throttle, org-wide, no user or admin toggle); quick-tool pins synced across devices; presence stored server-side with auto-expiry and visible to teammates; per-hub default view/landing; custom sidebar sections (disabled stub); rail label density as an org lock (lockedKeys plumbing exists but no admin UI for `sidebar.iconsOnly`); tour replay/reset; locale (all dates `en-US`); sidebar width sync; which topbar bells/badges show; Upgrade target by plan.
