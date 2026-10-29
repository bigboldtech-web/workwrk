// An in-memory stand-in for the parts of Prisma that repeating goals use, for
// the vitest suites (never imported by the app). Built on the OAuth suites'
// `matches` (src/lib/oauth/oauth-test-db.ts), with what goals need on top:
//
//   - relations, for nested `select` / `include` (keyResults, periods,
//     targets, kpi, checkIns, children, okr, _count) and for relation
//     filters (`some`, `none`, `every`, and a to-one filter);
//   - `aggregate` (_avg, _sum, _max, _min, _count), as the effort and
//     self assessment routes ask it;
//   - the unique keys (every table's id, GoalPeriod okrId+key,
//     KeyResultPeriod keyResultId+periodId, KPIRecord kpiId+userId+period): `create` throws
//     on a clash, `createMany({ skipDuplicates })` skips it, as ON CONFLICT
//     DO NOTHING does;
//   - the foreign keys: an insert whose key names no row throws (P2003), and
//     a delete follows the ON DELETE rules (CASCADE and SET NULL) the SQL
//     file declares;
//   - LOCKS THAT REALLY WAIT. pg_advisory_xact_lock (one key, or a sorted
//     batch from unnest), a GoalPeriod row FOR UPDATE, the OKR rows FOR KEY
//     SHARE and FOR UPDATE take locks held to the end of the transaction
//     (re-entrant inside it); a delete of an OKR waits for its row lock.
//     Every statement yields to the event loop first, so two transactions
//     started together interleave statement by statement, and the second
//     waits at a lock exactly where Postgres would make it wait. A thrown
//     transaction undoes its own writes (an undo log, so a concurrent
//     transaction's writes survive);
//   - the raw statements of the period module (DISTINCT ON the latest
//     period, the batched UPDATEs over unnest), of the close patch (the
//     score rows FOR UPDATE) and, from step 4, of the task write paths a
//     goal counts (a task's row FOR UPDATE, a move's subtasks FOR UPDATE,
//     a List's status set FOR UPDATE, a Trash row FOR UPDATE, the
//     ItemCompletion orphan read), from step 5, the table rows a goal
//     counts (lib/table-counts.ts liveTableRows and filledRowCounts, whose
//     ROW_HAS_DATA is played by rowHasData below; the real rule runs in
//     scripts/recurring-goals/table-source.dbtest.ts), and nothing else: any
//     other raw SQL throws, so a new statement cannot pass unnoticed. A
//     Prisma.sql fragment inside a statement is inlined, as Prisma does;
//   - COUNTERS for the cost tests: every statement (`stats.statements`), and
//     every callback a find, filter, some, map or reduce runs over a result
//     this store returned, or over an array made from one
//     (`stats.iterations`), so a lookup done by scanning a list inside a
//     loop shows up as quadratic.
//
// What it is not: isolation. A transaction's writes are visible to others
// before it commits (Postgres would hide them under READ COMMITTED). Every
// write path of repeating goals reads what it writes under the goal's lock,
// so the suites that race two paths prove the locks, not the isolation;
// the live proof against Postgres is scripts/recurring-goals/.

import { matches } from "@/lib/oauth/oauth-test-db";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type Select = Record<string, unknown>;

/**
 * A relation: the model it reaches and how a row of it belongs to the parent
 * row; `keys` ([parent field, child field]) lets one read index the children
 * once instead of scanning them for every parent.
 */
type Relation = { model: string; many: boolean; on: (parent: Row, child: Row) => boolean; keys?: [string, string] };

const REL: Record<string, Record<string, Relation>> = {
  oKR: {
    keyResults: { model: "keyResult", many: true, on: (p, c) => c.okrId === p.id, keys: ["id", "okrId"] },
    periods: { model: "goalPeriod", many: true, on: (p, c) => c.okrId === p.id, keys: ["id", "okrId"] },
    children: { model: "oKR", many: true, on: (p, c) => c.parentId === p.id, keys: ["id", "parentId"] },
    assignees: { model: "goalAssignee", many: true, on: (p, c) => c.okrId === p.id, keys: ["id", "okrId"] },
    parent: { model: "oKR", many: false, on: (p, c) => c.id === p.parentId },
  },
  keyResult: {
    kpi: { model: "kPI", many: false, on: (p, c) => c.id === p.kpiId, keys: ["kpiId", "id"] },
    checkIns: { model: "kRCheckIn", many: true, on: (p, c) => c.keyResultId === p.id, keys: ["id", "keyResultId"] },
    okr: { model: "oKR", many: false, on: (p, c) => c.id === p.okrId },
    periods: { model: "keyResultPeriod", many: true, on: (p, c) => c.keyResultId === p.id },
  },
  goalPeriod: {
    targets: { model: "keyResultPeriod", many: true, on: (p, c) => c.periodId === p.id, keys: ["id", "periodId"] },
    checkIns: { model: "kRCheckIn", many: true, on: (p, c) => c.periodId === p.id },
    okr: { model: "oKR", many: false, on: (p, c) => c.id === p.okrId },
  },
  keyResultPeriod: {
    period: { model: "goalPeriod", many: false, on: (p, c) => c.id === p.periodId },
    keyResult: { model: "keyResult", many: false, on: (p, c) => c.id === p.keyResultId },
  },
  kRCheckIn: {
    keyResult: { model: "keyResult", many: false, on: (p, c) => c.id === p.keyResultId },
    period: { model: "goalPeriod", many: false, on: (p, c) => c.id === p.periodId },
  },
  // Tasks and their List (step 4: the List sources and their write paths).
  item: {
    board: { model: "board", many: false, on: (p, c) => c.id === p.boardId },
  },
  // The score routes' person (performance scores, employee of the month).
  performanceScore: {
    user: { model: "user", many: false, on: (p, c) => c.id === p.userId },
  },
  employeeOfMonth: {
    user: { model: "user", many: false, on: (p, c) => c.id === p.userId },
  },
};

