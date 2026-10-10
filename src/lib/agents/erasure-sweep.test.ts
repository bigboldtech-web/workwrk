// An account erasure's words, blanked after its short transaction commits
// (src/lib/agents/erasure-sweep.ts; review round 5 of Phase 3). Before, the
// erasure blanked the person's whole teammate history inside its one 20
// second transaction, so a person with years of hourly routines timed it out
// every time and could never erase their account. Now the words go in
// batches after the commit, and a cron step finishes whatever is left. The
// database is an in-memory double that reads the where clauses the module
// writes, so what is blanked is what the rows hold.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  /** Every statement, in order: the model, the operation, and for a write the ids or where it named. */
  log: [] as Array<{ model: string; op: string; ids?: string[]; take?: number; count?: number; where?: unknown }>,
  /** A fake clock that moves on by `tick` ms each statement, when set (Date.now is spied to it). */
  clock: null as number | null,
  tick: 0,
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
  const model = (name: string) => ({
    findMany: async (a: { where?: Row; orderBy?: unknown; take?: number; select?: Record<string, boolean> }) => {
      step();
      const hit = sortBy(table(name).filter((r) => matches(r, a.where)), a.orderBy).slice(0, a.take ?? Infinity);
      st.log.push({ model: name, op: "findMany", take: a.take, where: a.where });
      return hit.map((r) => (a.select ? Object.fromEntries(Object.keys(a.select).map((k) => [k, r[k] ?? null])) : { ...r }));
    },
    updateMany: async (a: { where: Row; data: Row }) => {
      step();
      const hit = table(name).filter((r) => matches(r, a.where));
      const owner = hit.find((r) => st.throwFor && st.throwFor.model === name && [r.userId, r.actingForId, r.triggeredBy, r.actorId, r.scopeId, r.ownerId].includes(st.throwFor.userId));
      if (owner) throw new Error("canceling statement due to statement timeout");
      for (const r of hit) for (const [k, v] of Object.entries(a.data)) r[k] = isDbNull(v) ? null : v;
      const ids = (a.where.id as { in?: string[] } | undefined)?.in;
      st.log.push({ model: name, op: "updateMany", count: hit.length, ...(ids ? { ids: [...ids] } : {}) });
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
          // finishErasures' one read: the erasures not yet finished, as Postgres answers it.
          if (key === "$queryRaw") {
            return async (strings: TemplateStringsArray, ...values: unknown[]) => {
              step();
              const sql = strings.join("?").replace(/\s+/g, " ");
              if (!sql.includes('FROM "ConsentRecord" e')) throw new Error(`erasure-sweep.test: unknown query ${sql}`);
              const [method, since, finished, limit] = values as [string, string, string, number];
              const records = table("consentRecord");
              const done = new Set(records.filter((r) => r.method === finished).map((r) => r.userId));
              st.log.push({ model: "consentRecord", op: "erasures" });
              return sortBy(
                records.filter((r) => r.method === method && r.userId !== null && (r.createdAt as Date).getTime() >= new Date(since).getTime() && !done.has(r.userId)),
                [{ createdAt: "asc" }, { id: "asc" }],
              )
                .slice(0, limit)
                .map((r) => ({ userId: r.userId, createdAt: r.createdAt, policyVersion: r.policyVersion }));
            };
          }
          if (!models.has(key)) models.set(key, model(key));
          return models.get(key);
        },
      },
    ),
  };
});

import { ERASURE_BATCH, ERASURE_SETTLED_MS, ERASURE_SWEEP_WINDOW_MS, blankTeammateHistory, finishErasures } from "./erasure-sweep";

const NOW = new Date("2026-10-10T12:00:00Z");
const FAR = () => Date.now() + 60_000;
const t = (min: number) => new Date(NOW.getTime() + min * 60_000);

