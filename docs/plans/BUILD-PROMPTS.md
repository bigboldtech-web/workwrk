# Build Prompts for Fable 5 — WorkwrK → ClickUp/Monday parity

How to use: paste **PROMPT 0** first (orientation). Then paste **PROMPT 1**, let it finish + commit, review,
then paste **PROMPT 2**, etc. Every prompt already contains the PREAMBLE, so each is self-contained.

---

## ▶ PREAMBLE (baked into every prompt below — don't skip)

```
You are enhancing an existing production app — WorkwrK — toward full ClickUp parity (plus Monday's
board/list/view types). Repo: /Users/bigboldtechnologies/theywrk (Next.js App Router, Prisma/Postgres, code
in src/). Branch: feat/alignment-system (work here; do NOT merge to main).

MISSION FRAMING — read carefully:
- ENHANCE, do not remove or replace. Inbox, Assigned Comments, My Work, Home, Docs(=Notes), Forms,
  Dashboards, Whiteboards already exist and must keep working. The job is to make the pieces actually work
  and connect like ClickUp/Monday.
- Read docs/plans/00-index.md FIRST, then the spec doc named in the prompt (views-catalog.md / tasks-spec.md /
  lists-spaces-spec.md / plus-create-menu-plan.md). These are the source of truth.

HARD RULES (violating these breaks the user's running app — they are non-negotiable):
1. The user runs their OWN `pnpm dev` on http://localhost:3000. NEVER run `next build`, `npm run build`, or
   start a second dev server — `next build` overwrites the same .next/ the dev server uses and white-screens
   the app. To verify, use `npx tsc --noEmit` (ignore errors under .next/dev/types — those are stale
   generated files) and `npx eslint <changed files>`. You cannot log in / visually verify (auth gate) — rely
   on tsc + eslint + careful reading. Never ask the user to enter passwords.
2. Prisma migrations: the shadow DB is broken, so `prisma migrate dev` FAILS. Hand-author the SQL under
   prisma/migrations/<UTC-timestamp>_<name>/migration.sql and run `npx prisma migrate deploy` + `npx prisma
   generate`. Apply to local Neon only; production (aaPanel) deploy is a separate step the user does. Keep
   migrations additive/safe. Date.now() is fine in app code (not in plan scripts).
3. AGENTS.md: this is a customized Next.js — if unsure about a Next API, read node_modules/next/dist/docs
   before writing.
4. Commit each logical unit on feat/alignment-system with a clear message ending:
   Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>. Do not push unless asked.
5. Match existing code style (client islands, native <details>/popovers, fetch-based mutations, Tailwind +
   CSS vars like var(--os-brand)). Reuse before building new — the index lists what already exists.

ARCHITECTURE (the model mapping):
Space → Folder → Board(=List) → Item(=Task). Views = `View` rows (config JSON per view). Statuses today are a
global 3 in src/lib/board-items-shared.ts (DEFAULT_STATUS_OPTIONS). Fields = Board.schema.fields (JSON) +
values in Item.metadata. Cross-entity links = EntityLink (Docs/SOPs/KRAs/Files/Tables/Whiteboards/Items).
Live shell = OsShell → click-topbar/click-app-rail/click-sidebar. The "+" create menu = CreateMenu in
src/components/layout/os/click-sidebar.tsx.

WORK STYLE: plan briefly, then implement; after each change run tsc + eslint; keep diffs focused; report what
you did + how you verified. If a step needs a product decision the docs don't answer, make the sensible
ClickUp-parity choice, note it, and continue.
```

---

## ▶ PROMPT 0 — Orientation (paste first)

```
[PASTE PREAMBLE]

Task: Orient yourself, do NOT change code yet.
1. Read docs/plans/00-index.md, then skim plus-create-menu-plan.md, views-catalog.md, tasks-spec.md,
   lists-spaces-spec.md.
2. Run `git log --oneline -8` and `git status` to confirm you're on feat/alignment-system with a clean tree.
3. Confirm the dev server is up: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login`
   (expect 200). If it's not 200, STOP and tell the user to run `pnpm dev` — do not start one yourself.
4. Reply with: a 5-bullet summary of the mission, the 4 backbone systems, and the build order you'll follow
   (Phases 1–9 below). Then wait for the user to paste PROMPT 1.
```

---

## ▶ PROMPT 1 — "+" menu chrome + real create flows (start here; low risk, no migration)

```
[PASTE PREAMBLE]

Spec: plus-create-menu-plan.md §3, §4, §7.
Goal: make the sidebar "+" create menu clean (ClickUp-style) and give every item a REAL create flow.

