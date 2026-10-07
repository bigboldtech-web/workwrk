// The approval queue (src/lib/agents/actions.ts): an approval runs its tool
// once however many arrive at once; only the person it acts for can decide,
// and another person's id answers like a missing one; what can no longer run
// is expired, cancelled or left waiting, never run; an edit changes only the
// one editable field, clamped; a deny runs nothing; the Inbox notification is
// marked read; "don't ask again" is stored only where the policy allows it;
// the sweep expires and fails what it must and never runs anything; a
// chat's outcomes are claimed once; and the person's other tabs are told
// once per teammate. The database and the modules around it are the shared
// doubles in test-fixtures.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const published = vi.hoisted(() => [] as Array<{ userId: string; event: unknown }>);
vi.mock("@/lib/realtime-bus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/realtime-bus")>()),
  publishToUser: (userId: string, event: unknown) => void published.push({ userId, event }),
}));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./test-fixtures")).prismaFake }));
vi.mock("./acting", async () => (await import("./test-fixtures")).actingFake);
vi.mock("./previews", async () => ({ prepareCall: (await import("./test-fixtures")).fakePrepareCall }));
vi.mock("./tools", async () => ({ TOOLS: (await import("./test-fixtures")).fakeTools() }));
vi.mock("@/lib/activity", async () => ({ logActivity: (await import("./test-fixtures")).fakeLogActivity }));
vi.mock("@/lib/entitlements", async () => ({ isModuleActive: (await import("./test-fixtures")).fakeIsModuleActive }));

import { RUNNING_STUCK_MS, actionHref, actionViews, cancelPendingActionsOf, claimUnreportedOutcomes, decideActions, sweepActions, waitingCount } from "./actions";
import { AGENT_SLUG, VIEWER, fx, prismaFake, resetFixtures, seedAction, type ActionRowFx } from "./test-fixtures";

const viewer = VIEWER as never;

/** A request to post in #general, waiting for the person unless told otherwise. */
function talkPost(o: Partial<ActionRowFx> = {}) {
  return seedAction({
    toolName: "post_in_talk",
    input: { conversationId: "c1", text: "Hello team" },
    preview: { title: "Post in #general", alwaysKey: "post_in_talk:conv:c1" },
    targetKey: "conv:c1",
    ...o,
  });
}

const POSTED = { ok: true, message: { id: "msg1", conversationId: "c1" }, conversation: { name: "#general", type: "CHANNEL" } };

/** What was published of one kind: agent.changed for the chats, notification for the bell and Inbox. */
const sent = (type: string) => published.filter((p) => (p.event as { type: string }).type === type);

beforeEach(() => {
  resetFixtures();
  published.length = 0;
  fx.answers.post_in_talk = POSTED;
  fx.cards.post_in_talk = { title: "Post in #general" };
});

