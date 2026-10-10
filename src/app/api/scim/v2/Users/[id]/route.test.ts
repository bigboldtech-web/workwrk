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
  return { prisma: { user, consentRecord, $transaction: async (fn: (tx: unknown) => unknown) => fn({ user }) } };
});
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
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));

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
