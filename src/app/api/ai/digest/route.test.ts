// GET /api/ai/digest. Docs-found fixes batch 5: "Team Mood" and the low-mood
// count averaged every check-in in the workspace for anyone signed in, so in
// a small team they told a colleague a peer's mood. They now read only the
// check-ins the viewer may read one by one (check-in-access.server.ts).
// Batch 6: the KPI tiles counted and averaged every KPI reading of the
// workspace for anyone signed in, a Guest and an Agent included; now each
// tile reads only what the viewer may read (as GET /api/kpi-records reads
// it) and says whose it is, a Guest sees nothing of the workspace, the
// low-mood alert counts people, Team Size counts live people who hold a
// level here, an empty average is no number, and no sentence holds a dash.
// The engine pieces are the real ones (relationTo, levelHeldIn,
// mayActOnKpisOf, the people context's report tree); the database answers
// the where clauses as Postgres would.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type Person = { organizationId: string; level: string; memberOf: string[]; deletedAt?: Date | null; status?: string; createdAt?: Date; joinedHere?: Date };
type CheckInRow = { userId: string; organizationId: string | null; mood: number | null; createdAt: Date };

const st = vi.hoisted(() => ({
  people: {} as Record<string, { organizationId: string; level: string; memberOf: string[]; deletedAt?: Date | null; status?: string; createdAt?: Date; joinedHere?: Date }>,
  rows: [] as Array<{ userId: string; organizationId: string | null; mood: number | null; createdAt: Date }>,
  kpis: [] as Array<{ userId: string; organizationId: string; score: number | null; createdAt: Date }>,
  kras: [] as Array<{ userId: string; organizationId: string }>,
  viewer: null as Record<string, unknown> | null,
  team: [] as string[],
  /** Which KPI reads ran. */
  reads: [] as string[],
}));

function userMatches(id: string, where: Record<string, unknown>): boolean {
  const p = st.people[id] as Person | undefined;
  if (!p) return false;
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => userMatches(id, w));
    if (k === "AND") return (v as Array<Record<string, unknown>>).every((w) => userMatches(id, w));
    if (k === "organizationId") return p.organizationId === v;
    if (k === "deletedAt") return (p.deletedAt ?? null) === v;
    if (k === "status") return (p.status ?? "ACTIVE") !== (v as { not: string }).not;
    if (k === "createdAt") return (p.createdAt ?? new Date(0)) >= (v as { gte: Date }).gte;
    if (k === "organizationMemberships") {
      const m = v as { some?: { organizationId: string; createdAt?: { gte: Date } }; every?: { organizationId: string } };
      if (m.some) return p.memberOf.includes(m.some.organizationId) && (!m.some.createdAt || (p.joinedHere ?? new Date(0)) >= m.some.createdAt.gte);
      if (m.every) return p.memberOf.every((o) => o === m.every!.organizationId);
    }
    throw new Error(`the mock can't read user.${k}`);
  });
}
function checkInMatches(row: CheckInRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => checkInMatches(row, w));
    if (k === "AND") return (v as Array<Record<string, unknown>>).every((w) => checkInMatches(row, w));
    if (k === "userId") return typeof v === "string" ? row.userId === v : (v as { in: string[] }).in.includes(row.userId);
    if (k === "organizationId") return row.organizationId === v;
    if (k === "createdAt") return row.createdAt >= (v as { gte: Date }).gte;
    if (k === "mood") return row.mood !== null && row.mood <= (v as { lte: number }).lte;
    if (k === "user") return userMatches(row.userId, v as Record<string, unknown>);
    throw new Error(`the mock can't read checkIn.${k}`);
  });
}
/** A KPI record's or KRA assignment's where: its workspace, the week, the people. */
function alignmentMatches(row: { userId: string; organizationId: string; createdAt?: Date }, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "kpi" || k === "kra") return row.organizationId === (v as { organizationId: string }).organizationId;
    if (k === "createdAt") return (row.createdAt ?? new Date()) >= (v as { gte: Date }).gte;
    if (k === "userId") return (v as { in: string[] }).in.includes(row.userId);
    if (k === "status") return v === "ACTIVE";
    throw new Error(`the mock can't read ${k}`);
  });
}
const avg = (xs: Array<number | null>) => {
  const n = xs.filter((x): x is number => x !== null);
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
};

