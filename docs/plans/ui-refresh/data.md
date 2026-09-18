# UI/UX audit: Tables/Sheets + Forms subsystem

Audited 2026-09-10 from source (read-only). Repo root: /Users/bigboldtechnologies/theywrk. All file references are relative to `src/` unless absolute.

## 0. Map of the subsystem

| Surface | File | Lines |
|---|---|---|
| /tables list | `app/(dashboard)/tables/page.tsx` | 167 |
| /tables module gate | `app/(dashboard)/tables/layout.tsx` | 26 |
| /tables/[id] sheet editor | `app/(dashboard)/tables/[id]/page.tsx` | 6178 |
| Sheet grid kernel | `components/tables/sheet-grid.tsx` | 2210 |
| Formula bar | `components/tables/formula-bar.tsx` | 365 |
| Dialogs | `components/tables/{ask-data-dialog,named-ranges-dialog,pivot-dialog,pivot-chart,relation-config-modal,table-trash-dialog}.tsx` | 138-273 each |
| Tables secondary sidebar | `components/layout/os/tables-sidebar.tsx` | 252 |
| Table "..." menu (Space tree) | `components/layout/os/table-more-menu.tsx` | 208 |
| Table star | `components/board-view/table-favorite-button.tsx` | 70 |
| /forms list | `app/(dashboard)/forms/page.tsx` | 166 |
| /forms/[id] builder + submissions | `app/(dashboard)/forms/[id]/page.tsx` | 430 |
| /forms/[id]/respond (in-app responder) | `app/(dashboard)/forms/[id]/respond/page.tsx` | 195 |
| /embed/forms/[id] (chrome-less) | `app/embed/forms/[id]/page.tsx` | 163 |
| /embed/tables/[id] (public read-only) | `app/embed/tables/[id]/page.tsx` | 98 |
| Board FORM view | `components/board-view/board-form-view.tsx` | 205 |
| FormsSidebar + hub entries | `components/layout/os/apps-catalog.tsx:1069-1082, 1202-1209, 1218-1220, 1350-1359` | |
| Doc embeds (form / data_table blocks) | `components/docs/block-editor.tsx:2740-2860` | |
| Generic `DataTable` primitive (admin tables, NOT the sheet) | `components/ui/data-table.tsx` | 195 |
| Legacy `OsMainTable` (Monday-style demo table) | `components/layout/os/main-table.tsx` | 539 |
| APIs | `app/api/tables/**`, `app/api/forms/**`, `app/api/public/tables/[id]`, `app/api/me/favorites/tables` | |
| CSS | `app/(dashboard)/os.css`: `.frmlist/.frmcard` 16774-16803, `.frmb*` 16811-16878, `.resp*` 16880-16915, `.dtbl*` 16918-17090 (117 rules, mostly legacy), `.shx__*` 34044-34235 (187 rules) | |

Note on `DataTable` (`ui/data-table.tsx`): this is the generic admin list-table primitive (`dash-table` classes, skeleton rows, sortable headers, checkbox selection) used by settings/admin pages. It is unrelated to the Tables module's `DataTable` Prisma model. `OsMainTable` (`main-table.tsx`) is the old Monday-style grouped table with a hard-coded status/priority vocabulary and an "Add column" `+` header cell and group `...` button that are both wired to nothing (`main-table.tsx:415-426, 437`). Neither renders on any /tables or /forms route.

## 1. Navigation model (how a user gets here)

