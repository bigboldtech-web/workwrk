# Tables — Sheets/Excel-grade spreadsheets in WorkwrK

**Date:** 2026-08-22 · **Status:** PLANNED — starts after Comms Hub ("Room") acceptance
**Mandate (user):** "Like Google Sheets and Excel basically where I can add formulas, do stuffs — and we'll call it Tables."

---

## 1. Where we are (recon 2026-08-22)

The live surface (`/tables`, `src/app/(dashboard)/tables/[id]/page.tsx`, 1303 lines)
has been tracking **Airtable/Stackby** parity, not Sheets: typed columns
(18 types incl. link/lookup/rollup/attachment/person), saved views
(grid/kanban/calendar/gallery), CSV import/export, column resize/reorder,
sticky header. Storage: `DataTable.columns Json` + `DataTableRow.values Json`.

What Sheets-parity needs and is **uniformly absent** (full details in the
recon): cell selection model, keyboard navigation, multi-cell copy/paste +
Excel/Sheets clipboard interop, fill handle, per-CELL formulas (today:
per-column only, 5 functions, position-based refs that silently break on
column reorder), dependency-graph recalc (today: full engine teardown per
edit), number formatting, undo/redo, virtualization (hard ~5k-row ceiling,
every cell a live input), row pagination, bulk ops, sorting, conflict
detection. Zero tests on the formula engine.

**Reality check:** this is the largest single build since the ClickUp
overhaul. The grid kernel and the formula engine are both real engineering
— we ship them as separate phases with the fleet reviewing every diff, and
the existing Airtable-style tables must keep working untouched throughout.

## 2. Architecture decisions (locked unless overruled)

1. **Evolve in place, no new models.** Cell formulas ride the existing
   `values` Json: a cell whose value is `{ "=": "A1+B2" }`-shaped (exact
   encoding decided in Phase 3) computes; anything else is a literal.
   Column-level formulas stay working as "fill the whole column".
2. **A1 semantics with rewrite-on-structure-change.** Users type `A1`,
   `B2:B10` like a real spreadsheet. Refs are REWRITTEN when rows/columns
   move or die (that's what Sheets does) — fixing today's silent
   repointing bug for column formulas too.
3. **Engine is pure + tested.** `lib/sheet-engine/` — tokenizer, parser,
   dependency graph, incremental recalc — no React, no fetch, with a real
   test suite (the current engine has none). The old `sheet-formula.ts`
   stays until Phase 3 swaps it out.
4. **Grid kernel replaces the `<table>`,** virtualized (TanStack Virtual),
   selection/keyboard first-class, `role="grid"` a11y. Same data, same
   APIs underneath at first — the kernel lands as pure UI.
5. **Light on the server, like Room:** batch endpoints instead of
   per-cell PATCHes; recalc stays client-side; no realtime infra until a
   measured need (same Phase-6 gate philosophy as comms).

## 3. Phases

### Phase 1 — Grid kernel (feel like a spreadsheet)
Virtualized grid (rows + columns), active cell + anchor + range selection
(mouse + Shift/Cmd), full keyboard nav (arrows, Tab/Enter commit-and-move,
type-to-replace, F2/dbl-click to edit, Escape), frozen first column,
row multi-select + bulk delete. Server: cursor pagination on rows
(`position` keyset, kills the 5k ceiling), `PATCH /rows/batch` (cell
edits + inserts + deletes in one call). Existing cell editors re-hosted
inside the kernel. Sorting (client, persisted per view).

### Phase 2 — Clipboard + fill
Copy/cut/paste ranges in-grid; paste FROM Excel/Google Sheets (TSV +
`text/html` table parsing) and copy TO them; paste expands rows when it
overflows the grid; fill handle with series detection (1,2,3… /
dates / copy-down); Cmd+D/Cmd+R. All routed through the Phase-1 batch
endpoint.

### Phase 3 — Formula engine v2 (the Sheets heart)
Per-cell formulas (`=` prefix), formula bar + in-cell editing with ref
highlighting + function autocomplete, A1 + absolute (`$A$1`) + range refs,
cross-column refs by header name for readability. Engine: dependency
graph, topological incremental recalc (edit recomputes only dependents),
cycle reporting, ref rewrite on insert/delete/reorder. Function library:
logic (IF, AND, OR, NOT, IFERROR), comparison + string literals in the
grammar, text (CONCAT, LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER,
SUBSTITUTE), math (ROUND, ABS, POW, SQRT, MOD), dates (TODAY, NOW, DATE,
DATEDIF), aggregates + conditionals (COUNTIF, SUMIF, AVERAGEIF), lookup
(VLOOKUP, INDEX, MATCH). Ships with the test suite. Column formulas
migrate transparently.

### Phase 4 — Undo/redo + formatting
Command-stack undo/redo (Cmd+Z / Shift+Cmd+Z) across cell edits, paste,
fill, row/col structure ops — in-memory per session, no schema change.
Number formatting per column AND per cell via `Intl.NumberFormat`:
decimals, thousands separators, currency code, percent, date formats,
negative styling. Honest CSV export of formatted values + a raw-values
option. Conditional formatting v1 (value-rule → cell color).

### Phase 5 — Scale + trust
Aggregate footer row (SUM/AVG/COUNT per column), row grouping, view-level
filters that persist (today's filter is ephemeral), optimistic-concurrency
guard on batch writes (row `updatedAt` precondition — two editors can't
silently clobber each other; loser gets a refresh prompt), 20s
co-presence poll ("Priya is editing" chip) reusing the Room polling
pattern. Load test at 50k rows.

## 4. Rollout discipline

Same as Room: one phase = one deploy = one live test cycle; fleet review
on every diff; tsc/eslint gates; the OLD table surface remains the
fallback renderer until Phase 2 proves stable (a per-table "classic view"
escape hatch, removed in Phase 5). No migrations expected before Phase 5
(concurrency token may want a dedicated column — decided then).

## 5. Open questions for the user

1. Rail placement: Tables as its own left-rail app (like Room), or stay
   reachable from Work/Spaces as today?
2. Are the Airtable-style relational columns (link/lookup/rollup) worth
   keeping first-class in the new kernel, or do formulas subsume them?
3. 50k rows target OK, or do you expect bigger?
