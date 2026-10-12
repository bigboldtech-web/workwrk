// The engine's viewer and the Agent tier across workspaces (docs-found fixes
// batch 4). An Agent is nobody's manager, and the tier that counts is the one
// held in the workspace the session acts in, never the anchored row's level
// in another one. Batch 3 read the anchored row: a Manager here who became an
// Agent where they are anchored lost their whole team here, and an Agent here
// who is a Manager where they are anchored kept their stored tree here, and
// with it chain-view and Can edit on their people's records (facts.ts
// managesSubject).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("next-auth/next", () => ({ getServerSession: async () => null }));
vi.mock("../auth", () => ({ authOptions: {} }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("../admin/company-detail", () => ({ ownerIdsFor: async () => [] }));
vi.mock("./flags", async (orig) => ({ ...(await orig<object>()), accessV2Tables: () => false }));

// The stored lines, as the walkers read them: dana's and ava's reports are
// in acme, whatever workspace their own rows are anchored in.
const tree = vi.hoisted(() => new Map<string, string[]>());
const scopes = vi.hoisted(() => [] as unknown[]);
vi.mock("../reporting-line", () => ({
  getEffectiveReportTree: async (id: string, scope: unknown) => { scopes.push(scope); return [id, ...(tree.get(id) ?? [])]; },
}));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async (_org: string, id: string) => [id, ...(tree.get(id) ?? [])] }));

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

const row = (organizationId: string, accessLevel: string): Row => ({ organizationId, accessLevel, orgRole: null, adminScopes: [], status: "ACTIVE", deletedAt: null });
const actingIn = (id: string, organizationId: string, accessLevel: string) => viewerFromSessionObject({ user: { id, organizationId, accessLevel } })!;

beforeEach(() => {
  users.clear();
  memberships.clear();
  tree.clear();
  scopes.length = 0;
  tree.set("dana", ["kai", "lin"]);
  tree.set("ava", ["noa"]);
});

describe("the viewer's report tree", () => {
  it("keeps a Manager's team here when they are an Agent where they are anchored", async () => {
    // dana accepted an invitation to "client" as an Agent; her phone still acts in acme.
    users.set("dana", row("client", "AGENT"));
    memberships.set("dana:acme", { role: "MANAGER" });
    const v = await hydrate(actingIn("dana", "acme", "MANAGER"), {});
    expect([...(v.reportTree ?? [])].sort()).toEqual(["kai", "lin"]);
    const ctx = await peopleCtxForViewer(v);
    expect(relationTo(ctx, "kai")).not.toBe("none");
    // The walk names the workspace it reads.
    expect(scopes[0]).toMatchObject({ organizationId: "acme" });
  });

  it("is empty for an Agent here who is a Manager where they are anchored", async () => {
    users.set("ava", row("client", "MANAGER"));
    memberships.set("ava:acme", { role: "AGENT" });
    const v = await hydrate(actingIn("ava", "acme", "AGENT"), {});
    expect(v.isAgent).toBe(true);
    expect([...(v.reportTree ?? [])]).toEqual([]);
    const ctx = await peopleCtxForViewer(v);
    expect(relationTo(ctx, "noa")).toBe("none");
  });

  it("is empty when the level held here is the Agent tier, whatever an older token says", async () => {
    // A token minted before the change to Agent still says MANAGER.
    users.set("ava", row("acme", "AGENT"));
    const v = await hydrate(actingIn("ava", "acme", "MANAGER"), {});
    expect([...(v.reportTree ?? [])]).toEqual([]);
  });

  it("is the stored tree for a manager at home, as before", async () => {
    users.set("dana", row("acme", "MANAGER"));
    const v = await hydrate(actingIn("dana", "acme", "MANAGER"), {});
    expect([...(v.reportTree ?? [])].sort()).toEqual(["kai", "lin"]);
  });
});
