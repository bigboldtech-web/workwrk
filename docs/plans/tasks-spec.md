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

> **Future phase (founder):** the **task detail view** — how a fully-created task looks (all info, activity,
> comments, subtasks, custom fields, relationships). Separate spec.

## 5. Build order (tasks)

1. **Context-aware list/space preselect** from the current route (small, high-value).
2. **Per-List statuses** — read a board's status set in views/kanban/picker instead of the 3 defaults; pipe Space-wizard statuses through. (Sets up Phase 2.)
3. **Task Types system** — `ItemType` model + seed defaults + manage page + recommended library + picker/column/filter. (Pending the architecture decision in §2.)
4. **Attachments external sources** — Dropbox/OneDrive/Box/Google Drive/New Google Doc via connectors.
5. **Template Center** — `Template` model + center UI + built-in library + save/apply (own phase; biggest).
6. **Phase 2 (next founder input):** edit-statuses UI + status templates.
7. **Future phase (founder):** task **detail view** (post-creation full task page).

## Open questions for founder
- §2 flag: Item-type re-skin vs route-to-dedicated-model for Objective/Key Result/Goal/Person.
- Statuses scope: per-**List** (ClickUp) or per-**Space** (our wizard) — or list inherits space + can override?
- Task Types cap (ClickUp shows "20") — any limit for us, or unlimited?