Do, in order, committing after each:
1. CHROME: refactor CreateMenu in src/components/layout/os/click-sidebar.tsx into one reusable row component;
   sections Create / AI / Build / Footer per the spec; add a **Database** item; keep the existing AI input
   row. Reuse ui/chip.tsx, ui/accent.ts, ui/switch.tsx. No behavior change yet beyond layout.
2. REAL CREATE FLOWS (kill the dead ?new=1): for Doc, Form, Dashboard, Whiteboard — add a small inline
   "New X" step (name + location where relevant) that calls the existing API (POST /api/docs, /api/forms,
   /api/whiteboards, dashboards) and navigates to the created entity. Verify each API exists first
   (ls src/app/api/...); if an entity's create API is missing, create a minimal one following the sibling
   pattern.
3. DATABASE item: wire it to create a DataTable (POST /api/tables) with a name + default columns, then open
   /tables/[id]. (DataTable grid already exists — Phases 32–38.)
4. IMPORT (footer): keep navigating to /imports for now (CSV exists); leave a TODO for inline sources.
   TEMPLATES (footer): keep navigating to /templates for now (full Template Center is Phase 4).
Verify: npx tsc --noEmit (ignore .next/dev/types), npx eslint on changed files. Report what each "+" item now
does. Commit.
```

---

## ▶ PROMPT 2 — Per-List statuses (backbone #1)

```
[PASTE PREAMBLE]

Spec: tasks-spec.md §3 + 00-index "backbone #1".
Goal: each Board(=List) has its OWN status set instead of the global 3. Status = {value,label,color,
group: ACTIVE|DONE|CLOSED}.

1. MIGRATION (hand-authored): add Board.statuses Json? (null = use default). Default helper getBoardStatuses(board)
   returns the board set or the canonical default (TO_DO→ACTIVE, IN_PROGRESS→ACTIVE, DONE→DONE). Put it near
   src/lib/board-items.ts. prisma migrate deploy + generate on local.
2. READ PATH: thread the board's statuses from src/app/(dashboard)/boards/[slug]/page.tsx → BoardCanvas →
   every renderer (board-table-view StatusCell/STATUS_BY_VALUE/group buckets/Monday fill/summary segments,
   board-item-drawer StatusPicker, board-kanban-view columns, calendar/gantt colors, board-filter-bar status
   facet). Replace uses of DEFAULT_STATUS_OPTIONS/STATUS_LOOKUP with the board's set. Fix hardcoded "DONE"
   checks (overdue, kanban) to use the board's DONE-group.
3. STATUS EDITOR UI: a panel to add/rename/recolor/delete/reorder statuses + assign group; reachable from the
   board (settings cog / context menu "Task statuses" / list group "Edit statuses"). PATCH /api/boards/[id]
   { statuses }.
4. CASCADE: when a Board is created in a Space, seed its statuses from the Space wizard's workflow.statuses
   (space-wizard-presets.ts). New standalone boards get the default.
Verify tsc + eslint. Commit per sub-step (migration; read-path; editor; cascade).
```

---

## ▶ PROMPT 3 — Finish the stubbed view renderers

```
[PASTE PREAMBLE]

Spec: views-catalog.md (status table) + board-canvas.tsx (the switch; TABLE/KANBAN/CALENDAR/GANTT are real,
the rest are stubs).
Goal: build the missing view renderers, reusing the Space-level versions (Phases 44–56) and board-view
components. Order: Chart → Dashboard → Form → Doc → File gallery → Workload → Team → Timeline → Map →
Whiteboard → Hierarchy → Pivot → Cards → Activity. Decide per type whether to add a ViewType enum value
(migration) or drive it via View.config (no migration) — prefer config where possible; only add enum values
for genuinely new types (CARDS/PIVOT/HIERARCHY/ACTIVITY) and do ONE migration for all of them.
Build 2–4 renderers per commit. Each stores its settings in View.config. Clean the placeholder type-mappings
in view-create-popover.tsx (Team→DASHBOARD etc.) once real types exist. Verify tsc + eslint per commit.
```

---

## ▶ PROMPT 4 — Template Center (backbone #2)

```
[PASTE PREAMBLE]

Spec: tasks-spec.md §4 (Template Center) + lists-spaces-spec.md (List/Space bundles).
Goal: one Template Center. MIGRATION: a Template model { id, organizationId, kind: TASK|LIST|SPACE|FOLDER|
DOC|VIEW|WHITEBOARD, name, description, complexity?, useCases[], tags[], category?, payload Json, builtIn,
createdById }. Build: the center modal (left nav Featured/Workspace/Org + filters Type/Complexity/Use-Cases/
Tags/Created-by + category sections + search); a small built-in seed library; "save as template" from
task/list/space; APPLY materializes the payload — TASK → fill the create-task modal; LIST → create a Board
with statuses + schema.fields + Views + seed Items; SPACE → Space + workflow + child Lists. Wire the "+"
menu Templates footer + List/Space "Use Templates" + the context-menu "Templates" to this. Migrate the
existing /api/item-templates into Template(kind=TASK). Verify tsc + eslint. Commit per sub-step.
```

---

## ▶ PROMPT 5 — Connection-as-field (backbone #3) + Task Types + context-aware create

```
[PASTE PREAMBLE]

