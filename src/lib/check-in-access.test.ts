// The check-in read rule (src/lib/check-in-access.server.ts, docs-found fixes
// batch 5): the list's where and the one-person ladder (relationTo) must
// agree for every viewer shape, so a list never holds a row that reading
// that person alone would refuse, and never misses one it would allow.
// Batch 6: and each row only in the workspace it belongs to: written there,
// or written before check-ins named one by someone whose only workspace it
// is (a person's own older rows stay theirs wherever they work).

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
import { CHECK_IN_TEXT_MAX, checkInReach, holdsALevelIn, holdsALevelOnlyIn, mayReadCheckInsOf, parseCheckIn, readableCheckInsWhere } from "./check-in-access.server";

const ctx = (over: Partial<PeopleCtx>): PeopleCtx => ({
  userId: "me", organizationId: "acme", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", isAgent: false, isAdmin: false, peopleTeam: false,
  orgWide: false, managerTier: false, chain: new Set(), writeChain: new Set(), viewer: {} as PeopleCtx["viewer"], ...over,
});

/** Where each subject works: their anchor, and their memberships. */
const PEOPLE: Record<string, { anchor: string; memberOf: string[] }> = {
  me: { anchor: "acme", memberOf: [] },
  peer: { anchor: "acme", memberOf: [] },
  rep: { anchor: "acme", memberOf: [] },
  deep: { anchor: "acme", memberOf: [] },
  dot: { anchor: "acme", memberOf: ["acme"] }, // a membership row in the anchored workspace too: still one workspace
  // Anchored here, with a membership in a client workspace: two workspaces.
  dana: { anchor: "acme", memberOf: ["globex"] },
  // Works here through a membership, anchored in a partner workspace.
  vic: { anchor: "partner", memberOf: ["acme"] },
};
const SUBJECTS = Object.keys(PEOPLE);
/** A row each subject wrote in acme, in globex, and before check-ins named a workspace. */
const WRITTEN_IN = ["acme", "globex", null] as const;

function userMatches(id: string, where: Record<string, unknown>): boolean {
  const p = PEOPLE[id];
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => userMatches(id, w));
    if (k === "organizationId") return p.anchor === v;
    if (k === "organizationMemberships") {
      const m = v as { some?: { organizationId: string }; every?: { organizationId: string } };
      if (m.some) return p.memberOf.includes(m.some.organizationId);
      if (m.every) return p.memberOf.every((o) => o === m.every!.organizationId);
    }
    throw new Error(`unexpected user.${k}`);
  });
}
/** A check-in where, answered as Postgres would, for one row. */
function listed(where: Record<string, unknown>, row: { userId: string; organizationId: string | null }): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => listed(w, row));
    if (k === "AND") return (v as Array<Record<string, unknown>>).every((w) => listed(w, row));
    if (k === "userId") return typeof v === "string" ? v === row.userId : (v as { in: string[] }).in.includes(row.userId);
    if (k === "organizationId") return row.organizationId === v;
    if (k === "user") return userMatches(row.userId, v as Record<string, unknown>);
    throw new Error(`unexpected ${k}`);
  });
}
/** The rule, said plainly: the person's own row written here or before workspaces; anyone else's only by the ladder, of someone with a level here, and only a row of this workspace. */
function expected(c: PeopleCtx, row: { userId: string; organizationId: string | null }): boolean {
  if (row.userId === c.userId) return row.organizationId === "acme" || row.organizationId === null;
  const p = PEOPLE[row.userId];
  const workspaces = new Set([p.anchor, ...p.memberOf]);
  if (!readsPeopleDataOf(c, row.userId) || !workspaces.has("acme")) return false;
  return row.organizationId === "acme" || (row.organizationId === null && workspaces.size === 1);
}

