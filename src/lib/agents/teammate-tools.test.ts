// The AI teammate tools (src/lib/agents/teammate-tools.ts) act as the person
// through the person's own write paths, and no further: only with a teammate
// context, a task change and a comment through patchItemAs and
// postItemCommentAs, a Talk post at most once per approval with no pings and
// no hidden links, a Talk read of only the conversations the person is in,
// and the tool set a teammate is given. The write paths and the database are
// mocked; what is asserted is what the tools send them.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOf, legacyLevelRow } from "@/lib/access/test-fixtures";

const h = vi.hoisted(() => ({
  person: null as null | Record<string, unknown>,
  personCalls: 0,
  gate: null as null | Record<string, unknown> | number,
  patchCalls: [] as Array<{ c: unknown; id: string; body: Record<string, unknown> }>,
  patchAnswer: { status: 200, body: {} as Record<string, unknown> },
  commentCalls: [] as Array<{ id: string; body: Record<string, unknown> }>,
  commentAnswer: { status: 201, body: { update: { id: "u1" } } as Record<string, unknown> },
  talkOn: true,
  conversation: { id: "c-general", type: "CHANNEL", name: "general", restricted: false, archivedAt: null as Date | null, role: "edit" },
  firstPosts: [] as Array<{ id: string } | null>,
  inserts: [] as Array<Record<string, unknown>>,
  insertAnswer: null as null | Record<string, unknown>,
  afterSent: [] as Array<Record<string, unknown>>,
  memberships: [] as Array<{ lastReadAt: Date; conversation: { id: string; type: string; name: string | null; lastMessageAt: Date } }>,
  membershipWhere: null as null | Record<string, unknown>,
  messages: {} as Record<string, Array<Record<string, unknown>>>,
  messageWheres: [] as Array<Record<string, unknown>>,
  cursorWrites: 0,
  notifications: [] as Array<Record<string, unknown>>,
  notificationWhere: null as null | Record<string, unknown>,
  readable: {} as Record<string, boolean>,
}));

// The person and their legacy gates, as acting.ts hands them over: the
// item context carries the person's level exactly as the fixture holds it.
vi.mock("./acting", () => ({
  actingPersonFor: async () => {
    h.personCalls += 1;
    return h.person;
  },
  itemCtxFor: (p: { userId: string; organizationId: string; name: string; accessLevel?: string }) => ({ userId: p.userId, organizationId: p.organizationId, userName: p.name, ...legacyLevelRow(legacyLevelOf({ user: p })) }),
  canReadListAs: async () => true,
  canContributeAs: async () => true,
  nodeCtxOf: () => ({}),
  docSaveCtxOf: (p: { userId: string; organizationId: string }) => ({ userId: p.userId, orgId: p.organizationId }),
  readableTargetsFor: async (_p: unknown, targets: Array<{ kind: string; id: string | null }>) => {
    const m = new Map<string, { readable: boolean; reason: string | null }>();
    for (const t of targets) {
      const key = `${t.kind}:${t.id ?? ""}`;
      if (key in h.readable) m.set(key, { readable: h.readable[key], reason: h.readable[key] ? null : "no_access" });
    }
    return m;
  },
}));
vi.mock("@/lib/item-gate", () => ({
  gateItem: async () => {
    if (h.gate === null) return { error: new Response(null, { status: 404 }) };
    if (typeof h.gate === "number") return { error: new Response(null, { status: h.gate }) };
    return h.gate;
  },
}));
vi.mock("@/lib/items/item-patch", () => ({
  patchItemAs: async (c: unknown, id: string, body: Record<string, unknown>) => {
    h.patchCalls.push({ c, id, body });
    return new Response(JSON.stringify(h.patchAnswer.body), { status: h.patchAnswer.status });
  },
}));
vi.mock("@/lib/items/item-comment", () => ({
  postItemCommentAs: async (_c: unknown, id: string, body: Record<string, unknown>) => {
    h.commentCalls.push({ id, body });
    return new Response(JSON.stringify(h.commentAnswer.body), { status: h.commentAnswer.status });
  },
}));
vi.mock("@/lib/talk-gate", () => ({
  talkGateForUser: async (userId: string, organizationId: string) =>
    h.talkOn ? { ok: true, gate: { userId, organizationId, orgRole: "MEMBER", ...legacyLevelRow("EMPLOYEE") } } : { ok: false, reason: "talk_off" },
  loadConversationRole: async (id: string) => {
    const c = h.conversation;
    if (id !== c.id) return null;
    return { conversation: { id, type: c.type, name: c.name, restricted: c.restricted, archivedAt: c.archivedAt, createdById: "x", findable: true, topic: null, createdAt: new Date(), callEpoch: 0 }, role: c.role, membershipId: "mem-1" };
  },
}));
vi.mock("@/lib/talk-post", () => ({
  insertConversationMessage: async (a: Record<string, unknown>) => {
    h.inserts.push(a);
    return h.insertAnswer ?? { ok: true, message: { id: "m-new", author: { firstName: "Priya", lastName: "Shah" } } };
  },
  afterMessageSent: async (a: Record<string, unknown>) => {
    h.afterSent.push(a);
  },
}));
vi.mock("@/lib/notification-readability", () => ({
  targetKey: (t: { kind: string; id: string | null }) => `${t.kind}:${t.id ?? ""}`,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: async (a: { where: { email?: { equals: string } } }) =>
        a.where.email?.equals?.toLowerCase() === "max@x.com" ? { id: "max", firstName: "Max", lastName: "Chen", email: "max@x.com" } : null,
    },
    board: { findUnique: async () => ({ productSlug: null }) },
    conversation: { findMany: async () => [{ id: "c-general" }], findFirst: async () => null },
    conversationMember: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        h.membershipWhere = a.where;
        return h.memberships;
      },
      findFirst: async () => null,
      count: async () => 3,
      update: async () => { h.cursorWrites += 1; },
      updateMany: async () => { h.cursorWrites += 1; },
    },
    conversationMessage: {
      findFirst: async () => h.firstPosts.shift() ?? null,
      findMany: async (a: { where: { conversationId: string } & Record<string, unknown>; take: number }) => {
        h.messageWheres.push(a.where);
        return (h.messages[a.where.conversationId] ?? []).slice(0, a.take);
      },
    },
    notification: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        h.notificationWhere = a.where;
        return h.notifications;
      },
    },
  },
}));

