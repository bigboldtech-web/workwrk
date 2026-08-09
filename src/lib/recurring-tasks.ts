// Recurring tasks — server logic behind the "Set Recurring" panel.
//
// A rule lives on the SERIES ANCHOR task (Item.recurRule) with an optional
// Item.recurNextAt spawn time. Two spec modes (what the new UI writes):
//
//   "On schedule"   (trigger SCHEDULE, createNew true) — the cron spawns a NEW
//        task per occurrence. Prior instances are never touched: done stays
//        done, open stays overdue. Spawning is idempotent: the anchor records
//        metadata.lastSpawnedKey and every copy carries
//        metadata.recurrenceSourceId + metadata.recurrenceKey; catch-up after
//        an outage is capped at 7 occurrences (older keys recorded in
//        metadata.skippedOccurrences).
//
//   "After completion" (trigger ON_COMPLETE, createNew false) — marking the
//        task done rolls ITS dates forward to the next occurrence. No new rows.
//
// Two legacy combos keep their original engine branches so stored rules never
// change behavior: SCHEDULE+createNew=false (cron rolls the same row) and
// ON_COMPLETE+createNew=true (completion spawns a copy that carries the series).
//
//   forever/count/until — a non-forever series stops once its occurrences run
//        out; the rule (and recurNextAt) are cleared on the last cycle.
//   resetStatus — the status the new/rolled task lands in (else first open).
//   syncDue     — legacy flag: when false, dates are kept in place on roll.

import { prisma } from "@/lib/prisma";
import { createBoardItem, updateBoardItem, type BoardItemRow } from "@/lib/board-items";
import { getBoardStatuses, type StatusOption } from "@/lib/board-items-shared";
import {
  parseRecurrence, advanceDate, seriesEnded, occurrenceKey, occurrencesSince,
  nextOccurrenceAfter, type RecurrenceRule,
} from "@/lib/recurrence";

