import { describe, expect, it, vi } from "vitest";

// reanchorUser keeps a way back to the workspace being left, as the level
// held there, and takes the target membership's own level.
const calls: Array<{ op: string; args: unknown }> = [];
let hasPrimary = false;
let anchored: { organizationId: string; accessLevel: string } | null = null;
const tx = {
  organizationMembership: {
    findFirst: async () => (hasPrimary ? { id: "m0" } : null),
    upsert: async (args: unknown) => { calls.push({ op: "upsert", args }); return {}; },
  },
  user: {
    findUnique: async () => anchored,
    update: async (args: unknown) => { calls.push({ op: "user.update", args }); return {}; },
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } }));

import { homesElsewhere, leavingIsPrimary, reanchorUser, type MembershipElsewhere } from "./workspace-anchor";

describe("reanchorUser", () => {
  it("keeps the workspace left as a primary membership at the level held there, and takes the target's level", async () => {
    calls.length = 0; hasPrimary = false; anchored = { organizationId: "home", accessLevel: "EMPLOYEE" };
    expect(await reanchorUser({ userId: "u", to: { organizationId: "mine", role: "COMPANY_ADMIN" } })).toBe(true);
    expect(calls[0]).toMatchObject({ op: "upsert", args: { create: { organizationId: "home", role: "EMPLOYEE", isPrimary: true }, update: { role: "EMPLOYEE" } } });
    expect(calls[1]).toMatchObject({ op: "user.update", args: { data: { organizationId: "mine", accessLevel: "COMPANY_ADMIN" } } });
  });

  it("never carries an Admin level into a workspace where the person is a Member", async () => {
    calls.length = 0; hasPrimary = true; anchored = { organizationId: "a", accessLevel: "COMPANY_ADMIN" };
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } });
    expect(calls[0]).toMatchObject({ args: { create: { role: "COMPANY_ADMIN", isPrimary: false } } });
    expect(calls[1]).toMatchObject({ args: { data: { organizationId: "b", accessLevel: "EMPLOYEE" } } });
  });

  it("does nothing when the person is already there", async () => {
    calls.length = 0; anchored = { organizationId: "a", accessLevel: "EMPLOYEE" };
    expect(await reanchorUser({ userId: "u", to: { organizationId: "a", role: "COMPANY_ADMIN" } })).toBe(false);
    expect(calls).toHaveLength(0);
    expect(leavingIsPrimary(false)).toBe(true);
    expect(leavingIsPrimary(true)).toBe(false);
  });
});

describe("homesElsewhere", () => {
  const m = (userId: string, organizationId: string, status: string, role: MembershipElsewhere["role"] = "EMPLOYEE"): MembershipElsewhere => ({ userId, organizationId, role, status });

  it("moves a person into a working workspace before a suspended or closed one, whatever the order", () => {
    const homes = homesElsewhere([m("u", "closed", "CANCELLED"), m("u", "held", "SUSPENDED"), m("u", "live", "ACTIVE", "MANAGER")]);
    expect(homes.get("u")).toEqual({ organizationId: "live", role: "MANAGER" });
  });

  it("keeps the order given within a status (primary first, then oldest)", () => {
    const homes = homesElsewhere([m("u", "first", "TRIAL"), m("u", "second", "ACTIVE")]);
    expect(homes.get("u")?.organizationId).toBe("first");
  });

  it("still keeps an account whose only other workspace is suspended or closed", () => {
    expect(homesElsewhere([m("u", "held", "SUSPENDED")]).get("u")?.organizationId).toBe("held");
    expect(homesElsewhere([m("v", "closed", "CANCELLED")]).get("v")?.organizationId).toBe("closed");
  });

  it("takes each person's own role there, and leaves out people with nowhere else", () => {
    const homes = homesElsewhere([m("a", "x", "ACTIVE", "COMPANY_ADMIN"), m("b", "x", "ACTIVE", "EMPLOYEE")]);
    expect(homes.get("a")?.role).toBe("COMPANY_ADMIN");
    expect(homes.get("b")?.role).toBe("EMPLOYEE");
    expect(homes.has("c")).toBe(false);
    expect(homesElsewhere([]).size).toBe(0);
  });
});
