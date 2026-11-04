// A person's KRAs, KPI numbers and SOPs are read for THIS workspace only,
// wherever they are read (docs/plans/workspace-status-2.md, the final review,
// product M5). Run on the in-memory database (seat-test-db.ts), through the
// real routes.
//
// The case, the normal way a contractor joins. Pat is anchored at her agency
// A, where she reports to Max, and holds A's Analyst KRA ("Close A's books",
// 50%) and A's published SOP. Client B invites her and she accepts signed in,
// so her account moves into B (the join's own move, reanchorUser). Hana, B's
// People team, then sets her B job title in Members: her seat is anchored in
// B at that moment, so B's job title assigns her B's KRA ("Ship B's
// releases", 50%) and B's published SOP, as for anyone anchored in B. She
// records a number for B's KPI there. Then she switches back to A. An
// assignment, a KPI record and an SOP assignment name no workspace of their
// own: before this fix, A's My KRAs, Max's KPI recorder, her self-report,
// her self-assessment, the weight total and her open SOPs all showed and
// counted B's rows in A.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  me: "hana",
  level: "HR",
  org: "b",
  ctx: {} as Record<string, unknown>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession(st.me, st.level, st.org) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined, logAuditEvent: async () => undefined }));
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async () => undefined }));
vi.mock("@/lib/access/role-change-after", () => ({ afterRoleChanges: async () => undefined }));
vi.mock("@/lib/access/flags", async (orig) => ({ ...(await orig<typeof import("@/lib/access/flags")>()), accessV2Resolver: () => false }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/user-tags", () => ({ getUserTagsMap: async () => new Map(), resolveUserIdsByTags: async () => [] }));
// The permission matrix is its own module's (tested there): the KRA door's gate passes here.
vi.mock("@/lib/api-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/api-helpers")>()), hasPermission: async () => false, requirePermission: async () => null }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => undefined, queueEmail: async () => undefined }));
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));
vi.mock("@/lib/access/workspace-admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/workspace-admin")>()),
  freshWorkspaceActor: async () => ({ ok: true, admin: true, owner: true }),
}));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));
// Who a review's manager half goes to, and the reviews that follow a line, are review-cycle's own (tested there).
vi.mock("@/lib/performance/review-cycle.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/performance/review-cycle.server")>()),
  followReportingLine: async () => undefined,
  reviewWritersIn: async () => new Map(),
}));
vi.mock("@/services/performanceScoreService", () => ({ getLatestScore: async () => null, getScoreHistory: async () => [] }));
vi.mock("@/lib/access/manager-lines", async (orig) => ({ ...(await orig<typeof import("@/lib/access/manager-lines")>()), agentsWithStoredReports: async () => new Map() }));
// The three doors' own gates (who may read whose KPIs, who hears of a number) are their modules' (tested there).
vi.mock("@/lib/alignment-scope", async (orig) => ({ ...(await orig<typeof import("@/lib/alignment-scope")>()), canTouchUserAlignment: async () => true }));
vi.mock("@/lib/kpi-review.server", async (orig) => ({ ...(await orig<typeof import("@/lib/kpi-review.server")>()), notifyKpiSubmitted: async () => undefined }));
// A self-assessment's goals are the goal rollup's (tested there); Pat owns none.
vi.mock("@/lib/alignment", async (orig) => ({ ...(await orig<typeof import("@/lib/alignment")>()), computeGoalRollups: async () => ({}) }));
vi.mock("@/lib/goals/goal-period-score.server", async (orig) => ({ ...(await orig<typeof import("@/lib/goals/goal-period-score.server")>()), repeatingCycleReads: async () => new Map() }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { reanchorUser } from "@/lib/access/workspace-anchor";
import { PATCH as userPatch } from "@/app/api/users/[id]/route";
import { GET as myKras } from "@/app/api/me/kras/route";
import { GET as mySops } from "@/app/api/me/sops/route";
import { GET as userKpis } from "@/app/api/users/[id]/kpis/route";
import { POST as selfReport } from "@/app/api/kpi-records/self-report/route";
import { GET as selfAssessmentGet, PATCH as selfAssessmentPatch } from "@/app/api/reviews/[id]/self-assessment/route";
import { POST as kraAssign } from "@/app/api/kra-assignments/route";
import { currentPeriodKey } from "@/lib/person-alignment";

type Row = Record<string, unknown> & { id: string };
const req = (url: string, init?: { method: string; body?: unknown }) =>
  new NextRequest(`https://app.test${url}`, init ? { method: init.method, ...(init.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}) } : undefined);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
const PERIOD = currentPeriodKey();

/** The session acting: who, at what level, in which workspace. */
function as(me: string, level: string, org: string) {
  st.me = me;
  st.level = level;
  st.org = org;
}

let made = 0;
function person(id: string, organizationId: string, level: string, managerId: string | null, extra: Record<string, unknown> = {}) {
  made += 1;
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", organizationId, ...legacyLevelRow(level),
    managerId, phone: null, avatar: null, dateOfBirth: null, departmentId: null, roleId: null, officeId: null, joinDate: new Date(Date.UTC(2025, 0, made)), createdAt: new Date(Date.UTC(2025, 0, made)),
    weeklyCapacityHours: null, workSchedule: null, customFields: null, presenceStatus: null, ...extra,
  });
}
const membership = (userId: string, organizationId: string, role: string, managerId: string | null, extra: Record<string, unknown> = {}) =>
  db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role, managerId, createdAt: new Date("2026-06-01"), ...extra });

