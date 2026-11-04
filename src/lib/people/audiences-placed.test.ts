// Audiences and counts by department, job title, office or the whole
// workspace include the people placed there through a membership
// (docs/plans/workspace-status-2.md E15, step 8). Run on the in-memory
// database (seat-test-db.ts), through the real routes and helpers.
//
// The case: Pat is anchored at her agency A, in A's Operations as an Analyst
// in A's London office, and works at client B through a live membership
// placed in B's Design department as a Designer in B's Leeds office; Dana,
// a Manager in B, is her manager there. Pat still holds a stale membership
// row in A, placed in A's Operations too (it must never count her twice).
// Lee is anchored in B, in Design, a Designer in Leeds. Rita is anchored at
// A and placed in B's Design, but B deactivated her; Rex is anchored at A
// and B removed him, placed in Design too. Bo owns B; Ari owns A. Before
// this step every audience and count below read the people anchored in B
// only, so Pat was in none of B's Design audiences and in none of its
// counts, whatever B's HR placed her in.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  me: "bo",
  level: "SUPER_ADMIN",
  org: "b",
  /** What getTeamUserIds answers (the viewer's report tree, self included). */
  team: [] as string[],
}));

const session = () => legacyTestSession(st.me, st.level, st.org);

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
  // The announcement matrix: Owners and Admins create; nobody else here.
  hasPermission: async () => st.level === "SUPER_ADMIN" || st.level === "COMPANY_ADMIN",
}));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => st.team }));
vi.mock("@/lib/process-scope", async (orig) => ({
  ...(await orig<typeof import("@/lib/process-scope")>()),
  personScope: async () => ({ canView: true, orgWide: true, userIds: null }),
  inScope: () => true,
}));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined, logAuditEvent: async () => undefined }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => undefined, queueEmail: async () => undefined, processEmailQueue: async () => undefined }));
vi.mock("@/lib/policies-to-ack", () => ({ countPoliciesToAck: async () => 0, listPoliciesToAck: async () => [] }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { idsPlacedHere, membershipPlacedCounts, placementHereOf } from "@/lib/access/profile-here";
import { resolveAnnouncementAudienceUserIds } from "@/lib/announcement-audience";
import { GET as feed } from "@/app/api/announcements/route";
import { GET as announcement } from "@/app/api/announcements/[id]/route";
import { GET as ackRoster } from "@/app/api/announcements/[id]/acknowledge/route";
import { GET as policyAssignments, POST as assignPolicy } from "@/app/api/policies/[id]/assignments/route";
import { GET as policyPage } from "@/app/api/policies/[id]/route";
import { buildPolicyCompliance } from "@/lib/policy-compliance";
import { buildPolicyLedger } from "@/lib/policy-ledger";
import { notifySurveyAudience, surveyAudienceStats } from "@/lib/performance/survey.server";
import { POST as answerSurvey } from "@/app/api/pulse-surveys/[id]/respond/route";
import { POST as answerCandor } from "@/app/api/candor/[id]/respond/route";
import { notifyCandorOpen } from "@/lib/performance/candor.server";
import { GET as boot } from "@/app/api/boot/route";
import { canSeeGoal, goalVisibilityOr, resolveGoalMembersBatch } from "@/lib/goal-audience";
import { isGoalContributor } from "@/lib/goals/goal-contributor";
import { GET as departments } from "@/app/api/departments/route";
import { GET as offices } from "@/app/api/offices/route";
import { GET as roles } from "@/app/api/roles/route";
import { GET as role } from "@/app/api/roles/[id]/route";
import { jobTitleHolders } from "@/lib/access/job-title-holders";
import { POST as boundaryRequest } from "@/app/api/role-boundaries/request/route";
import { GET as roleAlignment } from "@/app/api/roles/[id]/alignment/route";
import { GET as kudosFeed } from "@/app/api/kudos/route";
import { GET as policyList } from "@/app/api/policies/route";
import { buildSopCompliance } from "@/lib/sop-compliance";
import { cultureGate } from "@/lib/people/culture-gate";

const req = (url: string, init?: RequestInit) => new NextRequest(`https://app.test${url}`, init as ConstructorParameters<typeof NextRequest>[1]);
const json = async (res: Response | undefined) => (await res!.json()) as Record<string, unknown>;
const post = (url: string, body: unknown) => req(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (me: string, level: string, org: string) => {
  st.me = me;
  st.level = level;
  st.org = org;
};
const sorted = (ids: Iterable<string>) => [...ids].sort();
/** Who was told, by notification row of this type. */
const told = (type: string) => sorted(new Set(db.tables.notification?.filter((n) => n.type === type).map((n) => n.userId as string) ?? []));

function person(id: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", organizationId,
    ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE", deletedAt: null, phone: null, managerId: null,
    departmentId: null, roleId: null, officeId: null, joinDate: new Date("2025-01-01"), createdAt: new Date("2025-01-01"),
    presenceStatus: null, presenceUntil: null, ...over,
  });
}
function seat(userId: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, createdAt: new Date("2026-06-01"), ...over });
}
const DESIGN = { departmentId: "dep-b-design", roleId: "role-b-designer", officeId: "off-b-leeds" };

