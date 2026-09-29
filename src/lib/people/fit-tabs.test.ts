import { describe, expect, it } from "vitest";
import { fitTabs } from "./fit-tabs";

const tabs = ["overview", "kras", "goals", "reviews", "skills", "kudos", "assets", "reports"];
const chars = (k: string) => k.length + 2;

describe("fitTabs", () => {
  it("shows everything unmeasured or when it fits", () => {
    expect(fitTabs(tabs, "overview", 0, chars).overflow).toEqual([]);
    expect(fitTabs(tabs, "overview", 2000, chars).overflow).toEqual([]);
  });
  it("moves the tail into More at drawer width", () => {
    const r = fitTabs(tabs, "overview", 480, chars);
    expect(r.overflow.length).toBeGreaterThan(0);
    expect([...r.shown, ...r.overflow].sort()).toEqual([...tabs].sort());
    expect(r.overflow).toContain("reports");
  });
  it("keeps the active tab in view, in order", () => {
    const r = fitTabs(tabs, "reports", 480, chars);
    expect(r.shown).toContain("reports");
    expect(r.shown[r.shown.length - 1]).toBe("reports");
    expect(r.overflow).not.toContain("reports");
  });
});
