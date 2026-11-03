// An in-memory stand-in for the parts of Prisma that sign-in, the session
// check, the switcher and the invitations read and write, for the vitest
// suites of docs/plans/workspace-status.md step 2 (never imported by the
// app). Each model is an array of rows. Unlike oauth-test-db.ts, a relation
// (a User's or a membership's organization, a membership's user, an
// invitation's organization) is resolved from its table by its key on every
// read, so a move between workspaces is seen by the next read, and a filter
// on a relation (usableSeatWhere's workspace status, alreadyInOrg's address)
// really filters. A `where` shape this file does not know throws, so a test
// never passes on a condition the fake ignored.
//
// `where`: equality, null, not (a value or null), in, notIn, equals and
// contains (each with mode "insensitive"), gt/gte/lt/lte, OR, AND, compound
// keys (userId_organizationId), relation filters. A comparison with a NULL
// column is false, as in SQL (`not` and `notIn` included). `select` (nested
// for relations) and `include`. `orderBy` one key or a list, each "asc",
// "desc" or { sort, nulls }, nulls last for asc and first for desc, as
// Postgres. `skip` and `take`. `data` with { increment }. createMany, and a
// groupBy by one column with `_max` (step 3's Members list). A User's list
// relations (KPI records, reviews, kudos, certifications, skills, dotted
// lines, direct reports, KRA assignments) and `_count` of them, each with its
// own `where` (the step 3 review fixes: a read scoped to a workspace is
// really scoped). The User's department, job role and office foreign keys
// are held on every write (P2003), as Postgres holds them. The unique keys Postgres holds are held here
// too (an account's email and workspace, spelled exactly as the index
// compares them; a membership's person and workspace; an invitation's
// token): a write that breaks one throws P2002.
//
// THE TRANSACTION IS ITS OWN CLIENT. $transaction hands its callback a
// different object from `prisma` over the same store (with no $transaction
// of its own, as Prisma's), rolled back on a throw. Every call is logged in
// `log`, reads too, as "<model>.<op>" from `prisma` and "tx.<model>.<op>"
// from a transaction, so a test can prove an order (the person's lock before
// the first read) and that a read inside a transaction went through it, not
// around it. Raw statements: the person's row lock logs "lock:<id>"
// ("tx.lock:<id>" in a transaction), set_config and pg_advisory locks are
// logged; any other $executeRaw throws (not modelled), and so does every
// $queryRaw unless the test answers it (`onQueryRaw`, given the statement as
// Postgres receives it, nested fragments inline, with its values).
//
// Step 4 (the counts): a list relation's `some`, `none` and `every` (a User's
// memberships, a workspace's people and memberships), `NOT`, deleteMany, a
// groupBy by several columns with `_count`, and a kudos' receiver.
//
// The final review (integrity M2): `onCall`, when set, runs after each call
// is logged and before it acts, given its log entry ("tx.lock:<id>",
// "tx.user.findUnique"), so a test can land another transaction's commit at
// a chosen moment (a move committed while this one waited for the person's
// lock, or just after it read them). It may be async for a raw statement;
// for a read or a write it runs synchronously.
//
// The fixes review (L2): `delete` of one row by its unique key, P2025 when
// there is none, as Prisma answers.

import { Prisma } from "@/generated/prisma";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** Relation name to [table, key on this row]. */
const RELATIONS: Record<string, Record<string, [string, string]>> = {
  user: { organization: ["organization", "organizationId"], role: ["role", "roleId"], department: ["department", "departmentId"], office: ["office", "officeId"], manager: ["user", "managerId"] },
  organizationMembership: { organization: ["organization", "organizationId"], user: ["user", "userId"] },
  invitation: { organization: ["organization", "organizationId"] },
  apiKey: { organization: ["organization", "organizationId"] },
  kRAAssignment: { kra: ["kRA", "kraId"] },
  kPIRecord: { kpi: ["kPI", "kpiId"], user: ["user", "userId"] },
  review: { cycle: ["reviewCycle", "cycleId"] },
  userDottedLine: { manager: ["user", "managerId"], user: ["user", "userId"] },
  kudos: { giver: ["user", "giverId"], receiver: ["user", "receiverId"] },
  kudosReaction: { kudos: ["kudos", "kudosId"] },
  conversationMember: { user: ["user", "userId"] },
  userSkill: { user: ["user", "userId"] },
  idea: { submitter: ["user", "submitterId"], reviewer: ["user", "reviewerId"] },
};

