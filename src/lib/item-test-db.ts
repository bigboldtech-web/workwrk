// An in-memory stand-in for the Item and Board reads the cross-List task
// surfaces make (My work, Home, Everything, the task pickers, the calendar,
// the Space tabs), for the vitest suites. Never imported by the app.
//
// `where` supports AND, OR, NOT (one clause or a list), equality and null,
// in / notIn, lt / lte / gt / gte, not, has / hasSome / isEmpty, contains
// (any case), a Json field's { path, equals }, and a to-one relation filter
// on `board`. `orderBy` takes one key or a list, a relation key (board.name)
// and { sort, nulls }, with Postgres's default of NULLS LAST ascending and
// NULLS FIRST descending. `cursor` + `skip` page as Prisma does. Rows come
// back whole with their `board` attached, whatever the select asks: the
// tests read what the code under test does with them, not the projection.
// An operator this store does not know throws, so a new clause cannot pass
// a test by being ignored.

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function cmp(a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (typeof x === "string" && typeof y === "string") return x < y ? -1 : x > y ? 1 : 0;
  return null;
}

const same = (a: unknown, b: unknown) => (a instanceof Date || b instanceof Date ? cmp(a, b) === 0 : a === b);

export interface ItemTestDb {
  items: Row[];
  boards: Row[];
  /** Every read this store answered, in order, for assertions on the queries. */
  calls: Array<{ op: string; args: Row }>;
  /** Runs after each groupBy, so a test can move a status between the two steps of a read. */
  afterGroupBy?: () => void;
  prisma: Record<string, Record<string, (args?: Row) => Promise<unknown>>>;
}

export function matchesWhere(row: Row, where: Where | undefined, db: Pick<ItemTestDb, "boards">): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (cond === undefined) continue;
    if (key === "AND") {
      const list = Array.isArray(cond) ? cond : [cond];
      if (!list.every((c) => matchesWhere(row, c as Where, db))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(cond as Where[]).some((c) => matchesWhere(row, c, db))) return false;
      continue;
    }
    if (key === "NOT") {
      const list = Array.isArray(cond) ? cond : [cond];
      if (list.some((c) => matchesWhere(row, c as Where, db))) return false;
      continue;
    }
    if (key === "board") {
      const board = db.boards.find((b) => b.id === row.boardId);
      if (!board || !matchesWhere(board, cond as Where, db)) return false;
      continue;
    }
    const v = row[key];
    if (cond === null) {
      if (v !== null && v !== undefined) return false;
      continue;
    }
    if (cond instanceof Date || typeof cond !== "object" || Array.isArray(cond)) {
      if (!same(v, cond)) return false;
      continue;
    }
    const c = cond as Record<string, unknown>;
    if (Array.isArray(c.path)) {
      let at: unknown = v;
      for (const step of c.path as string[]) at = at && typeof at === "object" ? (at as Row)[step] : undefined;
      if (!same(at, c.equals)) return false;
      continue;
    }
    for (const [op, x] of Object.entries(c)) {
      const d = cmp(v, x);
      if (op === "gt") { if (!(d !== null && d > 0)) return false; }
      else if (op === "gte") { if (!(d !== null && d >= 0)) return false; }
      else if (op === "lt") { if (!(d !== null && d < 0)) return false; }
      else if (op === "lte") { if (!(d !== null && d <= 0)) return false; }
      else if (op === "in") { if (!(x as unknown[]).some((y) => same(v, y))) return false; }
      // SQL: NULL NOT IN (...) is NULL, which drops the row.
      else if (op === "notIn") { if (v === null || v === undefined || (x as unknown[]).some((y) => same(v, y))) return false; }
      else if (op === "not") { if (x === null ? v === null || v === undefined : same(v, x)) return false; }
      else if (op === "equals") { if (!same(v, x)) return false; }
      else if (op === "has") { if (!(Array.isArray(v) && v.includes(x))) return false; }
      else if (op === "hasSome") { if (!(Array.isArray(v) && (x as unknown[]).some((y) => v.includes(y)))) return false; }
      else if (op === "isEmpty") { if ((Array.isArray(v) && v.length === 0) !== x) return false; }
      else if (op === "contains") { if (!(typeof v === "string" && v.toLowerCase().includes(String(x).toLowerCase()))) return false; }
      else if (op === "mode") continue;
      else throw new Error(`item-test-db does not know the operator ${op} on ${key}`);
    }
  }
  return true;
}

type OrderKey = Record<string, unknown>;