describe("decideActions: who decides, and once", () => {
  it("runs the tool once when two approvals arrive at the same moment", async () => {
    const row = talkPost();
    const [a, b] = await Promise.all([
      decideActions(viewer, [{ id: row.id, decision: "approve" }]),
      decideActions(viewer, [{ id: row.id, decision: "approve" }]),
    ]);
    expect(fx.handlerCalls.filter((c) => c.tool === "post_in_talk")).toHaveLength(1);
    const statuses = [a.results[0], b.results[0]].map((r) => [r.status, r.code ?? null]);
    expect(statuses).toContainEqual(["EXECUTED", null]);
    expect(statuses.filter(([, code]) => code === "already_decided")).toHaveLength(1);
    expect(fx.actions[0].status).toBe("EXECUTED");
    // The approved action's id rides in the tool context: the Talk post's key is ag_<id>.
    expect(fx.handlerCalls[0].ctx.teammate).toMatchObject({ actionId: row.id, trigger: "APPROVAL", agentId: "a1", sessionId: "s1" });

    const again = await decideActions(viewer, [{ id: row.id, decision: "approve" }]);
    expect(again.results).toEqual([{ id: row.id, status: "EXECUTED", code: "already_decided" }]);
    expect(fx.handlerCalls).toHaveLength(1);
  });

  it("answers another person's action exactly like a missing one, and changes nothing", async () => {
    const theirs = talkPost({ actingForId: "max" });
    const admin = { ...VIEWER, orgRole: "ADMIN" } as never;
    expect((await decideActions(viewer, [{ id: theirs.id, decision: "approve" }])).results).toEqual([{ id: theirs.id, status: "not_found" }]);
    expect((await decideActions(admin, [{ id: theirs.id, decision: "deny" }])).results).toEqual([{ id: theirs.id, status: "not_found" }]);
    expect((await decideActions(viewer, [{ id: "nope", decision: "approve" }])).results).toEqual([{ id: "nope", status: "not_found" }]);
    expect(fx.actions[0].status).toBe("PENDING");
    expect(fx.handlerCalls).toEqual([]);
    expect(fx.messages).toEqual([]);
  });

  it("decides at most 50 at once", async () => {
    const ids = Array.from({ length: 60 }, () => talkPost().id);
    const out = await decideActions(viewer, ids.map((id) => ({ id, decision: "deny" as const })));
    expect(out.results).toHaveLength(50);
    expect(fx.actions.filter((r) => r.status === "PENDING")).toHaveLength(10);
  });
});

describe("decideActions: what can no longer run", () => {
  it("refuses an expired request, marks it EXPIRED and writes its line", async () => {
    const row = talkPost({ expiresAt: new Date(Date.now() - 1000) });
    const out = await decideActions(viewer, [{ id: row.id, decision: "approve" }]);
    expect(out.results).toEqual([{ id: row.id, status: "EXPIRED", code: "expired" }]);
    expect(fx.actions[0]).toMatchObject({ status: "EXPIRED", decidedVia: "expiry" });
    expect(fx.handlerCalls).toEqual([]);
    expect(fx.messages).toEqual([{ sessionId: "s1", role: "SYSTEM", kind: "EVENT", content: "Expired without an answer: Post in #general", meta: { event: "action_expired", actionId: row.id } }]);
    expect(out.resume).toBe(false);
  });

  it("leaves a paused teammate's request waiting, and still lets the person say no", async () => {
    fx.agent.status = "DISABLED";
    const row = talkPost();
    const out = await decideActions(viewer, [{ id: row.id, decision: "approve" }]);
    expect(out.results).toEqual([{ id: row.id, status: "PENDING", code: "agent_paused", error: "Chief of Staff is paused." }]);
    expect(fx.actions[0].status).toBe("PENDING");
    expect(fx.handlerCalls).toEqual([]);
    const no = await decideActions(viewer, [{ id: row.id, decision: "deny" }]);
    expect(no.results[0].status).toBe("DENIED");
  });

  it("cancels the request of a removed teammate, and of a tool it no longer has", async () => {
    fx.agent.status = "ARCHIVED";
    const removed = talkPost();
    expect((await decideActions(viewer, [{ id: removed.id, decision: "approve" }])).results).toEqual([
      { id: removed.id, status: "CANCELLED", code: "agent_removed", error: "Cancelled: Chief of Staff was removed." },
    ]);

    fx.agent.status = "ENABLED";
    fx.agent.toolNames = ["search_tasks", "create_task"];
    const toolGone = talkPost();
    expect((await decideActions(viewer, [{ id: toolGone.id, decision: "approve" }])).results).toEqual([
      { id: toolGone.id, status: "CANCELLED", code: "tool_off", error: "Cancelled: Chief of Staff can no longer use this tool." },
    ]);

    // Talk turned off takes post_in_talk out of every teammate's set.
    fx.agent.toolNames = ["post_in_talk"];
    fx.modules.talkOn = false;
    const talkOff = talkPost();
    expect((await decideActions(viewer, [{ id: talkOff.id, decision: "approve" }])).results[0]).toMatchObject({ status: "CANCELLED", code: "tool_off" });

    expect(fx.actions.map((r) => [r.status, r.decidedVia])).toEqual([["CANCELLED", "system"], ["CANCELLED", "system"], ["CANCELLED", "system"]]);
    expect(fx.handlerCalls).toEqual([]);
  });

  it("cancels the request of a private teammate the person can no longer use", async () => {
    fx.agent.ownerId = "someone-else";
    const row = talkPost();
    expect((await decideActions(viewer, [{ id: row.id, decision: "approve" }])).results[0]).toMatchObject({ status: "CANCELLED", code: "agent_removed" });
    expect(fx.handlerCalls).toEqual([]);
  });

  it("leaves the request waiting when a teammate may not act for the person now", async () => {
    fx.person = { ok: false, reason: "gone" };
    const row = talkPost();
    expect((await decideActions(viewer, [{ id: row.id, decision: "approve" }])).results).toEqual([
      { id: row.id, status: "PENDING", code: "person_cannot", error: "A teammate can't act for you in this workspace now." },
    ]);
    expect(fx.actions[0].status).toBe("PENDING");
    expect(fx.handlerCalls).toEqual([]);
  });

  it("fails a request the person can no longer make, with the reason, and runs nothing", async () => {
    fx.cards.post_in_talk = { ok: false, error: "You can't post in #general." };
    const row = talkPost();
    const out = await decideActions(viewer, [{ id: row.id, decision: "approve" }]);
    expect(out.results).toEqual([{ id: row.id, status: "FAILED", code: "failed", error: "You can't post in #general." }]);
    expect(fx.actions[0]).toMatchObject({ status: "FAILED", error: "You can't post in #general.", decidedVia: "person", decidedById: "me" });
    expect(fx.handlerCalls).toEqual([]);
    expect(fx.messages.map((m) => m.content)).toEqual(["Didn't work: Post in #general. You can't post in #general."]);
    expect(out.resume).toBe(true);
  });
});

