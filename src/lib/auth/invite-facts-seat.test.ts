// alreadyInOrg and liveAccountFor read a person's seat in each workspace
// (docs/plans/workspace-status.md step 2, D7 and D13). A membership this
// workspace ended (deactivated or removed here) is not "already a member":
// an invitation brings it back, and it comes back marked inactive for the
// callers that must not bring it back themselves. An account ended where it
// is anchored that still has a usable seat elsewhere can still sign in, so
// it is still "an account" for /join.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/access/manager-candidate", () => ({ managerCandidateIn: async () => "ok" }));

import { alreadyInOrg, liveAccountFor } from "./invite-facts.server";
import { seatDb as db } from "@/lib/access/seat-test-db";

beforeEach(() => {
  db.reset();
  for (const [id, status] of [["here", "ACTIVE"], ["home", "ACTIVE"], ["other", "TRIAL"], ["held", "SUSPENDED"]]) db.seed("organization", { id, name: id, status });
  db.seed("user", { id: "pat", email: "pat@x.test", organizationId: "home", createdAt: new Date("2025-01-01") });
});

describe("alreadyInOrg", () => {
  it("a live membership here is a member, an HR status too", async () => {
    db.seed("organizationMembership", { id: "m", userId: "pat", organizationId: "here", status: "PROBATION" });
    expect(await alreadyInOrg("Pat@X.test", "here")).toEqual({ member: true, inactive: false, removed: false, elsewhere: true });
  });

  it("a membership this workspace deactivated or removed is not a member, and says so", async () => {
    db.seed("organizationMembership", { id: "m", userId: "pat", organizationId: "here", status: "INACTIVE" });
    // Before: a member, so the invitation that would bring them back was refused.
    expect(await alreadyInOrg("pat@x.test", "here")).toEqual({ member: false, inactive: true, removed: false, elsewhere: true });
    db.row("organizationMembership", "m").removedAt = new Date("2026-10-01");
    expect(await alreadyInOrg("pat@x.test", "here")).toEqual({ member: false, inactive: true, removed: true, elsewhere: true });
  });

  it("an account anchored here is a member whatever its status, as before", async () => {
    db.row("user", "pat").organizationId = "here";
    db.row("user", "pat").status = "INACTIVE";
    expect(await alreadyInOrg("pat@x.test", "here")).toEqual({ member: true, inactive: true, removed: false, elsewhere: false });
  });

  // The step 2 review M2: User.deletedAt is the removal where the account is
  // anchored (D1), never here, so the seat here is read whatever it says.
  it("an account removed where it is anchored is judged by its seat here: live is a member, ended is inactive", async () => {
    const m = db.seed("organizationMembership", { id: "m", userId: "pat", organizationId: "here" });
    db.row("user", "pat").deletedAt = new Date("2026-10-01");
    // Before: no one, so POST /api/users made a second Pat here.
    expect(await alreadyInOrg("pat@x.test", "here")).toEqual({ member: true, inactive: false, removed: false, elsewhere: true });
    // Before: no one, so a Space editor's invitation made a new account for someone this workspace ended.
    m.status = "INACTIVE";
    expect(await alreadyInOrg("pat@x.test", "here")).toEqual({ member: false, inactive: true, removed: false, elsewhere: true });
  });

  it("an address with no seat here is no one, and an erased account's anonymised address never matches", async () => {
    expect(await alreadyInOrg("nobody@x.test", "here")).toEqual({ member: false, inactive: false, removed: false, elsewhere: false });
    db.seed("user", { id: "gone", email: "deleted-gone@workwrk.anon", organizationId: "home", status: "INACTIVE", deletedAt: new Date("2026-10-01") });
    db.seed("organizationMembership", { id: "m-gone", userId: "gone", organizationId: "here", status: "INACTIVE", removedAt: new Date("2026-10-01") });
    expect(await alreadyInOrg("pat@x.test", "here")).toEqual({ member: false, inactive: false, removed: false, elsewhere: false });
  });
});

describe("liveAccountFor", () => {
  it("is the live account, oldest first", async () => {
    db.seed("user", { id: "pat2", email: "PAT@x.test", organizationId: "other", createdAt: new Date("2026-01-01") });
    expect(await liveAccountFor("pat@x.test")).toEqual({ id: "pat", organizationId: "home" });
  });

  it("an account ended where it is anchored with a usable seat elsewhere is still an account (its sign-in moves it there)", async () => {
    db.row("user", "pat").status = "INACTIVE";
    db.seed("organizationMembership", { id: "m", userId: "pat", organizationId: "other" });
    // Before: none, so /join made a second account for the same mailbox.
    expect(await liveAccountFor("pat@x.test")).toEqual({ id: "pat", organizationId: "home" });
  });

  it("an account whose only usable seat is in a workspace a same-address account is anchored to is none (the repair could not move it; the step 2 review L5)", async () => {
    db.row("user", "pat").status = "INACTIVE";
    db.seed("organizationMembership", { id: "m", userId: "pat", organizationId: "other" });
    db.seed("user", { id: "twin", email: "Pat@X.test", organizationId: "other", status: "INACTIVE" });
    // Before: Pat, so /join said "Log in once" and the sign-in then refused him.
    expect(await liveAccountFor("pat@x.test")).toBeNull();
  });

  it("an account that can work nowhere is none: every other seat ended, suspended, or its own stale row", async () => {
    db.row("user", "pat").status = "INACTIVE";
    db.seed("organizationMembership", { id: "m1", userId: "pat", organizationId: "other", status: "INACTIVE" });
    db.seed("organizationMembership", { id: "m2", userId: "pat", organizationId: "held" });
    db.seed("organizationMembership", { id: "m3", userId: "pat", organizationId: "home" });
    expect(await liveAccountFor("pat@x.test")).toBeNull();
  });
});