vi.mock("server-only", () => ({}));
// The session the route read before (getSessionOrFail), so this file also runs against that code.
vi.mock("next-auth", () => ({ getServerSession: async () => (st.viewer ? { user: { id: st.viewer.userId, organizationId: st.viewer.organizationId } } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => st.viewer }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => st.team }));
vi.mock("@/lib/sop-access", () => ({ sopVisibilityWhere: async () => ({}) }));
// Team Size's live people (acting-workspace.ts workspacePeopleLines is raw SQL): anchored here or a member here, not removed, not deactivated.
vi.mock("@/lib/access/acting-workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/acting-workspace")>()),
  workspacePeopleLines: async (org: string, opts: { activeOnly?: boolean } = {}) =>
    Object.entries(st.people)
      .filter(([, p]) => (p.organizationId === org || p.memberOf.includes(org)) && (p.deletedAt ?? null) === null && (!opts.activeOnly || (p.status ?? "ACTIVE") !== "INACTIVE"))
      .map(([id]) => ({ id, managerId: null })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      count: async (a: { where: Record<string, unknown> }) => Object.keys(st.people).filter((id) => userMatches(id, a.where)).length,
      findUnique: async (a: { where: { id: string } }) => {
        const p = st.people[a.where.id];
        return p ? { organizationId: p.organizationId, ...legacyLevelRow(p.level) } : null;
      },
    },
    organizationMembership: {
      // Members joined here this week whose row is anchored elsewhere (the second of Team Size's two indexed reads).
      count: async (a: { where: { organizationId: string; createdAt: { gte: Date }; user: { deletedAt: null; status: { not: string }; organizationId: { not: string } } } }) =>
        Object.values(st.people).filter(
          (p) =>
            p.memberOf.includes(a.where.organizationId) &&
            (p.joinedHere ?? new Date(0)) >= a.where.createdAt.gte &&
            (p.deletedAt ?? null) === null &&
            (p.status ?? "ACTIVE") !== a.where.user.status.not &&
            p.organizationId !== a.where.user.organizationId.not,
        ).length,
      findUnique: async (a: { where: { userId_organizationId: { userId: string; organizationId: string } } }) => {
        const p = st.people[a.where.userId_organizationId.userId];
        return p && p.memberOf.includes(a.where.userId_organizationId.organizationId) ? { role: p.level } : null;
      },
    },
    kRAAssignment: { count: async (a: { where: Record<string, unknown> }) => st.kras.filter((r) => alignmentMatches(r, a.where)).length },
    kPIRecord: {
      // Before batch 6: every record of the week, loaded.
      findMany: async (a: { where: Record<string, unknown> }) => {
        st.reads.push("kPIRecord.findMany");
        return st.kpis.filter((r) => alignmentMatches(r, a.where)).map((r) => ({ score: r.score }));
      },
      aggregate: async (a: { where: Record<string, unknown> }) => {
        st.reads.push("kPIRecord.aggregate");
        const rows = st.kpis.filter((r) => alignmentMatches(r, a.where));
        return { _count: { _all: rows.length }, _avg: { score: avg(rows.map((r) => r.score)) } };
      },
    },
    sOP: { count: async () => 2 },
    checkIn: {
      findMany: async (a: { where: Record<string, unknown>; distinct?: string[] }) => {
        const rows = st.rows.filter((r) => checkInMatches(r, a.where));
        return a.distinct ? [...new Map(rows.map((r) => [r.userId, { userId: r.userId }])).values()] : rows;
      },
      count: async (a: { where: Record<string, unknown> }) => st.rows.filter((r) => checkInMatches(r, a.where)).length,
      aggregate: async (a: { where: Record<string, unknown> }) => {
        const rows = st.rows.filter((r) => checkInMatches(r, a.where));
        return { _count: { _all: rows.length }, _avg: { mood: avg(rows.map((r) => r.mood)) } };
      },
    },
  },
}));

