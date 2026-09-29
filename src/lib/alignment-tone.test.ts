import { describe, expect, it } from "vitest";
import { complianceBand, complianceTone, complianceWord } from "./alignment-tone";

describe("complianceTone", () => {
  it("uses the one 80 / 50 rule", () => {
    expect(complianceTone(80)).toBe("success");
    expect(complianceTone(79)).toBe("warning");
    expect(complianceTone(50)).toBe("warning");
    expect(complianceTone(49)).toBe("danger");
    expect(complianceTone(null)).toBe("neutral");
    expect(complianceTone(Number.NaN)).toBe("neutral");
  });
  it("always has a word and a band", () => {
    expect(complianceWord(90)).toBe("On track");
    expect(complianceWord(undefined)).toBe("Not measured");
    expect(complianceBand(10)).toBe("low");
    expect(complianceBand(60)).toBe("mid");
    expect(complianceBand(100)).toBe("high");
    expect(complianceBand(null)).toBe("none");
  });
});
