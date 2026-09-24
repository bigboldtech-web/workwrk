// POST /api/items/[id]/duplicate — copy a task.
//
// spec-task-detail section 4 step 1 names exactly what is copied and what is
// not: "copies title with ' (copy)', every field, tags, checklist,
// description, custom fields; NOT subtasks, comments, time or attachments;
// creator = actor".
//
// It replaces three hand-rolled copies of the same POST — the Table view
// (board-table-view.tsx), the Kanban card (board-kanban-view.tsx) and the
// right-click menu (item-context-menu.tsx) — each of which built its own
// `/api/boards/[id]/items` body and quietly dropped a different set of fields:
// none of the three copied assigneeIds or tagIds, and two dropped the dates and
// the priority as well, so "Duplicate" produced a task with no assignees and no
// tags and nobody noticed because there was nothing to compare it to. All three
// call this route now.

import { NextResponse } from "next/server";
import { createBoardItem, getBoardItemRow } from "@/lib/board-items";
import { keepNamespacesFor } from "@/lib/list-metadata";
import { copyListLinks, eligibleCopyLists } from "@/lib/list-links-server";
import { canContributeBoard } from "@/lib/board";
import { gateItem, itemCtx } from "@/lib/item-gate";
import { publishItemChanged } from "@/lib/notify-realtime";
import { prisma } from "@/lib/prisma";

/** Copied per the spec; everything not listed here is deliberately dropped. */
const DROPPED_METADATA_KEYS = [
  // Time tracked belongs to the sessions, not to the row.
  "timeTracked",
  // Recurrence bookkeeping: a copy is not the next occurrence of a series.
  "lastSpawnedKey",
  "skippedOccurrences",
  "recurrenceSourceId",
  "recurrenceKey",
  // Watchers follow the work, not the copy; the actor auto-watches as creator.
  "watchers",
  "unwatchers",
  "followers",
  // Migration markers. The copy is a brand-new task that never was a legacy
  // `Task`, so carrying these would give it a forwarding marker for somebody
  // else's row and would over-count the migration's own verification query
  // (scripts/MIGRATIONS.md: count Items carrying `legacyTaskId`) by one per
  // duplicate. The ORIGINAL keeps both; only the copy drops them.
  "legacyTaskId",
  "legacyTask",
  // The same, for the Ideas migration.
  "legacyIdeaId",
  "legacyIdea",
];

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await gateItem(id, c, "duplicate");
  if ("error" in gate) return gate.error;
  const item = gate.item;

  // Duplicating writes a NEW row into the List, so it needs content-write on
  // the List itself and not only Can edit on the task. An assignee-only viewer
  // can edit the task they were given and cannot add rows to a List they are
  // not on, which is the same rule every other create obeys.
  if (!(await canContributeBoard(item.boardId, c.userId, c.accessLevel))) {
    return NextResponse.json(
      { error: "no_access", reason: "list_read_only", requestAccess: true },
      { status: 403 },
    );
  }

  const md =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? { ...(item.metadata as Record<string, unknown>) }
      : {};
  for (const key of DROPPED_METADATA_KEYS) delete md[key];

  // Phase 5b: the copy joins the Lists its original is in ONLY where the
  // duplicator may write, and keeps only those Lists' own values. Nothing is
  // counted, so a duplicate teaches nobody about Lists they cannot write.
  // Only a top-level original carries links.
  const joinLists = item.parentItemId ? [] : await eligibleCopyLists(item.id, c);
  const copiedMetadata = keepNamespacesFor(md, joinLists);

  const tagRows = await prisma.tagAssignment.findMany({
    where: { entityType: "BOARD_ITEM", entityId: item.id },
    select: { tagId: true },
  });

  const created = await createBoardItem({
    organizationId: c.organizationId,
    boardId: item.boardId,
    title: `${item.title} (copy)`,
    status: item.status ?? undefined,
    ownerId: item.ownerId ?? undefined,
    assigneeIds: item.assigneeIds,
    groupKey: item.groupKey ?? undefined,
    startAt: item.startAt ? item.startAt.toISOString() : null,
    dueAt: item.dueAt ? item.dueAt.toISOString() : null,
    priority: item.priority ?? undefined,
    itemTypeId: item.itemTypeId ?? undefined,
    tagIds: tagRows.map((t) => t.tagId),
    metadata: copiedMetadata,
    // A copy of a SUBTASK is a sibling subtask: it keeps the original's parent
    // so it lands beside the row it was copied from rather than at the top
    // level of the List, where nobody would look for it. (A copy of a top-level
    // task has no parent, so this is undefined for the common case.) The series
    // bookkeeping IS dropped, above: a copy is never the next occurrence.
    parentItemId: item.parentItemId ?? undefined,
    actorId: c.userId,
  }, {
    // A copy keeps its connect values and markers verbatim, and takes NO List
    // defaults: an unprioritised task's copy stays unprioritised, as today.
    trustedMetadata: true,
  });
  await copyListLinks(created.id, joinLists, c);

  void publishItemChanged({
    itemId: created.id,
    boardId: item.boardId,
    organizationId: c.organizationId,
    actorId: c.userId,
  });
  return NextResponse.json({ item: (await getBoardItemRow(created.id, { viewer: c })) ?? created }, { status: 201 });
}
