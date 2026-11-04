// SCIM 2.0 Users, one resource: an erased account (review round 8 of Phase
// 3). A person who deleted their own account (POST /api/me/delete) is gone
// for the identity provider. Before, a PUT or PATCH found the row by id and
// organisation alone and wrote the person's real address and names back onto
// the anonymised "Deleted User", and active:true brought the account back;
// the erasure sweep then never recognised it, so their AI teammates' words
// stayed for good. Now GET, PUT and PATCH answer as for an unknown user, a
// deprovision still answers a harmless success (identity providers retry on
// errors), and a normal account works as before.
// Review round 9 of Phase 3: only while the account is in the state its
// erasure left it (deletedAt within a minute of its newest erasure record).
// An erased account an Admin restored before round 8, or removed after such
// a restore, is an ordinary account again; before, every push to it was 404.
//
// Step 4 of docs/plans/workspace-status.md (D14): `active` is this
// workspace's seat, and a reactivation restores that seat through
// restoreSeat; the status is never written onto the account by the route.
// The file runs on the in-memory database (seat-test-db.ts) since then, so
// the reactivation's own reads and writes are the real ones; the assertions
// read the rows rather than a list of update calls (a reactivation that
// clears a manager writes the line, then restoreSeat writes the status).

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const ERASED_AT = new Date("2026-10-01T09:00:00Z");
const ERASED_ROW = {
  id: "u-gone",
  email: "deleted-u-gone@workwrk.anon",
  firstName: "Deleted",
  lastName: "User",
  status: "INACTIVE",
  deletedAt: ERASED_AT,
  organizationId: "org1",
  createdAt: new Date("2026-01-01T09:00:00Z"),
  updatedAt: new Date("2026-10-01T09:00:00Z"),
};
const LIVE_ROW = { ...ERASED_ROW, id: "u-max", email: "max@x.test", firstName: "Max", lastName: "Chen", status: "ACTIVE", deletedAt: null };

const st = vi.hoisted(() => ({
  deprovisioned: [] as string[],
  locks: [] as string[],
  followed: [] as Array<{ ids: string[]; actor: string }>,
  rolesBusy: false,
  seatsBusy: false,
  /** Phase 5 step 3 (Decision 14): the people whose skills a reactivation cleared, by workspace. */
  skillsBack: [] as Array<[string, readonly string[]]>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async (org: string, ids: readonly string[]) => void st.skillsBack.push([org, ids]) }));