function sortRows(rows: Row[], orderBy: OrderKey | OrderKey[] | undefined, db: Pick<ItemTestDb, "boards">): Row[] {
  const keys = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
  const value = (row: Row, key: string, spec: unknown): { v: unknown; dir: "asc" | "desc"; nulls: "first" | "last" } => {
    if (key === "board" && spec && typeof spec === "object") {
      const [inner, innerSpec] = Object.entries(spec as Row)[0];
      const board = db.boards.find((b) => b.id === row.boardId) ?? {};
      return value(board, inner, innerSpec);
    }
    const s = spec as "asc" | "desc" | { sort: "asc" | "desc"; nulls?: "first" | "last" };
    const dir = typeof s === "string" ? s : s.sort;
    const nulls = typeof s === "string" ? (dir === "asc" ? "last" : "first") : s.nulls ?? (dir === "asc" ? "last" : "first");
    return { v: row[key], dir, nulls };
  };
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const [key, spec] = Object.entries(k)[0];
      const x = value(a, key, spec);
      const y = value(b, key, spec);
      const xn = x.v === null || x.v === undefined;
      const yn = y.v === null || y.v === undefined;
      if (xn && yn) continue;
      if (xn || yn) return (xn ? -1 : 1) * (x.nulls === "first" ? 1 : -1);
      const d = cmp(x.v, y.v) ?? 0;
      if (d !== 0) return x.dir === "asc" ? d : -d;
    }
    return 0;
  });
}

// vi.mock factories run before a test file's own top level, so the mock
// cannot close over a store the file makes. It hands out this one instead,
// which answers through whichever store the test last installed.
let current: ItemTestDb | null = null;

/** Install a store as what the mocked prisma answers through. */
export function installItemTestDb(db: ItemTestDb): ItemTestDb {
  current = db;
  return db;
}

/** For vi.mock("@/lib/prisma", ...): the installed store's models, plus any a test adds. */
export const itemTestPrisma: Record<string, Record<string, (args?: Row) => Promise<unknown>>> = new Proxy({}, {
  get(_target, model: string) {
    if (!current) throw new Error("item-test-db: call installItemTestDb(db) before the code under test reads prisma");
    return current.prisma[model];
  },
});

export function itemTestDb(seed: { items?: Row[]; boards?: Row[] } = {}): ItemTestDb {
  const db: ItemTestDb = { items: seed.items ?? [], boards: seed.boards ?? [], calls: [], prisma: {} };
  const withBoard = (row: Row): Row => ({ ...row, board: db.boards.find((b) => b.id === row.boardId) ?? null });
  const filter = (table: Row[], where: unknown) => table.filter((r) => matchesWhere(r, where as Where, db));

  const findMany = (table: () => Row[], join: boolean) => async (args: Row = {}) => {
    db.calls.push({ op: "findMany", args });
    let rows = sortRows(filter(table(), args.where), args.orderBy as OrderKey[] | undefined, db);
    const cursor = args.cursor as { id: string } | undefined;
    if (cursor) {
      const at = rows.findIndex((r) => r.id === cursor.id);
      rows = at === -1 ? [] : rows.slice(at);
    }
    if (typeof args.skip === "number") rows = rows.slice(args.skip);
    if (Array.isArray(args.distinct)) {
      const seen = new Set<string>();
      rows = rows.filter((r) => {
        const k = (args.distinct as string[]).map((f) => String(r[f])).join("\u0000");
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    if (typeof args.take === "number") rows = rows.slice(0, args.take);
    return join ? rows.map(withBoard) : rows.map((r) => ({ ...r }));
  };

  db.prisma = {
    item: {
      findMany: findMany(() => db.items, true),
      count: async (args: Row = {}) => {
        db.calls.push({ op: "count", args });
        return filter(db.items, args.where).length;
      },
      groupBy: async (args: Row = {}) => {
        db.calls.push({ op: "groupBy", args });
        const by = args.by as string[];
        const out = new Map<string, Row & { _count: { _all: number } }>();
        for (const r of filter(db.items, args.where)) {
          const key = by.map((f) => String(r[f] ?? "\u0001null")).join("\u0000");
          const hit = out.get(key);
          if (hit) hit._count._all += 1;
          else out.set(key, { ...Object.fromEntries(by.map((f) => [f, r[f] ?? null])), _count: { _all: 1 } });
        }
        db.afterGroupBy?.();
        return [...out.values()];
      },
    },
    board: {
      findMany: findMany(() => db.boards, false),
    },
  };
  return db;
}
