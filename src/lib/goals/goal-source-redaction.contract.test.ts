// Repeating goals, the step 4 review H1 (docs/plans/recurring-goals.md C9):
// a target counted from a List never sends its source to a goal reader.
// Everyone who sees a goal sees every target, and C9 gives a viewer who
// cannot open the source no name, no link and no filter details, so no goal
// route and no profile may carry KeyResult.source (its Lists or Space, its
// filter rules and values, its field keys), sourceById (its connector),
// sourcePausedReason or sourceRefreshedAt. What they decide is kept:
// `measuredAutomatically` (C2) and `kpiCombine` (C6). The goal page reads the
// source through describeTargetSources, as its viewer may see it.
//
// The real routes and the real rollup over the in-memory database of
// goal-test-db.ts, an Admin in one Asia/Kolkata workspace (the world of
// goal-periods.review.test.ts). Each route's whole answer is walked.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./goal-test-db")).goalDb.prisma }));
vi.mock("server-only", () => ({}));

const ORG = "org-1";
const BOSS = "u-boss";
const session = legacyTestSession(BOSS, "COMPANY_ADMIN", ORG);
const st = vi.hoisted(() => ({ editor: true }));

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
  canEditGoal: async () => st.editor,
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
vi.mock("@/lib/activity", () => ({ logActivity: () => {} }));
vi.mock("@/lib/goals/goal-period-score.server", () => ({ patchPeriodScore: async () => {} }));
vi.mock("@/lib/ai/ai-off-gate", () => ({ aiOffResponse: async () => true }));
// The List engine is goal-source.step4.test.ts's: here the connector may
// connect, and the count is not what is asserted.
vi.mock("@/lib/goals/goal-source.server", () => ({
  connectSourceProblem: async () => null,
  refreshGoalSources: async () => ({ counted: 0, paused: 0, skipped: 0, changed: [] }),
}));

import { goalDb as db, seedRow } from "./goal-test-db";
import * as okrsRoute from "@/app/api/okrs/route";
import * as okrRoute from "@/app/api/okrs/[id]/route";
import * as myOkrsRoute from "@/app/api/okrs/my-okrs/route";
import * as krsRoute from "@/app/api/okrs/[id]/key-results/route";
import * as krRoute from "@/app/api/okrs/[id]/key-results/[krId]/route";
import * as periodsRoute from "@/app/api/okrs/[id]/periods/route";
import { buildPersonAlignment } from "@/lib/person-alignment";
import { enrichKeyResultGroups, enrichKeyResults } from "@/lib/alignment";

const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);

/** What a source names, none of which a goal reader may receive. */
const SECRET_LIST = "b-hiring-secret";
const SECRET_SPACE = "s-exec-secret";
const SECRET_VALUE = "Acme acquisition";
const SECRET_FIELD = "offer_amount";
const LIST_SOURCE = {
  kind: "list", listIds: [SECRET_LIST], metric: { op: "sum", fieldKey: SECRET_FIELD },
  filter: { connector: "AND", rules: [{ field: "title", operator: "contains", value: SECRET_VALUE }], hideDone: false }, countedBy: "done",
};
const SPACE_SOURCE = { kind: "space", spaceId: SECRET_SPACE, metric: { op: "count" }, filter: { connector: "AND", rules: [], hideDone: false }, countedBy: "now" };
const SOURCE_KEYS = ["source", "sourceById", "sourcePausedReason", "sourceRefreshedAt"];
/** Why it paused: an editor's to read (C10), as it names the connector. */
const LOST = "Priya can no longer open a List it counts. Reconnect it.";

type Json = Record<string, unknown> & { error?: string };
type Handler = (req: never, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(handler: unknown, url: string, init: { method?: string; body?: unknown; params?: Record<string, string> } = {}): Promise<{ status: number; body: Json }> {
  const req = new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await (handler as Handler)(req as never, { params: Promise.resolve(init.params ?? {}) });
  return { status: res.status, body: (await res.json()) as Json };
}

/** Every target object in an answer (anything carrying targetValue and startValue), wherever it sits. */
function targetsIn(v: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(v)) for (const x of v) targetsIn(x, out);
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("targetValue" in o && "startValue" in o) out.push(o);
    for (const x of Object.values(o)) targetsIn(x, out);
  }
  return out;
}

