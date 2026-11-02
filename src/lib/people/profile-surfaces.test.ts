// Every surface that shows a department, job role or office shows it only
// when it belongs to this workspace, and a manager only while they hold a
// seat here (docs/plans/workspace-status.md D18, the step 3 review H2;
// src/lib/access/profile-here.ts): the Directory, the Org chart, the
// Directory's export, Settings' people export (and its KPI average), My team
// and GET /api/v1/people. Run on an in-memory database.
//
// The case: Max works in B (anchored there) but his account still carries
// A's Finance department, A's Controller title and A's manager Amy (old data,
// or a move before D18). Before, every one of these surfaces named them in B.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ ctx: {} as Record<string, unknown> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "u-admin", organizationId: "b" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined, logAuditEvent: async () => undefined }));
vi.mock("@/lib/user-tags", () => ({ getUserTagsMap: async () => new Map(), resolveUserIdsByTags: async () => [] }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => ["max", "bea"] }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/access/settings-write", () => ({ settingsWriteGate: async () => ({ ok: true }) }));
vi.mock("@/lib/api-auth", () => ({ authenticate: async () => ({ ctx: { organizationId: "b", scopes: ["READ"], via: "api_key" }, error: null }) }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-admin", organizationId: "b" } } }),
  getOrgId: () => "b",
  getUserId: () => "u-admin",
  hasPermission: async () => false,
}));
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { directoryList } from "./directory-list.server";
import { GET as exportDirectory } from "@/app/api/users/export/route";
import { GET as exportPeople } from "@/app/api/export/people/route";
import { GET as myTeam } from "@/app/api/my-team/route";
import { GET as v1People } from "@/app/api/v1/people/route";
import { GET as usersList } from "@/app/api/users/route";

const MAX = /Finance|Controller|Amy|A revenue/;

