# UI audit: Planner, Calendar, Timesheets, Clock

Subsystem: time (Planner / calendar / timesheets / clock). Read-only audit, 2026-09-10.
All paths below are relative to `/Users/bigboldtechnologies/theywrk/`.

## 0. Route map (everything under src/app in scope)

| Route | File | Kind | Reachable from | State |
|---|---|---|---|---|
| `/planner` | `src/app/(dashboard)/planner/page.tsx` | page (client) | Rail "Planner", CalendarSidebar, topbar CalendarPeek (modal), command palette, `/calendar` redirect | rough |
| `/calendar` | `src/app/(dashboard)/calendar/page.tsx` | server redirect → `/planner` | legacy links only | n/a (redirect) |
| `/timesheets` | `src/app/(dashboard)/timesheets/page.tsx` | page (client) | Rail "Timesheets", Rail "Planner" sidebar, `/clock`, profile tool "Track Time", palette, analytics tile | rough |
| `/timesheets/[id]` | (does not exist) | referenced by dead `timesheet-manager.tsx:658` | none | broken link in dead code |
| `/clock` | `src/app/(dashboard)/clock/page.tsx` | page (client) | URL only (`g c` shortcut hook exists but is never mounted) | broken |
| `/tasks/calendar` | `src/app/(dashboard)/tasks/calendar/page.tsx` | page (client) | URL only, no links anywhere | rough, orphaned |
| `/settings/calendar` | `src/app/(dashboard)/settings/calendar/page.tsx` | page (client, settings shell) | Settings hub card, Settings → Integrations, settings-shell nav "Calendar feeds", `/integrations` header link, Google OAuth callback redirect | stub |
| `/time` | (does not exist) | target of the timesheet decision notification `src/app/api/timesheets/[id]/route.ts:157` | bell notification | 404 |

Non-route surfaces in scope (components):

| Surface | File | Mounted at | Notes |
|---|---|---|---|
| PlannerWeek | `src/components/layout/os/planner-week.tsx` | `/planner` + PlannerModal | the actual Planner UI |
| PlannerSidePanel | `src/components/layout/os/planner-side-panel.tsx` | inside PlannerWeek (not in modal) | Priorities / Meet with / buckets |
| PlannerCommandBar | `src/components/layout/os/planner-command-bar.tsx` | inside PlannerWeek (page AND modal) | floating search + Sidekick |
| PlannerConnectBanner | `src/components/layout/os/planner-connect-gate.tsx` | inside PlannerWeek | Google connect banner |
| PlannerModal + CalendarPeek | `planner-modal.tsx`, `calendar-peek.tsx` | topbar (`click-topbar.tsx:113`) | 1100px overlay |
| ActiveTimerPill | `src/components/layout/os/active-timer-pill.tsx` | topbar (`click-topbar.tsx:145`) | running TimerSession pill |
| TimeTracker | `src/components/board-view/time-tracker.tsx` | board item detail "Time entries" popover (`board-item-detail.tsx:554`) | start/stop/manual |
| DatePlanner | `src/components/board-view/date-planner.tsx` | item detail, kanban card chip, table Due cell | Date / Reminder / Repeat popover |
| BoardCalendarView | `src/components/board-view/board-calendar-view.tsx` | a board's CALENDAR view (`board-canvas.tsx:418`) | month grid per board |
| EntityTimer | `src/components/timers/entity-timer.tsx` | NOT imported anywhere | dead component (violet-600, pre-OS tokens) |
| OsCalendar | `src/components/layout/os/calendar.tsx` | NOT imported anywhere | dead component (`.os-cal` CSS still shipped) |
| TimesheetManager | `src/app/(dashboard)/timesheets/timesheet-manager.tsx` | NOT imported anywhere | dead 717-line week editor + approval queue |

Rail / sidebar wiring (`src/components/layout/os/apps-catalog.tsx`):
- `planner` app (line 1178): label "Planner", `defaultHref: "/planner"`, `matchPaths: ["/calendar","/planner","/timesheets"]`, Sidebar = `CalendarSidebar` (line 942: two NavItems, both with the `Calendar` icon: "Planner" → `/planner`, "Timesheets" → `/timesheets`). Core, defaultPinned, no `requiredAccess`. Sidebar "+" = "New task" → `ctx.openCreateTask()`.
- `timesheets` app (line 1230): label "Timesheets", `matchPaths: ["/timesheets"]`, Sidebar = `TimesheetsSidebar` (line 1122: "My Timesheets" → `/timesheets`, then a `SectionLabel` "Approvals" with a hard-coded `EmptyState "No pending approvals"` that never queries anything). Sidebar "+" = "Start this week" → `startTimesheetWeek` (line 202: POST `/api/timesheets`, bumps `rowVersion("timesheets")`, pushes `/timesheets`).
- No app matches `/clock`. `/tasks/calendar` falls under the `home` hub (`matchPaths` includes `/tasks`).
- IMPORTANT shell behaviour (`click-sidebar.tsx:89`): the sidebar shown is `getApp(activeAppKey) ?? findAppForPath(pathname)`. `activeAppKey` comes from the last rail click / Cmd+N / localStorage (`shell-context.tsx:278`) and is never re-derived from the URL. So `/timesheets` shows TimesheetsSidebar when reached via the Timesheets rail icon, CalendarSidebar when reached via the Planner rail icon, and whatever-was-last-active when reached by URL, palette, profile tool or the `/clock` links. `/clock` and `/tasks/calendar` always show a stale sidebar.
- Two Core rail icons (Planner, Timesheets) both lead to `/timesheets`.

Top bar (global, `click-topbar.tsx`): workspace switcher, CalendarPeek (Planner glyph, opens PlannerModal unless already on `/planner`), centered search "⌘K" + Ask AI pill, right card: ActiveTimerPill (only when a TimerSession is running), pinned profile tools (incl. "Track Time" → `/timesheets`, `profile-tools.ts:37`), Notifications bell, Reminders bell, Inbox link, avatar. None of the routes in scope add page-specific topbar items; page actions live in `OsTitleBar` (Timesheets, Clock, Task calendar, Settings calendar) or the Planner's own in-component header.

