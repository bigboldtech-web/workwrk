// Where a teammate step's answer may go (docs/plans/ai-teammates-phase2.md
// step 7): {{teammate.answer}} fills a task's title, but never an email to an
// address outside the workspace or what a webhook is sent.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const st = vi.hoisted(() => ({ created: [] as Row[], emails: [] as Row[], hooks: [] as Row[], notes: [] as Row[], guests: new Set<string>() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    board: { findFirst: async () => ({ id: "b1", schema: { fields: [{ key: "sev", type: "DROPDOWN", options: { choices: [{ value: "s1", label: "Sev 1" }] } }] } }) },
    item: { findFirst: async () => ({ id: "i0", boardId: "b1", title: "T", status: null, ownerId: null, priority: null, archivedAt: null, metadata: {} }) },
    user: { findFirst: async (a: { where: { id: string } }) => ({ id: a.where.id, email: `${a.where.id}@x.test`, firstName: "G", lastName: "H", status: "ACTIVE" }) },
    notification: { create: async (a: { data: Row }) => (st.notes.push(a.data), { id: "n1" }) },
  },
}));
vi.mock("@/lib/board-items", () => ({
  createBoardItem: async (a: Row) => (st.created.push(a), { id: "i1", boardId: "b1", title: a.title, status: null, ownerId: null, priority: null, dueAt: null, createdAt: new Date() }),
  archiveBoardItem: async () => {},
  moveBoardItem: async () => {},
  updateBoardItem: async () => {},
  getBoardStatuses: () => [],
}));
vi.mock("@/lib/email", () => ({ queueEmail: async (a: Row) => void st.emails.push(a) }));
vi.mock("@/services/webhookDispatcher", () => ({ dispatchEvent: async () => {} }));
vi.mock("@/lib/access/guests", () => ({ anyGuestHere: async (_org: string, ids: string[]) => ids.some((i) => st.guests.has(i)) }));
vi.mock("./webhook-server", () => ({ sendThroughWebhook: async (_org: string, _ev: string, body: Row) => (st.hooks.push(body), { ok: true, httpStatus: 200, durationMs: 1 }) }));

import { getAction, interpolate, type ActionContext } from "./registry-actions";

const ctx = (extra: Partial<ActionContext> = {}): ActionContext => ({
  organizationId: "org1",
  eventKey: "task.created",
  payload: { title: "Printer down" },
  recordId: "i0",
  recordType: "task",
  workflowId: "wf1",
  runId: "run1",
  depth: 0,
  stepData: { teammate: { answer: "Restart the print server.", name: "Triage" } },
  ...extra,
});

beforeEach(() => {
  st.created = [];
  st.emails = [];
  st.hooks = [];
  st.notes = [];
  st.guests = new Set();
});