describe("readableCheckInsWhere", () => {
  const shapes: Array<[string, PeopleCtx]> = [
    ["a colleague", ctx({})],
    ["a Guest", ctx({ orgRole: "GUEST", isAdmin: false })],
    ["a manager", ctx({ managerTier: true, chain: new Set(["rep", "deep"]), writeChain: new Set(["rep", "deep"]) })],
    ["a dotted-line manager", ctx({ chain: new Set(["dot"]) })],
    ["a manager of people in two workspaces", ctx({ managerTier: true, chain: new Set(["dana", "vic"]), writeChain: new Set(["dana", "vic"]) })],
    ["an Admin", ctx({ orgRole: "ADMIN", isAdmin: true, orgWide: true })],
    ["the People team", ctx({ peopleTeam: true, orgWide: true })],
    ["an org-wide level", ctx({ ...legacyLevelRow("C_LEVEL"), orgWide: true })],
    ["an Agent", ctx({ isAgent: true })],
  ];
  for (const [name, c] of shapes) {
    it(`lists exactly what the ladder lets ${name} read, of this workspace only`, () => {
      const where = readableCheckInsWhere(c) as Record<string, unknown>;
      for (const userId of SUBJECTS) {
        for (const organizationId of WRITTEN_IN) {
          const row = { userId, organizationId };
          expect(listed(where, row), `${name} / ${userId} / written in ${organizationId}`).toBe(expected(c, row));
        }
      }
    });
  }

  it("reads a person in this workspace by the level they hold here, a membership included", () => {
    expect(holdsALevelIn("acme")).toEqual({ OR: [{ organizationId: "acme" }, { organizationMemberships: { some: { organizationId: "acme" } } }] });
    expect(holdsALevelOnlyIn("acme")).toEqual({ organizationId: "acme", organizationMemberships: { every: { organizationId: "acme" } } });
  });
});

// Docs-found fixes batch 6, the review's scenario: Dana is anchored in Acme
// with a membership in Globex. Her Acme check-ins (and her older ones, which
// name no workspace) reached every Globex Admin.
describe("a check-in stays in the workspace it was written in", () => {
  const where = (c: PeopleCtx) => readableCheckInsWhere(c) as Record<string, unknown>;
  const globexAdmin = ctx({ userId: "gia", organizationId: "globex", orgRole: "ADMIN", isAdmin: true, orgWide: true });
  const acmeAdmin = ctx({ userId: "ada", orgRole: "ADMIN", isAdmin: true, orgWide: true });

  it("never reaches another workspace's Admin, People team or org-wide level", () => {
    for (const c of [globexAdmin, { ...globexAdmin, isAdmin: false, orgRole: "MEMBER", peopleTeam: true }, { ...globexAdmin, isAdmin: false, orgRole: "MEMBER", ...legacyLevelRow("VP") }]) {
      expect(listed(where(c), { userId: "dana", organizationId: "acme" })).toBe(false);
      // Written before workspaces, by someone who works in two: no workspace reads it but her.
      expect(listed(where(c), { userId: "dana", organizationId: null })).toBe(false);
      expect(listed(where(c), { userId: "dana", organizationId: "globex" })).toBe(true);
    }
    expect(listed(where(acmeAdmin), { userId: "dana", organizationId: "acme" })).toBe(true);
    expect(listed(where(acmeAdmin), { userId: "dana", organizationId: null })).toBe(false);
    expect(listed(where(acmeAdmin), { userId: "dana", organizationId: "globex" })).toBe(false);
  });

  it("keeps an older row readable where its person works alone, and a person's own older rows theirs wherever they work", () => {
    expect(listed(where(acmeAdmin), { userId: "peer", organizationId: null })).toBe(true);
    expect(listed(where(acmeAdmin), { userId: "vic", organizationId: null })).toBe(false);
    const dana = ctx({ userId: "dana", organizationId: "globex" });
    expect(listed(where(dana), { userId: "dana", organizationId: null })).toBe(true);
    expect(listed(where(dana), { userId: "dana", organizationId: "globex" })).toBe(true);
    // Her own, written in Acme, is read in Acme, not in Globex.
    expect(listed(where(dana), { userId: "dana", organizationId: "acme" })).toBe(false);
  });

  it("names what the viewer reads, for the digest's labels", () => {
    expect(checkInReach(acmeAdmin)).toBe("workspace");
    expect(checkInReach(ctx({ chain: new Set(["rep"]) }))).toBe("team");
    expect(checkInReach(ctx({}))).toBe("own");
    expect(checkInReach(ctx({ orgRole: "GUEST", peopleTeam: true }))).toBe("own");
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
