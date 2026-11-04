// SCIM speaks for this workspace's seat only (docs/plans/workspace-status.md
// D14), on the in-memory database with the real seat reads and restoreSeat:
//   - every resource answers `active` from the seat here, never the
//     account's status (the anchored workspace's), an HR label live;
//   - POST for an address whose seat here was ended brings that seat back
//     (the SCIM token is an Admin-level actor) under the seat check, rather
//     than make a second account; a live seat here is still the 409;
//   - for someone here through a membership, active:false deactivates that
//     membership (never deleted, D8), active:true brings it back, and
//     nothing about their account or their other workspaces changes.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ skillsBack: [] as Array<[string, readonly string[]]>, handovers: [] as Array<Record<string, unknown>>, inactive: false }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/scim-auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/scim-auth")>()),
  authenticateScim: async () => ({ ok: true, organizationId: "b", workspaceInactive: st.inactive }),
}));
vi.mock("@/lib/platform-admin", () => ({ isReservedStaffAddress: async () => false, STAFF_ADDRESS_REFUSAL: "staff" }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async (org: string, ids: readonly string[]) => void st.skillsBack.push([org, ids]) }));
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
// The review follow is the real one (the step 4 review L1: the open reviews move with the cleared line, in its transaction); its audit row is recorded.
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined, logAuditEvent: async () => undefined }));
// The handover after a deprovision moves work; it is handover.server.test.ts's. Recorded here.
vi.mock("@/lib/people/handover.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/people/handover.server")>()),
  runHandover: async (input: Record<string, unknown>) => {
    st.handovers.push(input);
    return { tasksReassigned: 0, reportsReassigned: 0, containersReassigned: 0, reportsRehomed: [], reportsStaying: [], reportsAtAccountEnd: [], reportsAlsoElsewhere: [] };
  },
}));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { GET as list, POST } from "./route";
import { GET, PATCH, PUT } from "./[id]/route";

const person = (id: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  db.seed("user", { id, email: `${id}@acme.test`, firstName: id, lastName: "Ray", organizationId, ...legacyLevelRow("EMPLOYEE"), createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), ...extra });
const seat = (userId: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role: "EMPLOYEE", createdAt: new Date("2026-02-01"), ...extra });
const post = (email: string, active = true) =>
  POST(new NextRequest("https://app.test/api/scim/v2/Users", { method: "POST", body: JSON.stringify({ userName: email, name: { givenName: "Dana", familyName: "Ray" }, active }) }));
const byName = async (email: string) => (await (await list(new NextRequest(`https://app.test/api/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`))).json()) as { totalResults: number; Resources: Array<{ id: string; active: boolean }> };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, ops: unknown[]) => PATCH(new NextRequest(`https://app.test/api/scim/v2/Users/${id}`, { method: "PATCH", body: JSON.stringify({ Operations: ops }) }), params(id));

beforeEach(() => {
  db.reset();
  st.skillsBack = [];
  st.handovers = [];
  // The open invitations' count (seats.ts): none.
  db.onQueryRaw = () => [{ n: 0 }];
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", plan: "STARTER", settings: {}, domain: null });
  // B's Owner, who takes handed over work.
  person("owner", "b", { ...legacyLevelRow("SUPER_ADMIN"), email: "owner@acme.test" });
  // Dana is anchored in A and works in B through a membership.
  person("dana", "a");
  seat("dana", "b");
});

describe("`active` is the seat here (D14)", () => {
  it("answers a member here inactive once this workspace ended their membership, their account live in A", async () => {
    expect((await byName("dana@acme.test")).Resources).toEqual([expect.objectContaining({ id: "dana", active: true })]);
    db.row("organizationMembership", "m-dana-b").status = "INACTIVE";
    // Before: active true, the account being live in A.
    expect((await byName("dana@acme.test")).Resources).toEqual([expect.objectContaining({ id: "dana", active: false })]);
    expect((await (await GET(new NextRequest("https://app.test/x"), params("dana"))).json()).active).toBe(false);
  });

  it("answers a member here active whatever their account's state in A, and someone on leave here active", async () => {
    db.row("user", "dana").status = "INACTIVE";
    // Before: active false, and with A's removal the filter did not find her at all.
    expect((await byName("dana@acme.test")).Resources).toEqual([expect.objectContaining({ id: "dana", active: true })]);
    person("lee", "b", { status: "ON_LEAVE" });
    expect((await byName("lee@acme.test")).Resources).toEqual([expect.objectContaining({ id: "lee", active: true })]);
  });
});

