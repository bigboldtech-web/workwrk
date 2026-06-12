# List & Space Spec (founder spec series, part 3)

> After `views-catalog.md` + `tasks-spec.md`. Covers **List** and **Space** creation + the hierarchy.
> The whole PPMS hierarchy: **Space → List → Task**, which maps 1:1 to our models:
> **Space → Board → Item** (a "List" IS a `Board`; a "Task" IS an `Item`; views are `View` rows).

## 0. The core equivalence (founder, verbatim)

> "A List is basically nothing but a view — a Board which can be converted to a List, a Table, a Kanban,
> a Gantt. Customizable."

✅ This is exactly our architecture: one `Board` holds the Items + the field schema + the statuses, and
**Views** (List/Table/Kanban/Gantt/Calendar/…) are different lenses on it. So "create a List" = create a
`Board`; "convert to Table/Kanban" = switch the active `View`. **Terminology note:** ClickUp says *List*,
we say *Board* internally and already label the create tile "List" — keep "List" in the UI, "Board" in code.

## 1. Create List

**ClickUp modal (target):** Name* (e.g. Project, Campaign) · **Space (location)** picker · **Make private**
toggle · **Use Templates** (opens Template Center filtered to **List** templates) · Create.

**Our status (`create-list-modal.tsx`):** Name input · private toggle (✅ fixed) · template chips
(Trophy/Rocket/Timer — currently cosmetic) · creates a `Board`. **Gaps:**
- **Space (location) picker** — make it a real dropdown (default = current space / Personal Space).
- **Use Templates → Template Center (List filter)** — wire to the Template Center (see tasks-spec §4).
- After create: land on the new board with default views.

**A List template bundles (the Advertisement example):**
| Bundle part | Example | Our home |
|---|---|---|
| **Status group(s)** | 1 group (e.g. blue/green/grey + 3) | `Board.statuses` (per-list statuses — see tasks-spec §3) |
| **Custom Fields** | 11 (Allocated Budget, Publication Link, Release Date, Platform, Target Audience, Ad Type, Campaign, Ad Brief, Client, Caption, Ad Status) | `Board.schema.fields` |
| **View types** | 6 (List, Board, Team, Calendar, Doc, Table) | `View` rows |
| **Seed items** | sample rows | `Item` rows |
So **applying a List template** = create a Board, write its statuses + schema.fields + Views + seed Items.
This is the materialize path the Template Center must implement for `kind=LIST`.

## 2. Create Space

**ClickUp flow (target):** two steps —
1. **Create a Space:** Icon & name (e.g. Marketing/Engineering/HR) · Description (optional) ·
   **Default permission** (Full edit ▾) · **Make Private** toggle · **Use Templates** · Continue.
2. **Define your workflow:** pick a **pre-configured solution** (Starter · Marketing Teams ·
   Project Management · Product + Engineering) then customize defaults:
   - **Default views** (e.g. List, Board)
   - **Task statuses** (e.g. TO DO → IN PROGRESS → COMPLETE)
   - **ClickApps** (Tags, Time Estimates, Priority, Time Tracking, Incomplete Warning…)
   - Create Space.

**Our status — strong; the Space wizard already models this** (`space-wizard-step2.tsx` +
`space-wizard-presets.ts`):
| ClickUp piece | Our equivalent | Status |
|---|---|---|
| Pre-configured solutions | `PRESETS` / `workflowFromPreset` (Sales/Support/CS/Marketing presets, Phases 30/35) | ✅ |
| Default views | `WorkflowConfig.defaultViews` + `defaultViewKey` (views sub-screen) | ✅ |
| Task statuses | `WorkflowConfig.statuses` (statuses sub-screen) | ✅ |
| ClickApps | `WorkflowConfig.modules` (modules sub-screen) | ✅ (naming differs) |
| Icon & name · Make Private | new-space-dialog | ✅ |
| **+ KRA linking** | `linkedKraIds` (our PPMS extra — not in ClickUp) | ✅ bonus |
**Gaps:** **Default permission** dropdown (Full edit/Read/Comment); **Use Templates → Space templates**;
align "ClickApps" naming/labels; ensure the wizard-defined **statuses actually flow to the boards** created
in the space (the missing wire from tasks-spec §3).

**Space templates** (e.g. Marketing/Advertising) — **founder will send next**; a Space template bundles
Lists + their fields/statuses/views + docs + modules. Same Template Center, `kind=SPACE`.

## 2b. Management (right-click) menus — Space / Folder / List

Every hierarchy node has a "…" menu. ClickUp's are rich; ours are thin today.

