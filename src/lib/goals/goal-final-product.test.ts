// Repeating goals, the final review's product, accessibility and copy
// findings (b7ef7be6, 2026-10-29), the server and the pure words: H1 late
// numbers, H2 a goal that has not started, M1 to M6, M12, the copy of L1,
// L5 to L11, L14, L16, L18 and L19, and run 1's KPI refusals. The screens'
// markup is src/app/(dashboard)/okrs/[id]/goal-final-product.test.ts.
//
// The step 3 world (goal-periods.step3.test.ts): the real routes, period
// module and rollup over the in-memory database of goal-test-db.ts, an
// Admin in one Asia/Kolkata workspace.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

const { patchSpy, activity, aiOff, aiClient, aiReply } = vi.hoisted(() => ({
  patchSpy: vi.fn<(tx: unknown, periodId: string) => Promise<void>>(async () => {}),
  activity: [] as Array<Record<string, unknown>>,
  aiOff: vi.fn(async () => true),
  aiClient: vi.fn(async () => ({ source: "shared", client: null }) as { source: string; client: unknown }),
  aiReply: vi.fn(async (): Promise<unknown> => { throw new Error("no AI in a test"); }),
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
  canTouchUserAlignment: async () => true,
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
vi.mock("@/lib/ai-allowance", () => ({ aiAutoAllowed: async () => true }));
vi.mock("@/lib/ai-client", () => ({ getAnthropicForOrg: aiClient, modelFor: () => "m", createMessageWithFallback: aiReply }));

import { goalDb as db, seedRow } from "./goal-test-db";
import * as okrsRoute from "@/app/api/okrs/route";
import * as okrRoute from "@/app/api/okrs/[id]/route";
import * as checkInRoute from "@/app/api/okrs/[id]/check-in/route";
import * as assessRoute from "@/app/api/okrs/[id]/assess/route";
import * as checkInsRoute from "@/app/api/okrs/[id]/check-ins/route";
import * as krRoute from "@/app/api/okrs/[id]/key-results/[krId]/route";
import * as cronRoute from "@/app/api/cron/goal-periods/route";
import { goalPeriodsSummary } from "./goal-period-view.server";
import { goalVerdicts } from "./goal-verdicts.server";
import { kpiAfterWeeksWords, kpiOwnerDeniedWords } from "./goal-periods.server";
import {
  blockedSaveWords,
  conversionCountLine,
  dueDateRemovedLine,
  endedSoFar,
  goalPageDoors,
  lateNumbersNote,
  notStartedLine,
  offersMonthlyConversion,
  periodTargetsLine,
  periodTopLine,
  repeatMenuAction,
  repeatsRowText,
  restartingLine,
  startChoices,
} from "./goal-form";
import { mentionsDueDate, verdictChip, verdictNarrative } from "@/lib/goal-verdict";
import { PAUSE, pausedInboxMessage, PREVIEW_FAILED } from "./goal-source";
import { TABLE_PAUSE } from "./table-source";
import { startedTitle } from "./goal-period-notify.server";
import { KINDS } from "@/lib/inbox-kinds";
import { lastNumbersDayKey, periodFor, type PeriodSettings } from "./goal-period";

const IST: PeriodSettings = { timezone: "Asia/Kolkata", weekStart: "MON", fiscalYearStart: 4 };
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
async function checkIn(t: Date, okrId: string, keyResultId: string, value: number, periodKey?: string) {
  at(t);
  return call(checkInRoute.POST, `/api/okrs/${okrId}/check-in`, { method: "POST", params: { id: okrId }, body: { keyResultId, value, ...(periodKey ? { periodKey } : {}) } });
}
async function runCron(t: Date) {
  at(t);
  return call(cronRoute.POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
}

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.reset();
  activity.length = 0;
  patchSpy.mockClear();
  aiOff.mockReset();
  aiOff.mockImplementation(async () => true);
  aiClient.mockReset();
  aiClient.mockImplementation(async () => ({ source: "shared", client: null }));
  aiReply.mockReset();
  aiReply.mockImplementation(async () => { throw new Error("no AI in a test"); });
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

/* ───────────────────────── H1 ───────────────────────── */

describe("H1: while October still takes late numbers, November's card says so and links to it", () => {
  it("the period view of November carries October's grace, the note names it, and a check-in through the link lands in October", async () => {
    const g = await createGoalAt(ist(2026, 10, 1, 9), { title: "Demos", repeat: "MONTHLY", repeatStart: "2026-10-01", keyResults: [{ title: "Demos booked", startValue: 0, targetValue: 40 }] });
    const kr = String(krsOf(g.id)[0].id);
    expect((await checkIn(ist(2026, 10, 25), g.id, kr, 20)).status).toBe(200);
    at(ist(2026, 11, 3));
    const nov = await call(okrRoute.GET, `/api/okrs/${g.id}`, { params: { id: g.id } });
    const view = nov.body.periodView as Record<string, unknown> & { previous: Parameters<typeof lateNumbersNote>[0] & { key: string } };
    expect(view).toMatchObject({ key: "2026-11-01", current: true, state: "open" });
    expect(view.previous).toEqual({ key: "2026-10-01", label: "October 2026", cadence: "MONTHLY", takesLateNumbers: true, kpiHeld: false, graceLastDay: "2026-11-05", kpiLastDay: null });
    expect(lateNumbersNote(view.previous, true)).toEqual({ line: "October still takes late numbers until 5 Nov.", linkLabel: "Check in for October" });
    expect(lateNumbersNote(view.previous, false)).toEqual({ line: "October still takes late numbers until 5 Nov.", linkLabel: "Open October" });
    // The link opens ?period=2026-10-01, whose check-in lands in October.
    expect((await checkIn(ist(2026, 11, 3), g.id, kr, 26, view.previous.key)).status).toBe(200);
    const oct = rows("goalPeriod").find((p) => p.okrId === g.id && p.key === "2026-10-01")!;
    expect(rows("keyResultPeriod").find((r) => r.periodId === oct.id)).toMatchObject({ currentValue: 26 });
    // Past its grace it takes nothing more: no note, and once closed, no previous at all.
    at(ist(2026, 11, 6, 9));
    const after = (await call(okrRoute.GET, `/api/okrs/${g.id}`, { params: { id: g.id } })).body.periodView as { previous: Parameters<typeof lateNumbersNote>[0] };
    expect(lateNumbersNote(after.previous, true)).toBeNull();
    await runCron(ist(2026, 11, 7));
    at(ist(2026, 11, 7, 12));
    expect(((await call(okrRoute.GET, `/api/okrs/${g.id}`, { params: { id: g.id } })).body.periodView as { previous: unknown }).previous).toBeNull();
  });

  it("a period held for its KPI month says KPI numbers, with Open October", () => {
    const prev = { label: "October 2026", cadence: "MONTHLY" as const, takesLateNumbers: false, kpiHeld: true, graceLastDay: "2026-11-05", kpiLastDay: "2026-11-30" };
    expect(lateNumbersNote(prev, true)).toEqual({ line: "October still takes KPI numbers until 30 Nov.", linkLabel: "Open October" });
    expect(lateNumbersNote({ ...prev, label: "Week of 19 Oct", cadence: "WEEKLY", takesLateNumbers: true, kpiHeld: false, graceLastDay: "2026-10-27" }, true))
      .toEqual({ line: "The week of 19 Oct still takes late numbers until 27 Oct.", linkLabel: "Check in for the week of 19 Oct" });
  });
});

/* ───────────────────────── H2 ───────────────────────── */

describe("H2: a goal that has not started reads Not started, takes no check-in, and never names a due date", () => {
  async function november() {
    const g = await createGoalAt(ist(2026, 10, 27, 9), { title: "Calls", repeat: "MONTHLY", repeatStart: "2026-11-01", keyResults: [{ title: "Calls made", startValue: 0, targetValue: 50 }] });
    expect(g.status).toBe(201);
    return g;
  }

  it("the summary's first day and label, the verdict, and the top line", async () => {
    const g = await november();
    const okr = rows("oKR").find((o) => o.id === g.id)! as { id: string; repeat: string | null; repeatUntil: string | null; startDate: Date | null };
    const summary = await goalPeriodsSummary(okr, IST, ist(2026, 10, 27));
    expect(summary).toMatchObject({ started: false, startLabel: "November 2026", startsOn: "2026-11-01", choices: [] });
    expect(notStartedLine(summary!.startsOn)).toBe("Starts 1 Nov. Check-ins open then.");
  });

  it("assess: Not started, Starts November 2026., no pace, no staleness, no AI, never a due date", async () => {
    const g = await november();
    aiOff.mockImplementation(async () => false);
    aiClient.mockImplementation(async () => ({ source: "org", client: {} }));
    at(ist(2026, 10, 31, 18));
    const r = await call(assessRoute.GET, `/api/okrs/${g.id}/assess`, { params: { id: g.id } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verdict: "not_started", headline: "Starts November 2026.", reasons: [], pctTimeElapsed: null, daysLeft: null, isStale: false, progress: null });
    expect(String(r.body.recommendation)).toBe("Set up its targets now. They start counting on 1 Nov.");
    expect(JSON.stringify(r.body)).not.toMatch(/due date/i);
    expect(aiReply).not.toHaveBeenCalled();
    expect(verdictChip("not_started")).toEqual({ tone: "neutral", label: "Not started" });
  });

  it("the list reads it Not started too, even a month without a check-in", async () => {
    const g = await november();
    seedRow(db, "oKR", { id: "g-old", organizationId: ORG, title: "Old", level: "INDIVIDUAL", ownerId: BOSS, repeat: "MONTHLY", startDate: new Date("2026-12-01T00:00:00Z"), checkInCadence: "WEEKLY", status: "ON_TRACK", progress: 0, createdAt: ist(2026, 10, 1) });
    seedRow(db, "keyResult", { id: "g-old-kr", okrId: "g-old", title: "Typed", startValue: 0, targetValue: 10, currentValue: 0, progress: 0, createdAt: ist(2026, 10, 1) });
    at(ist(2026, 10, 31));
    const list = await call(okrsRoute.GET, "/api/okrs?page=1");
    const data = list.body.data as Array<{ id: string; verdict: string }>;
    expect(data.find((d) => d.id === g.id)?.verdict).toBe("not_started");
    // Made on 1 October, starting in December: a month with no check-in is not At risk.
    expect(data.find((d) => d.id === "g-old")?.verdict).toBe("not_started");
  });

  it("an AI sentence about a due date never reaches a repeating goal: the worked-out words stand", async () => {
    const g = await createGoalAt(ist(2026, 10, 1, 9), { title: "Demos", repeat: "MONTHLY", repeatStart: "2026-10-01", keyResults: [{ title: "Demos booked", startValue: 0, targetValue: 40 }] });
    await checkIn(ist(2026, 10, 10), g.id, String(krsOf(g.id)[0].id), 15);
    aiOff.mockImplementation(async () => false);
    aiClient.mockImplementation(async () => ({ source: "org", client: {} }));
    aiReply.mockImplementation(async () => ({ content: [{ type: "text", text: JSON.stringify({ headline: "On track for the due date.", reasons: ["15 of 40 with the deadline near."], recommendation: "Keep going before the due date." }) }] }));
    at(ist(2026, 10, 12));
    const r = await call(assessRoute.GET, `/api/okrs/${g.id}/assess`, { params: { id: g.id } });
    expect(aiReply).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r.body)).not.toMatch(/due date|deadline/i);
    expect(r.body.headline).toBe("On track for October 2026.");
    // The model is told the goal repeats and has no due date.
    const sent = aiReply.mock.calls[0] as unknown as [unknown, { system: string; messages: Array<{ content: string }> }];
    expect(sent[1].system).toContain("has NO due date");
    expect(JSON.parse(sent[1].messages[0].content)).toMatchObject({ repeats: "monthly", period: "October 2026" });
    expect(mentionsDueDate("Check in, a check-in is due.")).toBe(false);
    expect(mentionsDueDate("On track for the due date.")).toBe(true);
  });

  it("no worked-out sentence of a repeating goal names a due date", () => {
    const base = { progress: 50, pctTimeElapsed: 40, daysLeft: 10, isStale: false, daysSinceCheckin: 1, hasLinkedWork: true, totalHours: 0, tasksOpen: 0, tasksDone: 0 };
    expect(verdictNarrative("on_track", { ...base, periodLabel: null, repeating: true }).headline).toBe("On track for this period.");
    expect(verdictNarrative("on_track", { ...base, periodLabel: null }).headline).toBe("On track for the due date.");
  });
});

/* ───────────────────────── M1 ───────────────────────── */

describe("M1: a period in its grace shows its result so far, not a pace", () => {
  it("Week of 19 Oct ended: Partly hit so far, 84%. Late numbers until 27 Oct.", () => {
    const base = { label: "Week of 19 Oct", state: "grace" as const, progress: 84, attainment: 84, takesLateNumbers: true, kpiHeld: false, graceLastDay: "2026-10-27", kpiLastDay: null };
    expect(endedSoFar(base)?.text).toBe("Week of 19 Oct ended: Partly hit so far, 84%. Late numbers until 27 Oct.");
    expect(endedSoFar({ ...base, label: "October 2026", progress: 100, attainment: 112, graceLastDay: "2026-11-05" })?.text).toBe("October 2026 ended: Hit so far, 112%. Late numbers until 5 Nov.");
    expect(endedSoFar({ ...base, state: "closing", takesLateNumbers: false })?.text).toBe("Week of 19 Oct ended: Partly hit so far, 84%. Its final numbers are being saved.");
    expect(endedSoFar({ ...base, takesLateNumbers: false, kpiHeld: true, kpiLastDay: "2026-11-30" })?.tail).toBe("KPI numbers until 30 Nov.");
    expect(endedSoFar({ ...base, progress: null, attainment: null })?.text).toBe("Week of 19 Oct ended: Not measured yet. Late numbers until 27 Oct.");
    expect(endedSoFar({ ...base, state: "open" })).toBeNull();
    expect(endedSoFar({ ...base, state: "closed" })).toBeNull();
  });
});

/* ───────────────────────── M2, M3, M8, L18 ───────────────────────── */

describe("M2: a conversion starts in the period running now", () => {
  it("on 27 October a new goal defaults to November, a conversion to October", () => {
    const now = ist(2026, 10, 27);
    expect(startChoices("MONTHLY", now, IST).defaultKey).toBe("2026-11-01");
    expect(startChoices("MONTHLY", now, IST, { conversion: true }).defaultKey).toBe("2026-10-01");
  });
});

describe("M3: the A5 offer for a monthly goal with no start date", () => {
  const base = { repeat: null, checkInCadence: "MONTHLY", startDate: null, endDate: "2026-10-31T00:00:00.000Z", completedAt: null };
  it("offered with no start or a start on the 1st, inside the month; not otherwise", () => {
    expect(offersMonthlyConversion(base, "2026-10-12")).toBe(true);
    expect(offersMonthlyConversion({ ...base, startDate: "2026-10-01T00:00:00.000Z" }, "2026-10-12")).toBe(true);
    expect(offersMonthlyConversion({ ...base, startDate: "2026-10-05T00:00:00.000Z" }, "2026-10-12")).toBe(false);
    expect(offersMonthlyConversion({ ...base, endDate: "2026-10-30T00:00:00.000Z" }, "2026-10-12")).toBe(false);
    expect(offersMonthlyConversion(base, "2026-11-02")).toBe(false);
    expect(goalPageDoors({ recurringOn: true, canEdit: true, repeat: null, checkInCadence: "MONTHLY", allAutomatic: false, startDate: null, endDate: base.endDate, completedAt: null, today: "2026-10-12" }).migrationOffer).toBe(true);
  });
});

describe("M8 and L18: the conversion's words", () => {
  it("the due date removed, what was added since, and the numbers a later Starts leaves behind", () => {
    expect(dueDateRemovedLine("2026-10-31T00:00:00.000Z")).toBe("The due date 31 Oct is removed.");
    expect(dueDateRemovedLine(null)).toBeNull();
    expect(conversionCountLine("2026-10-01", { title: "Demos", now: 5, atStart: 3, atStartDay: "2026-09-30", addedDay: null }, false)).toBe("What was added since 1 Oct: 2 (5 now, 3 on 30 Sep)");
    expect(restartingLine("November", [{ title: "Demos", now: 6, startValue: 0 }], "October")).toBe("November starts at 0. October's 6 so far stay in Activity and won't count toward November.");
    expect(restartingLine("October", [{ title: "Demos", now: 6, startValue: 0 }], "October")).toBe("October starts at 0. The 6 checked in so far stay in Activity and won't count.");
  });
});

/* ───────────────────────── M4, L6 ───────────────────────── */

describe("M4: one day for a closed period, the last day it took numbers", () => {
  it("the card and the 409 name the same day, not the day the cron ran", async () => {
    const g = await createGoalAt(ist(2026, 9, 1, 9), { title: "Calls", repeat: "MONTHLY", repeatStart: "2026-09-01", keyResults: [{ title: "Calls", startValue: 0, targetValue: 10 }] });
    const kr = String(krsOf(g.id)[0].id);
    await checkIn(ist(2026, 9, 20), g.id, kr, 7);
    // The cron is late: it closes September on 9 October.
    await runCron(ist(2026, 10, 9));
    at(ist(2026, 10, 12));
    const sep = (await call(okrRoute.GET, `/api/okrs/${g.id}?period=2026-09-01`, { params: { id: g.id } })).body.periodView as Parameters<typeof periodTargetsLine>[0] & { closedDay: string; lastNumbersDay: string };
    expect(sep.closedDay).toBe("2026-10-09");
    expect(sep.lastNumbersDay).toBe("2026-10-05");
    expect(periodTargetsLine(sep)).toBe("Took numbers until 5 Oct. Its numbers are final.");
    const late = await checkIn(ist(2026, 10, 12), g.id, kr, 9, "2026-09-01");
    expect(late).toMatchObject({ status: 409, body: { error: "September took its last numbers on 5 Oct. Its numbers are final." } });
  });

  it("a KPI-held period's last day is its KPI day; closing says its numbers are being saved", () => {
    const p = periodFor("MONTHLY", ist(2026, 10, 15), IST);
    expect(lastNumbersDayKey({ ...p, graceEndsAt: new Date("2026-11-05T18:30:00Z"), closesAt: new Date("2026-12-01T14:00:00Z") }, IST)).toBe("2026-11-30");
    expect(lastNumbersDayKey({ ...p, graceEndsAt: new Date("2026-11-05T18:30:00Z"), closesAt: new Date("2026-11-05T18:30:00Z") }, IST)).toBe("2026-11-05");
    const facts = { state: "closing" as const, takesLateNumbers: false, kpiHeld: false, graceLastDay: "2026-11-05", kpiLastDay: null, closedDay: null };
    expect(periodTargetsLine(facts)).toBe("Closing. Its final numbers are being saved.");
    expect(periodTargetsLine({ ...facts, state: "closed", kpiHeld: true, kpiLastDay: "2026-11-30" })).toBe("Took numbers until 30 Nov. Its numbers are final.");
  });
});

/* ───────────────────────── M5 ───────────────────────── */

describe("M5: the goal's own changes are in its Activity, each naming its target", () => {
  it("the conversion line and a target change sit among the check-ins, newest first; This period keeps its own", async () => {
    const g = await createGoalAt(ist(2026, 10, 2, 9), { title: "Demos", endDate: "2026-10-31", checkInCadence: "MONTHLY", keyResults: [{ title: "Demos booked", startValue: 0, targetValue: 60 }] });
    at(ist(2026, 10, 15));
    const conv = await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: g.id, repeat: "MONTHLY", repeatStart: "2026-10-01", repeatUntil: null } });
    expect(conv.status).toBe(200);
    const kr = String(krsOf(g.id)[0].id);
    expect((await checkIn(ist(2026, 10, 16), g.id, kr, 12)).status).toBe(200);
    at(ist(2026, 10, 18));
    const edit = await call(krRoute.PATCH, `/api/okrs/${g.id}/key-results/${kr}`, { method: "PATCH", params: { id: g.id, krId: kr }, body: { targetValue: 40 } });
    expect(edit.status).toBe(200);
    // The edit's line names its target (written through logActivity, stood in for here).
    const line = activity.find((a) => String(a.description).includes("target changed"))!;
    expect(line.description).toBe("Demos booked: target changed from 60 to 40 for October 2026");
    seedRow(db, "activityLog", { id: "al-edit", type: "okr_updated", actorId: BOSS, organizationId: ORG, description: line.description, targetId: g.id, targetType: "okr", createdAt: ist(2026, 10, 18) });
    // Another goal's line and another type never come in.
    seedRow(db, "activityLog", { id: "al-other", type: "okr_updated", actorId: BOSS, organizationId: ORG, description: "Elsewhere", targetId: "g-other", targetType: "okr", createdAt: ist(2026, 10, 19) });
    seedRow(db, "activityLog", { id: "al-made", type: "okr_created", actorId: BOSS, organizationId: ORG, description: "Created OKR", targetId: g.id, targetType: "okr", createdAt: ist(2026, 10, 19) });
    at(ist(2026, 10, 20));
    const all = await call(checkInsRoute.GET, `/api/okrs/${g.id}/check-ins`, { params: { id: g.id } });
    const items = all.body.items as Array<{ kind: string; description?: string; value?: number; by: { firstName: string } | null }>;
    expect(items.map((i) => (i.kind === "update" ? i.description : `check-in ${i.value}`))).toEqual([
      "Demos booked: target changed from 60 to 40 for October 2026",
      "check-in 12",
      "Due date 31 Oct removed when this goal became monthly",
    ]);
    expect(items[0].by).toMatchObject({ firstName: "Bo" });
    expect(all.body.total).toBe(3);
    // This period: the lines written inside October's dates.
    const oct = await call(checkInsRoute.GET, `/api/okrs/${g.id}/check-ins?periodKey=2026-10-01`, { params: { id: g.id } });
    expect((oct.body.items as Array<{ kind: string }>).map((i) => i.kind)).toEqual(["update", "check-in", "update"]);
  });

  it("pages of twelve hold the merged feed in order", async () => {
    const g = await createGoalAt(ist(2026, 10, 1, 9), { title: "Calls", repeat: "MONTHLY", repeatStart: "2026-10-01", keyResults: [{ title: "Calls", startValue: 0, targetValue: 100 }] });
    const kr = String(krsOf(g.id)[0].id);
    for (let d = 2; d <= 15; d++) await checkIn(ist(2026, 10, d, 10), g.id, kr, d);
    for (let d = 2; d <= 15; d++) seedRow(db, "activityLog", { id: `al-${d}`, type: "okr_updated", actorId: null, organizationId: ORG, description: `Line ${d}`, targetId: g.id, targetType: "okr", createdAt: ist(2026, 10, d, 11) });
    at(ist(2026, 10, 20));
    const p1 = await call(checkInsRoute.GET, `/api/okrs/${g.id}/check-ins?page=1`, { params: { id: g.id } });
    const p2 = await call(checkInsRoute.GET, `/api/okrs/${g.id}/check-ins?page=2`, { params: { id: g.id } });
    const label = (i: { kind: string; description?: string; value?: number }) => (i.kind === "update" ? i.description : `c${i.value}`);
    expect((p1.body.items as never[]).map(label)).toEqual(["Line 15", "c15", "Line 14", "c14", "Line 13", "c13", "Line 12", "c12", "Line 11", "c11", "Line 10", "c10"]);
    expect((p2.body.items as never[]).map(label).slice(0, 2)).toEqual(["Line 9", "c9"]);
    expect(p1.body).toMatchObject({ total: 28, hasMore: true });
    // A system line has no person.
    expect((p1.body.items as Array<{ by: unknown }>)[0].by).toBeNull();
  });
});

