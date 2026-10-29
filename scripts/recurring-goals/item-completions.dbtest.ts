// Step 4 of repeating goals on real Postgres (see vitest.db.config.mts):
// the ItemCompletion writes in their status writes' own transactions (the
// task's row FOR UPDATE, a List's status set FOR UPDATE), a Trash snapshot
// keeping a task's completions and the repair's NOT EXISTS orphan delete, a
// Date field window through Prisma's JSON string_starts_with, and the
// query-count proof: 2,000 period openings in one batch run a fixed handful
// of queries per chunk of goals and one org rollup, counted at the driver
// (every statement the pg client sends, BEGIN and COMMIT included). From the
// step 4 review: a move's subtasks locked and read again (= ANY(...) FOR
// UPDATE), a status leaving the done group, an unarchive by the backfill's
// rule, a restore moving rows home, a Date field read with "the field is
// set" (an empty string_starts_with) over a wide window, and a Done-date
// count paging past 20,000 subtask completions.
// The default suite proves the same logic over the in-memory store
// (src/lib/goals/goal-source.step4.test.ts).
//
// Needs prisma/sql/2026-10-27-recurring-goals.sql,
// 2026-10-27-recurring-goals-kpi-identity.sql and
// 2026-10-27-item-completions.sql applied locally. Builds three throwaway
// organizations in Asia/Kolkata and removes them afterwards; the repair it
// runs is kept to its own organization.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

const LOCAL = /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1):5432\//;
if (!LOCAL.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("item-completions.dbtest refuses to run: DATABASE_URL is not the local database on port 5432 (use the URL from .env.local).");
}

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
// The org rollup, counted: the real functions, watched.
vi.mock("@/lib/alignment", async (orig) => {
  const real = (await orig()) as Record<string, (...a: unknown[]) => unknown>;
  return { ...real, persistGoalRollupChains: vi.fn(real.persistGoalRollupChains), computeGoalRollups: vi.fn(real.computeGoalRollups) };
});

// Every statement the driver sends, counted while `counting` is on.
let counting = false;
let queries = 0;
const send = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
  if (counting) queries += 1;
  return (send as (...a: unknown[]) => unknown).apply(this, args);
} as typeof pg.Client.prototype.query;

import { prisma } from "@/lib/prisma";
import { computeGoalRollups, persistGoalRollupChains } from "@/lib/alignment";
import { archiveBoardItem, createBoardItem, moveBoardItem, restoreBoardItem, updateBoardItem } from "@/lib/board-items";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { updateBoard } from "@/lib/board";
import { moveToTrash, restoreFromTrash } from "@/lib/trash";
import { repairItemCompletions, restoreCompletions } from "@/lib/item-completions";
import { settleGoalPeriods } from "@/lib/goals/goal-periods.server";
import { connectorFor, countListSource } from "@/lib/goals/goal-source.server";
import { goalDatesWindow, LIST_SOURCE_CAP, periodWindow } from "@/lib/goals/goal-source";
import { periodFor, periodSettingsOf } from "@/lib/goals/goal-period";

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ids = { org: "", user: "", board: "", shipped: "", qOrgSmall: "", qOrgLarge: "", qUserSmall: "", qUserLarge: "" };
/** An instant given as IST wall-clock time. */
const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);
const completionsOf = (itemId: string) => prisma.itemCompletion.findMany({ where: { itemId }, orderBy: { doneAt: "asc" } });

async function workspace(name: string): Promise<{ org: string; user: string }> {
  const org = await prisma.organization.create({ data: { name: `${name} ${suffix}`, slug: `${name.toLowerCase()}-${suffix}`, settings: { timezone: "Asia/Kolkata" } } });
  const u = await prisma.user.create({ data: { email: `${name.toLowerCase()}-${suffix}@ic.test`, passwordHash: "x", firstName: "Ivy", lastName: "Test", organizationId: org.id, accessLevel: "COMPANY_ADMIN" } });
  return { org: org.id, user: u.id };
}