`OsTitleBar` (`title-bar.tsx`) note: every page using it renders a gold star + title + description + page `actions` + a standard trio "Ask AI / Share / Invite" (lines 89–111) that have NO onClick handlers. Those three buttons are cosmetic on every page in scope that uses the title bar.

---

## 1. `/planner`

**File:** `src/app/(dashboard)/planner/page.tsx` → renders `<PlannerWeek />` (`planner-week.tsx`).

**Title / purpose:** "Planner". Personal week time-grid (Sun–Sat, 24h × 48px) showing my assigned Tasks (incl. Google-synced meetings) and work Items I own that have dates, from `GET /api/planner/events?from&to` (`src/app/api/planner/events/route.ts`). Drag on the grid to create. Left side panel with Priorities / Meet with / task buckets. Floating command bar at the bottom.

**Reachable from:**
- Rail hub "Planner" (`apps-catalog.tsx:1178`, defaultHref `/planner`).
- CalendarSidebar → "Planner".
- Topbar `CalendarPeek` (`calendar-peek.tsx`): anywhere except `/planner` it opens `PlannerModal` (embedded PlannerWeek, no side panel). On `/planner` the button is a no-op with tooltip "Planner".
- Command palette: navigate row "Planner" (shortcut label "G M", `command-palette.tsx:134`) and command "Open Planner" alias `calendar` (line 143).
- `/calendar` server redirect.
- `?meet=1` focuses the side-panel "Meet with" input (`planner-week.tsx:54`, `planner-side-panel.tsx:96`); nothing in the codebase links with `?meet=1`.

**Back button:** none. No `BackButton`, no `router.back`.

**Top bar:** global only. The page has its own in-component header (`planner-week.tsx:150–159`): "Planner" (15px semibold), ‹ / Today / › week nav, week label ("Sep 6 – Sep 12, 2026"), `Loader2` spinner while a week loads. It does NOT use `OsTitleBar` (no star, no Ask AI/Share/Invite, no description). This is the only page in scope with a bespoke header.

**Sidebar when active:** CalendarSidebar: Planner, Timesheets. "+" → New task.

**Every control on the page:**
1. Week nav ‹ Today › (`planner-week.tsx:153–155`).
2. Connect banner (`planner-connect-gate.tsx`), shown only when `GET /api/integrations/google-calendar` returns `connected:false` and `localStorage["planner:connectBannerDismissed"] !== "1"`:
   - "Connect Google Calendar" `<a href="/api/integrations/google-calendar/connect">` (full-page nav to OAuth).
   - "Outlook · SOON" button, `disabled`, tooltip "Microsoft Outlook is coming soon".
   - Dismiss X → localStorage.
3. Side panel (`planner-side-panel.tsx`, 256px, hidden in the modal):
   - "Priorities" dashed placeholder "Prioritize a task to see it appear here" + **"Add priority" button with no onClick** (line 43).
   - "Meet with" search input (≥2 chars → `GET /api/users?search=&limit=6`, 200ms debounce) → list of people with "Meet" label → click POSTs `/api/tasks` `{ title: "Meet with <name>", startAt: next full hour, endAt: +30min, allDay:false }` (line 109–120). No attendee, no invite, no notification to the other person.
   - Collapsible "Assigned to me" (overdue+today+next), "Today & overdue", "Backlog" (unscheduled, open by default) from `GET /api/me/work`; row click → `router.push(url)`. Empty copy "Nothing here.", `Loader2` while loading.
4. Grid (`planner-week.tsx:185–241`): 7 columns, hour rows, 9–18 work hours un-shaded (`WORK_START/END` hard-coded), current-time red line, today pill in header. Mouse down/move/up on a column sweeps a 15-min-snapped range (`SNAP_MIN`); a plain click = 1h. Release → `CreateEventPopover`.
5. Event blocks: `<button>` with title + start time, colored by `eventColor` (item `#F2A93B`, external `#2F8BF0`, task `#16A9A1`). Click → `openEvent` → `router.push(e.url)` only if `url` non-null. **Task events always have `url: null`** (`planner/events/route.ts:62`) so clicking any Task/Google event does nothing. No hover card, no edit, no delete, no drag-to-move/resize.
6. `CreateEventPopover` (`planner-week.tsx:258–360`), centered fixed overlay:
   - Tabs Event / Task / Focus time / OOO: only change placeholder + accent colour (line 274–283); all four POST the same `/api/tasks` body. The chosen "type" is not persisted anywhere.
   - Title input, placeholder "…, @ for people, @@ for tasks": no mention parsing exists.
   - Date, start time, end time, duration label; "All day" checkbox hides the time inputs.
   - Four muted affordance rows: "Add video call", "Add participants", "Add tasks and docs", "Add location or room" (`Row muted`, lines 338–341) — plain `<div>`s, non-interactive placeholders.
   - "Add description" toggle + textarea.
   - Cancel / Create (Enter in title also creates). `create()` only calls `onCreated()` on `res.ok`; a failed POST closes nothing and shows no toast (line 302).
7. `PlannerCommandBar` (`planner-command-bar.tsx`, fixed bottom-center 560px pill): input placeholder "Search events, teammates, commands…". Typing ≥2 chars searches `/api/users` (people only; it never searches events). Enter / Sparkles button: empty query toggles a "Meet with" people list; non-empty query → `openSidekick(query)`. Clicking a person creates the same "Meet with X" task as the side panel (duplicate feature).
8. All-day events are filtered out of the grid (`.filter((e) => !e.allDay)`, line 193) and there is no all-day lane, so every all-day task (the default when created from `/tasks/calendar` or the "All day" checkbox here) is invisible on the Planner.

**UI state:** rough.