/** ON DELETE rules, as prisma/sql/2026-10-27-recurring-goals.sql and the schema declare them. */
const ON_DELETE: Record<string, Array<{ model: string; fk: string; rule: "cascade" | "setNull" }>> = {
  oKR: [
    { model: "keyResult", fk: "okrId", rule: "cascade" },
    { model: "goalPeriod", fk: "okrId", rule: "cascade" },
    { model: "goalAssignee", fk: "okrId", rule: "cascade" },
    { model: "oKR", fk: "parentId", rule: "setNull" },
  ],
  keyResult: [
    { model: "kRCheckIn", fk: "keyResultId", rule: "cascade" },
    { model: "keyResultPeriod", fk: "keyResultId", rule: "setNull" },
  ],
  goalPeriod: [
    { model: "keyResultPeriod", fk: "periodId", rule: "cascade" },
    { model: "kRCheckIn", fk: "periodId", rule: "setNull" },
  ],
};

/** The foreign keys an insert must satisfy (a NULL key is no reference). */
const FOREIGN: Record<string, Array<{ fk: string; model: string }>> = {
  keyResult: [{ fk: "okrId", model: "oKR" }],
  goalPeriod: [{ fk: "okrId", model: "oKR" }],
  keyResultPeriod: [{ fk: "periodId", model: "goalPeriod" }, { fk: "keyResultId", model: "keyResult" }],
  kRCheckIn: [{ fk: "keyResultId", model: "keyResult" }, { fk: "periodId", model: "goalPeriod" }],
};

const UNIQUE: Record<string, string[][]> = {
  goalPeriod: [["okrId", "key"]],
  keyResultPeriod: [["keyResultId", "periodId"]],
  kPIRecord: [["kpiId", "userId", "period"]],
  performanceScore: [["userId", "period"]],
};

export interface GoalFakeDb {
  rows: Record<string, Row[]>;
  /** The clock defaults (createdAt, updatedAt) read. */
  clock: () => Date;
  /** Raw statements run, in order, as text. */
  raw: string[];
  /** Writes, in order: "model.op id" (updates and deletes), for a test to read the order. */
  log: string[];
  stats: { committed: number; rolledBack: number; lockWaits: number; statements: number; iterations: number };
  /**
   * Runs right after a transaction takes a lock (its key, e.g.
   * "row:GoalPeriod:<id>"), before the statement returns: a test parks one
   * transaction there to start another against the held lock.
   */
  afterLock: ((key: string) => Promise<void> | void) | null;
  /** Runs once after the next transaction commits (its locks released): a test lands a read in that gap. */
  afterCommit: (() => Promise<void>) | null;
  /** Runs before every statement ("model.op"); a test starts a concurrent write in that window. */
  beforeStatement: ((what: string) => void) | null;
  /** The next statement matching it throws once, as a dropped connection would. */
  failNext: { what: string; error?: string } | null;
  prisma: Record<string, unknown>;
  reset(): void;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

function defaultsOf(model: string, now: Date): Row {
  const base: Row = { createdAt: now, updatedAt: now };
  switch (model) {
    case "oKR":
      return { ...base, status: "ON_TRACK", progress: 0, completedAt: null, checkInCadence: "WEEKLY", repeat: null, repeatUntil: null, parentId: null, ownerId: null, departmentId: null, description: null, quarter: null, startDate: null, endDate: null, position: 0, level: "INDIVIDUAL" };
    case "keyResult":
      return { ...base, startValue: 0, currentValue: 0, progress: 0, unit: null, kpiId: null, source: null, sourceById: null, periodStart: null, lastReminderAt: null };
    case "goalPeriod":
      return { ...base, status: "OPEN", progress: null, attainment: null, result: null, scored: null, closedAt: null, scorePatchedAt: null };
    case "keyResultPeriod":
      return { ...base, carried: false, currentValue: null, progress: null, frozenAt: null, refreshedAt: null, sourceSig: null, sourceListCount: null, pausedSince: null, pausedReason: null, unit: null, kpiId: null, kpiUserId: null };
    case "kRCheckIn":
      return { ...base, note: null, periodId: null };
    case "kPIRecord":
      return { ...base, status: "SUBMITTED" };
    case "organization":
      return { ...base, settings: {} };
    case "activityLog":
      return { ...base, metadata: null };
    case "item":
      return { ...base, itemType: "studio-item", status: "TO_DO", ownerId: null, assigneeIds: [], groupKey: null, position: 0, startAt: null, dueAt: null, priority: null, itemTypeId: null, metadata: {}, parentItemId: null, archivedAt: null, recurRule: null, recurNextAt: null, workType: null };
    case "board":
      return { ...base, itemType: "studio-item", statuses: null, schema: { fields: [] }, settings: {}, archivedAt: null, spaceId: null, folderId: null, visibility: "PUBLIC", productSlug: null, ownerId: null };
    case "itemActivity":
      return { createdAt: now, meta: {} };
    case "itemCompletion":
      return { actorId: null };
    case "dataTable":
      return { ...base, description: null, columns: [], views: [], settings: {}, isPublic: false, spaceId: null };
    case "dataTableRow":
      return { ...base, values: {}, position: 0, createdById: null, deletedAt: null };
    case "user":
      // A Member level where the row is anchored (access/acting-workspace.ts levelHeldIn reads it).
      return { ...base, deletedAt: null, status: "ACTIVE", ...legacyLevelRow("EMPLOYEE") };
    default:
      return base;
  }
}

let idSeq = 0;
const newId = (model: string) => `${model}-${++idSeq}`;

/**
 * ROW_HAS_DATA (lib/table-counts.ts), for the stand-in: a JSON object with
 * at least one key not starting "$" whose value is not null, "", false, []
 * or {}. Anything that is not an object holds no data.
 */
export function rowHasData(values: unknown): boolean {
  if (!values || typeof values !== "object" || Array.isArray(values)) return false;
  return Object.entries(values as Row).some(([k, v]) => {
    if (k.startsWith("$") || v === null || v === undefined || v === "" || v === false) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v as Row).length > 0;
    return true;
  });
}