async function list(orgId: string, userId: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const b = await prisma.board.create({ data: { organizationId: orgId, name, slug: `${name.toLowerCase()}-${suffix}`, itemType: "studio-item", ownerId: userId, ...extra } });
  return b.id;
}

beforeAll(async () => {
  const w = await workspace("IC");
  ids.org = w.org;
  ids.user = w.user;
  ids.board = await list(ids.org, ids.user, "Ops", { schema: { fields: [{ key: "deadline", label: "Deadline", type: "DATE" }] } });
  ids.shipped = await list(ids.org, ids.user, "Shipped", { statuses: [{ value: "OPEN", label: "Open", group: "ACTIVE" }, { value: "SHIPPED", label: "Shipped", group: "DONE" }] });
  const small = await workspace("ICS");
  const large = await workspace("ICL");
  ids.qOrgSmall = small.org;
  ids.qUserSmall = small.user;
  ids.qOrgLarge = large.org;
  ids.qUserLarge = large.user;
});

afterAll(async () => {
  pg.Client.prototype.query = send;
  for (const id of [ids.org, ids.qOrgSmall, ids.qOrgLarge].filter(Boolean)) {
    await prisma.itemCompletion.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup completions", e));
    await prisma.trashItem.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup trash", e));
    await prisma.oKR.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup okr", e));
    await prisma.item.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup items", e));
    await prisma.itemActivity.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup activity", e));
    await prisma.board.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup boards", e));
    await prisma.user.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup user", e));
    await prisma.organization.delete({ where: { id } }).catch((e) => console.error("cleanup org", e));
  }
  await prisma.$disconnect();
});

describe("item completions on Postgres", () => {
  it("a create into Done, a reopen and a done again write and remove rows in the status write's transaction", async () => {
    const t = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "Born done", status: "DONE", actorId: ids.user });
    expect(await completionsOf(t.id)).toHaveLength(1);
    await updateBoardItem(t.id, { status: "TO_DO" }, ids.user);
    expect(await completionsOf(t.id)).toHaveLength(0);
    await updateBoardItem(t.id, { status: "DONE" }, ids.user);
    expect((await completionsOf(t.id)).map((c) => c.status)).toEqual(["DONE"]);
  });

  it("ten saves racing a task into Done write one completion (the task's row FOR UPDATE)", async () => {
    const t = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "Racing", actorId: ids.user });
    await Promise.all(Array.from({ length: 10 }, () => updateBoardItem(t.id, { status: "DONE" }, ids.user)));
    expect(await completionsOf(t.id)).toHaveLength(1);
  });

  it("a move carries its rows to the new home, and a new status set records the tasks it puts into done", async () => {
    const t = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "Mover", actorId: ids.user });
    await moveBoardItem({ itemId: t.id, toBoardId: ids.shipped, status: "SHIPPED", actorId: ids.user });
    expect((await completionsOf(t.id)).map((c) => [c.status, c.boardId])).toEqual([["SHIPPED", ids.shipped]]);
    const qa = await list(ids.org, ids.user, "QA", { statuses: [{ value: "OPEN", label: "Open", group: "ACTIVE" }, { value: "VERIFIED", label: "Verified", group: "ACTIVE" }] });
    const v = await createBoardItem({ organizationId: ids.org, boardId: qa, title: "Verified", status: "VERIFIED", actorId: ids.user });
    expect(await completionsOf(v.id)).toHaveLength(0);
    await updateBoard(qa, { statuses: [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" }, { value: "VERIFIED", label: "Verified", color: "#090", group: "DONE" }] });
    expect((await completionsOf(v.id)).map((c) => c.status)).toEqual(["VERIFIED"]);
  });

  it("Trash keeps a task's completions, the repair deletes the orphan, and the restore brings it back once", async () => {
    const t = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "To Trash", status: "DONE", actorId: ids.user });
    expect(await moveToTrash("item", t.id, { organizationId: ids.org, userId: ids.user })).toBe(true);
    expect(await completionsOf(t.id)).toHaveLength(1);
    const r = await repairItemCompletions(new Date(), { organizationId: ids.org });
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect(await completionsOf(t.id)).toHaveLength(0);
    const trash = await prisma.trashItem.findFirstOrThrow({ where: { organizationId: ids.org, entityId: t.id }, select: { id: true, entityType: true, snapshot: true } });
    await restoreFromTrash(trash);
    expect(await completionsOf(t.id)).toHaveLength(1);
  });

  it("a Date field window reads through Prisma's string_starts_with: the day, the UTC midnight and the IST midnight of 1 November count in November", async () => {
    for (const [title, deadline] of [["Day", "2026-11-01"], ["Gantt", "2026-11-01T00:00:00.000Z"], ["Picker", "2026-10-31T18:30:00.000Z"], ["October", "2026-10-31"]] as const) {
      await createBoardItem({ organizationId: ids.org, boardId: ids.board, title, metadata: { deadline }, actorId: ids.user });
    }
    const s = periodSettingsOf({ timezone: "Asia/Kolkata" });
    const conn = await connectorFor(ids.org, ids.user);
    if (!conn.ok) throw new Error(conn.reason);
    const source = { kind: "list" as const, listIds: [ids.board], spaceId: null, metric: { op: "count" as const }, filter: { connector: "AND" as const, rules: [], hideDone: false }, countedBy: "field" as const, dateFieldKey: "deadline" };
    const nov = await countListSource({ orgId: ids.org, source, connector: conn.connector, window: periodWindow(periodFor("MONTHLY", ist(2026, 11, 15), s), s), zone: s.timezone, now: new Date() });
    expect(nov).toMatchObject({ kind: "counted", value: 3 });
  });
});

