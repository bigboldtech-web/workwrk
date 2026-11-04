// Every walk and every reach reads THIS workspace's line
// (docs/plans/workspace-status-2.md E1, E2, E4, E5, step 2). Pat is anchored
// at her agency A, where she reports to Max, and works for client B through
// a membership, where Dana leads her; she has a dotted line to Kai in A and
// to Lee in B. Max contracts for B as a Manager there, and Kai works in B
// too. Each read answers A's line in A and B's in B, before and after Pat
// switches, and never the other workspace's. Run on the in-memory database
// through the real reads (manager-lines.ts, manager-candidate.ts,
// membership.ts, digest-recipients.ts, review-cycle.server.ts,
// teams-counts.ts, weekly-review.ts, alignment-scope.ts); the raw walks of
// team.ts and reporting-line.ts are held by report-tree-seat.test.ts and
// were run on Postgres (the plan's "Step 2, built").
//
// Before: every one of these read User.managerId, the account's line, and
// every workspace's dotted rows, so in B Pat was Max's report, Max "had
// reports", B's rule 6 counted Pat against making Max an Agent, Pat's B
// digest, review, weekly review and unattended work went to Max, and a B
// edit was refused as a loop through Pat's line in A.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));

import { seatDb as db } from "./seat-test-db";
import { reanchorUser } from "./workspace-anchor";
import {
  agentsWithStoredReports,
  countedDottedManagerIds,
  countedDottedReportIds,
  effectiveDirectReportIds,
  effectiveManagerOf,
  effectiveManagersOf,
  effectiveReportsOfMany,
  lineFactsAround,
} from "./manager-lines";
import { lineAbove, managerCandidateIn, wouldLoopIn } from "./manager-candidate";
import { reportCountOf, unattendedRecipient } from "./membership";
import { digestManagersOf } from "./digest-recipients";
import { reviewWritersIn } from "@/lib/performance/review-cycle.server";
import { hasReportsFor } from "@/lib/people/teams-counts";
import { managerQueueWhereFor } from "@/lib/weekly-review";
import { goalRightsActor } from "@/lib/alignment-scope";

const person = (id: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  db.seed("user", { id, email: `${id}@x.test`, firstName: id, lastName: "Lee", organizationId, accessLevel: "EMPLOYEE", status: "ACTIVE", managerId: null, ...extra });
const membership = (userId: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role: "EMPLOYEE", status: "ACTIVE", ...extra });
const dotted = (userId: string, managerId: string, organizationId: string) =>
  db.seed("userDottedLine", { id: `d-${userId}-${managerId}-${organizationId}`, userId, managerId, organizationId });
const seatOf = (userId: string, organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId)!;

/**
 * Pat switches into B (reanchorUser's swap, E3): B's line comes onto her
 * account and A's goes onto her A membership. Her B membership is then the
 * anchored workspace's own stale row, which the swap leaves as it was; it is
 * set to another manager (`stale`), so a reader that took that row, or the
 * account in A, answers wrong (the step 2 review L3).
 */
async function patSwitchesToB(stale: string) {
  expect(await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
  expect(db.row("user", "pat")).toMatchObject({ organizationId: "b", managerId: "dana" });
  expect(seatOf("pat", "a")).toMatchObject({ managerId: "max" });
  seatOf("pat", "b").managerId = stale;
}

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  // A: Ada owns it; Max manages Pat; Kai is Pat's dotted-line manager there.
  person("ada", "a", { accessLevel: "COMPANY_ADMIN" });
  person("max", "a", { accessLevel: "MANAGER" });
  person("kai", "a", { accessLevel: "MANAGER" });
  // B: Bo owns it; Dana leads Pat there, Lee is her dotted-line manager there.
  person("bo", "b", { accessLevel: "COMPANY_ADMIN" });
  person("dana", "b", { accessLevel: "MANAGER" });
  person("lee", "b", { accessLevel: "MANAGER" });
  // Max contracts for B as a Manager; Kai works in B too.
  membership("max", "b", { role: "MANAGER" });
  membership("kai", "b", { role: "MANAGER" });
  // Pat: A's line on her account, B's on her membership (E1); a dotted line in each (E2).
  person("pat", "a", { managerId: "max" });
  membership("pat", "b", { managerId: "dana" });
  dotted("pat", "kai", "a");
  dotted("pat", "lee", "b");
});

