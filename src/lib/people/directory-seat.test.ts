// The People directory lists everyone who works here (docs/plans/workspace-status.md
// D11, step 4; src/lib/people/directory-list.server.ts): the people anchored
// here and the people here through a membership, each in THIS workspace's
// state (the membership's own status and removal), so the Removed view lists
// a membership this workspace removed, for Restore. Their profile here is
// empty (D18): no department, job title or office, their join date the
// membership's, their placement not editable here. The Org chart and the
// export list the same people. Before, all three listed people anchored
// here only, so a removed contractor had no screen to come back from.
// Run on the in-memory database.

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
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/api-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/api-helpers")>()), hasPermission: async () => false }));
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { directoryList } from "./directory-list.server";
import { GET as exportDirectory } from "@/app/api/users/export/route";

type Row = Record<string, unknown> & { id: string };
const dir = async (query = "") => (await (await directoryList(new NextRequest(`https://app.test/api/users?scope=directory${query}`))).json()) as { data: Row[]; pagination: { total: number }; groups?: Array<{ key: string; count: number }> };
const ids = (rows: Row[]) => rows.map((r) => r.id);

beforeEach(() => {
  db.reset();
  st.ctx = { userId: "u-admin", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN"), orgRole: "ADMIN", isAgent: false, isAdmin: true, peopleTeam: false, orgWide: true, managerTier: true, chain: new Set(), writeChain: new Set(), viewer: {} };
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
  db.seed("department", { id: "dep-a", name: "Finance", color: null, organizationId: "a" });
  db.seed("department", { id: "dep-b", name: "Design", color: null, organizationId: "b" });
  const base = { lastName: "Lee", phone: null, status: "ACTIVE", deletedAt: null, managerId: null, roleId: null, officeId: null, presenceStatus: null };
  db.seed("user", { id: "u-admin", email: "ada@x.test", firstName: "Ada", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN"), departmentId: null, joinDate: new Date("2026-01-01"), ...base });
  db.seed("user", { id: "bea", email: "bea@x.test", firstName: "Bea", organizationId: "b", ...legacyLevelRow("EMPLOYEE"), departmentId: "dep-b", joinDate: new Date("2026-03-01"), ...base });
  // Cy is anchored in A (with A's Finance and A's join date) and works in B through a membership made in June.
  db.seed("user", { id: "cy", email: "cy@x.test", firstName: "Cy", organizationId: "a", ...legacyLevelRow("MANAGER"), departmentId: "dep-a", joinDate: new Date("2019-01-01"), ...base });
  db.seed("organizationMembership", { id: "m-cy", userId: "cy", organizationId: "b", role: "AGENT", createdAt: new Date("2026-06-01") });
});

describe("the Directory lists everyone who works here (D11)", () => {
  it("lists a member here with this workspace's state and none of their profile, their placement not editable here", async () => {
    const body = await dir();
    // Before: Ada and Bea only.
    expect(ids(body.data)).toEqual(["u-admin", "bea", "cy"]);
    expect(body.pagination.total).toBe(3);
    const cy = body.data.find((r) => r.id === "cy")!;
    expect(cy).toMatchObject({ department: null, role: null, office: null, isAgent: true, isDeactivated: false, deletedAt: null, canEdit: false, profileHere: false });
    expect(new Date(cy.joinDate as string).toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(JSON.stringify(cy)).not.toMatch(/Finance|2019/);
    expect(body.data.find((r) => r.id === "bea")).toMatchObject({ canEdit: true, profileHere: true });
  });

  it("lists a member this workspace deactivated under the Deactivated filter only, whatever their account's state in A", async () => {
    db.row("organizationMembership", "m-cy").status = "INACTIVE";
    expect(ids((await dir()).data)).not.toContain("cy");
    expect((await dir("&deactivated=1")).data.find((r) => r.id === "cy")).toMatchObject({ isDeactivated: true });
    // Deactivated in A, live here: listed here as live.
    db.row("organizationMembership", "m-cy").status = "ACTIVE";
    db.row("user", "cy").status = "INACTIVE";
    expect((await dir()).data.find((r) => r.id === "cy")).toMatchObject({ isDeactivated: false });
  });

  it("lists a member this workspace removed in the Removed view, with when, for Restore", async () => {
    Object.assign(db.row("organizationMembership", "m-cy"), { status: "INACTIVE", removedAt: new Date("2026-10-01") });
    expect(ids((await dir()).data)).not.toContain("cy");
    const removed = await dir("&view=removed");
    // Before: empty, so no screen offered Restore for them.
    expect(ids(removed.data)).toEqual(["cy"]);
    expect(new Date(removed.data[0].deletedAt as string).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("matches a member here on no department, job title or office filter (none of theirs here), and on search as anyone", async () => {
    expect(ids((await dir("&dept=dep-a")).data)).toEqual([]);
    expect(ids((await dir("&dept=dep-b")).data)).toEqual(["bea"]);
    expect(ids((await dir("&q=cy")).data)).toEqual(["cy"]);
  });

  it("orders by the join date here and groups by this workspace's departments, a member here in none", async () => {
    // Before: Cy would sort by 2019, A's date.
    expect(ids((await dir("&sort=recent")).data)).toEqual(["cy", "bea", "u-admin"]);
    expect(ids((await dir("&sort=tenure&size=2")).data)).toEqual(["u-admin", "bea"]);
    const grouped = await dir("&group=department");
    expect(ids(grouped.data)).toEqual(["bea", "u-admin", "cy"]);
    expect(grouped.groups?.sort((x, y) => x.key.localeCompare(y.key))).toEqual([{ key: "dep-b", count: 1 }, { key: "none", count: 2 }]);
  });
});

describe("the Org chart and the export list the same people (D11)", () => {
  it("the chart places a member here with their seat's tier and status and no profile, never a removed one", async () => {
    const chart = async () => ((await (await directoryList(new NextRequest("https://app.test/api/users?fields=chart"))).json()) as { data: Row[]; total: number });
    const cy = (await chart()).data.find((r) => r.id === "cy");
    // Before: absent.
    expect(cy).toMatchObject({ isAgent: true, isDeactivated: false, departmentId: null, department: null, jobTitle: null });
    db.row("organizationMembership", "m-cy").status = "INACTIVE";
    expect((await chart()).data.find((r) => r.id === "cy")).toMatchObject({ isDeactivated: true });
    db.row("organizationMembership", "m-cy").removedAt = new Date("2026-10-01");
    expect(ids((await chart()).data)).not.toContain("cy");
    expect((await chart()).total).toBe(2);
  });

  it("the export writes a member here with this workspace's status and join date, and none of their profile", async () => {
    const csv = async (query = "") => (await (await exportDirectory(new NextRequest(`https://app.test/api/users/export?x=1${query}`))).text());
    const line = (await csv()).split("\n").find((l) => l.includes("cy@x.test"))!;
    expect(line).toContain("2026-06-01");
    expect(line).not.toMatch(/Finance|2019/);
    expect(line).toMatch(/,"?Active"?$/);
    // In the page's order: a member here by their join date here.
    const emails = (text: string) => text.split("\n").slice(1).map((l) => (l.match(/[a-z-]+@x\.test/) ?? [""])[0]);
    expect(emails(await csv("&sort=recent"))).toEqual(["cy@x.test", "bea@x.test", "ada@x.test"]);
    Object.assign(db.row("organizationMembership", "m-cy"), { status: "INACTIVE", removedAt: new Date("2026-10-01") });
    expect((await csv("&view=removed")).split("\n").find((l) => l.includes("cy@x.test"))).toMatch(/,"?Removed"?$/);
  });
});

// The step 4 review fixes: H1 (a home row dated by the account), L6 (a
// membership person's row counts their reports here, and the chart names a
// dotted manager only with a seat here), L9 (names in memory by collation).
describe("the Directory's rows of membership people, after the step 4 review", () => {
  it("dates a membership person whose row here is their home row by their account (H1)", async () => {
    db.row("user", "cy").createdAt = new Date("2018-03-01T00:00:00Z");
    db.row("organizationMembership", "m-cy").isPrimary = true;
    const cy = (await dir()).data.find((r) => r.id === "cy")!;
    // Before: 2026-06-01, the moment Cy's account left B.
    expect(new Date(cy.joinDate as string).toISOString()).toBe("2018-03-01T00:00:00.000Z");
  });

  it("counts a membership person's reports here only, and names a dotted manager on the chart only with a seat here (L6)", async () => {
    const base = { lastName: "Lee", phone: null, status: "ACTIVE", deletedAt: null, roleId: null, officeId: null, departmentId: null, presenceStatus: null, joinDate: new Date("2026-02-01"), ...legacyLevelRow("EMPLOYEE") };
    db.seed("user", { id: "amy", email: "amy@x.test", firstName: "Amy", organizationId: "a", managerId: "cy", ...base });
    db.seed("user", { id: "eve", email: "eve@x.test", firstName: "Eve", organizationId: "b", managerId: "cy", ...base });
    const cy = (await dir()).data.find((r) => r.id === "cy")!;
    // Before: 2, Amy reporting to Cy in A counted here too.
    expect(cy.directReports).toBe(1);
    db.seed("userDottedLine", { id: "d1", userId: "bea", managerId: "cy" });
    db.seed("userDottedLine", { id: "d2", userId: "bea", managerId: "amy" });
    const chart = (await (await directoryList(new NextRequest("https://app.test/api/users?fields=chart"))).json()) as { data: Row[] };
    // Before: ["cy", "amy"], Amy being A's alone.
    expect(chart.data.find((r) => r.id === "bea")?.dottedManagerIds).toEqual(["cy"]);
  });

  it("orders names in memory as the database does, case set aside (L9)", async () => {
    db.row("user", "bea").firstName = "adam";
    db.row("user", "u-admin").firstName = "Zoe";
    // A grouping with a membership person among the matches is ordered in memory.
    const grouped = await dir("&group=department");
    const none = grouped.data.filter((r) => r.id !== "bea").map((r) => r.firstName);
    // Before: "Zoe" before "Cy" and "adam" sorted after every capital.
    expect(none).toEqual(["Cy", "Zoe"]);
    db.row("user", "bea").departmentId = null;
    expect((await dir("&group=department")).data.map((r) => r.firstName)).toEqual(["adam", "Cy", "Zoe"]);
  });
});

// The Remove dialog's toast promises a screen only now that one exists for
// both kinds (the step 3 review L6), and Plan & billing no longer says
// Members cannot list people here through a membership (it does since step
// 3). Checked in their sources: both are plain strings in client components.
describe("the words that point to these screens are true", () => {
  it("the Remove toast names the Directory's Removed view, and the billing page names Members", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (f: string) => readFileSync(`${process.cwd()}/${f}`, "utf8");
    expect(read("src/components/people/remove-person-dialog.tsx")).toContain("was removed. An Admin can restore them from the Directory's Removed view.");
    const billing = read("src/app/(dashboard)/settings/billing/page.tsx");
    expect(billing).toContain("To free one of these seats, deactivate or remove them in Members.");
    expect(billing).not.toContain("Members does not list");
  });
});
