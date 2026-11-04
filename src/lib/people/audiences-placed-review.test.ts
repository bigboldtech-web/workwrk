// The step 8 review fixes (docs/plans/workspace-status-2.md, "Step 8, review
// fixes"): the doors the step left out, each now reading the audience at the
// seat here, and the step 5 M1 holds, by behaviour. Run on the in-memory
// database (seat-test-db.ts), through the real routes and helpers.
//
// The case is audiences-placed.test.ts's: Pat anchored at A and placed in
// B's Design (a Designer, Leeds) through a live membership; Lee anchored in
// B in Design; Rita placed in B's Design and deactivated by B; Rex placed
// there and removed by B; Bo owns B; Dana is a Manager in B. B's
// "Leadership" tag is held by Pat, Lee, Rita and Rex.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  me: "bo",
  level: "SUPER_ADMIN",
  org: "b",
  team: [] as string[],
  /** Who each email went to, by user id. */
  emailed: [] as string[],
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession(st.me, st.level, st.org) }));
vi.mock("next-auth/next", () => ({ getServerSession: async () => legacyTestSession(st.me, st.level, st.org) }));
vi.mock("next-auth/jwt", () => ({ getToken: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: legacyTestSession(st.me, st.level, st.org) }),
  getOrgId: () => st.org,
  getUserId: () => st.me,
  hasPermission: async () => st.level === "SUPER_ADMIN" || st.level === "COMPANY_ADMIN",
}));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => st.team }));
vi.mock("@/lib/process-scope", async (orig) => ({
  ...(await orig<typeof import("@/lib/process-scope")>()),
  personScope: async () => ({ canView: true, orgWide: true, userIds: null }),
  inScope: () => true,
}));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined, logAuditEvent: async () => undefined }));
vi.mock("@/lib/email", () => ({
  sendEmail: async (a: { userId?: string }) => { if (a.userId) st.emailed.push(a.userId); },
  queueEmail: async () => undefined,
  processEmailQueue: async () => undefined,
}));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { membershipPlacedCounts } from "@/lib/access/profile-here";
import { resolveAnnouncementAudienceUserIds } from "@/lib/announcement-audience";
import { POST as surveysRotate } from "@/app/api/cron/surveys-rotate/route";
import { PATCH as editPolicy } from "@/app/api/policies/[id]/route";
import { POST as remindPending } from "@/app/api/policies/[id]/assignments/remind/route";
import { POST as remindOne } from "@/app/api/policies/[id]/assignments/[assignmentId]/remind/route";
import { remindPolicyAssignmentsDue } from "@/lib/policy-remind";
import { POST as sendReminders } from "@/app/api/email/send-reminders/route";
import { surveyAudienceStats } from "@/lib/performance/survey.server";
import { GET as surveyResults } from "@/app/api/pulse-surveys/[id]/responses/route";
import { GET as surveyExport } from "@/app/api/pulse-surveys/[id]/responses/export/route";
import { POST as assignSop } from "@/app/api/sop-assignments/route";
import { GET as role } from "@/app/api/roles/[id]/route";
import { GET as launchPreview } from "@/app/api/reviews/[id]/launch/route";
import { seedKraToRoleHolders } from "@/lib/alignment-assign";
import { GET as departments } from "@/app/api/departments/route";
import { POST as assignPolicy } from "@/app/api/policies/[id]/assignments/route";
import { notifyCandorOpen } from "@/lib/performance/candor.server";

const req = (url: string, init?: RequestInit) => new NextRequest(`https://app.test${url}`, init as ConstructorParameters<typeof NextRequest>[1]);
const json = async (res: Response | undefined) => (await res!.json()) as Record<string, unknown>;
const post = (url: string, body: unknown) => req(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const patch = (url: string, body: unknown) => req(url, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (me: string, level: string, org: string) => {
  st.me = me;
  st.level = level;
  st.org = org;
};
const sorted = (ids: Iterable<string>) => [...ids].sort();
/** Who was told, by notification row of this type. */
const told = (type: string, title?: string) =>
  sorted(new Set(db.tables.notification?.filter((n) => n.type === type && (!title || String(n.title).startsWith(title))).map((n) => n.userId as string) ?? []));

function person(id: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", organizationId,
    ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE", deletedAt: null, phone: null, managerId: null,
    departmentId: null, roleId: null, officeId: null, joinDate: new Date("2025-01-01"), createdAt: new Date("2025-01-01"),
    presenceStatus: null, presenceUntil: null, orgRole: null, ...over,
  });
}
function seat(userId: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, createdAt: new Date("2026-06-01"), ...over });
}
const DESIGN = { departmentId: "dep-b-design", roleId: "role-b-designer", officeId: "off-b-leeds" };
const DAY = 86_400_000;

