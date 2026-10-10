// An account erasure's words, blanked after its short transaction commits
// (src/lib/agents/erasure-sweep.ts; review round 5 of Phase 3). Before, the
// erasure blanked the person's whole teammate history inside its one 20
// second transaction, so a person with years of hourly routines timed it out
// every time and could never erase their account. Now the words go in
// batches after the commit, and a cron step finishes whatever is left.
// Review round 6 of Phase 3: the sweep started each erasure again from its
// first row every tick, gave the oldest the whole budget, dropped unfinished
// ones after 30 days, and picked people by a consent record anyone could
// write. Each erasure now keeps its progress on its own AccountErasure row.
// The database is an in-memory double that reads the where clauses the module
// writes, and answers its raw statements on "AccountErasure" as Postgres
// would, so what is blanked is what the rows hold.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  /** Every statement, in order: the model, the operation, and for a write the ids or where it named. */
  log: [] as Array<{ model: string; op: string; ids?: string[]; take?: number; count?: number; where?: unknown; returned?: string[] }>,
  /** A fake clock that moves on by `tick` ms each statement, when set (Date.now is spied to it). */
  clock: null as number | null,
  tick: 0,
  /** The database's own clock (now()), for lastTriedAt and createdAt: it only moves on. */
  dbNow: 0,
  /** A model whose writes throw, for one person. */
  throwFor: null as { model: string; userId: string } | null,
}));

