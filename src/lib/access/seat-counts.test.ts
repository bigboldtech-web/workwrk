// Counts and reads in src/lib/access that judged someone who works here
// through a membership by their ACCOUNT's status read this workspace's seat
// instead (docs/plans/workspace-status.md D12): the last-admin check of an
// account's erasure (self-facts.ts soleAdminWorkspaces), Security's "N of M
// admins enrolled" (role-counts.ts adminEnrolment) and how a reporting line
// stands in the person's other workspaces (acting-workspace.ts
// lineStandingsElsewhere). Run on the in-memory database.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "./test-fixtures";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));

import { seatDb as db } from "./seat-test-db";
import { soleAdminWorkspaces } from "./self-facts";
import { adminEnrolment } from "./role-counts";
import { lineKey, lineStandingsElsewhere } from "./acting-workspace";

const person = (id: string, organizationId: string, level: string, extra: Record<string, unknown> = {}) =>
  db.seed("user", { id, email: `${id}@x.test`, firstName: id, lastName: "Lee", organizationId, ...legacyLevelRow(level), createdAt: new Date("2026-01-01"), ...extra });
const seat = (userId: string, organizationId: string, role: string, extra: Record<string, unknown> = {}) =>
  db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role, createdAt: new Date("2026-02-01"), ...extra });

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b", "c"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
});

describe("soleAdminWorkspaces reads each workspace's seat (D12)", () => {
  beforeEach(() => {
    // Pat, anchored in A, is an Admin of B through a membership. Quinn, anchored in C, is B's other Admin through his.
    person("pat", "a", "EMPLOYEE");
    seat("pat", "b", "COMPANY_ADMIN");
    person("quinn", "c", "EMPLOYEE");
    seat("quinn", "b", "COMPANY_ADMIN");
  });

  it("finds a workspace left with no live admin once this account goes, the other admin deactivated there", async () => {
    expect(await soleAdminWorkspaces("pat")).toEqual([]);
    // B deactivated Quinn through his membership; his account is live in C.
    db.row("organizationMembership", "m-quinn-b").status = "INACTIVE";
    // Before: Quinn counted, so Pat's erasure was allowed and left B with nobody.
    expect(await soleAdminWorkspaces("pat")).toEqual(["b"]);
  });

  it("never names a workspace that ended this person's own seat", async () => {
    // B removed Pat, and Quinn has left B altogether.
    db.tables.organizationMembership = db.tables.organizationMembership.filter((m) => m.id !== "m-quinn-b");
    db.row("organizationMembership", "m-pat-b").removedAt = new Date("2026-10-01");
    db.row("organizationMembership", "m-pat-b").status = "INACTIVE";
    // Before: B was named, and Pat could not delete an account B had removed.
    expect(await soleAdminWorkspaces("pat")).toEqual([]);
  });
});

describe("adminEnrolment counts everyone who belongs here (D11, D12)", () => {
  it("counts the admins and people here through a live seat, with the account's second factor", async () => {
    person("bo", "b", "COMPANY_ADMIN", { mfaEnabled: true });
    person("ann", "b", "EMPLOYEE");
    person("cy", "a", "EMPLOYEE");
    seat("cy", "b", "COMPANY_ADMIN");
    person("dee", "a", "EMPLOYEE", { mfaEnabled: true });
    seat("dee", "b", "EMPLOYEE");
    // Ended here: counted nowhere.
    person("eve", "a", "EMPLOYEE", { mfaEnabled: true });
    seat("eve", "b", "COMPANY_ADMIN", { status: "INACTIVE" });
    // Before: { admins: 1, enrolled: 1, everyone: 2, everyoneEnrolled: 1 }, the people anchored here alone.
    expect(await adminEnrolment("b", "bo")).toEqual({ admins: 2, enrolled: 1, everyone: 4, everyoneEnrolled: 2, viewerEnrolled: true });
  });
});

describe("lineStandingsElsewhere reads the seats there (D12)", () => {
  beforeEach(() => {
    // Rae reports to Max. Both work in A (anchored) and in B through memberships; this workspace is A.
    person("max", "a", "MANAGER");
    seat("max", "b", "MANAGER");
    person("rae", "a", "EMPLOYEE", { managerId: "max" });
    seat("rae", "b", "EMPLOYEE");
  });
  const standing = async (opts: { leaving?: boolean } = {}) =>
    (await lineStandingsElsewhere("a", [{ personId: "rae", managerId: "max" }], db.prisma as never, opts)).get(lineKey({ personId: "rae", managerId: "max" }))?.standing;

  it("is relied on where both hold live seats, and still where the person is only deactivated", async () => {
    expect(await standing()).toBe("relied");
    db.row("organizationMembership", "m-rae-b").status = "INACTIVE";
    expect(await standing()).toBe("relied");
  });

  it("is relied on nowhere once that workspace removed the person", async () => {
    db.row("organizationMembership", "m-rae-b").removedAt = new Date("2026-10-01");
    // Before: "relied", B's removed seat still counted.
    expect(await standing()).toBeUndefined();
  });

  it("is relied on nowhere when that workspace ended the manager's seat, unless the manager is the one leaving", async () => {
    db.row("organizationMembership", "m-max-b").status = "INACTIVE";
    // Before: "relied", Max's role there read whatever his seat.
    expect(await standing()).toBeUndefined();
    expect(await standing({ leaving: true })).toBe("relied");
  });
});
