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
  /** Tasks linked into the counted Lists (the step 4 review L15): the scope resolveListScope answers, rewritten. */
  linked: null as null | ((scope: { where: unknown; listsByItem: Map<string, string[]> }) => unknown),
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
    resolveListScope: async (...a: unknown[]) => {
      const scope = (await real.resolveListScope(...a)) as { where: unknown; listsByItem: Map<string, string[]> };
      return st.linked ? st.linked(scope) : scope;
    },
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
// The List engine's refresh, watched (the close's final count, the cron's order): the real one.
vi.mock("@/lib/goals/goal-source.server", async (orig) => {
  const real = (await orig()) as Record<string, (...a: unknown[]) => unknown>;
  return { ...real, refreshGoalSources: vi.fn(real.refreshGoalSources) };
});

import { goalDb as db, seedRow } from "./goal-test-db";
import { createBoardItem, moveBoardItem, restoreBoardItem, updateBoardItem } from "@/lib/board-items";
import { duplicateBoard, updateBoard } from "@/lib/board";
import { advanceSeriesOnComplete } from "@/lib/recurring-tasks";
import { moveToTrash, restoreFromTrash } from "@/lib/trash";
import { repairItemCompletions, restoreCompletions } from "@/lib/item-completions";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { checkInRepeating, closeDuePeriods, settleGoalPeriods } from "./goal-periods.server";
import { countListSource, connectorFor, describeTargetSources, handOverGoalSources, refreshGoalSources } from "./goal-source.server";
import { goalDatesWindow, LIST_SOURCE_CAP, PRIVATE_LIST_WORDS, periodWindow } from "./goal-source";
import { periodFor, periodSettingsOf } from "./goal-period";
import { computeGoalRollups, persistGoalRollupChains } from "@/lib/alignment";
import { computeWidget } from "@/lib/dashboards/widget-data";
import { parseWidgets } from "@/lib/dashboards/widgets";
import * as duplicateRoute from "@/app/api/items/[id]/duplicate/route";
import * as cronRoute from "@/app/api/cron/goal-periods/route";
import * as krsRoute from "@/app/api/okrs/[id]/key-results/route";
import * as previewRoute from "@/app/api/okrs/[id]/key-results/preview/route";
import * as refreshRoute from "@/app/api/okrs/[id]/refresh/route";
import * as krRoute from "@/app/api/okrs/[id]/key-results/[krId]/route";

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
  st.linked = null;
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
    // An editor who cannot open it reads who connected it (C9); anyone else not even that.
    const forEditor = (await describeTargetSources(ORG, VIEWER, krs, { canEdit: true })).get("g-private-kr")!;
    expect(forEditor).toEqual({ label: PRIVATE_LIST_WORDS, private: true, href: null, connectorName: "Priya Shah", paused: null, settings: null });
    expect(JSON.stringify(forEditor)).not.toMatch(/Ops|b-ops|ops/);
    const forViewer = (await describeTargetSources(ORG, VIEWER, krs)).get("g-private-kr")!;
    expect(forViewer).toEqual({ label: PRIVATE_LIST_WORDS, private: true, href: null, connectorName: null, paused: null, settings: null });
    const forConnector = (await describeTargetSources(ORG, CONN, krs, { canEdit: true })).get("g-private-kr")!;
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

/* ───────────────────────── The step 4 review (1 high, 3 medium, 16 low) ───────────────────────── */

