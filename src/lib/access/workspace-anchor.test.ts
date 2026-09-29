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

import { leavingIsPrimary, reanchorUser } from "./workspace-anchor";

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
