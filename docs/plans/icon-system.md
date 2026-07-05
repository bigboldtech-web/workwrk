# Icon system — one clean, consistent set everywhere

Goal: every icon in the app looks like it came from the same designer. Same
sizes, same greys, same stroke, same "states." No more one icon at 14px next to
another at 18px in a different grey. This is the standard + the sweep to apply it.

## The standard (the rules every icon follows)

There are only **four icon roles**. Pick the role, use its spec, done.

| Role | Where it shows | Size | Color | Notes |
|------|----------------|------|-------|-------|
| **Affordance** | Empty cell that says "click to set" (assignee, due, priority, tags) | `w-[17px] h-[17px]` | `text-zinc-400` | lucide default stroke. Reads as a gentle prompt. |
| **Labeled** | Icon sitting next to a text label (Type pill, a set status, menu rows) | `w-3.5 h-3.5` (14px) | `text-zinc-400` or the entity's own color | Smaller because the label carries the meaning. |
| **Action** | Toolbar / header / hover buttons (Share, Automate, filter, +, rename) | `w-3.5 h-3.5` (14px) | `text-zinc-500`, darker on hover | Sits in an `h-7`/`h-8` control. |
| **Entity tile** | Space / Folder / Board / Doc / Table square | via `EntityTile` | white glyph on colored square | Already standardized — never hand-roll a colored square. |

Two supporting rules:
- **Accent, not grey, for "on":** active/selected/checked icons use `var(--os-brand)`. Never a hardcoded taupe hex, never flat `bg-zinc-900`.
- **One icon per concept, app-wide:** assignee = `UserPlus`, due = `CalendarPlus`, priority = `Flag`, tags = `Tag`, type = the ItemType's own icon, comments = `MessageSquare`, attachment = `Paperclip`, link = `Link2`, subtask = `Network`, more = `MoreHorizontal`. Don't swap `User`/`UserCheck`/`UserPlus` around for the same idea.

## The sweep (surfaces to bring onto the standard)

Ordered by how much the CEO looks at them. Each is independently shippable.

**1. List / Table rows — DONE.** Assignee, due, priority, tags empty icons all at
17px zinc-400; set states use labeled 14px. The inline Add bar boxes match.
Remaining nit: the Type cell empty state is a bare `—` — give it a faint 17px
type affordance so it matches its neighbors (currently the one cell that doesn't
prompt you).

**2. Kanban (Board) cards.** Audit the 8 control icons on each card — confirm
they're all Action role (14px, zinc-500) and use the same lucide glyph as the
List row for the same concept. This is the surface with the most icons crammed
together, so drift shows most.

**3. Board view tabs (List / Board / Calendar / Gantt).** Tab icons should be one
size (`w-4`), grey when idle, `--os-brand` when active, with the active underline
in brand. Right now the colors are ad-hoc.

**4. Board chrome action row (Ask / Automate / Share / reader / filter).** All
Action role, `h-8` controls, 14px icons. Automate's amber and Ask's violet accents
should either both go to a single accent treatment or be intentional — pick one.

**5. Sidebar tree.** Chevrons, entity tiles, and the hover-reveal clusters
(+, more) at every level (Space / Folder / Board / Table) should be one size and
one grey. The tiles already route through `EntityTile`; the loose chevrons/buttons
are what drift.

**6. Create modals + pickers (List / Folder / Board / Space, +View, field shelf).**
Icon tiles at `h-7 w-7 rounded-[8px]`, glyphs and section icons on the Action/Labeled
scale. `space-create-popover` is the north star; bring the others to it.

**7. Empty states & headers.** The big "get started" tiles and section-card
headers on the Space dashboard — one icon scale, brand accent for the primary tile.

## How we verify each pass

- `tsc --noEmit` + `eslint` clean on touched files (reuse the running dev server,
  never `next build`).
- Visual: open the surface next to a ClickUp screenshot. Every icon in view should
  read as the same weight and grey; the only color should be intentional (status
  pills, priority flags, brand-accent "on" states, entity tiles).

## Sequencing

1 (finish Type cell) is a 2-line follow-up. Then 2 → 3 → 4 are the board surfaces
the CEO stares at; 5 → 6 → 7 are the surrounding chrome. Pure client styling — no
schema, no migration, shows on refresh.