beforeEach(() => {
  db.reset();
  db.onQueryRaw = () => [];
  as("bo", "SUPER_ADMIN", "b");
  st.team = [];
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, settings: {} });
  db.seed("department", { id: "dep-a-ops", name: "Operations", color: null, organizationId: "a", parentId: null, headId: null });
  db.seed("department", { id: "dep-b-design", name: "Design", color: null, organizationId: "b", parentId: null, headId: null });
  db.seed("department", { id: "dep-b-eng", name: "Engineering", color: null, organizationId: "b", parentId: null, headId: null });
  db.seed("role", { id: "role-a-analyst", title: "Analyst", level: "EMPLOYEE", description: null, organizationId: "a", departmentId: null });
  db.seed("role", { id: "role-b-designer", title: "Designer", level: "EMPLOYEE", description: null, organizationId: "b", departmentId: null });
  db.seed("office", { id: "off-a-london", name: "London", organizationId: "a", isHeadquarters: true, city: null, country: null });
  db.seed("office", { id: "off-b-leeds", name: "Leeds", organizationId: "b", isHeadquarters: true, city: null, country: null });

  person("ari", "a", { ...legacyLevelRow("SUPER_ADMIN") });
  person("pat", "a", { departmentId: "dep-a-ops", roleId: "role-a-analyst", officeId: "off-a-london" });
  // Her own workspace's stale membership row, placed in A's Operations too.
  seat("pat", "a", { departmentId: "dep-a-ops", roleId: "role-a-analyst", officeId: "off-a-london" });
  seat("pat", "b", { role: "EMPLOYEE", ...DESIGN, managerId: "dana" });
  person("bo", "b", { ...legacyLevelRow("SUPER_ADMIN") });
  person("dana", "b", { ...legacyLevelRow("MANAGER") });
  person("lee", "b", { ...DESIGN, managerId: "dana" });
  person("rita", "a");
  seat("rita", "b", { status: "INACTIVE", ...DESIGN });
  person("rex", "a");
  seat("rex", "b", { status: "INACTIVE", removedAt: new Date("2026-10-01"), ...DESIGN });
});

