// What a teammate's call would do, decided before anything runs
// (src/lib/agents/previews.ts prepareCall): the escalations of the 3.3
// table, a target the person cannot reach failing before any proposal, and
// text that leaves the chat cleaned before the card shows it. The gates and
// the database are mocked; the rules under test are the previews' own.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type Gate = {
  item: { id: string; title: string; status: string | null; boardId: string; ownerId: string | null; assigneeIds: string[]; board: { id: string; name: string; ownerId: string | null; statuses: unknown } };
  watcherIds: string[];
};

const db = vi.hoisted(() => ({
  tasks: {} as Record<string, Gate | number>,
  people: {} as Record<string, { id: string; firstName: string; lastName: string; email: string }>,
  personalBoards: new Set<string>(),
  allowed: new Set<string>(),
  manager: false,
  companyGoalOk: true,
  conversationsByName: {} as Record<string, string[]>,
  conversations: {} as Record<string, { type: "DM" | "GROUP" | "CHANNEL"; name: string | null; restricted: boolean; archivedAt: Date | null; role: string }>,
  members: 34,
  docs: {} as Record<string, { id: string; title: string; content: unknown; updatedAt: Date; archivedAt: Date | null; entityType: string | null; entityId: string | null }>,
  subtasks: 0,
  lists: [] as Array<{ id: string; name: string; statuses: unknown; productSlug: string | null; space: { name: string } | null }>,
  contribute: new Set<string>(),
}));

vi.mock("@/lib/item-gate", () => ({
  gateItem: async (id: string) => {
    const t = db.tasks[id];
    if (t === undefined) return { error: new Response(null, { status: 404 }) };
    if (typeof t === "number") return { error: new Response(null, { status: t }) };
    return { ...t, decision: {}, creatorId: null, isCreator: false, unwatcherIds: [], viaLinkedList: null, canAddToList: true, canManageList: false };
  },
}));
// The person's legacy gates, as acting.ts hands them over.
vi.mock("./acting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./acting")>();
  return {
  itemCtxFor: (p: { userId: string; organizationId: string; name: string }) => ({ userId: p.userId, organizationId: p.organizationId, userName: p.name }),
  nodeCtxOf: () => ({}),
  canReadListAs: async (_p: unknown, id: string) => db.lists.some((l) => l.id === id),
  canContributeAs: async (_p: unknown, id: string) => db.contribute.has(id),
  personMay: async (_p: unknown, module: string, action: string) => db.allowed.has(`${module}.${action}`),
  isManagerPerson: () => db.manager,
  goalActorFor: async () => ({}),
  // The real invitation rule, from the mocked person's level (legacyLevelRow).
  inviteLevelAs: actual.inviteLevelAs,
  inviteInput: actual.inviteInput,
  };
});
vi.mock("@/lib/talk-gate", () => ({
  talkGateForUser: async (userId: string, organizationId: string) => ({ ok: true, gate: { userId, organizationId, orgRole: "MEMBER", ...legacyLevelRow("EMPLOYEE") } }),
  loadConversationRole: async (id: string) => {
    const c = db.conversations[id];
    if (!c) return null;
    return { conversation: { id, type: c.type, name: c.name, restricted: c.restricted, archivedAt: c.archivedAt, createdById: "someone", findable: true, topic: null, createdAt: new Date(), callEpoch: 0 }, role: c.role, membershipId: null };
  },
}));
vi.mock("@/lib/doc-access", () => ({ docAccess: async () => ({ unlockedRole: "EDIT", locked: false, canManage: false }) }));
vi.mock("@/lib/plan-limits", () => ({ checkPlanLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/goals/goal-rights", () => ({ mayEditGoal: () => db.companyGoalOk }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: async (a: { where: { email?: { equals: string } } }) => {
        const e = a.where.email?.equals?.toLowerCase();
        return e ? (db.people[e] ?? null) : null;
      },
    },
    board: {
      findUnique: async (a: { where: { id: string } }) => ({ productSlug: db.personalBoards.has(a.where.id) ? "personal-list" : null }),
      findFirst: async (a: { where: { id: string } }) => db.lists.find((l) => l.id === a.where.id) ?? null,
      findMany: async (a: { where: { name: { equals: string } } }) => db.lists.filter((l) => l.name.toLowerCase() === a.where.name.equals.toLowerCase() && l.productSlug !== "personal-list"),
    },
    item: { count: async () => db.subtasks },
    conversation: {
      findMany: async (a: { where: { name: { equals: string } } }) => (db.conversationsByName[a.where.name.equals.toLowerCase()] ?? []).map((id) => ({ id })),
      findFirst: async () => null,
    },
    conversationMember: { count: async () => db.members, findFirst: async () => null },
    doc: { findFirst: async (a: { where: { id: string } }) => db.docs[a.where.id] ?? null },
    role: { findFirst: async () => ({ id: "r1", title: "Account Executive" }) },
    kRA: { findFirst: async () => ({ id: "k1", name: "Pipeline health" }) },
  },
}));

