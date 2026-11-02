// A person's profile in each workspace (docs/plans/workspace-status.md D18,
// the step 3 review H2): a move swaps the department, job role, office, join
// date, working week, schedule, custom profile fields and the level's org
// role and Agent mirrors, as it swaps the level and the status. Run through
// the real move (workspace-anchor.ts reanchorUser), endSeat's D3 move and
// restoreSeat's D6 move, on an in-memory database.
//
// Before: the account carried the first company's department, title and the
// rest into the next one, where its Admins read them as their own and
// edited over them.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));

import { Prisma } from "@/generated/prisma";
import { arrivingProfile, moveHomesOutOf, reanchorUser } from "./workspace-anchor";
import { endSeat, restoreSeat } from "./workspace-status";
import { seatDb as db } from "./seat-test-db";

const JOINED_A = new Date("2019-03-01T00:00:00Z");
const JOINED_B = new Date("2026-06-01T00:00:00Z");
const pat = () => db.row("user", "pat");
const seatIn = (organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === "pat" && m.organizationId === organizationId)!;

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  // Each workspace's own placement rows (User's columns are foreign keys to them).
  db.seed("department", { id: "dep-a", name: "Finance", organizationId: "a" });
  db.seed("role", { id: "role-a", title: "Controller", organizationId: "a" });
  db.seed("office", { id: "off-a", name: "Leeds", organizationId: "a" });
  db.seed("department", { id: "dep-b", name: "Design", organizationId: "b" });
  db.seed("role", { id: "role-b", title: "Designer", organizationId: "b" });
  // Pat's account is anchored in A (her employer), with A's profile.
  db.seed("user", {
    id: "pat", email: "pat@x.test", organizationId: "a", accessLevel: "MANAGER", managerId: "amy", phone: "+44 1",
    departmentId: "dep-a", roleId: "role-a", officeId: "off-a", joinDate: JOINED_A, weeklyCapacityHours: 30,
    workSchedule: { workdays: [1, 2, 3] }, customFields: { shirt: "M" }, orgRole: "MEMBER", isAgent: false,
  });
  // B (a client) holds its own profile of her on the membership, with no join date stored.
  db.seed("organizationMembership", {
    id: "m-b", userId: "pat", organizationId: "b", role: "EMPLOYEE", createdAt: JOINED_B,
    departmentId: "dep-b", roleId: "role-b", officeId: null, joinDate: null, weeklyCapacityHours: 20,
    workSchedule: null, customFields: { badge: "C-12" }, orgRole: "MEMBER", isAgent: false,
  });
});

