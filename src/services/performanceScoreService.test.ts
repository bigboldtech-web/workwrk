// The monthly performance score reads the workspace it is written for
// (docs/plans/workspace-status-2.md, the final review, product M5, and the
// fixes review, finding 5), through the real service on the in-memory
// database (seat-test-db.ts).
//
// The case. Pat is anchored at her agency A, where Max reviewed her, and
// works for client B, where Dana reviewed her later. Each review has its own
// self-ratings and peer feedback. Before, the score A's managers read on her
// A record took its manager, self and peer parts from her newest review,
// B's; and a recalculation B asked for (a kudos there) wrote B's parts onto
// her A row.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
// The goal part is goal-period-score.server's (tested there): none here.
vi.mock("@/lib/goals/goal-period-score.server", () => ({ okrPartsFor: async () => ({ okrScore: null, okrParts: [] }) }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { currentScoreMonth } from "@/lib/performance/score-compose";
import { calculatePerformanceScore } from "./performanceScoreService";

const period = () => currentScoreMonth(new Date());
const rowOf = (userId: string) => db.tables.performanceScore?.find((r) => r.userId === userId && r.period === period()) ?? null;

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id.toUpperCase()}`, status: "ACTIVE", settings: {} });
  for (const [id, organizationId] of [["pat", "a"], ["max", "a"], ["zed", "a"], ["dana", "b"], ["lee", "b"]] as const) {
    db.seed("user", { id, email: `${id}@x.test`, firstName: id, lastName: "Ng", organizationId, status: "ACTIVE", deletedAt: null });
  }
  db.seed("reviewCycle", { id: "cycle-a", organizationId: "a", name: "A's autumn review" });
  db.seed("reviewCycle", { id: "cycle-b", organizationId: "b", name: "B's autumn review" });
  // A's review of Pat, then B's, newer.
  db.seed("review", {
    id: "review-a", cycleId: "cycle-a", subjectId: "pat", reviewerId: "max", status: "COMPLETED",
    managerRating: 60, calibratedScore: null, selfRatings: { kraRatings: [{ rating: 3 }] }, updatedAt: new Date("2026-10-01"),
  });
  db.seed("review", {
    id: "review-b", cycleId: "cycle-b", subjectId: "pat", reviewerId: "dana", status: "COMPLETED",
    managerRating: 95, calibratedScore: null, selfRatings: { kraRatings: [{ rating: 5 }] }, updatedAt: new Date("2026-10-20"),
  });
  db.seed("peerFeedback", { id: "peer-a", reviewId: "review-a", giverId: "zed", receiverId: "pat", status: "SUBMITTED", rating: 40, createdAt: new Date("2026-10-02") });
  db.seed("peerFeedback", { id: "peer-b", reviewId: "review-b", giverId: "lee", receiverId: "pat", status: "SUBMITTED", rating: 90, createdAt: new Date("2026-10-21") });
});

describe("the performance score's review parts are this workspace's (the fixes review, finding 5)", () => {
  it("reads A's review, A's self-ratings and A's peer feedback for Pat in A, never B's newer ones", async () => {
    const { breakdown } = await calculatePerformanceScore("pat", "a");
    // Before: 95 (B's manager rating), 100 (B's self-ratings) and 65 (both workspaces' peer feedback).
    expect(breakdown).toMatchObject({ managerRating: 60, selfRating: 60, peerRating: 40 });
    expect(rowOf("pat")).toMatchObject({ organizationId: "a", breakdown: expect.objectContaining({ managerRating: 60, selfRating: 60, peerRating: 40 }) });
  });

  it("a recalculation asked from B, where Pat is not anchored, writes nothing on her A row", async () => {
    const before = structuredClone(db.seed("performanceScore", {
      id: "score-pat", userId: "pat", period: period(), organizationId: "a", score: 61, breakdown: { managerRating: 60 }, calculatedAt: new Date("2026-11-01"),
    }));
    const writes = db.writes.length;
    const out = await calculatePerformanceScore("pat", "b");
    expect(out.score).toBeNull();
    // Before: B's parts were written onto her A row (or the row deleted when none were left).
    expect(rowOf("pat")).toEqual(before);
    expect(db.writes.slice(writes)).toEqual([]);
  });

  it("a month row made while Pat was anchored in B takes A's name when A recalculates her, with A's parts", async () => {
    db.seed("performanceScore", {
      id: "score-pat", userId: "pat", period: period(), organizationId: "b", score: 99, breakdown: { managerRating: 95 }, calculatedAt: new Date("2026-11-01"),
    });
    await calculatePerformanceScore("pat", "a");
    // Before: the row kept B's name while holding A's score, so B's reads took A's numbers.
    expect(rowOf("pat")).toMatchObject({ organizationId: "a", breakdown: expect.objectContaining({ managerRating: 60 }) });
    expect(db.tables.performanceScore).toHaveLength(1);
  });
});
