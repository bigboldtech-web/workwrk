// Item completions (docs/plans/recurring-goals.md C4): one append-only row
// each time a task enters its List's done group, so a goal counted "by Done
// date" reads when work was really finished.
//
// WHY A ROW AND NOT Item.doneAt. A column holds one time per task: an "After
// completion" recurring task, done and reset to open in one save, would
// stamp and clear it at once, and a weekly report done four times in October
// would count zero; a task done, reopened and done again keeps only the last
// time; and updatedAt is no stand-in, since a reorder rewrites it. A row per
// completion has none of these.
//
// THE WRITERS. A row is written IN THE SAME TRANSACTION as the status write,
// whenever a task's status crosses from not done into its List's done group
// (isDoneStatus): updateBoardItem (every PATCH, the bulk route, automations,
// Ask AI, MCP), createBoardItem with a done status, moveBoardItem when the
// remapped status is done (its subtasks too), and updateBoard when a change
// of the List's status set puts tasks into the done group. A duplicate
// copies its source's latest completion (duplicateBoard, the task Duplicate);
// Trash keeps a task's completions in its snapshot and a restore brings them
// back. Crossing back out of done (reopened by a person) removes the latest
// row; the recurring roll-forward's own reset keeps it (`keep`), so each
// completion of an "After completion" task counts.
//
// `boardId` follows the task's home List: a move carries its rows, so a
// goal reads "completions of tasks now in these Lists" through the
// ("boardId", "doneAt") index.
//
// No foreign key to "Item" (as EndedSession has none to "User"): creating
// the table takes no lock on the busiest table in the product, and the
// nightly repair (repairItemCompletions) deletes rows whose task is gone.
// ItemCompletion rows are data plumbing, written whatever RECURRING_GOALS
// says (2.0), so the first period counted after it turns on has them.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { getBoardStatuses, isDoneStatus, type StatusOption } from "@/lib/board-items-shared";

/** The client a completion write goes through: the status write's transaction. */
export type CompletionDb = Pick<Prisma.TransactionClient, "itemCompletion">;

export interface CompletionRow {
  itemId: string;
  boardId: string;
  organizationId: string;
  /** The done status it entered. */
  status: string;
  doneAt: Date;
  actorId: string | null;
}

/**
 * What a status write does to a task's completions (pure): "enter" when it
 * crosses from not done into the done group, "leave" when it crosses back,
 * null otherwise. A move passes the two Lists' sets; every other write one.
 */
export function completionStep(
  before: { statuses: readonly StatusOption[]; status: string | null | undefined },
  after: { statuses: readonly StatusOption[]; status: string | null | undefined },
): "enter" | "leave" | null {
  const was = isDoneStatus(before.statuses, before.status ?? null);
  const now = isDoneStatus(after.statuses, after.status ?? null);
  if (!was && now) return "enter";
  if (was && !now) return "leave";
  return null;
}

/** Insert completion rows (no row for an empty list). */
export async function recordCompletions(db: CompletionDb, rows: readonly CompletionRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.itemCompletion.createMany({ data: rows.map((r) => ({ ...r })) });
}

/** A task reopened by a person: its LATEST completion goes, the earlier ones stay. */
export async function removeLatestCompletion(db: CompletionDb, itemId: string): Promise<void> {
  const latest = await db.itemCompletion.findFirst({ where: { itemId }, orderBy: { doneAt: "desc" }, select: { id: true } });
  if (latest) await db.itemCompletion.delete({ where: { id: latest.id } });
}

/** Many tasks out of done at once (a List's status set changed): each one's LATEST completion goes, in two statements. */
export async function removeLatestCompletions(db: CompletionDb, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const latest = await db.itemCompletion.findMany({
    where: { itemId: { in: [...new Set(itemIds)] } },
    orderBy: { doneAt: "desc" },
    distinct: ["itemId"],
    select: { id: true },
  });
  if (latest.length > 0) await db.itemCompletion.deleteMany({ where: { id: { in: latest.map((r) => r.id) } } });
}

