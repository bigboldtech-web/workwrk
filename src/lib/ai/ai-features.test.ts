import { describe, expect, it } from "vitest";
import { aiFieldsOn, aiTalkUpdatesOn } from "./ai-features";

describe("the two AI opt-ins", () => {
  it("are off when the key, the data section or the whole blob is absent", () => {
    for (const s of [undefined, null, {}, [], "x", { data: null }, { data: [] }, { data: {} }]) {
      expect(aiFieldsOn(s)).toBe(false);
      expect(aiTalkUpdatesOn(s)).toBe(false);
    }
  });

  it("count only an explicit true", () => {
    for (const v of ["true", 1, "yes", {}, null]) {
      expect(aiFieldsOn({ data: { aiFields: v } })).toBe(false);
      expect(aiTalkUpdatesOn({ data: { aiTalkUpdates: v } })).toBe(false);
    }
    expect(aiFieldsOn({ data: { aiFields: true } })).toBe(true);
    expect(aiTalkUpdatesOn({ data: { aiTalkUpdates: true } })).toBe(true);
  });

  it("are independent of each other", () => {
    expect(aiTalkUpdatesOn({ data: { aiFields: true } })).toBe(false);
    expect(aiFieldsOn({ data: { aiTalkUpdates: true } })).toBe(false);
  });

  it("are off while AI features for everyone is off", () => {
    const s = { data: { aiEnabled: false, aiFields: true, aiTalkUpdates: true } };
    expect(aiFieldsOn(s)).toBe(false);
    expect(aiTalkUpdatesOn(s)).toBe(false);
  });
});
