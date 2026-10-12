// The reminder digests (/api/email/send-reminders): read per live workspace,
// every row a page at a time, done tasks left out by the read itself, 50
// lines per digest with the full count said, and only to a manager who is in
// the workspace.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOfRow, legacyLevelRow } from "@/lib/access/test-fixtures";

type Person = { id: string; email: string; firstName: string; lastName: string; deletedAt: Date | null; status: string; organizationId: string; organizationMemberships: Array<{ id: string }> };

const db = vi.hoisted(() => ({
  orgWheres: [] as unknown[],
  itemWheres: [] as Array<Record<string, unknown>>,
  items: new Map<string, Array<{ id: string; title: string; dueAt: Date; status: string | null; boardId: string; ownerId: string | null; assigneeIds?: string[]; itemType?: string; board?: { folderId: string | null; spaceId: string | null } }>>(),
  /** Extra Lists of o1, beside the two below (the hidden Meetings List, Lists in archived places). */
  extraBoards: [] as Array<Record<string, unknown>>,
  spaces: [] as Array<{ id: string; parentSpaceId: string | null; archivedAt: Date | null }>,
  folders: [] as Array<{ id: string; parentFolderId: string | null; spaceId: string; archivedAt: Date | null }>,
  /** The people the sweeps read, by id (u1 by default). */
  people: {} as Record<string, Person>,
  /** home.notifications.muted[] per person, for the per-object mute. */
  muted: {} as Record<string, string[]>,
  notified: [] as Array<{ userId: string; type: string; link: string; createdAt?: Date }>,
  sent: [] as Array<{ to: string; organizationId?: string; count?: number; rows: number; subject: string; html: string; variables?: Record<string, unknown> }>,
  /** Everyone's stored manager is m1 unless named here. */
  manager: { id: "m1", email: "m1@example.test", firstName: "Mia", lastName: "Lead", deletedAt: null as Date | null, status: "ACTIVE", organizationId: "o1", organizationMemberships: [] as Array<{ id: string }> },
  /** More people who manage (an Agent, the manager above one), by id. */
  others: {} as Record<string, Person>,
  /** Stored managerId by person, beside the m1 default for db.people. */
  storedManager: {} as Record<string, string | null>,
  /** Levels by person id (EMPLOYEE when absent); held in their own workspace, and in a membership. */
  levels: {} as Record<string, string>,
  /** "manager|List" pairs the manager cannot open (listsEachCanRead's answer). */
  cannotRead: new Set<string>(),
  readCalls: [] as Array<{ viewers: string[]; lists: string[]; pairs: string[] }>,
  locks: [] as string[],
  failCheck: false,
  /** Overdue SOP assignments (each SOP's id is `sop-<assignment id>` unless named). */
  sops: [] as Array<{ id: string; title: string; organizationId: string; userId: string; dueDate: Date; sopId?: string }>,
  /** "manager|SOP" pairs the manager cannot open (sopsEachCanRead's answer), and each call's pairs. */
  cannotReadSop: new Set<string>(),
  sopReadCalls: [] as string[][],
  /** Stored org roles by person (the column a Guest invitation writes). */
  orgRoles: {} as Record<string, string>,
}));

/** Everyone the mock database holds. */
function directory(): Record<string, Person> {
  return { ...db.others, m1: db.manager, ...db.people };
}
function storedManagerOf(id: string): string | null {
  if (id in db.storedManager) return db.storedManager[id];
  return id in db.people ? "m1" : null;
}
const liveRow = (u: Person) => !u.deletedAt && u.status !== "INACTIVE";
const levelOf = (id: string) => db.levels[id] ?? "EMPLOYEE";