vi.mock("@/lib/access/membership", () => ({
  lockOrgRoles: async () => {
    st.locks.push("roles");
    if (st.rolesBusy) throw Object.assign(new Error("busy"), { name: "OrgRolesBusy" });
  },
  liveOwnerIds: async () => ["u-owner"],
}));
vi.mock("@/lib/performance/review-cycle.server", () => ({
  followReportingLine: async (_org: string, ids: string[], actor: string) => { st.followed.push({ ids, actor }); return 0; },
}));
vi.mock("@/lib/scim-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scim-auth")>()),
  authenticateScim: async () => ({ ok: true, organizationId: "org1", workspaceInactive: false }),
}));
vi.mock("@/lib/scim-deprovision", () => ({
  scimDeprovision: async (_org: string, id: string) => {
    st.deprovisioned.push(id);
    return { ok: true, alreadyInactive: true, recipientId: null };
  },
  scimDeprovisionMember: async () => ({ ok: true, alreadyInactive: true, recipientId: null }),
  formerMemberDeprovision: async () => null,
  scimReactivated: async () => undefined,
}));
vi.mock("@/lib/platform-admin", () => ({ isReservedStaffAddress: async () => false, STAFF_ADDRESS_REFUSAL: "reserved" }));
vi.mock("@/lib/seats", () => ({
  lockWorkspaceSeats: async (_tx: unknown, _org: string, opts?: { bounded?: boolean }) => {
    st.locks.push(opts?.bounded ? "seats-bounded" : "seats");
    if (st.seatsBusy) throw Object.assign(new Error("busy"), { name: "SeatsBusy" });
  },
  seatsFor: async () => ({ ok: true }),
}));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { GET, PATCH, PUT } from "./route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, id: string, body?: unknown) =>
  new NextRequest(`https://app.test/api/scim/v2/Users/${id}`, { method, headers: { "content-type": "application/scim+json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

const FULL = {
  userName: "max.real@x.test",
  name: { givenName: "Max", familyName: "Chen" },
  emails: [{ value: "max.real@x.test", primary: true }],
};

/** The erasure's provenance record (src/lib/compliance/erased-account.ts). */
const erasedAt = (userId: string, at: Date) => db.seed("consentRecord", { id: `c-${userId}`, userId, method: "erasure", withdrawnAt: at });
const audit = () => (db.tables.activityLog ?? []) as Array<Record<string, unknown>>;
const writes = () => db.writes.filter((w) => w.startsWith("user."));

beforeEach(() => {
  db.reset();
  st.skillsBack = [];
  st.deprovisioned = [];
  st.locks = [];
  st.followed = [];
  st.rolesBusy = false;
  st.seatsBusy = false;
  for (const id of ["org1", "client"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  db.seed("user", { ...ERASED_ROW, ...legacyLevelRow("EMPLOYEE") });
  db.seed("user", { ...LIVE_ROW, ...legacyLevelRow("EMPLOYEE") });
  erasedAt("u-gone", ERASED_AT);
});

describe("an erased account is gone for the identity provider", () => {
  it("PUT never writes the real address and names back, and active:true never brings it back", async () => {
    for (const body of [{ ...FULL, active: true }, FULL, { active: true }]) {
      const res = await PUT(req("PUT", "u-gone", body), params("u-gone"));
      // Before: 200, and the row held max.real@x.test, "Max Chen", ACTIVE.
      expect(res.status).toBe(404);
      expect((await res.json()).detail).toBe("User not found");
    }
    expect(writes()).toEqual([]);
    expect(db.row("user", "u-gone")).toMatchObject({ email: "deleted-u-gone@workwrk.anon", firstName: "Deleted", lastName: "User", status: "INACTIVE" });
  });

  it("PATCH never renames it or brings it back, whatever the shape of the operations", async () => {
    const bodies = [
      { Operations: [{ op: "replace", path: "userName", value: "max.real@x.test" }] },
      { Operations: [{ op: "replace", path: "name.givenName", value: "Max" }, { op: "replace", path: "name.familyName", value: "Chen" }] },
      { Operations: [{ op: "replace", path: "active", value: true }] },
      { Operations: [{ op: "replace", value: { active: true, name: { givenName: "Max" } } }] },
      { Operations: [{ op: "replace", path: "title", value: "Ops" }] },
    ];
    for (const body of bodies) {
      const res = await PATCH(req("PATCH", "u-gone", body), params("u-gone"));
      // Before: 200 with the names and address written (or the row answered back).
      expect(res.status).toBe(404);
    }
    expect(writes()).toEqual([]);
    expect(db.row("user", "u-gone")).toMatchObject({ email: "deleted-u-gone@workwrk.anon", firstName: "Deleted", status: "INACTIVE" });
  });

  it("a deprovision still answers success, with every other field dropped", async () => {
    const put = await PUT(req("PUT", "u-gone", { ...FULL, active: false }), params("u-gone"));
    expect(put.status).toBe(200);
    const patch = await PATCH(req("PATCH", "u-gone", { Operations: [{ op: "replace", value: { active: false, name: { givenName: "Max" } } }] }), params("u-gone"));
    expect(patch.status).toBe(200);
    expect(st.deprovisioned).toEqual(["u-gone", "u-gone"]);
    // Nothing of the push lands on the row.
    expect(writes()).toEqual([]);
    expect(db.row("user", "u-gone")).toMatchObject({ email: "deleted-u-gone@workwrk.anon", firstName: "Deleted", lastName: "User" });
    expect(await put.json()).toMatchObject({ userName: "deleted-u-gone@workwrk.anon", active: false });
  });

  it("GET answers as for an unknown user", async () => {
    const res = await GET(req("GET", "u-gone"), params("u-gone"));
    expect(res.status).toBe(404);
  });
});

describe("a normal account works as before", () => {
  it("PUT renames it and changes its address", async () => {
    const res = await PUT(req("PUT", "u-max", { ...FULL, active: true }), params("u-max"));
    expect(res.status).toBe(200);
    expect(db.row("user", "u-max")).toMatchObject({ email: "max.real@x.test", firstName: "Max", lastName: "Chen", status: "ACTIVE", emailVerifiedAt: null });
    expect((await res.json()).active).toBe(true);
  });

  it("PATCH renames it and GET reads it", async () => {
    const res = await PATCH(req("PATCH", "u-max", { Operations: [{ op: "replace", path: "name.givenName", value: "Maxine" }] }), params("u-max"));
    expect(res.status).toBe(200);
    expect(db.row("user", "u-max").firstName).toBe("Maxine");
    const got = await GET(req("GET", "u-max"), params("u-max"));
    expect(got.status).toBe(200);
    expect((await got.json()).name.givenName).toBe("Maxine");
  });

  it("an account an Admin removed, with no erasure of its own, is still renamed as before", async () => {
    // Deleted, but no provenance record: not an erasure.
    db.tables.consentRecord = [];
    const res = await PUT(req("PUT", "u-gone", FULL), params("u-gone"));
    expect(res.status).toBe(200);
    expect(db.row("user", "u-gone").email).toBe("max.real@x.test");
  });
});

describe("an erased account no longer in the state its erasure left it is an ordinary account", () => {
  it("one an Admin restored before round 8 is read and renamed as anyone is", async () => {
    Object.assign(db.row("user", "u-gone"), { deletedAt: null, status: "ACTIVE" });
    const res = await PUT(req("PUT", "u-gone", FULL), params("u-gone"));
    // Before: 404, any erasure record refused it.
    expect(res.status).toBe(200);
    expect(db.row("user", "u-gone")).toMatchObject({ email: "max.real@x.test", firstName: "Max", lastName: "Chen" });
    const got = await GET(req("GET", "u-gone"), params("u-gone"));
    expect(got.status).toBe(200);
  });

  it("one an Admin removed after such a restore is renamed as anyone is", async () => {
    db.row("user", "u-gone").deletedAt = new Date("2026-10-20T09:00:00Z");
    const res = await PATCH(req("PATCH", "u-gone", { Operations: [{ op: "replace", path: "name.givenName", value: "Max" }] }), params("u-gone"));
    // Before: 404.
    expect(res.status).toBe(200);
    expect(db.row("user", "u-gone").firstName).toBe("Max");
  });

  it("goes by the minute's edge: 60 seconds from the erasure is refused, 60.001 seconds from it is not", async () => {
    db.row("user", "u-gone").deletedAt = new Date(ERASED_AT.getTime() + 60_000);
    expect((await PUT(req("PUT", "u-gone", FULL), params("u-gone"))).status).toBe(404);
    expect(writes()).toEqual([]);
    db.row("user", "u-gone").deletedAt = new Date(ERASED_AT.getTime() + 60_001);
    // Before: 404.
    expect((await PUT(req("PUT", "u-gone", FULL), params("u-gone"))).status).toBe(200);
  });
});

// Docs-found fixes batch 5: a reactivation from the identity provider
// checked no lines, so the person came back under a manager who had left or
// been deactivated meanwhile, or an Agent from before rule 6, and the seat
// wait had no bound.
describe("SCIM reactivation re-checks the person's lines, as a restore does", () => {
  const manager = (extra: Record<string, unknown> = {}) => db.seed("user", { id: "u-dana", email: "dana@x.test", organizationId: "org1", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray", ...extra });
  beforeEach(() => {
    Object.assign(db.row("user", "u-max"), { status: "INACTIVE", managerId: "u-dana" });
  });

  it("comes back with no manager when the manager was deactivated, logged as the identity provider", async () => {
    manager({ status: "INACTIVE" });
    const res = await PATCH(req("PATCH", "u-max", { Operations: [{ op: "replace", path: "active", value: true }] }), params("u-max"));
    expect(res.status).toBe(200);
    // Before step 4: { status: "ACTIVE", managerId: null } in one write; now the
    // line is cleared, then the seat restored (restoreSeat).
    expect(db.row("user", "u-max")).toMatchObject({ status: "ACTIVE", managerId: null });
    expect(audit().find((a) => a.type === "reporting_line_changed")).toMatchObject({
      actorType: "scim",
      description: "Reactivated Max Chen with no manager: Dana Ray is deactivated",
      oldValue: { managerId: "u-dana" },
    });
    // Open reviews follow, to the first Owner when no person acted.
    expect(st.followed).toEqual([{ ids: ["u-max"], actor: "u-owner" }]);
    expect(st.locks).toEqual(["roles", "seats-bounded"]);
    // Their skills with AI teammates here stop their 30 days (Phase 5 step 3). Before: never cleared.
    expect(st.skillsBack).toEqual([["org1", ["u-max"]]]);
    expect((await res.json()).active).toBe(true);
  });

  it("keeps a live manager, and takes off a dotted line to an Agent (PUT too)", async () => {
    manager();
    db.seed("user", { id: "u-sam", email: "sam@x.test", organizationId: "org1", ...legacyLevelRow("AGENT"), status: "ACTIVE", deletedAt: null, firstName: "Sam", lastName: "Agent" });
    // This workspace's row (E2), and the client workspace's row of the same pair, never read here.
    db.seed("userDottedLine", { id: "d1", userId: "u-max", managerId: "u-sam", organizationId: "org1" });
    db.seed("userDottedLine", { id: "d2", userId: "u-max", managerId: "u-sam", organizationId: "client" });
    const res = await PUT(req("PUT", "u-max", { active: true }), params("u-max"));
    expect(res.status).toBe(200);
    expect(db.row("user", "u-max")).toMatchObject({ status: "ACTIVE", managerId: "u-dana" });
    expect(db.tables.userDottedLine.map((d) => d.id)).toEqual(["d2"]);
    expect(st.followed).toEqual([]);
  });

  it("answers 503 when the role lock or the seat lock is busy, never a 500, and writes nothing", async () => {
    manager();
    st.seatsBusy = true;
    const res = await PATCH(req("PATCH", "u-max", { Operations: [{ op: "replace", path: "active", value: true }] }), params("u-max"));
    expect(res.status).toBe(503);
    expect(writes()).toEqual([]);
    st.seatsBusy = false;
    st.rolesBusy = true;
    const again = await PUT(req("PUT", "u-max", { active: true }), params("u-max"));
    expect(again.status).toBe(503);
    expect(writes()).toEqual([]);
    expect(db.row("user", "u-max").status).toBe("INACTIVE");
  });
});

// Docs-found fixes batch 6 kept a manager line and a dotted line the person's
// other workspace relied on, since they were one row each. Since
// workspace-status-2.md E1 and E2 the client's lines are its own rows, and
// step 4 checks this workspace's lines only (E4): one here to someone with
// no seat here is cleared, never named, and the client's rows are never read.
describe("SCIM reactivation checks this workspace's lines only", () => {
  it("clears a line here to someone who works with the person in the other workspace only, unnamed, and keeps that workspace's row", async () => {
    Object.assign(db.row("user", "u-max"), { status: "INACTIVE", managerId: "u-dana" });
    db.seed("user", { id: "u-dana", email: "dana@x.test", organizationId: "client", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray" });
    db.seed("userDottedLine", { id: "d1", userId: "u-max", managerId: "u-dana", organizationId: "org1" });
    db.seed("userDottedLine", { id: "d2", userId: "u-max", managerId: "u-dana", organizationId: "client" });
    // Max works in the client workspace too, through a membership whose seat is deactivated with the account (D16).
    db.seed("organizationMembership", { id: "m-max-client", userId: "u-max", organizationId: "client", role: "EMPLOYEE", status: "INACTIVE", endedWithAccount: true });
    const res = await PATCH(req("PATCH", "u-max", { Operations: [{ op: "replace", path: "active", value: true }] }), params("u-max"));
    expect(res.status).toBe(200);
    // Max is anchored here: his account's line is this workspace's, to
    // someone with no seat here. Before (batch 6): kept, as the client's.
    expect(db.row("user", "u-max")).toMatchObject({ status: "ACTIVE", managerId: null });
    expect(db.tables.userDottedLine.map((d) => d.id)).toEqual(["d2"]);
    const said = audit().filter((a) => a.type === "reporting_line_changed").map((a) => a.description);
    expect(said).toEqual([
      "Reactivated Max Chen with no manager: the manager on their record doesn't work in this workspace",
      "Reactivated Max Chen without a dotted line to someone who doesn't work in this workspace",
    ]);
    expect(JSON.stringify(said)).not.toContain("Dana");
    // D16: the seat the one-time step ended with the account comes back with it, and its skills with it.
    expect(db.row("organizationMembership", "m-max-client")).toMatchObject({ status: "ACTIVE", endedWithAccount: false });
    expect(st.skillsBack).toEqual([["org1", ["u-max"]], ["client", ["u-max"]]]);
  });
});

// docs/plans/workspace-status.md D14 (step 4): this workspace's seat, for
// someone anchored here.
describe("SCIM reads and restores this workspace's seat (D14)", () => {
  it("answers active from the seat: an HR label is live, and active:true leaves it as it is", async () => {
    db.row("user", "u-max").status = "ON_LEAVE";
    // Before: active false, and a full PUT with active:true wrote ACTIVE over the label.
    expect((await (await GET(req("GET", "u-max"), params("u-max"))).json()).active).toBe(true);
    const res = await PUT(req("PUT", "u-max", { ...FULL, active: true }), params("u-max"));
    expect(res.status).toBe(200);
    expect(db.row("user", "u-max").status).toBe("ON_LEAVE");
  });

  it("never brings back a seat this workspace removed, writing nothing, the fields included", async () => {
    Object.assign(db.row("user", "u-max"), { status: "INACTIVE", deletedAt: new Date("2026-10-20T09:00:00Z") });
    const res = await PUT(req("PUT", "u-max", { ...FULL, active: true }), params("u-max"));
    // Before: 200, and ACTIVE written beside the removal.
    expect(res.status).toBe(409);
    expect((await res.json()).detail).toBe("This person was removed from this workspace in WorkwrK, so the identity provider can't bring them back. An Owner or Admin can restore them from the Directory's Removed view.");
    expect(db.row("user", "u-max")).toMatchObject({ status: "INACTIVE", email: "max@x.test" });
  });
});
