// POST /api/me/delete (GDPR Art. 17): review round 3 of Phase 3. The
// erasure blanked the person's AIQuery rows and nothing an AI teammate kept:
// their chats (Gmail summaries in a teammate's answers), the requests they
// approved (the whole body of every email they sent or replied to, and
// other people's addresses), and their runs' output all stayed for good.
// Review round 5 of Phase 3: blanking them in the one transaction timed out
// for a heavy person, so the transaction is short and the words are blanked
// in batches after it commits (src/lib/agents/erasure-sweep.ts, tested in
// erasure-sweep.test.ts); and their Google connections end before it, so no
// teammate reads their mail into a chat just blanked.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Args = { where?: Record<string, unknown>; data?: Record<string, unknown>; select?: unknown };

const st = vi.hoisted(() => ({
  /** Every call, in order: the model, the operation, whether it ran in the transaction. */
  calls: [] as Array<{ model: string; op: string; args: Args; inTx: boolean }>,
  inTx: false,
  sole: [] as string[],
  soleInTx: [] as string[],
  ended: [] as Array<{ userId: string; reason: string; at: number }>,
  endThrows: false,
  /** Review round 5 of Phase 3: the batched blanking after the commit, and what it answers. */
  blanks: [] as Array<{ userId: string; deadline: number; at: number; inTx: boolean }>,
  blankAnswer: { done: true, rows: 3 } as { done: boolean; rows: number } | Error,
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-max" } } }),
  getUserId: (s: { user: { id: string } }) => s.user.id,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/compliance/server", () => ({
  getClientIp: async () => "203.0.113.9",
  getVisitorGeo: async () => ({ label: "EU", country: "DE" }),
  POLICY_VERSION: "2026-10-06",
}));
vi.mock("@/lib/access/self-facts", () => ({
  soleAdminWorkspaces: async (_userId: string, db?: unknown) => {
    // The re-check under the lock is a statement of the transaction too.
    if (db) st.calls.push({ model: "soleAdmin", op: "recheck", args: {}, inTx: st.inTx });
    return db ? st.soleInTx : st.sole;
  },
}));
vi.mock("@/lib/connectors/connections", () => ({
  endAllConnectionsOf: async (userId: string, reason: string) => {
    st.ended.push({ userId, reason, at: st.calls.length });
    if (st.endThrows) throw new Error("connection reset");
    return 1;
  },
}));
vi.mock("@/lib/agents/erasure-sweep", () => ({
  ERASURE_INLINE_BUDGET_MS: 20_000,
  ERASURE_METHOD: "erasure",
  blankTeammateHistory: async (userId: string, deadline: number) => {
    st.blanks.push({ userId, deadline, at: st.calls.length, inTx: st.inTx });
    if (st.blankAnswer instanceof Error) throw st.blankAnswer;
    return st.blankAnswer;
  },
}));
vi.mock("@/lib/prisma", () => {
  const models = new Map<string, unknown>();
  const record = (model: string, op: string) => async (args: Args) => {
    st.calls.push({ model, op, args, inTx: st.inTx });
    if (model === "user" && op === "findUnique") return { id: "u-max", email: "max@x.test", deletedAt: null, organizationId: "org1" };
    if (op === "findMany") return [];
    return { count: 1 };
  };
  const model = (name: string) =>
    new Proxy({}, { get: (_t, op: string) => record(name, op) });
  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === "$transaction") {
          return async (fn: (tx: unknown) => Promise<unknown>) => {
            st.inTx = true;
            try {
              const out = await fn(prisma);
              st.calls.push({ model: "$commit", op: "commit", args: {}, inTx: true });
              return out;
            } finally {
              st.inTx = false;
            }
          };
        }
        if (key === "$executeRaw") {
          return async () => {
            st.calls.push({ model: "$executeRaw", op: "lock", args: {}, inTx: st.inTx });
            return 1;
          };
        }
        if (!models.has(key)) models.set(key, model(key));
        return models.get(key);
      },
    },
  );
  return { prisma };
});

import { POST } from "./route";

