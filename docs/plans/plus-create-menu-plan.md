# "+" Create Menu — Redesign + Database (Plan v0.1)

> **Status:** Draft framework. Verified current-state filled in by Claude; sections marked
> **[NEEDS INPUT]** await the founder's per-button behavior list. Plan-only — no code this session.
> **Decisions locked:** (1) plan only, execute in a later chat; (2) "Database" builds on the existing
> `DataTable` (Stackby-style tables), not a new engine.

## 1. Purpose

The sidebar "+" create menu (`CreateMenu` in `src/components/layout/os/click-sidebar.tsx`) is the single
"create anything" entry point — ClickUp's most-used control. Two problems to solve:
1. **Chrome/UX:** the menu looks unpolished and inconsistent vs. the ClickUp reference.
2. **Behavior:** half the items don't actually create anything — they navigate to a list page with a
   dead `?new=1` param. Each item needs a real, clean create flow.
Plus: **add a "Database"** item (in-house Google-Sheets-style tables), built on our `DataTable`.

## 2. Current-state audit (verified in code, 2026-06-12)

| Item | Today | Wiring | Verdict |
|---|---|---|---|
| **Task** | Opens rich create-task modal (Item-backed; types, templates, checklist, subtasks, followers, attachments, ⌥T) | `openCreateTask` | ✅ mature — mostly polish |
| **List** | Opens create-list modal | `openCreateList` | ✅ real modal |
| **Space** | Opens Space wizard | `runAppNewAction` | ✅ real flow |
| **Create with AI** | Navigates to `/sidekick` | `router.push` | ⚠️ navigate-only — should create *in* the menu |
| **Super Agent** ("Hot") | Navigates to `/agents` | `router.push` | ⚠️ navigate-only |
| **Doc** | `router.push("/docs?new=1")` — **page ignores `?new`** | dead param | ❌ creates nothing |
| **Form** | `router.push("/forms?new=1")` — page ignores `?new` | dead param | ❌ creates nothing |
| **Dashboard** | `router.push("/dashboard?new=1")` — page ignores `?new` | dead param | ❌ creates nothing |
| **Whiteboard** | `router.push("/whiteboards?new=1")` — page ignores `?new` | dead param | ❌ creates nothing |
| **Database** | — | — | 🆕 to add (build on DataTable) |
| **Customize sidebar** | Opens Customize panel | `openCustomize` | ✅ ok |
| **Import** (footer) | Navigates to `/imports` | `router.push` | ⚠️ ok-ish |
| **Templates** (footer) | Navigates to `/templates` | `router.push` | ⚠️ ok-ish |
| **"Describe anything to create"** input | Top AI input (taupe border) | Enter → `openCreateTask` | ⚠️ only creates a Task; should route by intent |

**Takeaway:** the redesign is *both* visual (the menu card) *and* behavioral (give Doc/Form/Dashboard/
Whiteboard/Database/AI real create flows, not navigation).

## 3. Menu chrome redesign (clean, ClickUp-style)

Reuse our design system: `ui/chip.tsx`, taupe accent `ui/accent.ts` (`TAUPE`), shared `ui/switch.tsx`.
Target layout (matches the ClickUp reference the founder shared):
- **Card:** rounded-xl, 1px `#e4e4e7` border, soft shadow, ~300px wide, white. Anchored under the "+".
- **AI input row** (top): "Describe anything to create" with the taupe focus ring; routes by intent
  (task / doc / list…) instead of always creating a Task. **[NEEDS INPUT: desired AI routing behavior]**
- **Section: Create** — Task (⌥T), List, Space. Each row: icon + label + optional shortcut/▸ affordance,
  hover `bg-zinc-50`, 13px text, consistent 36px row height.