/** C9 on one answer: no source column on any target, and nothing a source names anywhere in it. */
function expectNoSource(body: unknown, where: string, expectTargets = true) {
  const text = JSON.stringify(body);
  for (const secret of [SECRET_LIST, SECRET_SPACE, SECRET_VALUE, SECRET_FIELD, "u-priya"]) {
    expect(text, `${where} names ${secret}`).not.toContain(secret);
  }
  const targets = targetsIn(body);
  if (expectTargets) expect(targets.length, `${where} has targets`).toBeGreaterThan(0);
  for (const t of targets) {
    for (const k of SOURCE_KEYS) expect(Object.keys(t), `${where}: a target carries ${k}`).not.toContain(k);
  }
  return targets;
}

beforeEach(() => {
  db.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ist(2026, 10, 12));
  process.env.RECURRING_GOALS = "1";
  seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
  seedRow(db, "user", { id: BOSS, organizationId: ORG, firstName: "Bo", lastName: "Ss", email: "boss@acme.test", status: "ACTIVE", deletedAt: null });
  seedRow(db, "user", { id: "u-priya", organizationId: ORG, firstName: "Priya", lastName: "Shah", email: "priya@acme.test", status: "ACTIVE", deletedAt: null });
  // A one-time goal and a repeating one, each with a target counted from a
  // List or a Space by Priya, paused, and one typed by hand.
  for (const [id, repeat] of [["g-once", null], ["g-monthly", "MONTHLY"]] as const) {
    seedRow(db, "oKR", {
      id, organizationId: ORG, title: `Goal ${id}`, level: "INDIVIDUAL", ownerId: BOSS, repeat, quarter: "Q4 2026",
      startDate: new Date("2026-10-01T00:00:00Z"), endDate: repeat ? null : new Date("2026-12-31T00:00:00Z"), createdAt: ist(2026, 9, 20),
    });
    seedRow(db, "keyResult", {
      id: `${id}-list`, okrId: id, title: "Offers", startValue: 0, targetValue: 10, currentValue: 3, progress: 30,
      source: LIST_SOURCE, sourceById: "u-priya", sourcePausedReason: LOST, sourceRefreshedAt: ist(2026, 10, 11), createdAt: ist(2026, 9, 20),
    });
    seedRow(db, "keyResult", {
      id: `${id}-space`, okrId: id, title: "Open roles", startValue: 0, targetValue: 5, currentValue: 2, progress: 40,
      source: SPACE_SOURCE, sourceById: "u-priya", sourceRefreshedAt: ist(2026, 10, 11), createdAt: ist(2026, 9, 20),
    });
    seedRow(db, "keyResult", { id: `${id}-hand`, okrId: id, title: "Typed", startValue: 0, targetValue: 10, currentValue: 1, progress: 10, createdAt: ist(2026, 9, 20) });
  }
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  delete process.env.RECURRING_GOALS;
});

