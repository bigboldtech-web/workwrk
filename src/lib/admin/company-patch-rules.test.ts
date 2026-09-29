import { describe, expect, it } from "vitest";
import { confirmMatches, deletionSchedule, FEATURE_LABELS, statusRevokesSessions, validateCompanyPatch } from "./company-patch-rules";

describe("validateCompanyPatch", () => {
  it("accepts a valid plan, status and feature together", () => {
    expect(validateCompanyPatch({ plan: "SCALE", status: "TRIAL", feature: "byok", enabled: true })).toEqual({
      ok: true,
      patch: { plan: "SCALE", status: "TRIAL", feature: { key: "byok", enabled: true } },
    });
  });
  it("an empty body is a valid empty patch", () => {
    expect(validateCompanyPatch({})).toEqual({ ok: true, patch: {} });
    expect(validateCompanyPatch(null)).toEqual({ ok: true, patch: {} });
  });
  it("refuses a plan or status that is not in the enum, whatever the case", () => {
    expect(validateCompanyPatch({ plan: "growth" })).toEqual({ ok: false, error: "Invalid plan" });
    expect(validateCompanyPatch({ plan: 3 })).toEqual({ ok: false, error: "Invalid plan" });
    expect(validateCompanyPatch({ status: "DELETED" })).toEqual({ ok: false, error: "Invalid status" });
  });
  it("refuses an unknown feature and a non-boolean enabled", () => {
    expect(validateCompanyPatch({ feature: "sso", enabled: true })).toEqual({ ok: false, error: "Unknown feature" });
    expect(validateCompanyPatch({ feature: "byok", enabled: "yes" })).toEqual({
      ok: false,
      error: "`enabled` must be a boolean",
    });
  });
  it("ignores fields it does not know, so a body cannot smuggle a write", () => {
    const r = validateCompanyPatch({ plan: "GROWTH", settings: { features: { byok: true } }, name: "x" });
    expect(r).toEqual({ ok: true, patch: { plan: "GROWTH" } });
  });
});

describe("statusRevokesSessions", () => {
  it("only suspend and cancel sign people out", () => {
    expect(statusRevokesSessions("SUSPENDED")).toBe(true);
    expect(statusRevokesSessions("CANCELLED")).toBe(true);
    expect(statusRevokesSessions("ACTIVE")).toBe(false);
    expect(statusRevokesSessions("TRIAL")).toBe(false);
  });
});

describe("FEATURE_LABELS", () => {
  it("names every add-on in the customer's words", () => {
    expect(FEATURE_LABELS.byok).toBe("Bring your own AI key");
    expect(FEATURE_LABELS.whiteLabel).toBe("White label");
    expect(Object.keys(FEATURE_LABELS)).toHaveLength(3);
  });
});

describe("deletionSchedule", () => {
  it("is null when no deletion key is present", () => {
    expect(deletionSchedule(null)).toBeNull();
    expect(deletionSchedule({ features: { byok: true } })).toBeNull();
    expect(deletionSchedule([])).toBeNull();
  });
  it("reads a self-service schedule so a staff status change can clear it", () => {
    expect(
      deletionSchedule({ cancelledAt: "2026-08-01T00:00:00.000Z", cancelledById: "u1", scheduledHardDeleteAt: "2026-08-31T00:00:00.000Z" }),
    ).toEqual({ cancelledAt: "2026-08-01T00:00:00.000Z", cancelledById: "u1", scheduledHardDeleteAt: "2026-08-31T00:00:00.000Z" });
  });
  it("still reports a stray key so it is cleared too", () => {
    expect(deletionSchedule({ scheduledHardDeleteAt: 42 })).toEqual({ cancelledAt: null, cancelledById: null, scheduledHardDeleteAt: null });
  });
});

describe("the server-side typed confirmation", () => {
  it("carries confirm through validation and refuses a non-string", () => {
    expect(validateCompanyPatch({ status: "SUSPENDED", confirm: "Acme Corp" })).toEqual({
      ok: true,
      patch: { status: "SUSPENDED", confirm: "Acme Corp" },
    });
    expect(validateCompanyPatch({ status: "SUSPENDED", confirm: 1 }).ok).toBe(false);
  });
  it("matches the company name ignoring case and surrounding spaces only", () => {
    expect(confirmMatches("  acme corp ", "Acme Corp")).toBe(true);
    expect(confirmMatches("Acme", "Acme Corp")).toBe(false);
    expect(confirmMatches(undefined, "Acme Corp")).toBe(false);
    expect(confirmMatches("", "")).toBe(false);
  });
});