describe("decideActions: approving", () => {
  it("runs the fresh card's input as the person now, keeps the fresh card, and audits it", async () => {
    fx.cards.post_in_talk = { title: "Post in #general-renamed", input: { conversationId: "c1", text: "Hello team" } };
    const row = talkPost();
    const out = await decideActions(viewer, [{ id: row.id, decision: "approve" }]);
    expect(out).toEqual({ results: [{ id: row.id, status: "EXECUTED", result: { text: "Posted in Talk", href: null } }], resume: true, agentSlug: AGENT_SLUG });
    expect(fx.prepareCalls[0]).toMatchObject({ tool: "post_in_talk", input: { conversationId: "c1", text: "Hello team" }, ctx: { teammate: { agentId: "a1", trigger: "APPROVAL" } } });
    expect(fx.actions[0]).toMatchObject({ status: "EXECUTED", decidedVia: "person", decidedById: "me", preview: { title: "Post in #general-renamed" }, editedInput: null });
    expect(fx.actions[0].executedAt).toBeInstanceOf(Date);
    expect(fx.messages.map((m) => m.content)).toEqual(["You approved: Post in #general-renamed"]);
    expect(fx.activity).toHaveLength(1);
    expect(fx.activity[0]).toMatchObject({ type: "agent.post_in_talk", actorId: "me", actorType: "agent", actingForId: "me", metadata: { actionId: row.id, decidedVia: "person" }, severity: "info" });
  });

  it("changes only the editable field when the person edits, clamped to its length", async () => {
    const row = talkPost();
    await decideActions(viewer, [{ id: row.id, decision: "approve", edit: { text: "y".repeat(5000) } }]);
    expect(fx.prepareCalls[0].input).toEqual({ conversationId: "c1", text: "y".repeat(3000) });
    expect(fx.handlerCalls[0].input).toEqual({ conversationId: "c1", text: "y".repeat(3000) });
    expect(fx.actions[0].editedInput).toEqual({ conversationId: "c1", text: "y".repeat(3000) });

    // A tool with no editable field runs what the card showed.
    const invite = seedAction({ toolName: "invite_person_with_role", risk: "IRREVERSIBLE", input: { email: "lea@x.com", role: "MEMBER" }, preview: { title: "Invite lea@x.com" } });
    await decideActions(viewer, [{ id: invite.id, decision: "approve", edit: { text: "evil@x.com" } }]);
    expect(fx.prepareCalls[1].input).toEqual({ email: "lea@x.com", role: "MEMBER" });
    expect(fx.actions[1].editedInput).toBeNull();

    // Never half a character: an emoji across the limit is left out whole.
    const emoji = talkPost();
    await decideActions(viewer, [{ id: emoji.id, decision: "approve", edit: { text: `${"y".repeat(2999)}\u{1F600}` } }]);
    expect(fx.actions.find((r) => r.id === emoji.id)?.editedInput).toEqual({ conversationId: "c1", text: "y".repeat(2999) });
  });

  it("records a tool that fails as FAILED with its reason, and a thrown error as a plain sentence", async () => {
    fx.answers.post_in_talk = { error: "The channel is archived." };
    const row = talkPost();
    const out = await decideActions(viewer, [{ id: row.id, decision: "approve" }]);
    expect(out.results).toEqual([{ id: row.id, status: "FAILED", code: "failed", error: "The channel is archived." }]);
    expect(fx.actions[0]).toMatchObject({ status: "FAILED", error: "The channel is archived." });
    expect(fx.messages.map((m) => m.content)).toEqual(["Didn't work: Post in #general. The channel is archived."]);
    expect(fx.activity).toEqual([]);

    fx.answers.post_in_talk = new Error('duplicate key value violates unique constraint "x"');
    const thrown = talkPost();
    const t = await decideActions(viewer, [{ id: thrown.id, decision: "approve" }]);
    expect(t.results[0]).toMatchObject({ status: "FAILED", error: "That didn't work. Check it in the app and try again." });
  });
});

