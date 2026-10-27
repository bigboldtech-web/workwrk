// Repeating goals, step 3: the server reads the screens use (docs/plans/
// recurring-goals.md E1, E2, E4, I). ?period= on GET /api/okrs/[id] and on
// assess (a closed period answers its frozen result and never asks the AI),
// This period on Activity, Past periods, the list rows' period and Due sort,
// Home's "Resets 1 Nov", the profile's window, and the Edit modal's facts.
// Same world as goal-periods.review.test.ts: the real routes, period module
// and rollup over the in-memory database of goal-test-db.ts, an Admin in one
// Asia/Kolkata workspace.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

const { patchSpy, activity, aiOff, aiClient } = vi.hoisted(() => ({
  patchSpy: vi.fn<(tx: unknown, periodId: string) => Promise<void>>(async () => {}),
  activity: [] as Array<Record<string, unknown>>,
  aiOff: vi.fn(async () => true),
  aiClient: vi.fn(async () => ({ source: "shared", client: null })),
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./goal-test-db")).goalDb.prisma }));
vi.mock("server-only", () => ({}));

const ORG = "org-1";
const BOSS = "u-boss";
const session = legacyTestSession(BOSS, "COMPANY_ADMIN", ORG);

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session }),
  getOrgId: (s: { user: { organizationId: string } }) => s.user.organizationId,
  getUserId: (s: { user: { id: string } }) => s.user.id,
  isManager: () => true,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("next-auth", () => ({ getServerSession: async () => session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/preferences", () => ({ getEffectivePreferences: async () => null }));
vi.mock("@/lib/alignment-scope", () => ({
  goalRightsActor: async (s: { user: { id: string } }) => ({ callerId: s.user.id, admin: true, peopleTeam: true, manager: true, agent: false, chain: null, leadsPeople: true }),
  goalCreatorIds: async () => new Map(),
  isOrgWideAlignment: () => true,
  canEditGoal: async () => true,
  canDeleteGoal: async () => true,
}));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [BOSS] }));
vi.mock("@/lib/access/manager-lines", () => ({ effectiveDirectReportIds: async () => [], countedDottedReportIds: async () => [] }));
vi.mock("@/lib/goal-audience", () => ({
  addGoalAssignees: async () => {},
  canSeeGoal: async () => true,
  goalEditDenial: async () => null,
  memberVisibilityOr: () => [],
  seesUnownedGoals: () => true,
  summarizeGoalAudiences: async (_o: string, list: Array<{ id: string }>) => new Map(list.map((g) => [g.id, { members: [], totalMembers: 0, assigneeCount: 0 }])),
  syncGoalAssignees: async () => {},
  teamAudienceVisibilityOr: async () => [],
  validateGoalAssignees: async () => ({ ok: true, entries: [] }),
  goalVisibilityOr: async () => null,
}));
vi.mock("@/lib/user-tags", () => ({ getUserTagIds: async () => [] }));
vi.mock("@/lib/goals/goal-notify", () => ({ notifyGoalAssigned: async () => {} }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => {}, queueEmail: async () => {} }));
vi.mock("@/lib/email-templates", () => ({ genericNotificationTemplate: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/goal-effort", () => ({
  goalsWithLinkedWork: async () => new Set(),
  computeGoalEffortBatch: async () => new Map(),
  computeGoalEffort: async () => ({ hasLinkedWork: false, linkedKras: 0, linkedBoards: 0, totalHours: 0, hoursThisMonth: 0, tasksDone: 0, tasksOpen: 0, lastActivityAt: null, contributors: [] }),
}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/goals/goal-contributor", () => ({ isGoalContributor: async () => false }));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => {} }));
vi.mock("@/lib/activity", () => ({ logActivity: (a: Record<string, unknown>) => { activity.push(a); } }));
vi.mock("@/lib/goals/goal-period-score.server", () => ({ patchPeriodScore: patchSpy }));
vi.mock("@/lib/ai/ai-off-gate", () => ({ aiOffResponse: aiOff }));
vi.mock("@/lib/ai-client", () => ({ getAnthropicForOrg: aiClient, modelFor: () => "m", createMessageWithFallback: async () => { throw new Error("no AI in a test"); } }));


import { goalDb as db, seedRow } from "./goal-test-db";
import * as okrsRoute from "@/app/api/okrs/route";
import * as okrRoute from "@/app/api/okrs/[id]/route";
import * as checkInRoute from "@/app/api/okrs/[id]/check-in/route";
import * as assessRoute from "@/app/api/okrs/[id]/assess/route";
import * as periodsRoute from "@/app/api/okrs/[id]/periods/route";
import * as checkInsRoute from "@/app/api/okrs/[id]/check-ins/route";
import * as cronRoute from "@/app/api/cron/goal-periods/route";
import * as homeRoute from "@/app/api/me/home/route";
import { goalInPersonWindow } from "@/lib/person-alignment";

const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);

type Json = Record<string, unknown> & { error?: string };
type Handler = (req: never, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(handler: unknown, url: string, init: { method?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<{ status: number; body: Json }> {
  const req = new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await (handler as Handler)(req as never, { params: Promise.resolve(init.params ?? {}) });
  return { status: res.status, body: (await res.json()) as Json };
}

const at = (t: Date) => vi.setSystemTime(t);
const rows = (model: string) => (db.rows[model] ?? []) as Array<Record<string, unknown>>;
const krsOf = (okrId: string) => rows("keyResult").filter((k) => k.okrId === okrId);

async function createGoalAt(t: Date, body: Record<string, unknown>) {
  at(t);
  const r = await call(okrsRoute.POST, "/api/okrs", { method: "POST", body: { level: "INDIVIDUAL", ownerId: BOSS, ...body } });
  return { id: String(r.body.id), status: r.status, body: r.body };
}
async function checkIn(t: Date, okrId: string, keyResultId: string, value: number) {
  at(t);
  return call(checkInRoute.POST, `/api/okrs/${okrId}/check-in`, { method: "POST", params: { id: okrId }, body: { keyResultId, value } });
}
async function runCron(t: Date) {
  at(t);
  return call(cronRoute.POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
}

/**
 * "Demos", monthly from August: 20 of 50 in August (Missed, 40%), 56 of 50 in
 * September (Hit, 112%), 30 so far in October; August and September closed
 * by the cron. Read on 27 October.
 */
async function demosWithHistory(): Promise<{ id: string; kr: string }> {
  const g = await createGoalAt(ist(2026, 8, 1, 9), { title: "Demos", repeat: "MONTHLY", repeatStart: "2026-08-01", keyResults: [{ title: "Demos", startValue: 0, targetValue: 50 }] });
  expect(g.status).toBe(201);
  const kr = String(krsOf(g.id)[0].id);
  expect((await checkIn(ist(2026, 8, 20), g.id, kr, 20)).status).toBe(200);
  await runCron(ist(2026, 9, 7));
  expect((await checkIn(ist(2026, 9, 20), g.id, kr, 56)).status).toBe(200);
  await runCron(ist(2026, 10, 7));
  expect((await checkIn(ist(2026, 10, 15), g.id, kr, 30)).status).toBe(200);
  at(ist(2026, 10, 27));
  return { id: g.id, kr };
}

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.reset();
  activity.length = 0;
  patchSpy.mockClear();
  aiOff.mockClear();
  aiClient.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.RECURRING_GOALS = "1";
  process.env.CRON_SECRET = "test-secret";
  seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
  seedRow(db, "user", { id: BOSS, organizationId: ORG, firstName: "Bo", lastName: "Ss", email: "boss@acme.test", status: "ACTIVE", deletedAt: null });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errors.mockRestore();
});

afterAll(() => {
  delete process.env.RECURRING_GOALS;
  delete process.env.CRON_SECRET;
});

describe("?period= returns a closed period's frozen result (E2, E4, I)", () => {
  it("assess?period= of a closed period: its result and final numbers, and the AI is never asked", async () => {
    const { id } = await demosWithHistory();
    aiOff.mockClear();
    aiClient.mockClear();
    const sep = await call(assessRoute.GET, `/api/okrs/${id}/assess?period=2026-09-01`, { params: { id } });
    expect(sep.status).toBe(200);
    expect(sep.body).toMatchObject({
      closed: true, periodKey: "2026-09-01", periodLabel: "September 2026", result: "HIT", resultLabel: "Hit", attainment: 112, progress: 100,
      headline: "September 2026: Hit, 112%", reasons: ["Demos: 56 of 50"], source: "frozen",
    });
    const aug = await call(assessRoute.GET, `/api/okrs/${id}/assess?period=2026-08-01`, { params: { id } });
    expect(aug.body).toMatchObject({ closed: true, result: "MISSED", headline: "August 2026: Missed, 40%", reasons: ["Demos: 20 of 50"] });
    expect(aiOff).not.toHaveBeenCalled();
    expect(aiClient).not.toHaveBeenCalled();
  });

  it("assess with no ?period= still assesses the period running now; an unknown period is a 404", async () => {
    const { id } = await demosWithHistory();
    const now = await call(assessRoute.GET, `/api/okrs/${id}/assess`, { params: { id } });
    expect(now.status).toBe(200);
    expect(now.body.closed).toBeUndefined();
    expect(now.body.progress).toBe(60);
    expect((await call(assessRoute.GET, `/api/okrs/${id}/assess?period=2026-01-01`, { params: { id } })).status).toBe(404);
  });

  it("assess?period= of a period in its grace is assessed over its own window", async () => {
    const g = await createGoalAt(ist(2026, 9, 1, 9), { title: "Calls", repeat: "MONTHLY", repeatStart: "2026-09-01", keyResults: [{ title: "Calls", startValue: 0, targetValue: 10 }] });
    await checkIn(ist(2026, 9, 25), g.id, String(krsOf(g.id)[0].id), 9);
    at(ist(2026, 10, 3));
    const r = await call(assessRoute.GET, `/api/okrs/${g.id}/assess?period=2026-09-01`, { params: { id: g.id } });
    expect(r.status).toBe(200);
    expect(r.body.closed).toBeUndefined();
    // All of September's time is used; 90% done with no linked work moving
    // it is At risk by the one verdict's rules (goal-verdict.ts assessGoal).
    expect(r.body).toMatchObject({ progress: 90, pctTimeElapsed: 100, daysLeft: null, verdict: "at_risk" });
    // The page's live number is October's (0%), not September's.
    const now = await call(assessRoute.GET, `/api/okrs/${g.id}/assess`, { params: { id: g.id } });
    expect(now.body.progress).toBe(0);
    // The period running now names its calendar days left in the workspace zone, as the period control does.
    expect(now.body.daysLeft).toBe(28);
  });

  it("GET /api/okrs/[id]?period= carries that period as the page shows it", async () => {
    const { id } = await demosWithHistory();
    const sep = await call(okrRoute.GET, `/api/okrs/${id}?period=2026-09-01`, { params: { id } });
    expect(sep.status).toBe(200);
    expect(sep.body.periodView).toMatchObject({
      key: "2026-09-01", label: "September 2026", state: "closed", current: false, result: "HIT", attainment: 112, progress: 100,
      datesLabel: "1 Sep 2026 to 30 Sep 2026", closedDay: "2026-10-07",
    });
    expect((sep.body.periodView as { targets: unknown[] }).targets).toEqual([expect.objectContaining({ title: "Demos", currentValue: 56, targetValue: 50, attainment: 112 })]);
    const now = await call(okrRoute.GET, `/api/okrs/${id}`, { params: { id } });
    expect(now.body.periodView).toMatchObject({ key: "2026-10-01", state: "open", current: true, progress: 60, daysLeft: 4, resetsOn: "2026-11-01", previousLabel: "September 2026" });
    expect((await call(okrRoute.GET, `/api/okrs/${id}?period=2026-01-01`, { params: { id } })).status).toBe(404);
  });

  it("a period in its grace says so: it takes late numbers until 5 Oct", async () => {
    const g = await createGoalAt(ist(2026, 9, 1, 9), { title: "Calls", repeat: "MONTHLY", repeatStart: "2026-09-01", keyResults: [{ title: "Calls", startValue: 0, targetValue: 10 }] });
    at(ist(2026, 10, 3));
    const r = await call(okrRoute.GET, `/api/okrs/${g.id}?period=2026-09-01`, { params: { id: g.id } });
    expect(r.body.periodView).toMatchObject({ state: "grace", takesCheckIns: true, takesLateNumbers: true, graceLastDay: "2026-10-05", kpiHeld: false });
  });
});

describe("Past periods and This period (E2)", () => {
  it("periods?closed=1: the closed periods only, newest first, with '56 of 50' for a one-target goal", async () => {
    const { id } = await demosWithHistory();
    const r = await call(periodsRoute.GET, `/api/okrs/${id}/periods?closed=1`, { params: { id } });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([
      expect.objectContaining({ key: "2026-09-01", label: "September 2026", shortLabel: "Sep", result: "HIT", resultLabel: "Hit", attainment: 112, single: { currentValue: 56, targetValue: 50, unit: null } }),
      expect.objectContaining({ key: "2026-08-01", label: "August 2026", shortLabel: "Aug", result: "MISSED", attainment: 40, single: { currentValue: 20, targetValue: 50, unit: null } }),
    ]);
    expect(r.body.pagination).toMatchObject({ total: 2, pageSize: 12 });
  });

  it("check-ins?periodKey=: only what counted toward that period", async () => {
    const { id } = await demosWithHistory();
    const sep = await call(checkInsRoute.GET, `/api/okrs/${id}/check-ins?periodKey=2026-09-01`, { params: { id } });
    expect((sep.body.items as Array<{ value: number; previous: number | null }>).map((c) => [c.value, c.previous])).toEqual([[56, null]]);
    const all = await call(checkInsRoute.GET, `/api/okrs/${id}/check-ins`, { params: { id } });
    expect(all.body.total).toBe(3);
    expect((await call(checkInsRoute.GET, `/api/okrs/${id}/check-ins?periodKey=1999-01-01`, { params: { id } })).status).toBe(404);
  });
});

describe("the list, Home and the profile (E1, E4)", () => {
  it("a list row carries its period's days and closed count, Sort by Due uses the period's end, and the switch hands the period settings", async () => {
    const { id } = await demosWithHistory();
    seedRow(db, "oKR", { id: "g-launch", organizationId: ORG, title: "Launch v2", level: "INDIVIDUAL", ownerId: BOSS, startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-11-15T00:00:00Z"), checkInCadence: "WEEKLY", createdAt: ist(2026, 10, 1) });
    const r = await call(okrsRoute.GET, "/api/okrs?page=1&sort=due");
    const data = r.body.data as Array<{ id: string; period: Record<string, unknown> | null; closedPeriods: number; repeat: string | null }>;
    expect(data.map((d) => d.id)).toEqual([id, "g-launch"]);
    expect(data[0]).toMatchObject({ repeat: "MONTHLY", closedPeriods: 2, period: expect.objectContaining({ label: "October 2026", lastDay: "2026-10-31", nominalLastDay: "2026-10-31", resetsOn: "2026-11-01" }) });
    expect(r.body.periodSettings).toEqual({ timezone: "Asia/Kolkata", weekStart: "MON", fiscalYearStart: 4 });
    delete process.env.RECURRING_GOALS;
    expect((await call(okrsRoute.GET, "/api/okrs?page=1")).body.periodSettings).toBeUndefined();
  });

  it("the Due filter matches a repeating goal by its current period's end", async () => {
    const { id } = await demosWithHistory();
    const inOct = await call(okrsRoute.GET, "/api/okrs?page=1&dueFrom=2026-10-01&dueTo=2026-10-31");
    expect((inOct.body.data as Array<{ id: string }>).map((d) => d.id)).toEqual([id]);
    const inNov = await call(okrsRoute.GET, "/api/okrs?page=1&dueFrom=2026-11-01&dueTo=2026-11-30");
    expect(inNov.body.data).toEqual([]);
  });

  it("Home's row carries what 'Resets 1 Nov' is made of", async () => {
    const { id } = await demosWithHistory();
    const home = (await (await (homeRoute.GET as () => Promise<Response>)()).json()) as { goals: { rows: Array<Record<string, unknown>> } | null };
    expect(home.goals?.rows.find((g) => g.id === id)).toMatchObject({ repeat: "MONTHLY", repeatUntil: null, period: { label: "October 2026", lastDay: "2026-10-31", nominalLastDay: "2026-10-31", resetsOn: "2026-11-01" } });
  });

  it("Home sorts a repeating goal by its period's end among the dated ones, so five later goals never hide it", async () => {
    const { id } = await demosWithHistory();
    for (let i = 0; i < 5; i++) {
      seedRow(db, "oKR", { id: `g-dated-${i}`, organizationId: ORG, title: `Dated ${i}`, level: "INDIVIDUAL", ownerId: BOSS, endDate: new Date(`2026-12-1${i}T00:00:00Z`), checkInCadence: "WEEKLY", status: "ON_TRACK", createdAt: ist(2026, 10, 1) });
    }
    seedRow(db, "oKR", { id: "g-soon", organizationId: ORG, title: "Soon", level: "INDIVIDUAL", ownerId: BOSS, endDate: new Date("2026-10-29T00:00:00Z"), checkInCadence: "WEEKLY", status: "ON_TRACK", createdAt: ist(2026, 10, 1) });
    const home = (await (await (homeRoute.GET as () => Promise<Response>)()).json()) as { goals: { rows: Array<{ id: string }> } | null };
    expect(home.goals?.rows.map((g) => g.id)).toEqual(["g-soon", id, "g-dated-0", "g-dated-1", "g-dated-2"]);
  });

  it("the profile treats a running repeating goal as current, even one that hit its number and began last quarter", () => {
    const ctx = { label: null, legacyLabels: ["Q4 2026", "Q3 FY27"], quarterStart: new Date("2026-10-01T00:00:00Z"), fiscalStart: 4 };
    const goal = { quarter: null, endDate: null, completedAt: null, createdAt: new Date("2026-08-01T00:00:00Z"), repeat: "MONTHLY" };
    expect(goalInPersonWindow(goal, "completed", ctx)).toBe(true);
    expect(goalInPersonWindow(goal, "completed", { ...ctx, label: "Q3 FY27" })).toBe(true);
    expect(goalInPersonWindow(goal, "completed", { ...ctx, label: "Q1 FY27" })).toBe(false);
    // An ended one follows the one-time rule.
    expect(goalInPersonWindow({ ...goal, completedAt: new Date("2026-09-06T00:00:00Z") }, "completed", ctx)).toBe(false);
  });
});

describe("the Edit modal's facts (A3, GET /api/okrs/[id]?edit=1)", () => {
  it("a one-time goal: what 'What was added since 1 Oct' would count, '38 now, 30 on 30 Sep'", async () => {
    seedRow(db, "oKR", { id: "g-deals", organizationId: ORG, title: "Deals", level: "INDIVIDUAL", ownerId: BOSS, startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), checkInCadence: "MONTHLY", createdAt: ist(2026, 9, 1) });
    seedRow(db, "keyResult", { id: "g-deals-kr", okrId: "g-deals", title: "Deals", startValue: 0, targetValue: 100, currentValue: 38, progress: 38, createdAt: ist(2026, 9, 1) });
    seedRow(db, "kRCheckIn", { id: "c1", keyResultId: "g-deals-kr", value: 30, userId: BOSS, createdAt: ist(2026, 9, 30, 12) });
    seedRow(db, "kRCheckIn", { id: "c2", keyResultId: "g-deals-kr", value: 38, userId: BOSS, createdAt: ist(2026, 10, 10, 12) });
    at(ist(2026, 10, 27));
    const r = await call(okrRoute.GET, "/api/okrs/g-deals?edit=1", { params: { id: "g-deals" } });
    const facts = r.body.repeatEdit as Record<string, unknown> & { conversion: Record<string, unknown> };
    expect(facts).toMatchObject({ settings: { timezone: "Asia/Kolkata" }, kpiLinked: false, allAutomatic: false, current: null });
    expect(facts.conversion.MONTHLY).toEqual({ periodKey: "2026-10-01", periodName: "October", startDay: "2026-10-01", targets: [{ title: "Deals", unit: null, now: 38, atStart: 30, atStartDay: "2026-09-30", startValue: 0 }] });
  });

  it("a repeating goal: its current period, its first period's check-ins, and Starts locked once a period has closed", async () => {
    const { id } = await demosWithHistory();
    const r = await call(okrRoute.GET, `/api/okrs/${id}?edit=1`, { params: { id } });
    expect(r.body.repeatEdit).toMatchObject({
      current: { key: "2026-10-01", label: "October 2026", nominalLastDay: "2026-10-31", status: "OPEN" },
      startsEditable: false, firstKey: "2026-08-01", firstLabel: "August 2026", firstCheckIns: 1, closedCount: 2,
    });
  });

  it("no edit facts while the switch is off for a one-time goal", async () => {
    seedRow(db, "oKR", { id: "g-x", organizationId: ORG, title: "X", level: "INDIVIDUAL", ownerId: BOSS, endDate: new Date("2026-12-31T00:00:00Z"), checkInCadence: "WEEKLY", createdAt: ist(2026, 9, 1) });
    delete process.env.RECURRING_GOALS;
    at(ist(2026, 10, 27));
    const r = await call(okrRoute.GET, "/api/okrs/g-x?edit=1", { params: { id: "g-x" } });
    expect(r.status).toBe(200);
    expect(r.body.repeatEdit).toBeUndefined();
    expect(r.body.periodView).toBeNull();
  });
});
