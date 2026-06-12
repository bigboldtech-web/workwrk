# Views Catalog — every view type, elaborated (Plan, part 1 of the build series)

> Part of the founder's incremental spec series (views → board/task field options → list → …).
> Source refs: Monday "Views Center", Monday board "+", ClickUp "+ View" picker.
> Status legend: **✅ Built** (real renderer) · **🔧 Stub** (enum + picker tile exist, no renderer) ·
> **➕ New** (not in our enum/picker yet) · **🔗 Embed** (external iframe).
>
> Our substrate today: `ViewType` enum (13 values) · `View` model (`config` JSON per view) ·
> `board-canvas.tsx` switch (renders TABLE/KANBAN/CALENDAR/GANTT, rest stubbed) ·
> `view-create-popover.tsx` (Popular/Secondary/Embed tiles) · per-board view tabs with `?view=` ·
> Space-level views already built (Overview/List/Board/Calendar/Gantt/Team/Workload — Phases 44–56) that
> several board views can reuse.

---

## A. Core data views (render the board's Items)

| View | What it does | Data source | Our type | Status | Reuse / build notes |
|---|---|---|---|---|---|
| **List** | Flat or grouped rows; the default work view | Items + fields | `TABLE` | ✅ Built | `BoardTableView` (group-by, filter bar, summary footer) |
| **Table** (Monday grid) | Spreadsheet feel: full-cell colored status, group rails, summary row | Items + fields | `TABLE` + `config.grid="monday"` | ✅ Built | `gridStyle="table"` variant |
| **Board / Kanban** | Cards in columns by status (or any select field) | Items grouped by status | `KANBAN` | ✅ Built | `BoardKanbanView` (drag, card chips); add **group-by any field** + WIP limits |
| **Calendar** | Items placed on a month grid by date | Items.dueAt / DATE field | `CALENDAR` | ✅ Built | `BoardCalendarView` (drag-to-reschedule); add week/day modes |
| **Gantt** | Duration bars across weeks; dependencies | Items.startAt→dueAt | `GANTT` | ✅ Built | `BoardGanttView` (drag/resize); add **dependency arrows**, critical path |
| **Timeline** | Lighter horizontal time view (swimlanes by group) | Items dates | `TIMELINE` | 🔧 Stub | Like Gantt minus bars-detail; can fork `BoardGanttView` |
| **Cards** | Items as visual cards in a responsive gallery (not column-bound) | Items | `KANBAN` variant or ➕ | 🔧/➕ | Kanban without columns; reuse card component |
| **Workload** | Per-person capacity (over/under), assign to balance | Items by owner + estimate | `WORKLOAD` | 🔧 Stub | Reuse Space Workload card (Phase 52–55) per board |
| **Team** | Per-person kanban of their items | Items by owner | `DASHBOARD`(placeholder) → own type | 🔧 Stub | Reuse Space Team view (Phase 52–54) |
| **Map** | Items with a Location field pinned on a map | Items + LOCATION field | `MAP` | 🔧 Stub | Needs a maps lib + geocode; LOCATION field exists |
| **Chart** | Bar/line/pie/number of board data (count/sum by field) | Items aggregates | `CHART` | 🔧 Stub | Picker config: metric + group-by + chart type |
| **Pivot / Pivot Boards** | Two-axis grouping with aggregates (rows × cols) | Items grouped 2D | ➕ New | ➕ | New renderer; group-by row + col + agg |
| **Hierarchy** | Tree of parent → subtasks | Items.parentItemId | ➕ New | ➕ | We have subtasks; render an expand/collapse tree |
| **Activity / Feed** | Chronological log of changes | `ItemActivity` | `CHART`(placeholder) → own type | 🔧 Stub | Reuse `ItemThread` activity tab, board-wide |

## B. Content views (not an item grid)