**Issues (planner):**
- P-1 (high) All-day events never render (no all-day lane, filtered out at line 193). Anything created with "All day" on this very page disappears after Create.
- P-2 (high) Task/Google event blocks are unclickable (`url: null`); no way to open, edit, move, resize or delete an event from the Planner. Items open the board drawer via URL.
- P-3 (medium) Dead / cosmetic controls: "Add priority" (no handler); "Add video call / participants / tasks and docs / location" rows are inert; Event/Task/Focus/OOO tabs are cosmetic; "@ / @@" placeholder promises unimplemented mentions; CalendarPeek is a no-op on `/planner`.
- P-4 (medium) "Meet with" (present twice: side panel + command bar) creates a self-assigned task titled "Meet with X" and does not involve X at all. Misleading label.
- P-5 (medium) Command bar placeholder says it searches events; it only searches people, and Enter with text opens Sidekick.
- P-6 (medium) Connect flow: if `GOOGLE_CLIENT_ID/SECRET` are unset the "Connect Google Calendar" link lands on a raw 501 JSON page (`connect/route.ts:17–22`). On success the callback redirects to `/settings/calendar?connected=1` (`callback/route.ts:24`), which is a "Coming soon" stub that ignores the param (see §6). No disconnect / per-calendar UI anywhere though `DELETE /api/integrations/google-calendar`, `/calendars`, `/subscribe` exist.
- P-7 (medium) No error state: a failed `/api/planner/events` fetch just marks the week loaded and leaves the grid empty (`planner-week.tsx:90`).
- P-8 (medium) Overlapping events are drawn on top of each other (absolute positioning, no column packing).
- P-9 (medium) PlannerModal does not close on navigation: clicking an item block inside the modal `router.push`es the board while the modal stays open over the new page (`calendar-peek.tsx` keeps `open` state; `planner-modal.tsx` has no pathname effect).
- P-10 (low) Mouse-only drag-create (no touch/pointer events); `onMouseLeave` on the whole page finishes a drag.
- P-11 (low) Week starts Sunday here; Timesheets and `/tasks/calendar` start Monday.
- P-12 (low) Style drift: hard-coded hex (`#2F8BF0`, `#16A9A1`, `#F2A93B`, `#7C5CFF`, `#FB5A6F`) instead of `--os-*` tokens; brand blue is `#0073EA` but the Planner's "blue" is `#2F8BF0`; `dark:` Tailwind variants exist only here; header/loader differ from every other page (no OsTitleBar, `Loader2` instead of `ValueLoader`).
- P-13 (low) Working hours 9–18 and 15-min snap hard-coded; no settings.
- P-14 (low) Palette shows keyboard hint "G M" for Planner but `use-goto-nav.ts` maps `g m` → `/meetings` and the hook is not mounted anyway; the hint is decorative.
- P-15 (low) `useSearchParams` in a client page without a Suspense boundary (`planner-week.tsx:53`) relies on the dashboard being fully dynamic.

---

## 2. `/calendar`

**File:** `src/app/(dashboard)/calendar/page.tsx`: `redirect("/planner")`. Server component, no UI. Comment explains the old My/Team/By-person calendar was retired.

**Reachable from:** nothing links here anymore; `planner.matchPaths` still lists `/calendar`. Fine to keep as a legacy redirect. The old `/api/calendar` route (`src/app/api/calendar/route.ts`, my/team scope with TimerSession totals, weekly reviews, SOP assignments, `workByUser`) still exists with no consumer in scope (orphan API kept alive).

**UI state:** n/a (redirect). No issues beyond the orphaned API.

---

## 3. `/timesheets`

**File:** `src/app/(dashboard)/timesheets/page.tsx` (BEM `.tsh__*`, CSS `os.css:30388–30467`).

**Title / purpose:** "Timesheets" (OsTitleBar, star, description "N timesheets · N submitted · Nh logged", or "Loading…"). Lists weekly Timesheet rows per scope, expands a row to show its TimeEntry lines grouped by day, and runs the submit / retract / approve / reject flow.

**Reachable from:**
- Rail "Timesheets" (`apps-catalog.tsx:1230`) and TimesheetsSidebar "My Timesheets".
- Rail "Planner" → CalendarSidebar "Timesheets" (`apps-catalog.tsx:947`).
- `/clock` header link "My timesheets" and panel link "Go to timesheets" (`clock/page.tsx:110,158`).
- Topbar pinned profile tool "Track Time" (`profile-tools.ts:37`).
- Command palette "Go to Timesheets" alias `ts` (line 150) and quick action "Open Timesheets" (line 279).
- `/analytics` tile "Timesheets" (`analytics/page.tsx:99`).
- Sidebar "+" → Start this week → pushes `/timesheets`.
- Broken: decision notifications link to `/time` (`api/timesheets/[id]/route.ts:157`), which does not exist.
- `/settings/data` offers `href: "/api/export/timesheets"` (`settings/data/page.tsx:65`) but `src/app/api/export/timesheets/route.ts` does not exist.

**Back button:** none.

**Top bar / title bar:** OsTitleBar with actions: primary "Start this week" (`.tsh__btn-primary`, brand→blue gradient). Standard dead trio Ask AI / Share / Invite.

**Sidebar when active:** TimesheetsSidebar (My Timesheets; "Approvals" → static "No pending approvals") OR CalendarSidebar, depending on which rail icon was clicked last (see §0).

**Every control:**
1. "Start this week" → `POST /api/timesheets {}` (idempotent upsert of the current UTC-Monday week; approver = my manager or null). Toast "This week's timesheet is open". Only the current week can be created from the UI (the API accepts `weekStartDate`, nothing sends it).
2. Four KPI tiles: Drafts / Submitted / Approved / Hours logged. Static, computed from the currently loaded list only (default `limit` 20, whichever scope is selected). Not clickable.
3. Scope segmented control: Mine / Approve queue / Team / All. Rendered for every user. `approve|team|all` return 403 for non-managers (`api/timesheets/route.ts:41–51`) → the page shows the OsEmptyView error "Couldn't load timesheets / HTTP 403" with a working Retry.
4. Rows (`.tsh__row`): status chip (Draft/Submitted/Approved/Rejected), week label "Sep 7 → Sep 13", owner avatar+name (present in every scope, incl. Mine), "Xh logged", "N entries", "· Approved by <approver>" whenever `t.approver` is set. Click the main area → toggles an inline detail panel loaded from `GET /api/timesheets/[id]`.
5. Row actions: Submit (DRAFT), Retract (SUBMITTED), Approve / Reject (SUBMITTED and `scope === "approve"` only). No confirm dialog, no reject reason prompt (API accepts `note`; UI never sends one). 403 → toast "Permission denied".
6. Detail panel (`SheetDetailPanel`, Tailwind zinc utilities, not BEM): per-day header with total, entries with a blue dot, title (item → task → description → "Time entry"), "from timer" tag for `TIMER` source, hours. No links to the item (board slug is fetched but unused). No add / edit / delete of entries anywhere on this page.
7. Empty state: OsEmptyView "No timesheets in this view" with CTA "Start this week" (works).
8. Loading: `ValueLoader size 32` inside `.tsh__loading`.
9. Realtime: reloads when `rowVersion("timesheets")` bumps (only the sidebar "+" bumps it).

