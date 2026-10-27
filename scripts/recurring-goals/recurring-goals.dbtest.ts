// The locks of repeating goals on real Postgres (see vitest.db.config.mts),
// and the raw statements the in-memory suites stand in for (the batched
// lock, DISTINCT ON, FOR KEY SHARE, the unnest updates). Builds two
// throwaway organizations in Asia/Kolkata with monthly goals, and removes
// them afterwards. Needs both recurring-goals SQL files applied locally.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const LOCAL = /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1):5432\//;
if (!LOCAL.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("recurring-goals.dbtest refuses to run: DATABASE_URL is not the local database on port 5432 (use the URL from .env.local).");
}

vi.mock("server-only", () => ({}));

import { prisma } from "@/lib/prisma";
import { checkInRepeating, closeDuePeriods, GoalPeriodRefusal, settleGoalPeriods } from "@/lib/goals/goal-periods.server";

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ids = { org: "", user: "", org2: "", user2: "" };
/** An instant given as IST wall-clock time. */
const ist = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi) - 330 * 60_000);
const OCT_GRACE_END = ist(2026, 11, 6, 0, 0);

async function monthlyGoal(name: string, orgId = ids.org, userId = ids.user): Promise<{ okrId: string; krId: string }> {
  const okr = await prisma.oKR.create({
    data: {
      organizationId: orgId, title: `${name} ${suffix}`, level: "INDIVIDUAL", ownerId: userId,
      repeat: "MONTHLY", startDate: new Date("2026-10-01T00:00:00Z"), createdAt: ist(2026, 10, 5),
      keyResults: { create: [{ title: "Calls", startValue: 0, targetValue: 10, currentValue: 0, createdAt: ist(2026, 10, 5) }] },
    },
    select: { id: true, keyResults: { select: { id: true } } },
  });
  return { okrId: okr.id, krId: okr.keyResults[0].id };
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `RG ${suffix}`, slug: `rg-${suffix}`, settings: { timezone: "Asia/Kolkata" } } });
  ids.org = org.id;
  const u = await prisma.user.create({ data: { email: `rg-${suffix}@rg.test`, passwordHash: "x", firstName: "Rae", lastName: "Test", organizationId: org.id, accessLevel: "COMPANY_ADMIN" } });
  ids.user = u.id;
  // A second workspace, so the double close counts this one goal alone.
  const org2 = await prisma.organization.create({ data: { name: `RG2 ${suffix}`, slug: `rg2-${suffix}`, settings: { timezone: "Asia/Kolkata" } } });
  ids.org2 = org2.id;
  const u2 = await prisma.user.create({ data: { email: `rg2-${suffix}@rg.test`, passwordHash: "x", firstName: "Ray", lastName: "Test", organizationId: org2.id, accessLevel: "COMPANY_ADMIN" } });
  ids.user2 = u2.id;
});

afterAll(async () => {
  for (const id of [ids.org, ids.org2].filter(Boolean)) {
    await prisma.oKR.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup okr", e));
    await prisma.user.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup user", e));
    await prisma.organization.delete({ where: { id } }).catch((e) => console.error("cleanup org", e));
  }
  await prisma.$disconnect();
});

