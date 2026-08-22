// Reference rewriting for structure changes, plus the serialiser that turns a
// rewritten tree back into formula text. Pure: no React, no DOM, no I/O.
//
// This is the fix for the live bug in `sheet-formula.ts`, where column
// formulas address columns by position: reordering a column silently repoints
// every formula at whichever column slid into the old slot. Here a move is a
// permutation applied to the refs themselves, a delete produces #REF! instead
// of a wrong number, and a range that straddles a deletion contracts.
//
// TWO SEMANTICS FOR `$`, AND THE DEFAULT DIVERGES FROM EXCEL.
// In Excel and Sheets, `$` affects COPY AND FILL only: a structural insert or
// delete rewrites every reference, pinned or not, so `=B2*$D$1` becomes
// `=B3*$D$2` when a row is inserted above. This module defaults to
// `pinAbsolute: true`, where a pinned coordinate keeps its index through an
// insert, because that is the behaviour the Phase 3 brief and the address
// model in `types.ts` both specify. Pass `pinAbsolute: false` for
// spreadsheet-standard behaviour. Deletes and moves always rewrite: a pinned
// ref to a row that no longer exists is #REF! either way, and letting a pin
// survive a reorder would reintroduce the very bug above.
//
// `translateRef` is the other meaning of `$` and is not affected by the option:
// copy and fill shift relative coordinates and leave pinned ones alone, always.

import { parseFormula } from "./parser";
import { MAX_ROW_NUMBER } from "./tokenizer";
import {
  MAX_COLUMN_INDEX,
  columnLabel,
  type Ast,
  type BinaryOperator,
  type CellAddress,
  type ColumnBound,
  type ColumnRef,
  type FormulaParseError,
  type RangeRef,
  type Ref,
} from "./types";

const MAX_ROW_INDEX = MAX_ROW_NUMBER - 1;

export type StructureChange =
  | { type: "insert-rows"; at: number; count: number }
  | { type: "delete-rows"; at: number; count: number }
  /** `to` is the destination index AFTER the block is lifted out. */
  | { type: "move-rows"; from: number; count: number; to: number }
  | { type: "insert-columns"; at: number; count: number }
  | { type: "delete-columns"; at: number; count: number }
  | { type: "move-columns"; from: number; count: number; to: number }
  | { type: "rename-header"; from: string; to: string };

export interface RewriteOptions {
  /** Default true. See the note at the top of this file. */
  pinAbsolute?: boolean;
  /**
   * Needed to decide whether a header ref died with a deleted column. Without
   * it, header refs survive column deletes untouched.
   */
  resolveHeader?: (name: string) => number | null;
}

export type RewriteResult =
  | { ok: true; source: string; changed: boolean }
  | { ok: false; error: FormulaParseError };

type Axis = "row" | "column";

interface AxisEdit {
  kind: "insert" | "delete" | "move";
  at: number;
  count: number;
  to: number;
  limit: number;
}

function axisEdit(change: StructureChange): { axis: Axis; edit: AxisEdit } | null {
  switch (change.type) {
    case "insert-rows":
      return {
        axis: "row",
        edit: { kind: "insert", at: change.at, count: change.count, to: 0, limit: MAX_ROW_INDEX },
      };
    case "delete-rows":
      return {
        axis: "row",
        edit: { kind: "delete", at: change.at, count: change.count, to: 0, limit: MAX_ROW_INDEX },
      };
    case "move-rows":
      return {
        axis: "row",
        edit: {
          kind: "move",
          at: change.from,
          count: change.count,
          to: change.to,
          limit: MAX_ROW_INDEX,
        },
      };
    case "insert-columns":
      return {
        axis: "column",
        edit: {
          kind: "insert",
          at: change.at,
          count: change.count,
          to: 0,
          limit: MAX_COLUMN_INDEX,
        },
      };
    case "delete-columns":
      return {
        axis: "column",
        edit: {
          kind: "delete",
          at: change.at,
          count: change.count,
          to: 0,
          limit: MAX_COLUMN_INDEX,
        },
      };
    case "move-columns":
      return {
        axis: "column",
        edit: {
          kind: "move",
          at: change.from,
          count: change.count,
          to: change.to,
          limit: MAX_COLUMN_INDEX,
        },
      };
    default:
      return null;
  }
}

