// Where a teammate step's answer may go (docs/plans/ai-teammates-phase2.md
// step 7): {{teammate.answer}} fills a task's title, but never an email to an
// address outside the workspace or what a webhook is sent.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const st = vi.hoisted(() => ({ created: [] as Row[], emails: [] as Row[], hooks: [] as Row[] }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    board: { findFirst: async () => ({ id: "b1", schema: { fields: [{ key: "sev", type: "DROPDOWN", options: { choices: [{ value: "s1", label: "Sev 1" }] } }] } }) },
    item: { findFirst: async () => ({ id: "i0", boardId: "b1", title: "T", status: null, ownerId: null, priority: null, archivedAt: null, metadata: {} }) },
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
});

describe("{{teammate.answer}}", () => {
  it("fills a task's title", async () => {
    await getAction("create_task")!.execute(ctx(), { boardId: "b1", title: "{{teammate.name}}: {{teammate.answer}} ({{title}})" });
    expect(st.created[0].title).toBe("Triage: Restart the print server. (Printer down)");
  });

  it("stays empty in an email to a raw address", async () => {
    await getAction("send_email")!.execute(ctx(), { to: "someone@outside.test", subject: "Re {{title}}: {{teammate.answer}}", body: "{{teammate.answer}} for {{title}}" });
    expect(st.emails[0]).toMatchObject({ to: "someone@outside.test", subject: "Re Printer down:" });
    expect(JSON.stringify(st.emails[0])).not.toContain("Restart the print server");
  });

  it("never reaches what a webhook is sent", async () => {
    await getAction("send_webhook")!.execute(ctx(), { note: "{{teammate.answer}}" });
    expect(JSON.stringify(st.hooks[0])).not.toContain("Restart the print server");
    expect((st.hooks[0].data as Row).teammate).toBeUndefined();
  });

  it("fails a step that needs an answer when no teammate step before it answered, and posts nothing", async () => {
    await expect(getAction("create_task")!.execute(ctx({ stepData: {} }), { boardId: "b1", title: "{{teammate.name}} says: {{teammate.answer}}" })).rejects.toThrow(
      "no AI teammate step before it answered",
    );
    expect(st.created).toEqual([]);
  });

  it("fails a step that needs the answer when the answer was empty", async () => {
    await expect(getAction("create_task")!.execute(ctx({ stepData: { teammate: { answer: "  ", name: "Triage" } } }), { boardId: "b1", title: "{{teammate.answer}}" })).rejects.toThrow(
      "no AI teammate step before it answered",
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