**Data model reality check:** TimeEntry sources are WEB / PUNCH / MOBILE / KIOSK / IMPORT / TIMER (`prisma/schema.prisma:3341`). The only live writer of entries is the board-timer bridge (`/api/timers/stop` → `logTimerToTimesheet`, `src/lib/timesheet.ts:40`, source TIMER, DRAFT sheets only). `POST /api/time-entries` (manual hours) and `POST /api/time-entries/punch` exist but no mounted UI calls them correctly (the dead `timesheet-manager.tsx` did; the Clock page calls punch without a body). Manual sessions from TimeTracker (`POST /api/timers`) do NOT bridge to a timesheet.

**UI state:** rough.

**Issues (timesheets):**
- T-1 (high) There is no way to log, edit or delete hours on the Timesheets page. "Start this week" creates an empty DRAFT the user cannot fill; hours only arrive via a board-item timer stop. The complete week editor (day rows, inline add, delete, punch, submit confirm, reject reason, bulk approve) exists in `timesheet-manager.tsx` but is not imported anywhere.
- T-2 (high) REJECTED is a dead end: the UI only offers Retract on SUBMITTED, the API only allows SUBMITTED→DRAFT (`[id]/route.ts:101–111`), and `POST /api/time-entries` refuses entries on REJECTED (`time-entries/route.ts:82`). A rejected week can never be corrected or resubmitted.
- T-3 (high) "Approved by <manager>" is shown on DRAFT and SUBMITTED sheets: `approverId` is pre-filled with the manager at creation (`api/timesheets/route.ts:114`) and the row renders `t.approver && "· Approved by …"` regardless of status (`page.tsx:194`). Also wrong wording on REJECTED.
- T-4 (medium) `decisionNote` (rejection reason) is stored but never displayed; the live Reject button sends none.
- T-5 (medium) Scope tabs Approve/Team/All are visible to ICs and produce a 403 error screen instead of being hidden.
- T-6 (medium) In Team / All scopes a manager sees SUBMITTED rows but gets no Approve/Reject (only in `approve` scope); a manager whose report's sheet is assigned to a different approver can decide via API but not via UI.
- T-7 (medium) Timezone drift: `weekStartDate` is Monday 00:00 UTC (`timesheet-week.ts:16`); `weekLabel` and the detail day headers format it with local `toLocaleDateString` → users west of UTC see "Sun → Sat" weeks and shifted day headers. `new Date("YYYY-MM-DD")` in the detail panel parses as UTC (page.tsx:229–242).
- T-8 (medium) Decision notification deep-link `/time` → 404. Data export link `/api/export/timesheets` → 404.
- T-9 (medium) TimesheetsSidebar "Approvals: No pending approvals" is hard-coded and never reflects the queue.
- T-10 (low) KPIs sum only the loaded page of the active scope (labelled "across all sheets").
- T-11 (low) Two Core rail icons route to the same page; CalendarSidebar uses the `Calendar` icon for Timesheets while the rail uses `Clock`.
- T-12 (low) No previous-week creation, no week navigation, no date filter, no tag filter UI (API supports `tags`).
- T-13 (low) No confirm on Submit / Approve / Reject; zero-hour weeks can be submitted.
- T-14 (low) Style: gradient primary button, 3px status accent bars, KPI tiles with gradient accents; detail panel switches to Tailwind zinc utilities and hard-coded `#0073EA` dot. Dead Ask AI/Share/Invite trio.
- T-15 (low) Source labels: only TIMER gets "from timer"; PUNCH / WEB / IMPORT are unlabelled.

---

## 4. `/clock`

**File:** `src/app/(dashboard)/clock/page.tsx` (BEM `.clk__*`, CSS `os.css:30472–30595`).

**Title / purpose:** "Clock" (OsTitleBar; description "Clocked in" / "Clocked out"; action link "My timesheets"). Punch in/out hero with live clock, "Today" hours and "Recent sessions".

**Reachable from:** URL only. `src/hooks/use-goto-nav.ts:28` maps `g c` → `/clock`, but `useGoToNav` is never imported or mounted anywhere. No rail app, sidebar item, palette entry or in-page link references `/clock`.

**Back button:** none (forward links to `/timesheets` only).

**Sidebar when active:** stale (no app matches `/clock`).

**Every control:**
1. Hero: state pill (Clocked in / out), date, 88px monospace clock (or elapsed when clocked in), "Clock in" / "Clock out" gradient button, "Since HH:MM" when running.
2. "Today" panel: hours today (`todayHours`) + "Go to timesheets".
3. "Recent sessions" panel: up to 8 completed entries, or "No completed sessions yet today."
4. Error state: OsEmptyView "Couldn't load clock" with `cta="Retry"` but no `onCta`/`ctaHref` → the CTA is suppressed (`empty-view.tsx:40`), so there is no retry.

