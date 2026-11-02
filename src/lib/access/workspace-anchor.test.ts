import { beforeEach, describe, expect, it, vi } from "vitest";

// reanchorUser keeps a way back to the workspace being left, as the level
// held there, and takes the target membership's own level.
const calls: Array<{ op: string; args: unknown }> = [];
let hasPrimary = false;
let anchored: { organizationId: string; accessLevel: string; adminScopes?: string[]; status?: string; deletedAt?: Date | null; email?: string } | null = null;
let targetScopes: string[] | null = null;
/** The target membership's seat (docs/plans/workspace-status.md D1), or null for no row there. */
let targetSeat: { status: string; removedAt: Date | null } | null = null;
/** The newest erasure record's withdrawnAt (src/lib/compliance/erased-account.ts), or null. */
let erasedAt: Date | null = null;
// Every read is logged too (step 1 review L3), so a test can prove the lock
// comes before them.
const tx = {
  organizationMembership: {
    findFirst: async () => { calls.push({ op: "read:membership.findFirst", args: null }); return hasPrimary ? { id: "m0" } : null; },
    findUnique: async () => {
      calls.push({ op: "read:membership.findUnique", args: null });
      return targetScopes || targetSeat ? { adminScopes: targetScopes ?? [], ...(targetSeat ?? {}) } : null;
    },
    upsert: async (args: unknown) => { calls.push({ op: "upsert", args }); return {}; },
  },
  user: {
    findUnique: async (args: { select?: Record<string, boolean> }) => {
      calls.push({ op: "read:user.findUnique", args: null });
      // isErasedAccount reads deletedAt alone; reanchorUser reads the whole row.
      if (anchored && args.select && Object.keys(args.select).length === 1) return { deletedAt: anchored.deletedAt ?? null };
      return anchored ? { status: "ACTIVE", deletedAt: null, ...anchored } : null;
    },
    update: async (args: unknown) => { calls.push({ op: "user.update", args }); return {}; },
  },
  consentRecord: { findFirst: async () => { calls.push({ op: "read:consentRecord.findFirst", args: null }); return erasedAt ? { withdrawnAt: erasedAt } : null; } },
  invitation: { updateMany: async (args: unknown) => { calls.push({ op: "invitation.updateMany", args }); return { count: 1 }; } },
  $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => { calls.push({ op: "lock", args: { sql: sql.join("?"), values } }); return 1; },
};
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } }));

import { AccountCannotMove, WouldLandEnded, homeRank, homesElsewhere, leavingIsPrimary, moveHomesOutOf, reanchorUser, type MembershipElsewhere } from "./workspace-anchor";

const live = { status: "ACTIVE", removedAt: null };
const upserts = () => calls.filter((c) => c.op === "upsert");
const userUpdates = () => calls.filter((c) => c.op === "user.update");

