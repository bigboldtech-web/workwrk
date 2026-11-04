// A job title's People tab counts what each holder holds of the title's KRAs
// here, the holders here through a membership included (docs/plans/
// workspace-status-2.md, the fixes review, finding 8). None is assigned a
// KRA here (the step 5 review M1), but a contractor whose account was in
// this workspace when it set her title holds its KRAs. Before, every such
// row was sent with no count, and read "KRAs not assigned here" even for
// someone holding them all.
//
// The case, in client B: Lee is anchored here and holds both of the
// Designer title's KRAs. Pat, Ivy and Zoe work here from their agency's
// account and hold the title through their memberships: Pat holds both
// (from when her account was here), Ivy one, Zoe none.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const st = vi.hoisted(() => ({
  assignments: [] as Array<{ userId: string; kraId: string }>,
  grouped: [] as Array<{ userIds: string[]; kraIds: string[] }>,
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));
// Hana, B's Admin: the page's editor check reads the session's level.
vi.mock("next-auth", async () => {
  const { legacyLevelRow } = await import("@/lib/access/test-fixtures");
  return { getServerSession: async () => ({ user: { id: "hana", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN") } }) };
});
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/gate", () => ({ gatePage: async () => ({ viewer: { organizationId: "b" } }) }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/people/job-title-access", () => ({ jobTitleWriterByFacts: () => true }));
// The client workspace is role-people.test.ts's: here, only what the page hands it.
vi.mock("./role-workspace", () => ({ RoleWorkspace: () => null }));
vi.mock("@/lib/access/profile-here", () => ({
  peoplePlacedHere: async () => ["pat", "ivy", "zoe"].map((id) => ({ id, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", email: `${id}@x.test`, avatar: null })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    role: {
      findFirst: async () => ({
        id: "r1", title: "Designer", description: null, level: "MID", department: null,
        kraTemplates: ["k1", "k2"].map((id) => ({ id, name: id, description: null, category: null, weight: 50, kpis: [], sops: [] })),
        ownedAreas: [], boundaries: [], thresholds: [], instances: [],
        users: [{ id: "lee", firstName: "Lee", lastName: "Ng", email: "lee@x.test", avatar: null }],
      }),
      findMany: async () => [],
    },
    ownershipArea: { findMany: async () => [] },
    kRA: { findMany: async () => [] },
    scope: { findMany: async () => [] },
    user: { findMany: async () => [] },
    kRAAssignment: {
      groupBy: async ({ where }: { where: { userId: { in: string[] }; kraId: { in: string[] } } }) => {
        st.grouped.push({ userIds: where.userId.in, kraIds: where.kraId.in });
        const counts = new Map<string, number>();
        for (const a of st.assignments) if (where.userId.in.includes(a.userId) && where.kraId.in.includes(a.kraId)) counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1);
        return [...counts].map(([userId, n]) => ({ userId, _count: { _all: n } }));
      },
    },
  },
}));

import RolePage from "./page";

type Holder = { id: string; missingKras: number | null; elsewhere?: boolean };
const people = async () => {
  const page = (await RolePage({ params: Promise.resolve({ id: "r1" }), searchParams: Promise.resolve({ tab: "people" }) })) as ReactElement<{ children: ReactElement<{ bundle: { people: Holder[] } }> }>;
  return page.props.children.props.bundle.people;
};

beforeEach(() => {
  st.grouped = [];
  st.assignments = [
    { userId: "lee", kraId: "k1" }, { userId: "lee", kraId: "k2" },
    { userId: "pat", kraId: "k1" }, { userId: "pat", kraId: "k2" },
    { userId: "ivy", kraId: "k1" },
    // A KRA of no template of this title counts for nobody.
    { userId: "zoe", kraId: "k9" },
  ];
});

describe("a job title's People tab counts each holder's KRAs here (the fixes review, finding 8)", () => {
  it("sends what Pat, Ivy and Zoe hold of the title's KRAs, beside Lee's, and marks them as here from another workspace", async () => {
    const byId = new Map((await people()).map((p) => [p.id, p]));
    expect(byId.get("lee")).toMatchObject({ missingKras: 0 });
    expect(byId.get("lee")?.elsewhere).toBeUndefined();
    // Before: missingKras null for all three, so every row read "KRAs not assigned here".
    expect(byId.get("pat")).toMatchObject({ missingKras: 0, elsewhere: true });
    expect(byId.get("ivy")).toMatchObject({ missingKras: 1, elsewhere: true });
    expect(byId.get("zoe")).toMatchObject({ missingKras: 2, elsewhere: true });
    // One grouped count, of the title's own KRAs, for every holder.
    expect(st.grouped).toEqual([{ userIds: ["lee", "pat", "ivy", "zoe"], kraIds: ["k1", "k2"] }]);
  });
});