/** A workspace's job title with its KRA (and the KRA's KPI) and a published SOP under it, as a job title carries them. */
function jobTitle(org: string, roleId: string, title: string, kra: string, kraName: string) {
  db.seed("role", { id: roleId, title, description: null, level: null, organizationId: org });
  db.seed("kRA", { id: kra, name: kraName, description: null, category: null, roleId, organizationId: org, weight: 50, createdAt: new Date() });
  db.seed("kPI", { id: `kpi-${org}`, name: `${kraName}: on time`, unit: "%", type: "QUANTITATIVE", frequency: "MONTHLY", targetValue: 100, targetLabel: null, lowerIsBetter: false, direction: null, kraId: kra, organizationId: org });
  db.seed("sOP", { id: `sop-${org}`, title: `${title} checklist`, description: null, kraId: kra, organizationId: org, status: "PUBLISHED", sopType: "WRITTEN", content: { sections: [] }, version: 1, category: null, createdAt: new Date() });
}

const accountOf = (id: string) => db.row("user", id);

beforeEach(async () => {
  db.reset();
  made = 0;
  db.onQueryRaw = () => [];
  db.seed("organization", { id: "a", name: "Org A", status: "ACTIVE", settings: {} });
  db.seed("organization", { id: "b", name: "Org B", status: "ACTIVE", settings: {} });
  jobTitle("a", "role-a-an", "Analyst", "kra-a", "Close A's books");
  jobTitle("b", "role-b-dev", "Developer", "kra-b", "Ship B's releases");
  // A.
  person("ari", "a", "SUPER_ADMIN", null);
  person("max", "a", "MANAGER", "ari");
  person("pat", "a", "EMPLOYEE", "max", { roleId: "role-a-an" });
  // B.
  person("bo", "b", "SUPER_ADMIN", null);
  person("hana", "b", "HR", "bo");
  person("dana", "b", "MANAGER", "bo");
  membership("pat", "b", "EMPLOYEE", "dana");
  // A's job title gave her A's KRA and SOP long ago, and she recorded A's number this month.
  db.seed("kRAAssignment", { id: "ka-pat-a", userId: "pat", kraId: "kra-a", weightage: 50, createdAt: new Date("2026-01-01") });
  db.seed("sOPAssignment", { id: "sa-pat-a", userId: "pat", sopId: "sop-a", createdAt: new Date("2026-01-01") });
  db.seed("kPIRecord", { id: "kr-pat-a", kpiId: "kpi-a", userId: "pat", period: PERIOD, targetValue: 100, actualValue: 90, score: 90, status: "SUBMITTED", notes: null, evidence: null, managerNotes: null, reviewedById: null, createdAt: new Date(), updatedAt: new Date() });

  // She accepts B's invitation signed in: her account moves into B (the join's own move).
  expect(await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } })).toBe(true);
  expect(accountOf("pat").organizationId).toBe("b");
  // Hana sets her B job title in Members, as the AI invitation card says to: anchored in B, she is given B's KRA and SOP.
  as("hana", "HR", "b");
  st.ctx = {
    userId: "hana", organizationId: "b", ...legacyLevelRow("HR"), orgRole: "MEMBER", isAgent: false, isAdmin: false, peopleTeam: true,
    orgWide: true, managerTier: false, chain: new Set(), writeChain: new Set(), viewer: { userId: "hana", organizationId: "b" },
  };
  const set = await userPatch(req("/api/users/pat", { method: "PATCH", body: { roleId: "role-b-dev" } }), params("pat"));
  expect(set.status).toBe(200);
  expect(((db.tables.kRAAssignment ?? []) as Row[]).filter((r) => r.userId === "pat").map((r) => r.kraId).sort()).toEqual(["kra-a", "kra-b"]);
  expect(((db.tables.sOPAssignment ?? []) as Row[]).filter((r) => r.userId === "pat").map((r) => r.sopId).sort()).toEqual(["sop-a", "sop-b"]);
  // In B she records B's number for this month.
  as("pat", "EMPLOYEE", "b");
  expect(await json(await selfReport(req("/api/kpi-records/self-report", { method: "POST", body: { period: PERIOD, records: [{ kpiId: "kpi-b", actualValue: 70 }] } })))).toMatchObject({ saved: 1 });
  // Then she switches back to A.
  expect(await reanchorUser({ userId: "pat", to: { organizationId: "a", role: "EMPLOYEE" } })).toBe(true);
  expect(accountOf("pat").organizationId).toBe("a");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Pat joined B by invitation, got B's KRA and SOP there, and switched back to A: B's never show or count in A (M5)", () => {
  it("her My KRAs in A lists A's KRA only, and in B, B's only", async () => {
    as("pat", "EMPLOYEE", "a");
    const inA = (await json(await myKras())).kras as Array<{ kra: { id: string } }>;
    // Before: Close A's books and Ship B's releases.
    expect(inA.map((k) => k.kra.id)).toEqual(["kra-a"]);
    as("pat", "EMPLOYEE", "b");
    expect(((await json(await myKras())).kras as Array<{ kra: { id: string } }>).map((k) => k.kra.id)).toEqual(["kra-b"]);
  });

  it("Max's KPI recorder for her in A shows A's KRA and A's number only", async () => {
    as("max", "MANAGER", "a");
    const res = await userKpis(req(`/api/users/pat/kpis?period=${PERIOD}`), params("pat"));
    expect(res.status).toBe(200);
    const body = await json(res);
    const kras = ((body.data ?? body) as { kras: Array<{ kraId: string; kpis: Array<{ kpiId: string }> }> }).kras;
    // Before: B's KRA and its KPI too, with her B number.
    expect(kras.map((k) => k.kraId)).toEqual(["kra-a"]);
    expect(kras.flatMap((k) => k.kpis.map((p) => p.kpiId))).toEqual(["kpi-a"]);
  });

  it("her self-report in A takes A's KPI and never B's", async () => {
    as("pat", "EMPLOYEE", "a");
    const before = JSON.stringify(((db.tables.kPIRecord ?? []) as Row[]).find((r) => r.kpiId === "kpi-b"));
    const body = await json(await selfReport(req("/api/kpi-records/self-report", { method: "POST", body: { period: PERIOD, records: [{ kpiId: "kpi-a", actualValue: 95 }, { kpiId: "kpi-b", actualValue: 10 }] } })));
    // Before: both saved, B's number overwritten from A.
    expect((body.data ?? body)).toMatchObject({ saved: 1, skipped: 1 });
    expect(JSON.stringify(((db.tables.kPIRecord ?? []) as Row[]).find((r) => r.kpiId === "kpi-b"))).toBe(before);
    expect(((db.tables.kPIRecord ?? []) as Row[]).find((r) => r.kpiId === "kpi-a")).toMatchObject({ actualValue: 95 });
  });

  it("her A self-assessment lists A's KRA only, and submits with A's KRA rated", async () => {
    db.seed("reviewCycle", { id: "cyc-a", name: "A's H2", type: "SEMI_ANNUAL", status: "ACTIVE", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), organizationId: "a", createdById: "ari", audienceType: "ALL", departmentIds: [], userIds: [] });
    db.seed("review", { id: "rev-pat-a", cycleId: "cyc-a", subjectId: "pat", reviewerId: "max", status: "PENDING", selfRatings: null, managerAssessment: null, createdAt: new Date(), updatedAt: new Date() });
    as("pat", "EMPLOYEE", "a");
    const got = await selfAssessmentGet(req("/api/reviews/cyc-a/self-assessment"), params("cyc-a"));
    expect(got.status).toBe(200);
    const view = await json(got);
    const kras = ((view.data ?? view) as { kraAssignments: Array<{ kra: { id: string } }> }).kraAssignments;
    // Before: B's KRA too, which A's manager can't see or rate.
    expect(kras.map((k) => k.kra.id)).toEqual(["kra-a"]);
    const sent = await selfAssessmentPatch(req("/api/reviews/cyc-a/self-assessment", {
      method: "PATCH",
      body: { submit: true, selfRatings: { kraRatings: [{ kraId: "kra-a", kraName: "Close A's books", rating: 4, achievements: "Closed on time" }], reflection: { wentWell: "", couldImprove: "", goals: "" } } },
    }), params("cyc-a"));
    // Before: 400 "Rate every KRA first (1 left)", the one left being B's.
    expect(sent.status).toBe(200);
    expect(db.row("review", "rev-pat-a").status).toBe("SELF_ASSESSMENT");
  });

  it("a new KRA in A is weighed against her A KRAs only", async () => {
    db.seed("kRA", { id: "kra-a2", name: "Train A's juniors", description: null, category: null, roleId: null, organizationId: "a", weight: 0, createdAt: new Date() });
    as("ari", "SUPER_ADMIN", "a");
    const res = await kraAssign(req("/api/kra-assignments", { method: "POST", body: { userId: "pat", kraId: "kra-a2", weightage: 50 } }));
    expect(res.status).toBe(201);
    const body = await json(res);
    // A's 50 and this 50: exactly a full plan (before: 150, B's 50 counted, and a warning over 100).
    expect((body.data ?? body)).toMatchObject({ weightTotal: 100, weightWarning: null });
  });

  it("her open SOPs in A are A's only, the badge's count too", async () => {
    as("pat", "EMPLOYEE", "a");
    const body = await json(await mySops(req("/api/me/sops")));
    expect((body.data as Array<{ sop: { id: string } }>).map((a) => a.sop.id)).toEqual(["sop-a"]);
    // Before: 2, B's SOP counted in A's badge.
    expect(body.count).toBe(1);
  });
});