describe("repeating goals on Postgres", () => {
  it("ten settles at once make one period and one row per target", async () => {
    const g = await monthlyGoal("settle");
    const now = ist(2026, 10, 15);
    await Promise.all(Array.from({ length: 10 }, () => settleGoalPeriods(ids.org, [g.okrId], now)));
    expect(await prisma.goalPeriod.count({ where: { okrId: g.okrId } })).toBe(1);
    expect(await prisma.keyResultPeriod.count({ where: { keyResultId: g.krId } })).toBe(1);
  });

  it("a check-in racing the close lands before the freeze or gets the 409, never half of each", async () => {
    let landed = 0;
    let refused = 0;
    for (let i = 0; i < 12; i++) {
      const g = await monthlyGoal(`race-${i}`);
      await settleGoalPeriods(ids.org, [g.okrId], ist(2026, 10, 15));
      const oct = await prisma.goalPeriod.findFirstOrThrow({ where: { okrId: g.okrId }, select: { id: true } });
      // Half the runs start the close first, half the check-in.
      const close = () => closeDuePeriods(ids.org, OCT_GRACE_END);
      const checkIn = () => checkInRepeating({ orgId: ids.org, okrId: g.okrId, keyResultId: g.krId, value: 7, note: null, userId: ids.user, periodKey: "2026-10-01", now: new Date(OCT_GRACE_END.getTime() - 500) })
        .then(() => "landed" as const, (e) => { if (e instanceof GoalPeriodRefusal && e.status === 409) return "refused" as const; throw e; });
      const [a, b] = i % 2 === 0 ? await Promise.all([checkIn(), close()]) : await Promise.all([close(), checkIn()]);
      const outcome = typeof a === "string" ? a : (b as string);
      const period = await prisma.goalPeriod.findUniqueOrThrow({ where: { id: oct.id }, select: { status: true, progress: true } });
      const row = await prisma.keyResultPeriod.findFirstOrThrow({ where: { periodId: oct.id, keyResultId: g.krId }, select: { currentValue: true, frozenAt: true } });
      const checkIns = await prisma.kRCheckIn.count({ where: { periodId: oct.id } });
      expect(period.status).toBe("CLOSED");
      expect(row.frozenAt).not.toBeNull();
      if (outcome === "landed") {
        landed += 1;
        expect(checkIns).toBe(1);
        expect(row.currentValue).toBe(7);
        expect(period.progress).toBe(70);
      } else {
        refused += 1;
        expect(checkIns).toBe(0);
        expect(row.currentValue).toBe(0);
        expect(period.progress).toBe(0);
      }
    }
    console.log(`[recurring-goals.dbtest] race: ${landed} landed before the freeze, ${refused} got the 409`);
    expect(landed + refused).toBe(12);
  });

  it("a month opening for 60 goals runs the batched statements: one lock statement, DISTINCT ON, KEY SHARE, the unnest updates", async () => {
    const goals = [];
    for (let i = 0; i < 60; i++) goals.push(await monthlyGoal(`batch-${i}`, ids.org2, ids.user2));
    await settleGoalPeriods(ids.org2, goals.map((g) => g.okrId), ist(2026, 10, 15));
    // October's numbers, then November opens for all of them at once.
    for (const g of goals) {
      await checkInRepeating({ orgId: ids.org2, okrId: g.okrId, keyResultId: g.krId, value: 5, note: null, userId: ids.user2, now: ist(2026, 10, 20) });
    }
    const r = await settleGoalPeriods(ids.org2, goals.map((g) => g.okrId), ist(2026, 11, 2));
    expect(r.opened).toBe(60);
    // The mirror reset to November's start for every target in one statement.
    const krs = await prisma.keyResult.findMany({ where: { id: { in: goals.map((g) => g.krId) } }, select: { currentValue: true, progress: true } });
    expect(krs.every((k) => k.currentValue === 0 && k.progress === 0)).toBe(true);
    // And the stored status of all sixty in the batched write.
    const okrs = await prisma.oKR.findMany({ where: { id: { in: goals.map((g) => g.okrId) } }, select: { progress: true, status: true } });
    expect(okrs.every((o) => o.progress === 0 && o.status === "BEHIND")).toBe(true);
    await prisma.oKR.deleteMany({ where: { id: { in: goals.map((g) => g.okrId) } } });
  });

  it("two closes at once close the period once and patch its score once", async () => {
    const g = await monthlyGoal("close", ids.org2, ids.user2);
    await settleGoalPeriods(ids.org2, [g.okrId], ist(2026, 10, 15));
    const at = ist(2026, 11, 6, 0, 5);
    const [a, b] = await Promise.all([closeDuePeriods(ids.org2, at), closeDuePeriods(ids.org2, at)]);
    const oct = await prisma.goalPeriod.findFirstOrThrow({ where: { okrId: g.okrId, key: "2026-10-01" }, select: { status: true, scorePatchedAt: true } });
    expect(oct.status).toBe("CLOSED");
    expect(oct.scorePatchedAt).not.toBeNull();
    expect(a.closed + b.closed).toBe(1);
    expect(a.scorePatched + b.scorePatched).toBe(1);
  });
});