/* ───────────────────────── M6 ───────────────────────── */

describe("M6: the row menu can undo Stop repeating and restart an ended goal", () => {
  const period = { label: "October 2026", lastDay: "2026-10-31", nominalLastDay: "2026-10-31", resetsOn: "2026-11-01" };
  it("Stop repeating, then Keep repeating; an ended goal, Repeat again while the switch is on", () => {
    expect(repeatMenuAction({ repeat: "MONTHLY", period }, true)).toBe("stop");
    expect(repeatMenuAction({ repeat: "MONTHLY", period, repeatUntil: "2026-10-31" }, true)).toBe("keep");
    expect(repeatMenuAction({ repeat: "MONTHLY", period, repeatUntil: "2026-10-31" }, false)).toBe("keep");
    expect(repeatMenuAction({ repeat: "MONTHLY", period, completedAt: "2026-11-06T00:00:00Z" }, true)).toBe("again");
    expect(repeatMenuAction({ repeat: "MONTHLY", period, completedAt: "2026-11-06T00:00:00Z" }, false)).toBeNull();
    expect(repeatMenuAction({ repeat: null, period }, true)).toBeNull();
  });

  it("the PATCH the menu sends (repeatUntil: null) keeps a stopping goal running and restarts an ended one", async () => {
    const g = await createGoalAt(ist(2026, 10, 1, 9), { title: "Demos", repeat: "MONTHLY", repeatStart: "2026-10-01", keyResults: [{ title: "Demos", startValue: 0, targetValue: 10 }] });
    at(ist(2026, 10, 10));
    expect((await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: g.id, stopRepeating: true } })).status).toBe(200);
    expect(rows("oKR").find((o) => o.id === g.id)?.repeatUntil).toBe("2026-10-31");
    expect((await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: g.id, repeatUntil: null } })).status).toBe(200);
    expect(rows("oKR").find((o) => o.id === g.id)?.repeatUntil).toBeNull();
    // Stopped and ended at October's close; Repeat again on 10 December restarts from December.
    expect((await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: g.id, stopRepeating: true } })).status).toBe(200);
    await runCron(ist(2026, 11, 7));
    expect(rows("oKR").find((o) => o.id === g.id)?.completedAt).toBeTruthy();
    at(ist(2026, 12, 10));
    expect((await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: g.id, repeatUntil: null } })).status).toBe(200);
    expect(rows("oKR").find((o) => o.id === g.id)?.completedAt).toBeNull();
    expect(rows("goalPeriod").filter((p) => p.okrId === g.id).map((p) => p.key).sort()).toEqual(["2026-10-01", "2026-12-01"]);
  });
});