| View | What it does | Our type | Status | Notes |
|---|---|---|---|---|
| **Doc / Wiki** | Embed a rich workdoc tab on the board | `DOC` | 🔧 Stub | We have `Doc` + block editor — embed it; store docId in `View.config` |
| **Form / Survey** | A public form whose submissions create Items | `FORM` | 🔧 Stub | We have Form model + form→Item push (now Item-backed); render builder + share link |
| **Whiteboard** | Freeform canvas tab | `WHITEBOARD` | 🔧 Stub | We have `Whiteboard` model; embed canvas |
| **Mind Map** | Node graph of items/ideas | `WHITEBOARD`(placeholder) → ➕ | 🔧/➕ | Could build on whiteboard or a graph lib |
| **File gallery** | Grid of files attached to the board | `FILE_GALLERY` | 🔧 Stub | We have Files + EntityLink; render thumbnails |
| **Dashboard / Report** | Widgets (numbers, charts, lists) over board data | `DASHBOARD` | 🔧 Stub | We have a dashboards app; add a board-scoped widget canvas |

## C. Agile / preset views (Monday) — mostly presets over B/A renderers

| View | Really a… | Status | Notes |
|---|---|---|---|
| **Sales pipeline** | Kanban preset (stages + value sum) | preset | Kanban grouped by stage + column sums |
| **Roadmap tracker** | Gantt/Timeline preset (quarters) | preset | Gantt with quarter buckets |
| **Velocity** | Chart preset (work done / sprint) | preset | Chart over sprint field |
| **Burndown** | Chart preset (remaining vs time) | preset | Chart |
| **Planned vs. unplanned** | Chart preset | preset | Chart |

> Presets = a base view type + a saved `config`. Build the base renderers (Kanban/Gantt/Chart) first;
> presets become one-click templates in the picker later.

## D. AI & embeds

| Item | What it does | Status | Notes |
|---|---|---|---|
| **Create with AI** | Describe a view/board in words → generate it | ➕ | Wire to Sidekick; generate `View.config` (group/filter/columns) from a prompt |
| **Any website / Google Sheets / Docs / Calendar / Maps / YouTube / Figma** | Iframe-embed an external URL as a board tab | 🔗 Embed | Add an `EMBED` path: store URL in `View.config.embedUrl`; render sandboxed iframe. Today these toast "coming soon" |
| **Embedded Airtable / Data Studio / Online Docs** (Monday apps) | Same embed pattern | 🔗 Embed | Covered by the generic embed |

---

## E. What this implies for the build (when we code views)

1. **Finish the stubbed renderers** in `board-canvas.tsx`, in value order:
   **Chart → Dashboard → Form → Doc → File gallery → Workload/Team → Timeline → Map → Whiteboard/Mind Map → Hierarchy → Pivot → Cards → Activity.**
2. **Clean the placeholder type-mappings** in `view-create-popover.tsx` (Team→DASHBOARD, Activity→CHART, Mind Map→WHITEBOARD): give each its own `ViewType` (migration: add `CARDS, PIVOT, HIERARCHY, ACTIVITY, TEAM, MINDMAP, EMBED` to the enum) OR drive variants via `View.config` (no migration) — decide per type.
3. **Each view stores its settings in `View.config`** (group-by, filters, columns, chart metric, embed URL, doc id, etc.) — already the pattern (hiddenFields/filters/grid live there).
4. **Reuse the Space-level renderers** (Workload/Team/List/Calendar/Gantt from Phases 44–56) — adapt to single-board scope, like we did for Calendar/Gantt.
5. **Database/Sheets view** ties to the separate DataTable plan (`plus-create-menu-plan.md`): a board can also surface a DataTable-style grid.

## F. Open questions for the founder (per view, when we spec deeper)

- Which views are **v1 must-haves** vs later? (My guess: Chart, Dashboard, Form, Doc, File gallery, Workload first.)
- For **embeds** — allow any URL, or a curated allow-list (Sheets/Docs/Figma/YouTube) for safety?
- **Cards vs Kanban** — do you want Cards as a distinct ungrouped gallery, or is Kanban enough?
- **Pivot / Hierarchy** — needed for v1, or later power-user views?
- Naming: keep ClickUp labels ("List", "Board") or Monday labels ("Table", "Kanban")? (We currently mix.)

> **Next inputs from founder (this series):** board/task field options → list options → … I'll fold each
> into its own doc and cross-link, then we code from the assembled plan.
