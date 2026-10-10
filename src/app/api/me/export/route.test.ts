// GET /api/me/export (GDPR Art. 15): review round 3 of Phase 3. The export
// read notifications, KPIs, reviews and the like, and nothing an AI teammate
// keeps for the person: not their Google connection (the account's address,
// products, dates), not what they allowed each teammate, not the requests a
// teammate asked them to approve (every email body and recipient they sent
// through one), not their chats with their teammates. Each is now in it,
// scoped to the person, and a connection's sealed tokens never are.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Args = { where?: Record<string, unknown>; select?: Record<string, unknown>; take?: number; orderBy?: unknown; cursor?: { id: string }; skip?: number };

const st = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  calls: [] as Array<{ model: string; op: string; args: Args }>,
  /** Review round 5 of Phase 3: reads in flight at once, and the most there ever were. */
  inFlight: 0,
  maxInFlight: 0,
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-max" } } }),
  getUserId: (s: { user: { id: string } }) => s.user.id,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
}));
vi.mock("@/lib/people/review-visibility", () => ({ subjectRowView: (r: unknown) => r }));
vi.mock("@/lib/prisma", () => {
  const models = new Map<string, unknown>();
  /** One read in flight until the next turn of the event loop's microtasks, so reads started together are seen together. */
  const inFlight = async <T>(read: () => T): Promise<T> => {
    st.inFlight += 1;
    st.maxInFlight = Math.max(st.maxInFlight, st.inFlight);
    await null;
    st.inFlight -= 1;
    return read();
  };
  /** Newest first, after the cursor (Prisma's cursor plus skip), at most `take`. */
  const page = (newestFirst: Array<Record<string, unknown>>, args: Args) => {
    const from = args.cursor ? newestFirst.findIndex((r) => r.id === args.cursor?.id) + (args.skip ?? 0) : 0;
    return newestFirst.slice(from, args.take === undefined ? undefined : from + args.take);
  };
  const model = (name: string) => ({
    findMany: (args: Args) =>
      inFlight(() => {
        st.calls.push({ model: name, op: "findMany", args });
        const rows = (st.rows[name] ?? []) as Array<Record<string, unknown>>;
        // A chat's messages: its own, newest first, a page at a time.
        if (name === "chatMessage") return page(rows.filter((r) => r.sessionId === args.where?.sessionId).reverse(), args);
        // The requests, notifications and activity rows: newest first, at most `take` (review rounds 4 and 5 of Phase 3).
        if (["agentAction", "notification", "activityLog"].includes(name) && args.take !== undefined) return page([...rows].reverse(), args);
        return rows;
      }),
    findUnique: (args: Args) =>
      inFlight(() => {
        st.calls.push({ model: name, op: "findUnique", args });
        return name === "user" ? { id: "u-max", email: "max@x.test" } : null;
      }),
    count: (args: Args) =>
      inFlight(() => {
        st.calls.push({ model: name, op: "count", args });
        const rows = (st.rows[name] ?? []) as Array<Record<string, unknown>>;
        // Only a chat's messages are counted by chat: every other row in the double is the person's.
        if (name === "chatMessage") return rows.filter((r) => r.sessionId === args.where?.sessionId).length;
        return rows.length;
      }),
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
/** Review round 5 of Phase 3: a page of rows a read, the byte budget, a tool input's cut, the activity and notification caps. */
const TEAMMATE_EXPORT_PAGE = 100;
const TEAMMATE_EXPORT_BYTE_BUDGET = 50 * 1024 * 1024;
const TEAMMATE_TOOL_INPUT_EXPORT_MAX = 2_000;
const ACTIVITY_EXPORT_MAX = 10_000;
const NOTIFICATIONS_EXPORT_MAX = 10_000;

beforeEach(() => {
  st.rows = {};
  st.calls = [];
  st.inFlight = 0;
  st.maxInFlight = 0;
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
    expect([...new Set(st.calls.filter((c) => c.model === "chatMessage" && c.op === "findMany").map((c) => JSON.stringify(c.args.where)))]).toEqual(['{"sessionId":"s1"}', '{"sessionId":"s2"}']);
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
    // One chat at a time: each chat's count and reads before the next chat's, and none for a chat past the budget.
    const reads = st.calls.filter((c) => c.model === "chatMessage").map((c) => `${c.op}:${String(c.args.where?.sessionId)}`);
    expect(reads.filter((r, i) => r !== reads[i - 1])).toEqual(["count:c1", "findMany:c1", "count:c2", "findMany:c2", "count:c3", "findMany:c3", "count:c4", "findMany:c4", "count:c5", "findMany:c5", "count:c6"]);
    // Review round 5 of Phase 3: a page at a time, never more than TEAMMATE_EXPORT_PAGE rows a read.
    const takes = st.calls.filter((c) => c.model === "chatMessage" && c.op === "findMany").map((c) => c.args.take as number);
    expect(Math.max(...takes)).toBe(TEAMMATE_EXPORT_PAGE);
    expect(takes.reduce((n, x) => n + x, 0)).toBe(TEAMMATE_CHATS_EXPORT_BUDGET);
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
    expect(callOf("agentAction")?.args).toMatchObject({ where: { actingForId: "u-max" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: TEAMMATE_EXPORT_PAGE });
    st.rows.agentAction = st.rows.agentAction.slice(0, 3);
    expect((await exported()).records.teammateRequestsLeftOut).toBe(0);
  });
});

// Review round 5 of Phase 3: the export was bounded by rows, not bytes. Each
// teammate message's call record held whole tool results (other people's
// records the tool read), so 20,000 rows could reach gigabytes; activity
// rows and notifications had no cap; and its 25 reads ran all at once.
describe("GET /api/me/export: bounded in bytes (review round 5 of Phase 3)", () => {
  const chat = (id: string) => ({ id, organizationId: "org1", kind: "TEAMMATE", title: id, agentId: `a-${id}`, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-09T09:00:00.000Z" });
  const bytes = (row: unknown) => Buffer.byteLength(JSON.stringify(row), "utf8");

  it("carries each tool call's name, whether it failed and its input cut at 2,000 characters, never what the tool returned, and says so", async () => {
    st.rows.chatSession = [chat("c1")];
    st.rows.chatMessage = [
      {
        id: "m1", sessionId: "c1", role: "ASSISTANT", kind: null, content: "Done.", createdAt: "2026-10-08T09:00:00.000Z",
        toolCalls: [
          { name: "search_tasks", input: { query: "salary" }, result: { tasks: [{ title: "Lea's salary review" }] }, errorText: null, state: "ran", durationMs: 40, actionId: null },
          { name: "update_doc", input: { body: "y".repeat(5_000) }, result: { error: "No such doc" }, errorText: "No such doc", state: "failed", durationMs: 12, actionId: null },
          { name: "search_email", input: null, result: { count: 3 }, errorText: null, state: "ran", durationMs: 90, actionId: null },
        ],
      },
      { id: "m2", sessionId: "c1", role: "USER", kind: null, content: "Thanks", toolCalls: null, createdAt: "2026-10-08T09:01:00.000Z" },
    ];
    const res = await GET();
    const text = await res.text();
    const out = JSON.parse(text) as { records: { teammateChats: Array<{ messages: Array<{ toolCalls: unknown }> }>; teammateChatsNote: string } };
    const [first, second] = out.records.teammateChats[0].messages;
    // Before: each call whole, its result (other people's records) with it.
    expect(first.toolCalls).toEqual([
      { name: "search_tasks", failed: false, input: { query: "salary" } },
      { name: "update_doc", failed: true, input: JSON.stringify({ body: "y".repeat(5_000) }).slice(0, TEAMMATE_TOOL_INPUT_EXPORT_MAX), inputCut: true },
      { name: "search_email", failed: false, input: null },
    ]);
    expect(second.toolCalls).toBeNull();
    expect(text).not.toContain("Lea's salary review");
    expect(text).not.toContain("No such doc");
    expect(out.records.teammateChatsNote).toBe(
      "Each teammate message's tool calls show the tool, whether it failed and what it was asked, cut at 2,000 characters. What a tool returned is left out: those are your workspace's records the tool read, which can hold other people's data.",
    );
  });

  it("stops taking requests and messages once their bytes would pass the budget, requests first, counting what each left out", async () => {
    const mb = "x".repeat(1024 * 1024);
    st.rows.agentAction = Array.from({ length: 30 }, (_, i) => ({
      id: `act${String(i).padStart(2, "0")}`, organizationId: "org1", agentId: "a-ops", toolName: "send_email", status: "EXECUTED", preview: {}, input: { body: mb }, editedInput: null,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(), decidedAt: null, executedAt: null, expiresAt: "2026-10-09T09:00:00.000Z",
    }));
    st.rows.chatSession = [chat("c1"), chat("c2")];
    st.rows.chatMessage = [
      ...Array.from({ length: 40 }, (_, i) => ({ id: `c1-m${String(i).padStart(2, "0")}`, sessionId: "c1", role: "ASSISTANT", kind: null, content: mb, toolCalls: null, createdAt: new Date(Date.UTC(2026, 9, 8, 9, 0, i)).toISOString() })),
      { id: "c2-m0", sessionId: "c2", role: "USER", kind: null, content: "small", toolCalls: null, createdAt: "2026-10-08T09:00:00.000Z" },
    ];
    const out = await exported();
    const requests = out.records.teammateRequests as unknown[];
    const chats = out.records.teammateChats as Array<{ id: string; messages: Array<{ id: string }>; messagesLeftOut: number }>;
    // The requests took the budget first: all 30 fit.
    expect(requests).toHaveLength(30);
    expect(out.records.teammateRequestsLeftOut).toBe(0);
    // Before: all 40 one-megabyte messages, and the next chat's too.
    const [c1, c2] = chats;
    expect(c1.messages.length).toBeGreaterThan(0);
    expect(c1.messages.length).toBeLessThan(40);
    expect(c1.messages.length + c1.messagesLeftOut).toBe(40);
    // The newest kept, oldest first, and the next one would not have fit.
    expect(c1.messages[c1.messages.length - 1].id).toBe("c1-m39");
    const used = [...requests, ...c1.messages].reduce<number>((n, r) => n + bytes(r), 0);
    expect(used).toBeLessThanOrEqual(TEAMMATE_EXPORT_BYTE_BUDGET);
    expect(used + bytes(c1.messages[0])).toBeGreaterThan(TEAMMATE_EXPORT_BYTE_BUDGET);
    // Past the budget: listed, nothing read, every message counted as left out.
    expect([c2.id, c2.messages.length, c2.messagesLeftOut]).toEqual(["c2", 0, 1]);
    expect(st.calls.some((c) => c.model === "chatMessage" && c.op === "findMany" && c.args.where?.sessionId === "c2")).toBe(false);

    // Requests past the budget on their own: those after it are left out and counted.
    st.calls = [];
    st.rows.agentAction = Array.from({ length: 60 }, (_, i) => ({ ...(st.rows.agentAction[0] as object), id: `big${String(i).padStart(2, "0")}`, createdAt: new Date(Date.UTC(2026, 9, 2, 0, 0, i)).toISOString() }));
    const again = await exported();
    const kept = (again.records.teammateRequests as unknown[]).length;
    expect(kept).toBeLessThan(60);
    expect(again.records.teammateRequestsLeftOut).toBe(60 - kept);
    expect((again.records.teammateChats as Array<{ messages: unknown[] }>).every((c) => c.messages.length === 0)).toBe(true);
  });

  it("carries the newest 10,000 activity rows and notifications, oldest first, saying how many it left out", async () => {
    const row = (prefix: string, i: number) => ({ id: `${prefix}${String(i).padStart(5, "0")}`, createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() });
    st.rows.activityLog = Array.from({ length: ACTIVITY_EXPORT_MAX + 2 }, (_, i) => row("log", i));
    st.rows.notification = Array.from({ length: NOTIFICATIONS_EXPORT_MAX + 3 }, (_, i) => row("n", i));
    const out = await exported();
    const logs = out.records.activityLogs as Array<{ id: string }>;
    const notes = out.records.notifications as Array<{ id: string }>;
    // Before: every row, however many, and no count of what was left out.
    expect(logs).toHaveLength(ACTIVITY_EXPORT_MAX);
    expect([logs[0].id, logs[logs.length - 1].id]).toEqual(["log00002", `log${ACTIVITY_EXPORT_MAX + 1}`]);
    expect(out.records.activityLogsLeftOut).toBe(2);
    expect(notes).toHaveLength(NOTIFICATIONS_EXPORT_MAX);
    expect([notes[0].id, notes[notes.length - 1].id]).toEqual(["n00003", `n${NOTIFICATIONS_EXPORT_MAX + 2}`]);
    expect(out.records.notificationsLeftOut).toBe(3);
    expect(callOf("activityLog")?.args).toMatchObject({ where: { actorId: "u-max" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ACTIVITY_EXPORT_MAX });
    expect(callOf("notification")?.args).toMatchObject({ where: { userId: "u-max" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: NOTIFICATIONS_EXPORT_MAX });
    st.rows.activityLog = st.rows.activityLog.slice(0, 2);
    st.rows.notification = [];
    const small = await exported();
    expect([small.records.activityLogsLeftOut, small.records.notificationsLeftOut]).toEqual([0, 0]);
  });

  it("runs its reads at most five at a time", async () => {
    await exported();
    // Before: all 25 at once.
    expect(st.maxInFlight).toBe(5);
  });
});
