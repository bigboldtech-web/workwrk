// SCIM 2.0 Users, one resource, for someone who works here through a
// membership, anchored in another workspace (docs-found fixes batch 7, from
// the batch 6 review). POST answered 409 for them (batch 6) while GET and the
// [id] routes read only people anchored here, so the identity provider could
// never find them, and so never deprovision them. Now they are SCIM targets
// for deprovisioning only: GET reads them, active:false and DELETE end their
// membership here (scimDeprovisionMember), and no other field is written,
// because their names, address and status are one row every workspace they
// belong to reads.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROW = {
  id: "u-dana",
  email: "dana@acme.test",
  firstName: "Dana",
  lastName: "Ray",
  status: "ACTIVE",
  deletedAt: null as Date | null,
  organizationId: "client",
  createdAt: new Date("2026-01-01T09:00:00Z"),
  updatedAt: new Date("2026-10-01T09:00:00Z"),
};

const st = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>>,
  /** Memberships here, by person. */
  memberHere: new Set<string>(),
  updates: [] as Array<Record<string, unknown>>,
  deprovisioned: [] as string[],
  memberDeprovisioned: [] as string[],
  /** formerMemberDeprovision's answer. */
  former: null as "pending" | "done" | null,
}));

vi.mock("@/lib/prisma", () => {
  type OrgWhere = string | { not?: string } | undefined;
  const orgOk = (w: OrgWhere, org: unknown) => w === undefined || (typeof w === "string" ? w === org : w.not === undefined || w.not !== org);
  const user = {
    findFirst: async (a: { where: { id: string; organizationId?: OrgWhere; deletedAt?: null } }) => {
      const r = st.rows[a.where.id];
      if (!r || !orgOk(a.where.organizationId, r.organizationId)) return null;
      if ("deletedAt" in a.where && r.deletedAt) return null;
      return { ...r };
    },
    findUnique: async (a: { where: { id: string } }) => (st.rows[a.where.id] ? { ...st.rows[a.where.id] } : null),
    update: async (a: { data: Record<string, unknown> }) => { st.updates.push(a.data); return {}; },
  };
  const organizationMembership = {
    findUnique: async (a: { where: { userId_organizationId: { userId: string; organizationId: string } } }) =>
      a.where.userId_organizationId.organizationId === "org1" && st.memberHere.has(a.where.userId_organizationId.userId) ? { id: "m1" } : null,
  };
  const consentRecord = { findFirst: async () => null };
  return { prisma: { user, organizationMembership, consentRecord, $transaction: async (fn: (tx: unknown) => unknown) => fn({ user }) } };
});
vi.mock("@/lib/scim-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scim-auth")>()),
  authenticateScim: async () => ({ ok: true, organizationId: "org1", workspaceInactive: false }),
}));
vi.mock("@/lib/scim-deprovision", () => ({
  scimDeprovision: async (_org: string, id: string) => { st.deprovisioned.push(id); return { ok: true, alreadyInactive: false, recipientId: null }; },
  scimDeprovisionMember: async (_org: string, id: string) => {
    st.memberDeprovisioned.push(id);
    st.memberHere.delete(id);
    return { ok: true, alreadyInactive: false, recipientId: "u-owner" };
  },
  formerMemberDeprovision: async () => st.former,
  scimReactivated: async () => undefined,
}));
vi.mock("@/lib/access/membership", () => ({ lockOrgRoles: async () => undefined, liveOwnerIds: async () => [] }));
vi.mock("@/lib/performance/review-cycle.server", () => ({ followReportingLine: async () => 0 }));
vi.mock("@/lib/platform-admin", () => ({ isReservedStaffAddress: async () => false, STAFF_ADDRESS_REFUSAL: "reserved" }));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));

import { DELETE, GET, PATCH, PUT } from "./route";

