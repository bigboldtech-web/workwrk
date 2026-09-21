import { describe, expect, it } from "vitest";
import {
  gapStatusWord,
  matchesGap,
  matchesPerson,
  matchesPolicy,
  parsePeriod,
  parsePolicyComplianceView,
  periodStart,
  policyComplianceStats,
} from "./policy-compliance-view";

describe("parsePolicyComplianceView", () => {
  it("falls back to overview silently", () => {
    expect(parsePolicyComplianceView(null)).toBe("overview");
    expect(parsePolicyComplianceView("bogus")).toBe("overview");
    expect(parsePolicyComplianceView("gaps")).toBe("gaps");
  });
});

describe("periods", () => {
  const now = new Date(2026, 8, 21, 12, 0, 0);
  it("parses the four periods and defaults to all time", () => {
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod(undefined)).toBe("all");
    expect(periodStart("all", now)).toBeNull();
  });
  it("starts this month on the first and this quarter on the quarter's first month", () => {
    const local = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null);
    expect(local(periodStart("month", now))).toBe("2026-09-01");
    expect(local(periodStart("quarter", now))).toBe("2026-07-01");
  });
  it("last 30 days is thirty days back", () => {
    const s = periodStart("30d", now)!;
    expect(Math.round((now.getTime() - s.getTime()) / 86_400_000)).toBe(30);
  });
});

describe("policyComplianceStats", () => {
  it("draws the danger dot only when something is overdue", () => {
    const base = { totalPolicies: 2, totalUsers: 10, totalRequired: 20, totalAcked: 15, orgRate: 75, pending: 5, overdue: 0, outOfDate: 1 };
    const cards = policyComplianceStats(base);
    expect(cards.map((c) => c.label)).toEqual(["Required", "Acknowledged", "Pending", "Overdue"]);
    expect(cards[1].value).toBe("15 of 20");
    expect(cards[2].sub).toBe("1 need re-acknowledgement");
    expect(cards[3].dot).toBeUndefined();
    expect(policyComplianceStats({ ...base, overdue: 2 })[3].dot).toBe("danger");
  });
});

describe("search rules", () => {
  it("matches the person and the policy title in a gap row", () => {
    const row = { policyTitle: "Expense policy", userName: "Priya Nair", department: "Finance" };
    expect(matchesGap(row, "priya")).toBe(true);
    expect(matchesGap(row, "expense")).toBe(true);
    expect(matchesGap(row, "zzz")).toBe(false);
    expect(matchesGap(row, "  ")).toBe(true);
  });
  it("matches people and policies by their own fields", () => {
    expect(matchesPerson({ name: "Sam Lee", department: "Sales" }, "sales")).toBe(true);
    expect(matchesPolicy({ title: "Code of conduct", category: "HR" }, "hr")).toBe(true);
    expect(matchesPolicy({ title: "Code of conduct", category: null }, "hr")).toBe(false);
  });
});

describe("gapStatusWord", () => {
  it("names the days late, never colour alone", () => {
    expect(gapStatusWord("overdue", 3)).toBe("3 days late");
    expect(gapStatusWord("overdue", 1)).toBe("1 day late");
    expect(gapStatusWord("overdue", 0)).toBe("Overdue");
    expect(gapStatusWord("out-of-date", 0)).toBe("Re-acknowledge");
    expect(gapStatusWord("pending", 0)).toBe("Pending");
  });
});