/**
 * One status write's completion, in its transaction: a row at `now` on
 * "enter", the latest removed on "leave" unless `keep` (the roll-forward
 * resetting a task it just counted).
 */
export async function applyCompletionStep(
  db: CompletionDb,
  step: "enter" | "leave" | null,
  row: Omit<CompletionRow, "doneAt"> & { doneAt?: Date },
  opts: { keep?: boolean } = {},
): Promise<void> {
  if (step === "enter") await recordCompletions(db, [{ ...row, doneAt: row.doneAt ?? new Date() }]);
  else if (step === "leave" && !opts.keep) await removeLatestCompletion(db, row.itemId);
}

/** A List's status set, as the completion rule reads it. */
export async function boardStatusesOf(db: Pick<Prisma.TransactionClient, "board">, boardId: string): Promise<StatusOption[]> {
  const b = await db.board.findUnique({ where: { id: boardId }, select: { statuses: true } });
  return getBoardStatuses(b);
}

/**
 * A duplicate's completion: each copy takes its source's LATEST completion
 * (its done status and time), so a copy of a task done in September counts
 * in September, like its source, and a source with no row gives its copy
 * none. Two reads at most, whatever the number of copies.
 */
export async function copyLatestCompletions(
  db: CompletionDb,
  pairs: ReadonlyArray<{ fromItemId: string; toItemId: string; toBoardId: string; organizationId: string; actorId: string | null }>,
): Promise<void> {
  if (pairs.length === 0) return;
  const rows = await db.itemCompletion.findMany({
    where: { itemId: { in: [...new Set(pairs.map((p) => p.fromItemId))] } },
    orderBy: { doneAt: "desc" },
    select: { itemId: true, status: true, doneAt: true },
  });
  const latest = new Map<string, { status: string; doneAt: Date }>();
  for (const r of rows) if (!latest.has(r.itemId)) latest.set(r.itemId, { status: r.status, doneAt: r.doneAt });
  const out: CompletionRow[] = [];
  for (const p of pairs) {
    const l = latest.get(p.fromItemId);
    if (l) out.push({ itemId: p.toItemId, boardId: p.toBoardId, organizationId: p.organizationId, status: l.status, doneAt: l.doneAt, actorId: p.actorId });
  }
  await recordCompletions(db, out);
}

/** Every completion of these tasks, for a Trash snapshot. */
export async function completionsOf(db: CompletionDb, itemIds: readonly string[]): Promise<Array<Record<string, unknown>>> {
  if (itemIds.length === 0) return [];
  const rows = await db.itemCompletion.findMany({ where: { itemId: { in: [...itemIds] } } });
  return rows as unknown as Array<Record<string, unknown>>;
}

/**
 * A Trash restore's completions: the snapshot's rows back, each on the home
 * the task comes back to (`homeOf`, a "Restore to..." List), skipping any
 * still there (the repair has not run since the delete). A row skipped that
 * way still names the List the task was deleted from, so every row of the
 * restored tasks is then moved to its task's home: a goal reads completions
 * of tasks NOW in its Lists by that column.
 */
export async function restoreCompletions(
  db: CompletionDb,
  rows: ReadonlyArray<Record<string, unknown>>,
  homeOf: (itemId: string) => string | null,
): Promise<void> {
  const data = rows
    .filter((r) => typeof r.id === "string" && typeof r.itemId === "string" && r.doneAt != null)
    .map((r) => ({
      id: r.id as string,
      itemId: r.itemId as string,
      boardId: homeOf(r.itemId as string) ?? String(r.boardId),
      organizationId: String(r.organizationId),
      status: String(r.status),
      doneAt: new Date(r.doneAt as string),
      actorId: typeof r.actorId === "string" ? r.actorId : null,
    }));
  if (data.length === 0) return;
  await db.itemCompletion.createMany({ data, skipDuplicates: true });
  // One updateMany per home (a restore brings back one task, or a List's or
  // Space's tasks, a handful of homes at most).
  const byHome = new Map<string, Set<string>>();
  for (const d of data) {
    const ids = byHome.get(d.boardId) ?? new Set<string>();
    ids.add(d.itemId);
    byHome.set(d.boardId, ids);
  }
  for (const [boardId, ids] of byHome) {
    await db.itemCompletion.updateMany({ where: { itemId: { in: [...ids] }, boardId: { not: boardId } }, data: { boardId } });
  }
}

