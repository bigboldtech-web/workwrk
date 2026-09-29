import { describe, expect, it } from "vitest";
import {
  SEARCH_MAX_CHARS,
  boundedInt,
  escapeLike,
  codeSearchWhere,
  codeSecondary,
  codeStatus,
  companySearchWhere,
  companySecondary,
  normalizeSearchQuery,
  parseSearchLimit,
  parseSearchTypes,
  staffSearchWhere,
} from "./search";

describe("normalizeSearchQuery", () => {
  it("needs two characters after trimming", () => {
    expect(normalizeSearchQuery("")).toBeNull();
    expect(normalizeSearchQuery(" a ")).toBeNull();
    expect(normalizeSearchQuery(null)).toBeNull();
    expect(normalizeSearchQuery("ac")).toBe("ac");
  });
  it("collapses whitespace and caps the length", () => {
    expect(normalizeSearchQuery("  acme   corp ")).toBe("acme corp");
    expect(normalizeSearchQuery("x".repeat(500))).toHaveLength(SEARCH_MAX_CHARS);
  });
});

describe("parseSearchTypes", () => {
  it("defaults to all three and drops unknown words", () => {
    expect(parseSearchTypes(null)).toEqual(["companies", "staff", "codes"]);
    expect(parseSearchTypes("tasks,docs")).toEqual(["companies", "staff", "codes"]);
    expect(parseSearchTypes("codes, COMPANIES")).toEqual(["companies", "codes"]);
  });
});

describe("parseSearchLimit", () => {
  it("defaults to 8 and clamps to 1..20", () => {
    expect(parseSearchLimit(null)).toBe(8);
    expect(parseSearchLimit("abc")).toBe(8);
    expect(parseSearchLimit("0")).toBe(1);
    expect(parseSearchLimit("500")).toBe(20);
  });
});

describe("the where clauses", () => {
  it("match companies on name, slug and sign-in domain only", () => {
    const w = companySearchWhere("acme");
    expect(w.OR?.map((c) => Object.keys(c)[0])).toEqual(["name", "slug", "domain"]);
    expect(JSON.stringify(w)).not.toMatch(/task|doc|message|settings/i);
  });
  it("match staff on email and name", () => {
    expect(staffSearchWhere("ann").OR?.map((c) => Object.keys(c)[0])).toEqual(["email", "name"]);
  });
  it("match codes by prefix, ignoring spaces and case", () => {
    expect(codeSearchWhere("AB 12")).toEqual({ code: { startsWith: "AB12", mode: "insensitive" } });
  });
});

describe("codeStatus and codeSecondary", () => {
  it("a refund wins over a redemption", () => {
    expect(codeStatus({ redeemedAt: new Date(), refundedAt: new Date() })).toBe("refunded");
    expect(codeStatus({ redeemedAt: "2026-01-01", refundedAt: null })).toBe("redeemed");
    expect(codeStatus({ redeemedAt: null, refundedAt: null })).toBe("unused");
  });
  it("names the company, and never a dangling id when it is gone", () => {
    expect(codeSecondary("redeemed", "Acme")).toBe("Redeemed by Acme");
    expect(codeSecondary("redeemed", null)).toBe("Redeemed");
    expect(codeSecondary("unused", null)).toBe("Unused");
    expect(codeSecondary("refunded", "Acme")).toBe("Refunded");
  });
});

describe("companySecondary", () => {
  it("reads plan and status in words", () => {
    expect(companySecondary("SCALE", "ACTIVE")).toBe("Scale · Active");
    expect(companySecondary("GROWTH", "SUSPENDED")).toBe("Growth · Suspended");
  });
});

describe("escapeLike", () => {
  it("makes % and _ literal, so they are never wildcards", () => {
    expect(escapeLike("%%")).toBe("\\%\\%");
    expect(escapeLike("P9_TEST")).toBe("P9\\_TEST");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
    expect(escapeLike("acme")).toBe("acme");
  });
  it("is applied by every search rule", () => {
    expect(JSON.stringify(companySearchWhere("%%"))).toContain("\\\\%\\\\%");
    expect(JSON.stringify(staffSearchWhere("__"))).toContain("\\\\_\\\\_");
    expect(codeSearchWhere("P9_T")).toEqual({ code: { startsWith: "P9\\_T", mode: "insensitive" } });
  });
});

describe("boundedInt", () => {
  it("falls back on garbage and clamps to the range", () => {
    expect(boundedInt("abc", 1, 1, 100)).toBe(1);
    expect(boundedInt(null, 20, 1, 100)).toBe(20);
    expect(boundedInt("0", 1, 1, 100)).toBe(1);
    expect(boundedInt("-5", 100, 1, 500)).toBe(1);
    expect(boundedInt("9999", 100, 1, 500)).toBe(500);
    expect(boundedInt("42", 1, 1, 100)).toBe(42);
  });
});