describe("decideActions: saying no", () => {
  it("runs nothing, records who said no, writes the line, and does not resume", async () => {
    const row = talkPost();
    const out = await decideActions(viewer, [{ id: row.id, decision: "deny" }]);
    expect(out).toEqual({ results: [{ id: row.id, status: "DENIED" }], resume: false, agentSlug: AGENT_SLUG });
    expect(fx.actions[0]).toMatchObject({ status: "DENIED", decidedVia: "person", decidedById: "me" });
    expect(fx.handlerCalls).toEqual([]);
    expect(fx.prepareCalls).toEqual([]);
    expect(fx.activity).toEqual([]);
    expect(fx.messages).toEqual([{ sessionId: "s1", role: "SYSTEM", kind: "EVENT", content: "You said no: Post in #general", meta: { event: "action_denied", actionId: row.id } }]);
  });

  it("does not resume for a request decided before this call", async () => {
    const row = talkPost();
    expect((await decideActions(viewer, [{ id: row.id, decision: "approve" }])).resume).toBe(true);
    // A second tab, or a double click: nothing runs, nothing new to tell.
    const again = await decideActions(viewer, [{ id: row.id, decision: "approve" }]);
    expect(again.results).toEqual([{ id: row.id, status: "EXECUTED", code: "already_decided" }]);
    expect(again.resume).toBe(false);
    expect(fx.handlerCalls).toHaveLength(1);
  });

  it("resumes when anything in the batch ran", async () => {
    const yes = talkPost();
    const no = talkPost();
    const out = await decideActions(viewer, [{ id: no.id, decision: "deny" }, { id: yes.id, decision: "approve" }]);
    expect(out.results.map((r) => r.status)).toEqual(["DENIED", "EXECUTED"]);
    expect(out.resume).toBe(true);
  });
});