/* ───────────────────────── M12 ───────────────────────── */

describe("M12: a target counted from a List is linked work", () => {
  it("past 60% of the time with no other link it is not At risk, and the words say a List moves it", async () => {
    seedRow(db, "oKR", { id: "g-list", organizationId: ORG, title: "Ship", level: "INDIVIDUAL", ownerId: BOSS, startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z"), checkInCadence: "NONE", status: "ON_TRACK", progress: 75, createdAt: ist(2026, 10, 1) });
    const goal = { id: "g-list", progress: 75, status: "ON_TRACK", startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z"), createdAt: ist(2026, 10, 1), completedAt: null, checkInCadence: "NONE", repeat: null };
    const ctx = { rollups: new Map([["g-list", { progress: 75, status: "ON_TRACK", source: "ROLLUP" }]]), periods: new Map() } as unknown as Parameters<typeof goalVerdicts>[0];
    const none = { has: () => false };
    const typed = await goalVerdicts(ctx, [{ ...goal, keyResults: [{ id: "kr-a", kpiId: null, source: null }] }], none, ist(2026, 10, 25));
    expect(typed.verdicts.get("g-list")?.verdict).toBe("at_risk");
    const fromList = await goalVerdicts(ctx, [{ ...goal, keyResults: [{ id: "kr-a", kpiId: null, source: { kind: "list", listIds: ["b1"] } }] }], none, ist(2026, 10, 25));
    expect(fromList.verdicts.get("g-list")?.verdict).toBe("on_track");
    expect(fromList.verdicts.get("g-list")?.signals.hasLinkedWork).toBe(true);
    // A table is not work.
    const fromTable = await goalVerdicts(ctx, [{ ...goal, keyResults: [{ id: "kr-a", kpiId: null, source: { kind: "table", tableId: "t1" } }] }], none, ist(2026, 10, 25));
    expect(fromTable.verdicts.get("g-list")?.verdict).toBe("at_risk");
    const words = verdictNarrative("on_track", { progress: 75, pctTimeElapsed: 80, daysLeft: 6, isStale: false, daysSinceCheckin: null, hasLinkedWork: true, listOnly: true, totalHours: 0, tasksOpen: 0, tasksDone: 0 });
    expect(words.reasons).toContain("A target counts from a List, so that List's work moves this goal.");
    expect(words.reasons.join(" ")).not.toContain("No linked work");
  });
});

/* ───────────────────────── Copy ───────────────────────── */

describe("the copy (L5, L7, L8, L10, L11, L14, L16, L19, run 1's refusals)", () => {
  it("L5: each pause says what fixes it; the preview's failure says try again", () => {
    expect(PAUSE.listGone).toBe("A List it counts was deleted or moved to Trash. Restore it, or choose another List in Edit target.");
    expect(PAUSE.listArchived).toBe("A List it counts was archived. Unarchive it, or choose another List.");
    expect(PAUSE.fieldGone).toBe("The field it adds up was removed. Choose another field in Edit target.");
    expect(TABLE_PAUSE.tablesOff).toBe("Tables is turned off for this workspace. An Admin can turn it on in Settings > Modules.");
    expect(TABLE_PAUSE.tooLarge).toBe("This table is too large to count from a goal. Count from a smaller table.");
    expect(PREVIEW_FAILED).toBe("Couldn't count the preview. Try again in a moment.");
  });

  it("L7: a week inside a sentence is 'the week of 19 Oct'", () => {
    const base = { progress: 50, pctTimeElapsed: 40, daysLeft: 3, isStale: false, daysSinceCheckin: 1, hasLinkedWork: true, totalHours: 0, tasksOpen: 0, tasksDone: 0 };
    expect(verdictNarrative("on_track", { ...base, periodLabel: "Week of 19 Oct" }).headline).toBe("On track for the week of 19 Oct.");
  });

  it("L8: goals reset, in the row and the kind", () => {
    expect(startedTitle(["October 2026", "October 2026", "October 2026"])).toBe("3 goals reset for October 2026");
    expect(startedTitle(["October 2026", "the week of 26 Oct"])).toBe("2 goals reset for new periods");
    expect(KINDS.goal_period_started.label).toBe("Goals reset");
  });

  it("L10: an ended goal's Repeats row", () => {
    expect(repeatsRowText("WEEKLY", "Week of 7 Sep", null, true, "Week of 19 Oct")).toBe("Every week, ended after the week of 19 Oct");
    expect(repeatsRowText("MONTHLY", "August 2026", null, true, "October 2026")).toBe("Every month, ended after October 2026");
  });

  it("L10: the summary names the last stored period", async () => {
    const g = await createGoalAt(ist(2026, 9, 1, 9), { title: "Calls", repeat: "MONTHLY", repeatStart: "2026-09-01", keyResults: [{ title: "Calls", startValue: 0, targetValue: 10 }] });
    at(ist(2026, 10, 3));
    await call(okrRoute.GET, `/api/okrs/${g.id}`, { params: { id: g.id } });
    const okr = rows("oKR").find((o) => o.id === g.id)! as { id: string; repeat: string | null; repeatUntil: string | null; startDate: Date | null };
    expect(await goalPeriodsSummary(okr, IST, ist(2026, 10, 3))).toMatchObject({ lastLabel: "October 2026", startLabel: "September 2026" });
  });

  it("L11: Reminders, Weekly, to the owner", () => {
    const g = { recurringOn: true, canEdit: true, repeat: "MONTHLY", checkInCadence: "WEEKLY", allAutomatic: false, startDate: null, endDate: null, completedAt: null, today: "2026-10-12" };
    expect(goalPageDoors(g)).toMatchObject({ remindLabel: "Reminders", remindWord: "Weekly, to the owner" });
    expect(goalPageDoors({ ...g, checkInCadence: "BIWEEKLY" }).remindWord).toBe("Every two weeks, to the owner");
    expect(goalPageDoors({ ...g, checkInCadence: "NONE" }).remindWord).toBe("Off");
  });

  it("L14: a quarter's top line names its dates", () => {
    expect(periodTopLine({ cadence: "QUARTERLY", current: true, state: "open", daysLeft: 9, datesLabel: "1 Oct 2026 to 31 Dec 2026" })).toBe("1 Oct 2026 to 31 Dec 2026, 9 days left");
    expect(periodTopLine({ cadence: "YEARLY", current: true, state: "open", daysLeft: 1, datesLabel: "1 Apr 2026 to 31 Mar 2027" })).toBe("1 Apr 2026 to 31 Mar 2027, 1 day left");
    expect(periodTopLine({ cadence: "MONTHLY", current: true, state: "open", daysLeft: 9, datesLabel: "1 Oct 2026 to 31 Oct 2026" })).toBe("9 days left");
    expect(periodTopLine({ cadence: "QUARTERLY", current: false, state: "closed", daysLeft: 0, datesLabel: "1 Jul 2026 to 30 Sep 2026" })).toBe("1 Jul 2026 to 30 Sep 2026");
  });

  it("L16: the paused Inbox row says where Reconnect is, only when reconnecting fixes it", () => {
    expect(pausedInboxMessage(PAUSE.lostList("Priya"))).toBe("Priya can no longer open a List it counts. Open the goal and choose Reconnect in the target's menu.");
    expect(pausedInboxMessage(TABLE_PAUSE.lostTable(null))).toBe("The person who connected it can no longer open the table it counts. Open the goal and choose Reconnect in the target's menu.");
    expect(pausedInboxMessage(PAUSE.listGone)).toBe(PAUSE.listGone);
  });

  it("L19: a blocked Save says why", () => {
    expect(blockedSaveWords({ companyBlocked: false, kpiBlocksWeekly: false, historyBlocksOneTime: true })).toBe("This goal has history. Stop it repeating and create a one-time goal instead.");
    expect(blockedSaveWords({ companyBlocked: false, kpiBlocksWeekly: true, historyBlocksOneTime: false })).toBe("A KPI is recorded monthly. Use it on a monthly, quarterly or yearly goal.");
    expect(blockedSaveWords({ companyBlocked: true, kpiBlocksWeekly: false, historyBlocksOneTime: false })).toContain("Company goal");
    expect(blockedSaveWords({ companyBlocked: false, kpiBlocksWeekly: false, historyBlocksOneTime: false })).toBeNull();
  });

  it("run 1's refusals, plain and fixable", () => {
    expect(kpiAfterWeeksWords("2026-12-01")).toBe("This goal runs weekly until 30 Nov. A KPI is recorded monthly, so link it from 1 Dec.");
    expect(kpiOwnerDeniedWords("Priya")).toBe("You can link a KPI only when you can see Priya's KPI numbers. Ask Priya or their manager to link it.");
    expect(kpiOwnerDeniedWords(null)).toBe("You can link a KPI only when you can see the owner's KPI numbers. Ask the owner or their manager to link it.");
  });
});