import { prepareCall, type PrepareContext } from "./previews";
import { INVITE_CARD, PREVIEW_LINES } from "./teammate-copy";

const ME = { id: "me", firstName: "Priya", lastName: "Shah", email: "priya@x.com" };
const MAX = { id: "max", firstName: "Max", lastName: "Chen", email: "max@x.com" };

/** The person, as a Member, or as a manager (what acting.ts's isManagerPerson answers). */
function ctx(tier: "member" | "manager" = "member"): PrepareContext {
  db.manager = tier === "manager";
  return {
    person: {
      userId: "me",
      organizationId: "org",
      ...legacyLevelRow(tier === "manager" ? "MANAGER" : "EMPLOYEE"),
      orgRole: "MEMBER",
      name: "Priya Shah",
      firstName: "Priya",
      email: "priya@x.com",
      timezone: "UTC",
      viewer: { userId: "me", organizationId: "org", orgRole: "MEMBER", isAgent: false, adminScopes: [] },
    } as never,
    teammate: { agentId: "a1", agentName: "Chief of Staff", trigger: "CHAT" },
  };
}

function task(id: string, o: { personal: boolean; ownerId?: string | null; assigneeIds?: string[]; watcherIds?: string[] }): Gate {
  const boardId = o.personal ? "b-personal" : "b-team";
  return {
    item: { id, title: "Call Acme", status: "TO_DO", boardId, ownerId: o.ownerId === undefined ? "me" : o.ownerId, assigneeIds: o.assigneeIds ?? ["me"], board: { id: boardId, name: o.personal ? "Personal list" : "Team", ownerId: o.personal ? "me" : "olivia", statuses: null } },
    watcherIds: o.watcherIds ?? [],
  };
}

beforeEach(() => {
  db.tasks = {};
  db.people = { [ME.email]: ME, [MAX.email]: MAX };
  db.personalBoards = new Set(["b-personal"]);
  db.allowed = new Set(["meetings.create", "kras.create", "sops.create", "people.create"]);
  db.manager = false;
  db.companyGoalOk = true;
  db.conversationsByName = { general: ["c-general"], secret: ["c-secret"] };
  db.conversations = {
    "c-general": { type: "CHANNEL", name: "general", restricted: false, archivedAt: null, role: "edit" },
    "c-secret": { type: "CHANNEL", name: "secret", restricted: true, archivedAt: null, role: "none" },
  };
  db.members = 34;
  db.docs = {};
  db.subtasks = 0;
  db.lists = [];
  db.contribute = new Set();
});

