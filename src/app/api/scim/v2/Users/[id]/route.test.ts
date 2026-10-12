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

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const ERASED_ROW = {
  id: "u-gone",
  email: "deleted-u-gone@workwrk.anon",
  firstName: "Deleted",
  lastName: "User",
  status: "INACTIVE",
  deletedAt: new Date("2026-10-01T09:00:00Z"),
  createdAt: new Date("2026-01-01T09:00:00Z"),
  updatedAt: new Date("2026-10-01T09:00:00Z"),
};
const LIVE_ROW = { ...ERASED_ROW, id: "u-max", email: "max@x.test", firstName: "Max", lastName: "Chen", status: "ACTIVE", deletedAt: null };

const st = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>>,
  /** The withdrawnAt of each userId's newest erasure provenance record. */
  erased: new Map<string, Date>(),
  consentWhere: [] as unknown[],
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  deprovisioned: [] as string[],
  // Docs-found fixes batch 5: a reactivation's lines and locks.
  dotted: [] as string[],
  dottedDeleted: [] as string[][],
  audit: [] as Array<Record<string, unknown>>,
  locks: [] as string[],
  followed: [] as Array<{ ids: string[]; actor: string }>,
  rolesBusy: false,
  seatsBusy: false,
  /** Memberships in other workspaces, by person, with their role there (batch 6). */
  elsewhere: {} as Record<string, Record<string, string>>,
}));

vi.mock("@/lib/prisma", () => {
  const user = {
    findFirst: async (a: { where: { id: string } }) => (st.rows[a.where.id] ? { ...st.rows[a.where.id] } : null),
    findUnique: async (a: { where: { id: string } }) => (st.rows[a.where.id] ? { ...st.rows[a.where.id] } : null),
    update: async (a: { where: { id: string }; data: Record<string, unknown> }) => {
      st.updates.push({ id: a.where.id, data: { ...a.data } });
      Object.assign(st.rows[a.where.id], a.data);
      return { ...st.rows[a.where.id] };
    },
  };
  const consentRecord = {
    findFirst: async (a: { where: { userId: string; method: string; withdrawnAt: unknown } }) => {
      st.consentWhere.push(a.where);
      const real = a.where.method === "erasure" && JSON.stringify(a.where.withdrawnAt) === JSON.stringify({ not: null });
      const at = st.erased.get(a.where.userId);
      return real && at ? { id: "c1", withdrawnAt: at } : null;
    },
  };
  Object.assign(user, {
    findMany: async (a: { where: { id: { in: string[] } } }) => a.where.id.in.filter((id) => st.rows[id]).map((id) => ({ ...st.rows[id] })),
  });
  const userDottedLine = {
    findMany: async () => st.dotted.map((managerId) => ({ managerId })),
    deleteMany: async (a: { where: { managerId: { in: string[] } } }) => { st.dottedDeleted.push(a.where.managerId.in); return { count: a.where.managerId.in.length }; },
  };
  // Memberships in other workspaces only (batch 6): none here.
  const organizationMembership = {
    findUnique: async () => null,
    findMany: async (a: { where: { userId: { in: string[] }; organizationId?: string | { not?: string; in?: string[] } } }) => {
      const w = a.where.organizationId;
      if (!w || typeof w !== "object") return [];
      return a.where.userId.in.flatMap((userId) =>
        Object.entries(st.elsewhere[userId] ?? {})
          .filter(([org]) => (w.not === undefined || org !== w.not) && (w.in === undefined || w.in.includes(org)))
          .map(([organizationId, role]) => ({ userId, organizationId, role })),
      );
    },
  };
  const activityLog = { create: async (a: { data: Record<string, unknown> }) => { st.audit.push(a.data); return {}; } };
  const tx = { user, userDottedLine, organizationMembership };
  return { prisma: { user, consentRecord, userDottedLine, organizationMembership, activityLog, $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } };
});
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

