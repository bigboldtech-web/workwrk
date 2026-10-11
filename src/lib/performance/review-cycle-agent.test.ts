// Review cycles and the Agent tier (docs-found fixes batch 3). An open
// review's manager half is written by whoever the subject reports to now
// (review-cycle.ts effectiveReviewerId), and that was the stored manager:
// for someone listed under an Agent before rule 6, the Agent. An Agent is
// nobody's manager, so the reviewer is the next manager up the line, or
// nobody, and an Agent's launch stamp writes nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type U = { id: string; organizationId: string; managerId: string | null; accessLevel: string; status: string; deletedAt: Date | null };
const st = vi.hoisted(() => ({
  users: new Map<string, U>(),
  reviews: [] as Array<{ id: string; subjectId: string; reviewerId: string; cycleId: string }>,
  moved: [] as Array<{ id: string; reviewerId: string }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/reporting-line", () => ({ getEffectiveReportTree: async () => [] }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/prisma", () => {
  const pick = (where: { id?: { in: string[] }; organizationId?: string; deletedAt?: null }) =>
    [...st.users.values()].filter((u) => (!where.id || where.id.in.includes(u.id)) && (!where.organizationId || u.organizationId === where.organizationId) && (!("deletedAt" in where) || !u.deletedAt));
  return {
    prisma: {
      user: { findMany: async (a: { where: { id?: { in: string[] }; organizationId?: string; deletedAt?: null } }) => pick(a.where) },
      review: {
        findMany: async () => st.reviews,
        update: async (a: { where: { id: string }; data: { reviewerId: string } }) => { st.moved.push({ id: a.where.id, reviewerId: a.data.reviewerId }); return {}; },
      },
    },
  };
});

import { followReportingLine, reviewerFacts } from "./review-cycle.server";
import { effectiveReviewerId } from "./review-cycle";

const add = (id: string, managerId: string | null, level = "EMPLOYEE") =>
  st.users.set(id, { id, organizationId: "org", managerId, ...legacyLevelRow(level), status: "ACTIVE", deletedAt: null });

beforeEach(() => {
  st.users.clear();
  st.moved = [];
  // mona > sam (Agent, made before rule 6) > ida ; rex (Agent, no manager) > tia
  add("mona", null, "MANAGER");
  add("sam", "mona", "AGENT");
  add("ida", "sam");
  add("rex", null, "AGENT");
  add("tia", "rex");
  st.reviews = [
    { id: "r-ida", subjectId: "ida", reviewerId: "sam", cycleId: "c1" },
    { id: "r-tia", subjectId: "tia", reviewerId: "rex", cycleId: "c1" },
  ];
});

describe("reviewerFacts and effectiveReviewerId", () => {
  it("name the manager above the Agent as the writer, and nobody where there is none", async () => {
    const facts = await reviewerFacts("org", st.reviews);
    const writer = (r: (typeof st.reviews)[number]) =>
      effectiveReviewerId({ reviewerId: r.reviewerId, subjectManagerId: facts.managerOf.get(r.subjectId) ?? null, cycleStatus: "ACTIVE", reviewStatus: "PENDING", reviewerIsAgent: facts.agentReviewers.has(r.reviewerId) });
    expect(writer(st.reviews[0])).toBe("mona");
    expect(writer(st.reviews[1])).toBeNull();
  });
});

describe("followReportingLine", () => {
  it("hands an open review stamped to an Agent to the manager above them", async () => {
    await followReportingLine("org", ["ida"], "admin");
    expect(st.moved).toContainEqual({ id: "r-ida", reviewerId: "mona" });
  });

  it("with nobody above the Agent, hands it to the person who changed the line", async () => {
    await followReportingLine("org", ["tia"], "admin");
    expect(st.moved).toContainEqual({ id: "r-tia", reviewerId: "admin" });
  });
});