function del(body: unknown = { confirm: "DELETE" }) {
  return POST(new NextRequest("https://app.test/api/me/delete", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
}

const inTx = (model: string, op = "updateMany") => st.calls.filter((c) => c.model === model && c.op === op && c.inTx);
const txCalls = () => st.calls.filter((c) => c.inTx);

beforeEach(() => {
  st.calls = [];
  st.inTx = false;
  st.sole = [];
  st.soleInTx = [];
  st.ended = [];
  st.endThrows = false;
  st.blanks = [];
  st.blankAnswer = { done: true, rows: 3 };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/me/delete: AI teammates' records (review round 3 of Phase 3)", () => {
  it("deletes what teammates remember about the person, and leaves their routines no words and no next run, in its transaction (lead, after review round 3)", async () => {
    await del();
    // Before: neither was touched.
    const ofModel = (model: string) => st.calls.filter((c) => c.model === model);
    expect(ofModel("agentMemory").map((c) => [c.op, c.args, c.inTx])).toEqual([["deleteMany", { where: { scope: "person", scopeId: "u-max" } }, true]]);
    expect(ofModel("agentRoutine").map((c) => [c.op, c.args, c.inTx])).toEqual([["updateMany", { where: { actingForId: "u-max" }, data: { name: "Erased", prompt: "Erased", status: "paused", pausedReason: "person_gone", nextRunAt: null } }, true]]);
    // A teammate's shared memories (scope "agent") are the workspace's, never deleted here.
    expect(JSON.stringify(ofModel("agentMemory").map((c) => c.args))).not.toContain('"agent"');
    // The erasure's own record, in the transaction.
    expect(st.calls.filter((c) => c.model === "consentRecord" && c.op === "create" && c.inTx).map((c) => (c.args.data as { method: string }).method)).toEqual(["erasure"]);
  });

  it("ends the person's Google connections before the transaction, and an end that fails never stops the erasure", async () => {
    await del();
    expect(st.ended).toHaveLength(1);
    expect(st.ended[0]).toMatchObject({ userId: "u-max", reason: "left" });
    // Before: it ran after the commit, so a teammate could read their mail into a chat just blanked.
    const firstTx = st.calls.findIndex((c) => c.inTx);
    expect(st.ended[0].at).toBeLessThanOrEqual(firstTx);
    expect(st.calls.slice(0, st.ended[0].at).some((c) => c.inTx)).toBe(false);

    st.calls = [];
    st.ended = [];
    st.blanks = [];
    st.endThrows = true;
    const res = await del();
    expect(res.status).toBe(200);
    expect(st.blanks).toHaveLength(1);
  });

  it("blanks nothing when the request is refused", async () => {
    expect((await del({ confirm: "nope" })).status).toBe(400);
    st.sole = ["org1"];
    expect((await del()).status).toBe(409);
    expect(st.calls.filter((c) => c.op === "updateMany")).toEqual([]);
    expect(st.ended).toEqual([]);
    expect(st.blanks).toEqual([]);
  });
});

// Review round 4 of Phase 3: a turn still going during the erasure wrote its
// answer, its run's output and its cards after the blanking; review round 5:
// the runs were failed before the workspace locks' wait, so a run claimed
// during it kept its output for good.
describe("POST /api/me/delete: a turn still going (review rounds 4 and 5 of Phase 3)", () => {
  it("takes the workspace locks and re-checks the last admin before any run statement", async () => {
    await del();
    const tx = txCalls();
    // Before: the first statement failed the runs, before the locks' wait.
    expect(tx.slice(0, 2).map((c) => c.model)).toEqual(["$executeRaw", "soleAdmin"]);
    const firstRun = tx.findIndex((c) => c.model === "agentRun");
    expect(firstRun).toBe(2);
  });

  it("fails the open runs, ends the running requests and anonymises the User row back to back", async () => {
    await del();
    const tx = txCalls();
    const firstRun = tx.findIndex((c) => c.model === "agentRun");
    expect(tx.slice(firstRun, firstRun + 3).map((c) => [c.model, c.op])).toEqual([
      ["agentRun", "updateMany"],
      ["agentAction", "updateMany"],
      ["user", "update"],
    ]);
    expect(tx[firstRun].args).toEqual({
      where: { OR: [{ actingForId: "u-max" }, { triggeredBy: "u-max" }], status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "FAILED", endedAt: expect.any(Date), error: "This run stopped because the account it worked for was deleted." },
    });
    expect(tx[firstRun + 1].args).toEqual({ where: { actingForId: "u-max", status: "RUNNING" }, data: { status: "FAILED", updatedAt: expect.any(Date) } });
    expect(tx[firstRun + 2].args.data).toMatchObject({ email: "deleted-u-max@workwrk.anon", status: "INACTIVE", deletedAt: expect.any(Date), tokenVersion: { increment: 1 } });
    // No run after the person: the order a turn takes the two in.
    expect(tx.slice(firstRun + 3).some((c) => c.model === "agentRun")).toBe(false);
  });

  it("runs no update of the person's whole history inside the transaction", async () => {
    await del();
    // Before: every chat message, chat title, request, run, AI question and activity row of theirs, in this one transaction.
    for (const model of ["chatMessage", "chatSession", "aIQuery", "activityLog"]) expect(st.calls.filter((c) => c.model === model && c.inTx)).toEqual([]);
    // The only run and request statements are the bounded ones: open runs, running requests.
    expect(inTx("agentRun").map((c) => (c.args.where as { status?: unknown }).status)).toEqual([{ in: ["PENDING", "RUNNING"] }]);
    expect(inTx("agentAction").map((c) => (c.args.where as { status?: unknown }).status)).toEqual(["RUNNING"]);
  });

  it("blanks the person's words in batches after the commit, outside the transaction, within its budget", async () => {
    const before = Date.now();
    const res = await del();
    expect(res.status).toBe(200);
    expect(st.blanks).toHaveLength(1);
    const commit = st.calls.findIndex((c) => c.model === "$commit");
    expect(commit).toBeGreaterThan(0);
    // Before: inside the transaction, before its commit.
    expect(st.blanks[0]).toMatchObject({ userId: "u-max", inTx: false });
    expect(st.blanks[0].at).toBeGreaterThan(commit);
    expect(st.blanks[0].deadline).toBeGreaterThanOrEqual(before + 20_000);
    expect(st.blanks[0].deadline).toBeLessThanOrEqual(Date.now() + 20_000);
  });

  it("answers success once the transaction committed, when the batches throw or run out of time", async () => {
    st.blankAnswer = new Error("canceling statement due to statement timeout");
    const thrown = await del();
    expect(thrown.status).toBe(200);
    expect(await thrown.json()).toMatchObject({ ok: true });
    st.blankAnswer = { done: false, rows: 500 };
    const unfinished = await del();
    expect(unfinished.status).toBe(200);
    expect(await unfinished.json()).toMatchObject({ ok: true });
  });

  it("blanks nothing after a refusal under the lock", async () => {
    st.soleInTx = ["org1"];
    expect((await del()).status).toBe(409);
    expect(st.blanks).toEqual([]);
    // Refused before any run statement.
    expect(st.calls.filter((c) => c.model === "agentRun")).toEqual([]);
  });
});
