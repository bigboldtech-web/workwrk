import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration";

describe("formatDuration", () => {
  it("reads seconds, minutes and hours", () => {
    expect(formatDuration(420)).toBe("0.4s");
    expect(formatDuration(3)).toBe("under 0.1s");
    expect(formatDuration(0)).toBe("under 0.1s");
    expect(formatDuration(60)).toBe("0.1s");
    expect(formatDuration(12_400)).toBe("12s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(3_780_000)).toBe("1h 3m");
  });
  it("is null for anything that is not a finished duration", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });
});
