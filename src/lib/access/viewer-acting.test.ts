import { beforeEach, describe, expect, it, vi } from "vitest";

// A level never climbs into another workspace: a person who is HR or an Admin
// where they are anchored, and a Member where this session acts, is a Member
// here, in the engine's viewer and in the people rules alike.
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("next-auth/next", () => ({ getServerSession: async () => null }));
vi.mock("../auth", () => ({ authOptions: {} }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("../reporting-line", () => ({ getEffectiveReportTree: async () => [] }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("../admin/company-detail", () => ({ ownerIdsFor: async () => [] }));
let tablesOn = false;
vi.mock("./flags", async (orig) => ({ ...(await orig<object>()), accessV2Tables: () => tablesOn }));

type Row = { organizationId: string; accessLevel: string; orgRole: string | null; adminScopes: string[]; status: string; deletedAt: Date | null };
const users = new Map<string, Row>();
const memberships = new Map<string, { role: string }>();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const r = users.get(where.id);
        return r ? { ...r, departmentId: null, officeId: null, roleId: null } : null;
      },
      findMany: async () => [],
    },
    organizationMembership: {
      findUnique: async ({ where }: { where: { userId_organizationId: { userId: string; organizationId: string } } }) =>
        memberships.get(`${where.userId_organizationId.userId}:${where.userId_organizationId.organizationId}`) ?? null,
    },
    tagAssignment: { findMany: async () => [] },
    organization: { findUnique: async () => null },
  },
}));

import { hydrate, viewerFromSessionObject } from "./viewer";
import { peopleCtxForViewer, relationTo } from "@/lib/people/person-access.server";
import { levelHeldIn } from "./acting-workspace";

const session = (organizationId: string, accessLevel: string) => ({ user: { id: "pat", organizationId, accessLevel } });

beforeEach(() => {
  users.clear();
  memberships.clear();
  tablesOn = false;
});

describe("levelHeldIn", () => {
  it("is the anchored level at home, the membership's role elsewhere, null with neither", async () => {
    users.set("pat", { organizationId: "acme", accessLevel: "COMPANY_ADMIN", orgRole: null, adminScopes: [], status: "ACTIVE", deletedAt: null });
    memberships.set("pat:beta", { role: "EMPLOYEE" });
    expect(await levelHeldIn("pat", "acme")).toBe("COMPANY_ADMIN");
    expect(await levelHeldIn("pat", "beta")).toBe("EMPLOYEE");
    expect(await levelHeldIn("pat", "gamma")).toBeNull();
  });
});

describe("a session acting outside the anchored workspace", () => {
  it("is not on the People team because the anchored level is HR", async () => {
    users.set("pat", { organizationId: "acme", accessLevel: "HR", orgRole: null, adminScopes: [], status: "ACTIVE", deletedAt: null });
    memberships.set("pat:beta", { role: "EMPLOYEE" });
    const viewer = await hydrate(viewerFromSessionObject(session("beta", "EMPLOYEE"))!, {});
    expect(viewer.peopleTeam).toBe(false);
    // At home the same person is.
    const home = await hydrate(viewerFromSessionObject(session("acme", "HR"))!, {});
    expect(home.peopleTeam).toBe(true);
  });

  it("gets no org-wide or manager reach in people data from an Admin level held elsewhere", async () => {
    users.set("pat", { organizationId: "acme", accessLevel: "COMPANY_ADMIN", orgRole: "ADMIN", adminScopes: ["billing"], status: "ACTIVE", deletedAt: null });
    memberships.set("pat:beta", { role: "EMPLOYEE" });
    const viewer = await hydrate(viewerFromSessionObject(session("beta", "EMPLOYEE"))!, {});
    const ctx = await peopleCtxForViewer(viewer);
    expect(ctx).toMatchObject({ accessLevel: "EMPLOYEE", isAdmin: false, orgWide: false, managerTier: false, peopleTeam: false });
    expect(relationTo(ctx, "colleague")).toBe("none");
  });

  it("with ACCESS_V2_TABLES on, takes neither the org role nor the scopes of the anchored row", async () => {
    tablesOn = true;
    users.set("pat", { organizationId: "acme", accessLevel: "COMPANY_ADMIN", orgRole: "ADMIN", adminScopes: ["billing"], status: "ACTIVE", deletedAt: null });
    memberships.set("pat:beta", { role: "EMPLOYEE" });
    const viewer = await hydrate(viewerFromSessionObject(session("beta", "EMPLOYEE"))!, {});
    expect(viewer.orgRole).not.toBe("ADMIN");
    expect(viewer.orgRole).not.toBe("OWNER");
    expect(viewer.adminScopes ?? []).toEqual([]);
  });
});