vi.mock("@/lib/prisma", () => {
  const client = {
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
      // comes back, so the mock hands back everyone it is asked for (the
      // removed left out where the read asks for deletedAt null).
      findMany: async ({ where }: { where: { deletedAt?: null; directReports?: unknown; managerId?: unknown; organizationId?: string | { not: string }; organizationMemberships?: { some: { organizationId: string } }; id: { in: string[]; gt?: string } } }) => {
        const all = directory();
        const rows = Object.values(all).filter((u) => (where.deletedAt === null ? !u.deletedAt : true));
        // A digest's people who work here through a membership (docs-found
        // fixes batch 5, digest-recipients.ts memberManagersOf): live,
        // anchored elsewhere, a member here, with their stored manager.
        if (where.organizationMemberships) {
          const here = where.organizationMemberships.some.organizationId;
          return where.id.in
            .map((id) => all[id])
            .filter((u) => u && liveRow(u) && u.organizationId !== here && u.organizationMemberships.length > 0)
            .map((u) => ({ id: u.id, managerId: storedManagerOf(u.id) }));
        }
        // The monthly evaluation before batch 4: every manager with a live report.
        if (where.directReports) {
          return rows
            .filter((m) => liveRow(m))
            .map((m) => ({ ...m, directReports: Object.values(all).filter((r) => storedManagerOf(r.id) === m.id && liveRow(r)).map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, organizationId: r.organizationId })) }))
            .filter((m) => m.directReports.length > 0);
        }
        // The monthly evaluation now: a workspace's live people with a stored manager, a page at a time.
        if (where.managerId) {
          return rows
            .filter((u) => u.organizationId === where.organizationId && liveRow(u) && storedManagerOf(u.id) && (!where.id?.gt || u.id > where.id.gt))
            .sort((a, b) => (a.id < b.id ? -1 : 1));
        }
        const ids: string[] = where.id.in;
        return ids
          .filter((id) => rows.some((u) => u.id === id))
          .map((id) => ({ ...all[id], ...legacyLevelRow(levelOf(id)), orgRole: db.orgRoles[id] ?? null, managerId: storedManagerOf(id), manager: all[storedManagerOf(id) ?? ""] ?? null }));
      },
    },
    organizationMembership: {
      findMany: async ({ where }: { where: { organizationId: string; userId: { in: string[] } } }) =>
        where.userId.in.filter((id) => (directory()[id]?.organizationMemberships.length ?? 0) > 0).map((userId) => ({ userId, role: levelOf(userId) })),
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
      findMany: async ({ where }: { where: { userId: { in: string[] }; type: string; createdAt: { gte: Date } } }) => {
        if (db.failCheck) throw new Error("connection reset");
        return db.notified.filter((n) => where.userId.in.includes(n.userId) && n.type === where.type && (n.createdAt ?? new Date(0)) >= where.createdAt.gte);
      },
    },
    sOPAssignment: {
      findMany: async ({ where }: { where: { sop: { organizationId: string } } }) =>
        db.sops
          .filter((a) => a.organizationId === where.sop.organizationId)
          .map((a) => ({ id: a.id, dueDate: a.dueDate, sop: { id: a.sopId ?? `sop-${a.id}`, title: a.title, organizationId: a.organizationId }, user: { ...directory()[a.userId], manager: directory()[storedManagerOf(a.userId) ?? ""] ?? null } })),
    },
  };
  // A transaction's advisory lock is a real one here: a second transaction
  // asking for the same key waits until the first one ends.
  const held = new Map<string, Promise<void>>();
  const $transaction = async (fn: (tx: unknown) => unknown) => {
    const releases: Array<() => void> = [];
    const tx = {
      ...client,
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const key = values.join(",");
        db.locks.push(`${strings.join("?")} ${key}`);
        while (held.has(key)) await held.get(key);
        let release = () => {};
        held.set(key, new Promise<void>((r) => { release = () => { held.delete(key); r(); }; }));
        releases.push(release);
        return 1;
      },
    };
    try {
      return await fn(tx);
    } finally {
      for (const r of releases) r();
    }
  };
  return { prisma: { ...client, $transaction } };
});
vi.mock("@/lib/email", () => ({
  sendEmail: async (e: { to: string; subject: string; html: string; organizationId?: string; variables?: { count?: number } }) => {
    db.sent.push({ to: e.to, organizationId: e.organizationId, count: e.variables?.count, rows: (e.html.match(/d overdue/g) ?? []).length, subject: e.subject, html: e.html, variables: e.variables });
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
// The line each person reports on, read as manager-lines.ts reads it: the
// stored manager, or past an Agent the next one up who is none.
vi.mock("@/lib/access/manager-lines", () => ({
  effectiveManagersOf: async (organizationId: string, ids: readonly string[]) => {
    const all = directory();
    const out = new Map<string, string | null>();
    for (const id of ids) {
      if (all[id]?.organizationId !== organizationId) continue;
      let cur = storedManagerOf(id);
      const seen = new Set<string>();
      while (cur && levelOf(cur) === "AGENT" && !seen.has(cur)) {
        seen.add(cur);
        cur = storedManagerOf(cur);
      }
      out.set(id, cur && levelOf(cur) !== "AGENT" ? cur : null);
    }
    return out;
  },
}));
// Which Lists each manager can open: the engine's answer, scripted here
// (src/lib/access/digest-recipients.test.ts runs the real one).
// It answers both shapes: the (manager, List) pairs asked (docs-found fixes
// batch 5), and the managers and Lists of before, read as every pair of them,
// so the earlier tests run unchanged against both.
vi.mock("@/lib/access/digest-recipients", async () => ({
  ...(await vi.importActual<object>("@/lib/access/digest-recipients")),
  listsEachCanRead: async (_org: string, first: Array<{ userId?: string; viewer?: { userId: string }; listId?: string }>, listIds?: Iterable<string>) => {
    const pairs = listIds === undefined
      ? first.map((a) => [a.viewer!.userId, a.listId!] as const)
      : first.flatMap((v) => [...new Set(listIds)].map((b) => [v.userId!, b] as const));
    const viewers = [...new Set(pairs.map(([v]) => v))];
    const lists = [...new Set(pairs.map(([, b]) => b))];
    db.readCalls.push({ viewers, lists, pairs: [...new Set(pairs.map(([v, b]) => `${v}|${b}`))] });
    const out = new Map(viewers.map((v) => [v, new Set<string>()]));
    for (const [v, b] of pairs) if (!db.cannotRead.has(`${v}|${b}`)) out.get(v)!.add(b);
    return out;
  },
  // Which SOPs each manager can open: sop-access.ts's answer, scripted here
  // (src/lib/sop-access.test.ts runs the real one against sopVisibilityWhere).
  sopsEachManagerCanRead: async (_org: string, asks: Array<{ manager: { id: string } & Parameters<typeof legacyLevelOfRow>[0]; sopId: string }>) => {
    db.sopReadCalls.push(asks.map((a) => `${a.manager.id}|${a.sopId}|${legacyLevelOfRow(a.manager)}`));
    const out = new Map<string, Set<string>>();
    for (const a of asks) {
      const set = out.get(a.manager.id) ?? new Set<string>();
      if (!db.cannotReadSop.has(`${a.manager.id}|${a.sopId}`)) set.add(a.sopId);
      out.set(a.manager.id, set);
    }
    return out;
  },
}));

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
  db.manager = { id: "m1", email: "m1@example.test", firstName: "Mia", lastName: "Lead", deletedAt: null, status: "ACTIVE", organizationId: "o1", organizationMemberships: [] };
  db.others = {};
  db.storedManager = {};
  db.levels = {};
  db.cannotRead = new Set();
  db.readCalls = [];
  db.locks = [];
  db.failCheck = false;
  db.sops = [];
  db.cannotReadSop = new Set();
  db.sopReadCalls = [];
  db.orgRoles = {};
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

  it("names every assignee in their manager's overdue digest, on the one line of the task", async () => {
    db.items.set("o1", [task("late", { title: "Late together", dueAt: lastWeek(), ownerId: "u1", assigneeIds: ["u1", "u2"] })]);
    await run("overdue-tasks");
    expect(db.sent).toHaveLength(1);
    // Docs-found fixes batch 4: one task is one overdue item, not one per person.
    expect(db.sent[0]).toMatchObject({ count: 1, rows: 1, subject: "1 overdue item from your team" });
    expect(db.sent[0].html).toContain("Uma One, Ugo One");
  });
});

// Docs-found fixes batch 4 (src/lib/access/digest-recipients.ts): the
// digests went to the STORED manager, so an Agent with reports from before
// rule 6 got their overdue work every Monday; a task's title reached a
// manager who cannot open its List; and two of one manager's people on one
// task read as two overdue items.
describe("who a manager digest goes to, and what it names", () => {
  const lastWeek = () => new Date(Date.now() - 7 * 86_400_000);
  const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Title ${id}`, dueAt: lastWeek(), status: "TO_DO", boardId: "b-default", ownerId: "u1", ...extra });
  const person = (id: string, firstName: string, organizationId = "o1") => ({ id, email: `${id}@example.test`, firstName, lastName: "Lead", deletedAt: null, status: "ACTIVE", organizationId, organizationMemberships: [] as Array<{ id: string }> });
  /** Uma's stored manager is Sam, an Agent from before rule 6, who reports to Mia (m1). */
  const agentLine = () => {
    db.others = { a1: person("a1", "Sam") };
    db.levels = { a1: "AGENT" };
    db.storedManager = { u1: "a1", a1: "m1" };
  };

  it("sends the overdue task digest to the manager above an Agent, never to the Agent", async () => {
    agentLine();
    db.items.set("o1", [task("late", { title: "Quarterly close" })]);
    await run("overdue-tasks");
    expect(db.sent.map((m) => m.to)).toEqual(["m1@example.test"]);
    expect(db.sent[0].html).toContain("Quarterly close");
  });

  it("sends nothing when the line ends at an Agent", async () => {
    agentLine();
    db.storedManager = { u1: "a1", a1: null };
    db.items.set("o1", [task("late")]);
    await run("overdue-tasks");
    expect(db.sent).toEqual([]);
  });

  it("does the same for the overdue SOP digest and the monthly evaluation reminder", async () => {
    agentLine();
    db.sops = [{ id: "as1", title: "Close the books", organizationId: "o1", userId: "u1", dueDate: lastWeek() }];
    await run("overdue-sops");
    // The person's own reminder, and the manager digest to Mia only.
    expect(db.sent.map((m) => m.to).sort()).toEqual(["m1@example.test", "u1@example.test"]);
    db.sent.length = 0;
    await run("monthly-evaluation");
    expect(db.sent.map((m) => m.to)).not.toContain("a1@example.test");
    const mia = db.sent.find((m) => m.to === "m1@example.test")!;
    expect(mia.html).toContain("Uma One");
    expect(mia.organizationId).toBe("o1");
  });

  it("names only tasks the manager can open, and leaves the others out of the count", async () => {
    db.cannotRead = new Set(["m1|b-custom"]);
    db.items.set("o1", [
      task("open", { title: "Visible work" }),
      task("hidden", { title: "HR investigation: Mia", boardId: "b-custom", status: "OPEN" }),
    ]);
    await run("overdue-tasks");
    expect(db.sent).toHaveLength(1);
    expect(db.sent[0]).toMatchObject({ count: 1, rows: 1 });
    expect(db.sent[0].html).toContain("Visible work");
    expect(db.sent[0].html).not.toContain("HR investigation");
  });

  it("tells a co-assignee's manager of a task only when they can open it, or are on it themselves", async () => {
    db.others = { m2: person("m2", "Max") };
    db.storedManager = { u2: "m2", u3: "m2" };
    db.cannotRead = new Set(["m2|b-custom"]);
    db.items.set("o1", [
      task("private", { title: "Private together", boardId: "b-custom", status: "OPEN", ownerId: "u1", assigneeIds: ["u1", "u2"] }),
      task("with-max", { title: "Max is on it", boardId: "b-custom", status: "OPEN", ownerId: "u3", assigneeIds: ["u3", "m2"] }),
    ]);
    await run("overdue-tasks");
    const to = (who: string) => db.sent.find((m) => m.to === who);
    expect(to("m1@example.test")?.html).toContain("Private together");
    expect(to("m2@example.test")?.html).not.toContain("Private together");
    expect(to("m2@example.test")?.html).toContain("Max is on it");
    expect(to("m2@example.test")).toMatchObject({ count: 1 });
  });

  it("asks which Lists the managers can open once for a page, for every manager and List on it", async () => {
    db.others = { m2: person("m2", "Max") };
    db.storedManager = { u2: "m2" };
    db.items.set("o1", [
      task("a", { ownerId: "u1" }),
      task("b", { ownerId: "u2", boardId: "b-custom", status: "OPEN" }),
      task("c", { ownerId: "u1", boardId: "b-custom", status: "OPEN" }),
      task("d", { ownerId: "u2" }),
    ]);
    await run("overdue-tasks");
    expect(db.readCalls).toHaveLength(1);
    expect(db.readCalls[0].viewers.sort()).toEqual(["m1", "m2"]);
    expect(db.readCalls[0].lists.sort()).toEqual(["b-custom", "b-default"]);
  });
});

// Docs-found fixes batch 5 (src/lib/access/digest-recipients.ts): a person
// who works here through a membership (anchored in a workspace they switched
// to once) had no digest manager here, so their late work and SOPs reached
// nobody; and the read check evaluated every manager against every List of
// a page.
describe("the digests, for people who work here through a membership, and the read check's pairs", () => {
  const lastWeek = () => new Date(Date.now() - 7 * 86_400_000);
  const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Title ${id}`, dueAt: lastWeek(), status: "TO_DO", boardId: "b-default", ownerId: "u1", ...extra });
  const person = (id: string, firstName: string, organizationId = "o1", memberHere = false) => ({ id, email: `${id}@example.test`, firstName, lastName: "Lead", deletedAt: null, status: "ACTIVE", organizationId, organizationMemberships: memberHere ? [{ id: `mem-${id}` }] : [] as Array<{ id: string }> });

  it("tells a member's manager here, who can open the List, of their late task and SOP", async () => {
    // Dana switched to a partner workspace once: anchored there, a member here. Mia (m1, here) is her manager.
    db.people = { u5: person("u5", "Dana", "partner", true) };
    db.items.set("o1", [task("dana", { title: "Partner launch plan", ownerId: "u5" })]);
    await run("overdue-tasks");
    expect(db.sent.map((m) => m.to)).toEqual(["m1@example.test"]);
    expect(db.sent[0].html).toContain("Partner launch plan");
    expect(db.sent[0].html).toContain("Dana Lead");
    db.sent.length = 0;
    db.sops = [{ id: "as5", title: "Partner onboarding", organizationId: "o1", userId: "u5", dueDate: lastWeek() }];
    await run("overdue-sops");
    expect(db.sent.map((m) => m.to).sort()).toEqual(["m1@example.test", "u5@example.test"]);
  });

  it("walks a member's line past an Agent here, and tells no one outside this workspace, nor the person themselves", async () => {
    db.people = {
      u5: person("u5", "Dana", "partner", true),
      u6: person("u6", "Fay", "partner", true),
      u7: person("u7", "Sel", "partner", true),
    };
    db.others = { a1: person("a1", "Sam"), x9: person("x9", "Xan", "partner") };
    db.levels = { a1: "AGENT" };
    db.storedManager = { u5: "a1", a1: "m1", u6: "x9", u7: "u7" };
    db.items.set("o1", [
      task("d", { title: "Dana late", ownerId: "u5" }),
      task("f", { title: "Fay late", ownerId: "u6" }),
      task("s", { title: "Sel late", ownerId: "u7" }),
    ]);
    await run("overdue-tasks");
    expect(db.sent.map((m) => m.to)).toEqual(["m1@example.test"]);
    expect(db.sent[0].html).toContain("Dana late");
    expect(db.sent[0].html).not.toContain("Fay late");
    expect(db.sent[0].html).not.toContain("Sel late");
  });

  it("asks only about each manager's own Lists, never every manager against every List", async () => {
    db.others = { m2: person("m2", "Max") };
    db.storedManager = { u2: "m2" };
    db.items.set("o1", [
      task("a", { ownerId: "u1" }),
      task("b", { ownerId: "u2", boardId: "b-custom", status: "OPEN" }),
    ]);
    await run("overdue-tasks");
    expect(db.readCalls).toHaveLength(1);
    expect(db.readCalls[0].pairs.sort()).toEqual(["m1|b-default", "m2|b-custom"]);
  });
});

