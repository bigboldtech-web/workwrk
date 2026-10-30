// Repeating goals, the review of the final fix runs (1da1eb07 and d97587f4,
// 2026-10-29): M1 a target a period still taking numbers holds can't be
// deleted yet, M2 a status set round trip invents no completion, L1 the
// set-aside row is no feed, L2 a one-time Right now count paused at its
// final count stands, L3 the backfill judges the status sets of its write,
// locks parents first and retries a deadlock, L4 the count budget never
// refuses a Save, and L5 "Open October" when nothing in October takes a
// check-in. The screens' side (the delete dialog, the preview's 429, the
// toast) is src/app/(dashboard)/okrs/[id]/goal-fixes-review.test.ts.
//
// The final review's world (goal-final-review.test.ts): the real routes,
// task write paths, count, refresh, close and crons over the in-memory
// database of goal-test-db.ts, in an Asia/Kolkata workspace.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  /** userId to listId to role. */
  roles: new Map<string, Map<string, string>>(),
  /** Who may edit the goals. */
  editors: new Set<string>(),
  session: null as null | { user: Record<string, unknown> },
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
  canSeeGoal: async () => true,
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
// GET /api/item-activity's caller: a member of the workspace.
vi.mock("@/lib/suites/auth", () => ({
  resolveSuiteContext: async () => ({ userId: String(st.session?.user.id), orgId: String(st.session?.user.organizationId) }),
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
vi.mock("@/lib/activity", () => ({ logActivity: () => {} }));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => {}, calculatePerformanceScore: async () => {} }));
vi.mock("@/lib/goals/goal-period-score.server", () => ({ patchPeriodScore: async () => undefined }));
vi.mock("@/lib/access/node-placement", async (orig) => ({ ...((await orig()) as Record<string, unknown>), canvasesHaveFolders: async () => false }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => {}, queueEmail: async () => {} }));
vi.mock("@/lib/email-templates", () => ({ genericNotificationTemplate: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/notify-prefs", () => ({ shouldEmail: async () => true }));

import { goalDb as db, seedRow } from "./goal-test-db";
import { createBoardItem, updateBoardItem } from "@/lib/board-items";
import { updateBoard } from "@/lib/board";
import { checkInRepeating, deleteWaitWords, settleGoalPeriods, targetDeleteRefusals } from "./goal-periods.server";
import { periodView } from "./goal-period-view.server";
import { periodSettingsOf } from "./goal-period";
import { lateNumbersNote } from "./goal-form";
import { writePage } from "../../../scripts/backfill-item-completions";
import { getBoardStatuses } from "@/lib/board-items-shared";
import * as cronRoute from "@/app/api/cron/goal-periods/route";
import * as krsRoute from "@/app/api/okrs/[id]/key-results/route";
import * as krRoute from "@/app/api/okrs/[id]/key-results/[krId]/route";
import * as previewRoute from "@/app/api/okrs/[id]/key-results/preview/route";
import * as itemActivityRoute from "@/app/api/item-activity/route";

const ORG = "org-1";
const OWNER = "u-olga";
const CONN = "u-priya";
const KOLKATA = periodSettingsOf({ timezone: "Asia/Kolkata" });

/** An instant given as IST wall-clock time. */
const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);
const at = (t: Date) => vi.setSystemTime(t);
const rows = (model: string) => (db.rows[model] ?? []) as Array<Record<string, unknown>>;
const DONE_LIST = { kind: "list", listIds: ["b-ops"], metric: { op: "count" }, filter: { connector: "AND", rules: [], hideDone: false }, countedBy: "done" };
const NOW_LIST = { ...DONE_LIST, countedBy: "now" };
const kr = (id: string) => rows("keyResult").find((k) => k.id === id);
const periodOf = (okrId: string, key: string) => rows("goalPeriod").find((p) => p.okrId === okrId && p.key === key);
const rowsIn = (okrId: string, key: string) => rows("keyResultPeriod").filter((r) => r.periodId === periodOf(okrId, key)?.id);
const completionsOf = (itemId: string) => rows("itemCompletion").filter((c) => c.itemId === itemId);

function grant(userId: string, id: string, role = "VIEW") {
  const m = st.roles.get(userId) ?? new Map<string, string>();
  m.set(id, role);
  st.roles.set(userId, m);
}

/** A goal with hand-checked targets (or KPI ones), written straight into the store. */
function handGoal(id: string, goal: Record<string, unknown>, targets: Array<Record<string, unknown>>) {
  seedRow(db, "oKR", { id, organizationId: ORG, title: `Goal ${id}`, level: "INDIVIDUAL", ownerId: OWNER, createdAt: ist(2026, 9, 25), ...goal });
  targets.forEach((t, i) => seedRow(db, "keyResult", { id: `${id}-kr${i}`, okrId: id, title: `T${i}`, startValue: 0, targetValue: 10, currentValue: 0, createdAt: ist(2026, 9, 25), ...t }));
}

/** A monthly goal whose one target counts `source` as Priya, from September. */
function sourcedGoal(id: string, source: unknown) {
  seedRow(db, "oKR", { id, organizationId: ORG, title: `Goal ${id}`, level: "INDIVIDUAL", ownerId: OWNER, repeat: "MONTHLY", startDate: new Date("2026-09-01T00:00:00Z"), createdAt: ist(2026, 8, 20) });
  seedRow(db, "keyResult", { id: `${id}-kr`, okrId: id, title: "Counted", startValue: 0, targetValue: 10, currentValue: 0, source, sourceById: CONN, createdAt: ist(2026, 8, 20) });
}

function seedKpi() {
  seedRow(db, "kPI", { id: "kpi-1", organizationId: ORG, name: "Revenue", unit: null, direction: "HIGHER", lowerIsBetter: false, targetValue: 100, ownership: "OWNED", isNorthStar: false });
}

/** A task written straight into the store, with no completion (a copy, a dateless import, work from before completions). */
function bareTask(id: string, extra: Record<string, unknown> = {}) {
  return seedRow(db, "item", {
    id, organizationId: ORG, boardId: "b-ops", title: id, itemType: "studio-item", status: "DONE", ownerId: null, assigneeIds: [], metadata: {},
    parentItemId: null, archivedAt: null, dueAt: null, startAt: null, priority: null, itemTypeId: null, createdAt: ist(2026, 9, 1), updatedAt: ist(2026, 9, 1), ...extra,
  });
}

async function newTask(title: string, t: Date, extra: Record<string, unknown> = {}) {
  at(t);
  return createBoardItem({ organizationId: ORG, boardId: "b-ops", title, actorId: CONN, ...extra } as Parameters<typeof createBoardItem>[0]);
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

async function runCron(t: Date) {
  at(t);
  return call(cronRoute.POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
}
const as = (userId: string) => { st.session = legacyTestSession(userId, "EMPLOYEE", ORG); };
const deleteTarget = (okrId: string, krId: string) => call(krRoute.DELETE, `/api/okrs/${okrId}/key-results/${krId}`, { method: "DELETE", params: { id: okrId, krId } });

let errors: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.reset();
  st.roles.clear();
  st.editors = new Set([OWNER, CONN]);
  as(CONN);
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.RECURRING_GOALS = "1";
  process.env.CRON_SECRET = "test-secret";
  seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
  for (const [id, first, email] of [[OWNER, "Olga", "olga@acme.test"], [CONN, "Priya", "priya@acme.test"]]) {
    seedRow(db, "user", { id, organizationId: ORG, firstName: first, lastName: "Test", email, status: "ACTIVE", deletedAt: null });
  }
  seedRow(db, "board", { id: "b-ops", organizationId: ORG, name: "Ops", slug: "ops" });
  grant(CONN, "b-ops");
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
});

/* ───────────────────────── Medium ───────────────────────── */

describe("fixes review M1: a target a period still taking numbers holds can't be deleted yet", () => {
  it("refused on 3 November with October's last day, both rows and the target kept; deleted once October closes, and October's result never moves", async () => {
    handGoal("g-del", { repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z") }, [{}, {}]);
    await checkInRepeating({ orgId: ORG, okrId: "g-del", keyResultId: "g-del-kr0", value: 10, note: null, userId: OWNER, now: ist(2026, 10, 10) });
    at(ist(2026, 11, 3));
    await settleGoalPeriods(ORG, ["g-del"], ist(2026, 11, 3));
    as(OWNER);
    const words = "October still takes numbers until 5 Nov, so this target can't be deleted yet. Delete it after that.";
    expect(await deleteTarget("g-del", "g-del-kr1")).toEqual({ status: 409, body: { error: words } });
    expect(kr("g-del-kr1")).toBeTruthy();
    expect(rowsIn("g-del", "2026-10-01").map((r) => r.keyResultId).sort()).toEqual(["g-del-kr0", "g-del-kr1"]);
    expect(rowsIn("g-del", "2026-11-01").map((r) => r.keyResultId).sort()).toEqual(["g-del-kr0", "g-del-kr1"]);
    // The goal page reads the same words for each target October holds, before any confirm.
    expect(await targetDeleteRefusals(db.prisma as never, "g-del", ["g-del-kr0", "g-del-kr1"], KOLKATA, ist(2026, 11, 3))).toEqual(new Map([["g-del-kr0", words], ["g-del-kr1", words]]));
    // Past its grace, before the cron has frozen it.
    at(ist(2026, 11, 6, 0, 10));
    expect(await deleteTarget("g-del", "g-del-kr1")).toEqual({ status: 409, body: { error: "October is closing, so this target can't be deleted yet. Try again in an hour." } });
    // October closes on both targets, as it stood.
    await runCron(ist(2026, 11, 6, 0, 35));
    expect(periodOf("g-del", "2026-10-01")).toMatchObject({ status: "CLOSED", progress: 50, result: "MISSED" });
    at(ist(2026, 11, 6, 9));
    expect(await deleteTarget("g-del", "g-del-kr1")).toMatchObject({ status: 200 });
    expect(kr("g-del-kr1")).toBeUndefined();
    expect(rowsIn("g-del", "2026-11-01").map((r) => r.keyResultId)).toEqual(["g-del-kr0"]);
    expect(rowsIn("g-del", "2026-10-01").map((r) => r.keyResultId).sort()).toEqual(["g-del-kr0", null].sort());
    expect(periodOf("g-del", "2026-10-01")).toMatchObject({ status: "CLOSED", progress: 50, result: "MISSED" });
  });

  it("a KPI hold names the hold's last day; of two periods holding it, the one that closes last", async () => {
    seedKpi();
    handGoal("g-kpi", { repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z") }, [{}, { title: "Revenue", targetValue: 100, kpiId: "kpi-1" }]);
    await runCron(ist(2026, 10, 15));
    // Past October's grace (5 November), still held for its KPI month until 1 December, 14:00 UTC.
    at(ist(2026, 11, 20));
    await settleGoalPeriods(ORG, ["g-kpi"], ist(2026, 11, 20));
    as(OWNER);
    expect(await deleteTarget("g-kpi", "g-kpi-kr0")).toEqual({ status: 409, body: { error: "October still takes numbers until 30 Nov, so this target can't be deleted yet. Delete it after that." } });
    // 1 December: October is still held, and November has ended too, held for its KPI month until 31 December.
    at(new Date("2026-12-01T10:00:00.000Z"));
    await settleGoalPeriods(ORG, ["g-kpi"], new Date("2026-12-01T10:00:00.000Z"));
    expect(periodOf("g-kpi", "2026-10-01")!.status).toBe("OPEN");
    expect(await deleteTarget("g-kpi", "g-kpi-kr0")).toEqual({ status: 409, body: { error: "November still takes numbers until 31 Dec, so this target can't be deleted yet. Delete it after that." } });
    expect(kr("g-kpi-kr0")).toBeTruthy();
  });

  it("a week says the week, and a target October never held goes at once", async () => {
    const week = { key: "2026-10-19", cadence: "WEEKLY" as const, startsAt: ist(2026, 10, 19, 0), endsAt: ist(2026, 10, 26, 0), graceEndsAt: ist(2026, 10, 28, 0), closesAt: ist(2026, 10, 28, 0) };
    expect(deleteWaitWords(week, KOLKATA, ist(2026, 10, 27))).toBe("The week of 19 Oct still takes numbers until 27 Oct, so this target can't be deleted yet. Delete it after that.");
    handGoal("g-new", { repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z") }, [{}]);
    at(ist(2026, 10, 20));
    await settleGoalPeriods(ORG, ["g-new"], ist(2026, 10, 20));
    // Added on 3 November, in October's grace: a row in November only (B5).
    at(ist(2026, 11, 3));
    as(OWNER);
    const added = await call(krsRoute.POST, "/api/okrs/g-new/key-results", { method: "POST", params: { id: "g-new" }, body: { title: "New", startValue: 0, targetValue: 5 } });
    expect(added.status).toBe(201);
    const id = String((added.body.keyResult as { id: string }).id);
    expect(rowsIn("g-new", "2026-10-01").map((r) => r.keyResultId)).toEqual(["g-new-kr0"]);
    expect(await deleteTarget("g-new", id)).toMatchObject({ status: 200 });
    expect(kr(id)).toBeUndefined();
  });
});

describe("fixes review M2: a status set round trip gives a done task with no completion none back", () => {
  const set = (verified: "ACTIVE" | "DONE") => [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" as const }, { value: "VERIFIED", label: "Verified", color: "#090", group: verified }];

  it("a copy in Verified, set aside with none on 9 October, gets no completion when Verified is done again on 12 October", async () => {
    seedRow(db, "board", { id: "b-qa", organizationId: ORG, name: "QA", slug: "qa", statuses: set("DONE") });
    bareTask("t-copy", { boardId: "b-qa", status: "VERIFIED" });
    at(ist(2026, 10, 9));
    await updateBoard("b-qa", { statuses: set("ACTIVE") });
    expect(rows("itemActivity").filter((a) => a.entityType === "BOARD_STATUS_SET").map((a) => a.meta)).toEqual([{ completions: [], none: [{ itemId: "t-copy", status: "VERIFIED" }] }]);
    at(ist(2026, 10, 12));
    await updateBoard("b-qa", { statuses: set("DONE") });
    expect(completionsOf("t-copy")).toHaveLength(0);
  });

  it("moved since the change set it aside, it is dated by that move, as any task is", async () => {
    seedRow(db, "board", { id: "b-qa", organizationId: ORG, name: "QA", slug: "qa", statuses: set("DONE") });
    bareTask("t-moved", { boardId: "b-qa", status: "VERIFIED" });
    at(ist(2026, 10, 9));
    await updateBoard("b-qa", { statuses: set("ACTIVE") });
    at(ist(2026, 10, 10));
    await updateBoardItem("t-moved", { status: "OPEN" }, CONN);
    at(ist(2026, 10, 11));
    await updateBoardItem("t-moved", { status: "VERIFIED" }, CONN);
    at(ist(2026, 10, 12));
    await updateBoard("b-qa", { statuses: set("DONE") });
    expect(completionsOf("t-moved").map((c) => (c.doneAt as Date).getTime())).toEqual([ist(2026, 10, 11).getTime()]);
  });
});

/* ───────────────────────── Low ───────────────────────── */

describe("fixes review L1: the set-aside row is not readable through the activity feed", () => {
  it("GET /api/item-activity refuses BOARD_STATUS_SET, and a task's feed still reads", async () => {
    seedRow(db, "itemActivity", { id: "a-aside", organizationId: ORG, entityType: "BOARD_STATUS_SET", entityId: "b-ops", actorId: null, action: "COMPLETIONS_SET_ASIDE", meta: { completions: [{ itemId: "t-secret", status: "DONE", doneAt: "2026-10-03T00:00:00.000Z" }] }, createdAt: ist(2026, 10, 9) });
    seedRow(db, "itemActivity", { id: "a-task", organizationId: ORG, entityType: "BOARD_ITEM", entityId: "t-1", actorId: CONN, action: "CREATED", meta: {}, createdAt: ist(2026, 10, 9) });
    const refused = await call(itemActivityRoute.GET, "/api/item-activity?entityType=BOARD_STATUS_SET&entityId=b-ops");
    expect(refused).toEqual({ status: 404, body: { error: "not found" } });
    const task = await call(itemActivityRoute.GET, "/api/item-activity?entityType=BOARD_ITEM&entityId=t-1");
    expect(task.status).toBe(200);
    expect((task.body.activity as Array<{ id: string }>).map((a) => a.id)).toEqual(["a-task"]);
  });
});

describe("fixes review L2: a one-time Right now count paused at its final count keeps its number", () => {
  it("paused on 1 November with access lost, it stays at October's 1 when access is back and a task is added", async () => {
    seedRow(db, "oKR", { id: "g-now", organizationId: ORG, title: "Open bugs", level: "INDIVIDUAL", ownerId: OWNER, startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z"), createdAt: ist(2026, 9, 25) });
    seedRow(db, "keyResult", { id: "g-now-kr", okrId: "g-now", title: "Bugs", startValue: 0, targetValue: 10, currentValue: 0, source: NOW_LIST, sourceById: CONN, createdAt: ist(2026, 9, 25) });
    await newTask("A bug", ist(2026, 10, 10));
    await runCron(ist(2026, 10, 20));
    expect(kr("g-now-kr")?.currentValue).toBe(1);
    st.roles.get(CONN)!.delete("b-ops");
    await runCron(ist(2026, 11, 1, 12));
    expect(kr("g-now-kr")).toMatchObject({ currentValue: 1, sourcePausedReason: "Priya can no longer open a List it counts. Reconnect it." });
    grant(CONN, "b-ops");
    await newTask("A November bug", ist(2026, 11, 1, 12, 30));
    await runCron(ist(2026, 11, 1, 13, 5));
    await runCron(ist(2026, 11, 2, 14));
    expect(kr("g-now-kr")?.currentValue).toBe(1);
  });

  it("paused ten minutes before the due date ended, its final count is still the first run after the end, not one an hour on", async () => {
    seedRow(db, "oKR", { id: "g-now2", organizationId: ORG, title: "Open bugs", level: "INDIVIDUAL", ownerId: OWNER, startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z"), createdAt: ist(2026, 9, 25) });
    seedRow(db, "keyResult", { id: "g-now2-kr", okrId: "g-now2", title: "Bugs", startValue: 0, targetValue: 10, currentValue: 0, source: NOW_LIST, sourceById: CONN, createdAt: ist(2026, 9, 25) });
    await newTask("A bug", ist(2026, 10, 10));
    st.roles.get(CONN)!.delete("b-ops");
    await runCron(ist(2026, 10, 31, 23, 50));
    expect(kr("g-now2-kr")).toMatchObject({ currentValue: 0, sourcePausedReason: "Priya can no longer open a List it counts. Reconnect it." });
    grant(CONN, "b-ops");
    await runCron(ist(2026, 11, 1, 0, 5));
    expect(kr("g-now2-kr")).toMatchObject({ currentValue: 1, sourcePausedReason: null });
    await newTask("A November bug", ist(2026, 11, 1, 0, 20));
    await runCron(ist(2026, 11, 1, 0, 35));
    await runCron(ist(2026, 11, 1, 1, 5));
    expect(kr("g-now2-kr")?.currentValue).toBe(1);
  });
});

describe("fixes review L3: the backfill judges the status sets of its own write, locks parents first, and retries a deadlock", () => {
  const set = (verified: "ACTIVE" | "DONE") => [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" as const }, { value: "VERIFIED", label: "Verified", color: "#090", group: verified }];
  const plan = (itemId: string, boardId = "b-ops", status = "DONE") => ({ itemId, boardId, organizationId: ORG, status, doneAt: ist(2026, 9, 15), actorId: null as null });
  // As the backfill was called before: with the sets the run read at its start, which the write must not trust.
  const write = writePage as unknown as (prisma: unknown, rows: unknown, startSets?: unknown) => ReturnType<typeof writePage>;

  it("Verified made not done after the plan: the task is skipped, never given a completion", async () => {
    seedRow(db, "board", { id: "b-qa", organizationId: ORG, name: "QA", slug: "qa", statuses: set("DONE") });
    bareTask("t-v", { boardId: "b-qa", status: "VERIFIED" });
    const startSets = new Map([["b-qa", getBoardStatuses({ statuses: set("DONE") })]]);
    db.rows.board.find((b) => b.id === "b-qa")!.statuses = set("ACTIVE");
    expect(await write(db.prisma, [plan("t-v", "b-qa", "VERIFIED")], startSets)).toEqual({ written: 0, changedSince: 1 });
    expect(completionsOf("t-v")).toHaveLength(0);
    expect(db.raw.some((t) => /^SELECT id, statuses FROM "Board" WHERE id = ANY\(\?\) ORDER BY id FOR SHARE/.test(t))).toBe(true);
  });

  it("a parent is locked before its subtask, whatever their ids, as a move locks them", async () => {
    bareTask("t-z-parent");
    bareTask("t-a-sub", { parentItemId: "t-z-parent" });
    const order: string[] = [];
    db.afterLock = (key) => { if (key.startsWith("row:Item:")) order.push(key); };
    const startSets = new Map([["b-ops", getBoardStatuses(null)]]);
    expect(await write(db.prisma, [plan("t-a-sub"), plan("t-z-parent")], startSets)).toEqual({ written: 2, changedSince: 0 });
    expect(order).toEqual(["row:Item:t-z-parent", "row:Item:t-a-sub"]);
  });

  it("a page that loses a deadlock is rolled back and tried again", async () => {
    bareTask("t-dl");
    db.failNext = { what: "itemCompletion.createMany", error: "deadlock detected (SQLSTATE 40P01)" };
    const startSets = new Map([["b-ops", getBoardStatuses(null)]]);
    expect(await write(db.prisma, [plan("t-dl")], startSets)).toEqual({ written: 1, changedSince: 0 });
    expect(completionsOf("t-dl")).toHaveLength(1);
  });
});

describe("fixes review L4: the count budget never refuses a Save", () => {
  it("with the budget spent the preview says the 429's words, and a new source and a Reconnect are saved uncounted, then counted by the cron", async () => {
    sourcedGoal("g-budget", DONE_LIST);
    seedRow(db, "user", { id: "u-bud", organizationId: ORG, firstName: "Bud", lastName: "Get", email: "bud@acme.test", status: "ACTIVE", deletedAt: null });
    st.editors.add("u-bud");
    grant("u-bud", "b-ops");
    await newTask("Shipped", ist(2026, 10, 2), { status: "DONE" });
    as("u-bud");
    at(ist(2026, 10, 4));
    for (let i = 0; i < 30; i++) expect((await call(previewRoute.POST, "/api/okrs/g-budget/key-results/preview", { method: "POST", params: { id: "g-budget" }, body: { source: DONE_LIST } })).status).toBe(200);
    const preview = await call(previewRoute.POST, "/api/okrs/g-budget/key-results/preview", { method: "POST", params: { id: "g-budget" }, body: { source: DONE_LIST } });
    expect(preview).toEqual({ status: 429, body: { error: "You're counting too often. Try again in a minute." } });
    const post = await call(krsRoute.POST, "/api/okrs/g-budget/key-results", { method: "POST", params: { id: "g-budget" }, body: { title: "More", source: DONE_LIST } });
    expect(post.status).toBe(201);
    expect(post.body.countsLater).toBe(true);
    const added = kr(String((post.body.keyResult as { id: string }).id))!;
    expect(added).toMatchObject({ sourceById: "u-bud", currentValue: 0 });
    expect(added.sourceRefreshedAt ?? null).toBeNull();
    const patch = await call(krRoute.PATCH, "/api/okrs/g-budget/key-results/g-budget-kr", { method: "PATCH", params: { id: "g-budget", krId: "g-budget-kr" }, body: { reconnect: true } });
    expect(patch).toMatchObject({ status: 200, body: { countsLater: true } });
    expect(kr("g-budget-kr")).toMatchObject({ sourceById: "u-bud", sourceRefreshedAt: null });
    // The cron's next run counts both.
    await runCron(ist(2026, 10, 4, 12, 35));
    expect(rowsIn("g-budget", "2026-10-01").map((r) => [r.keyResultId, r.currentValue]).sort()).toEqual([[added.id, 1], ["g-budget-kr", 1]].sort());
  });
});

describe("fixes review L5: \"Open October\" when no row of October takes a hand check-in", () => {
  it("a goal counted by its List alone opens October; a hand-checked one checks in there", async () => {
    sourcedGoal("g-auto", DONE_LIST);
    handGoal("g-hand", { repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z") }, [{}]);
    at(ist(2026, 11, 3));
    await settleGoalPeriods(ORG, ["g-auto", "g-hand"], ist(2026, 11, 3));
    const auto = (await periodView(null, "g-auto", null, KOLKATA, ist(2026, 11, 3)))!;
    expect(auto.previous).toMatchObject({ key: "2026-10-01", takesLateNumbers: true, takesHandCheckIns: false });
    expect(lateNumbersNote(auto.previous, true)).toEqual({ line: "October still takes late numbers until 5 Nov.", linkLabel: "Open October" });
    const hand = (await periodView(null, "g-hand", null, KOLKATA, ist(2026, 11, 3)))!;
    expect(hand.previous).toMatchObject({ key: "2026-10-01", takesHandCheckIns: true });
    expect(lateNumbersNote(hand.previous, true)).toEqual({ line: "October still takes late numbers until 5 Nov.", linkLabel: "Check in for October" });
  });
});
