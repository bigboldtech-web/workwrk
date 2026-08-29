# Tables → array formulas / spill (PAUSED — roadmap 4b remainder)

**Status:** designed, not started. Paused 2026-08-28 when the founder redirected to Talk/bookmarks/notifications. Pick up from here.

**Goal:** Google-Sheets-style dynamic arrays — a formula in one cell returns a 2D array that *spills* into adjacent cells (FILTER/SORT/UNIQUE/ARRAYFORMULA/SEQUENCE). This is the flagship Zoho/Sheets gap.

## The core obstacle
The engine assumes **one formula = one cell = one scalar**, encoded at every layer:
- `CellValue` is a scalar union (`types.ts:33`); `RangeValue` (`coerce.ts:47`) exists ONLY as a function *argument*, never a result. `FunctionArg = CellValue | RangeValue`.
- `evalNode`/`evalCall`/`FunctionImpl`/`SheetFunction.call` all return `CellValue` (`evaluate.ts:100,565,613`; `functions.ts:101`).
- Two hard collapse points turn any multi-cell result into `#VALUE!`: `toScalar` (`coerce.ts:129`) and `refToScalar` (`evaluate.ts:393`).
- `SheetGraph.settle` writes exactly one key: `this.values.set(key, value)` (`graph.ts:505`); `view.getCell` maps a cell to its own formula's value or the base literal (`graph.ts:283`) — no anchor→region ownership.
- Dependencies are **input-only** (`graph.ts:76-79`) — no notion of a formula's *output* cells (spill needs this for invalidation + collision).
- No `#SPILL!` error code (`types.ts:15-24`).
- Grid read-only is **column-granular** (`page.tsx:4885`, `sheet-grid.tsx:255`) — spilled cells need per-cell read-only.
- `evalCall` already has a guard `if (isRangeValue(value)) keyed = false;` (`evaluate.ts:652`) anticipating a future array result.

## Smallest viable first slice (SEQUENCE spilling into empty cells)
1. **Type:** widen `FunctionImpl`/`SheetFunction.call` return to `CellValue | RangeValue` (`evaluate.ts:100`, `functions.ts:101/133`). Add `SEQUENCE` returning a `RangeValue` via `rangeValue`/`columnRange`/`rowRange`.
2. **Engine surface:** only handle an array result at the TOP LEVEL of a formula (nested-in-operator stays `#VALUE!` via `toScalar`), so the `evalNode`/`evalCall` change is a narrow special case, not a full broadcast rewrite.
3. **Graph:** in `compute()`/`settle()` (`graph.ts:562-575, 502-515`), if a formula result is a range, materialize a spill overlay `Map<CellKey,{anchor,value}>` + register the output rect; `view.getCell` consults the overlay before `base`. Dirty old ∪ new rect on size change via the existing `directDependents`+`dirty` primitive (`graph.ts:330-342`).
4. **Collision:** spill only into empty base cells with no own formula; else set anchor = new `#SPILL!` code and suppress. Add `#SPILL!` to `types.ts` CELL_ERRORS.
5. **Host:** expose overlay values through `value()/display()` (`sheet-engine-host.ts:241-257`); add `isSpilledCell(colId,rowId)` so the page gates edits. Spilled cells stay UNSTORED (computed-only), never persisted (`literalAt` desync guard at `:654`).
6. **Grid/page:** extend the read-only test from column-only to a per-cell predicate at the edit gates (`sheet-grid.tsx:1574,1580,2076`, `commitCellText` `page.tsx:4209-4214`).

**Then** add FILTER/SORT/UNIQUE/ARRAYFORMULA (variable-size, data-dependent output rects → heavier invalidation) once the fixed-size SEQUENCE path proves the overlay + collision + read-only machinery. Guard against O(n²) recalc regressions (`sheet-engine-host.perf.test.ts`, PassCache).
