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
  evaluate,
  walkRefs,
  type CellPoint,
  type Coercions,
  type FunctionLookup,
  type RefContext,
  type SheetAccess,
} from "./evaluate";
import { parseFormula } from "./parser";
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
  private readonly scanDependents = new Set<CellKey>();

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
    this.view = {
      getCell: (row, col) => {
        const key = cellKey(row, col);
        if (!formulas.has(key)) return base.getCell(row, col);
        const value = values.get(key);
        return value === undefined ? null : value;
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
    this.unindex(key);
    this.formulas.delete(key);
    this.values.delete(key);
    this.dirty.delete(key);
    return true;
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

  /** Index occupancy, so a test can prove ranges are never expanded. */
  indexSize(): { cells: number; blocks: number; scans: number } {
    let cells = 0;
    for (const set of this.cellDependents.values()) cells += set.size;
    let blocks = 0;
    for (const set of this.blockDependents.values()) blocks += set.size;
    return { cells, blocks, scans: this.scanDependents.size };
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
    for (const point of changed) seeds.push(cellKey(point.row, point.col));
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

  private run(affected: Set<CellKey>): RecalcResult {
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

    const settle = (key: CellKey, value: CellValue) => {
      const previous = this.values.get(key);
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
        settle(key, this.compute(key));
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

    return { computed, changed, cycles: cycles.sort((a, b) => order(a[0], b[0])) };
  }

  private compute(key: CellKey): CellValue {
    const record = this.formulas.get(key);
    if (!record) return FORMULA_ERROR;
    if (!record.ast) return FORMULA_ERROR;
    return evaluate(record.ast, {
      sheet: this.view,
      origin: { row: record.row, col: record.col },
      functions: this.functions,
      coercions: this.coercions,
      now: this.nowFn,
      maxRangeCells: this.maxRangeCells,
    });
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
      if (!blocks) {
        record.wide = true;
        this.scanDependents.add(record.key);
        continue;
      }
      for (const block of blocks) {
        let owners = this.blockDependents.get(block);
        if (!owners) {
          owners = new Set();
          this.blockDependents.set(block, owners);
        }
        owners.add(record.key);
      }
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
      if (!blocks) continue;
      for (const block of blocks) {
        const owners = this.blockDependents.get(block);
        if (!owners) continue;
        owners.delete(key);
        if (owners.size === 0) this.blockDependents.delete(block);
      }
    }
    if (record.wide) {
      this.scanDependents.delete(key);
      record.wide = false;
    }
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
