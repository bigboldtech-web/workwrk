// Repeating goals, step 3 review (4 medium, 9 low): the stopped goal's last
// period takes its late numbers, undoing a conversion keeps the dates, the
// conversion counts a target added after the period began, and the reads
// refuse a viewer who may not see or edit the goal (canSeeGoal and
// canEditGoal answer false here, never a blanket true).
//
// Step 3: the server reads the screens use (docs/plans/
// recurring-goals.md E1, E2, E4, I). ?period= on GET /api/okrs/[id] and on
// assess (a closed period answers its frozen result and never asks the AI),
// This period on Activity, Past periods, the list rows' period and Due sort,
// Home's "Resets 1 Nov", the profile's window, and the Edit modal's facts.
// Same world as goal-periods.review.test.ts: the real routes, period module
// and rollup over the in-memory database of goal-test-db.ts, an Admin in one
// Asia/Kolkata workspace.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

const { patchSpy, activity, aiOff, aiClient, rights } = vi.hoisted(() => ({
  rights: { see: true, edit: true },
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
  canEditGoal: async () => rights.edit,
  canDeleteGoal: async () => true,
}));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [BOSS] }));
vi.mock("@/lib/access/manager-lines", () => ({ effectiveDirectReportIds: async () => [], countedDottedReportIds: async () => [] }));
vi.mock("@/lib/goal-audience", () => ({
  addGoalAssignees: async () => {},
  canSeeGoal: async () => rights.see,
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
import * as homeRoute from "@/app/api/me/home/route";
import { checkInBody } from "@/app/(dashboard)/okrs/[id]/okr-checkin-modal";
import { goalDatesPayload, restartingLine, undoneDates, type GoalDatesForm } from "./goal-form";

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
async function patch(t: Date, body: Record<string, unknown>) {
  at(t);
  return call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body });
}
const okrRow = (id: string) => rows("oKR").find((o) => o.id === id)!;
const periodRow = (okrId: string, key: string) => rows("goalPeriod").find((p) => p.okrId === okrId && p.key === key);
const rowIn = (krId: string, okrId: string, key: string) => rows("keyResultPeriod").find((r) => r.keyResultId === krId && r.periodId === periodRow(okrId, key)?.id);
const form = (f: Partial<GoalDatesForm>): GoalDatesForm => ({ type: "ONE_TIME", startDate: null, endDate: null, repeat: "MONTHLY", repeatStart: null, repeatUntil: "", reminder: "MONTHLY", firstPeriodStart: "start", ...f });

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.reset();
  activity.length = 0;
  patchSpy.mockClear();
  aiOff.mockClear();
  aiClient.mockClear();
  rights.see = true;
  rights.edit = true;
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

describe("M1: a stopped goal's last period takes its late numbers", () => {
  it("on 2 Nov October is the period shown for now, in its grace; the check-in the page sends lands in October", async () => {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", repeatStart: "2026-10-01", keyResults: [{ title: "Demos", startValue: 0, targetValue: 10 }] });
    const kr = String(krsOf(g.id)[0].id);
    expect((await checkIn(ist(2026, 10, 10), g.id, kr, 4)).status).toBe(200);
    expect((await patch(ist(2026, 10, 20), { id: g.id, stopRepeating: true })).status).toBe(200);
    at(ist(2026, 11, 2));
    const page = await call(okrRoute.GET, `/api/okrs/${g.id}`, { params: { id: g.id } });
    const v = page.body.periodView as { key: string; current: boolean; state: string; takesCheckIns: boolean };
    expect(v).toMatchObject({ key: "2026-10-01", current: true, state: "grace", takesCheckIns: true });
    // Nothing runs after October, so a check-in that names no period finds none.
    const bare = await call(checkInRoute.POST, `/api/okrs/${g.id}/check-in`, { method: "POST", params: { id: g.id }, body: { keyResultId: kr, value: 7 } });
    expect(bare.status).toBe(409);
    // The page names the period on screen, and the number lands in October.
    const sent = await call(checkInRoute.POST, `/api/okrs/${g.id}/check-in`, { method: "POST", params: { id: g.id }, body: checkInBody(kr, 7, "", { key: v.key }) });
    expect(sent.status).toBe(200);
    expect(rowIn(kr, g.id, "2026-10-01")).toMatchObject({ currentValue: 7 });
    // Its assessment is over its own, ended window.
    const assess = await call(assessRoute.GET, `/api/okrs/${g.id}/assess?period=2026-10-01`, { params: { id: g.id } });
    expect(assess.body).toMatchObject({ progress: 70, pctTimeElapsed: 100, daysLeft: null });
  });
});

describe("M2: undoing a conversion keeps the dates the goal had", () => {
  it("\"Launch v2\", due 31 Dec, made monthly and undone gets 31 Dec back and no start date", async () => {
    seedRow(db, "oKR", { id: "g-launch", organizationId: ORG, title: "Launch v2", level: "INDIVIDUAL", ownerId: BOSS, startDate: null, endDate: new Date("2026-12-31T00:00:00Z"), checkInCadence: "MONTHLY", createdAt: ist(2026, 9, 1) });
    seedRow(db, "keyResult", { id: "g-launch-kr", okrId: "g-launch", title: "Partners", startValue: 0, targetValue: 10, currentValue: 0, progress: 0, createdAt: ist(2026, 9, 1) });
    expect((await patch(ist(2026, 10, 10), { id: "g-launch", repeat: "MONTHLY", repeatStart: "2026-10-01", repeatUntil: null })).status).toBe(200);
    expect(okrRow("g-launch")).toMatchObject({ repeat: "MONTHLY", endDate: null });
    // The modal opens Edit, reads the facts, and One time puts the old dates back in its fields.
    const facts = (await call(okrRoute.GET, "/api/okrs/g-launch?edit=1", { params: { id: "g-launch" } })).body.repeatEdit as { previousDates: { startDate: string | null; endDate: string | null } };
    expect(facts.previousDates).toEqual({ startDate: null, endDate: "2026-12-31T00:00:00.000Z" });
    const back = undoneDates(facts.previousDates)!;
    const body = goalDatesPayload(form({ type: "ONE_TIME", ...back }), { repeat: "MONTHLY", repeatUntil: null, firstKey: "2026-10-01", startsEditable: true });
    expect((await patch(ist(2026, 10, 11), { id: "g-launch", title: "Launch v2", ...body })).status).toBe(200);
    const done = okrRow("g-launch");
    expect(done.repeat).toBeNull();
    expect(done.startDate).toBeNull();
    expect((done.endDate as Date).toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("once a period has closed there is nothing to restore (the goal cannot go back)", async () => {
    const g = await createGoalAt(ist(2026, 9, 2), { title: "Calls", repeat: "MONTHLY", repeatStart: "2026-09-01", keyResults: [{ title: "Calls", startValue: 0, targetValue: 10 }] });
    await call((await import("@/app/api/cron/goal-periods/route")).POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
    at(ist(2026, 10, 7));
    await call((await import("@/app/api/cron/goal-periods/route")).POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
    const facts = (await call(okrRoute.GET, `/api/okrs/${g.id}?edit=1`, { params: { id: g.id } })).body.repeatEdit as { closedCount: number; previousDates: unknown };
    expect(facts.closedCount).toBe(1);
    expect(facts.previousDates).toBeNull();
  });
});

describe("M4: a conversion counts a target added after the period began, and says so when it cannot count", () => {
  it("\"October onboarding checklist\" (added 1 Oct, 6 of 8) made monthly on 10 Oct offers the choice, and opens October at 6 when chosen", async () => {
    seedRow(db, "oKR", { id: "g-onb", organizationId: ORG, title: "October onboarding checklist", level: "INDIVIDUAL", ownerId: BOSS, startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z"), checkInCadence: "MONTHLY", createdAt: ist(2026, 10, 1, 10) });
    seedRow(db, "keyResult", { id: "g-onb-kr", okrId: "g-onb", title: "New hires onboarded", startValue: 0, targetValue: 8, currentValue: 6, progress: 75, createdAt: ist(2026, 10, 1, 10) });
    seedRow(db, "kRCheckIn", { id: "onb-c1", keyResultId: "g-onb-kr", value: 6, userId: BOSS, createdAt: ist(2026, 10, 8) });
    at(ist(2026, 10, 10));
    const facts = (await call(okrRoute.GET, "/api/okrs/g-onb?edit=1", { params: { id: "g-onb" } })).body.repeatEdit as { conversion: Record<string, { targets: unknown[]; restarting: unknown[] }> };
    expect(facts.conversion.MONTHLY).toMatchObject({ periodKey: "2026-10-01", periodName: "October", restarting: [] });
    expect(facts.conversion.MONTHLY.targets).toEqual([{ title: "New hires onboarded", unit: null, now: 6, atStart: 0, atStartDay: null, addedDay: "2026-10-01", startValue: 0 }]);
    expect((await patch(ist(2026, 10, 10), { id: "g-onb", repeat: "MONTHLY", repeatStart: "2026-10-01", repeatUntil: null, firstPeriodStart: "change" })).status).toBe(200);
    expect(rowIn("g-onb-kr", "g-onb", "2026-10-01")).toMatchObject({ currentValue: 6 });
  });

  it("a target that was there before the period began, with no check-in before it, cannot be counted: the modal says what happens", async () => {
    seedRow(db, "oKR", { id: "g-port", organizationId: ORG, title: "Partner portal", level: "INDIVIDUAL", ownerId: BOSS, startDate: new Date("2026-09-15T00:00:00Z"), endDate: new Date("2026-12-15T00:00:00Z"), checkInCadence: "WEEKLY", createdAt: ist(2026, 9, 15) });
    seedRow(db, "keyResult", { id: "g-port-kr", okrId: "g-port", title: "Partners live", startValue: 0, targetValue: 12, currentValue: 5, progress: 42, createdAt: ist(2026, 9, 15) });
    seedRow(db, "kRCheckIn", { id: "port-c1", keyResultId: "g-port-kr", value: 5, userId: BOSS, createdAt: ist(2026, 10, 10) });
    at(ist(2026, 10, 12));
    const facts = (await call(okrRoute.GET, "/api/okrs/g-port?edit=1", { params: { id: "g-port" } })).body.repeatEdit as { conversion: Record<string, { periodName: string; targets: unknown[]; restarting: Array<{ title: string; now: number; startValue: number }> }> };
    expect(facts.conversion.MONTHLY.targets).toEqual([]);
    expect(facts.conversion.MONTHLY.restarting).toEqual([{ title: "Partners live", unit: null, now: 5, startValue: 0 }]);
    expect(restartingLine(facts.conversion.MONTHLY.periodName, facts.conversion.MONTHLY.restarting)).toBe("October starts at 0. The 5 checked in so far stay in Activity and won't count.");
  });
});

describe("L8: the reads refuse who may not see or edit the goal", () => {
  async function monthly() {
    const g = await createGoalAt(ist(2026, 10, 5), { title: "Demos", repeat: "MONTHLY", repeatStart: "2026-10-01", keyResults: [{ title: "Demos", startValue: 0, targetValue: 10 }] });
    at(ist(2026, 10, 12));
    return g.id;
  }

  it("a viewer who cannot edit gets no edit facts", async () => {
    const id = await monthly();
    rights.edit = false;
    const r = await call(okrRoute.GET, `/api/okrs/${id}?edit=1`, { params: { id } });
    expect(r.status).toBe(200);
    expect(r.body.repeatEdit).toBeUndefined();
  });

  it("someone who cannot see the goal gets 404 for ?period=, periodKey= and closed periods, as for the goal", async () => {
    const id = await monthly();
    rights.see = false;
    expect((await call(okrRoute.GET, `/api/okrs/${id}?period=2026-10-01`, { params: { id } })).status).toBe(404);
    expect((await call(assessRoute.GET, `/api/okrs/${id}/assess?period=2026-10-01`, { params: { id } })).status).toBe(404);
    expect((await call(checkInsRoute.GET, `/api/okrs/${id}/check-ins?periodKey=2026-10-01`, { params: { id } })).status).toBe(404);
    expect((await call(periodsRoute.GET, `/api/okrs/${id}/periods?closed=1`, { params: { id } })).status).toBe(404);
  });

  it("Home keeps its one-time order: due soonest first, a tie by the newest, no due date last", async () => {
    seedRow(db, "oKR", { id: "a", organizationId: ORG, title: "A", level: "INDIVIDUAL", ownerId: BOSS, endDate: new Date("2026-11-10T00:00:00Z"), checkInCadence: "WEEKLY", status: "ON_TRACK", createdAt: ist(2026, 10, 1) });
    seedRow(db, "oKR", { id: "b", organizationId: ORG, title: "B", level: "INDIVIDUAL", ownerId: BOSS, endDate: new Date("2026-11-10T00:00:00Z"), checkInCadence: "WEEKLY", status: "ON_TRACK", createdAt: ist(2026, 10, 5) });
    seedRow(db, "oKR", { id: "c", organizationId: ORG, title: "C", level: "INDIVIDUAL", ownerId: BOSS, endDate: null, checkInCadence: "WEEKLY", status: "ON_TRACK", createdAt: ist(2026, 10, 9) });
    seedRow(db, "oKR", { id: "d", organizationId: ORG, title: "D", level: "INDIVIDUAL", ownerId: BOSS, endDate: new Date("2026-11-01T00:00:00Z"), checkInCadence: "WEEKLY", status: "ON_TRACK", createdAt: ist(2026, 9, 1) });
    seedRow(db, "oKR", { id: "e", organizationId: ORG, title: "E", level: "INDIVIDUAL", ownerId: BOSS, endDate: new Date("2026-11-20T00:00:00Z"), checkInCadence: "WEEKLY", status: "COMPLETED", createdAt: ist(2026, 9, 1) });
    at(ist(2026, 10, 12));
    const home = (await (await (homeRoute.GET as () => Promise<Response>)()).json()) as { goals: { rows: Array<{ id: string }> } | null };
    expect(home.goals?.rows.map((g) => g.id)).toEqual(["d", "b", "a", "c"]);
  });
});
