import { beforeEach, describe, expect, it, vi } from "vitest";

const users = new Map<string, { id: string; organizationId: string; accessLevel: string }>();
const memberships = new Map<string, { role: string }>();

vi.mock("next-auth/next", () => ({ getServerSession: async () => null }));
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

import { loadSuiteViewer } from "./auth";

const session = (organizationId?: string) => ({ user: { id: "u1", organizationId }, expires: "" }) as never;

beforeEach(() => {
  users.clear();
  memberships.clear();
  users.set("u1", { id: "u1", organizationId: "orgB", accessLevel: "COMPANY_ADMIN" });
});

describe("loadSuiteViewer: the workspace the session acts in", () => {
  it("is the anchored one when the session acts there", async () => {
    expect(await loadSuiteViewer(session("orgB"))).toEqual({ userId: "u1", orgId: "orgB", accessLevel: "COMPANY_ADMIN", sessionOrgId: "orgB" });
  });
  it("is the session's, with that membership's level, when acting elsewhere", async () => {
    memberships.set("u1:orgA", { role: "EMPLOYEE" });
    // An Admin at home is never an Admin of A because of it.
    expect(await loadSuiteViewer(session("orgA"))).toEqual({ userId: "u1", orgId: "orgA", accessLevel: "EMPLOYEE", sessionOrgId: "orgA" });
  });
  it("comes home when there is no membership where the session acts", async () => {
    // No place in the session's workspace: home, and the route can tell (sessionOrgId differs).
    expect(await loadSuiteViewer(session("orgA"))).toEqual({ userId: "u1", orgId: "orgB", accessLevel: "COMPANY_ADMIN", sessionOrgId: "orgA" });
  });
  it("comes home when the session names no workspace", async () => {
    expect(await loadSuiteViewer(session(undefined))).toEqual({ userId: "u1", orgId: "orgB", accessLevel: "COMPANY_ADMIN", sessionOrgId: null });
  });
});
