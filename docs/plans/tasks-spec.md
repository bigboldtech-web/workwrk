# Task Spec — Phase 1 (creation context · task types · statuses intro)

> Founder spec series, part 2 (after `views-catalog.md`). **Phase 1 of tasks** — context-aware creation,
> Task Types system, and a first look at Statuses. **Phase 2 (next): edit-statuses, status templates, more.**
> Current surface: `create-task-modal.tsx` (the "+" → Task modal), `board-items-shared.ts` (statuses),
> Space wizard (`space-wizard-step2.tsx`, per-Space statuses).

---

## 1. Context-aware "Select List" (where the task lands)

**Rule (from founder):** the destination is auto-chosen by *where you trigger create from*:
| Trigger location | Behavior |
|---|---|
| Inbox / global "+" / anywhere with no context | Show **"Select List…"** picker (user must choose) |
| Inside a **Space** (space open on the right) | Auto-select that **Space** (still pick a list within, or default list) |
| Inside a **List/Board** (board open, or its "+") | Auto-select that **List** — don't ask |
| Any contextual "+" (board toolbar, list row) | Auto-select that context |

**Today:** `createTaskPreselect` (shell context) preselects when opened from a board's "+ Task" button;
otherwise the modal shows "Select List…". **Gap:** generalize preselect to derive from the *current route*
(space page → space; board page → that board/list) so every "+" is context-aware, and only Inbox/global
shows the picker. Keep last-used list in `localStorage` as the fallback.

## 2. Task Types

**ClickUp model (target):** a task isn't only a "task" — it can be re-typed (Milestone, Bug, Deal, Person,
Objective…). Each type = name + icon; tasks of that type re-skin slightly and are filterable/groupable by type.

**Defaults (built-in):** Task (default) · Milestone · Form Response · Meeting Note.

**Manage page ("Task Types"):**
- Lists the org's active types (Name + Created by) with a usage meter ("N of 20 used").
- **Create Task Type** modal: **Icon** (picker) · **Singular name** (≤16) · **Plural name** (≤16) ·
  **Description** (≤100). [name singular required]
- **Recommended library** (one-click "Add"), each with a **Category**:
  Account · Asset · Bug · Campaign · Content · Deal · Goal · Initiative · Key Result · Lead · Objective ·
  Person · Project · Request · Resource · User Story …
  Categories: Finance & Accounting · Creative & Design · IT · Software Development · Marketing ·
  Sales & CRM · HR & Recruiting · Operations · PMO · Personal Use · Support.
- Filter by category; search.

**Today vs target:**
- Today: 4 hardcoded `TaskTypeKey`s in `create-task-modal.tsx`, persisted as `metadata.taskType` (form re-skins). No custom types, no manage page, no icon/plural/category.
- **Build (target):** a new org-level **`ItemType`** model `{ id, organizationId, singular, plural, icon, description, category?, isDefault, builtIn }`, seeded with the 4 defaults; `Item.itemTypeId` (or keep `metadata.taskType` → migrate to a real column). New **/settings/task-types** manage page (list + create modal + recommended library seed). Type picker in the create modal + a board column/filter/group-by "Type". The `?` help + "Edit" link in the picker opens the manage page.

