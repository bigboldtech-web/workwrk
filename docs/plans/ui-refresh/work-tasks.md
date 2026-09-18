# UI audit: Work hub + tasks

Subsystem: the "Work" rail hub (HomeSidebar) and everything task-shaped that hangs off it. Audited read-only on 2026-09-10 from the working tree at `/Users/bigboldtechnologies/theywrk` (branch main, HEAD 6187227a).

All paths below are relative to `/Users/bigboldtechnologies/theywrk/`.

## 0. Shell context that applies to every route here

- **Rail hub**: `home` entry in `src/components/layout/os/apps-catalog.tsx:1172-1177`. Label is "Work", icon Home, `defaultHref: "/today"`, `matchPaths: ["/today","/inbox","/tasks","/spaces","/activity","/favorites","/files","/okrs","/goals"]`. Always pinned. Sidebar = `HomeSidebar`. Its "+" is the global CreateMenu (`createActions: "global"`).
- **Secondary sidebar (HomeSidebar)** `apps-catalog.tsx:489-938`, top to bottom:
  1. `Me` -> `/people/me` (`:884`)
  2. `Inbox` -> `/inbox` (`:885`)
  3. `Assigned Comments` -> `/assigned-comments` (`:886`)
  4. `My Wrk` -> `/tasks` with a hover-only expand chevron (`MyTasksGroup`, `:304-373`) revealing `Assigned to me` (`/tasks/assigned-to-me`), `Today & Overdue` (`/tasks/today-overdue`), `Personal List` (`/tasks/personal-list`)
  5. `Everything` -> `/everything` (`:888`)
  6. `Goals` -> `/okrs` (`:889`)
  7. `More` popover (`MoreNavItem`, `:259-302`): `Drafts & Sent` (disabled, "Coming soon"), `All Spaces` (`/spaces`), `All Tasks` (`/tasks`, i.e. the same page as My Wrk), separator, `Customize` (opens CustomizePanel). The three list rows carry a decorative Pin icon that does nothing (rail pinning was removed 2026-08-22).
  8. `Favorites` collapsible section (starred spaces/boards/docs/folders/tables/canvases/files, hydrated from 7 parallel `/api/me/favorites/*` calls, `:595-645`; sub-headers only when >6 items, `:677`)
  9. `Spaces` section with `+` New Space, drag-reorder, search-filter via the sidebar header search, and a trailing `New Space` row.
  Section order comes from `/api/preferences` `sidebar.sectionsOrder` (`:573-591`), so the Customize panel's "Sections" tab is honoured. The Customize panel's **"Home" tab toggles (`home.cards`: Inbox, Assigned Comments, My Wrk, Drafts & Sent, All Spaces, All Tasks) are saved (`customize-panel.tsx:612-631`) but never read by HomeSidebar** (no `.cards` reference in `apps-catalog.tsx` or `click-sidebar.tsx`) -> cosmetic setting.
- **Sidebar fallback for unmatched routes**: `click-sidebar.tsx:89` uses `getApp(activeAppKey) ?? findAppForPath(pathname) ?? APPS[0]`. `/assigned-comments`, `/everything`, `/item/*`, `/me/*` are in NO hub's `matchPaths`, so they keep whatever sidebar was last active (stale sidebar on deep-link; if you arrive from Docs you keep the Docs sidebar).
- **Top bar (ClickTopbar)** `src/components/layout/os/click-topbar.tsx:57-200`, identical on every route, pages cannot add to it: workspace switcher (initials + org name + chevron) -> WorkspaceMenu; CalendarPeek; centred search pill "Search tasks, docs, people, spaces… ⌘K" -> command palette; Ask AI pill (⌘J) -> Sidekick; right card: ActiveTimerPill, pinned personal tools (Quick task ⌘⇧K, My Work, Notepad, Reminder, Quick doc, Voice to text, Track Time, Create Canvas, View People, AI Notetaker; managed from ProfileMenu, `profile-tools.ts:31-43`), NotificationsBell, RemindersBell, Inbox icon link, avatar+presence dot -> ProfileMenu. Below it `TopPinsStrip` (top-pinned favorites chips from `/api/me/pins`).
- **Page-level header**: there is no shared page header. Routes here use three different patterns: (a) `OsTitleBar` (`src/components/layout/os/title-bar.tsx`) with a permanently-filled amber star and an "Ask AI / Share / Invite" trio that have **no onClick at all** (`title-bar.tsx:89-111`) plus fake `PEOPLE` avatar stacks from `catalog.ts:79-88` (BB/SC/MK hard-coded initials); (b) a 40px white `header` with a 13-14px bold title (My Wrk, Assigned Comments, Assigned to me, Today & Overdue); (c) a board-page breadcrumb row (`Everything`, `Personal List`).
- **Loader**: route transitions use `src/app/(dashboard)/loading.tsx` (`ValueLoader size 40`, a company value). In-page loaders are mixed: `ValueLoader` (favorites, activity, mentions, backlog, board, /tasks/[id], drawer), `Loader2` spinner + "Loading…" text (item/[id], today-overdue, trash, create-task list picker), plain text "Loading inbox…" (inbox) / "Loading…" (My Wrk cards).
- **Back navigation**: `src/components/ui/back-button.tsx` (`BackButton{fallbackHref}`) is the documented convention but **no route in this subsystem uses it**. `/item/[id]` hand-rolls the same logic (`item/[id]/page.tsx:86-91`); `/tasks/[id]` hard-pushes to `/tasks` (`tasks/[id]/page.tsx:257`); every list-level route has no back affordance at all (relies on sidebar).
- **Two task models**: the codebase has a legacy `Task` model (`prisma/schema.prisma:1209`, API `/api/tasks`, `TaskComment`, labels, custom-fields TASK) and the ClickUp-parity `Item` model (`schema.prisma:4422`, boards/lists, `/api/items/[id]`, `/api/boards/[id]/items`, `ItemUpdate`). The Work hub straddles both: Items power Personal List, Everything, `/item/[id]`, CreateTaskModal, the My Wrk "Assigned to me" card (`/api/me/items`), the topbar My Work panel (`/api/me/work`), reminders; legacy Tasks power `/tasks/assigned-to-me`, `/tasks/today-overdue` (My Work panel), `/tasks/[id]`, `/tasks/{backlog,board,calendar,gantt,sprint}`, the Planner hub, and the Activity feed's Task chip. **A task created from the topbar Quick task never appears in the sidebar's "Assigned to me" page, and a task created inline on "Assigned to me" never appears in the My Wrk card, Everything, or Personal List.**
- **Mobile**: none. The shell is fixed three-column (`os-shell.tsx:102-114`: 60px rail `click-app-rail.tsx:108`, resizable sidebar, main). No `md:`/`lg:` breakpoints in os-shell, rail, sidebar, or topbar; no `matchMedia`. In-scope pages hard-code `min-w-[860px]` (TaskListSurface list/board/doc modes), `w-[1000px]` drawer, `grid-cols-2` (Today & Overdue). The react-grid-layout on `/tasks` has sm/xs/xxs breakpoints but sits inside a desktop-only shell. `os.css` has a handful of `@media (max-width: 920px)` rules only for the orphan legacy pages (`.bklg__stats`, `.tcal__stats`).