describe("escalations (3.3)", () => {
  it("a task for someone else asks, and names whose list it lands on", async () => {
    const r = await prepareCall("create_task", { title: " Call Acme ", assigneeEmail: "MAX@x.com" }, ctx());
    expect(r).toMatchObject({ ok: true, risk: "OUTWARD", input: { title: "Call Acme", assigneeEmail: "max@x.com" } });
    if (!r.ok) return;
    expect(r.preview.title).toBe('Create task "Call Acme" for Max Chen');
    expect(r.preview.lines).toEqual(["It goes on Max Chen's Personal list."]);
    expect(r.preview.editable).toMatchObject({ field: "title" });
    expect((await prepareCall("create_task", { title: "Call Acme", assigneeEmail: "priya@x.com" }, ctx()))).toMatchObject({ ok: true, risk: "INTERNAL" });
    expect((await prepareCall("create_task", { title: "Call Acme" }, ctx()))).toMatchObject({ ok: true, risk: "INTERNAL" });
  });

  it("a meeting with anyone but the person asks, and lists only live people", async () => {
    const r = await prepareCall("create_meeting", { title: "Weekly sync", scheduledAt: "2026-10-12T14:00:00Z", attendeeEmails: ["max@x.com", "gone@x.com", "priya@x.com"] }, ctx());
    expect(r).toMatchObject({ ok: true, risk: "OUTWARD", input: { attendeeEmails: ["max@x.com", "priya@x.com"] } });
    if (!r.ok) return;
    expect(r.preview.lines).toEqual(["On Mon 12 Oct, 14:00, UTC.", "With Max Chen."]);
    expect(await prepareCall("create_meeting", { title: "Focus", scheduledAt: "2026-10-12T14:00:00Z" }, ctx())).toMatchObject({ ok: true, risk: "INTERNAL" });
  });

  it("a goal owned by someone else, or above Individual, asks; a Member's Department goal fails before any card", async () => {
    const other = await prepareCall("create_okr", { title: "Grow", ownerEmail: "max@x.com" }, ctx("manager"));
    expect(other).toMatchObject({ ok: true, risk: "OUTWARD", input: { ownerEmail: "max@x.com", level: "INDIVIDUAL" } });
    if (other.ok) expect(other.preview.lines).toEqual(["Max Chen is told it's theirs now."]);
    const dept = await prepareCall("create_okr", { title: "Grow", level: "TEAM" }, ctx("manager"));
    expect(dept).toMatchObject({ ok: true, risk: "OUTWARD", input: { level: "DEPARTMENT" } });
    if (dept.ok) expect(dept.preview.lines).toEqual(["It's a Department goal."]);
    expect(await prepareCall("create_okr", { title: "Grow", level: "DEPARTMENT" }, ctx())).toMatchObject({ ok: false, error: expect.stringContaining("Only managers") });
    expect(await prepareCall("create_okr", { title: "Mine" }, ctx())).toMatchObject({ ok: true, risk: "INTERNAL" });
  });

  it("a task change off the person's own Personal list asks; on it, with nobody else on it, it runs", async () => {
    db.tasks["t-private"] = task("t-private", { personal: true });
    db.tasks["t-shared"] = task("t-shared", { personal: false, ownerId: "olivia", assigneeIds: ["olivia"] });
    db.tasks["t-watched"] = task("t-watched", { personal: true, watcherIds: ["olivia"] });

    const mine = await prepareCall("update_task", { taskId: "t-private", done: true }, ctx());
    expect(mine).toMatchObject({ ok: true, risk: "INTERNAL", input: { taskId: "t-private", status: "DONE" } });
    if (mine.ok) expect(mine.preview.lines).toEqual(["Status: Done"]);

    const shared = await prepareCall("update_task", { taskId: "t-shared", status: "in progress" }, ctx());
    expect(shared).toMatchObject({ ok: true, risk: "OUTWARD", input: { status: "IN_PROGRESS" } });
    if (shared.ok) expect(shared.preview.lines).toEqual(["Status: In Progress", PREVIEW_LINES.statusAudience, PREVIEW_LINES.automations]);

    expect(await prepareCall("update_task", { taskId: "t-watched", priority: "high" }, ctx())).toMatchObject({ ok: true, risk: "OUTWARD", input: { priority: "HIGH" } });
    // Handing even a private task to someone else is outward.
    const handed = await prepareCall("update_task", { taskId: "t-private", assigneeEmail: "Max@x.com" }, ctx());
    expect(handed).toMatchObject({ ok: true, risk: "OUTWARD", input: { assigneeEmail: "max@x.com" } });
    if (handed.ok) expect(handed.preview.lines).toContain("Max Chen is told it's theirs now.");
  });

  it("a comment on a shared task asks; on the person's own private task it runs", async () => {
    db.tasks["t-private"] = task("t-private", { personal: true });
    db.tasks["t-shared"] = task("t-shared", { personal: false, ownerId: "olivia", assigneeIds: ["olivia"] });
    expect(await prepareCall("comment_on_task", { taskId: "t-private", text: "Done" }, ctx())).toMatchObject({ ok: true, risk: "INTERNAL" });
    const shared = await prepareCall("comment_on_task", { taskId: "t-shared", text: "See [the brief](https://evil.example/x) @Max" }, ctx());
    expect(shared).toMatchObject({ ok: true, risk: "OUTWARD", input: { text: "See the brief @Max" } });
    if (shared.ok) expect(shared.preview.lines).toEqual([PREVIEW_LINES.commentAudience]);
  });

  it("adding to the person's own note runs; to any other doc it asks, with the undo", async () => {
    db.docs.note = { id: "note", title: "My notes", content: { blocks: [] }, updatedAt: new Date(), archivedAt: null, entityType: "NOTEPAD", entityId: "me" };
    db.docs.plan = { id: "plan", title: "Q3 plan", content: { blocks: [] }, updatedAt: new Date(), archivedAt: null, entityType: "SPACE", entityId: "s1" };
    expect(await prepareCall("update_doc", { docId: "note", text: "x" }, ctx())).toMatchObject({ ok: true, risk: "INTERNAL" });
    const plan = await prepareCall("update_doc", { docId: "plan", heading: "Status", text: "On track" }, ctx());
    expect(plan).toMatchObject({ ok: true, risk: "OUTWARD", preview: { title: 'Add to "Q3 plan"', body: "Status\n\nOn track", undo: PREVIEW_LINES.docUndo, lines: [PREVIEW_LINES.docAudience] } });
  });
});

