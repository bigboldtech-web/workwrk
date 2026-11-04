// Members lists everyone who belongs here (docs/plans/workspace-status.md
// D11, step 3): people anchored here, and people who work here through a
// membership, each with THIS workspace's role and status, under the same
// filters, search and scope, and the counts read the same people (D12). Run
// on an in-memory database whose relations follow the rows.
//
// Before step 3 Members listed people anchored here only, so a workspace's
// admins never saw (and could never deactivate or remove) someone who works
// there while anchored in their own company.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));
// An Agent's stored reports are manager-lines.ts's own (tested there).
vi.mock("./manager-lines", async (orig) => ({ ...(await orig<typeof import("./manager-lines")>()), agentsWithStoredReports: async () => new Map() }));

import { listMembers, peopleTeamIdsFor } from "./members-list.server";
import { liveMembersHere, roleCountsFor } from "./role-counts";
import { seatDb as db } from "./seat-test-db";

let made = 0;
function person(id: string, organizationId: string, accessLevel = "EMPLOYEE", extra: Record<string, unknown> = {}) {
  made += 1;
  return db.seed("user", { id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Lee", organizationId, accessLevel, createdAt: new Date(Date.UTC(2026, 0, made)), managerId: null, weeklyCapacityHours: null, departmentId: null, roleId: null, officeId: null, ...extra });
}
function seat(userId: string, organizationId: string, role = "EMPLOYEE", extra: Record<string, unknown> = {}) {
  made += 1;
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role, createdAt: new Date(Date.UTC(2026, 5, made)), ...extra });
}
const ORG = { orgWide: true, ids: [] };
const names = (r: { rows: Array<{ id: string }> }) => r.rows.map((x) => x.id);

beforeEach(() => {
  db.reset();
  made = 0;
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
  db.seed("department", { id: "dep-a", name: "Finance", organizationId: "a" });
  db.seed("department", { id: "dep-b", name: "Design", organizationId: "b" });
  // B's own people.
  person("olga", "b", "SUPER_ADMIN");
  person("bea", "b", "EMPLOYEE", { departmentId: "dep-b" });
  person("dan", "b", "MANAGER", { status: "INACTIVE" });
  // Pat: anchored in A (an Admin there, in A's Finance, reporting to A's Amy), a Manager in B.
  person("amy", "a", "MANAGER");
  person("pat", "a", "COMPANY_ADMIN", { departmentId: "dep-a", managerId: "amy", weeklyCapacityHours: 20, mfaEnabled: true });
  seat("pat", "b", "MANAGER");
  // Rex: anchored in A, deactivated in B. Ron: removed from B. Ida: deactivated in A, live in B.
  person("rex", "a");
  seat("rex", "b", "EMPLOYEE", { status: "INACTIVE" });
  person("ron", "a");
  seat("ron", "b", "EMPLOYEE", { status: "INACTIVE", removedAt: new Date("2026-10-01") });
  person("ida", "a", "EMPLOYEE", { status: "INACTIVE" });
  seat("ida", "b", "COMPANY_ADMIN");
});