// The final review, product L8: once Pat works in B from A's account again,
// a new B job title assigns her nothing, and the note says so only for a job
// title that carries KRAs.
describe("a job title for someone who works here from another workspace's account (L8)", () => {
  it("says \"Job title saved\" and why nothing was assigned only when the job title carries KRAs", async () => {
    db.seed("role", { id: "role-b-qa", title: "Tester", description: null, level: null, organizationId: "b" });
    db.seed("role", { id: "role-b-lead", title: "Tech Lead", description: null, level: null, organizationId: "b" });
    db.seed("kRA", { id: "kra-b-lead", name: "Lead B's team", description: null, category: null, roleId: "role-b-lead", organizationId: "b", weight: 30, createdAt: new Date() });
    as("hana", "HR", "b");
    const none = await userPatch(req("/api/users/pat", { method: "PATCH", body: { roleId: "role-b-qa" } }), params("pat"));
    expect(none.status).toBe(200);
    // Before: "KRAs and SOPs are not assigned..." for a job title with nothing to assign.
    expect(await json(none)).not.toHaveProperty("alignmentNote");
    const lead = await userPatch(req("/api/users/pat", { method: "PATCH", body: { roleId: "role-b-lead" } }), params("pat"));
    expect(await json(lead)).toMatchObject({ roleId: "role-b-lead", alignmentNote: "Job title saved. KRAs and SOPs are not assigned to people who work here from another workspace's account." });
    expect(((db.tables.kRAAssignment ?? []) as Row[]).filter((r) => r.userId === "pat").map((r) => r.kraId).sort()).toEqual(["kra-a", "kra-b"]);
  });
});