/** One person's teammate history, every kind of row holding words, and one row of each already blank. */
function seedPerson(u: string) {
  const T = st.tables;
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

const ofTable = (name: string, pick: (r: Row) => boolean = () => true) => (st.tables[name] ?? []).filter(pick);
const writesOf = (model: string) => st.log.filter((l) => l.model === model && l.op === "updateMany");

function expectBlank(u: string) {
  expect(ofTable("chatMessage", (r) => String(r.sessionId).startsWith(u)).map((r) => [r.content, r.toolCalls, r.meta])).toEqual([
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

beforeEach(() => {
  st.tables = {};
  st.log = [];
  st.clock = null;
  st.tick = 0;
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
    expect(writesOf("chatMessage").flatMap((w) => w.ids)).toEqual(["u1-m1", "u1-m3"]);
    expect(writesOf("agentAction").flatMap((w) => w.ids)).toEqual(["u1-a1", "u1-a2"]);
    // The teammate run's question, blanked with its batch by id.
    expect(writesOf("aIQuery")[0].ids).toEqual(["u1-q1"]);
    // Nobody else's row moved: u2's words are all still there.
    expect(ofTable("chatMessage", (r) => r.sessionId === "u2-s1")[0].content).toBe("Your inbox has 3 invoices from lea@x.test");
    expect(ofTable("agentRun", (r) => r.id === "u2-r1")[0].output).toEqual({ text: "Pay the invoices" });
    expect(ofTable("aIQuery", (r) => r.id === "u2-q2")[0].query).toBe("What did Lea send me?");
    expect(ofTable("agentMemory", (r) => r.scopeId === "u2")).toHaveLength(1);
    // A teammate's shared memory (scope "agent") is the workspace's and stays.
    expect(ofTable("agentMemory", (r) => r.scope === "agent")).toHaveLength(2);
    // A second pass finds nothing left and changes no row.
    st.log = [];
    expect(await blankTeammateHistory("u1", FAR())).toEqual({ done: true, rows: 0 });
    expect(st.log.filter((l) => (l.op === "updateMany" || l.op === "deleteMany") && l.count !== 0)).toEqual([]);
  });

  it("blanks in batches of at most ERASURE_BATCH rows, each read starting after the last, never reading a row twice", async () => {
    const n = ERASURE_BATCH * 2 + 201;
    st.tables.chatSession = [{ id: "s1", userId: "u1", title: null }];
    // Every message at one moment: the id breaks the tie.
    st.tables.chatMessage = Array.from({ length: n }, (_, i) => ({ id: `m${String(i).padStart(5, "0")}`, sessionId: "s1", content: `words ${i}`, toolCalls: null, meta: null, createdAt: t(1) }));
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

  it("stops between batches once its deadline passes, and a later pass finishes the rest", async () => {
    st.tables.chatSession = [{ id: "s1", userId: "u1", title: "Ops" }];
    st.tables.chatMessage = Array.from({ length: ERASURE_BATCH * 3 }, (_, i) => ({ id: `m${String(i).padStart(5, "0")}`, sessionId: "s1", content: "words", toolCalls: null, meta: null, createdAt: t(1) }));
    st.clock = NOW.getTime();
    st.tick = 10;
    vi.spyOn(Date, "now").mockImplementation(() => st.clock as number);
    // Each statement takes 10 ms: room for the chats' read and one batch.
    const first = await blankTeammateHistory("u1", NOW.getTime() + 25);
    expect(first).toEqual({ done: false, rows: ERASURE_BATCH });
    expect(ofTable("chatMessage", (m) => m.content === "Erased")).toHaveLength(ERASURE_BATCH);
    const second = await blankTeammateHistory("u1", (st.clock as number) + 1_000_000);
    expect(second.done).toBe(true);
    expect(ofTable("chatMessage").every((m) => m.content === "Erased")).toBe(true);
    expect(ofTable("chatSession")[0].title).toBeNull();
    // A deadline already gone: nothing is read at all.
    st.log = [];
    expect(await blankTeammateHistory("u1", (st.clock as number) - 1)).toEqual({ done: false, rows: 0 });
    expect(st.log).toEqual([]);
  });
});

describe("finishErasures", () => {
  const erasure = (userId: string, createdAt: Date, method = "erasure") => ({ id: `c-${userId}-${method}`, userId, method, createdAt, policyVersion: "2026-10-06" });

  it("finds the people erased in the last 30 days, blanks what is left of theirs, and records each finished once it has settled", async () => {
    for (const u of ["old", "settled", "fresh", "done", "gone"]) seedPerson(u);
    st.tables.consentRecord = [
      // Past the window: left alone.
      erasure("old", new Date(NOW.getTime() - ERASURE_SWEEP_WINDOW_MS - 60_000)),
      // Erased long enough ago that nothing in flight can still write.
      erasure("settled", new Date(NOW.getTime() - ERASURE_SETTLED_MS - 60_000)),
      // Erased a minute ago: blanked, but read again on later ticks.
      erasure("fresh", new Date(NOW.getTime() - 60_000)),
      // Already finished: never read again.
      erasure("done", new Date(NOW.getTime() - ERASURE_SETTLED_MS - 120_000)),
      erasure("done", new Date(NOW.getTime() - ERASURE_SETTLED_MS - 60_000), "erasure_finished"),
      // Consent records of other kinds are not erasures.
      { id: "c-banner", userId: "gone", method: "banner", createdAt: NOW, policyVersion: "2026-10-06" },
    ];
    const counts = await finishErasures(NOW, { limit: 50, budgetMs: 60_000 });
    expect(counts).toMatchObject({ found: 2, finished: 1, waiting: 1, failed: 0 });
    expect(counts.blanked).toBeGreaterThan(0);
    expectBlank("settled");
    expectBlank("fresh");
    // The ones outside it keep what they hold: the sweep never reads them.
    for (const u of ["old", "done", "gone"]) expect(ofTable("chatMessage", (r) => r.id === `${u}-m1`)[0].content).toBe("Your inbox has 3 invoices from lea@x.test");
    // One finished record, for the settled erasure, carrying its policy version.
    expect(ofTable("consentRecord", (r) => r.method === "erasure_finished" && r.userId === "settled")).toEqual([
      expect.objectContaining({ userId: "settled", method: "erasure_finished", policyVersion: "2026-10-06", withdrawnAt: NOW }),
    ]);
    // The next tick: the settled one is finished, the fresh one is read again and is clean.
    st.log = [];
    const next = await finishErasures(NOW, { limit: 50, budgetMs: 60_000 });
    expect(next).toEqual({ found: 1, blanked: 0, finished: 0, waiting: 1, failed: 0 });
    // Once settled, the fresh one finishes too.
    const later = await finishErasures(new Date(NOW.getTime() + ERASURE_SETTLED_MS), { limit: 50, budgetMs: 60_000 });
    expect(later).toMatchObject({ found: 1, finished: 1 });
    expect(await finishErasures(new Date(NOW.getTime() + ERASURE_SETTLED_MS), { limit: 50, budgetMs: 60_000 })).toMatchObject({ found: 0 });
  });

  it("blanks a row written late, after the erasure's own pass, on the next tick", async () => {
    seedPerson("u1");
    st.tables.consentRecord = [erasure("u1", new Date(NOW.getTime() - 60_000))];
    await blankTeammateHistory("u1", FAR());
    // An Ask AI answer that was still streaming when the account went.
    st.tables.chatMessage.push({ id: "u1-late", sessionId: "u1-s1", content: "Here is the summary of Lea's email", toolCalls: null, meta: null, createdAt: t(9) });
    expect(await finishErasures(NOW, { limit: 50, budgetMs: 60_000 })).toMatchObject({ found: 1, blanked: 1, waiting: 1 });
    expect(ofTable("chatMessage", (r) => r.id === "u1-late")[0].content).toBe("Erased");
  });

  it("stops at its budget, leaving the rest for the next tick, and at its limit", async () => {
    for (const u of ["a", "b", "c"]) seedPerson(u);
    st.tables.consentRecord = ["a", "b", "c"].map((u, i) => erasure(u, new Date(NOW.getTime() - ERASURE_SETTLED_MS - (3 - i) * 60_000)));
    // No budget at all: every erasure found waits, nothing is read or written for it.
    const none = await finishErasures(NOW, { limit: 50, budgetMs: 0 });
    expect(none).toEqual({ found: 3, blanked: 0, finished: 0, waiting: 3, failed: 0 });
    expect(st.log.filter((l) => l.op !== "erasures")).toEqual([]);
    // A limit of two: the two oldest, and the third on the next tick.
    const two = await finishErasures(NOW, { limit: 2, budgetMs: 60_000 });
    expect(two).toMatchObject({ found: 2, finished: 2 });
    expectBlank("a");
    expectBlank("b");
    expect(ofTable("chatMessage", (r) => r.id === "c-m1")[0].content).not.toBe("Erased");
    expect(await finishErasures(NOW, { limit: 2, budgetMs: 60_000 })).toMatchObject({ found: 1, finished: 1 });
    expectBlank("c");
  });

  it("counts a pass that throws as failed, logs it, and still finishes the people after it", async () => {
    for (const u of ["a", "b"]) seedPerson(u);
    st.tables.consentRecord = ["a", "b"].map((u, i) => erasure(u, new Date(NOW.getTime() - ERASURE_SETTLED_MS - (2 - i) * 60_000)));
    st.throwFor = { model: "agentAction", userId: "a" };
    const counts = await finishErasures(NOW, { limit: 50, budgetMs: 60_000 });
    expect(counts).toMatchObject({ found: 2, finished: 1, failed: 1 });
    expectBlank("b");
    expect(ofTable("consentRecord", (r) => r.method === "erasure_finished").map((r) => r.userId)).toEqual(["b"]);
    expect(String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain("[cron-failure] run-due-agents");
  });
});
