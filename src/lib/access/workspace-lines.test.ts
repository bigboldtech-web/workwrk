// A person's manager in each workspace (docs/plans/workspace-status-2.md E1,
// E2, E3, step 1). Pat is anchored at her agency A, where she reports to
// Max, and works for client B through a membership, where Dana leads her.
// Max also contracts for B. Run on the in-memory database through the real
// move (workspace-anchor.ts reanchorUser, endSeat's D3, the hard delete's
// moveHomesOutOf) and the real line reads (acting-workspace.ts).
//
// Before: User.managerId was one line per account, carried by every move,
// so Pat switching into B took Max with her as her B manager, and every
// workspace read the same column.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));

import { moveHomesOutOf, reanchorUser } from "./workspace-anchor";
import { endSeat } from "./workspace-status";
import { personSeatIn, reportsHereOf, seatsHeldFor } from "./acting-workspace";
import { seatDb as db } from "./seat-test-db";

const user = (id: string) => db.row("user", id);
const seatOf = (userId: string, organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId);
const person = (id: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  db.seed("user", { id, email: `${id}@x.test`, organizationId, accessLevel: "EMPLOYEE", managerId: null, ...extra });
const membership = (userId: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role: "EMPLOYEE", ...extra });
const seatRows = (ids: string[]) =>
  ids.map((id) => {
    const u = user(id);
    return { id, organizationId: u.organizationId as string, accessLevel: u.accessLevel as never, status: u.status as string, managerId: (u.managerId as string | null) ?? null };
  });

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b", "c"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  // A: Max manages Pat. B: Dana leads her there; Max contracts for B.
  person("max", "a", { accessLevel: "MANAGER" });
  membership("max", "b", { role: "EMPLOYEE" });
  person("dana", "b", { accessLevel: "MANAGER" });
  person("pat", "a", { managerId: "max" });
  membership("pat", "b", { managerId: "dana" });
});