/** A Prisma.sql fragment (sql-template-tag's Sql): its strings and values. */
function isSqlFragment(v: unknown): v is { strings: readonly string[]; values: readonly unknown[] } {
  return !!v && typeof v === "object" && Array.isArray((v as { strings?: unknown }).strings) && Array.isArray((v as { values?: unknown }).values);
}

/** A tagged statement with its Prisma.sql fragments inlined, as Prisma composes them. */
function inlineFragments(strings: readonly string[], values: readonly unknown[]): { strings: string[]; values: unknown[] } {
  const outStrings = [strings[0]];
  const outValues: unknown[] = [];
  values.forEach((v, i) => {
    if (isSqlFragment(v)) {
      const inner = inlineFragments(v.strings, v.values);
      outStrings[outStrings.length - 1] += inner.strings[0];
      inner.values.forEach((x, j) => {
        outValues.push(x);
        outStrings.push(inner.strings[j + 1]);
      });
    } else {
      outValues.push(v);
      outStrings.push("");
    }
    outStrings[outStrings.length - 1] += strings[i + 1];
  });
  return { strings: outStrings, values: outValues };
}

function cmpValues(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (x == null && y == null) return 0;
  if (x == null) return -1;
  if (y == null) return 1;
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
}

type OrderBy = Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;