const OPEN_BUGS = { kind: "list", listIds: ["b-bugs"], metric: { op: "count" }, filter: { connector: "AND", rules: [], hideDone: true }, countedBy: "now" };
const SHIP_STATUSES = [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" as const }, { value: "SHIPPED", label: "Shipped", color: "#090", group: "DONE" as const }];
const completionsOf = (itemId: string) => rows("itemCompletion").filter((c) => c.itemId === itemId);
const runCron = async (t: Date) => {
  at(t);
  return call(cronRoute.POST, "/api/cron/goal-periods", { method: "POST", headers: { "x-cron-secret": "test-secret" } });
};
/** Every row count an item.findMany answered while `fn` ran (the rows a count loaded). */
async function itemRowsLoaded(fn: () => Promise<unknown>): Promise<number[]> {
  const model = (db.prisma as unknown as { item: { findMany: (a: unknown) => Promise<unknown[]> } }).item;
  const real = model.findMany;
  const loaded: number[] = [];
  model.findMany = async (a: unknown) => {
    const r = await real(a);
    loaded.push(r.length);
    return r;
  };
  try {
    await fn();
  } finally {
    model.findMany = real;
  }
  return loaded;
}
/** A one-time goal from 1 to 31 October whose one target counts `source` as Priya. */
function oneTimeGoal(id: string, source: unknown) {
  seedRow(db, "oKR", { id, organizationId: ORG, title: `Goal ${id}`, level: "INDIVIDUAL", ownerId: OWNER, startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z"), createdAt: ist(2026, 9, 20) });
  seedRow(db, "keyResult", { id: `${id}-kr`, okrId: id, title: "Counted", startValue: 0, targetValue: 10, currentValue: 0, source, sourceById: CONN, createdAt: ist(2026, 9, 20) });
}

describe("step 4 review M1: a close counts each level's sources once, scoped to it, with no rollup of its own", () => {
  it("four goals closing September and October: one final count for the level, its late completions in, one org rollup", async () => {
    const ids = ["g-c1", "g-c2", "g-c3", "g-c4"];
    for (const id of ids) sourcedGoal(id, DONE_LIST);
    await newTask("Early", ist(2026, 10, 20), { status: "DONE" });
    for (const id of ids) await count(id, ist(2026, 10, 25));
    expect(rowIn("g-c1-kr", "g-c1", "2026-10-01")?.currentValue).toBe(1);
    // Done after the last count: only the close's final count can see them.
    await newTask("Late 1", ist(2026, 10, 31, 20), { status: "DONE" });
    await newTask("Late 2", ist(2026, 10, 31, 21), { status: "DONE" });
    vi.mocked(refreshGoalSources).mockClear();
    vi.mocked(persistGoalRollupChains).mockClear();
    at(ist(2026, 11, 6, 0, 5));
    const r = await closeDuePeriods(ORG, ist(2026, 11, 6, 0, 5));
    expect(r).toMatchObject({ closed: 8, failed: 0 });
    for (const id of ids) {
      expect(periodOf(id, "2026-10-01")).toMatchObject({ status: "CLOSED", progress: 30 });
      expect(rowIn(`${id}-kr`, id, "2026-10-01")?.currentValue).toBe(3);
    }
    // ONE count for the level's eight periods, scoped to its goals, and no rollup of its own.
    expect(vi.mocked(refreshGoalSources).mock.calls).toHaveLength(1);
    expect(vi.mocked(refreshGoalSources).mock.calls[0][1]).toMatchObject({ okrIds: ids, rollup: false, windowedOnly: true, force: true });
    expect(vi.mocked(persistGoalRollupChains).mock.calls).toHaveLength(1);
  });
});

describe("step 4 review M2: a status set change judges both ways, and an archived task too", () => {
  it("a status leaving the done group takes its tasks' latest completion; back again, one completion, never a second", async () => {
    const set = (verified: "ACTIVE" | "DONE") => [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" as const }, { value: "VERIFIED", label: "Verified", color: "#090", group: verified }];
    seedRow(db, "board", { id: "b-qa", organizationId: ORG, name: "QA", slug: "qa", statuses: set("DONE") });
    at(ist(2026, 10, 3));
    const t = await createBoardItem({ organizationId: ORG, boardId: "b-qa", title: "Check", status: "VERIFIED", actorId: CONN } as Parameters<typeof createBoardItem>[0]);
    expect(completionsOf(t.id)).toHaveLength(1);
    at(ist(2026, 10, 9));
    await updateBoard("b-qa", { statuses: set("ACTIVE") });
    expect(completionsOf(t.id)).toHaveLength(0);
    at(ist(2026, 10, 12));
    await updateBoard("b-qa", { statuses: set("DONE") });
    expect(completionsOf(t.id).map((c) => (c.doneAt as Date).getTime())).toEqual([ist(2026, 10, 12).getTime()]);
  });

  it("an archived task's status entering done records its completion, so it comes back counted", async () => {
    seedRow(db, "board", { id: "b-qa", organizationId: ORG, name: "QA", slug: "qa", statuses: [{ value: "OPEN", label: "Open", group: "ACTIVE" }, { value: "VERIFIED", label: "Verified", group: "ACTIVE" }] });
    at(ist(2026, 10, 3));
    const t = await createBoardItem({ organizationId: ORG, boardId: "b-qa", title: "Shelved", status: "VERIFIED", actorId: CONN } as Parameters<typeof createBoardItem>[0]);
    rows("item").find((r) => r.id === t.id)!.archivedAt = ist(2026, 10, 4);
    at(ist(2026, 10, 9));
    await updateBoard("b-qa", { statuses: [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" }, { value: "VERIFIED", label: "Verified", color: "#090", group: "DONE" }] });
    expect(completionsOf(t.id).map((c) => (c.doneAt as Date).getTime())).toEqual([ist(2026, 10, 9).getTime()]);
  });

  it("unarchived in a done status with no completion: one at its last entry into done (the backfill's rule), none with no such activity", async () => {
    at(ist(2026, 10, 9));
    // Done in September, archived before completions were written.
    seedRow(db, "item", { id: "old-done", organizationId: ORG, boardId: "b-ops", title: "Old", status: "DONE", archivedAt: ist(2026, 9, 20) });
    seedRow(db, "itemActivity", { id: "a-old", organizationId: ORG, entityType: "BOARD_ITEM", entityId: "old-done", action: "STATUS_CHANGED", meta: { from: "TO_DO", to: "DONE" }, createdAt: ist(2026, 9, 15) });
    seedRow(db, "item", { id: "no-trace", organizationId: ORG, boardId: "b-ops", title: "No trace", status: "DONE", archivedAt: ist(2026, 9, 20) });
    // Archived while done, with its completion: nothing more.
    seedRow(db, "item", { id: "kept", organizationId: ORG, boardId: "b-ops", title: "Kept", status: "DONE", archivedAt: ist(2026, 9, 20) });
    seedRow(db, "itemActivity", { id: "a-kept", organizationId: ORG, entityType: "BOARD_ITEM", entityId: "kept", action: "STATUS_CHANGED", meta: { from: "TO_DO", to: "DONE" }, createdAt: ist(2026, 9, 16) });
    seedRow(db, "itemCompletion", { itemId: "kept", boardId: "b-ops", organizationId: ORG, status: "DONE", doneAt: ist(2026, 9, 16) });
    for (const id of ["old-done", "no-trace", "kept"]) await restoreBoardItem(id, CONN);
    expect(completionsOf("old-done").map((c) => [c.status, (c.doneAt as Date).getTime()])).toEqual([["DONE", ist(2026, 9, 15).getTime()]]);
    expect(completionsOf("no-trace")).toHaveLength(0);
    expect(completionsOf("kept")).toHaveLength(1);
    expect(rows("item").filter((r) => ["old-done", "no-trace", "kept"].includes(String(r.id))).every((r) => r.archivedAt == null)).toBe(true);
  });
});

describe("step 4 review M3: a create into done is dated when the work was finished", () => {
  it("completionAt null writes none, a date writes it then, nothing given writes now; a copy still takes its source's", async () => {
    at(ist(2026, 10, 20));
    const sample = await createBoardItem({ organizationId: ORG, boardId: "b-ops", title: "Sample", status: "DONE", actorId: CONN }, { completionAt: null });
    const imported = await createBoardItem({ organizationId: ORG, boardId: "b-ops", title: "Imported", status: "DONE", actorId: CONN }, { completionAt: ist(2026, 3, 31) });
    const typed = await createBoardItem({ organizationId: ORG, boardId: "b-ops", title: "Typed", status: "DONE", actorId: CONN });
    expect(completionsOf(sample.id)).toHaveLength(0);
    expect(completionsOf(imported.id).map((c) => (c.doneAt as Date).getTime())).toEqual([ist(2026, 3, 31).getTime()]);
    expect(completionsOf(typed.id).map((c) => (c.doneAt as Date).getTime())).toEqual([ist(2026, 10, 20).getTime()]);
    const copy = await createBoardItem({ organizationId: ORG, boardId: "b-ops", title: "Copy", status: "DONE", actorId: CONN }, { completionFrom: imported.id, completionAt: null });
    expect(completionsOf(copy.id).map((c) => (c.doneAt as Date).getTime())).toEqual([ist(2026, 3, 31).getTime()]);
  });
});

describe("step 4 review L1: a move judges the statuses it reads under its locks", () => {
  it("a status written between the move's first read and its lock: no second completion, and a done subtask stays done", async () => {
    seedRow(db, "board", { id: "b-ship", organizationId: ORG, name: "Shipped", slug: "shipped", statuses: SHIP_STATUSES });
    const parent = await newTask("Parent", ist(2026, 10, 3));
    const child = await newTask("Child", ist(2026, 10, 3), { parentItemId: parent.id });
    // Both are marked done by someone else while the move waits for the target List's lock.
    db.afterLock = (key) => {
      if (key !== "advisory:list-order:b-ship") return;
      db.afterLock = null;
      for (const id of [parent.id, child.id]) {
        rows("item").find((r) => r.id === id)!.status = "DONE";
        seedRow(db, "itemCompletion", { itemId: id, boardId: "b-ops", organizationId: ORG, status: "DONE", doneAt: ist(2026, 10, 4, 9) });
      }
    };
    at(ist(2026, 10, 4, 10));
    await moveBoardItem({ itemId: parent.id, toBoardId: "b-ship", status: "SHIPPED", actorId: CONN, fromStatuses: getBoardStatuses(null), toStatuses: SHIP_STATUSES });
    expect(completionsOf(parent.id).map((c) => [c.boardId, (c.doneAt as Date).getTime()])).toEqual([["b-ship", ist(2026, 10, 4, 9).getTime()]]);
    expect(rows("item").find((r) => r.id === child.id)?.status).toBe("SHIPPED");
    expect(completionsOf(child.id)).toHaveLength(1);
  });
});

describe("step 4 review L2: a Right now freeze runs first and whatever the budget has left, and a paused one freezes its stored number", () => {
  it("paused at its freeze: October keeps the number it stood at, frozen, though the source comes back in the grace", async () => {
    sourcedGoal("g-fz", OPEN_BUGS, { startValue: 30, targetValue: 10 });
    at(ist(2026, 10, 20));
    for (let i = 0; i < 5; i++) await createBoardItem({ organizationId: ORG, boardId: "b-bugs", title: `Bug ${i}`, actorId: CONN } as Parameters<typeof createBoardItem>[0]);
    await count("g-fz", ist(2026, 10, 21));
    st.roles.get(CONN)!.delete("b-bugs");
    expect((await runCron(ist(2026, 11, 1, 0, 5))).status).toBe(200);
    const oct = rowIn("g-fz-kr", "g-fz", "2026-10-01")!;
    expect(oct.currentValue).toBe(5);
    expect((oct.frozenAt as Date | null)?.getTime()).toBe(ist(2026, 11, 1, 0, 5).getTime());
    expect(oct.pausedReason).toBe("Priya can no longer open a List it counts. Reconnect it.");
    // Back on 2 November, and a bug closed: November moves, October does not.
    grant(CONN, "b-bugs");
    await setStatus(String(rows("item").find((r) => r.boardId === "b-bugs")!.id), "DONE", ist(2026, 11, 2));
    await runCron(ist(2026, 11, 2, 12));
    expect(rowIn("g-fz-kr", "g-fz", "2026-10-01")).toMatchObject({ currentValue: 5, frozenAt: ist(2026, 11, 1, 0, 5) });
    expect(rowIn("g-fz-kr", "g-fz", "2026-11-01")?.currentValue).toBe(4);
  });

  it("the budget spent by an earlier workspace: a later one's October still freezes at the first run after its end", async () => {
    // New York first (never counted), with a count that spends the whole budget.
    seedRow(db, "oKR", { id: "g-ny", organizationId: NY, title: "NY goal", level: "INDIVIDUAL", ownerId: "u-nyc", repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 9, 20) });
    seedRow(db, "keyResult", { id: "g-ny-kr", okrId: "g-ny", title: "NY", startValue: 0, targetValue: 10, currentValue: 0, source: { ...DONE_LIST, listIds: ["b-ny"] }, sourceById: "u-nyc", createdAt: ist(2026, 9, 20) });
    st.editors.add("u-nyc");
    // Kolkata second (counted on 31 October), a Right now count due its freeze.
    sourcedGoal("g-late", OPEN_BUGS, { startValue: 30, targetValue: 10 });
    at(ist(2026, 10, 30));
    for (let i = 0; i < 2; i++) await createBoardItem({ organizationId: ORG, boardId: "b-bugs", title: `Bug ${i}`, actorId: CONN } as Parameters<typeof createBoardItem>[0]);
    await count("g-late", ist(2026, 10, 31, 12));
    vi.mocked(refreshGoalSources).mockClear();
    let spend = true;
    db.beforeStatement = (what) => {
      if (spend && what === "itemCompletion.aggregate") {
        spend = false;
        vi.setSystemTime(new Date(Date.now() + 121_000));
      }
    };
    try {
      expect((await runCron(ist(2026, 11, 1, 0, 5))).status).toBe(200);
    } finally {
      db.beforeStatement = null;
    }
    expect(vi.mocked(refreshGoalSources).mock.calls.filter((c) => (c[1] as { freezeRightNow?: boolean } | undefined)?.freezeRightNow).map((c) => c[0])).toEqual([NY, ORG]);
    expect(rowIn("g-late-kr", "g-late", "2026-10-01")).toMatchObject({ currentValue: 2, frozenAt: ist(2026, 11, 1, 0, 5) });
  });
});

describe("step 4 review L3: a one-time goal's number stands once its window has ended", () => {
  it("Right now freezes at the first cron run after the due date; a bug closed later changes nothing, even on Refresh", async () => {
    oneTimeGoal("g-1x", OPEN_BUGS);
    at(ist(2026, 10, 20));
    for (let i = 0; i < 5; i++) await createBoardItem({ organizationId: ORG, boardId: "b-bugs", title: `Bug ${i}`, actorId: CONN } as Parameters<typeof createBoardItem>[0]);
    at(ist(2026, 10, 21));
    await refreshGoalSources(ORG, { okrIds: ["g-1x"], force: true, now: ist(2026, 10, 21) });
    expect(rows("keyResult").find((k) => k.id === "g-1x-kr")?.currentValue).toBe(5);
    // The goal page after the end does not freeze it: only the cron's first run does.
    at(ist(2026, 10, 31, 23, 30));
    await setStatus(String(rows("item").find((r) => r.boardId === "b-bugs")!.id), "DONE", ist(2026, 10, 31, 23, 30));
    expect((await refreshGoalSources(ORG, { okrIds: ["g-1x"], minAgeMs: 0, now: ist(2026, 11, 1, 0, 1) })).counted).toBe(0);
    await runCron(ist(2026, 11, 1, 0, 5));
    expect(rows("keyResult").find((k) => k.id === "g-1x-kr")?.currentValue).toBe(4);
    // 2 November: another bug closed, the cron and a Refresh leave it at 4.
    await setStatus(String(rows("item").filter((r) => r.boardId === "b-bugs")[1].id), "DONE", ist(2026, 11, 2));
    await runCron(ist(2026, 11, 2, 12));
    const refreshed = await refreshGoalSources(ORG, { okrIds: ["g-1x"], keyResultIds: ["g-1x-kr"], force: true, now: ist(2026, 11, 2, 13) });
    expect(refreshed.counted).toBe(0);
    expect(rows("keyResult").find((k) => k.id === "g-1x-kr")?.currentValue).toBe(4);
  });

  it("a windowed one is counted once after its end, then left", async () => {
    oneTimeGoal("g-1w", DONE_LIST);
    await newTask("Done", ist(2026, 10, 10), { status: "DONE" });
    at(ist(2026, 10, 21));
    await refreshGoalSources(ORG, { okrIds: ["g-1w"], force: true, now: ist(2026, 10, 21) });
    await newTask("Done late", ist(2026, 10, 31, 22), { status: "DONE" });
    at(ist(2026, 11, 1, 0, 10));
    expect((await refreshGoalSources(ORG, { okrIds: ["g-1w"], force: true, now: ist(2026, 11, 1, 0, 10) })).counted).toBe(1);
    expect(rows("keyResult").find((k) => k.id === "g-1w-kr")?.currentValue).toBe(2);
    at(ist(2026, 11, 3));
    expect((await refreshGoalSources(ORG, { okrIds: ["g-1w"], force: true, now: ist(2026, 11, 3) })).counted).toBe(0);
  });
});

describe("step 4 review L4: the cron counts the workspace counted longest ago first", () => {
  it("New York, never counted, before Kolkata, though Kolkata's goal was made first", async () => {
    sourcedGoal("g-kol", DONE_LIST);
    await count("g-kol", ist(2026, 10, 10));
    seedRow(db, "oKR", { id: "g-ny", organizationId: NY, title: "NY goal", level: "INDIVIDUAL", ownerId: "u-nyc", repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 9, 20) });
    seedRow(db, "keyResult", { id: "g-ny-kr", okrId: "g-ny", title: "NY", startValue: 0, targetValue: 10, currentValue: 0, source: { ...DONE_LIST, listIds: ["b-ny"] }, sourceById: "u-nyc", createdAt: ist(2026, 9, 20) });
    st.editors.add("u-nyc");
    vi.mocked(refreshGoalSources).mockClear();
    await runCron(ist(2026, 10, 12));
    // The cron's counting pass (its closes count their own periods first).
    const counting = vi.mocked(refreshGoalSources).mock.calls.filter((c) => (c[1] as { freezeRightNow?: boolean } | undefined)?.freezeRightNow);
    expect(counting.map((c) => c[0])).toEqual([NY, ORG]);
  });
});

describe("step 4 review L5: the cap is decided on counts, after the filters", () => {
  it("over the cap pauses before any task is loaded", async () => {
    const t = ist(2026, 10, 3);
    const items = db.rows.item ?? (db.rows.item = []);
    for (let i = 0; i < LIST_SOURCE_CAP + 1; i++) {
      items.push({ id: `cap-${i}`, organizationId: ORG, boardId: "b-ops", title: `T${i}`, itemType: "studio-item", status: "TO_DO", ownerId: null, assigneeIds: [], metadata: {}, parentItemId: null, archivedAt: null, dueAt: null, startAt: null, priority: null, itemTypeId: null, createdAt: t, updatedAt: t });
    }
    const conn = await connectorFor(ORG, CONN);
    if (!conn.ok) throw new Error(conn.reason);
    const source = { kind: "list" as const, listIds: ["b-ops"], spaceId: null, metric: { op: "count" as const }, filter: { connector: "AND" as const, rules: [], hideDone: false }, countedBy: "now" as const, dateFieldKey: null };
    let outcome: unknown;
    const loaded = await itemRowsLoaded(async () => { outcome = await countListSource({ orgId: ORG, source, connector: conn.connector, window: null, zone: "Asia/Kolkata", now: t }); });
    expect(outcome).toEqual({ kind: "paused", reason: "Too many tasks to count. Narrow the filter." });
    expect(Math.max(0, ...loaded)).toBe(0);
  }, 60_000);

  it("Done date: 20,001 subtask completions never pause a List whose three top-level tasks count", async () => {
    const t = ist(2026, 10, 5);
    const items = db.rows.item ?? (db.rows.item = []);
    const done = db.rows.itemCompletion ?? (db.rows.itemCompletion = []);
    seedRow(db, "item", { id: "parent", organizationId: ORG, boardId: "b-ops", title: "Parent" });
    for (let i = 0; i < LIST_SOURCE_CAP + 1; i++) {
      items.push({ id: `sub-${i}`, organizationId: ORG, boardId: "b-ops", title: `S${i}`, itemType: "studio-item", status: "DONE", ownerId: null, assigneeIds: [], metadata: {}, parentItemId: "parent", archivedAt: null, dueAt: null, startAt: null, priority: null, itemTypeId: null, createdAt: t, updatedAt: t });
      done.push({ id: `c-sub-${i}`, itemId: `sub-${i}`, boardId: "b-ops", organizationId: ORG, status: "DONE", doneAt: t, actorId: null });
    }
    for (let i = 0; i < 3; i++) await newTask(`Top ${i}`, ist(2026, 10, 6 + i), { status: "DONE" });
    const conn = await connectorFor(ORG, CONN);
    if (!conn.ok) throw new Error(conn.reason);
    const source = { kind: "list" as const, listIds: ["b-ops"], spaceId: null, metric: { op: "count" as const }, filter: { connector: "AND" as const, rules: [], hideDone: false }, countedBy: "done" as const, dateFieldKey: null };
    const r = await countListSource({ orgId: ORG, source, connector: conn.connector, window: periodWindow(periodFor("MONTHLY", ist(2026, 10, 15), KOLKATA), KOLKATA), zone: "Asia/Kolkata", now: ist(2026, 10, 20) });
    expect(r).toMatchObject({ kind: "counted", value: 3 });
  }, 60_000);

  it("the preview is rate limited per person: 30 a minute", async () => {
    sourcedGoal("g-rate", null);
    at(ist(2026, 10, 3));
    seedRow(db, "user", { id: "u-rate", organizationId: ORG, firstName: "Rae", lastName: "Te" });
    st.editors.add("u-rate");
    st.session = legacyTestSession("u-rate", "EMPLOYEE", ORG);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await call(previewRoute.POST, "/api/okrs/g-rate/key-results/preview", { method: "POST", params: { id: "g-rate" }, body: { source: DONE_LIST } })).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe("step 4 review L6, L7: what a Space source tells the workspace", () => {
  function marketing() {
    seedRow(db, "space", { id: "s-mkt", organizationId: ORG, name: "Marketing", slug: "marketing", archivedAt: null });
    db.rows.board.find((b) => b.id === "b-ops")!.spaceId = "s-mkt";
    grant(CONN, "s-mkt");
  }
  const SPACE = { kind: "space", spaceId: "s-mkt", metric: { op: "count" }, filter: { connector: "AND", rules: [], hideDone: false }, countedBy: "done" };

  it("L6: a Space open to the workspace holding a private List gets the audience line", async () => {
    marketing();
    grant("workspace-member", "s-mkt");
    sourcedGoal("g-aud", null);
    at(ist(2026, 10, 3));
    await settleGoalPeriods(ORG, ["g-aud"], ist(2026, 10, 3));
    const preview = async () => (await call(previewRoute.POST, "/api/okrs/g-aud/key-results/preview", { method: "POST", params: { id: "g-aud" }, body: { source: SPACE } })).body;
    expect(await preview()).toMatchObject({ paused: null, openToWorkspace: false });
    grant("workspace-member", "b-ops");
    expect(await preview()).toMatchObject({ paused: null, openToWorkspace: true });
  });

  it("L7: \"Now counting 2 Lists\" names the Space only when the whole workspace may open it", async () => {
    marketing();
    sourcedGoal("g-act", SPACE);
    // After September's close, so October's row alone is counted.
    await count("g-act", ist(2026, 10, 10));
    seedRow(db, "board", { id: "b-ads", organizationId: ORG, name: "Ads", slug: "ads", spaceId: "s-mkt" });
    grant(CONN, "b-ads");
    await count("g-act", ist(2026, 10, 11));
    expect(st.activity.map((a) => a.description)).toEqual(["Now counting 2 Lists, was 1"]);
    grant("workspace-member", "s-mkt");
    seedRow(db, "board", { id: "b-seo", organizationId: ORG, name: "SEO", slug: "seo", spaceId: "s-mkt" });
    grant(CONN, "b-seo");
    await count("g-act", ist(2026, 10, 12));
    expect(st.activity.map((a) => a.description)).toEqual(["Now counting 2 Lists, was 1", "Now counting 3 Lists in Marketing, was 2"]);
  });
});

describe("step 4 review L8: goal_source_paused reaches only people who still work here, and never a leaver about themselves", () => {
  const inbox = () => rows("notification").filter((n) => n.type === "goal_source_paused").map((n) => n.userId);

  it("a connector removed from the workspace (their account active elsewhere) gets no row; the owner does", async () => {
    sourcedGoal("g-gone", DONE_LIST);
    await count("g-gone", ist(2026, 10, 3));
    db.rows.user.find((u) => u.id === CONN)!.organizationId = "org-elsewhere";
    await count("g-gone", ist(2026, 10, 4));
    expect(rowIn("g-gone-kr", "g-gone", "2026-10-01")?.pausedReason).toBe("Priya no longer works here. Reconnect it.");
    expect(inbox()).toEqual([OWNER]);
  });

  it("the handover tells the owner what stayed paused, not the leaver", async () => {
    sourcedGoal("g-hand", DONE_LIST);
    await count("g-hand", ist(2026, 10, 3));
    // Vic takes over, but cannot open Ops: the source stays, paused.
    expect(await handOverGoalSources(ORG, CONN, VIEWER)).toEqual({ moved: 0, paused: 1 });
    expect(inbox()).toEqual([OWNER]);
  });
});

describe("step 4 review L12: a restore moves every completion of the task to its home", () => {
  it("a row still there (the repair has not run) is moved to the List the task is restored to", async () => {
    seedRow(db, "itemCompletion", { id: "c-kept", itemId: "t-back", boardId: "b-ops", organizationId: ORG, status: "DONE", doneAt: ist(2026, 10, 2) });
    await restoreCompletions(db.prisma as never, [
      { id: "c-kept", itemId: "t-back", boardId: "b-ops", organizationId: ORG, status: "DONE", doneAt: ist(2026, 10, 2).toISOString(), actorId: null },
      { id: "c-gone", itemId: "t-back", boardId: "b-ops", organizationId: ORG, status: "DONE", doneAt: ist(2026, 9, 2).toISOString(), actorId: null },
    ], () => "b-bugs");
    expect(completionsOf("t-back").map((c) => [c.id, c.boardId]).sort()).toEqual([["c-gone", "b-bugs"], ["c-kept", "b-bugs"]]);
  });
});

describe("step 4 review L13: Reconnect is a door the switch closes", () => {
  it("refused while RECURRING_GOALS is off, with or without a source in the body", async () => {
    sourcedGoal("g-rc", DONE_LIST);
    grant(OWNER, "b-ops");
    at(ist(2026, 10, 3));
    st.session = legacyTestSession(OWNER, "EMPLOYEE", ORG);
    process.env.RECURRING_GOALS = "0";
    const r = await call(krRoute.PATCH, "/api/okrs/g-rc/key-results/g-rc-kr", { method: "PATCH", params: { id: "g-rc", krId: "g-rc-kr" }, body: { reconnect: true } });
    expect(r).toMatchObject({ status: 400, body: { error: "Repeating goals are not turned on." } });
    expect(rows("keyResult").find((k) => k.id === "g-rc-kr")?.sourceById).toBe(CONN);
    process.env.RECURRING_GOALS = "1";
    expect((await call(krRoute.PATCH, "/api/okrs/g-rc/key-results/g-rc-kr", { method: "PATCH", params: { id: "g-rc", krId: "g-rc-kr" }, body: { reconnect: true } })).status).toBe(200);
    expect(rows("keyResult").find((k) => k.id === "g-rc-kr")?.sourceById).toBe(OWNER);
  });
});

describe("step 4 review L14: Hide completed does not apply to Done date", () => {
  it("a Done-date count with Hide completed on counts its completions, not 0", async () => {
    sourcedGoal("g-hide", { ...DONE_LIST, filter: { connector: "AND", rules: [], hideDone: true } });
    await newTask("Done", ist(2026, 10, 2), { status: "DONE" });
    await newTask("Done too", ist(2026, 10, 3), { status: "DONE" });
    await count("g-hide", ist(2026, 10, 4));
    expect(rowIn("g-hide-kr", "g-hide", "2026-10-01")?.currentValue).toBe(2);
  });
});

describe("step 4 review L15: the signature reads which tasks are linked in, not how many", () => {
  it("one linked task swapped for another, every other fact the same: counted again", async () => {
    sourcedGoal("g-link", DONE_LIST);
    // Home: one task done on 20 October, the newest of everything.
    seedRow(db, "item", { id: "home", organizationId: ORG, boardId: "b-ops", title: "Home", status: "DONE", updatedAt: ist(2026, 10, 20) });
    seedRow(db, "itemCompletion", { itemId: "home", boardId: "b-ops", organizationId: ORG, status: "DONE", doneAt: ist(2026, 10, 20) });
    // Two tasks of Bugs: one done in October, one in September.
    seedRow(db, "item", { id: "l-oct", organizationId: ORG, boardId: "b-bugs", title: "Oct", status: "DONE", updatedAt: ist(2026, 10, 5) });
    seedRow(db, "itemCompletion", { itemId: "l-oct", boardId: "b-bugs", organizationId: ORG, status: "DONE", doneAt: ist(2026, 10, 5) });
    seedRow(db, "item", { id: "l-sep", organizationId: ORG, boardId: "b-bugs", title: "Sep", status: "DONE", updatedAt: ist(2026, 10, 5) });
    seedRow(db, "itemCompletion", { itemId: "l-sep", boardId: "b-bugs", organizationId: ORG, status: "DONE", doneAt: ist(2026, 9, 6) });
    const linkIn = (id: string) => (scope: { where: unknown; listsByItem: Map<string, string[]> }) => ({ ...scope, where: { OR: [scope.where, { id: { in: [id] } }] }, listsByItem: new Map([[id, ["b-ops"]]]) });
    st.linked = linkIn("l-oct");
    at(ist(2026, 10, 21));
    await settleGoalPeriods(ORG, ["g-link"], ist(2026, 10, 21));
    await refreshGoalSources(ORG, { okrIds: ["g-link"], now: ist(2026, 10, 21) });
    expect(rowIn("g-link-kr", "g-link", "2026-10-01")?.currentValue).toBe(2);
    st.linked = linkIn("l-sep");
    at(ist(2026, 10, 21, 13));
    await refreshGoalSources(ORG, { okrIds: ["g-link"], now: ist(2026, 10, 21, 13) });
    expect(rowIn("g-link-kr", "g-link", "2026-10-01")?.currentValue).toBe(1);
  });
});

describe("step 4 review L16: a Date field window too wide for prefixes reads only tasks whose field is set", () => {
  it("a goal from 2020 to 2026 counted by a Date field loads the two tasks that have one, not the third", async () => {
    db.rows.board.find((b) => b.id === "b-ops")!.schema = { fields: [{ key: "deadline", label: "Deadline", type: "DATE" }] };
    at(ist(2026, 10, 20));
    seedRow(db, "item", { id: "f-1", organizationId: ORG, boardId: "b-ops", title: "One", metadata: { deadline: "2024-05-01" } });
    seedRow(db, "item", { id: "f-2", organizationId: ORG, boardId: "b-ops", title: "Two", metadata: { deadline: "2026-01-15" } });
    seedRow(db, "item", { id: "f-0", organizationId: ORG, boardId: "b-ops", title: "None", metadata: {} });
    const conn = await connectorFor(ORG, CONN);
    if (!conn.ok) throw new Error(conn.reason);
    const source = { kind: "list" as const, listIds: ["b-ops"], spaceId: null, metric: { op: "count" as const }, filter: { connector: "AND" as const, rules: [], hideDone: false }, countedBy: "field" as const, dateFieldKey: "deadline" };
    const window = goalDatesWindow(new Date("2020-01-01T00:00:00Z"), new Date("2026-12-31T00:00:00Z"), "Asia/Kolkata");
    let outcome: unknown;
    const loaded = await itemRowsLoaded(async () => { outcome = await countListSource({ orgId: ORG, source, connector: conn.connector, window, zone: "Asia/Kolkata", now: ist(2026, 10, 20) }); });
    expect(outcome).toMatchObject({ kind: "counted", value: 2 });
    expect(loaded).toEqual([2]);
  });
});