**Full option set (ClickUp) + our status:**
| Option | Space | Folder | List | Our status |
|---|:-:|:-:|:-:|---|
| Favorite (Sidebar/Top, sections) | ✓ | ✓ | ✓ | ✅ (toggle; no sidebar/top sections) |
| Rename | ✓ | ✓ | ✓ | ✅ |
| Copy link | ✓ | ✓ | ✓ | ⚠️ missing |
| Create new (▸ submenu) | ✓ | ✓ | ✓ | ⚠️ partial (per-space "+") |
| Color & Icon / Folder color | ✓ | ✓ | ✓ | ✅ |
| **Automations** | ✓ | ✓ | ✓ | ⚠️ (Automation Hub deferred) |
| **Custom Fields** (opens field editor) | ✓ | ✓ | ✓ | ⚠️ open `FieldShelf` from here |
| **Task statuses** (opens status editor) | ✓ | ✓ | ✓ | ⚠️ status editor not built (tasks-spec §3 P2) |
| More (▸) | ✓ | ✓ | ✓ | ⚠️ |
| **List Info** | – | – | ✓ | ⚠️ |
| **Default task type** | – | – | ✓ | ⚠️ (needs ItemType — tasks-spec §2) |
| **Email to List** | – | – | ✓ | ⚠️ inbound-email→Item |
| Imports (▸) | ✓ | ✓ | ✓ | ⚠️ |
| Templates (▸ save/browse) | ✓ | ✓ | ✓ | ⚠️ → Template Center |
| Hide (Space only) | ✓ | – | – | ⚠️ stub |
| Move | – | ✓ | ✓ | ⚠️ (re-parent folder/list) |
| Duplicate | ✓ | ✓ | ✓ | ⚠️ missing |
| Archive | ✓ | ✓ | ✓ | ✅ |
| Delete | ✓ | ✓ | ✓ | ⚠️ (we soft-archive; hard delete TBD) |
| **Sharing & Permissions** | ✓ | ✓ | ✓ | ⚠️ partial (board Share dialog exists) |

Files: `space-more-menu.tsx`, `folder-more-menu.tsx`, `board-more-menu.tsx` (today: rename / icon&color /
favorite / archive [+ share on board]). **Build:** expand all three to the full set, routing the heavy ones
to existing systems — Custom Fields → `FieldShelf`; Task statuses → new status editor; Templates → Template
Center; Automations → Automation Hub (deferred); add Copy link / Duplicate / Move / Hide / Sharing.

### List group-status "…" menu (per status group in a List view)
**Rename · New status · Edit statuses · Collapse group · Hide status · Select all · Collapse all groups ·
Automate status.** Plus the **"Set up your List"** hint row: *Create new fields · Copy settings from another
list · Get AI suggestions*. (Edit-statuses + Automate-status tie to tasks-spec §3 Phase 2 + Automation Hub.)

### Space template bundle (Marketing Team Operations example)
A **Space** template bundles: **Status groups** (multiple: COMPLETE/PLANNED/IN PROGRESS/CANCELLED/OPEN) ·
**ClickApps** (6: Priorities, Tags, Time Estimates, Custom Fields, Dependency Warning, Multiple Assignees) ·
**View types** (List/Doc/Whiteboard) · (also Lists/Folders/Docs/OKRs). Materialize path for Template Center
`kind=SPACE`: create Space + workflow (statuses/modules/views) + child Lists + their fields/views + docs.

## 3. Hierarchy & "everything connects" (recap)

`Space` (team/dept, owns workflow defaults + apps + permissions)
 └─ `List`/`Board` (statuses + field schema + views)
     └─ `Task`/`Item` (values in metadata; fields render in table cell ⇄ task detail ⇄ card; links to
        SOPs/Forms/Docs/Tables via EntityLink)
Workflow defaults set at Space level **cascade** to new Lists; a List can override. (Decision in
tasks-spec §3: statuses per-List, inheriting Space defaults.)

## 4. Build order (lists & spaces)

1. **List modal**: real Space-location picker + land-on-board; wire template chips → Template Center.
2. **Per-List statuses wired from Space wizard** (shared with tasks-spec §3, build step 2).
3. **Default permission** on Space + cascade of workflow defaults (views/statuses/modules) to new Lists.
4. **Template Center `kind=LIST` and `kind=SPACE`** materialize paths (shared with tasks-spec §4 / Template Center).
5. **Space templates** library (Marketing Team Operations etc.) via Template Center `kind=SPACE`.
6. **Expand the Space/Folder/List "…" menus** to the full ClickUp set (Copy link, Duplicate, Move, Hide,
   Custom Fields → FieldShelf, Task statuses → status editor, Templates, Sharing & Permissions, List Info,
   Default task type, Email to List); add the group-status "…" menu (rename/new/edit/hide/automate status).

## Open questions
- Keep our **KRA-linking** in Space creation (PPMS bonus) — yes? (Recommend yes.)
- "ClickApps" — keep ClickUp's name, or our "Modules"/"Apps"?
- Default permission levels we support (Full edit / Comment / Read / Guest)?
