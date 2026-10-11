// The reminder digests (/api/email/send-reminders): read per live workspace,
// every row a page at a time, done tasks left out by the read itself, 50
// lines per digest with the full count said, and only to a manager who is in
// the workspace.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  orgWheres: [] as unknown[],
  itemWheres: [] as Array<Record<string, unknown>>,
  items: new Map<string, Array<{ id: string; title: string; dueAt: Date; status: string | null; boardId: string; ownerId: string | null; assigneeIds?: string[]; itemType?: string; board?: { folderId: string | null; spaceId: string | null } }>>(),
  /** Extra Lists of o1, beside the two below (the hidden Meetings List, Lists in archived places). */
  extraBoards: [] as Array<Record<string, unknown>>,
  spaces: [] as Array<{ id: string; parentSpaceId: string | null; archivedAt: Date | null }>,
  folders: [] as Array<{ id: string; parentFolderId: string | null; spaceId: string; archivedAt: Date | null }>,
  /** The people the sweeps read, by id (u1 by default). */
  people: {} as Record<string, { id: string; email: string; firstName: string; lastName: string; deletedAt: Date | null; status: string; organizationId: string; organizationMemberships: Array<{ id: string }> }>,
  /** home.notifications.muted[] per person, for the per-object mute. */
  muted: {} as Record<string, string[]>,
  notified: [] as Array<{ userId: string; type: string; link: string; createdAt?: Date }>,
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
              ...db.extraBoards,
            ]
          : [],
    },
    space: { findMany: async () => db.spaces },
    folder: { findMany: async () => db.folders },
    item: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        db.itemWheres.push(where);
        return db.items.get(String(where.organizationId)) ?? [];
      },
    },
    user: {
      // The live-person filter is the route's own, checked again on what
      // comes back, so the mock hands back everyone it is asked for.
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => db.people[id]).map((id) => ({ ...db.people[id], manager: db.manager })),
    },
    userPreference: {
      findMany: async ({ where }: { where: { userId: { in: string[] } } }) =>
        where.userId.in.filter((id) => db.muted[id]).map((userId) => ({ userId, home: { notifications: { muted: db.muted[userId] } } })),
    },
    notification: {
      createMany: async ({ data }: { data: Array<{ userId: string; type: string; link: string }> }) => {
        db.notified.push(...data.map((d) => ({ ...d, createdAt: new Date() })));
        return { count: data.length };
      },
      findMany: async ({ where }: { where: { userId: { in: string[] }; type: string; createdAt: { gte: Date } } }) =>
        db.notified.filter((n) => where.userId.in.includes(n.userId) && n.type === where.type && (n.createdAt ?? new Date(0)) >= where.createdAt.gte),
    },
  },
}));
vi.mock("@/lib/email", () => ({
  sendEmail: async (e: { to: string; subject: string; html: string; organizationId?: string; variables?: { count?: number } }) => {
    db.sent.push({ to: e.to, organizationId: e.organizationId, count: e.variables?.count, rows: (e.html.match(/d overdue/g) ?? []).length, subject: e.subject, html: e.html });
  },
}));
// The inbox switches all on; the per-object mute is the real one, over the
// userPreference rows above.
vi.mock("@/lib/notify-prefs", async () => ({
  ...(await vi.importActual<object>("@/lib/notify-prefs")),
  filterNotifyUsers: async (ids: string[]) => new Set(ids),
}));
vi.mock("@/lib/policy-remind", () => ({ remindPolicyAssignmentsDue: async () => ({ orgs: 0, reminded: 0 }) }));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));

import { POST } from "./route";

const run = (type: string) => POST(new Request("https://app.example.test/api/email/send-reminders", { method: "POST", body: JSON.stringify({ type }) }) as never);