describe("the manager each read names (effectiveManagersOf: the reviewer, the approver, the weekly-review manager)", () => {
  it("answers Max in A and Dana in B, before and after Pat switches", async () => {
    // Before: Max in B too, through her account's line.
    expect(await effectiveManagerOf("a", "pat")).toBe("max");
    expect(await effectiveManagerOf("b", "pat")).toBe("dana");
    // The stale B row names Lee: B still answers Dana (the account), A Max (A's membership).
    await patSwitchesToB("lee");
    expect(await effectiveManagerOf("a", "pat")).toBe("max");
    expect(await effectiveManagerOf("b", "pat")).toBe("dana");
    expect(Object.fromEntries(await effectiveManagersOf("b", ["pat"]))).toEqual({ pat: "dana" });
  });

  it("never names a manager whose seat here ended", async () => {
    // Rae is anchored in A under Ada and works in B under Rita (her
    // membership's line); Rita works in B through a membership too.
    person("rita", "a");
    membership("rita", "b", { role: "MANAGER" });
    person("rae", "a", { managerId: "ada" });
    membership("rae", "b", { managerId: "rita" });
    // Before: Ada, through Rae's account line (and then nobody, Ada holding no seat in B).
    expect(await effectiveManagerOf("b", "rae")).toBe("rita");
    seatOf("rita", "b").status = "INACTIVE";
    expect(await effectiveManagerOf("b", "rae")).toBeNull();
    seatOf("rita", "b").status = "ACTIVE";
    seatOf("rita", "b").removedAt = new Date("2026-10-01");
    expect(await effectiveManagerOf("b", "rae")).toBeNull();
  });
});

describe("who reports to someone here (the walks down)", () => {
  it("Dana has Pat in B, Max has her in A only", async () => {
    // Before: Max had Pat in B through her line in A, and Dana did not.
    expect(await effectiveDirectReportIds("b", "dana")).toEqual(["pat"]);
    expect(await effectiveDirectReportIds("b", "max")).toEqual([]);
    expect(await effectiveDirectReportIds("a", "max")).toEqual(["pat"]);
    const many = await effectiveReportsOfMany("b", ["dana", "max"]);
    expect([many.get("dana"), many.get("max")]).toEqual([["pat"], []]);
  });

  it("the handover's line facts hold B's line in B and A's in A", async () => {
    // Before: lineFactsAround read Pat under Max in B and never under Dana.
    expect((await lineFactsAround("b", "dana", [])).get("pat")).toEqual({ managerId: "dana", agent: false, inactive: false });
    expect((await lineFactsAround("b", "max", [])).has("pat")).toBe(false);
    expect((await lineFactsAround("a", "max", [])).get("pat")).toEqual({ managerId: "max", agent: false, inactive: false });
    // Walking up from Pat in B climbs B's line.
    expect((await lineFactsAround("b", "lee", ["pat"])).get("pat")?.managerId).toBe("dana");
  });

  it("an Agent's stored reports here are this workspace's", async () => {
    // B makes Max an Agent (his B seat): nobody reports to him in B.
    seatOf("max", "b").role = "AGENT";
    // Before: Pat, through her line in A.
    expect((await agentsWithStoredReports("b", ["max"])).has("max")).toBe(false);
  });

  it("the Teams badge and the goal rules see the reports here", async () => {
    // Before: Max "had reports" in B through Pat's A line.
    expect(await hasReportsFor("max", "b")).toBe(false);
    expect(await hasReportsFor("dana", "b")).toBe(true);
    expect(await hasReportsFor("max", "a")).toBe(true);
    // Eve, a Member in B, leads Zia there through Zia's membership's line.
    person("eve", "b");
    person("zia", "a", { managerId: "max" });
    membership("zia", "b", { managerId: "eve" });
    // Before: only people anchored in B counted, so Eve led nobody.
    const actor = await goalRightsActor({ user: { id: "eve", organizationId: "b", accessLevel: "EMPLOYEE" } });
    expect(actor.leadsPeople).toBe(true);
  });

  it("the weekly-review queue holds the people who report here", async () => {
    const ids = (where: unknown) => JSON.stringify(where);
    // Before: { user: { managerId: "dana" } }, the account's line, which names Max for Pat.
    expect(ids(await managerQueueWhereFor("dana", "b"))).toContain('"userId":{"in":["pat"]}');
    expect(ids(await managerQueueWhereFor("max", "b"))).not.toContain('"pat"');
    expect(ids(await managerQueueWhereFor("max", "a"))).toContain('"userId":{"in":["pat"]}');
  });
});

