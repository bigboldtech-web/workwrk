import { beforeEach, describe, expect, it, vi } from "vitest";

// The workspace a session acts in, for nodeCtxFromSession and the suite routes
// alike: the session's own workspace at its membership's role, else the anchor.
const users = new Map<string, { organizationId: string; accessLevel: string; status: string; deletedAt: Date | null; orgRole?: string }>();
const memberships = new Map<string, { role: string; status?: string; removedAt?: Date | null }>();
let session: { user: { id: string; organizationId?: string; accessLevel?: string } } | null = null;

vi.mock("next-auth/next", () => ({ getServerSession: async () => session }));
vi.mock("next-auth", () => ({ getServerSession: async () => session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
/** The SQL each $queryRaw was sent, with its values (docs-found fixes batch 6). */
const raw: Array<{ sql: string; values: unknown[] }> = [];
type OrgWhere = string | { not?: string; in?: string[] };
const orgOk = (w: OrgWhere, org: string) => (typeof w === "string" ? w === org : (w.not === undefined || w.not !== org) && (w.in === undefined || w.in.includes(org)));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => users.has(id)).map((id) => ({ id, ...users.get(id)! })),
    },
    organizationMembership: {
      findUnique: async ({ where }: { where: { userId_organizationId: { userId: string; organizationId: string } } }) =>
        memberships.get(`${where.userId_organizationId.userId}:${where.userId_organizationId.organizationId}`) ?? null,
      findMany: async ({ where }: { where: { userId: { in: string[] }; organizationId: OrgWhere } }) =>
        [...memberships.entries()]
          .map(([key, m]) => ({ userId: key.split(":")[0], organizationId: key.split(":")[1], role: m.role, status: m.status ?? "ACTIVE", removedAt: m.removedAt ?? null }))
          .filter((m) => where.userId.in.includes(m.userId) && orgOk(where.organizationId, m.organizationId)),
    },
    // Rendered as Postgres would receive it: a nested fragment (workspace-seat.ts liveSeatSql) inline.
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const q = Prisma.sql(sql, ...values);
      raw.push({ sql: q.sql, values: q.values });
      return [];
    },
  },
}));

import { Prisma } from "@/generated/prisma";
import { actingWorkspace, inWorkspaceWhere, levelHeldIn, levelsHeldFor, levelsHeldIn, lineStandingsElsewhere, linesElsewhere, workspaceDottedLines, workspacePeopleLines } from "./acting-workspace";
import { nodeCtxFromSession } from "./node-access";

beforeEach(() => {
  users.clear();
  memberships.clear();
  users.set("u1", { organizationId: "orgB", accessLevel: "COMPANY_ADMIN", status: "ACTIVE", deletedAt: null });
  session = null;
});

const anchored = { id: "u1", organizationId: "orgB", accessLevel: "COMPANY_ADMIN" as const };

describe("actingWorkspace", () => {
  it("is the anchored workspace at the anchored level when the session acts there", async () => {
    expect(await actingWorkspace(anchored, "orgB")).toEqual({ organizationId: "orgB", accessLevel: "COMPANY_ADMIN" });
    expect(await actingWorkspace(anchored, undefined)).toEqual({ organizationId: "orgB", accessLevel: "COMPANY_ADMIN" });
  });

  it("is the session's workspace at the membership's role, never the anchor's level", async () => {
    memberships.set("u1:orgA", { role: "EMPLOYEE" });
    expect(await actingWorkspace(anchored, "orgA")).toEqual({ organizationId: "orgA", accessLevel: "EMPLOYEE" });
  });

  it("falls back to the anchor when the person holds no membership where the session acts", async () => {
    expect(await actingWorkspace(anchored, "orgC")).toEqual({ organizationId: "orgB", accessLevel: "COMPANY_ADMIN" });
  });

  // docs/plans/workspace-status.md D7: an ended membership is no membership.
  // Before, a session acting in a workspace that had deactivated or removed
  // the person kept acting there at the membership's role.
  it("falls back to the anchor when the membership where the session acts is deactivated or removed", async () => {
    memberships.set("u1:orgA", { role: "MANAGER", status: "INACTIVE" });
    expect(await actingWorkspace(anchored, "orgA")).toEqual({ organizationId: "orgB", accessLevel: "COMPANY_ADMIN" });
    memberships.set("u1:orgA", { role: "MANAGER", status: "ACTIVE", removedAt: new Date("2026-10-01") });
    expect(await actingWorkspace(anchored, "orgA")).toEqual({ organizationId: "orgB", accessLevel: "COMPANY_ADMIN" });
    // An HR status there is still a seat.
    memberships.set("u1:orgA", { role: "MANAGER", status: "NOTICE_PERIOD" });
    expect(await actingWorkspace(anchored, "orgA")).toEqual({ organizationId: "orgA", accessLevel: "MANAGER" });
  });
});

