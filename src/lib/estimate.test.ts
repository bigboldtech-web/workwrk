import { describe, expect, it } from "vitest";
import { formatClock, formatMinutes, formatTracked, parseEstimate } from "./estimate";

describe("parseEstimate", () => {
  it("reads every form the field advertises", () => {
    expect(parseEstimate("2h 30m")).toBe(150);
    expect(parseEstimate("2h")).toBe(120);
    expect(parseEstimate("90m")).toBe(90);
    expect(parseEstimate("1.5h")).toBe(90);
    expect(parseEstimate("45")).toBe(45);
  });

  it("is case and whitespace tolerant", () => {
    expect(parseEstimate("  2H 30M ")).toBe(150);
  });

  it("answers null for nothing, for junk and for zero", () => {
    expect(parseEstimate("")).toBeNull();
    expect(parseEstimate("   ")).toBeNull();
    expect(parseEstimate("soon")).toBeNull();
    expect(parseEstimate("0")).toBeNull();
    expect(parseEstimate("0h 0m")).toBeNull();
  });

  it("round-trips through formatMinutes", () => {
    for (const m of [1, 45, 60, 90, 150, 480, 1441]) {
      expect(parseEstimate(formatMinutes(m))).toBe(m);
    }
  });
});

describe("formatMinutes", () => {
  it("drops a zero remainder and never prints a bare zero hour", () => {
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(150)).toBe("2h 30m");
    expect(formatMinutes(30)).toBe("30m");
    expect(formatMinutes(0)).toBe("0m");
  });
});

describe("formatTracked", () => {
  it("degrades from hours to seconds", () => {
    expect(formatTracked(4_800_000)).toBe("1h 20m");
    expect(formatTracked(2_700_000)).toBe("45m");
    expect(formatTracked(12_000)).toBe("12s");
    expect(formatTracked(0)).toBe("0m");
  });
});

describe("formatClock", () => {
  it("shows hours only once there are any", () => {
    expect(formatClock(3_749_000)).toBe("1:02:29");
    expect(formatClock(249_000)).toBe("4:09");
    expect(formatClock(-5)).toBe("0:00");
  });
});