/** A model's list relations (one to many): name to [table, the key on the other table that names this row]. */
const LISTS: Record<string, Record<string, [string, string]>> = {
  user: {
    kpiRecords: ["kPIRecord", "userId"],
    reviewsAsSubject: ["review", "subjectId"],
    kudosReceived: ["kudos", "receiverId"],
    certifications: ["certification", "userId"],
    skills: ["userSkill", "userId"],
    dottedLineToManagers: ["userDottedLine", "userId"],
    directReports: ["user", "managerId"],
    kraAssignments: ["kRAAssignment", "userId"],
    organizationMemberships: ["organizationMembership", "userId"],
  },
  organization: {
    users: ["user", "organizationId"],
    memberships: ["organizationMembership", "organizationId"],
  },
  kudos: { reactions: ["kudosReaction", "kudosId"] },
  idea: { votes: ["ideaVote", "ideaId"], comments: ["ideaComment", "ideaId"] },
};

/** The filters a list relation takes in a `where`. */
const LIST_FILTERS = new Set(["some", "none", "every"]);

/**
 * The foreign keys Postgres holds that a write must keep: column to the
 * table its id must exist in. A write that names a missing row throws P2003,
 * as Postgres does (User.departmentId, roleId and officeId; a membership's
 * copies have no key, D18). Seeds are not checked.
 */
const FOREIGN: Record<string, Record<string, string>> = {
  user: { departmentId: "department", roleId: "role", officeId: "office" },
};

/** Each model's unique keys (Postgres' unique indexes), as column lists. */
const UNIQUE: Record<string, string[][]> = {
  user: [["email", "organizationId"]],
  organizationMembership: [["userId", "organizationId"]],
  invitation: [["token"]],
};

const DEFAULTS: Record<string, () => Row> = {
  user: () => ({ deletedAt: null, status: "ACTIVE", tokenVersion: 0, mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [], passwordChangedAt: null, adminScopes: [], avatar: null, orgRole: null, createdAt: new Date() }),
  organization: () => ({ status: "ACTIVE", settings: {}, logo: null, slug: null }),
  organizationMembership: () => ({ role: "EMPLOYEE", isPrimary: false, adminScopes: [], status: "ACTIVE", removedAt: null, endedWithAccount: false, createdAt: new Date() }),
  invitation: () => ({ accepted: false, spaceId: null, spaceRole: null, createdAt: new Date() }),
};

const OPS = new Set(["not", "in", "notIn", "equals", "contains", "mode", "gt", "gte", "lt", "lte"]);

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  return a === b;
}