describe("the dotted lines are each workspace's own (E2)", () => {
  it("Kai counts in A and Lee in B; A's row never counts in B, though Kai works in B too", async () => {
    // Before: every workspace's rows, so Kai was Pat's dotted manager in B.
    expect(await countedDottedManagerIds("a", "pat")).toEqual(["kai"]);
    expect(await countedDottedManagerIds("b", "pat")).toEqual(["lee"]);
    expect(await countedDottedReportIds("b", "kai")).toEqual([]);
    expect(await countedDottedReportIds("a", "kai")).toEqual(["pat"]);
    expect(await countedDottedReportIds("b", "lee")).toEqual(["pat"]);
  });
});

describe("rule 6 counts this workspace's reports", () => {
  it("B may make Max an Agent: nobody reports to him in B", async () => {
    // Before: 1 in B (Pat's A line), so B could not.
    expect(await reportCountOf(db.prisma as never, "b", "max")).toBe(0);
    expect(await reportCountOf(db.prisma as never, "a", "max")).toBe(1);
    expect(await reportCountOf(db.prisma as never, "b", "dana")).toBe(1);
    // A dotted line counts in its own workspace only.
    expect(await reportCountOf(db.prisma as never, "b", "kai")).toBe(0);
    expect(await reportCountOf(db.prisma as never, "a", "kai")).toBe(1);
  });

  it("still counts them after Pat switches into B", async () => {
    // The stale B row names Kai, who works in B: he still has nobody there.
    await patSwitchesToB("kai");
    expect(await reportCountOf(db.prisma as never, "b", "max")).toBe(0);
    expect(await reportCountOf(db.prisma as never, "a", "max")).toBe(1);
    expect(await reportCountOf(db.prisma as never, "b", "dana")).toBe(1);
    expect(await reportCountOf(db.prisma as never, "b", "kai")).toBe(0);
  });
});

describe("the unattended recipient and the digest manager", () => {
  it("give Pat's B work and B digest to Dana, and her A ones to Max", async () => {
    // Before: Max in B, who holds a Manager's seat there.
    expect(await unattendedRecipient("b", "pat")).toBe("dana");
    expect(await unattendedRecipient("a", "pat")).toBe("max");
    expect((await digestManagersOf("b", ["pat"])).get("pat")?.id).toBe("dana");
    expect((await digestManagersOf("a", ["pat"])).get("pat")?.id).toBe("max");
    // The stale B row names Lee, a live Manager in B: still Dana in B, Max in A, both reads (L3, L6).
    await patSwitchesToB("lee");
    expect(await unattendedRecipient("b", "pat")).toBe("dana");
    expect(await unattendedRecipient("a", "pat")).toBe("max");
    expect((await digestManagersOf("b", ["pat"])).get("pat")?.id).toBe("dana");
    expect((await digestManagersOf("a", ["pat"])).get("pat")?.id).toBe("max");
  });

  it("walk past a manager whose seat here ended, by that manager's own line here", async () => {
    // Dana works in A too, deactivated there, and reports to Kai in A.
    membership("dana", "a", { role: "MANAGER", status: "INACTIVE", managerId: "kai" });
    // For this case Pat reports to Dana in A (A's line, on Pat's account).
    db.row("user", "pat").managerId = "dana";
    // Before: Dana's account line (none) ended the walk at A's first Owner.
    expect(await unattendedRecipient("a", "pat")).toBe("kai");
  });
});