describe("H1: no goal route or profile sends a target's source (C9)", () => {
  it("enrichKeyResults and enrichKeyResultGroups drop the source columns and keep what they decide", async () => {
    const krs = (db.rows.keyResult ?? []).filter((k) => k.okrId === "g-once") as Array<{ id: string; startValue: number; targetValue: number; currentValue: number; progress: number; kpiId: string | null; source: unknown }>;
    const one = await enrichKeyResults(krs);
    const [grouped] = await enrichKeyResultGroups([{ userId: BOSS, keyResults: krs }]);
    for (const list of [one, grouped]) {
      expectNoSource(list, "enriched");
      expect(list.map((k) => [k.id, k.measuredAutomatically, k.kpiCombine])).toEqual([
        ["g-once-list", true, null], ["g-once-space", true, null], ["g-once-hand", false, null],
      ]);
    }
  });

  it("GET /api/okrs, GET /api/okrs/[id] and GET /api/okrs/my-okrs", async () => {
    const list = await call(okrsRoute.GET, "/api/okrs?page=1&includeCompleted=1");
    expect(list.status).toBe(200);
    expect(expectNoSource(list.body, "GET /api/okrs").length).toBeGreaterThanOrEqual(6);
    for (const id of ["g-once", "g-monthly"]) {
      const one = await call(okrRoute.GET, `/api/okrs/${id}`, { params: { id } });
      expect(one.status).toBe(200);
      expectNoSource(one.body, `GET /api/okrs/${id}`);
    }
    const mine = await call(myOkrsRoute.GET, "/api/okrs/my-okrs?quarter=Q4%202026");
    expect(mine.status).toBe(200);
    expectNoSource(mine.body, "GET /api/okrs/my-okrs");
  });

  it("POST and PATCH /api/okrs", async () => {
    const created = await call(okrsRoute.POST, "/api/okrs", { method: "POST", body: { title: "New", level: "INDIVIDUAL", ownerId: BOSS, endDate: "2026-12-31", keyResults: [{ title: "Demos", startValue: 0, targetValue: 40 }] } });
    expect(created.status).toBeLessThan(300);
    expectNoSource(created.body, "POST /api/okrs");
    const patched = await call(okrsRoute.PATCH, "/api/okrs", { method: "PATCH", body: { id: "g-once", title: "Renamed" } });
    expect(patched.status).toBe(200);
    expectNoSource(patched.body, "PATCH /api/okrs");
  });

  it("the key-results POST and PATCH, connecting a source and editing a sourced target", async () => {
    const added = await call(krsRoute.POST, "/api/okrs/g-once/key-results", { method: "POST", params: { id: "g-once" }, body: { title: "More offers", startValue: 0, targetValue: 5, source: LIST_SOURCE } });
    expect(added.status).toBe(201);
    expect((db.rows.keyResult ?? []).find((k) => k.title === "More offers")?.sourceById).toBe(BOSS);
    expectNoSource(added.body, "POST key-results");
    for (const id of ["g-once", "g-monthly"]) {
      const edited = await call(krRoute.PATCH, `/api/okrs/${id}/key-results/${id}-list`, { method: "PATCH", params: { id, krId: `${id}-list` }, body: { title: "Offers made" } });
      expect(edited.status).toBe(200);
      expectNoSource(edited.body, `PATCH key-results on ${id}`);
    }
  });

  it("the profile (/api/me/alignment and /api/people/[id]/alignment build it)", async () => {
    const profile = await buildPersonAlignment(ORG, BOSS);
    expectNoSource(profile, "the profile");
  });

  it("why a source paused is an editor's: everyone else reads Paused, in GET /api/okrs/[id] and the periods", async () => {
    const pauseOf = (body: Json) => ((body.periodView as { targets: Array<{ keyResultId: string; pausedReason: string | null }> }).targets
      .find((t) => t.keyResultId === "g-monthly-list")?.pausedReason);
    expect(pauseOf((await call(okrRoute.GET, "/api/okrs/g-monthly", { params: { id: "g-monthly" } })).body)).toBe(LOST);
    st.editor = false;
    try {
      const one = await call(okrRoute.GET, "/api/okrs/g-monthly", { params: { id: "g-monthly" } });
      expect(pauseOf(one.body)).toBe("Paused");
      expect(JSON.stringify(one.body)).not.toContain("Priya");
      const periods = await call(periodsRoute.GET, "/api/okrs/g-monthly/periods", { params: { id: "g-monthly" } });
      expect(periods.status).toBe(200);
      const rows = (periods.body.data as Array<{ targets: Array<{ keyResultId: string; pausedReason: string | null }> }>).flatMap((p) => p.targets);
      expect(rows.find((t) => t.keyResultId === "g-monthly-list")?.pausedReason).toBe("Paused");
      expect(JSON.stringify(periods.body)).not.toContain("Priya");
    } finally {
      st.editor = true;
    }
  });
});
