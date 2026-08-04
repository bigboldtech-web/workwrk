// Recurring tasks — server logic behind the "Set Recurring" panel.
//
// A rule lives on the SERIES ANCHOR task (Item.recurRule) with an optional
// Item.recurNextAt spawn time. How the series advances depends on the rule:
//
//   trigger   SCHEDULE     — the hourly cron (recurNextAt) advances it.
//             ON_COMPLETE  — marking the task done advances it (recurNextAt null).
//
//   createNew true  — a fresh copy (+ subtasks) is spawned each cycle.
//             false — the SAME task rolls forward (dates advance, status resets).
//
//   forever/count/until — a non-forever series stops once its occurrences run
//             out; the rule (and recurNextAt) are cleared on the last cycle.
//
//   resetStatus — the status the new/rolled task lands in (else first open).
//   syncDue     — when false, dates are kept in place instead of shifted.

import { prisma } from "@/lib/prisma";
import { createBoardItem, updateBoardItem, type BoardItemRow } from "@/lib/board-items";
import { getBoardStatuses, type StatusOption } from "@/lib/board-items-shared";
import { parseRecurrence, advanceDate, seriesEnded, type RecurrenceRule } from "@/lib/recurrence";

// A clone starts fresh: uncheck any checklist and drop legacy recurrence state.
function cloneMetadata(md: unknown): Record<string, unknown> {
  const src = md && typeof md === "object" ? { ...(md as Record<string, unknown>) } : {};
  delete src.recurrence; // legacy completion-model key, never carried onto copies
  const cl = src.checklist;
  if (Array.isArray(cl)) {
    src.checklist = cl.map((c) =>
      c && typeof c === "object" ? { ...(c as Record<string, unknown>), checked: false, done: false } : c,
    );
  }
  return src;
}

async function tagIdsFor(itemId: string): Promise<string[]> {
  const rows = await prisma.tagAssignment.findMany({
    where: { entityType: "BOARD_ITEM", entityId: itemId },
    select: { tagId: true },
  });
  return rows.map((r) => r.tagId);
}

/** First open status on the board, or `wanted` when it's a real status value. */
function resolveStatus(statuses: StatusOption[], wanted: string | null | undefined): string {
  if (wanted && statuses.some((s) => s.value === wanted)) return wanted;
  return (statuses.find((s) => s.group === "ACTIVE") ?? statuses[0])?.value ?? "TO_DO";
}

/** Is `status` in the board's DONE group? (Drives the ON_COMPLETE trigger.) */
export function isDoneGroupStatus(statuses: StatusOption[], status: string | null): boolean {
  return !!status && statuses.find((s) => s.value === status)?.group === "DONE";
}

type CloneSrc = {
  id: string; boardId: string; title: string; ownerId: string | null;
  priority: string | null; itemTypeId: string | null; metadata: unknown;
  startAt: Date | null; dueAt: Date | null;
};

/**
 * Deep-clone an item + its subtask subtree as a fresh task.
 * `cycleDue` is the due date for the new occurrence; every date in the tree is
 * shifted by the same delta so subtask spacing is preserved. The root lands in
 * `rootStatus` (children in the board's first open status). When `carryRule` is
 * given the new root becomes the series anchor (its recurRule is set), used by
 * the ON_COMPLETE + create-new flow where the series hops to the fresh copy.
 * Returns the new root id, or null if the source is gone.
 */