function cmp(a: unknown, b: unknown): number | null {
  if (a == null || b == null) return null;
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (typeof x === "string" && typeof y === "string") return x < y ? -1 : x > y ? 1 : 0;
  if (typeof x === "boolean" && typeof y === "boolean") return Number(x) - Number(y);
  return null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

export interface SeatDb {
  tables: Record<string, Row[]>;
  /** Every raw statement, in order; the person's row lock is "lock:<id>". */
  raw: string[];
  /** Every write, in order, as "<model>.<op>", whichever client made it. */
  writes: string[];
  /** Every call, reads and raw statements too, in order; "tx." in front of a transaction's. */
  log: string[];
  /** Model names whose reads and writes throw (a missing table, a blip). */
  failing: Set<string>;
  /** The error a failing model throws (a pool timeout, P2024, unless a test says otherwise). */
  failWith: { code: string; message: string };
  /** Answers a $queryRaw (the statement rendered, `?` for each value); unset, every $queryRaw throws. */
  onQueryRaw: ((sql: string, values: unknown[]) => unknown) | null;
  /** Runs after each call is logged, before it acts (see the header). */
  onCall: ((entry: string) => void | Promise<void>) | null;
  prisma: Record<string, unknown>;
  reset(): void;
  seed(model: string, row: Row): Row;
  row(model: string, id: string): Row;
}

export function createSeatDb(): SeatDb {
  const db = { tables: {}, raw: [], writes: [], log: [], failing: new Set<string>(), failWith: { code: "P2024", message: "pool timeout" }, onQueryRaw: null, onCall: null, prisma: {} } as unknown as SeatDb;
  const table = (name: string) => (db.tables[name] ??= []);
  const related = (model: string, row: Row, key: string): Row | null => {
    const rel = RELATIONS[model]?.[key];
    if (!rel) return null;
    return table(rel[0]).find((r) => r.id === row[rel[1]]) ?? null;
  };

  function matches(model: string, row: Row, where: Where | undefined): boolean {
    for (const [k, cond] of Object.entries(where ?? {})) {
      if (cond === undefined) continue;
      if (k === "OR") {
        if (!(cond as Where[]).some((c) => matches(model, row, c))) return false;
        continue;
      }
      if (k === "AND") {
        if (!(cond as Where[]).every((c) => matches(model, row, c))) return false;
        continue;
      }
      if (k === "NOT") {
        if ((Array.isArray(cond) ? (cond as Where[]) : [cond as Where]).some((c) => matches(model, row, c))) return false;
        continue;
      }
      const list = LISTS[model]?.[k];
      if (list) {
        if (!isPlainObject(cond) || !Object.keys(cond).every((op) => LIST_FILTERS.has(op))) throw new Error(`seat-test-db: ${model}.${k} takes some, none or every`);
        const [rel, fk] = list;
        const rows = table(rel).filter((r) => r[fk] === row.id);
        const c = cond as { some?: Where; none?: Where; every?: Where };
        if (c.some !== undefined && !rows.some((r) => matches(rel, r, c.some))) return false;
        if (c.none !== undefined && rows.some((r) => matches(rel, r, c.none))) return false;
        if (c.every !== undefined && !rows.every((r) => matches(rel, r, c.every))) return false;
        continue;
      }
      if (k.includes("_") && isPlainObject(cond)) {
        if (!matches(model, row, cond)) return false;
        continue;
      }
      const rel = RELATIONS[model]?.[k];
      if (rel) {
        const r = related(model, row, k);
        if (!r || !matches(rel[0], r, cond as Where)) return false;
        continue;
      }
      const v = row[k];
      if (cond === null) {
        if (v != null) return false;
        continue;
      }
      if (!isPlainObject(cond)) {
        if (Array.isArray(cond)) throw new Error(`seat-test-db: an array as ${model}.${k} is not modelled`);
        if (!same(v, cond)) return false;
        continue;
      }
      for (const [op, x] of Object.entries(cond)) {
        if (!OPS.has(op)) throw new Error(`seat-test-db: unknown condition ${model}.${k}.${op}`);
        if (op === "mode") {
          if (x !== "insensitive" && x !== "default") throw new Error(`seat-test-db: unknown mode ${String(x)}`);
          continue;
        }
        if (op === "not") {
          if (isPlainObject(x) || Array.isArray(x)) throw new Error(`seat-test-db: a "not" with an operator (${model}.${k}) is not modelled`);
          // SQL: NOT (v = x) is not true for a NULL v.
          if (x === null ? v == null : v == null || same(v, x)) return false;
          continue;
        }
        if (op === "in" || op === "notIn") {
          if (!Array.isArray(x)) throw new Error(`seat-test-db: ${op} needs a list (${model}.${k})`);
          if (v == null) return false;
          const hit = x.some((y) => same(v, y));
          if (op === "in" ? !hit : hit) return false;
          continue;
        }
        if (op === "equals") {
          const ci = (cond as Record<string, unknown>).mode === "insensitive";
          if (!(ci && typeof v === "string" && typeof x === "string" ? v.toLowerCase() === x.toLowerCase() : same(v, x))) return false;
          continue;
        }
        if (op === "contains") {
          if (typeof x !== "string") throw new Error(`seat-test-db: contains needs a string (${model}.${k})`);
          const ci = (cond as Record<string, unknown>).mode === "insensitive";
          if (typeof v !== "string" || !(ci ? v.toLowerCase().includes(x.toLowerCase()) : v.includes(x))) return false;
          continue;
        }
        const order = cmp(v, x);
        if (op === "gt" && !(order !== null && order > 0)) return false;
        if (op === "gte" && !(order !== null && order >= 0)) return false;
        if (op === "lt" && !(order !== null && order < 0)) return false;
        if (op === "lte" && !(order !== null && order <= 0)) return false;
      }
    }
    return true;
  }

  function project(model: string, row: Row, a: { select?: Record<string, unknown>; include?: Record<string, unknown> }): Row {
    const relOf = (k: string, on: unknown): Row | null => {
      const r = related(model, row, k);
      if (!r) return null;
      const rel = RELATIONS[model][k][0];
      return on && typeof on === "object" ? project(rel, r, on as { select?: Record<string, unknown> }) : { ...r };
    };
    // A list relation: the rows of its table that name this row, filtered by
    // its `where`, ordered and cut as asked, each projected by its select.
    type ListArgs = { where?: Where; orderBy?: OrderBy; take?: number; select?: Record<string, unknown>; include?: Record<string, unknown> };
    const listOf = (k: string, on: unknown): Row[] => {
      const [rel, fk] = LISTS[model][k];
      const args = (on && typeof on === "object" ? on : {}) as ListArgs;
      let list = ordered(table(rel).filter((r) => r[fk] === row.id && matches(rel, r, args.where)), args.orderBy);
      if (typeof args.take === "number") list = list.slice(0, args.take);
      return list.map((r) => (args.select || args.include ? project(rel, r, args) : structuredClone(r)));
    };
    // `_count: { select: { list: true | { where } } }`.
    const countOf = (on: unknown): Row => {
      const sel = ((on as { select?: Record<string, unknown> } | undefined)?.select ?? {}) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(sel).filter(([, v]) => v).map(([k, v]) => {
          const pair = LISTS[model]?.[k];
          if (!pair) throw new Error(`seat-test-db: _count of ${model}.${k} is not modelled`);
          const w = typeof v === "object" ? (v as { where?: Where }).where : undefined;
          return [k, table(pair[0]).filter((r) => r[pair[1]] === row.id && matches(pair[0], r, w)).length];
        }),
      );
    };
    if (a.select) {
      const out: Row = {};
      for (const [k, on] of Object.entries(a.select)) {
        if (!on) continue;
        if (k === "_count") out[k] = countOf(on);
        else if (LISTS[model]?.[k]) out[k] = listOf(k, on);
        else out[k] = RELATIONS[model]?.[k] ? relOf(k, on) : Array.isArray(row[k]) ? [...(row[k] as unknown[])] : row[k];
      }
      return out;
    }
    const out: Row = structuredClone(row);
    for (const [k, on] of Object.entries(a.include ?? {})) {
      if (!on) continue;
      if (LISTS[model]?.[k]) out[k] = listOf(k, on);
      else if (RELATIONS[model]?.[k]) out[k] = relOf(k, on);
    }
    return out;
  }

  type OrderBy = Record<string, unknown> | Array<Record<string, unknown>>;
  function ordered(list: Row[], orderBy: OrderBy | undefined): Row[] {
    if (!orderBy) return list;
    const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
    return [...list].sort((x, y) => {
      for (const [k, d] of keys) {
        const spec = typeof d === "string" ? { sort: d } : (d as { sort: string; nulls?: string });
        const xv = x[k];
        const yv = y[k];
        if (xv == null || yv == null) {
          if (xv == null && yv == null) continue;
          // Postgres: NULLS LAST for ascending, NULLS FIRST for descending, unless said.
          const nullFirst = spec.nulls ? spec.nulls === "first" : spec.sort === "desc";
          return (xv == null) === nullFirst ? -1 : 1;
        }
        const c = cmp(xv, yv) ?? 0;
        if (c !== 0) return spec.sort === "desc" ? -c : c;
      }
      return 0;
    });
  }

  function apply(row: Row, data: Row): void {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (isPlainObject(v) && "increment" in v) row[k] = ((row[k] as number) ?? 0) + (v as { increment: number }).increment;
      else row[k] = Array.isArray(v) ? [...v] : v;
    }
  }

  /** Throws P2003 when `row` names a row a foreign key needs and its table does not hold. */
  function holdForeign(name: string, row: Row): void {
    for (const [col, target] of Object.entries(FOREIGN[name] ?? {})) {
      const v = row[col];
      if (v == null) continue;
      if (!table(target).some((r) => r.id === v)) throw Object.assign(new Error(`seat-test-db: ${name}.${col} names a missing ${target} ${String(v)}`), { code: "P2003" });
    }
  }

  /** Throws P2002 when `row` would share a unique key with another row of the table. */
  function holdUnique(name: string, row: Row): void {
    for (const cols of UNIQUE[name] ?? []) {
      if (cols.some((c) => row[c] == null)) continue;
      const clash = table(name).find((r) => r !== row && cols.every((c) => same(r[c], row[c])));
      if (clash) throw Object.assign(new Error(`seat-test-db: unique ${name}(${cols.join(", ")}) broken`), { code: "P2002" });
    }
  }

  const guard = (name: string) => {
    if (db.failing.has(name)) throw Object.assign(new Error(`seat-test-db: ${name} is failing (${db.failWith.message})`), { code: db.failWith.code });
  };
  let ids = 0;

  const model = (name: string, via: string) => {
    const read = (op: string) => {
      db.log.push(`${via}${name}.${op}`);
      void db.onCall?.(`${via}${name}.${op}`);
      guard(name);
    };
    const wrote = (op: string) => {
      db.log.push(`${via}${name}.${op}`);
      void db.onCall?.(`${via}${name}.${op}`);
      guard(name);
      db.writes.push(`${name}.${op}`);
    };
    return {
      findUnique: async (a: { where: Where; select?: Record<string, unknown>; include?: Record<string, unknown> }) => {
        read("findUnique");
        const r = table(name).find((row) => matches(name, row, a.where));
        return r ? project(name, r, a) : null;
      },
      findFirst: async (a: { where?: Where; select?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: OrderBy } = {}) => {
        read("findFirst");
        const r = ordered(table(name).filter((row) => matches(name, row, a.where)), a.orderBy)[0];
        return r ? project(name, r, a) : null;
      },
      findMany: async (a: { where?: Where; select?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: OrderBy; take?: number; skip?: number } = {}) => {
        read("findMany");
        let list = ordered(table(name).filter((row) => matches(name, row, a.where)), a.orderBy);
        if (typeof a.skip === "number") list = list.slice(a.skip);
        if (typeof a.take === "number") list = list.slice(0, a.take);
        return list.map((r) => project(name, r, a));
      },
      groupBy: async (a: { by: string[]; where?: Where; _max?: Record<string, boolean>; _count?: { _all?: boolean } }) => {
        read("groupBy");
        if (a.by.length === 0) throw new Error("seat-test-db: groupBy needs a column");
        const groups = new Map<string, Row[]>();
        for (const row of table(name).filter((r) => matches(name, r, a.where))) {
          const key = JSON.stringify(a.by.map((c) => row[c] ?? null));
          groups.set(key, [...(groups.get(key) ?? []), row]);
        }
        return [...groups.values()].map((rows) => ({
          ...Object.fromEntries(a.by.map((c) => [c, rows[0][c] ?? null])),
          ...(a._max ? { _max: Object.fromEntries(Object.keys(a._max).map((c) => [c, rows.map((r) => r[c]).reduce<unknown>((m, v) => (m == null || (cmp(v, m) ?? 0) > 0 ? v : m), null)])) } : {}),
          ...(a._count ? { _count: { _all: rows.length } } : {}),
        }));
      },
      count: async (a: { where?: Where } = {}) => {
        read("count");
        return table(name).filter((row) => matches(name, row, a.where)).length;
      },
      create: async (a: { data: Row; select?: Record<string, unknown> }) => {
        wrote("create");
        const row: Row = { ...(DEFAULTS[name]?.() ?? {}) };
        apply(row, a.data);
        if (row.id === undefined) row.id = `${name}-${(ids += 1)}`;
        holdUnique(name, row);
        holdForeign(name, row);
        table(name).push(row);
        return project(name, row, a);
      },
      createMany: async (a: { data: Row[] }) => {
        wrote("createMany");
        for (const d of a.data) {
          const row: Row = { ...(DEFAULTS[name]?.() ?? {}) };
          apply(row, d);
          if (row.id === undefined) row.id = `${name}-${(ids += 1)}`;
          holdUnique(name, row);
          table(name).push(row);
        }
        return { count: a.data.length };
      },
      update: async (a: { where: Where; data: Row; select?: Record<string, unknown> }) => {
        wrote("update");
        const row = table(name).find((r) => matches(name, r, a.where));
        if (!row) throw Object.assign(new Error(`seat-test-db: ${name}.update found no row`), { code: "P2025" });
        const next = { ...row };
        apply(next, a.data);
        const before = { ...row };
        Object.assign(row, next);
        try {
          holdUnique(name, row);
          holdForeign(name, row);
        } catch (err) {
          Object.assign(row, before);
          throw err;
        }
        return project(name, row, a);
      },
      updateMany: async (a: { where?: Where; data: Row }) => {
        wrote("updateMany");
        const hit = table(name).filter((r) => matches(name, r, a.where));
        for (const r of hit) {
          apply(r, a.data);
          holdUnique(name, r);
          holdForeign(name, r);
        }
        return { count: hit.length };
      },
      delete: async (a: { where: Where; select?: Record<string, unknown> }) => {
        wrote("delete");
        const t = table(name);
        const row = t.find((r) => matches(name, r, a.where));
        if (!row) throw Object.assign(new Error(`seat-test-db: ${name}.delete found no row`), { code: "P2025" });
        t.splice(t.indexOf(row), 1);
        return project(name, row, a);
      },
      deleteMany: async (a: { where?: Where } = {}) => {
        wrote("deleteMany");
        const t = table(name);
        const gone = t.filter((r) => matches(name, r, a.where));
        for (const r of gone) t.splice(t.indexOf(r), 1);
        return { count: gone.length };
      },
      upsert: async (a: { where: Where; create: Row; update: Row }) => {
        wrote("upsert");
        const row = table(name).find((r) => matches(name, r, a.where));
        if (row) {
          apply(row, a.update);
          holdUnique(name, row);
          holdForeign(name, row);
          return { ...row };
        }
        const fresh: Row = { ...(DEFAULTS[name]?.() ?? {}) };
        apply(fresh, a.create);
        if (fresh.id === undefined) fresh.id = `${name}-${(ids += 1)}`;
        holdUnique(name, fresh);
        holdForeign(name, fresh);
        table(name).push(fresh);
        return { ...fresh };
      },
    };
  };

  const raw = (via: string) => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    let entry: string;
    if (/^SELECT 1 FROM "User" WHERE "id" = \? FOR NO KEY UPDATE$/.test(text)) entry = `lock:${String(values[0])}`;
    else if (/^SELECT (set_config|pg_advisory_xact_lock)\(/.test(text) || /^SET LOCAL /.test(text)) entry = text;
    else throw new Error(`seat-test-db: raw statement not modelled: ${text}`);
    db.raw.push(entry);
    db.log.push(`${via}${entry}`);
    await db.onCall?.(`${via}${entry}`);
    return 1;
  };
  const queryRaw = (via: string) => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = Prisma.sql(strings, ...values);
    const text = q.sql.replace(/\s+/g, " ").trim();
    if (!db.onQueryRaw) throw new Error(`seat-test-db: $queryRaw is not modelled: ${text}`);
    db.log.push(`${via}queryRaw`);
    return db.onQueryRaw(text, q.values);
  };

  const client = (via: string, inTx: boolean): Record<string, unknown> => {
    const models = new Map<string, ReturnType<typeof model>>();
    return new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === "$transaction") {
            // A transaction's client has no $transaction of its own, as Prisma's.
            if (inTx) return undefined;
            return async (fn: (tx: unknown) => Promise<unknown>) => {
              const before = structuredClone(db.tables);
              try {
                return await fn(txClient);
              } catch (err) {
                for (const k of Object.keys(db.tables)) delete db.tables[k];
                Object.assign(db.tables, before);
                throw err;
              }
            };
          }
          if (key === "$executeRaw") return raw(via);
          if (key === "$queryRaw") return queryRaw(via);
          if (typeof key !== "string" || key.startsWith("$") || key === "then") return undefined;
          if (!models.has(key)) models.set(key, model(key, via));
          return models.get(key);
        },
      },
    );
  };
  const txClient = client("tx.", true);
  db.prisma = client("", false);

  db.reset = () => {
    for (const k of Object.keys(db.tables)) delete db.tables[k];
    db.raw.length = 0;
    db.writes.length = 0;
    db.log.length = 0;
    db.failing.clear();
    db.failWith = { code: "P2024", message: "pool timeout" };
    db.onQueryRaw = null;
    db.onCall = null;
    ids = 0;
  };
  db.seed = (name: string, row: Row) => {
    const full: Row = { ...(DEFAULTS[name]?.() ?? {}), ...row };
    holdUnique(name, full);
    table(name).push(full);
    return full;
  };
  db.row = (name: string, id: string) => {
    const r = table(name).find((x) => x.id === id);
    if (!r) throw new Error(`seat-test-db: no ${name} ${id}`);
    return r;
  };
  return db;
}

/** The one store the step 2 suites mock @/lib/prisma with. */
export const seatDb = createSeatDb();