describe("the helpers (profile-here.ts)", () => {
  it("place Pat by her B membership in B and by her account in A, each at her seat's state, never twice", async () => {
    expect(await placementHereOf("b", "pat")).toEqual(DESIGN);
    expect(await placementHereOf("a", "pat")).toEqual({ departmentId: "dep-a-ops", roleId: "role-a-analyst", officeId: "off-a-london" });
    expect(await placementHereOf("b", "rita", "live")).toBeNull();
    expect(await placementHereOf("b", "rex", "kept")).toBeNull();
    expect(sorted(await idsPlacedHere("b", { departmentIds: ["dep-b-design"] }, "live"))).toEqual(["lee", "pat"]);
    expect(sorted(await idsPlacedHere("b", { departmentIds: ["dep-b-design"] }, "kept"))).toEqual(["lee", "pat", "rita"]);
    expect(sorted(await idsPlacedHere("b", { departmentIds: ["dep-b-design"] }, "any"))).toEqual(["lee", "pat", "rex", "rita"]);
    // A's Operations holds Pat once, at her account; her stale A row adds nothing.
    expect(await idsPlacedHere("a", { departmentIds: ["dep-a-ops"] }, "any")).toEqual(["pat"]);
    expect(await idsPlacedHere("a", { departmentIds: ["dep-b-design"] }, "any")).toEqual([]);
    expect((await membershipPlacedCounts("a", "departmentId")).size).toBe(0);
    expect([...(await membershipPlacedCounts("b", "departmentId"))]).toEqual([["dep-b-design", 2]]);
    // A filter naming nothing places nobody; "everyone" is the whole workspace.
    expect(await idsPlacedHere("b", { departmentIds: [] }, "any")).toEqual([]);
    expect(sorted(await idsPlacedHere("b", "everyone", { anchored: "kept", membership: "live" }))).toEqual(["bo", "dana", "lee", "pat"]);
  });
});

