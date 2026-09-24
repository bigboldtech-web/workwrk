import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORM_SETTINGS, acceptsAnonymousResponses, formSettingsPatchSchema, mergeFormSettings, normalizeRedirectInput,
  readFormSettings,
} from "./settings";

describe("Accept responses from people without an account (D16)", () => {
  it("is off by default, including for a form stored before the switch existed", () => {
    expect(DEFAULT_FORM_SETTINGS.acceptAnonymous).toBe(false);
    expect(readFormSettings({ acceptingResponses: true }).acceptAnonymous).toBe(false);
    expect(readFormSettings({ acceptAnonymous: "yes" }).acceptAnonymous).toBe(false);
  });
  it("is written through the one strict writer and read back", () => {
    const parsed = formSettingsPatchSchema.safeParse({ acceptAnonymous: true });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(mergeFormSettings({ collectEmail: true }, parsed.data)).toEqual({ ...DEFAULT_FORM_SETTINGS, collectEmail: true, acceptAnonymous: true });
    expect(formSettingsPatchSchema.safeParse({ acceptAnonymous: "on" }).success).toBe(false);
  });
  it("needs BOTH the live public link and the switch", () => {
    const on = { ...DEFAULT_FORM_SETTINGS, acceptAnonymous: true };
    expect(acceptsAnonymousResponses(on, true)).toBe(true);
    expect(acceptsAnonymousResponses(on, false)).toBe(false);
    expect(acceptsAnonymousResponses(DEFAULT_FORM_SETTINGS, true)).toBe(false);
  });
});

describe("normalizeRedirectInput (the Settings tab's Link box)", () => {
  it("saves a bare host as https", () => {
    expect(normalizeRedirectInput("example.com/thanks")).toBe("https://example.com/thanks");
    expect(normalizeRedirectInput("  www.example.com  ")).toBe("https://www.example.com/");
    expect(normalizeRedirectInput("shop.example.co.uk:8443/done?x=1")).toBe("https://shop.example.co.uk:8443/done?x=1");
  });
  it("keeps an explicit http or https link", () => {
    expect(normalizeRedirectInput("https://example.com/thanks")).toBe("https://example.com/thanks");
    expect(normalizeRedirectInput("http://example.com")).toBe("http://example.com/");
  });
  it("refuses what is not a web address, and never rewrites another scheme", () => {
    for (const bad of ["", "   ", "thanks", "https://", "a b.com", "javascript:alert(1)", "mailto:a@b.co", "ftp://example.com", "data:text/html,x", "user@example.com"]) {
      expect(normalizeRedirectInput(bad)).toBeNull();
    }
  });
  it("what it returns is what the stored reader keeps", () => {
    const url = normalizeRedirectInput("example.com/thanks");
    expect(readFormSettings({ redirectUrl: url }).redirectUrl).toBe(url);
    expect(formSettingsPatchSchema.safeParse({ redirectUrl: url }).success).toBe(true);
  });
});