import { TEAMMATE_TOOLS, teammateToolNames } from "./teammate-tools";
import { CROSS_TOOL_NAMES } from "./tool-names";
import type { ToolContext } from "./tools";

const PERSON = { userId: "me", organizationId: "org", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", name: "Priya Shah", firstName: "Priya", email: "priya@x.com", timezone: "Asia/Kolkata" };

const ctx = (o: Partial<NonNullable<ToolContext["teammate"]>> = {}): ToolContext => ({
  orgId: "org",
  userId: "me",
  teammate: { agentId: "a1", agentName: "Chief of Staff", sessionId: "s1", routineId: null, trigger: "CHAT", timezone: "Asia/Kolkata", ...o },
});

function gateFor(o: { status?: string; statuses?: unknown } = {}) {
  return {
    item: { id: "t1", title: "Call Acme", status: o.status ?? "TO_DO", boardId: "b1", ownerId: "me", assigneeIds: ["me"], metadata: {}, board: { id: "b1", name: "Team", ownerId: "olivia", statuses: o.statuses ?? null } },
    watcherIds: [],
  };
}

beforeEach(() => {
  h.person = { ...PERSON };
  h.personCalls = 0;
  h.gate = gateFor();
  h.patchCalls = [];
  h.patchAnswer = { status: 200, body: { item: { id: "t1", title: "Call Acme", status: "IN_PROGRESS", dueAt: null, priority: null, ownerId: "me" } } };
  h.commentCalls = [];
  h.commentAnswer = { status: 201, body: { update: { id: "u1" } } };
  h.talkOn = true;
  h.conversation = { id: "c-general", type: "CHANNEL", name: "general", restricted: false, archivedAt: null, role: "edit" };
  h.firstPosts = [];
  h.inserts = [];
  h.insertAnswer = null;
  h.afterSent = [];
  h.memberships = [];
  h.membershipWhere = null;
  h.messages = {};
  h.messageWheres = [];
  h.cursorWrites = 0;
  h.notifications = [];
  h.notificationWhere = null;
  h.readable = {};
});

describe("only a teammate", () => {
  it("every teammate tool refuses the Ask AI and legacy loops (no ctx.teammate) before it reads anything", async () => {
    for (const [name, tool] of Object.entries(TEAMMATE_TOOLS)) {
      expect(await tool.handler({ orgId: "org", userId: "me" }, { taskId: "t1", text: "x", key: "k", value: "v" }), name).toEqual({ error: "Only an AI teammate can use this tool." });
    }
    expect(h.personCalls).toBe(0);
    expect(h.patchCalls).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses when the person may not be acted for now", async () => {
    h.person = null;
    expect(await TEAMMATE_TOOLS.update_task.handler(ctx(), { taskId: "t1", done: true })).toEqual({ error: "The person this teammate works for can't do that in this workspace now." });
    expect(h.patchCalls).toHaveLength(0);
  });
});

describe("update_task", () => {
  it("matches a status name without case and sends the List's value through patchItemAs, as the person", async () => {
    const r = await TEAMMATE_TOOLS.update_task.handler(ctx(), { taskId: "t1", status: "in progress" });
    expect(h.patchCalls).toHaveLength(1);
    expect(h.patchCalls[0]).toMatchObject({ c: { userId: "me", organizationId: "org", userName: "Priya Shah" }, id: "t1", body: { status: "IN_PROGRESS" } });
    expect(Object.keys(h.patchCalls[0].body)).toEqual(["status"]);
    expect(legacyLevelOf({ user: h.patchCalls[0].c as { accessLevel?: string } })).toBe("EMPLOYEE");
    expect(r).toEqual({ ok: true, task: { id: "t1", title: "Call Acme", status: "IN_PROGRESS", dueAt: null, priority: null, ownerId: "me" } });
  });

  it("refuses a status the List does not have, naming the ones it has, and writes nothing", async () => {
    expect(await TEAMMATE_TOOLS.update_task.handler(ctx(), { taskId: "t1", status: "Shipped" })).toEqual({
      error: "That isn't a status in this List. Its statuses are: To Do, In Progress, Done.",
    });
    expect(h.patchCalls).toHaveLength(0);
  });

  it("marks done with the List's first Done status, a due day as midnight where the person is, and an owner by email", async () => {
    h.gate = gateFor({ statuses: [
      { value: "OPEN", label: "Open", color: "#000", group: "ACTIVE" },
      { value: "CANCELLED", label: "Cancelled", color: "#000", group: "CLOSED" },
      { value: "SHIPPED", label: "Shipped", color: "#000", group: "DONE" },
    ] });
    await TEAMMATE_TOOLS.update_task.handler(ctx(), { taskId: "t1", done: true, dueDate: "2026-10-12", assigneeEmail: "MAX@x.com", priority: "high" });
    expect(h.patchCalls[0].body).toEqual({ status: "SHIPPED", dueAt: "2026-10-11T18:30:00.000Z", ownerId: "max", priority: "HIGH" });
  });

  it("answers the route's refusals in the person's words", async () => {
    h.patchAnswer = { status: 403, body: { error: "no_access", reason: "role_too_low" } };
    expect(await TEAMMATE_TOOLS.update_task.handler(ctx(), { taskId: "t1", done: true })).toEqual({ error: "You can't change this task." });
    h.patchAnswer = { status: 409, body: { error: "invalid_status", homeStatuses: [{ label: "Backlog" }, { label: "Live" }] } };
    expect(await TEAMMATE_TOOLS.update_task.handler(ctx(), { taskId: "t1", status: "to do" })).toEqual({ error: "That isn't a status in this List. Its statuses are: Backlog, Live." });
    h.gate = null;
    expect(await TEAMMATE_TOOLS.update_task.handler(ctx(), { taskId: "t1", done: true })).toEqual({ error: "I can't find that task." });
    expect(await TEAMMATE_TOOLS.update_task.handler(ctx(), { taskId: "t1" })).toEqual({ error: "I can't find that task." });
  });

  it("asks for something to change", async () => {
    expect(await TEAMMATE_TOOLS.update_task.handler(ctx(), { taskId: "t1" })).toEqual({ error: "Say what to change: the status, the due date, the priority or the owner." });
    expect(await TEAMMATE_TOOLS.update_task.handler(ctx(), { taskId: "t1", dueDate: "2026-02-30" })).toEqual({ error: "A due date is a day written like 2026-10-12, or none." });
  });
});

describe("comment_on_task", () => {
  it("posts the person's comment with links reduced to their words and no mention ids or attachments", async () => {
    const r = await TEAMMATE_TOOLS.comment_on_task.handler(ctx(), { taskId: "t1", text: "See [the brief](https://evil.example/x) please" });
    expect(h.commentCalls).toEqual([{ id: "t1", body: { body: "See the brief please" } }]);
    expect(r).toEqual({ ok: true, task: { id: "t1", title: "Call Acme" }, comment: { id: "u1" } });
  });

  it("refuses where the person cannot comment, without posting", async () => {
    h.gate = 403;
    expect(await TEAMMATE_TOOLS.comment_on_task.handler(ctx(), { taskId: "t1", text: "Hi" })).toEqual({ error: "You can't comment on this task." });
    expect(h.commentCalls).toHaveLength(0);
  });
});

describe("post_in_talk", () => {
  const post = (text = "Hi") => TEAMMATE_TOOLS.post_in_talk.handler(ctx({ trigger: "APPROVAL", actionId: "act1" }), { channel: "#general", text });

  it("posts once, as the person, with no @ pings and links reduced to their words", async () => {
    const r = await post("Read [this](https://evil.example/steal) now @Max and @all");
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      conversationId: "c-general",
      authorId: "me",
      membershipId: null,
      body: "Read this now Max and all",
      parentId: null,
      metadata: { kind: "agent_post", agent: { id: "a1", name: "Chief of Staff" }, actionId: "act1" },
      clientId: "ag_act1",
    });
    expect(String(h.inserts[0].body)).not.toMatch(/@|\]\(/);
    expect(h.afterSent).toHaveLength(1);
    expect(h.afterSent[0]).toMatchObject({ mentions: [], isCallCard: false, parentId: null, text: "Read this now Max and all", authorId: "me" });
    expect(r).toEqual({ ok: true, message: { id: "m-new", conversationId: "c-general" }, conversation: { name: "#general", type: "CHANNEL" } });
  });

  it("answers a repeated clientId with the first post and never posts or rings a second time", async () => {
    h.firstPosts = [{ id: "m-first" }];
    expect(await post()).toEqual({ ok: true, message: { id: "m-first", conversationId: "c-general" }, conversation: { name: "#general", type: "CHANNEL" }, duplicate: true });
    expect(h.inserts).toHaveLength(0);
    expect(h.afterSent).toHaveLength(0);
  });

  it("answers the same when two runs with one key race and the second insert loses (P2002)", async () => {
    h.firstPosts = [null, { id: "m-first" }];
    h.insertAnswer = { ok: false, duplicate: true, error: Object.assign(new Error("unique"), { code: "P2002" }) };
    expect(await post()).toMatchObject({ ok: true, message: { id: "m-first" }, duplicate: true });
    expect(h.afterSent).toHaveLength(0);
  });

  it("runs only from its approval record", async () => {
    expect(await TEAMMATE_TOOLS.post_in_talk.handler(ctx(), { channel: "#general", text: "Hi" })).toEqual({ error: "A post in Talk runs only from its approval." });
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses an archived conversation, a conversation the person is not in, and Talk switched off", async () => {
    h.conversation.archivedAt = new Date();
    expect(await post()).toEqual({ error: "You can't post in #general." });
    h.conversation.archivedAt = null;
    h.conversation.role = "none";
    expect(await post()).toEqual({ error: "There's no channel or group called general that you're in." });
    h.talkOn = false;
    expect(await post()).toEqual({ error: "Talk is off in this workspace." });
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses text that is nothing once cleaned", async () => {
    expect(await post("[](https://evil.example)")).toEqual({ error: "There's nothing left to send once links and @ signs are taken out." });
    expect(h.inserts).toHaveLength(0);
  });
});