export async function cloneItemTree(
  rootId: string,
  cycleDue: Date,
  actorId: string | null = null,
  rootStatus: string | null = null,
  carryRule: RecurrenceRule | null = null,
): Promise<string | null> {
  const root = await prisma.item.findUnique({
    where: { id: rootId },
    include: { board: { select: { statuses: true } } },
  });
  if (!root) return null;

  const statuses = getBoardStatuses(root.board);
  const firstOpen = resolveStatus(statuses, null);
  const rootResolved = resolveStatus(statuses, rootStatus);
  const anchor = root.dueAt ?? root.startAt ?? null;
  const delta = anchor ? cycleDue.getTime() - anchor.getTime() : 0;
  const shift = (d: Date | null): Date | null => (d ? new Date(d.getTime() + delta) : null);

  const cloneOne = async (src: CloneSrc, newParentId: string | null): Promise<string> => {
    const created = await createBoardItem({
      organizationId: root.organizationId,
      boardId: src.boardId,
      title: src.title,
      status: newParentId === null ? rootResolved : firstOpen,
      ownerId: src.ownerId ?? undefined,
      metadata: cloneMetadata(src.metadata),
      startAt: shift(src.startAt),
      dueAt: shift(src.dueAt),
      priority: src.priority ?? null,
      itemTypeId: src.itemTypeId ?? null,
      parentItemId: newParentId,
      tagIds: await tagIdsFor(src.id),
      actorId,
    });
    if (newParentId === null && carryRule) {
      // The fresh copy becomes the anchor (ON_COMPLETE series hop). recurNextAt
      // stays null — a completion, not the cron, fires the next occurrence.
      await updateBoardItem(created.id, { recurRule: carryRule as unknown as Record<string, unknown>, recurNextAt: null }, actorId);
    }
    const children = await prisma.item.findMany({
      where: { parentItemId: src.id, archivedAt: null },
      orderBy: { position: "asc" },
    });
    for (const child of children) await cloneOne(child, created.id);
    return created.id;
  };

  return cloneOne(root, null);
}

type AnchorWithBoard = {
  id: string; startAt: Date | null; dueAt: Date | null;
  board: { statuses: unknown } | null;
};

/** Roll the SAME task forward one cycle: advance its dates (unless syncDue is
 *  off), reset its status, and write the (decremented / cleared) rule. Returns
 *  the updated row so the caller can hand it straight back to the client. */
async function rollAnchorForward(
  anchor: AnchorWithBoard,
  statuses: StatusOption[],
  rule: RecurrenceRule,
  nextRule: RecurrenceRule | null,
  actorId: string | null,
): Promise<BoardItemRow> {
  const doShift = rule.syncDue !== false;
  const oldAnchorDate = anchor.dueAt ?? anchor.startAt ?? new Date();
  const delta = doShift ? advanceDate(oldAnchorDate, rule).getTime() - new Date(oldAnchorDate).getTime() : 0;
  const shift = (d: Date | null): Date | null => (d ? new Date(d.getTime() + delta) : null);
  return updateBoardItem(anchor.id, {
    status: resolveStatus(statuses, rule.resetStatus),
    startAt: shift(anchor.startAt),
    dueAt: shift(anchor.dueAt),
    recurRule: nextRule as unknown as Record<string, unknown> | null,
    recurNextAt: null,
  }, actorId);
}

/** Given a rule and the cycle it's about to run, compute the decremented count
 *  and whether this is the final occurrence. */
function stepSeries(rule: RecurrenceRule, nextCycle: Date): { nextRule: RecurrenceRule | null; ended: boolean } {
  const newCount = rule.forever === false && typeof rule.count === "number" ? rule.count - 1 : rule.count;
  const ended = seriesEnded(rule, nextCycle) || (rule.forever === false && typeof newCount === "number" && newCount <= 0);
  return { nextRule: ended ? null : { ...rule, count: newCount ?? null }, ended };
}

/**
 * Marking a task done advanced its ON_COMPLETE series. Returns the rolled-forward
 * row (create-new=false) so the client can update in place, or recurred=false
 * (create-new=true) after spawning a fresh copy that carries the series.
 */