describe("decideActions: the Inbox", () => {
  it("marks read the notification that points at the request", async () => {
    const row = talkPost();
    await decideActions(viewer, [{ id: row.id, decision: "approve" }]);
    const link = actionHref(AGENT_SLUG, row.id);
    expect(link).toBe(`/agents?chat=${AGENT_SLUG}&action=${row.id}`);
    expect(fx.notifications).toEqual([{ where: { userId: "me", link: { in: [link] }, read: false }, data: { read: true } }]);
  });
});

describe("decideActions: don't ask again", () => {
  it("stores the person's own rule for one Talk conversation, and says so", async () => {
    fx.settings.set("a1:me", { send_kudos: "ask" });
    fx.cards.post_in_talk = { title: "Post in #general", input: { conversationId: "c1", text: "Hello team" } };
    const row = talkPost();
    await decideActions(viewer, [{ id: row.id, decision: "approve" }], { always: true });
    expect(fx.settings.get("a1:me")).toEqual({ "post_in_talk:conv:c1": "always", send_kudos: "ask" });
    expect(fx.messages.map((m) => m.content)).toEqual(["You approved: Post in #general. It won't ask again for this."]);
  });

  it("never stores it for what cannot be taken back", async () => {
    fx.cards.invite_person_with_role = { title: "Invite lea@x.com" };
    const invite = seedAction({ toolName: "invite_person_with_role", risk: "IRREVERSIBLE", input: { email: "lea@x.com" }, preview: { title: "Invite lea@x.com" } });
    await decideActions(viewer, [{ id: invite.id, decision: "approve" }], { always: true });
    expect(fx.actions[0].status).toBe("EXECUTED");
    expect(fx.settings.size).toBe(0);
    expect(fx.messages.map((m) => m.content)).toEqual(["You approved: Invite lea@x.com"]);
    expect(fx.activity[0]).toMatchObject({ severity: "warning" });
  });

  it("stores the escalated key for a call above its tool's own class, never the tool-wide one", async () => {
    fx.cards.create_task = { risk: "OUTWARD", title: 'Create task "Call Acme" for Max Chen' };
    const forMax = seedAction({ toolName: "create_task", input: { title: "Call Acme", assigneeEmail: "max@x.com" }, preview: { title: 'Create task "Call Acme" for Max Chen' } });
    await decideActions(viewer, [{ id: forMax.id, decision: "approve" }], { always: true });
    expect(fx.settings.get("a1:me")).toEqual({ "create_task:outward": "always" });
  });

  it("stores nothing when the teammate's managers set the tool to ask", async () => {
    fx.agent.approvalRules = { post_in_talk: "ask" };
    const row = talkPost();
    await decideActions(viewer, [{ id: row.id, decision: "approve" }], { always: true });
    expect(fx.actions[0].status).toBe("EXECUTED");
    expect(fx.settings.size).toBe(0);
  });

  it("stores nothing without the choice", async () => {
    const row = talkPost();
    await decideActions(viewer, [{ id: row.id, decision: "approve" }]);
    expect(fx.settings.size).toBe(0);
  });
});

