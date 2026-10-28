// Repeating goals, step 4: numbers from a List (docs/plans/recurring-goals.md
// C3, C4, C7 to C10, and the step's "Must prove" list, one `describe` each).
// The real task write paths (createBoardItem, updateBoardItem, the recurring
// roll-forward, the task and List duplicates, Trash), the real count, refresh
// and close, over the in-memory database of goal-test-db.ts, in an
// Asia/Kolkata workspace (and a New York one for the date keys). Access is a
// table the test sets (who can open which List), so a connector losing a
// List is one line.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  /** userId to listId (or spaceId) to role. */
  roles: new Map<string, Map<string, string>>(),
  /** Who may edit the goals. */
  editors: new Set<string>(),
  session: null as null | { user: Record<string, unknown> },
  activity: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./goal-test-db")).goalDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => st.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

// Acting as the connector (access/acting-person.ts): their stored row, as the engine would read it.
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
vi.mock("@/lib/list-links-server", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  listLinksAvailable: async () => false,
  spaceForViewer: async (v: { userId: string }, spaceId: string) => (st.roles.get(v.userId)?.get(spaceId) ? { id: spaceId } : null),
  captureListLinks: async () => [],
  reconcileListLinks: async () => undefined,
  eligibleCopyLists: async () => [],
  copyListLinks: async () => [],
}));
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
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => {}, calculatePerformanceScore: async () => undefined }));
vi.mock("@/lib/goals/goal-period-score.server", () => ({ patchPeriodScore: async () => undefined }));
vi.mock("@/lib/access/node-placement", async (orig) => ({ ...((await orig()) as Record<string, unknown>), canvasesHaveFolders: async () => false }));
// The org rollup, counted (the query-count proof): the real functions, watched.
vi.mock("@/lib/alignment", async (orig) => {
  const real = (await orig()) as Record<string, (...a: unknown[]) => unknown>;
  return { ...real, persistGoalRollupChains: vi.fn(real.persistGoalRollupChains), computeGoalRollups: vi.fn(real.computeGoalRollups) };
});

import { goalDb as db, seedRow } from "./goal-test-db";
import { createBoardItem, moveBoardItem, updateBoardItem } from "@/lib/board-items";
import { duplicateBoard, updateBoard } from "@/lib/board";
import { advanceSeriesOnComplete } from "@/lib/recurring-tasks";
import { moveToTrash, restoreFromTrash } from "@/lib/trash";
import { repairItemCompletions } from "@/lib/item-completions";
import { checkInRepeating, closeDuePeriods, settleGoalPeriods } from "./goal-periods.server";
import { countListSource, connectorFor, describeTargetSources, refreshGoalSources } from "./goal-source.server";
import { LIST_SOURCE_CAP, PRIVATE_LIST_WORDS, periodWindow } from "./goal-source";
import { periodFor, periodSettingsOf } from "./goal-period";
import { computeGoalRollups, persistGoalRollupChains } from "@/lib/alignment";
import { computeWidget } from "@/lib/dashboards/widget-data";
import { parseWidgets } from "@/lib/dashboards/widgets";
import * as duplicateRoute from "@/app/api/items/[id]/duplicate/route";
import * as cronRoute from "@/app/api/cron/goal-periods/route";
import * as krsRoute from "@/app/api/okrs/[id]/key-results/route";
import * as previewRoute from "@/app/api/okrs/[id]/key-results/preview/route";
import * as refreshRoute from "@/app/api/okrs/[id]/refresh/route";

const ORG = "org-1";
const NY = "org-ny";
const OWNER = "u-olga";
const CONN = "u-priya";
const VIEWER = "u-vic";
const KOLKATA = periodSettingsOf({ timezone: "Asia/Kolkata" });
const NEW_YORK = periodSettingsOf({ timezone: "America/New_York" });

/** An instant given as IST wall-clock time. */
const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);
const at = (t: Date) => vi.setSystemTime(t);
const rows = (model: string) => (db.rows[model] ?? []) as Array<Record<string, unknown>>;
const DONE_LIST = { kind: "list", listIds: ["b-ops"], metric: { op: "count" }, filter: { connector: "AND", rules: [], hideDone: false }, countedBy: "done" };

function grant(userId: string, id: string, role = "VIEW") {
  const m = st.roles.get(userId) ?? new Map<string, string>();
  m.set(id, role);
  st.roles.set(userId, m);
}

/** A monthly goal whose one target counts `source` as Priya, from September (so September and October both exist). */
function sourcedGoal(id: string, source: unknown, extra: { startValue?: number; targetValue?: number; hand?: boolean } = {}) {
  seedRow(db, "oKR", { id, organizationId: ORG, title: `Goal ${id}`, level: "INDIVIDUAL", ownerId: OWNER, repeat: "MONTHLY", startDate: new Date("2026-09-01T00:00:00Z"), createdAt: ist(2026, 8, 20) });
  seedRow(db, "keyResult", { id: `${id}-kr`, okrId: id, title: "Counted", startValue: extra.startValue ?? 0, targetValue: extra.targetValue ?? 10, currentValue: extra.startValue ?? 0, source, sourceById: CONN, createdAt: ist(2026, 8, 20) });
  if (extra.hand) seedRow(db, "keyResult", { id: `${id}-hand`, okrId: id, title: "Typed", startValue: 0, targetValue: 10, currentValue: 0, createdAt: ist(2026, 8, 20) });
}

