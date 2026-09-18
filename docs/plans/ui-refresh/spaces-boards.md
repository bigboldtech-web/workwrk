# UI Audit: Spaces, Folders, Boards, Views

Subsystem audit for the WorkwrK redesign. Read-only inventory of every route, control, dialog and renderer in the Spaces / Folders / Boards / Views area, with concrete file:line citations. Audited 2026-09-10 against `main` (HEAD 6187227a).

Scope covered:

- Routes: `/spaces`, `/spaces/[slug]` (6 tabs), `/folders/[id]` (2 tabs), `/boards/[slug]` (17 view renderers), `/tasks/personal-list` (same board chassis), `/templates` (legacy page), plus the Template Center modal.
- Components: `src/components/board-view/*` (canvas, every view, filter bar, field shelf, field value, status editor, bulk bar, row menu, view tabs/menus), `src/components/layout/os/*` share dialogs, more-menus, tree row, members strip, create dialogs, `src/components/spaces/*` cards, `src/components/templates/template-center.tsx`.
- Shell context that determines reachability: `apps-catalog.tsx` HomeSidebar, `click-app-rail.tsx`, `click-sidebar.tsx`, `click-topbar.tsx`, `os-shell.tsx`.

---

## 0. How this area is reached (shell context)

**Rail hub:** the "Work" app (key `home`, `apps-catalog.tsx:1172`, defaultHref `/today`). `/today` server-redirects to the first Space the viewer can see, else `/spaces` (`today/page.tsx:36-44`). So the Work rail icon lands you on a Space page.

**Secondary sidebar when any Space/Folder/Board route is active** (HomeSidebar, `apps-catalog.tsx:881-899`):

1. `Me` (/people/me), `Inbox`, `Assigned Comments`, `My Wrk` group (expandable: Personal List etc.), `Everything`, `Goals`, `More…`
2. `Favorites` section (collapsible; sub-labels Spaces / Lists / Folders / Docs…), rendered only if the user has favorites
3. `Spaces` section header with `+` (New Space) and the Space tree: `SpaceTreeRow` per Space → folders (recursive) → boards / docs / whiteboards / tables (`space-tree-row.tsx:303-448`). Trailing "New Space" row.

Sidebar header: app title "Work", hover-revealed Search + Collapse buttons, and a "+" create button that opens the global CreateMenu (`click-sidebar.tsx:228-284`). Footer: "Customize Sidebar".

**Top bar (all routes in this area, `click-topbar.tsx`):** workspace switcher (initials + name + chevron), CalendarPeek, center search pill "Search tasks, docs, people, spaces… ⌘K" with Ask AI button, right card: ActiveTimerPill, pinned personal-tool icons, Notifications bell, Reminders bell, Inbox link, avatar with presence dot → ProfileMenu. None of the top bar changes per route (no breadcrumb / page title in the top bar; those live in the page body).

**Loader:** one shared `(dashboard)/loading.tsx` using `ValueLoader` (company value + dots) for every route transition (`loading.tsx:8-15`). There is no route-level `loading.tsx` under spaces/boards/folders. Because Space tabs, Space List filters, Space Calendar month nav and Board view tabs are all `<Link>`s that change `searchParams` on `force-dynamic` server pages, **every tab click / filter click re-runs the whole server page and shows the full-page ValueLoader**.

**Error / 404:** shared `(dashboard)/error.tsx` (Try again / All spaces / Home) and `not-found.tsx` ("We haven't built this yet", Back home / Browse spaces / GoBackButton). `notFound()` is used for missing Space/Folder/Board AND for access denial (`spaces/[slug]/page.tsx:209,226`, `boards/[slug]/page.tsx:50,68`, `folders/[id]/page.tsx:64,72`) so a forbidden entity reads as "We haven't built this yet", which is misleading.

**Back navigation:** there is **no `BackButton`** (`ui/back-button.tsx`) anywhere in scope (grep across spaces/boards/folders/board-view/templates returned nothing). Navigation up is by breadcrumb links only: Board → Space (link), Space → `/spaces` (text link), Folder → `/spaces` and Space (links). The house rule "BackButton{fallbackHref} on every detail route" is not followed here.

---

## 1. Route: `/spaces` (Spaces index)

- **File:** `src/app/(dashboard)/spaces/page.tsx` (server, `force-dynamic`)
- **Title/purpose:** "Spaces: Your team's grouping of Folders and Boards." Grid of Space cards (icon/lock, name, description, member/folder/board counts, hover star).
- **Reachable from:** breadcrumb "Spaces" on Space and Folder pages; Home "+" menu → "All Spaces" (`apps-catalog.tsx:283`); error page "All spaces"; 404 "Browse spaces"; `/today` fallback when the viewer has zero Spaces. **Not** in the sidebar, not in the rail. Effectively a secondary/orphan page.
- **Back button:** none. No breadcrumb (it is the root).
- **Top bar:** shared shell (see §0).
- **Sidebar:** Home sidebar; no item highlights for `/spaces` (Space rows highlight only on `/spaces/[slug]`).
- **Controls:** card link → `/spaces/[slug]`; hover `SpaceFavoriteButton` (star). No create button on the page; empty state text says "Create one from the sidebar's '+' button next to Spaces" (`spaces/page.tsx:40`).
- **UI state:** rough. Plain grid, no search/sort/filter, no "New Space" CTA, header comment literally says "Phase 2 stub" (`spaces/page.tsx:1`).
- **Issues:**
  - No way to create a Space from the index; empty state points at the sidebar.
  - Cards show `s.memberCount` etc. but not owner, last activity, or privacy tooltip.
  - Hardcoded `text-zinc-*` styling, no `--os-*` tokens.

---

## 2. Route: `/spaces/[slug]` (Space detail, 6 tabs)

- **File:** `src/app/(dashboard)/spaces/[slug]/page.tsx` (2241 lines, server, `force-dynamic`), tabs in `space-view-tabs.tsx`, List rows in `space-list-items.tsx`.
- **Reachable from:** sidebar Space row (name link `space-tree-row.tsx:377`), Favorites, `/today` redirect, breadcrumb from Board/Folder, `/spaces` card, Space "…" → "Space settings" (which just navigates here, `space-more-menu.tsx:501`).
- **Back:** none. Breadcrumb `Spaces` text link only (`page.tsx:581`).
- **Title row (`page.tsx:583-617`):** EntityTile (lg) + name; **ChevronDown "Space menu" button with no onClick handler** (dead, `page.tsx:587-594`); Lock glyph if PRIVATE; spacer; `Automate` link → `/automation/workflows` (generic, not scoped to this Space); `AskSidekickButton` ("Help me with the X space."); `SpaceShareButton` → ShareSpaceDialog.
- **View tabs (`space-view-tabs.tsx`):** Overview, List, Board, Team, Calendar, Gantt. Each is a `<Link>` to `?view=`. Calendar is hidden if the `CALENDAR_VIEW` module is off (`page.tsx:246-248`). Tab icons are hue-keyed colored tiles (blue/gray/blue/green/amber/red).
- **Access gate (`page.tsx:211-227`):** org admin, ORG-visibility, or SpaceMember → allowed. Otherwise a folder-only grantee is redirected to their first granted folder; everyone else gets `notFound()`.

