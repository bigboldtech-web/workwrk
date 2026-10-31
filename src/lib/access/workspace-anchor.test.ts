import { describe, expect, it, vi } from "vitest";

// reanchorUser keeps a way back to the workspace being left, as the level
// held there, and takes the target membership's own level.
const calls: Array<{ op: string; args: unknown }> = [];
let hasPrimary = false;
let anchored: { organizationId: string; accessLevel: string; adminScopes?: string[] } | null = null;
let targetScopes: string[] | null = null;
const tx = {
  organizationMembership: {
    findFirst: async () => (hasPrimary ? { id: "m0" } : null),
    findUnique: async () => (targetScopes ? { adminScopes: targetScopes } : null),
    upsert: async (args: unknown) => { calls.push({ op: "upsert", args }); return {}; },
  },
  user: {
    findUnique: async () => anchored,
    update: async (args: unknown) => { calls.push({ op: "user.update", args }); return {}; },
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } }));

import { AccountCannotMove, homesElsewhere, leavingIsPrimary, moveHomesOutOf, reanchorUser, type MembershipElsewhere } from "./workspace-anchor";

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

  it("keeps the Admin scopes with the workspace that granted them", async () => {
    calls.length = 0; hasPrimary = true; targetScopes = null;
    anchored = { organizationId: "a", accessLevel: "COMPANY_ADMIN", adminScopes: ["billing", "security"] };
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "COMPANY_ADMIN" } });
    expect(calls[0]).toMatchObject({ op: "upsert", args: { create: { organizationId: "a", adminScopes: ["billing", "security"] }, update: { adminScopes: ["billing", "security"] } } });
    expect(calls[1]).toMatchObject({ op: "user.update", args: { data: { organizationId: "b", adminScopes: [] } } });
    // Coming back takes the ones kept there.
    calls.length = 0; targetScopes = ["billing"];
    anchored = { organizationId: "b", accessLevel: "COMPANY_ADMIN", adminScopes: [] };
    await reanchorUser({ userId: "u", to: { organizationId: "a", role: "COMPANY_ADMIN" } });
    expect(calls[1]).toMatchObject({ op: "user.update", args: { data: { organizationId: "a", adminScopes: ["billing"] } } });
    targetScopes = null;
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

describe("moveHomesOutOf", () => {
  // A fake transaction: memberships elsewhere, accounts already anchored in
  // those workspaces, and the moves reanchorUser makes.
  const fakeTx = (memberships: Array<{ userId: string; organizationId: string; role: string; status: string; email: string }>, existing: Array<{ organizationId: string; email: string }>) => {
    const moves: Array<{ userId: string; to: string; role: string }> = [];
    const anchors = new Map<string, string>(memberships.map((m) => [m.userId, "doomed"]));
    const tx = {
      organizationMembership: {
        findMany: async () => memberships.map((m) => ({ userId: m.userId, organizationId: m.organizationId, role: m.role, organization: { status: m.status }, user: { email: m.email } })),
        findFirst: async () => null,
        findUnique: async () => null,
        upsert: async () => ({}),
      },
      user: {
        findMany: async ({ where }: { where: { OR: Array<{ organizationId: string; email: string }> } }) =>
          existing.filter((e) => where.OR.some((w) => w.organizationId === e.organizationId && w.email === e.email)),
        findUnique: async ({ where }: { where: { id: string } }) => ({ organizationId: anchors.get(where.id) ?? "doomed", accessLevel: "EMPLOYEE", adminScopes: [] }),
        update: async ({ where, data }: { where: { id: string }; data: { organizationId: string; accessLevel: string } }) => {
          moves.push({ userId: where.id, to: data.organizationId, role: data.accessLevel });
          anchors.set(where.id, data.organizationId);
          return {};
        },
      },
    };
    return { tx: tx as never, moves };
  };

  it("passes over a workspace that already has an account with the same email, to the next one", async () => {
    const { tx, moves } = fakeTx(
      [
        { userId: "p", organizationId: "taken", role: "COMPANY_ADMIN", status: "ACTIVE", email: "pat@x.test" },
        { userId: "p", organizationId: "free", role: "EMPLOYEE", status: "SUSPENDED", email: "pat@x.test" },
      ],
      [{ organizationId: "taken", email: "pat@x.test" }],
    );
    expect(await moveHomesOutOf("doomed", tx)).toBe(1);
    expect(moves).toEqual([{ userId: "p", to: "free", role: "EMPLOYEE" }]);
  });

  it("keeps the company, moving nobody, when someone can move into none of their workspaces", async () => {
    const { tx, moves } = fakeTx(
      [
        { userId: "p", organizationId: "taken", role: "EMPLOYEE", status: "ACTIVE", email: "pat@x.test" },
        { userId: "q", organizationId: "free", role: "EMPLOYEE", status: "ACTIVE", email: "quin@x.test" },
      ],
      [{ organizationId: "taken", email: "pat@x.test" }],
    );
    await expect(moveHomesOutOf("doomed", tx)).rejects.toBeInstanceOf(AccountCannotMove);
    expect(moves).toEqual([]);
  });

  it("moves nobody when nobody belongs elsewhere", async () => {
    const { tx, moves } = fakeTx([], []);
    expect(await moveHomesOutOf("doomed", tx)).toBe(0);
    expect(moves).toEqual([]);
  });
});