describe("reanchorUser", () => {
  beforeEach(() => {
    calls.length = 0; hasPrimary = false; anchored = null; targetScopes = null; targetSeat = null; erasedAt = null;
  });

  it("keeps the workspace left as a primary membership at the level held there, and takes the target's level", async () => {
    calls.length = 0; hasPrimary = false; anchored = { organizationId: "home", accessLevel: "EMPLOYEE" };
    expect(await reanchorUser({ userId: "u", to: { organizationId: "mine", role: "COMPANY_ADMIN" } })).toBe(true);
    expect(upserts()[0]).toMatchObject({ op: "upsert", args: { create: { organizationId: "home", role: "EMPLOYEE", isPrimary: true }, update: { role: "EMPLOYEE" } } });
    expect(userUpdates()[0]).toMatchObject({ op: "user.update", args: { data: { organizationId: "mine", accessLevel: "COMPANY_ADMIN" } } });
  });

  it("never carries an Admin level into a workspace where the person is a Member", async () => {
    calls.length = 0; hasPrimary = true; anchored = { organizationId: "a", accessLevel: "COMPANY_ADMIN" };
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } });
    expect(upserts()[0]).toMatchObject({ args: { create: { role: "COMPANY_ADMIN", isPrimary: false } } });
    expect(userUpdates()[0]).toMatchObject({ args: { data: { organizationId: "b", accessLevel: "EMPLOYEE" } } });
  });

  it("keeps the Admin scopes with the workspace that granted them", async () => {
    calls.length = 0; hasPrimary = true; targetScopes = null;
    anchored = { organizationId: "a", accessLevel: "COMPANY_ADMIN", adminScopes: ["billing", "security"] };
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "COMPANY_ADMIN" } });
    expect(upserts()[0]).toMatchObject({ op: "upsert", args: { create: { organizationId: "a", adminScopes: ["billing", "security"] }, update: { adminScopes: ["billing", "security"] } } });
    expect(userUpdates()[0]).toMatchObject({ op: "user.update", args: { data: { organizationId: "b", adminScopes: [] } } });
    // Coming back takes the ones kept there.
    calls.length = 0; targetScopes = ["billing"];
    anchored = { organizationId: "b", accessLevel: "COMPANY_ADMIN", adminScopes: [] };
    await reanchorUser({ userId: "u", to: { organizationId: "a", role: "COMPANY_ADMIN" } });
    expect(userUpdates()[0]).toMatchObject({ op: "user.update", args: { data: { organizationId: "a", adminScopes: ["billing"] } } });
    targetScopes = null;
  });

  it("does nothing when the person is already there", async () => {
    calls.length = 0; anchored = { organizationId: "a", accessLevel: "EMPLOYEE" };
    expect(await reanchorUser({ userId: "u", to: { organizationId: "a", role: "COMPANY_ADMIN" } })).toBe(false);
    expect(upserts()).toHaveLength(0);
    expect(userUpdates()).toHaveLength(0);
    expect(leavingIsPrimary(false)).toBe(true);
    expect(leavingIsPrimary(true)).toBe(false);
  });
});