beforeEach(() => {
  db.reset();
  db.onQueryRaw = () => [];
  as("bo", "SUPER_ADMIN", "b");
  st.team = [];
  st.emailed = [];
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, settings: {}, status: "ACTIVE" });
  db.seed("department", { id: "dep-a-ops", name: "Operations", color: null, organizationId: "a", parentId: null, headId: null });
  db.seed("department", { id: "dep-b-design", name: "Design", color: null, organizationId: "b", parentId: null, headId: null });
  db.seed("role", { id: "role-b-designer", title: "Designer", level: "EMPLOYEE", description: null, organizationId: "b", departmentId: null });
  db.seed("office", { id: "off-b-leeds", name: "Leeds", organizationId: "b", isHeadquarters: true, city: null, country: null });
  db.seed("tag", { id: "tag-lead", name: "Leadership", organizationId: "b", archived: false });

  person("ari", "a", { ...legacyLevelRow("SUPER_ADMIN") });
  person("pat", "a", { departmentId: "dep-a-ops" });
  seat("pat", "b", { role: "EMPLOYEE", ...DESIGN, managerId: "dana" });
  person("bo", "b", { ...legacyLevelRow("SUPER_ADMIN") });
  person("dana", "b", { ...legacyLevelRow("MANAGER") });
  person("lee", "b", { ...DESIGN, managerId: "dana" });
  person("rita", "a");
  seat("rita", "b", { status: "INACTIVE", ...DESIGN });
  person("rex", "a");
  seat("rex", "b", { status: "INACTIVE", removedAt: new Date("2026-10-01"), ...DESIGN });
  for (const userId of ["pat", "lee", "rita", "rex"]) db.seed("tagAssignment", { id: `ta-${userId}`, organizationId: "b", entityType: "USER", entityId: userId, tagId: "tag-lead" });
});

describe("M1: the recurring survey cron reads the one survey audience", () => {
  it("a later round of B's Design pulse tells Pat, and a tag survey's closing reminder never tells Rita or Rex", async () => {
    const now = Date.now();
    const base = { organizationId: "b", anonymous: true, createdById: "bo", officeIds: [], userIds: [], questions: [{ id: "q1", text: "How is it going?", type: "rating" }], reminderSentAt: null };
    db.seed("pulseSurvey", { ...base, id: "sv-monthly", title: "Design pulse", status: "ACTIVE", frequency: "MONTHLY", closesAt: new Date(now - DAY), audienceType: "DEPARTMENTS", departmentIds: ["dep-b-design"], tagIds: [] });
    db.seed("pulseSurvey", { ...base, id: "sv-lead", title: "Leadership check-in", status: "ACTIVE", frequency: null, closesAt: new Date(now + DAY / 2), audienceType: "TAGS", departmentIds: [], tagIds: ["tag-lead"] });
    const res = await surveysRotate(req("/api/cron/surveys-rotate", { method: "POST" }));
    expect(res.status).toBe(200);
    const round = db.tables.pulseSurvey.find((s) => s.parentSurveyId === "sv-monthly")!;
    expect(round).toBeDefined();
    const roundTold = sorted(new Set(db.tables.notification.filter((n) => n.link === `/surveys/${round.id}`).map((n) => n.userId as string)));
    expect(roundTold).toEqual(["lee", "pat"]);
    const closingTold = sorted(new Set(db.tables.notification.filter((n) => n.link === "/surveys/sv-lead").map((n) => n.userId as string)));
    expect(closingTold).toEqual(["lee", "pat"]);
  });
});