### 2a. Overview tab (`?view=overview` / default)

- If the Space has no content at all: `SpaceQuickStart` (`space-quick-start.tsx`) with 4 tiles: Board (opens legacy `NewBoardDialog`), Folder (NewFolderDialog), Doc (POST /api/docs → /docs/[id]), Database (POST /api/tables → /tables/[id]). Labels "Board"/"Database" vs the rest of the app's "List"/"Table" terminology.
- Otherwise: `OverviewCustomizeBanner` + `OverviewToolbar` + `SpaceOverviewGrid` (react-grid-layout, drag/resize, persisted to `UserPreference.home.overviewCardLayout`, `space-overview-grid.tsx:88-117`).
- **Cards** (`page.tsx:690-863`): Recent (8 items → `/boards/[slug]?item=`), Docs (5, link `/docs/[id]`), Bookmarks (`SpaceBookmarks`, add/remove for OWNER/ADMIN/org-admin), Folders (grid, `+` opens NewFolderDialog, hover `FolderMoreTrigger`), Lists (table Name / Color / Progress / Owner, `+` opens CreateListModal, hover ShareBoardButton + BoardMoreTrigger), Resources (`SpaceFilesCard`: drop zone + Upload + file rows with open/move/delete), Workload by Status (conic pie + legend).
- **Overview controls that do nothing:**
  - Banner "Get Started" button has no handler (`overview-customize.tsx:40-46`).
  - Toolbar "Auto refresh: On/Off" toggles local state only; nothing refreshes (`overview-customize.tsx:64,77-88`). "Refreshed: just now" is set once on mount.
  - Toolbar Filter and Settings icon buttons have no handlers (`overview-customize.tsx:90-105`).
  - `+ Card` works (dispatches `workwrk:overview-add-card` → ManageCardsModal, `space-overview-grid.tsx:81-86,145-151`).