**What actually happens at runtime:**
- `load()` calls `GET /api/time-entries?mine=true&open=true` and `GET /api/time-entries?mine=true&limit=8` (lines 56–57). `src/app/api/time-entries/route.ts` exports only `POST` → both requests fail (405). `activeRes.ok` is false so `active` stays null, `recent` stays `[]`, `todayHours` is always 0. No error is surfaced (`loadError` only on network throw).
- `punch()` POSTs `/api/time-entries/punch` with no body (line 81). The handler does `await req.json()` (`punch/route.ts:52`) which throws on an empty body (500); even with `{}` it returns 400 "action must be 'start' or 'stop'". Result: every click toasts "Punch failed". The page never detects an existing punch either (see above), so the button label is always "Clock in".
- The correct active-punch endpoint is `GET /api/time-entries/punch` (returns `{active}`), which the page never calls.

**UI state:** broken.

**Issues (clock):**
- C-1 (high) Clock in/out never works (wrong request body).
- C-2 (high) Active punch / recent sessions / today hours are never loaded (GET on a POST-only route); the page silently shows 00:00 / 0h / empty.
- C-3 (high) Orphaned: unreachable from any UI; the only intended entry (`g c`) is an unmounted hook.
- C-4 (medium) Three disconnected time models: punch (`TimeEntry.PUNCH`), board timers (`TimerSession`, topbar pill), manual timer sessions. The topbar ActiveTimerPill only knows TimerSession, so a punch never shows in the topbar and a running board timer never shows on `/clock`.
- C-5 (medium) Retry CTA silently suppressed; non-OK responses never produce an error state.
- C-6 (low) Copy mismatch: "No completed sessions yet today" for a "recent 8" list; "Today" is computed from those 8.
- C-7 (low) Visual drift: gradient hero, gradient buttons, 88px display digits, pulsing top bar; empty `.clk__hero-btn:hover` rule (`os.css`).
- C-8 (low) Punch guardrails (5s minimum, 16h maximum) are hard-coded in the API with no setting and no UI explanation.

---

## 5. `/tasks/calendar`

**File:** `src/app/(dashboard)/tasks/calendar/page.tsx` (BEM `.tcal__*`, CSS `os.css:5622–5700`).

**Title / purpose:** "Task calendar" (OsTitleBar; description "<Month Year> · N tasks this month"). Full-bleed Monday-start month grid of `Task` rows (`GET /api/tasks?startDate&endDate`, ±14 days padding), status-coloured pills, drag-to-reschedule, day drawer with inline add.

**Reachable from:** URL only. `grep -rn 'tasks/calendar' src` finds no link. Not in any sidebar, palette or rail.

**Back button:** none.

**Top bar / title bar:** OsTitleBar with `people={[PEOPLE.bb, PEOPLE.sc]} morePeople={3}` — `PEOPLE` is a hard-coded demo constant (`catalog.ts:79`: "BB", "SC", …). The header shows two fabricated avatars and "+3". Actions: ‹ month label › nav and "Today". Dead Ask AI/Share/Invite trio.

**Sidebar when active:** stale / home hub.

**Every control:**
1. Month nav ‹ › + Today.
2. Stat strip (Planned / In progress / Completed / Late) shown only when `stats.total > 0`.
3. 6×7 Monday-start grid: cell click → day drawer; `onDragOver/onDrop` → `reschedule` (optimistic + `PATCH /api/tasks {id, date}`; on failure toast "Couldn't move" + reload).
4. Pills: max 3 per cell, draggable, `onClick` stops propagation and does nothing else (a pill click neither opens the task nor the drawer); "+N more" is a static span. Flame icon on URGENT/HIGH.
5. Day drawer (right panel): weekday, date, "N task(s)", list rows (status label, P0/P1 flame, assignee avatar/initials) that are not clickable, empty copy "No tasks on this day yet.", footer input "Add task to <date>…" → Enter → `POST /api/tasks {title, date, allDay:true}` then the drawer closes immediately even if the POST fails.
6. Error: bare `.tcal__loading` text "Couldn't load: …", no retry. No loading state for the grid (empty cells while loading; the title description says "Loading…").

**UI state:** rough (works, but orphaned and shows fake data).

**Issues (task calendar):**
- TC-1 (high) Fabricated people avatars ("BB", "SC", "+3") in the title bar from `PEOPLE` demo constants.
- TC-2 (high) Orphaned route: unreachable; duplicates the Planner's purpose with a different data source (Tasks only, no Items, no Google events; Planner shows Items + Tasks) and a different week start.
- TC-3 (medium) Nothing is openable: pills swallow clicks, drawer rows are inert, "+N more" is static.
- TC-4 (medium) UTC bucketing: `new Date(t.date).toISOString().slice(0,10)` and `isoDate(d)` use UTC while the grid is local → tasks appear on the previous day for users west of UTC; drops write `day.toISOString()` (local midnight → UTC).
- TC-5 (medium) Tasks created here are `allDay:true`, which the Planner then hides (P-1).
- TC-6 (low) No loading state, error state without retry, drawer closes on failed add, HTML5 drag only (no touch).

---

## 6. `/settings/calendar`

**File:** `src/app/(dashboard)/settings/calendar/page.tsx` (BEM `.cli__*`, CSS `os.css:12667` shared block + `12948–12990`). Rendered inside the Settings shell (`os-shell.tsx:79` `settingsMode`), so the secondary sidebar is the settings nav.

**Title / purpose:** "Calendar integrations" (OsTitleBar; description "External calendar sync is coming soon — no calendars are connected yet"). Lists five providers (Google, Outlook/M365, iCloud, Fastmail, ICS feed) each with a "Coming soon" status chip, an empty-state paragraph, and a hint "WorkwrK will keep your calendar in sync without storing event bodies — subject lines and times only."

**Reachable from:**
- Settings hub card "Calendar feeds" (`settings/page.tsx:170`, copy "Subscribe external calendars; publish org feeds.").
- Settings → Integrations card "Calendar feeds — Connect Google, Outlook, iCloud or ICS feeds" (`settings/integrations/page.tsx:10`).
- Settings shell nav Platform → "Calendar feeds" (`settings-shell.tsx:95`).
- `/integrations` header link "Calendar" (`integrations/page.tsx:90`).
- Google OAuth callback success redirect `…/settings/calendar?connected=1` (`api/integrations/google-calendar/callback/route.ts:13,24`).

