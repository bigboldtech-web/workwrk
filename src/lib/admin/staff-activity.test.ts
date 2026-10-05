import { describe, expect, it } from "vitest";
import { STAFF_ACTIONS } from "@/lib/staff-audit-helpers";
import {
  ACTION_LABEL,
  ACTION_VIEW,
  activeActivityFilterCount,
  activityOrderBy,
  activityWhere,
  detailRows,
  parseActivityParams,
  plainValue,
} from "./staff-activity";

const sp = (s: string) => new URLSearchParams(s);

describe("the action vocabulary", () => {
  it("gives every action key a view and a label", () => {
    for (const k of STAFF_ACTIONS) {
      expect(ACTION_VIEW[k]).toBeTruthy();
      expect(ACTION_LABEL[k]).toBeTruthy();
    }
  });
});

describe("parseActivityParams", () => {
  it("lower-cases who, refuses a bad company id and an unknown action", () => {
    const p = parseActivityParams(sp("who=Priya@WorkWrk.com&company=%25&action=admin.drop&from=2026-09-01&sort=oldest"));
    expect(p.who).toBe("priya@workwrk.com");
    expect(p.company).toBeNull();
    expect(p.action).toBeNull();
    expect(p.from).toBe("2026-09-01");
    expect(p.sort).toBe("oldest");
    expect(activeActivityFilterCount(p)).toBe(2);
  });
});

describe("activityWhere", () => {
  it("a view is the set of its action keys", () => {
    const w = activityWhere(parseActivityParams(sp("view=codes"))) as { AND: { action: { in: string[] } }[] };
    expect(w.AND[0].action.in.sort()).toEqual(["admin.code.refunded", "admin.codes.imported"]);
  });
  it("combines company and action, and pages newest first by default", () => {
    const w = activityWhere(parseActivityParams(sp("company=cmabc12345&action=admin.org.plan_changed"))) as { AND: unknown[] };
    expect(w.AND).toEqual([{ targetCompanyId: "cmabc12345" }, { action: "admin.org.plan_changed" }]);
    expect(activityOrderBy("newest")).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
});

describe("plain words for before and after", () => {
  it("renders plans, statuses, roles, switches and unlimited seats in words", () => {
    expect(plainValue("plan", "GROWTH")).toBe("Growth");
    expect(plainValue("status", "SUSPENDED")).toBe("Suspended");
    expect(plainValue("role", "SUPER_ADMIN")).toBe("Owner");
    expect(plainValue("enabled", true)).toBe("On");
    expect(plainValue("seats", null)).toBe("Unlimited");
    expect(plainValue("name", null)).toBe("None");
  });
  it("lists every key either side holds", () => {
    expect(detailRows({ plan: "GROWTH" }, { plan: "SCALE", signedOut: 3 })).toEqual([
      { key: "plan", label: "Plan", before: "Growth", after: "Scale", changed: true },
      { key: "signedOut", label: "Signed out", before: "None", after: "3", changed: true },
    ]);
    expect(detailRows({ name: "Ann", role: "MEMBER" }, { name: "Ann", role: "OWNER" }).map((r) => [r.key, r.changed])).toEqual([
      ["name", false],
      ["role", true],
    ]);
    expect(detailRows(null, null)).toEqual([]);
  });
  it("shows a trial end as its UTC day, never a time in the viewer's zone", () => {
    const zoned = (iso: string) => `zoned ${iso}`;
    expect(plainValue("trialEndsAt", "2026-10-19T12:00:00.000Z", zoned)).toBe("2026-10-19");
    expect(plainValue("trialEndsAt", null, zoned)).toBe("None");
    expect(plainValue("cancelledAt", "2026-10-19T12:00:00.000Z", zoned)).toBe("zoned 2026-10-19T12:00:00.000Z");
    expect(detailRows({ trialEndsAt: "2026-10-12T12:00:00.000Z" }, { trialEndsAt: "2026-10-19T12:00:00.000Z" }, { date: zoned })).toEqual([
      { key: "trialEndsAt", label: "Trial end", before: "2026-10-12", after: "2026-10-19", changed: true },
    ]);
  });
});