- **Lists card data bugs:** Progress bar is hardcoded `width: "0%"` and label `0/—` (`page.tsx:803-808`); the "Owner" column header exists but the cell only holds the hover Share/… buttons, never an owner (`page.tsx:783,809-821`). Color column prints the raw hex string (`page.tsx:801`).
- **Docs card bug:** secondary text renders `in {d.title}` (the doc's own title again) instead of a location (`page.tsx:729`).
- **Workload card** is keyed to `Space.settings.workflow.statuses` (the wizard palette), not to per-board statuses; boards with custom statuses show as raw keys / "Unset" (`page.tsx:557-573`).

### 2b. List tab (`?view=list`)

- Cross-board item pull (cap 200, `page.tsx:377-394`) rendered by `SpaceListItemsTable` (Name w/ StatusGlyph + subtask nesting, Status pill, Board link, Updated). Row click opens `BoardItemDrawer` in place; hover "Open in its board" link.
- **Toolbar (`page.tsx:2010-2043`):** `Mine` toggle, Status filter, Owner filter, Due menu (Any/Overdue/Today/This week/This month), Group menu (None/Status/Board/Owner), Sort menu (Recently updated / Title / Status / Board), CSV Export. All are `<details>` native disclosure menus with `<Link>` options: **every click is a full server round trip + ValueLoader flash**, and `<details>` menus do not close on outside click or Esc.
- Filter chips strip with per-chip remove and Clear all (`page.tsx:1613-1689`).
- Empty states: "No items in this Space yet" and "No items match this filter" (`page.tsx:1997-2058`).
- **Status mismatch:** the status filter, glyphs and the drawer's status picker use the Space workflow palette (`workflow.statuses`), but boards own per-List statuses (`getBoardStatuses`). Items on boards with custom statuses show raw keys and the popup offers the wrong status set (`page.tsx:1978-1980`, `space-list-items.tsx:57-88`).
- **Edit gate mismatch:** `spaceCanEdit = isAdmin || isSpaceOwner || !!membership` (any member incl. GUEST, `page.tsx:234`) drives the drawer's editing UI, while the Board page uses `canEditSpace` (OWNER/ADMIN only). Same item, different editability depending on where you open it.

### 2c. Board tab (`?view=board`)

- Read-only kanban of the 200 most recent items grouped by Space workflow status; header literally says "across this Space · read-only" (`page.tsx:1507-1509`). No drag, no add. Cards link to `/boards/[slug]?item=`. Unknown statuses bucket into "Unset".
- **UI state:** rough / read-only stub of a Board.

### 2d. Team tab (`?view=team`)

- Per-owner columns (280px) with a status mini-bar whose segments deep-link into the List tab with owner+status filters (`page.tsx:1392-1407`). Read-only. Empty state "No items assigned yet".
- Uses a djb2-hue avatar tint (`page.tsx:1568-1611`), a third avatar style distinct from `PersonAvatar` and the share dialogs' initials avatar.

### 2e. Calendar tab (`?view=calendar`)

- Month grid, `?month=YYYY-MM` nav links (prev/next/Today), 3 chips per day + "+N more" (no expand), chip → `/boards/[slug]?item=`. Read-only, no drag, no add. Gated by `CALENDAR_VIEW` module.
- Hint text "Items with a DATE field value · add one in the Field Shelf to surface" (`page.tsx:1202-1204`) is wrong now that `dueAt` is first-class.

### 2f. Gantt tab (`?view=gantt`)

- 12-week board-grouped bars; nav reuses the `?month=` param for week anchoring (`page.tsx:900-901`), so the URL says "month" while the UI moves by a month per click and shows a 12-week window. Read-only, no drag. Hint: "Items with startAt + dueAt render as duration bars".

### 2g. Space-page UI state overall

- **rough.** Overview is the only rich tab; List is functional but server-round-trip heavy; Board/Team/Calendar/Gantt are read-only previews of per-board views. Multiple dead controls (see above). Wizard-created "views" and "default permission" are stored but never enforced (see §8 Settings).

---

## 3. Route: `/folders/[id]` (Folder detail, 2 tabs)

- **File:** `src/app/(dashboard)/folders/[id]/page.tsx` (server, `force-dynamic`), tabs `folder-view-tabs.tsx`.
- **Reachable from:** sidebar folder row name (`space-tree-row.tsx:561-566`), Space Overview Folders card, Favorites (note: favorites link to `/spaces/[slug]#folder-<id>`, `apps-catalog.tsx:744`, an anchor that nothing on the Space page targets), folder-only grantee redirect from Space page.
- **Back:** none. Breadcrumb `Spaces / <Space>` links (`page.tsx:163-170`).
- **Title row (`page.tsx:171-191`):** folder icon tile, name, **ChevronDown "Folder menu" button with no handler** (`page.tsx:177-179`), Lock if PRIVATE, `Automate` link (generic), Ask Sidekick. **No Share, no rename, no "…" menu on the folder's own page**; management only exists on sidebar rows and the parent Space's Folders card.
- **Tabs:** Overview, List (`folder-view-tabs.tsx`). `hiddenViews` prop is accepted but never passed.
- **Body:** `FileDropZone` sits at the top of BOTH tabs (`page.tsx:197`), above the content, which is odd on the List tab.
- **Overview:** Folders card (only rendered when child folders exist, so there is no "+ New folder" affordance on a folder with no children, `page.tsx:214-233`), Lists card (Name / Color / Progress / Owner; progress is real here `done/total`, `page.tsx:246-263`; Owner column again empty), Docs card, `FolderFilesCard` (Upload, open/move/delete).
- **List:** `SpaceListItemsTable` of up to 200 items across the folder subtree with **no filters, sort, group, or export** (unlike the Space List tab, `page.tsx:198-210`). Statuses come from the Space workflow palette (same mismatch as §2b). Empty: "No lists in this folder yet." (wrong copy when lists exist but have no items).
- **UI state:** rough. Reads as a thinner clone of the Space page with fewer affordances.

---

## 4. Route: `/boards/[slug]` (Board / List detail, view tabs)

- **File:** `src/app/(dashboard)/boards/[slug]/page.tsx` (server, `force-dynamic`), tabs `board-view-tabs.tsx`, canvas `components/board-view/board-canvas.tsx`.
- **Reachable from:** sidebar board row (`space-tree-row.tsx:632-646`), Space/Folder Lists cards, Favorites, Recent card, any `?item=` deep link from Space views, CreateListModal / NewBoardDialog / template apply redirects, BoardMoreMenu Duplicate.
- **Access:** `canRead(viewer, board)` central resolver (`page.tsx:67-68`); `canEdit = canEditSpace(space)` = Space OWNER/ADMIN or org admin (`page.tsx:78`).
- **Back:** none. Breadcrumb: Space (link) `/` Folder (**plain span styled `cursor-pointer hover:bg-zinc-100` but NOT a link**, `page.tsx:106-120`) `/` Board name (h1 with hover ChevronDown that has no handler, `page.tsx:124-134`).
- **Title row right:** `Automate` (generic link), AskSidekick, `BoardShareButton` → ShareBoardDialog.
- **View tabs (`board-view-tabs.tsx`):** one tab per `View` row, drag-to-reorder (persists `displayOrder` with one PATCH per view, `board-view-tabs.tsx:114-126`), right-click → `ViewTabContextMenu` (Rename / Set as default / Duplicate / Delete). **No visible "…" trigger on tabs; the menu is right-click only** (`view-tab-menu.tsx:57-64`). Separator then `+ View` (`NewViewTrigger`).
- `ensureCoreListViews` self-heals every board to List + Board + Calendar + Gantt tabs on load (`page.tsx:52-62`), so every List shows at least 4 tabs whether or not the user wants them.
- **Sprint boards** render `SprintHeaderStrip` above the canvas when `settings.sprint` exists.

### 4a. BoardCanvas (`board-canvas.tsx`)

- Owns: open item drawer (`?item=` deep link, `?panel=fields|statuses` deep link), items mirror + 12s polling (`board-canvas.tsx:291-322`), per-view `hiddenFields` / `extraColumns` / `filters` / `savedFilters` persisted into `View.config` (single PATCH replacing the blob, with an `Object.assign` clobber guard, `board-canvas.tsx:156-166`).
- **Toolbar actions** (right side): `Statuses (N)` → BoardStatusEditor, `Fields (N)` → FieldShelf, `+ Task` (`BoardAddTaskButton` → shell CreateTaskModal). For TABLE these ride inside the table's own toolbar row; for every other view they sit in a separate row above the canvas with the FilterMenu (`board-canvas.tsx:367-373`). Filter appears only for `FILTERABLE_VIEWS` (12 of 17).
- Module gating from the Space (`priority`, `tags`, `timeTracking`, `customFields`) hides columns/pickers; legacy Spaces with no modules list are "all on" (`space-modules.ts:30-34`).
- Fallback renderer for unknown view types: "This view type isn't supported by this build yet" (`board-canvas.tsx:536-542`).

### 4b. Per-view inventory

| View type | File | State | Controls / notes |
|---|---|---|---|
| TABLE (List / Monday Table) | `board-table-view.tsx` (3352 lines) | polished | Toolbar: Group by pill (+direction), Subtasks mode menu (Collapsed/Expanded/**Separate: no-op**, `:1860-1866`), Columns (opens FieldShelf), item count, FilterMenu slot, Me toggle, Sort menu (Default/Name/Due/Created/Priority), CSV export, quick search, then Statuses/Fields/+Task. Column header menu: sort asc/desc, group, edit statuses, edit field, move start/end, hide, delete, add column (`:2118-2151`). Resizable columns (persist `colWidths`), inline add-task row with type/assignee/due/priority/tags, inline subtask add, row checkbox multi-select → `BulkActionBar`, row "…" menu, aggregate footers (sum/avg/checked). `gridStyle="table"` when `config.grid==="monday"`. Subtask "Separate" mode is a silent stub. |
| KANBAN | `board-kanban-view.tsx` | polished | Column per status (uppercase colored chip + count + hover `+`), native HTML5 drag between columns, card: select checkbox, title inline edit, complete toggle, add subtask, rename, `ItemRowMoreMenu`, meta row (Assignee/Due/Priority/Tags pickers + up to 6 choice-field chips), subtask count. Empty: "This board has no statuses yet". No WIP limits, no column collapse, no column reorder, no add-column. |
| CALENDAR | `board-calendar-view.tsx` | polished | Local month state (no URL), prev/next/Today, "Date field" select persisted to `config.dateFieldKey`, dated count, day `+` (creates "New item" at TO_DO regardless of board statuses, `:127`), drag chip to reschedule, right-click context menu, 4 chips + "+N more" (not expandable). Month view only (no week/day). |
| GANTT | `board-gantt-view.tsx` (892) | polished | Today / earlier / later, range label, Date field select, `Backlog` toggle (docks `GanttBacklogPanel`: Unscheduled / Overdue tabs, drag-out, one-click Today), floating zoom stack (4/8/12/16/24 weeks persisted), sticky Name column, drag-move/resize bars, undated markers, bottom "+ Add Task" row. Declared omissions: dependencies, progress fill, day/week/month dropdown, weekends toggle (`:35-37`). |
| TIMELINE | `board-timeline-view.tsx` | rough | Read-only fixed 12-week strip (2 weeks back, 10 forward, no navigation), one lane per status, "Unscheduled" chip strip capped at 8. No zoom, no drag, no add. |
| CHART | `board-chart-view.tsx` | polished (small) | Type (Bar/Pie/Line created-per-week/Number), Group by (status/owner/priority/choice fields), Metric (count / sum of number fields); persisted. Selects disabled when `!canEdit`, so viewers cannot even explore. Recharts with hardcoded hex palette. |
| DASHBOARD | `board-dashboard-view.tsx` | rough | Fixed widget set: 6 stat cards + By status / By priority / By person. No configuration, no per-widget options; comment: "v1 is a fixed widget set". Not filter-driven beyond canvas filters. |
| FORM | `board-form-view.tsx` | polished (setup) | Setup card: "Create intake form" (seeds Title + Details) or "Connect existing…" select; connected: Copy link, Edit form (→ /forms/[id]), Change, iframe of `/embed/forms/[id]`. Viewer copy "Ask a List editor to connect a form." |
| DOC | `board-doc-view.tsx` | polished (setup) | Create doc (anchored BOARD) or "Embed existing…" (lists ALL org docs, not scoped); connected: Open full page, Change, inline `BlockDocEditor pane="peek"`. |
| FILE_GALLERY | `board-file-gallery-view.tsx` | rough | Grid of files attached to items; click → owning task; hover download. No upload here, no sort/filter, error text is shown inside the empty-state paragraph. |
| WORKLOAD (variant workload) | `board-workload-view.tsx` + `workload-grid.tsx` | polished | Today/prev/next week, mode select (Task count / Time estimates), window (1/2/4 weeks), capacity gear (daily hours, daily tasks, count weekends, per-person hours) persisted as `wl*` keys with debounce+retry. Members ∪ owners rows. |
| WORKLOAD (variant team) | same | rough | Per-person kanban columns (Unassigned last) with status bar; read-only cards, no drag. |
| MAP | `board-map-view.tsx` | stub-ish | Groups by first LOCATION field string; card per place with "Open in Google Maps" link; copy admits "interactive pin map lands with the maps-library integration" (`:78-79`). No map. |
| WHITEBOARD (Canvas / Mind Map) | `board-whiteboard-view.tsx` | polished (legacy engine) | Setup: create or "Embed existing…"; embeds **Excalidraw** with 3s autosave, Saving pill, Open full page, Change. Note: the standalone canvas is moving to the first-party engine (`components/canvas`), so this tab is on the legacy engine. "Mind Map" tile in +View creates the same WHITEBOARD type. |
| HIERARCHY | `board-hierarchy-view.tsx` | rough | Read-only expand/collapse tree with status pill + avatar; right-click menu only. |
| PIVOT | `board-pivot-view.tsx` | polished (small) | Rows / Columns / Value selects persisted; totals. Selects disabled when `!canEdit`. |
| CARDS | `board-cards-view.tsx` | rough | Responsive card grid (status top border, priority, 2 tags, owner, due). Read-only, right-click menu. No group/sort. |
| ACTIVITY | `board-activity-view.tsx` | rough | Flat feed from `/api/item-activity?boardId=`; no pagination, no filters; error message rendered as the empty-state text. |

### 4c. `+ View` popover (`view-create-popover.tsx`)

- Search input with sparkle icon: filters the tile catalog client-side; the submit button toasts "AI-create coming soon" (`:193-200`).
- Popular (List, Gantt, Calendar, Doc, Board, Form, Dashboard) + secondary (Table(monday), Canvas, Activity, Workload, Team, Mind Map, Map, Chart, Timeline, Cards, Pivot, Hierarchy, File gallery). All POST `/api/boards/[id]/views` and refresh.
- **Embed section (Any website, Google Sheets/Docs/Calendar/Maps, YouTube, Figma): every tile is a toast stub** (`:178,231`).
- Footer: "Private view" checkbox sets `isShared:false` on create, but **nothing filters views by `isShared`/creator** (board page loads all `board.views`, `page.tsx:47`), so private views are visible to everyone (cosmetic). "Pin view" checkbox only changes the toast text ("pin coming soon", `:166-170`).

### 4d. View tab context menu (`view-tab-menu.tsx`)

- Right-click only. Rename (inline), Set as default (hidden on current default), Duplicate, Delete (server refuses deleting the last view with a 400 that surfaces as a toast; UI does not pre-disable it, `views/[viewId]/route.ts:83`).

### 4e. Filter menu (`board-filter-bar.tsx`)

- Chip button (icon only until active: "N Filters"), portaled panel: Where/AND-OR rows with field (Status/Assignee/Priority/Due/Tags/Title/Task Type/custom fields), operator, value; Add filter, Clear all, "Hide closed tasks" switch, Saved filters (list/apply/delete, save-as input). Persisted per view. Polished. Note the AND/OR connector is one global toggle per rule row (clicking any row's connector flips all).
- Assignee value list fetches only 50 users (`:351`).

### 4f. Field shelf (`field-shelf.tsx`)

- Right slide-in (360px): tabs "Create new" / "Add existing", search. Create: AI Suggestions (one LLM call per board/session), Popular, All catalog; "Soon" types disabled (Summary, Sentiment, Categorize, Translation, Formula, Rollup, Progress auto, Button, Signature, Action items, `field-catalog.ts:95-116`). Add existing: Shown (locked Name/Status + built-ins + custom), Properties (built-ins to turn on, plus 12 "Soon" rows: Assigned Comments, Custom Task ID, Date closed/done, Dependencies, Duration, Latest comment, Lists, Pull Requests, Sprint points, Sprints, Time estimate, `field-catalog.ts:165-176`), Hidden fields, Custom Fields in Workspace (copy from sibling boards). Field rows: drag-reorder (one PATCH per moved field), rename, eye toggle (per view), choice editor (add/rename/recolor/delete), remove.
- Custom Fields module off → Create tab replaced by an explainer card; header title "Fields" but page buttons call it "Columns" (table) / "Fields" (canvas) inconsistently.
- Both the shelf and the Status editor are `fixed` right panels with their own backdrop, a different pattern from the centered Radix `Dialog` used by share/create dialogs.

### 4g. Field value renderer (`field-value.tsx`)

- Handles TEXT/CUSTOM_TEXT/URL/EMAIL/PHONE, LONG_TEXT, NUMBER/MONEY/PERCENT, DATE/DATETIME, CHECKBOX, DROPDOWN/CUSTOM_DROPDOWN/TSHIRT_SIZE, MULTI_SELECT/LABELS, RATING, KRA, LINKED_DOC/SOP/CANVAS, RELATIONSHIP, USER/PEOPLE, PROGRESS_MANUAL, LOCATION, VOTING, FILES (`:224-270`). AI types render a muted "—" (`:10`).

### 4h. Status editor (`board-status-editor.tsx`)

- Right panel "Task statuses N of 30": drag reorder, color swatch (14 fixed colors), label, group select (Active/Done/Closed), delete (min 1), add row, "Reset to default" (PATCH `statuses:null`), Save. Read-only mode for `!canEdit`. Polished.

### 4i. Bulk action bar (`bulk-action-bar.tsx`)

- Floating dark pill: N selected, Set status, Set owner (lazy users, 100 cap), Set due date (stores `T00:00:00.000Z` UTC midnight, unlike the calendar's local-midnight fix, `:133` vs `board-calendar-view.tsx:50-52`), Priority, Archive, Delete, Clear. Uses native `<details>` menus. Fan-out one request per item (no bulk endpoint).

### 4j. Row / card "…" menu (`item-row-more-menu.tsx`)

- Copy link / Copy ID / New tab (→ `/item/[id]`), **Favorite (toast stub)**, Open, Rename, Remind me submenu, **Move to (toast stub)**, Duplicate, Task type submenu, Start timer, Archive, Delete.

### 4k. Board page UI state overall

- **polished core (Table/Kanban/Calendar/Gantt/Workload/Filter/Fields/Statuses), rough long tail** (Timeline, Cards, Hierarchy, Map, Activity, Dashboard, File gallery, Team variant). Chrome issues: non-link folder crumb, dead title chevron, right-click-only tab menu, forced 4 default tabs, no back button.

---

## 5. Route: `/tasks/personal-list` (Personal List)

- **File:** `src/app/(dashboard)/tasks/personal-list/page.tsx`. Same `BoardViewTabs` + `BoardCanvas` chassis on a per-user PRIVATE space-less board (`getOrCreatePersonalBoard`).
- **Reachable from:** Home sidebar "My Wrk" group → "Personal List" (`apps-catalog.tsx:365`).
- **Back:** none; breadcrumb "My Wrk / 🔒 Personal List" is plain text (no links).
- **Controls:** identical to §4 minus Share/Automate/Ask; `canEdit` hardcoded true; no module gating (all on). `+ Task` passes `spaceId: null`.
- **UI state:** polished (inherits). Issue: BoardMoreMenu / share affordances don't exist here, and the sidebar row for it has no "…".

---

## 6. Route: `/templates` (legacy "Workspace templates")

- **File:** `src/app/(dashboard)/templates/page.tsx` (client). Lists `/api/workspace-templates` bundles (Doc + Form + Table per team type) with an Apply button; toast on success; hint links to /docs, /forms, /tables.
- **Reachable from:** Workspace menu → "Templates" only (`workspace-menu.tsx:299`). Not in rail/sidebar.
- **Back:** none.
- **UI state:** rough / legacy. Styled with bespoke `.tmpl__*` classes in `os.css` (gradient card headers) rather than the Tailwind/zinc style everywhere else. Conceptually duplicates the Template Center (§7) under a different data model (`/api/workspace-templates` vs `/api/template-center`). "Applied — apply again?" button copy is odd. Loading state is a plain "Loading…" string, not ValueLoader.

---

## 7. Template Center modal (`components/templates/template-center.tsx`)

- Opened from: Space "…" → Templates → Browse templates, Space "+" → Templates, Folder "…" → Templates, Folder "+" → Templates, Board "…" → Browse templates, CreateListModal "Use Templates", NewFolderDialog "Use Templates".
- Layout: 1040px modal, left nav (Featured = builtIn only / Workspace Templates / All), Template Types checkboxes (hidden when scoped to one kind), Complexity checkboxes, search, category grid → Detail (Use Template, "Template includes" statuses/fields/views, Space picker for LIST when no context).
- Apply: TASK → hands config to CreateTaskModal; LIST → `/boards/[slug]`; SPACE → `/spaces/[slug]`; **FOLDER / DOC / VIEW / WHITEBOARD → `onApplied` with slug, and the shell's handler only reacts to TASK** (`os-shell.tsx:61-66`), so applying a Folder/Doc/View/Canvas template closes the modal with no navigation and no toast (silent dead-end). FOLDER apply also sends no spaceId/folder context (`template-center.tsx:134-139`).
- Every card uses the same generic ListChecks placeholder art (`:247-249`). Detail "Use Template" uses the taupe accent (`taupeButton`) while every other primary action in this area is brand blue or zinc-900.
- UI state: rough.

---

## 8. Dialogs, menus and sidebar controls (in scope)

### 8a. ShareSpaceDialog (`share-space-dialog.tsx`)
- Visibility tri-state: Private ("Only invited members"), Workspace ("Members + org admins"), Org-wide. **Private and Workspace are functionally identical for non-members** (both `notFound()` unless member or admin, `spaces/[slug]/page.tsx:216`; `listSpacesForUser` shows non-admins only ORG + member spaces). The distinction is label-only.
- Add people: tabs People (search, add as MEMBER), Departments / Offices (bulk "Add all", office counts computed client-side), Invite (email + role, pending invitations list with copy/resend/revoke). Members list with role select (Owner/Admin/Member/Guest) and remove. Polished; the only dialog with department/office/email flows.
- Role labels: Owner/Admin/Member/Guest here vs "Can manage/Can edit/View only" in ShareBoardDialog vs "Admin/Can edit/Can view" in ShareFolderDialog. Three vocabularies for the same four roles.
- Also mounted from the sidebar Space "…" → "Sharing & Permissions" and the title-row Share button; `SpaceMembersStrip` (`space-members-strip.tsx`) is an orphaned component (no importer) left over from the removed About card.

### 8b. ShareBoardDialog (`share-board-dialog.tsx`)
- Visibility: "Inherit Space" (WORKSPACE), Private, Org-wide. Add people (MEMBER by default, no role at add time), members list with role select. No department/office/email tabs. Info line explains list-level grants.
- Opened from title-row Share (`BoardShareButton`), Space/Folder Lists card hover "Share" (`ShareBoardButton`). **From the sidebar board row "…" → "Sharing & Permissions" it toasts "Share coming soon"** because `BoardTreeRow` passes no `onRequestShare` (`board-more-menu.tsx:445-456`, `space-tree-row.tsx:649-653`).

### 8c. ShareFolderDialog (`share-folder-dialog.tsx`)
- Add people with role select (Admin / Can edit / Can view), members list, remove. No visibility control (folder PRIVATE/WORKSPACE is set only at create time via NewFolderDialog and cannot be changed later anywhere in the UI). Reached only via Folder "…" → blue "Sharing & Permissions" button.

### 8d. SpaceMoreMenu (sidebar Space "…", `space-more-menu.tsx`)
- Favorite (Sidebar / Top), Rename, Copy link, Create new (List / Doc / Folder: Folder creates "New Folder" instantly with no dialog, unlike the "+" menu which opens NewFolderDialog), Color & Icon, Make Private / workspace-visible, Modules (SpaceModulesModal), **Automations (toast stub)**, **Custom Fields / Task statuses (toasts "set per List")**, **Space settings (just navigates to the Space page; there is no settings surface)**, **Imports (stub)**, Templates (Browse / Save as template), Move (MoveTargetDialog), Duplicate (creates an empty copy: name/icon/color/visibility only, no folders/boards), **Hide from sidebar (stub)**, Archive, Delete, Sharing & Permissions.

### 8e. FolderMoreMenu (`folder-more-menu.tsx`)
- Favorite, Rename, **Copy link copies `<current page>#folder-<id>`, not `/folders/[id]`** (`:196`), Create new (List / Doc / Canvas; Canvas lands in the Space, not the folder), Folder color, **Automations / Custom Fields / Task statuses / Convert to Space / Imports / Move / Duplicate: all "coming soon" toasts** (`:204,443-458`), Templates, Archive, Delete, Sharing & Permissions (blue button).

### 8f. BoardMoreMenu (`board-more-menu.tsx`)
- Favorite, Rename, **Copy link builds `/boards/${board.id}` but the route resolves by slug → 404** (`:222` vs `boards/[slug]/page.tsx:43`), List color, Custom Fields / Task statuses (deep-link `?panel=`), Default task type (→ /settings/task-types), **List info (just a toast)**, **Email to List / Automations / Imports (toast stubs; "Automations" toasts even though the page header has a working Automate link)**, Browse templates, Save as template, Move (MoveTargetDialog), Duplicate, Archive, Delete, Sharing & Permissions (toast when no handler, see 8b).

### 8g. SpaceTreeRow / FolderTreeRow / BoardTreeRow (`space-tree-row.tsx`)
- Space row: tile flips to chevron on hover, name link, hover cluster: `SidebarQuickStar` (**retired, renders null**, `sidebar-quick-star.tsx`), SpaceMoreTrigger, SpaceCreateTrigger. Right-click opens the "…" menu. Drag: OS files drop → upload to Space root; tree items drop → move to root; Space rows drag to reorder (`/api/spaces/reorder`).
- Folder row: folder/chevron toggle (disabled when empty), name link → `/folders/[id]`, hover "…" + `FolderAddTrigger` (List / Doc / **Dashboard (stub)** / Canvas / **Form (stub)** / Folder / **Imports (stub)** / Templates). Drop zones before/inside/after.
- Board row: name → `/boards/[slug]`, hover "…". Docs/whiteboards/tables rows also appear in the tree with their own menus.
- Expand state and children are cached per session (`spaceExpandStore`), reset on reload.

### 8h. SpaceCreatePopover (sidebar Space "+", `space-create-popover.tsx`)
- List (CreateListModal), Folder (NewFolderDialog), Sprint (CreateSprintModal), Doc, **Dashboard (stub)**, Canvas, Database, **Form (stub)**, **Imports (stub)**, Templates.

### 8i. CreateListModal (`create-list-modal.tsx`)
- Name, Description, Space picker (preselect from opener or route), Make private switch, "Use Templates", Create → `/boards/[slug]`. Custom overlay (not Radix Dialog). Space glyph uses a generic Boxes icon when the Space has an icon (`:213`), so the picker never shows the real Space icon.

### 8j. NewBoardDialog (legacy "New Board", `new-board-dialog.tsx`)
- Still used by SpaceQuickStart "Board" tile, sidebar `onRequestNewBoard` (Home sidebar `NewBoardDialog`, `apps-catalog.tsx:906-916`) and orphaned `SpaceActions`. Name + view-tile picker (16 tiles; Create with AI / Activity / Team / Mind Map marked "Soon" even though `+ View` can create Activity/Team/Mind Map), 7 embed tiles that are all "Soon", search box whose Send button has no handler (`:236-243`), Make Private, Create Board. Vocabulary "Board" vs "List" everywhere else.

### 8k. NewFolderDialog (`new-folder-dialog.tsx`)
- Name + color swatch, Description, location breadcrumb (only when `spaceName` is passed, and no caller passes it), **"Settings → Statuses: Use Space statuses" row with a chevron that does nothing** (`:191-203`), Make private, Use Templates, Create. Uses `#0073EA` literal rather than `--os-brand`.

### 8l. NewSpaceDialog (`new-space-dialog.tsx` + `space-wizard-step2.tsx`)
- Step 1: icon+color, name, description, **Default permission select (Full edit/Edit/Comment/View) stored in `settings.defaultPermission` and never read anywhere** (grep: only a comment in `lib/space.ts:251`), Make Private, Continue. Step 2: preset, owner, views (view catalog flags Calendar/Team/Gantt/Timeline/Map/Activity/Table/Mind Map/Workload as `shipped:false` "Coming soon", `space-wizard-presets.ts:50-60`, yet the Space page always shows Team/Calendar/Gantt tabs; the selection itself is never enforced), statuses, modules. Uses `bg-surface`/`border-border`/`text-muted` theme classes unlike the zinc-* styling of sibling dialogs.

### 8m. SpaceModulesModal (`space-modules-modal.tsx`)
- Toggle grid of modules (WORKWRK_NATIVE + PROJECT_MGMT); 8 "soon" modules disabled (Time Estimates, Sprints, Sprint Points, Dependencies, Multiple Assignees, WIP Limits, Incomplete Warning, Email). Enforced today: CALENDAR_VIEW (Space tab), PRIORITY / TAGS / TIME_TRACKING / CUSTOM_FIELDS (board surfaces). KRA/KPI/SOP/NOTES/WHITEBOARDS/REVIEWS… toggles are stored but not gated in this area.

### 8n. MoveTargetDialog (`move-target-dialog.tsx`)
- Board → pick Space (expand to folders) / Space → parent Space or Top level. Folder move is not supported (Folder menu Move is a stub) even though the sidebar supports folder drag-nesting.

---

## 9. Broken / confusing (consolidated, with severity)

**High**
1. BoardMoreMenu "Copy link" copies `/boards/<id>` while the route is slug-based → shared links 404 (`board-more-menu.tsx:222`, `boards/[slug]/page.tsx:43`).
2. Board page `canEdit = canEditSpace` (Space OWNER/ADMIN only, `boards/[slug]/page.tsx:78`) while the items API allows Space MEMBERs, board owners, item owners/assignees to edit (`api/items/[id]/route.ts:30-37`). Plain members and board "Can edit" grantees get a read-only board UI for work the server would accept; the Space List tab popup meanwhile lets any member (even GUEST) edit (`spaces/[slug]/page.tsx:234`).
3. Space List/Board/Team/Calendar tabs and the Folder List tab use `Space.settings.workflow.statuses` for status pills, filters and the drawer's status picker, but boards own per-List statuses. Items on boards with custom statuses show raw keys / "Unset", and the popup offers the wrong status set (`spaces/[slug]/page.tsx:557-573,1978-1980`, `folders/[id]/page.tsx:122-126`).
4. Access denial uses `notFound()` on all three detail routes, so a private Space/Folder/Board reads as "We haven't built this yet" (`spaces/[slug]/page.tsx:226`, `boards/[slug]/page.tsx:68`, `folders/[id]/page.tsx:72`).
5. "Private view" in `+ View` sets `isShared:false` but views are never filtered by sharing/creator; private views are visible to everyone (`view-create-popover.tsx:158`, `boards/[slug]/page.tsx:47`).
6. Template Center apply for FOLDER / DOC / VIEW / WHITEBOARD templates ends in nothing: shell handler only handles TASK (`os-shell.tsx:61-66`, `template-center.tsx:156-159`).
7. No `BackButton` on any detail route in this subsystem, contrary to the app-wide rule; Board breadcrumb folder segment looks clickable but is a `<span>` (`boards/[slug]/page.tsx:106-120`).

**Medium**
8. Every Space tab switch, List filter/sort/group/due click, Calendar/Gantt month nav and Board view-tab switch is a server round trip on a `force-dynamic` page and flashes the full-page ValueLoader (`space-view-tabs.tsx`, `spaces/[slug]/page.tsx:1691-1704`, `board-view-tabs.tsx:141`).
9. Dead title-row chevrons: Space "Space menu" (`spaces/[slug]/page.tsx:587-594`), Folder "Folder menu" (`folders/[id]/page.tsx:177-179`), Board name hover chevron (`boards/[slug]/page.tsx:124-134`).
10. Overview toolbar: Auto refresh toggle, Filter and Settings buttons, and the banner "Get Started" link do nothing (`overview-customize.tsx:40-46,77-105`).
11. Space Overview Lists card: hardcoded 0% progress and "0/—", empty Owner column, raw hex in Color column (`spaces/[slug]/page.tsx:795-821`); Folder page has the same empty Owner column (`folders/[id]/page.tsx:241,265-270`).
12. Docs card location text prints the doc title twice ("in {d.title}", `spaces/[slug]/page.tsx:729`).
13. Folder page has no Share / Rename / "…" on its own page; folder visibility cannot be changed after creation anywhere in the UI (`folders/[id]/page.tsx:171-191`, `share-folder-dialog.tsx`).
14. Sidebar board "…" → "Sharing & Permissions" toasts "Share coming soon" (`space-tree-row.tsx:649-653`, `board-more-menu.tsx:449-455`).
15. FolderMoreMenu copy link yields `<current path>#folder-<id>` (`folder-more-menu.tsx:196`); Favorites folder links point at `/spaces/[slug]#folder-<id>` (`apps-catalog.tsx:744`) where no such anchor exists.
16. Space wizard "Default permission" and selected "Views" are stored and never enforced; the wizard marks Calendar/Team/Gantt "Coming soon" while the Space page ships those tabs (`new-space-dialog.tsx:275-282`, `space-wizard-presets.ts:50-60`, `space-view-tabs.tsx`).
17. Space visibility "Workspace" vs "Private" behave identically for non-members (`spaces/[slug]/page.tsx:216`, `lib/space.ts:85-96`); three different role vocabularies across the three share dialogs.
18. Stub menu items presented as real actions (toast "coming soon"): Space (Automations, Imports, Hide from sidebar), Folder (Automations, Custom Fields, Task statuses, Convert to Space, Imports, Move, Duplicate), Board (Email to List, Automations, Imports, List info), Folder "+" (Dashboard, Form, Imports), Space "+" (Dashboard, Form, Imports), row menu (Favorite, Move to), `+ View` (7 embeds, AI create, Pin view), NewBoardDialog (4 view tiles + 7 embeds), Table Subtasks "Separate" mode (silent no-op).
19. View tab actions (rename/default/duplicate/delete) are right-click only; no visible affordance (`view-tab-menu.tsx:57-64`).
20. `ensureCoreListViews` forces List+Board+Calendar+Gantt tabs onto every board on load (`boards/[slug]/page.tsx:52-62`), so a Form-only or Doc-only List still shows 5 tabs.
21. Terminology drift: "Board" (NewBoardDialog, QuickStart tile, Space Board tab) vs "List" (CreateListModal, menus, share dialog copy) for the same entity; "Database"/"Table"; "Canvas"/"Whiteboard"; "Fields"/"Columns"/"Custom Fields".
22. Space "Duplicate" creates an empty Space (name/icon/color only) with no folders/boards, presented as a duplicate (`space-more-menu.tsx:283-304`).
23. Space "Space settings" menu item just navigates to the Space page; there is no settings surface for description, owner, workflow statuses, views or permission defaults after creation (`space-more-menu.tsx:501`).
24. Bulk "Set due date" stores UTC midnight (`bulk-action-bar.tsx:133`) while the calendar stores local midnight (`board-calendar-view.tsx:50-52`); the same task can land on different days depending on which control set it.
25. Calendar day "+" creates items with hardcoded status "TO_DO" regardless of the board's status set (`board-calendar-view.tsx:127`).
26. Chart / Pivot selects are disabled for read-only viewers so they cannot even change what they look at (`board-chart-view.tsx:196,209,215`, `board-pivot-view.tsx:173-177`).

**Low**
27. Two different avatar/initials styles inside the Space page (djb2 hue `OwnerBadge`) vs `PersonAvatar` and the share dialogs' gray initials.
28. Native `<details>` disclosure menus (Space List toolbar, BulkActionBar) do not close on outside click/Esc, unlike the MorePortal menus used everywhere else.
29. Space Calendar hint copy still says "add a DATE field in the Field Shelf" though `dueAt` is first-class (`spaces/[slug]/page.tsx:1202-1204`). Gantt tab reuses `?month=` for week anchoring (`:900-901`).
30. `/spaces` index has no create CTA and no search; `/templates` is a legacy page styled by bespoke `.tmpl__*` CSS.
31. Orphaned components: `SpaceMembersStrip`, `SpaceActions` (no importers); `SidebarQuickStar` renders null but is still threaded through every row.
32. CreateListModal shows a generic Boxes glyph instead of the Space's real icon (`create-list-modal.tsx:209-217`).
33. NewFolderDialog "Statuses: Use Space statuses" row is a dead control (`new-folder-dialog.tsx:191-203`); NewBoardDialog search Send button has no handler (`:236-243`).
34. Board Timeline view has no navigation/zoom; File gallery and Activity render their fetch error inside the empty-state paragraph.

---

## 10. Cross-cutting conventions observed

- **Back navigation:** none of the routes use `BackButton`; hierarchy navigation is by breadcrumb `<Link>`s in the page body (Space→/spaces, Folder→/spaces + Space, Board→Space only). The not-found page uses `GoBackButton` (router.back). No consistent "up" affordance.
- **Loader:** shared `(dashboard)/loading.tsx` → `ValueLoader` on every navigation; because tabs/filters are URL-driven server pages, the loader fires constantly inside this area. Client-side loads inside views use ad-hoc `Loader2 + "Loading…"` text (share dialogs, file cards, gallery, activity, template center, move dialog), never ValueLoader.
- **Empty states:** every view and card has a text empty state, but the pattern varies: bordered card with icon + one line (views), plain paragraph (overview cards), dashed border (List filter miss), "Empty" one-word row (sidebar). No shared EmptyState primitive. Error states: red banner with X inside views (table/kanban/calendar/gantt), `setError` red text in dialogs, toasts for menu actions, and error text substituted into the empty state (gallery/activity).
- **Style consistency:** the whole area is hand-styled Tailwind `zinc-*` + literal hex (`#0073EA`, `#0060B9`, tile colors). `var(--os-brand)` is used only in a handful of places (filter chip, checkboxes, brand buttons); the three page files use zero `--os-*` tokens (grep: 0/0/0 vs 159/11/30 `zinc-` uses). Dark mode depends on the `os.css` `.workwrk-os .text-zinc-*` catch-all overrides (`os.css:1540-1547`). View-tab tiles and `+ View` swatches are hue-keyed per view type (ClickUp style), against the stated "Monday-clean single accent" preference. Primary buttons alternate between brand blue (`bg-[#0073EA]`), `bg-zinc-900` dark pills (rename/save, NewSpace Continue, Doc/Form/Whiteboard setup) and taupe (`taupeButton` in Template Center). Dialogs alternate between Radix `Dialog` (share/create dialogs), custom fixed overlays (CreateListModal, TemplateCenter, MoveTargetDialog, SpaceModulesModal) and fixed right-side sheets (FieldShelf, BoardStatusEditor). NewSpaceDialog uses the `bg-surface/border-border/text-muted` token classes while sibling dialogs use zinc.
- **Menus:** `MenuList/MenuItem` + `MorePortal` for all "…" menus (consistent), but native `<details>` for the Space List toolbar and bulk bar, and bespoke absolute panels for the table Group-by/Sort/Subtasks menus.
- **Mobile / responsive:** the shell is a fixed three-column layout (60px rail + 200-320px resizable sidebar + main) with no breakpoint collapse (`os-shell.tsx:102-114`, `click-sidebar.tsx:189-203`). Board table uses fixed pixel column widths with horizontal scroll; kanban/team/gantt scroll horizontally; the Space overview grid has react-grid-layout breakpoints and a few `sm:`/`lg:` classes; the Space List table hides the Board column under `sm`. Popovers are absolutely positioned with `max-w-[92vw]` in one place (`+ View`). Practically: not usable below tablet width.
- **Persistence:** view chrome (filters, hidden columns, widths, group, chart/pivot settings, workload caps, date field) is persisted per View via a whole-blob PATCH; overview layout/hidden cards persist per user in preferences; sidebar expand state is session-memory only.
- **Live data:** BoardCanvas polls `/api/boards/[id]/items` every 12s while visible (no SSE); Space/Folder pages are static until navigation or `router.refresh()`.

---

## 11. Access notes

- **Space read:** org admin, `visibility === "ORG"`, or SpaceMember (any role). PRIVATE and WORKSPACE are equivalent for non-members. Folder-only grantees get redirected from the Space page to their first granted folder (`spaces/[slug]/page.tsx:216-227`).
- **Space edit (rename/icon/visibility/archive/delete/bookmarks/modules):** SpaceMember OWNER/ADMIN or org admin (`canEditSpace`, `lib/space.ts:210-216`; API `api/spaces/[id]/route.ts:57-58`). The sidebar "…" menu shows Rename/Delete/etc. to every viewer and only fails with a toast after the request 403s.
- **Space List popup editing:** any member incl. GUEST (`spaceCanEdit`, `page.tsx:234`); server gates per item.
- **Folder read:** `resolveAccess(folder)`: admin, folder owner, FolderMember, or Space read unless folder is PRIVATE (`lib/access.ts:168-196`). Folder edit: `meets(decision,"edit")` = folder owner/admin/member-edit, Space admins, org admin. Folder API PATCH/DELETE however uses `canEditSpace` (Space OWNER/ADMIN) (`api/folders/[id]/route.ts:35-36`), so a folder ADMIN grantee can see edit affordances on the folder page yet be 403'd on rename/archive.
- **Board read:** `canRead(board)` via Space/folder resolver; PRIVATE board + only "read" via Space → denied (`lib/access.ts:207-224`). Board edit (rename/statuses/fields/views): `canEditBoard` = org admin, board owner, PRIVATE-board OWNER/ADMIN member, Space OWNER (`lib/board.ts:672-700`); view PATCH/DELETE uses `canEditSpace` instead (`api/boards/[id]/views/[viewId]/route.ts:34-35`), a third rule.
- **Board UI edit flag:** page passes `canEditSpace` (OWNER/ADMIN of Space) to BoardCanvas (`boards/[slug]/page.tsx:78`) so plain Space MEMBERs and board "Can edit" grantees see read-only tables/kanban even though `PATCH /api/items/[id]` accepts them (`canContributeBoard`, `api/items/[id]/route.ts:30-37`). This is the biggest access inconsistency in the area.
- **Visibility of PRIVATE boards/folders in aggregates:** Space and Folder pages filter PRIVATE boards for non-admin/non-owner/non-Space-owner (`spaces/[slug]/page.tsx:276-284`, `folders/[id]/page.tsx:118`); `/api/spaces/[id]/children` prunes PRIVATE folders for full viewers and scopes grantees to their folders.
- **Views:** `isShared` is written but never read; every view is visible to every reader.
- **Delete vs Archive:** menus expose both Archive (soft) and Delete (`?hard=1` → Trash, 60 days) for Space/Folder/Board/Item; the two are adjacent with only a confirm-dialog description to distinguish them.

---

## 12. Settings notes

**Configurable today (where):**
- Space: name, icon+color, visibility, members/roles/invites (ShareSpaceDialog), modules (SpaceModulesModal), bookmarks (Overview card), overview card layout + hidden cards (per user, drag/resize/+Card), sidebar order (drag), favorites/top pins, move parent, archive/delete. At creation only: description, default permission (unenforced), preset workflow statuses, owner, views (unenforced).
- Folder: name, color+icon, members/roles (ShareFolderDialog), position (drag), nesting (drag), archive/delete. At creation only: description, private flag.
- Board/List: name, icon+color, visibility + members/roles, per-List statuses (BoardStatusEditor), custom fields (FieldShelf), per-view hidden/extra columns, column widths, group-by, filters + saved filters, chart/pivot/workload/calendar/gantt/form/doc/whiteboard view config, view order/default/rename/duplicate/delete, move to Space/Folder, duplicate, save as template, archive/delete. At creation: description, private flag, default view type (legacy dialog only).

**Should be configurable but isn't (gaps):**
- Space: description and owner after creation; workflow statuses after creation (the Space palette drives all Space-level tabs but has no editor; the "Task statuses" menu item just toasts "set per List"); which tabs the Space shows (Team/Gantt/Board are always on; only Calendar is module-gated); default permission (stored, not enforced, not editable); "Hide from sidebar"; automations scoped to the Space; a real Space settings page (the menu item exists and goes nowhere).
- Folder: visibility after creation; description after creation; move/duplicate (stubs); folder-level statuses/fields (stubs, and the create dialog implies "Use Space statuses" is a choice).
- Board/List: description after creation (CreateListModal captures it, nothing displays or edits it); per-view privacy/pinning (checkboxes are cosmetic); embed views; WIP limits, dependencies, time estimates, sprints, multiple assignees (module toggles exist but are "soon"); email-to-list; a per-board settings panel (the title chevron implies one).
- Views: no user-facing way to hide the auto-created Board/Calendar/Gantt tabs short of deleting them one by one via right-click.
