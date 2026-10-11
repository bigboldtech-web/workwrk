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
  /** Who asks for their export (review round 2 of Phase 4). */
  userId: "u-max",
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: st.userId } } }),
  getUserId: (s: { user: { id: string } }) => s.user.id,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
}));
vi.mock("@/lib/people/review-visibility", () => ({ subjectRowView: (r: unknown) => r }));
vi.mock("@/lib/prisma", async () => {
  // Review round 2 of Phase 4: activity rows are found by the route's own
  // where clause and its select, through the matcher the activity routes'
  // tests use, so a test reads as whose export holds a row.
  const kit = await import("@/lib/access/personal-activity.testkit");
  const time = (r: Record<string, unknown>) => new Date(r.createdAt as string | Date).getTime();
  const activity = (args: Args) => ((st.rows.activityLog ?? []) as Array<Record<string, unknown>>).filter((r) => kit.matches(r as unknown as Row, args.where));
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
        // Activity rows: those the where clause finds, newest first, at most `take`, as selected (review round 2 of Phase 4).
        if (name === "activityLog") {
          const found = page([...activity(args)].sort((a, b) => time(b) - time(a)), args);
          return args.select ? found.map((r) => kit.project(r as unknown as Row, args)) : found;
        }
        // The requests and notifications: newest first, at most `take` (review rounds 4 and 5 of Phase 3).
        if (["agentAction", "notification"].includes(name) && args.take !== undefined) return page([...rows].reverse(), args);
        // Phase 4: the person's browser sessions, by their own id; their steps by session, newest first.
        if (name === "teammateBrowserSession") return rows.filter((r) => r.userId === args.where?.userId);
        if (name === "teammateBrowserStep") {
          const ids = (args.where?.browserSessionId as { in: string[] }).in;
          return rows
            .filter((r) => ids.includes(String(r.browserSessionId)))
            .sort((a, b) => (b.at as Date).getTime() - (a.at as Date).getTime())
            .slice(0, args.take);
        }
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
        if (name === "teammateBrowserStep") return rows.filter((r) => (args.where?.browserSessionId as { in: string[] }).in.includes(String(r.browserSessionId))).length;
        if (name === "activityLog") return activity(args).length;
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
import { WRITER_PART_COPY, exportWrittenAboutOthersWhere, myActivityWhere } from "@/lib/access/personal-activity";
import { ROWS, matches as kitMatches, type Row } from "@/lib/access/personal-activity.testkit";

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
/** Review round 4 of Phase 4: the cap on the rows a person wrote about someone else (route.ts ACTIVITY_ABOUT_OTHERS_EXPORT_MAX). */
const ACTIVITY_ABOUT_OTHERS_EXPORT_MAX = 1_000;

beforeEach(() => {
  st.rows = {};
  st.calls = [];
  st.inFlight = 0;
  st.maxInFlight = 0;
  st.userId = "u-max";
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
/** The activity reads (review round 4 of Phase 4: two lists, each a findMany and a count). */
const activityCalls = (op: "findMany" | "count") => st.calls.filter((c) => c.model === "activityLog" && c.op === op);

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
// AI teammates Phase 4 (the reconciliation note): the person's browser steps,
// as kinds and sites only, within the byte budget and with how many were left out.
describe("GET /api/me/export: the person's browser steps (Phase 4)", () => {
  it("carries their own steps, oldest first, as when, where, kind and outcome only, never anyone else's", async () => {
    st.rows.teammateBrowserSession = [
      { id: "bs-max", userId: "u-max", organizationId: "org1" },
      { id: "bs-lea", userId: "u-lea", organizationId: "org1" },
    ];
    st.rows.teammateBrowserStep = [
      { id: "s1", browserSessionId: "bs-max", kind: "open", site: "docs.proof.test", outcome: "ok", code: null, actionId: null, shotId: "sh1", at: new Date("2026-10-11T10:00:00Z") },
      { id: "s2", browserSessionId: "bs-max", kind: "click", site: "shop.proof.test", outcome: "waiting", code: null, actionId: "a1", shotId: null, at: new Date("2026-10-11T10:01:00Z") },
      { id: "s3", browserSessionId: "bs-lea", kind: "open", site: "lea.proof.test", outcome: "ok", code: null, actionId: null, shotId: null, at: new Date("2026-10-11T10:02:00Z") },
    ];
    const { records } = await exported();
    expect(records.teammateBrowserSteps).toEqual([
      { at: "2026-10-11T10:00:00.000Z", organizationId: "org1", kind: "open", site: "docs.proof.test", outcome: "ok" },
      { at: "2026-10-11T10:01:00.000Z", organizationId: "org1", kind: "click", site: "shop.proof.test", outcome: "waiting" },
    ]);
    expect(records.teammateBrowserStepsLeftOut).toBe(0);
    expect(records.teammateBrowserStepsNote).toMatch(/kind, the site and when/);
    // Read through the person's own sessions of the last 31 days.
    const sessions = callOf("teammateBrowserSession");
    expect(sessions?.args.where).toMatchObject({ userId: "u-max", startedAt: { gte: expect.any(Date) } });
  });

  it("keeps the newest 20,000 and says how many it left out", async () => {
    st.rows.teammateBrowserSession = [{ id: "bs-max", userId: "u-max", organizationId: "org1" }];
    const base = Date.parse("2026-10-11T00:00:00Z");
    st.rows.teammateBrowserStep = Array.from({ length: 20_005 }, (_, i) => ({ id: `s${i}`, browserSessionId: "bs-max", kind: "read", site: "docs.proof.test", outcome: "ok", at: new Date(base + i * 1000) }));
    const { records } = await exported();
    const steps = records.teammateBrowserSteps as Array<{ at: string }>;
    expect(steps).toHaveLength(20_000);
    expect(records.teammateBrowserStepsLeftOut).toBe(5);
    expect(steps[0].at).toBe(new Date(base + 5 * 1000).toISOString());
  });
});

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
    // The person's own rows (review round 2 of Phase 4: the activity double reads the route's where clause).
    const own = { type: "task.created", actorId: "u-max", actingForId: null, targetType: null, targetId: null };
    st.rows.activityLog = Array.from({ length: ACTIVITY_EXPORT_MAX + 2 }, (_, i) => ({ ...row("log", i), ...own }));
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
    expect(callOf("activityLog")?.args).toMatchObject({ where: myActivityWhere("u-max"), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ACTIVITY_EXPORT_MAX });
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

// Review round 2 of Phase 4: the export read every activity row the person
// was the actor of, whole. Mia, a manager, ended her report Max's browser
// (the row's actor is Mia, it acts for Max, and its metadata names every
// site his teammate used): her export held it, and his own did not.
describe("GET /api/me/export: activity rows are the person's own (review round 2 of Phase 4)", () => {
  const ids = (out: { records: Record<string, unknown> }) => (out.records.activityLogs as Array<{ id: string }>).map((r) => r.id);
  const othersIds = (out: { records: Record<string, unknown> }) => (out.records.activityAboutOthers as Array<{ id: string }>).map((r) => r.id);

  it("keeps the sites of a personal teammate row Mia wrote about Max out of her export, and keeps her own rows", async () => {
    st.rows.activityLog = ROWS;
    st.userId = "mia";
    const res = await GET();
    const text = await res.text();
    const out = JSON.parse(text) as { records: Record<string, unknown> };
    // Before round 2: "ended-max-by-mia" was in Mia's activityLogs whole, with Max's sites.
    // Since review round 4 her part of it is in her second list (see below), never in activityLogs.
    expect(ids(out)).toEqual(["task-mia"]);
    expect(othersIds(out)).toEqual(["ended-max-by-mia"]);
    for (const site of ["jobs.competitor.example", "bank.example.com", "clinic.example.org"]) expect(text).not.toContain(site);
    expect(out.records.activityLogsLeftOut).toBe(0);
    // Ada, the Admin who disconnected Max's Google: her switch row in activityLogs, her part of his connection's end in the second list.
    st.userId = "ada";
    const ada = await exported();
    expect([ids(ada), othersIds(ada)]).toEqual([["switch-ada"], ["google-off-max"]]);
  });

  it("gives Max the personal rows about him that someone else wrote, with their sites, in every workspace, and the writer's IP address and user agent never", async () => {
    st.rows.activityLog = ROWS;
    st.userId = "max";
    const out = await exported();
    const logs = out.records.activityLogs as Array<Record<string, unknown>>;
    // Before: only the rows Max wrote, so neither Mia's end of his browser, the system's, nor Ada's disconnect of his Google.
    expect(ids(out)).toEqual(["other-org", "google-on-max", "google-off-max", "mail-max", "ended-max-by-mia", "ended-max", "takeover-max", "click-max", "task-max"]);
    expect(ids(out)).not.toContain("click-ann");
    const byMia = logs.find((r) => r.id === "ended-max-by-mia");
    expect(byMia).toMatchObject({ type: "teammate_browser.session_ended", actorId: "mia", actingForId: "max", metadata: { sites: [{ site: "jobs.competitor.example", reads: 1, acts: 0 }] } });
    // The IP address and user agent of a row someone else wrote are theirs: left out. Max's own keep his.
    expect([byMia?.ipAddress, byMia?.userAgent]).toEqual([null, null]);
    expect(logs.find((r) => r.id === "google-off-max")).toMatchObject({ actorId: "ada", ipAddress: null, userAgent: null });
    expect(logs.find((r) => r.id === "ended-max")).toMatchObject({ actorId: null, ipAddress: null, userAgent: null, metadata: { sites: [{ site: "bank.example.com", reads: 3, acts: 1 }, { site: "clinic.example.org", reads: 2, acts: 0 }] } });
    expect(logs.find((r) => r.id === "task-max")).toMatchObject({ ipAddress: "10.1.2.3", userAgent: "Mozilla/5.0 (secret agent)", metadata: { title: "Call Acme", internal: "kept out" } });
    // The count asks the same rows: none left out.
    expect(out.records.activityLogsLeftOut).toBe(0);
    expect(activityCalls("count")[0]?.args.where).toEqual(myActivityWhere("max"));
    // No workspace in either list's where clause: the export covers every one (other-org above).
    for (const c of [...activityCalls("findMany"), ...activityCalls("count")]) expect(JSON.stringify(c.args.where)).not.toContain("organizationId");
  });

  it("names its columns: every column of a row, nothing more, in both lists", async () => {
    await exported();
    const reads = activityCalls("findMany");
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      expect(Object.keys(read.args.select ?? {}).sort()).toEqual([
        "actingForId", "actorId", "actorLabel", "actorType", "createdAt", "description", "id", "ipAddress", "metadata", "newValue", "oldValue", "organizationId", "severity", "targetId", "targetType", "type", "userAgent",
      ]);
    }
  });
});

// Review round 3 of Phase 4: round 2 read the export by Just me's where
// clause, so it left out every personal teammate row a person wrote about
// someone else's teammate work: an Admin's Disconnect everyone (a row a
// person, each naming that person), a manager's removal that ended a
// report's browser. Those are the writer's own acts, so the Article 15
// answer was incomplete. They are in the writer's export, trimmed to the
// writer's part; since review round 4, in a list of their own,
// activityAboutOthers.
describe("GET /api/me/export: the rows a person wrote about someone else's teammate work (review round 3 of Phase 4)", () => {
  const ids = (out: { records: Record<string, unknown> }) => (out.records.activityLogs as Array<{ id: string }>).map((r) => r.id);
  const othersOf = (out: { records: Record<string, unknown> }) => out.records.activityAboutOthers as Array<Record<string, unknown>>;
  /** Every column the export names (ACTIVITY_EXPORT_SELECT), so a trimmed row keeps the shape of a whole one. */
  const COLUMNS = ["actingForId", "actorId", "actorLabel", "actorType", "createdAt", "description", "id", "ipAddress", "metadata", "newValue", "oldValue", "organizationId", "severity", "targetId", "targetType", "type", "userAgent"];

  it("gives Mia her end of Max's browser in activityAboutOthers: her part, with no site and no Max id", async () => {
    st.rows.activityLog = ROWS;
    st.userId = "mia";
    const res = await GET();
    const text = await res.text();
    const out = JSON.parse(text) as { records: Record<string, unknown> };
    // Before round 3: only "task-mia"; her end of Max's browser was nowhere in her export. Round 3 put it in activityLogs.
    expect(ids(out)).toEqual(["task-mia"]);
    expect(othersOf(out)).toEqual([
      {
        id: "ended-max-by-mia",
        organizationId: "org",
        type: "teammate_browser.session_ended",
        createdAt: ROWS.find((r) => r.id === "ended-max-by-mia")?.createdAt.toISOString(),
        actorId: "mia",
        actorType: null,
        actorLabel: null,
        severity: "info",
        // Hers: she wrote it.
        ipAddress: "10.1.2.3",
        userAgent: "Mozilla/5.0 (secret agent)",
        description: WRITER_PART_COPY.sessionEnded,
        actingForId: null,
        targetType: null,
        targetId: null,
        metadata: null,
        oldValue: null,
        newValue: null,
      },
    ]);
    expect(Object.keys(othersOf(out)[0]).sort()).toEqual(COLUMNS);
    // No site, no id of Max's, his teammate's or his session, no name.
    for (const word of ["jobs.competitor.example", "bank.example.com", "clinic.example.org", '"max"', '"a1"', "Max", "Smith", "Chief of Staff", "1 minute"]) expect(text).not.toContain(word);
    // Counted by its own read.
    expect([out.records.activityLogsLeftOut, out.records.activityAboutOthersLeftOut]).toEqual([0, 0]);
    expect(activityCalls("count")[1]?.args.where).toEqual(exportWrittenAboutOthersWhere("mia"));
  });

  it("gives Ada her disconnect of Max's Google in activityAboutOthers with no target, and her own switch row whole in activityLogs", async () => {
    st.rows.activityLog = ROWS;
    st.userId = "ada";
    const res = await GET();
    const text = await res.text();
    const out = JSON.parse(text) as { records: Record<string, unknown> };
    // Before round 3: only her switch row.
    expect(ids(out)).toEqual(["switch-ada"]);
    const [mine, ...more] = othersOf(out);
    expect(more).toEqual([]);
    expect(mine).toMatchObject({
      id: "google-off-max",
      type: "teammate_connection.disconnected",
      actorId: "ada",
      description: WRITER_PART_COPY.disconnected,
      targetType: null,
      targetId: null,
      actingForId: null,
      metadata: null,
      ipAddress: "10.1.2.3",
      userAgent: "Mozilla/5.0 (secret agent)",
    });
    expect(Object.keys(mine).sort()).toEqual(COLUMNS);
    // Not Max's id, nor the connection's facts (provider, reason, connection id).
    for (const word of ['"max"', "Max", '"admin"', '"google"', '"provider"', '"reason"']) expect(text).not.toContain(word);
    // Her own switch row stays whole.
    expect((out.records.activityLogs as Array<Record<string, unknown>>).find((r) => r.id === "switch-ada")).toMatchObject({ description: "Turned on the computer for AI teammates", metadata: { enabled: true } });
  });

  it("leaves Max's export as it was: every row about him whole, nothing he wrote about anyone else", async () => {
    st.rows.activityLog = ROWS;
    st.userId = "max";
    const out = await exported();
    expect(ids(out)).toEqual(["other-org", "google-on-max", "google-off-max", "mail-max", "ended-max-by-mia", "ended-max", "takeover-max", "click-max", "task-max"]);
    // The same rows Just me's where clause finds, none of them trimmed.
    expect(ids(out).sort()).toEqual(ROWS.filter((r) => kitMatches(r, myActivityWhere("max"))).map((r) => r.id).sort());
    for (const r of out.records.activityLogs as Array<Record<string, unknown>>) expect(Object.values(WRITER_PART_COPY)).not.toContain(r.description);
    expect((out.records.activityLogs as Array<Record<string, unknown>>).find((r) => r.id === "ended-max-by-mia")).toMatchObject({ actingForId: "max", targetId: "a1", metadata: { sites: [{ site: "jobs.competitor.example", reads: 1, acts: 0 }] } });
    expect([othersOf(out), out.records.activityAboutOthersLeftOut]).toEqual([[], 0]);
  });
});

// Review round 4 of Phase 4: round 3 read the rows a person wrote about
// someone else in the same list as their own, under one cap of the newest
// 10,000. Ada, an Admin, pressed Turn off and disconnect everyone in a
// workspace of about 10,000 Google connections: one
// teammate_connection.disconnected row a connection, actor Ada, about
// someone else. Her export the next day held about 10,000 identical trimmed
// lines and none of her own records, which were only counted in
// activityLogsLeftOut. The export has no paging, so she could not reach
// them. Now activityLogs reads her own rows alone, and the rows about others
// are activityAboutOthers, with their own cap and count.
describe("GET /api/me/export: the rows about others are a list of their own (review round 4 of Phase 4)", () => {
  const BASE = Date.UTC(2026, 9, 1);
  const at = (s: number) => new Date(BASE + s * 1000).toISOString();
  /** One row of Ada's Disconnect everyone: actor Ada, about another person's Google. */
  const disconnect = (i: number) => ({
    id: `off${String(i).padStart(5, "0")}`, organizationId: "org", type: "teammate_connection.disconnected", description: `Disconnected Google for person ${i}`, actorId: "ada", actorType: "user", actorLabel: null,
    actingForId: null, targetType: "user", targetId: `person${i}`, metadata: { provider: "google", reason: "admin", connectionId: `conn${i}` }, ipAddress: "10.9.9.9", userAgent: "Ada's browser",
    severity: "info", oldValue: null, newValue: null, createdAt: at(1_000 + i),
  });
  /** Ada's own rows, all older than every disconnect. */
  const own = [
    { id: "ada-task", organizationId: "org", type: "task.created", description: 'Created task "Budget"', actorId: "ada", actorType: "user", actorLabel: null, actingForId: null, targetType: "task", targetId: "t9", metadata: { title: "Budget" }, ipAddress: "10.9.9.9", userAgent: "Ada's browser", severity: "info", oldValue: null, newValue: null, createdAt: at(1) },
    { id: "ada-switch", organizationId: "org", type: "teammate_connectors.disconnect_all_started", description: "Started disconnecting everyone's Google", actorId: "ada", actorType: "user", actorLabel: null, actingForId: null, targetType: null, targetId: null, metadata: { count: 10_005 }, ipAddress: "10.9.9.9", userAgent: "Ada's browser", severity: "warning", oldValue: null, newValue: null, createdAt: at(2) },
    { id: "ada-google", organizationId: "org", type: "teammate_connection.disconnected", description: "Disconnected Google", actorId: "ada", actorType: "user", actorLabel: null, actingForId: null, targetType: "user", targetId: "ada", metadata: { provider: "google", reason: "admin" }, ipAddress: "10.9.9.9", userAgent: "Ada's browser", severity: "info", oldValue: null, newValue: null, createdAt: at(3) },
  ];
  const DISCONNECTS = 10_005;

  it("keeps Ada's own rows in activityLogs after a Disconnect everyone of 10,005 newer rows, and gives the newest 1,000 of those trimmed in activityAboutOthers", async () => {
    st.rows.activityLog = [...own, ...Array.from({ length: DISCONNECTS }, (_, i) => disconnect(i))];
    st.userId = "ada";
    const res = await GET();
    const text = await res.text();
    const out = JSON.parse(text) as { records: Record<string, unknown> };
    const logs = out.records.activityLogs as Array<Record<string, unknown>>;
    const others = out.records.activityAboutOthers as Array<Record<string, unknown>>;
    // Before: activityLogs held the newest 10,000 disconnects, trimmed, and none of these, which were only counted as left out.
    expect(logs.map((r) => r.id)).toEqual(["ada-task", "ada-switch", "ada-google"]);
    expect(out.records.activityLogsLeftOut).toBe(0);
    // Her own rows whole, her own Google's row too.
    expect(logs[0]).toMatchObject({ description: 'Created task "Budget"', metadata: { title: "Budget" }, ipAddress: "10.9.9.9" });
    expect(logs[2]).toMatchObject({ description: "Disconnected Google", targetType: "user", targetId: "ada", metadata: { provider: "google", reason: "admin" } });
    // The rows about others: the newest 1,000, oldest first, each the writer's part, and how many were left out.
    expect(others).toHaveLength(ACTIVITY_ABOUT_OTHERS_EXPORT_MAX);
    expect([others[0].id, others[others.length - 1].id]).toEqual([disconnect(DISCONNECTS - ACTIVITY_ABOUT_OTHERS_EXPORT_MAX).id, disconnect(DISCONNECTS - 1).id]);
    expect([others[0].id, others[others.length - 1].id]).toEqual(["off09005", "off10004"]);
    expect(out.records.activityAboutOthersLeftOut).toBe(DISCONNECTS - ACTIVITY_ABOUT_OTHERS_EXPORT_MAX);
    for (const r of others) {
      expect(r).toMatchObject({ type: "teammate_connection.disconnected", actorId: "ada", description: WRITER_PART_COPY.disconnected, actingForId: null, targetType: null, targetId: null, metadata: null, oldValue: null, newValue: null, ipAddress: "10.9.9.9", userAgent: "Ada's browser" });
    }
    // No one else's id, connection or name (her own Google's row keeps its own facts, whole).
    for (const word of ['"person', '"conn', "for person"]) expect(text).not.toContain(word);
    expect(out.records.activityAboutOthersNote).toMatch(/^Records of your actions on other people's AI teammate work/);
    // Each list by its own where clause, cap and count.
    expect(activityCalls("findMany").map((c) => c.args)).toEqual([
      expect.objectContaining({ where: myActivityWhere("ada"), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ACTIVITY_EXPORT_MAX }),
      expect.objectContaining({ where: exportWrittenAboutOthersWhere("ada"), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ACTIVITY_ABOUT_OTHERS_EXPORT_MAX }),
    ]);
    expect(activityCalls("count").map((c) => c.args.where)).toEqual([myActivityWhere("ada"), exportWrittenAboutOthersWhere("ada")]);
  });

  it("counts each list's left-out rows by its own read: Mia's 10,000 rows of her own and 3 ends of reports' browsers", async () => {
    // Mia ended 3 reports' browsers, then wrote ACTIVITY_EXPORT_MAX + 2 rows of her own after.
    const ended = Array.from({ length: 3 }, (_, i) => ({ id: `end${i}`, type: "teammate_browser.session_ended", actorId: "mia", actingForId: `report${i}`, targetType: "agent", targetId: "a1", createdAt: at(i) }));
    const mine = Array.from({ length: ACTIVITY_EXPORT_MAX + 2 }, (_, i) => ({ id: `own${String(i).padStart(5, "0")}`, type: "task.created", actorId: "mia", actingForId: null, targetType: null, targetId: null, createdAt: at(10 + i) }));
    st.rows.activityLog = [...ended, ...mine];
    st.userId = "mia";
    const out = await exported();
    // Before (round 3): the 3 shared her cap and were left out of it with her 2 oldest, so activityLogsLeftOut read 5 and they were nowhere.
    expect((out.records.activityLogs as Array<{ id: string }>).map((r) => r.id).slice(0, 1)).toEqual(["own00002"]);
    expect((out.records.activityLogs as unknown[]).length).toBe(ACTIVITY_EXPORT_MAX);
    expect(out.records.activityLogsLeftOut).toBe(2);
    expect((out.records.activityAboutOthers as Array<{ id: string; description: string }>).map((r) => [r.id, r.description])).toEqual([
      ["end0", WRITER_PART_COPY.sessionEnded],
      ["end1", WRITER_PART_COPY.sessionEnded],
      ["end2", WRITER_PART_COPY.sessionEnded],
    ]);
    expect(out.records.activityAboutOthersLeftOut).toBe(0);
  });

  it("says what the second list holds and leaves out, in plain words", async () => {
    const out = await exported();
    expect([out.records.activityAboutOthers, out.records.activityAboutOthersLeftOut]).toEqual([[], 0]);
    const note = out.records.activityAboutOthersNote as string;
    expect(note).toBe(
      "Records of your actions on other people's AI teammate work, such as closing their teammate's browser or disconnecting their Google: the kind of action, when, and your own IP address and browser. Whom each was about and its details, such as the sites a browser used, are left out, since those are the other person's.",
    );
    expect(note).not.toMatch(/--|\u2014|\u2013/);
  });
});
