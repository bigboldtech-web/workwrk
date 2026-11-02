import { beforeEach, describe, expect, it, vi } from "vitest";

// A session acting in a workspace where the person is not anchored reads its
// status and removal from the seat there (docs/plans/workspace-status.md D1,
// D3, D7). Found by the step 5 live proof: after B deactivated Pat while she
// was anchored there (D3, the account moved home to A) her session, still
// acting in B until its next check, kept reading B's Directory, though D3 and
// the step 4 review (L8) say every viewer-based read denies at once. The
// viewer took `status` and `deleted` from the account row, which is the
// anchored workspace's, and the people context never asked rule 1.
vi.mock("server-only", () => ({}));
let session: { user: { id: string; organizationId: string; accessLevel: string } } | null = null;
vi.mock("next-auth", () => ({ getServerSession: async () => session }));
vi.mock("next-auth/next", () => ({ getServerSession: async () => session }));
vi.mock("../auth", () => ({ authOptions: {} }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("../reporting-line", () => ({ getEffectiveReportTree: async () => [] }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("../admin/company-detail", () => ({ ownerIdsFor: async () => [] }));

type Row = { organizationId: string; accessLevel: string; orgRole: string | null; adminScopes: string[]; status: string; deletedAt: Date | null };
type Seat = { role: string; status: string; removedAt: Date | null; adminScopes: string[] };
const users = new Map<string, Row>();
const memberships = new Map<string, Seat>();
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

import { viewerFromSession } from "./viewer";
import { peopleCtx } from "@/lib/people/person-access.server";

const live = { organizationId: "acme", accessLevel: "EMPLOYEE", orgRole: null, adminScopes: [], status: "ACTIVE", deletedAt: null };
const acting = (organizationId: string) => {
  session = { user: { id: "pat", organizationId, accessLevel: "EMPLOYEE" } };
};

beforeEach(() => {
  users.clear();
  memberships.clear();
  session = null;
});

describe("the viewer's status in the workspace its session acts in", () => {
  it("is the membership's there: a seat deactivated there is INACTIVE, though the account is live at home", async () => {
    users.set("pat", { ...live });
    memberships.set("pat:beta", { role: "EMPLOYEE", status: "INACTIVE", removedAt: null, adminScopes: [] });
    acting("beta");
    const v = await viewerFromSession();
    expect(v).toMatchObject({ organizationId: "beta", status: "INACTIVE", deleted: false });
    expect(await peopleCtx()).toBeNull();
  });

  it("a seat removed there, or none at all, is removed (rule 1 denies), and the people context is none", async () => {
    users.set("pat", { ...live });
    memberships.set("pat:beta", { role: "EMPLOYEE", status: "INACTIVE", removedAt: new Date(), adminScopes: [] });
    acting("beta");
    expect(await viewerFromSession()).toMatchObject({ deleted: true });
    expect(await peopleCtx()).toBeNull();
    acting("gamma");
    expect(await viewerFromSession()).toMatchObject({ deleted: true });
    expect(await peopleCtx()).toBeNull();
  });

  it("a live seat there reads as live, an HR label kept; the people context is there", async () => {
    users.set("pat", { ...live });
    memberships.set("pat:beta", { role: "EMPLOYEE", status: "ON_LEAVE", removedAt: null, adminScopes: [] });
    acting("beta");
    expect(await viewerFromSession()).toMatchObject({ status: "ON_LEAVE", deleted: false });
    expect(await peopleCtx()).toMatchObject({ organizationId: "beta", accessLevel: "EMPLOYEE" });
  });

  it("the seat there decides even when the account is ended at home (D1; the session check then moves it, D7)", async () => {
    users.set("pat", { ...live, status: "INACTIVE", deletedAt: new Date() });
    memberships.set("pat:beta", { role: "MANAGER", status: "ACTIVE", removedAt: null, adminScopes: [] });
    acting("beta");
    expect(await viewerFromSession()).toMatchObject({ status: "ACTIVE", deleted: false });
    expect(await peopleCtx()).toMatchObject({ organizationId: "beta", accessLevel: "MANAGER" });
  });

  it("where they are anchored, the account row decides, its own stale membership row never read", async () => {
    users.set("pat", { ...live });
    memberships.set("pat:acme", { role: "EMPLOYEE", status: "INACTIVE", removedAt: new Date(), adminScopes: [] });
    acting("acme");
    expect(await viewerFromSession()).toMatchObject({ status: "ACTIVE", deleted: false });
    expect(await peopleCtx()).toMatchObject({ organizationId: "acme" });
  });

  it("someone deactivated or removed where they are anchored gets no people context either (rule 1, at once)", async () => {
    users.set("pat", { ...live, status: "INACTIVE" });
    acting("acme");
    expect(await peopleCtx()).toBeNull();
    users.set("pat", { ...live, deletedAt: new Date() });
    acting("acme"); // a new request (the viewer is memoised per session object)
    expect(await peopleCtx()).toBeNull();
  });
});