describe("sweepActions", () => {
  it("expires what waited too long, with one line per chat naming them, and marks their notifications read", async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 1000);
    const a = talkPost({ expiresAt: past, preview: { title: "Post in #general" } });
    const b = talkPost({ expiresAt: past, preview: { title: "Post in #proof" } });
    const c = talkPost({ expiresAt: past, sessionId: "s2", actingForId: "max", preview: { title: "Send kudos to Lea" } });
    const live = talkPost();
    const decided = talkPost({ expiresAt: past, status: "DENIED" });
    const out = await sweepActions(now);
    expect(out).toEqual({ expired: 3, stuck: 0 });
    expect([a, b, c, live, decided].map((r) => fx.actions.find((x) => x.id === r.id)?.status)).toEqual(["EXPIRED", "EXPIRED", "EXPIRED", "PENDING", "DENIED"]);
    expect(fx.messages.map((m) => [m.sessionId, m.content])).toEqual([
      ["s1", "Expired without an answer: Post in #general and Post in #proof"],
      ["s2", "Expired without an answer: Send kudos to Lea"],
    ]);
    expect(fx.notifications.map((n) => n.where)).toEqual([
      { userId: "me", link: { in: [actionHref(AGENT_SLUG, a.id), actionHref(AGENT_SLUG, b.id)] }, read: false },
      { userId: "max", link: { in: [actionHref(AGENT_SLUG, c.id)] }, read: false },
    ]);
    expect(fx.handlerCalls).toEqual([]);
  });

  it("fails a request stuck RUNNING, and it never runs again", async () => {
    const now = new Date();
    const stuck = talkPost({ status: "RUNNING", decidedAt: new Date(now.getTime() - RUNNING_STUCK_MS - 1000) });
    const busy = talkPost({ status: "RUNNING", decidedAt: new Date(now.getTime() - 60_000) });
    const out = await sweepActions(now);
    expect(out).toEqual({ expired: 0, stuck: 1 });
    expect(fx.actions.find((r) => r.id === stuck.id)).toMatchObject({ status: "FAILED", error: "Couldn't confirm it finished." });
    expect(fx.actions.find((r) => r.id === busy.id)?.status).toBe("RUNNING");
    const again = await decideActions(viewer, [{ id: stuck.id, decision: "approve" }]);
    expect(again.results).toEqual([{ id: stuck.id, status: "FAILED", code: "already_decided" }]);
    expect(fx.handlerCalls).toEqual([]);
  });
});

describe("telling the person's other tabs (agent.changed)", () => {
  it("publishes once per teammate after the decisions settle, and nothing for an id that is not theirs", async () => {
    const a = talkPost();
    const b = talkPost();
    const theirs = talkPost({ actingForId: "max" });
    await decideActions(viewer, [{ id: a.id, decision: "deny" }, { id: b.id, decision: "approve" }, { id: theirs.id, decision: "deny" }]);
    expect(sent("agent.changed")).toEqual([{ userId: "me", event: { type: "agent.changed", agentId: "a1" } }]);

    published.length = 0;
    await decideActions(viewer, [{ id: theirs.id, decision: "approve" }, { id: "nope", decision: "deny" }]);
    expect(published).toEqual([]);
  });

  it("publishes once per person and teammate after a sweep expires their requests", async () => {
    const past = new Date(Date.now() - 1000);
    talkPost({ expiresAt: past });
    talkPost({ expiresAt: past });
    talkPost({ expiresAt: past, agentId: "a2", sessionId: "s3" });
    talkPost({ expiresAt: past, actingForId: "max", sessionId: "s2" });
    talkPost();
    await sweepActions(new Date());
    expect(sent("agent.changed")).toEqual([
      { userId: "me", event: { type: "agent.changed", agentId: "a1" } },
      { userId: "me", event: { type: "agent.changed", agentId: "a2" } },
      { userId: "max", event: { type: "agent.changed", agentId: "a1" } },
    ]);

    published.length = 0;
    await sweepActions(new Date());
    expect(published).toEqual([]);
  });
});