const params = (id = "u-dana") => ({ params: Promise.resolve({ id }) });
const url = (id = "u-dana") => `https://app.test/api/scim/v2/Users/${id}`;
const patch = (ops: unknown[], id = "u-dana") => PATCH(new NextRequest(url(id), { method: "PATCH", body: JSON.stringify({ Operations: ops }) }), params(id));
const put = (body: Record<string, unknown>) => PUT(new NextRequest(url(), { method: "PUT", body: JSON.stringify(body) }), params());

beforeEach(() => {
  st.rows = { "u-dana": { ...ROW } };
  st.memberHere = new Set(["u-dana"]);
  st.updates = [];
  st.deprovisioned = [];
  st.memberDeprovisioned = [];
  st.former = null;
});

describe("someone who works here through a membership, for the identity provider", () => {
  it("GET reads them as stored, and someone with no membership here is still not found", async () => {
    const res = await GET(new NextRequest(url()), params());
    // Before: 404, though POST answered 409 for the same address.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "u-dana", userName: "dana@acme.test", active: true });
    st.memberHere.clear();
    expect((await GET(new NextRequest(url()), params())).status).toBe(404);
  });

  it("active:false ends their membership here, never their account, and answers them inactive here", async () => {
    const res = await patch([{ op: "replace", path: "active", value: false }]);
    // Before: 404, so they could never be deprovisioned.
    expect(res.status).toBe(200);
    expect((await res.json()).active).toBe(false);
    expect(st.memberDeprovisioned).toEqual(["u-dana"]);
    expect(st.deprovisioned).toEqual([]);
    expect(st.updates).toEqual([]);
  });

  it("any other field is left as stored: their row is every workspace's", async () => {
    const res = await patch([{ op: "replace", path: "name.givenName", value: "Danielle" }, { op: "replace", path: "userName", value: "d@x.test" }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userName: "dana@acme.test", name: { givenName: "Dana" } });
    expect(st.updates).toEqual([]);
    expect(st.memberDeprovisioned).toEqual([]);
    // A full PUT with active:true writes nothing either.
    expect((await put({ userName: "d@x.test", name: { givenName: "Danielle", familyName: "Ray" }, active: true })).status).toBe(200);
    expect(st.updates).toEqual([]);
  });

  it("a PUT with active:false and DELETE deprovision them too", async () => {
    expect((await put({ userName: "dana@acme.test", name: { givenName: "Dana", familyName: "Ray" }, active: false })).status).toBe(200);
    st.memberHere.add("u-dana");
    const res = await DELETE(new NextRequest(url(), { method: "DELETE" }), params());
    expect(res.status).toBe(204);
    expect(st.memberDeprovisioned).toEqual(["u-dana", "u-dana"]);
  });

  it("a retried deprovision once the membership has ended still finds them; anything else does not", async () => {
    st.memberHere.clear();
    st.former = "pending";
    expect((await DELETE(new NextRequest(url(), { method: "DELETE" }), params())).status).toBe(204);
    expect((await patch([{ op: "replace", path: "active", value: false }])).status).toBe(200);
    expect(st.memberDeprovisioned).toEqual(["u-dana", "u-dana"]);
    expect((await GET(new NextRequest(url()), params())).status).toBe(404);
    expect((await patch([{ op: "replace", path: "name.givenName", value: "Danielle" }])).status).toBe(404);
    st.former = null;
    expect((await DELETE(new NextRequest(url(), { method: "DELETE" }), params())).status).toBe(404);
  });

  it("someone anchored here takes the anchored path, as before", async () => {
    st.rows["u-max"] = { ...ROW, id: "u-max", email: "max@acme.test", organizationId: "org1" };
    const res = await DELETE(new NextRequest(url("u-max"), { method: "DELETE" }), params("u-max"));
    expect(res.status).toBe(204);
    expect(st.deprovisioned).toEqual(["u-max"]);
    expect(st.memberDeprovisioned).toEqual([]);
  });
});
