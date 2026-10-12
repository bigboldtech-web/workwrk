import { beforeEach, describe, expect, it, vi } from "vitest";

// The workspace a session acts in, for nodeCtxFromSession and the suite routes
// alike: the session's own workspace at its membership's role, else the anchor.
const users = new Map<string, { organizationId: string; accessLevel: string; status: string; deletedAt: Date | null }>();
const memberships = new Map<string, { role: string }>();
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
          .map(([key, m]) => ({ userId: key.split(":")[0], organizationId: key.split(":")[1], role: m.role }))
          .filter((m) => where.userId.in.includes(m.userId) && orgOk(where.organizationId, m.organizationId)),
    },
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => { raw.push({ sql: sql.join("?"), values }); return []; },
  },
}));

import { actingWorkspace, linesElsewhere, workspaceDottedLines, workspacePeopleLines } from "./acting-workspace";
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

  it("workspaceDottedLines joins the dotted lines to both halves", async () => {
    await workspaceDottedLines("orgA");
    expect(raw[0].sql.split('JOIN "UserDottedLine" d ON d."userId" = u."id"')).toHaveLength(3);
    expect(raw[0].sql).toContain("UNION ALL");
  });
});