**Back button:** none (settings shell nav only). Header links "Settings" and "Integrations".

**Controls:** none functional. Two nav links. Standard dead trio.

**UI state:** stub.

**Issues (settings calendar):**
- SC-1 (high) The page (and its header comment, lines 5–9) claims "this app has no calendar-OAuth backend", but a full Google backend exists: `connect`, `callback`, `route.ts` (GET status incl. `lastSyncAt`, DELETE disconnect + purge GCAL tasks), `calendars`, `subscribe`, a 5-minute cron `api/cron/calendar-sync`, and the Planner banner actively offers "Connect Google Calendar". Users who connect are redirected here and told it is "coming soon".
- SC-2 (high) `?connected=1` is ignored: no success message, no connection card, no disconnect. The CSS for a connected state (`.cli__provider-status--connected`, `.cli__provider-btn`, `.cli__conn*`) is shipped but never rendered.
- SC-3 (medium) ICS export exists end-to-end (`POST/GET/DELETE /api/calendar/ics/token`, public `/api/calendar/ics/[token]`) with no UI to issue, copy, rotate or revoke the feed URL, yet the settings copy promises "publish org feeds".
- SC-4 (medium) Model fields `direction`, `shareTitles`, `enabled` per subscription have no controls, although the hint text promises the "subject lines and times only" behaviour.
- SC-5 (low) Three different labels for the same page: "Calendar integrations" (title), "Calendar feeds" (settings nav + hub + integrations card), "Calendar" (/integrations link).

---

## 7. Non-route surfaces

### PlannerModal / CalendarPeek (topbar)
- 1100px × 82vh overlay (`planner-modal.tsx`), Esc + backdrop close, close X top-right. Embeds `PlannerWeek embedded` (no side panel, command bar still floating at the bottom, connect banner still shown).
- Issues: stays open across navigation (P-9); no-op on `/planner`; command bar's Sidekick handoff inside a modal opens Sidekick under/over the modal (z-index 80 vs Sidekick unknown); no responsive behaviour below ~700px.

### ActiveTimerPill (topbar)
- Polls `GET /api/timers/active` every 15s; red pill (Tailwind `red-50/200/700`, not tokens) with elapsed + entity title + stop square; link to the board item when `BOARD_ITEM`. Only `BOARD_ITEM` titles are resolved (`timers/active/route.ts:26`); other entity types show a lowercased type label.
- Issues: knows nothing about punches; stop is optimistic without error handling; up-to-15s stale after starting a timer elsewhere.

### TimeTracker (board item detail popover, `board-item-detail.tsx:554`)
- Header "Time tracked · Xh Ym total", "Manual entry" link; Start timer (black `zinc-900` button) / Stop (red-500) with running clock; manual form (hours, minutes, notes) → `POST /api/timers` manual session; sessions list (6 most recent, dot + duration + relative time), "+N earlier sessions", empty copy, "Loading…" text.
- Issues: manual sessions are NOT bridged to a timesheet (only `/api/timers/stop` calls `logTimerToTimesheet`), so timer-tracked time appears on the timesheet while manually logged time does not; totals are cross-user but the list never shows who; tracked time only lands on DRAFT sheets (silently dropped otherwise, `timesheet.ts:52`); buttons use black/red Tailwind rather than brand tokens.

### DatePlanner (task date popover)
- Trigger chip (full or compact); 520px portaled panel with tabs Date / Reminder / Repeat. Date: start/due `datetime-local`, quick chips (Today/Later/Tomorrow/This weekend/Next week/Next weekend/2 weeks/4 weeks, 17:00 default), Sunday-start month grid, "Set Recurring" row. Reminder: quick relative chips (need a due date), custom datetime, scheduled list with remove. Repeat: frequency, interval, weekday chips / month day / year month+day, "At" time, trigger (On schedule / After completion), Ends (never / on date / after N), "Update status to", Don't Recur / Cancel / Save with live summary.
- State: polished; uses `--os-brand` and `--signal-*` tokens.
- Issues: `removeReminder` sends `PATCH /api/reminders/[id]` with body `{}` (`date-planner.tsx:203`) rather than a DELETE, relying on the API to treat an empty patch as dismiss; when `canEdit` is false the full chip still renders as a disabled "Set date" affordance.

### BoardCalendarView (board CALENDAR view)
- Toolbar: ‹ › month, title, "Today" (disabled on current month), "Date field" select (Auto / Due date / each DATE field; persisted to the view config via `PATCH /api/boards/[id]/views/[viewId]`), "N dated items". Sunday-start grid, weekend tint, today pill, hover "+" per cell (creates "New item" TO_DO due local midnight and opens the drawer), up to 4 chips per cell (status-tinted, owner avatar), drag-to-reschedule with drop highlight, right-click context menu (Start timer gated by Space `timeTracking` module), inline error banner with dismiss.
- State: polished (closest to convention in scope).
- Issues: "+ N more" is a static `<li>`; lead/trail cells are inert drop targets; no week/day/agenda modes; HTML5 drag only.

### Dead code that still shapes expectations
- `timesheet-manager.tsx` (717 lines): full week editor + approval queue with `BulkApproveBar`, confirm dialogs, reject-reason prompt, "View" link to a non-existent `/timesheets/[id]`. Pre-OS styling (`text-muted`, `border-white/20`, `blue-400`). Never imported.
- `EntityTimer` (`timers/entity-timer.tsx`): violet-600 play/pause chip, never imported.
- `OsCalendar` (`layout/os/calendar.tsx`): month grid using `openItemDrawer`, never imported; `.os-cal*` CSS still shipped.
- `use-goto-nav.ts`: never mounted; palette still advertises `G T / G I / G K / G M` hints.

---

## 8. Broken / confusing (ranked)

