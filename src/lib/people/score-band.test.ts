import { describe, expect, it } from "vitest";
import { scoreBand } from "./score-band";

const bands = [
  { label: "At risk", min: 0, max: 39 },
  { label: "Exceptional", min: 90, max: 100 },
  { label: "Strong", min: 75, max: 89 },
  { label: "On track", min: 60, max: 74 },
  { label: "Needs focus", min: 40, max: 59 },
];

describe("scoreBand", () => {
  it("maps the top and bottom bands to success and danger by rank", () => {
    expect(scoreBand(95, bands)).toEqual({ label: "Exceptional", tone: "success" });
    expect(scoreBand(10, bands)).toEqual({ label: "At risk", tone: "danger" });
  });
  it("gives the band above the bottom warning and the middle neutral", () => {
    expect(scoreBand(45, bands)?.tone).toBe("warning");
    expect(scoreBand(80, bands)?.tone).toBe("neutral");
  });
  it("returns null outside every band or with none configured", () => {
    expect(scoreBand(150, bands)).toBeNull();
    expect(scoreBand(50, [])).toBeNull();
  });
});