- **Section: AI** — Create with AI, Super Agent (Hot badge).
- **Section: Build** — Doc, Form, Dashboard, Whiteboard, **Database** (new).
- **Footer divider** — Customize your sidebar; then a 2-button row: Import · Templates.
- **Consistency:** one row component, one icon size (16px), aligned chevrons for items with sub-menus,
  section labels in 10.5px uppercase zinc-400. (Today the spacing/dividers are uneven — unify them.)

## 4. Per-button plan (template + draft; complete with founder's list)

For **every** button capture: **Trigger** (icon/shortcut/badge) · **Creates** (entity + model + API) ·
**Flow** (inline modal / full page / wizard) · **UI/UX** (fields, steps, empty state) · **Lands** (redirect/
drawer/toast) · **Sub-options** (templates/sources) · **Status** (works/stub/new) · **Effort**.

- **Task** — Creates `Item` via `POST /api/boards/[id]/items`. Flow: existing modal. Work: polish only.
  **[NEEDS INPUT: any new fields/types you want]**
- **List** — Creates a Board/List. Existing modal. **[NEEDS INPUT: parity items vs ClickUp]**
- **Space** — Space wizard. **[NEEDS INPUT]**
- **Doc** — Should open a "New doc" inline (title + location picker) → create `Doc` via `POST /api/docs` →
  open the editor. Replaces dead `?new=1`. **[NEEDS INPUT: template/location options]**
- **Form** — "New form" → `POST /api/forms` → form builder. **[NEEDS INPUT]**
- **Dashboard** — "New dashboard" → create + open. **[NEEDS INPUT: widget set]**
- **Whiteboard** — "New whiteboard" → create + open. **[NEEDS INPUT]**
- **Database** — see §5. Creates a `DataTable` (+ optional Space) → opens the grid. **[NEEDS INPUT: column presets]**
- **Create with AI / Super Agent** — **[NEEDS INPUT: what should these *do* from the menu — generate a
  board/doc from a prompt? launch an agent run? — define the in-menu behavior]**
- **Import** — **[NEEDS INPUT: which sources — CSV, ClickUp, Asana, Trello, Sheets?]**
- **Templates** — **[NEEDS INPUT: template gallery contents + categories]**

## 5. Database (build on DataTable → "Google Sheets in-house")

**Already built (reuse, don't rebuild):** `DataTable` model · `/tables` list + `/tables/[id]` grid editor ·
`POST /api/tables` · **9 column types** (short_text, long_text, number, select, multi_select, date,
checkbox, url, email) · row/column CRUD (right-click delete) · CSV import · Space-scoping · embeds in docs ·
sidebar tree + library tabs (Phases 32–38).

**Gap to a Sheets feel (candidate scope — prioritize with founder):**
- Formula column type + cell references (`=A1+B2`, SUM/AVG) — *the* defining Sheets feature.
- Richer column types: currency, percent, rating, person/owner, attachment, relation/lookup, created/updated.
- Frozen header row + column resize/reorder; cell selection + copy/paste ranges; fill-down.
- Scale: pagination/virtualized rows for large sheets.
- "Database" create entry in the "+" menu → name + column preset → `POST /api/tables` → open grid.
**[NEEDS INPUT: which of these matter for v1, and how "spreadsheet" vs "structured DB" you want it to feel]**

## 6. What to send me (your per-button list)

For each menu item, tell me: what it should **create**, the **flow** (quick inline modal vs full page),
the **fields/steps**, where it **lands**, and any **sub-options** (templates, import sources). Especially:
AI/Super-Agent in-menu behavior, Templates gallery, Import sources, and your Database/Sheets v1 priorities.

## 7. Suggested phasing (for the build chat)

1. **Menu chrome redesign** (one row component, sections, AI input, Database entry) — visual, low risk.
2. **Real create flows** for Doc/Form/Dashboard/Whiteboard (kill `?new=1`).
3. **Database** create entry + DataTable "sheets" enhancements (formulas first).
4. **AI/Super Agent** in-menu behavior; **Templates** gallery; **Import** sources.
