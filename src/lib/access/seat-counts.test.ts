// Counts and reads in src/lib/access that judged someone who works here
// through a membership by their ACCOUNT's status read this workspace's seat
// instead (docs/plans/workspace-status.md D12): the last-admin check of an
// account's erasure (self-facts.ts soleAdminWorkspaces), Security's "N of M
// admins enrolled" (role-counts.ts adminEnrolment). Run on the in-memory
// database. (How a reporting line stood in the person's other workspaces,
// acting-workspace.ts lineStandingsElsewhere, retired with
// workspace-status-2.md step 4: a line is one workspace's row since E1, E2.)

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "./test-fixtures";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));

import { seatDb as db } from "./seat-test-db";
import { soleAdminWorkspaces } from "./self-facts";
import { adminEnrolment } from "./role-counts";

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