beforeEach(() => {
  db.orgWheres.length = 0;
  db.itemWheres.length = 0;
  db.items.clear();
  db.sent.length = 0;
  db.muted = {};
  db.notified.length = 0;
  db.extraBoards = [];
  db.spaces = [];
  db.folders = [];
  const person = (id: string, firstName: string) => ({ id, email: `${id}@example.test`, firstName, lastName: "One", deletedAt: null, status: "ACTIVE", organizationId: "o1", organizationMemberships: [] });
  db.people = { u1: person("u1", "Uma"), u2: person("u2", "Ugo"), u3: person("u3", "Ula") };
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

// Docs-found fixes batch 2: the Muted items card says muting a Space, Folder
// or List stops its due-date updates, and every other task notification
// honoured that (notify-item.ts), but the due-today run did not.
describe("tasks due today", () => {
  const today = () => new Date();

  it("tells the owner about an open task due today", async () => {
    db.items.set("o1", [{ id: "t1", title: "Ship it", dueAt: today(), status: "TO_DO", boardId: "b-default", ownerId: "u1", board: { folderId: "f1", spaceId: "s1" } }]);
    await run("tasks-due-today");
    expect(db.notified).toEqual([expect.objectContaining({ userId: "u1", type: "task_due_today", link: "/item/t1" })]);
  });

  it("says nothing about a task in a List, Folder or Space its owner muted", async () => {
    db.items.set("o1", [
      { id: "in-muted-space", title: "A", dueAt: today(), status: "TO_DO", boardId: "b-default", ownerId: "u1", board: { folderId: null, spaceId: "s1" } },
      { id: "in-muted-folder", title: "B", dueAt: today(), status: "TO_DO", boardId: "b-custom", ownerId: "u1", board: { folderId: "f9", spaceId: "s2" } },
      { id: "in-muted-list", title: "C", dueAt: today(), status: "OPEN", boardId: "b-custom", ownerId: "u2", board: { folderId: null, spaceId: "s3" } },
      { id: "elsewhere", title: "D", dueAt: today(), status: "TO_DO", boardId: "b-default", ownerId: "u2", board: { folderId: null, spaceId: "s2" } },
    ]);
    db.muted = { u1: ["space:s1", "folder:f9"], u2: ["list:b-custom"] };
    await run("tasks-due-today");
    expect(db.notified.map((n) => n.link)).toEqual(["/item/elsewhere"]);
  });
});

// Docs-found fixes batch 3 (src/lib/reminder-sweep.ts): the sweeps counted a
// meeting's Item on the hidden Meetings List as a task, so a meeting's
// creator got "Task Due Today" rows and their manager's Monday email listed
// private meeting titles. They also counted tasks in archived places, told
// only the first assignee, told people who were removed or deactivated, and
// a second run the same day wrote every due-today row again.
describe("which tasks the sweeps count, and who hears of them", () => {
  const today = () => new Date();
  const lastWeek = () => new Date(Date.now() - 7 * 86_400_000);
  const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Title ${id}`, dueAt: today(), status: "TO_DO", boardId: "b-default", ownerId: "u1", board: { folderId: null, spaceId: null }, ...extra });

  it("never counts a meeting's Item: due today stays quiet and the digest never names it", async () => {
    db.extraBoards = [{ id: "b-meetings", statuses: null, settings: { system: true, hidden: true, source: "meetings" }, itemType: "meeting" }];
    db.items.set("o1", [
      task("meet-hidden", { title: "HR: concerns about my manager", boardId: "b-meetings", itemType: "meeting", status: null }),
      task("meet-stray", { title: "1:1 with HR", itemType: "meeting", status: null }),
      task("real", { itemType: "studio-item" }),
    ]);
    await run("tasks-due-today");
    expect(db.notified.map((n) => n.link)).toEqual(["/item/real"]);
    // The read leaves them out too, and the hidden List is in none of its groups.
    expect(db.itemWheres[0].itemType).toEqual({ notIn: ["meeting"] });
    const grouped = (db.itemWheres[0].OR as Array<{ boardId: { in: string[] } }>).flatMap((g) => g.boardId.in);
    expect(grouped).not.toContain("b-meetings");

    db.items.set("o1", [
      task("meet-hidden", { title: "HR: concerns about my manager", boardId: "b-meetings", itemType: "meeting", status: null, dueAt: lastWeek() }),
      task("meet-stray", { title: "1:1 with HR", itemType: "meeting", status: null, dueAt: lastWeek() }),
      task("late", { title: "Late report", dueAt: lastWeek() }),
    ]);
    await run("overdue-tasks");
    expect(db.sent).toHaveLength(1);
    expect(db.sent[0]).toMatchObject({ count: 1, rows: 1 });
    expect(db.sent[0].html).toContain("Late report");
    expect(db.sent[0].html).not.toContain("HR");
  });

  it("leaves out tasks in an archived List's place: a Space, a Folder, or any one above them", async () => {
    const gone = new Date("2026-09-01T00:00:00Z");
    db.spaces = [
      { id: "s-live", parentSpaceId: null, archivedAt: null },
      { id: "s-archived", parentSpaceId: null, archivedAt: gone },
      { id: "s-child", parentSpaceId: "s-archived", archivedAt: null },
    ];
    db.folders = [
      { id: "f-live", parentFolderId: null, spaceId: "s-live", archivedAt: null },
      { id: "f-archived", parentFolderId: null, spaceId: "s-live", archivedAt: gone },
      { id: "f-child", parentFolderId: "f-archived", spaceId: "s-live", archivedAt: null },
    ];
    db.extraBoards = [
      { id: "b-live", statuses: null, spaceId: "s-live", folderId: "f-live" },
      { id: "b-in-archived-space", statuses: null, spaceId: "s-archived", folderId: null },
      { id: "b-in-child-space", statuses: null, spaceId: "s-child", folderId: null },
      { id: "b-in-archived-folder", statuses: null, spaceId: "s-live", folderId: "f-archived" },
      { id: "b-in-child-folder", statuses: null, spaceId: "s-live", folderId: "f-child" },
    ];
    const ids = ["b-live", "b-in-archived-space", "b-in-child-space", "b-in-archived-folder", "b-in-child-folder"];
    db.items.set("o1", ids.map((b) => task(b, { boardId: b })));
    await run("tasks-due-today");
    expect(db.notified.map((n) => n.link)).toEqual(["/item/b-live"]);

    db.items.set("o1", ids.map((b) => task(b, { boardId: b, title: `Late ${b}`, dueAt: lastWeek() })));
    await run("overdue-tasks");
    expect(db.sent[0]).toMatchObject({ count: 1, rows: 1 });
    expect(db.sent[0].html).toContain("Late b-live");
  });

  it("tells every assignee of a task due today, each once, and a task with no first assignee too", async () => {
    db.items.set("o1", [
      task("shared", { ownerId: "u1", assigneeIds: ["u1", "u2", "u3"] }),
      task("no-owner", { ownerId: null, assigneeIds: ["u2"] }),
    ]);
    await run("tasks-due-today");
    expect(db.notified.map((n) => `${n.userId} ${n.link}`).sort()).toEqual([
      "u1 /item/shared", "u2 /item/no-owner", "u2 /item/shared", "u3 /item/shared",
    ]);
  });

  it("tells no one who was removed, deactivated or is not in this workspace", async () => {
    db.people.u2 = { ...db.people.u2, deletedAt: new Date() };
    db.people.u3 = { ...db.people.u3, status: "INACTIVE" };
    db.people.u4 = { ...db.people.u1, id: "u4", organizationId: "agency" };
    db.people.u5 = { ...db.people.u1, id: "u5", organizationId: "agency", organizationMemberships: [{ id: "mem" }] };
    db.items.set("o1", [task("t", { ownerId: "u1", assigneeIds: ["u1", "u2", "u3", "u4", "u5"] })]);
    await run("tasks-due-today");
    expect(db.notified.map((n) => n.userId).sort()).toEqual(["u1", "u5"]);
  });

  it("writes due today once a day per person and task, however many times it runs", async () => {
    db.items.set("o1", [task("a"), task("b", { assigneeIds: ["u1", "u2"] })]);
    await run("tasks-due-today");
    expect(db.notified).toHaveLength(3);
    await run("tasks-due-today");
    expect(db.notified).toHaveLength(3);
    // A row from an earlier day never stands in for today's.
    for (const n of db.notified) n.createdAt = new Date(Date.now() - 2 * 86_400_000);
    await run("tasks-due-today");
    expect(db.notified).toHaveLength(6);
  });

  it("names every assignee in their manager's overdue digest", async () => {
    db.items.set("o1", [task("late", { title: "Late together", dueAt: lastWeek(), ownerId: "u1", assigneeIds: ["u1", "u2"] })]);
    await run("overdue-tasks");
    expect(db.sent).toHaveLength(1);
    expect(db.sent[0]).toMatchObject({ count: 2, rows: 2 });
    expect(db.sent[0].html).toContain("Uma One");
    expect(db.sent[0].html).toContain("Ugo One");
  });
});
