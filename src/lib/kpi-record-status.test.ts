import { describe, expect, it } from "vitest";
import { kpiStatusLabel, kpiWriteStatus, personKpiChip } from "./kpi-record-status";

// The golden cases (spec-goals section 4 step 5).
describe("kpiWriteStatus golden cases", () => {
  it("a manager POST lands APPROVED with reviewedById", () => {
    expect(kpiWriteStatus({ actorId: "mgr", subjectId: "emp", actual: 42, existing: null })).toMatchObject({ status: "APPROVED", reviewedById: "mgr", keepValue: false });
    expect(kpiWriteStatus({ actorId: "mgr", subjectId: "emp", actual: 42, existing: { status: "SUBMITTED" } })).toMatchObject({ status: "APPROVED", reviewedById: "mgr", keepValue: false });
  });
  it("an employee self-report lands SUBMITTED", () => {
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: 7, existing: null })).toMatchObject({ status: "SUBMITTED", reviewedById: null, keepValue: false });
  });
  it("a REJECTED row resubmitted lands SUBMITTED", () => {
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: 9, existing: { status: "REJECTED", reviewedById: "mgr" } })).toMatchObject({ status: "SUBMITTED", reviewedById: null, keepValue: false });
  });
  it("a blank save never downgrades a decided row", () => {
    expect(kpiWriteStatus({ actorId: "mgr", subjectId: "emp", actual: null, existing: { status: "APPROVED" } }).status).toBe("APPROVED");
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: null, existing: { status: "APPROVED" } }).status).toBe("APPROVED");
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: null, existing: null }).status).toBe("PENDING");
  });
});

// The whole-month resend (the recorder autosaves every row after any
// keystroke). Reproduced live in the Stage D review.
describe("kpiWriteStatus on a whole-month resend", () => {
  const approved = { status: "APPROVED" as const, reviewedById: "mgr", actualValue: 3 };
  it("an employee resending an approved, unchanged number keeps the approval", () => {
    const d = kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: 3, existing: approved });
    expect(d).toEqual({ status: "APPROVED", reviewedById: undefined, keepValue: true, valueChanged: false });
  });
  it("an employee changing an approved number resubmits only that row", () => {
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: 4, existing: approved })).toMatchObject({ status: "SUBMITTED", reviewedById: null, valueChanged: true });
  });
  it("a manager resending the employee's submitted number does not approve it", () => {
    const d = kpiWriteStatus({ actorId: "mgr", subjectId: "emp", actual: 3, existing: { status: "SUBMITTED", actualValue: 3 } });
    expect(d).toMatchObject({ status: "SUBMITTED", keepValue: true, valueChanged: false });
  });
  it("a manager resending a Changes-requested row does not approve it", () => {
    const d = kpiWriteStatus({ actorId: "mgr", subjectId: "emp", actual: 5, existing: { status: "REJECTED", reviewedById: "mgr", actualValue: 5 } });
    expect(d.status).toBe("REJECTED");
    expect(d.valueChanged).toBe(false);
  });
  it("a manager changing a number approves only that row", () => {
    expect(kpiWriteStatus({ actorId: "mgr", subjectId: "emp", actual: 11, existing: { status: "SUBMITTED", actualValue: 12 } })).toMatchObject({ status: "APPROVED", reviewedById: "mgr", valueChanged: true, keepValue: false });
  });
  it("a manager's blank never erases a stored number, whatever the status", () => {
    for (const status of ["APPROVED", "SUBMITTED", "REJECTED", "PENDING"] as const) {
      const d = kpiWriteStatus({ actorId: "mgr", subjectId: "emp", actual: null, existing: { status, actualValue: 3 } });
      expect(d).toMatchObject({ status, keepValue: true, valueChanged: false });
    }
  });
  it("an employee's blank keeps a decided number and clears an undecided one", () => {
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: null, existing: approved })).toMatchObject({ status: "APPROVED", keepValue: true });
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: null, existing: { status: "SUBMITTED", actualValue: 3 } })).toMatchObject({ status: "PENDING", keepValue: false, valueChanged: true });
  });
  it("answering Changes requested with a new note resubmits without a new number", () => {
    const ex = { status: "REJECTED" as const, reviewedById: "mgr", actualValue: 5 };
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: 5, existing: ex, noteChanged: true })).toMatchObject({ status: "SUBMITTED", reviewedById: null, keepValue: true });
    expect(kpiWriteStatus({ actorId: "emp", subjectId: "emp", actual: 5, existing: ex }).status).toBe("REJECTED");
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