describe("the move swaps the line, as it swaps the level (E3)", () => {
  it("Pat switching into B takes Dana as her manager there; A's membership keeps Max", async () => {
    expect(await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
    // Before: Max came with her, so B read Max as her B manager and A's line was lost.
    expect(user("pat")).toMatchObject({ organizationId: "b", managerId: "dana" });
    expect(seatOf("pat", "a")).toMatchObject({ managerId: "max" });
  });

  it("switching back brings each workspace's own line back, both ways, a line set in B while she was there included", async () => {
    person("kai", "b", { accessLevel: "MANAGER" });
    await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    expect(user("pat").managerId).toBe("dana");
    // B moves her under Kai while she is anchored there: B's line is on her account now.
    user("pat").managerId = "kai";
    await reanchorUser({ userId: "pat", to: { organizationId: "a", role: "EMPLOYEE" } });
    // Before: Kai came back to A with her, and B's membership never held a line.
    expect(user("pat")).toMatchObject({ organizationId: "a", managerId: "max" });
    expect(seatOf("pat", "b")).toMatchObject({ managerId: "kai" });
  });

  it("with no membership in the target the account arrives with no manager, never another workspace's", async () => {
    expect(await reanchorUser({ userId: "pat", to: { organizationId: "c", role: "EMPLOYEE" } })).toBe(true);
    // Before: Max, A's line, now read as C's.
    expect(user("pat")).toMatchObject({ organizationId: "c", managerId: null });
    expect(seatOf("pat", "a")).toMatchObject({ managerId: "max" });
  });

  it("the anchored workspace's own stale membership row is overwritten on leaving, never carried in", async () => {
    // From an earlier move, Pat's row for A still names Rita (a line A replaced since).
    person("rita", "a");
    membership("pat", "a", { managerId: "rita" });
    await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    expect(seatOf("pat", "a")).toMatchObject({ managerId: "max" });
    expect(user("pat").managerId).toBe("dana");
  });

  it("A's removal that moves her to B (D3) hands her Dana; the ended seat in A keeps Max, so a restore there brings him back", async () => {
    expect(await endSeat(db.prisma as never, { userId: "pat", organizationId: "a", kind: "removed" })).toMatchObject({ outcome: "moved", anchoredIn: "b" });
    expect(user("pat")).toMatchObject({ organizationId: "b", managerId: "dana" });
    expect(seatOf("pat", "a")).toMatchObject({ status: "INACTIVE", removedAt: expect.any(Date), managerId: "max" });
  });

  it("the hard delete moves a home line: A deleted for good, Pat lives on in B under Dana", async () => {
    const client = db.prisma as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
    await client.$transaction(async (tx: unknown) => {
      expect(await moveHomesOutOf("a", tx as never)).toBe(2);
    });
    expect(user("pat")).toMatchObject({ organizationId: "b", managerId: "dana" });
    // Max moved home to B too, where he holds no line.
    expect(user("max")).toMatchObject({ organizationId: "b", managerId: null });
  });
});

describe("a line names an account: deleted for good, the line is none (ON DELETE SET NULL, E1)", () => {
  it("every membership and account line naming a deleted account is cleared, and the dotted lines to it go", async () => {
    // Lia works for B through a membership and reports to Max there; Kai, anchored at A, reports to Max too.
    person("kai", "a", { managerId: "max" });
    person("lia", "c");
    membership("lia", "b", { managerId: "max" });
    db.seed("userDottedLine", { id: "d-pat-max-b", userId: "pat", managerId: "max", organizationId: "b" });
    await (db.prisma as unknown as { user: { delete: (a: unknown) => Promise<unknown> } }).user.delete({ where: { id: "max" } });
    expect(seatOf("lia", "b")).toMatchObject({ managerId: null });
    expect(user("kai").managerId).toBeNull();
    expect(user("pat").managerId).toBeNull();
    expect(db.tables.userDottedLine).toEqual([]);
    // His own memberships go with him (CASCADE).
    expect(seatOf("max", "b")).toBeUndefined();
  });

  it("the account's own line is a key to User too, so a swap can never carry a dangling id onto it (the step 1 review L7)", async () => {
    const users = db.prisma as unknown as { user: { update: (a: unknown) => Promise<unknown> } };
    await expect(users.user.update({ where: { id: "pat" }, data: { managerId: "nobody" } })).rejects.toMatchObject({ code: "P2003" });
    expect(user("pat").managerId).toBe("max");
    // And the swap takes only a line that names an account: Dana's.
    await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    expect(user("pat").managerId).toBe("dana");
  });

  it("a membership's line must name an account that exists (the key), as Postgres holds it", async () => {
    const tx = db.prisma as unknown as { organizationMembership: { updateMany: (a: unknown) => Promise<unknown> } };
    await expect(tx.organizationMembership.updateMany({ where: { userId: "pat", organizationId: "b" }, data: { managerId: "nobody" } })).rejects.toMatchObject({ code: "P2003" });
    expect(seatOf("pat", "b")?.managerId).toBe("dana");
  });

  it("a dotted line must name its workspace (NOT NULL), and is unique per person, manager and workspace", async () => {
    const dl = (db.prisma as unknown as { userDottedLine: { create: (a: unknown) => Promise<unknown> } }).userDottedLine;
    await expect(dl.create({ data: { userId: "pat", managerId: "max" } })).rejects.toMatchObject({ code: "P2011" });
    await dl.create({ data: { userId: "pat", managerId: "max", organizationId: "a" } });
    // The same line in B is B's own row.
    await dl.create({ data: { userId: "pat", managerId: "max", organizationId: "b" } });
    await expect(dl.create({ data: { userId: "pat", managerId: "max", organizationId: "b" } })).rejects.toMatchObject({ code: "P2002" });
    expect(db.tables.userDottedLine.map((d) => d.organizationId)).toEqual(["a", "b"]);
  });
});

describe("the line reads answer this workspace's line (E1)", () => {
  it("seatsHeldFor: Max in A (the account's line), Dana in B (the membership's)", async () => {
    // Before: no line in the answer, and every reader took the account's (Max) in B too.
    expect((await seatsHeldFor("a", seatRows(["pat"]))).get("pat")).toEqual({ level: "EMPLOYEE", deactivated: false, managerId: "max" });
    expect((await seatsHeldFor("b", seatRows(["pat"]))).get("pat")).toEqual({ level: "EMPLOYEE", deactivated: false, managerId: "dana" });
  });

  it("personSeatIn: the same, and a row passed without the line reads it rather than guess", async () => {
    expect(await personSeatIn("a", "pat")).toMatchObject({ kind: "anchor", managerId: "max" });
    expect(await personSeatIn("b", "pat")).toMatchObject({ kind: "membership", managerId: "dana" });
    const row = { organizationId: "a", accessLevel: "EMPLOYEE" as never, status: "ACTIVE", deletedAt: null };
    expect(await personSeatIn("a", "pat", db.prisma as never, row)).toMatchObject({ kind: "anchor", managerId: "max" });
  });

  it("the anchored workspace's own stale membership row is never read as its line", async () => {
    // Pat is anchored at A; her row for A (from an earlier move) names Dana.
    membership("pat", "a", { managerId: "dana" });
    expect((await seatsHeldFor("a", seatRows(["pat"]))).get("pat")?.managerId).toBe("max");
    expect((await personSeatIn("a", "pat"))?.managerId).toBe("max");
    expect(await reportsHereOf("a", ["dana"])).toEqual([]);
  });

  it("after Pat switches into B, each workspace still reads its own line", async () => {
    await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    expect((await personSeatIn("a", "pat"))?.managerId).toBe("max");
    expect((await personSeatIn("b", "pat"))?.managerId).toBe("dana");
    expect((await seatsHeldFor("a", seatRows(["pat"]))).get("pat")?.managerId).toBe("max");
  });
});

describe("reportsHereOf: who reports to someone in this workspace, both halves (E1)", () => {
  beforeEach(() => {
    // B: Dan anchored there under Dana; Rex works there through a membership,
    // deactivated by B, under Dana; Ron removed by B, under Dana there.
    person("dan", "b", { managerId: "dana" });
    person("rex", "c");
    membership("rex", "b", { managerId: "dana", status: "INACTIVE" });
    person("ron", "c");
    membership("ron", "b", { managerId: "dana", status: "INACTIVE", removedAt: new Date("2026-10-01") });
  });

  it("answers the people anchored here by their account's line and the people here through a membership by its line", async () => {
    // Before: no such read; directReports named every account whose own line names Dana, in any workspace.
    expect(await reportsHereOf("b", ["dana"])).toEqual([
      { id: "dan", managerId: "dana", kind: "anchor", level: "EMPLOYEE", deactivated: false },
      { id: "pat", managerId: "dana", kind: "membership", level: "EMPLOYEE", deactivated: false },
      { id: "rex", managerId: "dana", kind: "membership", level: "EMPLOYEE", deactivated: true },
    ]);
    expect(await reportsHereOf("a", ["max"])).toEqual([{ id: "pat", managerId: "max", kind: "anchor", level: "EMPLOYEE", deactivated: false }]);
  });

  it("never answers another workspace's line: Pat's account names Max, but in B she reports to Dana", async () => {
    expect(await reportsHereOf("b", ["max"])).toEqual([]);
    expect(await reportsHereOf("a", ["dana"])).toEqual([]);
  });

  it("kept seats by default (a deactivated report included), live seats on request, never a removed one", async () => {
    expect((await reportsHereOf("b", ["dana"], undefined, { seats: "live" })).map((r) => r.id)).toEqual(["dan", "pat"]);
    expect((await reportsHereOf("b", ["dana"])).map((r) => r.id)).not.toContain("ron");
    // An account ended where it is anchored is not live here either (D12).
    user("pat").status = "INACTIVE";
    expect((await reportsHereOf("b", ["dana"], undefined, { seats: "live" })).map((r) => r.id)).toEqual(["dan"]);
  });

  // The step 1 review L7: the index used is EXPLAIN's (the coordinator's
  // planted cases); here, that each half is one read narrowed by exactly the
  // columns of its index, never one OR with a membership sublink.
  it("reads two halves, each narrowed by its index's columns: the accounts by line then workspace, the memberships by line and workspace", async () => {
    const models = db.prisma as unknown as Record<string, { findMany: (a: { where: Record<string, unknown> }) => Promise<unknown> }>;
    const seen: Array<{ model: string; where: Record<string, unknown> }> = [];
    const real = { user: models.user.findMany, organizationMembership: models.organizationMembership.findMany };
    for (const model of ["user", "organizationMembership"] as const) {
      models[model].findMany = async (a) => {
        seen.push({ model, where: a.where });
        return real[model](a);
      };
    }
    try {
      db.log.length = 0;
      await reportsHereOf("b", ["dana", "max"]);
    } finally {
      models.user.findMany = real.user;
      models.organizationMembership.findMany = real.organizationMembership;
    }
    expect(seen.map((x) => x.model)).toEqual(["user", "organizationMembership"]);
    // "User_managerId_idx", then the workspace.
    expect(seen[0].where).toMatchObject({ managerId: { in: ["dana", "max"] }, organizationId: "b", deletedAt: null });
    expect(seen[0].where).not.toHaveProperty("OR");
    // "OrganizationMembership_managerId_organizationId_idx": both columns, then the person anchored elsewhere.
    expect(seen[1].where).toMatchObject({ managerId: { in: ["dana", "max"] }, organizationId: "b", removedAt: null, user: { organizationId: { not: "b" }, deletedAt: null } });
    expect(seen[1].where).not.toHaveProperty("OR");
    expect(await reportsHereOf("b", [])).toEqual([]);
  });
});
