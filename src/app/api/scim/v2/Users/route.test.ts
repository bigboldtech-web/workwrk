// POST /api/scim/v2/Users (docs-found fixes batch 6, from the batch 5
// review). The uniqueness check looked only at the people anchored in the
// workspace, so a person who already works here through a membership
// (anchored in another workspace since they last switched) was given a
// second account with the same address: two sign-ins, their work split
// between them. Now that is the SCIM uniqueness 409 too.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  /** People by address: where they are anchored, and their memberships. */
  accounts: [] as Array<{ id: string; email: string; organizationId: string; memberships: string[] }>,
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/scim-auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/scim-auth")>()),
  authenticateScim: async () => ({ ok: true, organizationId: "org" }),
}));
vi.mock("@/lib/platform-admin", () => ({ isReservedStaffAddress: async () => false, STAFF_ADDRESS_REFUSAL: "staff" }));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));
vi.mock("@/lib/prisma", () => {
  const user = {
    findFirst: async (a: { where: { organizationId: string; email: string } }) =>
      st.accounts.find((u) => u.organizationId === a.where.organizationId && u.email === a.where.email) ?? null,
    // By address, and (GET, batch 7) by where each is anchored and their memberships.
    findMany: async (a: { where: { email?: string; organizationId?: string | { not: string }; organizationMemberships?: { some: { organizationId: string } } } }) =>
      st.accounts
        .filter((u) => a.where.email === undefined || u.email === a.where.email)
        .filter((u) => {
          const w = a.where.organizationId;
          return w === undefined || (typeof w === "string" ? u.organizationId === w : u.organizationId !== w.not);
        })
        .filter((u) => !a.where.organizationMemberships || u.memberships.includes(a.where.organizationMemberships.some.organizationId))
        .map((u) => ({ id: u.id, email: u.email, firstName: "Dana", lastName: "Ray", status: "ACTIVE", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") })),
    count: async (a: { where: { organizationId: string } }) => st.accounts.filter((u) => u.organizationId === a.where.organizationId).length,
    create: async (a: { data: Record<string, unknown> }) => {
      st.created.push(a.data);
      return { id: "new", email: a.data.email, firstName: a.data.firstName, lastName: a.data.lastName, status: a.data.status, createdAt: new Date(), updatedAt: new Date() };
    },
  };
  const organizationMembership = {
    findFirst: async (a: { where: { organizationId: string; userId: { in: string[] } } }) =>
      st.accounts.some((u) => a.where.userId.in.includes(u.id) && u.memberships.includes(a.where.organizationId)) ? { id: "m1" } : null,
  };
  return {
    prisma: {
      user,
      organizationMembership,
      organization: { findUnique: async () => ({ settings: {}, domain: null }) },
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ user }),
    },
  };
});

import { GET, POST } from "./route";

const post = (email: string) =>
  POST(new NextRequest("https://app.test/api/scim/v2/Users", {
    method: "POST",
    body: JSON.stringify({ userName: email, name: { givenName: "Dana", familyName: "Ray" }, active: true }),
  }));

beforeEach(() => {
  st.accounts = [];
  st.created = [];
});

describe("POST /api/scim/v2/Users", () => {
  it("refuses a second account for someone who works here through a membership", async () => {
    // Dana is anchored in the client workspace and works here too.
    st.accounts = [{ id: "dana", email: "dana@acme.test", organizationId: "client", memberships: ["org"] }];
    const res = await post("dana@acme.test");
    // Before: 201, and a second account for dana@acme.test anchored here.
    expect(res.status).toBe(409);
    expect((await res.json()).scimType).toBe("uniqueness");
    expect(st.created).toEqual([]);
  });

  it("still makes the account for an address that works elsewhere only", async () => {
    st.accounts = [{ id: "dana", email: "dana@acme.test", organizationId: "client", memberships: [] }];
    const res = await post("dana@acme.test");
    expect(res.status).toBe(201);
    expect(st.created).toHaveLength(1);
  });

  it("still refuses an address anchored here", async () => {
    st.accounts = [{ id: "dana", email: "dana@acme.test", organizationId: "org", memberships: [] }];
    expect((await post("dana@acme.test")).status).toBe(409);
  });
});

// Docs-found fixes batch 7, from the batch 6 review: POST answers 409 for
// someone who works here through a membership, but GET read only the people
// anchored here, so the identity provider could never find them to link,
// and so never deprovision them.
describe("GET /api/scim/v2/Users by userName", () => {
  const get = (filter?: string) => GET(new NextRequest(`https://app.test/api/scim/v2/Users${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`));

  it("finds someone who works here through a membership, as the lookup an identity provider links by", async () => {
    st.accounts = [{ id: "dana", email: "dana@acme.test", organizationId: "client", memberships: ["org"] }];
    const body = await (await get('userName eq "dana@acme.test"')).json();
    // Before: totalResults 0.
    expect(body.totalResults).toBe(1);
    expect(body.Resources.map((r: { id: string }) => r.id)).toEqual(["dana"]);
  });

  it("finds the account anchored here too, and nobody who only works elsewhere", async () => {
    st.accounts = [
      { id: "max", email: "max@acme.test", organizationId: "org", memberships: [] },
      { id: "fay", email: "fay@acme.test", organizationId: "client", memberships: [] },
    ];
    expect((await (await get('userName eq "max@acme.test"')).json()).totalResults).toBe(1);
    expect((await (await get('userName eq "fay@acme.test"')).json()).totalResults).toBe(0);
  });

  it("the unfiltered list stays the people anchored here", async () => {
    st.accounts = [
      { id: "max", email: "max@acme.test", organizationId: "org", memberships: [] },
      { id: "dana", email: "dana@acme.test", organizationId: "client", memberships: ["org"] },
    ];
    const body = await (await get()).json();
    expect(body.totalResults).toBe(1);
  });
});