describe("the level held in one workspace, with an ended membership (D7)", () => {
  it("levelHeldIn: none through a deactivated or removed membership, the role through a live one", async () => {
    memberships.set("u1:orgA", { role: "MANAGER", status: "INACTIVE" });
    expect(await levelHeldIn("u1", "orgA")).toBeNull();
    memberships.set("u1:orgA", { role: "MANAGER", status: "ACTIVE", removedAt: new Date("2026-10-01") });
    expect(await levelHeldIn("u1", "orgA")).toBeNull();
    memberships.set("u1:orgA", { role: "MANAGER", status: "PIP" });
    expect(await levelHeldIn("u1", "orgA")).toBe("MANAGER");
    // The anchored workspace keeps its own rules: the row's level, whatever a membership row there says.
    memberships.set("u1:orgB", { role: "EMPLOYEE", status: "INACTIVE" });
    expect(await levelHeldIn("u1", "orgB")).toBe("COMPANY_ADMIN");
  });

  it("levelsHeldFor and levelsHeldIn leave out a person whose membership here is ended", async () => {
    users.set("off", { organizationId: "orgB", accessLevel: "EMPLOYEE", status: "ACTIVE", deletedAt: null });
    users.set("gone", { organizationId: "orgB", accessLevel: "EMPLOYEE", status: "ACTIVE", deletedAt: null });
    users.set("on", { organizationId: "orgB", accessLevel: "EMPLOYEE", status: "ACTIVE", deletedAt: null });
    memberships.set("off:orgA", { role: "MANAGER", status: "INACTIVE" });
    memberships.set("gone:orgA", { role: "MANAGER", status: "INACTIVE", removedAt: new Date("2026-10-01") });
    memberships.set("on:orgA", { role: "MANAGER", status: "ON_LEAVE" });
    const rows = ["off", "gone", "on"].map((id) => ({ id, organizationId: "orgB", accessLevel: "EMPLOYEE" as const }));
    expect([...(await levelsHeldFor("orgA", rows)).entries()]).toEqual([["on", "MANAGER"]]);
    expect([...(await levelsHeldIn("orgA", ["off", "gone", "on"])).entries()]).toEqual([["on", "MANAGER"]]);
  });
});

describe("inWorkspaceWhere (D7, D12)", () => {
  it("counts a live membership only, by default", () => {
    expect(inWorkspaceWhere("orgA")).toEqual({
      OR: [{ organizationId: "orgA" }, { organizationMemberships: { some: { organizationId: "orgA", status: { not: "INACTIVE" }, removedAt: null } } }],
    });
  });

  it("keeps a deactivated membership, never a removed one, with deactivatedToo", () => {
    expect(inWorkspaceWhere("orgA", { deactivatedToo: true })).toEqual({
      OR: [{ organizationId: "orgA" }, { organizationMemberships: { some: { organizationId: "orgA", removedAt: null } } }],
    });
    expect(inWorkspaceWhere("orgA", { deactivatedToo: false })).toEqual(inWorkspaceWhere("orgA"));
  });
});

describe("nodeCtxFromSession", () => {
  it("acts in the session's workspace with a membership there, at that membership's level", async () => {
    memberships.set("u1:orgA", { role: "EMPLOYEE" });
    session = { user: { id: "u1", organizationId: "orgA", accessLevel: "EMPLOYEE" } };
    const ctx = await nodeCtxFromSession();
    expect(ctx).toMatchObject({ userId: "u1", organizationId: "orgA", orgAdmin: false, denied: false });
  });

  it("acts at home without one, and the home level stays the database's", async () => {
    session = { user: { id: "u1", organizationId: "orgC", accessLevel: "EMPLOYEE" } };
    expect(await nodeCtxFromSession()).toMatchObject({ organizationId: "orgB", orgAdmin: true });
  });

  it("denies a deactivated account and reads nothing when signed out", async () => {
    users.set("u1", { organizationId: "orgB", accessLevel: "COMPANY_ADMIN", status: "INACTIVE", deletedAt: null });
    session = { user: { id: "u1", organizationId: "orgB" } };
    expect((await nodeCtxFromSession())?.denied).toBe(true);
    session = null;
    expect(await nodeCtxFromSession()).toBeNull();
  });
});