| # | Where | What | Severity |
|---|---|---|---|
| 1 | `/clock` | Clock in/out never works: `POST /api/time-entries/punch` sent without a body; handler needs `{action:"start"|"stop"}` (`clock/page.tsx:81`, `punch/route.ts:52–58`) | high |
| 2 | `/clock` | Active punch, recent sessions and today's hours never load: page GETs `/api/time-entries` which only exports POST (`clock/page.tsx:56–57`, `time-entries/route.ts:21`) | high |
| 3 | `/clock` | Orphaned route: no rail/sidebar/palette/link; `g c` hook (`use-goto-nav.ts`) is never mounted | high |
| 4 | `/timesheets` | No UI anywhere to add/edit/delete hours; "Start this week" opens an empty sheet; the full editor (`timesheet-manager.tsx`) is dead code | high |
| 5 | `/timesheets` + API | REJECTED is terminal: no retract from REJECTED (UI + `[id]/route.ts:101–111`) and entries refused on REJECTED (`time-entries/route.ts:82`) | high |
| 6 | `/timesheets` | "· Approved by <manager>" shown on DRAFT/SUBMITTED/REJECTED rows because `approverId` is pre-assigned at creation (`page.tsx:194`, `api/timesheets/route.ts:114`) | high |
| 7 | `/planner` | All-day events are filtered out and there is no all-day lane (`planner-week.tsx:193`); tasks created "All day" (here or in `/tasks/calendar`) vanish | high |
| 8 | `/planner` | Task/Google event blocks are unclickable (`url: null`, `planner/events/route.ts:62`); no edit/move/delete of any event | high |
| 9 | `/settings/calendar` | Stub says no calendar backend / "Coming soon" while a full Google OAuth + cron sync + ICS export backend exists and the Planner banner offers Connect; OAuth success redirects here with an ignored `?connected=1` | high |
| 10 | `/tasks/calendar` | Fabricated avatars "BB", "SC", "+3" from `PEOPLE` demo constants in the title bar (`tasks/calendar/page.tsx:156`) | high |
| 11 | `/tasks/calendar` | Orphaned route duplicating the Planner with a different data source and week start | high |
| 12 | `/planner` | Dead/cosmetic controls: "Add priority", four inert "Add video call/participants/tasks and docs/location" rows, Event/Task/Focus/OOO tabs that change nothing persisted, "@ / @@" placeholder without mentions, CalendarPeek no-op on `/planner` | medium |
| 13 | `/planner` | "Meet with" (twice: side panel + command bar) creates a self-assigned task "Meet with X"; X is never invited or notified | medium |
| 14 | `/planner` | Command bar claims to search events; searches people only; Enter with text opens Sidekick | medium |
| 15 | `/planner` | Google connect: unconfigured env → raw 501 JSON page; no disconnect / per-calendar / sync-status UI though the APIs exist | medium |
| 16 | `/planner` | No error state for a failed events fetch; overlapping events stack; PlannerModal stays open after in-modal navigation | medium |
| 17 | `/timesheets` | Approve/Team/All tabs shown to ICs → 403 error screen; Approve/Reject missing in Team/All scopes; rejection reason never captured or displayed | medium |
| 18 | `/timesheets` | UTC-Monday `weekStartDate` rendered with local `toLocaleDateString` → Sunday-start labels and shifted day headers for users west of UTC | medium |
| 19 | `/timesheets` | Decision notification links to `/time` (404); Settings → Data links `/api/export/timesheets` (404) | medium |
| 20 | Timesheets sidebar | "Approvals: No pending approvals" is a hard-coded empty state | medium |
| 21 | TimeTracker | Manual sessions (`POST /api/timers`) never bridge to the timesheet; only timer stops do; tracked time silently dropped when the week is not DRAFT | medium |
| 22 | `/tasks/calendar` | Pills, drawer rows and "+N more" are not openable; UTC bucketing shifts days west of UTC; drawer closes on failed add | medium |
| 23 | `/clock` | Error view's "Retry" CTA is suppressed (no `onCta`); non-OK responses never surface | medium |
| 24 | Cross-cutting | Three unlinked time models (punch TimeEntry, TimerSession, manual TimerSession); topbar pill only shows TimerSession | medium |
| 25 | All OsTitleBar pages | "Ask AI / Share / Invite" buttons have no handlers (`title-bar.tsx:89–111`) | medium |
| 26 | Week start | Planner Sunday; Timesheets + Task calendar Monday; Board calendar + DatePlanner Sunday | low |
| 27 | `/timesheets` | KPI totals only cover the loaded page of the active scope; no previous-week creation; no confirms; zero-hour submit | low |
| 28 | `/planner` | Hard-coded hex palette (`#2F8BF0` etc., not brand `#0073EA`), only page with `dark:` variants, bespoke header and `Loader2` loader | low |
| 29 | Palette / shortcuts | "G M" etc. hints reference an unmounted hook; `g m` would go to `/meetings` not `/planner` | low |
| 30 | Dead code | `EntityTimer`, `OsCalendar` (+ `.os-cal` CSS), `timesheet-manager.tsx` (links `/timesheets/[id]`), `/api/calendar` legacy feed | low |
| 31 | DatePlanner | Reminder removal uses `PATCH {}` rather than a delete | low |

---

## 9. Cross-cutting conventions observed

**Back navigation.** None of the six routes has a `BackButton` or `router.back`. Planner/Timesheets are top-level hub pages (acceptable). `/clock`, `/tasks/calendar` and `/settings/calendar` are second-level pages with no back affordance; `/settings/calendar` relies on the settings shell nav and two header links ("Settings", "Integrations"). Convention 2026-08-20 (`BackButton{fallbackHref}` on detail routes) is not applied to any detail-ish surface here. Modal/popover surfaces close via Esc / backdrop / X consistently.

**Loader.** Route transitions: `(dashboard)/loading.tsx` renders `ValueLoader size 40`. In-page: Timesheets uses `ValueLoader 32` (matches); Planner uses `Loader2` spinners (header, side panel, command bar, create button); Clock has no loading state (shows 00:00:00 and 0h); Task calendar has none (grid renders empty, description says "Loading…"); TimeTracker and the timesheet detail panel use plain "Loading…" text.