export async function advanceSeriesOnComplete(
  itemId: string,
  newStatus: string | null,
  actorId: string | null,
): Promise<{ recurred: boolean; item?: BoardItemRow }> {
  const anchor = await prisma.item.findUnique({
    where: { id: itemId },
    include: { board: { select: { statuses: true } } },
  });
  if (!anchor) return { recurred: false };
  const rule = parseRecurrence(anchor.recurRule);
  if (!rule || (rule.trigger ?? "SCHEDULE") !== "ON_COMPLETE") return { recurred: false };

  const statuses = getBoardStatuses(anchor.board);
  if (!isDoneGroupStatus(statuses, newStatus)) return { recurred: false };

  const base = anchor.dueAt ?? anchor.startAt ?? new Date();
  const nextDue = advanceDate(base, rule);
  const { nextRule } = stepSeries(rule, nextDue);

  if (rule.createNew === false) {
    const rolled = await rollAnchorForward(anchor, statuses, rule, nextRule, actorId);
    return { recurred: true, item: rolled };
  }

  // create-new: spawn the next occurrence (carrying the series when it continues)
  // and strip the rule off the just-completed task so it stays done.
  const cycleDue = rule.syncDue === false ? (anchor.dueAt ?? nextDue) : nextDue;
  await cloneItemTree(anchor.id, cycleDue, actorId, rule.resetStatus ?? null, nextRule);
  await updateBoardItem(anchor.id, { recurRule: null, recurNextAt: null }, actorId);
  return { recurred: false };
}

/**
 * Spawn/advance the current cycle for every SCHEDULE anchor whose recurNextAt is
 * due. Fast-forwards past missed cycles (at most one action per anchor per run)
 * so a lapsed cron never floods the list. Safe to run concurrently: the claim is
 * an optimistic updateMany on the exact recurNextAt value.
 */
export async function spawnDueRecurringTasks(
  now: Date = new Date(),
  limit = 200,
): Promise<{ anchors: number; spawned: number }> {
  const due = await prisma.item.findMany({
    where: { archivedAt: null, recurNextAt: { not: null, lte: now } },
    include: { board: { select: { statuses: true } } },
    take: limit,
  });

  let spawned = 0;
  for (const anchor of due) {
    const rule = parseRecurrence(anchor.recurRule);
    if (!rule || !anchor.recurNextAt) continue;
    if ((rule.trigger ?? "SCHEDULE") !== "SCHEDULE") continue; // ON_COMPLETE never uses the cron

    // The cycle to run now = latest occurrence <= now; the next spawn time =
    // the first occurrence strictly after now.
    let cycleDue = new Date(anchor.recurNextAt);
    let nextAt = advanceDate(cycleDue, rule);
    for (let i = 0; i < 10000 && nextAt.getTime() <= now.getTime(); i++) {
      cycleDue = nextAt;
      nextAt = advanceDate(nextAt, rule);
    }

    const { nextRule, ended } = stepSeries(rule, nextAt);
    const statuses = getBoardStatuses(anchor.board);

    // Claim by advancing recurNextAt from the exact value we read. If another
    // worker already advanced it, count is 0 and we skip (no double-run). The
    // rule bookkeeping (decrement/clear) is persisted just after via the safe
    // updateBoardItem wrapper, which handles nullable-Json correctly.
    const claim = await prisma.item.updateMany({
      where: { id: anchor.id, recurNextAt: anchor.recurNextAt },
      data: { recurNextAt: ended ? null : nextAt },
    });
    if (claim.count !== 1) continue;

    try {
      if (rule.createNew === false) {
        // Roll the same anchor forward (dates + status), keeping its schedule,
        // and persist the stepped/cleared rule in the same write.
        const doShift = rule.syncDue !== false;
        const oldAnchorDate = anchor.dueAt ?? anchor.startAt ?? cycleDue;
        const delta = doShift ? cycleDue.getTime() - new Date(oldAnchorDate).getTime() : 0;
        const shift = (d: Date | null): Date | null => (d ? new Date(d.getTime() + delta) : null);
        await updateBoardItem(anchor.id, {
          status: resolveStatus(statuses, rule.resetStatus),
          startAt: shift(anchor.startAt),
          dueAt: shift(anchor.dueAt),
          recurRule: ended ? null : (nextRule as unknown as Record<string, unknown>),
        }, null);
      } else {
        await cloneItemTree(anchor.id, cycleDue, null, rule.resetStatus ?? null);
        // Copy carries no rule; the anchor keeps recurring. Persist the step.
        await updateBoardItem(anchor.id, { recurRule: ended ? null : (nextRule as unknown as Record<string, unknown>) }, null);
      }
      spawned++;
    } catch (e) {
      console.error("spawnDueRecurringTasks: cycle failed for", anchor.id, e);
    }
  }

  return { anchors: due.length, spawned };
}