/** Deep equality for the JSON values a where compares. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const isDbNull = (v: unknown) => v === Prisma.DbNull;

/** A where as the module writes them: equality, null, not (a value, null, DbNull, {}), gt, gte, in, OR, AND. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Row[]).some((c) => matches(row, c));
    if (key === "AND") return (cond as Row[]).every((c) => matches(row, c));
    const v = row[key] ?? null;
    if (cond === null) return v === null;
    if (typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; gt?: unknown; gte?: unknown; in?: unknown[] };
      if (Array.isArray(c.in)) return c.in.includes(v);
      if ("not" in c) {
        // SQL: a NULL column matches no comparison but IS NOT NULL.
        if (c.not === null || isDbNull(c.not)) return v !== null;
        return v !== null && !same(v, c.not);
      }
      const cmp = (x: unknown, y: unknown) => (x instanceof Date && y instanceof Date ? x.getTime() - y.getTime() : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0);
      if ("gt" in c) return v !== null && cmp(v, c.gt) > 0;
      if ("gte" in c) return v !== null && cmp(v, c.gte) >= 0;
      throw new Error(`erasure-sweep.test: unknown condition on ${key}: ${JSON.stringify(cond)}`);
    }
    return v === cond;
  });
}

function sortBy(rows: Row[], orderBy: unknown): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, "asc" | "desc">>;
  return [...rows].sort((x, y) => {
    for (const k of keys) {
      const [field, dir] = Object.entries(k)[0];
      const a = x[field];
      const b = y[field];
      const d = a instanceof Date && b instanceof Date ? a.getTime() - b.getTime() : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
      if (d !== 0) return dir === "desc" ? -d : d;
    }
    return 0;
  });
}

vi.mock("@/lib/prisma", () => {
  const step = () => {
    if (st.clock !== null) st.clock += st.tick;
  };
  const table = (name: string) => (st.tables[name] ??= []);
  const dbNow = () => new Date((st.dbNow += 1));
  const ts = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
  const time = (v: unknown) => (v instanceof Date ? v.getTime() : Number.NEGATIVE_INFINITY);
  const deleted = (userId: unknown) => table("user").some((u) => u.id === userId && u.deletedAt != null);
  const erasureOut = (r: Row) => ({
    userId: r.userId,
    erasedAt: r.erasedAt,
    part: r.part,
    cursor: r.cursor === null ? null : JSON.parse(JSON.stringify(r.cursor)),
    passStartedAt: r.passStartedAt,
    tries: r.tries,
  });
  /** The module's raw statements on "AccountErasure", each answered as Postgres would. */
  const raw = (kind: "query" | "execute") => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    step();
    const sql = strings.join("?").replace(/\s+/g, " ");
    const rows = table("accountErasure");
    const log = (op: string, count?: number) => st.log.push({ model: "accountErasure", op, ...(count !== undefined ? { count } : {}) });
    if (kind === "execute" && sql.includes('INSERT INTO "AccountErasure"') && sql.includes('FROM "ConsentRecord" c')) {
      // The bridge for round 5's erasures.
      const [part, at, method, since, finished] = values as [string, string, string, string, string];
      const records = table("consentRecord");
      const byUser = new Map<string, Row>();
      for (const c of records) {
        const u = table("user").find((x) => x.id === c.userId);
        if (c.method !== method || !u || (c.createdAt as Date).getTime() < new Date(since).getTime()) continue;
        if (u.deletedAt == null || u.email !== `deleted-${u.id}@workwrk.anon`) continue;
        if (rows.some((r) => r.userId === c.userId) || records.some((f) => f.userId === c.userId && f.method === finished)) continue;
        const had = byUser.get(c.userId as string);
        if (!had || (had.createdAt as Date).getTime() < (c.createdAt as Date).getTime()) byUser.set(c.userId as string, c);
      }
      for (const c of byUser.values()) {
        rows.push({ userId: c.userId, erasedAt: c.createdAt, part, cursor: null, passStartedAt: ts(at), lastTriedAt: null, tries: 0, finishedAt: null, createdAt: dbNow() });
      }
      log("bridge", byUser.size);
      return byUser.size;
    }
    if (kind === "execute" && sql.includes('INSERT INTO "AccountErasure"') && sql.includes('ON CONFLICT ("userId") DO UPDATE')) {
      // recordErasure, in the erasure's own transaction.
      const [userId, when, part, started] = values as [string, string, string, string];
      const had = rows.find((r) => r.userId === userId);
      if (had) Object.assign(had, { erasedAt: ts(when), part, cursor: null, passStartedAt: ts(started), lastTriedAt: null, finishedAt: null, tries: (had.tries as number) + 1 });
      else rows.push({ userId, erasedAt: ts(when), part, cursor: null, passStartedAt: ts(started), lastTriedAt: null, tries: 0, finishedAt: null, createdAt: dbNow() });
      log("record");
      return 1;
    }
    if (kind === "execute" && /^\s*UPDATE "AccountErasure"/.test(sql)) {
      // A slice's save: only while the row is as the slice read it.
      const [part, cursor, passStartedAt, finishedAt, userId, tries] = values as [string, string | null, string | null, string | null, string, number];
      const r = rows.find((x) => x.userId === userId && x.tries === tries && x.finishedAt === null);
      if (r) Object.assign(r, { part, cursor: cursor === null ? null : JSON.parse(cursor), passStartedAt: ts(passStartedAt), finishedAt: ts(finishedAt), lastTriedAt: dbNow(), tries: tries + 1 });
      log("save", r ? 1 : 0);
      return r ? 1 : 0;
    }
    if (kind === "query" && sql.includes("count(*)")) {
      const [before] = values as [string];
      const n = rows.filter((r) => r.finishedAt === null && (r.erasedAt as Date).getTime() < new Date(before).getTime()).length;
      log("overdue", n);
      return [{ n }];
    }
    if (kind === "query" && sql.includes('FROM "AccountErasure" e') && sql.includes("LIMIT")) {
      // The sweep's read, in the partial index's order.
      const [settledBefore, limit] = values as [string, number];
      const hit = rows
        .filter((r) => r.finishedAt === null && deleted(r.userId) && (r.passStartedAt !== null || (r.erasedAt as Date).getTime() <= new Date(settledBefore).getTime()))
        .sort((a, b) => {
          const la = a.lastTriedAt === null ? Number.NEGATIVE_INFINITY : time(a.lastTriedAt);
          const lb = b.lastTriedAt === null ? Number.NEGATIVE_INFINITY : time(b.lastTriedAt);
          return la - lb || time(a.erasedAt) - time(b.erasedAt) || String(a.userId).localeCompare(String(b.userId));
        })
        .slice(0, limit);
      log("read", hit.length);
      return hit.map(erasureOut);
    }
    if (kind === "query" && sql.includes('FROM "AccountErasure" e') && sql.includes('WHERE e."userId" = ?')) {
      const [userId] = values as [string];
      const hit = rows.filter((r) => r.userId === userId && r.finishedAt === null && deleted(r.userId));
      log("readOne", hit.length);
      return hit.map(erasureOut);
    }
    throw new Error(`erasure-sweep.test: unknown raw statement ${sql}`);
  };
  const model = (name: string) => ({
    findMany: async (a: { where?: Row; orderBy?: unknown; take?: number; select?: Record<string, boolean> }) => {
      step();
      const hit = sortBy(table(name).filter((r) => matches(r, a.where)), a.orderBy).slice(0, a.take ?? Infinity);
      st.log.push({ model: name, op: "findMany", take: a.take, where: a.where, returned: hit.map((r) => String(r.id)) });
      return hit.map((r) => (a.select ? Object.fromEntries(Object.keys(a.select).map((k) => [k, r[k] ?? null])) : { ...r }));
    },
    updateMany: async (a: { where: Row; data: Row }) => {
      step();
      const hit = table(name).filter((r) => matches(r, a.where));
      const owner = hit.find((r) => st.throwFor && st.throwFor.model === name && [r.userId, r.actingForId, r.triggeredBy, r.actorId, r.scopeId, r.ownerId].includes(st.throwFor.userId));
      if (owner) throw new Error("canceling statement due to statement timeout");
      for (const r of hit) for (const [k, v] of Object.entries(a.data)) r[k] = isDbNull(v) ? null : v;
      const ids = (a.where.id as { in?: string[] } | undefined)?.in;
      st.log.push({ model: name, op: "updateMany", count: hit.length, where: a.where, ...(ids ? { ids: [...ids] } : {}) });
      return { count: hit.length };
    },
    deleteMany: async (a: { where: Row }) => {
      step();
      const before = table(name).length;
      st.tables[name] = table(name).filter((r) => !matches(r, a.where));
      st.log.push({ model: name, op: "deleteMany", count: before - st.tables[name].length });
      return { count: before - st.tables[name].length };
    },
    create: async (a: { data: Row }) => {
      step();
      const row = { id: `${name}${table(name).length + 1}`, createdAt: new Date(st.clock ?? Date.now()), ...a.data };
      table(name).push(row);
      st.log.push({ model: name, op: "create" });
      return row;
    },
  });
  const models = new Map<string, unknown>();
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === "$queryRaw") return raw("query");
          if (key === "$executeRaw") return raw("execute");
          if (!models.has(key)) models.set(key, model(key));
          return models.get(key);
        },
      },
    ),
  };
});

import { prisma } from "@/lib/prisma";
import {
  ERASURE_BATCH,
  ERASURE_OVERDUE_MS,
  ERASURE_SETTLED_MS,
  ROUND5_ERASURES_SINCE,
  blankTeammateHistory,
  continueErasure,
  finishErasures,
  recordErasure,
} from "./erasure-sweep";

