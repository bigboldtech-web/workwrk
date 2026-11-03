// The role of someone who works here through a membership, and the Owner and
// Admin guards over everyone who belongs here (docs/plans/workspace-status.md
// step 3, D11 and D12). Run through the real planner (membership.ts) and the
// role lock on an in-memory database whose relations follow the rows.
//
// Before step 3 a role change found its person among those anchored here
// only (a membership person was "Not found"), and the Owners counted a
// membership Owner by the account's status alone, so one this workspace had
// deactivated through their membership still "held" Owner here.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));

import { applyRoleChange, isLiveOwner, liveAdminsOf, liveCompanyAdminCount, wouldRemoveLastOwner } from "./membership";
import { reanchorUser } from "./workspace-anchor";
import { SEAT_PLAN_CHANGED_WORDS } from "./workspace-status";
import { seatDb as db } from "./seat-test-db";

const T0 = new Date("2026-01-01T00:00:00Z");
const later = (days: number) => new Date(T0.getTime() + days * 86_400_000);

function person(id: string, organizationId: string, accessLevel = "EMPLOYEE", extra: Record<string, unknown> = {}) {
  return db.seed("user", { id, email: `${id}@x.test`, firstName: id, lastName: "", organizationId, accessLevel, createdAt: later(Object.keys(db.tables.user ?? {}).length), ...extra });
}
function seat(userId: string, organizationId: string, role = "EMPLOYEE", extra: Record<string, unknown> = {}) {
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role, ...extra });
}
const seatOf = (userId: string, organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId)!;
const change = (targetId: string, next: { role: "OWNER" | "ADMIN" | "MEMBER"; tier?: string | null }, actor = { id: "olga", owner: true }) =>
  applyRoleChange(db.prisma as never, { organizationId: "b", actorId: actor.id, actorIsOwner: actor.owner, actorIsAdmin: true, targetId, next });

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  // Olga owns B (anchored there). Pat is anchored in A, a Member of B through a membership.
  person("olga", "b", "SUPER_ADMIN");
  person("pat", "a", "COMPANY_ADMIN");
  seat("pat", "b", "EMPLOYEE");
});

describe("a role change on someone who works here through a membership (D11)", () => {
  it("writes only that membership's role, never the account, and signs nobody out", async () => {
    const r = await change("pat", { role: "MEMBER", tier: "MANAGER" });
    // Before: 404 Not found (anchored people only).
    expect(r).toMatchObject({ ok: true, changed: true, before: { level: "EMPLOYEE", role: "MEMBER" }, after: { level: "MANAGER", role: "MEMBER" }, bumped: false });
    expect(seatOf("pat", "b")).toMatchObject({ role: "MANAGER", adminScopes: [], orgRole: "MEMBER" });
    // Their level and sessions in A are A's.
    expect(db.row("user", "pat")).toMatchObject({ accessLevel: "COMPANY_ADMIN", tokenVersion: 0, organizationId: "a" });
    // A lowering too: still no bump, the seat alone.
    expect(await change("pat", { role: "MEMBER", tier: "EMPLOYEE" })).toMatchObject({ ok: true, bumped: false });
    expect(db.row("user", "pat").tokenVersion).toBe(0);
  });

  it("keeps every guard: only an Owner makes an Owner, and the last Owner stays one", async () => {
    expect(await change("pat", { role: "OWNER" }, { id: "olga", owner: false })).toMatchObject({ ok: false, status: 403 });
    expect(seatOf("pat", "b").role).toBe("EMPLOYEE");
    // Pat becomes an Owner of B through the membership: the guard counts that seat.
    expect(await change("pat", { role: "OWNER" })).toMatchObject({ ok: true, after: { role: "OWNER", level: "SUPER_ADMIN" } });
    expect(await isLiveOwner("b", "pat")).toBe(true);
    // Olga steps down to Member: Pat, an Owner through the membership, stays one, so it is allowed.
    expect(await change("olga", { role: "MEMBER", tier: "EMPLOYEE" })).toMatchObject({ ok: true });
    // Now Pat is the last Owner: demoting Pat is refused.
    expect(await change("pat", { role: "MEMBER", tier: "EMPLOYEE" }, { id: "pat", owner: true })).toMatchObject({ ok: false, code: "last_owner" });
    expect(seatOf("pat", "b").role).toBe("SUPER_ADMIN");
  });

  it("finds nobody whose membership here was removed, and nobody with no seat here", async () => {
    seatOf("pat", "b").removedAt = T0;
    seatOf("pat", "b").status = "INACTIVE";
    expect(await change("pat", { role: "ADMIN" })).toMatchObject({ ok: false, status: 404 });
    person("ned", "a");
    expect(await change("ned", { role: "ADMIN" })).toMatchObject({ ok: false, status: 404 });
  });

  it("changes the role of someone deactivated here through the membership, as of someone deactivated while anchored here", async () => {
    seatOf("pat", "b").status = "INACTIVE";
    expect(await change("pat", { role: "MEMBER", tier: "TEAM_LEAD" })).toMatchObject({ ok: true });
    expect(seatOf("pat", "b").role).toBe("TEAM_LEAD");
  });
});

