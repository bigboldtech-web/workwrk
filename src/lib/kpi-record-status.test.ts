import { describe, expect, it } from "vitest";
import { kpiStatusLabel, kpiWriteStatus, personKpiChip } from "./kpi-record-status";

// The golden cases (spec-goals section 4 step 5).
describe("kpiWriteStatus golden cases", () => {
  it("a manager POST lands APPROVED with reviewedById", () => {
    expect(kpiWriteStatus({ actorId: "mgr", subjectId: "emp", actual: 42, existing: null })).toEqual({ status: "APPROVED", reviewedById: "mgr" });
    expect(kpiWriteStatus({ actorId: "mgr", subjectId: "emp", actual: 42, existing: { status: "SUBMITTED" } })).toEqual({ status: "APPROVED", reviewedById: "mgr" });
  });
  it("an employee self-report lands SUBMITTED", () => {
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: 7, existing: null })).toEqual({ status: "SUBMITTED", reviewedById: null });
  });
  it("a REJECTED row resubmitted lands SUBMITTED", () => {
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: 9, existing: { status: "REJECTED", reviewedById: "mgr" } })).toEqual({ status: "SUBMITTED", reviewedById: null });
  });
  it("a blank save never downgrades a decided row", () => {
    expect(kpiWriteStatus({ actorId: "mgr", subjectId: "emp", actual: null, existing: { status: "APPROVED" } }).status).toBe("APPROVED");
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: null, existing: { status: "APPROVED" } }).status).toBe("APPROVED");
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: null, existing: null }).status).toBe("PENDING");
  });
});

describe("labels and the people chip", () => {
  it("speaks one vocabulary", () => {
    expect(kpiStatusLabel("SUBMITTED", { forManager: true })).toBe("Awaiting you");
    expect(kpiStatusLabel("SUBMITTED")).toBe("Awaiting approval");
    expect(kpiStatusLabel("REJECTED")).toBe("Changes requested");
    expect(kpiStatusLabel("PENDING")).toBe("Not recorded");
  });
  it("puts attention first", () => {
    expect(personKpiChip({ pending: 0, submitted: 2, approved: 1, rejected: 1, total: 4 }).key).toBe("awaiting");
    expect(personKpiChip({ pending: 0, submitted: 0, approved: 1, rejected: 1, total: 4 }).key).toBe("changes");
    expect(personKpiChip({ pending: 0, submitted: 0, approved: 1, rejected: 0, total: 4 }).key).toBe("notRecorded");
    expect(personKpiChip({ pending: 0, submitted: 0, approved: 4, rejected: 0, total: 4 }).key).toBe("approved");
    expect(personKpiChip({ pending: 0, submitted: 0, approved: 0, rejected: 0, total: 0 }).key).toBe("noKpis");
  });
});
