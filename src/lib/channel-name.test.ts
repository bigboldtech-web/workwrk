import { describe, expect, it } from "vitest";
import { CHANNEL_NAME_MAX, normaliseChannelName } from "./channel-name";

describe("normaliseChannelName", () => {
  it("lowercases and hyphenates, which is the whole point", () => {
    expect(normaliseChannelName("Sales Team")).toBe("sales-team");
    expect(normaliseChannelName("  Customer   Success  ")).toBe("customer-success");
  });

  it("strips the hash people type, however many of them", () => {
    expect(normaliseChannelName("#sales")).toBe("sales");
    expect(normaliseChannelName("##sales")).toBe("sales");
    expect(normaliseChannelName("# Sales Team")).toBe("sales-team");
  });

  it("makes the two spellings of one name the SAME name", () => {
    expect(normaliseChannelName("Sales Team")).toBe(normaliseChannelName("#sales-team"));
    expect(normaliseChannelName("SALES  TEAM")).toBe(normaliseChannelName("sales team"));
  });

  it("keeps digits, underscores and hyphens, and drops everything else", () => {
    expect(normaliseChannelName("q4-2026_planning")).toBe("q4-2026_planning");
    expect(normaliseChannelName("sales & marketing!")).toBe("sales-marketing");
    expect(normaliseChannelName("café")).toBe("caf");
  });

  it("never leaves a doubled or dangling hyphen", () => {
    expect(normaliseChannelName("a  --  b")).toBe("a-b");
    expect(normaliseChannelName("-sales-")).toBe("sales");
    expect(normaliseChannelName("---")).toBe("");
  });

  it("caps the length and still ends on a real character", () => {
    const long = normaliseChannelName("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(CHANNEL_NAME_MAX);
    expect(long.endsWith("-")).toBe(false);
  });

  it("answers empty for input with nothing usable in it, so Create stays off", () => {
    expect(normaliseChannelName("")).toBe("");
    expect(normaliseChannelName("   ")).toBe("");
    expect(normaliseChannelName("###")).toBe("");
    expect(normaliseChannelName("!!!")).toBe("");
  });
});
