// The final review of repeating goals on real Postgres (see
// vitest.db.config.mts), for what the in-memory store only plays:
//   - data M4: a status set round trip on a List keeps its tasks' real
//     completion dates, through the set-aside activity row written in the
//     status set's own transaction (the List's row FOR UPDATE);
//   - privacy M1: the people who still work in a workspace (liveRecipients)
//     read through inWorkspaceWhere, the anchored row OR a membership: a
//     person anchored elsewhere with a membership here counts, one with none
//     does not, and a deactivated one never;
//   - data L5: the backfill's page write locks its tasks FOR UPDATE (= ANY)
//     and waits for a status write in flight, then skips the task it reopened;
//   - data M6: the closer's dead-man count reads OPEN periods more than two
//     hours past their close, and not one an hour past.
// The default suite proves the rest (src/lib/goals/goal-final-review.test.ts).
//
// Run it (the local URL only, as vitest.db.config.mts says):
//   DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" TZ=UTC \
//     npx vitest run --config scripts/recurring-goals/vitest.db.config.mts scripts/recurring-goals/final-review.dbtest.ts
//
// Needs the recurring goals SQL files applied locally (the final review adds
// no SQL). Builds two throwaway organizations and removes them after.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const LOCAL = /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1):5432\//;
if (!LOCAL.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("final-review.dbtest refuses to run: DATABASE_URL is not the local database on port 5432 (use the URL from .env.local).");
}

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { prisma } from "@/lib/prisma";
import { createBoardItem } from "@/lib/board-items";
import { updateBoard } from "@/lib/board";
import { liveRecipients } from "@/lib/goals/goal-period-notify.server";
import { staleCloseCount } from "@/lib/goals/goal-periods.server";
import { writePage } from "../backfill-item-completions";

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ids = { org: "", org2: "", user: "", member: "", stranger: "", gone: "", board: "" };
const completionsOf = (itemId: string) => prisma.itemCompletion.findMany({ where: { itemId }, orderBy: { doneAt: "asc" } });

async function person(orgId: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const u = await prisma.user.create({ data: { email: `${name.toLowerCase()}-${suffix}@fr.test`, passwordHash: "x", firstName: name, lastName: "Test", organizationId: orgId, ...extra } });
  return u.id;
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `FR ${suffix}`, slug: `fr-${suffix}`, settings: { timezone: "Asia/Kolkata" } } });
  const org2 = await prisma.organization.create({ data: { name: `FR2 ${suffix}`, slug: `fr2-${suffix}`, settings: { timezone: "Asia/Kolkata" } } });
  ids.org = org.id;
  ids.org2 = org2.id;
  ids.user = await person(ids.org, "Fran", { accessLevel: "COMPANY_ADMIN" });
  ids.member = await person(ids.org, "Mia");
  ids.stranger = await person(ids.org, "Sid");
  ids.gone = await person(ids.org2, "Gus", { status: "INACTIVE" });
  await prisma.organizationMembership.create({ data: { userId: ids.member, organizationId: ids.org2, role: "EMPLOYEE" } });
  const b = await prisma.board.create({ data: { organizationId: ids.org, name: "QA", slug: `qa-${suffix}`, itemType: "studio-item", ownerId: ids.user } });
  ids.board = b.id;
});

afterAll(async () => {
  for (const id of [ids.org, ids.org2].filter(Boolean)) {
    await prisma.itemCompletion.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup completions", e));
    await prisma.oKR.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup okr", e));
    await prisma.item.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup items", e));
    await prisma.itemActivity.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup activity", e));
    await prisma.board.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup boards", e));
    await prisma.organizationMembership.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup memberships", e));
  }
  for (const id of [ids.org, ids.org2].filter(Boolean)) {
    await prisma.user.deleteMany({ where: { organizationId: id } }).catch((e) => console.error("cleanup users", e));
    await prisma.organization.delete({ where: { id } }).catch((e) => console.error("cleanup org", e));
  }
  await prisma.$disconnect();
});

