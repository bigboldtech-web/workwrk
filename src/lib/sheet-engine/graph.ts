// Dependency graph and incremental recalculation. Pure: no React, no DOM, no
// I/O.
//
// The engine this replaces rebuilt itself on every keystroke and re-derived
// every formula in the table. Here an edit recomputes exactly the transitive
// dependents of what changed, in a deterministic order, and reports which
// cells it touched so the grid can repaint only those.
//
// RANGE DEPENDENCIES ARE NOT EXPANDED. `=SUM(A1:A50000)` is one rectangle, not
// fifty thousand edges. Reverse lookup ("who reads this cell?") is answered by
// two structures:
//
//   * an exact map for single-cell precedents, and
//   * a coarse block index for rectangles: a rectangle is registered in the
//     blocks it overlaps, and a hit is confirmed against the owner's real
//     rectangles. A rectangle that would touch more than `maxIndexedBlocks`
//     blocks, and every whole-column rectangle (unbounded below), skips the
//     index and lands in a scan list instead, so a pathological range costs a
//     containment test per query rather than unbounded memory.
//
// Whole-column refs are the reason the scan list exists at all: `SUM(A)` must
// notice a change in any row of column A, now and after ten thousand more rows
// are added, and pinning that to a row count would be a bug waiting for the
// next insert.

import {
  evaluateSpill,
  isRangeValue,
  walkRefs,
  type CellPoint,
  type Coercions,
  type FunctionLookup,
  type RangeValue,
  type RefContext,
  type SheetAccess,
} from "./evaluate";
import { parseFormula } from "./parser";
import { PassCache } from "./pass-cache";
import {
  MAX_COLUMN_INDEX,
  cellError,
  isErrorValue,
  type Ast,
  type CellValue,
  type FormulaParseError,
  type Ref,
} from "./types";

/** Row-major packed address. Sorting keys sorts cells top-to-bottom, left-to-right. */
export type CellKey = number;

const KEY_STRIDE = MAX_COLUMN_INDEX + 1;

export function cellKey(row: number, col: number): CellKey {
  return row * KEY_STRIDE + col;
}

export function keyRow(key: CellKey): number {
  return Math.floor(key / KEY_STRIDE);
}

export function keyCol(key: CellKey): number {
  return key - Math.floor(key / KEY_STRIDE) * KEY_STRIDE;
}

export function keyPoint(key: CellKey): CellPoint {
  return { row: keyRow(key), col: keyCol(key) };
}

/** `bottom` is Infinity for a whole-column dependency. */
export interface DependencyRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface CellDependencies {
  cells: CellKey[];
  rects: DependencyRect[];
}

export interface RecalcResult {
  /** Every cell recomputed, in the order it was computed. */
  computed: CellPoint[];
  /** The subset whose value actually differs from before. */
  changed: CellPoint[];
  /** Participants in each cycle found, grouped and sorted. */
  cycles: CellPoint[][];
}

export interface SheetGraphOptions {
  sheet: SheetAccess;
  functions?: FunctionLookup;
  coercions?: Coercions;
  now?: () => Date;
  maxRangeCells?: number;
  blockRows?: number;
  blockColumns?: number;
  /** Rectangles wider than this many blocks go to the scan list. */
  maxIndexedBlocks?: number;
}

interface FormulaRecord {
  key: CellKey;
  row: number;
  col: number;
  source: string | null;
  ast: Ast | null;
  parseError: FormulaParseError | null;
  deps: CellDependencies;
  wide: boolean;
}

const CYCLE_ERROR = cellError("#CYCLE!");
const FORMULA_ERROR = cellError("#ERROR!");
const SPILL_ERROR = cellError("#SPILL!");

/** How many times a recalc will chase spill-induced changes before giving up.
 *  Only an array-of-arrays feedback loop reaches this; a bound beats a hang. */
const SPILL_PASS_LIMIT = 64;

function sameValue(a: CellValue | undefined, b: CellValue | undefined): boolean {
  if (isErrorValue(a) && isErrorValue(b)) return a.err === b.err;
  return a === b;
}

function contains(rect: DependencyRect, row: number, col: number): boolean {
  return (
    row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right
  );
}

/** Array-backed binary min-heap: the tie-break that makes recalc reproducible. */
class MinHeap {
  private data: number[] = [];

  get size(): number {
    return this.data.length;
  }

