// The review of the final fix runs on real Postgres (see
// vitest.db.config.mts), for what the in-memory store only plays:
//   - M2: a status set round trip gives a done task that had no completion
//     (a copy, a dateless import) none back, through the set-aside row's
//     `none`, written in the status set's own transaction;
//   - L3: the backfill's page reads its Lists' status sets FOR SHARE, so it
//     waits for a status set change in flight and judges the task by the set
//     that change commits, never by the set read when the run started; and
//     a page that loses a deadlock to a move of a subtask (which locks it
//     before its own subtask of a lower id) is rolled back and tried again.
// The default suite proves the rest (src/lib/goals/goal-fixes-review.test.ts).
//
// Run it (the local URL only, as vitest.db.config.mts says):
//   DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" TZ=UTC \
//     npx vitest run --config scripts/recurring-goals/vitest.db.config.mts scripts/recurring-goals/fixes-review.dbtest.ts
//
// Needs the recurring goals SQL files applied locally (the fixes add no
// SQL). Builds one throwaway organization and removes it after.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const LOCAL = /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1):5432\//;
if (!LOCAL.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("fixes-review.dbtest refuses to run: DATABASE_URL is not the local database on port 5432 (use the URL from .env.local).");
}

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { prisma } from "@/lib/prisma";
import { createBoardItem } from "@/lib/board-items";
import { updateBoard } from "@/lib/board";
import { isDeadlock } from "@/lib/access/org-roles-busy";
import { writePage } from "../backfill-item-completions";

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ids = { org: "", user: "", qa: "", review: "", tree: "" };
const completionsOf = (itemId: string) => prisma.itemCompletion.findMany({ where: { itemId }, orderBy: { doneAt: "asc" } });
const set = (verified: "ACTIVE" | "DONE") => [{ value: "OPEN", label: "Open", color: "#999", group: "ACTIVE" as const }, { value: "VERIFIED", label: "Verified", color: "#090", group: verified }];
const TX = { timeout: 20_000, maxWait: 10_000 };

async function list(name: string): Promise<string> {
  const b = await prisma.board.create({ data: { organizationId: ids.org, name, slug: `${name.toLowerCase()}-${suffix}`, itemType: "studio-item", ownerId: ids.user } });
  return b.id;
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `FX ${suffix}`, slug: `fx-${suffix}`, settings: { timezone: "Asia/Kolkata" } } });
  ids.org = org.id;
  const u = await prisma.user.create({ data: { email: `fran-${suffix}@fx.test`, passwordHash: "x", firstName: "Fran", lastName: "Test", organizationId: ids.org, accessLevel: "COMPANY_ADMIN" } });
  ids.user = u.id;
  ids.qa = await list("QA");
  ids.review = await list("Review");
  ids.tree = await list("Tree");
});

afterAll(async () => {
  if (ids.org) {
    await prisma.itemCompletion.deleteMany({ where: { organizationId: ids.org } }).catch((e) => console.error("cleanup completions", e));
    await prisma.item.deleteMany({ where: { organizationId: ids.org } }).catch((e) => console.error("cleanup items", e));
    await prisma.itemActivity.deleteMany({ where: { organizationId: ids.org } }).catch((e) => console.error("cleanup activity", e));
    await prisma.board.deleteMany({ where: { organizationId: ids.org } }).catch((e) => console.error("cleanup boards", e));
    await prisma.user.deleteMany({ where: { organizationId: ids.org } }).catch((e) => console.error("cleanup users", e));
    await prisma.organization.delete({ where: { id: ids.org } }).catch((e) => console.error("cleanup org", e));
  }
  await prisma.$disconnect();
});

/** A task done in `status` with no completion, as a copy, a dateless import or work from before completions is. */
async function doneWithout(boardId: string, title: string, status: string): Promise<string> {
  const t = await createBoardItem({ organizationId: ids.org, boardId, title, status: "OPEN", actorId: ids.user });
  await prisma.item.update({ where: { id: t.id }, data: { status } });
  await prisma.itemCompletion.deleteMany({ where: { itemId: t.id } });
  return t.id;
}

describe("the fixes review on Postgres", () => {
  it("M2: a status set round trip gives a done task with no completion none back", async () => {
    await updateBoard(ids.qa, { statuses: set("DONE") });
    const t = await doneWithout(ids.qa, "Copied", "VERIFIED");
    await updateBoard(ids.qa, { statuses: set("ACTIVE") });
    const aside = await prisma.itemActivity.findMany({ where: { organizationId: ids.org, entityType: "BOARD_STATUS_SET", entityId: ids.qa } });
    expect(aside.map((a) => a.meta)).toEqual([{ completions: [], none: [{ itemId: t, status: "VERIFIED" }] }]);
    await updateBoard(ids.qa, { statuses: set("DONE") });
    expect(await completionsOf(t)).toHaveLength(0);
  });

  it("L3: the backfill's page waits for a status set change in flight and judges the task by the set it commits", async () => {
    await updateBoard(ids.review, { statuses: set("DONE") });
    const t = await doneWithout(ids.review, "Verified", "VERIFIED");
    const planned = [{ itemId: t, boardId: ids.review, organizationId: ids.org, status: "VERIFIED", doneAt: new Date("2026-09-15T06:30:00.000Z"), actorId: null as null }];
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => { locked = r; });
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    // A status set change in flight, as updateBoard makes it: the List FOR UPDATE, Verified made not done, not yet committed.
    const change = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Board" WHERE id = ${ids.review} FOR UPDATE`;
      await tx.board.update({ where: { id: ids.review }, data: { statuses: set("ACTIVE") } });
      locked();
      await held;
    }, TX);
    await isLocked;
    const writing = writePage(prisma, planned);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await change;
    expect(await writing).toEqual({ written: 0, changedSince: 1 });
    expect(await completionsOf(t)).toHaveLength(0);
  });

  it("L3: a page that loses a deadlock to a move of a subtask is rolled back and tried again", async () => {
    const top = await createBoardItem({ organizationId: ids.org, boardId: ids.tree, title: "Top", actorId: ids.user });
    const [low, high] = [await doneWithout(ids.tree, "A", "DONE"), await doneWithout(ids.tree, "B", "DONE")].sort();
    // `high` is a subtask of Top and `low` a subtask of `high`: a move of `high` locks it, then its subtask `low`.
    await prisma.item.update({ where: { id: high }, data: { parentItemId: top.id } });
    await prisma.item.update({ where: { id: low }, data: { parentItemId: high } });
    const planned = [low, high].map((itemId) => ({ itemId, boardId: ids.tree, organizationId: ids.org, status: "DONE", doneAt: new Date("2026-09-15T06:30:00.000Z"), actorId: null as null }));
    let holding!: () => void;
    const holdsHigh = new Promise<void>((r) => { holding = r; });
    // The move: its task FOR UPDATE; then, once the page holds `low` and waits for `high`, its subtask.
    const move = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${high} FOR UPDATE`;
      holding();
      await new Promise((r) => setTimeout(r, 300));
      await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${low} FOR UPDATE`;
    }, TX).then(() => "committed", (e) => (isDeadlock(e) ? "lost" : Promise.reject(e)));
    await holdsHigh;
    const writing = writePage(prisma, planned);
    // The page waited first, so Postgres breaks the cycle by ending the page's
    // first try: the move commits, and the page, tried again, writes both.
    expect(await move).toBe("committed");
    expect(await writing).toEqual({ written: 2, changedSince: 0 });
    expect(await completionsOf(low)).toHaveLength(1);
    expect(await completionsOf(high)).toHaveLength(1);
  });
});