- Rail hub **Tables** (`apps-catalog.tsx:1202-1209`): key `tables`, matchPaths `["/tables", "/forms"]`, category Core, defaultHref `/tables`, Sidebar = `TablesSidebar`, one createAction "New sheet" -> `/tables?new=1`.
- App **Forms** (`apps-catalog.tsx:1218-1220`): key `forms`, matchPaths `["/forms"]`, Sidebar = `FormsSidebar`, createAction "New form" -> `/forms?new=1`. It is in `FOLDED_INTO_HUB` (`apps-catalog.tsx:1355`, comment "forms -> Tables") so `offRail = true`: no rail icon; still listed in the More launcher and reachable by URL.
- `findAppForPath` (`apps-catalog.tsx:1380-1388`) skips offRail apps, so `/forms/*` resolves to the **Tables** hub. `ClickSidebar` (`click-sidebar.tsx:89`) picks `getApp(activeAppKey) ?? findAppForPath(pathname)`; `activeAppKey` is set to `"forms"` only by the More launcher (`apps-more-popover.tsx:95`). Consequence: the sidebar shown on `/forms` depends on how you arrived (see 4.2).
- Module gate: Tables is a premium module (`lib/modules.ts:32-38`, product `workwrk-tables`, `defaultEnabled: false` in `lib/products/catalog.ts:106-120`). `/tables/*` is wrapped by a server layout that renders `ModuleDisabledScreen` when off (`tables/layout.tsx`), and every `/api/tables*` handler uses `getSessionAndModule("workwrk-tables")` -> 403 (`lib/api-helpers.ts:25-42`). Forms is **not** a module and has no layout gate; its APIs use plain `getSessionOrFail`.
- Other entry points into the sheet editor: Space tree "Table" rows (`space-tree-row.tsx:661-695`, with `TableMoreTrigger` rename/delete + `SidebarQuickStar kind="table"`), Library -> Tables tab (`app/(dashboard)/library/page.tsx:770-860`), Home sidebar Favorites (`apps-catalog.tsx:754-765`), Activity feed (`activity/page.tsx:80-81`), doc `data_table` block (`block-editor.tsx:2854-2858`), linked attachments (`linked-attachments.tsx:237`), Space create popover "Database" (`space-create-popover.tsx:164-181`), Space quick-start (`space-quick-start.tsx:59-78`), global create menu "Database" (`create-menu.tsx:115-129`), Imports page card (`imports/page.tsx:34-46`), Templates hint (`templates/page.tsx:106`), AI agent tool `create_table` (`lib/agents/tools.ts:1651`).
- Other entry points into forms: global create menu "Form" (`create-menu.tsx:100-111`), board FORM view "Edit form" (`board-form-view.tsx:178-184`), doc `form` block (`block-editor.tsx:2790-2794`), Activity feed, RELATIONSHIP field entity picker (`field-value.tsx:1105`), AI tool `create_form` (`lib/agents/tools.ts:1531`).
- Global top bar is route-agnostic (`click-topbar.tsx`): workspace switcher, "Search workspace", Ask AI (Cmd+J), notifications bell, reminders bell, Inbox, profile. No page title, no breadcrumb, no route-specific actions on any route in scope.
- Global search (`app/api/search/route.ts`) does not index DataTable or FormDefinition, and the command palette has no tables/forms entries.

Naming drift for the same object across entry points: "Tables" (rail), "sheet" / "New sheet" (sidebar, tab bar, rail +), "Untitled spreadsheet" (created name, `lib/sheet-new.ts:19`), "table" / "New table" (list page, cards), "Database" (create menu, Space popover, Library empty state, Imports page "CSV -> Database"). Four names, one entity.

Four different creation recipes produce four different starting objects:
1. `createUntitledSheet` (sidebar +, rail +, list page "New table", tab bar +): "Untitled spreadsheet", 26 columns A..Z with `label: ""`, 1000 blank seeded rows (`lib/sheet-new.ts:13-16, 44-46`).
2. Library / Space popover / quick-start: "Untitled table", server default single `Name` column, 0 rows (`app/api/tables/route.ts:54-56`).
3. Global create menu "Database": Name / Status(select) / Due date / Notes typed columns (`create-menu.tsx:52-60`).
4. CSV import from the list page: columns from CSV headers, all `short_text`.

## 2. Route inventory

### 2.1 `/tables` (Tables overview)