/** The clients the unarchive's completion reads and writes through. */
type UnarchiveDb = Pick<Prisma.TransactionClient, "itemCompletion" | "itemActivity" | "board">;

/**
 * A task UNARCHIVED in a done status (C4, step 4 review M2), in the
 * unarchive's transaction, by the backfill's rule
 * (scripts/backfill-item-completions.ts): one completion at its last
 * not-done-to-done STATUS_CHANGED activity, when it has none at or after
 * that moment; with no such activity, none (it was done before anything
 * could count it, and nothing is invented). A task archived while done
 * keeps its rows, and a status set change reaches archived tasks too, so
 * this catches only what neither left (a task archived before completions
 * existed, and not yet backfilled). True when it wrote one.
 */
export async function completionOnUnarchive(
  db: UnarchiveDb,
  item: { id: string; boardId: string; organizationId: string; status: string | null },
): Promise<boolean> {
  const statuses = await boardStatusesOf(db, item.boardId);
  if (!isDoneStatus(statuses, item.status)) return false;
  const changes = await db.itemActivity.findMany({
    where: { entityType: "BOARD_ITEM", entityId: item.id, action: "STATUS_CHANGED" },
    select: { action: true, meta: true, createdAt: true },
  });
  let last: Date | null = null;
  for (const a of changes) {
    const at = enteredDoneAt(a, statuses);
    if (at && (!last || at.getTime() > last.getTime())) last = at;
  }
  if (!last) return false;
  const latest = await db.itemCompletion.findFirst({ where: { itemId: item.id }, orderBy: { doneAt: "desc" }, select: { doneAt: true } });
  // A writer stamps its row a moment before the activity row is written.
  if (latest && latest.doneAt.getTime() >= last.getTime() - 60_000) return false;
  await recordCompletions(db, [{ itemId: item.id, boardId: item.boardId, organizationId: item.organizationId, status: item.status ?? "", doneAt: last, actorId: null }]);
  return true;
}

/* ───────────────────────── The nightly repair ───────────────────────── */

/** The repair looks this far back for a task that entered done without a row (two runs, so one missed run is still covered). */
export const REPAIR_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const PAGE = 2000;

/** The goal-periods cron's run that repairs: 20:35 UTC, 02:05 in Kolkata. */
export function isRepairRun(now: Date): boolean {
  return now.getUTCHours() === 20 && now.getUTCMinutes() >= 30;
}

/** Did this STATUS_CHANGED row put the task into done (pure)? Its time, or null. */
export function enteredDoneAt(
  a: { action: string; meta: unknown; createdAt: Date },
  statuses: readonly StatusOption[],
): Date | null {
  if (a.action !== "STATUS_CHANGED") return null;
  const m = a.meta && typeof a.meta === "object" && !Array.isArray(a.meta) ? (a.meta as Record<string, unknown>) : {};
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  return !isDoneStatus(statuses, s(m.from)) && isDoneStatus(statuses, s(m.to)) ? a.createdAt : null;
}

export interface RepairResult {
  /** Rows added for a task that entered done without one (a missed writer). */
  added: number;
  /** Rows deleted because their task is gone. */
  removed: number;
}

/**
 * The nightly repair (C4), for every workspace: (1) a task still in a done
 * status whose last not-done-to-done STATUS_CHANGED activity, in the last
 * two days, has no completion at or after it gets one at that activity's
 * time, and the count is logged so the writer that missed it gets fixed;
 * (2) rows whose task is gone are deleted (a task in Trash keeps its rows in
 * its snapshot). Only what the activity shows is added: a task done long
 * before any completion existed, or a copy of one (a duplicate copies its
 * source's row, and a source with none gives none), gets no row here, so
 * the repair can never stamp old work as finished tonight. The one-time
 * backfill (scripts/backfill-item-completions.ts) decides the old ones.
 * `organizationId` keeps a run to one workspace (the live proof); the cron
 * runs it for all.
 */