const NOW = new Date("2026-10-10T12:00:00Z");
const FAR = () => Date.now() + 60_000;
const t = (min: number) => new Date(NOW.getTime() + min * 60_000);
const HOUR = 60;

/** One person's teammate history, every kind of row holding words, and one row of each already blank; their account erased. */
function seedPerson(u: string) {
  const T = st.tables;
  (T.user ??= []).push({ id: u, deletedAt: t(-3 * HOUR), email: `deleted-${u}@workwrk.anon` });
  (T.chatSession ??= []).push({ id: `${u}-s1`, userId: u, title: "Ops" }, { id: `${u}-s2`, userId: u, title: null });
  (T.chatMessage ??= []).push(
    { id: `${u}-m1`, sessionId: `${u}-s1`, content: "Your inbox has 3 invoices from lea@x.test", toolCalls: [{ name: "search_email", result: { count: 3 } }], meta: { readGoogle: true }, createdAt: t(1) },
    { id: `${u}-m2`, sessionId: `${u}-s1`, content: "Erased", toolCalls: null, meta: null, createdAt: t(2) },
    { id: `${u}-m3`, sessionId: `${u}-s2`, content: "Erased", toolCalls: null, meta: { event: "memory_updated" }, createdAt: t(3) },
  );
  (T.agentAction ??= []).push(
    { id: `${u}-a1`, actingForId: u, input: { to: ["lea@x.test"], body: "Pay it" }, editedInput: { body: "Pay it today" }, preview: { title: "Send" }, result: { ok: true }, error: null, createdAt: t(1) },
    { id: `${u}-a2`, actingForId: u, input: {}, editedInput: null, preview: {}, result: null, error: "You connected a different Google account (a@x.test, b@x.test).", createdAt: t(2) },
    { id: `${u}-a3`, actingForId: u, input: {}, editedInput: null, preview: {}, result: null, error: null, createdAt: t(3) },
  );
  (T.agentRun ??= []).push(
    { id: `${u}-r1`, triggeredBy: u, actingForId: u, questionId: `${u}-q1`, input: { trigger: "CHAT" }, output: { text: "Pay the invoices" }, error: null },
    // Ask AI's tool run: its input and error, and its output.
    { id: `${u}-r2`, triggeredBy: u, actingForId: null, questionId: null, input: { toolName: "create_task", input: { title: "Pay Lea" } }, output: { ok: true }, error: "Could not find Lea" },
    // A teammate run's own sentence stays, and so does its input (the trigger).
    { id: `${u}-r3`, triggeredBy: u, actingForId: u, questionId: null, input: { trigger: "ROUTINE" }, output: null, error: "This run stopped because the account it worked for was deleted." },
  );
  (T.aIQuery ??= []).push(
    { id: `${u}-q1`, userId: u, query: "AI teammate message", response: null },
    { id: `${u}-q2`, userId: u, query: "What did Lea send me?", response: "Three invoices." },
  );
  (T.activityLog ??= []).push({ id: `${u}-l1`, actorId: u, ipAddress: "203.0.113.9", userAgent: "Firefox" }, { id: `${u}-l2`, actorId: u, ipAddress: null, userAgent: null });
  (T.agentMemory ??= []).push({ id: `${u}-mem1`, scope: "person", scopeId: u, key: "report day", value: "Friday" }, { id: `${u}-mem2`, scope: "agent", scopeId: "a1", key: "team", value: "Ops" });
  (T.agentRoutine ??= []).push({ id: `${u}-rt1`, actingForId: u, name: "Daily brief", prompt: "Read my inbox", status: "active", pausedReason: null, nextRunAt: t(60) });
}

/** One chat of `n` messages all holding words, all at one moment (the id breaks the tie). */
function seedLongChat(u: string, n: number) {
  (st.tables.user ??= []).push({ id: u, deletedAt: t(-3 * HOUR), email: `deleted-${u}@workwrk.anon` });
  (st.tables.chatSession ??= []).push({ id: `${u}-s1`, userId: u, title: null });
  (st.tables.chatMessage ??= []).push(
    ...Array.from({ length: n }, (_, i) => ({ id: `${u}-m${String(i).padStart(5, "0")}`, sessionId: `${u}-s1`, content: `words ${i}`, toolCalls: null, meta: null, createdAt: t(1) })),
  );
}

/** A person's AccountErasure row: by default a pass under way that started after the settle time, so its end finishes it. */
function erasureRow(userId: string, o: { erasedAt?: Date; passStartedAt?: Date | null; lastTriedAt?: Date | null; part?: string; cursor?: unknown; tries?: number; finishedAt?: Date | null } = {}) {
  const erasedAt = o.erasedAt ?? t(-3 * HOUR);
  (st.tables.accountErasure ??= []).push({
    userId,
    erasedAt,
    part: o.part ?? "chats",
    cursor: o.cursor ?? null,
    passStartedAt: o.passStartedAt === undefined ? new Date(erasedAt.getTime() + ERASURE_SETTLED_MS + 60_000) : o.passStartedAt,
    lastTriedAt: o.lastTriedAt ?? null,
    tries: o.tries ?? 0,
    finishedAt: o.finishedAt ?? null,
    createdAt: erasedAt,
  });
}