describe("a target the person cannot reach fails before any proposal", () => {
  it("a task they cannot open or change", async () => {
    expect(await prepareCall("update_task", { taskId: "t-nowhere", done: true }, ctx())).toEqual({ ok: false, error: "I can't find that task." });
    db.tasks["t-readonly"] = 403;
    expect(await prepareCall("comment_on_task", { taskId: "t-readonly", text: "Hi" }, ctx())).toEqual({ ok: false, error: "You can't comment on this task." });
    expect(await prepareCall("update_task", { taskId: "t-readonly", done: true }, ctx())).toEqual({ ok: false, error: "You can't change this task." });
  });

  it("a status the List does not have names the List's statuses", async () => {
    db.tasks["t-private"] = task("t-private", { personal: true });
    expect(await prepareCall("update_task", { taskId: "t-private", status: "Shipped" }, ctx())).toEqual({
      ok: false,
      error: "That isn't a status in this List. Its statuses are: To Do, In Progress, Done.",
    });
  });

  it("a conversation they are not in, and a List they cannot add to", async () => {
    expect(await prepareCall("post_in_talk", { channel: "#secret", text: "Hi" }, ctx())).toEqual({ ok: false, error: "There's no channel or group called secret that you're in." });
    db.tasks["t-shared"] = task("t-shared", { personal: false });
    db.contribute.add("b-team");
    db.lists = [{ id: "l-locked", name: "Locked", statuses: null, productSlug: null, space: null }];
    expect(await prepareCall("move_task", { taskId: "t-shared", listName: "locked" }, ctx())).toEqual({ ok: false, error: "There's no List called locked that you can add tasks to." });
  });

  it("a permission the person lacks", async () => {
    db.allowed = new Set();
    expect(await prepareCall("create_kra", { name: "Pipeline", roleTitle: "AE" }, ctx())).toMatchObject({ ok: false, error: expect.stringContaining("can't create KRAs") });
    expect(await prepareCall("invite_person_with_role", { email: "new@x.com" }, ctx())).toMatchObject({ ok: false, error: expect.stringContaining("can't invite") });
    expect(await prepareCall("create_meeting", { title: "Sync", scheduledAt: "2026-10-12T14:00:00Z" }, ctx())).toMatchObject({ ok: false });
  });
});

