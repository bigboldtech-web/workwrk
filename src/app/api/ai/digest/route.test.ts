// GET /api/ai/digest's mood tiles. Docs-found fixes batch 5: "Team Mood" and
// the low-mood count averaged every check-in in the workspace for anyone
// signed in, so in a small team they told a colleague a peer's mood. They now
// read only the check-ins the viewer may read one by one
// (src/lib/check-in-access.server.ts readableCheckInsWhere).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  people: {} as Record<string, { organizationId: string; level: string; memberOf: string[] }>,
  rows: [] as Array<{ userId: string; mood: number; createdAt: Date }>,
  viewer: null as Record<string, unknown> | null,
}));

type Row = { userId: string; mood: number; createdAt: Date };
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => matches(row, w));
    if (k === "AND") return (v as Array<Record<string, unknown>>).every((w) => matches(row, w));
    if (k === "userId") return typeof v === "string" ? row.userId === v : (v as { in: string[] }).in.includes(row.userId);
    if (k === "createdAt") return row.createdAt >= (v as { gte: Date }).gte;
    if (k === "mood") return row.mood <= (v as { lte: number }).lte;
    if (k === "user") {
      const p = st.people[row.userId];
      const u = v as Record<string, unknown>;
      const one = (w: Record<string, unknown>): boolean =>
        "OR" in w ? (w.OR as Array<Record<string, unknown>>).some(one)
        : "organizationId" in w ? p?.organizationId === w.organizationId
        : "organizationMemberships" in w ? !!p?.memberOf.includes((w.organizationMemberships as { some: { organizationId: string } }).some.organizationId)
        : false;
      return one(u);
    }
    throw new Error(`the mock can't read ${k}`);
  });
}

vi.mock("server-only", () => ({}));
// The session the route read before (getSessionOrFail), so this file also runs against that code.
vi.mock("next-auth", () => ({ getServerSession: async () => (st.viewer ? { user: { id: st.viewer.userId, organizationId: st.viewer.organizationId } } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => st.viewer }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      count: async () => Object.keys(st.people).length,
      findUnique: async (a: { where: { id: string } }) => {
        const p = st.people[a.where.id];
        return p ? { organizationId: p.organizationId, ...legacyLevelRow(p.level) } : null;
      },
    },
    organizationMembership: { findUnique: async () => null },
    kRAAssignment: { count: async () => 0 },
    kPIRecord: { findMany: async () => [] },
    sOP: { count: async () => 0 },
    checkIn: {
      findMany: async (a: { where: Record<string, unknown> }) => st.rows.filter((r) => matches(r, a.where)),
      count: async (a: { where: Record<string, unknown> }) => st.rows.filter((r) => matches(r, a.where)).length,
    },
  },
}));

import { GET } from "./route";

const tile = async (label: string) => {
  const body = (await (await GET()).json()) as { highlights: Array<{ label: string; value: unknown; detail: string }> };
  return body.highlights.find((h) => h.label === label)!;
};

beforeEach(() => {
  st.people = {
    me: { organizationId: "acme", level: "EMPLOYEE", memberOf: [] },
    peer: { organizationId: "acme", level: "EMPLOYEE", memberOf: [] },
    admin: { organizationId: "acme", level: "COMPANY_ADMIN", memberOf: [] },
  };
  const today = new Date();
  st.rows = [
    { userId: "me", mood: 5, createdAt: today },
    { userId: "peer", mood: 1, createdAt: today },
  ];
});

describe("the digest's mood tiles", () => {
  it("average only the viewer's own check-ins for a colleague, so a peer's low mood never shows", async () => {
    st.viewer = { userId: "me", organizationId: "acme", orgRole: "MEMBER", isAgent: false, adminScopes: [], reportTree: new Set() };
    expect(await tile("Team Mood")).toMatchObject({ value: "5.0", detail: "0 low-mood check-ins" });
    expect(await tile("Check-ins")).toMatchObject({ value: 1 });
  });

  it("average everyone's for an Admin, who reads everyone's people data here", async () => {
    st.viewer = { userId: "admin", organizationId: "acme", orgRole: "ADMIN", isAgent: false, adminScopes: [], reportTree: new Set() };
    expect(await tile("Team Mood")).toMatchObject({ value: "3.0", detail: "1 low-mood check-ins" });
  });
});