// docs/plans/workspace-status.md D1 and D10: the status and the removal
// move as the level does. Before, neither moved: the account kept its
// status wherever it went, and the workspace left kept none.
describe("reanchorUser swaps the person's status in each workspace", () => {
  beforeEach(() => {
    calls.length = 0; hasPrimary = true; anchored = null; targetScopes = null; targetSeat = null; erasedAt = null;
  });

  it("takes the person's row lock before it reads anything", async () => {
    anchored = { organizationId: "a", accessLevel: "EMPLOYEE", status: "INACTIVE", deletedAt: new Date("2026-10-01") };
    targetSeat = { ...live };
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } });
    const ops = calls.map((c) => c.op);
    const firstRead = ops.findIndex((op) => op.startsWith("read:"));
    // Every read the move makes, the erasure check's included, comes after the lock.
    expect(ops.indexOf("lock")).toBe(0);
    expect(firstRead).toBeGreaterThan(0);
    expect(ops.filter((op) => op.startsWith("read:")).length).toBeGreaterThanOrEqual(4);
    expect(calls[0]).toMatchObject({ op: "lock", args: { values: ["u"] } });
    expect((calls[0].args as { sql: string }).sql).toMatch(/SELECT 1 FROM "User" WHERE "id" = \? FOR NO KEY UPDATE/);
  });

  it("ends the open invitations of the workspace it leaves when the seat it leaves there is ended (the step 2 review H1)", async () => {
    anchored = { organizationId: "a", accessLevel: "EMPLOYEE", status: "INACTIVE", deletedAt: null, email: "Pat@x.test" };
    targetSeat = { ...live };
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } });
    const ended = calls.filter((c) => c.op === "invitation.updateMany");
    // Before: none, so an invitation to A still open brought the seat back.
    expect(ended).toHaveLength(1);
    expect(ended[0].args).toMatchObject({
      where: { organizationId: { in: ["a"] }, accepted: false, email: { equals: "Pat@x.test", mode: "insensitive" } },
      data: { expiresAt: expect.any(Date) },
    });
    // A seat a live account leaves keeps its invitations.
    calls.length = 0;
    anchored = { organizationId: "b", accessLevel: "EMPLOYEE", status: "ACTIVE", deletedAt: null, email: "Pat@x.test" };
    await reanchorUser({ userId: "u", to: { organizationId: "a", role: "EMPLOYEE" } });
    expect(calls.filter((c) => c.op === "invitation.updateMany")).toEqual([]);
  });

  it("keeps the status held where the person was on that membership, and takes the target's status and removal", async () => {
    // On leave in A, moving into B where they were deactivated.
    anchored = { organizationId: "a", accessLevel: "EMPLOYEE", status: "ON_LEAVE", deletedAt: null };
    targetSeat = { status: "INACTIVE", removedAt: null };
    // A live account lands ended only where the caller allows it (the hard delete, D9).
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" }, mayLandEnded: true });
    expect(upserts()[0]).toMatchObject({ args: { create: { organizationId: "a", status: "ON_LEAVE", removedAt: null }, update: { status: "ON_LEAVE", removedAt: null } } });
    expect(userUpdates()[0]).toMatchObject({ args: { data: { organizationId: "b", status: "INACTIVE", deletedAt: null } } });
  });

  it("swaps back the other way: a removal there becomes the account's deletedAt, and the live seat left is kept live", async () => {
    const removed = new Date("2026-10-30T09:00:00Z");
    anchored = { organizationId: "b", accessLevel: "EMPLOYEE", status: "ACTIVE", deletedAt: null };
    targetSeat = { status: "INACTIVE", removedAt: removed };
    await reanchorUser({ userId: "u", to: { organizationId: "a", role: "EMPLOYEE" }, mayLandEnded: true });
    expect(upserts()[0]).toMatchObject({ args: { update: { status: "ACTIVE", removedAt: null } } });
    expect(userUpdates()[0]).toMatchObject({ args: { data: { organizationId: "a", status: "INACTIVE", deletedAt: removed } } });
    // And a removed account leaving keeps its removal on the membership it leaves.
    calls.length = 0;
    anchored = { organizationId: "a", accessLevel: "EMPLOYEE", status: "INACTIVE", deletedAt: removed };
    targetSeat = { ...live };
    await reanchorUser({ userId: "u", to: { organizationId: "c", role: "EMPLOYEE" } });
    expect(upserts()[0]).toMatchObject({ args: { update: { status: "INACTIVE", removedAt: removed } } });
    expect(userUpdates()[0]).toMatchObject({ args: { data: { organizationId: "c", status: "ACTIVE", deletedAt: null } } });
  });

  it("writes the seat the caller names for the workspace being left (endSeat ending it as it moves)", async () => {
    const at = new Date("2026-11-01T10:00:00Z");
    anchored = { organizationId: "a", accessLevel: "MANAGER", status: "ACTIVE", deletedAt: null };
    targetSeat = { ...live };
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" }, leaving: { status: "INACTIVE", removedAt: at } });
    expect(upserts()[0]).toMatchObject({ args: { create: { status: "INACTIVE", removedAt: at, role: "MANAGER" }, update: { status: "INACTIVE", removedAt: at } } });
    expect(userUpdates()[0]).toMatchObject({ args: { data: { organizationId: "b", status: "ACTIVE", deletedAt: null } } });
  });

  it("keeps the account's own status when the target has no membership row", async () => {
    anchored = { organizationId: "a", accessLevel: "EMPLOYEE", status: "PROBATION", deletedAt: null };
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } });
    const data = (userUpdates()[0].args as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ organizationId: "b" });
    expect("status" in data).toBe(false);
    expect("deletedAt" in data).toBe(false);
  });

  it("never revives an erased account, whatever the target holds (D10)", async () => {
    const erased = new Date("2026-10-20T12:00:00Z");
    anchored = { organizationId: "a", accessLevel: "EMPLOYEE", status: "INACTIVE", deletedAt: erased };
    erasedAt = new Date(erased.getTime() + 5);
    targetSeat = { ...live };
    expect(await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
    const data = (userUpdates()[0].args as { data: Record<string, unknown> }).data;
    // Before: status ACTIVE and deletedAt null from the live seat there.
    expect(data).toEqual({ organizationId: "b", accessLevel: "EMPLOYEE", adminScopes: [] });
    // The seat left records the erasure's state.
    expect(upserts()[0]).toMatchObject({ args: { update: { status: "INACTIVE", removedAt: erased } } });
  });

  // Step 1 review H1: the switcher, the sign-in fallbacks and any other
  // caller could land a live account in a seat its workspace ended, and the
  // swap then ended the account everywhere. Before, the move was made.
  it("refuses, writing nothing, to land a live account in a deactivated or removed seat", async () => {
    for (const seat of [{ status: "INACTIVE", removedAt: null }, { status: "INACTIVE", removedAt: new Date("2026-10-01") }, { status: "ACTIVE", removedAt: new Date("2026-10-01") }]) {
      calls.length = 0;
      anchored = { organizationId: "a", accessLevel: "EMPLOYEE", status: "ON_LEAVE", deletedAt: null };
      targetSeat = seat;
      const tried = reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } });
      await expect(tried).rejects.toBeInstanceOf(WouldLandEnded);
      await expect(tried).rejects.toThrow(/would end the account everywhere/);
      expect(upserts()).toEqual([]);
      expect(userUpdates()).toEqual([]);
    }
  });

  it("lands a live account in a live seat (an HR status there too), and an ended account in an ended seat, with no flag", async () => {
    anchored = { organizationId: "a", accessLevel: "EMPLOYEE", status: "ACTIVE", deletedAt: null };
    targetSeat = { status: "NOTICE_PERIOD", removedAt: null };
    expect(await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
    expect(userUpdates()[0]).toMatchObject({ args: { data: { status: "NOTICE_PERIOD", deletedAt: null } } });
    calls.length = 0;
    anchored = { organizationId: "a", accessLevel: "EMPLOYEE", status: "INACTIVE", deletedAt: null };
    targetSeat = { status: "INACTIVE", removedAt: null };
    expect(await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
  });

  // D16, step 1 review M1: the seat a move leaves is written by the person's
  // own move, so the one-time step's copied mark goes.
  it("clears the copied mark on the seat it leaves", async () => {
    anchored = { organizationId: "a", accessLevel: "EMPLOYEE" };
    targetSeat = { ...live };
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } });
    expect(upserts()[0]).toMatchObject({ args: { create: { endedWithAccount: false }, update: { endedWithAccount: false } } });
  });

  it("revives an account removed by an Admin (not erased) into a live seat it holds elsewhere", async () => {
    // Removed from A long after an erasure record of an earlier, restored erasure: not in the erased state.
    const removed = new Date("2026-10-28T12:00:00Z");
    anchored = { organizationId: "a", accessLevel: "EMPLOYEE", status: "INACTIVE", deletedAt: removed };
    erasedAt = new Date("2026-08-01T12:00:00Z");
    targetSeat = { ...live };
    await reanchorUser({ userId: "u", to: { organizationId: "b", role: "EMPLOYEE" } });
    expect(userUpdates()[0]).toMatchObject({ args: { data: { status: "ACTIVE", deletedAt: null } } });
  });
});