describe("Talk posts", () => {
  it("are cleaned before the card: links to their words and no @ pings, with the conversation as the target", async () => {
    const r = await prepareCall("post_in_talk", { channel: "#General", text: "Read [this](https://evil.example/steal) now @Max and @all." }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toEqual({ conversationId: "c-general", text: "Read this now Max and all." });
    expect(r.preview.body).toBe("Read this now Max and all.");
    expect(r.preview.title).toBe("Post in #general");
    expect(r.preview.lines).toEqual([PREVIEW_LINES.anyoneCanOpenChannel, PREVIEW_LINES.notifiedBySettings]);
    expect(r.risk).toBe("OUTWARD");
    expect(r.targetKey).toBe("conv:c-general");
    expect(r.preview.alwaysKey).toBe("post_in_talk:conv:c-general");
    expect(r.preview.alwaysLabel).toBe("Approve and don't ask again in #general");
  });

  it("count who can read a private conversation", async () => {
    db.conversations["c-general"].restricted = true;
    db.members = 5;
    const r = await prepareCall("post_in_talk", { conversationId: "c-general", text: "Hi" }, ctx());
    expect(r.ok && r.preview.lines).toEqual(["5 people can read it.", PREVIEW_LINES.notifiedBySettings]);
  });

  it("refuse an archived conversation", async () => {
    db.conversations["c-general"].archivedAt = new Date();
    expect(await prepareCall("post_in_talk", { channel: "general", text: "Hi" }, ctx())).toEqual({ ok: false, error: "You can't post in #general." });
  });
});

describe("the card's choices", () => {
  it("never offers don't ask again for an invitation", async () => {
    const r = await prepareCall("invite_person_with_role", { email: "new@x.com" }, ctx());
    expect(r).toMatchObject({ ok: true, risk: "IRREVERSIBLE", preview: { title: "Invite new@x.com", lines: [INVITE_CARD.level("Employee"), PREVIEW_LINES.inviteSent, PREVIEW_LINES.invitePending] } });
    if (r.ok) expect(r.preview.alwaysKey).toBeUndefined();
  });

  it("names what an invitation gives, refuses a level above the person's own, and stores only what it checked (review round 1)", async () => {
    // Before: the card showed only the email while an Admin level ran.
    const admin = await prepareCall("invite_person_with_role", { email: "new@x.com", ...legacyLevelRow("COMPANY_ADMIN") }, ctx("manager"));
    expect(admin.ok).toBe(false);
    const r = await prepareCall("invite_person_with_role", { email: "new@x.com", ...legacyLevelRow("TEAM_LEAD"), roleId: "r1", sneaky: "x" }, ctx("manager"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.lines).toEqual([INVITE_CARD.level("Team Lead"), INVITE_CARD.role("Account Executive"), PREVIEW_LINES.inviteSent, PREVIEW_LINES.invitePending]);
    expect(r.input).toEqual({ email: "new@x.com", ...legacyLevelRow("TEAM_LEAD"), roleId: "r1" });
  });

  it("never offers it where a manager set the tool to ask", async () => {
    db.people["max@x.com"] = MAX;
    const free = await prepareCall("send_kudos", { receiverEmail: "max@x.com", message: "Thanks" }, ctx());
    expect(free.ok && free.preview.alwaysKey).toBe("send_kudos");
    const tight = await prepareCall("send_kudos", { receiverEmail: "max@x.com", message: "Thanks" }, { ...ctx(), agentRules: { send_kudos: "ask" } });
    expect(tight.ok && tight.preview.alwaysKey).toBeUndefined();
  });

  it("passes a read through as a read", async () => {
    expect(await prepareCall("search_tasks", { titleContains: "acme" }, ctx())).toEqual({ ok: true, tool: "search_tasks", input: { titleContains: "acme" }, risk: "READ", preview: { title: "Find tasks" }, targetKey: null });
  });

  it("refuses a routine set up from inside a routine run", async () => {
    const inRoutine = { ...ctx(), teammate: { agentId: "a1", agentName: "Chief of Staff", trigger: "ROUTINE" as const } };
    expect(await prepareCall("create_routine", { name: "Brief", instructions: "x", schedule: { kind: "daily", time: "09:00" } }, inRoutine)).toEqual({ ok: false, error: "A routine can't set up another routine." });
    const r = await prepareCall("create_routine", { name: "Brief", instructions: "x", schedule: { kind: "weekdays", time: "9:00" } }, ctx());
    expect(r).toMatchObject({ ok: true, risk: "INTERNAL", preview: { title: 'Set up routine "Brief"', lines: ["Weekdays at 9:00"] } });
  });
});