describe("POST brings back a seat this workspace ended, never a second account (D14)", () => {
  it("revives a deactivated membership here at its level, under the seat check", async () => {
    db.row("organizationMembership", "m-dana-b").status = "INACTIVE";
    const res = await post("dana@acme.test");
    // Before: 409, and with the membership deleted by the old deprovision, a second account.
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "dana", active: true });
    expect(db.row("organizationMembership", "m-dana-b")).toMatchObject({ status: "ACTIVE", removedAt: null, role: "EMPLOYEE" });
    expect(db.tables.user.filter((u) => u.email === "dana@acme.test")).toHaveLength(1);
    expect(db.row("user", "dana").organizationId).toBe("a");
    expect(st.skillsBack).toEqual([["b", ["dana"]]]);
  });

  // The step 4 review M1: a removal is a decision no push from the identity
  // provider undoes, a POST included, as PATCH and PUT active:true refuse it.
  // Before: 201, and a removed seat came back at the level it held, an
  // Owner's included.
  it("refuses a seat this workspace removed, writing nothing", async () => {
    Object.assign(db.row("organizationMembership", "m-dana-b"), { status: "INACTIVE", removedAt: new Date("2026-10-01"), role: "SUPER_ADMIN" });
    const res = await post("dana@acme.test");
    expect(res.status).toBe(409);
    expect((await res.json()).detail).toBe("This person was removed from this workspace in WorkwrK, so the identity provider can't bring them back. An Owner or Admin can restore them from the Directory's Removed view.");
    expect(db.row("organizationMembership", "m-dana-b")).toMatchObject({ status: "INACTIVE", role: "SUPER_ADMIN" });
    expect(db.row("organizationMembership", "m-dana-b").removedAt).toBeInstanceOf(Date);
  });

  it("revives a deactivated seat and moves the account here when it is ended where it is anchored (D6)", async () => {
    db.row("organizationMembership", "m-dana-b").status = "INACTIVE";
    Object.assign(db.row("user", "dana"), { status: "INACTIVE" });
    expect((await post("dana@acme.test")).status).toBe(201);
    expect(db.row("user", "dana")).toMatchObject({ organizationId: "b", status: "ACTIVE", deletedAt: null });
  });

  it("is still the 409 for a live seat here, and for an ended one provisioned as inactive", async () => {
    expect((await post("dana@acme.test")).status).toBe(409);
    db.row("organizationMembership", "m-dana-b").status = "INACTIVE";
    expect((await post("dana@acme.test", false)).status).toBe(409);
    expect(db.row("organizationMembership", "m-dana-b").status).toBe("INACTIVE");
  });

  it("refuses a revive past the seats, writing nothing", async () => {
    db.row("organizationMembership", "m-dana-b").status = "INACTIVE";
    for (let i = 0; i < 9; i += 1) person(`p${i}`, "b");
    const res = await post("dana@acme.test");
    expect(res.status).toBe(403);
    expect(db.row("organizationMembership", "m-dana-b").status).toBe("INACTIVE");
  });
});

describe("the member's seat here, through the resource (D14)", () => {
  it("active:false deactivates the membership, keeps the row and the account, and active:true brings it back", async () => {
    const off = await patch("dana", [{ op: "replace", path: "active", value: false }]);
    expect(off.status).toBe(200);
    expect((await off.json()).active).toBe(false);
    // Before: the membership deleted, and Dana's tokenVersion bumped (signed out of A).
    expect(db.row("organizationMembership", "m-dana-b")).toMatchObject({ status: "INACTIVE", removedAt: null });
    expect(db.row("user", "dana")).toMatchObject({ organizationId: "a", status: "ACTIVE", tokenVersion: 0 });
    // This workspace's handover, as every one is since workspace-status-2 step 4 (E6).
    expect(st.handovers[0]).toMatchObject({ fromId: "dana" });
    expect(st.handovers[0]).not.toHaveProperty("leavesOnlyHere");
    const on = await PUT(new NextRequest("https://app.test/x", { method: "PUT", body: JSON.stringify({ userName: "other@x.test", name: { givenName: "Other", familyName: "Name" }, active: true }) }), params("dana"));
    // Before: answered as stored, nothing brought back.
    expect(on.status).toBe(200);
    expect((await on.json()).active).toBe(true);
    expect(db.row("organizationMembership", "m-dana-b").status).toBe("ACTIVE");
    // Their names and address are not this workspace's to write.
    expect(db.row("user", "dana")).toMatchObject({ email: "dana@acme.test", firstName: "dana" });
  });

  it("active:true never brings back a membership this workspace removed", async () => {
    Object.assign(db.row("organizationMembership", "m-dana-b"), { status: "INACTIVE", removedAt: new Date("2026-10-01") });
    const res = await patch("dana", [{ op: "replace", path: "active", value: true }]);
    expect(res.status).toBe(409);
    expect(db.row("organizationMembership", "m-dana-b").removedAt).toBeInstanceOf(Date);
  });
});

