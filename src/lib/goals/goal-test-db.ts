// An in-memory stand-in for the parts of Prisma that repeating goals use, for
// the vitest suites (never imported by the app). Built on the OAuth suites'
// `matches` (src/lib/oauth/oauth-test-db.ts), with what goals need on top:
//
//   - relations, for nested `select` / `include` (keyResults, periods,
//     targets, kpi, checkIns, children, okr, _count) and for relation
//     filters (`some`, `none`, `every`, and a to-one filter);
//   - the unique keys (GoalPeriod okrId+key, KeyResultPeriod
//     keyResultId+periodId, KPIRecord kpiId+userId+period): `create` throws
//     on a clash, `createMany({ skipDuplicates })` skips it, as ON CONFLICT
//     DO NOTHING does;
//   - the foreign keys' ON DELETE rules (CASCADE and SET NULL) the SQL file
//     declares;
//   - LOCKS THAT REALLY WAIT. `$executeRaw` of pg_advisory_xact_lock and
//     `$queryRaw` of a GoalPeriod row FOR UPDATE take a lock held to the end
//     of the transaction (re-entrant inside it), and every statement yields
//     to the event loop first, so two transactions started together
//     interleave statement by statement, and the second one waits at the
//     lock exactly where Postgres would make it wait. A thrown transaction
//     undoes its own writes (an undo log, so a concurrent transaction's
//     writes survive).
//
// What it is not: isolation. A transaction's writes are visible to others
// before it commits (Postgres would hide them under READ COMMITTED). Every
// write path of repeating goals reads what it writes under the goal's lock,
// so the suites that race two paths prove the locks, not the isolation;
// the live proof against Postgres is named in the step report.

import { matches } from "@/lib/oauth/oauth-test-db";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type Select = Record<string, unknown>;

/** A relation: the model it reaches and how a row of it belongs to the parent row. */
type Relation = { model: string; many: boolean; on: (parent: Row, child: Row) => boolean };