function inBand(index: number, edit: AxisEdit): boolean {
  return index >= edit.at && index < edit.at + edit.count;
}

/** null means the target no longer exists: the ref becomes #REF!. */
function shiftIndex(
  index: number,
  absolute: boolean,
  edit: AxisEdit,
  pin: boolean,
): number | null {
  if (edit.count <= 0) return index;
  let next: number;
  switch (edit.kind) {
    case "insert":
      next = pin && absolute ? index : index >= edit.at ? index + edit.count : index;
      break;
    case "delete":
      if (inBand(index, edit)) return null;
      next =
        pin && absolute
          ? index
          : index >= edit.at + edit.count
            ? index - edit.count
            : index;
      break;
    default: {
      // A move relocates the addressed cell, so the ref follows it whether or
      // not it is pinned.
      if (inBand(index, edit)) {
        next = edit.to + (index - edit.at);
        break;
      }
      const lifted = index >= edit.at + edit.count ? index - edit.count : index;
      next = lifted >= edit.to ? lifted + edit.count : lifted;
      break;
    }
  }
  if (next < 0 || next > edit.limit) return null;
  return next;
}

/**
 * The two ends of a range move by different rules under a delete: the low end
 * clamps to the top of the hole and the high end to the row above it, which is
 * what makes a straddling range contract instead of dying.
 */
function shiftSpan(
  lo: number,
  loAbsolute: boolean,
  hi: number,
  hiAbsolute: boolean,
  edit: AxisEdit,
  pin: boolean,
): { lo: number; hi: number } | null {
  if (edit.kind !== "delete") {
    const a = shiftIndex(lo, loAbsolute, edit, pin);
    const b = shiftIndex(hi, hiAbsolute, edit, pin);
    if (a === null || b === null) return null;
    // A move can carry one end past the other; the rectangle is the same.
    return a <= b ? { lo: a, hi: b } : { lo: b, hi: a };
  }
  if (edit.count <= 0) return { lo, hi };

  const shift = (index: number, absolute: boolean): number =>
    pin && absolute
      ? index
      : index >= edit.at + edit.count
        ? index - edit.count
        : index;

  const nextLo = inBand(lo, edit) ? edit.at : shift(lo, loAbsolute);
  const nextHi = inBand(hi, edit) ? edit.at - 1 : shift(hi, hiAbsolute);
  if (nextHi < nextLo) return null;
  if (nextLo < 0 || nextHi > edit.limit) return null;
  return { lo: nextLo, hi: nextHi };
}

function withRow(addr: CellAddress, row: number): CellAddress {
  return { ...addr, row };
}

function withCol(addr: CellAddress, col: number): CellAddress {
  return { ...addr, col };
}

function rewriteRange(
  ref: RangeRef,
  axis: Axis,
  edit: AxisEdit,
  pin: boolean,
): Ref | null {
  if (axis === "row") {
    const fromIsLow = ref.from.row <= ref.to.row;
    const low = fromIsLow ? ref.from : ref.to;
    const high = fromIsLow ? ref.to : ref.from;
    const span = shiftSpan(
      low.row,
      low.rowAbsolute,
      high.row,
      high.rowAbsolute,
      edit,
      pin,
    );
    if (!span) return null;
    return {
      kind: "range",
      from: withRow(ref.from, fromIsLow ? span.lo : span.hi),
      to: withRow(ref.to, fromIsLow ? span.hi : span.lo),
    };
  }
  const fromIsLow = ref.from.col <= ref.to.col;
  const low = fromIsLow ? ref.from : ref.to;
  const high = fromIsLow ? ref.to : ref.from;
  const span = shiftSpan(
    low.col,
    low.colAbsolute,
    high.col,
    high.colAbsolute,
    edit,
    pin,
  );
  if (!span) return null;
  return {
    kind: "range",
    from: withCol(ref.from, fromIsLow ? span.lo : span.hi),
    to: withCol(ref.to, fromIsLow ? span.hi : span.lo),
  };
}

