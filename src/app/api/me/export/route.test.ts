// GET /api/me/export (GDPR Art. 15): review round 3 of Phase 3. The export
// read notifications, KPIs, reviews and the like, and nothing an AI teammate
// keeps for the person: not their Google connection (the account's address,
// products, dates), not what they allowed each teammate, not the requests a
// teammate asked them to approve (every email body and recipient they sent
// through one), not their chats with their teammates. Each is now in it,
// scoped to the person, and a connection's sealed tokens never are.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Args = { where?: Record<string, unknown>; select?: Record<string, unknown>; take?: number; orderBy?: unknown };

const st = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  calls: [] as Array<{ model: string; op: string; args: Args }>,
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-max" } } }),
  getUserId: (s: { user: { id: string } }) => s.user.id,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
}));
vi.mock("@/lib/people/review-visibility", () => ({ subjectRowView: (r: unknown) => r }));
vi.mock("@/lib/prisma", () => {
  const models = new Map<string, unknown>();
  const model = (name: string) => ({
    findMany: async (args: Args) => {
      st.calls.push({ model: name, op: "findMany", args });
      const rows = (st.rows[name] ?? []) as Array<Record<string, unknown>>;
      // A chat's messages: its own, newest first, at most `take`.
      if (name === "chatMessage") {
        const mine = rows.filter((r) => r.sessionId === args.where?.sessionId).reverse();
        return mine.slice(0, args.take ?? mine.length);
      }
      // The requests: newest first, at most `take` (review round 4 of Phase 3).
      if (name === "agentAction" && args.take !== undefined) return [...rows].reverse().slice(0, args.take);
      return rows;
    },
    findUnique: async (args: Args) => {
      st.calls.push({ model: name, op: "findUnique", args });
      return name === "user" ? { id: "u-max", email: "max@x.test" } : null;
    },
    count: async (args: Args) => {
      st.calls.push({ model: name, op: "count", args });
      const rows = (st.rows[name] ?? []) as Array<Record<string, unknown>>;
      // A request has no sessionId here: every request in the double is the person's.
      if (name === "agentAction") return rows.length;
      return rows.filter((r) => r.sessionId === args.where?.sessionId).length;
    },
  });
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (!models.has(key)) models.set(key, model(key));
          return models.get(key);
        },
      },
    ),
  };
});

import { GET } from "./route";

/** The route's own cap on one chat (route.ts TEAMMATE_CHAT_EXPORT_MAX). */
const TEAMMATE_CHAT_EXPORT_MAX = 5_000;
/** The route's cap on every chat together, and on the requests (review round 4 of Phase 3). */
const TEAMMATE_CHATS_EXPORT_BUDGET = 20_000;
const TEAMMATE_REQUESTS_EXPORT_MAX = 5_000;

