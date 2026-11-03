// The Staff console reads each workspace's seat (docs/plans/workspace-status.md
// D12): who is an Owner there, who belongs there, whom Set Owner may promote,
// who a suspension signs out and whether it would lock the staff member out.
// A membership counts only while its seat in that workspace is live (a
// usable one, for "another healthy workspace"), and a membership person
// joined that workspace when the membership was made (the step 3 review H3),
// as the workspace's own Owner rule reads it (membership.ts liveAdminsOf).
// Run on the in-memory database.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOfRow, legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/staff-audit", () => ({
  logStaffAction: async () => ({ id: "sa1" }),
  writeTenantRow: () => undefined,
  planLabel: (p: string) => p,
  statusLabel: (s: string) => s,
}));
vi.mock("@/lib/agents/leaver-hooks", () => ({ endWorkspaceTeammateAccess: async () => undefined }));
vi.mock("@/services/billing", () => ({ subscriptionStillOpen: async () => false }));
vi.mock("@/lib/enterprise-features", () => ({ setFeature: async () => undefined }));
vi.mock("@/lib/org-settings-write", () => ({ writeOrgSettingsKeys: async () => undefined }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { companyPeople, ownerCompanyIds, ownerCountsOf, ownerIdsFor } from "./company-detail";
import { hasOwnerWhere } from "./companies-list";
import { setWorkspaceOwner } from "./set-owner";
import { applyCompanyPatch } from "./company-patch";

const orgs = () => (db.prisma as never as { organization: { findMany: (a: unknown) => Promise<Array<{ id: string }>> } }).organization;
const person = (id: string, organizationId: string, level: string, createdAt: string) =>
  db.seed("user", { id, email: `${id}@x.test`, firstName: id, lastName: "Lee", organizationId, ...legacyLevelRow(level), createdAt: new Date(createdAt) });

beforeEach(() => {
  db.reset();
  // Raw statements these paths send: the workspace's row lock, the advisory role lock's helpers.
  db.onQueryRaw = () => [];
  for (const id of ["a", "b", "c"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
  // B's founder, anchored there, an Admin since 2026.
  person("bo", "b", "COMPANY_ADMIN", "2026-03-01");
  // Cy, anchored in A since 2019, an Admin of B through a membership made in 2026.
  person("cy", "a", "EMPLOYEE", "2019-01-01");
  db.seed("organizationMembership", { id: "m-cy-b", userId: "cy", organizationId: "b", role: "COMPANY_ADMIN", createdAt: new Date("2026-06-01") });
});

describe("the Staff console reads who is an Owner where from each workspace's seat", () => {
  it("names the earliest Admin who joined HERE, never by an older account made elsewhere", async () => {
    // Before: Cy's account (2019) outranked Bo, so the console called Cy the Owner of B.
    expect(await ownerIdsFor("b")).toEqual(["bo"]);
  });

  it("never names an Owner whose membership here the workspace deactivated or removed", async () => {
    Object.assign(db.row("user", "bo"), legacyLevelRow("EMPLOYEE"));
    expect(await ownerIdsFor("b")).toEqual(["cy"]);
    db.row("organizationMembership", "m-cy-b").status = "INACTIVE";
    // Before: Cy's account is live in A, so B still had an Owner.
    expect(await ownerIdsFor("b")).toEqual([]);
    const withOwner = async () => ((await orgs().findMany({ where: { AND: [{ id: "b" }, hasOwnerWhere(await ownerCompanyIds())] } })).length > 0);
    expect(await withOwner()).toBe(false);
    db.row("organizationMembership", "m-cy-b").status = "ACTIVE";
    expect(await withOwner()).toBe(true);
    db.row("organizationMembership", "m-cy-b").removedAt = new Date("2026-10-01");
    expect(await withOwner()).toBe(false);
  });

  it("counts the Companies list's Owners the same way (moved here from the route in step 4)", async () => {
    // Bo is B's Owner by earliest Admin here; Cy's 2019 account does not outrank him.
    expect(await ownerCountsOf(["b"])).toEqual(new Map([["b", 1]]));
    db.row("user", "bo").status = "INACTIVE";
    expect(await ownerCountsOf(["b"])).toEqual(new Map([["b", 1]]));
    db.row("organizationMembership", "m-cy-b").status = "INACTIVE";
    // Before: 1, Cy's account being live in A.
    expect(await ownerCountsOf(["b"])).toEqual(new Map());
  });

  it("lists as the workspace's people only those whose seat here is live", async () => {
    expect((await companyPeople("b")).map((p) => p.id).sort()).toEqual(["bo", "cy"]);
    db.row("organizationMembership", "m-cy-b").status = "INACTIVE";
    // Before: Cy, ended here, was listed as an Admin of B.
    expect((await companyPeople("b")).map((p) => p.id)).toEqual(["bo"]);
  });
});

describe("Set Owner reads the seat here", () => {
  const run = (userId: string) => setWorkspaceOwner({ companyId: "b", userId, reason: "Their Owner left the company", confirm: "Org b", actor: { id: "staff1" } as never, ip: null });

  it("refuses someone whose membership here the workspace ended", async () => {
    person("dee", "a", "EMPLOYEE", "2026-01-01");
    db.seed("organizationMembership", { id: "m-dee-b", userId: "dee", organizationId: "b", role: "EMPLOYEE", status: "INACTIVE" });
    // Before: Dee's account is live in A, so she was made an Owner of a workspace that ended her.
    expect(await run("dee")).toMatchObject({ ok: false, status: 404 });
    expect(db.row("organizationMembership", "m-dee-b").role).toBe("EMPLOYEE");
  });

  it("keeps the Owner by earliest Admin by when each joined here", async () => {
    // Eve, anchored in A since 2018, joins B as a Member in 2026: promoting her
    // displaces nobody, since Bo joined B first.
    person("eve", "a", "EMPLOYEE", "2018-01-01");
    db.seed("organizationMembership", { id: "m-eve-b", userId: "eve", organizationId: "b", role: "EMPLOYEE", createdAt: new Date("2026-07-01") });
    expect(await run("eve")).toMatchObject({ ok: true });
    // Before: Cy's 2019 account made him B's Owner by earliest Admin, and
    // Eve's 2018 one displaced him, so he was rewritten as SUPER_ADMIN.
    expect(legacyLevelOfRow(db.row("user", "bo"))).toBe("COMPANY_ADMIN");
    expect(db.row("organizationMembership", "m-cy-b").role).toBe("COMPANY_ADMIN");
    expect(db.row("organizationMembership", "m-eve-b").role).toBe("SUPER_ADMIN");
  });
});

describe("a suspension reads each person's other seats", () => {
  const suspend = (actorUserId: string | null) =>
    applyCompanyPatch({ id: "b", patch: { status: "SUSPENDED", confirm: "Org b" } as never, actor: { id: "staff1", userId: actorUserId } as never, ip: null });

  it("signs out someone whose only other membership was ended there, and leaves someone with a usable seat elsewhere", async () => {
    person("fay", "b", "EMPLOYEE", "2026-01-01");
    db.seed("organizationMembership", { id: "m-fay-c", userId: "fay", organizationId: "c", role: "EMPLOYEE", status: "INACTIVE" });
    person("gil", "b", "EMPLOYEE", "2026-01-01");
    db.seed("organizationMembership", { id: "m-gil-c", userId: "gil", organizationId: "c", role: "EMPLOYEE" });
    const r = await suspend(null);
    expect(r).toMatchObject({ ok: true });
    // Before: Fay's ended seat in C counted as a healthy workspace, so she was
    // not signed out, and the session check then had nowhere to move her.
    expect(db.row("user", "fay").tokenVersion).toBe(1);
    expect(db.row("user", "gil").tokenVersion).toBe(0);
    // Bo has no other seat.
    expect(db.row("user", "bo").tokenVersion).toBe(1);
  });

  it("does not refuse a staff member whose membership here the workspace ended (closing it cannot lock them out)", async () => {
    person("hal", "a", "EMPLOYEE", "2026-01-01");
    db.seed("organizationMembership", { id: "m-hal-b", userId: "hal", organizationId: "b", role: "EMPLOYEE", status: "INACTIVE", removedAt: new Date("2026-10-01") });
    // Before: any membership row here refused the suspension as a self lockout.
    expect(await suspend("hal")).toMatchObject({ ok: true });
    db.row("organizationMembership", "m-hal-b").status = "ACTIVE";
    db.row("organizationMembership", "m-hal-b").removedAt = null;
    db.row("organization", "b").status = "ACTIVE";
    expect(await suspend("hal")).toMatchObject({ ok: false, status: 400 });
  });
});

// The step 4 review H1: "joined here" never depends on which row holds the
// seat (access/joined-here.ts). A person's own membership row for the
// workspace dates them, unless it is the home row (isPrimary: the workspace
// the account was made in, left first), then the account's creation.
describe("the earliest Admin is dated by when they joined HERE, whatever their anchor (H1)", () => {
  it("an account older than the workspace's founder, anchored in it through a switch, is not an Owner", async () => {
    // Pat switched into B: her account (2019, made at her agency) is anchored
    // in B now, her B row (June 2026) stays, and her agency row is the home row.
    person("pat", "b", "COMPANY_ADMIN", "2019-01-01");
    db.seed("organizationMembership", { id: "m-pat-b", userId: "pat", organizationId: "b", role: "COMPANY_ADMIN", createdAt: new Date("2026-06-01") });
    db.seed("organizationMembership", { id: "m-pat-a", userId: "pat", organizationId: "a", role: "COMPANY_ADMIN", isPrimary: true, createdAt: new Date("2026-06-02") });
    // Before: ["pat"], her 2019 account outranking Bo (March 2026), and the console agreed.
    expect(await ownerIdsFor("b")).toEqual(["bo"]);
    expect(await ownerCountsOf(["b"])).toEqual(new Map([["b", 1]]));
    expect((await companyPeople("b")).find((p) => p.id === "pat")?.role).toBe("ADMIN");
  });

  it("the home workspace's founder stays its Owner while working elsewhere and after switching back", async () => {
    // Ana founded A (2019); Quinn is A's other Admin (2021).
    person("ana", "a", "COMPANY_ADMIN", "2019-01-01");
    person("quinn", "a", "COMPANY_ADMIN", "2021-01-01");
    expect(await ownerIdsFor("a")).toEqual(["ana"]);
    // Ana moves to B: A's row for her is the home row, made at the move.
    db.row("user", "ana").organizationId = "b";
    db.seed("organizationMembership", { id: "m-ana-a", userId: "ana", organizationId: "a", role: "COMPANY_ADMIN", isPrimary: true, createdAt: new Date("2026-07-01") });
    // Before: ["quinn"], A's row dating Ana by the move.
    expect(await ownerIdsFor("a")).toEqual(["ana"]);
    expect(await ownerCountsOf(["a"])).toEqual(new Map([["a", 1]]));
    // Back in A, the home row stays stale and she is dated 2019 still.
    db.row("user", "ana").organizationId = "a";
    expect(await ownerIdsFor("a")).toEqual(["ana"]);
  });

  it("Set Owner's \"older\" rule reads the same dates", async () => {
    // Pat, anchored in B through a switch as a Member (her B row June 2026), is made an Owner.
    person("pat", "b", "EMPLOYEE", "2019-01-01");
    db.seed("organizationMembership", { id: "m-pat-b", userId: "pat", organizationId: "b", role: "EMPLOYEE", createdAt: new Date("2026-06-01") });
    expect(await setWorkspaceOwner({ companyId: "b", userId: "pat", reason: "Their Owner left the company", confirm: "Org b", actor: { id: "staff1" } as never, ip: null })).toMatchObject({ ok: true });
    // Before: her 2019 account displaced Bo, so Bo was rewritten as SUPER_ADMIN.
    expect(legacyLevelOfRow(db.row("user", "bo"))).toBe("COMPANY_ADMIN");
    expect(await ownerIdsFor("b")).toEqual(["bo", "pat"]);
  });
});

// The step 4 review L7: the Companies list's Owners filter and the overview's
// count read the same rows as the Owner count, so the anchored workspace's
// own stale membership row never says "has an Owner".
describe("has an Owner and the Owner count agree (L7)", () => {
  it("never counts an anchored person's own stale row", async () => {
    db.seed("organization", { id: "c", name: "Org c", status: "ACTIVE", settings: {} });
    // Dee is anchored in C and was demoted there; her stale C row still says COMPANY_ADMIN.
    person("dee", "c", "EMPLOYEE", "2026-01-01");
    db.seed("organizationMembership", { id: "m-dee-c", userId: "dee", organizationId: "c", role: "COMPANY_ADMIN" });
    const has = async (id: string) => (await orgs().findMany({ where: { AND: [{ id }, hasOwnerWhere(await ownerCompanyIds())] } })).length > 0;
    expect(await ownerCountsOf(["c"])).toEqual(new Map());
    // Before: true, the stale row matched the membership half.
    expect(await has("c")).toBe(false);
    // And both agree where there is one.
    expect(await ownerCountsOf(["b"])).toEqual(new Map([["b", 1]]));
    expect(await has("b")).toBe(true);
  });
});