// The step 4 review L1, L2, L3 and T2: POST and PUT/PATCH active:true share
// one way back (src/lib/scim-reactivate.ts), so a stale line is cleared, its
// audit row written and its open reviews moved only once the seat is back,
// in the same transaction; a closed workspace takes nobody back; and the
// anchored door after a real D3 move answers as for a member.
describe("one way back for a deactivated seat, whichever door (step 4 review)", () => {
  /**
   * Dana reports to Mo in B, and Mo left B; she has an open review with him.
   * Her line in B is her membership's (workspace-status-2.md E1); her
   * account's line is A's, to Amy, and B never touches it (step 4: before,
   * B's reactivation read and cleared the account's line).
   */
  const staleLine = () => {
    person("mo", "b", { status: "INACTIVE", firstName: "Mo", lastName: "Gone" });
    person("amy", "a", { firstName: "Amy", lastName: "Ash" });
    db.row("organizationMembership", "m-dana-b").managerId = "mo";
    db.row("user", "dana").managerId = "amy";
    db.seed("reviewCycle", { id: "rc1", organizationId: "b", status: "ACTIVE" });
    db.seed("review", { id: "rv1", cycleId: "rc1", subjectId: "dana", reviewerId: "mo", status: "PENDING" });
    db.row("organizationMembership", "m-dana-b").status = "INACTIVE";
  };
  const lineRows = () => (db.tables.activityLog ?? []).filter((r) => r.type === "reporting_line_changed");

  for (const [door, bringBack] of [
    ["POST", () => post("dana@acme.test")],
    ["PATCH", () => patch("dana", [{ op: "replace", path: "active", value: true }])],
  ] as const) {
    it(`${door} clears a line that no longer holds, logs it and moves its open review, with the seat`, async () => {
      staleLine();
      expect((await bringBack()).status).toBe(door === "POST" ? 201 : 200);
      expect(db.row("organizationMembership", "m-dana-b").status).toBe("ACTIVE");
      expect(db.row("organizationMembership", "m-dana-b").managerId).toBeNull();
      expect(db.row("user", "dana").managerId).toBe("amy");
      // Before (POST): the line cleared with no row, and the review left with Mo.
      expect(lineRows()).toHaveLength(1);
      expect(lineRows()[0]).toMatchObject({ actorType: "scim", targetId: "dana", oldValue: { managerId: "mo" } });
      expect(db.row("review", "rv1").reviewerId).toBe("owner");
    });
  }

  it("leaves everything as it was when the seat is live already (not_ended)", async () => {
    staleLine();
    db.row("organizationMembership", "m-dana-b").status = "ACTIVE";
    const { scimReactivateSeat } = await import("@/lib/scim-reactivate");
    expect(await scimReactivateSeat("b", "dana")).toMatchObject({ ok: true, restored: false });
    // Before (PATCH): the line cleared and kept, unlogged.
    expect(db.row("organizationMembership", "m-dana-b").managerId).toBe("mo");
    expect(db.row("user", "dana").managerId).toBe("amy");
    expect(lineRows()).toEqual([]);
    expect(db.row("review", "rv1").reviewerId).toBe("mo");
  });

  it("takes nobody back in a suspended or cancelled workspace, by either door", async () => {
    db.row("organizationMembership", "m-dana-b").status = "INACTIVE";
    st.inactive = true;
    // Before: PATCH active:true on a member reactivated them there.
    expect((await patch("dana", [{ op: "replace", path: "active", value: true }])).status).toBe(403);
    st.inactive = false;
    db.row("organization", "b").status = "SUSPENDED";
    const { scimReactivateSeat } = await import("@/lib/scim-reactivate");
    expect(await scimReactivateSeat("b", "dana")).toMatchObject({ ok: false, status: 403 });
    expect(db.row("organizationMembership", "m-dana-b").status).toBe("INACTIVE");
    db.row("organization", "b").status = "ACTIVE";
  });

  it("the anchored door, after a real D3 move, answers as for a member and writes none of the push's fields", async () => {
    // Max is anchored in B and also works in A, so B's deprovision moves him there.
    person("max", "b", { firstName: "Max" });
    seat("max", "a", { role: "MANAGER" });
    const res = await PUT(new NextRequest("https://app.test/x", { method: "PUT", body: JSON.stringify({ userName: "other@x.test", name: { givenName: "Other", familyName: "Name" }, active: false }) }), params("max"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "max", active: false, userName: "max@acme.test" });
    expect(db.row("user", "max")).toMatchObject({ organizationId: "a", status: "ACTIVE", firstName: "Max", email: "max@acme.test", tokenVersion: 0 });
    expect(db.tables.organizationMembership.find((m) => m.userId === "max" && m.organizationId === "b")).toMatchObject({ status: "INACTIVE", removedAt: null });
  });
});
