// GET /api/me/home: the "My work" widget.
//
// The widget read the oldest 200 of the viewer's tasks by due date with no
// status filter and then dropped done ones by the five words
// isDoneStatusName knows. Reproduced against the in-memory store:
//
//   * after 200 finished past-due tasks every open task was cut off, and
//     Home said "Nothing due this week";
//   * the tick on Home writes the List's own done status (PUBLISHED for a
//     content List), which those five words do not know, so the task it had
//     just completed stayed under Overdue;
//   * the group counts and "N more" were counted off the capped rows.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itemTestDb, installItemTestDb, type ItemTestDb } from "@/lib/item-test-db";

vi.mock("next-auth", async () => {
  const { legacyTestSession } = await import("@/lib/access/test-fixtures");
  return { getServerSession: async () => legacyTestSession("u-me", "EMPLOYEE", "org-1") };
});
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/item-test-db")).itemTestPrisma }));
vi.mock("@/lib/preferences", () => ({ getEffectivePreferences: async () => ({ home: { locale: { timezone: "UTC", weekStart: 1 } } }) }));
vi.mock("@/lib/assignee-lift", () => ({ liftWithheldListIds: async () => new Set() }));
// The other widgets fail alone (each is caught to null); they are not under test.
vi.mock("@/lib/goals/goal-periods.server", () => ({ currentPeriodPayload: () => null, orgPeriodSettings: async () => null, settleOnRead: async () => {} }));
vi.mock("@/lib/goals/goal-period", () => ({ isGoalCadence: () => false }));
vi.mock("@/lib/recent-doc-views", () => ({ parseRecentDocViews: () => ({ ids: [], viewedAt: new Map() }) }));
vi.mock("@/lib/access/node-access", () => ({ nodeCtxFromLevel: () => ({}), nodeRoleMap: async () => new Map() }));
vi.mock("@/lib/inbox-kinds", () => ({ kindFor: () => ({ label: "", icon: "" }) }));
vi.mock("@/lib/inbox-query", () => ({ tabUnreadWhere: () => ({}), unreadWhere: () => ({}), withClearedAtFallback: async () => { throw new Error("not under test"); } }));
vi.mock("@/lib/notification-target", () => ({ notificationTarget: () => ({ href: null }) }));

import { GET } from "./route";

const CONTENT = {
  id: "b-content", slug: "posts", name: "Posts", organizationId: "org-1",
  statuses: [
    { value: "DRAFT", label: "Draft", color: "#999999", group: "ACTIVE" },
    { value: "PUBLISHED", label: "Published", color: "#15803D", group: "DONE" },
  ],
};
const PLAIN = { id: "b-plain", slug: "work", name: "Work", organizationId: "org-1", statuses: null };

// Tuesday 15 September 2026, noon UTC; the viewer's week ends on Sunday.
const NOW = new Date("2026-09-15T12:00:00Z");
const DAY = 86_400_000;

let db: ItemTestDb;
let n = 0;
function task(boardId: string, status: string | null, dueAt: Date | null) {
  n += 1;
  const id = `t-${String(n).padStart(4, "0")}`;
  db.items.push({
    id, title: id, organizationId: "org-1", boardId, status, priority: null, dueAt, startAt: null, position: n,
    ownerId: "u-me", assigneeIds: [], archivedAt: null, itemType: "TASK",
  });
  return id;
}

interface Work {
  overdue: Array<{ id: string; doneStatus: string | null }>;
  today: Array<{ id: string }>;
  week: Array<{ id: string }>;
  counts: { overdue: number; today: number; week: number; shown: number; more: number };
}
async function work(): Promise<Work> {
  const res = await GET();
  return ((await res.json()) as { work: Work }).work;
}

beforeEach(() => {
  n = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = installItemTestDb(itemTestDb({ boards: [{ ...CONTENT }, { ...PLAIN }] }));
});
afterEach(() => vi.useRealTimers());

describe("Home's My work widget", () => {
  it("shows today's open task behind 250 finished past-due ones", async () => {
    for (let i = 0; i < 250; i++) task("b-plain", "DONE", new Date(NOW.getTime() - 30 * DAY));
    const today = task("b-plain", "TO_DO", NOW);
    const w = await work();
    expect(w.today.map((r) => r.id)).toEqual([today]);
    expect(w.overdue).toEqual([]);
    expect(w.counts).toMatchObject({ overdue: 0, today: 1, week: 0, more: 0 });
  });

  it("a task ticked to its List's own done status leaves Overdue", async () => {
    const draft = task("b-content", "DRAFT", new Date(NOW.getTime() - DAY));
    const before = await work();
    expect(before.overdue.map((r) => r.id)).toEqual([draft]);
    // What the tick writes is the List's first done status.
    expect(before.overdue[0].doneStatus).toBe("PUBLISHED");
    db.items[0].status = "PUBLISHED";
    const after = await work();
    expect(after.overdue).toEqual([]);
    expect(after.counts.overdue).toBe(0);
  });

  it("counts every open task, not the ones a cap let through", async () => {
    for (let i = 0; i < 230; i++) task("b-plain", "TO_DO", new Date(NOW.getTime() - 3 * DAY));
    task("b-plain", "TO_DO", new Date(NOW.getTime() + DAY));
    const w = await work();
    expect(w.overdue).toHaveLength(10);
    expect(w.counts).toMatchObject({ overdue: 230, today: 0, week: 1, shown: 10, more: 221 });
  });
});