> **⚠️ Architecture flag:** several recommended ClickUp types overlap our **dedicated models** — *Objective*,
> *Key Result*, *Goal* ↔ our **OKR/KRA/KPI**; *Person* ↔ **User**; *Bug/Request* could be SOP-driven.
> Decision needed: do those types **re-skin an Item** (ClickUp's flat model) or **route to the dedicated
> model** (our PPMS model)? Recommend: Item-types are presentational re-skins for board work; keep
> OKR/KRA/KPI as their own first-class systems, and *optionally* link an Item to them via EntityLink rather
> than duplicating. **[NEEDS FOUNDER DECISION]**

## 3. Statuses (intro — full edit/templates in Phase 2)

**ClickUp model (target):** statuses are **per-List** and grouped:
- **Active group** (Not Started/Active): e.g. TO DO, PLANNING, IN PROGRESS, AT RISK, UPDATE REQUIRED, ON HOLD
- **Done group**: COMPLETE
- **Closed group**: CANCELLED
Status picker has search; each status has a color + group; the "done"/"closed" markers drive completion logic.
Statuses are editable per list and **saveable as reusable templates** (Phase 2).

**Today vs target:**
- Today: global `DEFAULT_STATUS_OPTIONS` (TO_DO, IN_PROGRESS, DONE — 3, in `board-items-shared.ts`); board
  views render these. BUT a real foundation exists: the **Space wizard** defines per-Space statuses
  (`workflow.statuses` with presets per vertical — Sales/Support/CS), and the create modal has a
  `statusCache` keyed by `spaceId`. So per-space status sets are modeled but **board views ignore them**
  and use the 3 defaults.
- **Build (target, spans Phase 1→2):** make statuses **per-List/Board** (stored on `Board.schema.statuses`
  or a `Board.statuses` JSON) with `{ value, label, color, group: ACTIVE|DONE|CLOSED }`; board views +
  kanban columns + status picker read them instead of `DEFAULT_STATUS_OPTIONS`; wire the Space-wizard
  statuses through to the boards created in that space. **Phase 2 (founder will detail):** the edit-statuses
  UI, status **templates** (save/store/apply), reordering, group assignment.

## 4. Task modal fields, extras, attachments, create-variants, Templates

`create-task-modal.tsx` is Item-backed (`POST /api/boards/[id]/items`). Status today:

| Control | Target (ClickUp) | Our status |
|---|---|---|
| List picker · Type picker · Task Name · Description (+AI) · Status · Assignee · Due date · Priority · Tags | core fields | ✅ Built |
| **"…" more** | Time Estimate · Dependencies · Subtasks · Checklist | ✅ Built (`ExtraKey`) — Dependencies is UI-stub |
| **Create button ▾** | Create and **open** · Create and **start another** · Create and **duplicate** | ✅ Built (`handleCreate` variants) |
| **Attachments (📎)** | Upload file · **Dropbox · OneDrive/SharePoint · Box · Google Drive · New Google Doc** | ⚠️ **Local upload only** (`/api/upload`); external sources missing |
| **Templates** | full Template Center (below) + save-as-template | ⚠️ Basic — `/api/item-templates` saves/applies a modal **config snapshot**; no gallery |

**Attachments — build:** add external-source picker rows (Dropbox/OneDrive/Box/Google Drive/New Google Doc)
behind OAuth connectors; each returns a URL → stored as a `FileEntry` + linked via `EntityLink` (same path
local uploads already use). Gate behind "connect account" if not linked. **[NEEDS FOUNDER: which sources for v1]**

### Template Center (the big one)

**ClickUp model (target):** a center with left nav **Featured · Workspace Templates · {Org} Templates (N)**;
filters: **Template Types** (Space / Folder / List / **Task** / Doc / View / Whiteboard), **Complexity**
(Beginner / Intermediate / Advanced), **Use Cases**, **Tags**, **Created by**; search; category sections
(Marketing, Operations, …). Each template is a **pre-built artifact** — e.g. "Social Media Content Plan"
applies a full task with description (Getting-Started guide), subtasks, and **custom fields**
(Designer/Editor=People, Copywriter=People, Month=Dropdown, Platform=Label, Content Progress=Progress-Auto).
Users can **save any task/list/space as a custom template** and reuse.

**Our status vs target:**
- Today: `/api/item-templates` stores a **task modal config snapshot** (status/priority/tags/checklist/
  subtasks/description) per org; the modal's Templates button lists + applies them. No gallery, no template
  *types* beyond task, no complexity/use-case/category metadata, no pre-built library.
- **Build (target, its own phase):** a `Template` model `{ id, organizationId, kind: SPACE|FOLDER|LIST|TASK|
  DOC|VIEW|WHITEBOARD, name, description, complexity?, useCases[], tags[], category?, payload JSON, builtIn,
  createdById }`; a **Template Center** modal (left nav + filters + grid); seed a built-in library;
  "save as template" from task/list/space; **apply** materializes the payload (for TASK → fill the modal;
  for LIST → create a board with fields+statuses+views+seed items).
  **⚠️ Custom-fields nuance:** ClickUp task templates carry custom fields, but in our model fields live on the
  **Board** (`Board.schema.fields`), not the task. So a task template that "includes custom fields" really
  implies a **List template** that sets up the board's fields. Map template fields → board schema on apply.

## 4b. Task Detail View + the connection principle ("Lego")

**Core principle (founder, repeated):** a task is *connected to everything*. The custom fields defined on a
**List/Board** automatically appear **inside every task** of that list, are editable there, and **carry across
views** (table column ⇄ task field ⇄ board card ⇄ calendar/gantt). Fields can also link to **SOPs, forms, docs,
sub-items** — "fields can have nodes." This is the same `Board.schema.fields` + `Item.metadata` + `EntityLink`
graph we already use; the detail view is just another surface onto it.

**ClickUp task detail layout (target):** full-page/overlay with —
- Header: type picker · breadcrumbs · subtask/attachment counts · Created date · Ask AI · Share.
- Top block: **Status · Assignees · Dates (start→due) · Priority · Time estimate · Track time · Tags**.
- Description (+ "Ask Brain" AI: write description / summary / find similar).
- **Fields** section — every list field inline (select/text/number/money/date/people/progress/location…),
  with **search · expand · + add · "Hide N empty fields"**.
- **Subtasks** — mini-table (Name · Assignee · Priority + add columns), Sort, AI Suggest, Show N closed.
- **Relate items / add dependencies** · **Create checklist** · **Attachments** (drop-to-upload, grid/list).
- Right rail: **Activity** feed (created/assigned/follower/field-change log) + **Comments** composer
  (mentions, emoji, attach, slash, voice).

**Our status vs target — most of it is built** (`BoardItemDrawer` + `FieldShelf`, Phases 1–8 + 5):

| Detail element | Our status |
|---|---|
| Title · Status · Assignee · Start/Due · Priority · Tags | ✅ `BoardItemDrawer` |
| Description (+AI placeholder) | ✅ (AI is a stub) |
| **Fields grid** (list fields render inline, editable) | ✅ via `FieldValue` over `Board.schema.fields` |
| Time tracking | ✅ `TimeTracker` |
| Comments + Activity | ✅ `ItemThread` (comments + auto-logged activity) |
| Linked **Notes / Whiteboards / Files / Tables / SOPs** ("nodes") | ✅ `LinkedAttachments` (EntityLink) |
| Subtasks | ✅ data + table-view nesting; ⚠️ **no inline subtask mini-table in the drawer yet** |
| Relate/Dependencies · Checklist | ⚠️ stubs |
| "Hide N empty fields" · field search/expand in detail | ⚠️ not yet |
| **Full-page** task view (vs 480px side drawer) | ⚠️ we have the drawer; a full-page route is a gap |

**Fields panel ("Create new" / "Add existing") — founder: "we have this, make sure it works":**
- ✅ Built (`FieldShelf`, Phase 5): Create-new (44-type catalog, grouped) · Add-existing (copy from sibling
  board) · per-view show/hide · drag-reorder · choice-option editor.
- ⚠️ Gaps vs ClickUp's panel: a **"Suggested"** group (context-aware field ideas) · **AI fields**
  (Summary/Custom Text/Custom Dropdown) · the **"Add existing → Shown/Hidden" toggles for BUILT-IN fields**
  (Status, Start date, Time tracked, Dependencies, Task Type, Lists, Linked Docs…) — today show/hide only
  covers *custom* fields, not the built-in columns. **Verify end-to-end + close these gaps.**

**Connection-as-field (Docs / SOPs / KRAs as "nodes" — founder):** beyond the drawer's "Linked X" sections,
a **Doc / SOP / KRA can be attached to a task as a field** (a board column whose value links the entity, shown
in the table cell *and* the task detail). Today: **KRA field** exists (✅); **Docs/SOPs link only via the
drawer** LinkedAttachments (EntityLink), not as columns; **RELATIONSHIP** field is a stub. **Build:** add
**Linked-Doc** and **Linked-SOP** field types (mirror the KRA field, backed by EntityLink) + finish
**RELATIONSHIP** (link any Item/Doc/SOP/KRA/Form). This makes the "fields can have nodes" vision concrete:
the same EntityLink graph surfaces as either a drawer section or a first-class column.

**Build (task detail phase):** (a) add a **full-page task route** that reuses the drawer's sections;
(b) inline **subtask mini-table** + **checklist** + **relate/dependencies** in the detail; (c) "hide empty
fields" + field search in the detail; (d) extend FieldShelf "Add existing" to toggle **built-in** field
visibility + add Suggested/AI groups; (e) confirm the same field set renders identically across table/board/
calendar/gantt (the connection principle).

## 5. Build order (tasks)

1. **Context-aware list/space preselect** from the current route (small, high-value).
2. **Per-List statuses** — read a board's status set in views/kanban/picker instead of the 3 defaults; pipe Space-wizard statuses through. (Sets up Phase 2.)
3. **Task Types system** — `ItemType` model + seed defaults + manage page + recommended library + picker/column/filter. (Pending the architecture decision in §2.)
4. **Attachments external sources** — Dropbox/OneDrive/Box/Google Drive/New Google Doc via connectors.
5. **Template Center** — `Template` model + center UI + built-in library + save/apply (own phase; biggest).
6. **Task Detail View** — full-page route reusing the drawer; inline subtask mini-table + checklist +
   relate/dependencies; "hide empty fields"; extend FieldShelf "Add existing" to built-in fields +
   Suggested/AI groups; verify the field set renders identically across all views (connection principle).
7. **Phase 2 (next founder input):** edit-statuses UI + status templates.

## Open questions for founder
- §2 flag: Item-type re-skin vs route-to-dedicated-model for Objective/Key Result/Goal/Person.
- Statuses scope: per-**List** (ClickUp) or per-**Space** (our wizard) — or list inherits space + can override?
- Task Types cap (ClickUp shows "20") — any limit for us, or unlimited?