describe("the Owners and Admins read this workspace's seat (D12)", () => {
  it("an Owner this workspace deactivated or removed through their membership is no Owner here", async () => {
    seatOf("pat", "b").role = "SUPER_ADMIN";
    expect((await liveAdminsOf(db.prisma as never, "b")).map((a) => a.id).sort()).toEqual(["olga", "pat"]);
    expect(await wouldRemoveLastOwner("b", "olga")).toBe(false);
    seatOf("pat", "b").status = "INACTIVE";
    // Before: Pat still counted (her account is live in A), so Olga, the last live Owner, could be removed.
    expect((await liveAdminsOf(db.prisma as never, "b")).map((a) => a.id)).toEqual(["olga"]);
    expect(await wouldRemoveLastOwner("b", "olga")).toBe(true);
    seatOf("pat", "b").status = "ACTIVE";
    seatOf("pat", "b").removedAt = T0;
    expect(await isLiveOwner("b", "pat")).toBe(false);
  });

  it("an account ended where it is anchored still counts for nobody here, as before", async () => {
    seatOf("pat", "b").role = "SUPER_ADMIN";
    db.row("user", "pat").status = "INACTIVE";
    expect(await isLiveOwner("b", "pat")).toBe(false);
  });

  it("liveCompanyAdminCount counts a live Company Admin through a membership, never a deactivated or removed one (L7)", async () => {
    person("ada", "b", "COMPANY_ADMIN");
    expect(await liveCompanyAdminCount(db.prisma as never, "b")).toBe(1);
    seatOf("pat", "b").role = "COMPANY_ADMIN";
    // Before (DELETE's own count): 1, anchored only.
    expect(await liveCompanyAdminCount(db.prisma as never, "b")).toBe(2);
    expect(await liveCompanyAdminCount(db.prisma as never, "b", { except: "pat" })).toBe(1);
    // Deactivated here: no longer counted (before this review fix: still 2).
    seatOf("pat", "b").status = "INACTIVE";
    expect(await liveCompanyAdminCount(db.prisma as never, "b")).toBe(1);
    seatOf("pat", "b").status = "ACTIVE";
    seatOf("pat", "b").removedAt = T0;
    expect(await liveCompanyAdminCount(db.prisma as never, "b")).toBe(1);
    // An anchored Company Admin deactivated here no longer counts either.
    db.row("user", "ada").status = "INACTIVE";
    expect(await liveCompanyAdminCount(db.prisma as never, "b")).toBe(0);
    // The anchored workspace's own stale row is not a seat here.
    db.row("user", "ada").status = "ACTIVE";
    seat("ada", "b", "COMPANY_ADMIN");
    expect(await liveCompanyAdminCount(db.prisma as never, "b")).toBe(1);
  });
});

// The step 3 review H3: the earliest Company Admin is an Owner (ownerIdsOf),
// and a membership admin's "joined" was their ACCOUNT's creation, in another
// company: an Owner making an old contractor account an Admin made them an
// Owner of this workspace.
describe("a membership admin joined here when their membership was made (H3)", () => {
  it("making a contractor whose account is years older an Admin never makes them an Owner", async () => {
    // B was set up by Olga in 2026 as its earliest Company Admin (an implicit Owner).
    db.row("user", "olga").accessLevel = "COMPANY_ADMIN";
    db.row("user", "olga").createdAt = new Date("2026-01-01");
    // Pat's account was made at her agency in 2019; she joined B in 2026, after Olga.
    db.row("user", "pat").createdAt = new Date("2019-05-01");
    seatOf("pat", "b").createdAt = new Date("2026-06-01");
    const r = await change("pat", { role: "ADMIN" }, { id: "olga", owner: true });
    // Before: she was the earliest admin, so ADMIN made her the Owner (afterRole OWNER).
    expect(r).toMatchObject({ ok: true, after: { role: "ADMIN" } });
    expect(await isLiveOwner("b", "olga")).toBe(true);
    expect(await isLiveOwner("b", "pat")).toBe(false);
    // liveAdminsOf answers the membership's own date for her.
    expect((await liveAdminsOf(db.prisma as never, "b")).find((a) => a.id === "pat")?.createdAt).toEqual(new Date("2026-06-01"));
  });
});