// Docs-found fixes batch 6: a workspace writes only the reporting lines it
// owns, and reads a whole workspace's people by its indexes.
describe("linesElsewhere: the other workspaces a line counts in", () => {
  const user = (id: string, organizationId: string, accessLevel = "EMPLOYEE") => users.set(id, { organizationId, accessLevel, status: "ACTIVE", deletedAt: null });
  beforeEach(() => {
    // pia works in orgA (anchored) and orgB (a membership).
    user("pia", "orgA");
    memberships.set("pia:orgB", { role: "EMPLOYEE" });
  });

  it("says a line is relied on where its manager holds a level that is no Agent, anchored there or through a membership", async () => {
    user("gil", "orgB", "MANAGER");
    user("max", "orgA", "MANAGER");
    memberships.set("max:orgB", { role: "MANAGER" });
    const out = await linesElsewhere("orgA", [{ personId: "pia", managerId: "gil" }, { personId: "pia", managerId: "max" }]);
    expect(out.get("pia\ngil")).toBe("relied");
    expect(out.get("pia\nmax")).toBe("relied");
  });

  it("says only shared where the manager is an Agent there, and nothing where they hold no level there", async () => {
    user("ava", "orgA", "MANAGER");
    memberships.set("ava:orgB", { role: "AGENT" });
    user("zed", "orgC", "MANAGER"); // a workspace pia is not in
    const out = await linesElsewhere("orgA", [{ personId: "pia", managerId: "ava" }, { personId: "pia", managerId: "zed" }]);
    expect(out.get("pia\nava")).toBe("shared");
    expect(out.has("pia\nzed")).toBe(false);
  });

  it("answers nothing for someone who works in this workspace only", async () => {
    user("solo", "orgA");
    user("gil", "orgB", "MANAGER");
    expect((await linesElsewhere("orgA", [{ personId: "solo", managerId: "gil" }])).size).toBe(0);
  });

  it("reads from the other side too: a person anchored elsewhere, asked about here", async () => {
    // From orgB, pia's anchored workspace orgA is the other one.
    user("max", "orgA", "MANAGER");
    expect((await linesElsewhere("orgB", [{ personId: "pia", managerId: "max" }])).get("pia\nmax")).toBe("relied");
  });
});

// Docs-found fixes batch 7, from the batch 6 review: a Guest, deactivated
// or removed manager in the other workspace counted as "relied", so the Agent
// move, the dotted-lines PUT and a restore kept a line no workspace treats as
// a manager's, and the dialogs said "that line still counts".
describe("linesElsewhere answers nothing for a manager no workspace treats as one", () => {
  const user = (id: string, organizationId: string, accessLevel = "EMPLOYEE", extra: { status?: string; deletedAt?: Date | null; orgRole?: string } = {}) =>
    users.set(id, { organizationId, accessLevel, status: extra.status ?? "ACTIVE", deletedAt: extra.deletedAt ?? null, ...(extra.orgRole ? { orgRole: extra.orgRole } : {}) });
  beforeEach(() => {
    // pia works in orgA (anchored) and orgB (a membership).
    user("pia", "orgA");
    memberships.set("pia:orgB", { role: "EMPLOYEE" });
  });

  it("a deactivated or removed account, and a Guest there", async () => {
    user("off", "orgB", "MANAGER", { status: "INACTIVE" });
    user("gone", "orgB", "MANAGER", { deletedAt: new Date("2026-09-01") });
    user("guest", "orgB", "EMPLOYEE", { orgRole: "GUEST" });
    const out = await linesElsewhere("orgA", ["off", "gone", "guest"].map((managerId) => ({ personId: "pia", managerId })));
    // Before: "relied" for all three.
    expect(out.size).toBe(0);
  });

  it("a Guest anchored in one workspace who manages through a membership in another is answered by that one", async () => {
    memberships.set("pia:orgC", { role: "EMPLOYEE" });
    user("gil", "orgB", "EMPLOYEE", { orgRole: "GUEST" });
    memberships.set("gil:orgC", { role: "MANAGER" });
    expect((await lineStandingsElsewhere("orgA", [{ personId: "pia", managerId: "gil" }])).get("pia\ngil")).toEqual({ standing: "relied", reliedIn: ["orgC"] });
  });

  it("names the workspaces that rely on a line, and for a leaver being deactivated now, still those", async () => {
    memberships.set("pia:orgC", { role: "EMPLOYEE" });
    user("leo", "orgB", "MANAGER", { status: "INACTIVE" });
    memberships.set("leo:orgC", { role: "AGENT" });
    // SCIM deactivates the leaver before the handover runs: the record of
    // the line the other workspace relied on until now is still written there.
    expect((await lineStandingsElsewhere("orgA", [{ personId: "pia", managerId: "leo" }], undefined, { leaving: true })).get("pia\nleo")).toEqual({ standing: "relied", reliedIn: ["orgB"] });
    expect((await lineStandingsElsewhere("orgA", [{ personId: "pia", managerId: "leo" }])).size).toBe(0);
  });

  // Batch 8, from the batch 7 review: a handover run after a removal wrote the
  // other workspace no record, since a removed leaver was left out even then.
  it("for a leaver removed already, still those, and never without `leaving`", async () => {
    user("leo", "orgB", "MANAGER", { status: "INACTIVE", deletedAt: new Date("2026-10-01") });
    expect((await lineStandingsElsewhere("orgA", [{ personId: "pia", managerId: "leo" }], undefined, { leaving: true })).get("pia\nleo")).toEqual({ standing: "relied", reliedIn: ["orgB"] });
    expect((await linesElsewhere("orgA", [{ personId: "pia", managerId: "leo" }])).size).toBe(0);
  });
});