describe("telling the person's bell and Inbox (notification)", () => {
  it("publishes when a decision marked an Inbox row read, and nothing when no row was unread", async () => {
    const a = talkPost();
    await decideActions(viewer, [{ id: a.id, decision: "deny" }]);
    expect(sent("notification")).toEqual([{ userId: "me", event: { type: "notification" } }]);

    published.length = 0;
    const none = vi.spyOn(prismaFake.notification, "updateMany").mockResolvedValueOnce({ count: 0 });
    const b = talkPost();
    await decideActions(viewer, [{ id: b.id, decision: "deny" }]);
    expect(sent("notification")).toEqual([]);
    none.mockRestore();
  });

  it("publishes for each person whose rows a sweep marked read", async () => {
    const past = new Date(Date.now() - 1000);
    talkPost({ expiresAt: past });
    talkPost({ expiresAt: past, actingForId: "max", sessionId: "s2" });
    await sweepActions(new Date());
    expect(sent("notification")).toEqual([
      { userId: "me", event: { type: "notification" } },
      { userId: "max", event: { type: "notification" } },
    ]);
  });
});

describe("claimUnreportedOutcomes", () => {
  it("claims a chat's decided outcomes in one statement, oldest first, and only once", async () => {
    const older = talkPost({ status: "DENIED", createdAt: new Date(Date.now() - 60_000) });
    const newer = talkPost({ status: "EXECUTED" });
    talkPost({ status: "PENDING" });
    talkPost({ status: "EXECUTED", sessionId: "s2" });
    talkPost({ status: "FAILED", reportedAt: new Date() });
    const first = await claimUnreportedOutcomes("s1");
    expect(first.map((r) => r.id)).toEqual([older.id, newer.id]);
    expect(await claimUnreportedOutcomes("s1")).toEqual([]);
    expect(fx.sql[0]).toMatch(/^\s*UPDATE "AgentAction"[\s\S]*"reportedAt" IS NULL[\s\S]*RETURNING/);
  });
});

describe("reading the cards", () => {
  it("shows a person only their own cards, and one past its time as expired", async () => {
    const mine = talkPost();
    const overdue = talkPost({ expiresAt: new Date(Date.now() - 1000) });
    const theirs = talkPost({ actingForId: "max" });
    const views = await actionViews([mine.id, overdue.id, theirs.id, mine.id], "me");
    expect(Object.keys(views).sort()).toEqual([mine.id, overdue.id].sort());
    expect(views[mine.id]).toMatchObject({ status: "PENDING", always: { allowed: true } });
    expect(views[overdue.id]).toMatchObject({ status: "EXPIRED", always: { allowed: false, label: null } });
  });

  it("reads each card's editable field from the input that runs, so Edit never starts from the card's shortened words", async () => {
    const reads = vi.spyOn(prismaFake.agentAction, "findMany");
    try {
      const doc = seedAction({
        toolName: "update_doc",
        input: { docId: "d1", heading: "Weekly status", text: "All green." },
        preview: { title: 'Add to "Plan"', body: "Weekly status\n\nAll green.", editable: { field: "text", label: "Text", maxLength: 8000 } },
      });
      const views = await actionViews([doc.id], "me");
      expect(views[doc.id].editableValue).toBe("All green.");
      // The card's read selects the input (the double hands back whole rows, so this is what proves it).
      expect(reads.mock.calls[0][0]).toMatchObject({ select: { input: true, editedInput: true } });
    } finally {
      reads.mockRestore();
    }
  });

  it("counts what waits for the person now", async () => {
    talkPost();
    talkPost({ expiresAt: new Date(Date.now() - 1000) });
    talkPost({ actingForId: "max" });
    talkPost({ status: "EXECUTED" });
    expect(await waitingCount("org", "me")).toBe(1);
  });
});