import { GET } from "./route";

type Digest = { highlights: Array<{ label: string; value: unknown; detail: string }>; alerts: string[] };
const digest = async () => (await (await GET()).json()) as Digest;
const tile = async (label: string) => (await digest()).highlights.find((h) => h.label === label);

const ORG = "acme";
const as = (userId: string, orgRole: string, over: Record<string, unknown> = {}) => {
  st.viewer = { userId, organizationId: ORG, orgRole, isAgent: false, adminScopes: [], reportTree: new Set<string>(), peopleTeam: false, ...over };
};

beforeEach(() => {
  st.people = {
    me: { organizationId: ORG, level: "EMPLOYEE", memberOf: [] },
    peer: { organizationId: ORG, level: "EMPLOYEE", memberOf: [] },
    admin: { organizationId: ORG, level: "COMPANY_ADMIN", memberOf: [] },
  };
  const today = new Date();
  st.rows = [
    { userId: "me", organizationId: ORG, mood: 5, createdAt: today },
    { userId: "peer", organizationId: ORG, mood: 1, createdAt: today },
  ];
  st.kpis = [];
  st.kras = [];
  st.team = [];
  st.reads = [];
});

describe("the digest's mood tiles", () => {
  it("average only the viewer's own check-ins for a colleague, so a peer's low mood never shows, and say they are the viewer's", async () => {
    as("me", "MEMBER");
    expect(await tile("Your mood")).toMatchObject({ value: "5.0", detail: "0 people with a low mood" });
    expect(await tile("Your check-ins")).toMatchObject({ value: 1 });
    expect(await tile("Team Mood")).toBeUndefined();
  });

  it("average everyone's for an Admin, who reads everyone's people data here", async () => {
    as("admin", "ADMIN");
    expect(await tile("Team Mood")).toMatchObject({ value: "3.0", detail: "1 person with a low mood" });
  });

  it("leave a check-in with no mood out of the average, never read as a 3", async () => {
    as("admin", "ADMIN");
    st.rows = [{ userId: "me", organizationId: ORG, mood: 5, createdAt: new Date() }, { userId: "peer", organizationId: ORG, mood: null, createdAt: new Date() }];
    expect(await tile("Team Mood")).toMatchObject({ value: "5.0" });
    expect(await tile("Check-ins")).toMatchObject({ value: 2 });
  });

  it("raise the low-mood alert by people, never by check-ins", async () => {
    as("admin", "ADMIN");
    const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000);
    // One person's four low days are one person.
    st.rows = [1, 2, 3, 4].map((n) => ({ userId: "peer", organizationId: ORG, mood: 1, createdAt: hoursAgo(n) }));
    let d = await digest();
    expect(d.alerts.some((a) => /low mood/.test(a))).toBe(false);
    expect(d.highlights.find((h) => h.label === "Team Mood")?.detail).toBe("1 person with a low mood");
    for (const id of ["p2", "p3", "p4"]) st.people[id] = { organizationId: ORG, level: "EMPLOYEE", memberOf: [] };
    st.rows.push(...["p2", "p3", "p4"].map((userId) => ({ userId, organizationId: ORG, mood: 2, createdAt: hoursAgo(1) })));
    d = await digest();
    expect(d.alerts).toContain("4 people reported a low mood this week.");
  });
});