// The final review, integrity M2 (a): B's Owner makes Pat a Company Admin
// while Pat, in another tab, switches to A (or accepts A's invitation).
// Before: the change read Pat as anchored in B with no lock on her row, the
// move committed, and the level was written onto the account, now anchored
// in A, so A had a Company Admin it never made (and B's own level for her
// was the stale one the move left on B's row).
describe("a role change and a move between workspaces never cross (M2)", () => {
  beforeEach(() => {
    // Pat anchored in B as an Employee, and an Employee of A through a membership.
    Object.assign(db.row("user", "pat"), { organizationId: "b", accessLevel: "EMPLOYEE" });
    db.tables.organizationMembership = db.tables.organizationMembership.filter((m) => m.id !== "m-pat-b");
    seat("pat", "a", "EMPLOYEE");
  });

  it("takes the person's row lock after the workspace's role lock and before it reads them", async () => {
    await change("pat", { role: "ADMIN" });
    const roles = db.log.findIndex((e) => e.startsWith("tx.SELECT pg_advisory_xact_lock"));
    const lock = db.log.indexOf("tx.lock:pat");
    const read = db.log.indexOf("tx.user.findUnique");
    expect(roles).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(roles);
    expect(read).toBeGreaterThan(lock);
  });

  it("a switch that lands while the change waits for the person's lock: the new level is B's seat, on the row B holds now, never the account now in A", async () => {
    db.onCall = async (entry) => {
      if (entry !== "tx.lock:pat") return;
      db.onCall = null;
      // Pat's switch to A commits first.
      await reanchorUser({ userId: "pat", to: { organizationId: "a", role: "EMPLOYEE" } });
    };
    const r = await change("pat", { role: "ADMIN" });
    expect(r).toMatchObject({ ok: true, changed: true, after: { level: "COMPANY_ADMIN" }, bumped: false });
    expect(db.row("user", "pat")).toMatchObject({ organizationId: "a", accessLevel: "EMPLOYEE", tokenVersion: 0 });
    expect(seatOf("pat", "b")).toMatchObject({ role: "COMPANY_ADMIN" });
    // When she switches back, B's level is the one B gave.
    await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    expect(db.row("user", "pat")).toMatchObject({ organizationId: "b", accessLevel: "COMPANY_ADMIN" });
    expect(seatOf("pat", "a").role).toBe("EMPLOYEE");
  });

  it("an account write that finds the person anchored elsewhere than read writes nothing and asks to try again", async () => {
    // The lock makes this impossible in Postgres; the guard holds without it.
    db.onCall = (entry) => {
      if (entry !== "tx.organizationMembership.findUnique") return;
      db.onCall = null;
      Object.assign(db.row("user", "pat"), { organizationId: "a", accessLevel: "EMPLOYEE" });
      seat("pat", "b", "EMPLOYEE");
    };
    const r = await change("pat", { role: "ADMIN" });
    expect(r).toEqual({ ok: false, status: 409, error: SEAT_PLAN_CHANGED_WORDS, code: "seat_plan_changed" });
    expect(db.row("user", "pat")).toMatchObject({ organizationId: "a", accessLevel: "EMPLOYEE" });
    expect(seatOf("pat", "b").role).toBe("EMPLOYEE");
  });

  it("a membership write that finds the person moved here writes nothing and asks to try again", async () => {
    // Pat is a membership person of B (anchored in A); the change reads her so, then she is anchored in B.
    Object.assign(db.row("user", "pat"), { organizationId: "a" });
    db.tables.organizationMembership = db.tables.organizationMembership.filter((m) => m.id !== "m-pat-a");
    seat("pat", "b", "EMPLOYEE");
    db.onCall = (entry) => {
      if (entry !== "tx.organizationMembership.findMany") return;
      db.onCall = null;
      Object.assign(db.row("user", "pat"), { organizationId: "b", accessLevel: "EMPLOYEE" });
    };
    const r = await change("pat", { role: "ADMIN" });
    expect(r).toEqual({ ok: false, status: 409, error: SEAT_PLAN_CHANGED_WORDS, code: "seat_plan_changed" });
    expect(seatOf("pat", "b").role).toBe("EMPLOYEE");
    expect(db.row("user", "pat").accessLevel).toBe("EMPLOYEE");
  });
});