beforeEach(() => {
  db.reset();
  st.ctx = { userId: "u-admin", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN"), orgRole: "ADMIN", isAgent: false, isAdmin: true, peopleTeam: false, orgWide: true, managerTier: true, chain: new Set(), writeChain: new Set(), viewer: {} };
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
  db.seed("department", { id: "dep-a", name: "Finance", color: null, organizationId: "a" });
  db.seed("department", { id: "dep-b", name: "Design", color: null, organizationId: "b" });
  db.seed("role", { id: "role-a", title: "Controller", level: "MANAGER", organizationId: "a" });
  db.seed("office", { id: "off-b", name: "London", city: "London", organizationId: "b" });
  const base = { lastName: "Lee", phone: null, status: "ACTIVE", deletedAt: null, joinDate: new Date("2026-01-01"), createdAt: new Date("2026-01-01"), presenceStatus: null };
  db.seed("user", { id: "u-admin", email: "admin@x.test", firstName: "Ada", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN"), managerId: null, departmentId: null, roleId: null, officeId: null, ...base });
  db.seed("user", { id: "amy", email: "amy@x.test", firstName: "Amy", organizationId: "a", ...legacyLevelRow("MANAGER"), managerId: null, departmentId: "dep-a", roleId: null, officeId: null, ...base });
  db.seed("user", { id: "max", email: "max@x.test", firstName: "Max", organizationId: "b", ...legacyLevelRow("EMPLOYEE"), managerId: "amy", departmentId: "dep-a", roleId: "role-a", officeId: "off-b", ...base });
  db.seed("user", { id: "bea", email: "bea@x.test", firstName: "Bea", organizationId: "b", ...legacyLevelRow("EMPLOYEE"), managerId: "u-admin", departmentId: "dep-b", roleId: null, officeId: null, ...base });
  db.seed("kPI", { id: "k-a", name: "A revenue", organizationId: "a" });
  db.seed("kPI", { id: "k-b", name: "B tickets", organizationId: "b" });
  db.seed("kPIRecord", { id: "r-a", kpiId: "k-a", userId: "max", score: 10, createdAt: new Date("2026-10-02") });
  db.seed("kPIRecord", { id: "r-b", kpiId: "k-b", userId: "max", score: 90, createdAt: new Date("2026-10-01") });
});

describe("the profile is this workspace's on every surface (D18)", () => {
  it("the Directory names no other workspace's department, job role or manager, and keeps this workspace's own", async () => {
    const res = await directoryList(new NextRequest("https://app.test/api/users?scope=directory"));
    const rows = (await res.json()).data as Array<Record<string, unknown>>;
    const max = rows.find((r) => r.id === "max")!;
    // Before: Finance, Controller and Amy, from A.
    expect(max).toMatchObject({ department: null, role: null, manager: null, managerId: null, office: { id: "off-b", name: "London", city: "London" } });
    expect(rows.find((r) => r.id === "bea")).toMatchObject({ department: { id: "dep-b", name: "Design" }, managerId: "u-admin", manager: { id: "u-admin" } });
    expect(JSON.stringify(max)).not.toMatch(MAX);
  });

  it("the Directory's search by job title finds this workspace's titles only", async () => {
    const res = await directoryList(new NextRequest("https://app.test/api/users?scope=directory&q=Controller"));
    // Before: Max, by A's title.
    expect((await res.json()).data).toEqual([]);
  });

  it("the Org chart places nobody under another workspace's manager, and shows this workspace's titles only", async () => {
    const res = await directoryList(new NextRequest("https://app.test/api/users?fields=chart"));
    const max = ((await res.json()).data as Array<Record<string, unknown>>).find((r) => r.id === "max")!;
    expect(max).toMatchObject({ managerId: null, roleId: null, departmentId: null, officeId: "off-b", jobTitle: null, department: null });
  });

  it("the Directory's export writes this workspace's own only", async () => {
    const csv = await (await exportDirectory(new NextRequest("https://app.test/api/users/export"))).text();
    const line = csv.split("\n").find((l) => l.includes("max@x.test"))!;
    expect(line).not.toMatch(MAX);
    expect(line).toContain("London");
  });

  it("Settings' people export writes this workspace's own, and averages this workspace's KPIs only", async () => {
    const csv = await (await exportPeople()).text();
    const line = csv.split("\n").find((l) => l.includes("max@x.test"))!;
    expect(line).not.toMatch(MAX);
    // Before: the average of A's 10 and B's 90, 50.
    expect(line.endsWith(`"90"`)).toBe(true);
  });

  it("My team and the API answer this workspace's own only", async () => {
    const team = await (await myTeam()).json();
    expect(team.members.find((m: { id: string }) => m.id === "max")).toMatchObject({ department: null, role: null });
    const api = await (await v1People(new NextRequest("https://app.test/api/v1/people"))).json();
    const max = api.data.find((m: { id: string }) => m.id === "max");
    expect(max).toMatchObject({ department: null, role: null, manager: null });
    expect(JSON.stringify(max)).not.toMatch(MAX);
  });

  it("the people list behind the pickers answers this workspace's own only", async () => {
    const body = await (await usersList(new NextRequest("https://app.test/api/users"))).json();
    const max = (body.data as Array<Record<string, unknown>>).find((u) => u.id === "max")!;
    // Before: { name: "Finance" }, { title: "Controller" } and Amy as manager.
    expect(max).toMatchObject({ department: null, role: null, managerId: null, manager: null });
    expect((body.data as Array<Record<string, unknown>>).find((u) => u.id === "bea")).toMatchObject({ department: { id: "dep-b", name: "Design" }, managerId: "u-admin" });
  });
});

// The workspace export streams a zip over a dozen tables; its people.csv
// reads the same rule (D18), checked here in its source.
describe("the workspace export's people.csv", () => {
  it("selects each department and job role with its workspace, and writes it only when it is this workspace's", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/src/lib/export/workspace-export.server.ts`, "utf8");
    expect(src).toContain("department: { select: { name: true, organizationId: true } }, role: { select: { title: true, organizationId: true } },");
    expect(src).toContain('department: ownHere(u.department, orgId)?.name ?? "", role: ownHere(u.role, orgId)?.title ?? ""');
  });
});

