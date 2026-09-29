import { describe, expect, it } from "vitest";
import { confirmMatches, createWriteLedger, deletionSchedule, FEATURE_LABELS, statusRevokesSessions, validateCompanyPatch, validateOwnerBody, VALID_FEATURES } from "./company-patch-rules";

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

describe("seats and modules", () => {
  it("accepts a whole seat count, and null or empty as unlimited (0)", () => {
    expect(validateCompanyPatch({ seats: 25 })).toEqual({ ok: true, patch: { seats: 25 } });
    expect(validateCompanyPatch({ seats: null })).toEqual({ ok: true, patch: { seats: 0 } });
    expect(validateCompanyPatch({ seats: "" })).toEqual({ ok: true, patch: { seats: 0 } });
  });
  it("refuses a fractional, negative, huge or text seat count", () => {
    for (const seats of [2.5, -1, 1_000_001, "12"]) {
      expect(validateCompanyPatch({ seats }).ok).toBe(false);
    }
  });
  it("refuses 0: a typed 0 must never be stored as unlimited (only an empty box is)", () => {
    expect(validateCompanyPatch({ seats: 0 })).toEqual({
      ok: false,
      error: "Seats must be a whole number from 1 to 1,000,000, or empty for unlimited",
    });
    expect(validateCompanyPatch({ seats: 1 })).toEqual({ ok: true, patch: { seats: 1 } });
  });
  it("accepts a known module with a boolean and refuses anything else", () => {
    expect(validateCompanyPatch({ module: "chat", enabled: false })).toEqual({ ok: true, patch: { module: { key: "chat", enabled: false } } });
    expect(validateCompanyPatch({ module: "slack", enabled: true })).toEqual({ ok: false, error: "Unknown module" });
    expect(validateCompanyPatch({ module: "tables" }).ok).toBe(false);
  });
  it("one body carries one switch: a feature and a module share `enabled`", () => {
    expect(validateCompanyPatch({ feature: "byok", module: "chat", enabled: true })).toEqual({ ok: false, error: "Change one switch at a time" });
  });
  it("no longer switches Custom domain (nothing reads it); its stored value is left alone", () => {
    expect(VALID_FEATURES).toEqual(["byok", "whiteLabel"]);
    expect(validateCompanyPatch({ feature: "customDomain", enabled: true })).toEqual({ ok: false, error: "Unknown feature" });
  });
});

describe("validateOwnerBody", () => {
  it("needs a person, a reason of a few words and carries the typed name", () => {
    expect(validateOwnerBody({ userId: "u1", reason: "  founder   left ", confirm: "Acme" })).toEqual({ ok: true, userId: "u1", reason: "founder left", confirm: "Acme" });
    expect(validateOwnerBody({ reason: "because" }).ok).toBe(false);
    expect(validateOwnerBody({ userId: "u1", reason: "no" }).ok).toBe(false);
    expect(validateOwnerBody({ userId: "u1", reason: "x".repeat(501) }).ok).toBe(false);
    expect(validateOwnerBody(null).ok).toBe(false);
  });
});

// The company page's stale-Retry guard (company-record.tsx patch()).
describe("createWriteLedger", () => {
  it("a Retry from a failed save is live until the field is written again", () => {
    const l = createWriteLedger();
    const failedGrowth = l.begin("plan");
    expect(l.isLatest("plan", failedGrowth)).toBe(true);
    // The staff member picks Enterprise, and it saves.
    const enterprise = l.begin("plan");
    expect(l.isLatest("plan", enterprise)).toBe(true);
    // The old toast's Retry must now do nothing: it would put Growth back.
    expect(l.isLatest("plan", failedGrowth)).toBe(false);
  });

  it("fields are independent: a Suspend does not retire a failed plan save", () => {
    const l = createWriteLedger();
    const plan = l.begin("plan");
    l.begin("status");
    l.begin("module:chat");
    expect(l.isLatest("plan", plan)).toBe(true);
  });

  it("a stale status Retry cannot undo a later Suspend", () => {
    const l = createWriteLedger();
    const failedActive = l.begin("status");
    const suspend = l.begin("status");
    expect(l.isLatest("status", failedActive)).toBe(false);
    expect(l.isLatest("status", suspend)).toBe(true);
  });

  it("retire: typing a new number in Seats kills the Retry for the old one", () => {
    const l = createWriteLedger();
    const failed12 = l.begin("seats");
    l.retire("seats");
    expect(l.isLatest("seats", failed12)).toBe(false);
  });

  it("each ledger is its own (one per company page)", () => {
    const a = createWriteLedger();
    const b = createWriteLedger();
    const t = a.begin("plan");
    b.begin("plan");
    b.begin("plan");
    expect(a.isLatest("plan", t)).toBe(true);
  });
});