const REL: Record<string, Record<string, Relation>> = {
  oKR: {
    keyResults: { model: "keyResult", many: true, on: (p, c) => c.okrId === p.id },
    periods: { model: "goalPeriod", many: true, on: (p, c) => c.okrId === p.id },
    children: { model: "oKR", many: true, on: (p, c) => c.parentId === p.id },
    assignees: { model: "goalAssignee", many: true, on: (p, c) => c.okrId === p.id },
    parent: { model: "oKR", many: false, on: (p, c) => c.id === p.parentId },
  },
  keyResult: {
    kpi: { model: "kPI", many: false, on: (p, c) => c.id === p.kpiId },
    checkIns: { model: "kRCheckIn", many: true, on: (p, c) => c.keyResultId === p.id },
    okr: { model: "oKR", many: false, on: (p, c) => c.id === p.okrId },
    periods: { model: "keyResultPeriod", many: true, on: (p, c) => c.keyResultId === p.id },
  },
  goalPeriod: {
    targets: { model: "keyResultPeriod", many: true, on: (p, c) => c.periodId === p.id },
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

const UNIQUE: Record<string, string[][]> = {
  goalPeriod: [["okrId", "key"]],
  keyResultPeriod: [["keyResultId", "periodId"]],
  kPIRecord: [["kpiId", "userId", "period"]],
};

export interface GoalFakeDb {
  rows: Record<string, Row[]>;
  /** The clock defaults (createdAt, updatedAt) read. */
  clock: () => Date;
  /** Raw statements run, in order, as text. */
  raw: string[];
  /** Transactions committed and rolled back, for a test to count. */
  stats: { committed: number; rolledBack: number; lockWaits: number };
  /**
   * Runs right after a transaction takes a lock (its key, e.g.
   * "row:GoalPeriod:<id>"), before the statement returns: a test parks one
   * transaction there to start another against the held lock.
   */
  afterLock: ((key: string) => Promise<void> | void) | null;
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
      return { ...base, carried: false, currentValue: null, progress: null, frozenAt: null, refreshedAt: null, sourceSig: null, sourceListCount: null, pausedSince: null, pausedReason: null, unit: null };
    case "kRCheckIn":
      return { ...base, note: null, periodId: null };
    case "kPIRecord":
      return { ...base, status: "SUBMITTED" };
    case "organization":
      return { ...base, settings: {} };
    default:
      return base;
  }
}

let idSeq = 0;
const newId = (model: string) => `${model}-${++idSeq}`;

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

export function createGoalFakeDb(): GoalFakeDb {
  const db: GoalFakeDb = {
    rows: {},
    clock: () => new Date(),
    raw: [],
    stats: { committed: 0, rolledBack: 0, lockWaits: 0 },
    afterLock: null,
    prisma: {},
    reset() {
      for (const k of Object.keys(db.rows)) delete db.rows[k];
      db.raw.length = 0;
      db.stats.committed = 0;
      db.stats.rolledBack = 0;
      db.stats.lockWaits = 0;
      db.afterLock = null;
      db.clock = () => new Date();
    },
  };
  const table = (name: string) => (db.rows[name] ??= []);

  // ── Relation-aware where ──
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
      plain[k] = cond;
    }
    return matches(row, plain);
  };

  // ── Nested select / include ──
  const shape = (model: string, row: Row, args: { select?: Select; include?: Select }): Row => {
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
        let kids = table(rel.model).filter((c) => rel.on(row, c) && relMatches(rel.model, c, a.where));
        kids = sortRows(kids, a.orderBy);
        if (typeof a.take === "number") kids = kids.slice(0, a.take);
        const shaped = kids.map((c) => shape(rel.model, c, { select: a.select, include: a.include }));
        out[k] = rel.many ? shaped : (shaped[0] ?? null);
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
  const releaseAll = (owner: number, keys: Set<string>) => {
    for (const key of keys) {
      const h = held.get(key);
      if (!h || h.owner !== owner) continue;
      held.delete(key);
      for (const w of h.waiters) w();
    }
  };

  type Ctx = { id: number; locks: Set<string>; undo: Array<() => void> } | null;

  const uniqueClash = (model: string, data: Row): boolean =>
    (UNIQUE[model] ?? []).some((cols) => cols.every((c) => data[c] != null) && table(model).some((r) => cols.every((c) => cmpValues(r[c], data[c]) === 0)));

  const insert = (model: string, data: Row, ctx: Ctx): Row => {
    const now = db.clock();
    const row: Row = { ...defaultsOf(model, now), ...data };
    if (row.id === undefined) row.id = newId(model);
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
      await tick();
      const r = table(name).find((row) => relMatches(name, row, a.where));
      return r ? shape(name, r, a) : null;
    },
    findUniqueOrThrow: async (a: { where: Where; select?: Select; include?: Select }) => {
      await tick();
      const r = table(name).find((row) => relMatches(name, row, a.where));
      if (!r) throw new Error(`${name}.findUniqueOrThrow: no row`);
      return shape(name, r, a);
    },
    findFirst: async (a: { where?: Where; select?: Select; include?: Select; orderBy?: OrderBy } = {}) => {
      await tick();
      const r = sortRows(table(name).filter((row) => relMatches(name, row, a.where)), a.orderBy)[0];
      return r ? shape(name, r, a) : null;
    },
    findMany: async (a: { where?: Where; select?: Select; include?: Select; orderBy?: OrderBy; take?: number; skip?: number; distinct?: string[] } = {}) => {
      await tick();
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
      return list.map((r) => shape(name, r, a));
    },
    count: async (a: { where?: Where } = {}) => {
      await tick();
      return table(name).filter((row) => relMatches(name, row, a.where)).length;
    },
    groupBy: async (a: { by: string[]; where?: Where; _max?: Record<string, boolean>; _min?: Record<string, boolean>; _count?: unknown }) => {
      await tick();
      const groups = new Map<string, Row[]>();
      for (const r of table(name).filter((row) => relMatches(name, row, a.where))) {
        const key = a.by.map((b) => String(r[b])).join("|");
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      return [...groups.values()].map((rows) => {
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
        if (a._count) out._count = rows.length;
        return out;
      });
    },
    create: async (a: { data: Row; select?: Select; include?: Select }) => {
      await tick();
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
      await tick();
      let count = 0;
      for (const d of a.data) {
        if (uniqueClash(name, d)) {
          if (a.skipDuplicates) continue;
          throw Object.assign(new Error(`Unique constraint failed on ${name}`), { code: "P2002" });
        }
        insert(name, d, ctx);
        count += 1;
      }
      return { count };
    },
    update: async (a: { where: Where; data: Row; select?: Select; include?: Select }) => {
      await tick();
      const row = table(name).find((r) => relMatches(name, r, a.where));
      if (!row) throw Object.assign(new Error(`${name}.update: no row`), { code: "P2025" });
      applyData(row, a.data, ctx);
      return shape(name, row, a);
    },
    updateMany: async (a: { where?: Where; data: Row }) => {
      await tick();
      const hit = table(name).filter((r) => relMatches(name, r, a.where));
      for (const r of hit) applyData(r, a.data, ctx);
      return { count: hit.length };
    },
    delete: async (a: { where: Where }) => {
      await tick();
      const row = table(name).find((r) => relMatches(name, r, a.where));
      if (!row) throw Object.assign(new Error(`${name}.delete: no row`), { code: "P2025" });
      const copy = { ...row };
      removeRow(name, row, ctx);
      return copy;
    },
    deleteMany: async (a: { where?: Where } = {}) => {
      await tick();
      const hit = table(name).filter((r) => relMatches(name, r, a.where));
      for (const r of hit) removeRow(name, r, ctx);
      return { count: hit.length };
    },
    upsert: async (a: { where: Where; create: Row; update: Row }) => {
      await tick();
      const row = table(name).find((r) => relMatches(name, r, a.where));
      if (row) {
        applyData(row, a.update, ctx);
        return { ...row };
      }
      return { ...insert(name, a.create, ctx) };
    },
  });

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
            try {
              const out = await fn(client(inner));
              db.stats.committed += 1;
              return out;
            } catch (err) {
              for (const u of inner.undo.reverse()) u();
              db.stats.rolledBack += 1;
              throw err;
            } finally {
              releaseAll(inner.id, inner.locks);
            }
          };
        }
        if (key === "$executeRaw" || key === "$queryRaw") {
          return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            await tick();
            const text = strings.join("?").replace(/\s+/g, " ").trim();
            db.raw.push(text + (values.length ? ` [${values.map(String).join(", ")}]` : ""));
            if (/pg_advisory_xact_lock/.test(text)) {
              if (!ctx) throw new Error("pg_advisory_xact_lock outside a transaction is released at once; the code must not do it");
              const k = `advisory:${String(values[0])}`;
              await acquire(k, ctx.id);
              ctx.locks.add(k);
              if (db.afterLock) await db.afterLock(k);
              return key === "$queryRaw" ? [] : 1;
            }
            const forUpdate = /FROM "GoalPeriod" WHERE "id" = \? FOR UPDATE/.exec(text);
            if (forUpdate) {
              if (!ctx) throw new Error("FOR UPDATE outside a transaction locks nothing");
              const id = String(values[0]);
              const k = `row:GoalPeriod:${id}`;
              await acquire(k, ctx.id);
              ctx.locks.add(k);
              if (db.afterLock) await db.afterLock(k);
              const row = table("goalPeriod").find((r) => r.id === id);
              return row ? [{ ...row }] : [];
            }
            throw new Error(`goal-test-db: no stand-in for raw SQL: ${text}`);
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