describe("read_talk", () => {
  const OLD = new Date("2026-10-06T08:00:00Z");
  const NEW = new Date("2026-10-06T09:00:00Z");

  it("reads only conversations the person is in, never moves a read cursor, and drops AI updates hidden from them", async () => {
    h.memberships = [
      { lastReadAt: OLD, conversation: { id: "c1", type: "CHANNEL", name: "general", lastMessageAt: NEW } },
      { lastReadAt: NEW, conversation: { id: "c2", type: "GROUP", name: "Design", lastMessageAt: NEW } },
    ];
    h.messages = {
      c1: [
        { id: "x1", body: "**Ship** it today", metadata: null, createdAt: NEW, author: { firstName: "Max", lastName: "Chen", email: "max@x.com" } },
        { id: "x2", body: "Secret standup", metadata: { kind: "ai_update", update: { readers: ["olivia"] } }, createdAt: NEW, author: { firstName: "Olivia", lastName: "R", email: "o@x.com" } },
      ],
      elsewhere: [{ id: "x9", body: "not yours", metadata: null, createdAt: NEW, author: { firstName: "Z", lastName: "Z", email: "z@x.com" } }],
    };
    const r = await TEAMMATE_TOOLS.read_talk.handler(ctx(), {});
    expect(h.membershipWhere).toMatchObject({ userId: "me", conversation: { organizationId: "org" } });
    // c2 has nothing unread, so only c1 is read; "elsewhere" is never asked for.
    expect(h.messageWheres.map((w) => w.conversationId)).toEqual(["c1"]);
    expect(h.messageWheres[0]).toMatchObject({ deletedAt: null, createdAt: { gt: OLD }, authorId: { not: "me" } });
    expect(r).toEqual({ count: 1, conversations: [{ id: "c1", name: "#general", type: "CHANNEL", messages: [{ from: "Max", text: "Ship it today", at: NEW.toISOString() }] }] });
    expect(h.cursorWrites).toBe(0);
  });

  it("names a conversation the person is not in as not found", async () => {
    h.memberships = [{ lastReadAt: OLD, conversation: { id: "c1", type: "CHANNEL", name: "general", lastMessageAt: NEW } }];
    expect(await TEAMMATE_TOOLS.read_talk.handler(ctx(), { conversation: "#board-only" })).toEqual({ error: "There's no channel or group called #board-only that you're in." });
    expect(h.messageWheres).toHaveLength(0);
  });

  it("answers Talk switched off", async () => {
    h.talkOn = false;
    expect(await TEAMMATE_TOOLS.read_talk.handler(ctx(), {})).toEqual({ error: "Talk is off in this workspace." });
  });
});