describe("M2: every policy notice from assignment rows tells only a seat here that can be told", () => {
  beforeEach(() => {
    const base = { organizationId: "b", content: "Be kind", category: null, requiresAck: true, version: 1, ackVersion: 1, effectiveDate: null, createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01") };
    db.seed("policy", { ...base, id: "pol-code", title: "Code of conduct", status: "PUBLISHED" });
    db.seed("policy", { ...base, id: "pol-draft", title: "Travel policy", status: "DRAFT" });
    const due = new Date(Date.now() + 2 * DAY);
    for (const policyId of ["pol-code", "pol-draft"]) {
      for (const userId of ["pat", "lee", "rita", "rex"]) {
        db.seed("policyAssignment", { id: `pa-${policyId}-${userId}`, policyId, userId, status: "ASSIGNED", mandatory: true, dueDate: due, completedAt: null, createdAt: new Date("2026-10-01"), assignedBy: "bo" });
      }
    }
  });

  it("a version bump and a publish tell Pat and Lee, never Rita or Rex, and every row still reopens", async () => {
    db.row("policyAssignment", "pa-pol-code-rita").status = "COMPLETED";
    expect((await editPolicy(patch("/api/policies/pol-code", { requireReack: true }), params("pol-code")))!.status).toBe(200);
    expect(told("policy.reacknowledge")).toEqual(["lee", "pat"]);
    expect(db.row("policyAssignment", "pa-pol-code-rita").status).toBe("ASSIGNED");
    expect((await editPolicy(patch("/api/policies/pol-draft", { status: "PUBLISHED" }), params("pol-draft")))!.status).toBe(200);
    expect(told("policy_published")).toEqual(["lee", "pat"]);
  });

  it("Remind everyone pending, one person's Remind and the due-soon pass tell only Pat and Lee", async () => {
    expect(await json(await remindPending(post("/api/policies/pol-code/assignments/remind", {}), params("pol-code")))).toEqual({ reminded: 2 });
    expect(told("policy.assigned", "Reminder")).toEqual(["lee", "pat"]);
    expect(sorted(st.emailed)).toEqual(["lee", "pat"]);
    const one = await remindOne(post("/api/policies/pol-code/assignments/pa-pol-code-rita/remind", {}), { params: Promise.resolve({ id: "pol-code", assignmentId: "pa-pol-code-rita" }) });
    expect(await json(one)).toEqual({ reminded: 0 });
    db.tables.notification.length = 0;
    st.emailed = [];
    db.row("organization", "b").settings = { process: { ackRemindDays: 7 } };
    const r = await remindPolicyAssignmentsDue();
    expect(r.reminded).toBe(2);
    expect(told("policy.assigned", "Reminder")).toEqual(["lee", "pat"]);
  });
});

describe("M3: a tag's announcement audience is read at the seat here", () => {
  it("B's announcement to Leadership reaches Pat and Lee, and never Rita or Rex, who still hold the tag", async () => {
    expect(sorted(await resolveAnnouncementAudienceUserIds("b", { type: "TAGS", ids: ["tag-lead"] }))).toEqual(["lee", "pat"]);
  });
});

describe("L1: the weekly policy reminder reads the policy's audience in both halves", () => {
  it("a policy for everyone reminds Pat; one assigned to Lee reminds Lee only; nobody B ended is emailed", async () => {
    const base = { organizationId: "b", content: "Read", category: null, status: "PUBLISHED", requiresAck: true, version: 1, ackVersion: 1, effectiveDate: null, createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01") };
    db.seed("policy", { ...base, id: "pol-all", title: "For everyone" });
    db.seed("policy", { ...base, id: "pol-lee", title: "For Lee" });
    db.seed("policyAssignment", { id: "pa-lee", policyId: "pol-lee", userId: "lee", status: "ASSIGNED", mandatory: true, dueDate: null, completedAt: null, createdAt: new Date("2026-10-01"), assignedBy: "bo" });
    db.seed("policyAssignment", { id: "pa-rita", policyId: "pol-lee", userId: "rita", status: "ASSIGNED", mandatory: true, dueDate: null, completedAt: null, createdAt: new Date("2026-10-01"), assignedBy: "bo" });
    db.seed("policyAcknowledgment", { id: "ack-bo", policyId: "pol-all", userId: "bo", version: 1, acknowledgedAt: new Date("2026-10-02") });
    const res = await sendReminders(post("/api/email/send-reminders", { type: "policy-ack" }));
    expect(res.status).toBe(200);
    // For everyone: Dana, Lee and Pat (Bo acknowledged); for Lee's: Lee alone.
    expect([...st.emailed].sort()).toEqual(["dana", "lee", "lee", "pat"]);
  });
});

describe("L2 and L3: the counts read no person's row", () => {
  it("the survey list counts an audience by the two halves, and the Settings counts group the memberships", async () => {
    const before = db.log.length;
    expect(await surveyAudienceStats("b", { id: "sv-x", audienceType: "DEPARTMENTS", departmentIds: ["dep-b-design"], officeIds: [], userIds: [], tagIds: [] })).toEqual({ audienceSize: 2, totalResponses: 0, responseRate: 0 });
    const reads = db.log.slice(before);
    expect(reads).toEqual(expect.arrayContaining(["user.count", "organizationMembership.count"]));
    expect(reads).not.toContain("user.findMany");
    expect(reads).not.toContain("organizationMembership.findMany");
    const at = db.log.length;
    expect([...(await membershipPlacedCounts("b", "departmentId"))]).toEqual([["dep-b-design", 2]]);
    expect(db.log.slice(at)).toEqual(["organizationMembership.groupBy"]);
  });
});

describe("L6: a named survey names a respondent here through a membership", () => {
  beforeEach(() => {
    db.seed("pulseSurvey", { id: "sv-named", organizationId: "b", title: "Named", status: "ACTIVE", anonymous: false, createdById: "bo", audienceType: "DEPARTMENTS", departmentIds: ["dep-b-design"], officeIds: [], userIds: [], tagIds: [], questions: [{ id: "q1", text: "What should change?", type: "text" }], createdAt: new Date("2026-10-01"), closedAt: null });
    db.seed("surveyResponse", { id: "r-pat", surveyId: "sv-named", userId: "pat", answers: [{ questionId: "q1", value: "More pairing" }], createdAt: new Date("2026-10-02") });
    db.seed("surveyResponse", { id: "r-lee", surveyId: "sv-named", userId: "lee", answers: [{ questionId: "q1", value: "Fewer meetings" }], createdAt: new Date("2026-10-03") });
  });

  it("the results and the export name Pat under B's Design, and the Design segment holds her", async () => {
    const results = (await json(await surveyResults(req("/api/pulse-surveys/sv-named/responses?departmentId=dep-b-design"), params("sv-named")))) as { totalResponses: number };
    expect(results.totalResponses).toBe(2);
    expect(JSON.stringify(results)).toContain('"respondent":{"id":"pat","name":"Pat Ng","office":{"id":"off-b-leeds","name":"Leeds"},"department":{"id":"dep-b-design","name":"Design"}}');
    const csv = await (await surveyExport(req("/api/pulse-surveys/sv-named/responses/export?departmentId=dep-b-design"), params("sv-named")))!.text();
    expect(csv).toMatch(/Pat Ng/);
    expect(csv).toMatch(/pat@x\.test/);
    expect(csv).toMatch(/Lee Ng/);
  });
});

describe("L7: a job title's holders' addresses go only to readers of their people data", () => {
  it("Bo reads every holder's address; Lee only her own, for both kinds", async () => {
    const emails = async () => {
      const body = (await json(await role(req("/api/roles/role-b-designer"), params("role-b-designer")))) as { role: { users: Array<{ id: string; email: string }> } };
      return Object.fromEntries(body.role.users.map((u) => [u.id, u.email]));
    };
    expect(await emails()).toEqual({ lee: "lee@x.test", pat: "pat@x.test", rita: "rita@x.test" });
    as("lee", "EMPLOYEE", "b");
    expect(await emails()).toEqual({ lee: "lee@x.test", pat: "", rita: "" });
  });
});

describe("L8: an account ended where it is anchored, and the step 5 M1 holds", () => {
  it("Pat is in B's Design audiences while her account lives, and in none once A deactivates her account", async () => {
    const design = { type: "DEPARTMENTS" as const, ids: ["dep-b-design"] };
    expect(sorted(await resolveAnnouncementAudienceUserIds("b", design))).toEqual(["lee", "pat"]);
    db.row("user", "pat").status = "INACTIVE";
    expect(sorted(await resolveAnnouncementAudienceUserIds("b", design))).toEqual(["lee"]);
    expect(sorted(await resolveAnnouncementAudienceUserIds("b", { type: "TAGS", ids: ["tag-lead"] }))).toEqual(["lee"]);
    expect(await surveyAudienceStats("b", { id: "sv-y", audienceType: "DEPARTMENTS", departmentIds: ["dep-b-design"], officeIds: [], userIds: [], tagIds: [] })).toEqual({ audienceSize: 1, totalResponses: 0, responseRate: 0 });
    await notifyCandorOpen({ id: "cs-1", title: "Retro", description: null, departmentId: "dep-b-design" }, "b", "bo");
    expect(told("candor_open")).toEqual(["lee"]);
    db.seed("policy", { id: "pol-d", organizationId: "b", title: "Design rules", content: "Read", category: null, status: "PUBLISHED", requiresAck: true, version: 1, ackVersion: 1, effectiveDate: null, createdAt: new Date(), updatedAt: new Date() });
    expect((await assignPolicy(post("/api/policies/pol-d/assignments", { departmentId: "dep-b-design" }), params("pol-d")))!.status).toBe(201);
    expect(db.tables.policyAssignment.map((a) => a.userId)).toEqual(["lee"]);
    // A count keeps her kept seat (the delete still refuses by it), as for a deactivated person anchored here.
    const rows = (await (await departments(req("/api/departments?fresh=1")))!.json()) as Array<{ id: string; _count: { members: number } }>;
    expect(rows.find((d) => d.id === "dep-b-design")!._count.members).toBe(3);
  });

  it("no KRA is seeded, no SOP assigned and no review launched for Pat by B's placement of her; the SOP answer says so", async () => {
    db.seed("kRA", { id: "kra-1", organizationId: "b", name: "Ship designs", roleId: "role-b-designer", weight: 20 });
    expect(await seedKraToRoleHolders({ kraId: "kra-1", roleId: "role-b-designer", organizationId: "b" })).toEqual({ peopleSeeded: 1 });
    expect(db.tables.kRAAssignment.map((a) => a.userId)).toEqual(["lee"]);

    db.seed("sOP", { id: "sop-1", organizationId: "b", title: "Brand checks", category: null, sopType: "CHECKLIST", status: "PUBLISHED", content: {} });
    const res = await assignSop(post("/api/sop-assignments", { sopId: "sop-1", departmentId: "dep-b-design" }));
    expect(res!.status).toBe(201);
    expect(db.tables.sOPAssignment.map((a) => a.userId)).toEqual(["lee"]);
    expect(await json(res)).toMatchObject({
      count: 1,
      notAssignedElsewhere: 1,
      // Said once (the final review, product L8).
      alignmentNote: "1 person who works here from another workspace's account was not assigned, since KRAs and SOPs are not assigned to people who do.",
    });
    // Everyone: the same, Pat named in the count (Rita and Rex were never live here).
    expect(await json(await assignSop(post("/api/sop-assignments", { sopId: "sop-1", all: true })))).toMatchObject({ notAssignedElsewhere: 1 });
    expect(db.tables.sOPAssignment.map((a) => a.userId).sort()).toEqual(["bo", "dana", "lee"]);

    db.seed("reviewCycle", { id: "rc-1", organizationId: "b", name: "H2", type: "ANNUAL", status: "DRAFT", audienceType: "DEPARTMENTS", departmentIds: ["dep-b-design"], userIds: [], createdById: "bo", startDate: new Date(), endDate: new Date() });
    expect(await json(await launchPreview(req("/api/reviews/rc-1/launch"), params("rc-1")))).toMatchObject({ count: 1 });
  });
});

// The final review of workspace-status-2, product L4: a launch still
// reviews the people anchored here only, and its confirm now says how many
// people here from another workspace's account it leaves out, and why.
describe("a review launch says whom it leaves out", () => {
  const cycle = (id: string, audienceType: string, extra: Record<string, unknown> = {}) =>
    db.seed("reviewCycle", { id, organizationId: "b", name: "H2", type: "ANNUAL", status: "DRAFT", audienceType, departmentIds: [], userIds: [], createdById: "bo", startDate: new Date(), endDate: new Date(), ...extra });

  it("counts Pat, placed in B's Design through her membership, for Design, for everyone and by name; never Rita or Rex, whom B ended", async () => {
    cycle("rc-d", "DEPARTMENTS", { departmentIds: ["dep-b-design"] });
    cycle("rc-all", "ALL");
    cycle("rc-pat", "USERS", { userIds: ["pat"] });
    // Before: { count: 1 } and nothing said of Pat.
    expect(await json(await launchPreview(req("/api/reviews/rc-d/launch"), params("rc-d")))).toMatchObject({ count: 1, notReviewedElsewhere: 1 });
    expect(await json(await launchPreview(req("/api/reviews/rc-all/launch"), params("rc-all")))).toMatchObject({ notReviewedElsewhere: 1 });
    expect(await json(await launchPreview(req("/api/reviews/rc-pat/launch"), params("rc-pat")))).toMatchObject({ count: 0, notReviewedElsewhere: 1 });
    // Nobody is reviewed who was not before: the launch's own audience is unchanged.
    expect(db.tables.review ?? []).toEqual([]);
  });
});