beforeEach(() => {
  st.rows = {};
  st.calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function exported(): Promise<{ records: Record<string, unknown> }> {
  const res = await GET();
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

const callOf = (model: string) => st.calls.find((c) => c.model === model && c.op === "findMany");

describe("GET /api/me/export: AI teammates' records (review round 3 of Phase 3)", () => {
  it("carries what the person's teammates remember about them and the routines that work as them (lead, after review round 3)", async () => {
    st.rows.agentMemory = [{ key: "report day", value: "Friday", source: "chat", createdAt: "2026-10-08T09:00:00.000Z", updatedAt: "2026-10-08T09:00:00.000Z", agent: { name: "Planner", organizationId: "org1" } }];
    st.rows.agentRoutine = [{ name: "Daily brief", prompt: "Tell me my top three.", schedule: "weekdays 09:00", status: "active", createdAt: "2026-10-08T09:00:00.000Z", lastRunAt: null, agent: { name: "Planner", organizationId: "org1" } }];
    const out = await exported();
    // Before: neither was in the export.
    expect(out.records.teammateMemories).toEqual([{ teammate: "Planner", organizationId: "org1", key: "report day", value: "Friday", savedFrom: "chat", createdAt: "2026-10-08T09:00:00.000Z", updatedAt: "2026-10-08T09:00:00.000Z" }]);
    expect(out.records.teammateRoutines).toEqual([{ teammate: "Planner", organizationId: "org1", name: "Daily brief", prompt: "Tell me my top three.", schedule: "weekdays 09:00", status: "active", createdAt: "2026-10-08T09:00:00.000Z", lastRunAt: null }]);
    // Only the person's own: person scope, by their id; never a teammate's shared memories.
    expect(callOf("agentMemory")?.args.where).toEqual({ scope: "person", scopeId: "u-max" });
    expect(callOf("agentRoutine")?.args.where).toEqual({ actingForId: "u-max" });
  });

  it("carries the person's Google connections, never a token", async () => {
    st.rows.teammateConnection = [
      { organizationId: "org1", provider: "google", products: ["gmail"], accountEmail: "max@mail.test", status: "active", connectedAt: "2026-10-08T09:00:00.000Z", lastUsedAt: null },
    ];
    const out = await exported();
    // Before: no teammateConnections at all.
    expect(out.records.teammateConnections).toEqual(st.rows.teammateConnection);
    const read = callOf("teammateConnection");
    expect(read?.args.where).toEqual({ userId: "u-max" });
    // The select names what is shown, and no sealed column or account id.
    expect(Object.keys(read?.args.select ?? {}).sort()).toEqual(["accountEmail", "connectedAt", "lastUsedAt", "organizationId", "products", "provider", "status"]);
    for (const secret of ["refreshTokenSealed", "accessTokenSealed", "accountSub", "accountKey", "scopes"]) expect(read?.args.select).not.toHaveProperty(secret);
  });

  it("carries what the person allowed each teammate, and every request a teammate asked them to approve with what it would send", async () => {
    st.rows.agentPersonSetting = [
      { agentId: "a-ops", connectorProducts: ["gmail"], approvalRules: { "post_in_talk:conv:c1": "always" }, createdAt: "2026-10-08T09:00:00.000Z", updatedAt: "2026-10-08T09:00:00.000Z", agent: { name: "Ops", organizationId: "org1" } },
    ];
    st.rows.agentAction = [
      {
        id: "act1", organizationId: "org1", agentId: "a-ops", toolName: "send_email", status: "EXECUTED", preview: { title: "Send an email from Gmail" },
        input: { to: ["lea@x.test"], subject: "Plan", body: "Draft" }, editedInput: { to: ["lea@x.test"], subject: "Plan", body: "Final words" },
        createdAt: "2026-10-08T09:00:00.000Z", decidedAt: "2026-10-08T09:01:00.000Z", executedAt: "2026-10-08T09:01:01.000Z", expiresAt: "2026-10-09T09:00:00.000Z",
      },
      {
        id: "act2", organizationId: "org1", agentId: "a-ops", toolName: "create_event", status: "DENIED", preview: {}, input: { title: "Sync" }, editedInput: null,
        createdAt: "2026-10-08T10:00:00.000Z", decidedAt: "2026-10-08T10:01:00.000Z", executedAt: null, expiresAt: "2026-10-09T10:00:00.000Z",
      },
    ];
    const out = await exported();
    expect(out.records.teammateAllows).toEqual([
      { agentId: "a-ops", teammate: "Ops", organizationId: "org1", googleProductsAllowed: ["gmail"], approvalRules: { "post_in_talk:conv:c1": "always" }, createdAt: "2026-10-08T09:00:00.000Z", updatedAt: "2026-10-08T09:00:00.000Z" },
    ]);
    expect(out.records.teammateRequests).toEqual([
      {
        id: "act1", organizationId: "org1", agentId: "a-ops", tool: "send_email", status: "EXECUTED", title: "Send an email from Gmail",
        // What the person approved: their edit, not what was first asked.
        input: { to: ["lea@x.test"], subject: "Plan", body: "Final words" },
        createdAt: "2026-10-08T09:00:00.000Z", decidedAt: "2026-10-08T09:01:00.000Z", executedAt: "2026-10-08T09:01:01.000Z", expiresAt: "2026-10-09T09:00:00.000Z",
      },
      {
        id: "act2", organizationId: "org1", agentId: "a-ops", tool: "create_event", status: "DENIED", title: null, input: { title: "Sync" },
        createdAt: "2026-10-08T10:00:00.000Z", decidedAt: "2026-10-08T10:01:00.000Z", executedAt: null, expiresAt: "2026-10-09T10:00:00.000Z",
      },
    ]);
    expect(callOf("agentPersonSetting")?.args.where).toEqual({ userId: "u-max" });
    expect(callOf("agentAction")?.args.where).toEqual({ actingForId: "u-max" });
  });

  it("carries the person's own teammate chats, oldest first, at most TEAMMATE_CHAT_EXPORT_MAX messages each, saying how many it left out", async () => {
    st.rows.chatSession = [
      { id: "s1", organizationId: "org1", kind: "TEAMMATE", title: "Ops", agentId: "a-ops", createdAt: "2026-10-08T09:00:00.000Z" },
      { id: "s2", organizationId: "org1", kind: "TEAMMATE_GROUP", title: "Vendors", agentId: null, createdAt: "2026-10-08T09:00:00.000Z" },
    ];
    const msg = (sessionId: string, i: number) => ({ id: `${sessionId}-m${i}`, sessionId, role: i % 2 ? "ASSISTANT" : "USER", kind: null, content: `words ${i}`, toolCalls: null, createdAt: new Date(Date.UTC(2026, 9, 8, 9, 0, i)).toISOString() });
    st.rows.chatMessage = [...Array.from({ length: TEAMMATE_CHAT_EXPORT_MAX + 3 }, (_, i) => msg("s1", i)), msg("s2", 0), msg("s2", 1)];
    const out = await exported();
    const chats = out.records.teammateChats as Array<{ id: string; messages: Array<{ id: string }>; messagesLeftOut: number }>;
    // Before: no teammateChats at all.
    expect(chats.map((c) => [c.id, c.messages.length, c.messagesLeftOut])).toEqual([
      ["s1", TEAMMATE_CHAT_EXPORT_MAX, 3],
      ["s2", 2, 0],
    ]);
    // The newest are kept, oldest first.
    expect(chats[0].messages[0].id).toBe("s1-m3");
    expect(chats[0].messages[TEAMMATE_CHAT_EXPORT_MAX - 1].id).toBe(`s1-m${TEAMMATE_CHAT_EXPORT_MAX + 2}`);
    expect(chats[1].messages.map((m) => m.id)).toEqual(["s2-m0", "s2-m1"]);
    // Only the person's own chats with teammates, and only their messages.
    expect(callOf("chatSession")?.args.where).toEqual({ userId: "u-max", kind: { in: ["TEAMMATE", "TEAMMATE_GROUP"] } });
    expect(st.calls.filter((c) => c.model === "chatMessage" && c.op === "findMany").map((c) => c.args.where)).toEqual([{ sessionId: "s1" }, { sessionId: "s2" }]);
  });
});

// Review round 4 of Phase 3: each chat was capped, the export as a whole was
// not, and every chat was read at once through Promise.all, so a heavy
// user's export could fail or run the server out of memory; and every
// request a teammate ever asked them to approve was read with no cap.
describe("GET /api/me/export: bounded as a whole (review round 4 of Phase 3)", () => {
  const msg = (sessionId: string, i: number) => ({ id: `${sessionId}-m${i}`, sessionId, role: "USER", kind: null, content: "w", toolCalls: null, createdAt: "2026-10-08T09:00:00.000Z" });
  const chat = (id: string) => ({ id, organizationId: "org1", kind: "TEAMMATE", title: id, agentId: `a-${id}`, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-09T09:00:00.000Z" });

  it("reads the chats one at a time, most recently active first, within one budget across them all, saying what each left out", async () => {
    const sizes: Array<[string, number]> = [["c1", TEAMMATE_CHAT_EXPORT_MAX + 3], ["c2", 4_500], ["c3", 4_500], ["c4", 4_500], ["c5", 4_500], ["c6", 2]];
    st.rows.chatSession = sizes.map(([id]) => chat(id));
    st.rows.chatMessage = sizes.flatMap(([id, n]) => Array.from({ length: n }, (_, i) => msg(id, i)));
    const out = await exported();
    const chats = out.records.teammateChats as Array<{ id: string; messages: unknown[]; messagesLeftOut: number; lastActiveAt: string }>;
    // Before: every chat whole up to its own cap, 23,002 messages in all, read side by side.
    expect(chats.map((c) => [c.id, c.messages.length, c.messagesLeftOut])).toEqual([
      ["c1", TEAMMATE_CHAT_EXPORT_MAX, 3],
      ["c2", 4_500, 0],
      ["c3", 4_500, 0],
      ["c4", 4_500, 0],
      ["c5", 1_500, 3_000],
      ["c6", 0, 2],
    ]);
    expect(chats.reduce((n, c) => n + c.messages.length, 0)).toBe(TEAMMATE_CHATS_EXPORT_BUDGET);
    expect(chats[0].lastActiveAt).toBe("2026-10-09T09:00:00.000Z");
    // The most recently active first.
    expect(callOf("chatSession")?.args.orderBy).toEqual([{ updatedAt: "desc" }, { id: "desc" }]);
    // One chat at a time: each chat's count and read before the next chat's, and none for a chat past the budget.
    const reads = st.calls.filter((c) => c.model === "chatMessage").map((c) => `${c.op}:${String(c.args.where?.sessionId)}`);
    expect(reads).toEqual(["count:c1", "findMany:c1", "count:c2", "findMany:c2", "count:c3", "findMany:c3", "count:c4", "findMany:c4", "count:c5", "findMany:c5", "count:c6"]);
    expect(st.calls.filter((c) => c.model === "chatMessage" && c.op === "findMany").map((c) => c.args.take)).toEqual([TEAMMATE_CHAT_EXPORT_MAX, 4_500, 4_500, 4_500, 1_500]);
  });

  it("carries at most TEAMMATE_REQUESTS_EXPORT_MAX requests, the newest, oldest first, and says how many it left out", async () => {
    st.rows.agentAction = Array.from({ length: TEAMMATE_REQUESTS_EXPORT_MAX + 2 }, (_, i) => ({
      id: `act${i}`, organizationId: "org1", agentId: "a-ops", toolName: "create_task", status: "EXECUTED", preview: {}, input: {}, editedInput: null,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(), decidedAt: null, executedAt: null, expiresAt: "2026-10-09T09:00:00.000Z",
    }));
    const out = await exported();
    const requests = out.records.teammateRequests as Array<{ id: string }>;
    // Before: all 5,002, and no count of what was left out.
    expect(requests).toHaveLength(TEAMMATE_REQUESTS_EXPORT_MAX);
    expect(requests[0].id).toBe("act2");
    expect(requests[requests.length - 1].id).toBe(`act${TEAMMATE_REQUESTS_EXPORT_MAX + 1}`);
    expect(out.records.teammateRequestsLeftOut).toBe(2);
    expect(callOf("agentAction")?.args).toMatchObject({ where: { actingForId: "u-max" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: TEAMMATE_REQUESTS_EXPORT_MAX });
    st.rows.agentAction = st.rows.agentAction.slice(0, 3);
    expect((await exported()).records.teammateRequestsLeftOut).toBe(0);
  });
});