describe("announcements", () => {
  beforeEach(() => {
    const base = { organizationId: "b", authorId: "bo", content: "Read this", type: "GENERAL", priority: "NORMAL", pinned: false, mustAcknowledge: true, publishedAt: new Date("2026-10-01"), expiresAt: null, createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01") };
    db.seed("announcement", { ...base, id: "an-design", title: "Design review", targetAudience: { type: "DEPARTMENTS", ids: ["dep-b-design"] } });
    db.seed("announcement", { ...base, id: "an-leeds", title: "Leeds office", targetAudience: { type: "OFFICES", ids: ["off-b-leeds"] } });
    db.seed("announcement", { ...base, id: "an-eng", title: "Engineering only", targetAudience: { type: "DEPARTMENTS", ids: ["dep-b-eng"] } });
    db.seed("announcement", { ...base, id: "an-a-ops", organizationId: "a", authorId: "ari", title: "Ops in A", targetAudience: { type: "DEPARTMENTS", ids: ["dep-a-ops"] } });
  });

  it("a B announcement to Design, to Leeds or to everyone reaches Pat, and nobody B ended; a Guest is where they were", async () => {
    // A Guest is unchanged. A Guest is a seat anchored here whose stored org
    // role is GUEST (the column the Guest invitation writes; a membership
    // seat is never a Guest, and AccessLevel has no GUEST value): Gus, placed
    // in B's Design, is in its audience exactly as before this step, by the
    // rule for people anchored here, which this step leaves as it was.
    person("gus", "b", { orgRole: "GUEST", departmentId: "dep-b-design" });
    expect(sorted(await resolveAnnouncementAudienceUserIds("b", { type: "DEPARTMENTS", ids: ["dep-b-design"] }))).toEqual(["gus", "lee", "pat"]);
    expect(sorted(await resolveAnnouncementAudienceUserIds("b", { type: "OFFICES", ids: ["off-b-leeds"] }))).toEqual(["lee", "pat"]);
    expect(sorted(await resolveAnnouncementAudienceUserIds("b", { type: "ALL", ids: [] }))).toEqual(["bo", "dana", "gus", "lee", "pat"]);
    // A's audience to its Operations holds Pat once, at her account, and B's ids place nobody in A.
    expect(await resolveAnnouncementAudienceUserIds("a", { type: "DEPARTMENTS", ids: ["dep-a-ops"] })).toEqual(["pat"]);
    expect(await resolveAnnouncementAudienceUserIds("a", { type: "DEPARTMENTS", ids: ["dep-b-design"] })).toEqual([]);
  });

  it("Pat, in B, reads B's Design and Leeds posts in her feed and by their link, and not Engineering's", async () => {
    as("pat", "EMPLOYEE", "b");
    const list = (await json(await feed(req("/api/announcements")))).data as Array<{ id: string }>;
    expect(sorted(list.map((a) => a.id))).toEqual(["an-design", "an-leeds"]);
    expect((await announcement(req("/api/announcements/an-design"), params("an-design")))!.status).toBe(200);
    expect((await announcement(req("/api/announcements/an-eng"), params("an-eng")))!.status).toBe(404);
    // In A she reads A's Operations post, by her account's department there.
    as("pat", "EMPLOYEE", "a");
    expect(((await json(await feed(req("/api/announcements")))).data as Array<{ id: string }>).map((a) => a.id)).toEqual(["an-a-ops"]);
  });

  it("the acknowledgement roster lists Pat under B's Design, and nobody B ended", async () => {
    const body = (await json(await ackRoster(req("/api/announcements/an-design/acknowledge"), params("an-design")))) as unknown as { roster: Array<{ id: string; department: string | null }>; totalCount: number };
    expect(body.roster.map((r) => [r.id, r.department])).toEqual([["lee", "Design"], ["pat", "Design"]]);
    expect(body.totalCount).toBe(2);
  });
});

describe("policies", () => {
  beforeEach(() => {
    const base = { organizationId: "b", content: "Read this", category: null, status: "PUBLISHED", requiresAck: true, version: 1, ackVersion: 1, effectiveDate: null, createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01") };
    db.seed("policy", { ...base, id: "pol-design", title: "Design handbook" });
    db.seed("policy", { ...base, id: "pol-all", title: "Code of conduct" });
  });

  it("B's policy assigned to Design reaches Pat, shows her under Design, and never Rita or Rex", async () => {
    const res = await assignPolicy(post("/api/policies/pol-design/assignments", { departmentId: "dep-b-design" }), params("pol-design"));
    expect(res!.status).toBe(201);
    expect(sorted(db.tables.policyAssignment.map((a) => a.userId as string))).toEqual(["lee", "pat"]);
    expect(told("policy.assigned")).toEqual(["lee", "pat"]);
    const rows = (await json(await policyAssignments(req("/api/policies/pol-design/assignments"), params("pol-design")))) as unknown as { assignments: Array<{ userId: string; department: string | null }> };
    expect(sorted(rows.assignments.map((a) => `${a.userId}:${a.department}`))).toEqual(["lee:Design", "pat:Design"]);
    const page = (await json(await policyPage(req("/api/policies/pol-design"), params("pol-design")))) as unknown as { audienceSummary: { departments: Array<{ name: string; count: number }>; people: Array<{ id: string; firstName: string | null; department: string | null }> } };
    expect(page.audienceSummary.departments).toEqual([{ id: "dep-b-design", name: "Design", count: 2 }]);
    expect(page.audienceSummary.people.find((p) => p.id === "pat")).toMatchObject({ firstName: "Pat", department: "Design" });
  });

  it("B's policy for everyone counts Pat, and its compliance and ledger list her under Design", async () => {
    const page = (await json(await policyPage(req("/api/policies/pol-all"), params("pol-all")))) as unknown as { totalUsers: number };
    expect(page.totalUsers).toBe(4);
    const list = (await json(await policyList(req("/api/policies")))) as unknown as { totalUsers: number; data: Array<{ id: string; totalUsers: number | null }> };
    expect(list.totalUsers).toBe(4);
    expect(list.data.find((p) => p.id === "pol-all")!.totalUsers).toBe(4);
    const compliance = await buildPolicyCompliance("b", null, { departmentId: "dep-b-design" });
    expect(sorted(compliance.personCompliance.map((p) => `${p.userId}:${p.department}`))).toEqual(["lee:Design", "pat:Design"]);
    const ledger = await buildPolicyLedger("pol-all", "b");
    expect(sorted(ledger!.rows.map((r) => `${r.userId}:${r.department}`))).toEqual(["bo:Unassigned", "dana:Unassigned", "lee:Design", "pat:Design"]);
  });
});

describe("surveys and Candor", () => {
  beforeEach(() => {
    db.seed("pulseSurvey", {
      id: "sv-design", organizationId: "b", title: "Design pulse", status: "ACTIVE", closesAt: null, anonymous: true, createdById: "bo",
      audienceType: "DEPARTMENTS", departmentIds: ["dep-b-design"], officeIds: [], userIds: [], tagIds: [],
      questions: [{ id: "q1", text: "How is it going?", type: "rating" }],
    });
    db.seed("candorSession", { id: "cs-design", organizationId: "b", title: "Design retro", description: null, status: "ACTIVE", departmentId: "dep-b-design", createdBy: "bo", prompts: [{ id: "p1", text: "What should change?", type: "text" }] });
  });

  it("B's survey to Design counts Pat, tells her, and takes her answer; nobody B ended is told", async () => {
    expect(await surveyAudienceStats("b", { id: "sv-design", audienceType: "DEPARTMENTS", departmentIds: ["dep-b-design"], officeIds: [], userIds: [], tagIds: [] })).toEqual({ audienceSize: 2, totalResponses: 0, responseRate: 0 });
    const survey = db.row("pulseSurvey", "sv-design") as never;
    expect(await notifySurveyAudience(survey, "b")).toBe(2);
    expect(told("survey_open")).toEqual(["lee", "pat"]);
    as("pat", "EMPLOYEE", "b");
    const res = await answerSurvey(post("/api/pulse-surveys/sv-design/respond", { answers: [{ questionId: "q1", value: 4 }] }), params("sv-design"));
    expect(res!.status).toBe(200);
    expect(db.tables.surveyResponse.map((r) => r.userId)).toEqual(["pat"]);
  });

  it("the Surveys page opens to Pat in B, targeted by B's Design survey at her seat there", async () => {
    as("pat", "EMPLOYEE", "b");
    await expect(cultureGate("surveys", "/surveys")).resolves.toMatchObject({ userId: "pat", organizationId: "b", organiser: false });
    await expect(cultureGate("candor", "/candor")).resolves.toMatchObject({ userId: "pat", organizationId: "b" });
  });

  it("B's Candor session for Design takes Pat's answer and tells her, and nobody B ended", async () => {
    await notifyCandorOpen({ id: "cs-design", title: "Design retro", description: null, departmentId: "dep-b-design" }, "b", "bo");
    expect(told("candor_open")).toEqual(["lee", "pat"]);
    as("pat", "EMPLOYEE", "b");
    const res = await answerCandor(post("/api/candor/cs-design/respond", { answers: [{ promptId: "p1", value: "More pairing" }] }), params("cs-design"));
    expect(res!.status).toBe(201);
    expect(db.tables.candorRespondent.map((r) => r.userId)).toEqual(["pat"]);
  });

  it("the boot's facts count B's open Design survey and Candor session for Pat in B, and none in A", async () => {
    as("pat", "EMPLOYEE", "b");
    const inB = (await json(await boot(req("/api/boot?counts=1")))).counts as { surveysOpen: number; candorOpen: number };
    expect({ surveysOpen: inB.surveysOpen, candorOpen: inB.candorOpen }).toEqual({ surveysOpen: 1, candorOpen: 1 });
    as("pat", "EMPLOYEE", "a");
    const inA = (await json(await boot(req("/api/boot?counts=1")))).counts as { surveysOpen: number; candorOpen: number };
    expect({ surveysOpen: inA.surveysOpen, candorOpen: inA.candorOpen }).toEqual({ surveysOpen: 0, candorOpen: 0 });
  });
});

describe("goals", () => {
  beforeEach(() => {
    const base = { organizationId: "b", description: null, parentId: null, status: "ON_TRACK", progress: 0, quarter: null, departmentId: null, repeat: null, createdAt: new Date("2026-10-01") };
    db.seed("oKR", { ...base, id: "g-design", title: "Ship the design system", level: "INDIVIDUAL", ownerId: "bo" });
    db.seed("goalAssignee", { id: "ga1", okrId: "g-design", userId: null, departmentId: "dep-b-design", roleId: null, tagId: null, createdAt: new Date("2026-10-01") });
    db.seed("oKR", { ...base, id: "g-designers", title: "Every designer certified", level: "INDIVIDUAL", ownerId: "bo" });
    db.seed("goalAssignee", { id: "ga2", okrId: "g-designers", userId: null, departmentId: null, roleId: "role-b-designer", tagId: null, createdAt: new Date("2026-10-01") });
  });

  it("a B goal for Design and one for Designers hold Pat as a member, and never Rita or Rex", async () => {
    const members = await resolveGoalMembersBatch("b", [{ id: "g-design", ownerId: "bo" }, { id: "g-designers", ownerId: "bo" }]);
    expect(members.get("g-design")!.map((m) => m.id)).toEqual(["bo", "lee", "pat"]);
    expect(members.get("g-designers")!.map((m) => m.id)).toEqual(["bo", "lee", "pat"]);
  });

  it("Pat, in B, sees both goals and contributes to them; her goal list reads B's Design", async () => {
    as("pat", "EMPLOYEE", "b");
    st.team = ["pat"];
    const okr = { id: "g-design", level: "INDIVIDUAL", ownerId: "bo", departmentId: null };
    expect(await canSeeGoal(session(), okr)).toBe(true);
    expect(await canSeeGoal(session(), { ...okr, id: "g-designers" })).toBe(true);
    expect(await isGoalContributor(session(), "g-design")).toBe(true);
    const visible = await goalVisibilityOr(session());
    expect(visible).toContainEqual({ assignees: { some: { departmentId: "dep-b-design" } } });
    expect(visible).toContainEqual({ assignees: { some: { roleId: "role-b-designer" } } });
    expect(visible).toContainEqual({ level: "DEPARTMENT", departmentId: "dep-b-design" });
    expect(JSON.stringify(visible)).not.toMatch(/dep-a-ops|role-a-analyst/);
  });

  it("Dana sees the Designers goal through Pat, who reports to her in B, by the title Pat holds in B", async () => {
    as("dana", "MANAGER", "b");
    st.team = ["dana", "pat"];
    expect(await canSeeGoal(session(), { id: "g-designers", level: "INDIVIDUAL", ownerId: "bo", departmentId: null })).toBe(true);
  });
});

describe("counts by placement (Settings)", () => {
  it("B's Design, Designer and Leeds count Pat (and Rita, whose kept seat a delete refuses by), never Rex; A counts Pat once", async () => {
    const depts = (await departments(req("/api/departments?fresh=1"))) as Response;
    const dRows = (await depts.json()) as Array<{ id: string; _count: { members: number } }>;
    expect(dRows.map((d) => [d.id, d._count.members])).toEqual([["dep-b-design", 3], ["dep-b-eng", 0]]);
    const oRows = (await json(await offices())) as unknown as Array<{ id: string; _count: { members: number } }>;
    expect(oRows.map((o) => [o.id, o._count.members])).toEqual([["off-b-leeds", 3]]);
    const rRows = (await json(await roles(req("/api/roles")))) as unknown as Array<{ id: string; _count: { users: number } }>;
    expect(rRows.map((r) => [r.id, r._count.users])).toEqual([["role-b-designer", 3]]);
    const holders = ((await json(await role(req("/api/roles/role-b-designer"), params("role-b-designer")))) as unknown as { role: { users: Array<{ id: string }> } }).role.users;
    expect(sorted(holders.map((u) => u.id))).toEqual(["lee", "pat", "rita"]);
    // A: Pat once, at her account (her stale A membership row adds nothing), and nothing of B's.
    as("ari", "SUPER_ADMIN", "a");
    const aDepts = (await ((await departments(req("/api/departments?fresh=1"))) as Response).json()) as Array<{ id: string; _count: { members: number } }>;
    expect(aDepts.map((d) => [d.id, d._count.members])).toEqual([["dep-a-ops", 1]]);
    expect(((await json(await offices())) as unknown as Array<{ id: string; _count: { members: number } }>).map((o) => [o.id, o._count.members])).toEqual([["off-a-london", 1]]);
    expect(((await json(await roles(req("/api/roles")))) as unknown as Array<{ id: string; _count: { users: number } }>).map((r) => [r.id, r._count.users])).toEqual([["role-a-analyst", 1]]);
  });
});

describe("the kudos wall, SOP compliance and a job title's template, by placement", () => {
  it("the wall's Design filter holds Pat's kudos, given or received, and the SOP compliance groups her under Design", async () => {
    db.seed("kudos", { id: "k-pat", organizationId: "b", giverId: "bo", receiverId: "pat", message: "Great work", companyValue: null, createdAt: new Date("2026-10-02") });
    db.seed("kudos", { id: "k-lee", organizationId: "b", giverId: "bo", receiverId: "lee", message: "Thanks", companyValue: null, createdAt: new Date("2026-10-01") });
    db.seed("kudos", { id: "k-dana", organizationId: "b", giverId: "bo", receiverId: "dana", message: "Nice", companyValue: null, createdAt: new Date("2026-09-30") });
    const wall = (await json(await kudosFeed(req("/api/kudos?dept=dep-b-design")))) as unknown as { data: Array<{ id: string }> };
    expect(wall.data.map((k) => k.id)).toEqual(["k-pat", "k-lee"]);

    db.seed("sOP", { id: "sop-1", organizationId: "b", title: "Brand checks", category: null, sopType: "CHECKLIST" });
    for (const userId of ["pat", "lee", "dana"]) db.seed("sOPAssignment", { id: `sa-${userId}`, sopId: "sop-1", userId, status: "ASSIGNED", mandatory: true, dueDate: null, score: null, stepsCompleted: 0, stepsTotal: 1 });
    const all = await buildSopCompliance(session(), req("/api/sop-assignments/compliance"));
    expect(all!.departmentCompliance.map((d) => [d.name, d.people]).sort()).toEqual([["Design", 2], ["No department", 1]]);
    const design = await buildSopCompliance(session(), req("/api/sop-assignments/compliance?departmentId=dep-b-design"));
    expect(design!.personScores.map((p) => `${p.userId}:${p.department}`).sort()).toEqual(["lee:Design", "pat:Design"]);
  });

  it("a job title's template counts its holders here through a membership too", async () => {
    const body = (await json(await roleAlignment(req("/api/roles/role-b-designer/alignment"), params("role-b-designer")))) as unknown as { holders: { users: number } };
    expect(body.holders.users).toBe(3);
  });
});

describe("a job title's holders", () => {
  it("B's Designer holders are Pat at her B seat with Lee, Rita and Rex as the step owner rule reads them", async () => {
    const holders = await jobTitleHolders("b", ["role-b-designer"]);
    expect(holders.map((h) => [h.id, h.status, h.deletedAt != null, h.isAgent])).toEqual([
      ["lee", "ACTIVE", false, false],
      ["pat", "ACTIVE", false, false],
      ["rex", "INACTIVE", true, false],
      ["rita", "INACTIVE", false, false],
    ]);
    expect(await jobTitleHolders("a", ["role-b-designer"])).toEqual([]);
  });

  it("a request to the Designer-owned area tells Pat, and never Rita or Rex", async () => {
    db.seed("ownershipArea", { id: "area-brand", name: "Brand", organizationId: "b", ownerRoleId: "role-b-designer", description: null });
    as("dana", "MANAGER", "b");
    const res = await boundaryRequest(post("/api/role-boundaries/request", { areaId: "area-brand", note: "New logo please" }));
    expect(res!.status).toBe(200);
    expect(told("boundary_request")).toEqual(["lee", "pat"]);
  });
});
