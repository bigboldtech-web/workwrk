// The /team/reviews drawer and queue, and the Agent tier (docs-found fixes
// batch 4). A weekly review records its subject's manager; one recorded to
// an Agent before rule 6 (or one whose subject has no manager above the
// Agent) kept that stamp, and readWeeklyReview let the recorded manager read
// it whole, Agent or not: highlights, blockers, plan, KRA progress and KPI
// values. canDecideFor read the stored subject manager, so the queue's
// Approve button and the decision route disagreed for someone listed under
// an Agent with nobody above.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/reporting-line", () => ({ getEffectiveReportTree: async (id: string) => [id] }));

type U = { id: string; organizationId: string; managerId: string | null; accessLevel: string; status: string; deletedAt: Date | null };
const st = vi.hoisted(() => ({ users: new Map<string, unknown>(), recordedTo: "sam" as string | null }));

vi.mock("@/lib/prisma", () => {
  const all = () => [...st.users.values()] as U[];
  const subject = () => {
    const u = st.users.get("tia") as U;
    return { id: "tia", firstName: "Tia", lastName: "T", email: "tia@x", avatar: null, managerId: u.managerId, presenceStatus: null, presenceUntil: null, role: null, deletedAt: null };
  };
  const review = () => ({
    id: "w1", userId: "tia", organizationId: "org", managerId: st.recordedTo, status: "SUBMITTED", managerStatus: "PENDING",
    periodStart: new Date("2026-10-05T00:00:00.000Z"), submittedAt: new Date("2026-10-09T00:00:00.000Z"), reviewedAt: null,
    highlights: "Shipped the thing", blockers: "None", plan: "More", managerNotes: null, kraProgress: [], kpiSnapshots: [],
    user: subject(), manager: null,
  });
  return {
    prisma: {
      user: {
        findMany: async (a: { where: { id?: { in: string[] }; organizationId?: string } }) =>
          all().filter((u) => (!a.where.id || a.where.id.in.includes(u.id)) && (!a.where.organizationId || u.organizationId === a.where.organizationId)),
        findUnique: async (a: { where: { id: string } }) => st.users.get(a.where.id) ?? null,
      },
      organizationMembership: { findMany: async () => [], findUnique: async () => null },
      weeklyReview: { findFirst: async () => review() },
      activityLog: { findFirst: async () => null },
      kRA: { findMany: async () => [] },
      kPI: { findMany: async () => [] },
    },
  };
});

import { canDecideFor, readWeeklyReview, type WeeklyQueueCtx } from "./weekly-queue.server";

const add = (id: string, managerId: string | null, level = "EMPLOYEE") =>
  st.users.set(id, { id, organizationId: "org", managerId, ...legacyLevelRow(level), status: "ACTIVE", deletedAt: null });
const ctx = (userId: string, isAgent: boolean, tree: string[] = []): WeeklyQueueCtx => ({
  userId, organizationId: "org", peopleTeamOrAdmin: false, isAgent, hasReports: tree.length > 0, tree: new Set(tree),
});

beforeEach(() => {
  st.users.clear();
  // rex (Agent, nobody above) > tia; olde is a non-Agent manager tia had once.
  add("rex", null, "AGENT");
  add("tia", "rex");
  add("olde", null, "MANAGER");
  st.recordedTo = "rex";
});

describe("the drawer's read gate", () => {
  it("never opens a review to the Agent it was recorded to", async () => {
    expect(await readWeeklyReview(ctx("rex", true), "w1")).toBeNull();
  });

  it("still opens it to a recorded manager who is no Agent", async () => {
    st.recordedTo = "olde";
    const detail = await readWeeklyReview(ctx("olde", false), "w1");
    expect(detail?.body?.highlights).toBe("Shipped the thing");
  });
});

describe("canDecideFor says what the decision route answers", () => {
  it("lets a recorded manager decide when the subject has nobody above the Agent", async () => {
    // tia is listed under rex, an Agent with nobody above: as the route reads
    // it she has no manager, so her recorded manager may decide.
    st.recordedTo = "olde";
    const detail = await readWeeklyReview(ctx("olde", false), "w1");
    expect(detail?.canDecide).toBe(true);
  });

  it("never lets an Agent decide through a recorded stamp", () => {
    expect(canDecideFor(ctx("rex", true), { userId: "tia", managerId: "rex" }, null)).toBe(false);
  });
});
