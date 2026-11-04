// What this workspace holds of someone who works here through a membership
// (docs/plans/workspace-status.md D18; the final review, product H1 and
// security L1, L2, L3): Members, the Directory (rows, filters, groups), the
// Org chart, the Directory's export and My team show the job title,
// department, office and weekly hours their membership here holds (edited
// there since workspace-status-2.md step 5), and never the account's (which are the workspace it is anchored
// to, today), nor their phone; the placement filters match them by the
// membership's own ids; My team sends their level here and a manager only
// with a seat here. Run on an in-memory database.
//
// The case: Pat works for client B through a membership and is anchored at
// her agency A, whose department "Platform", title "Senior Engineer" and
// Admin level her account holds. B set her department "Delivery", title
// "Contractor", office "Leeds" and 20 weekly hours on her membership.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOfRow, legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ ctx: {} as Record<string, unknown> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "u-admin", organizationId: "b" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined, logAuditEvent: async () => undefined }));
vi.mock("@/lib/user-tags", () => ({ getUserTagsMap: async () => new Map(), resolveUserIdsByTags: async () => [] }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => ["u-admin", "pat"] }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-admin", organizationId: "b" } } }),
  getOrgId: () => "b",
  getUserId: () => "u-admin",
  hasPermission: async () => false,
}));
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { listMembers } from "@/lib/access/members-list.server";
import { directoryList } from "./directory-list.server";
import { GET as exportDirectory } from "@/app/api/users/export/route";
import { GET as myTeam } from "@/app/api/my-team/route";

const A = /Platform|Senior Engineer|\+44 1/;
const members = (query: Parameters<typeof listMembers>[2] = {}) => listMembers("b", { orgWide: true, ids: [] }, query);
const directory = async (qs = "") => (await (await directoryList(new NextRequest(`https://app.test/api/users?scope=directory${qs}`))).json()) as { data: Array<Record<string, unknown>>; groups?: Array<{ key: string; count: number }> };