  push(value: number): void {
    const data = this.data;
    data.push(value);
    let i = data.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (data[parent] <= data[i]) break;
      [data[parent], data[i]] = [data[i], data[parent]];
      i = parent;
    }
  }

  pop(): number | undefined {
    const data = this.data;
    if (data.length === 0) return undefined;
    const top = data[0];
    const last = data.pop() as number;
    if (data.length > 0) {
      data[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < data.length && data[left] < data[smallest]) smallest = left;
        if (right < data.length && data[right] < data[smallest]) smallest = right;
        if (smallest === i) break;
        [data[smallest], data[i]] = [data[i], data[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Tarjan's SCC, iterative: a ten-thousand-cell chain must not overflow the
 * JavaScript stack. Components come back sorted, and sorted among themselves,
 * so a cycle report is stable across runs.
 */
export function stronglyConnected(
  nodes: readonly CellKey[],
  adjacency: (node: CellKey) => readonly CellKey[],
): CellKey[][] {
  const index = new Map<CellKey, number>();
  const low = new Map<CellKey, number>();
  const onStack = new Set<CellKey>();
  const stack: CellKey[] = [];
  const out: CellKey[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);
    const frames: Array<{ node: CellKey; next: number }> = [{ node: root, next: 0 }];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const children = adjacency(frame.node);
      if (frame.next < children.length) {
        const child = children[frame.next++];
        if (!index.has(child)) {
          index.set(child, counter);
          low.set(child, counter);
          counter++;
          stack.push(child);
          onStack.add(child);
          frames.push({ node: child, next: 0 });
        } else if (onStack.has(child)) {
          low.set(
            frame.node,
            Math.min(low.get(frame.node) as number, index.get(child) as number),
          );
        }
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) {
        low.set(
          parent.node,
          Math.min(low.get(parent.node) as number, low.get(frame.node) as number),
        );
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: CellKey[] = [];
        for (;;) {
          const popped = stack.pop() as CellKey;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        out.push(component.sort((a, b) => a - b));
      }
    }
  }

  return out.sort((a, b) => a[0] - b[0]);
}

export class SheetGraph {
  /** A `SheetAccess` that reads computed values for formula cells. */
  readonly view: SheetAccess;

  private readonly base: SheetAccess;
  private readonly functions?: FunctionLookup;
  private readonly coercions?: Coercions;
  private readonly nowFn?: () => Date;
  private readonly maxRangeCells?: number;
  private readonly blockRows: number;
  private readonly blockColumns: number;
  private readonly maxIndexedBlocks: number;

  private readonly formulas = new Map<CellKey, FormulaRecord>();
  private readonly values = new Map<CellKey, CellValue>();
  private readonly dirty = new Set<CellKey>();
  private readonly cellDependents = new Map<CellKey, Set<CellKey>>();
  private readonly blockDependents = new Map<number, Set<CellKey>>();
  /** Whole-column rectangles, keyed by each column they cover. A formula
   *  column of n `SUM([Amount])` cells would otherwise put n entries in the
   *  scan list and make every dependency query O(n) — the second O(n²)
   *  hiding behind the aggregate one. Here "who reads this column?" is one
   *  Map lookup, and the scan list keeps only rectangles that are neither
   *  block-indexable nor whole-column. */
  private readonly columnDependents = new Map<number, Set<CellKey>>();
  private readonly scanDependents = new Set<CellKey>();

  // --- Dynamic-array spill state ------------------------------------------
  // A formula like `=SEQUENCE(3)` computes to a 3x1 array. The anchor cell
  // keeps the top-left value; the rest of the array SPILLS into the cells
  // below/right. Spilled cells are never stored — a reload recomputes the
  // anchor and re-materialises them — so they live only in these maps.
  /** Non-anchor cells a spill currently occupies, keyed by the cell. */
  private readonly spillCells = new Map<CellKey, { anchor: CellKey; value: CellValue }>();
  /** Per anchor, the cells its last spill claimed, so a recompute or a
   *  formula edit/removal can clear the old footprint exactly. */
  private readonly spillOwned = new Map<CellKey, CellKey[]>();
  /** Formula cells to recompute because a spilled cell they read changed
   *  value mid-pass. Drained by `run`'s fixpoint loop; spilled cells are not
   *  graph nodes, so their dependents can only be reached this way. */
  private readonly spillReseeds = new Set<CellKey>();
  /** Spilled cells whose displayed value changed in the current pass, so the
   *  grid can repaint them. Reset at the top of every `runPass`. */
  private spillChanged = new Set<CellKey>();
  /** When an array is #SPILL!-blocked it spills nothing, but it still WANTS
   *  those cells. Anchor → the cells it wanted, plus the reverse index, so
   *  clearing whatever blocked it re-tries the anchor and the array recovers. */
  private readonly spillBlocked = new Map<CellKey, CellKey[]>();
  private readonly blockedBy = new Map<CellKey, Set<CellKey>>();

  constructor(options: SheetGraphOptions) {
    this.base = options.sheet;
    this.functions = options.functions;
    this.coercions = options.coercions;
    this.nowFn = options.now;
    this.maxRangeCells = options.maxRangeCells;
    this.blockRows = Math.max(1, options.blockRows ?? 64);
    this.blockColumns = Math.max(1, options.blockColumns ?? 64);
    this.maxIndexedBlocks = Math.max(1, options.maxIndexedBlocks ?? 256);

    const base = this.base;
    const values = this.values;
    const formulas = this.formulas;
    const spillCells = this.spillCells;
    this.view = {
      getCell: (row, col) => {
        const key = cellKey(row, col);
        if (formulas.has(key)) {
          const value = values.get(key);
          return value === undefined ? null : value;
        }
        // A spilled cell has a computed value but no formula of its own.
        const spilled = spillCells.get(key);
        if (spilled) return spilled.value;
        return base.getCell(row, col);
      },
      rowCount: () => base.rowCount(),
      columnCount: () => base.columnCount(),
      resolveHeader: (name) => base.resolveHeader(name),
      resolveName: base.resolveName ? (name) => base.resolveName!(name) : undefined,
      clock: base.clock ? () => base.clock!() : undefined,
    };
  }

  // --- Formula membership -------------------------------------------------

  setFormula(row: number, col: number, formula: string | Ast): void {
    const key = cellKey(row, col);
    // This cell's own array (if it had one) is about to be redefined, and if
    // a neighbour's array was spilling here it must re-evaluate to a #SPILL!.
    this.clearSpillFootprint(key);
    this.dirtyAnchorOf(key);
    this.unindex(key);

    let ast: Ast | null = null;
    let parseError: FormulaParseError | null = null;
    let source: string | null = null;
    if (typeof formula === "string") {
      source = formula;
      const parsed = parseFormula(formula);
      if (parsed.ok) ast = parsed.ast;
      else parseError = parsed.error;
    } else {
      ast = formula;
    }

    const record: FormulaRecord = {
      key,
      row,
      col,
      source,
      ast,
      parseError,
      deps: ast
        ? this.dependenciesOf(ast, { row, col })
        : { cells: [], rects: [] },
      wide: false,
    };
    this.formulas.set(key, record);
    this.index(record);
    this.dirty.add(key);
  }

  removeFormula(row: number, col: number): boolean {
    const key = cellKey(row, col);
    if (!this.formulas.has(key)) return false;
    // The cell reverts to whatever literal sits underneath it, so everything
    // reading it is now stale. `setFormula` gets this for free by dirtying the
    // cell itself; a removal has to say so before the record disappears.
    for (const dependent of this.directDependents(key)) this.dirty.add(dependent);
    this.clearSpillFootprint(key);
    this.unindex(key);
    this.formulas.delete(key);
    this.values.delete(key);
    this.dirty.delete(key);
    return true;
  }

  /** Drop the cells an anchor's last spill occupied and stale their readers.
   *  Used off the recalc path (formula edit/removal); on the recalc path
   *  `applySpill` clears the old footprint itself. */
  private clearSpillFootprint(anchorKey: CellKey): void {
    this.unregisterBlocked(anchorKey);
    const owned = this.spillOwned.get(anchorKey);
    if (!owned) return;
    for (const ownedKey of owned) {
      this.spillCells.delete(ownedKey);
      for (const dependent of this.directDependents(ownedKey)) this.dirty.add(dependent);
      // Freeing this cell may let a #SPILL!-blocked array finally fit.
      for (const anchor of this.blockedBy.get(ownedKey) ?? []) this.dirty.add(anchor);
    }
    this.spillOwned.delete(anchorKey);
  }

  /** Queue for recompute any array whose footprint `key` touches: the one
   *  currently spilling into it (a write there collides → #SPILL!) and any
   *  that WANTED it but was blocked (clearing the blocker lets it recover). */
  private dirtyAnchorOf(key: CellKey): void {
    const spilled = this.spillCells.get(key);
    if (spilled && this.formulas.has(spilled.anchor)) this.dirty.add(spilled.anchor);
    for (const anchor of this.blockedBy.get(key) ?? []) {
      if (this.formulas.has(anchor)) this.dirty.add(anchor);
    }
  }

  /** Drop the record that `anchorKey`'s blocked array wanted certain cells. */
  private unregisterBlocked(anchorKey: CellKey): void {
    const targets = this.spillBlocked.get(anchorKey);
    if (!targets) return;
    for (const target of targets) {
      const set = this.blockedBy.get(target);
      if (!set) continue;
      set.delete(anchorKey);
      if (set.size === 0) this.blockedBy.delete(target);
    }
    this.spillBlocked.delete(anchorKey);
  }

  private registerBlocked(anchorKey: CellKey, targets: CellKey[]): void {
    this.spillBlocked.set(anchorKey, targets);
    for (const target of targets) {
      let set = this.blockedBy.get(target);
      if (!set) {
        set = new Set<CellKey>();
        this.blockedBy.set(target, set);
      }
      set.add(anchorKey);
    }
  }

  hasFormula(row: number, col: number): boolean {
    return this.formulas.has(cellKey(row, col));
  }

  formulaSource(row: number, col: number): string | null {
    return this.formulas.get(cellKey(row, col))?.source ?? null;
  }

  parseErrorAt(row: number, col: number): FormulaParseError | null {
    return this.formulas.get(cellKey(row, col))?.parseError ?? null;
  }

  formulaCells(): CellPoint[] {
    return [...this.formulas.keys()].sort((a, b) => a - b).map(keyPoint);
  }

  /**
   * Rebuild every dependency from the stored trees. Header refs resolve
   * through the sheet, so a column rename or reorder invalidates them.
   */
  reindex(): void {
    for (const record of this.formulas.values()) {
      this.unindex(record.key);
      record.deps = record.ast
        ? this.dependenciesOf(record.ast, { row: record.row, col: record.col })
        : { cells: [], rects: [] };
      this.index(record);
      this.dirty.add(record.key);
    }
  }

  // --- Values --------------------------------------------------------------

  getValue(row: number, col: number): CellValue {
    return this.view.getCell(row, col);
  }

  /** True when this cell shows a value spilled from a neighbouring array
   *  formula rather than its own content. The grid renders it read-only: a
   *  spilled cell has no stored value of its own and typing into it would
   *  collide the array (→ #SPILL!). */
  isSpilled(row: number, col: number): boolean {
    return this.spillCells.has(cellKey(row, col));
  }

  /**
   * Queue a FORMULA cell for recomputation. Note the asymmetry with the
   * name: editing a literal that other formulas read is NOT this call —
   * this no-ops on a non-formula cell, which would leave every dependent
   * stale. After changing a literal, call `recalculate([{ row, col }])`,
   * which walks the dependents.
   */
  markDirtyFormula(row: number, col: number): void {
    const key = cellKey(row, col);
    if (this.formulas.has(key)) this.dirty.add(key);
  }

  get pendingCount(): number {
    return this.dirty.size;
  }

  // --- Queries -------------------------------------------------------------

  precedentsOf(row: number, col: number): CellDependencies {
    const record = this.formulas.get(cellKey(row, col));
    if (!record) return { cells: [], rects: [] };
    return { cells: [...record.deps.cells], rects: [...record.deps.rects] };
  }

  dependentsOf(row: number, col: number): CellPoint[] {
    return this.directDependents(cellKey(row, col)).map(keyPoint);
  }

  /** Index occupancy, so a test can prove ranges are never expanded. The
   *  per-column entries count as scans: both answer whole-column coverage,
   *  they just answer it at different speeds. */
  indexSize(): { cells: number; blocks: number; scans: number } {
    let cells = 0;
    for (const set of this.cellDependents.values()) cells += set.size;
    let blocks = 0;
    for (const set of this.blockDependents.values()) blocks += set.size;
    let scans = this.scanDependents.size;
    for (const set of this.columnDependents.values()) scans += set.size;
    return { cells, blocks, scans };
  }

  findCycles(): CellPoint[][] {
    const nodes = [...this.formulas.keys()].sort((a, b) => a - b);
    const present = new Set(nodes);
    const adjacency = new Map<CellKey, CellKey[]>();
    for (const node of nodes) {
      adjacency.set(
        node,
        this.directDependents(node).filter((key) => present.has(key)),
      );
    }
    const components = stronglyConnected(nodes, (node) => adjacency.get(node) ?? []);
    return components
      .filter((component) => isCyclicComponent(component, adjacency))
      .map((component) => component.map(keyPoint));
  }

  // --- Recalculation -------------------------------------------------------

  recalculateAll(): RecalcResult {
    return this.run(new Set(this.formulas.keys()));
  }

  /**
   * Recompute only what the given edits can reach. Cells that were never
   * computed stay queued until they are, so a formula added between recalcs is
   * never silently stale.
   */
  recalculate(changed: Iterable<CellPoint> = []): RecalcResult {
    const seeds: CellKey[] = [];
    for (const point of changed) {
      const key = cellKey(point.row, point.col);
      seeds.push(key);
      // A literal written onto a cell a neighbour spills into must re-evaluate
      // that neighbour so its array collides (→ #SPILL!).
      this.dirtyAnchorOf(key);
    }
    for (const key of this.dirty) seeds.push(key);
    return this.run(this.affected(seeds));
  }

  private affected(seeds: readonly CellKey[]): Set<CellKey> {
    const out = new Set<CellKey>();
    const stack: CellKey[] = [];
    const push = (key: CellKey) => {
      if (out.has(key)) return;
      out.add(key);
      stack.push(key);
    };
    for (const seed of seeds) {
      if (this.formulas.has(seed)) push(seed);
      for (const dependent of this.directDependents(seed)) push(dependent);
    }
    while (stack.length > 0) {
      const current = stack.pop() as CellKey;
      for (const dependent of this.directDependents(current)) push(dependent);
    }
    return out;
  }

  /**
   * Recompute the affected formulas, then keep going while any spill changed
   * a cell some OTHER formula reads. Spilled cells are not graph nodes, so a
   * single static pass cannot see those edges — the fixpoint reseeds their
   * readers. `SPILL_PASS_LIMIT` bounds a pathological array-of-arrays loop.
   */
  private run(affected: Set<CellKey>): RecalcResult {
    this.spillReseeds.clear();
    let result = this.runPass(affected);
    let guard = 0;
    while (this.spillReseeds.size > 0 && guard++ < SPILL_PASS_LIMIT) {
      const seeds = [...this.spillReseeds];
      this.spillReseeds.clear();
      result = mergeRecalc(result, this.runPass(this.affected(seeds)));
    }
    this.spillReseeds.clear();
    return result;
  }

  private runPass(affected: Set<CellKey>): RecalcResult {
    this.spillChanged = new Set<CellKey>();
    // One cache per pass, NEVER longer: values move between passes, and a
    // surviving cache would serve the world from before the edit. Within
    // the pass, `settle` invalidates on every value that actually changed,
    // so a cached range or memoized aggregate is indistinguishable from a
    // fresh read even if a covered formula cell recomputes mid-pass.
    const cache = new PassCache();
    const nodes = [...affected].sort((a, b) => a - b);
    const adjacency = new Map<CellKey, CellKey[]>();
    const inDegree = new Map<CellKey, number>();
    for (const node of nodes) inDegree.set(node, 0);
    for (const node of nodes) {
      const targets = this.directDependents(node).filter((key) => affected.has(key));
      adjacency.set(node, targets);
      for (const target of targets) {
        inDegree.set(target, (inDegree.get(target) as number) + 1);
      }
    }

    const heap = new MinHeap();
    for (const node of nodes) if (inDegree.get(node) === 0) heap.push(node);

    const computed: CellPoint[] = [];
    const changed: CellPoint[] = [];
    const cycles: CellPoint[][] = [];
    const done = new Set<CellKey>();

    const settle = (key: CellKey, result: CellValue | RangeValue) => {
      // An array result spills into neighbouring cells; the anchor keeps the
      // scalar this returns (or #SPILL! if the spill is blocked).
      const value = this.applySpill(key, result, cache);
      const previous = this.values.get(key);
      if (!sameValue(previous, value)) cache.invalidate(keyRow(key), keyCol(key));
      this.values.set(key, value);
      this.dirty.delete(key);
      done.add(key);
      computed.push(keyPoint(key));
      if (!sameValue(previous, value)) changed.push(keyPoint(key));
      for (const target of adjacency.get(key) ?? []) {
        const left = (inDegree.get(target) as number) - 1;
        inDegree.set(target, left);
        if (left === 0) heap.push(target);
      }
    };

    while (done.size < nodes.length) {
      while (heap.size > 0) {
        const key = heap.pop() as CellKey;
        if (done.has(key)) continue;
        settle(key, this.compute(key, cache));
      }
      if (done.size >= nodes.length) break;

      // Anything left is in a cycle or downstream of one. Resolving every
      // cyclic component at once lets the rest drain through the heap and see
      // #CYCLE! as an ordinary poisoned value.
      const remaining = nodes.filter((node) => !done.has(node));
      const present = new Set(remaining);
      const restricted = new Map<CellKey, CellKey[]>();
      for (const node of remaining) {
        restricted.set(
          node,
          (adjacency.get(node) ?? []).filter((key) => present.has(key)),
        );
      }
      const components = stronglyConnected(
        remaining,
        (node) => restricted.get(node) ?? [],
      );
      let released = false;
      for (const component of components) {
        if (!isCyclicComponent(component, restricted)) continue;
        cycles.push(component.map(keyPoint));
        for (const key of component) {
          if (done.has(key)) continue;
          settle(key, CYCLE_ERROR);
          released = true;
        }
      }
      if (!released) {
        // Unreachable by construction; a stall would be an infinite loop, so
        // report the survivors as cyclic rather than spin.
        cycles.push(remaining.map(keyPoint));
        for (const key of remaining) settle(key, CYCLE_ERROR);
      }
    }

    // Spilled cells are not graph nodes, but they repainted this pass, so the
    // grid must hear about them alongside the formula cells.
    for (const key of this.spillChanged) {
      computed.push(keyPoint(key));
      changed.push(keyPoint(key));
    }

    return { computed, changed, cycles: cycles.sort((a, b) => order(a[0], b[0])) };
  }

  private compute(key: CellKey, cache: PassCache): CellValue | RangeValue {
    const record = this.formulas.get(key);
    if (!record) return FORMULA_ERROR;
    if (!record.ast) return FORMULA_ERROR;
    return evaluateSpill(record.ast, {
      sheet: this.view,
      origin: { row: record.row, col: record.col },
      functions: this.functions,
      coercions: this.coercions,
      now: this.nowFn,
      maxRangeCells: this.maxRangeCells,
      cache,
    });
  }

  // --- Dynamic-array spill --------------------------------------------------

  /**
   * Materialise a formula's result and return the ANCHOR's scalar. A scalar
   * occupies only the anchor. An array spills: the anchor keeps the top-left
   * value and the rest lands in the cells below and to the right, unless
   * something already sits there, in which case the anchor is #SPILL! and
   * nothing spills. Every cell whose displayed value moved is queued for
   * repaint (`spillChanged`) and its readers for recompute (`spillReseeds`).
   *
   * Spilled cells are never persisted; `applySpill` is the single writer of
   * `spillCells`/`spillOwned`, so a recompute always clears the old footprint
   * before laying the new one — no cell can be orphaned.
   */
  private applySpill(
    anchorKey: CellKey,
    result: CellValue | RangeValue,
    cache: PassCache,
  ): CellValue {
    // 1. Lift the old footprint out of the overlay, remembering what it showed,
    //    and forget any region a previous blocked attempt had reserved.
    this.unregisterBlocked(anchorKey);
    const previousOwned = this.spillOwned.get(anchorKey) ?? [];
    const oldShown = new Map<CellKey, CellValue>();
    for (const key of previousOwned) {
      const cell = this.spillCells.get(key);
      if (cell) oldShown.set(key, cell.value);
      this.spillCells.delete(key);
    }
    this.spillOwned.delete(anchorKey);

    // 2. Decide the anchor value and the new footprint.
    let anchorValue: CellValue;
    const newOwned = new Map<CellKey, CellValue>();
    if (!isRangeValue(result)) {
      anchorValue = result;
    } else {
      const rows = result.rows;
      const height = rows.length;
      let width = 0;
      for (const row of rows) if (row.length > width) width = row.length;
      if (height <= 1 && width <= 1) {
        // A 1x1 array is indistinguishable from its scalar — no footprint.
        anchorValue = height === 1 && width === 1 ? rows[0][0] ?? null : null;
      } else {
        const anchorRow = keyRow(anchorKey);
        const anchorCol = keyCol(anchorKey);
        if (anchorCol + width - 1 > MAX_COLUMN_INDEX) {
          // A spill running past the last column has nowhere to land: the key
          // packing would wrap it into column 0 of a later row and shadow a
          // real cell. Off-sheet is #SPILL!, as Excel refuses a spill that
          // would leave the grid. Nothing to register — the edge never moves.
          anchorValue = SPILL_ERROR;
        } else {
          const intended: CellKey[] = [];
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              if (r === 0 && c === 0) continue;
              intended.push(cellKey(anchorRow + r, anchorCol + c));
            }
          }
          const blocked = intended.some((target) => this.isBlocked(target, anchorKey));
          if (blocked) {
            // Spill nothing, but remember the region so clearing the blocker
            // lets the array recover instead of staying stuck on #SPILL!.
            anchorValue = SPILL_ERROR;
            this.registerBlocked(anchorKey, intended);
          } else {
            anchorValue = rows[0]?.[0] ?? null;
            for (let r = 0; r < height; r++) {
              for (let c = 0; c < width; c++) {
                if (r === 0 && c === 0) continue;
                const targetKey = cellKey(anchorRow + r, anchorCol + c);
                const value = rows[r]?.[c] ?? null;
                this.spillCells.set(targetKey, { anchor: anchorKey, value });
                newOwned.set(targetKey, value);
              }
            }
            this.spillOwned.set(anchorKey, [...newOwned.keys()]);
          }
        }
      }
    }

    // 3. Repaint + reseed every cell whose displayed value actually moved.
    //    Comparing shown-before to shown-after handles a cell that stays owned
    //    with an unchanged value (no work) and a cell that revealed its literal
    //    again (its readers are stale) with the same code.
    const touched = new Set<CellKey>([...oldShown.keys(), ...newOwned.keys()]);
    for (const key of touched) {
      const before = oldShown.has(key)
        ? (oldShown.get(key) as CellValue)
        : this.base.getCell(keyRow(key), keyCol(key));
      const after = newOwned.has(key)
        ? (newOwned.get(key) as CellValue)
        : this.base.getCell(keyRow(key), keyCol(key));
      if (sameValue(before, after)) continue;
      cache.invalidate(keyRow(key), keyCol(key));
      this.spillChanged.add(key);
      for (const dependent of this.directDependents(key)) this.spillReseeds.add(dependent);
      // A blocked array that WANTED this cell must re-evaluate: if this spill
      // just vacated it, that array can now fit; if it just took it, that
      // array must confirm it is still blocked. Readers of a spilled cell only
      // reach it through `directDependents`; a blocked anchor does not read it,
      // so without this it would stay stuck on #SPILL! forever.
      for (const anchor of this.blockedBy.get(key) ?? []) this.spillReseeds.add(anchor);
    }

    return anchorValue;
  }

  /** Whether a spill target is occupied by anything but this anchor's array. */
  private isBlocked(targetKey: CellKey, anchorKey: CellKey): boolean {
    if (this.formulas.has(targetKey)) return true;
    const spilled = this.spillCells.get(targetKey);
    if (spilled && spilled.anchor !== anchorKey) return true;
    const base = this.base.getCell(keyRow(targetKey), keyCol(targetKey));
    return base !== null && base !== "";
  }

  // --- Dependency extraction ----------------------------------------------

  /**
   * Mirrors what the evaluator reads: an operand ref reads one cell, an
   * argument ref reads its whole rectangle, and a whole-column ref in a scalar
   * parameter reads only the current row. A ref the evaluator cannot read at
   * all (a multi-cell range in an operand position, which is #VALUE!) creates
   * no dependency, because no change to those cells can alter the result.
   */
  private dependenciesOf(ast: Ast, origin: CellPoint): CellDependencies {
    const cells = new Set<CellKey>();
    const rects: DependencyRect[] = [];
    walkRefs(
      ast,
      ({ ref, context, argument }) => {
        const shape = this.readShape(ref, context, argument, origin);
        if (!shape) return;
        if ("key" in shape) cells.add(shape.key);
        else rects.push(shape.rect);
      },
      { functions: this.functions },
    );
    return { cells: [...cells].sort((a, b) => a - b), rects };
  }

  private readShape(
    ref: Ref,
    context: RefContext,
    argument: boolean,
    origin: CellPoint,
  ): { key: CellKey } | { rect: DependencyRect } | null {
    switch (ref.kind) {
      case "cell":
        return { key: cellKey(ref.addr.row, ref.addr.col) };
      case "range": {
        const top = Math.min(ref.from.row, ref.to.row);
        const bottom = Math.max(ref.from.row, ref.to.row);
        const left = Math.min(ref.from.col, ref.to.col);
        const right = Math.max(ref.from.col, ref.to.col);
        if (top === bottom && left === right) return { key: cellKey(top, left) };
        if (!argument) return null;
        return { rect: { top, left, bottom, right } };
      }
      case "column":
      case "header": {
        let left: number;
        let right: number;
        if (ref.kind === "column") {
          left = Math.min(ref.from.col, ref.to.col);
          right = Math.max(ref.from.col, ref.to.col);
        } else {
          const col = this.base.resolveHeader(ref.name);
          if (col === null || col < 0) return null;
          left = col;
          right = col;
        }
        const single = left === right;
        if (single && context === "scalar") return { key: cellKey(origin.row, left) };
        if (!single && !argument) return null;
        return { rect: { top: 0, left, bottom: Infinity, right } };
      }
    }
  }

  // --- Reverse index -------------------------------------------------------

  private index(record: FormulaRecord): void {
    for (const cell of record.deps.cells) {
      let owners = this.cellDependents.get(cell);
      if (!owners) {
        owners = new Set();
        this.cellDependents.set(cell, owners);
      }
      owners.add(record.key);
    }
    for (const rect of record.deps.rects) {
      const blocks = this.blocksFor(rect);
      if (blocks) {
        for (const block of blocks) {
          let owners = this.blockDependents.get(block);
          if (!owners) {
            owners = new Set();
            this.blockDependents.set(block, owners);
          }
          owners.add(record.key);
        }
        continue;
      }
      const columns = this.columnsFor(rect);
      if (columns) {
        for (const column of columns) {
          let owners = this.columnDependents.get(column);
          if (!owners) {
            owners = new Set();
            this.columnDependents.set(column, owners);
          }
          owners.add(record.key);
        }
        continue;
      }
      record.wide = true;
      this.scanDependents.add(record.key);
    }
  }

  private unindex(key: CellKey): void {
    const record = this.formulas.get(key);
    if (!record) return;
    for (const cell of record.deps.cells) {
      const owners = this.cellDependents.get(cell);
      if (!owners) continue;
      owners.delete(key);
      if (owners.size === 0) this.cellDependents.delete(cell);
    }
    for (const rect of record.deps.rects) {
      const blocks = this.blocksFor(rect);
      if (blocks) {
        for (const block of blocks) {
          const owners = this.blockDependents.get(block);
          if (!owners) continue;
          owners.delete(key);
          if (owners.size === 0) this.blockDependents.delete(block);
        }
        continue;
      }
      const columns = this.columnsFor(rect);
      if (!columns) continue;
      for (const column of columns) {
        const owners = this.columnDependents.get(column);
        if (!owners) continue;
        owners.delete(key);
        if (owners.size === 0) this.columnDependents.delete(column);
      }
    }
    if (record.wide) {
      this.scanDependents.delete(key);
      record.wide = false;
    }
  }

  /** Columns for the per-column index: only a rectangle that covers EVERY
   *  row of its columns qualifies (whole-column refs are built as top 0,
   *  bottom Infinity), because the index answers "does this rect cover
   *  (row, col)?" from the column alone. A pathologically wide span falls
   *  back to the scan list like an oversized block count does. */
  private columnsFor(rect: DependencyRect): number[] | null {
    if (rect.bottom !== Infinity || rect.top > 0) return null;
    const left = Math.max(rect.left, 0);
    if (rect.right - left + 1 > this.maxIndexedBlocks) return null;
    const columns: number[] = [];
    for (let column = left; column <= rect.right; column++) columns.push(column);
    return columns;
  }

  private blocksFor(rect: DependencyRect): number[] | null {
    if (!Number.isFinite(rect.bottom) || !Number.isFinite(rect.right)) return null;
    const topBlock = Math.floor(Math.max(rect.top, 0) / this.blockRows);
    const bottomBlock = Math.floor(rect.bottom / this.blockRows);
    const leftBlock = Math.floor(Math.max(rect.left, 0) / this.blockColumns);
    const rightBlock = Math.floor(rect.right / this.blockColumns);
    const count = (bottomBlock - topBlock + 1) * (rightBlock - leftBlock + 1);
    if (count > this.maxIndexedBlocks) return null;
    const blocks: number[] = [];
    for (let r = topBlock; r <= bottomBlock; r++) {
      for (let c = leftBlock; c <= rightBlock; c++) blocks.push(r * KEY_STRIDE + c);
    }
    return blocks;
  }

  private directDependents(key: CellKey): CellKey[] {
    const row = keyRow(key);
    const col = keyCol(key);
    const out = new Set<CellKey>();
    const exact = this.cellDependents.get(key);
    if (exact) for (const owner of exact) out.add(owner);

    const block =
      Math.floor(row / this.blockRows) * KEY_STRIDE +
      Math.floor(col / this.blockColumns);
    const candidates = this.blockDependents.get(block);
    if (candidates) {
      for (const owner of candidates) {
        if (out.has(owner)) continue;
        if (this.rectsCover(owner, row, col)) out.add(owner);
      }
    }
    const columnOwners = this.columnDependents.get(col);
    if (columnOwners) {
      for (const owner of columnOwners) {
        if (out.has(owner)) continue;
        if (this.rectsCover(owner, row, col)) out.add(owner);
      }
    }
    for (const owner of this.scanDependents) {
      if (out.has(owner)) continue;
      if (this.rectsCover(owner, row, col)) out.add(owner);
    }
    return [...out].sort((a, b) => a - b);
  }

  private rectsCover(owner: CellKey, row: number, col: number): boolean {
    const record = this.formulas.get(owner);
    if (!record) return false;
    for (const rect of record.deps.rects) {
      if (contains(rect, row, col)) return true;
    }
    return false;
  }
}

function isCyclicComponent(
  component: readonly CellKey[],
  adjacency: ReadonlyMap<CellKey, readonly CellKey[]>,
): boolean {
  if (component.length > 1) return true;
  const only = component[0];
  return (adjacency.get(only) ?? []).includes(only);
}

function order(a: CellPoint, b: CellPoint): number {
  return cellKey(a.row, a.col) - cellKey(b.row, b.col);
}

/** Fold a follow-up spill pass into the running result. `computed`/`changed`
 *  are de-duplicated by cell (a later pass supersedes an earlier one); cycles
 *  concatenate, since a cycle found in any pass is real. */
function mergeRecalc(a: RecalcResult, b: RecalcResult): RecalcResult {
  const dedupe = (points: CellPoint[]): CellPoint[] => {
    const seen = new Map<CellKey, CellPoint>();
    for (const point of points) seen.set(cellKey(point.row, point.col), point);
    return [...seen.values()];
  };
  return {
    computed: dedupe([...a.computed, ...b.computed]),
    changed: dedupe([...a.changed, ...b.changed]),
    cycles: [...a.cycles, ...b.cycles],
  };
}