describe("the reviewer a review names", () => {
  it("is Dana in B and Max in A, never the launch stamp of the other workspace's manager", async () => {
    const open = { status: "PENDING", cycleStatus: "ACTIVE" };
    // Before: Max wrote Pat's B review, through her line in A.
    expect((await reviewWritersIn("b", [{ id: "r-b", subjectId: "pat", reviewerId: "max", ...open }])).get("r-b")).toBe("dana");
    expect((await reviewWritersIn("a", [{ id: "r-a", subjectId: "pat", reviewerId: "dana", ...open }])).get("r-a")).toBe("max");
  });

  it("lets someone with no line here write their own, whatever line their account holds elsewhere", async () => {
    // Zoe is anchored in A under Max and works in B with no manager there: B's launch stamped her as her own reviewer.
    person("zoe", "a", { managerId: "max" });
    membership("zoe", "b");
    const open = { status: "PENDING", cycleStatus: "ACTIVE" };
    // Before: her account's line (Max) made her "managed", so nobody wrote it.
    expect((await reviewWritersIn("b", [{ id: "r-z", subjectId: "zoe", reviewerId: "zoe", ...open }])).get("r-z")).toBe("zoe");
    expect((await reviewWritersIn("a", [{ id: "r-za", subjectId: "zoe", reviewerId: "zoe", ...open }])).get("r-za")).toBe("max");
  });
});

describe("the loop checks run per workspace (E5)", () => {
  it("B may make Max report to Pat, since in B Pat reports to Dana; A may not", async () => {
    // Before: refused in B, through Pat's line to Max in A (and telling B how A is organised).
    expect(await wouldLoopIn("b", "max", "pat")).toBe(false);
    expect(await wouldLoopIn("a", "max", "pat")).toBe(true);
  });

  it("sees a loop through a membership's line in B", async () => {
    // Pat reports to Dana in B by her membership: Dana reporting to Pat in B closes a loop.
    // Before: the walk climbed Pat's account line to Max and missed it.
    expect([...(await lineAbove("b", "pat"))].sort()).toEqual(["dana", "pat"]);
    expect(await wouldLoopIn("b", "dana", "pat")).toBe(true);
    expect(await wouldLoopIn("a", "dana", "pat")).toBe(false);
  });

  it("holds after Pat switches into B", async () => {
    // The stale B row names Lee: Lee reporting to Pat in B closes no loop (her B line is Dana's).
    await patSwitchesToB("lee");
    expect(await wouldLoopIn("b", "max", "pat")).toBe(false);
    expect(await wouldLoopIn("b", "lee", "pat")).toBe(false);
    expect(await wouldLoopIn("b", "dana", "pat")).toBe(true);
    expect(await wouldLoopIn("a", "max", "pat")).toBe(true);
    expect([...(await lineAbove("a", "pat"))].sort()).toEqual(["max", "pat"]);
  });
});

describe("a new manager here is read at the seat here (E4)", () => {
  it("someone B deactivated through their membership is refused as deactivated, never as not in this workspace", async () => {
    person("rita", "a");
    membership("rita", "b", { role: "MANAGER", status: "INACTIVE" });
    // Before: "not_found" ("That person isn't in this workspace"), though she is, deactivated.
    expect(await managerCandidateIn("b", "rita", { live: true })).toBe("inactive");
    seatOf("rita", "b").status = "ACTIVE";
    expect(await managerCandidateIn("b", "rita", { live: true })).toBe("ok");
    seatOf("rita", "b").removedAt = new Date("2026-10-01");
    expect(await managerCandidateIn("b", "rita", { live: true })).toBe("not_found");
  });
});