function rewriteColumn(ref: ColumnRef, edit: AxisEdit, pin: boolean): Ref | null {
  const fromIsLow = ref.from.col <= ref.to.col;
  const low = fromIsLow ? ref.from : ref.to;
  const high = fromIsLow ? ref.to : ref.from;
  const span = shiftSpan(low.col, low.absolute, high.col, high.absolute, edit, pin);
  if (!span) return null;
  const bound = (source: ColumnBound, col: number): ColumnBound => ({
    col,
    absolute: source.absolute,
  });
  return {
    kind: "column",
    from: bound(ref.from, fromIsLow ? span.lo : span.hi),
    to: bound(ref.to, fromIsLow ? span.hi : span.lo),
  };
}

function sameHeader(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function sameAddress(a: CellAddress, b: CellAddress): boolean {
  return a.row === b.row && a.col === b.col;
}

/**
 * Identity is load-bearing: `rewriteFormula` leaves a formula's stored text
 * untouched when nothing moved, and the tree walk decides that by reference.
 */
function sameRef(a: Ref, b: Ref): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "cell" && b.kind === "cell") return sameAddress(a.addr, b.addr);
  if (a.kind === "range" && b.kind === "range") {
    return sameAddress(a.from, b.from) && sameAddress(a.to, b.to);
  }
  if (a.kind === "column" && b.kind === "column") {
    return a.from.col === b.from.col && a.to.col === b.to.col;
  }
  if (a.kind === "header" && b.kind === "header") return a.name === b.name;
  return false;
}

function preserve(original: Ref, next: Ref | null): Ref | null {
  if (next === null) return null;
  return sameRef(original, next) ? original : next;
}

/** null means the ref should become #REF!. */
export function rewriteRef(
  ref: Ref,
  change: StructureChange,
  options: RewriteOptions = {},
): Ref | null {
  return preserve(ref, rewriteRefInner(ref, change, options));
}

function rewriteRefInner(
  ref: Ref,
  change: StructureChange,
  options: RewriteOptions,
): Ref | null {
  const pin = options.pinAbsolute ?? true;

  if (change.type === "rename-header") {
    if (ref.kind !== "header" || !sameHeader(ref.name, change.from)) return ref;
    return { kind: "header", name: change.to };
  }

  const resolved = axisEdit(change);
  if (!resolved) return ref;
  const { axis, edit } = resolved;

  switch (ref.kind) {
    case "cell": {
      if (axis === "row") {
        const row = shiftIndex(ref.addr.row, ref.addr.rowAbsolute, edit, pin);
        return row === null ? null : { kind: "cell", addr: withRow(ref.addr, row) };
      }
      const col = shiftIndex(ref.addr.col, ref.addr.colAbsolute, edit, pin);
      return col === null ? null : { kind: "cell", addr: withCol(ref.addr, col) };
    }
    case "range":
      return rewriteRange(ref, axis, edit, pin);
    case "column":
      // Whole columns are indifferent to row edits.
      return axis === "row" ? ref : rewriteColumn(ref, edit, pin);
    case "header": {
      // A header names its column, so a reorder is exactly what it survives.
      if (axis !== "column" || edit.kind !== "delete") return ref;
      const col = options.resolveHeader?.(ref.name);
      if (col === undefined || col === null || col < 0) return ref;
      return inBand(col, edit) ? null : ref;
    }
  }
}

/** Copy and fill: relative coordinates move, pinned ones never do. */
export function translateRef(ref: Ref, rowDelta: number, colDelta: number): Ref | null {
  return preserve(ref, translateRefInner(ref, rowDelta, colDelta));
}