function sortRows(list: Row[], orderBy: OrderBy | undefined): Row[] {
  if (!orderBy) return list;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...list].sort((a, b) => {
    for (const [k, dir] of keys) {
      const c = cmpValues(a[k], b[k]);
      if (c !== 0) return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

const SET_OF = new WeakMap<unknown[], Set<unknown>>();
const asKey = (v: unknown) => (v instanceof Date ? v.getTime() : v);
function setOf(list: unknown[]): Set<unknown> {
  let s = SET_OF.get(list);
  if (!s) {
    s = new Set(list.map(asKey));
    SET_OF.set(list, s);
  }
  return s;
}

export function createGoalFakeDb(): GoalFakeDb {
  const db: GoalFakeDb = {
    rows: {},
    clock: () => new Date(),
    raw: [],
    log: [],
    stats: { committed: 0, rolledBack: 0, lockWaits: 0, statements: 0, iterations: 0 },
    afterLock: null,
    afterCommit: null,
    beforeStatement: null,
    failNext: null,
    prisma: {},
    reset() {
      for (const k of Object.keys(db.rows)) delete db.rows[k];
      db.raw.length = 0;
      db.log.length = 0;
      for (const k of Object.keys(db.stats) as Array<keyof GoalFakeDb["stats"]>) db.stats[k] = 0;
      db.afterLock = null;
      db.afterCommit = null;
      db.beforeStatement = null;
      db.failNext = null;
      db.clock = () => new Date();
    },
  };
  const table = (name: string) => (db.rows[name] ??= []);

  /** An array that counts every callback run over it (and over arrays made from it). */
  class Counted<T> extends Array<T> {
    private static count<F extends (...a: never[]) => unknown>(fn: F): F {
      return ((...a: never[]) => {
        db.stats.iterations += 1;
        return fn(...a);
      }) as F;
    }
    find(fn: (v: T, i: number, a: T[]) => unknown): T | undefined { return super.find(Counted.count(fn)); }
    findIndex(fn: (v: T, i: number, a: T[]) => unknown): number { return super.findIndex(Counted.count(fn)); }
    filter(fn: (v: T, i: number, a: T[]) => unknown): T[] { return super.filter(Counted.count(fn)); }
    some(fn: (v: T, i: number, a: T[]) => unknown): boolean { return super.some(Counted.count(fn)); }
    forEach(fn: (v: T, i: number, a: T[]) => void): void { super.forEach(Counted.count(fn)); }
    map<U>(fn: (v: T, i: number, a: T[]) => U): U[] { return super.map(Counted.count(fn)); }
    flatMap<U>(fn: (v: T, i: number, a: T[]) => U | readonly U[]): U[] { return super.flatMap(Counted.count(fn)); }
  }
  const counted = <T,>(list: T[]): T[] => {
    const c = new Counted<T>();
    for (const x of list) c.push(x);
    return c;
  };

  // ── Relation-aware where (a long `in` list is read through a Set) ──
  const relMatches = (model: string, row: Row, where: Where | undefined): boolean => {
    if (!where) return true;
    const plain: Where = {};
    for (const [k, cond] of Object.entries(where)) {
      if (k === "OR") {
        if (!(cond as Where[]).some((c) => relMatches(model, row, c))) return false;
        continue;
      }
      if (k === "AND") {
        const list = Array.isArray(cond) ? cond : [cond];
        if (!(list as Where[]).every((c) => relMatches(model, row, c))) return false;
        continue;
      }
      if (k === "NOT") {
        const list = Array.isArray(cond) ? cond : [cond];
        if ((list as Where[]).some((c) => relMatches(model, row, c))) return false;
        continue;
      }
      const rel = REL[model]?.[k];
      if (rel && cond && typeof cond === "object") {
        const kids = table(rel.model).filter((c) => rel.on(row, c));
        const c = cond as Where;
        if (rel.many) {
          if ("some" in c && !kids.some((x) => relMatches(rel.model, x, c.some as Where))) return false;
          if ("none" in c && kids.some((x) => relMatches(rel.model, x, c.none as Where))) return false;
          if ("every" in c && !kids.every((x) => relMatches(rel.model, x, c.every as Where))) return false;
        } else {
          const one = kids[0];
          if ("is" in c) {
            if (c.is === null ? !!one : !one || !relMatches(rel.model, one, c.is as Where)) return false;
          } else if (!one || !relMatches(rel.model, one, c)) return false;
        }
        continue;
      }
      if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date) && Array.isArray((cond as Where).in)) {
        const { in: list, ...rest } = cond as Where & { in: unknown[] };
        if (!setOf(list).has(asKey(row[k]))) return false;
        if (Object.keys(rest).length > 0) plain[k] = rest;
        continue;
      }
      plain[k] = cond;
    }
    return matches(row, plain);
  };

  // ── Nested select / include ──
  // The children of an indexed relation, grouped by their key once per read.
  type Index = Map<string, Map<unknown, Row[]>>;
  const kidsOf = (rel: Relation, row: Row, index: Index): Row[] => {
    if (!rel.keys) return table(rel.model).filter((c) => rel.on(row, c));
    const [pk, ck] = rel.keys;
    const name = `${rel.model}.${ck}`;
    let byKey = index.get(name);
    if (!byKey) {
      byKey = new Map();
      for (const c of table(rel.model)) {
        const v = c[ck];
        const list = byKey.get(v);
        if (list) list.push(c);
        else byKey.set(v, [c]);
      }
      index.set(name, byKey);
    }
    return row[pk] == null ? [] : byKey.get(row[pk]) ?? [];
  };
  const shape = (model: string, row: Row, args: { select?: Select; include?: Select }, index: Index = new Map()): Row => {
    const { select, include } = args;
    const out: Row = {};
    if (!select) {
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? new Date(v.getTime()) : v;
    }
    const spec = select ?? include ?? {};
    for (const [k, on] of Object.entries(spec)) {
      if (!on) continue;
      if (k === "_count") {
        const counts: Row = {};
        const sel = ((on as Row).select ?? {}) as Row;
        for (const rk of Object.keys(sel)) {
          const rel = REL[model]?.[rk];
          counts[rk] = rel ? table(rel.model).filter((c) => rel.on(row, c)).length : 0;
        }
        out._count = counts;
        continue;
      }
      const rel = REL[model]?.[k];
      if (rel) {
        const a = (on === true ? {} : on) as { select?: Select; include?: Select; where?: Where; orderBy?: OrderBy; take?: number };
        let kids = kidsOf(rel, row, index).filter((c) => relMatches(rel.model, c, a.where));
        kids = sortRows(kids, a.orderBy);
        if (typeof a.take === "number") kids = kids.slice(0, a.take);
        const shaped = kids.map((c) => shape(rel.model, c, { select: a.select, include: a.include }, index));
        out[k] = rel.many ? counted(shaped) : (shaped[0] ?? null);
        continue;
      }
      if (select) {
        const v = row[k];
        out[k] = v instanceof Date ? new Date(v.getTime()) : v;
      }
    }
    return out;
  };

  // ── Locks and transactions ──
  const held = new Map<string, { owner: number; waiters: Array<() => void> }>();
  let txSeq = 0;
  const acquire = async (key: string, owner: number): Promise<void> => {
    for (;;) {
      const h = held.get(key);
      if (!h) {
        held.set(key, { owner, waiters: [] });
        return;
      }
      if (h.owner === owner) return;
      db.stats.lockWaits += 1;
      await new Promise<void>((r) => h.waiters.push(r));
    }
  };
  const release = (owner: number, key: string) => {
    const h = held.get(key);
    if (!h || h.owner !== owner) return;
    held.delete(key);
    for (const w of h.waiters) w();
  };
  const releaseAll = (owner: number, keys: Set<string>) => {
    for (const key of keys) release(owner, key);
  };

  type Ctx = { id: number; locks: Set<string>; undo: Array<() => void> } | null;

  const take = async (ctx: Ctx, key: string) => {
    if (!ctx) throw new Error(`${key}: a lock outside a transaction is released at once; the code must not do it`);
    await acquire(key, ctx.id);
    ctx.locks.add(key);
    if (db.afterLock) await db.afterLock(key);
  };

  const statement = async (what: string) => {
    db.stats.statements += 1;
    db.beforeStatement?.(what);
    await tick();
    if (db.failNext && what.startsWith(db.failNext.what)) {
      const message = db.failNext.error ?? `connection lost during ${what}`;
      db.failNext = null;
      throw new Error(message);
    }
  };

  // Every table's primary key is unique too (a notification written with a
  // fixed id, so a second run's insert is skipped, needs it).
  const keysOf = (model: string): string[][] => [["id"], ...(UNIQUE[model] ?? [])];
  const uniqueClash = (model: string, data: Row): boolean =>
    keysOf(model).some((cols) => cols.every((c) => data[c] != null) && table(model).some((r) => cols.every((c) => cmpValues(r[c], data[c]) === 0)));

  const checkForeign = (model: string, data: Row) => {
    for (const f of FOREIGN[model] ?? []) {
      const v = data[f.fk];
      if (v == null) continue;
      if (!table(f.model).some((r) => r.id === v)) {
        throw Object.assign(new Error(`Foreign key constraint violated on ${model}.${f.fk}`), { code: "P2003" });
      }
    }
  };

  const insert = (model: string, data: Row, ctx: Ctx, checked = false): Row => {
    const now = db.clock();
    const row: Row = { ...defaultsOf(model, now), ...data };
    if (row.id === undefined) row.id = newId(model);
    if (!checked) checkForeign(model, row);
    table(model).push(row);
    ctx?.undo.push(() => {
      db.rows[model] = table(model).filter((r) => r !== row);
    });
    return row;
  };

  const removeRow = (model: string, row: Row, ctx: Ctx) => {
    for (const rule of ON_DELETE[model] ?? []) {
      for (const child of table(rule.model).filter((c) => c[rule.fk] === row.id)) {
        if (rule.rule === "cascade") removeRow(rule.model, child, ctx);
        else {
          const before = child[rule.fk];
          child[rule.fk] = null;
          ctx?.undo.push(() => { child[rule.fk] = before; });
        }
      }
    }
    db.rows[model] = table(model).filter((r) => r !== row);
    ctx?.undo.push(() => { table(model).push(row); });
  };

  /** A delete of an OKR row waits for whoever holds it FOR KEY SHARE or FOR UPDATE. */
  const waitForRow = async (model: string, row: Row, ctx: Ctx) => {
    if (model !== "oKR") return;
    const key = `row:OKR:${String(row.id)}`;
    if (ctx) {
      await acquire(key, ctx.id);
      ctx.locks.add(key);
    } else {
      const owner = -(++txSeq);
      await acquire(key, owner);
      release(owner, key);
    }
  };

  const applyData = (row: Row, data: Row, ctx: Ctx) => {
    const before = { ...row };
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && "increment" in (v as Row)) {
        row[k] = ((row[k] as number) ?? 0) + (v as { increment: number }).increment;
      } else if (v !== undefined) row[k] = v;
    }
    if (!("updatedAt" in data)) row.updatedAt = db.clock();
    ctx?.undo.push(() => {
      for (const k of Object.keys(row)) delete row[k];
      Object.assign(row, before);
    });
  };

  /** Nested `create` of a relation inside a create's data (oKR.keyResults.create). */
  const splitNested = (model: string, data: Row): { own: Row; nested: Array<{ rel: string; items: Row[] }> } => {
    const own: Row = {};
    const nested: Array<{ rel: string; items: Row[] }> = [];
    for (const [k, v] of Object.entries(data)) {
      const rel = REL[model]?.[k];
      if (rel && v && typeof v === "object" && "create" in (v as Row)) {
        const c = (v as Row).create;
        nested.push({ rel: k, items: (Array.isArray(c) ? c : [c]) as Row[] });
      } else own[k] = v;
    }
    return { own, nested };
  };

  const model = (name: string, ctx: Ctx) => ({
    findUnique: async (a: { where: Where; select?: Select; include?: Select }) => {
      await statement(`${name}.findUnique`);
      const r = table(name).find((row) => relMatches(name, row, a.where));
      return r ? shape(name, r, a) : null;
    },
    findUniqueOrThrow: async (a: { where: Where; select?: Select; include?: Select }) => {
      await statement(`${name}.findUniqueOrThrow`);
      const r = table(name).find((row) => relMatches(name, row, a.where));
      if (!r) throw new Error(`${name}.findUniqueOrThrow: no row`);
      return shape(name, r, a);
    },
    findFirst: async (a: { where?: Where; select?: Select; include?: Select; orderBy?: OrderBy } = {}) => {
      await statement(`${name}.findFirst`);
      const r = sortRows(table(name).filter((row) => relMatches(name, row, a.where)), a.orderBy)[0];
      return r ? shape(name, r, a) : null;
    },
    findFirstOrThrow: async (a: { where?: Where; select?: Select; include?: Select; orderBy?: OrderBy } = {}) => {
      await statement(`${name}.findFirstOrThrow`);
      const r = sortRows(table(name).filter((row) => relMatches(name, row, a.where)), a.orderBy)[0];
      if (!r) throw new Error(`${name}.findFirstOrThrow: no row`);
      return shape(name, r, a);
    },
    findMany: async (a: { where?: Where; select?: Select; include?: Select; orderBy?: OrderBy; take?: number; skip?: number; distinct?: string[] } = {}) => {
      await statement(`${name}.findMany`);
      let list = sortRows(table(name).filter((row) => relMatches(name, row, a.where)), a.orderBy);
      if (a.distinct) {
        const seen = new Set<string>();
        list = list.filter((r) => {
          const key = a.distinct!.map((d) => String(r[d])).join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      if (typeof a.skip === "number") list = list.slice(a.skip);
      if (typeof a.take === "number") list = list.slice(0, a.take);
      const index: Index = new Map();
      return counted(list.map((r) => shape(name, r, a, index)));
    },
    count: async (a: { where?: Where } = {}) => {
      await statement(`${name}.count`);
      return table(name).filter((row) => relMatches(name, row, a.where)).length;
    },
    groupBy: async (a: { by: string[]; where?: Where; _max?: Record<string, boolean>; _min?: Record<string, boolean>; _count?: unknown }) => {
      await statement(`${name}.groupBy`);
      const groups = new Map<string, Row[]>();
      for (const r of table(name).filter((row) => relMatches(name, row, a.where))) {
        const key = a.by.map((b) => String(r[b])).join("|");
        const list = groups.get(key);
        if (list) list.push(r);
        else groups.set(key, [r]);
      }
      return counted([...groups.values()].map((rows) => {
        const out: Row = {};
        for (const b of a.by) out[b] = rows[0][b];
        // The largest and smallest non-null value of each field, as SQL's MAX and MIN.
        const extreme = (f: string, sign: 1 | -1): unknown => {
          let best: unknown = null;
          for (const r of rows) {
            const v = r[f];
            if (v != null && (best == null || sign * cmpValues(v, best) > 0)) best = v;
          }
          return best;
        };
        if (a._max) {
          const m: Row = {};
          for (const f of Object.keys(a._max)) m[f] = extreme(f, 1);
          out._max = m;
        }
        if (a._min) {
          const m: Row = {};
          for (const f of Object.keys(a._min)) m[f] = extreme(f, -1);
          out._min = m;
        }
        // _count: true is a number; _count: { _all, field } counts per field, as Prisma does.
        if (a._count === true) out._count = rows.length;
        else if (a._count && typeof a._count === "object") {
          const c: Row = {};
          for (const f of Object.keys(a._count as Record<string, unknown>)) c[f] = f === "_all" ? rows.length : rows.filter((r) => r[f] != null).length;
          out._count = c;
        }
        return out;
      }));
    },
    aggregate: async (a: { where?: Where; _avg?: Record<string, boolean>; _sum?: Record<string, boolean>; _max?: Record<string, boolean>; _min?: Record<string, boolean>; _count?: unknown }) => {
      await statement(`${name}.aggregate`);
      const list = table(name).filter((row) => relMatches(name, row, a.where));
      const out: Row = {};
      const numbers = (f: string) => list.map((r) => r[f]).filter((v): v is number => typeof v === "number");
      if (a._avg) {
        const m: Row = {};
        for (const f of Object.keys(a._avg)) {
          const xs = numbers(f);
          m[f] = xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null;
        }
        out._avg = m;
      }
      if (a._sum) {
        const m: Row = {};
        for (const f of Object.keys(a._sum)) {
          const xs = numbers(f);
          m[f] = xs.length ? xs.reduce((x, y) => x + y, 0) : null;
        }
        out._sum = m;
      }
      for (const [k, sign] of [["_max", 1], ["_min", -1]] as const) {
        const spec = a[k];
        if (!spec) continue;
        const m: Row = {};
        for (const f of Object.keys(spec)) {
          let best: unknown = null;
          for (const r of list) if (r[f] != null && (best == null || sign * cmpValues(r[f], best) > 0)) best = r[f];
          m[f] = best;
        }
        out[k] = m;
      }
      if (a._count === true) out._count = list.length;
      else if (a._count && typeof a._count === "object") {
        const c: Row = {};
        for (const f of Object.keys(a._count as Record<string, unknown>)) c[f] = f === "_all" ? list.length : list.filter((r) => r[f] != null).length;
        out._count = c;
      }
      return out;
    },
    create: async (a: { data: Row; select?: Select; include?: Select }) => {
      await statement(`${name}.create`);
      const { own, nested } = splitNested(name, a.data);
      if (uniqueClash(name, own)) throw Object.assign(new Error(`Unique constraint failed on ${name}`), { code: "P2002" });
      const row = insert(name, own, ctx);
      for (const n of nested) {
        const rel = REL[name][n.rel];
        for (const item of n.items) {
          const fk = name === "oKR" ? { okrId: row.id } : {};
          insert(rel.model, { ...item, ...fk }, ctx);
        }
      }
      return shape(name, row, a);
    },
    createMany: async (a: { data: Row[]; skipDuplicates?: boolean }) => {
      await statement(`${name}.createMany`);
      // The unique keys and the referenced ids, read once for the batch.
      const keyOf = (cols: string[], r: Row) => (cols.every((c) => r[c] != null) ? cols.map((c) => String(asKey(r[c]))).join("|") : null);
      const uniques = keysOf(name).map((cols) => ({ cols, seen: new Set(table(name).map((r) => keyOf(cols, r)).filter((k): k is string => k != null)) }));
      const parents = (FOREIGN[name] ?? []).map((f) => ({ f, ids: new Set(table(f.model).map((r) => r.id)) }));
      let count = 0;
      for (const d of a.data) {
        const keys = uniques.map((u) => keyOf(u.cols, d));
        if (keys.some((k, i) => k != null && uniques[i].seen.has(k))) {
          if (a.skipDuplicates) continue;
          throw Object.assign(new Error(`Unique constraint failed on ${name}`), { code: "P2002" });
        }
        for (const { f, ids } of parents) {
          if (d[f.fk] != null && !ids.has(d[f.fk])) throw Object.assign(new Error(`Foreign key constraint violated on ${name}.${f.fk}`), { code: "P2003" });
        }
        insert(name, d, ctx, true);
        keys.forEach((k, i) => { if (k != null) uniques[i].seen.add(k); });
        count += 1;
      }
      return { count };
    },
    update: async (a: { where: Where; data: Row; select?: Select; include?: Select }) => {
      await statement(`${name}.update`);
      const row = table(name).find((r) => relMatches(name, r, a.where));
      if (!row) throw Object.assign(new Error(`${name}.update: no row`), { code: "P2025" });
      db.log.push(`${name}.update ${String(row.id)}`);
      applyData(row, a.data, ctx);
      return shape(name, row, a);
    },
    updateMany: async (a: { where?: Where; data: Row }) => {
      await statement(`${name}.updateMany`);
      const hit = table(name).filter((r) => relMatches(name, r, a.where));
      for (const r of hit) applyData(r, a.data, ctx);
      return { count: hit.length };
    },
    delete: async (a: { where: Where }) => {
      await statement(`${name}.delete`);
      const row = table(name).find((r) => relMatches(name, r, a.where));
      if (!row) throw Object.assign(new Error(`${name}.delete: no row`), { code: "P2025" });
      await waitForRow(name, row, ctx);
      if (!table(name).includes(row)) throw Object.assign(new Error(`${name}.delete: no row`), { code: "P2025" });
      db.log.push(`${name}.delete ${String(row.id)}`);
      const copy = { ...row };
      removeRow(name, row, ctx);
      return copy;
    },
    deleteMany: async (a: { where?: Where } = {}) => {
      await statement(`${name}.deleteMany`);
      const hit = table(name).filter((r) => relMatches(name, r, a.where));
      for (const r of hit) await waitForRow(name, r, ctx);
      for (const r of hit) if (table(name).includes(r)) removeRow(name, r, ctx);
      return { count: hit.length };
    },
    upsert: async (a: { where: Where; create: Row; update: Row }) => {
      await statement(`${name}.upsert`);
      const row = table(name).find((r) => relMatches(name, r, a.where));
      if (row) {
        applyData(row, a.update, ctx);
        return { ...row };
      }
      return { ...insert(name, a.create, ctx) };
    },
  });

  /** The raw statements of the period module, and no others. */
  const runRaw = async (ctx: Ctx, kind: "$executeRaw" | "$queryRaw", text: string, values: unknown[]): Promise<unknown> => {
    const empty = kind === "$queryRaw" ? counted([]) : 0;
    if (/pg_advisory_xact_lock/.test(text)) {
      // One key, or a batch from unnest, taken in sorted order.
      const keys = Array.isArray(values[0]) ? [...new Set((values[0] as unknown[]).map(String))].sort() : [String(values[0])];
      for (const k of keys) await take(ctx, `advisory:${k}`);
      return kind === "$queryRaw" ? counted([]) : keys.length;
    }
    if (/FROM "GoalPeriod" WHERE "id" = \? FOR UPDATE/.test(text)) {
      const id = String(values[0]);
      await take(ctx, `row:GoalPeriod:${id}`);
      const row = table("goalPeriod").find((r) => r.id === id);
      return counted(row ? [{ ...row }] : []);
    }
    if (/FROM "OKR" WHERE "id" = ANY\(\?\)(?: ORDER BY "id")? FOR (KEY SHARE|UPDATE)/.test(text)) {
      const ids = [...new Set((values[0] as unknown[]).map(String))].sort();
      const out: Row[] = [];
      const exists = () => new Set(table("oKR").map((r) => r.id));
      const before = exists();
      for (const id of ids) {
        if (!before.has(id)) continue;
        await take(ctx, `row:OKR:${id}`);
      }
      const after = exists();
      for (const id of ids) if (before.has(id) && after.has(id)) out.push({ id });
      return counted(out);
    }
    // The close patch's score rows (goal-period-score.server.ts): the month's
    // rows holding a goal's part, and one person's row, each FOR UPDATE.
    if (/FROM "PerformanceScore" WHERE "organizationId" = \? AND "period" = \? AND \("breakdown" -> 'okrParts'\) @> \?::jsonb ORDER BY "id" FOR UPDATE/.test(text)) {
      const [orgId, period, needle] = values as [string, string, string];
      const want = (JSON.parse(needle) as Array<{ okrId: string }>)[0].okrId;
      const hit = table("performanceScore")
        .filter((r) => r.organizationId === orgId && r.period === period)
        .filter((r) => Array.isArray((r.breakdown as Row | null)?.okrParts) && ((r.breakdown as Row).okrParts as Row[]).some((x) => x && x.okrId === want))
        .sort((a, b) => cmpValues(a.id, b.id));
      for (const r of hit) await take(ctx, `row:PerformanceScore:${String(r.id)}`);
      // Read again after the locks, as Postgres re-reads a row it waited for.
      return counted(hit.filter((r) => table("performanceScore").includes(r)).map((r) => ({ id: r.id, userId: r.userId, score: r.score, breakdown: JSON.parse(JSON.stringify(r.breakdown)) })));
    }
    if (/FROM "PerformanceScore" WHERE "userId" = \? AND "period" = \? FOR UPDATE/.test(text)) {
      const [userId, period] = values as [string, string];
      const row = table("performanceScore").find((r) => r.userId === userId && r.period === period);
      if (row) await take(ctx, `row:PerformanceScore:${String(row.id)}`);
      const now = row && table("performanceScore").includes(row) ? row : null;
      return counted(now ? [{ id: now.id, userId: now.userId, score: now.score, breakdown: JSON.parse(JSON.stringify(now.breakdown)) }] : []);
    }
    if (/SELECT DISTINCT ON \("okrId"\)/.test(text) && /FROM "GoalPeriod" WHERE "okrId" = ANY\(\?\)/.test(text)) {
      const ids = setOf(values[0] as unknown[]);
      const latest = new Map<string, Row>();
      for (const r of table("goalPeriod")) {
        if (!ids.has(r.okrId)) continue;
        const had = latest.get(String(r.okrId));
        if (!had || cmpValues(r.startsAt, had.startsAt) > 0) latest.set(String(r.okrId), r);
      }
      return counted([...latest.values()].map((r) => ({ ...r })));
    }
    if (/^UPDATE "KeyResult" AS k SET "currentValue" = v\."currentValue", "progress" = v\."progress" FROM unnest\(\?::text\[\], \?::float8\[\], \?::int\[\]\)/.test(text)) {
      const [ids, values1, progress] = values as [string[], number[], number[]];
      const byId = new Map(table("keyResult").map((r) => [r.id, r]));
      let n = 0;
      ids.forEach((id, i) => {
        const row = byId.get(id);
        if (!row) return;
        db.log.push(`keyResult.update ${id}`);
        applyData(row, { currentValue: values1[i], progress: progress[i] }, ctx);
        n += 1;
      });
      return n;
    }
    if (/^UPDATE "OKR" AS o SET "progress" = v\."progress", "status" = v\."status" FROM unnest\(\?::text\[\], \?::int\[\], \?::text\[\]\)/.test(text)) {
      const [ids, progress, status] = values as [string[], number[], string[]];
      const byId = new Map(table("oKR").map((r) => [r.id, r]));
      let n = 0;
      ids.forEach((id, i) => {
        const row = byId.get(id);
        if (!row) return;
        db.log.push(`oKR.update ${id}`);
        applyData(row, { progress: progress[i], status: status[i] }, ctx);
        n += 1;
      });
      return n;
    }
    // Step 4: the task write paths a goal counts (item-completions.ts).
    if (/^SELECT (status|metadata|id|metadata, status, "groupKey") FROM "Item" WHERE id = \? FOR UPDATE$/.test(text)) {
      const id = String(values[0]);
      await take(ctx, `row:Item:${id}`);
      const row = table("item").find((r) => r.id === id);
      return counted(row ? [{ id: row.id, status: row.status, metadata: row.metadata, groupKey: row.groupKey ?? null }] : []);
    }
    // A move's subtasks, each row locked in id order, their statuses read again.
    if (/^SELECT id, status FROM "Item" WHERE id = ANY\(\?\) ORDER BY id FOR UPDATE$/.test(text)) {
      const ids = [...new Set((values[0] as unknown[]).map(String))].sort();
      for (const id of ids) await take(ctx, `row:Item:${id}`);
      const byId = new Map(table("item").map((r) => [String(r.id), r]));
      return counted(ids.filter((id) => byId.has(id)).map((id) => ({ id, status: byId.get(id)!.status })));
    }
    if (/^SELECT settings, name, statuses, "organizationId" FROM "Board" WHERE id = \? FOR UPDATE$/.test(text)) {
      const id = String(values[0]);
      await take(ctx, `row:Board:${id}`);
      const row = table("board").find((r) => r.id === id);
      return counted(row ? [{ settings: row.settings, name: row.name, statuses: row.statuses, organizationId: row.organizationId }] : []);
    }
    if (/^SELECT "organizationId", snapshot FROM "TrashItem" WHERE id = \? FOR UPDATE$/.test(text)) {
      const id = String(values[0]);
      await take(ctx, `row:TrashItem:${id}`);
      const row = table("trashItem").find((r) => r.id === id);
      return counted(row ? [{ organizationId: row.organizationId, snapshot: row.snapshot }] : []);
    }
    // Step 5: a table's live rows in storage order, each with ROW_HAS_DATA
    // as "filled" (and only the filled ones with the rule in the WHERE);
    // the whole values, or only the keys named (a plain count's projection).
    const tableRows = /^SELECT r\."id" AS "id", (r\."values"|\(SELECT COALESCE\(jsonb_object_agg\(e\.key, e\.value\), '\{\}'::jsonb\) FROM jsonb_each\( CASE WHEN jsonb_typeof\(r\."values"::jsonb\) = 'object' THEN r\."values"::jsonb ELSE '\{\}'::jsonb END \) e WHERE e\.key = ANY\(\?::text\[\]\)\)) AS "values", EXISTS \(.+\) AS "filled" FROM "DataTableRow" r WHERE r\."tableId" = \? AND r\."deletedAt" IS NULL (AND EXISTS \(.+\) )?ORDER BY r\."position" ASC, r\."id" ASC$/.exec(text);
    if (tableRows) {
      const keys = tableRows[1] === 'r."values"' ? null : new Set((values[0] as unknown[]).map(String));
      const tableId = String(values[keys ? 1 : 0]);
      const project = (v: unknown): unknown => {
        const copy = JSON.parse(JSON.stringify(v ?? {}));
        if (!keys) return copy;
        if (!copy || typeof copy !== "object" || Array.isArray(copy)) return {};
        return Object.fromEntries(Object.entries(copy as Row).filter(([k]) => keys.has(k)));
      };
      const live = table("dataTableRow")
        .filter((r) => r.tableId === tableId && r.deletedAt == null)
        .map((r) => ({ row: r, filled: rowHasData(r.values) }))
        .filter((x) => !tableRows[2] || x.filled)
        .sort((a, b) => cmpValues(a.row.position, b.row.position) || cmpValues(a.row.id, b.row.id));
      return counted(live.map((x) => ({ id: x.row.id, values: project(x.row.values), filled: x.filled })));
    }
    if (/^SELECT r\."tableId" AS "tableId", COUNT\(\*\) AS n FROM "DataTableRow" r WHERE r\."tableId" IN \([?,]+\) AND r\."deletedAt" IS NULL AND EXISTS \(.+\) GROUP BY r\."tableId"$/.test(text)) {
      const ids = setOf(values as unknown[]);
      const n = new Map<string, number>();
      for (const r of table("dataTableRow")) {
        if (!ids.has(r.tableId) || r.deletedAt != null || !rowHasData(r.values)) continue;
        n.set(String(r.tableId), (n.get(String(r.tableId)) ?? 0) + 1);
      }
      return counted([...n].map(([tableId, count]) => ({ tableId, n: BigInt(count) })));
    }
    const orphans = /^SELECT c\."id" FROM "ItemCompletion" c WHERE (c\."organizationId" = \? AND )?NOT EXISTS \(SELECT 1 FROM "Item" i WHERE i\."id" = c\."itemId"\) LIMIT 5000$/.exec(text);
    if (orphans) {
      const live = new Set(table("item").map((r) => r.id));
      const org = orphans[1] ? String(values[0]) : null;
      return counted(table("itemCompletion").filter((c) => !live.has(c.itemId) && (!org || c.organizationId === org)).slice(0, 5000).map((c) => ({ id: c.id })));
    }
    void empty;
    throw new Error(`goal-test-db: no stand-in for raw SQL: ${text}`);
  };

  const client = (ctx: Ctx): Record<string, unknown> => {
    const models = new Map<string, ReturnType<typeof model>>();
    return new Proxy({}, {
      get: (_t, key: string) => {
        if (key === "$transaction") {
          return async (arg: unknown) => {
            if (Array.isArray(arg)) return Promise.all(arg);
            const fn = arg as (tx: unknown) => Promise<unknown>;
            // A nested $transaction (inside one) runs in the same one.
            if (ctx) return fn(client(ctx));
            const inner = { id: ++txSeq, locks: new Set<string>(), undo: [] as Array<() => void> };
            let ok = false;
            try {
              const out = await fn(client(inner));
              db.stats.committed += 1;
              ok = true;
              return out;
            } catch (err) {
              for (const u of inner.undo.reverse()) u();
              db.stats.rolledBack += 1;
              throw err;
            } finally {
              releaseAll(inner.id, inner.locks);
              if (ok && db.afterCommit) {
                const hook = db.afterCommit;
                db.afterCommit = null;
                await hook();
              }
            }
          };
        }
        if (key === "$executeRaw" || key === "$queryRaw") {
          return async (tagged: TemplateStringsArray, ...raw: unknown[]) => {
            const { strings, values } = inlineFragments(tagged, raw);
            const text = strings.join("?").replace(/\s+/g, " ").trim();
            await statement(`raw ${text.slice(0, 40)}`);
            db.raw.push(text + (values.length ? ` [${values.map((v) => (Array.isArray(v) ? `${v.length} values` : String(v))).join(", ")}]` : ""));
            return runRaw(ctx, key, text, values);
          };
        }
        if (typeof key !== "string" || key.startsWith("$") || key === "then") return undefined;
        if (!models.has(key)) models.set(key, model(key, ctx));
        return models.get(key);
      },
    });
  };
  db.prisma = client(null);
  return db;
}

/** A row in a model, with that model's defaults. */
export function seedRow(db: GoalFakeDb, name: string, row: Row): Row {
  const full: Row = { ...defaultsOf(name, db.clock()), ...row };
  if (full.id === undefined) full.id = newId(name);
  (db.rows[name] ??= []).push(full);
  return full;
}

/** The one store the goal suites mock @/lib/prisma with. */
export const goalDb = createGoalFakeDb();