describe("Members lists everyone who belongs here (D11)", () => {
  it("lists membership people with this workspace's role and status, and never a removed membership", async () => {
    const list = await listMembers("b", ORG, {});
    // Before: olga, bea and dan only.
    expect(names(list).sort()).toEqual(["bea", "dan", "ida", "olga", "pat", "rex"]);
    expect(list.total).toBe(6);
    const pat = list.rows.find((r) => r.id === "pat")!;
    expect(pat).toMatchObject({ role: "MEMBER", tier: "MANAGER", tierLabel: "Manager", status: "ACTIVE", profileHere: false });
    expect(list.rows.find((r) => r.id === "rex")).toMatchObject({ status: "INACTIVE", profileHere: false });
    // Ida's account is deactivated in A; here she is a live Admin.
    expect(list.rows.find((r) => r.id === "ida")).toMatchObject({ role: "ADMIN", status: "ACTIVE" });
    expect(list.rows.find((r) => r.id === "bea")).toMatchObject({ department: { id: "dep-b", name: "Design" }, profileHere: true });
  });

  it("sends nothing of a membership person's profile beyond name, email and photo", async () => {
    const pat = (await listMembers("b", ORG, {})).rows.find((r) => r.id === "pat")!;
    // A's department, A's manager, the account's working week and sign-in factor.
    expect(pat).toMatchObject({ department: null, jobTitle: null, office: null, manager: null, weeklyCapacityHours: null });
    expect(pat).not.toHaveProperty("mfaEnabled");
    expect(JSON.stringify(pat)).not.toMatch(/Finance|Amy/);
    // A manager who holds a seat here is named: the one Pat's line HERE
    // names, on her membership (workspace-status-2 E1); her account still
    // names Amy, A's.
    person("max", "b", "MANAGER");
    db.row("organizationMembership", "m-pat-b").managerId = "max";
    expect((await listMembers("b", ORG, {})).rows.find((r) => r.id === "pat")?.manager).toEqual({ id: "max", name: "Max Lee" });
    // Their joining date here is their membership's.
    expect(pat.joinedAt).toBe((db.tables.organizationMembership.find((m) => m.userId === "pat" && m.organizationId === "b")!.createdAt as Date).toISOString());
  });

  it("filters by the seat: status, role and No manager read this workspace's answer", async () => {
    // Deactivated here: Dan (anchored) and Rex (membership), never Ida (deactivated in A only).
    expect(names(await listMembers("b", ORG, { status: "INACTIVE" })).sort()).toEqual(["dan", "rex"]);
    expect(names(await listMembers("b", ORG, { status: "ACTIVE" })).sort()).toEqual(["bea", "ida", "olga", "pat"]);
    expect(names(await listMembers("b", ORG, { role: "ADMIN" }))).toEqual(["ida"]);
    expect(names(await listMembers("b", ORG, { role: "MEMBER" })).sort()).toEqual(["bea", "dan", "pat", "rex"]);
    expect(names(await listMembers("b", ORG, { role: "OWNER" }))).toEqual(["olga"]);
    // Pat's account reports to Amy, who has no seat here, and her line here
    // (her membership's, workspace-status-2 E1) names nobody: her row says
    // Nobody, and No manager lists her (the step 3 review L3; before, the
    // account's line left her out, which told B she had a manager in A).
    expect(names(await listMembers("b", ORG, { noManager: true })).sort()).toEqual(["bea", "ida", "olga", "pat"]);
    person("max", "b", "MANAGER");
    db.row("organizationMembership", "m-pat-b").managerId = "max";
    expect(names(await listMembers("b", ORG, { noManager: true })).sort()).toEqual(["bea", "ida", "max", "olga"]);
    // This workspace's own department matches only its own people.
    expect(names(await listMembers("b", ORG, { departmentId: "dep-b" }))).toEqual(["bea"]);
  });

  it("finds a membership person by search, and inside a manager's chain", async () => {
    expect(names(await listMembers("b", ORG, { q: "pat" }))).toEqual(["pat"]);
    expect(names(await listMembers("b", ORG, { q: "PAT@X" }))).toEqual(["pat"]);
    expect(names(await listMembers("b", { orgWide: false, ids: ["bea", "pat"] }, {})).sort()).toEqual(["bea", "pat"]);
    expect(names(await listMembers("b", { orgWide: false, ids: ["ron"] }, {}))).toEqual([]);
  });

  it("sorts by role and status at the seat here, and pages them", async () => {
    // Postgres orders AccessLevel by its declaration: SUPER_ADMIN, COMPANY_ADMIN, ..., MANAGER, ..., EMPLOYEE.
    const byRole = await listMembers("b", ORG, { sort: "role", limit: 10 });
    // Pat sorts as B's Manager, never as A's Company Admin; Ida as B's Admin.
    expect(names(byRole)).toEqual(["olga", "ida", "dan", "pat", "bea", "rex"]);
    expect(names(await listMembers("b", ORG, { sort: "status" }))).toEqual(["bea", "ida", "olga", "pat", "dan", "rex"]);
    // Name sorts stay in the database, membership people in their place.
    expect(names(await listMembers("b", ORG, { sort: "name_asc" }))).toEqual(["bea", "dan", "ida", "olga", "pat", "rex"]);
    for (let i = 0; i < 12; i += 1) person(`z${String(i).padStart(2, "0")}`, "b");
    const p0 = await listMembers("b", ORG, { sort: "role", limit: 10, page: 0 });
    const p1 = await listMembers("b", ORG, { sort: "role", limit: 10, page: 1 });
    expect(p0.total).toBe(18);
    expect(p0.pageCount).toBe(2);
    expect(new Set([...names(p0), ...names(p1)]).size).toBe(18);
  });
});

describe("the Owners, the People team and the counts read the same people (D11, D12)", () => {
  it("an Owner through a membership is an Owner here while their seat is live", async () => {
    db.tables.organizationMembership.find((m) => m.userId === "pat" && m.organizationId === "b")!.role = "SUPER_ADMIN";
    expect(names(await listMembers("b", ORG, { role: "OWNER" })).sort()).toEqual(["olga", "pat"]);
    db.tables.organizationMembership.find((m) => m.userId === "pat" && m.organizationId === "b")!.status = "INACTIVE";
    expect(names(await listMembers("b", ORG, { role: "OWNER" }))).toEqual(["olga"]);
  });

  it("the People team at HR includes someone at HR here through a membership", async () => {
    db.tables.organizationMembership.find((m) => m.userId === "pat" && m.organizationId === "b")!.role = "HR";
    person("hana", "b", "HR");
    // Before: hana only.
    expect([...(await peopleTeamIdsFor("b")).ids].sort()).toEqual(["hana", "pat"]);
    expect((await listMembers("b", ORG, { peopleTeam: true })).rows.map((r) => r.id).sort()).toEqual(["hana", "pat"]);
  });

  it("roleCountsFor and the Overview's member count count live seats here, a membership's too", async () => {
    // Live here: olga (Owner), bea, pat (Member), ida (Admin through a membership). Not: dan and rex (deactivated here), ron (removed), amy (A only).
    // Ida's account is deactivated in A, so D12 leaves her out of the counts though her seat here is live.
    expect(await liveMembersHere("b")).toBe(3);
    // Before: 2 (olga, bea).
    expect(await roleCountsFor("b")).toEqual({ owners: 1, admins: 0, members: 2, guests: 0, peopleTeam: 0 });
    db.row("user", "ida").status = "ACTIVE";
    expect(await roleCountsFor("b")).toEqual({ owners: 1, admins: 1, members: 2, guests: 0, peopleTeam: 0 });
    expect(await liveMembersHere("b")).toBe(4);
  });
});

