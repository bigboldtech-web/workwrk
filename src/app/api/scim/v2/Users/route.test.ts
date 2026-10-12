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
    findMany: async (a: { where: { email: string } }) => st.accounts.filter((u) => u.email === a.where.email).map((u) => ({ id: u.id })),
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

import { POST } from "./route";

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