const ofTable = (name: string, pick: (r: Row) => boolean = () => true) => (st.tables[name] ?? []).filter(pick);
const writesOf = (model: string) => st.log.filter((l) => l.model === model && l.op === "updateMany");
const rowOf = (userId: string) => ofTable("accountErasure", (r) => r.userId === userId)[0];
const sum = (xs: Array<{ count?: number }>) => xs.reduce((n, x) => n + (x.count ?? 0), 0);

function expectBlank(u: string) {
  expect(ofTable("chatMessage", (r) => String(r.sessionId).startsWith(`${u}-`)).map((r) => [r.content, r.toolCalls, r.meta])).toEqual([
    ["Erased", null, null],
    ["Erased", null, null],
    ["Erased", null, null],
  ]);
  expect(ofTable("chatSession", (r) => r.userId === u).map((r) => r.title)).toEqual([null, null]);
  for (const a of ofTable("agentAction", (r) => r.actingForId === u)) expect([a.input, a.editedInput, a.preview, a.result, a.error]).toEqual([{}, null, {}, null, null]);
  expect(ofTable("agentRun", (r) => r.triggeredBy === u).map((r) => [r.input, r.output, r.error])).toEqual([
    [{ trigger: "CHAT" }, null, null],
    [{}, null, null],
    [{ trigger: "ROUTINE" }, null, "This run stopped because the account it worked for was deleted."],
  ]);
  expect(ofTable("aIQuery", (r) => r.userId === u).map((r) => [r.query, r.response])).toEqual([
    ["Erased", null],
    ["Erased", null],
  ]);
  expect(ofTable("activityLog", (r) => r.actorId === u).map((r) => [r.ipAddress, r.userAgent])).toEqual([
    [null, null],
    [null, null],
  ]);
  expect(ofTable("agentMemory", (r) => r.scopeId === u)).toEqual([]);
  expect(ofTable("agentRoutine", (r) => r.actingForId === u)[0]).toMatchObject({ name: "Erased", prompt: "Erased", status: "paused", pausedReason: "person_gone", nextRunAt: null });
}

const firstWords = (u: string) => ofTable("chatMessage", (r) => r.id === `${u}-m1`)[0].content;
const WORDS = "Your inbox has 3 invoices from lea@x.test";

/** The fake clock: each statement takes `tick` ms. */
function fakeClock(tick: number) {
  st.clock = NOW.getTime();
  st.tick = tick;
  vi.spyOn(Date, "now").mockImplementation(() => st.clock as number);
}

