// Recurring tasks (spawn model) — server logic behind the "Repeat" tab.
//
// The task the user sets Repeat on is the SERIES ANCHOR: it holds recurRule +
// recurNextAt. On schedule, /api/cron/recurring-tasks calls spawnDueRecurringTasks
// which, for each due anchor, atomically claims it (advances recurNextAt so a
// concurrent run can't double-spawn), then clones the anchor AND its full subtask
// tree as a fresh open task for the current cycle. Copies carry no recurRule, so
// only the anchor keeps recurring until the user turns Repeat off.

import { prisma } from "@/lib/prisma";
import { createBoardItem } from "@/lib/board-items";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { parseRecurrence, advanceDate } from "@/lib/recurrence";

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

type CloneSrc = {
  id: string; boardId: string; title: string; ownerId: string | null;
  priority: string | null; itemTypeId: string | null; metadata: unknown;
  startAt: Date | null; dueAt: Date | null;
};

/**
 * Deep-clone an item + its subtask subtree as a fresh open task.
 * `cycleDue` is the due date for the new occurrence; every date in the tree is
 * shifted by the same delta so subtask spacing is preserved. Returns the new
 * root id, or null if the source is gone.
 */
export async function cloneItemTree(
  rootId: string,
  cycleDue: Date,
  actorId: string | null = null,
): Promise<string | null> {
  const root = await prisma.item.findUnique({
    where: { id: rootId },
    include: { board: { select: { statuses: true } } },
  });
  if (!root) return null;

  const statuses = getBoardStatuses(root.board);
  const firstOpen = (statuses.find((s) => s.group === "ACTIVE") ?? statuses[0])?.value ?? "TO_DO";
  const anchor = root.dueAt ?? root.startAt ?? null;
  const delta = anchor ? cycleDue.getTime() - anchor.getTime() : 0;
  const shift = (d: Date | null): Date | null => (d ? new Date(d.getTime() + delta) : null);

  const cloneOne = async (src: CloneSrc, newParentId: string | null): Promise<string> => {
    const created = await createBoardItem({
      organizationId: root.organizationId,
      boardId: src.boardId,
      title: src.title,
      status: firstOpen,
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
    const children = await prisma.item.findMany({
      where: { parentItemId: src.id, archivedAt: null },
      orderBy: { position: "asc" },
    });
    for (const child of children) await cloneOne(child, created.id);
    return created.id;
  };

  return cloneOne(root, null);
}

/**
 * Spawn the current cycle's copy for every anchor whose recurNextAt is due.
 * Fast-forwards past missed cycles (at most one copy per anchor per run) so a
 * lapsed cron never floods the list. Safe to run concurrently: the claim is an
 * optimistic updateMany on the exact recurNextAt value.
 */
export async function spawnDueRecurringTasks(
  now: Date = new Date(),
  limit = 200,
): Promise<{ anchors: number; spawned: number }> {
  const due = await prisma.item.findMany({
    where: { archivedAt: null, recurNextAt: { not: null, lte: now } },
    take: limit,
  });

  let spawned = 0;
  for (const anchor of due) {
    const rule = parseRecurrence(anchor.recurRule);
    if (!rule || !anchor.recurNextAt) continue;

    // The cycle to create now = latest occurrence <= now; the next spawn time =
    // the first occurrence strictly after now.
    let cycleDue = new Date(anchor.recurNextAt);
    let nextAt = advanceDate(cycleDue, rule);
    for (let i = 0; i < 10000 && nextAt.getTime() <= now.getTime(); i++) {
      cycleDue = nextAt;
      nextAt = advanceDate(nextAt, rule);
    }

    // Claim by advancing recurNextAt from the exact value we read. If another
    // worker already advanced it, count is 0 and we skip (no double-spawn).
    const claim = await prisma.item.updateMany({
      where: { id: anchor.id, recurNextAt: anchor.recurNextAt },
      data: { recurNextAt: nextAt },
    });
    if (claim.count !== 1) continue;

    try {
      await cloneItemTree(anchor.id, cycleDue, null);
      spawned++;
    } catch (e) {
      console.error("spawnDueRecurringTasks: clone failed for", anchor.id, e);
    }
  }

  return { anchors: due.length, spawned };
}