beforeEach(() => {
  db.reset();
  st.ctx = { userId: "u-admin", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN"), orgRole: "ADMIN", isAgent: false, isAdmin: true, peopleTeam: false, orgWide: true, managerTier: true, chain: new Set(), writeChain: new Set(), viewer: {} };
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
  db.seed("department", { id: "dep-a", name: "Platform", color: null, organizationId: "a" });
  db.seed("role", { id: "role-a", title: "Senior Engineer", description: null, level: "MANAGER", organizationId: "a" });
  db.seed("department", { id: "dep-b", name: "Delivery", color: null, organizationId: "b" });
  db.seed("role", { id: "role-b", title: "Contractor", description: null, level: "TEAM_LEAD", organizationId: "b" });
  db.seed("office", { id: "off-b", name: "Leeds", city: "Leeds", country: "UK", isHeadquarters: false, organizationId: "b" });
  const base = { lastName: "Lee", status: "ACTIVE", deletedAt: null, joinDate: new Date("2015-04-01"), createdAt: new Date("2019-01-01"), presenceStatus: null, mfaEnabled: false, adminScopes: [], avatar: null, officeId: null, weeklyCapacityHours: null };
  db.seed("user", { id: "u-admin", email: "admin@x.test", firstName: "Ada", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN"), managerId: null, departmentId: null, roleId: null, phone: null, ...base });
  db.seed("user", { id: "amy", email: "amy@x.test", firstName: "Amy", organizationId: "a", ...legacyLevelRow("MANAGER"), managerId: null, departmentId: "dep-a", roleId: null, phone: null, ...base });
  db.seed("user", { id: "pat", email: "pat@x.test", firstName: "Pat", organizationId: "a", ...legacyLevelRow("COMPANY_ADMIN"), managerId: "amy", departmentId: "dep-a", roleId: "role-a", phone: "+44 1", ...base, weeklyCapacityHours: 37 });
  db.seed("organizationMembership", { id: "m-pat-b", userId: "pat", organizationId: "b", role: "EMPLOYEE", createdAt: new Date("2026-06-01"), departmentId: "dep-b", roleId: "role-b", officeId: "off-b", weeklyCapacityHours: 20, joinDate: new Date("2026-06-15") });
});

describe("Members shows what the membership holds here (product H1, security L1)", () => {
  it("the row has B's title, department, office and hours, read-only, never A's", async () => {
    const pat = (await members()).rows.find((r) => r.id === "pat")!;
    // Before: no title, department or office, and capacity null.
    expect(pat).toMatchObject({ profileHere: false, jobTitle: { id: "role-b", title: "Contractor" }, department: { id: "dep-b", name: "Delivery" }, office: { id: "off-b", name: "Leeds" }, weeklyCapacityHours: 20, lastSignInAt: null, manager: null });
    expect(JSON.stringify(pat)).not.toMatch(A);
  });

  it("the department, office and title filters match the membership's own ids, never the account's", async () => {
    // Before: dep-a (A's) listed Pat in B, telling B which of its contractors sit in A's Platform.
    expect((await members({ departmentId: "dep-a" })).rows.map((r) => r.id)).toEqual([]);
    expect((await members({ roleId: "role-a" })).rows.map((r) => r.id)).toEqual([]);
    expect((await members({ departmentId: "dep-b" })).rows.map((r) => r.id)).toEqual(["pat"]);
    expect((await members({ roleId: "role-b" })).rows.map((r) => r.id)).toEqual(["pat"]);
    expect((await members({ officeId: "off-b" })).rows.map((r) => r.id)).toEqual(["pat"]);
  });

  it("sorts by department and title by what the membership holds", async () => {
    expect((await members({ sort: "department" })).rows.map((r) => r.id)).toEqual(["pat", "u-admin"]);
    expect((await members({ sort: "title" })).rows.map((r) => r.id)).toEqual(["pat", "u-admin"]);
  });
});

describe("the Directory, the chart and the export show what the membership holds here (product H1, security L2)", () => {
  it("the row has B's department, title and office, and no phone, for an Admin too", async () => {
    const pat = (await directory()).data.find((r) => r.id === "pat")!;
    // Before: department, role and office null, and the account's phone.
    // Editable here by an Admin since workspace-status-2.md step 5 (E8): on her B membership.
    expect(pat).toMatchObject({ profileHere: false, department: { id: "dep-b", name: "Delivery" }, role: { id: "role-b", title: "Contractor", seniority: "TEAM_LEAD" }, office: { id: "off-b", name: "Leeds", city: "Leeds" }, joinDate: "2026-06-15T00:00:00.000Z", canEdit: true });
    expect(pat).not.toHaveProperty("phone");
    expect(JSON.stringify(pat)).not.toMatch(A);
  });

  it("the department, title, office and seniority filters, and the groups, count them by the membership's ids", async () => {
    // Before: any of these filters matched no membership person at all.
    for (const qs of ["&dept=dep-b", "&title=role-b", "&office=off-b", "&seniority=TEAM_LEAD"]) {
      expect((await directory(qs)).data.map((r) => r.id), qs).toEqual(["pat"]);
    }
    expect((await directory("&dept=dep-a")).data.map((r) => r.id)).toEqual([]);
    const grouped = await directory("&group=department");
    expect(grouped.groups).toEqual(expect.arrayContaining([{ key: "dep-b", count: 1 }, { key: "none", count: 1 }]));
  });

  it("the chart places them in B's department and title", async () => {
    const res = await directoryList(new NextRequest("https://app.test/api/users?fields=chart"));
    const pat = ((await res.json()).data as Array<Record<string, unknown>>).find((r) => r.id === "pat")!;
    expect(pat).toMatchObject({ departmentId: "dep-b", roleId: "role-b", officeId: "off-b", jobTitle: "Contractor", department: "Delivery", managerId: null });
  });

  it("the export writes B's title, seniority, department and office, and no phone", async () => {
    const csv = await (await exportDirectory(new NextRequest("https://app.test/api/users/export"))).text();
    const line = csv.split("\n").find((l) => l.includes("pat@x.test"))!;
    expect(line).toContain("Contractor");
    expect(line).toContain("Delivery");
    expect(line).toContain("Leeds");
    expect(line).not.toMatch(A);
  });
});

describe("My team sends what this workspace holds (security L3)", () => {
  it("a membership member's level here, B's placement, and no manager of another workspace", async () => {
    const team = await (await myTeam()).json();
    const pat = (team.members as Array<Record<string, unknown>>).find((m) => m.id === "pat")!;
    // Before: COMPANY_ADMIN (her level in A), A's department and title, and Amy's id.
    expect(legacyLevelOfRow(pat)).toBe("EMPLOYEE");
    expect(pat).toMatchObject({ managerId: null, department: { id: "dep-b", name: "Delivery" }, role: { id: "role-b", title: "Contractor" } });
    expect(JSON.stringify(pat)).not.toMatch(/Platform|Senior Engineer|amy/);
  });
});
