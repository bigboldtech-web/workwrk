// anyGuestHere: a Guest is read at the level held in THIS workspace, or from
// the stored org role of a person at home here; a person who cannot be read
// counts as one.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; organizationId: string; accessLevel: string; orgRole: string | null };

const st = vi.hoisted(() => ({ users: [] as Row[], memberships: [] as { userId: string; organizationId: string; role: string }[] }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: async (a: { where: { id: { in: string[] } } }) => st.users.filter((u) => a.where.id.in.includes(u.id)) },
    organizationMembership: {
      findMany: async (a: { where: { organizationId: string; userId: { in: string[] } } }) =>
        st.memberships.filter((m) => m.organizationId === a.where.organizationId && a.where.userId.in.includes(m.userId)),
    },
  },
}));

import { anyGuestHere } from "./guests";

const member = (id: string, extra: Partial<Row> = {}): Row => ({ id, organizationId: "org1", accessLevel: "EMPLOYEE", orgRole: null, ...extra });

beforeEach(() => {
  st.users = [];
  st.memberships = [];
});

describe("anyGuestHere", () => {
  it("finds no Guest among Members at home", async () => {
    st.users = [member("a"), member("b", { accessLevel: "MANAGER", orgRole: "MEMBER" })];
    expect(await anyGuestHere("org1", ["a", "b", "a"])).toBe(false);
  });

  it("counts a person the stored org role names a Guest, whatever their level", async () => {
    st.users = [member("a"), member("g", { orgRole: "GUEST" })];
    expect(await anyGuestHere("org1", ["a", "g"])).toBe(true);
  });

  it("ignores the stored org role of a person anchored in another workspace", async () => {
    st.users = [member("a"), member("v", { organizationId: "org2", orgRole: "GUEST" })];
    st.memberships = [{ userId: "v", organizationId: "org1", role: "EMPLOYEE" }];
    expect(await anyGuestHere("org1", ["a", "v"])).toBe(false);
  });

  it("counts a visitor with no membership here, and a person who cannot be read", async () => {
    st.users = [member("a"), member("v", { organizationId: "org2" })];
    expect(await anyGuestHere("org1", ["a", "v"])).toBe(true);
    expect(await anyGuestHere("org1", ["a", "gone"])).toBe(true);
  });

  it("asks nothing for nobody", async () => {
    expect(await anyGuestHere("org1", [])).toBe(false);
  });
});