---

## 1. Route inventory

### 1.1 `/today`
- File: `src/app/(dashboard)/today/page.tsx` (41 lines, server).
- Purpose: the "Work" hub's default landing. It is a pure redirect: finds the viewer's earliest readable Space and `redirect('/spaces/<slug>')`, else `/spaces` (`:33-40`). There is no Home/Today page any more (removed 2026-06-05 for ClickUp parity, header comment `:1-5`).
- Reachable from: rail "Work" icon (`defaultHref`), app-host root `/` (`src/proxy.ts:176-179`), `/dashboard` redirect, `next.config` `/dashboards` redirect, error/not-found "Home" links, command palette "Today G T" (`command-palette.tsx:131`), "Open My Priorities" command (`:144`, also points at /today), the `/item/[id]` error state "Go to Today", `/me/weekly-review` breadcrumb.
- Back button: n/a. Top bar: shell. Sidebar: HomeSidebar (the Space page it lands on is out of this subsystem's scope).
- Options: none.
- UI state: **stub by design (redirect)**. Issues:
  - Naming mismatch: rail says "Work", URL says `/today`, command palette says "Today", the sidebar page it ends up on is a Space Overview. "Open My Priorities" in the palette goes here although the Priorities concept lives (empty) on `/tasks`.
  - New org with zero Spaces lands on `/spaces` (list page), so the first thing a fresh user sees is a Spaces list, not a personal work view.

### 1.2 `/inbox`
- File: `src/app/(dashboard)/inbox/page.tsx` (725 lines, client).
- Purpose: ClickUp-style notifications inbox. Tabs Primary / Other / Later / Cleared; Filter pill; Settings gear opening a "Customize Inbox" right panel; Clear all.
- Reachable from: HomeSidebar `Inbox`; topbar Inbox icon (`click-topbar.tsx:168-175`); NotificationsBell popover "Open Inbox →" (`notifications-popover.tsx:245`); ProfileMenu "Notifications" (`profile-menu.tsx:203`); command palette "Inbox G I" and "Go to Inbox"; `g i` keyboard chord (`use-goto-nav.ts:18`); toast on new notification (`notifications-popover.tsx:312`).
- Back button: none. Top bar: shell only (page has no header; `h1` is `sr-only`, `:212`). Sidebar: HomeSidebar.
- Controls:
  - Tabs `:213-218`: Primary (with "N unread" subline), Other (subline), Later, Cleared.
  - Filter pill `:223-236` -> menu Mentions / Assigned to me / Unread / Reminders with "⇧1..⇧4" shortcut hints (`:350-355`); "Clear filter" link.
  - Settings gear `:255-263` -> `InboxSettingsPanel` (`:386-435`): switches "Show All tab", "Group by date", "Sort by newest first"; "Display mode" cards Fullscreen / Inline.
  - Clear all `:264-272` (disabled when everything read).
  - Row hover actions (`:646-675`): Mark read, Snooze until tomorrow 9:00, dark "Clear" pill. Row click follows `n.link` and marks read.
  - Empty states: Inbox Zero (Primary/Other) with a "Tip: Pin your Favorites bar…" card (`:560-603`); "Nothing snoozed"; "No cleared notifications".
- UI state: **rough** (looks finished, several controls are cosmetic or wrong).
- Issues:
  1. **Settings never persist.** `savePref` PATCHes `{ inbox: … }` to `/api/preferences` (`:113-123`) but the zod `patchSchema` has no top-level `inbox` key (`src/app/api/preferences/route.ts:35-91`), so the key is stripped and `data.effective.inbox` (`:104`) is always undefined. Every reload resets to defaults. All four settings are cosmetic.
  2. **"Show All tab" does not add a tab**; it makes the Other tab include Primary items (`:134`). Label lies.
  3. **Bucket routing is mis-keyed against real notification types.** `TYPE_VISUAL` (`:36-47`) knows `task_due`, `kudos`, `survey`, `sop_published`, `approval`, `chat_message`, `candor_session`, but the app actually creates `task_due_today`, `task_comment`, `okr_assigned`, `kra_assigned`, `action_item`, `automation`, `announcement`, `meeting_invite`, `asset_assigned`, `tool_shared`, `policy_published`, `review_cycle_opened`, `kpi_score_due`, `idea_update`, `reminder` (grep of `notification.create` across `src/lib` + `src/app/api`). Everything unknown falls to Other with a generic bell icon and a snake_case label. Only `mention`, `task_assigned`, `boundary_request`, `approval` reach Primary.
  4. Filter "Reminders" matches `type === "reminder"` with an inline "assuming type reminder" comment (`:142`); "Assigned to me" only matches `task_assigned` (misses `task_comment`, `task_due_today`); "Unread" is a no-op on Primary/Other (they are already unread-only).
  5. Filter shortcut hints "⇧1–⇧4" are display-only; no keydown handler exists in the file.
  6. **Load failures are swallowed** (`:94-96` sets `[]`), so an API error renders "Inbox Zero. Congratulations!".
  7. Group-by-date puts everything older than yesterday under a bucket labelled "Last 7 days" (`:292-303`), including month-old rows.
  8. `/api/notifications` GET returns `take: 50` with no cursor (`route.ts:30`); the page has no pagination or "load more", so Cleared silently truncates.
  9. Display mode "Inline" vs "Fullscreen" differ only in title max-width and the presence of a small type icon (`:679-704`); both render the same list. A settings panel for this is noise.
  10. Inbox Zero tip text ("Pin your Favorites bar to the top of your screen") is ClickUp copy; the equivalent feature here is TopPinsStrip, not discoverable from the tip.
  11. Loading state is plain grey text (`:277`), not the ValueLoader convention.
  12. Inbox row "Clear" and "Mark read" call the same `onMarkRead` (`:652`, `:668`); two controls, one behaviour.
  13. Row `Circle` lead icon (`:634-636`) is decorative; not a checkbox, no multi-select.
  14. `/settings/notifications` inbox toggles (`notify-prefs.ts`) gate only 6 keys (`task_assigned, mentions, comments, status_changes, due_reminders, kudos`); the many other types listed in (3) cannot be muted.

### 1.3 `/tasks` ("My Wrk")
- File: `src/app/(dashboard)/tasks/page.tsx` (944 lines, client).
- Purpose: ClickUp "Home" clone: greeting + draggable/resizable card grid (react-grid-layout). Cards: Recents, Agenda, My Work, Assigned to me, Assigned comments, AI StandUp, OKRs / Goals, KRAs & KPIs, Personal List, Reminders, Priorities.
- Reachable from: HomeSidebar `My Wrk`; More popover `All Tasks`; command palette "My tasks G K" / "Open My Work"; `g t` chord; `/tasks/[id]` back button; analytics tile; Activity feed Task chip (`/tasks?id=…`, which this page ignores).
- Back button: none. Top bar: shell. Sidebar: HomeSidebar (My Wrk row highlighted, group auto-expanded `:306-310`).
- Page header (`:277-308`): title "My Wrk" (13px), black "Manage cards" button -> right-side "Add Cards" panel with per-card switches (persisted to `home.taskCardsHidden`, `:202-208`), Settings gear -> popover with "Page greeting" switch (`:845-866`).
- Layout persistence: `home.taskCardLayoutV3` via debounced PATCH (`:241-256`); works.
- Per-card controls and their state:
  - Every card: hover-revealed `CardEyebrow` = Expand (Maximize2) + More (MoreHorizontal) buttons **with no onClick** (`:800-811`). Drag handle works.
  - Recents (`:357-384`): fetches `/api/spaces` and lists the first 8 Spaces labelled "in Spaces" (`:138-152`). **Not recents.** Icon logic for doc/item rows can never trigger.
  - Agenda (`:386-424`): Prev/Next day, "Today", calendar buttons **dead** (`:393-408`); Google Calendar / Microsoft Outlook "Connect" buttons `disabled title="Coming soon"` (`:934-941`). Stub.
  - My Work (`:717-752`): To Do / Done / Delegated tabs switch state but the body is always the same empty state; "Add task or reminder" button **dead** (`:742-749`). Stub. (A real version of this card exists on `/tasks/today-overdue`.)
  - Assigned to me (`:448-509`): real data from `/api/me/items?status=open` (Items). "Due date" button and "+" button **dead** (`:454-469`). Rows link to `/boards/<slug>?item=<id>`, or `href="#"` when the item has no board (`:486`). Caps at 8 with no "view all".
  - Assigned comments (`:547-559`): static empty state; "Learn more" links to `/assigned-comments` (itself a stub).
  - AI StandUp (`:561-592`): **fake static text** ("There is no recorded activity for {firstName} in the last 7 days"), no fetch; the "Refresh" button uses a Filter icon and is **dead** (`:569`).
  - OKRs / Goals (`:617-666`): real (`/api/okrs/my-okrs`), links to `/okrs/<id>`, expand link to `/okrs`. Polished.
  - KRAs & KPIs (`:668-715`): real (`/api/users/<id>/kpis`), expand link to `/team/alignment` (manager-gated page; ICs get redirected to /today).
  - Personal List (`:426-446`): static empty state, "Create a task" **dead** (`:436-443`); does not link to `/tasks/personal-list` and does not show its items.
  - Reminders (`:511-545`): static; dismissible note mentions "legacy Reminders" and "Inbox"; "Add reminder" **dead** (`:535-542`). Real reminders live in the topbar bell/popover.
  - Priorities (`:594-615`): static, "Create a task" **dead** (`:605-612`). "Open My Priorities" palette command goes to `/today`, not here.
- "Page greeting" toggle: local `useState` only (`:135`), not persisted.
- Styling: page bg `#FAFAFA`, cards white with shadow (`:772`), `dash-card-handle` class has no CSS rule (`os.css` / `globals.css` grep). `mytasks-grid` CSS exists in both `globals.css` and `os.css` (duplicate).
- UI state: **rough** (7 of 11 cards are stubs; 15+ dead buttons).
- Issues beyond the above: the card catalog says "My Wrk" for the My Work card (`:829`) while the card header says "My Work" and the page title is also "My Wrk"; "Manage cards" panel title is "Add Cards"; no empty/error state for a failed `/api/preferences` (silently default).

### 1.4 `/tasks/assigned-to-me`
- Files: `src/app/(dashboard)/tasks/assigned-to-me/page.tsx` (5 lines) -> `AssignedToMeReferencePage` in `tasks/_components/task-reference-pages.tsx:11-22` -> `TaskListSurface` (`tasks/_components/task-list-surface.tsx`, 5,869 lines).
- Purpose: a full ClickUp List/Board/Calendar/Gantt/Doc/Form surface over the viewer's **legacy `Task` rows** (`/api/tasks`, `task-list-surface.tsx:513`, which defaults to `assigneeId = currentUser`, `src/app/api/tasks/route.ts:78`). Opened with group=dueDate, sort=dueDate, columns priority+dueDate.
- Reachable from: HomeSidebar My Wrk ▸ Assigned to me. Nothing else links here.
- Back button: none. Header (`task-reference-pages.tsx:81-96`): "My Wrk / Assigned to me". Top bar: shell. Sidebar: HomeSidebar.
- Controls (all inside `TaskListSurface`):
  - View tab strip (`:903-935`): Board, List tabs + "+ View" -> `ViewCreatePanel` with search, "Popular" catalog of 16 view kinds (List, Gantt, Calendar, Doc, Board, Form, Create with AI, Dashboard, Table, Canvas, Timeline, Activity, Workload, Mind Map, Team, Map), Private/Pin switches. **Created views live in component state only** (`createView`, `:808-822`); they vanish on navigation. Private/Pin flags are never sent anywhere.
  - Toolbar (`:937-1047`): Group (none/name/status/assignee/priority/tags/dueDate/taskType, asc/desc, "Also group by List" which actually sorts by task type because Tasks have no list, comment `:638-640`), Subtasks collapse toggle, Filter (rule builder: field/operator/value, AND/OR, sort by, saved filters stored in **localStorage** `loadSavedFilters` `:4661-4671`), Show/Hide closed, Search, Customize view (right panel).
  - Customize panel (`:4431-4489`): toggles "Show empty statuses", "Wrap text", "Show task locations", "Show subtask parent names" -> stored in `viewOptions` state which **nothing reads** (grep shows `options.*` only inside the panel). "More options" row is a dead `SettingRow`. Fields / Filter / Group / Subtasks actions work; "Favorite" toggles an in-memory pin; "Export view" downloads a real CSV.
  - Fields panel: toggle columns; "Create" custom field POSTs `/api/custom-fields` targetType TASK (`:771-780`), falls back to a view-only column with an admin warning on 403.
  - List mode: inline create row ("Task Name or type '/' for commands" placeholder `:1721`; **no slash-command implementation exists**), status/type/assignee/date/priority/tags menus, multi-select bulk bar, group collapse, subtasks.
  - AssigneeMenu (`:2372-2452`): People list (from `/api/v1/people`) + an "Agents" section with a **disabled fake agent "Project Kickoff Scope Manager" and a disabled "Create Agent"** (`:2429-2447`). Stub.
  - DateMenu footer card "Set up your work schedule" with an X icon (`:2536-2543`): decorative, no link, no close.
  - Board mode: drag between To do / In progress / Complete, quick add, card actions. Calendar mode and Gantt mode: read-only renders. Doc mode: a textarea "Add notes, decisions, or context…" **kept in `useState` only** (`:3112`, never saved). Form mode: real create. Dashboard/Table/Canvas/Activity/Workload/Mind Map/Team/Map -> `PlaceholderMode` "isn't available for this space yet" (`:3352-3378`).
  - Row click -> `TaskDetailModal` (`:3380+`): a **third task-detail implementation** (besides BoardItemDetail and `/tasks/[id]`). Header "My Wrk / {name}" with "Ask" and "Share" buttons that have **no onClick** (`:3436-3437`); Ask Brain banner (static); status/assignee/date/priority/tags pickers (work); description; rail with Activity (comments via `/api/tasks/<id>/comments` + a hard-coded "You created this task" line `:3806`), Related items and Add links (both persisted as JSON strings into TASK custom-field values `relatedItems` / `taskLinks`, `:3868-3879`, `:4146-4159`), Fields, Checklist. AddLinksPanel's "Or relate items" rows (Task or Doc / Dependencies / Custom) are `LinkPanelItem` buttons **with no onClick** (`:4210-4225`); the row of coloured dots "and more ›" is decorative.
- Loading/empty/error: list shows red inline error bar (`:1430-1433`); loading via skeleton text; grouped dueDate empties hidden.
- UI state: **rough**. Very large, mostly-working, but on the wrong model, with unpersisted views/options and several stub menus. Every task created here is invisible to Items-based surfaces (My Wrk card, Everything, Personal List, `/item/[id]`, reminders).

### 1.5 `/tasks/today-overdue`
- Files: `tasks/today-overdue/page.tsx` (5 lines) -> `TodayOverdueReferencePage` (`task-reference-pages.tsx:24-48`).
- Purpose: 2-column: "My Work" panel (To Do / Done / Delegated tabs, Today / Overdue / Next / Unscheduled buckets, inline add, complete toggle) + "Agenda" card.
- Reachable from: HomeSidebar My Wrk ▸ Today & Overdue only.
- Back button: none. Header: "Today & Overdue" (no "My Wrk /" prefix unlike its siblings). Top bar: shell. Sidebar: HomeSidebar.
- Controls: My Work Settings icon button **dead** (`:275`, `IconButton` has no onClick `:103-116`); Agenda "Connect" buttons for Google Calendar / Microsoft Outlook **dead** (`:118-126`, no onClick, not even disabled). Tabs, buckets, add, toggle-done all work against **legacy `/api/tasks`** (`:207`, `:222`, `:234`, `:249`). "Delegated" tab uses `?view=delegated`.
- Data model conflict: this "My Work" shows legacy Tasks; the topbar "My Work" tool (`my-work-panel.tsx` -> `/api/me/work`, Items) shows different rows with the same name and the same bucket labels.
- Loading: Loader2 spinner text. Error: none (silently `[]`). Empty: "Tasks and reminders assigned to you will show here." (reminders are not included).
- No responsive handling (`grid-cols-2` fixed, `:27`).
- UI state: **rough** (left half works on the wrong model; right half is a stub).

### 1.6 `/tasks/personal-list`
- File: `src/app/(dashboard)/tasks/personal-list/page.tsx` (89 lines, server).
- Purpose: a real per-user PRIVATE Board (`getOrCreatePersonalBoard`, productSlug `personal-list`) rendered through `BoardViewTabs` + `BoardCanvas` + `BoardAddTaskButton`, same as any List. Views self-heal to List/Board/Calendar/Gantt (`ensureCoreListViews`).
- Reachable from: HomeSidebar My Wrk ▸ Personal List. The My Wrk "Personal List" card does not link here.
- Back button: none. Header: breadcrumb "My Wrk / 🔒 Personal List" (`:46-53`). Top bar: shell. Sidebar: HomeSidebar.
- Controls: whatever the board surface offers (view tabs, + View, filters, Add Task which opens CreateTaskModal preselected to this board, row drawer BoardItemDrawer). All persisted (Views in DB, items via `/api/boards/<id>/items`).
- UI state: **polished** (it is the shared board surface). Issues: `PersonalListReferencePage` in `task-reference-pages.tsx:50-66` is dead code (a cosmetic View/Automate/Ask header over the legacy surface) and confuses which implementation is live; the breadcrumb style differs from the sibling pages' 40px header; no explicit empty state copy specific to a personal list (falls to "No items yet.").

### 1.7 `/tasks/[id]` (legacy Task detail)
- File: `src/app/(dashboard)/tasks/[id]/page.tsx` (496 lines, client).
- Purpose: full-page detail for a legacy `Task`: hero (status accent strip, inline title, description), Updates feed (comments) with composer, Properties sidebar (status/priority pickers, owner, due date, labels, completed), Quick actions.
- Reachable from: block-editor task block "Open" (`src/components/docs/block-editor.tsx:3528`) only. Otherwise URL-only.
- Back button: yes, "← My tasks" inside `OsTitleBar` actions, hard `router.push('/tasks')` (`:257`) regardless of where you came from (violates BackButton convention). Not-found state: `OsEmptyView cta="Back to My tasks"` **without `onCta`** (`:233-239`) -> dead CTA.
- Top bar: shell + `OsTitleBar` with dead Ask AI / Share (page's own Copy link works) and a "More" button **with no onClick** (`:263`).
- Controls: title/description autosave; status + priority via `OsPickerPopover` (work); Owner read-only; Due date read-only; composer icons Attach / Emoji / Mention **dead** (`:363-365`); Send update works; Quick actions Mark complete / Copy share link work.
- Data: loads by fetching a 2-year window of `/api/tasks` and `.find()`-ing the id (`:125-131`), so any task outside ±365 days shows "not found".
- Styling: BEM `tdt__*` classes in `os.css` using `--os-c-*` hue tokens and `GRAD.bluePurple` (legacy hue-keyed style the user rejected 2026-06-02). Priority labels here are Critical/High/Medium/Low while everywhere else they are Urgent/High/Normal/Low.
- UI state: **rough** and a duplicate of `/item/[id]` for the other model.

### 1.8 `/tasks/backlog`, `/tasks/board`, `/tasks/calendar`, `/tasks/gantt`, `/tasks/sprint` (orphan legacy views)
- Files: `tasks/backlog/page.tsx` (376), `tasks/board/page.tsx` (312), `tasks/calendar/page.tsx` (306), `tasks/gantt/page.tsx` (314), `tasks/sprint/page.tsx` (386). All client, all on `/api/tasks` (legacy model), all `OsTitleBar` with fake `PEOPLE` avatars and `GRAD.*` icons, all BEM `bklg__ / spbd__ / tcal__ / gantt__ / sprint__` CSS in `os.css`.
- Reachable from: **nothing in the UI**. The only reference is `src/lib/products/catalog.ts:66` (`landingHref: "/tasks/board"` for the "tasks" product). Not in any sidebar, palette, or link. URL-only.
- Back: none. Sidebar: HomeSidebar (matched by `/tasks` prefix).
- What works: backlog sort/bulk promote/archive(=mark completed)/inline add/estimate edits; board drag-between-columns + workload strip; calendar month grid + day drawer + drag reschedule; gantt group by status/assignee; sprint burndown/at-risk/capacity with "mark done".
- Dead: sprint "End sprint" / "Start next" (`sprint/page.tsx:170-175`, no onClick); backlog/board error CTAs "Retry" and board empty CTA "Plan a task" have no `onCta` (`backlog:230`, `board:179`, `board:225`); sprint window is hard-coded "today-6d, 14 days" (`sprint:41-44`), not a real Sprint entity (CreateSprintModal exists elsewhere for Items).
- UI state: **rough / orphan**. Candidates for deletion or migration to the Item board views (BoardCanvas already supports TABLE/KANBAN/CALENDAR/GANTT/TIMELINE/WORKLOAD… `board-canvas.tsx:375-529`).

### 1.9 `/assigned-comments`
- File: `src/app/(dashboard)/assigned-comments/page.tsx` (199 lines, client).
- Purpose: ClickUp "Assigned Comments" (Assigned to me / Delegated by me).
- Reachable from: HomeSidebar `Assigned Comments`; My Wrk card "Learn more".
- Back button: none. Header: "Assigned Comments" 13px. Top bar: shell. Sidebar: **stale** (route not in any hub's matchPaths; keeps the last active app sidebar).
- Controls: tab pills Assigned to me / Delegated by me (state only), "Filter" pill **dead** (`:63-69`, no onClick), "Resolved" toggle (state only), date-range dropdown Today/7/30/90/All time (state only), Search (state only), "Clear filters".
- Body: always "No results found" (`:112-124`). Header comment `:8-9`: "Comment-assignment schema does not exist yet — both tabs render the empty state."
- UI state: **stub** presented as a finished page (no "coming soon" label). Every control is cosmetic. No loading/error state because there is no data.

### 1.10 `/everything`
- Files: `src/app/(dashboard)/everything/page.tsx` (server), `everything/everything-view.tsx` (client).
- Purpose: ClickUp "Everything": one read-only List (grouped by status) of the newest 500 Items across every board the viewer can read (`src/lib/everything.ts`, per-board `getBoardForReader`). Row click -> `/item/<id>`; per-row List chip -> `/boards/<slug>`.
- Reachable from: HomeSidebar `Everything`; `/item/[id]` back/fallback.
- Back: none. Header (`page.tsx:26-34`): "Everything · N items" (board-page style, no OsTitleBar). Top bar: shell. Sidebar: **stale** (not in any matchPaths, so the Work hub does not even highlight).
- Controls: only those `BoardTableView` exposes when `canEdit=false` (group collapse, search/sort inside the table; no add, no inline edit). `viewId=null` so nothing persists. Statuses are the default trio; per-List custom statuses render as grey orphan buckets (comment `everything-view.tsx:25-27`).
- Loading: route `loading.tsx`. Empty: table's "No items yet." (`board-table-view.tsx:1481`). Error: dashboard error boundary.
- Issues: hard cap 500 with "500+" label and no pagination/filter by space/assignee/date; cannot filter to "mine" (that is what `/tasks/assigned-to-me` should be but on the other model); "Everything" and "All Tasks" (More popover -> `/tasks`) are two different things with near-identical names.
- UI state: **polished** within its narrow scope.

### 1.11 `/favorites`
- File: `src/app/(dashboard)/favorites/page.tsx` (197 lines, client).
- Purpose: **pinboard of pinned Sidekick chats** (`/api/sidekick/sessions`, PATCH `pinned`), plus 25 "Recent chats". Nothing to do with the sidebar "Favorites" (starred spaces/boards/docs/…) or TopPinsStrip.
- Reachable from: **nothing**. `/favorites` is in the home hub's matchPaths but no sidebar row, palette entry, or link points at it. URL-only.
- Back: none. Header: `OsTitleBar` "Favorites" with fake `PEOPLE.bb` avatar, dead Ask AI/Share/Invite. Sidebar: HomeSidebar.
- Controls: Pin/Unpin (work), card -> `/sidekick?session=<id>`. Empty state copy: "Pin a Sidekick chat or star a board item… Cross-module starring is shipping soon." (starring shipped months ago).
- Styling: BEM `fav__*` / `fav-card*` in `os.css`, gradient icons.
- UI state: **rough / orphan / misnamed**. Should either become the real Favorites page (mirror of the sidebar section, all 7 kinds) or be deleted/moved under AI.

### 1.12 `/activity`
- File: `src/app/(dashboard)/activity/page.tsx` (246 lines, client).
- Purpose: org activity feed (`/api/activity?scope=my|team|all&limit=200`), day-grouped, scope pills Just me / My team / Whole org, "Live" dot.
- Reachable from: `dashboard/dashboard-content.tsx:483` only (the `/dashboard` route itself redirects to `/today`, so effectively **URL-only**). In home matchPaths, so the Work hub highlights.
- Back: none. Header: `OsTitleBar` with fake avatars (BB/MK/SC "+8") and dead trio. Sidebar: HomeSidebar.
- Controls: scope pills (work; API downgrades non-managers to "my", `api/activity/route.ts:24`, without telling the UI, so an IC sees "My team" selected but gets only their own rows); "Live" indicator is decorative (no SSE; `rowVersion("activity")` is never bumped anywhere: grep of `bumpRowVersion("activity")` returns nothing). Target chips: Task -> `/tasks?id=<id>` which `/tasks` ignores (**broken link**); Board / File / Person / KRA / KPI / SOP chips have no href; actual `targetType` values written by the app are lowercase (`task`, `okr`, `sop`, `user`, `organization`…, grep in `src/lib` + `src/app/api`) while `TARGET_VISUAL` keys are PascalCase (`Task`, `Doc`, `DataTable`…), so **most chips never render**. Empty-state CTA "Explore modules" has no `onCta`; error CTA "Retry" works.
- Styling: `actfeed__*` BEM, `C.*` hue colours per verb, gradient icon.
- UI state: **rough / orphan**.

### 1.13 `/item/[id]` (Item task detail, full page)
- File: `src/app/(dashboard)/item/[id]/page.tsx` (143 lines, client) hosting `BoardItemDetail` (`layout="page"`).
- Purpose: shareable full page for a board Item. Loads `/api/items/<id>` (returns item, board ctx, `canEdit`).
- Reachable from: Everything rows; BoardItemDrawer "Full page"; row "…" menu New tab / Copy link (`item-row-more-menu.tsx:84-91`); RemindersBell / ReminderTicker links; canvas links; team workload; subtasks navigate here.
- Back button: yes, custom "← Back" (`:84-95`): `router.back()` if history, else `/boards/<slug>` or `/everything`. Same logic as `BackButton` but not the component. Board name link next to it. Archive (confirm dialog) on the right when `canEdit`; **on success with no board it pushes to `/home`, which does not exist** (`:75`) -> dashboard 404.
- Top bar: shell. Sidebar: **stale** (route in no hub). 
- Body: `BoardItemDetail` (see §2.1) with statuses from the board, `onAskAi` -> Sidekick. Loading: `Loader2` "Loading…" (`:108`), not ValueLoader. Error: good not-found block with "Go back" + "Go to Today".
- UI state: **polished** body, rough chrome (sticky header is its own style; no breadcrumb "Space / List / Task"; no Copy link / Share / watch controls; no keyboard prev/next).

### 1.14 `/me/mentions`
- File: `src/app/(dashboard)/me/mentions/page.tsx` (107 lines, client).
- Purpose: list of @-mentions of the viewer inside Notes and SOPs (`/api/me/mentions`), rows deep-link to `#b-<blockId>`.
- Reachable from: **nothing** (URL-only). Not in any matchPaths (stale sidebar).
- Back: none. Header: `OsTitleBar` (dead trio). Controls: none. Error CTA "Retry" and empty CTA "Open notes" both lack `onCta` (`:69`, `:79`).
- Overlaps with Inbox "mention" notifications (task mentions go to Inbox, doc/SOP mentions come here).
- UI state: **rough / orphan**.

### 1.15 `/me/weekly-review`
- File: `src/app/(dashboard)/me/weekly-review/page.tsx` (78 lines, server) + `components/me/weekly-review-form.tsx`.
- Purpose: weekly heartbeat: KRA sliders, KPI snapshots, highlights/blockers/plan, Save draft / Submit / Reopen.
- Reachable from: profile page button (`people/[id]/profile-client.tsx:1369`); `components/today/my-alignment.tsx` links here but that component is **imported nowhere** (dead code since /today became a redirect).
- Back: breadcrumb "Today › Weekly review" (`:61-65`) linking to `/today` (which redirects to a Space). Header: own 2xl h1 (different scale from every other page here). Sidebar: stale.
- UI state: **polished form, orphaned entry**.

### 1.16 `/trash` (adjacent: where archived tasks go)
- File: `src/app/(dashboard)/trash/page.tsx`. Org recycle bin (SOPs, tables, files, policies, contracts, spaces, folders, lists, **tasks** `TYPE_META.item`), 60-day window, Restore / Delete forever.
- Reachable from: Settings hub sidebar (hr-admin only, `apps-catalog.tsx:1153`), Settings → Data page link. API gate is `isManager` (`api/trash/route.ts:14`) so managers can use the page by URL but have no nav to it; ICs get "Manager access required." A non-manager who archives a task from `/item/[id]` ("You can restore from Trash", `item/[id]/page.tsx:73`) **cannot restore it**.
- UI state: polished list; `Loader2` loader; OsTitleBar with `showStandardActions={false}`.

---

## 2. Shared components in scope

### 2.1 `BoardItemDetail` (`src/components/board-view/board-item-detail.tsx`, 798 lines)
The canonical Item task view (used by drawer and `/item/[id]`).
- Type pill (`ItemTypePicker`), 22px inline title, "Ask Brain" row (when host passes `onAskAi`).
- Two-column field grid: Status (solid pill + "next status ›" segment + ✓ complete), Assignees (multi), Dates (`DatePlanner` with Date / Reminder / Repeat tabs), Priority, Time estimate (parses "2h 30m"), Track time (play/stop + popover TimeTracker), Tags, Alignment (KPI-first KRA/KPI picker into `metadata.kraId/kpiId`).
- Created/Updated stamp, Description textarea (autosave on blur, plain text, no rich editor), Custom Fields (collapsible, search, hide-empty), Subtasks, Checklist, Linked attachments/relations, ClickUp-style action rows for collapsed sections, Comments+Activity thread (`ItemThread`) unless host hides it.
- Module gating props hide Priority/Tags/Time/Custom fields per Space.
- Issues: description is a plain `<textarea>` (no formatting, no @mention, no attachments inline) while the placeholder in CreateTaskModal says "write with AI"; Status dropdown closes on `onMouseLeave` (`:787`) which is flaky; the Alignment chip uses taupe hex (`#a78b8022` `:616`) while the rest of the grid is zinc/brand blue; no "Watchers/Followers" field although CreateTaskModal writes `metadata.followers`; no "List / location" field (you cannot move an item between lists here); no delete/archive inside the body (host chrome only); no keyboard shortcuts.

### 2.2 `BoardItemDrawer` (`src/components/board-view/board-item-drawer.tsx`, 368 lines)
Despite the name/comments ("right-slide-in… 480px"), it is a **centred 1000×88vh modal** (`:175-181`). Header: close, "Task" label, "Full page" link, Archive. Right rail (400px, collapsible) with Activity (`ItemThread`) and Related (`LinkedAttachments`) icon-strip tabs. ESC closes. Error strip at top. Loader: `ValueLoader`.
- Issues: doc comment is stale; no prev/next item, no "copy link", no breadcrumb to Space/List; the drawer's `hideActivity` means the thread is in the rail while `/item/[id]` renders it inline, so the two hosts feel different; archive copy says "Archive row" (`:145`) vs "Archive task" on the page.

### 2.3 `CreateTaskModal` (`src/components/layout/os/create-task-modal.tsx`, 1,456 lines)
Global modal (shell-mounted) opened by topbar Quick task (⌘⇧K), sidebar "+", command palette, Planner "+", BoardAddTaskButton (preselects list), Template Center, voice capture.
- Header: List picker (grouped by Space; derives from route / last used via localStorage `LAST_LIST_KEY`), Task Type chip (+ "Manage task types" link), minimize (same as close) and close.
- Body: 24px name input, description textarea with a decorative "AI" wand hint (no action), extras block (Time estimate h/m, Subtasks, Checklist, Dependencies placeholder text "add them from the task page once it exists" `:1025-1030`), staged attachments.
- Toolbar chips: Status (grouped Active/Done/Closed, per-Space set), Assignee (PeoplePicker), Due date (start/due tabs, quick picks, month grid), Priority, Tags (org Tag catalog, create inline), Alignment (KPI/KRA), "…" menu revealing extras.
- Footer: Templates (Use / Create instantly / Save as / Update existing, `/api/item-templates`), Attachment (Upload file; Dropbox/OneDrive/Box/Google Drive/New Google Doc = paste-a-share-link prompts, `:564-597`), Followers (Bell icon, stored in `metadata.followers`, no consumer), split Create button (Create / Create and open / Create and start another / Create and duplicate).
- Persistence: POST `/api/boards/<list>/items`; subtasks + attachments best-effort follow-ups; dispatches `workwrk:item-created`.
- Issues: **taupe accent** (`#a78b80`, `#9d7d70`, `#c39b8c`, `TAUPE.soft`) throughout while the rest of the shell is brand blue `#0073EA` (memory says taupe chips are intentional, but here it colours primary buttons and calendar selection); "Minimize" icon does the same as close; Followers have no effect anywhere; "Dependencies" extra is a text placeholder; `Enter` in the title submits even when no list is chosen (shows "Choose a list first"); no way to create a task without a List (Personal List is a valid target but must be found in the picker under "Other"); no keyboard hint for ⌘⇧K in the modal.

### 2.4 `TaskListSurface` + `TaskDetailModal` (`src/app/(dashboard)/tasks/_components/task-list-surface.tsx`)
See §1.4. Legacy-model duplicate of the board surface with its own detail modal, filters, fields, views. 5.9k lines that mirror `BoardCanvas` + `BoardItemDrawer` feature-for-feature on the wrong table.

### 2.5 `HomeSidebar` (`apps-catalog.tsx:489-938`)
See §0. Additional issues: the My Wrk expand chevron only appears on hover and is positioned over the icon (`:328-343`), so keyboard/touch users cannot discover the sub-items until they land on `/tasks`; "Me" label carries a `TODO(rename)` (`:439`); Favorites section is collapsed by default with no persistence of open state; Favorites empty copy "Star a Space or Board" although 7 kinds are starrable; "Goals" appears both in this sidebar and as its own folded app; Library/Forms/Clips sidebars show a hard-coded "Favorites – Star an item to see it here" EmptyState (`:1063-1065`) that never populates.

### 2.6 Dead code in scope
- `src/components/tasks/*` (task-dialog, notes-thread, label-picker, view-day, view-gantt, view-month, workload-heatmap, types): **no importers anywhere** (grep). 1,563 lines of legacy Task UI.
- `src/components/today/*` (my-alignment, kpi-score-modal, sop-ack-modal): no importers.
- `PersonalListReferencePage` (`task-reference-pages.tsx:50-66`).
- `OsItemDrawer` (`layout/os/item-drawer.tsx`) is mounted in the shell (`os-shell.tsx:116`) but only opened by the legacy demo `module-view` surfaces (kanban.tsx/main-table.tsx/calendar.tsx), and comments through `/api/tasks/<id>/comments`.

---

## 3. Broken / confusing (consolidated, with severity)

| # | Where | What | Severity |
|---|---|---|---|
| 1 | Whole hub | Two task models. Sidebar "Assigned to me" + "Today & Overdue" + `/tasks/[id]` + orphan views use legacy `Task`; Personal List, Everything, `/item/[id]`, CreateTaskModal, My Wrk "Assigned to me" card, topbar My Work, reminders use `Item`. Tasks created in one never appear in the other. | high |
| 2 | `/inbox` settings panel | All four inbox prefs PATCH a top-level `inbox` key that `/api/preferences` strips; never persisted, always default on reload. | high |
| 3 | `/inbox` bucket map | `TYPE_VISUAL` keys do not match the notification types the app creates; most real notifications land in "Other" with a bell icon and snake_case label. | high |
| 4 | `/assigned-comments` | Entire page is a stub (schema absent); Filter dead, Resolved/date/search cosmetic; presented as finished. | high |
| 5 | `/tasks` My Wrk | 7 of 11 cards are static stubs; ~15 buttons with no onClick (card Expand/More, Agenda nav, Create a task ×2, Add reminder, Add task or reminder, Due date, +, Refresh); AI StandUp shows fabricated text; Recents shows Spaces. | high |
| 6 | Customize panel → Home tab | `home.cards` toggles saved but never read by HomeSidebar. | medium |
| 7 | `OsTitleBar` | Ask AI / Share / Invite buttons have no handlers; star is always filled; fake `PEOPLE` avatars on Favorites/Activity/Backlog/Board/Sprint. | medium |
| 8 | `/activity` | Task chip links to `/tasks?id=` (ignored); targetType keys PascalCase vs lowercase written values so chips mostly never render; "Live" is decorative; "Explore modules" CTA dead; ICs see "My team" selected while API returns only "my". | medium |
| 9 | `/item/[id]` archive | Redirects to non-existent `/home` when the item has no board. | medium |
| 10 | `/item/[id]` + `/tasks/[id]` + TaskDetailModal + BoardItemDrawer | Four task-detail UIs with different layouts, labels (Critical/Medium vs Urgent/Normal), and chrome. | medium |
| 11 | Trash access | Page says "restore from Trash" to anyone who can archive, but Trash is manager-gated (API) and hr-admin-gated (nav). | medium |
| 12 | Stale sidebar | `/assigned-comments`, `/everything`, `/item/*`, `/me/*` are in no hub's matchPaths; sidebar keeps whatever app was last active. | medium |
| 13 | Orphan routes | `/favorites` (pinned Sidekick chats, misnamed), `/activity`, `/me/mentions`, `/tasks/{backlog,board,calendar,gantt,sprint}`, `/tasks/[id]` reachable only by URL. | medium |
| 14 | TaskListSurface | Created views, pin/private flags, Customize toggles (Wrap text etc.), Doc-view notes are in-memory only; saved filters in localStorage; AssigneeMenu "Agents" and AddLinks "relate items" rows are fake; "Ask"/"Share" in modal dead; "/ for commands" placeholder without slash commands. | medium |
| 15 | `/inbox` | Errors swallowed into "Inbox Zero"; "Show All tab" adds no tab; "Last 7 days" bucket holds everything older; no pagination past 50; ⇧1-4 hints unwired; Reminders/Unread filters ineffective. | medium |
| 16 | `/tasks/today-overdue` | Settings button dead; Agenda "Connect" buttons dead (not even disabled); "My Work" here ≠ topbar "My Work". | medium |
| 17 | `/tasks/[id]` | Loads by scanning a ±365-day list; "More" and composer Attach/Emoji/Mention dead; not-found CTA dead; hard back to `/tasks`. | medium |
| 18 | `/today` | Rail "Work" → `/today` → Space Overview; no personal landing; palette "Today"/"Open My Priorities" both go here. | medium |
| 19 | Back navigation | Zero uses of `BackButton{fallbackHref}` in the subsystem; detail pages hand-roll or hard-push. | low |
| 20 | Loaders | Mixed ValueLoader / Loader2 / plain text across sibling pages. | low |
| 21 | Naming | "My Wrk" (sidebar+page) vs "My Work" (card, topbar tool, today-overdue panel) vs "All Tasks" (More → same `/tasks`) vs "Everything"; "Manage cards" opens "Add Cards"; "Archive row" vs "Archive task". | low |
| 22 | HomeSidebar | My Wrk expand chevron is hover-only over the icon; Favorites empty copy names only 2 of 7 kinds; decorative Pin icons in More menu; "Drafts & Sent" coming-soon row. | low |
| 23 | Dead code | `components/tasks/*`, `components/today/*`, `PersonalListReferencePage`, `OsItemDrawer` path. | low |
| 24 | Styling drift | Legacy pages use `os.css` BEM + `--os-c-*` hue tokens + `GRAD` gradients; CreateTaskModal uses taupe; My Wrk uses `#FAFAFA` + `#0073EA` literals; ClickUp-parity pages use zinc Tailwind + `--os-brand-rail/ink`. | low |
| 25 | Mobile | No responsive layout anywhere in the hub; several surfaces `min-w-[860px]`. | low |

---

## 4. Cross-cutting

- **Back button convention**: documented as `BackButton{fallbackHref}` (`ui/back-button.tsx`), unused here. `/item/[id]` reimplements it inline (history-length check + fallback); `/tasks/[id]` hard-pushes `/tasks`; `/me/weekly-review` uses a breadcrumb to `/today`; list pages have none. Drawer/modal closes via X, ESC, backdrop.
- **Loader convention**: route-level `loading.tsx` = `ValueLoader(40)`. In-page: ValueLoader(32-34) on favorites/activity/mentions/backlog/board/tasks-[id]/drawer; `Loader2` + text on item/[id], today-overdue, trash, create-task list picker; plain text on inbox and My Wrk cards. Three visual vocabularies for "loading".
- **Empty / error states**: three systems. (a) `OsEmptyView` (gradient icon tile, chips, CTA) on legacy pages, with CTAs frequently missing `onCta`; (b) hand-rolled zinc-icon-in-rounded-square blocks (inbox, assigned-comments, item/[id]); (c) `BoardTableView`'s one-line "No items yet.". Errors: inbox swallows; today-overdue swallows; My Wrk swallows per card; item/[id] and drawer show proper states; activity/favorites/mentions show OsEmptyView with API status.
- **Style consistency**: the ClickUp-parity pages (inbox, assigned-comments, My Wrk, reference pages, item detail, drawer, Everything, Personal List) are zinc Tailwind, 13-14px type, `--os-brand-rail` / `--os-brand-ink` for accents, occasional `#0073EA` literal: broadly Monday-clean. The legacy pages (favorites, activity, tasks/[id], backlog/board/calendar/gantt/sprint, mentions) are `os.css` BEM with `--os-c-*` hue palettes, `GRAD.*` gradient icons (now ignored by OsTitleBar but still passed), fake avatar stacks: the pre-2026-06 hue-keyed style. CreateTaskModal uses the taupe chip palette for primary actions. `OsTitleBar` header (px-6, base font, star) vs the 40px 13px page header vs the breadcrumb header: three page-header heights on sibling routes.
- **Mobile**: not supported. Fixed rail + sidebar + main; no breakpoints in the shell; hub pages assume ≥ 1000px.
- **Access model observed**: page-level gates are server-side only where a server component exists (today, everything, personal-list, weekly-review). Client pages rely on API 401/403 (inbox, tasks, activity, favorites, mentions, trash). `/api/activity` silently downgrades scope for non-managers. `/api/items/[id]` returns `canEdit` via `canContributeBoard`; `/api/me/items` deliberately ignores board access ("being assigned grants access", `api/me/items/route.ts:6-10`) while `/everything` filters by readable boards, so an assigned task can be in My Wrk but not in Everything. Trash: API manager-gated, nav hr-admin-gated. Everything else is any signed-in member.

## 5. Settings notes

Configurable today: card layout + hidden cards on `/tasks` (persisted); sidebar section order (persisted, honoured); sidebar `home.cards` (persisted, ignored); inbox prefs (not persisted); `/settings/notifications` inbox/email toggles for 6 types (honoured server-side via `notify-prefs.ts`); Personal List views (persisted); TaskListSurface custom fields (persisted org-wide via `/api/custom-fields`), everything else in TaskListSurface (views, filters, options) not persisted; CreateTaskModal last-used list (localStorage).

Should be configurable but is not: default landing for the Work hub (currently forced to first Space); which My Wrk cards exist per role; inbox routing rules (which types are Primary); snooze duration (hard-coded tomorrow 09:00); Everything default grouping/filters and scope; Assigned-to-me view persistence; "Page greeting"; reminders defaults; per-type mute for the 15+ notification types not exposed on `/settings/notifications`; whether Trash is reachable by non-managers for their own archived tasks.