describe("the step 4 review on Postgres", () => {
  const SHIP = [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" as const }, { value: "SHIPPED", label: "Shipped", color: "#090", group: "DONE" as const }];

  it("L1: a move locks its subtasks (= ANY(...) FOR UPDATE) and remaps the statuses it reads there: a done subtask stays done, one completion each", async () => {
    const parent = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "Parent", status: "DONE", actorId: ids.user });
    const child = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "Child", status: "DONE", parentItemId: parent.id, actorId: ids.user });
    await moveBoardItem({ itemId: parent.id, toBoardId: ids.shipped, status: "SHIPPED", actorId: ids.user, fromStatuses: getBoardStatuses(null), toStatuses: SHIP });
    expect((await prisma.item.findUniqueOrThrow({ where: { id: child.id }, select: { status: true, boardId: true } }))).toEqual({ status: "SHIPPED", boardId: ids.shipped });
    expect((await completionsOf(parent.id)).map((c) => c.boardId)).toEqual([ids.shipped]);
    expect((await completionsOf(child.id)).map((c) => c.boardId)).toEqual([ids.shipped]);
  });

  it("M2: a status leaving the done group removes its tasks' latest completion; back again, one", async () => {
    const set = (g: "ACTIVE" | "DONE") => [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" as const }, { value: "VERIFIED", label: "Verified", color: "#090", group: g }];
    const qa = await list(ids.org, ids.user, "QA2", { statuses: set("DONE") });
    const v = await createBoardItem({ organizationId: ids.org, boardId: qa, title: "Verified", status: "VERIFIED", actorId: ids.user });
    const archived = await createBoardItem({ organizationId: ids.org, boardId: qa, title: "Shelved", status: "VERIFIED", actorId: ids.user });
    await archiveBoardItem(archived.id, ids.user);
    await updateBoard(qa, { statuses: set("ACTIVE") });
    expect(await completionsOf(v.id)).toHaveLength(0);
    expect(await completionsOf(archived.id)).toHaveLength(0);
    await updateBoard(qa, { statuses: set("DONE") });
    expect(await completionsOf(v.id)).toHaveLength(1);
    expect(await completionsOf(archived.id)).toHaveLength(1);
  });

  it("M2: an unarchive in a done status with no completion writes one at its last entry into done, in the unarchive's transaction", async () => {
    const t = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "Old done", actorId: ids.user });
    await prisma.item.update({ where: { id: t.id }, data: { status: "DONE" } });
    const entered = new Date("2026-09-15T06:30:00.000Z");
    await prisma.itemActivity.create({ data: { organizationId: ids.org, entityType: "BOARD_ITEM", entityId: t.id, action: "STATUS_CHANGED", meta: { from: "TO_DO", to: "DONE" }, createdAt: entered } });
    await archiveBoardItem(t.id, ids.user);
    await restoreBoardItem(t.id, ids.user);
    expect((await completionsOf(t.id)).map((c) => c.doneAt.toISOString())).toEqual([entered.toISOString()]);
  });

  it("L12: a restore moves a row still there to the task's home", async () => {
    const t = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "Back home", status: "DONE", actorId: ids.user });
    const [row] = await completionsOf(t.id);
    await restoreCompletions(prisma, [{ ...row, doneAt: row.doneAt.toISOString() }], () => ids.shipped);
    expect((await completionsOf(t.id)).map((c) => c.boardId)).toEqual([ids.shipped]);
  });

  it("L16: a Date field window too wide for prefixes reads the tasks whose field is set (an empty string_starts_with)", async () => {
    const wide = await list(ids.org, ids.user, "Wide", { schema: { fields: [{ key: "deadline", label: "Deadline", type: "DATE" }] } });
    for (const [title, md] of [["Set 2024", { deadline: "2024-05-01" }], ["Set 2026", { deadline: "2026-01-15T00:00:00.000Z" }], ["Unset", {}], ["Null", { deadline: null }]] as const) {
      await createBoardItem({ organizationId: ids.org, boardId: wide, title, metadata: md, actorId: ids.user });
    }
    const conn = await connectorFor(ids.org, ids.user);
    if (!conn.ok) throw new Error(conn.reason);
    const source = { kind: "list" as const, listIds: [wide], spaceId: null, metric: { op: "count" as const }, filter: { connector: "AND" as const, rules: [], hideDone: false }, countedBy: "field" as const, dateFieldKey: "deadline" };
    const r = await countListSource({ orgId: ids.org, source, connector: conn.connector, window: goalDatesWindow(new Date("2020-01-01T00:00:00Z"), new Date("2026-12-31T00:00:00Z"), "Asia/Kolkata"), zone: "Asia/Kolkata", now: new Date() });
    expect(r).toMatchObject({ kind: "counted", value: 2 });
  });

  it("L5: a Done-date count pages past 20,000 subtask completions and counts its top-level tasks", async () => {
    const big = await list(ids.org, ids.user, "Big");
    const parent = await createBoardItem({ organizationId: ids.org, boardId: big, title: "Parent", actorId: ids.user });
    const doneAt = ist(2026, 10, 5);
    for (let i = 0; i <= LIST_SOURCE_CAP; i += 5000) {
      const part = Array.from({ length: Math.min(5000, LIST_SOURCE_CAP + 1 - i) }, (_, k) => `sub${suffix}${String(i + k).padStart(6, "0")}`);
      await prisma.item.createMany({ data: part.map((id) => ({ id, itemId: id, itemType: "studio-item", organizationId: ids.org, boardId: big, title: id, status: "DONE", parentItemId: parent.id })) });
      await prisma.itemCompletion.createMany({ data: part.map((id) => ({ itemId: id, boardId: big, organizationId: ids.org, status: "DONE", doneAt })) });
    }
    for (let i = 0; i < 3; i++) {
      const t = await createBoardItem({ organizationId: ids.org, boardId: big, title: `Top ${i}`, actorId: ids.user });
      await updateBoardItem(t.id, { status: "DONE" }, ids.user);
      await prisma.itemCompletion.updateMany({ where: { itemId: t.id }, data: { doneAt: ist(2026, 10, 6 + i) } });
    }
    const s = periodSettingsOf({ timezone: "Asia/Kolkata" });
    const conn = await connectorFor(ids.org, ids.user);
    if (!conn.ok) throw new Error(conn.reason);
    const source = { kind: "list" as const, listIds: [big], spaceId: null, metric: { op: "count" as const }, filter: { connector: "AND" as const, rules: [], hideDone: false }, countedBy: "done" as const, dateFieldKey: null };
    const r = await countListSource({ orgId: ids.org, source, connector: conn.connector, window: periodWindow(periodFor("MONTHLY", ist(2026, 10, 15), s), s), zone: s.timezone, now: new Date() });
    expect(r).toMatchObject({ kind: "counted", value: 3 });
  }, 300_000);
});