**Empty / error states.** `OsEmptyView` is used on Timesheets (error + empty, both with working CTAs) and Clock (error only, CTA suppressed). Planner has no error state at all and inline "Nothing here." copy in the side panel. Task calendar has a bare text error without retry and no empty state for the grid. Settings calendar is static "coming soon" copy. Board calendar shows an inline dismissible red banner. Toast wording differs per page ("Punch failed", "Couldn't update", "Couldn't add").

**Style consistency.** Two visual systems coexist:
- BEM + `os.css` + `--os-*` tokens: Timesheets (`.tsh`), Clock (`.clk`), Task calendar (`.tcal`), Settings calendar (`.cli`). Token-correct, but heavy on gradients (brand→blue gradient buttons, gradient hero, 3px accent bars, KPI tiles), which drifts from the Monday-clean flat single-accent preference.
- Tailwind with hard-coded hex: Planner family (`#2F8BF0`, `#16A9A1`, `#F2A93B`, `#7C5CFF`, `#FB5A6F`, `dark:` variants), TimeTracker (`zinc-900` / `red-500`), ActiveTimerPill (`red-*`), dead EntityTimer (`violet-600`). DatePlanner and BoardCalendarView use `var(--os-brand)` and are the closest to convention.
- Headers: Planner has a bespoke 48px header; everything else uses `OsTitleBar` (star + dead Ask AI/Share/Invite trio). Icon gradients passed to `OsTitleBar` are ignored (legacy prop).
- Type: 11.5–15px ad-hoc sizes in the Planner; OsTitleBar description is `text-xs`.

**Mobile / responsive.** No mobile layout anywhere in scope. Planner: fixed 256px side panel + 56px gutter + 7 flex columns, mouse-only drag-create, 560px/82vw floating command bar, modal 1100px/94vw. Timesheets: KPIs collapse to 2 columns at 900px; row grid is a fixed 4-column template. Clock: hero digits 88→60px and panels stack at 900px. Task calendar: stat strip 2 columns at 920px, 7-column grid never collapses. HTML5 drag/drop (task calendar, board calendar) does not work on touch.

**Time zones / week start.** Server anchors Timesheets to UTC Monday (`timesheet-week.ts`, duplicate helper in `lib/timesheet.ts`); the UI formats with local time. Planner, DatePlanner and Board calendar use local time and Sunday-start weeks; Task calendar uses Monday-start with UTC bucketing. No timezone or week-start preference exists.

**Sidebar selection.** The secondary sidebar is sticky to the last rail click, not the route (`click-sidebar.tsx:89`), so URL/palette/link arrivals at `/timesheets`, `/clock`, `/tasks/calendar` show a stale sidebar.

---

## 10. Access notes

- Rail: `planner` and `timesheets` have no `requiredAccess` (visible to every access level). The org can hide/floor/reorder them in Settings → Admin → Apps (`rail-apps.ts`), but that is display-only; all routes in scope remain reachable by URL and `src/lib/page-gates.ts` has no entries for planner/timesheets/clock/calendar.
- `/api/planner/events`: strictly my own Tasks (`assigneeId = me`) and Items I own. `/api/me/work` for the side panel buckets.
- `/api/timesheets` GET: `mine` = own rows; `approve` / `team` / `all` require `isManager` (SUPER_ADMIN, COMPANY_ADMIN, C_LEVEL, VP, DIRECTOR, MANAGER, TEAM_LEAD, `api-helpers.ts:56`). `approve` = SUBMITTED rows where `approverId = me OR null` (unassigned sheets are visible to every manager). `all` = org-wide for any TEAM_LEAD (not admin-only). UI shows all four scope tabs to everyone.
- `/api/timesheets/[id]` GET: owner, assigned approver, or any manager. `submit`/`retract`: owner only. `decide`: any manager except the subject; NOT restricted to the assigned approver, so any team lead can approve/reject any sheet in the org via API while the UI queue only surfaces assigned/unassigned ones.
- Time entries (`/api/time-entries/[id]`): owner-only edit/delete, DRAFT sheets only; active punch cannot be edited.
- Timers (`/api/timers*`): any org member on any entity; totals and session lists are cross-user (privacy: everyone sees who tracked how long on an item); board timer UI is gated by the Space `timeTracking` module (`board-canvas.tsx:203`).
- Google Calendar: per-user OAuth; requires `GOOGLE_CLIENT_ID/SECRET` or `/connect` returns 501 JSON. Disconnect purges all GCAL tasks for that user (`google-calendar/route.ts:50`).
- ICS export token: per-user, public unauthenticated feed URL once issued; no UI.
- `/clock`: any user (but non-functional).
- Inconsistency: Settings calendar page is reachable by everyone via the settings shell, yet it is a per-user connection surface described as org "feeds".

## 11. Settings notes

**Configurable today:** rail visibility/order/access floor for Planner and Timesheets (Settings → Admin → Apps); Space-level `timeTracking` module toggle (hides board timer field + context-menu Start timer); per-board Calendar view "Date field"; per-user Google connect (via Planner banner only) and banner dismissal (localStorage); per-task reminders and recurrence (DatePlanner).

**Should be configurable but is not (or has no UI):**
- Week start day (Sun/Mon) and timezone, at org and user level; the code hard-codes both differently per surface.
- Working hours (Planner shades 9–18 via constants), default event duration (1h) and snap (15 min).
- Timesheet policy: who approves (assigned manager vs any manager), lock after approval, submission deadline and reminder nudges, allow zero-hour submit, require descriptions, max hours per entry/day (24 hard-coded), rounding, overtime, correction flow after rejection, auto-create weekly sheets, retroactive week creation.
- Punch rules: minimum punch (5s) and maximum punch (16h) are hard-coded in `punch/route.ts`.
- Calendar sync: direction, `shareTitles` (titles-only privacy), per-calendar enable, sync status, disconnect, Outlook; ICS feed URL issue/rotate/revoke. All backed by existing routes/model fields with no UI.
- Planner sources and colours (Tasks vs Items vs external), all-day display, which buckets appear in the side panel.
- Display units (decimal hours vs h:mm) which currently differ between Timesheets (decimal), Clock (hh:mm:ss) and TimeTracker (Xh Ym).