function translateRefInner(ref: Ref, rowDelta: number, colDelta: number): Ref | null {
  const move = (value: number, absolute: boolean, delta: number, limit: number) => {
    if (absolute || delta === 0) return value;
    const next = value + delta;
    return next < 0 || next > limit ? null : next;
  };
  const cell = (addr: CellAddress): CellAddress | null => {
    const row = move(addr.row, addr.rowAbsolute, rowDelta, MAX_ROW_INDEX);
    const col = move(addr.col, addr.colAbsolute, colDelta, MAX_COLUMN_INDEX);
    if (row === null || col === null) return null;
    return { ...addr, row, col };
  };

  switch (ref.kind) {
    case "cell": {
      const addr = cell(ref.addr);
      return addr === null ? null : { kind: "cell", addr };
    }
    case "range": {
      const from = cell(ref.from);
      const to = cell(ref.to);
      if (from === null || to === null) return null;
      return { kind: "range", from, to };
    }
    case "column": {
      const from = move(ref.from.col, ref.from.absolute, colDelta, MAX_COLUMN_INDEX);
      const to = move(ref.to.col, ref.to.absolute, colDelta, MAX_COLUMN_INDEX);
      if (from === null || to === null) return null;
      return {
        kind: "column",
        from: { col: from, absolute: ref.from.absolute },
        to: { col: to, absolute: ref.to.absolute },
      };
    }
    case "header":
      return ref;
  }
}

// --- Tree rewriting --------------------------------------------------------

interface Tracked {
  ast: Ast;
  changed: boolean;
}

function mapRefs(node: Ast, apply: (ref: Ref) => Ref | null, state: { changed: boolean }): Ast {
  switch (node.type) {
    case "ref": {
      const next = apply(node.ref);
      if (next === node.ref) return node;
      state.changed = true;
      if (next === null) {
        // Spans still point into the ORIGINAL source; re-parse the formatted
        // output if fresh offsets are needed.
        return { type: "error", value: "#REF!", start: node.start, end: node.end };
      }
      return { type: "ref", ref: next, start: node.start, end: node.end };
    }
    case "unary": {
      const operand = mapRefs(node.operand, apply, state);
      return operand === node.operand ? node : { ...node, operand };
    }
    case "percent": {
      const operand = mapRefs(node.operand, apply, state);
      return operand === node.operand ? node : { ...node, operand };
    }
    case "binary": {
      const left = mapRefs(node.left, apply, state);
      const right = mapRefs(node.right, apply, state);
      return left === node.left && right === node.right ? node : { ...node, left, right };
    }
    case "call": {
      let touched = false;
      const args = node.args.map((arg) => {
        const next = mapRefs(arg, apply, state);
        if (next !== arg) touched = true;
        return next;
      });
      return touched ? { ...node, args } : node;
    }
    default:
      return node;
  }
}

export function rewriteAst(
  ast: Ast,
  change: StructureChange,
  options: RewriteOptions = {},
): Tracked {
  const state = { changed: false };
  const next = mapRefs(ast, (ref) => rewriteRef(ref, change, options), state);
  return { ast: next, changed: state.changed };
}

export function translateAst(ast: Ast, rowDelta: number, colDelta: number): Tracked {
  const state = { changed: false };
  const next = mapRefs(ast, (ref) => translateRef(ref, rowDelta, colDelta), state);
  return { ast: next, changed: state.changed };
}

/**
 * Rewrite stored formula text. An untouched formula comes back byte-identical
 * rather than reformatted, so a structure change only writes the rows it
 * actually altered.
 */
export function rewriteFormula(
  source: string,
  change: StructureChange,
  options: RewriteOptions = {},
): RewriteResult {
  return reserialize(source, (ast) => rewriteAst(ast, change, options));
}

export function translateFormula(
  source: string,
  rowDelta: number,
  colDelta: number,
): RewriteResult {
  return reserialize(source, (ast) => translateAst(ast, rowDelta, colDelta));
}