const periodOf = (okrId: string, key: string) => rows("goalPeriod").find((p) => p.okrId === okrId && p.key === key);
const rowIn = (krId: string, okrId: string, key: string) => rows("keyResultPeriod").find((r) => r.keyResultId === krId && r.periodId === periodOf(okrId, key)?.id);

async function count(okrId: string, now: Date) {
  at(now);
  await settleGoalPeriods(ORG, [okrId], now);
  return refreshGoalSources(ORG, { okrIds: [okrId], force: true, now });
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

let errors: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.reset();
  st.roles.clear();
  st.editors = new Set([OWNER, CONN]);
  st.activity.length = 0;
  st.session = legacyTestSession(CONN, "EMPLOYEE", ORG);
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.RECURRING_GOALS = "1";
  process.env.CRON_SECRET = "test-secret";
  seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
  seedRow(db, "organization", { id: NY, name: "Acme NY", settings: { timezone: "America/New_York" } });
  seedRow(db, "user", { id: OWNER, organizationId: ORG, firstName: "Olga", lastName: "Owner" });
  seedRow(db, "user", { id: CONN, organizationId: ORG, firstName: "Priya", lastName: "Shah" });
  seedRow(db, "user", { id: VIEWER, organizationId: ORG, firstName: "Vic", lastName: "Viewer" });
  seedRow(db, "user", { id: "u-nyc", organizationId: NY, firstName: "Nia", lastName: "York" });
  seedRow(db, "board", { id: "b-ops", organizationId: ORG, name: "Ops", slug: "ops" });
  seedRow(db, "board", { id: "b-bugs", organizationId: ORG, name: "Bugs", slug: "bugs" });
  seedRow(db, "board", { id: "b-ny", organizationId: NY, name: "NY work", slug: "ny-work", schema: { fields: [{ key: "deadline", label: "Deadline", type: "DATE" }] } });
  grant(CONN, "b-ops");
  grant(CONN, "b-bugs");
  grant("u-nyc", "b-ny");
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

describe("an \"After completion\" weekly task done four times in October counts 4", () => {
  it("each completion is a row, the roll-forward keeps it, and the goal counts four", async () => {
    sourcedGoal("g-weekly", DONE_LIST);
    const task = await newTask("Weekly report", ist(2026, 10, 1, 9), { dueAt: ist(2026, 10, 2, 18) });
    await updateBoardItem(task.id, { recurRule: { freq: "WEEK", interval: 1, trigger: "ON_COMPLETE", createNew: false } }, CONN);
    for (const day of [2, 9, 16, 23]) {
      await setStatus(task.id, "DONE", ist(2026, 10, day, 17));
      const rolled = await advanceSeriesOnComplete(task.id, "DONE", CONN);
      expect(rolled.recurred).toBe(true);
      // Done and reset to open within one save.
      expect(rows("item").find((r) => r.id === task.id)?.status).toBe("TO_DO");
    }
    expect(rows("itemCompletion").filter((c) => c.itemId === task.id)).toHaveLength(4);
    await count("g-weekly", ist(2026, 10, 25));
    expect(rowIn("g-weekly-kr", "g-weekly", "2026-10-01")?.currentValue).toBe(4);
  });
});

describe("a task done in September and reordered in October counts in September only", () => {
  it("a reorder rewrites updatedAt and moves no completion", async () => {
    sourcedGoal("g-sept", DONE_LIST);
    const task = await newTask("Close the books", ist(2026, 9, 10));
    await setStatus(task.id, "DONE", ist(2026, 9, 15));
    // The reorder route rewrites updatedAt (and only position).
    at(ist(2026, 10, 10));
    await (db.prisma as unknown as { item: { update: (a: unknown) => Promise<unknown> } }).item.update({ where: { id: task.id }, data: { position: 5 } });
    expect((rows("item").find((r) => r.id === task.id)?.updatedAt as Date).getTime()).toBe(ist(2026, 10, 10).getTime());
    await count("g-sept", ist(2026, 10, 3));
    await count("g-sept", ist(2026, 10, 12));
    // September's final count at its close, then October's.
    at(ist(2026, 10, 12));
    await closeDuePeriods(ORG, ist(2026, 10, 12));
    expect(periodOf("g-sept", "2026-09-01")?.status).toBe("CLOSED");
    expect(rowIn("g-sept-kr", "g-sept", "2026-09-01")?.currentValue).toBe(1);
    expect(rowIn("g-sept-kr", "g-sept", "2026-10-01")?.currentValue).toBe(0);
  });
});

describe("reopening a task removes its completion", () => {
  it("done, reopened, done again: one completion, at the last one", async () => {
    sourcedGoal("g-reopen", DONE_LIST);
    const task = await newTask("Ship it", ist(2026, 10, 3));
    await setStatus(task.id, "DONE", ist(2026, 10, 5));
    await setStatus(task.id, "IN_PROGRESS", ist(2026, 10, 6));
    expect(rows("itemCompletion").filter((c) => c.itemId === task.id)).toHaveLength(0);
    await count("g-reopen", ist(2026, 10, 6, 13));
    expect(rowIn("g-reopen-kr", "g-reopen", "2026-10-01")?.currentValue).toBe(0);
    await setStatus(task.id, "DONE", ist(2026, 10, 7));
    const left = rows("itemCompletion").filter((c) => c.itemId === task.id);
    expect(left).toHaveLength(1);
    expect((left[0].doneAt as Date).getTime()).toBe(ist(2026, 10, 7).getTime());
    await count("g-reopen", ist(2026, 10, 8));
    expect(rowIn("g-reopen-kr", "g-reopen", "2026-10-01")?.currentValue).toBe(1);
  });

  it("a move into another List's done group records one, and a move out of done removes it", async () => {
    seedRow(db, "board", { id: "b-ship", organizationId: ORG, name: "Shipped", slug: "shipped", statuses: [{ value: "OPEN", label: "Open", group: "ACTIVE" }, { value: "SHIPPED", label: "Shipped", group: "DONE" }] });
    const task = await newTask("Moving", ist(2026, 10, 3));
    at(ist(2026, 10, 4));
    await moveBoardItem({ itemId: task.id, toBoardId: "b-ship", status: "SHIPPED", actorId: CONN });
    expect(rows("itemCompletion").filter((c) => c.itemId === task.id).map((c) => [c.status, c.boardId])).toEqual([["SHIPPED", "b-ship"]]);
    at(ist(2026, 10, 5));
    await moveBoardItem({ itemId: task.id, toBoardId: "b-ops", status: "TO_DO", actorId: CONN });
    expect(rows("itemCompletion").filter((c) => c.itemId === task.id)).toHaveLength(0);
  });

  it("a new status set that puts a status into the done group records a completion for its tasks", async () => {
    seedRow(db, "board", { id: "b-qa", organizationId: ORG, name: "QA", slug: "qa", statuses: [{ value: "OPEN", label: "Open", group: "ACTIVE" }, { value: "VERIFIED", label: "Verified", group: "ACTIVE" }] });
    at(ist(2026, 10, 3));
    const t = await createBoardItem({ organizationId: ORG, boardId: "b-qa", title: "Check", status: "VERIFIED", actorId: CONN } as Parameters<typeof createBoardItem>[0]);
    expect(rows("itemCompletion")).toHaveLength(0);
    at(ist(2026, 10, 9));
    await updateBoard("b-qa", { statuses: [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" }, { value: "VERIFIED", label: "Verified", color: "#090", group: "DONE" }] });
    expect(rows("itemCompletion").map((c) => [c.itemId, c.status, (c.doneAt as Date).getTime()])).toEqual([[t.id, "VERIFIED", ist(2026, 10, 9).getTime()]]);
  });
});

describe("a task created straight into Done, duplicated, and restored from Trash each count once", () => {
  it("one completion each: the create, the copy (its source's time), the restore (no second)", async () => {
    sourcedGoal("g-once", DONE_LIST);
    const task = await newTask("Born done", ist(2026, 10, 4), { status: "DONE" });
    expect(rows("itemCompletion").filter((c) => c.itemId === task.id)).toHaveLength(1);
    await count("g-once", ist(2026, 10, 5));
    expect(rowIn("g-once-kr", "g-once", "2026-10-01")?.currentValue).toBe(1);

    // The task Duplicate: the copy takes the original's completion (4 October), not one at 8 October.
    at(ist(2026, 10, 8));
    const dup = await call(duplicateRoute.POST, `/api/items/${task.id}/duplicate`, { method: "POST", params: { id: task.id } });
    expect(dup.status).toBeLessThan(300);
    const copies = rows("item").filter((r) => r.id !== task.id && r.boardId === "b-ops");
    expect(copies).toHaveLength(1);
    const copyRows = rows("itemCompletion").filter((c) => c.itemId === copies[0].id);
    expect(copyRows.map((c) => (c.doneAt as Date).getTime())).toEqual([ist(2026, 10, 4).getTime()]);
    await count("g-once", ist(2026, 10, 8, 13));
    expect(rowIn("g-once-kr", "g-once", "2026-10-01")?.currentValue).toBe(2);

    // The List duplicate copies each done task's latest completion onto its copy.
    at(ist(2026, 10, 8, 14));
    const copy = await duplicateBoard("b-ops", CONN, ORG, { includeTasks: true });
    const inCopy = rows("item").filter((r) => r.boardId === copy.id).map((r) => r.id);
    expect(inCopy).toHaveLength(2);
    expect(rows("itemCompletion").filter((c) => inCopy.includes(String(c.itemId))).map((c) => [c.boardId, (c.doneAt as Date).getTime()]))
      .toEqual([[copy.id, ist(2026, 10, 4).getTime()], [copy.id, ist(2026, 10, 4).getTime()]]);

    // Trash: the snapshot keeps its completion; the nightly repair deletes the
    // orphan meanwhile; the restore brings it back once.
    at(ist(2026, 10, 9));
    expect(await moveToTrash("item", task.id, { organizationId: ORG, userId: CONN })).toBe(true);
    await count("g-once", ist(2026, 10, 9, 13));
    expect(rowIn("g-once-kr", "g-once", "2026-10-01")?.currentValue).toBe(1);
    at(new Date("2026-10-09T20:35:00Z"));
    const repaired = await repairItemCompletions(new Date("2026-10-09T20:35:00Z"));
    expect(repaired.removed).toBe(1);
    expect(rows("itemCompletion").filter((c) => c.itemId === task.id)).toHaveLength(0);
    at(ist(2026, 10, 10));
    const trashRow = rows("trashItem")[0];
    await restoreFromTrash({ id: String(trashRow.id), entityType: "item", snapshot: trashRow.snapshot });
    expect(rows("itemCompletion").filter((c) => c.itemId === task.id)).toHaveLength(1);
    await count("g-once", ist(2026, 10, 10, 13));
    expect(rowIn("g-once-kr", "g-once", "2026-10-01")?.currentValue).toBe(2);
  });
});

describe("a task due 1 November counts in November in Kolkata and New York, whichever way it was written", () => {
  async function counts(orgId: string, connector: string, boardId: string, by: "due" | "field", settings: typeof KOLKATA) {
    const conn = await connectorFor(orgId, connector);
    if (!conn.ok) throw new Error(conn.reason);
    const source = { kind: "list" as const, listIds: [boardId], spaceId: null, metric: { op: "count" as const }, filter: { connector: "AND" as const, rules: [], hideDone: false }, countedBy: by, dateFieldKey: by === "field" ? "deadline" : null };
    const out: number[] = [];
    for (const month of [ist(2026, 10, 15), ist(2026, 11, 15)]) {
      const r = await countListSource({ orgId, source, connector: conn.connector, window: periodWindow(periodFor("MONTHLY", month, settings), settings), zone: settings.timezone, now: ist(2026, 11, 20) });
      out.push(r.kind === "counted" ? r.value ?? -1 : -1);
    }
    return out;
  }

  it("Kolkata: the picker's IST midnight, the Gantt's UTC midnight, and the Date field's day or instant", async () => {
    db.rows.board.find((b) => b.id === "b-ops")!.schema = { fields: [{ key: "deadline", label: "Deadline", type: "DATE" }] };
    at(ist(2026, 10, 20));
    // Due date: the picker writes midnight where the person is; the Gantt UTC midnight.
    seedRow(db, "item", { id: "k-picker", organizationId: ORG, boardId: "b-ops", title: "Picker", dueAt: new Date("2026-10-31T18:30:00.000Z"), metadata: { deadline: "2026-11-01" } });
    seedRow(db, "item", { id: "k-gantt", organizationId: ORG, boardId: "b-ops", title: "Gantt", dueAt: new Date("2026-11-01T00:00:00.000Z"), metadata: { deadline: "2026-11-01T00:00:00.000Z" } });
    seedRow(db, "item", { id: "k-field-ist", organizationId: ORG, boardId: "b-ops", title: "Field", dueAt: new Date("2026-11-01T06:00:00.000Z"), metadata: { deadline: "2026-10-31T18:30:00.000Z" } });
    // A task due 31 October stays in October either way.
    seedRow(db, "item", { id: "k-oct", organizationId: ORG, boardId: "b-ops", title: "Oct", dueAt: new Date("2026-10-31T00:00:00.000Z"), metadata: { deadline: "2026-10-31" } });
    expect(await counts(ORG, CONN, "b-ops", "due", KOLKATA)).toEqual([1, 3]);
    expect(await counts(ORG, CONN, "b-ops", "field", KOLKATA)).toEqual([1, 3]);
  });

  it("New York: the picker's New York midnight, the Gantt's UTC midnight, and the Date field's day", async () => {
    at(ist(2026, 10, 20));
    seedRow(db, "item", { id: "n-picker", organizationId: NY, boardId: "b-ny", title: "Picker", dueAt: new Date("2026-11-01T04:00:00.000Z"), metadata: { deadline: "2026-11-01T04:00:00.000Z" } });
    seedRow(db, "item", { id: "n-gantt", organizationId: NY, boardId: "b-ny", title: "Gantt", dueAt: new Date("2026-11-01T00:00:00.000Z"), metadata: { deadline: "2026-11-01" } });
    seedRow(db, "item", { id: "n-oct", organizationId: NY, boardId: "b-ny", title: "Oct", dueAt: new Date("2026-10-31T23:00:00.000Z"), metadata: { deadline: "2026-10-31" } });
    expect(await counts(NY, "u-nyc", "b-ny", "due", NEW_YORK)).toEqual([1, 2]);
    expect(await counts(NY, "u-nyc", "b-ny", "field", NEW_YORK)).toEqual([1, 2]);
  });
});

describe("a deactivated connector pauses the source with its message, and so does one who lost the List", () => {
  it("deactivated: the number stands, the words name them, one Inbox row, no repeat", async () => {
    sourcedGoal("g-left", DONE_LIST);
    const task = await newTask("Done", ist(2026, 10, 2), { status: "DONE" });
    void task;
    await count("g-left", ist(2026, 10, 3));
    expect(rowIn("g-left-kr", "g-left", "2026-10-01")?.currentValue).toBe(1);
    db.rows.user.find((u) => u.id === CONN)!.status = "INACTIVE";
    await newTask("Done later", ist(2026, 10, 4), { status: "DONE" });
    await count("g-left", ist(2026, 10, 5));
    const row = rowIn("g-left-kr", "g-left", "2026-10-01")!;
    expect(row.currentValue).toBe(1);
    expect(row.pausedReason).toBe("Priya no longer works here. Reconnect it.");
    expect((row.pausedSince as Date).getTime()).toBe(ist(2026, 10, 5).getTime());
    expect(rows("keyResult").find((k) => k.id === "g-left-kr")?.sourcePausedReason).toBe("Priya no longer works here. Reconnect it.");
    const inbox = () => rows("notification").filter((n) => n.type === "goal_source_paused");
    // To the owner (the connector has left, so no row for them).
    expect(inbox().map((n) => [n.userId, n.title, n.message, n.link])).toEqual([[OWNER, "Goal g-left: Counted stopped counting.", "Priya no longer works here. Reconnect it.", "/okrs/g-left"]]);
    await count("g-left", ist(2026, 10, 6));
    expect(inbox()).toHaveLength(1);
  });

  it("lost the List: paused with its words, then counting again once the access is back", async () => {
    sourcedGoal("g-lost", DONE_LIST);
    await newTask("Done", ist(2026, 10, 2), { status: "DONE" });
    await count("g-lost", ist(2026, 10, 3));
    st.roles.get(CONN)!.delete("b-ops");
    await newTask("Done again", ist(2026, 10, 4), { status: "DONE" });
    await count("g-lost", ist(2026, 10, 5));
    expect(rowIn("g-lost-kr", "g-lost", "2026-10-01")).toMatchObject({ currentValue: 1, pausedReason: "Priya can no longer open a List it counts. Reconnect it." });
    expect(rows("notification").filter((n) => n.type === "goal_source_paused").map((n) => n.userId).sort()).toEqual([OWNER, CONN].sort());
    grant(CONN, "b-ops");
    await count("g-lost", ist(2026, 10, 6));
    expect(rowIn("g-lost-kr", "g-lost", "2026-10-01")).toMatchObject({ currentValue: 2, pausedReason: null, pausedSince: null });
    expect(rows("keyResult").find((k) => k.id === "g-lost-kr")?.sourcePausedReason).toBeNull();
  });
});

describe("a viewer without the List sees the number and \"From a private List\", never the name", () => {
  it("the page's source facts name the List only for who can open it, and the number is the same for both", async () => {
    sourcedGoal("g-private", DONE_LIST);
    await newTask("Done", ist(2026, 10, 2), { status: "DONE" });
    await count("g-private", ist(2026, 10, 3));
    const krs = rows("keyResult").filter((k) => k.okrId === "g-private") as Array<{ id: string; source: unknown; sourceById: string | null; sourcePausedReason: string | null }>;
    const forViewer = (await describeTargetSources(ORG, VIEWER, krs)).get("g-private-kr")!;
    expect(forViewer).toEqual({ label: PRIVATE_LIST_WORDS, private: true, href: null, connectorName: "Priya Shah", paused: null, settings: null });
    expect(JSON.stringify(forViewer)).not.toMatch(/Ops|b-ops|ops/);
    const forConnector = (await describeTargetSources(ORG, CONN, krs)).get("g-private-kr")!;
    expect(forConnector).toMatchObject({ label: "From Ops", private: false, href: "/boards/ops" });
    // The number is the period's, one for everyone (the rollup the page reads).
    at(ist(2026, 10, 3, 13));
    const ctx = await computeGoalRollups(ORG, ist(2026, 10, 3, 13));
    const oct = (ctx.periods.get("g-private") ?? []).find((p) => p.key === "2026-10-01")!;
    expect(oct.rows.find((r) => r.keyResultId === "g-private-kr")?.currentValue).toBe(1);
  });
});

describe("a count over the cap pauses rather than truncating", () => {
  it("20,001 tasks counted Right now: paused with its words, and the number stays", async () => {
    expect(LIST_SOURCE_CAP).toBe(20_000);
    sourcedGoal("g-cap", { ...DONE_LIST, countedBy: "now" });
    await count("g-cap", ist(2026, 10, 2));
    expect(rowIn("g-cap-kr", "g-cap", "2026-10-01")?.currentValue).toBe(0);
    const t = ist(2026, 10, 3);
    const items = db.rows.item ?? (db.rows.item = []);
    for (let i = 0; i < LIST_SOURCE_CAP + 1; i++) {
      items.push({ id: `cap-${i}`, organizationId: ORG, boardId: "b-ops", title: `T${i}`, itemType: "studio-item", status: "TO_DO", ownerId: null, assigneeIds: [], metadata: {}, parentItemId: null, archivedAt: null, dueAt: null, startAt: null, priority: null, itemTypeId: null, createdAt: t, updatedAt: t });
    }
    await count("g-cap", ist(2026, 10, 4));
    expect(rowIn("g-cap-kr", "g-cap", "2026-10-01")).toMatchObject({ currentValue: 0, pausedReason: "Too many tasks to count. Narrow the filter." });
  }, 60_000);
});

describe("a Right now count freezes at the first run after the end, and a bug closed on 2 November leaves October alone", () => {
  it("the cron's first run after October stores October's 5; November counts the closed bug; October closes at 5", async () => {
    const OPEN_BUGS = { kind: "list", listIds: ["b-bugs"], metric: { op: "count" }, filter: { connector: "AND", rules: [], hideDone: true }, countedBy: "now" };
    sourcedGoal("g-bugs", OPEN_BUGS, { startValue: 30, targetValue: 10 });
    at(ist(2026, 10, 20));
    for (let i = 0; i < 5; i++) await createBoardItem({ organizationId: ORG, boardId: "b-bugs", title: `Bug ${i}`, actorId: CONN } as Parameters<typeof createBoardItem>[0]);
    await count("g-bugs", ist(2026, 10, 21));
    expect(rowIn("g-bugs-kr", "g-bugs", "2026-10-01")?.currentValue).toBe(5);
    // The first run after October's end (00:05 IST, 1 November).
    at(ist(2026, 11, 1, 0, 5));
    const run = await call(cronRoute.POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
    expect(run.status).toBe(200);
    const oct = rowIn("g-bugs-kr", "g-bugs", "2026-10-01")!;
    expect(oct.currentValue).toBe(5);
    expect((oct.frozenAt as Date).getTime()).toBe(ist(2026, 11, 1, 0, 5).getTime());
    // A bug closed on 2 November.
    const bug = rows("item").find((r) => r.boardId === "b-bugs")!;
    await setStatus(String(bug.id), "DONE", ist(2026, 11, 2));
    at(ist(2026, 11, 2, 12));
    await call(cronRoute.POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
    expect(rowIn("g-bugs-kr", "g-bugs", "2026-11-01")?.currentValue).toBe(4);
    expect(rowIn("g-bugs-kr", "g-bugs", "2026-10-01")?.currentValue).toBe(5);
    // October's close (after its grace) keeps 5: a Right now count gets no final recount.
    at(ist(2026, 11, 6, 0, 5));
    await call(cronRoute.POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
    expect(periodOf("g-bugs", "2026-10-01")?.status).toBe("CLOSED");
    expect(rowIn("g-bugs-kr", "g-bugs", "2026-10-01")?.currentValue).toBe(5);
  });
});

describe("a source paused for 20 days of October is left out of October", () => {
  async function october(pauseDay: number, id: string) {
    sourcedGoal(id, DONE_LIST, { hand: true });
    at(ist(2026, 10, 2));
    await settleGoalPeriods(ORG, [id], ist(2026, 10, 2));
    await checkInRepeating({ orgId: ORG, okrId: id, keyResultId: `${id}-hand`, value: 10, note: null, userId: OWNER, now: ist(2026, 10, 3) });
    await count(id, ist(2026, 10, 4));
    st.roles.get(CONN)!.delete("b-ops");
    await count(id, ist(2026, 10, pauseDay));
    at(ist(2026, 11, 6, 0, 5));
    await closeDuePeriods(ORG, ist(2026, 11, 6, 0, 5));
    grant(CONN, "b-ops");
    return periodOf(id, "2026-10-01")!;
  }

  it("paused from 11 October (20 days): only the hand-checked target counts, 100%", async () => {
    const p = await october(11, "g-long");
    expect(p).toMatchObject({ status: "CLOSED", progress: 100, result: "HIT" });
  });

  it("paused from 21 October (10 days): the paused target still counts at its last number, 50%", async () => {
    const p = await october(21, "g-short");
    expect(p).toMatchObject({ status: "CLOSED", progress: 50 });
  });

  it("and the live number leaves it out once it has been paused more than half the period", async () => {
    sourcedGoal("g-live", DONE_LIST, { hand: true });
    at(ist(2026, 10, 2));
    await settleGoalPeriods(ORG, ["g-live"], ist(2026, 10, 2));
    await checkInRepeating({ orgId: ORG, okrId: "g-live", keyResultId: "g-live-hand", value: 10, note: null, userId: OWNER, now: ist(2026, 10, 3) });
    st.roles.get(CONN)!.delete("b-ops");
    await count("g-live", ist(2026, 10, 4));
    const live = async (t: Date) => (await computeGoalRollups(ORG, t)).rollups.get("g-live")?.progress;
    expect(await live(ist(2026, 10, 10))).toBe(50);
    expect(await live(ist(2026, 10, 25))).toBe(100);
  });
});

describe("the doors: connecting a List source", () => {
  it("is refused while RECURRING_GOALS is off, refused for a List the caller cannot open, and counts at once otherwise", async () => {
    sourcedGoal("g-doors", null);
    await newTask("Done", ist(2026, 10, 2), { status: "DONE" });
    at(ist(2026, 10, 3));
    const body = { title: "From Ops", startValue: 0, targetValue: 10, source: DONE_LIST };
    process.env.RECURRING_GOALS = "0";
    expect(await call(krsRoute.POST, "/api/okrs/g-doors/key-results", { method: "POST", params: { id: "g-doors" }, body })).toMatchObject({ status: 400, body: { error: "Repeating goals are not turned on." } });
    process.env.RECURRING_GOALS = "1";
    st.session = legacyTestSession(OWNER, "EMPLOYEE", ORG);
    expect(await call(krsRoute.POST, "/api/okrs/g-doors/key-results", { method: "POST", params: { id: "g-doors" }, body })).toMatchObject({ status: 400, body: { error: "You can only count from Lists you can open." } });
    st.session = legacyTestSession(CONN, "EMPLOYEE", ORG);
    const ok = await call(krsRoute.POST, "/api/okrs/g-doors/key-results", { method: "POST", params: { id: "g-doors" }, body });
    expect(ok.status).toBe(201);
    const kr = rows("keyResult").find((k) => k.okrId === "g-doors" && k.title === "From Ops")!;
    expect(kr.sourceById).toBe(CONN);
    expect(rows("keyResultPeriod").find((r) => r.keyResultId === kr.id)?.currentValue).toBe(1);
  });

  it("the preview counts as the person editing, and says when the source is not open to the whole workspace", async () => {
    sourcedGoal("g-preview", null);
    await newTask("Done", ist(2026, 10, 2), { status: "DONE" });
    at(ist(2026, 10, 3));
    await settleGoalPeriods(ORG, ["g-preview"], ist(2026, 10, 3));
    const r = await call(previewRoute.POST, "/api/okrs/g-preview/key-results/preview", { method: "POST", params: { id: "g-preview" }, body: { source: DONE_LIST } });
    expect(r).toMatchObject({ status: 200, body: { value: 1, paused: null, openToWorkspace: false } });
    grant("workspace-member", "b-ops");
    expect((await call(previewRoute.POST, "/api/okrs/g-preview/key-results/preview", { method: "POST", params: { id: "g-preview" }, body: { source: DONE_LIST } })).body.openToWorkspace).toBe(true);
    process.env.RECURRING_GOALS = "0";
    expect((await call(previewRoute.POST, "/api/okrs/g-preview/key-results/preview", { method: "POST", params: { id: "g-preview" }, body: { source: DONE_LIST } })).status).toBe(400);
  });

  it("Refresh needs Can edit or a contributor, and counts as the connector, never as the caller", async () => {
    sourcedGoal("g-refresh", DONE_LIST);
    await newTask("Done", ist(2026, 10, 2), { status: "DONE" });
    await count("g-refresh", ist(2026, 10, 3));
    await newTask("Done 2", ist(2026, 10, 4), { status: "DONE" });
    at(ist(2026, 10, 4, 13));
    st.session = legacyTestSession(VIEWER, "EMPLOYEE", ORG);
    expect((await call(refreshRoute.POST, "/api/okrs/g-refresh/refresh", { method: "POST", params: { id: "g-refresh" }, body: { keyResultId: "g-refresh-kr" } })).status).toBe(403);
    // The owner may refresh; the count is Priya's (the owner cannot open Ops).
    // Two rows: October, and September still in its grace (a windowed count
    // refreshes until the close).
    st.session = legacyTestSession(OWNER, "EMPLOYEE", ORG);
    const r = await call(refreshRoute.POST, "/api/okrs/g-refresh/refresh", { method: "POST", params: { id: "g-refresh" }, body: { keyResultId: "g-refresh-kr" } });
    expect(r).toMatchObject({ status: 200, body: { counted: 2, paused: 0, changed: true } });
    expect(rowIn("g-refresh-kr", "g-refresh", "2026-10-01")?.currentValue).toBe(2);
  });
});

describe("the nightly repair", () => {
  it("adds a row for a task that entered done with no completion (a missed writer), at its activity's time, and never for old done work", async () => {
    at(ist(2026, 10, 9));
    // A task some new path put into Done without a completion: its STATUS_CHANGED shows it.
    seedRow(db, "item", { id: "missed", organizationId: ORG, boardId: "b-ops", title: "Missed", status: "DONE" });
    seedRow(db, "itemActivity", { id: "act-1", organizationId: ORG, entityType: "BOARD_ITEM", entityId: "missed", action: "STATUS_CHANGED", meta: { from: "TO_DO", to: "DONE" }, createdAt: ist(2026, 10, 9, 10) });
    // Done long ago, with no activity in the last two days: no row.
    seedRow(db, "item", { id: "old", organizationId: ORG, boardId: "b-ops", title: "Old", status: "DONE" });
    seedRow(db, "itemActivity", { id: "act-0", organizationId: ORG, entityType: "BOARD_ITEM", entityId: "old", action: "STATUS_CHANGED", meta: { from: "TO_DO", to: "DONE" }, createdAt: ist(2026, 3, 1) });
    const now = new Date("2026-10-09T20:35:00Z");
    at(now);
    expect(await repairItemCompletions(now)).toEqual({ added: 1, removed: 0 });
    expect(rows("itemCompletion").map((c) => [c.itemId, (c.doneAt as Date).getTime()])).toEqual([["missed", ist(2026, 10, 9, 10).getTime()]]);
    // Run again: nothing more.
    expect(await repairItemCompletions(now)).toEqual({ added: 0, removed: 0 });
  });
});

describe("a query-count test: 2,000 period openings in one batch run a fixed number of queries and one org rollup", () => {
  /** n monthly goals, each with a target counted from a List and one typed by hand, opening November at once. */
  async function openNovember(n: number) {
    for (let i = 0; i < n; i++) {
      const id = `q-${String(i).padStart(5, "0")}`;
      seedRow(db, "oKR", { id, organizationId: ORG, title: id, level: "INDIVIDUAL", ownerId: OWNER, repeat: "MONTHLY", startDate: new Date("2026-11-01T00:00:00Z"), createdAt: ist(2026, 10, 20) });
      seedRow(db, "keyResult", { id: `${id}-list`, okrId: id, title: "Counted", startValue: 0, targetValue: 10, currentValue: 0, source: DONE_LIST, sourceById: CONN, createdAt: ist(2026, 10, 20) });
      seedRow(db, "keyResult", { id: `${id}-hand`, okrId: id, title: "Typed", startValue: 0, targetValue: 10, currentValue: 0, createdAt: ist(2026, 10, 20) });
    }
    const touched: string[] = [];
    db.beforeStatement = (what) => touched.push(what);
    vi.mocked(persistGoalRollupChains).mockClear();
    vi.mocked(computeGoalRollups).mockClear();
    at(ist(2026, 11, 2));
    const before = db.stats.statements;
    const r = await settleGoalPeriods(ORG, null, ist(2026, 11, 2));
    db.beforeStatement = null;
    expect(r.opened).toBe(n);
    return {
      statements: db.stats.statements - before,
      rollups: vi.mocked(persistGoalRollupChains).mock.calls.length + vi.mocked(computeGoalRollups).mock.calls.length,
      sourceReads: touched.filter((w) => /^(item|itemCompletion|board|space)\./.test(w)).length,
    };
  }

  it("the statements grow by a fixed handful per chunk of goals, never one per goal; one org rollup; no source is counted at opening", async () => {
    const small = await openNovember(600);
    db.reset();
    seedRow(db, "organization", { id: ORG, name: "Acme", settings: { timezone: "Asia/Kolkata" } });
    const large = await openNovember(2000);
    expect(rows("keyResultPeriod")).toHaveLength(4000);
    // Opening counts nothing: a List-sourced row opens at its start, and the cron or the page counts it.
    expect(rows("keyResultPeriod").filter((r) => String(r.keyResultId).endsWith("-list")).every((r) => r.currentValue === 0 && r.refreshedAt == null)).toBe(true);
    expect(large.sourceReads).toBe(0);
    expect(small.sourceReads).toBe(0);
    // ONE org rollup for the whole batch (persistGoalRollupChains computes it once).
    expect(large.rollups).toBe(1);
    expect(small.rollups).toBe(1);
    // A fixed handful per 150 goals: 2,000 goals are 10 chunks more than 600.
    // Measured: 47 statements for 600 goals, 131 for 2,000 (about 8 per chunk of 150).
    expect(large.statements).toBeLessThan(220);
    expect(large.statements - small.statements).toBeLessThanOrEqual(10 * 12);
  }, 120_000);
});

describe("the dashboard row loader, extracted from computeWidget, gives dashboards the same results", () => {
  it("a stat (filtered count and sum), a chart and a list card over the same tasks read as before", async () => {
    db.rows.board.find((b) => b.id === "b-ops")!.schema = { fields: [{ key: "points", label: "Points", type: "NUMBER" }] };
    at(ist(2026, 10, 10));
    seedRow(db, "item", { id: "w1", organizationId: ORG, boardId: "b-ops", title: "Alpha", status: "DONE", metadata: { points: 3 }, updatedAt: ist(2026, 10, 1) });
    seedRow(db, "item", { id: "w2", organizationId: ORG, boardId: "b-ops", title: "Beta", status: "TO_DO", metadata: { points: 5 }, updatedAt: ist(2026, 10, 2) });
    seedRow(db, "item", { id: "w3", organizationId: ORG, boardId: "b-ops", title: "Gamma", status: "TO_DO", metadata: { points: "x" }, updatedAt: ist(2026, 10, 3) });
    const conn = await connectorFor(ORG, CONN);
    if (!conn.ok) throw new Error(conn.reason);
    const r = { ctx: conn.connector.link, viewer: conn.connector.viewer, zone: "Asia/Kolkata", now: ist(2026, 10, 10) };
    const source = { kind: "lists", listIds: ["b-ops"] };
    const layout = { x: 0, y: 0, w: 4, h: 4 };
    const [count, sum, chart, listCard] = parseWidgets([
      { id: "s1", kind: "stat", title: "Open", source, filter: { connector: "AND", rules: [{ field: "status", operator: "is", value: "TO_DO" }], hideDone: false }, metric: { op: "count" }, scope: "total", layout },
      { id: "s2", kind: "stat", title: "Points", source, filter: { connector: "AND", rules: [], hideDone: false }, metric: { op: "sum", fieldKey: "points" }, scope: "open", layout },
      { id: "c1", kind: "chart", title: "By status", source, filter: { connector: "AND", rules: [], hideDone: false }, groupBy: "status", display: "bar", layout },
      { id: "l1", kind: "list", title: "Tasks", source, filter: { connector: "AND", rules: [], hideDone: true }, sort: "updated", limit: 10, layout },
    ]);
    expect(await computeWidget(count, r)).toEqual({ kind: "stat", value: 2, metric: { op: "count" }, scope: "total" });
    expect(await computeWidget(sum, r)).toEqual({ kind: "stat", value: 5, metric: { op: "sum", fieldKey: "points" }, scope: "open" });
    expect(await computeWidget(chart, r)).toEqual({
      kind: "chart", groupBy: "status", display: "bar",
      buckets: [{ key: "TO_DO", count: 2, label: "To Do", color: "#98A2B3" }, { key: "DONE", count: 1, label: "Done", color: "#15803D" }],
    });
    const listed = await computeWidget(listCard, r);
    expect(listed).toMatchObject({ kind: "list", total: 2 });
    expect((listed as { rows: Array<{ id: string; list: { name: string }; done: boolean }> }).rows.map((x) => [x.id, x.list.name, x.done])).toEqual([["w3", "Ops", false], ["w2", "Ops", false]]);
  });
});