describe("the final review on Postgres", () => {
  it("data M4: a status set round trip restores each task's real completion date from the set-aside row", async () => {
    const set = (g: "ACTIVE" | "DONE") => [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" as const }, { value: "VERIFIED", label: "Verified", color: "#090", group: g }];
    await updateBoard(ids.board, { statuses: set("DONE") });
    const t = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "Verified", status: "VERIFIED", actorId: ids.user });
    const real = new Date("2026-10-03T06:30:00.000Z");
    await prisma.itemCompletion.updateMany({ where: { itemId: t.id }, data: { doneAt: real } });
    await updateBoard(ids.board, { statuses: set("ACTIVE") });
    expect(await completionsOf(t.id)).toHaveLength(0);
    const aside = await prisma.itemActivity.findMany({ where: { organizationId: ids.org, entityType: "BOARD_STATUS_SET", entityId: ids.board } });
    expect(aside).toHaveLength(1);
    await updateBoard(ids.board, { statuses: set("DONE") });
    expect((await completionsOf(t.id)).map((c) => c.doneAt.toISOString())).toEqual([real.toISOString()]);
  });

  it("privacy M1: who still works in a workspace, read through the anchored row or a membership", async () => {
    expect([...(await liveRecipients(ids.org2, [ids.member, ids.stranger, ids.gone, null]))]).toEqual([ids.member]);
    expect([...(await liveRecipients(ids.org, [ids.user, ids.member, ids.stranger]))].sort()).toEqual([ids.user, ids.member, ids.stranger].sort());
  });

  it("data L5: the backfill's page write waits for a status write holding the task, then skips the task it reopened", async () => {
    const kept = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "Kept", actorId: ids.user });
    const racing = await createBoardItem({ organizationId: ids.org, boardId: ids.board, title: "Racing", actorId: ids.user });
    // Both done with no completion, as tasks from before ItemCompletion were.
    await prisma.item.updateMany({ where: { id: { in: [kept.id, racing.id] } }, data: { status: "DONE" } });
    await prisma.itemCompletion.deleteMany({ where: { itemId: { in: [kept.id, racing.id] } } });
    const planned = [kept.id, racing.id].map((itemId) => ({ itemId, boardId: ids.board, organizationId: ids.org, status: "DONE", doneAt: new Date("2026-09-15T06:30:00.000Z"), actorId: null as null }));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => { locked = r; });
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    // A status write in flight: the task's row FOR UPDATE, reopened, not yet committed.
    const reopen = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${racing.id} FOR UPDATE`;
      await tx.item.update({ where: { id: racing.id }, data: { status: "TO_DO" } });
      locked();
      await held;
    }, { timeout: 20_000, maxWait: 10_000 });
    await isLocked;
    const writing = writePage(prisma, planned);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await reopen;
    expect(await writing).toEqual({ written: 1, changedSince: 1 });
    expect(await completionsOf(kept.id)).toHaveLength(1);
    expect(await completionsOf(racing.id)).toHaveLength(0);
  });

  it("data M6: the dead-man count reads OPEN periods more than two hours past their close", async () => {
    const now = new Date();
    const before = await staleCloseCount(now);
    const g = await prisma.oKR.create({ data: { organizationId: ids.org, title: `Stuck ${suffix}`, level: "INDIVIDUAL", ownerId: ids.user, repeat: "MONTHLY", startDate: new Date("2026-09-01T00:00:00.000Z") } });
    const period = (key: string, closesAt: Date) => ({
      okrId: g.id, organizationId: ids.org, key, cadence: "MONTHLY", startsAt: new Date(`${key}T00:00:00.000Z`), endsAt: new Date(closesAt.getTime() - 86_400_000),
      trackedFrom: new Date(`${key}T00:00:00.000Z`), graceEndsAt: closesAt, closesAt, status: "OPEN",
    });
    await prisma.goalPeriod.createMany({ data: [period("2026-08-01", new Date(now.getTime() - 3 * 3_600_000)), period("2026-09-01", new Date(now.getTime() - 3_600_000))] });
    expect(await staleCloseCount(now)).toBe(before + 1);
  });
});
