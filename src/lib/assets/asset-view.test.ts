import { describe, expect, it } from "vitest";
import {
  parseAssetSort, parseAssetGroup, parseWarrantyWindow, resolveAssetScope, statusColor, typeLabel, warrantyState, warrantyWithin,
} from "./asset-view";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 27);

describe("warrantyState", () => {
  it("is none without a date, or with a broken one", () => {
    expect(warrantyState(null, now)).toEqual({ kind: "none" });
    expect(warrantyState("not a date", now)).toEqual({ kind: "none" });
  });
  it("counts days both ways and warns inside the fixed 60-day rule", () => {
    expect(warrantyState(new Date(now + 23 * DAY).toISOString(), now)).toEqual({ kind: "soon", days: 23 });
    expect(warrantyState(new Date(now + 61 * DAY).toISOString(), now)).toEqual({ kind: "ok", days: 61 });
    expect(warrantyState(new Date(now - 5 * DAY).toISOString(), now)).toEqual({ kind: "expired", days: 5 });
  });
  it("warrantyWithin follows the filter window, never counting an expired one", () => {
    const in45 = new Date(now + 45 * DAY).toISOString();
    expect(warrantyWithin(in45, 30, now)).toBe(false);
    expect(warrantyWithin(in45, 60, now)).toBe(true);
    expect(warrantyWithin(new Date(now - DAY).toISOString(), 90, now)).toBe(false);
  });
});

describe("the parsers", () => {
  it("fall back to the defaults on anything unknown", () => {
    expect(parseAssetSort("value")).toBe("value");
    expect(parseAssetSort("nope")).toBe("recent");
    expect(parseAssetGroup("status")).toBe("status");
    expect(parseAssetGroup(null)).toBe("none");
    expect(parseWarrantyWindow("90")).toBe(90);
    expect(parseWarrantyWindow("45")).toBeNull();
  });
  it("labels a type in sentence case", () => {
    expect(typeLabel("ACCESS_CARD")).toBe("Access card");
  });
  it("maps every status to a semantic tone colour", () => {
    expect(statusColor("LOST")).toBe(RUN_TONE_COLOR.danger);
    expect(statusColor("ASSIGNED")).toBe(RUN_TONE_COLOR.info);
    expect(statusColor("AVAILABLE")).toBe(RUN_TONE_COLOR.neutral);
  });
});

describe("resolveAssetScope (access 5.5 situation 2)", () => {
  it("gives a manager their team and strips ?scope=all with a notice", () => {
    expect(resolveAssetScope("all", false)).toEqual({ scope: "team", stripped: true });
    expect(resolveAssetScope(null, false)).toEqual({ scope: "team", stripped: false });
  });
  it("gives the People team and Admin the org by default and their team on request", () => {
    expect(resolveAssetScope(null, true)).toEqual({ scope: "all", stripped: false });
    expect(resolveAssetScope("team", true)).toEqual({ scope: "team", stripped: false });
    expect(resolveAssetScope("garbage", true)).toEqual({ scope: "all", stripped: true });
  });
});
