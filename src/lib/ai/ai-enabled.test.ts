import { describe, expect, it } from "vitest";
import { aiEnabledFromSettings } from "./ai-enabled";

describe("aiEnabledFromSettings", () => {
  it("defaults on when the key or the section is absent", () => {
    expect(aiEnabledFromSettings(null)).toBe(true);
    expect(aiEnabledFromSettings({})).toBe(true);
    expect(aiEnabledFromSettings({ data: {} })).toBe(true);
    expect(aiEnabledFromSettings({ data: null })).toBe(true);
    expect(aiEnabledFromSettings([])).toBe(true);
  });

  it("is off only for an explicit false", () => {
    expect(aiEnabledFromSettings({ data: { aiEnabled: false } })).toBe(false);
    expect(aiEnabledFromSettings({ data: { aiEnabled: "false" } })).toBe(true);
    expect(aiEnabledFromSettings({ data: { aiEnabled: true } })).toBe(true);
  });
});