export async function repairItemCompletions(now: Date = new Date(), opts: { organizationId?: string } = {}): Promise<RepairResult> {
  const since = new Date(now.getTime() - REPAIR_LOOKBACK_MS);
  let added = 0;
  let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const page: Array<{ id: string; entityId: string; action: string; meta: unknown; createdAt: Date }> = await prisma.itemActivity.findMany({
      where: {
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        entityType: "BOARD_ITEM",
        action: "STATUS_CHANGED",
        createdAt: { gte: since, lte: now },
        ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: PAGE,
      select: { id: true, entityId: true, action: true, meta: true, createdAt: true },
    });
    if (page.length === 0) break;
    cursor = { createdAt: page[page.length - 1].createdAt, id: page[page.length - 1].id };
    added += await repairPage(page);
    if (page.length < PAGE) break;
  }
  const removed = await deleteOrphans(opts.organizationId ?? null);
  if (added > 0) console.warn(`[item-completions] the repair added ${added} completion${added === 1 ? "" : "s"} a status writer missed`);
  return { added, removed };
}

async function repairPage(page: ReadonlyArray<{ entityId: string; action: string; meta: unknown; createdAt: Date }>): Promise<number> {
  const ids = [...new Set(page.map((a) => a.entityId))];
  const items = await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, boardId: true, organizationId: true, board: { select: { statuses: true } } } });
  const itemById = new Map(items.map((i) => [i.id, i]));
  // The latest moment each task, still done now, entered done.
  const entered = new Map<string, Date>();
  for (const a of page) {
    const it = itemById.get(a.entityId);
    if (!it) continue;
    const statuses = getBoardStatuses(it.board);
    if (!isDoneStatus(statuses, it.status)) continue;
    const at = enteredDoneAt(a, statuses);
    if (at && (!entered.has(it.id) || entered.get(it.id)!.getTime() < at.getTime())) entered.set(it.id, at);
  }
  if (entered.size === 0) return 0;
  const latest = await prisma.itemCompletion.findMany({
    where: { itemId: { in: [...entered.keys()] } },
    orderBy: { doneAt: "desc" },
    distinct: ["itemId"],
    select: { itemId: true, doneAt: true },
  });
  const lastOf = new Map(latest.map((c) => [c.itemId, c.doneAt]));
  const rows: CompletionRow[] = [];
  for (const [itemId, at] of entered) {
    const last = lastOf.get(itemId);
    // A writer stamps its row a moment before the activity row is written.
    if (last && last.getTime() >= at.getTime() - 60_000) continue;
    const it = itemById.get(itemId)!;
    rows.push({ itemId, boardId: it.boardId, organizationId: it.organizationId, status: it.status ?? "", doneAt: at, actorId: null });
  }
  await recordCompletions(prisma, rows);
  return rows.length;
}

/** Rows whose task no longer exists (in one workspace, or all), deleted in batches. */
async function deleteOrphans(organizationId: string | null): Promise<number> {
  let removed = 0;
  for (;;) {
    const gone = organizationId
      ? await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT c."id" FROM "ItemCompletion" c
          WHERE c."organizationId" = ${organizationId} AND NOT EXISTS (SELECT 1 FROM "Item" i WHERE i."id" = c."itemId")
          LIMIT 5000`
      : await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT c."id" FROM "ItemCompletion" c
          WHERE NOT EXISTS (SELECT 1 FROM "Item" i WHERE i."id" = c."itemId")
          LIMIT 5000`;
    if (gone.length === 0) break;
    const r = await prisma.itemCompletion.deleteMany({ where: { id: { in: gone.map((g) => g.id) } } });
    removed += r.count;
    if (gone.length < 5000) break;
  }
  return removed;
}