describe("homesElsewhere", () => {
  const m = (userId: string, organizationId: string, status: string, role: MembershipElsewhere["role"] = "EMPLOYEE", seat: MembershipElsewhere["seat"] = live): MembershipElsewhere => ({ userId, organizationId, role, status, seat });
  const ended = (removedAt: Date | null = null) => ({ status: "INACTIVE", removedAt });

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

  // D9: a live seat anywhere, then an ended one. Before, an ended seat in a
  // working workspace ranked first.
  it("moves into a live seat in a working, suspended or closed workspace before an ended seat anywhere", () => {
    const removedThere = ended(new Date("2026-10-01"));
    expect(homesElsewhere([m("u", "left-me", "ACTIVE", "EMPLOYEE", removedThere), m("u", "closed", "CANCELLED")]).get("u")?.organizationId).toBe("closed");
    expect(homesElsewhere([m("u", "off", "TRIAL", "EMPLOYEE", ended()), m("u", "held", "SUSPENDED")]).get("u")?.organizationId).toBe("held");
    expect(homesElsewhere([m("u", "off", "ACTIVE", "EMPLOYEE", ended()), m("u", "live", "ACTIVE")]).get("u")?.organizationId).toBe("live");
  });

  it("still keeps an account whose only other seat is ended, and prefers an ended seat in a working workspace", () => {
    expect(homesElsewhere([m("u", "removed-here", "ACTIVE", "EMPLOYEE", ended(new Date("2026-10-01")))]).get("u")?.organizationId).toBe("removed-here");
    expect(homesElsewhere([m("u", "gone", "CANCELLED", "EMPLOYEE", ended()), m("u", "off", "ACTIVE", "EMPLOYEE", ended())]).get("u")?.organizationId).toBe("off");
  });

  it("ranks every live seat before every ended one, and HR statuses as live", () => {
    for (const status of ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED", "SOMETHING_NEW"]) {
      for (const endedStatus of ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"]) {
        expect(homeRank({ status, seat: live })).toBeLessThan(homeRank({ status: endedStatus, seat: ended() }));
      }
    }
    for (const hr of ["ON_LEAVE", "PROBATION", "PIP", "NOTICE_PERIOD"]) expect(homeRank({ status: "ACTIVE", seat: { status: hr, removedAt: null } })).toBe(0);
    expect(homeRank({ status: "ACTIVE", seat: { status: "ACTIVE", removedAt: new Date() } })).toBeGreaterThan(3);
  });
});

