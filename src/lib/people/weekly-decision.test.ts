import { describe, expect, it } from "vitest";
import { parseWeeklyDecision, weeklyDecisionBlocked } from "./weekly-decision";

describe("parseWeeklyDecision", () => {
  it("takes the one payload", () => {
    expect(parseWeeklyDecision({ decision: "APPROVED" })).toEqual({ ok: true, decision: "APPROVED", notes: null });
    expect(parseWeeklyDecision({ decision: "CHANGES_REQUESTED", notes: " Add the blocker " })).toEqual({ ok: true, decision: "CHANGES_REQUESTED", notes: "Add the blocker" });
    expect(parseWeeklyDecision({ decision: "REOPEN" })).toEqual({ ok: true, decision: "REOPEN", notes: null });
  });
  it("still reads the retired { action } body for one release", () => {
    expect(parseWeeklyDecision({ action: "approve" })).toMatchObject({ ok: true, decision: "APPROVED" });
    expect(parseWeeklyDecision({ action: "request_changes", notes: "x" })).toMatchObject({ ok: true, decision: "CHANGES_REQUESTED" });
  });
  it("a request for changes needs a note, in every entry point", () => {
    expect(parseWeeklyDecision({ decision: "CHANGES_REQUESTED" }).ok).toBe(false);
    expect(parseWeeklyDecision({ decision: "CHANGES_REQUESTED", notes: "   " }).ok).toBe(false);
    expect(parseWeeklyDecision({ action: "request_changes" }).ok).toBe(false);
  });
  it("refuses anything else", () => {
    expect(parseWeeklyDecision(null).ok).toBe(false);
    expect(parseWeeklyDecision({ decision: "approve" }).ok).toBe(false);
    expect(parseWeeklyDecision({ decision: "APPROVED", notes: 4 }).ok).toBe(false);
    expect(parseWeeklyDecision({ decision: "APPROVED", notes: "x".repeat(5001) }).ok).toBe(false);
  });
});

describe("weeklyDecisionBlocked", () => {
  it("approve and request changes act only on a submitted review", () => {
    expect(weeklyDecisionBlocked("SUBMITTED", "APPROVED")).toBeNull();
    expect(weeklyDecisionBlocked("SUBMITTED", "CHANGES_REQUESTED")).toBeNull();
    expect(weeklyDecisionBlocked("DRAFT", "APPROVED")).toMatch(/draft/);
    expect(weeklyDecisionBlocked("ACKNOWLEDGED", "APPROVED")).toMatch(/already decided/);
  });
  it("Undo (REOPEN) acts only on a decided review", () => {
    expect(weeklyDecisionBlocked("ACKNOWLEDGED", "REOPEN")).toBeNull();
    expect(weeklyDecisionBlocked("SUBMITTED", "REOPEN")).not.toBeNull();
    expect(weeklyDecisionBlocked("DRAFT", "REOPEN")).not.toBeNull();
  });
});
