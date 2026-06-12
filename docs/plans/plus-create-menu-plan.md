# "+" Create Menu — Redesign + Every Button (Plan v1.0, handoff-ready)

> **Framing:** we are **ENHANCING** the current system to ClickUp parity — not removing anything. The "+"
> menu is the entry point because it creates & connects everything. Read `00-index.md` first.
> **Decisions:** Database builds on the existing `DataTable`; build the menu chrome first (low risk).
> Constraints: branch `feat/alignment-system`; verify with `tsc`/`eslint`; **never `next build` while the
> user's `pnpm dev` runs**.

## 1. Why
`CreateMenu` in `src/components/layout/os/click-sidebar.tsx` is the single "create anything" control. Two
problems: (a) the chrome is unpolished vs the ClickUp reference; (b) half the items just
`router.push("/x?new=1")` and the target pages ignore `?new`, so they **create nothing**. Every button needs
a real create flow; add a **Database** item.

## 2. The connected system the "+" feeds
`Workspace → Space → Folder → List(=Board) → Task(=Item)`, plus Docs/Forms/Whiteboards/Dashboards/Databases
in Spaces/Folders. A List has many **Views**; a List has its own **customizable statuses**; a Task has
**subtasks, a type, statuses, fields**; fields render identically across table/detail/card/calendar/gantt and
link to Docs/SOPs/KRAs as **nodes** (`EntityLink`). Deep specs: `views-catalog.md`, `tasks-spec.md`,
`lists-spaces-spec.md`.

## 3. Menu chrome (visual) — do first, isolated, no migration
One reusable row component; reuse `ui/chip.tsx`, `ui/accent.ts` (`TAUPE`), `ui/switch.tsx`. Card: rounded-xl,
1px `#e4e4e7` border, soft shadow, ~300px, anchored under "+". Sections w/ 10.5px uppercase zinc-400 labels,
36px rows, 16px icons, hover `bg-zinc-50`, aligned chevrons:
- **AI input** (top): "Describe anything to create", taupe ring. v1 = create a Task named with the text
  (current); NLP intent-routing (task/doc/list) = fast-follow TODO.
- **Create:** Task (⌥T) · List · Space
- **AI:** Create with AI · Super Agent (Hot)
- **Build:** Doc · Form · Dashboard · Whiteboard · **Database** (new)
- **Footer:** Customize sidebar; then Import · Templates

## 4. Per-button plan

| Button | Creates | Flow / UI | API | Status today | Build |
|---|---|---|---|---|---|
| **Task** | `Item` | full create-task modal (context-aware list picker, type, status, assignee, due, priority, tags, "…" extras, attachments, templates, create-variants) | `POST /api/boards/[id]/items` | ✅ modal mature | context-awareness + Task Types + per-list statuses → `tasks-spec.md` |
| **List** | `Board` | modal: Name* · **Space-location picker** · Make-private · Use-Templates | `POST /api/boards` | ⚠️ basic | space picker + template wiring → `lists-spaces-spec.md` |
| **Space** | `Space` | 2-step wizard (icon/name/desc/permission/private → preset/views/statuses/ClickApps/KRA) | `POST /api/spaces` | ✅ strong | + default-permission + space templates → `lists-spaces-spec.md` |
| **Create with AI** | AI Agent | opens **agent builder** (name, instructions, tools, train) — founder: "build your own agent" | agents (`/agents`) | ⚠️ navigate-only | founder to detail; v1 = open builder |
| **Super Agent** | — | launch/config the premium global agent | `/agents` | ⚠️ navigate-only | founder to detail |
| **Doc** | `Doc` (=Notes) | inline "New doc" (title + **location**: space/folder) → create → open block editor; attachable to a task as a **Linked-Doc field** | `POST /api/docs` | ❌ dead `?new=1` | real inline-create + open |
| **Form** | `Form` | inline "New form" → form builder; submissions create board Items (re-pointed) | `POST /api/forms` | ❌ dead `?new=1` | real create + builder |
| **Dashboard** | dashboard | inline "New dashboard" → widget canvas | dashboards app | ❌ dead `?new=1` | real create + canvas |
| **Whiteboard** | `Whiteboard` | inline "New whiteboard" → canvas | `POST /api/whiteboards` | ❌ dead `?new=1` | real create + open |
| **Database** | `DataTable` | "New database" → name + **column preset** → grid | `POST /api/tables` | 🆕 missing | add entry; DataTable already has 9 col types/CSV/embeds (Phases 32–38); Sheets feel (formulas, currency/rating/person cols, frozen header, copy/paste) = fast-follow |
| **Customize sidebar** | — | opens Customize panel | `openCustomize` | ✅ | — |
| **Import** | rows | source picker. **v1: CSV** (built); roadmap: ClickUp/Asana/Trello/Excel/Sheets | `/api/.../import` | ⚠️ navigate | CSV inline; others later |
| **Templates** | — | opens **Template Center** (Featured/Workspace/Org · filters Type/Complexity/Use-Cases/Tags/Created-by · categories · save/apply) | Template Center (`tasks-spec.md` §4) | ⚠️ navigate | the big shared system |

> Assumptions to confirm (sensible ClickUp defaults used): AI-input v1, Super-Agent behavior, Import v1=CSV,
> Database v1 = create-entry + existing grid (formulas next).

## 5. Database → "Google Sheets in-house" (build on DataTable)
**Reuse:** `DataTable` model · `/tables` + `/tables/[id]` grid · `POST /api/tables` · 9 column types · row/col
CRUD · CSV import · Space-scoping · doc embeds (Phases 32–38). **Sheets-feel roadmap (prioritize w/ founder):**
formulas + cell refs (`=A1+B2`, SUM/AVG) · richer cols (currency/percent/rating/person/relation/lookup/created)
· frozen header + col resize/reorder · cell selection + copy/paste + fill-down · row virtualization at scale.

## 6. Shared backbones (build once; many buttons depend on them — see `00-index.md`)
1. **Template Center** (`kind=TASK/LIST/SPACE/DOC/VIEW/WHITEBOARD`) — Templates button + List/Space "Use Templates".
2. **Per-list statuses** — Task button's status picker; list/space status editors.
3. **EntityLink connection-as-field** — Doc/SOP/KRA as columns (KRA field ✅; add Linked-Doc/SOP; finish Relationship).

## 7. Build order (this menu)
1. **Chrome redesign** (§3).
2. **Real inline create flows** for Doc/Form/Dashboard/Whiteboard (kill `?new=1`).
3. **Database** create entry (reuse `/api/tables`).
4. **Import** = CSV inline; **Create-with-AI / Super-Agent** → agent builder.
5. **Templates** → Template Center (large; shared backbone — own effort).

## 8. Verify (per step)
`npx tsc --noEmit` clean · `npx eslint` touched files · manual (behind login, user drives): each "+" item
opens a real create flow & lands correctly; no `?new=1` dead links. Commit per step on `feat/alignment-system`.
**Do not `next build` while the dev server runs.**
