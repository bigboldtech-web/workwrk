// The reminder digests (/api/email/send-reminders): read per live workspace,
// every row a page at a time, done tasks left out by the read itself, 50
// lines per digest with the full count said, and only to a manager who is in
// the workspace.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  orgWheres: [] as unknown[],
  itemWheres: [] as Array<Record<string, unknown>>,
  items: new Map<string, Array<{ id: string; title: string; dueAt: Date; status: string | null; boardId: string; ownerId: string }>>(),
  sent: [] as Array<{ to: string; organizationId?: string; count?: number; rows: number; subject: string; html: string }>,
  manager: { id: "m1", email: "m1@example.test", firstName: "Mia", deletedAt: null as Date | null, status: "ACTIVE", organizationId: "o1", organizationMemberships: [] as Array<{ id: string }> },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findMany: async (a: { where: unknown }) => {
        db.orgWheres.push(a.where);
        return [{ id: "o1" }, { id: "o2" }];
      },
    },
    board: {
      findMany: async ({ where }: { where: { organizationId: string } }) =>
        where.organizationId === "o1"
          ? [
              { id: "b-default", statuses: null },
              { id: "b-custom", statuses: [{ value: "OPEN", label: "Open", color: "#000000", group: "ACTIVE" }, { value: "SHIPPED", label: "Shipped", color: "#000000", group: "DONE" }] },
            ]
          : [],
    },
    item: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        db.itemWheres.push(where);
        return db.items.get(String(where.organizationId)) ?? [];
      },
    },
    user: {
      findMany: async () => [
        { id: "u1", email: "u1@example.test", firstName: "Uma", lastName: "One", manager: db.manager },
      ],
    },
  },
}));
vi.mock("@/lib/email", () => ({
  sendEmail: async (e: { to: string; subject: string; html: string; organizationId?: string; variables?: { count?: number } }) => {
    db.sent.push({ to: e.to, organizationId: e.organizationId, count: e.variables?.count, rows: (e.html.match(/d overdue/g) ?? []).length, subject: e.subject, html: e.html });
  },
}));
vi.mock("@/lib/notify-prefs", () => ({ filterNotifyUsers: async (ids: string[]) => new Set(ids) }));
vi.mock("@/lib/policy-remind", () => ({ remindPolicyAssignmentsDue: async () => ({ orgs: 0, reminded: 0 }) }));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));

import { POST } from "./route";

const run = (type: string) => POST(new Request("https://app.example.test/api/email/send-reminders", { method: "POST", body: JSON.stringify({ type }) }) as never);

beforeEach(() => {
  db.orgWheres.length = 0;
  db.itemWheres.length = 0;
  db.items.clear();
  db.sent.length = 0;
  db.manager = { id: "m1", email: "m1@example.test", firstName: "Mia", deletedAt: null, status: "ACTIVE", organizationId: "o1", organizationMemberships: [] };
});

describe("overdue tasks digest", () => {
  it("reads live workspaces only, one at a time", async () => {
    await run("overdue-tasks");
    expect(db.orgWheres).toEqual([{ status: { in: ["TRIAL", "ACTIVE"] } }]);
    // o2 has no Lists, so it is never read.
    expect(db.itemWheres.map((w) => w.organizationId)).toEqual(["o1"]);
  });

  it("leaves each List's done values out of the read", async () => {
    await run("overdue-tasks");
    const or = db.itemWheres[0].OR as Array<{ boardId: { in: string[] }; OR: unknown[] }>;
    const byBoard = Object.fromEntries(or.map((g) => [g.boardId.in.join(","), g.OR]));
    expect(byBoard["b-default"]).toEqual([{ status: null }, { status: { notIn: ["DONE"] } }]);
    expect(byBoard["b-custom"]).toEqual([{ status: null }, { status: { notIn: ["SHIPPED"] } }]);
  });

  it("sends one digest per manager, tagged with the workspace, at most 50 lines, and says how many there are", async () => {
    const due = new Date(Date.now() - 3 * 86_400_000);
    db.items.set("o1", Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, dueAt: due, status: "TO_DO", boardId: "b-default", ownerId: "u1" })));
    await run("overdue-tasks");
    expect(db.sent).toHaveLength(1);
    expect(db.sent[0]).toMatchObject({ to: "m1@example.test", organizationId: "o1", count: 60, rows: 50 });
    expect(db.sent[0].subject).toBe("60 overdue items from your team");
    expect(db.sent[0].html).toContain("Showing the 50 oldest of 60.");
  });

  it("sends nothing to a manager who is not in the workspace, and sends to one who is a member", async () => {
    const due = new Date(Date.now() - 86_400_000);
    db.items.set("o1", [{ id: "a", title: "Client task", dueAt: due, status: "TO_DO", boardId: "b-default", ownerId: "u1" }]);
    db.manager = { ...db.manager, organizationId: "agency" };
    await run("overdue-tasks");
    expect(db.sent).toEqual([]);
    db.manager = { ...db.manager, organizationMemberships: [{ id: "mem1" }] };
    await run("overdue-tasks");
    expect(db.sent).toHaveLength(1);
  });

  it("escapes people's own words in the digest", async () => {
    const due = new Date(Date.now() - 86_400_000);
    db.items.set("o1", [{ id: "a", title: "<img src=x onerror=alert(1)>", dueAt: due, status: "TO_DO", boardId: "b-default", ownerId: "u1" }]);
    await run("overdue-tasks");
    expect(db.sent[0].html).not.toContain("<img src=x");
    expect(db.sent[0].html).toContain("&lt;img src=x");
  });

  it("drops a done row the name rule catches, even when the read let it through", async () => {
    const due = new Date(Date.now() - 86_400_000);
    db.items.set("o1", [
      { id: "a", title: "Open one", dueAt: due, status: "OPEN", boardId: "b-custom", ownerId: "u1" },
      { id: "b", title: "Completed one", dueAt: due, status: "Completed", boardId: "b-custom", ownerId: "u1" },
    ]);
    await run("overdue-tasks");
    expect(db.sent[0]).toMatchObject({ count: 1, rows: 1 });
  });
});