beforeEach(() => {
  st.tables = {};
  st.log = [];
  st.clock = null;
  st.tick = 0;
  st.dbNow = NOW.getTime();
  st.throwFor = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("blankTeammateHistory", () => {
  it("blanks every row of the person's still holding words, writes no row already blank, and touches nobody else's", async () => {
    seedPerson("u1");
    seedPerson("u2");
    const pass = await blankTeammateHistory("u1", FAR());
    expect(pass.done).toBe(true);
    expectBlank("u1");
    // Only the rows holding words were written (m2, a3 were blank already; m3 had only meta).
    expect(sum(writesOf("chatMessage"))).toBe(2);
    expect(sum(writesOf("agentAction"))).toBe(2);
    // The teammate run's question, blanked with its batch by id.
    expect(writesOf("aIQuery")[0].ids).toEqual(["u1-q1"]);
    // Nobody else's row moved: u2's words are all still there.
    expect(firstWords("u2")).toBe(WORDS);
    expect(ofTable("agentRun", (r) => r.id === "u2-r1")[0].output).toEqual({ text: "Pay the invoices" });
    expect(ofTable("aIQuery", (r) => r.id === "u2-q2")[0].query).toBe("What did Lea send me?");
    expect(ofTable("agentMemory", (r) => r.scopeId === "u2")).toHaveLength(1);
    // A teammate's shared memory (scope "agent") is the workspace's and stays.
    expect(ofTable("agentMemory", (r) => r.scope === "agent")).toHaveLength(2);
    // A second pass finds nothing left and changes no row.
    st.log = [];
    expect(await blankTeammateHistory("u1", FAR())).toMatchObject({ done: true, rows: 0 });
    expect(st.log.filter((l) => (l.op === "updateMany" || l.op === "deleteMany") && l.count !== 0)).toEqual([]);
  });

  it("blanks in batches of at most ERASURE_BATCH rows, each read starting after the last, never reading a row twice", async () => {
    const n = ERASURE_BATCH * 2 + 201;
    seedLongChat("u1", n);
    expect(await blankTeammateHistory("u1", FAR())).toMatchObject({ done: true });
    const writes = writesOf("chatMessage").map((w) => w.ids as string[]);
    // Before: one statement over every row.
    expect(writes.map((w) => w.length)).toEqual([ERASURE_BATCH, ERASURE_BATCH, 201]);
    expect(new Set(writes.flat()).size).toBe(n);
    expect(ofTable("chatMessage").every((m) => m.content === "Erased")).toBe(true);
    const reads = st.log.filter((l) => l.model === "chatMessage" && l.op === "findMany");
    expect(reads.every((l) => l.take === ERASURE_BATCH)).toBe(true);
    // Each read starts after the last row of the one before (its index range), so no pass reads the blanked rows again.
    expect(JSON.stringify(reads[0].where)).not.toContain('"gte"');
    expect(JSON.stringify(reads[1].where)).toContain(`"id":{"gt":"${writes[0][ERASURE_BATCH - 1]}"}`);
    expect(JSON.stringify(reads[2].where)).toContain(`"id":{"gt":"${writes[1][ERASURE_BATCH - 1]}"}`);
  });

  // Review round 6 of Phase 3: a read asked only for rows still holding
  // words, so after a long stretch already blank (a second pass over a long
  // history) one statement walked every blank row before it found the next.
  it("reads the next rows in order whether or not they hold words, and writes only those that do", async () => {
    seedLongChat("u1", ERASURE_BATCH * 2 + 201);
    // The first thousand already blank, as a pass before left them.
    for (const m of ofTable("chatMessage").slice(0, ERASURE_BATCH * 2)) m.content = "Erased";
    expect(await blankTeammateHistory("u1", FAR())).toMatchObject({ done: true, rows: 201 });
    const reads = st.log.filter((l) => l.model === "chatMessage" && l.op === "findMany");
    // Before: one read, filtered on the words, passing over the thousand blank rows.
    expect(reads.map((r) => r.returned?.length)).toEqual([ERASURE_BATCH, ERASURE_BATCH, 201]);
    for (const r of reads) expect(JSON.stringify(r.where)).not.toContain('"content"');
    // The writes carry the words filter: the blank rows are not written again.
    expect(writesOf("chatMessage").map((w) => w.count)).toEqual([0, 0, 201]);
    for (const w of writesOf("chatMessage")) expect(JSON.stringify(w.where)).toContain('"content":{"not":"Erased"}');
  });

  it("stops between batches once its deadline passes, says where, and a pass from there finishes the rest", async () => {
    seedLongChat("u1", ERASURE_BATCH * 3);
    st.tables.chatSession[0].title = "Ops";
    // Each statement takes 10 ms: room for the chats' read, their titles and one batch.
    fakeClock(10);
    const first = await blankTeammateHistory("u1", NOW.getTime() + 25);
    expect(first).toEqual({ done: false, rows: ERASURE_BATCH + 1, part: "chats", cursor: { chat: "u1-s1", at: t(1).toISOString(), id: `u1-m${String(ERASURE_BATCH - 1).padStart(5, "0")}` } });
    expect(ofTable("chatMessage", (m) => m.content === "Erased")).toHaveLength(ERASURE_BATCH);
    expect(ofTable("chatSession")[0].title).toBeNull();
    st.log = [];
    const second = await blankTeammateHistory("u1", (st.clock as number) + 1_000_000, { part: first.part, cursor: first.cursor });
    expect(second.done).toBe(true);
    expect(ofTable("chatMessage").every((m) => m.content === "Erased")).toBe(true);
    // From the place it was given, not from the first row.
    const reads = st.log.filter((l) => l.model === "chatMessage" && l.op === "findMany");
    expect(JSON.stringify(reads[0].where)).toContain(`"id":{"gt":"u1-m${String(ERASURE_BATCH - 1).padStart(5, "0")}"}`);
    // A deadline already gone: nothing is read at all.
    st.log = [];
    expect(await blankTeammateHistory("u1", (st.clock as number) - 1)).toEqual({ done: false, rows: 0, part: "chats", cursor: null });
    expect(st.log).toEqual([]);
  });
});

describe("recordErasure", () => {
  it("writes a new erasure's row at its first part, its pass starting at the erasure's moment, and starts an existing one over", async () => {
    await recordErasure(prisma as never, "u1", t(0));
    expect(rowOf("u1")).toMatchObject({ erasedAt: t(0), part: "chats", cursor: null, passStartedAt: t(0), lastTriedAt: null, tries: 0, finishedAt: null });
    // Finished, or part way, and then asked again: it starts over, its tries moved on.
    Object.assign(rowOf("u1"), { part: "runs", cursor: { id: "r9" }, passStartedAt: t(200), lastTriedAt: t(201), tries: 7, finishedAt: t(202) });
    await recordErasure(prisma as never, "u1", t(300));
    expect(rowOf("u1")).toMatchObject({ erasedAt: t(300), part: "chats", cursor: null, passStartedAt: t(300), lastTriedAt: null, tries: 8, finishedAt: null });
    expect(ofTable("accountErasure")).toHaveLength(1);
  });
});

describe("continueErasure", () => {
  // Review round 6 of Phase 3: the erasure's own pass kept no place, so the
  // sweep began every erasure again from its first row.
  it("runs from the start, saves where it stopped, and never finishes the erasure it began with", async () => {
    seedLongChat("u1", ERASURE_BATCH * 3);
    await recordErasure(prisma as never, "u1", t(0));
    fakeClock(10);
    const first = await continueErasure("u1", NOW.getTime() + 35, t(0));
    expect(first).toMatchObject({ found: true, end: "more" });
    // Before: nothing saved.
    expect(rowOf("u1")).toMatchObject({ part: "chats", cursor: { chat: "u1-s1", id: `u1-m${String(ERASURE_BATCH - 1).padStart(5, "0")}` }, passStartedAt: t(0), tries: 1, finishedAt: null });
    expect(rowOf("u1").lastTriedAt).toBeInstanceOf(Date);
    // To the end: the pass began at the erasure's moment, so it waits for one more whole pass after the settle time.
    const rest = await continueErasure("u1", (st.clock as number) + 1_000_000, t(5));
    expect(rest).toMatchObject({ found: true, end: "settling" });
    expect(ofTable("chatMessage").every((m) => m.content === "Erased")).toBe(true);
    expect(rowOf("u1")).toMatchObject({ part: "chats", cursor: null, passStartedAt: null, tries: 2, finishedAt: null });
  });

  // Review round 6 of Phase 3: only a real erasure is acted on.
  it("acts only on a deleted account with an erasure row", async () => {
    seedPerson("u1");
    // No row: nothing is read.
    expect(await continueErasure("u1", FAR(), NOW)).toEqual({ found: false, end: null, rows: 0 });
    // A row, but the account is not deleted: nothing is read.
    erasureRow("u1");
    st.tables.user[0].deletedAt = null;
    expect(await continueErasure("u1", FAR(), NOW)).toEqual({ found: false, end: null, rows: 0 });
    expect(st.log.filter((l) => l.model !== "accountErasure")).toEqual([]);
    expect(firstWords("u1")).toBe(WORDS);
  });
});

describe("finishErasures", () => {
  it("blanks each erased person's words and finishes the erasure when a pass that started after the settle time ends, writing no consent record", async () => {
    for (const u of ["a", "b"]) seedPerson(u);
    erasureRow("a");
    erasureRow("b", { lastTriedAt: t(-10) });
    const counts = await finishErasures(NOW, { limit: 50, budgetMs: 60_000 });
    expect(counts).toEqual({ found: 2, blanked: expect.any(Number), finished: 2, waiting: 0, failed: 0, overdue: 0, bridged: 0 });
    expect(counts.blanked).toBeGreaterThan(0);
    expectBlank("a");
    expectBlank("b");
    expect(rowOf("a").finishedAt).toEqual(NOW);
    // Before: a ConsentRecord "erasure_finished" marked it; the row's finishedAt does now.
    expect(ofTable("consentRecord")).toEqual([]);
    // Finished: never read again.
    st.log = [];
    expect(await finishErasures(NOW, { limit: 50, budgetMs: 60_000 })).toMatchObject({ found: 0, finished: 0 });
    expect(st.log.filter((l) => l.model !== "accountErasure")).toEqual([]);
  });

  // Review round 6 of Phase 3: every tick began each erasure again from its first row.
  it("goes on from the place it saved, never from the first row, and reads no message twice in a pass", async () => {
    const n = ERASURE_BATCH * 3 + 10;
    seedLongChat("h", n);
    erasureRow("h");
    fakeClock(10);
    // Room for about one batch a tick.
    const first = await finishErasures(NOW, { limit: 50, budgetMs: 60 });
    expect(first).toMatchObject({ found: 1, finished: 0, waiting: 1 });
    expect(rowOf("h")).toMatchObject({ part: "chats", cursor: { chat: "h-s1", id: `h-m${String(ERASURE_BATCH - 1).padStart(5, "0")}` }, tries: 1 });
    st.log = [];
    await finishErasures(NOW, { limit: 50, budgetMs: 60 });
    const reads = () => st.log.filter((l) => l.model === "chatMessage" && l.op === "findMany");
    // Before: the tick's first read had no place in it.
    expect(JSON.stringify(reads()[0].where)).toContain(`"id":{"gt":"h-m${String(ERASURE_BATCH - 1).padStart(5, "0")}"}`);
    expect(rowOf("h").cursor).toMatchObject({ id: `h-m${String(ERASURE_BATCH * 2 - 1).padStart(5, "0")}` });
    // To the end, tick after tick: every message read once.
    const seen: string[] = [...reads().flatMap((r) => r.returned ?? [])];
    for (let i = 0; i < 20 && !rowOf("h").finishedAt; i += 1) {
      st.log = [];
      await finishErasures(NOW, { limit: 50, budgetMs: 60 });
      seen.push(...reads().flatMap((r) => r.returned ?? []));
    }
    expect(rowOf("h").finishedAt).toEqual(NOW);
    expect(ofTable("chatMessage").every((m) => m.content === "Erased")).toBe(true);
    expect(seen.length + ERASURE_BATCH).toBe(n);
    expect(new Set(seen).size).toBe(seen.length);
  });

  // Review round 6 of Phase 3: the oldest unfinished erasure took the whole budget.
  it("gives every erasure a fair slice, so a heavy one never holds up the one after it", async () => {
    seedLongChat("heavy", ERASURE_BATCH * 50);
    seedPerson("light");
    // The heavy one is read first (never tried), the light one after it.
    erasureRow("heavy");
    erasureRow("light", { lastTriedAt: t(-10) });
    fakeClock(10);
    const counts = await finishErasures(NOW, { limit: 50, budgetMs: 1_000 });
    // Before: the heavy one ran until the budget was spent, and the light one waited.
    expect(counts).toMatchObject({ found: 2, finished: 1, waiting: 1, failed: 0 });
    expectBlank("light");
    expect(rowOf("light").finishedAt).toEqual(NOW);
    // The heavy one went on as far as its share took it, and saved its place.
    expect(rowOf("heavy")).toMatchObject({ part: "chats", finishedAt: null });
    expect(ofTable("chatMessage", (m) => String(m.sessionId) === "heavy-s1" && m.content === "Erased").length).toBeGreaterThan(ERASURE_BATCH * 10);
    expect(ofTable("chatMessage", (m) => String(m.sessionId) === "heavy-s1" && m.content !== "Erased").length).toBeGreaterThan(0);
    // The next tick reads the light one no more, and the heavy one goes on.
    st.log = [];
    expect(await finishErasures(NOW, { limit: 50, budgetMs: 1_000 })).toMatchObject({ found: 1 });
  });

  // Review round 6 of Phase 3: a clean pass after the settle time finished an
  // erasure even when it had started before it, so a write that landed behind
  // its place was never read.
  it("finishes nothing before a whole pass that started after the settle time, and runs that pass once the time has passed", async () => {
    seedPerson("u1");
    const erasedAt = t(-HOUR);
    // The erasure's own pass, under way from the erasure's moment.
    erasureRow("u1", { erasedAt, passStartedAt: erasedAt });
    const early = await finishErasures(NOW, { limit: 50, budgetMs: 60_000 });
    expect(early).toMatchObject({ found: 1, finished: 0, waiting: 1 });
    expectBlank("u1");
    // Back to the first part, waiting for the settle time.
    expect(rowOf("u1")).toMatchObject({ part: "chats", cursor: null, passStartedAt: null, finishedAt: null });
    // A write in flight at the erasure lands now.
    st.tables.chatMessage.push({ id: "u1-late", sessionId: "u1-s1", content: "Here is the summary of Lea's email", toolCalls: null, meta: null, createdAt: t(-HOUR + 1) });
    // Before the settle time the row is not read.
    expect(await finishErasures(t(30), { limit: 50, budgetMs: 60_000 })).toMatchObject({ found: 0 });
    // Once it has passed, the last pass runs, blanks the late write, and finishes.
    const settled = new Date(erasedAt.getTime() + ERASURE_SETTLED_MS + 60_000);
    expect(await finishErasures(settled, { limit: 50, budgetMs: 60_000 })).toMatchObject({ found: 1, finished: 1 });
    expect(ofTable("chatMessage", (r) => r.id === "u1-late")[0].content).toBe("Erased");
    expect(rowOf("u1")).toMatchObject({ passStartedAt: settled, finishedAt: settled });
  });

  it("runs the last pass in the same slice when a pass that started before the settle time ends after it", async () => {
    seedPerson("u1");
    const erasedAt = t(-3 * HOUR);
    erasureRow("u1", { erasedAt, passStartedAt: erasedAt, part: "runs" });
    const counts = await finishErasures(NOW, { limit: 50, budgetMs: 60_000 });
    expect(counts).toMatchObject({ found: 1, finished: 1 });
    // Two passes: the rest of the old one from "runs", then a whole one from the chats. Before: the old one alone finished it.
    expect(st.log.filter((l) => l.model === "chatSession" && l.op === "findMany")).toHaveLength(1);
    expect(st.log.filter((l) => l.model === "agentRun" && l.op === "findMany")).toHaveLength(2);
    expectBlank("u1");
    expect(rowOf("u1")).toMatchObject({ passStartedAt: NOW, finishedAt: NOW });
  });

  // Review round 6 of Phase 3: an erasure older than 30 days was never read again.
  it("drops no erasure for its age: one asked 60 days ago and still unfinished is swept and finished", async () => {
    seedPerson("old");
    erasureRow("old", { erasedAt: t(-60 * 24 * HOUR) });
    const counts = await finishErasures(NOW, { limit: 50, budgetMs: 60_000 });
    // Before: past the 30 day window, never read.
    expect(counts).toMatchObject({ found: 1, finished: 1, overdue: 0 });
    expectBlank("old");
  });

  // Review round 6 of Phase 3: an erasure that could not finish did so in silence.
  it("counts an erasure unfinished three days after it was asked as overdue, logs it, and keeps sweeping it", async () => {
    seedLongChat("slow", ERASURE_BATCH * 4);
    erasureRow("slow", { erasedAt: new Date(NOW.getTime() - ERASURE_OVERDUE_MS - 60_000) });
    // Two days old and unfinished, and a finished one past three days: neither is overdue.
    seedLongChat("young", ERASURE_BATCH * 4);
    erasureRow("young", { erasedAt: t(-48 * HOUR), lastTriedAt: t(-1) });
    erasureRow("done", { erasedAt: t(-10 * 24 * HOUR), finishedAt: t(-9 * 24 * HOUR) });
    fakeClock(10);
    const counts = await finishErasures(NOW, { limit: 50, budgetMs: 60 });
    // Before: no such count, and the tick passed.
    expect(counts).toMatchObject({ overdue: 1, finished: 0 });
    expect((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))).toContain(
      "[cron-failure] run-due-agents: 1 account erasure(s) not finished 3 days after they were asked",
    );
    // Still swept, from its place.
    expect(rowOf("slow").tries).toBeGreaterThan(0);
    expect(await finishErasures(NOW, { limit: 50, budgetMs: 60 })).toMatchObject({ found: 2, overdue: 1 });
  });

  // Review round 6 of Phase 3: the sweep picked people by a consent record
  // alone, which POST /api/consent stored for any method a request named.
  it("acts only on a deleted account with an erasure row: a consent record alone, or a row whose account lives, is never read", async () => {
    seedPerson("forged");
    st.tables.user.find((u) => u.id === "forged")!.deletedAt = null;
    (st.tables.consentRecord ??= []).push({ id: "c-forged", userId: "forged", method: "erasure", createdAt: t(-5 * HOUR), policyVersion: "2026-10-06" });
    seedPerson("restored");
    erasureRow("restored");
    st.tables.user.find((u) => u.id === "restored")!.deletedAt = null;
    const counts = await finishErasures(NOW, { limit: 50, budgetMs: 60_000 });
    expect(counts).toMatchObject({ found: 0, bridged: 0 });
    expect(firstWords("forged")).toBe(WORDS);
    expect(firstWords("restored")).toBe(WORDS);
    expect(rowOf("forged")).toBeUndefined();
  });

  // Review round 6 of Phase 3: erasures made on round 5's code have a consent record and no row.
  it("gives round 5's erasures their rows, only for anonymised accounts with no row and no finished record, and sweeps them the same tick", async () => {
    for (const u of ["r5", "twice", "finished5", "early", "removed", "has"]) seedPerson(u);
    const at = (iso: string) => new Date(iso);
    (st.tables.consentRecord ??= []).push(
      // Erased on round 5's code, its words maybe left.
      { id: "c1", userId: "r5", method: "erasure", createdAt: at("2026-10-10T06:00:00Z"), policyVersion: "2026-10-06" },
      // Asked twice: one row, from the later.
      { id: "c2", userId: "twice", method: "erasure", createdAt: at("2026-10-10T05:00:00Z"), policyVersion: "2026-10-06" },
      { id: "c3", userId: "twice", method: "erasure", createdAt: at("2026-10-10T07:00:00Z"), policyVersion: "2026-10-06" },
      // Round 5 finished it.
      { id: "c4", userId: "finished5", method: "erasure", createdAt: at("2026-10-10T06:00:00Z"), policyVersion: "2026-10-06" },
      { id: "c5", userId: "finished5", method: "erasure_finished", createdAt: at("2026-10-10T09:00:00Z"), policyVersion: "2026-10-06" },
      // Before round 5's code.
      { id: "c6", userId: "early", method: "erasure", createdAt: new Date(ROUND5_ERASURES_SINCE.getTime() - 60_000), policyVersion: "2026-10-06" },
      // Removed by an admin (deleted, never anonymised), with a forged record.
      { id: "c7", userId: "removed", method: "erasure", createdAt: at("2026-10-10T06:00:00Z"), policyVersion: "2026-10-06" },
      // Already has its row.
      { id: "c8", userId: "has", method: "erasure", createdAt: at("2026-10-10T06:00:00Z"), policyVersion: "2026-10-06" },
      // Not an erasure.
      { id: "c9", userId: "r5", method: "banner", createdAt: at("2026-10-10T08:00:00Z"), policyVersion: "2026-10-06" },
    );
    st.tables.user.find((u) => u.id === "removed")!.email = "lea@x.test";
    erasureRow("has", { finishedAt: t(-60) });
    const counts = await finishErasures(NOW, { limit: 50, budgetMs: 60_000 });
    // Before: no rows; round 5's sweep read the consent records.
    expect(counts).toMatchObject({ bridged: 2, found: 2, finished: 2 });
    expect(ofTable("accountErasure").map((r) => r.userId).sort()).toEqual(["has", "r5", "twice"]);
    expect(rowOf("r5")).toMatchObject({ erasedAt: at("2026-10-10T06:00:00Z"), passStartedAt: NOW, finishedAt: NOW });
    expect(rowOf("twice").erasedAt).toEqual(at("2026-10-10T07:00:00Z"));
    expectBlank("r5");
    expectBlank("twice");
    for (const u of ["finished5", "early", "removed", "has"]) expect(firstWords(u)).toBe(WORDS);
    // Once only.
    expect(await finishErasures(NOW, { limit: 50, budgetMs: 60_000 })).toMatchObject({ bridged: 0, found: 0 });
  });

  it("stops at its budget, leaving the rest for the next tick, and at its limit, least recently tried first", async () => {
    for (const u of ["a", "b", "c"]) seedPerson(u);
    erasureRow("a", { lastTriedAt: t(-3) });
    erasureRow("b", { lastTriedAt: null });
    erasureRow("c", { lastTriedAt: t(-1) });
    // No budget at all: every erasure found waits, nothing is read or written for it.
    const none = await finishErasures(NOW, { limit: 50, budgetMs: 0 });
    expect(none).toEqual({ found: 3, blanked: 0, finished: 0, waiting: 3, failed: 0, overdue: 0, bridged: 0 });
    expect(st.log.filter((l) => l.model !== "accountErasure")).toEqual([]);
    expect(st.log.filter((l) => l.op === "save")).toEqual([]);
    // A limit of two: never tried first, then the least recently tried; the third on the next tick.
    const two = await finishErasures(NOW, { limit: 2, budgetMs: 60_000 });
    expect(two).toMatchObject({ found: 2, finished: 2 });
    expectBlank("b");
    expectBlank("a");
    expect(firstWords("c")).toBe(WORDS);
    expect(await finishErasures(NOW, { limit: 2, budgetMs: 60_000 })).toMatchObject({ found: 1, finished: 1 });
    expectBlank("c");
  });

  it("counts a slice that throws as failed, logs it, keeps its place and its try, and still finishes the others", async () => {
    for (const u of ["a", "b"]) seedPerson(u);
    erasureRow("a");
    erasureRow("b", { lastTriedAt: t(-1) });
    st.throwFor = { model: "agentAction", userId: "a" };
    const counts = await finishErasures(NOW, { limit: 50, budgetMs: 60_000 });
    expect(counts).toMatchObject({ found: 2, finished: 1, failed: 1, waiting: 0 });
    expectBlank("b");
    // The chats were done before the requests threw: the place is kept, and the try counted.
    expect(rowOf("a")).toMatchObject({ part: "requests", cursor: null, tries: 1, finishedAt: null });
    expect(firstWords("a")).toBe("Erased");
    expect(String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain("[cron-failure] run-due-agents");
    // Tried last on the next tick, after one never tried.
    seedPerson("c");
    erasureRow("c");
    st.throwFor = null;
    st.log = [];
    await finishErasures(NOW, { limit: 1, budgetMs: 60_000 });
    expect(rowOf("c").finishedAt).toEqual(NOW);
    expect(rowOf("a").finishedAt).toBeNull();
  });
});
