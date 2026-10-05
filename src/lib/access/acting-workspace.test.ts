import { beforeEach, describe, expect, it, vi } from "vitest";

// The workspace a session acts in, for nodeCtxFromSession and the suite routes
// alike: the session's own workspace at its membership's role, else the anchor.
const users = new Map<string, { organizationId: string; accessLevel: string; status: string; deletedAt: Date | null }>();
const memberships = new Map<string, { role: string }>();
let session: { user: { id: string; organizationId?: string; accessLevel?: string } } | null = null;

vi.mock("next-auth/next", () => ({ getServerSession: async () => session }));
vi.mock("next-auth", () => ({ getServerSession: async () => session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null },
    organizationMembership: {
      findUnique: async ({ where }: { where: { userId_organizationId: { userId: string; organizationId: string } } }) =>
        memberships.get(`${where.userId_organizationId.userId}:${where.userId_organizationId.organizationId}`) ?? null,
    },
  },
}));

import { actingWorkspace } from "./acting-workspace";
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
