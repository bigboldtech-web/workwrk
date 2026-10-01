import { describe, expect, it } from "vitest";
import { bandError } from "./scoring-bands";

describe("bandError", () => {
  it("accepts the default bands", () => {
    expect(bandError([{ label: "A", min: 50, max: 100, color: "" }, { label: "B", min: 0, max: 49, color: "" }])).toBeNull();
  });
  it("names the overlapping row", () => {
    expect(bandError([{ label: "A", min: 50, max: 100, color: "" }, { label: "B", min: 40, max: 60, color: "" }])).toEqual({ row: 1, message: "Overlaps A" });
  });
  it("refuses an empty name and a reversed range", () => {
    expect(bandError([{ label: " ", min: 0, max: 10, color: "" }])?.row).toBe(0);
    expect(bandError([{ label: "X", min: 20, max: 10, color: "" }])?.message).toMatch(/low to high/);
  });
});