describe("the digest's KPI and KRA tiles", () => {
  beforeEach(() => {
    st.people.boss = { organizationId: ORG, level: "MANAGER", memberOf: [] };
    st.people.rep = { organizationId: ORG, level: "EMPLOYEE", memberOf: [] };
    st.people.agt = { organizationId: ORG, level: "AGENT", memberOf: [] };
    const now = new Date();
    st.kpis = [
      { userId: "me", organizationId: ORG, score: 80, createdAt: now },
      { userId: "peer", organizationId: ORG, score: 40, createdAt: now },
      { userId: "rep", organizationId: ORG, score: 60, createdAt: now },
      { userId: "boss", organizationId: ORG, score: 20, createdAt: now },
      { userId: "x", organizationId: "other", score: 99, createdAt: now },
    ];
    st.kras = ["me", "peer", "rep", "boss"].map((userId) => ({ userId, organizationId: ORG }));
  });

  it("count and average only a colleague's own readings, an Agent's too, and say they are theirs", async () => {
    as("me", "MEMBER");
    expect(await tile("Your KPI updates")).toMatchObject({ value: 1, detail: "Avg score: 80" });
    expect(await tile("Your active KRAs")).toMatchObject({ value: 1, detail: "Assigned to you" });
    expect(await tile("KPI Updates")).toBeUndefined();
    as("agt", "MEMBER", { isAgent: true, reportTree: new Set(["rep"]) });
    st.kpis.push({ userId: "agt", organizationId: ORG, score: 10, createdAt: new Date() });
    expect(await tile("Your KPI updates")).toMatchObject({ value: 1, detail: "Avg score: 10" });
    // Counted in the database, never loaded row by row.
    expect(st.reads.length).toBeGreaterThan(0);
    expect(st.reads.every((r) => r === "kPIRecord.aggregate")).toBe(true);
  });

  it("count a manager's own and their reports', and everyone's here for an Admin", async () => {
    as("boss", "MEMBER", { reportTree: new Set(["rep"]) });
    st.team = ["boss", "rep"];
    expect(await tile("Your team's KPI updates")).toMatchObject({ value: 2, detail: "Avg score: 40" });
    expect(await tile("Your team's active KRAs")).toMatchObject({ value: 2, detail: "Assigned to you and your team" });
    as("admin", "ADMIN");
    expect(await tile("KPI Updates")).toMatchObject({ value: 4, detail: "Avg score: 50" });
    expect(await tile("Active KRAs")).toMatchObject({ value: 4, detail: "Assigned across the workspace" });
  });

  it("show a Guest nothing of the workspace: only their own check-ins", async () => {
    st.people.gus = { organizationId: ORG, level: "EMPLOYEE", memberOf: [] };
    st.rows.push({ userId: "gus", organizationId: ORG, mood: 4, createdAt: new Date() });
    as("gus", "GUEST");
    const d = await digest();
    expect(d.highlights.map((h) => h.label)).toEqual(["Your mood", "Your check-ins"]);
    expect(d.highlights[0]).toMatchObject({ value: "4.0" });
    expect(d.alerts).toEqual([]);
  });

  it("give no average when no reading this week has a score, never NaN, and say so plainly", async () => {
    as("admin", "ADMIN");
    st.kpis = [{ userId: "me", organizationId: ORG, score: null, createdAt: new Date() }];
    expect(await tile("KPI Updates")).toMatchObject({ value: 1, detail: "This week" });
    st.kpis = [];
    const d = await digest();
    expect(d.alerts).toContain("No KPI records this week. Check that teams are tracking them.");
    expect(JSON.stringify(d)).not.toMatch(/NaN|\u2014|--/);
  });
});

describe("the digest's Team Size", () => {
  it("counts the live people who hold a level here, a member anchored elsewhere included", async () => {
    const lastMonth = new Date(Date.now() - 30 * 86400_000);
    st.people = {
      admin: { organizationId: ORG, level: "COMPANY_ADMIN", memberOf: [], createdAt: lastMonth },
      me: { organizationId: ORG, level: "EMPLOYEE", memberOf: [], createdAt: lastMonth },
      gone: { organizationId: ORG, level: "EMPLOYEE", memberOf: [], deletedAt: new Date(), createdAt: new Date() },
      off: { organizationId: ORG, level: "EMPLOYEE", memberOf: [], status: "INACTIVE", createdAt: lastMonth },
      // Anchored in a partner workspace, a member here since this week.
      vic: { organizationId: "partner", level: "EMPLOYEE", memberOf: [ORG], createdAt: lastMonth, joinedHere: new Date() },
      out: { organizationId: "other", level: "EMPLOYEE", memberOf: [], createdAt: new Date() },
    };
    as("admin", "ADMIN");
    expect(await tile("Team Size")).toEqual({ label: "Team Size", value: 3, detail: "+1 new this week" });
  });
});
