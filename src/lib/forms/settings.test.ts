import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIRMATION_MESSAGE, DEFAULT_FORM_SETTINGS, describeSettingsError, formSettingsPatchSchema, isFormClosed,
  mergeFormSettings, readFormSettings,
} from "./settings";

describe("readFormSettings (tolerates the column being absent)", () => {
  it("reads absent, null, arrays and junk as the defaults", () => {
    for (const raw of [undefined, null, [], "x", 3]) expect(readFormSettings(raw)).toEqual(DEFAULT_FORM_SETTINGS);
  });
  it("keeps a live form accepting responses and offering another", () => {
    expect(DEFAULT_FORM_SETTINGS.acceptingResponses).toBe(true);
    expect(DEFAULT_FORM_SETTINGS.allowAnother).toBe(true);
    expect(DEFAULT_FORM_SETTINGS.closesAt).toBeNull();
  });
  it("reads stored values and drops unsafe redirects", () => {
    const s = readFormSettings({ acceptingResponses: false, redirectUrl: "javascript:alert(1)", confirmationMessage: "  Got it  " });
    expect(s.acceptingResponses).toBe(false);
    expect(s.redirectUrl).toBeNull();
    expect(s.confirmationMessage).toBe("Got it");
    expect(readFormSettings({ redirectUrl: "https://example.com/thanks" }).redirectUrl).toBe("https://example.com/thanks");
  });
});

describe("isFormClosed", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  it("is open by default", () => expect(isFormClosed(DEFAULT_FORM_SETTINGS, now)).toBe(false));
  it("closes on the switch", () => expect(isFormClosed({ ...DEFAULT_FORM_SETTINGS, acceptingResponses: false }, now)).toBe(true));
  it("closes once the date has passed, not before", () => {
    expect(isFormClosed(readFormSettings({ closesAt: "2026-09-23T11:59:00Z" }), now)).toBe(true);
    expect(isFormClosed(readFormSettings({ closesAt: "2026-09-23T12:01:00Z" }), now)).toBe(false);
  });
});

describe("formSettingsPatchSchema (the ONE strict writer)", () => {
  it("accepts a partial patch of known keys", () => {
    const r = formSettingsPatchSchema.safeParse({ acceptingResponses: false, closesAt: "2026-10-01T09:00:00.000Z", notifyUserIds: ["u1"] });
    expect(r.success).toBe(true);
    expect(formSettingsPatchSchema.safeParse({}).success).toBe(true);
  });
  it("refuses an unknown key and names it", () => {
    const r = formSettingsPatchSchema.safeParse({ acceptingResponses: true, theme: "dark" });
    expect(r.success).toBe(false);
    if (!r.success) expect(describeSettingsError(r.error)).toBe("Unknown form setting: theme");
  });
  it("refuses a javascript: redirect and a non-date close date", () => {
    const bad = formSettingsPatchSchema.safeParse({ redirectUrl: "javascript:alert(1)" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(describeSettingsError(bad.error)).toMatch(/^redirectUrl: /);
    expect(formSettingsPatchSchema.safeParse({ closesAt: "tomorrow" }).success).toBe(false);
    expect(formSettingsPatchSchema.safeParse({ redirectUrl: null, closesAt: null }).success).toBe(true);
  });
  it("refuses the wrong types", () => {
    expect(formSettingsPatchSchema.safeParse({ dailySummary: "yes" }).success).toBe(false);
    expect(formSettingsPatchSchema.safeParse({ notifyUserIds: "u1" }).success).toBe(false);
    expect(formSettingsPatchSchema.safeParse(null).success).toBe(false);
  });
});

describe("mergeFormSettings", () => {
  it("lays a patch over what is stored and writes the whole bucket", () => {
    const stored = { acceptingResponses: false, confirmationMessage: "Ta" };
    const out = mergeFormSettings(stored, { collectEmail: true });
    expect(out).toEqual({ ...DEFAULT_FORM_SETTINGS, acceptingResponses: false, confirmationMessage: "Ta", collectEmail: true });
  });
  it("an empty message falls back to the canon one", () => {
    expect(mergeFormSettings({}, { confirmationMessage: "   " }).confirmationMessage).toBe(DEFAULT_CONFIRMATION_MESSAGE);
  });
  it("an absent column (null) merges as the defaults", () => {
    expect(mergeFormSettings(null, {})).toEqual(DEFAULT_FORM_SETTINGS);
  });
  it("de-duplicates and caps the notify list on read", () => {
    const s = readFormSettings({ notifyUserIds: ["a", "a", "", 3, "b"] });
    expect(s.notifyUserIds).toEqual(["a", "b"]);
    expect(readFormSettings({ notifyUserIds: Array.from({ length: 80 }, (_, i) => `u${i}`) }).notifyUserIds).toHaveLength(50);
  });
  it("defaults keep today's behaviour: nobody is notified, no daily summary", () => {
    expect(DEFAULT_FORM_SETTINGS.notifyUserIds).toEqual([]);
    expect(DEFAULT_FORM_SETTINGS.dailySummary).toBe(false);
  });
});