Spec: tasks-spec.md §2 (Task Types), §1 (context-aware), §4b (connection-as-field).
A) Connection-as-field: add Linked-Doc and Linked-SOP field types (mirror the existing KRA field in
   field-value.tsx + field-catalog.ts, backed by EntityLink); finish the RELATIONSHIP field (link any
   Item/Doc/SOP/KRA/Form). These render in the table cell AND task detail.
B) Task Types: ItemType model { id, organizationId, singular, plural, icon, description, category?, isDefault,
   builtIn } seeded with Task/Milestone/Form Response/Meeting Note; Item.itemTypeId (migrate metadata.taskType
   over); a /settings/task-types manage page (list + create modal: icon/singular≤16/plural≤16/description≤100
   + recommended library w/ categories); type picker in the create modal + a board Type column/filter. NOTE:
   Objective/KeyResult/Goal/Person overlap our OKR/KRA/KPI/User — keep those first-class; item-types are
   presentational re-skins (link, don't duplicate).
C) Context-aware create: derive the create-task list/space from the current route (space page → that space;
   board page → that board); only Inbox/global shows "Select List". Extend the existing createTaskPreselect.
Verify tsc + eslint. Commit per sub-step (this prompt is large — split freely).
```

---

## ▶ PROMPT 6 — Full-page task detail + extras + List modal + context menus

```
[PASTE PREAMBLE]

Spec: tasks-spec.md §4/§4b (detail), lists-spaces-spec.md (List modal §1, context menus §2b).
A) Full-page task route reusing BoardItemDrawer's sections; add inline subtask mini-table + checklist +
   relate/dependencies in the detail; "hide N empty fields" + field search; extend FieldShelf "Add existing"
   to toggle BUILT-IN fields (Status/Start date/Time tracked/Dependencies/Task Type…) and add Suggested/AI
   groups.
B) List create modal: real Space-location picker + land-on-board; wire template chips → Template Center.
C) Space/Folder/List "…" context menus (space/folder/board-more-menu.tsx): expand to Copy link · Duplicate ·
   Move · Hide · Custom Fields (→ FieldShelf) · Task statuses (→ status editor) · Templates (→ Template Center)
   · Sharing & Permissions · (List-only) List Info / Default task type / Email-to-List. Add the list
   group-status "…" menu (rename/new/edit/hide/automate status).
Verify tsc + eslint. Commit per sub-step.
```

---

## ▶ PROMPT 7 — Database → Sheets feel + attachment sources

```
[PASTE PREAMBLE]

Spec: plus-create-menu-plan.md §5, tasks-spec.md §4 (attachments).
A) DataTable toward Google-Sheets feel (prioritize w/ user): formula column type + cell refs (=A1+B2, SUM/
   AVG); richer columns (currency/percent/rating/person/relation/lookup/created/updated); frozen header + col
   resize/reorder; cell selection + copy/paste + fill-down; row virtualization. Build incrementally; formulas
   first.
B) Create-task attachment external sources (Dropbox/OneDrive/Box/Google Drive/New Google Doc) behind OAuth
   connectors → store as FileEntry + EntityLink (reuse the local-upload path).
Verify tsc + eslint. Commit per sub-step.
```

---

## ▶ PROMPT 8 — Automation Hub + AI agent builder (LAST; some parts await founder detail)

```
[PASTE PREAMBLE]

Spec: automation-hub.md (+ automation-hub-schema.sql), plus-create-menu-plan.md (Create-with-AI = build an
agent). These are the most open-ended — confirm scope with the user before large work.
A) Automation Hub: per the existing design doc; lights up "Automations" in context menus + group-status menu.
   Only build once modules emit events (the doc's "lay pipes as you go" note).
B) "Create with AI" / "Super Agent": open an agent builder (name/instructions/tools/train) wired to the
   /agents system. Founder will provide detailed UX — ask for it before building beyond a stub.
Verify tsc + eslint. Commit per sub-step.
```

---

### After all phases
Run `npx tsc --noEmit` clean, `npx eslint src/`, and ask the user to click through behind login. Then the
user merges feat/alignment-system → main AFTER running the pending prod migrations (Item.priority+tags, the
StudioBoard/custom-fields drops, plus any new ones from these phases) on the production database.
```