// The step 3 review H2 (D18): an anchored row shows only this workspace's own
// department, job role and office, and a manager only with a seat here, as a
// membership row does. And L3: a membership person signs in where their
// account is anchored, so this workspace shows no sign-in for them and its
// Inactive 30 days filter never lists them.
describe("every row shows only this workspace's own profile, and no sign-in it cannot see", () => {
  it("an anchored row never names another workspace's department or a manager with no seat here", async () => {
    // Bea, anchored in B, still carries A's Finance (old data) and reports to Amy (A only).
    db.row("user", "bea").departmentId = "dep-a";
    db.row("user", "bea").managerId = "amy";
    const bea = (await listMembers("b", ORG, {})).rows.find((r) => r.id === "bea")!;
    // Before: { name: "Finance" } and Amy Lee, from A.
    expect(bea).toMatchObject({ department: null, manager: null });
    expect(JSON.stringify(bea)).not.toMatch(/Finance|Amy/);
    // Sorted by department, Finance is no key here either.
    const byDept = await listMembers("b", ORG, { sort: "department" });
    expect(byDept.rows.find((r) => r.id === "bea")?.department).toBeNull();
  });

  it("a membership row shows no sign-in, and Inactive 30 days leaves membership people out", async () => {
    db.seed("activityLog", { id: "l1", organizationId: "b", type: "login", actorId: "olga", createdAt: new Date() });
    db.seed("activityLog", { id: "l2", organizationId: "b", type: "login", actorId: "pat", createdAt: new Date() });
    const list = await listMembers("b", ORG, {});
    expect(list.rows.find((r) => r.id === "olga")?.lastSignInAt).not.toBeNull();
    // Before: B's own login rows (none for most membership people: "never signed in").
    expect(list.rows.find((r) => r.id === "pat")?.lastSignInAt).toBeNull();
    // Before: every membership person with no sign-in logged here was "inactive 30 days".
    expect(names(await listMembers("b", ORG, { inactive30: true })).sort()).toEqual(["bea", "dan"]);
  });
});

// The step 4 review H1 (joined-here.ts): Members shows, and sorts by, when
// each person joined HERE, whichever row holds their seat now.
describe("Members dates everyone by when they joined here (H1)", () => {
  it("dates someone who switched in by their row here, and a home row by the account", async () => {
    // Zed's account (2019) is anchored in B through a switch; his B row is from July 2026.
    person("zed", "b", "EMPLOYEE", { createdAt: new Date("2019-01-01T00:00:00Z") });
    seat("zed", "b", "EMPLOYEE", { createdAt: new Date("2026-07-15T00:00:00Z") });
    // Pat's B row is her home row: B is where her account was made, then she left.
    db.row("organizationMembership", "m-pat-b").isPrimary = true;
    const list = await listMembers("b", ORG, {});
    const joined = (id: string) => list.rows.find((r) => r.id === id)?.joinedAt;
    // Before: 2019 for Zed (his account), and Pat's row's date.
    expect(joined("zed")).toBe("2026-07-15T00:00:00.000Z");
    expect(joined("pat")).toBe(new Date(Date.UTC(2026, 0, 5)).toISOString());
    // The sort by join date reads the same dates: Zed is the newest here.
    expect(names(await listMembers("b", ORG, { sort: "joined" }))[0]).toBe("zed");
  });

  it("sorts by join date here with nobody here through a membership, when someone switched in", async () => {
    // A: everyone anchored there. Zoe's account (2019) switched in; her A row is from August 2026.
    person("zoe", "a", "EMPLOYEE", { createdAt: new Date("2019-01-01T00:00:00Z") });
    seat("zoe", "a", "EMPLOYEE", { createdAt: new Date("2026-08-01T00:00:00Z") });
    // Before: last, the database sorting by the account's creation.
    expect(names(await listMembers("a", ORG, { sort: "joined" }))[0]).toBe("zoe");
  });
});