describe("a whole workspace's people, by its indexes", () => {
  beforeEach(() => { raw.length = 0; });

  it("workspacePeopleLines is one statement, two indexed halves, each person once", async () => {
    await workspacePeopleLines("orgA");
    const [{ sql, values }] = raw;
    expect(sql).toMatch(/FROM "User" u\s+WHERE u."organizationId" = \?\s+AND u."deletedAt" IS NULL\s+UNION ALL/);
    expect(sql).toMatch(/FROM "OrganizationMembership" m\s+JOIN "User" u ON u."id" = m."userId"\s+WHERE m."organizationId" = \?\s+AND u."organizationId" <> \?/);
    expect(sql).not.toContain("INACTIVE");
    expect(values).toEqual(["orgA", "orgA", "orgA"]);
    await workspacePeopleLines("orgA", { activeOnly: true });
    expect(raw[1].sql.split(`u."status" <> 'INACTIVE'`)).toHaveLength(3);
  });

  // D12: a removed membership is no one here; a deactivated one is left out
  // where a deactivated account is. Before, both halves read the account alone.
  it("workspacePeopleLines leaves out a removed membership, and with activeOnly a deactivated one", async () => {
    await workspacePeopleLines("orgA");
    const membershipHalf = (q: string) => q.slice(q.indexOf('FROM "OrganizationMembership" m'));
    expect(membershipHalf(raw[0].sql)).toMatch(/AND u."deletedAt" IS NULL\s+AND m."removedAt" IS NULL$/);
    // The anchored half is unchanged.
    expect(raw[0].sql.slice(0, raw[0].sql.indexOf("UNION ALL"))).not.toContain('m."');
    await workspacePeopleLines("orgA", { activeOnly: true });
    expect(membershipHalf(raw[1].sql)).toMatch(/AND u."status" <> 'INACTIVE'\s+AND \(m."status" <> 'INACTIVE' AND m."removedAt" IS NULL\)$/);
    expect(raw[1].values).toEqual(["orgA", "orgA", "orgA"]);
  });

  it("workspaceDottedLines joins the dotted lines to both halves", async () => {
    await workspaceDottedLines("orgA");
    expect(raw[0].sql.split('JOIN "UserDottedLine" d ON d."userId" = u."id"')).toHaveLength(3);
    expect(raw[0].sql).toContain("UNION ALL");
  });

  it("workspaceDottedLines leaves out the lines of a removed membership, and keeps a deactivated one's (a loop through them is a loop)", async () => {
    await workspaceDottedLines("orgA");
    const membershipHalf = raw[0].sql.slice(raw[0].sql.indexOf('FROM "OrganizationMembership" m'));
    expect(membershipHalf).toMatch(/AND u."deletedAt" IS NULL\s+AND m."removedAt" IS NULL$/);
    expect(membershipHalf).not.toContain(`m."status"`);
    // Each half's join names this workspace (workspace-status-2.md E2).
    expect(raw[0].values).toEqual(["orgA", "orgA", "orgA", "orgA", "orgA"]);
  });

  // workspace-status-2.md E1, E2, step 1: each workspace's lines are its own.
  it("workspacePeopleLines takes a membership person's line from their membership here, an anchored person's from their account", async () => {
    await workspacePeopleLines("orgA");
    await workspacePeopleLines("orgA", { activeOnly: true });
    for (const { sql } of raw) {
      const [anchoredHalf, membershipHalf] = sql.split("UNION ALL");
      expect(anchoredHalf).toMatch(/^\s*SELECT u."id", u."managerId"\s+FROM "User" u/);
      // Before: u."managerId", the account's line, which is the anchored workspace's.
      expect(membershipHalf).toMatch(/^\s*SELECT u."id", m."managerId"\s+FROM "OrganizationMembership" m/);
      expect(membershipHalf).not.toContain('u."managerId"');
    }
  });

  it("workspaceDottedLines reads only this workspace's dotted lines, by each line's workspace", async () => {
    await workspaceDottedLines("orgA");
    // Before: joined by the person alone, so another workspace's lines were walked here.
    expect(raw[0].sql.split('JOIN "UserDottedLine" d ON d."userId" = u."id" AND d."organizationId" = ?')).toHaveLength(3);
  });
});
