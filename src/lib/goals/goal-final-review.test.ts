// Repeating goals, the final review's data and privacy findings (b7ef7be6,
// 2026-10-29): data M1 to M7 and L1 to L10, the workspace in the digest
// ids, and privacy M1, M2 and L1 to L4. Each `describe` names the finding it
// proves (data M5 is proved by goal-source.step4.test.ts, "a task created
// straight into Done, duplicated, and restored from Trash each count once").
//
// The step 4 world: the real task write paths, count, refresh, close and
// crons over the in-memory database of goal-test-db.ts, in an Asia/Kolkata
// workspace. Access is a table the test sets (who can open which List), who
// may see a goal is a set (`blind`), and the mailers, the score service and
// the score patch are stand-ins the test steers.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  /** userId to listId (or spaceId) to role. */
  roles: new Map<string, Map<string, string>>(),
  /** Who may edit the goals. */
  editors: new Set<string>(),
  /** Who may NOT see the goals (canSeeGoal false). */
  blind: new Set<string>(),
  session: null as null | { user: Record<string, unknown> },
  activity: [] as Array<Record<string, unknown>>,
  mail: [] as Array<Record<string, unknown>>,
  queued: [] as Array<Record<string, unknown>>,
  /** How many score recalculations fail next. */
  calcFails: 0,
  /** What the score patch answers (null: nothing to recalculate). */
  patchResult: null as null | { recalculate: Array<{ userId: string; organizationId: string }> },
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./goal-test-db")).goalDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => st.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("@/lib/access/acting-person", async () => {
  const { goalDb } = await import("./goal-test-db");
  const { legacyTestSession: session, legacyLevelRow: level } = await import("@/lib/access/test-fixtures");
  return {
    actingPerson: async (organizationId: string, userId: string) => {
      const row = (goalDb.rows.user ?? []).find((u) => u.id === userId && u.organizationId === organizationId);
      if (!row) return null;
      const viewer = { userId, organizationId, orgRole: "MEMBER", isAgent: false, adminScopes: [], peopleTeam: false, status: row.status, deleted: row.deletedAt != null };
      return { viewer, link: { userId, organizationId, ...level("EMPLOYEE") }, session: session(userId, "EMPLOYEE", organizationId) };
    },
  };
});
vi.mock("@/lib/access/node-access", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  const roleOf = (ctx: { userId: string; denied?: boolean }, id: string) => (ctx.denied ? "none" : st.roles.get(ctx.userId)?.get(id) ?? "none");
  return {
    ...real,
    nodeCtxFromViewer: (v: { userId: string; organizationId: string; deleted?: boolean; status?: string }) => ({
      userId: v.userId, organizationId: v.organizationId, orgAdmin: false, orgGuest: false, isAgent: false, denied: v.deleted === true || v.status === "INACTIVE",
    }),
    nodeRoleMap: async (ctx: { userId: string; denied?: boolean }, _kind: string, ids: Iterable<string>) => new Map([...ids].map((id) => [id, roleOf(ctx, id)])),
    nodeRole: async (ctx: { userId: string; denied?: boolean }, ref: { id: string }) => ({ role: roleOf(ctx, ref.id), strictRole: "none", via: { type: "none" }, path: false }),
  };
});
vi.mock("@/lib/list-links-server", async (orig) => {
  const real = (await orig()) as Record<string, (...a: unknown[]) => Promise<unknown>>;
  return {
    ...real,
    listLinksAvailable: async () => false,
    spaceForViewer: async (v: { userId: string }, spaceId: string) => (st.roles.get(v.userId)?.get(spaceId) ? { id: spaceId } : null),
    captureListLinks: async () => [],
    reconcileListLinks: async () => undefined,
    eligibleCopyLists: async () => [],
    copyListLinks: async () => [],
  };
});
vi.mock("@/lib/alignment-scope", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  canEditGoal: async (s: { user: { id: string } }) => st.editors.has(s.user.id),
}));
vi.mock("@/lib/goal-audience", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  canSeeGoal: async (s: { user: { id: string } }) => !st.blind.has(s.user.id),
  goalEditDenial: async (s: { user: { id: string } }) => (st.editors.has(s.user.id) ? null : { error: "You can't edit this goal.", status: 403 }),
}));
vi.mock("@/lib/goals/goal-contributor", () => ({ isGoalContributor: async () => false }));
vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: st.session }),
  getOrgId: (s: { user: { organizationId: string } }) => s.user.organizationId,
  getUserId: (s: { user: { id: string } }) => s.user.id,
  isManager: () => false,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/item-gate", async () => {
  const { goalDb } = await import("./goal-test-db");
  return {
    itemCtx: async () => ({ userId: String(st.session?.user.id), organizationId: String(st.session?.user.organizationId), userName: null, ...legacyLevelRow("EMPLOYEE") }),
    gateItem: async (id: string) => ({ item: { ...(goalDb.rows.item ?? []).find((r) => r.id === id) } }),
  };
});
vi.mock("@/lib/board", async (orig) => ({ ...((await orig()) as Record<string, unknown>), canContributeBoard: async () => true }));
vi.mock("@/lib/notify-realtime", () => ({ publishItemChanged: async () => undefined }));
vi.mock("@/lib/activity", () => ({ logActivity: (a: Record<string, unknown>) => { st.activity.push(a); } }));
vi.mock("@/services/performanceScoreService", () => ({
  triggerRecalculation: () => {},
  calculatePerformanceScore: async () => {
    if (st.calcFails > 0) {
      st.calcFails -= 1;
      throw new Error("the score service is down");
    }
  },
}));
vi.mock("@/lib/goals/goal-period-score.server", () => ({ patchPeriodScore: async () => st.patchResult ?? undefined }));
vi.mock("@/lib/access/node-placement", async (orig) => ({ ...((await orig()) as Record<string, unknown>), canvasesHaveFolders: async () => false }));
// The mailers: the reminders' emails, and the ops alert's queue writing its email log row as the real one does.
vi.mock("@/lib/email", async () => {
  const { goalDb } = await import("./goal-test-db");
  return {
    sendEmail: async (m: Record<string, unknown>) => { st.mail.push(m); },
    queueEmail: async (m: Record<string, unknown>) => {
      st.queued.push(m);
      (goalDb.rows.emailLog ??= []).push({ id: `el-${st.queued.length}`, template: m.template, subject: m.subject, createdAt: new Date() });
    },
  };
});
vi.mock("@/lib/email-templates", () => ({ genericNotificationTemplate: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/notify-prefs", () => ({ shouldEmail: async () => true }));

import { goalDb as db, seedRow } from "./goal-test-db";
import { createBoardItem, updateBoardItem } from "@/lib/board-items";
import { updateBoard } from "@/lib/board";
import { advanceSeriesOnComplete } from "@/lib/recurring-tasks";
import { restoreTrashRow } from "@/lib/trash-server";
import { archiveRowId } from "@/lib/trash-view";
import { applyRepeatPatch, checkInRepeating, deleteRepeatingTarget, KPI_AFTER_WEEKS, patchScoreOnce, planRepeatPatch, REPEAT_HAS_HISTORY, settleGoalPeriods } from "./goal-periods.server";
import { connectorFor, countListSource, notifySourcePaused, refreshGoalSources } from "./goal-source.server";
import { PAUSE, periodWindow } from "./goal-source";
import { periodFor, periodSettingsOf } from "./goal-period";
import { goalPageDoors, offersMonthlyConversion, resultWords, shownPercent } from "./goal-form";
import { notifyPeriodsStarted } from "./goal-period-notify.server";
import { computeGoalEffortBatch } from "@/lib/goal-effort";
import { backfillOrg, writePage } from "../../../scripts/backfill-item-completions";
import { getBoardStatuses } from "@/lib/board-items-shared";
import * as cronRoute from "@/app/api/cron/goal-periods/route";
import * as remindersRoute from "@/app/api/cron/okr-reminders/route";
import * as krsRoute from "@/app/api/okrs/[id]/key-results/route";
import * as krRoute from "@/app/api/okrs/[id]/key-results/[krId]/route";
import * as previewRoute from "@/app/api/okrs/[id]/key-results/preview/route";
import * as refreshRoute from "@/app/api/okrs/[id]/refresh/route";
import * as okrRoute from "@/app/api/okrs/[id]/route";

const ORG = "org-1";
const ORG2 = "org-2";
const OWNER = "u-olga";
const CONN = "u-priya";
const VIEWER = "u-vic";
const KOLKATA = periodSettingsOf({ timezone: "Asia/Kolkata" });

/** An instant given as IST wall-clock time. */
const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);
const at = (t: Date) => vi.setSystemTime(t);
const rows = (model: string) => (db.rows[model] ?? []) as Array<Record<string, unknown>>;
const DONE_LIST = { kind: "list", listIds: ["b-ops"], metric: { op: "count" }, filter: { connector: "AND", rules: [], hideDone: false }, countedBy: "done" };
const ms = (d: unknown) => (d as Date).getTime();

function grant(userId: string, id: string, role = "VIEW") {
  const m = st.roles.get(userId) ?? new Map<string, string>();
  m.set(id, role);
  st.roles.set(userId, m);
}

const periodOf = (okrId: string, key: string) => rows("goalPeriod").find((p) => p.okrId === okrId && p.key === key);
const rowsIn = (okrId: string, key: string) => rows("keyResultPeriod").filter((r) => r.periodId === periodOf(okrId, key)?.id);
const rowIn = (krId: string, okrId: string, key: string) => rowsIn(okrId, key).find((r) => r.keyResultId === krId);
const completionsOf = (itemId: string) => rows("itemCompletion").filter((c) => c.itemId === itemId);
const kr = (id: string) => rows("keyResult").find((k) => k.id === id)!;

/** A monthly goal whose one target counts `source` as Priya, from September. */
function sourcedGoal(id: string, source: unknown, extra: Record<string, unknown> = {}) {
  seedRow(db, "oKR", { id, organizationId: ORG, title: `Goal ${id}`, level: "INDIVIDUAL", ownerId: OWNER, repeat: "MONTHLY", startDate: new Date("2026-09-01T00:00:00Z"), createdAt: ist(2026, 8, 20), ...extra });
  seedRow(db, "keyResult", { id: `${id}-kr`, okrId: id, title: "Counted", startValue: 0, targetValue: 10, currentValue: 0, source, sourceById: CONN, createdAt: ist(2026, 8, 20) });
}

/** A goal with hand-checked targets, written straight into the store. */
function handGoal(id: string, goal: Record<string, unknown>, targets: Array<Record<string, unknown>>) {
  seedRow(db, "oKR", { id, organizationId: ORG, title: `Goal ${id}`, level: "INDIVIDUAL", ownerId: OWNER, createdAt: ist(2026, 9, 25), ...goal });
  targets.forEach((t, i) => seedRow(db, "keyResult", { id: `${id}-kr${i}`, okrId: id, title: `T${i}`, startValue: 0, targetValue: 10, currentValue: 0, createdAt: (goal.createdAt as Date | undefined) ?? ist(2026, 9, 25), ...t }));
}

function seedKpi() {
  seedRow(db, "kPI", { id: "kpi-1", organizationId: ORG, name: "Revenue", unit: null, direction: "HIGHER", lowerIsBetter: false, targetValue: 100, ownership: "OWNED", isNorthStar: false });
}

async function newTask(title: string, t: Date, extra: Record<string, unknown> = {}) {
  at(t);
  return createBoardItem({ organizationId: ORG, boardId: "b-ops", title, actorId: CONN, ...extra } as Parameters<typeof createBoardItem>[0]);
}

async function setStatus(id: string, status: string, t: Date) {
  at(t);
  return updateBoardItem(id, { status }, CONN);
}

type Json = Record<string, unknown> & { error?: string };
async function call(handler: unknown, url: string, init: { method?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<{ status: number; body: Json }> {
  const req = new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await (handler as (r: never, c: { params: Promise<Record<string, string>> }) => Promise<Response>)(req as never, { params: Promise.resolve(init.params ?? {}) });
  return { status: res.status, body: (await res.json()) as Json };
}

const CRON = { method: "POST", headers: { "x-cron-secret": "test-secret" } };
async function runCron(t: Date) {
  at(t);
  return call(cronRoute.POST, "/api/cron/goal-periods", CRON);
}
async function runReminders(t: Date) {
  at(t);
  return call(remindersRoute.POST, "/api/cron/okr-reminders", CRON);
}
const as = (userId: string, orgId = ORG) => { st.session = legacyTestSession(userId, "EMPLOYEE", orgId); };

let errors: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.reset();
  st.roles.clear();
  st.editors = new Set([OWNER, CONN]);
  st.blind = new Set();
  st.activity.length = 0;
  st.mail.length = 0;
  st.queued.length = 0;
  st.calcFails = 0;
  st.patchResult = null;
  as(CONN);
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.RECURRING_GOALS = "1";
  process.env.CRON_SECRET = "test-secret";
  delete process.env.OPS_ALERT_EMAIL;
  seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
  seedRow(db, "organization", { id: ORG2, name: "Acme Two", settings: { timezone: "Asia/Kolkata" } });
  for (const [id, first, email] of [[OWNER, "Olga", "olga@acme.test"], [CONN, "Priya", "priya@acme.test"], [VIEWER, "Vic", "vic@acme.test"]]) {
    seedRow(db, "user", { id, organizationId: ORG, firstName: first, lastName: "Test", email, status: "ACTIVE", deletedAt: null });
  }
  seedRow(db, "board", { id: "b-ops", organizationId: ORG, name: "Ops", slug: "ops" });
  seedRow(db, "board", { id: "b-bugs", organizationId: ORG, name: "Bugs", slug: "bugs" });
  grant(CONN, "b-ops");
  grant(CONN, "b-bugs");
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  warns = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errors.mockRestore();
  warns.mockRestore();
});

afterAll(() => {
  delete process.env.RECURRING_GOALS;
  delete process.env.CRON_SECRET;
  delete process.env.OPS_ALERT_EMAIL;
});

/* ───────────────────────── Data, medium ───────────────────────── */

describe("final review M1: a parent's close waits for every child period it reads, on its cadence or a finer one", () => {
  it("a quarterly goal stays open while its monthly KPI child's December takes numbers, then closes after it", async () => {
    seedKpi();
    handGoal("g-q", { level: "COMPANY", repeat: "QUARTERLY", startDate: new Date("2026-10-01T00:00:00Z") }, [{}]);
    handGoal("g-m", { level: "DEPARTMENT", parentId: "g-q", repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z") }, [{ title: "Revenue", targetValue: 100, kpiId: "kpi-1" }]);
    for (const t of [ist(2026, 10, 15), ist(2026, 11, 15), ist(2026, 12, 15)]) await runCron(t);
    const december = periodOf("g-m", "2026-12-01")!;
    // December reads January's KPI numbers until 1 February, 14:00 UTC.
    expect(ms(december.closesAt)).toBe(Date.parse("2027-02-01T14:00:00.000Z"));
    expect(ms(periodOf("g-q", "2026-10-01")!.closesAt)).toBe(ms(december.closesAt));
    // Past the quarter's own grace (6 January): still open, on the child's December.
    await runCron(ist(2027, 1, 6, 12));
    expect(periodOf("g-q", "2026-10-01")!.status).toBe("OPEN");
    await runCron(new Date("2027-02-01T15:05:00.000Z"));
    expect(periodOf("g-m", "2026-12-01")!.status).toBe("CLOSED");
    expect(periodOf("g-q", "2026-10-01")!.status).toBe("CLOSED");
  });

  it("a coarser child holds nothing: a monthly parent closes October on its quarterly child as it stands (D2)", async () => {
    seedKpi();
    handGoal("g-mp", { level: "COMPANY", repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z") }, [{}]);
    handGoal("g-qc", { level: "DEPARTMENT", parentId: "g-mp", repeat: "QUARTERLY", startDate: new Date("2026-10-01T00:00:00Z") }, [{ title: "Revenue", targetValue: 100, kpiId: "kpi-1" }]);
    await runCron(ist(2026, 10, 15));
    await runCron(ist(2026, 11, 6, 12));
    expect(periodOf("g-mp", "2026-10-01")!.status).toBe("CLOSED");
    expect(periodOf("g-qc", "2026-10-01")!.status).toBe("OPEN");
  });
});

describe("final review M2: a windowed source stops at its grace, not at a KPI hold's close", () => {
  it("October's Done-date count freezes at the first run after 5 November; a task reopened on 20 November leaves it alone", async () => {
    seedKpi();
    sourcedGoal("g-held", DONE_LIST);
    seedRow(db, "keyResult", { id: "g-held-kpi", okrId: "g-held", title: "Revenue", startValue: 0, targetValue: 100, currentValue: 0, kpiId: "kpi-1", createdAt: ist(2026, 8, 20) });
    const task = await newTask("Shipped", ist(2026, 10, 10), { status: "DONE" });
    await runCron(ist(2026, 10, 12));
    expect(rowIn("g-held-kr", "g-held", "2026-10-01")?.currentValue).toBe(1);
    // October is held for its KPI month (1 December, 14:00 UTC), its grace ends 6 November 00:00 IST.
    expect(ms(periodOf("g-held", "2026-10-01")!.closesAt)).toBe(Date.parse("2026-12-01T14:00:00.000Z"));
    await runCron(ist(2026, 11, 6, 0, 35));
    const frozen = rowIn("g-held-kr", "g-held", "2026-10-01")!;
    expect(frozen.currentValue).toBe(1);
    expect(frozen.frozenAt).toBeInstanceOf(Date);
    await setStatus(task.id, "IN_PROGRESS", ist(2026, 11, 20));
    expect(completionsOf(task.id)).toHaveLength(0);
    await runCron(ist(2026, 11, 20, 12));
    expect(rowIn("g-held-kr", "g-held", "2026-10-01")?.currentValue).toBe(1);
    await runCron(new Date("2026-12-01T15:05:00.000Z"));
    expect(periodOf("g-held", "2026-10-01")!.status).toBe("CLOSED");
    expect(rowIn("g-held-kr", "g-held", "2026-10-01")?.currentValue).toBe(1);
  });

  it("the goal page's Refresh counts nothing past the grace, even before the cron has frozen it", async () => {
    seedKpi();
    sourcedGoal("g-held2", DONE_LIST);
    seedRow(db, "keyResult", { id: "g-held2-kpi", okrId: "g-held2", title: "Revenue", startValue: 0, targetValue: 100, currentValue: 0, kpiId: "kpi-1", createdAt: ist(2026, 8, 20) });
    const task = await newTask("Shipped", ist(2026, 10, 10), { status: "DONE" });
    await runCron(ist(2026, 10, 12));
    await newTask("Shipped late", ist(2026, 11, 8), { status: "DONE" });
    // Reopened after October's grace, with no cron run since it ended.
    await setStatus(task.id, "IN_PROGRESS", ist(2026, 11, 8, 12));
    at(ist(2026, 11, 8, 13));
    await settleGoalPeriods(ORG, ["g-held2"], ist(2026, 11, 8, 13));
    await refreshGoalSources(ORG, { okrIds: ["g-held2"], keyResultIds: ["g-held2-kr"], force: true, now: ist(2026, 11, 8, 13) });
    // The request counted November, never October again (it is past its grace).
    expect(rowIn("g-held2-kr", "g-held2", "2026-10-01")?.currentValue).toBe(1);
    expect(rowIn("g-held2-kr", "g-held2", "2026-11-01")?.currentValue).toBe(1);
  });
});

describe("final review M3: deleting a target in a period's grace keeps its row in that period", () => {
  it("October keeps the deleted target's row and closes on both targets, not on the one left", async () => {
    handGoal("g-del", { repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z") }, [{}, {}]);
    await checkInRepeating({ orgId: ORG, okrId: "g-del", keyResultId: "g-del-kr0", value: 10, note: null, userId: OWNER, now: ist(2026, 10, 10) });
    at(ist(2026, 11, 3));
    await settleGoalPeriods(ORG, ["g-del"], ist(2026, 11, 3));
    await deleteRepeatingTarget(ORG, "g-del", "g-del-kr1", ist(2026, 11, 3));
    // The current period (November) loses it; October, ended and in its grace, keeps it.
    expect(rowsIn("g-del", "2026-11-01").map((r) => r.keyResultId)).toEqual(["g-del-kr0"]);
    expect(rowsIn("g-del", "2026-10-01").map((r) => r.keyResultId).sort()).toEqual(["g-del-kr0", null].sort());
    await runCron(ist(2026, 11, 6, 0, 35));
    const october = periodOf("g-del", "2026-10-01")!;
    expect(october).toMatchObject({ status: "CLOSED", progress: 50, result: "MISSED" });
    const orphan = rowsIn("g-del", "2026-10-01").find((r) => r.keyResultId == null)!;
    expect(orphan).toMatchObject({ currentValue: 0, progress: 0 });
    expect(orphan.frozenAt).toBeInstanceOf(Date);
  });
});

describe("final review M4: a status set round trip keeps the real completion dates", () => {
  const set = (verified: "ACTIVE" | "DONE") => [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" as const }, { value: "VERIFIED", label: "Verified", color: "#090", group: verified }];

  it("a status put into the done group dates its tasks by their last entry into it (the backfill's rule), not now", async () => {
    seedRow(db, "board", { id: "b-qa", organizationId: ORG, name: "QA", slug: "qa", statuses: set("ACTIVE") });
    at(ist(2026, 10, 3));
    const t = await createBoardItem({ organizationId: ORG, boardId: "b-qa", title: "Check", status: "OPEN", actorId: CONN } as Parameters<typeof createBoardItem>[0]);
    await setStatus(t.id, "VERIFIED", ist(2026, 10, 5));
    expect(completionsOf(t.id)).toHaveLength(0);
    at(ist(2026, 10, 12));
    await updateBoard("b-qa", { statuses: set("DONE") });
    expect(completionsOf(t.id).map((c) => ms(c.doneAt))).toEqual([ist(2026, 10, 5).getTime()]);
  });

  it("the set-aside date is used only while nobody moved the task since: moved out and back, it dates by that move", async () => {
    seedRow(db, "board", { id: "b-qa", organizationId: ORG, name: "QA", slug: "qa", statuses: set("DONE") });
    at(ist(2026, 10, 3));
    const t = await createBoardItem({ organizationId: ORG, boardId: "b-qa", title: "Check", status: "VERIFIED", actorId: CONN } as Parameters<typeof createBoardItem>[0]);
    at(ist(2026, 10, 9));
    await updateBoard("b-qa", { statuses: set("ACTIVE") });
    expect(completionsOf(t.id)).toHaveLength(0);
    // One activity row on the List holds what was set aside; no task feed reads it.
    expect(rows("itemActivity").filter((a) => a.entityType === "BOARD_STATUS_SET").map((a) => (a.meta as { completions: unknown[] }).completions)).toEqual([
      [{ itemId: t.id, status: "VERIFIED", doneAt: ist(2026, 10, 3).toISOString() }],
    ]);
    await setStatus(t.id, "OPEN", ist(2026, 10, 10));
    await setStatus(t.id, "VERIFIED", ist(2026, 10, 11));
    at(ist(2026, 10, 12));
    await updateBoard("b-qa", { statuses: set("DONE") });
    expect(completionsOf(t.id).map((c) => ms(c.doneAt))).toEqual([ist(2026, 10, 11).getTime()]);
  });
});

describe("final review M6: a missing goal-periods crontab row is not silent", () => {
  function stuckPeriod(closesAt: Date) {
    handGoal("g-stuck", { repeat: "MONTHLY", startDate: new Date("2026-09-01T00:00:00Z"), createdAt: ist(2026, 8, 20) }, [{}]);
    seedRow(db, "goalPeriod", {
      id: "p-stuck", okrId: "g-stuck", organizationId: ORG, key: "2026-09-01", cadence: "MONTHLY",
      startsAt: ist(2026, 9, 1, 0), endsAt: ist(2026, 10, 1, 0), trackedFrom: ist(2026, 9, 1, 0), graceEndsAt: closesAt, closesAt, status: "OPEN",
    });
  }

  it("okr-reminders counts the periods more than two hours past their close and alerts ops once a day", async () => {
    process.env.OPS_ALERT_EMAIL = "ops@workwrk.test";
    stuckPeriod(ist(2026, 10, 6, 0));
    const first = await runReminders(ist(2026, 10, 7, 9));
    expect(first.body.stuckCloses).toBe(1);
    expect(st.queued.map((m) => [m.to, m.subject])).toEqual([["ops@workwrk.test", "WorkwrK: repeating goals are not closing"]]);
    await runReminders(ist(2026, 10, 8, 9));
    expect(st.queued).toHaveLength(1);
    await runReminders(ist(2026, 10, 9, 9, 30));
    expect(st.queued).toHaveLength(2);
  });

  it("a period an hour past its close is the cron's next run, not an alert", async () => {
    process.env.OPS_ALERT_EMAIL = "ops@workwrk.test";
    stuckPeriod(ist(2026, 10, 7, 8));
    const r = await runReminders(ist(2026, 10, 7, 9));
    expect(r.body.stuckCloses).toBe(0);
    expect(st.queued).toHaveLength(0);
  });
});

describe("final review M7: a past period never reads \"Missed, 150%\"", () => {
  it("the attainment only beside Hit; otherwise the clamped progress the result was decided on", () => {
    expect(shownPercent({ result: "MISSED", progress: 33, attainment: 100 })).toBe(33);
    expect(resultWords("Missed", { result: "MISSED", progress: 33, attainment: 100 })).toBe("Missed, 33%");
    expect(resultWords("Partly hit", { result: "PARTLY_HIT", progress: 80, attainment: 150 })).toBe("Partly hit, 80%");
    expect(resultWords("Hit", { result: "HIT", progress: 100, attainment: 112 })).toBe("Hit, 112%");
    expect(resultWords("Not measured", { result: "NOT_MEASURED", progress: null, attainment: null })).toBe("Not measured");
  });
});

/* ───────────────────────── Data, low ───────────────────────── */

describe("final review L1: unarchiving from the Trash page writes the completion an unarchive owes", () => {
  it("a done task with no completion comes back with one at its last entry into done", async () => {
    grant(OWNER, "b-ops", "EDIT");
    seedRow(db, "item", { id: "t-arch", organizationId: ORG, boardId: "b-ops", title: "Old done", itemType: "studio-item", status: "DONE", ownerId: null, assigneeIds: [], metadata: {}, parentItemId: null, archivedAt: ist(2026, 10, 1), dueAt: null, startAt: null, priority: null, itemTypeId: null, createdAt: ist(2026, 9, 1), updatedAt: ist(2026, 10, 1) });
    seedRow(db, "itemActivity", { id: "a-arch", organizationId: ORG, entityType: "BOARD_ITEM", entityId: "t-arch", actorId: CONN, action: "STATUS_CHANGED", meta: { from: "TO_DO", to: "DONE" }, createdAt: ist(2026, 9, 15) });
    at(ist(2026, 10, 20));
    const viewer = { userId: OWNER, organizationId: ORG, orgRole: "OWNER", isAgent: false, adminScopes: [], peopleTeam: false, status: "ACTIVE", deleted: false };
    const r = await restoreTrashRow(viewer as never, archiveRowId("item", "t-arch"));
    expect(r).toEqual({ ok: true });
    expect(rows("item").find((i) => i.id === "t-arch")?.archivedAt).toBeNull();
    expect(completionsOf("t-arch").map((c) => ms(c.doneAt))).toEqual([ist(2026, 9, 15).getTime()]);
  });
});

describe("final review L2: the monthly offer only inside the goal's month", () => {
  it("offered on 12 October for October, not on 5 December", () => {
    const g = { repeat: null, checkInCadence: "MONTHLY", startDate: "2026-10-01T00:00:00.000Z", endDate: "2026-10-31T00:00:00.000Z", completedAt: null };
    expect(offersMonthlyConversion(g, "2026-10-12")).toBe(true);
    expect(offersMonthlyConversion(g, "2026-12-05")).toBe(false);
    expect(offersMonthlyConversion(g, "2026-09-30")).toBe(false);
    expect(goalPageDoors({ ...g, recurringOn: true, canEdit: true, allAutomatic: false, today: "2026-12-05" }).migrationOffer).toBe(false);
  });
});

describe("final review L3: a one-time source with no Start date counts from the day the goal was made", () => {
  it("a goal made on 15 October counts October's completion, not September's", async () => {
    seedRow(db, "oKR", { id: "g-ot", organizationId: ORG, title: "Close deals", level: "INDIVIDUAL", ownerId: OWNER, startDate: null, endDate: new Date("2026-12-31T00:00:00Z"), createdAt: ist(2026, 10, 15) });
    seedRow(db, "keyResult", { id: "g-ot-kr", okrId: "g-ot", title: "Deals", startValue: 0, targetValue: 10, currentValue: 0, source: DONE_LIST, sourceById: CONN, createdAt: ist(2026, 10, 15) });
    await newTask("September deal", ist(2026, 9, 10), { status: "DONE" });
    await newTask("October deal", ist(2026, 10, 20), { status: "DONE" });
    await refreshGoalSources(ORG, { okrIds: ["g-ot"], force: true, now: ist(2026, 10, 25) });
    expect(kr("g-ot-kr").currentValue).toBe(1);
  });
});

describe("final review L4: no KPI while a goal changed from weekly still runs weeks", () => {
  it("refused while the transitional weeks run, accepted once the month has started", async () => {
    seedKpi();
    handGoal("g-wk", { repeat: "WEEKLY", startDate: new Date("2026-10-05T00:00:00Z"), createdAt: ist(2026, 10, 4) }, [{}]);
    at(ist(2026, 10, 20));
    await settleGoalPeriods(ORG, ["g-wk"], ist(2026, 10, 20));
    // Repeats every changed to Month: the weeks run on to 1 November (A3).
    db.rows.oKR.find((o) => o.id === "g-wk")!.repeat = "MONTHLY";
    as(OWNER);
    const refused = await call(krsRoute.POST, "/api/okrs/g-wk/key-results", { method: "POST", params: { id: "g-wk" }, body: { title: "Revenue", kpiId: "kpi-1" } });
    // The refusal names when the weeks end and the first month starts (final review product).
    expect(refused).toMatchObject({ status: 400, body: { error: "This goal runs weekly until 31 Oct. A KPI is recorded monthly, so link it from 1 Nov." } });
    expect(KPI_AFTER_WEEKS).toBe("This goal still runs weekly for now. A KPI is recorded monthly, so link it once its first month starts.");
    // The last week (26 October to 1 November) has not even been opened yet on 27 October.
    at(ist(2026, 10, 27));
    expect((await call(krsRoute.POST, "/api/okrs/g-wk/key-results", { method: "POST", params: { id: "g-wk" }, body: { title: "Revenue", kpiId: "kpi-1" } })).status).toBe(400);
    at(ist(2026, 11, 3));
    expect((await call(krsRoute.POST, "/api/okrs/g-wk/key-results", { method: "POST", params: { id: "g-wk" }, body: { title: "Revenue", kpiId: "kpi-1" } })).status).toBe(201);
  });
});

describe("final review L5: the backfill writes page by page, each task checked again under its lock", () => {
  it("a planned row is skipped when its task was reopened, moved or given a completion since", async () => {
    at(ist(2026, 10, 20));
    for (const id of ["t-kept", "t-reopened", "t-had", "t-moved"]) {
      seedRow(db, "item", { id, organizationId: ORG, boardId: id === "t-moved" ? "b-bugs" : "b-ops", title: id, itemType: "studio-item", status: id === "t-reopened" ? "TO_DO" : "DONE", ownerId: null, assigneeIds: [], metadata: {}, parentItemId: null, archivedAt: null, dueAt: null, startAt: null, priority: null, itemTypeId: null, createdAt: ist(2026, 9, 1), updatedAt: ist(2026, 9, 1) });
    }
    seedRow(db, "itemCompletion", { id: "c-had", itemId: "t-had", boardId: "b-ops", organizationId: ORG, status: "DONE", doneAt: ist(2026, 10, 1), actorId: CONN });
    const planned = ["t-kept", "t-reopened", "t-had", "t-moved"].map((itemId) => ({ itemId, boardId: "b-ops", organizationId: ORG, status: "DONE", doneAt: ist(2026, 9, 15), actorId: null as null }));
    const statusesOf = new Map([["b-ops", getBoardStatuses(null)], ["b-bugs", getBoardStatuses(null)]]);
    const r = await writePage(db.prisma as never, planned, statusesOf);
    expect(r).toEqual({ written: 1, changedSince: 3 });
    expect(rows("itemCompletion").filter((c) => c.id !== "c-had").map((c) => c.itemId)).toEqual(["t-kept"]);
    expect(db.raw.some((t) => /SELECT id, status FROM "Item" WHERE id = ANY\(\?\) ORDER BY id FOR UPDATE/.test(t))).toBe(true);
  });

  it("an organization's run plans and writes, and a second run writes nothing", async () => {
    await newTask("Done once", ist(2026, 10, 3));
    const t = rows("item")[0];
    await setStatus(String(t.id), "DONE", ist(2026, 10, 5));
    // A completion the writers never wrote (as before ItemCompletion existed).
    db.rows.itemCompletion = [];
    const first = await backfillOrg(db.prisma as never, ORG, { write: true });
    expect(first).toMatchObject({ doneTasks: 1, toWrite: 1, written: 1, changedSince: 0 });
    expect(completionsOf(String(t.id)).map((c) => ms(c.doneAt))).toEqual([ist(2026, 10, 5).getTime()]);
    expect(await backfillOrg(db.prisma as never, ORG, { write: true })).toMatchObject({ toWrite: 0, written: 0, alreadyHadRow: 1 });
  });
});

describe("final review L6: a repeating goal with a period that has ended cannot go back to one time", () => {
  it("refused on 3 November while October is in its grace; allowed while October still runs", async () => {
    handGoal("g-back", { repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 10, 2) }, [{}]);
    const existing = (now: Date) => ({ id: "g-back", repeat: "MONTHLY", repeatUntil: null, endDate: null, completedAt: null, startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 10, 2), ownerId: OWNER, now });
    at(ist(2026, 10, 20));
    await settleGoalPeriods(ORG, ["g-back"], ist(2026, 10, 20));
    const during = await planRepeatPatch({ orgId: ORG, actorId: OWNER, existing: existing(ist(2026, 10, 20)), body: { repeat: null }, updates: {}, now: ist(2026, 10, 20) });
    expect(during.ok).toBe(true);
    at(ist(2026, 11, 3));
    const after = await planRepeatPatch({ orgId: ORG, actorId: OWNER, existing: existing(ist(2026, 11, 3)), body: { repeat: null }, updates: {}, now: ist(2026, 11, 3) });
    expect(after).toEqual({ ok: false, status: 400, error: REPEAT_HAS_HISTORY });
    expect(periodOf("g-back", "2026-10-01")).toBeTruthy();
  });
});

describe("final review L7: Effort's tasks done count the period's completions", () => {
  it("October's Effort counts the completions on October's days, a weekly report done twice included, never September's", async () => {
    seedRow(db, "entityLink", { id: "el-1", organizationId: ORG, sourceType: "OKR", sourceId: "g-eff", targetType: "BOARD", targetId: "b-ops" });
    await newTask("September", ist(2026, 9, 15), { status: "DONE" });
    await newTask("October", ist(2026, 10, 10), { status: "DONE" });
    const weekly = await newTask("Weekly report", ist(2026, 10, 1, 9), { dueAt: ist(2026, 10, 2, 18) });
    await updateBoardItem(weekly.id, { recurRule: { freq: "WEEK", interval: 1, trigger: "ON_COMPLETE", createNew: false } }, CONN);
    for (const day of [2, 9]) {
      await setStatus(weekly.id, "DONE", ist(2026, 10, day, 17));
      await advanceSeriesOnComplete(weekly.id, "DONE", CONN);
    }
    const viewer = { userId: CONN, organizationId: ORG, orgRole: "MEMBER", isAgent: false, adminScopes: [], peopleTeam: false, status: "ACTIVE", deleted: false };
    const windows = new Map([["g-eff", { firstKey: "2026-10-01", lastKey: "2026-10-31" }]]);
    const effort = (await computeGoalEffortBatch(ORG, ["g-eff"], ist(2026, 10, 25), viewer as never, windows)).get("g-eff")!;
    expect(effort).toMatchObject({ tasksDone: 3, tasksOpen: 1 });
    // With no window: the tasks done now.
    expect((await computeGoalEffortBatch(ORG, ["g-eff"], ist(2026, 10, 25), viewer as never)).get("g-eff")).toMatchObject({ tasksDone: 2, tasksOpen: 1 });
  });
});

describe("final review L8: a one-time source paused at its count after the due date is tried again", () => {
  it("paused on 1 November (access lost), counted at the next run once access is back", async () => {
    seedRow(db, "oKR", { id: "g-due", organizationId: ORG, title: "October deals", level: "INDIVIDUAL", ownerId: OWNER, startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z"), createdAt: ist(2026, 9, 25) });
    seedRow(db, "keyResult", { id: "g-due-kr", okrId: "g-due", title: "Deals", startValue: 0, targetValue: 10, currentValue: 0, source: DONE_LIST, sourceById: CONN, createdAt: ist(2026, 9, 25) });
    await newTask("A deal", ist(2026, 10, 10), { status: "DONE" });
    st.roles.get(CONN)!.delete("b-ops");
    await runCron(ist(2026, 11, 1, 12));
    expect(kr("g-due-kr")).toMatchObject({ currentValue: 0, sourcePausedReason: "Priya can no longer open a List it counts. Reconnect it." });
    grant(CONN, "b-ops");
    await runCron(ist(2026, 11, 1, 13));
    expect(kr("g-due-kr")).toMatchObject({ currentValue: 1, sourcePausedReason: null });
    // Then its number stands.
    await newTask("A late deal", ist(2026, 11, 2), { status: "DONE" });
    await runCron(ist(2026, 11, 2, 14));
    expect(kr("g-due-kr").currentValue).toBe(1);
  });
});

describe("final review L9: moving Starts later keeps a count-down target's level", () => {
  it("open bugs at 22 stay at 22 when October is discarded, and November opens there", async () => {
    handGoal("g-bugs", { repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 10, 2) }, [{ title: "Open bugs", startValue: 30, targetValue: 5, currentValue: 30 }]);
    at(ist(2026, 10, 3));
    await settleGoalPeriods(ORG, ["g-bugs"], ist(2026, 10, 3));
    await checkInRepeating({ orgId: ORG, okrId: "g-bugs", keyResultId: "g-bugs-kr0", value: 22, note: null, userId: OWNER, now: ist(2026, 10, 5) });
    expect(kr("g-bugs-kr0").currentValue).toBe(22);
    const now = ist(2026, 10, 10);
    at(now);
    const existing = { id: "g-bugs", repeat: "MONTHLY", repeatUntil: null, endDate: null, completedAt: null, startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 10, 2), ownerId: OWNER };
    const planned = await planRepeatPatch({ orgId: ORG, actorId: OWNER, existing, body: { repeatStart: "2026-11-01" }, updates: {}, now });
    if (!planned.ok || !planned.plan) throw new Error("no plan");
    await applyRepeatPatch(ORG, "g-bugs", planned.plan, {}, now);
    expect(periodOf("g-bugs", "2026-10-01")).toBeUndefined();
    expect(kr("g-bugs-kr0").currentValue).toBe(22);
    at(ist(2026, 11, 2));
    await settleGoalPeriods(ORG, ["g-bugs"], ist(2026, 11, 2));
    expect(rowIn("g-bugs-kr0", "g-bugs", "2026-11-01")?.currentValue).toBe(22);
  });
});

describe("final review L10: a failed running-month recalculation is tried again", () => {
  it("the period stays unpatched until the recalculation succeeds, then is stamped once", async () => {
    handGoal("g-l10", { repeat: "WEEKLY", startDate: new Date("2026-10-05T00:00:00Z"), createdAt: ist(2026, 10, 4) }, [{}]);
    seedRow(db, "goalPeriod", {
      id: "p-l10", okrId: "g-l10", organizationId: ORG, key: "2026-10-05", cadence: "WEEKLY", startsAt: ist(2026, 10, 5, 0), endsAt: ist(2026, 10, 12, 0),
      trackedFrom: ist(2026, 10, 5, 0), graceEndsAt: ist(2026, 10, 14, 0), closesAt: ist(2026, 10, 14, 0), status: "CLOSED", progress: 40, attainment: 40, result: "MISSED", scored: true, closedAt: ist(2026, 10, 14, 1), scorePatchedAt: null,
    });
    st.patchResult = { recalculate: [{ userId: OWNER, organizationId: ORG }] };
    st.calcFails = 1;
    at(ist(2026, 10, 14, 1));
    await expect(patchScoreOnce("p-l10", ist(2026, 10, 14, 1))).rejects.toThrow("the score service is down");
    expect(periodOf("g-l10", "2026-10-05")!.scorePatchedAt).toBeNull();
    at(ist(2026, 10, 14, 2));
    expect(await patchScoreOnce("p-l10", ist(2026, 10, 14, 2))).toBe(true);
    expect(ms(periodOf("g-l10", "2026-10-05")!.scorePatchedAt)).toBe(ist(2026, 10, 14, 2).getTime());
    expect(await patchScoreOnce("p-l10", ist(2026, 10, 14, 3))).toBe(false);
  });
});

/* ───────────────────────── The workspace in the digest ids ───────────────────────── */

describe("final review: an owner with goals in two workspaces gets each workspace's row", () => {
  it("two started rows on 1 November, and two end nudges on 29 October", async () => {
    seedRow(db, "organizationMembership", { id: "m-olga-2", userId: OWNER, organizationId: ORG2, role: "EMPLOYEE" });
    handGoal("g-w1", { repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 9, 20) }, [{}]);
    seedRow(db, "oKR", { id: "g-w2", organizationId: ORG2, title: "Goal g-w2", level: "INDIVIDUAL", ownerId: OWNER, repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 9, 20) });
    seedRow(db, "keyResult", { id: "g-w2-kr", okrId: "g-w2", title: "T", startValue: 0, targetValue: 10, currentValue: 0, createdAt: ist(2026, 9, 20) });
    await runCron(ist(2026, 10, 2));
    await runReminders(ist(2026, 10, 29, 9));
    expect(rows("notification").filter((n) => n.userId === OWNER && n.type === "okr_check_in_due" && /October ends/.test(String(n.title)))).toHaveLength(2);
    await runCron(ist(2026, 11, 1, 0, 35));
    const started = rows("notification").filter((n) => n.userId === OWNER && n.type === "goal_period_started");
    expect(started).toHaveLength(2);
    for (const n of started) expect(String(n.id)).toMatch(/^gps_2026-11-01_[0-9a-f]{32}$/);
  });
});

/* ───────────────────────── Privacy ───────────────────────── */

describe("final review privacy M1: no digest or nudge reaches an owner who no longer works in the goal's workspace", () => {
  function goalsOfThree() {
    seedRow(db, "user", { id: "u-gone", organizationId: ORG, firstName: "Gus", lastName: "Gone", email: "gus@acme.test", status: "INACTIVE", deletedAt: null });
    seedRow(db, "user", { id: "u-moved", organizationId: ORG2, firstName: "Mo", lastName: "Ved", email: "mo@acme.test", status: "ACTIVE", deletedAt: null });
    for (const [id, owner] of [["g-live", OWNER], ["g-gone", "u-gone"], ["g-moved", "u-moved"]]) {
      handGoal(id, { ownerId: owner, repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 9, 20) }, [{}]);
    }
  }

  it("the started and results rows go to the live owner only", async () => {
    goalsOfThree();
    await runCron(ist(2026, 10, 2));
    await runCron(ist(2026, 11, 1, 0, 35));
    expect(rows("notification").filter((n) => n.type === "goal_period_started").map((n) => n.userId)).toEqual([OWNER]);
    await runCron(ist(2026, 11, 6, 0, 35));
    expect(rows("notification").filter((n) => n.type === "goal_period_closed").map((n) => n.userId)).toEqual([OWNER]);
    // notifyPeriodsStarted alone, again: still nobody else.
    expect(await notifyPeriodsStarted(ORG, ist(2026, 11, 1, 1))).toBe(0);
  });

  it("the end nudge, its email and the stale check-in rows go to the live owner only", async () => {
    goalsOfThree();
    seedRow(db, "oKR", { id: "g-old", organizationId: ORG, title: "One time", level: "INDIVIDUAL", ownerId: "u-gone", startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), createdAt: ist(2026, 9, 1) });
    seedRow(db, "keyResult", { id: "g-old-kr", okrId: "g-old", title: "T", startValue: 0, targetValue: 10, currentValue: 0, createdAt: ist(2026, 9, 1) });
    await runCron(ist(2026, 10, 2));
    const r = await runReminders(ist(2026, 10, 29, 9));
    expect([...new Set(rows("notification").filter((n) => n.type === "okr_check_in_due").map((n) => n.userId))]).toEqual([OWNER]);
    expect(st.mail.map((m) => m.to)).toEqual(["olga@acme.test"]);
    expect(r.body.skippedLeft).toBeGreaterThan(0);
  });
});

describe("final review privacy M2: one count budget per person, shared by the preview, a saved source and Refresh", () => {
  it("30 previews spend it: Refresh and a connected source are then refused with the budget's words, and nothing is written", async () => {
    sourcedGoal("g-budget", DONE_LIST);
    seedRow(db, "user", { id: "u-budget", organizationId: ORG, firstName: "Bea", lastName: "Budget", email: "bea@acme.test", status: "ACTIVE", deletedAt: null });
    st.editors.add("u-budget");
    grant("u-budget", "b-ops");
    as("u-budget");
    at(ist(2026, 10, 3));
    for (let i = 0; i < 30; i++) expect((await call(previewRoute.POST, "/api/okrs/g-budget/key-results/preview", { method: "POST", params: { id: "g-budget" }, body: { source: DONE_LIST } })).status).toBe(200);
    const refresh = await call(refreshRoute.POST, "/api/okrs/g-budget/refresh", { method: "POST", params: { id: "g-budget" }, body: {} });
    expect(refresh).toMatchObject({ status: 429, body: { error: "You're counting too often. Try again in a minute." } });
    const before = rows("keyResult").length;
    const post = await call(krsRoute.POST, "/api/okrs/g-budget/key-results", { method: "POST", params: { id: "g-budget" }, body: { title: "More", source: DONE_LIST } });
    expect(post).toMatchObject({ status: 429, body: { error: "You're counting too often. Try again in a minute." } });
    expect(rows("keyResult")).toHaveLength(before);
    const patch = await call(krRoute.PATCH, "/api/okrs/g-budget/key-results/g-budget-kr", { method: "PATCH", params: { id: "g-budget", krId: "g-budget-kr" }, body: { reconnect: true } });
    expect(patch.status).toBe(429);
    expect(kr("g-budget-kr").sourceById).toBe(CONN);
  });

  it("Refresh is limited per person and goal: two people refresh the same goal six times each", async () => {
    sourcedGoal("g-two", DONE_LIST);
    for (const id of ["u-ref-a", "u-ref-b"]) {
      seedRow(db, "user", { id, organizationId: ORG, firstName: id, lastName: "R", email: `${id}@acme.test`, status: "ACTIVE", deletedAt: null });
      st.editors.add(id);
    }
    at(ist(2026, 10, 3));
    for (const id of ["u-ref-a", "u-ref-b"]) {
      as(id);
      for (let i = 0; i < 6; i++) expect((await call(refreshRoute.POST, "/api/okrs/g-two/refresh", { method: "POST", params: { id: "g-two" }, body: {} })).status).toBe(200);
    }
    as("u-ref-a");
    const seventh = await call(refreshRoute.POST, "/api/okrs/g-two/refresh", { method: "POST", params: { id: "g-two" }, body: {} });
    expect(seventh).toMatchObject({ status: 429, body: { error: "This goal was just refreshed. Try again in a minute." } });
  });
});

describe("final review privacy L1: the goal route settles only a goal the caller may see", () => {
  it("a caller who cannot see a repeating goal gets a 404 and opens no period", async () => {
    handGoal("g-hidden", { repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 9, 20) }, [{}]);
    st.blind.add(VIEWER);
    as(VIEWER);
    at(ist(2026, 10, 12));
    expect((await call(okrRoute.GET, "/api/okrs/g-hidden", { params: { id: "g-hidden" } })).status).toBe(404);
    expect(rows("goalPeriod").filter((p) => p.okrId === "g-hidden")).toHaveLength(0);
  });
});

describe("final review privacy L2: linking a KPI needs the right to read the owner's KPI numbers", () => {
  it("a goal editor who is not the owner, and cannot read the owner's KPIs, is refused; the owner is not", async () => {
    seedKpi();
    seedRow(db, "oKR", { id: "g-kpi", organizationId: ORG, title: "Revenue", level: "INDIVIDUAL", ownerId: OWNER, startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), createdAt: ist(2026, 9, 20) });
    seedRow(db, "keyResult", { id: "g-kpi-kr", okrId: "g-kpi", title: "Typed", startValue: 0, targetValue: 10, currentValue: 0, createdAt: ist(2026, 9, 20) });
    at(ist(2026, 10, 12));
    as(CONN);
    const post = await call(krsRoute.POST, "/api/okrs/g-kpi/key-results", { method: "POST", params: { id: "g-kpi" }, body: { title: "Revenue", kpiId: "kpi-1" } });
    // Plain and fixable: whose numbers, and who can link it (final review product).
    expect(post).toMatchObject({ status: 403, body: { error: "You can link a KPI only when you can see Olga's KPI numbers. Ask Olga or their manager to link it." } });
    const patch = await call(krRoute.PATCH, "/api/okrs/g-kpi/key-results/g-kpi-kr", { method: "PATCH", params: { id: "g-kpi", krId: "g-kpi-kr" }, body: { kpiId: "kpi-1" } });
    expect(patch.status).toBe(403);
    expect(kr("g-kpi-kr").kpiId).toBeNull();
    // A title edit of a target is not a new link.
    expect((await call(krRoute.PATCH, "/api/okrs/g-kpi/key-results/g-kpi-kr", { method: "PATCH", params: { id: "g-kpi", krId: "g-kpi-kr" }, body: { title: "Typed again" } })).status).toBe(200);
    as(OWNER);
    expect((await call(krsRoute.POST, "/api/okrs/g-kpi/key-results", { method: "POST", params: { id: "g-kpi" }, body: { title: "Revenue", kpiId: "kpi-1" } })).status).toBe(201);
  });
});

describe("final review privacy L3: goal_source_paused names the goal only to people who may still see it", () => {
  it("a connector moved off the goal's audience gets no row; the owner does", async () => {
    st.blind.add(CONN);
    const written = await notifySourcePaused(ORG, { id: "g-x", title: "Hiring", level: "INDIVIDUAL", ownerId: OWNER }, "Hires", PAUSE.lostList("Priya"), [OWNER, CONN]);
    expect(written).toBe(1);
    expect(rows("notification").map((n) => n.userId)).toEqual([OWNER]);
  });
});

describe("final review privacy L4: a Done-date count pages through at most four times the cap", () => {
  it("80,001 subtask completions in the window pause the count without paging through them", async () => {
    const t = ist(2026, 10, 5);
    const items = db.rows.item ?? (db.rows.item = []);
    const done = db.rows.itemCompletion ?? (db.rows.itemCompletion = []);
    seedRow(db, "item", { id: "parent", organizationId: ORG, boardId: "b-ops", title: "Parent" });
    for (let i = 0; i < 80_001; i++) {
      items.push({ id: `sub-${i}`, organizationId: ORG, boardId: "b-ops", title: `S${i}`, itemType: "studio-item", status: "DONE", ownerId: null, assigneeIds: [], metadata: {}, parentItemId: "parent", archivedAt: null, dueAt: null, startAt: null, priority: null, itemTypeId: null, createdAt: t, updatedAt: t });
      done.push({ id: `c-sub-${i}`, itemId: `sub-${i}`, boardId: "b-ops", organizationId: ORG, status: "DONE", doneAt: t, actorId: null });
    }
    for (let i = 0; i < 3; i++) await newTask(`Top ${i}`, ist(2026, 10, 6 + i), { status: "DONE" });
    const conn = await connectorFor(ORG, CONN);
    if (!conn.ok) throw new Error(conn.reason);
    const source = { kind: "list" as const, listIds: ["b-ops"], spaceId: null, metric: { op: "count" as const }, filter: { connector: "AND" as const, rules: [], hideDone: false }, countedBy: "done" as const, dateFieldKey: null };
    const r = await countListSource({ orgId: ORG, source, connector: conn.connector, window: periodWindow(periodFor("MONTHLY", ist(2026, 10, 15), KOLKATA), KOLKATA), zone: "Asia/Kolkata", now: ist(2026, 10, 20) });
    expect(r).toEqual({ kind: "paused", reason: PAUSE.tooMany });
  }, 120_000);
});
