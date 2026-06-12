# ClickUp/Monday-parity Build Plan — INDEX (start here)

Capstone for the founder's spec series (2026-06-12). **Mission: ENHANCE the current WorkwrK system to full
ClickUp parity** (+ Monday's board/list/view types). **We are NOT removing or replacing anything** — Inbox,
Assigned Comments, My Work, Home, Docs(=Notes), Forms, Dashboards, Whiteboards all exist and **stay**; the
job is to make them **actually work and connect**. **Start from the "+"** (it creates & connects everything —
see `plus-create-menu-plan.md`).

The product is **one connected OS**: a ClickUp/Monday-style PPMS (**Space → Folder → List → Task** = our
**Space → Folder → Board → Item**, with **Views**) infused with **SOPs / KRAs / KPIs / OKRs**. Everything is
**connected** (Lego): fields defined on a List render in the table cell ⇄ task detail ⇄ board card ⇄
calendar/gantt, and link to Docs/SOPs/KRAs/Forms via `EntityLink`. Plan-only so far — no build yet. All specs
live in `docs/plans/`. _(Ignore any older "old OS vs new OS / retire" wording elsewhere — superseded; the
StudioBoard/duplicate-custom-fields cleanup already done in commit `bf0a39f` was dead-code removal and stays.)_

## The spec docs (read in this order)
1. **`views-catalog.md`** — every view type (List/Table/Board/Calendar/Gantt built; Chart/Dashboard/Doc/Form/
   File-gallery/Workload/Team/Map/Timeline/Pivot/Hierarchy/Cards/Activity stubbed) + embeds.
2. **`tasks-spec.md`** — task creation (context-aware list/space), Task Types, statuses, modal fields/extras/
   attachments/create-variants, **Template Center**, the **task detail view**, and **connection-as-field**.
3. **`lists-spaces-spec.md`** — List = Board(+views); Space wizard (presets/views/statuses/ClickApps/KRA);
   List/Space template bundles; **Space/Folder/List context menus**; group-status menu.
4. **`plus-create-menu-plan.md`** — the sidebar "+" menu redesign + **Database** (built on `DataTable`) +
   Doc/Form/Dashboard/Whiteboard create flows + Create-with-AI (= build an AI agent) + Templates/Import.
5. **`automation-hub.md`** (older) — event-driven automations; **deferred** until modules emit events.

## The 4 backbone systems (almost every spec points at these — build these and most of the plan unlocks)
1. **Per-List statuses** — replace the global 3 `DEFAULT_STATUS_OPTIONS` with `Board.statuses`
   `{value,label,color,group:ACTIVE|DONE|CLOSED}`; read them in views/kanban/picker; cascade from the Space
   wizard. Surfaces in: task status picker, list group menu, space/list context menu, space wizard.
   *(tasks-spec §3 = Task Phase 2.)*
2. **Template Center** — one `Template` model `kind = TASK|LIST|SPACE|FOLDER|DOC|VIEW|WHITEBOARD`, a center UI
   (Featured/Workspace/Org + filters + categories), a built-in library, save/apply (apply *materializes* the
   bundle: statuses + fields + views + seed items). Surfaces in: every create modal + every "…" menu.
3. **EntityLink connection graph** — already exists; extend so Docs/SOPs/KRAs/Items link **as fields** (columns)
   not just drawer sections (Linked-Doc / Linked-SOP field types + finish RELATIONSHIP). The "nodes" vision.
4. **Automation Hub** — designed, deferred; lights up "Automations" in the context menus + group-status menu.

## What's already built (don't rebuild — verified)
Board/Item PPMS · 4 view renderers (List/Table-Monday/Kanban/Calendar/Gantt) + drag/resize + summary footer ·
field system (44-type catalog, FieldShelf: create/add-existing/show-hide/reorder/option-editor) · priority/
tags first-class · assignee picker · create-task modal (types/extras/create-variants/templates-basic) ·
task detail drawer (status/owner/dates/priority/tags/fields/time/comments/activity + linked notes/whiteboards/
files/tables/SOPs) · Space wizard (presets/views/statuses/modules/KRA) · DataTable grid (9 col types, CSV,
embeds) · per-node "…" menus (rename/icon/favorite/archive) · `/api/me/items` (cross-board "my work").

## Recommended build sequence (when we code)
1. **Per-List statuses** (backbone #1) — unblocks task/list/space status everywhere.
2. **Finish stubbed view renderers** (Chart→Dashboard→Form→Doc→File-gallery→Workload/Team→Timeline→Map→
   Whiteboard→Hierarchy→Pivot→Cards→Activity).
3. **Template Center** (backbone #2) — `kind` TASK then LIST then SPACE.
4. **Connection-as-field** (backbone #3) — Linked-Doc/SOP fields + RELATIONSHIP.
5. **"+" menu redesign** + real Doc/Form/Dashboard/Whiteboard/**Database** create flows.
6. **Expand context menus** (Copy link/Duplicate/Move/Hide/Custom Fields/Task statuses/Templates/Sharing…).
7. **Context-aware task creation**, **Task Types** system, **full-page task detail**, **attachment sources**.
8. **Automation Hub** (backbone #4) + **AI agent builder** (Create-with-AI) — last, founder to detail.

## Pending founder inputs
- AI agent builder (Create-with-AI) detail · Super-Agent behavior · Space templates library (Marketing/
  Advertising) · Task Phase 2 edit-statuses UI detail · any remaining per-button "+" menu behaviors.

## Operational notes
- Two prod DB migrations are **local-only** (not on aaPanel): `Item.priority`+tags, and the StudioBoard/
  custom-fields drops. Run on prod before any `main` merge/deploy.
- `feat/alignment-system` is ~20 commits ahead of `main`; main = deploy branch. Don't `next build` while the
  user's `pnpm dev` runs (it corrupts `.next`). Verify with `tsc`/`eslint`.
