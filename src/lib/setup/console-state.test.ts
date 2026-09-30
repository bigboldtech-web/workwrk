import { describe, expect, it } from "vitest";
import { nextConsole, onboardView, readConsole } from "./console-state";
import { consoleSectionSchema, parseSettingsEnvelope } from "@/lib/settings/org-settings-sections";
import { DEFAULT_DEPARTMENTS, missingDefaults, orgDefaultSettings, validTimeZone } from "@/lib/org/seed-org-defaults";

describe("readConsole", () => {
  it("starts a new workspace at step 1 with nothing done", () => {
    expect(readConsole({ console: { setupStep: 1, setupCompletedAt: null, setupDismissedAt: null } })).toEqual({ setupStep: 1, setupCompletedAt: null, setupDismissedAt: null });
    expect(readConsole(null)).toEqual({ setupStep: 1, setupCompletedAt: null, setupDismissedAt: null });
  });

  it("reads the old setupCompleted boolean as completed, so a finished org is never re-offered setup", () => {
    expect(readConsole({ setupCompleted: true }).setupCompletedAt).toBe("legacy");
    expect(onboardView(readConsole({ setupCompleted: true }), true)).toEqual({ kind: "nothing", reason: "completed" });
  });

  it("clamps a stored step and ignores junk dates", () => {
    expect(readConsole({ console: { setupStep: 9, setupDismissedAt: "nope" } })).toEqual({ setupStep: 4, setupCompletedAt: null, setupDismissedAt: null });
  });
});

describe("onboardView", () => {
  const fresh = readConsole({});
  it("offers the wizard only to an Owner or Admin with both flags null", () => {
    expect(onboardView(fresh, true)).toEqual({ kind: "wizard", step: 1 });
    expect(onboardView(fresh, false)).toEqual({ kind: "nothing", reason: "not-admin" });
    expect(onboardView(readConsole({ console: { setupDismissedAt: "2026-09-30T00:00:00Z" } }), true)).toEqual({ kind: "nothing", reason: "dismissed" });
  });
});

describe("nextConsole", () => {
  const now = new Date("2026-09-30T10:00:00Z");
  it("stamps the server's own time and mirrors setupCompleted on Finish", () => {
    expect(nextConsole({ setupStep: 3 }, { complete: true }, now)).toEqual({ console: { setupStep: 3, setupCompletedAt: now.toISOString() }, setupCompleted: true });
    expect(nextConsole({}, { dismiss: true }, now)).toEqual({ console: { setupDismissedAt: now.toISOString() } });
    expect(nextConsole({ setupStep: 1 }, { setupStep: 3 }, now)).toEqual({ console: { setupStep: 3 } });
  });

  it("never moves a stamp that is already set", () => {
    expect(nextConsole({ setupCompletedAt: "2026-01-01T00:00:00.000Z" }, { complete: true }, now).console.setupCompletedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("the console section of PATCH /api/settings", () => {
  it("is a live, strict section that refuses a client-sent date", () => {
    expect(parseSettingsEnvelope({ section: "console", data: { setupStep: 2 } })).toMatchObject({ kind: "section", section: "console" });
    expect(consoleSectionSchema.safeParse({ setupStep: 2 }).success).toBe(true);
    expect(consoleSectionSchema.safeParse({ setupCompletedAt: "2020-01-01" }).success).toBe(false);
    expect(consoleSectionSchema.safeParse({ setupStep: 5 }).success).toBe(false);
  });
});

describe("seedOrgDefaults' pure half", () => {
  it("seeds the six departments and the locale by the signup zone", () => {
    expect([...DEFAULT_DEPARTMENTS]).toEqual(["Engineering", "Sales", "Marketing", "Operations", "HR", "Finance"]);
    expect(orgDefaultSettings({ timezone: "Asia/Kolkata" })).toMatchObject({ timezone: "Asia/Kolkata", currency: "INR", fiscalYearStart: 4 });
    expect(orgDefaultSettings({ timezone: "Europe/London" })).toMatchObject({ timezone: "Europe/London", currency: "GBP", fiscalYearStart: 4 });
    expect(orgDefaultSettings({ timezone: "Europe/Berlin" })).toMatchObject({ currency: "EUR", fiscalYearStart: 1 });
    expect(orgDefaultSettings({ timezone: "Australia/Sydney" })).toMatchObject({ currency: "AUD", fiscalYearStart: 7 });
    expect(orgDefaultSettings({ timezone: "America/New_York" })).toMatchObject({ currency: "USD", fiscalYearStart: 1 });
    expect(orgDefaultSettings({ timezone: "Not/AZone" })).toMatchObject({ timezone: "Asia/Kolkata" });
    expect(validTimeZone("")).toBeNull();
  });

  it("writes only the password rules the code enforces, and no untrue policy", () => {
    const d = orgDefaultSettings();
    expect(d.security).toEqual({ minPasswordLength: 8, requireUppercase: true, requireNumbers: true });
    expect(d).not.toHaveProperty("enabledModules");
    expect(d).not.toHaveProperty("businessType");
    expect(d.console).toEqual({ setupStep: 1, setupCompletedAt: null, setupDismissedAt: null });
    expect(d.retention).toEqual({ trashDays: 60 });
  });

  it("never overwrites a key the org already holds", () => {
    expect(missingDefaults({ timezone: "UTC", currency: "EUR" }, { timezone: "Asia/Kolkata", language: "en" })).toEqual({ language: "en" });
    expect(missingDefaults(null, { a: 1 })).toEqual({ a: 1 });
  });
});
