// Ask AI's and an AI teammate's create_task (src/lib/agents/tools.ts).
// Docs-found fixes batch 5: the task it made dispatched no task.created, so
// a webhook subscriber mirroring every task, and every "When a task is
// created" automation, silently missed each task a person asked AI to make.
// It now sends the event a task added to a List in the app sends, and an
// event that can't be sent never fails the task.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  events: [] as Array<{ organizationId: string; event: string; payload: Record<string, unknown> }>,
  made: [] as Array<Record<string, unknown>>,
  failDispatch: false,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findFirst: async (a: { where: { email: string } }) => (a.where.email === "priya@x.test" ? { id: "priya", firstName: "Priya", lastName: "Shah" } : null) } },
}));
vi.mock("@/lib/work/personal-task", () => ({
  createPersonalTask: async (input: Record<string, unknown>) => {
    st.made.push(input);
    return { id: "item-1", boardId: "personal-1", title: input.title, status: "TO_DO", dueAt: input.dueAt, priority: input.priority, assigneeId: input.assigneeId };
  },
}));
vi.mock("@/services/webhookDispatcher", () => ({
  dispatchEvent: async (e: { organizationId: string; event: string; payload: Record<string, unknown> }) => {
    if (st.failDispatch) throw new Error("no subscriptions table");
    st.events.push(e);
  },
}));

const { TOOLS } = await import("./tools");
const ctx = { orgId: "org-1", userId: "me" };

beforeEach(() => {
  st.events = [];
  st.made = [];
  st.failDispatch = false;
});

describe("create_task", () => {
  it("sends task.created with the flat payload a List add sends, the person who asked as the actor", async () => {
    const out = (await TOOLS.create_task.handler(ctx, { title: "Call Acme", priority: "HIGH", dueIsoDate: "2026-10-20", assigneeEmail: "priya@x.test" })) as { ok: boolean; task: { id: string } };
    expect(out).toMatchObject({ ok: true, task: { id: "item-1" } });
    await Promise.resolve();
    expect(st.events).toHaveLength(1);
    expect(st.events[0]).toMatchObject({
      organizationId: "org-1",
      event: "task.created",
      payload: { id: "item-1", boardId: "personal-1", title: "Call Acme", status: "TO_DO", ownerId: "priya", assigneeId: "priya", priority: "HIGH", actorId: "me" },
    });
    expect(st.events[0].payload.dueAt).toEqual(new Date("2026-10-20"));
    expect(st.events[0].payload.createdAt).toBeInstanceOf(Date);
  });

  it("still makes the task, and says so, when the event can't be sent", async () => {
    st.failDispatch = true;
    const out = await TOOLS.create_task.handler(ctx, { title: "Call Acme" });
    expect(out).toMatchObject({ ok: true });
    expect(st.made).toHaveLength(1);
  });

  it("sends nothing for a task it did not make", async () => {
    const out = await TOOLS.create_task.handler(ctx, { title: "Call Acme", assigneeEmail: "nobody@x.test" });
    expect(out).toHaveProperty("error");
    expect(st.made).toEqual([]);
    expect(st.events).toEqual([]);
  });
});

describe("what task.created says it covers", () => {
  it("names the tasks Ask AI and AI teammates make among the ones that fire it, in the webhook list and the docs", async () => {
    const { WEBHOOK_EVENTS } = await import("@/lib/webhook-events");
    const said = WEBHOOK_EVENTS.find((e) => e.name === "task.created")!.description;
    const [fires, notFired] = said.split("Not fired for");
    expect(fires).toMatch(/a task Ask AI or an AI teammate makes/);
    expect(notFired).not.toMatch(/teammate|Ask AI/);
    const { readFileSync } = await import("node:fs");
    const docs = readFileSync("docs/product/reference/how-it-connects.mdx", "utf8");
    const row = docs.split("\n").find((l) => l.startsWith("| `task.created` |"))!;
    expect(row.split("Not from")[0]).toMatch(/Ask AI or an AI teammate/);
    expect(row.split("Not from")[1]).not.toMatch(/teammate/);
  });
});