describe("the query-count proof on Postgres", () => {
  /** n monthly goals in one workspace, each with a target counted from a List and one typed by hand, opening November at once. */
  async function openNovember(orgId: string, userId: string, n: number): Promise<{ queries: number; rollups: number }> {
    const board = await list(orgId, userId, `Q${n}`);
    const source = { kind: "list", listIds: [board], metric: { op: "count" }, filter: { connector: "AND", rules: [], hideDone: false }, countedBy: "done" };
    const goals = Array.from({ length: n }, (_, i) => `qc${suffix}${n}${String(i).padStart(5, "0")}`);
    for (let i = 0; i < n; i += 500) {
      const part = goals.slice(i, i + 500);
      await prisma.oKR.createMany({ data: part.map((id) => ({ id, organizationId: orgId, title: id, level: "INDIVIDUAL", ownerId: userId, repeat: "MONTHLY", startDate: new Date("2026-11-01T00:00:00Z"), createdAt: ist(2026, 10, 20) })) });
      await prisma.keyResult.createMany({
        data: part.flatMap((id) => [
          { okrId: id, title: "Counted", startValue: 0, targetValue: 10, currentValue: 0, source, sourceById: userId, createdAt: ist(2026, 10, 20) },
          { okrId: id, title: "Typed", startValue: 0, targetValue: 10, currentValue: 0, createdAt: ist(2026, 10, 20) },
        ]),
      });
    }
    vi.mocked(persistGoalRollupChains).mockClear();
    vi.mocked(computeGoalRollups).mockClear();
    queries = 0;
    counting = true;
    const r = await settleGoalPeriods(orgId, null, ist(2026, 11, 2));
    counting = false;
    expect(r.opened).toBe(n);
    return { queries, rollups: vi.mocked(persistGoalRollupChains).mock.calls.length + vi.mocked(computeGoalRollups).mock.calls.length };
  }

  it("2,000 openings run a fixed handful of queries per chunk of 150 goals, never one per goal, and one org rollup; no source is counted", async () => {
    const small = await openNovember(ids.qOrgSmall, ids.qUserSmall, 600);
    const large = await openNovember(ids.qOrgLarge, ids.qUserLarge, 2000);
    console.log(`[item-completions.dbtest] queries: 600 goals ${small.queries}, 2,000 goals ${large.queries}`);
    expect(small.rollups).toBe(1);
    expect(large.rollups).toBe(1);
    // Far fewer than one per goal, and 10 more chunks cost a bounded handful each.
    expect(large.queries).toBeLessThan(2000 / 4);
    expect(large.queries - small.queries).toBeLessThanOrEqual(10 * 30);
    // Opening counts nothing: every List-sourced row opens at its start, uncounted.
    const rows = await prisma.keyResultPeriod.findMany({ where: { period: { organizationId: ids.qOrgLarge }, keyResult: { sourceById: { not: null } } }, select: { currentValue: true, refreshedAt: true } });
    expect(rows).toHaveLength(2000);
    expect(rows.every((r) => r.currentValue === 0 && r.refreshedAt === null)).toBe(true);
  }, 300_000);
});