import { GET, PATCH, PUT } from "./route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, id: string, body?: unknown) =>
  new NextRequest(`https://app.test/api/scim/v2/Users/${id}`, { method, headers: { "content-type": "application/scim+json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

const FULL = {
  userName: "max.real@x.test",
  name: { givenName: "Max", familyName: "Chen" },
  emails: [{ value: "max.real@x.test", primary: true }],
};

beforeEach(() => {
  st.rows = { "u-gone": { ...ERASED_ROW }, "u-max": { ...LIVE_ROW } };
  st.erased = new Map([["u-gone", ERASED_ROW.deletedAt]]);
  st.consentWhere = [];
  st.updates = [];
  st.deprovisioned = [];
  st.dotted = [];
  st.dottedDeleted = [];
  st.audit = [];
  st.elsewhere = {};
  st.locks = [];
  st.followed = [];
  st.rolesBusy = false;
  st.seatsBusy = false;
});

describe("an erased account is gone for the identity provider", () => {
  it("PUT never writes the real address and names back, and active:true never brings it back", async () => {
    for (const body of [{ ...FULL, active: true }, FULL, { active: true }]) {
      const res = await PUT(req("PUT", "u-gone", body), params("u-gone"));
      // Before: 200, and the row held max.real@x.test, "Max Chen", ACTIVE.
      expect(res.status).toBe(404);
      expect((await res.json()).detail).toBe("User not found");
    }
    expect(st.updates).toEqual([]);
    expect(st.rows["u-gone"]).toMatchObject({ email: "deleted-u-gone@workwrk.anon", firstName: "Deleted", lastName: "User", status: "INACTIVE" });
    // Recognised by the erasure's provenance record: method "erasure" with withdrawnAt set.
    expect(st.consentWhere[0]).toEqual({ userId: "u-gone", method: "erasure", withdrawnAt: { not: null } });
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
    expect(st.updates).toEqual([]);
    expect(st.rows["u-gone"]).toMatchObject({ email: "deleted-u-gone@workwrk.anon", firstName: "Deleted", status: "INACTIVE" });
  });

  it("a deprovision still answers success, with every other field dropped", async () => {
    const put = await PUT(req("PUT", "u-gone", { ...FULL, active: false }), params("u-gone"));
    expect(put.status).toBe(200);
    const patch = await PATCH(req("PATCH", "u-gone", { Operations: [{ op: "replace", value: { active: false, name: { givenName: "Max" } } }] }), params("u-gone"));
    expect(patch.status).toBe(200);
    expect(st.deprovisioned).toEqual(["u-gone", "u-gone"]);
    // Nothing of the push lands on the row.
    for (const u of st.updates) expect(u.data).toEqual({});
    expect(st.rows["u-gone"]).toMatchObject({ email: "deleted-u-gone@workwrk.anon", firstName: "Deleted", lastName: "User" });
    expect((await put.json()).userName).toBe("deleted-u-gone@workwrk.anon");
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
    expect(st.rows["u-max"]).toMatchObject({ email: "max.real@x.test", firstName: "Max", lastName: "Chen", status: "ACTIVE", emailVerifiedAt: null });
  });

  it("PATCH renames it and GET reads it", async () => {
    const res = await PATCH(req("PATCH", "u-max", { Operations: [{ op: "replace", path: "name.givenName", value: "Maxine" }] }), params("u-max"));
    expect(res.status).toBe(200);
    expect(st.rows["u-max"].firstName).toBe("Maxine");
    const got = await GET(req("GET", "u-max"), params("u-max"));
    expect(got.status).toBe(200);
    expect((await got.json()).name.givenName).toBe("Maxine");
  });

  it("an account an Admin removed, with no erasure of its own, is still renamed as before", async () => {
    // Deleted, but no provenance record: not an erasure.
    st.erased = new Map();
    const res = await PUT(req("PUT", "u-gone", FULL), params("u-gone"));
    expect(res.status).toBe(200);
    expect(st.rows["u-gone"].email).toBe("max.real@x.test");
  });
});

describe("an erased account no longer in the state its erasure left it is an ordinary account", () => {
  it("one an Admin restored before round 8 is read and renamed as anyone is", async () => {
    Object.assign(st.rows["u-gone"], { deletedAt: null, status: "ACTIVE" });
    const res = await PUT(req("PUT", "u-gone", FULL), params("u-gone"));
    // Before: 404, any erasure record refused it.
    expect(res.status).toBe(200);
    expect(st.rows["u-gone"]).toMatchObject({ email: "max.real@x.test", firstName: "Max", lastName: "Chen" });
    const got = await GET(req("GET", "u-gone"), params("u-gone"));
    expect(got.status).toBe(200);
  });

  it("one an Admin removed after such a restore is renamed as anyone is", async () => {
    st.rows["u-gone"].deletedAt = new Date("2026-10-20T09:00:00Z");
    const res = await PATCH(req("PATCH", "u-gone", { Operations: [{ op: "replace", path: "name.givenName", value: "Max" }] }), params("u-gone"));
    // Before: 404.
    expect(res.status).toBe(200);
    expect(st.rows["u-gone"].firstName).toBe("Max");
  });

  it("goes by the minute's edge: 60 seconds from the erasure is refused, 60.001 seconds from it is not", async () => {
    const erasedAt = ERASED_ROW.deletedAt.getTime();
    st.rows["u-gone"].deletedAt = new Date(erasedAt + 60_000);
    expect((await PUT(req("PUT", "u-gone", FULL), params("u-gone"))).status).toBe(404);
    expect(st.updates).toEqual([]);
    st.rows["u-gone"].deletedAt = new Date(erasedAt + 60_001);
    // Before: 404.
    expect((await PUT(req("PUT", "u-gone", FULL), params("u-gone"))).status).toBe(200);
  });
});

// Docs-found fixes batch 5: a reactivation from the identity provider
// checked no lines, so the person came back under a manager who had left or
// been deactivated meanwhile, or an Agent from before rule 6, and the seat
// wait had no bound.
describe("SCIM reactivation re-checks the person's lines, as a restore does", () => {
  const OFF = { ...LIVE_ROW, organizationId: "org1", status: "INACTIVE", managerId: "u-dana" };
  const manager = (extra: Record<string, unknown> = {}) => ({ id: "u-dana", organizationId: "org1", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray", ...extra });

  it("comes back with no manager when the manager was deactivated, logged as the identity provider", async () => {
    st.rows = { "u-max": { ...OFF }, "u-dana": manager({ status: "INACTIVE" }) };
    st.erased = new Map();
    const res = await PATCH(req("PATCH", "u-max", { Operations: [{ op: "replace", path: "active", value: true }] }), params("u-max"));
    expect(res.status).toBe(200);
    // Before: { status: "ACTIVE" } alone.
    expect(st.updates[0].data).toEqual({ status: "ACTIVE", managerId: null });
    expect(st.audit[0]).toMatchObject({
      type: "reporting_line_changed",
      actorType: "scim",
      description: "Reactivated Max Chen with no manager: Dana Ray is deactivated",
      oldValue: { managerId: "u-dana" },
    });
    // Open reviews follow, to the first Owner when no person acted.
    expect(st.followed).toEqual([{ ids: ["u-max"], actor: "u-owner" }]);
    expect(st.locks).toEqual(["roles", "seats-bounded"]);
  });

  it("keeps a live manager, and takes off a dotted line to an Agent (PUT too)", async () => {
    st.rows = { "u-max": { ...OFF }, "u-dana": manager(), "u-sam": manager({ id: "u-sam", ...legacyLevelRow("AGENT"), firstName: "Sam", lastName: "Agent" }) };
    st.erased = new Map();
    st.dotted = ["u-sam"];
    const res = await PUT(req("PUT", "u-max", { active: true }), params("u-max"));
    expect(res.status).toBe(200);
    expect(st.updates[0].data).toEqual({ status: "ACTIVE" });
    expect(st.dottedDeleted).toEqual([["u-sam"]]);
    expect(st.followed).toEqual([]);
  });

  it("answers 503 when the role lock or the seat lock is busy, never a 500, and writes nothing", async () => {
    st.rows = { "u-max": { ...OFF }, "u-dana": manager() };
    st.erased = new Map();
    st.seatsBusy = true;
    const res = await PATCH(req("PATCH", "u-max", { Operations: [{ op: "replace", path: "active", value: true }] }), params("u-max"));
    expect(res.status).toBe(503);
    expect(st.updates).toEqual([]);
    st.seatsBusy = false;
    st.rolesBusy = true;
    const again = await PUT(req("PUT", "u-max", { active: true }), params("u-max"));
    expect(again.status).toBe(503);
    expect(st.updates).toEqual([]);
  });
});

// Docs-found fixes batch 6, from the batch 5 review: the identity provider's
// reactivation deleted a manager line and a dotted line that belong to the
// person's other workspace, saying "is no longer in the workspace".
describe("SCIM reactivation keeps the lines another workspace relies on", () => {
  const OFF = { ...LIVE_ROW, organizationId: "org1", status: "INACTIVE", managerId: "u-dana" };
  it("keeps a manager and a dotted manager who work with the person in the other workspace only", async () => {
    st.rows = {
      "u-max": { ...OFF },
      "u-dana": { id: "u-dana", organizationId: "client", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null, firstName: "Dana", lastName: "Ray" },
    };
    st.erased = new Map();
    st.dotted = ["u-dana"];
    st.elsewhere = { "u-max": { client: "EMPLOYEE" } };
    const res = await PATCH(req("PATCH", "u-max", { Operations: [{ op: "replace", path: "active", value: true }] }), params("u-max"));
    expect(res.status).toBe(200);
    // Before: { status: "ACTIVE", managerId: null }, the dotted line deleted,
    // and "Dana Ray is no longer in the workspace" in the Audit log.
    expect(st.updates[0].data).toEqual({ status: "ACTIVE" });
    expect(st.dottedDeleted).toEqual([]);
    expect(st.audit.filter((a) => a.type === "reporting_line_changed")).toEqual([]);
  });
});