describe("cancelPendingActionsOf: a removed teammate", () => {
  it("cancels what still waits, everyone's, with the reason its card shows, and runs nothing", async () => {
    const mine = talkPost();
    const theirs = talkPost({ actingForId: "max" });
    const done = talkPost({ status: "EXECUTED" });
    const otherTeammate = talkPost({ agentId: "a2" });
    expect(await cancelPendingActionsOf({ id: "a1", slug: AGENT_SLUG, name: "Chief of Staff" })).toBe(2);
    expect(fx.actions.map((r) => [r.id, r.status])).toEqual([
      [mine.id, "CANCELLED"],
      [theirs.id, "CANCELLED"],
      [done.id, "EXECUTED"],
      [otherTeammate.id, "PENDING"],
    ]);
    expect(fx.actions[0]).toMatchObject({ decidedVia: "system", error: "Cancelled: Chief of Staff was removed." });
    // Each person's Inbox notifications for their cards are marked read; no line is written.
    expect(fx.notifications.map((n) => n.where)).toEqual([
      { userId: "me", link: { in: [actionHref(AGENT_SLUG, mine.id)] }, read: false },
      { userId: "max", link: { in: [actionHref(AGENT_SLUG, theirs.id)] }, read: false },
    ]);
    expect(fx.messages).toEqual([]);
    expect(fx.handlerCalls).toEqual([]);
  });
});

describe("Ask AI's own requests (no teammate, follow-up 1.5c)", () => {
  function askAiPost(o: Partial<ActionRowFx> = {}) {
    return seedAction({ toolName: "send_kudos", agentId: null, sessionId: "s9", input: { email: "max@x.com", message: "Thanks" }, preview: { title: "Send kudos to Max" }, ...o });
  }

  it("can be denied, writes its line into its chat, and marks no teammate's link", async () => {
    const row = askAiPost();
    const out = await decideActions(viewer, [{ id: row.id, decision: "deny" }]);
    expect(out).toEqual({ results: [{ id: row.id, status: "DENIED" }], resume: false, agentSlug: null });
    expect(fx.messages).toEqual([expect.objectContaining({ sessionId: "s9", kind: "EVENT", content: "You said no: Send kudos to Max" })]);
    expect(fx.notifications.at(-1)?.where).toMatchObject({ link: { in: [`/sidekick?session=s9&action=${row.id}`] } });
    expect(sent("agent.changed")).toEqual([{ userId: "me", event: { type: "agent.changed", agentId: "ask-ai" } }]);
  });

  it("waits, with Ask AI's own sentence, while the person cannot be acted for", async () => {
    const row = askAiPost();
    fx.person = { ok: false, reason: "inactive" };
    const out = await decideActions(viewer, [{ id: row.id, decision: "approve" }]);
    expect(out.results).toEqual([{ id: row.id, status: "PENDING", code: "person_cannot", error: "Ask AI can't act for you in this workspace now." }]);
    expect(fx.handlerCalls).toEqual([]);
  });

  it("checks the tool against the chat's offer now: a product tool only where the chat's product has it", async () => {
    const kra = seedAction({ toolName: "create_kra", agentId: null, sessionId: "s9", input: { title: "Grow" }, preview: { title: "Create KRA" } });
    fx.chat = { productContext: null, agent: null };
    const out = await decideActions(viewer, [{ id: kra.id, decision: "approve" }]);
    expect(out.results[0]).toMatchObject({ status: "CANCELLED", code: "tool_off" });
    const again = seedAction({ toolName: "create_kra", agentId: null, sessionId: "s8", input: { title: "Grow" }, preview: { title: "Create KRA" } });
    fx.chat = { productContext: "workwrk-people", agent: null };
    const ran = await decideActions(viewer, [{ id: again.id, decision: "approve" }]);
    expect(ran.results[0]).toMatchObject({ status: "EXECUTED" });
  });

  it("expires in the sweep like any request, published under Ask AI's key", async () => {
    askAiPost({ expiresAt: new Date(Date.now() - 1000) });
    await sweepActions(new Date());
    expect(fx.actions[0].status).toBe("EXPIRED");
    expect(sent("agent.changed")).toEqual([{ userId: "me", event: { type: "agent.changed", agentId: "ask-ai" } }]);
  });

  it("is never counted on AI teammates, but always against the person's limit", async () => {
    askAiPost();
    talkPost();
    expect(await waitingCount("org", "me")).toBe(2);
    expect(await waitingCount("org", "me", new Date(), { teammatesOnly: true })).toBe(1);
  });
});
