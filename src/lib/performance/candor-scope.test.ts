import { describe, expect, it, vi } from "vitest";

// candor.server.ts is server only: stub what it imports at load so the pure
// scope rule can be tested without a database or a session.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/page-gates", () => ({ sessionOnLegacyManagerTier: async () => false }));

const { CANDOR_ORG_WIDE, candorChainScopes, candorDefaultScope, candorScopeAllowed, candorScopeRefusal } = await import("./candor.server");

// An org of six: the manager (m) with two reports (r1, r2) who make up all
// of Design; Sales has a report and someone else; Ops is headed by m with
// nobody in m's chain; Empty has no members.
const members = [
  { id: "m", departmentId: "sales" },
  { id: "r1", departmentId: "design" },
  { id: "r2", departmentId: "design" },
  { id: "r3", departmentId: "sales" },
  { id: "x", departmentId: "sales" },
  { id: "y", departmentId: "ops" },
];
const departments = [
  { id: "design", headId: null },
  { id: "sales", headId: "boss" },
  { id: "ops", headId: "m" },
  { id: "empty", headId: null },
];

describe("candorChainScopes", () => {
  it("a manager by reporting line never gets Everyone, only the departments their chain covers or they head", () => {
    const sc = candorChainScopes({ userId: "m", reportTree: new Set(["r1", "r2", "r3"]), members, departments });
    expect(sc.everyone).toBe(false);
    expect(sc.departmentIds).toEqual(["design", "ops"]);
  });
  it("gets Everyone only when the whole company reports to them", () => {
    const sc = candorChainScopes({ userId: "m", reportTree: new Set(["r1", "r2", "r3", "x", "y"]), members, departments });
    expect(sc.everyone).toBe(true);
    expect(sc.departmentIds).toEqual(["design", "sales", "ops"]);
  });
  it("no reports is no scope at all", () => {
    expect(candorChainScopes({ userId: "m", reportTree: new Set(), members, departments })).toEqual({ everyone: false, departmentIds: [] });
  });
});

describe("candorScopeRefusal", () => {
  const chain = { everyone: false, departmentIds: ["design"] };
  it("refuses Everyone and an uncovered department for a chain-only organiser", () => {
    expect(candorScopeRefusal(chain, null)).toMatch(/Only the People team and Admins can ask everyone/);
    expect(candorScopeRefusal(chain, "sales")).toMatch(/You can only ask a department you head/);
    expect(candorScopeRefusal(chain, "design")).toBeNull();
  });
  it("says plainly when nothing fits yet", () => {
    expect(candorScopeRefusal({ everyone: false, departmentIds: [] }, null)).toMatch(/None fits yet, so ask the People team/);
  });
  it("the People team and Admin may ask anyone", () => {
    expect(candorScopeAllowed(CANDOR_ORG_WIDE, null)).toBe(true);
    expect(candorScopeRefusal(CANDOR_ORG_WIDE, "sales")).toBeNull();
  });
  it("copy carries no em dashes or double hyphens", () => {
    for (const t of [candorScopeRefusal(chain, null), candorScopeRefusal(chain, "x"), candorScopeRefusal({ everyone: false, departmentIds: [] }, null)]) {
      expect(t).not.toMatch(/\u2014|--/);
    }
  });
});

describe("candorDefaultScope", () => {
  it("starts a new draft on the organiser's own department when allowed, else the first allowed, else nothing", () => {
    expect(candorDefaultScope(CANDOR_ORG_WIDE, "sales")).toBeNull();
    expect(candorDefaultScope({ everyone: false, departmentIds: ["design", "sales"] }, "sales")).toBe("sales");
    expect(candorDefaultScope({ everyone: false, departmentIds: ["design"] }, "sales")).toBe("design");
    expect(candorDefaultScope({ everyone: false, departmentIds: [] }, "sales")).toBeUndefined();
  });
});