describe("moveHomesOutOf", () => {
  // A fake transaction: memberships elsewhere, accounts already anchored in
  // those workspaces, and the moves reanchorUser makes.
  type Seat = { seatStatus?: string; removedAt?: Date | null };
  const fakeTx = (
    memberships: Array<{ userId: string; organizationId: string; role: string; status: string; email: string } & Seat>,
    existing: Array<{ organizationId: string; email: string }>,
    /** Runs when a person's row lock is taken: what a writer holding it committed before the lock was granted. */
    onLock?: (userId: string) => void,
  ) => {
    const moves: Array<{ userId: string; to: string; role: string }> = [];
    /** The membership reads and the person locks, in order (step 1 review L2). */
    const log: string[] = [];
    /** What each move wrote on the account beyond where and the level (the seat it took there). */
    const seats: Array<{ userId: string; status?: string; deletedAt?: Date | null }> = [];
    const anchors = new Map<string, string>(memberships.map((m) => [m.userId, "doomed"]));
    const seatOf = (m: Seat) => ({ status: m.seatStatus ?? "ACTIVE", removedAt: m.removedAt ?? null });
    const tx = {
      organizationMembership: {
        findMany: async () => {
          log.push("read:memberships");
          return memberships.map((m) => ({ userId: m.userId, organizationId: m.organizationId, role: m.role, ...seatOf(m), organization: { status: m.status }, user: { email: m.email } }));
        },
        findFirst: async () => null,
        findUnique: async ({ where }: { where: { userId_organizationId: { userId: string; organizationId: string } } }) => {
          const m = memberships.find((x) => x.userId === where.userId_organizationId.userId && x.organizationId === where.userId_organizationId.organizationId);
          return m ? { adminScopes: [], ...seatOf(m) } : null;
        },
        upsert: async () => ({}),
      },
      user: {
        // takenBySameEmail: the address as asked, exactly or in any case (the step 2 review L6).
        findMany: async ({ where }: { where: { OR: Array<{ organizationId: string; email: string | { equals: string; mode: string } }> } }) =>
          existing.filter((e) =>
            where.OR.some((w) =>
              w.organizationId === e.organizationId &&
              (typeof w.email === "string" ? w.email === e.email : w.email.mode === "insensitive" ? w.email.equals.toLowerCase() === e.email.toLowerCase() : w.email.equals === e.email),
            ),
          ),
        findUnique: async ({ where }: { where: { id: string } }) => ({ organizationId: anchors.get(where.id) ?? "doomed", accessLevel: "EMPLOYEE", adminScopes: [], status: "ACTIVE", deletedAt: null }),
        update: async ({ where, data }: { where: { id: string }; data: { organizationId: string; accessLevel: string; status?: string; deletedAt?: Date | null } }) => {
          moves.push({ userId: where.id, to: data.organizationId, role: data.accessLevel });
          seats.push({ userId: where.id, status: data.status, deletedAt: data.deletedAt });
          anchors.set(where.id, data.organizationId);
          return {};
        },
      },
      consentRecord: { findFirst: async () => null },
      $executeRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => {
        const id = String(values[0]);
        // A second lock of the same person in one transaction is already held.
        if (!log.includes(`lock:${id}`)) {
          log.push(`lock:${id}`);
          onLock?.(id);
        }
        return 1;
      },
    };
    return { tx: tx as never, moves, seats, log };
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

  it("passes over a workspace where an account with the same address in another case is anchored (the step 2 review L6)", async () => {
    const { tx, moves } = fakeTx(
      [
        { userId: "p", organizationId: "taken", role: "COMPANY_ADMIN", status: "ACTIVE", email: "pat@x.test" },
        { userId: "p", organizationId: "free", role: "EMPLOYEE", status: "SUSPENDED", email: "pat@x.test" },
      ],
      [{ organizationId: "taken", email: "Pat@X.test" }],
    );
    expect(await moveHomesOutOf("doomed", tx)).toBe(1);
    // Before: moved into "taken", beside the other spelling of the same mailbox.
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

  // The H1 case of the reverted 9877a79b (D9): someone removed from B whose
  // home A is deleted for good keeps their account, in B, as removed there,
  // with everything they did in B. Never left to the cascade.
  // The fake account is live, so without mayLandEnded (H1's guard) this move would throw.
  it("keeps the account of someone removed from their only other workspace, landing it there removed", async () => {
    const removedFromB = new Date("2026-10-15T08:00:00Z");
    const { tx, moves, seats } = fakeTx([{ userId: "p", organizationId: "b", role: "MANAGER", status: "ACTIVE", email: "pat@x.test", seatStatus: "INACTIVE", removedAt: removedFromB }], []);
    expect(await moveHomesOutOf("doomed", tx)).toBe(1);
    expect(moves).toEqual([{ userId: "p", to: "b", role: "MANAGER" }]);
    // Ended there: the move takes B's status and removal (before: status untouched, so the account came back live in B).
    expect(seats).toEqual([{ userId: "p", status: "INACTIVE", deletedAt: removedFromB }]);
  });

  it("moves into a live seat before an ended one, whatever the order, and lands live there", async () => {
    const { tx, moves, seats } = fakeTx(
      [
        { userId: "p", organizationId: "b", role: "EMPLOYEE", status: "ACTIVE", email: "pat@x.test", seatStatus: "INACTIVE", removedAt: null },
        { userId: "p", organizationId: "c", role: "EMPLOYEE", status: "SUSPENDED", email: "pat@x.test" },
      ],
      [],
    );
    await moveHomesOutOf("doomed", tx);
    // Before: B, the deactivated seat in a working workspace, came first.
    expect(moves).toEqual([{ userId: "p", to: "c", role: "EMPLOYEE" }]);
    expect(seats).toEqual([{ userId: "p", status: "ACTIVE", deletedAt: null }]);
  });

  // Step 1 review L2: the seats were ranked from a read taken before any
  // person's lock, so a seat ended while the delete waited for that person
  // still ranked as live, and the account landed in it.
  it("locks the people it may move, in id order, before it reads and ranks their seats", async () => {
    const people = [
      { userId: "zed", organizationId: "b", role: "EMPLOYEE", status: "ACTIVE", email: "zed@x.test" },
      { userId: "amy", organizationId: "b", role: "EMPLOYEE", status: "ACTIVE", email: "amy@x.test" },
      { userId: "amy", organizationId: "c", role: "MANAGER", status: "ACTIVE", email: "amy@x.test" },
    ];
    // Amy's seat in B is ended by a writer that held her lock until the delete got it.
    const { tx, moves, log } = fakeTx(people, [], (id) => {
      if (id === "amy") Object.assign(people[1], { seatStatus: "INACTIVE" });
    });
    await moveHomesOutOf("doomed", tx);
    const ranking = log.indexOf("read:memberships", 1);
    expect(log.slice(0, ranking + 1)).toEqual(["read:memberships", "lock:amy", "lock:zed", "read:memberships"]);
    // The ranking saw B ended, so Amy lands in her live seat in C.
    expect(moves).toEqual(expect.arrayContaining([{ userId: "amy", to: "c", role: "MANAGER" }, { userId: "zed", to: "b", role: "EMPLOYEE" }]));
  });

  it("still keeps the company when the only ended seat is taken by an account with the same email", async () => {
    const { tx, moves } = fakeTx([{ userId: "p", organizationId: "b", role: "EMPLOYEE", status: "ACTIVE", email: "pat@x.test", seatStatus: "INACTIVE", removedAt: new Date() }], [{ organizationId: "b", email: "pat@x.test" }]);
    await expect(moveHomesOutOf("doomed", tx)).rejects.toBeInstanceOf(AccountCannotMove);
    expect(moves).toEqual([]);
  });
});