describe("a move swaps the profile with the level (D18)", () => {
  // The step 4 review H1 (joined-here.ts): the home row (B is where Pat's
  // account was made, first left) was made at the move, so with no join
  // date stored there she joined B when the account was made.
  it("moving into the home row with no join date stored dates the arrival by the account", async () => {
    pat().createdAt = new Date("2018-05-01T00:00:00Z");
    seatIn("b").isPrimary = true;
    expect(await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
    // Before: JOINED_B, the moment the account had left B.
    expect(pat().joinDate).toEqual(new Date("2018-05-01T00:00:00Z"));
  });

  it("the account takes the target's profile, and the workspace left keeps its own on its membership", async () => {
    expect(await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
    // Before: dep-a, role-a, off-a, 2019, 30 hours and A's fields, now read as B's.
    expect(pat()).toMatchObject({
      organizationId: "b", accessLevel: "EMPLOYEE",
      departmentId: "dep-b", roleId: "role-b", officeId: null, weeklyCapacityHours: 20, customFields: { badge: "C-12" }, orgRole: "MEMBER", isAgent: false,
    });
    // No join date stored there: the membership's own createdAt.
    expect(pat().joinDate).toEqual(JOINED_B);
    expect(pat().workSchedule).toBe(Prisma.DbNull);
    // Personal details and the manager line stay with the account.
    expect(pat()).toMatchObject({ phone: "+44 1", managerId: "amy" });
    expect(seatIn("a")).toMatchObject({
      role: "MANAGER", departmentId: "dep-a", roleId: "role-a", officeId: "off-a", joinDate: JOINED_A, weeklyCapacityHours: 30,
      workSchedule: { workdays: [1, 2, 3] }, customFields: { shirt: "M" }, orgRole: "MEMBER",
    });
  });

  it("moving back brings each workspace's own profile back", async () => {
    await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    await reanchorUser({ userId: "pat", to: { organizationId: "a", role: "MANAGER" } });
    expect(pat()).toMatchObject({ organizationId: "a", departmentId: "dep-a", roleId: "role-a", officeId: "off-a", joinDate: JOINED_A, weeklyCapacityHours: 30, customFields: { shirt: "M" } });
    expect(seatIn("b")).toMatchObject({ departmentId: "dep-b", roleId: "role-b", weeklyCapacityHours: 20, customFields: { badge: "C-12" }, joinDate: JOINED_B });
  });

  it("A's removal that moves her to B (D3) hands her B's profile, never A's", async () => {
    expect(await endSeat(db.prisma as never, { userId: "pat", organizationId: "a", kind: "removed" })).toMatchObject({ outcome: "moved", anchoredIn: "b" });
    expect(pat()).toMatchObject({ organizationId: "b", departmentId: "dep-b", roleId: "role-b" });
    expect(seatIn("a")).toMatchObject({ status: "INACTIVE", removedAt: expect.any(Date), departmentId: "dep-a", roleId: "role-a" });
  });

  it("B's restore of an ended anchor that moves her to B (D6) hands her B's profile", async () => {
    pat().status = "INACTIVE";
    pat().deletedAt = new Date("2026-10-01");
    seatIn("b").status = "INACTIVE";
    seatIn("b").removedAt = new Date("2026-09-01");
    expect(await restoreSeat(db.prisma as never, { userId: "pat", organizationId: "b", kind: "restored" })).toMatchObject({ outcome: "restored", movedFrom: "a" });
    expect(pat()).toMatchObject({ organizationId: "b", status: "ACTIVE", departmentId: "dep-b", roleId: "role-b", officeId: null });
    expect(seatIn("a")).toMatchObject({ departmentId: "dep-a", roleId: "role-a", officeId: "off-a" });
  });

  it("with no membership there the account arrives with an empty profile, never another workspace's", () => {
    const empty = arrivingProfile(null);
    expect(empty).toMatchObject({ departmentId: null, roleId: null, officeId: null, weeklyCapacityHours: null, orgRole: null, isAgent: false });
    expect(empty.workSchedule).toBe(Prisma.DbNull);
    expect(empty.joinDate).toBeInstanceOf(Date);
  });
});

// A membership names its department, job role and office by id with no
// foreign key (D18), and those rows are deleted for good, while the
// account's columns are foreign keys: a stale copy failed the move itself
// (the switch, D3, D6, the repair and the hard delete). Only the ones that
// still exist in the target workspace reach the account.
describe("a stale placement on the membership never fails the move", () => {
  it("a deleted department, job role and office arrive as none, and the move goes through", async () => {
    db.tables.department = db.tables.department.filter((d) => d.id !== "dep-b");
    db.tables.role = db.tables.role.filter((r) => r.id !== "role-b");
    seatIn("b").officeId = "off-gone";
    // Before: P2003 on the account's foreign key, nothing moved.
    expect(await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
    expect(pat()).toMatchObject({ organizationId: "b", departmentId: null, roleId: null, officeId: null, weeklyCapacityHours: 20 });
    // The membership left keeps A's own, as ever.
    expect(seatIn("a")).toMatchObject({ departmentId: "dep-a", roleId: "role-a", officeId: "off-a" });
  });

  it("another workspace's department, job role or office arrive as none", async () => {
    seatIn("b").departmentId = "dep-a";
    seatIn("b").roleId = "role-a";
    seatIn("b").officeId = "off-a";
    expect(await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
    // Before: A's Finance, Controller and Leeds, landed on the account in B.
    expect(pat()).toMatchObject({ organizationId: "b", departmentId: null, roleId: null, officeId: null });
  });

  it("the hard delete and D3 move an account whose membership names a deleted department", async () => {
    db.tables.department = db.tables.department.filter((d) => d.id !== "dep-b");
    expect(await endSeat(db.prisma as never, { userId: "pat", organizationId: "a", kind: "deactivated" })).toMatchObject({ outcome: "moved", anchoredIn: "b" });
    expect(pat()).toMatchObject({ organizationId: "b", departmentId: null, roleId: "role-b" });
    // Back in A by the switcher, then A is deleted for good: the home move still goes through.
    seatIn("a").status = "ACTIVE";
    await reanchorUser({ userId: "pat", to: { organizationId: "a", role: "MANAGER" } });
    seatIn("b").departmentId = "dep-gone";
    const client = db.prisma as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
    await client.$transaction(async (tx: unknown) => {
      expect(await moveHomesOutOf("a", tx as never)).toBe(1);
    });
    expect(pat()).toMatchObject({ organizationId: "b", departmentId: null });
  });
});

