// POST /api/me/delete (GDPR Art. 17): review round 3 of Phase 3. The
// erasure blanked the person's AIQuery rows and nothing an AI teammate kept:
// their chats (Gmail summaries in a teammate's answers), the requests they
// approved (the whole body of every email they sent or replied to, and
// other people's addresses), and their runs' output all stayed for good. Now
// the same transaction blanks each, in every workspace, keeping the rows'
// ids, status and counts; and their Google connections end before it, so no
// teammate reads their mail into a chat just blanked.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma";

type Args = { where?: Record<string, unknown>; data?: Record<string, unknown>; select?: unknown };

const st = vi.hoisted(() => ({
  /** Every call, in order: the model, the operation, whether it ran in the transaction. */
  calls: [] as Array<{ model: string; op: string; args: Args; inTx: boolean }>,
  inTx: false,
  sole: [] as string[],
  soleInTx: [] as string[],
  ended: [] as Array<{ userId: string; reason: string; at: number }>,
  endThrows: false,
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
  soleAdminWorkspaces: async (_userId: string, db?: unknown) => (db ? st.soleInTx : st.sole),
}));
vi.mock("@/lib/connectors/connections", () => ({
  endAllConnectionsOf: async (userId: string, reason: string) => {
    st.ended.push({ userId, reason, at: st.calls.length });
    if (st.endThrows) throw new Error("connection reset");
    return 1;
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
              return await fn(prisma);
            } finally {
              st.inTx = false;
            }
          };
        }
        if (key === "$executeRaw") return async () => 1;
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

beforeEach(() => {
  st.calls = [];
  st.inTx = false;
  st.sole = [];
  st.soleInTx = [];
  st.ended = [];
  st.endThrows = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/me/delete: AI teammates' records (review round 3 of Phase 3)", () => {
  it("blanks, in its transaction and in every workspace, the person's chats, the requests they were asked to approve and their runs' output", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    // Before: none of these four were written.
    expect(inTx("chatMessage").map((c) => c.args)).toEqual([{ where: { session: { userId: "u-max" } }, data: { content: "Erased", toolCalls: Prisma.DbNull, meta: Prisma.DbNull } }]);
    expect(inTx("chatSession").map((c) => c.args)).toEqual([{ where: { userId: "u-max" }, data: { title: null } }]);
    expect(inTx("agentAction").map((c) => c.args)).toEqual([{ where: { actingForId: "u-max" }, data: { input: {}, editedInput: Prisma.DbNull, preview: {}, result: Prisma.DbNull } }]);
    expect(inTx("agentRun").map((c) => c.args)).toEqual([
      { where: { OR: [{ actingForId: "u-max" }, { triggeredBy: "u-max" }] }, data: { output: Prisma.DbNull } },
      { where: { triggeredBy: "u-max", actingForId: null }, data: { input: {} } },
    ]);
    // No workspace named: every workspace the person was in.
    for (const c of [...inTx("chatMessage"), ...inTx("chatSession"), ...inTx("agentAction"), ...inTx("agentRun")]) expect(JSON.stringify(c.args.where)).not.toContain("organizationId");
    // The rows stay (their ids, status and counts): nothing of these is deleted.
    for (const m of ["chatMessage", "chatSession", "agentAction", "agentRun"]) expect(st.calls.filter((c) => c.model === m && c.op.startsWith("delete"))).toEqual([]);
    // The existing guarantees hold: the AI questions worded "Erased", and the erasure's own record.
    expect(inTx("aIQuery").map((c) => c.args.data)).toEqual([{ query: "Erased", response: null }]);
    expect(st.calls.filter((c) => c.model === "consentRecord" && c.op === "create" && c.inTx)).toHaveLength(1);
  });

  it("deletes what teammates remember about the person, and leaves their routines no words and no next run (lead, after review round 3)", async () => {
    await del();
    // Before: neither was touched.
    const ofModel = (model: string) => st.calls.filter((c) => c.model === model);
    expect(ofModel("agentMemory").map((c) => [c.op, c.args, c.inTx])).toEqual([["deleteMany", { where: { scope: "person", scopeId: "u-max" } }, true]]);
    expect(ofModel("agentRoutine").map((c) => [c.op, c.args, c.inTx])).toEqual([["updateMany", { where: { actingForId: "u-max" }, data: { name: "Erased", prompt: "Erased", status: "paused", pausedReason: "person_gone", nextRunAt: null } }, true]]);
    // A teammate's shared memories (scope "agent") are the workspace's, never deleted here.
    expect(JSON.stringify(ofModel("agentMemory").map((c) => c.args))).not.toContain('"agent"');
  });

  it("ends the person's Google connections before the transaction that blanks their chats, and an end that fails never stops the erasure", async () => {
    await del();
    expect(st.ended).toHaveLength(1);
    expect(st.ended[0]).toMatchObject({ userId: "u-max", reason: "left" });
    const firstBlank = st.calls.findIndex((c) => c.model === "chatMessage" && c.op === "updateMany");
    // Before: it ran after the commit, so a teammate could read their mail into a chat just blanked.
    expect(st.ended[0].at).toBeLessThan(firstBlank);
    expect(st.calls.slice(0, st.ended[0].at).some((c) => c.inTx)).toBe(false);

    st.calls = [];
    st.ended = [];
    st.endThrows = true;
    const res = await del();
    expect(res.status).toBe(200);
    expect(inTx("chatMessage")).toHaveLength(1);
  });

  it("blanks nothing when the request is refused", async () => {
    expect((await del({ confirm: "nope" })).status).toBe(400);
    st.sole = ["org1"];
    expect((await del()).status).toBe(409);
    expect(st.calls.filter((c) => c.op === "updateMany")).toEqual([]);
    expect(st.ended).toEqual([]);
  });
});
