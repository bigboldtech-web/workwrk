// Weekly reviews and the Agent tier (docs-found fixes batch 3). A weekly
// review records the subject's manager, and the direct queue holds the
// reviews of the people who report to the viewer now. For someone listed
// under an Agent before rule 6, both named the Agent: their queue held the
// reviews (and the sidebar badge counted them), and the recorded manager
// could read them. An Agent is nobody's manager: their queue is empty, and
// the people listed under them belong to the manager above.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type U = { id: string; organizationId: string; managerId: string | null; accessLevel: string; status: string; deletedAt: Date | null };
const st = vi.hoisted(() => ({
  users: new Map<string, U>(),
  counted: [] as unknown[],
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/reporting-line", () => ({ getEffectiveReportTree: async (id: string) => [id] }));
vi.mock("@/lib/prisma", () => {
  type W = { id?: string | { in: string[] }; organizationId?: string; managerId?: string | { in: string[] }; deletedAt?: null };
  const ok = (u: U, w: W) =>
    (w.id === undefined || (typeof w.id === "string" ? u.id === w.id : w.id.in.includes(u.id))) &&
    (w.organizationId === undefined || u.organizationId === w.organizationId) &&
    (w.managerId === undefined || (typeof w.managerId === "string" ? u.managerId === w.managerId : !!u.managerId && w.managerId.in.includes(u.managerId))) &&
    (!("deletedAt" in w) || !u.deletedAt);
  return {
    prisma: {
      user: {
        findUnique: async (a: { where: { id: string } }) => st.users.get(a.where.id) ?? null,
        findMany: async (a: { where: W }) => [...st.users.values()].filter((u) => ok(u, a.where)),
      },
      weeklyReview: {
        findUnique: async (a: { where: { id?: string } }) => (a.where.id ? { id: a.where.id, userId: "ida", organizationId: "org" } : null),
        count: async (a: { where: unknown }) => { st.counted.push(a.where); return 0; },
        create: async (a: { data: Record<string, unknown> }) => { st.created.push(a.data); return { id: "w1", ...a.data, status: "DRAFT", periodStart: new Date() }; },
        update: async (a: { data: Record<string, unknown> }) => { st.updated.push(a.data); return { id: "w1", userId: "ida", organizationId: "org", periodStart: new Date(), ...a.data }; },
      },
    },
  };
});

import { countReviewsAwaitingManager, getOrCreateWeeklyReview, managerQueueWhereFor, submitWeeklyReview } from "./weekly-review";

const add = (id: string, managerId: string | null, level = "EMPLOYEE") =>
  st.users.set(id, { id, organizationId: "org", managerId, ...legacyLevelRow(level), status: "ACTIVE", deletedAt: null });

beforeEach(() => {
  st.users.clear();
  st.counted = [];
  st.created = [];
  st.updated = [];
  // mona > sam (Agent, made before rule 6) > ida
  add("mona", null, "MANAGER");
  add("sam", "mona", "AGENT");
  add("ida", "sam");
});

describe("the direct queue", () => {
  it("is empty for an Agent, badge included", async () => {
    expect(await managerQueueWhereFor("sam")).toEqual({ id: { in: [] } });
    await countReviewsAwaitingManager("sam");
    expect(st.counted[0]).toEqual({ AND: [{ id: { in: [] } }, { status: "SUBMITTED" }] });
  });

  it("holds, for the manager above, the people listed under the Agent", async () => {
    const where = (await managerQueueWhereFor("mona")) as { OR: unknown[] };
    expect(where.OR).toContainEqual({ user: { managerId: "mona", deletedAt: null } });
    expect(where.OR).toContainEqual({ userId: { in: ["ida"] }, user: { deletedAt: null } });
  });
});

describe("the recorded manager", () => {
  it("is the manager above the Agent, at creation and at submit", async () => {
    await getOrCreateWeeklyReview({ userId: "ida", organizationId: "org", periodStart: new Date("2026-10-05") }).catch(() => undefined);
    expect(st.created[0]?.managerId).toBe("mona");
    await submitWeeklyReview("w1").catch(() => undefined);
    expect(st.updated[0]?.managerId).toBe("mona");
  });
});