// A clone starts fresh: uncheck any checklist and drop recurrence bookkeeping
// (legacy wrapper + anchor spawn state + any stale per-copy stamps — the root
// copy is re-stamped by the caller when it is a spawned occurrence).
function cloneMetadata(md: unknown): Record<string, unknown> {
  const src = md && typeof md === "object" ? { ...(md as Record<string, unknown>) } : {};
  delete src.recurrence; // legacy completion-model key, never carried onto copies
  delete src.lastSpawnedKey;
  delete src.skippedOccurrences;
  delete src.recurrenceSourceId;
  delete src.recurrenceKey;
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
 * When `occurrence` is given (schedule-mode spawns) the root copy is stamped
 * with metadata.recurrenceSourceId + metadata.recurrenceKey and its dueAt is
 * pinned to `cycleDue` (idempotency + spec: dueAt = the occurrence date).
 * Returns the new root id, or null if the source is gone.
 */
export async function cloneItemTree(
  rootId: string,
  cycleDue: Date,
  actorId: string | null = null,
  rootStatus: string | null = null,
  carryRule: RecurrenceRule | null = null,
  occurrence: { sourceId: string; key: string } | null = null,
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
    const isRoot = newParentId === null;
    const metadata = cloneMetadata(src.metadata);
    if (isRoot && occurrence) {
      metadata.recurrenceSourceId = occurrence.sourceId;
      metadata.recurrenceKey = occurrence.key;
    }
    const created = await createBoardItem({
      organizationId: root.organizationId,
      boardId: src.boardId,
      title: src.title,
      status: isRoot ? rootResolved : firstOpen,
      ownerId: src.ownerId ?? undefined,
      metadata,
      startAt: shift(src.startAt),
      // Spec: a spawned occurrence's due date IS the occurrence date (covers
      // anchors with no due date, where delta is 0).
      dueAt: isRoot && occurrence ? cycleDue : shift(src.dueAt),
      priority: src.priority ?? null,
      itemTypeId: src.itemTypeId ?? null,
      parentItemId: newParentId,
      tagIds: await tagIdsFor(src.id),
      actorId,
    });
    if (isRoot && carryRule) {
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

/** Roll the SAME task forward to `nextDue`: advance its dates (unless syncDue
 *  is off), reset its status, and write the (decremented / cleared) rule.
 *  Returns the updated row so the caller can hand it straight to the client. */
async function rollAnchorForward(
  anchor: AnchorWithBoard,
  statuses: StatusOption[],
  rule: RecurrenceRule,
  nextRule: RecurrenceRule | null,
  nextDue: Date,
  actorId: string | null,
): Promise<BoardItemRow> {
  const doShift = rule.syncDue !== false;
  const oldAnchorDate = anchor.dueAt ?? anchor.startAt ?? new Date();
  const delta = doShift ? nextDue.getTime() - new Date(oldAnchorDate).getTime() : 0;
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
 * row (create-new=false, the spec "After completion" mode) so the client can
 * update in place, or recurred=false (legacy create-new=true) after spawning a
 * fresh copy that carries the series.
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

  if (rule.createNew === false) {
    // Spec "After completion": roll this task's due date to the next occurrence
    // on the calendar-aware grid (weekday / month-day / year-date rules).
    const nextDue = nextOccurrenceAfter(new Date(base), rule, new Date(base));
    const { nextRule } = stepSeries(rule, nextDue);
    const rolled = await rollAnchorForward(anchor, statuses, rule, nextRule, nextDue, actorId);
    return { recurred: true, item: rolled };
  }

  // Legacy ON_COMPLETE + create-new: spawn the next occurrence (carrying the
  // series when it continues) and strip the rule off the just-completed task.
  const nextDue = advanceDate(base, rule);
  const { nextRule } = stepSeries(rule, nextDue);
  const cycleDue = rule.syncDue === false ? (anchor.dueAt ?? nextDue) : nextDue;
  await cloneItemTree(anchor.id, cycleDue, actorId, rule.resetStatus ?? null, nextRule);
  await updateBoardItem(anchor.id, { recurRule: null, recurNextAt: null }, actorId);
  return { recurred: false };
}

/**
 * Spawn/advance the current cycle for every SCHEDULE anchor whose recurNextAt
 * is due. Safe to run hourly and concurrently:
 *   - the claim is an optimistic updateMany on the exact recurNextAt value;
 *   - each occurrence is double-guarded by metadata.lastSpawnedKey on the
 *     anchor and a recurrenceSourceId+recurrenceKey lookup, so a re-run never
 *     duplicates a spawn;
 *   - catch-up after an outage is capped at 7 occurrences per anchor; older
 *     missed keys are recorded in metadata.skippedOccurrences.
 * Prior spawned instances are never modified. Never throws into the route.
 */
export async function spawnDueRecurringTasks(
  now: Date = new Date(),
  limit = 200,
): Promise<{ anchors: number; spawned: number; skipped: number }> {
  const due = await prisma.item.findMany({
    where: { archivedAt: null, recurNextAt: { not: null, lte: now } },
    include: { board: { select: { statuses: true } } },
    take: limit,
  });

  let spawned = 0;
  let skippedTotal = 0;
  for (const anchor of due) {
    try {
      const rule = parseRecurrence(anchor.recurRule);
      if (!rule || !anchor.recurNextAt) continue;
      if ((rule.trigger ?? "SCHEDULE") !== "SCHEDULE") continue; // ON_COMPLETE never uses the cron
      const statuses = getBoardStatuses(anchor.board);

      if (rule.createNew === false) {
        // Legacy SCHEDULE + roll-the-same-row branch, preserved verbatim: the
        // cycle to run now = latest occurrence <= now (missed cycles collapse).
        let cycleDue = new Date(anchor.recurNextAt);
        let nextAt = advanceDate(cycleDue, rule);
        for (let i = 0; i < 10000 && nextAt.getTime() <= now.getTime(); i++) {
          cycleDue = nextAt;
          nextAt = advanceDate(nextAt, rule);
        }
        const { nextRule, ended } = stepSeries(rule, nextAt);
        const claim = await prisma.item.updateMany({
          where: { id: anchor.id, recurNextAt: anchor.recurNextAt },
          data: { recurNextAt: ended ? null : nextAt },
        });
        if (claim.count !== 1) continue;
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
        spawned++;
        continue;
      }

      // Spec "On schedule" mode: one NEW task per occurrence since the last
      // spawn. The anchor's due date is the grid anchor (time-of-day source);
      // anchors without dates fall back to the claimed recurNextAt.
      const anchorDue = new Date(anchor.dueAt ?? anchor.startAt ?? anchor.recurNextAt);
      const md = anchor.metadata && typeof anchor.metadata === "object"
        ? { ...(anchor.metadata as Record<string, unknown>) }
        : {};
      const prevKey = typeof md.lastSpawnedKey === "string" ? (md.lastSpawnedKey as string) : null;

      const batch = occurrencesSince(rule, anchorDue, prevKey, anchor.recurNextAt, now, 7);
      let spawnList = batch.spawn;
      const nextAt = nextOccurrenceAfter(now, rule, anchorDue);

      // End conditions: never spawn past `until`; spend `count` per spawn.
      let ended = false;
      if (rule.until) {
        const end = new Date(rule.until);
        if (!Number.isNaN(end.getTime())) {
          spawnList = spawnList.filter((s) => s.date.getTime() <= end.getTime());
          if (nextAt.getTime() > end.getTime()) ended = true;
        }
      }
      let nextCount: number | null = typeof rule.count === "number" ? rule.count : null;
      if (rule.forever === false && typeof rule.count === "number") {
        if (spawnList.length >= rule.count) {
          spawnList = spawnList.slice(0, Math.max(0, rule.count));
          nextCount = 0;
          ended = true;
        } else {
          nextCount = rule.count - spawnList.length;
        }
      }

      // Claim by advancing recurNextAt from the exact value we read. If another
      // worker already advanced it, count is 0 and we skip (no double-run).
      const claim = await prisma.item.updateMany({
        where: { id: anchor.id, recurNextAt: anchor.recurNextAt },
        data: { recurNextAt: ended ? null : nextAt },
      });
      if (claim.count !== 1) continue;

      let lastKey = prevKey;
      for (const k of batch.skipped) if (!lastKey || k > lastKey) lastKey = k;

      for (const occ of spawnList) {
        // Belt-and-braces idempotency: skip when an instance for this exact
        // occurrence already exists (any state — archived spawns still block).
        const existing = await prisma.item.findFirst({
          where: {
            boardId: anchor.boardId,
            AND: [
              { metadata: { path: ["recurrenceSourceId"], equals: anchor.id } },
              { metadata: { path: ["recurrenceKey"], equals: occ.key } },
            ],
          },
          select: { id: true },
        });
        if (!existing) {
          await cloneItemTree(anchor.id, occ.date, null, rule.resetStatus ?? null, null, {
            sourceId: anchor.id,
            key: occ.key,
          });
          spawned++;
        }
        if (!lastKey || occ.key > lastKey) lastKey = occ.key;
      }
      // Nothing handled this tick (e.g. everything past `until`): still seed
      // the key from the claimed recurNextAt so no retro-spawning can happen.
      if (!lastKey) lastKey = occurrenceKey(new Date(anchor.recurNextAt));

      md.lastSpawnedKey = lastKey;
      if (batch.skipped.length > 0) {
        const prevSkipped = Array.isArray(md.skippedOccurrences) ? (md.skippedOccurrences as unknown[]) : [];
        md.skippedOccurrences = [...prevSkipped, ...batch.skipped].slice(-50);
        skippedTotal += batch.skipped.length;
      }
      await updateBoardItem(anchor.id, {
        metadata: md,
        recurRule: ended ? null : ({ ...rule, count: nextCount } as unknown as Record<string, unknown>),
      }, null);
    } catch (e) {
      console.error("spawnDueRecurringTasks: cycle failed for", anchor.id, e);
    }
  }

  return { anchors: due.length, spawned, skipped: skippedTotal };
}
