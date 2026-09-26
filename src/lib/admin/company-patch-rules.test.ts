import { describe, expect, it } from "vitest";
import { FEATURE_LABELS, statusRevokesSessions, validateCompanyPatch } from "./company-patch-rules";

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