describe("list_my_inbox", () => {
  it("keeps only notifications about what the person can open in this workspace, and never a teammate's own", async () => {
    const at = new Date("2026-10-06T09:00:00Z");
    h.notifications = [
      { id: "n1", title: "Call Acme", message: "Assigned to you", type: "task_assigned", read: false, link: "/item/a", createdAt: at },
      { id: "n2", title: "Hidden", message: "x", type: "task_assigned", read: false, link: "/item/b", createdAt: at },
      { id: "n3", title: "A chat elsewhere", message: "x", type: "chat_message", read: false, link: "/tlk/c9", createdAt: at },
    ];
    h.readable = { "item:a": true, "item:b": false };
    const r = await TEAMMATE_TOOLS.list_my_inbox.handler(ctx(), {});
    expect(h.notificationWhere).toMatchObject({ userId: "me", clearedAt: null, read: false, NOT: { type: { startsWith: "agent_" } } });
    expect(r).toEqual({ count: 1, notifications: [{ kind: "Assigned to you", title: "Call Acme", message: "Assigned to you", at: at.toISOString(), read: false }] });
  });
});

describe("teammateToolNames", () => {
  it("gives a legacy agent (no tool list) the Ask AI set, its product's tools and the basics, minus what no teammate has", () => {
    const people = teammateToolNames({ toolNames: null, productSlug: "workwrk-people" }, { tablesOn: true, talkOn: true });
    for (const t of CROSS_TOOL_NAMES) expect(people).toContain(t);
    expect(people).toEqual(expect.arrayContaining(["create_kra", "create_kpi", "remember", "forget", "create_routine"]));
    expect(people).not.toContain("post_in_talk");
    expect([...people]).toEqual([...people].sort());
    const legal = teammateToolNames({ toolNames: null, productSlug: "workwrk-contracts" }, { tablesOn: true, talkOn: true });
    expect(legal).toContain("search_contracts");
    expect(legal).not.toContain("create_contract");
    expect(legal).not.toContain("update_contract");
    expect(teammateToolNames({ toolNames: null, productSlug: "workwrk-dev" }, { tablesOn: true, talkOn: true })).not.toContain("create_sprint");
    expect(teammateToolNames({ toolNames: null, productSlug: "constructor" }, { tablesOn: true, talkOn: true })).toHaveLength(CROSS_TOOL_NAMES.length + 3);
  });

  it("honours a saved list, dropping unknown names, excluded tools and tools of a module that is off", () => {
    const saved = ["read_talk", "post_in_talk", "bogus", "create_sprint", "remember", "list_data_tables"];
    expect(teammateToolNames({ toolNames: saved, productSlug: null }, { tablesOn: true, talkOn: true })).toEqual(["list_data_tables", "post_in_talk", "read_talk", "remember"]);
    expect(teammateToolNames({ toolNames: saved, productSlug: null }, { tablesOn: false, talkOn: false })).toEqual(["remember"]);
    expect(teammateToolNames({ toolNames: { not: "a list" }, productSlug: null }, { tablesOn: true, talkOn: true })).toEqual([]);
  });
});
