// The check-in read rule (src/lib/check-in-access.server.ts, docs-found fixes
// batch 5): the list's where and the one-person ladder (relationTo) must
// agree for every viewer shape, so a list never holds a row that reading
// that person alone would refuse, and never misses one it would allow.

import { describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/access/acting-workspace", () => ({
  // Anchored here, a member here, or (out) nothing here.
  levelHeldIn: async (id: string, org: string) => (org === "acme" && id !== "out" ? "EMPLOYEE" : null),
}));

import { readsPeopleDataOf, type PeopleCtx } from "@/lib/people/person-access.server";
import { CHECK_IN_TEXT_MAX, holdsALevelIn, mayReadCheckInsOf, parseCheckIn, readableCheckInsWhere } from "./check-in-access.server";

const ctx = (over: Partial<PeopleCtx>): PeopleCtx => ({
  userId: "me", organizationId: "acme", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", isAgent: false, isAdmin: false, peopleTeam: false,
  orgWide: false, managerTier: false, chain: new Set(), writeChain: new Set(), viewer: {} as PeopleCtx["viewer"], ...over,
});

/** Every subject here holds a level in acme; the where's workspace clause is checked by the route test. */
function listed(where: Record<string, unknown>, subject: string): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => listed(w, subject));
    if (k === "userId") return typeof v === "string" ? v === subject : (v as { in: string[] }).in.includes(subject);
    if (k === "user") return JSON.stringify(v) === JSON.stringify(holdsALevelIn("acme"));
    throw new Error(`unexpected ${k}`);
  });
}

describe("readableCheckInsWhere", () => {
  const shapes: Array<[string, PeopleCtx]> = [
    ["a colleague", ctx({})],
    ["a Guest", ctx({ orgRole: "GUEST", isAdmin: false })],
    ["a manager", ctx({ managerTier: true, chain: new Set(["rep", "deep"]), writeChain: new Set(["rep", "deep"]) })],
    ["a dotted-line manager", ctx({ chain: new Set(["dot"]) })],
    ["an Admin", ctx({ orgRole: "ADMIN", isAdmin: true, orgWide: true })],
    ["the People team", ctx({ peopleTeam: true, orgWide: true })],
    ["an org-wide level", ctx({ ...legacyLevelRow("C_LEVEL"), orgWide: true })],
    ["an Agent", ctx({ isAgent: true })],
  ];
  for (const [name, c] of shapes) {
    it(`lists exactly what the ladder lets ${name} read`, () => {
      const where = readableCheckInsWhere(c) as Record<string, unknown>;
      for (const subject of ["me", "peer", "rep", "deep", "dot"]) {
        expect(listed(where, subject), `${name} / ${subject}`).toBe(subject === "me" || readsPeopleDataOf(c, subject));
      }
    });
  }

  it("reads a person in this workspace by the level they hold here, a membership included", () => {
    expect(holdsALevelIn("acme")).toEqual({ OR: [{ organizationId: "acme" }, { organizationMemberships: { some: { organizationId: "acme" } } }] });
  });
});

describe("mayReadCheckInsOf", () => {
  it("is the ladder, for someone who holds a level here", async () => {
    expect(await mayReadCheckInsOf(ctx({}), "me")).toBe(true);
    expect(await mayReadCheckInsOf(ctx({}), "peer")).toBe(false);
    expect(await mayReadCheckInsOf(ctx({ orgRole: "ADMIN", isAdmin: true }), "peer")).toBe(true);
    // An Admin here reads nothing of someone with no level here.
    expect(await mayReadCheckInsOf(ctx({ orgRole: "ADMIN", isAdmin: true }), "out")).toBe(false);
  });
});

describe("parseCheckIn", () => {
  it("takes a whole mood from 1 to 5 and bounded text, and nothing else from the body", () => {
    expect(parseCheckIn({ mood: 1, wentWell: "a", userId: "peer" })).toEqual({ ok: true, value: { mood: 1, wentWell: "a", challenges: null, tomorrow: null } });
    expect(parseCheckIn({ mood: 5, challenges: "x".repeat(CHECK_IN_TEXT_MAX) }).ok).toBe(true);
    for (const bad of [null, [], "3", { mood: "3" }, { mood: 3.5 }, { mood: 0 }, { mood: 6 }, { mood: 3, tomorrow: {} }, { mood: 3, wentWell: "x".repeat(CHECK_IN_TEXT_MAX + 1) }]) {
      expect(parseCheckIn(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
