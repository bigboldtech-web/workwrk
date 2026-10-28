// Step 4 of repeating goals on real Postgres (see vitest.db.config.mts):
// the ItemCompletion writes in their status writes' own transactions (the
// task's row FOR UPDATE, a List's status set FOR UPDATE), a Trash snapshot
// keeping a task's completions and the repair's NOT EXISTS orphan delete, a
// Date field window through Prisma's JSON string_starts_with, and the
// query-count proof: 2,000 period openings in one batch run a fixed handful
// of queries per chunk of goals and one org rollup, counted at the driver
// (every statement the pg client sends, BEGIN and COMMIT included).
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
import { createBoardItem, moveBoardItem, updateBoardItem } from "@/lib/board-items";
import { updateBoard } from "@/lib/board";
import { moveToTrash, restoreFromTrash } from "@/lib/trash";
import { repairItemCompletions } from "@/lib/item-completions";
import { settleGoalPeriods } from "@/lib/goals/goal-periods.server";
import { connectorFor, countListSource } from "@/lib/goals/goal-source.server";
import { periodWindow } from "@/lib/goals/goal-source";
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