function reserialize(source: string, transform: (ast: Ast) => Tracked): RewriteResult {
  const parsed = parseFormula(source);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { ast, changed } = transform(parsed.ast);
  if (!changed) return { ok: true, source, changed: false };
  const prefix = /^\s*=/.test(source) ? "=" : "";
  return { ok: true, source: prefix + formatAst(ast), changed: true };
}

// --- Serialisation ---------------------------------------------------------

const BINARY_PRECEDENCE: Record<BinaryOperator, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  "<=": 1,
  ">": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 6,
};

const UNARY_PRECEDENCE = 5;
const PERCENT_PRECEDENCE = 7;
const PRIMARY_PRECEDENCE = 8;

function precedenceOf(node: Ast): number {
  if (node.type === "binary") return BINARY_PRECEDENCE[node.op];
  if (node.type === "unary") return UNARY_PRECEDENCE;
  if (node.type === "percent") return PERCENT_PRECEDENCE;
  return PRIMARY_PRECEDENCE;
}

function formatNumber(value: number): string {
  // Only reachable from a hand-built tree: the tokenizer cannot produce these.
  if (!Number.isFinite(value)) return "#NUM!";
  return String(value);
}

function addressText(addr: CellAddress): string {
  if (addr.col < 0 || addr.col > MAX_COLUMN_INDEX || addr.row < 0) return "#REF!";
  return `${addr.colAbsolute ? "$" : ""}${columnLabel(addr.col)}${
    addr.rowAbsolute ? "$" : ""
  }${addr.row + 1}`;
}

function boundText(bound: ColumnBound): string {
  if (bound.col < 0 || bound.col > MAX_COLUMN_INDEX) return "#REF!";
  return `${bound.absolute ? "$" : ""}${columnLabel(bound.col)}`;
}

/** Always the explicit `A:A` form, so a bare `A` round-trips unambiguously. */
export function formatRef(ref: Ref): string {
  switch (ref.kind) {
    case "cell":
      return addressText(ref.addr);
    case "range":
      return `${addressText(ref.from)}:${addressText(ref.to)}`;
    case "column":
      return `${boundText(ref.from)}:${boundText(ref.to)}`;
    case "header":
      return `[${ref.name.replace(/]/g, "]]")}]`;
  }
}

function needsParens(child: Ast, parent: number, side: "left" | "right", op: BinaryOperator): boolean {
  const prec = precedenceOf(child);
  if (prec < parent) return true;
  if (prec > parent) return false;
  // `^` groups to the right, everything else to the left.
  return op === "^" ? side === "left" : side === "right";
}

/**
 * Re-inserts the parentheses that the tree shape implies, including where two
 * same-precedence operations would otherwise re-associate: `a-(b-c)` keeps its
 * parens because dropping them changes the answer.
 */
export function formatAst(node: Ast): string {
  switch (node.type) {
    case "number":
      return formatNumber(node.value);
    case "string":
      return `"${node.value.replace(/"/g, '""')}"`;
    case "boolean":
      return node.value ? "TRUE" : "FALSE";
    case "error":
      return node.value;
    case "ref":
      return formatRef(node.ref);
    case "name":
      return node.name;
    case "unary": {
      const inner = formatAst(node.operand);
      return precedenceOf(node.operand) < UNARY_PRECEDENCE
        ? `${node.op}(${inner})`
        : `${node.op}${inner}`;
    }
    case "percent": {
      const inner = formatAst(node.operand);
      return precedenceOf(node.operand) < PERCENT_PRECEDENCE
        ? `(${inner})%`
        : `${inner}%`;
    }
    case "binary": {
      const prec = BINARY_PRECEDENCE[node.op];
      const left = formatAst(node.left);
      const right = formatAst(node.right);
      const leftText = needsParens(node.left, prec, "left", node.op) ? `(${left})` : left;
      const rightText = needsParens(node.right, prec, "right", node.op)
        ? `(${right})`
        : right;
      return `${leftText}${node.op}${rightText}`;
    }
    case "call":
      return `${node.name}(${node.args.map(formatAst).join(",")})`;
  }
}