// Docs-found fixes batch 6: the overdue SOP digest named every SOP to the
// person's manager by title, with no read check, and a manager stored as a
// Guest got the task digest as a Member would.
describe("the SOP digest's read check, and a Guest manager", () => {
  const lastWeek = () => new Date(Date.now() - 7 * 86_400_000);

  it("names a SOP only to a manager who can open it, asked once per manager and SOP, at the level held here", async () => {
    db.levels = { m1: "MANAGER" };
    db.cannotReadSop = new Set(["m1|sop-hr"]);
    db.sops = [
      { id: "as1", title: "Disciplinary steps", organizationId: "o1", userId: "u1", dueDate: lastWeek(), sopId: "sop-hr" },
      { id: "as2", title: "Close the books", organizationId: "o1", userId: "u1", dueDate: lastWeek(), sopId: "sop-fin" },
      { id: "as3", title: "Close the books", organizationId: "o1", userId: "u2", dueDate: lastWeek(), sopId: "sop-fin" },
    ];
    await run("overdue-sops");
    const mia = db.sent.find((m) => m.to === "m1@example.test")!;
    expect(mia.html).toContain("Close the books");
    expect(mia.html).not.toContain("Disciplinary steps");
    expect(mia).toMatchObject({ count: 2 });
    // The person still hears of their own SOP.
    expect(db.sent.find((m) => m.to === "u1@example.test" && m.html.includes("Disciplinary steps"))).toBeTruthy();
    expect(db.sopReadCalls).toEqual([["m1|sop-hr|MANAGER", "m1|sop-fin|MANAGER"]]);
  });

  it("sends a Guest manager no digest of their people's tasks or SOPs", async () => {
    db.orgRoles = { m1: "GUEST" };
    db.items.set("o1", [{ id: "late", title: "Late work", dueAt: lastWeek(), status: "TO_DO", boardId: "b-default", ownerId: "u1" }]);
    db.sops = [{ id: "as4", title: "Close the books", organizationId: "o1", userId: "u1", dueDate: lastWeek() }];
    await run("overdue-tasks");
    await run("overdue-sops");
    expect(db.sent.map((m) => m.to)).toEqual(["u1@example.test"]);
  });
});

// Docs-found fixes batch 4: due today's once-a-day check was a read before
// the write, so two runs at the same moment both wrote every row.
describe("due today, two runs at the same moment", () => {
  const today = () => new Date();
  const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Title ${id}`, dueAt: today(), status: "TO_DO", boardId: "b-default", ownerId: "u1", board: { folderId: null, spaceId: null }, ...extra });

  it("take turns under the workspace's lock, so each row is written once", async () => {
    db.items.set("o1", [task("a"), task("b", { assigneeIds: ["u1", "u2"] })]);
    await Promise.all([run("tasks-due-today"), run("tasks-due-today")]);
    expect(db.notified.map((n) => `${n.userId} ${n.link}`).sort()).toEqual(["u1 /item/a", "u1 /item/b", "u2 /item/b"]);
    expect(db.locks.every((l) => l.includes("pg_advisory_xact_lock") && l.endsWith("due-today:o1"))).toBe(true);
    expect(db.locks).toHaveLength(2);
  });

  it("writes anyway when the check fails: a duplicate beats a missed deadline", async () => {
    db.items.set("o1", [task("a")]);
    db.failCheck = true;
    await run("tasks-due-today");
    expect(db.notified.map((n) => n.link)).toEqual(["/item/a"]);
  });
});
