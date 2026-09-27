import { describe, expect, it } from "vitest";
import { peerRowView, reviewLens, subjectRowView } from "./review-visibility";

const row = {
  id: "r1", cycleId: "c1", subjectId: "emp", reviewerId: "mgr", status: "MANAGER_REVIEW",
  selfRatings: { a: 1 }, kpiScore: 70,
  managerAssessment: { recommendation: "PIP" }, managerRating: 2, managerComments: "draft", overallScore: 40, outcome: "PIP",
  strengths: "s", improvements: "i", calibratedScore: 41, calibrationNotes: "n", potential: 1, calibratedById: "hr", calibratedAt: new Date(),
  peerRating: 3, compositeScore: 44,
  subject: { id: "emp", firstName: "E", lastName: "M", email: "e@x" },
  peerFeedback: [],
};

describe("review visibility", () => {
  it("picks the lens", () => {
    expect(reviewLens({ callerId: "emp", hrAdmin: false, subjectId: "emp", reviewerId: "mgr", inTree: true })).toBe("subject");
    expect(reviewLens({ callerId: "hr", hrAdmin: true, subjectId: "emp", reviewerId: "mgr", inTree: false })).toBe("full");
    expect(reviewLens({ callerId: "mgr", hrAdmin: false, subjectId: "emp", reviewerId: "mgr", inTree: false })).toBe("full");
    expect(reviewLens({ callerId: "skip", hrAdmin: false, subjectId: "emp", reviewerId: "mgr", inTree: true })).toBe("full");
    expect(reviewLens({ callerId: "peer", hrAdmin: false, subjectId: "emp", reviewerId: "mgr", inTree: false })).toBe("peer");
  });

  it("never gives the subject the manager draft, calibration or the 9-box potential", () => {
    const v = subjectRowView(row, "emp");
    expect(v.managerAssessment).toBeNull();
    expect(v.calibratedScore).toBeNull();
    expect(v.calibrationNotes).toBeNull();
    expect(v.potential).toBeNull();
    expect(v.peerRating).toBeNull();
    expect(v.managerComments).toBeNull();
    expect(v.outcome).toBeNull();
    expect(v.overallScore).toBeNull();
    expect(v.selfRatings).toEqual({ a: 1 });
    expect(v.kpiScore).toBe(70);
  });

  it("gives the subject the final result once completed, still no potential", () => {
    const v = subjectRowView({ ...row, status: "COMPLETED" }, "emp");
    expect(v.overallScore).toBe(40);
    expect(v.outcome).toBe("PIP");
    expect(v.managerComments).toBe("draft");
    expect(v.potential).toBeNull();
    expect(v.managerAssessment).toBeNull();
  });

  it("gives a peer the header and their own rows only", () => {
    const v = peerRowView(row);
    expect(v.managerAssessment).toBeUndefined();
    expect(v.selfRatings).toBeUndefined();
    expect(v.potential).toBeUndefined();
    expect((v.subject as { email?: string }).email).toBeUndefined();
    expect(v.peerOnly).toBe(true);
  });
});