describe("{{teammate.answer}}", () => {
  it("fills a task's title", async () => {
    await getAction("create_task")!.execute(ctx(), { boardId: "b1", title: "{{teammate.name}}: {{teammate.answer}} ({{title}})" });
    expect(st.created[0].title).toBe("Triage: Restart the print server. (Printer down)");
  });

  it("never goes to an outside address: the email is not sent (review round 2)", async () => {
    await expect(getAction("send_email")!.execute(ctx(), { to: "someone@outside.test", subject: "Re {{title}}: {{teammate.answer}}", body: "{{teammate.answer}} for {{title}}" })).rejects.toThrow("only to members");
    expect(st.emails).toEqual([]);
    // One that does not use the answer still goes.
    await getAction("send_email")!.execute(ctx(), { to: "someone@outside.test", subject: "Re {{title}}", body: "Seen." });
    expect(st.emails[0]).toMatchObject({ to: "someone@outside.test", subject: "Re Printer down" });
  });

  it("never assigns a task titled with the answer to a Guest (review round 2)", async () => {
    st.guests = new Set(["u-gil"]);
    await expect(getAction("create_task")!.execute(ctx(), { boardId: "b1", title: "{{teammate.answer}}", ownerId: "u-gil" })).rejects.toThrow("never sent to Guests");
    expect(st.created).toEqual([]);
  });

  it("never reaches what a webhook is sent", async () => {
    await getAction("send_webhook")!.execute(ctx(), { note: "{{teammate.answer}}" });
    expect(JSON.stringify(st.hooks[0])).not.toContain("Restart the print server");
    expect((st.hooks[0].data as Row).teammate).toBeUndefined();
  });

  it("fails a step that needs an answer when no teammate step before it answered, and posts nothing", async () => {
    await expect(getAction("create_task")!.execute(ctx({ stepData: { teammateFailed: true } }), { boardId: "b1", title: "{{teammate.name}} says: {{teammate.answer}}" })).rejects.toThrow(
      "the AI teammate step before it didn't answer",
    );
    // With no teammate step before it at all, it says that instead (review round 4).
    await expect(getAction("create_task")!.execute(ctx({ stepData: {} }), { boardId: "b1", title: "{{teammate.answer}}" })).rejects.toThrow(
      "no AI teammate step comes before it",
    );
    expect(st.created).toEqual([]);
  });

  it("fails a step that needs the answer when the answer was empty", async () => {
    await expect(getAction("create_task")!.execute(ctx({ stepData: { teammate: { answer: "  ", name: "Triage" } } }), { boardId: "b1", title: "{{teammate.answer}}" })).rejects.toThrow(
      "the AI teammate step before it didn't answer",
    );
  });

  it("never repeats the answer in a field's error (the run's errors are read more widely)", async () => {
    const secret = ctx({ stepData: { teammate: { answer: "Acme renewal, 480k, from Max's private Space", name: "Triage" } } });
    for (const field of ["priority", "sev"]) {
      const err = await getAction("set_field")!.execute(secret, { field, value: "{{teammate.answer}}" }).then(() => null, (e: Error) => e.message);
      expect(err).toBe("The AI teammate's answer isn't a value this field takes, so it was left alone.");
    }
    // A value the creator typed keeps its own error.
    const typed = await getAction("set_field")!.execute(secret, { field: "priority", value: "Soon" }).then(() => null, (e: Error) => e.message);
    expect(typed).toContain('"Soon" is not a priority');
  });

  it("never sends the answer to a Guest, by notification or email (review round 1)", async () => {
    st.guests = new Set(["u-gil"]);
    await expect(getAction("create_notification")!.execute(ctx(), { userId: "u-gil", message: "{{teammate.answer}}" })).rejects.toThrow("never sent to Guests");
    await expect(getAction("send_email")!.execute(ctx(), { to: "u-gil", subject: "Re", body: "{{teammate.answer}}" })).rejects.toThrow("never sent to Guests");
    expect(st.notes).toEqual([]);
    expect(st.emails).toEqual([]);
    // A member gets it; a Guest gets a step that does not use it.
    await getAction("create_notification")!.execute(ctx(), { userId: "u-max", message: "{{teammate.answer}}" });
    await getAction("create_notification")!.execute(ctx(), { userId: "u-gil", message: "A task was created" });
    expect(st.notes.map((n) => n.userId)).toEqual(["u-max", "u-gil"]);
  });

  it("never assigns a Guest in a run that asked a teammate (review round 3)", async () => {
    st.guests = new Set(["u-gil"]);
    await expect(getAction("assign_user")!.execute(ctx(), { userId: "u-gil" })).rejects.toThrow("never sent to Guests");
  });

  it("nor where the teammate step failed or comes later in the run (review round 4)", async () => {
    st.guests = new Set(["u-gil"]);
    await expect(getAction("assign_user")!.execute(ctx({ stepData: {}, teammateInRun: true }), { userId: "u-gil" })).rejects.toThrow("never sent to Guests");
    // A run with no teammate step assigns a Guest as before.
    await expect(getAction("assign_user")!.execute(ctx({ stepData: {}, teammateInRun: false }), { userId: "u-gil" })).resolves.toMatchObject({ assigneeId: "u-gil" });
  });

  it("reads as written without an earlier teammate step", () => {
    expect(interpolate("A {{teammate.answer}} B", { title: "x" })).toBe("A  B");
  });
});

describe("the Ask an AI teammate action", () => {
  it("is never retried: a re-run would ask, and spend, again", () => {
    const a = getAction("ask_teammate")!;
    expect(a).toMatchObject({ safeToRetry: false, available: true, category: "AI" });
    expect(a.params.map((p) => [p.key, p.type, p.required])).toEqual([["teammate", "teammate", true], ["request", "text", true]]);
  });
});