- **File**: `app/(dashboard)/tables/page.tsx`
- **Title / purpose**: "Tables" card grid of every table the viewer can see; subtitle "N tables · M rows".
- **Reachable from**: rail hub Tables (defaultHref); TablesSidebar bottom row "All tables"; `/imports` card; `/templates` hint; `?new=1` from the rail/sidebar "+" (creates a sheet immediately and `router.replace("/tables")`, `page.tsx:48-56`).
- **Back button**: none (root of the hub).
- **Top bar**: global only.
- **Sidebar (TablesSidebar)**: header "Tables" + hover Search + Close + "+" (single action "New sheet"); body: "New sheet" ghost row; section SHEETS listing every sheet (right-click -> Rename / Delete sheet); divider; "All tables" (active here); "Forms".
- **Controls**: "Import CSV" (`frmlist__btn frmlist__btn--ai` with a Sparkles icon; creates a new table named after the file then POSTs `/import`); "New table" (promptless create -> navigate); cards (name, optional description truncated at 80 chars, row count, "Open >"). Empty state with "Create your first table".
- **States**: loading = plain "Loading…" text (`page.tsx:138`), error = red box with the raw `HTTP nnn`, empty = card.
- **UI state**: rough.
- **Issues**:
  - "Import CSV" is styled as the AI pill (`frmlist__btn--ai`, Sparkles icon) although nothing is AI-driven; visually lies.
  - Cards have no hover menu: no rename, delete, duplicate, star, move-to-Space, description edit. Delete/rename exist only via right-click in the sidebar, right-click on the bottom tab bar, or the Space tree "...".
  - Header comment promises "last edited" but cards show only a row count; every fresh sheet shows "1000 rows" because blank seeded rows count (`api/tables/route.ts:29`).
  - "New table" here vs "New sheet" in the sidebar/rail vs "Untitled spreadsheet" created.
  - Loader inconsistent with the rest of the app (plain text rather than `ValueLoader`).
  - Icon tile uses an inline teal->blue gradient (`page.tsx:119`), not the flat single-accent style.
  - No search/sort/filter/Space chip filter (Library's Tables tab has Space chips; this page does not).
  - Shares `frmlist*` classes with the Forms list; the two pages are the same template with different data.

### 2.2 `/tables/[id]` (Sheet editor)

- **File**: `app/(dashboard)/tables/[id]/page.tsx` (6178 lines, single client component).
- **Title / purpose**: the spreadsheet. Inline-editable name in a title row; full Sheets-style grid with formula engine.
- **Reachable from**: everything listed in section 1.
- **Back button**: custom `<button className="frmb__back shx__np">` -> `router.push("/tables")` (`page.tsx:4726`). Not `BackButton{fallbackHref}`; always goes to the overview even when you came from a Space, Library, a doc, or the Favorites list.
- **Top bar**: global only.
- **Sidebar**: TablesSidebar with the current sheet highlighted.
- **Title row** (`page.tsx:4725-4774`): back; green table icon; name input (blur -> PATCH, notifies sidebar + tab bar); "saving…" em while columns persist; star (`TableFavoriteButton`, self-hydrates from `/api/preferences`); Public/Private toggle (Globe/Lock, `dtbl__head-btn`, PATCHes `isPublic` instantly, no confirm); "Copy public embed snippet" (only when public; copies an `<iframe>` string, there is no plain "copy link").
- **Toolbar** (`page.tsx:4778-5019`, every control traced to a handler): Undo, Redo, Print (`window.print()` + `@media print` rules at os.css 34135), Zoom `<select>` 75/90/100/125/150, `$` currency, `%` percent, `.0` / `.00` decimal steppers, `123` number-format `<details>` menu (NUMBER_FORMAT_CHOICES with a check mark), B / I / U / S, Text color swatch grid + Reset, Fill color swatch grid + Reset, Align L/C/R, Filter toggle (funnel), `Σ` (inserts a `=SUM(` seed in the active cell), and a right-aligned **File** `<details>` menu: Import CSV (appends to this sheet), Export CSV (formatted), Export CSV (raw values), Ask your data…, Pivot table…, Named ranges…, Trash….
  - Formatting pills are disabled while rows are still streaming (`fmtDisabled`, title `FMT_STREAM_TITLE`).
- **Search + filter row** (on demand, `page.tsx:5022-5049`): "Search rows…" input; filter column `<select>` listing only `select`/`multi_select` columns; value `<select>`; "x of y" hint. Uses the legacy `dtbl__viewtabs` / `dtbl__filterbar` classes.
- **Formula bar** (`components/tables/formula-bar.tsx`): address box ("Active cell"), fx glyph, text input with function autocomplete listbox (signature + summary); read-only reasons toast when editing a computed/protected/spilled cell (`page.tsx:4708-4717`).
- **Grid** (`sheet-grid.tsx`): lettered column headers (letters only, lock icon when protected; drag to reorder; resize grip; double-click autofit, `page.tsx:4402-4431`); row-number gutter (click select, shift-extend, drag reorder; right-click menu); corner "Select all"; trailing header `+` "Add column"; bottom-left `+` "Add 500 rows" (`page.tsx:5135-5144`); "Start sheet" button when a table has zero columns (`page.tsx:5051-5056`).
- **Row context menu** (right-click, `page.tsx:5208-5295`): Open row; Insert 1 row above / below (disabled with a title while sorted/filtered/searched/streaming); Freeze up to row N / Unfreeze rows; Clear row(s); Delete row(s) (destructive, span-aware).
- **Header context menu** (right-click, `page.tsx:5297-5416`): Sort sheet A->Z / Z->A by X; Clear sort; Insert 1 column left / right; Freeze up to column X / Unfreeze columns; Clear column; Edit formula (only when `type === "formula"`); Configure relation (only when link/lookup/rollup); Data validation; Conditional formatting; Protect/Unprotect column; Delete column.
- **Find & Replace** (Cmd/Ctrl+F, Cmd/Ctrl+H; `page.tsx:5150-5191`): find input, counter, prev/next, "More options" (reveals Replace row), close; Replace / Replace all; notice line.
- **Bottom tab bar** (`SheetTabsBar`, `page.tsx:5552-5701`): `+` new sheet; one tab per **every sheet in the org** (right-click -> Rename / Delete sheet); selection stats; meta "N rows · M cols" or stream progress.
- **Dialogs**:
  - Conditional formatting (`page.tsx:507-698`): tabs Single color (rule list: when/value/colour, add/remove), Color scale (min/mid/max colour inputs, optional mid), Data bar (colour), Icon set (arrows/traffic). Radix `Dialog`.
  - Data validation (`page.tsx:702-778`): criteria none / list (one per line -> dropdown editor) / number between / text length between; Remove; reject-mode.
  - Row detail drawer (`RowDetailModal`, `page.tsx:5703-5750`): right-side `aside` (`dtbl__modal`), per-column `CellEditor`, formula cells read-only, delete-row icon, `×` close. Labels fall back to column letters.
  - Relation config (`relation-config-modal.tsx`): custom fixed overlay (not the shared `Dialog`), target table / link column / field / aggregate selects.
  - Trash (`table-trash-dialog.tsx`): list of soft-deleted rows, Restore, Delete permanently, Empty trash; 60-day copy.
  - Ask your data (`ask-data-dialog.tsx`): textarea + Ask, three example chips, answer card, "Answered from the first 300 rows" note.
  - Pivot (`pivot-dialog.tsx`): Rows (multi), Columns, Values (SUM/COUNT/AVERAGE/MIN/MAX), Table or Chart (bar/line/pie); **not persisted** (comment at top).
  - Named ranges (`named-ranges-dialog.tsx`): name + ref + Add, list with Remove; persists to `DataTable.settings`.
- **States**: loading = `ValueLoader` inside `frmb__loading` (`page.tsx:3396`); error = `frmb__error` text "Couldn't load table: HTTP nnn" with no retry.
- **UI state**: polished grid mechanics, rough/inconsistent chrome.
- **Issues** (details in section 3): no column naming UI; no column type UI; org-wide tab bar; instant public toggle; right-click-only discoverability; three styling systems in one page; no sheet-level menu (rename/delete/duplicate/move/description); formula cells show `[object Object]` in the public embed; no mobile.

### 2.3 `/forms` (Forms overview)

- **File**: `app/(dashboard)/forms/page.tsx`
- **Title / purpose**: "Forms" card grid; subtitle "N forms · P public · S submissions".
- **Reachable from**: TablesSidebar bottom row "Forms"; More launcher -> Forms; `/templates` hint; `?new=1` (only fires if arriving via the Forms app's own createAction, which needs `activeAppKey === "forms"`).
- **Back button**: none.
- **Top bar**: global only.
- **Sidebar**: depends on entry path (see 4.2). Via the Tables rail: TablesSidebar (header "Tables", "+" = New sheet, "Forms" row highlighted). Via the More launcher: `FormsSidebar` = "All Forms", "My Forms" (`/forms?mine=1`), section Favorites "Star a Form to see it here".
- **Controls**: "AI generate" (prompt dialog -> `POST /api/forms/generate` -> creates -> navigates); "New form" (prompt dialog "Form name?" -> POST -> navigate); cards (name, Public/Org chip, description, submission count, "Edit >"). Empty state with "Create your first form".
- **States**: loading plain text; error red box; empty card.
- **UI state**: rough.
- **Issues**:
  - `mine=1` is never read by the page (`grep mine forms/page.tsx` -> no hits): "My Forms" is a dead filter that shows all forms.
  - "Star a Form to see it here" but there is no star control for forms anywhere and no favorites API for forms (`SidebarQuickStar` kinds: space/board/folder/table/doc/whiteboard/file; `sidebar-quick-star.tsx:8`).
  - Forms cannot be deleted from any UI. `DELETE /api/forms/[id]` exists (`api/forms/[id]/route.ts:49-60`) with zero callers (grep for `method: "DELETE"` in the forms pages -> none).
  - No card menu, no duplicate, no search/sort, no "view submissions" secondary CTA (the file header comment claims one, `page.tsx:5-6`).
  - Creation asks for a name in a generic prompt dialog while sheets are promptless: inconsistent create ceremony within the same hub.
  - "AI generate" puts the whole instruction in the prompt dialog's title; the prompt dialog is a bare text field.
  - Same `frmlist` template and same loader/error inconsistencies as `/tables`.

### 2.4 `/forms/[id]` (Form builder + submissions inbox)

- **File**: `app/(dashboard)/forms/[id]/page.tsx`
- **Title / purpose**: two-tab page: Build (fields + targets) and Submissions.
- **Reachable from**: `/forms` cards; board FORM view "Edit form"; doc form block "Open"; Activity; create menu "Form"; AI tool.
- **Back button**: `ArrowLeft` button -> `router.push("/forms")` (`page.tsx:223`). Not `BackButton`. Leaves with unsaved edits silently (no dirty guard, no `beforeunload`).
- **Top bar**: global only.
- **Sidebar**: same entry-path dependence as `/forms`.
- **Header controls** (`page.tsx:222-244`): title input (placeholder "Untitled form"); Public / Org-only label wrapping a native checkbox; "Share link" (copies `${origin}/forms/${id}/respond`); "Embed code" (copies an `<iframe src=/embed/forms/id>`; toast warns to set Public); "Save" (manual PATCH; disabled while saving).
- **Tabs**: Build; Submissions with count `em` (count comes from the initial GET and is not refreshed after new submissions arrive).
- **Build tab**: field cards (type chip, move up/down, delete, label input, Required checkbox, "Options (one per line)" textarea for select/multi_select); aside "Add a field" with 9 type buttons (Short text, Long text, Number, Email, URL, Date, Single choice, Multiple choice, Checkbox); "Send to board" `<select>` (loads `/api/studio/boards` and `/api/studio/boards/[slug]` for columns, `page.tsx:113-121, 140`: the legacy Studio API, while the submission handler pushes to the canonical Board/Item model via `createBoardItem`, `api/forms/[id]/submissions/route.ts:152-193`); "Send to table" `<select>` (loads `/api/tables`; silently empty when the Tables module is off because the 403 is swallowed, `page.tsx:146-153`); "Field mapping" grid (form field -> board column / table column, "(auto-match)" default).
- **Submissions tab**: `<details>` rows with date and "Org member" / "Anonymous"; answers per field. `take: 500` server-side, no paging, no export, no delete, no submitter name (only `submittedById` presence), no link to the created board item / table row.
- **States**: loading `ValueLoader` (`frmb__loading`); error text; submissions loading with `Loader2`; submissions empty state "Share the responder link from the top bar".
- **UI state**: rough.
- **Issues**:
  - Manual Save with no dirty indicator and no leave guard (data loss on Back / sidebar click / tab close).
  - "Share link" is not shareable outside the org: `/forms/[id]/respond` sits inside `(dashboard)` which redirects unauthenticated visitors to `/login` (`app/(dashboard)/layout.tsx:31-34`; edge gate `proxy.ts:186-197` when enabled).
  - Field type cannot be changed after adding; no drag reorder (chevrons only); no placeholder / help text / description editing although `placeholder` exists in the Field type (`page.tsx:35`); no preview of the responder; no form description field in the UI (API supports `description`, and AI-generated forms populate it, but the builder never shows or edits it).
  - No form settings at all: confirmation message, redirect, close date, response limit, one-response-per-user, notify-on-submit, collect email, theming.
  - Public/Org-only is a native checkbox inside a label; the list page calls the same state "Org"; the toggle is not the shared `ui/switch`.
  - "Send to board" mapping dropdown lists board fields from the Studio API which may not match the canonical Board schema keys used at submit time.
  - "Send to table" mapping shows table column `label`s; for sheet-born tables every label is `""` so the dropdown renders blank options, and label auto-match can never fire (see 3.1).
  - No delete, duplicate, move, owner, or version history.
  - Submissions cannot be exported or removed; no per-row link to the pushed board item / table row; "Org member" is not resolved to a person.

### 2.5 `/forms/[id]/respond` (in-app responder)

- **File**: `app/(dashboard)/forms/[id]/respond/page.tsx`
- **Title / purpose**: fill and submit a form while signed in.
- **Reachable from**: "Share link" clipboard; doc form block "Click to fill this form"; AI tool `responderUrl`.
- **Back button**: `BackButton fallbackHref="/forms"` (`page.tsx:109`): the only route in scope that follows the app convention.
- **Top bar / sidebar**: global shell + whichever sidebar the hub resolves (Tables).
- **Controls**: field inputs by type; Submit (disabled when no fields); success card with "Submit another response".
- **States**: loading `ValueLoader`; error card; empty "This form has no fields yet."
- **UI state**: rough.
- **Issues**:
  - Required-field validation is a modal `confirm` per missing field (`page.tsx:60`), one at a time, instead of inline errors.
  - Renders inside the OS canvas with `.resp { min-height: 100vh; padding: 60px 24px }` (os.css 16880) -> nested scroll and a 60px top gap under the topbar.
  - Not public (dashboard auth), yet it is what "Share link" hands out.
  - Checkbox field label is hard-coded "Yes"; no placeholders; number field stores `""` when cleared.

### 2.6 `/embed/forms/[id]` (chrome-less public embed)

- **File**: `app/embed/forms/[id]/page.tsx`
- **Title / purpose**: iframe-able responder for external sites and the board FORM view.
- **Reachable from**: "Embed code" snippet; board FORM view iframe (`board-form-view.tsx:198`) and its "Copy link" (copies the embed URL, `board-form-view.tsx:100`).
- **Back button**: none (embed).
- **Controls**: fields; Submit; success card (no "submit another").
- **States**: `Loader2` with inline `@keyframes`; error text; `alert()` for validation and submit failure (`page.tsx:50, 61`).
- **UI state**: broken for its stated purpose.
- **Issues**:
  - Loads the definition from `GET /api/forms/[id]`, which requires a session (`api/forms/[id]/route.ts:11-13` via `getSessionOrFail`, `lib/api-helpers.ts:9-15`). An anonymous visitor on an external site gets "Couldn't load this form: HTTP 401" even when `isPublic = true`. Only the submission POST honours `isPublic` (`submissions/route.ts:60-61`). There is no `/api/public/forms` (only `api/public/{docs,run,sign,tables}`). Public forms therefore do not work outside the app; the board FORM view only works because the viewer is signed in.
  - Entire palette is hard-coded hex with a purple gradient icon (`#5559DF -> #A25DDC`, `page.tsx:147`) and a `#1f2937` charcoal button: violates the YBRG "no purple, blue primary" palette and ignores `--os-*` tokens and theme.
  - Duplicates the responder's `FieldInput` logic verbatim (two copies to maintain).

### 2.7 `/embed/tables/[id]` (public read-only table)

- **File**: `app/embed/tables/[id]/page.tsx`
- **Title / purpose**: read-only HTML table for public tables.
- **Reachable from**: "Copy public embed snippet" in the sheet title row (only when `isPublic`).
- **Back button**: none.
- **Controls**: none (static table, horizontal scroll).
- **States**: loader, "Table not found or not public", "No rows yet."
- **UI state**: rough.
- **Issues**:
  - Formula cells are stored as `{ "=": source }` objects and computed values are never persisted (`page.tsx:4441-4447` in the sheet page); the embed renders them with `String(v)` -> literally `[object Object]` (`embed/tables/[id]/page.tsx:62`). Reserved `$fmt` / `$rh` keys are not columns so they do not leak, but cell styles are ignored.
  - Column headers use `c.label`, blank for every sheet-born table (see 3.1) -> a header row of empty cells.
  - 5000-row cap with no paging or search; hard-coded teal gradient and grey palette; no theme.

### 2.8 Board FORM view (cross-subsystem, inside `/boards/...`)

- **File**: `components/board-view/board-form-view.tsx`; registered in `view-create-popover.tsx:43` ("Form", tag "Survey") and `board-canvas.tsx:459`.
- **Setup card**: "Connect a form to this List": Create intake form (creates "Intake form" with Title + Details targeting the board), "Connect existing…" select, Cancel; non-editors see "Ask a List editor to connect a form."
- **Connected**: "Live form" header, Copy link (embed URL), Edit form (-> `/forms/[id]`), Change; iframe `height: calc(100vh - 320px)`.
- **Issues**: "Copy link" copies the chrome-less embed URL, which 401s for anyone not signed in (2.6); no submissions view on the board side; Tailwind zinc + `#0073EA` literal.

### 2.9 Doc embeds (cross-subsystem)

- `block-editor.tsx:2740-2860`: `form` and `data_table` blocks are picker lists followed by a link card ("Click to fill this form ->" / "Open this table ->"); nothing is rendered inline. `blocknote-canvas.tsx:634-635` and `legacy-embed-preserve.ts:15` treat both as legacy pass-through blocks in the new editor.

### 2.10 Settings and trash touchpoints

- Settings -> Modules (`app/(dashboard)/settings/modules/page.tsx`): one Switch per module ("Tables", chip "Google Sheets + Zoho Sheet"); admin-only. Forms has no settings page, no module toggle, no org policy.
- `/trash` (rail app `trash`, `requiredAccess: "hr-admin"`, `apps-catalog.tsx:1337-1341`): lists deleted tables for restore (`trash/page.tsx:27`). Row-level trash is the sheet's File -> Trash… dialog. Two trash concepts, two audiences.

## 3. Broken / confusing (ranked)

### 3.1 HIGH: columns cannot be named in the sheet
`page.tsx:1977-1982`: "NO UI reaches renameColumn since the header label input died (headers are pure letters now)". `kernelHeader` (`page.tsx:4402-4431`) renders only the letter and a lock icon. New sheets seed 26 columns with `label: ""` (`lib/sheet-new.ts:44-46`); `addColumn` / `insertColumnNear` also create `label: ""` (`page.tsx:1819, 1873`). Downstream consequences:
- Forms "Send to table" mapping and label auto-match (`submissions/route.ts:123-133`) operate on labels: blank options, no matches.
- `/embed/tables` header row is empty; Ask-your-data and Pivot send blank column names to the model / pivot UI; Trash preview and Row detail fall back to letters; Library cards say "26 columns".
- `[Header]` formula references (supported by the engine, `page.tsx:1983-1997`) are unusable.
- Only legacy tables (create-menu "Database", CSV import, older data) carry labels, so the same feature works or fails depending on how the table was born.

### 3.2 HIGH: column types cannot be set
`addColumn` and `insertColumnNear` always create `short_text`. The only type transitions are number/currency/percent through the toolbar pills (`routeNumberFormat`, `page.tsx:3490-3497`). "Configure relation" and "Edit formula" appear only on columns that already are link/lookup/rollup/formula. `select`, `multi_select`, `date`, `checkbox`, `rating`, `person`, `attachment`, `link`, `lookup`, `rollup`, column-level `formula` are unreachable on a fresh sheet. The filter bar lists only select/multi_select columns, so on any fresh sheet the filter dropdown offers "No filter" only.

### 3.3 HIGH: public forms do not work publicly
`/embed/forms/[id]` fetches the session-gated `GET /api/forms/[id]` (2.6). `/forms/[id]/respond` is behind dashboard auth (2.5) yet is the "Share link". The builder's Public toggle and the "Public" chip promise anonymous access that only the submit endpoint honours.

### 3.4 HIGH: form builder loses work
Manual Save, no dirty state, no leave guard on Back / sidebar / tab close (`forms/[id]/page.tsx:156-176, 223`).

### 3.5 HIGH: forms cannot be deleted; tables can only be deleted via right-click
No delete control on `/forms` or `/forms/[id]`. Sheets: right-click in sidebar (`tables-sidebar.tsx:207-214`), right-click on a bottom tab (`page.tsx:5684-5691`), or Space-tree "..." (`table-more-menu.tsx`). Nothing on the sheet page chrome itself.

### 3.6 MEDIUM: public embed renders formulas as `[object Object]` (2.7)

### 3.7 MEDIUM: the Forms app has two sidebars
Arriving via the Tables rail shows TablesSidebar (header "Tables", "+" creates a sheet) on `/forms`; arriving via More shows FormsSidebar. "My Forms" filter is dead; Favorites section can never fill.

### 3.8 MEDIUM: bottom tab bar = every sheet in the org
`SheetTabsBar` (`page.tsx:5545-5551`) renders one tab per table in `/api/tables`. It reads as "sheets in this workbook" (Google Sheets) but is actually the whole org list, duplicated in the sidebar and the overview, each with its own fetch and refresh bus. Overflows horizontally with no grouping.

### 3.9 MEDIUM: public toggle on tables is a one-click, un-confirmed, any-member action
`page.tsx:4751-4758`; the API accepts `isPublic` from any org member (`api/tables/[id]/route.ts:65`). No policy, no audit, no "who can view" surface, no plain link (only an iframe snippet).

### 3.10 MEDIUM: discoverability of column/row actions
All column and row actions are right-click only (title hint "right-click for options", `page.tsx:4414`). There is no header chevron, no visible row handle for "Open row", no keyboard-shortcut reference.

### 3.11 MEDIUM: creation ceremony and naming are inconsistent
Four create recipes (section 1) and four names. Forms prompt for a name; sheets do not.

### 3.12 MEDIUM: "Send to board" uses the legacy Studio API
`forms/[id]/page.tsx:113-121, 137-145` (`/api/studio/boards*`) while submissions push into the canonical Board/Item model; the column keys offered in the mapping UI may not exist on the canonical schema.

### 3.13 LOW: Import CSV styled as an AI action (`tables/page.tsx:128`).
### 3.14 LOW: row counts inflate by the 1000 seeded blank rows (`tables/page.tsx:157`, `api/tables/route.ts:29`).
### 3.15 LOW: `Loading…` text vs `ValueLoader` vs `Loader2` across the same hub (section 4.3).
### 3.16 LOW: responder validation via modal confirms (2.5).
### 3.17 LOW: `frmb__*` (form builder) classes reused for the sheet's back/loader/error; `dtbl__*` legacy classes (viewtabs, head-btn, modal, col-head) still drive the filter bar, public toggle and row drawer; `dtbl__col-head input` CSS exists for a header input that no longer renders (os.css 16931).
### 3.18 LOW: table description is displayed on cards but editable nowhere in the UI (API accepts it, `api/tables/[id]/route.ts:62`). Form description likewise (AI fills it, builder never shows it).
### 3.19 LOW: saved `views` (grid/kanban/calendar/gallery, `page.tsx:99-105`, `schema.prisma:306-309`) have no switcher; `views[0]` is just the persistence slot for sort/filter/freeze.
### 3.20 LOW: `OsMainTable` (`main-table.tsx:415-426, 437`) ships an "Add column" header cell and a group "..." button wired to nothing (legacy demo component, not routed).
### 3.21 LOW: Pivot results are not persistable (dialog comment), so a pivot must be rebuilt every time.
### 3.22 LOW: Trash restore for whole tables lives in an hr-admin-only rail app while any member can delete a table (asymmetric).

## 4. Cross-cutting conventions observed

### 4.1 Back navigation
- `/tables/[id]` and `/forms/[id]`: custom `ArrowLeft` button -> `router.push(parent list)`; ignores where you came from (Space, Library, doc, favorites, board).
- `/forms/[id]/respond`: `BackButton fallbackHref="/forms"` (convention-compliant).
- List roots and embeds: none. No breadcrumbs anywhere in scope; the global topbar carries no page context.

### 4.2 Sidebar / hub
- One rail hub (Tables) hosts two apps; the folded Forms app's own sidebar renders only when activated from the More launcher. Sidebar header title is always the hub label ("Tables") on `/forms` when reached from the rail. The hub "+" creates a sheet even on Forms pages.
- TablesSidebar is a flat list (no Spaces, no folders, no recents, no search beyond the header filter); it duplicates the bottom tab bar and the overview grid.

### 4.3 Loaders
- Route transitions: `app/(dashboard)/loading.tsx` -> `ValueLoader` (values-as-loader convention).
- In-page initial loads: sheet editor, form builder, responder -> `ValueLoader`. List pages and TablesSidebar -> plain "Loading…" text. Submissions tab, dialogs, buttons -> `lucide` `Loader2` spinners (`frmb__spin` / `animate-spin`). Embeds -> `Loader2` with their own inline keyframes.

### 4.4 Empty / error states
- Lists: styled empty card with CTA; error = red box containing the raw `HTTP nnn`, no retry.
- Sheet: error = bare text; "Start sheet" for columnless tables; grid has no empty state (1000 blank rows).
- Builder: "No fields yet" card; submissions empty card; error text.
- Embeds: red text; `alert()` in the form embed.
- No route uses a shared EmptyState/ErrorState component from `ui/`.

### 4.5 Style consistency
- List pages, builder, responder: BEM classes on `--os-*` tokens (good) but with gradient icon tiles, drop shadows and a 3px gradient top bar on card hover (`.frmcard::before`), and black (`--os-ink`) primary buttons on the list pages vs brand-blue primaries in the builder/responder.
- Sheet page: `shx__*` BEM on tokens for title/toolbar/tabbar, inline hex (`#3f3f46`, `#a1a1aa`, `#fafafa`, `#d4d4d8`, `#e4e4e7`) in headers/grid/cell pickers, Tailwind `zinc-*` in dialogs and the add-column button, `#0073EA` / `#0060B9` literals in Named ranges / Trash / board form view, `var(--os-brand)` elsewhere. Three styling systems on one screen.
- Native `<details>` dropdowns for Zoom/123/File vs `MorePortal` + `MenuList` for context menus vs Radix `Dialog` for most dialogs vs a hand-rolled fixed overlay for the relation modal.
- Embeds: fully hard-coded, one with a purple gradient (palette violation).
- Font sizes: 13/13.5/14/14.5 mixed within the same screens; the sidebar uses 12/12.5/13/13.5/14.

### 4.6 Mobile / responsive
- No `@media` rules for `.frmlist`, `.frmcard`, `.frmb*`, `.resp*`, `.dtbl*`, or `.shx__*` except `@media print` (os.css 34135). The builder's `1fr 240px` grid with a sticky aside will not collapse; the toolbar does not wrap.
- The OS shell (rail + ClickSidebar) has no small-screen logic; the drawer rules in `app-shell.css:1499-1550` target the legacy `.app-sidebar`, not the OS shell.
- The grid is pointer-first: drag reorder, hover resize grips, right-click menus, `touchAction: none` on the gutter; no touch alternatives.

## 5. Access notes

- **Tables**: premium module; when off, `/tables/*` shows `ModuleDisabledScreen` (admins get a link to Settings -> Modules) and all `/api/tables*` return 403; the rail hides the hub, which also removes Forms' only rail home (Forms stays reachable via More/URL). Inside an active org: every member can create; read is gated by Space visibility for Space-scoped tables (`api/tables/route.ts:32-39`, `visibleSpaceIds`), org-wide when `spaceId` is null; write == read by decision (`docs/plans/tables.md:140-166`); no per-table roles, no view-only share, no lock, no owner shown. Any member can make any org-wide table public and can soft-delete any table; restoring whole tables needs the hr-admin Trash app. Favorites are per-user preferences.
- **Forms**: no module gate. Any org member can create, edit, retarget, publish, and (via API) delete any form; submissions are readable by all org members; there is no creator/owner gating and no per-form sharing. Anonymous submit is allowed only when `isPublic`, but anonymous load is impossible (3.3), so "Public" is not actually public. The builder's "Send to table" list silently empties when the Tables module is off.
- **Cross-org**: table and form reads are org-scoped (404 for other orgs); public table reads bypass auth by design.

## 6. Settings notes

Configurable today: module on/off (admin); per sheet: name (inline), public flag, star, freeze rows/cols, sort/filter (persisted into `views[0]`), column order/width/protection/validation/conditional format/formula/relation config, named ranges, row heights, per-cell styles, zoom (session only); per form: name, fields (label/required/options), public flag, board target, table target, explicit field mappings.

Should be configurable but is not: column names and types in the sheet; table description; move to Space / Space chip from the sheet; duplicate sheet; per-table access (view-only sharing, lock/publish); default new-sheet size (26x1000 is hard-coded); a plain public view link (not just an iframe snippet); form description, field placeholder/help text, field type change, confirmation message, redirect URL, notifications on submit, close date / response limit / one-per-user, anonymous-vs-identified collection, submission export/delete, embed theming, form delete/duplicate/owner; an org policy for who may make tables/forms public; any Forms settings page or module toggle; keyboard shortcut reference.
