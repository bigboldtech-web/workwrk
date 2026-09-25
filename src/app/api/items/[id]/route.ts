// GET    /api/items/[id], one task, with the viewer's decision, the
//                          breadcrumb, its watchers and its parent
// PATCH  /api/items/[id], update title / status / assignees / dates / …,
//                          plus `boardId` (move) and `watcherIds`
// DELETE /api/items/[id], archive (soft); ?hard=1 moves it to Trash
//
// Every branch gates through ONE door, `gateItem` on the ITEM ref
// (src/lib/item-gate.ts). Before Phase 2, GET short-circuited to
// `canEdit: true` for an assignee while PATCH had no assignee branch and 403'd
// them, so the UI handed an assignee a fully editable task whose every save
// failed. One gate is the whole fix.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  archiveBoardItem,
  getBoardItemRow,
  moveBoardItem,
  updateBoardItem,
  PRIORITY_OPTIONS,
} from "@/lib/board-items";
import { moveToTrash } from "@/lib/trash";
import { canContributeBoard, getBoardForReader } from "@/lib/board";
import { unknownUserIds } from "@/lib/assignable";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { remapStatusOnMove } from "@/lib/item-move";
import { applyWatcherIds, readWatchers, writeWatchers } from "@/lib/item-watchers";
import { boardContext, gateItem, itemBreadcrumb, itemCtx, itemServerError, listIsReadable } from "@/lib/item-gate";
import { applyTimeOfDay, nextOccurrenceAfter, occurrenceKey, parseRecurrence } from "@/lib/recurrence";
import { advanceSeriesOnComplete } from "@/lib/recurring-tasks";
import { prisma } from "@/lib/prisma";
import { hasModule } from "@/lib/space-modules";
import { dispatchEvent } from "@/services/webhookDispatcher";
import { notifyItemAssigned, notifyItemStatusChanged } from "@/lib/notify-item";
import { publishItemChanged } from "@/lib/notify-realtime";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  // Every throw inside the read becomes a 500 THAT NAMES ITSELF. Without
  // this, a database that is behind the code (a prisma/sql file not applied)
  // makes `prisma.item.findUnique` throw on the first task anyone opens, the
  // App Router answers an empty 500, and the whole product's task surface
  // reads "Couldn't load" with no clue in it. Now the body carries the line.
  try {
    return await readItem(id, c);
  } catch (err) {
    return itemServerError(err, `GET /api/items/${id}`);
  }
}

async function readItem(id: string, c: Exclude<Awaited<ReturnType<typeof itemCtx>>, { error: NextResponse }>) {
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;
  const item = gate.item;

  const [owner, assigneeUsers, tagAssignments, parent, listReadable] = await Promise.all([
    item.ownerId
      ? prisma.user.findUnique({
          where: { id: item.ownerId },
          select: { id: true, firstName: true, lastName: true, avatar: true, email: true },
        })
      : Promise.resolve(null),
    item.assigneeIds.length
      ? prisma.user.findMany({
          where: { id: { in: item.assigneeIds } },
          select: { id: true, firstName: true, lastName: true, avatar: true, email: true },
        })
      : Promise.resolve([]),
    prisma.tagAssignment.findMany({
      where: { entityType: "BOARD_ITEM", entityId: item.id },
      include: { tag: { select: { id: true, name: true, color: true, archived: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // The parent task, so a subtask's BackButton can be labelled with it
    // instead of sending the reader to the List (spec section 1, Back / close).
    item.parentItemId
      ? prisma.item.findFirst({
          where: { id: item.parentItemId, organizationId: c.organizationId },
          select: { id: true, title: true },
        })
      : Promise.resolve(null),
    listIsReadable(item, c),
  ]);
  const breadcrumb = await itemBreadcrumb(item, c, { listReadable });

  // The Space, read ONLY for its module toggles (see moduleGating below). It
  // is not a gate and cannot become one: the gate already answered above, a
  // task with no Space reads `null` here, and `hasModule(null, ...)` is true,
  // so a space-less Personal List task gets every field rather than none.
  const spaceId = item.board.spaceId;
  const space = spaceId
    ? await prisma.space
        .findFirst({ where: { id: spaceId, organizationId: c.organizationId }, select: { settings: true } })
        .catch(() => null)
    : null;

  // Two names the body needs and had to guess at before: the author, for the
  // meta line's "Created by {name}", and the List owner, so the read-only
  // banner asks a person rather than "the list owner". Both are best-effort:
  // a missing row degrades the sentence, never the page.
  const [creator, listOwner] = await Promise.all([
    gate.creatorId
      ? prisma.user
          .findFirst({
            where: { id: gate.creatorId, organizationId: c.organizationId },
            select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    item.board.ownerId
      ? prisma.user
          .findFirst({
            where: { id: item.board.ownerId, organizationId: c.organizationId },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    item: {
      id: item.id,
      boardId: item.boardId,
      spaceId: item.board.spaceId,
      title: item.title,
      status: item.status,
      ownerId: item.ownerId,
      groupKey: item.groupKey,
      position: item.position,
      metadata: item.metadata,
      startAt: item.startAt,
      dueAt: item.dueAt,
      priority: item.priority,
      itemTypeId: item.itemTypeId,
      parentItemId: item.parentItemId,
      recurRule: item.recurRule,
      recurNextAt: item.recurNextAt,
      tags: tagAssignments.filter((a) => !a.tag.archived).map((a) => ({ id: a.tag.id, name: a.tag.name, color: a.tag.color })),
      archivedAt: item.archivedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      owner,
      assigneeIds: item.assigneeIds,
      // Resolved assignees, ordered primary-first to match assigneeIds.
      assignees: item.assigneeIds
        .map((aid) => assigneeUsers.find((u) => u.id === aid))
        .filter((u): u is (typeof assigneeUsers)[number] => Boolean(u)),
    },
    // Board context so a standalone detail page (no board host) can
    // render custom fields + the right status palette + breadcrumb.
    board: boardContext(item),
    // Phase 2 additions. `decision` is what the body renders from, so the
    // drawer's editability comes from the task's own gate and never from the
    // host page's `canEditSpace` (spaces-boards High #2).
    decision: gate.decision,
    breadcrumb,
    watcherIds: gate.watcherIds,
    parent,
    createdById: gate.creatorId,
    createdBy: creator,
    listOwner,
    // The Space's module toggles. The board page hands these to its renderers
    // as props; the drawer is rendered by a different App Router slot and
    // cannot be handed anything, so the answer travels with the task. A
    // space-less Personal List has no toggles and everything is on.
    moduleGating: {
      priority: hasModule(space?.settings, "PRIORITY"),
      tags: hasModule(space?.settings, "TAGS"),
      timeTracking: hasModule(space?.settings, "TIME_TRACKING"),
      customFields: hasModule(space?.settings, "CUSTOM_FIELDS"),
    },
    // Kept for every client that predates `decision`. Same answer, one source.
    canEdit: gate.decision.role === "EDIT" || gate.decision.role === "FULL",
  });
}

// Recurrence ("Set Recurring") config. After a patch sets/clears recurRule (or
// moves the due date, which re-anchors the series), compute the anchor's
// recurNextAt. SCHEDULE-triggered series get a spawn time (first occurrence
// strictly after the anchor's own due date AND after now, so the anchor covers
// the current cycle and the first spawned copy is the next one) plus a seeded
// metadata.lastSpawnedKey so the cron only spawns cycles after the anchor's
// own. ON_COMPLETE series never use the cron, so recurNextAt stays null -
// completing the task advances them. Clearing the rule clears recurNextAt and
// the spawn bookkeeping too. Returns the re-updated row or null.
async function applyRecurrenceSchedule(itemId: string, rawRule: unknown, actorId: string) {
  const rule = parseRecurrence(rawRule);
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { dueAt: true, startAt: true, metadata: true },
  });
  if (!item) return null;
  const md = item.metadata && typeof item.metadata === "object"
    ? { ...(item.metadata as Record<string, unknown>) }
    : {};
  delete md.lastSpawnedKey;
  delete md.skippedOccurrences;
  // Explicit time-of-day: a rule carrying atTime re-times the anchor's OWN due
  // date to that clock time on its existing calendar day (so "today's"
  // occurrence is corrected too) and recurNextAt is computed from the re-timed
  // anchor. Rules without atTime never touch dueAt, occurrences keep
  // inheriting whatever time the anchor carries, exactly as before.
  let retimedDue: Date | null = null;
  if (rule?.atTime && item.dueAt) {
    const timed = applyTimeOfDay(new Date(item.dueAt), rule);
    if (timed.getTime() !== new Date(item.dueAt).getTime()) retimedDue = timed;
  }
  let recurNextAt: Date | null = null;
  if (rule && (rule.trigger ?? "SCHEDULE") === "SCHEDULE") {
    const base = new Date(retimedDue ?? item.dueAt ?? item.startAt ?? new Date());
    // Step from the ANCHOR, not from now: an occurrence whose date already
    // arrived must still spawn (the cron's capped catch-up handles any
    // backlog + records skips). max(now, …) here silently swallowed today's
    // instance when the rule was saved after its time-of-day had passed.
    recurNextAt = nextOccurrenceAfter(base, rule, base);
    md.lastSpawnedKey = occurrenceKey(base);
  }
  return updateBoardItem(itemId, {
    recurNextAt,
    metadata: md,
    ...(retimedDue ? { dueAt: retimedDue } : {}),
  }, actorId);
}

const recurRuleSchema = z.object({
  freq: z.enum(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"]),
  interval: z.number().int().min(1).max(365),
  // ClickUp "Set Recurring" options, all optional; parseRecurrence defaults them.
  trigger: z.enum(["SCHEDULE", "ON_COMPLETE"]).optional(),
  createNew: z.boolean().optional(),
  forever: z.boolean().optional(),
  count: z.number().int().min(0).max(9999).nullable().optional(),
  until: z.string().datetime().nullable().optional(),
  resetStatus: z.string().max(40).nullable().optional(),
  syncDue: z.boolean().optional(),
  // Calendar-aware fields, weekly weekday set (ISO 1=Mon..7=Sun), monthly
  // day-of-month (29-31 clamp to month end), yearly month/day.
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).nullable().optional(),
  monthDay: z.number().int().min(1).max(31).nullable().optional(),
  yearMonth: z.number().int().min(1).max(12).nullable().optional(),
  yearDay: z.number().int().min(1).max(31).nullable().optional(),
  // Explicit occurrence time, "HH:MM" 24-hour local. null/absent = inherit
  // the anchor's time-of-day (legacy behavior).
  atTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).max(280).optional(),
  // 60, the limit the List's statuses schema allows (boards/[id]/route.ts) and
  // the bulk route already uses: at 40 a long declared status could be picked
  // everywhere and saved nowhere.
  status: z.string().max(60).nullable().optional(),
  // A user id, not free text. `.trim().min(1)` rejects the whitespace-only id
  // that `.min(1)` waved through, and the length cap rejects the 5000-character
  // string that was accepted and stored verbatim. Existence is checked against
  // the org below: these columns carry no foreign key, so zod is the only shape
  // check and the org query is the only identity check.
  ownerId: z.string().trim().min(1).max(64).nullable().optional(),
  assigneeIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  groupKey: z.string().max(80).nullable().optional(),
  position: z.number().finite().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // The SAFE way to change one thing inside the JSON column. `metadata` is
  // written wholesale (updateBoardItem replaces it), which means a client
  // holding a stale copy of the blob silently reverts every key somebody else
  // changed in the meantime, and a client that sends only the key it means to
  // change deletes all the others. `metadataPatch` is a shallow merge over
  // what is STORED, read inside the same request: a key set to `null` is
  // deleted, every other stored key is kept. Every partial write on the task
  // body goes through this; `metadata` stays for the callers that really do
  // own the whole blob (the create modal's snapshot).
  metadataPatch: z.record(z.string(), z.unknown()).optional(),
  // Phase 58, first-class date columns; ISO strings or null.
  startAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  // Task-system phase 2, first-class priority + workspace tags.
  priority: z.enum(PRIORITY_OPTIONS.map((p) => p.value) as [string, ...string[]]).nullable().optional(),
  tagIds: z.array(z.string().min(1)).max(20).optional(),
  // Task Types, re-skin this row as an ItemType (null = default).
  itemTypeId: z.string().min(1).nullable().optional(),
  // Recurring tasks, the series rule, or null to stop repeating. recurNextAt
  // is derived server-side, never accepted from the client.
  recurRule: recurRuleSchema.nullable().optional(),
  // Phase 2, "Move to list…". Re-parents the row; the status is remapped
  // server-side and never accepted from the client.
  boardId: z.string().min(1).optional(),
  // Phase 2, the Watchers field. Two lists live in metadata; this is the
  // whole `watchers` set as the picker sees it, applied through the rules in
  // src/lib/item-watchers.ts (only you can put your own id in `unwatchers`).
  watcherIds: z.array(z.string().min(1)).max(100).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  // A move needs Can edit on BOTH Lists, so it gates on "move" rather than on
  // "edit" and then checks the target separately below.
  const gate = await gateItem(id, c, parsed.data.boardId ? "move" : "edit");
  if ("error" in gate) return gate.error;

  // EVERY assignee id is a real, live person in THIS organization.
  //
  // Item.ownerId and Item.assigneeIds are bare String columns with no
  // relation, so the database refuses nothing: a typo, a stale client id or an
  // id belonging to another org was accepted and stored. Under the old replace
  // semantics the next owner change flushed the junk out; now that an
  // owner-only patch MERGES, a bad id is prepended to the set and stays there
  // forever as a phantom assignee no picker can see or remove. Rejecting the
  // write is the only point at which that is still reversible.
  const proposedUserIds = [
    ...(parsed.data.assigneeIds ?? []),
    ...(typeof parsed.data.ownerId === "string" ? [parsed.data.ownerId] : []),
  ];
  if (proposedUserIds.length > 0) {
    const unknown = await unknownUserIds(proposedUserIds, c.organizationId);
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: "no_access", reason: "unknown_assignee", requestAccess: false },
        { status: 400 },
      );
    }
  }

  // ── Move to another List ────────────────────────────────────────
  //
  // The move does NOT return early. A body that carries `boardId` beside a
  // title, a status or a metadata blob used to answer 200 having written only
  // the move, silently discarding every other field the caller sent; now the
  // move runs first and the rest of the patch is applied straight after it, so
  // nothing a user typed is thrown away under a success.
  let moved: { toBoardId: string; toListName: string; status: string | null; reason: string } | null = null;
  const sourceBoardId = gate.item.boardId;
  let currentBoardId = gate.item.boardId;
  let currentStatuses = getBoardStatuses(gate.item.board);
  if (parsed.data.boardId && parsed.data.boardId !== gate.item.boardId) {
    // BOTH Lists, not just the target. `gateItem(…, "move")` clears at EDIT,
    // which rule 9 grants on the task alone, so without this an assignee with
    // no role at all on the source List could move the task out of it and then
    // hold FULL on the destination and hard-delete it.
    if (!(await canContributeBoard(gate.item.boardId, c.userId, c.accessLevel))) {
      return NextResponse.json(
        { error: "no_access", reason: "source_list_read_only", requestAccess: true },
        { status: 403 },
      );
    }
    const target = await prisma.board.findFirst({
      where: { id: parsed.data.boardId, organizationId: c.organizationId, archivedAt: null },
      select: { id: true, name: true, statuses: true, productSlug: true },
    });
    // A target the viewer cannot even read answers 404, exactly like an id
    // that does not exist: the move picker never offers one, so this is the
    // stale-tab case and it must not confirm that the List is there.
    if (!target || !(await getBoardForReader(target.id, c.userId, c.accessLevel))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // A Personal List is one person's private surface: spec-task-detail
    // section 1 says nothing may be moved into it from another List, so the
    // picker never offers it and a stale tab is refused here.
    if (target.productSlug === "personal-list") {
      return NextResponse.json(
        { error: "no_access", reason: "personal_list_not_a_move_target", requestAccess: false },
        { status: 403 },
      );
    }
    if (!(await canContributeBoard(target.id, c.userId, c.accessLevel))) {
      return NextResponse.json(
        { error: "no_access", reason: "target_list_read_only", requestAccess: true },
        { status: 403 },
      );
    }
    const remap = remapStatusOnMove({
      status: gate.item.status,
      from: getBoardStatuses(gate.item.board),
      to: getBoardStatuses(target),
    });
    await moveBoardItem({
      itemId: id,
      toBoardId: target.id,
      status: remap.status,
      actorId: c.userId,
      // The subtasks travel with the parent, so they need the same remap: a
      // child left carrying a status the target List does not declare drops
      // out of every group-by there.
      fromStatuses: getBoardStatuses(gate.item.board),
      toStatuses: getBoardStatuses(target),
    });
    moved = { toBoardId: target.id, toListName: target.name, status: remap.status, reason: remap.reason };
    currentBoardId = target.id;
    currentStatuses = getBoardStatuses(target);
    // BOTH Lists hear about it. Publishing only the target left every viewer
    // of the source List watching a row that had already vanished from it.
    void publishItemChanged({
      itemId: id,
      boardId: target.id,
      organizationId: c.organizationId,
      actorId: c.userId,
    });
    void publishItemChanged({
      itemId: id,
      boardId: sourceBoardId,
      organizationId: c.organizationId,
      actorId: c.userId,
    });
  }
  delete (parsed.data as { boardId?: unknown }).boardId;

  // ── Watchers ────────────────────────────────────────────────────
  // `Item.metadata` is a JSON column that `updateBoardItem` replaces WHOLESALE,
  // and the two watcher lists live inside it. Folding them in only when the
  // same body carried `watcherIds` meant every OTHER metadata write, a
  // description autosave, a checklist tick, a custom field, the create modal -
  // deleted both lists, silently re-subscribing everyone who had pressed
  // Unwatch. So the stored lists are re-merged into ANY incoming metadata
  // blob, and `watcherIds` is the only thing that may change them.
  // `metadataPatch` resolves against the STORED blob, here, in the same
  // request that writes it, so nothing depends on how fresh the client's copy
  // of `metadata` is. It never combines with a wholesale `metadata` write:
  // whichever one the caller sent is the one that is applied.
  if (parsed.data.metadataPatch !== undefined) {
    const base = { ...((gate.item.metadata as Record<string, unknown> | null) ?? {}) };
    for (const [k, v] of Object.entries(parsed.data.metadataPatch)) {
      if (v === null) delete base[k];
      else base[k] = v;
    }
    parsed.data.metadata = base;
  }
  delete (parsed.data as { metadataPatch?: unknown }).metadataPatch;

  const storedWatchers = readWatchers(gate.item.metadata);
  if (parsed.data.watcherIds) {
    const next = applyWatcherIds(storedWatchers, parsed.data.watcherIds, c.userId);
    const base = parsed.data.metadata ?? (gate.item.metadata as Record<string, unknown> | null) ?? {};
    parsed.data.metadata = writeWatchers(base, next);
    delete (parsed.data as { watcherIds?: unknown }).watcherIds;
  } else if (parsed.data.metadata !== undefined) {
    parsed.data.metadata = writeWatchers(parsed.data.metadata, storedWatchers);
  }

  // A move on its own, no other field in the body, is already written.
  if (moved && Object.keys(parsed.data).length === 0) {
    const row = await getBoardItemRow(id);
    return NextResponse.json({ ...(row ? { item: row } : {}), moved });
  }

  try {
    const updated = await updateBoardItem(id, parsed.data, c.userId);
    // Event pipes ("lay pipes as you go"), flat payloads: ids + the
    // fields automation conditions test. Fire-and-forget, never throws.
    if (parsed.data.status !== undefined && gate.item.status !== updated.status) {
      dispatchEvent({
        organizationId: c.organizationId,
        event: "task.status_changed",
        payload: {
          id: updated.id,
          boardId: currentBoardId,
          title: updated.title,
          status: updated.status,
          previousStatus: gate.item.status,
          ownerId: updated.ownerId,
          assigneeId: updated.ownerId,
          priority: updated.priority,
          dueAt: updated.dueAt,
          actorId: c.userId,
          updatedAt: updated.updatedAt,
        },
      }).catch(() => {});
    }
    if (parsed.data.ownerId !== undefined && gate.item.ownerId !== updated.ownerId) {
      dispatchEvent({
        organizationId: c.organizationId,
        event: "task.assignee_changed",
        payload: {
          id: updated.id,
          boardId: currentBoardId,
          title: updated.title,
          status: updated.status,
          ownerId: updated.ownerId,
          assigneeId: updated.ownerId,
          previousAssigneeId: gate.item.ownerId,
          priority: updated.priority,
          dueAt: updated.dueAt,
          actorId: c.userId,
          updatedAt: updated.updatedAt,
        },
      }).catch(() => {});
    }

    // ── Inbox notifications ──────────────────────────────────────────
    // Both emitters live in src/lib/notify-item.ts so the recipient's
    // /settings/notifications toggle is the single switch, and neither can
    // notify the actor about their own edit. Guarded on a REAL transition
    // (no-op PATCHes, same owner, same status, write nothing), and they
    // never throw: the item is already saved.
    const ownerChanged = parsed.data.ownerId !== undefined && gate.item.ownerId !== updated.ownerId;
    const statusChanged = parsed.data.status !== undefined && gate.item.status !== updated.status;
    if (ownerChanged) {
      await notifyItemAssigned({
        organizationId: c.organizationId,
        item: { id: updated.id, title: updated.title, dueAt: updated.dueAt ?? null },
        ownerId: updated.ownerId,
        actorId: c.userId,
        reassigned: gate.item.ownerId !== null,
      });
    }
    if (statusChanged) {
      await notifyItemStatusChanged({
        organizationId: c.organizationId,
        item: { id: updated.id, title: updated.title, dueAt: updated.dueAt ?? null },
        board: { statuses: currentStatuses },
        previousStatus: gate.item.status,
        status: updated.status,
        // When this same PATCH also handed the task to someone new, the
        // assignment row above already told them, don't double-notify.
        ownerId: ownerChanged ? null : updated.ownerId,
        actorId: c.userId,
        // Phase 2: watchers hear about status too, and an unwatcher does not.
        metadata: updated.metadata,
      });
    }

    // Phase 2 realtime: one trigger-only event so an open task stops polling
    // and hoping. Fire-and-forget; it can never fail the save above it.
    void publishItemChanged({
      itemId: id,
      boardId: currentBoardId,
      organizationId: c.organizationId,
      actorId: c.userId,
      // The assignee set AS WRITTEN, not the one the client happened to send.
      // An owner-only patch carries no `assigneeIds` at all, and that is now
      // the primary way a task is handed to somebody, so reading the request
      // body here pushed the realtime event to nobody extra and the newly
      // assigned person's board stayed stale until a reload.
      extraUserIds: updated.assigneeIds ?? [],
    });

    // Repeat turned on/off/changed → (re)compute the anchor's spawn schedule.
    // Every return below responds with the FULL enriched row (counts/links/
    // time/creator, the exact listBoardItems shape). The old lean writer
    // shape silently stripped those fields when the client merged/replaced
    // its cached row, which is how a saved task "disappeared" until refresh.
    if (parsed.data.recurRule !== undefined) {
      const rescheduled = await applyRecurrenceSchedule(id, parsed.data.recurRule ?? null, c.userId);
      if (rescheduled) return NextResponse.json({ item: (await getBoardItemRow(id)) ?? rescheduled, ...(moved ? { moved } : {}) });
    } else if (parsed.data.dueAt !== undefined) {
      // The due date IS the series anchor, moving it re-anchors an active
      // SCHEDULE series (recurNextAt + lastSpawnedKey recomputed from it).
      const storedRule = parseRecurrence(gate.item.recurRule);
      if (storedRule && (storedRule.trigger ?? "SCHEDULE") === "SCHEDULE") {
        const rescheduled = await applyRecurrenceSchedule(id, gate.item.recurRule, c.userId);
        if (rescheduled) return NextResponse.json({ item: (await getBoardItemRow(id)) ?? rescheduled, ...(moved ? { moved } : {}) });
      }
    }
    // Completing an ON_COMPLETE recurring task advances its series in place -
    // return the rolled-forward row so the board updates without a refetch.
    if (parsed.data.status !== undefined) {
      const recur = await advanceSeriesOnComplete(id, updated.status, c.userId);
      if (recur.recurred && recur.item) {
        return NextResponse.json({ item: (await getBoardItemRow(id)) ?? recur.item, recurred: true, ...(moved ? { moved } : {}) });
      }
    }
    return NextResponse.json({ item: (await getBoardItemRow(id)) ?? updated, ...(moved ? { moved } : {}) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update item" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";
  // Archive is reversible and needs Can edit. A hard delete moves the task to
  // Trash and needs `tasks.delete`: Full access, or the creator holding Can
  // edit, and never an Agent (access section 9). Before Phase 2 both branches
  // gated on `canContributeBoard`, so any Member could permanently delete
  // anyone's task in a List they could write to.
  const gate = await gateItem(id, c, hard ? "delete" : "archive");
  if ("error" in gate) return gate.error;
  const boardId = gate.item.boardId;
  if (hard) {
    // Recoverable delete, snapshot to Trash, then remove (subtasks cascade).
    await moveToTrash("item", id, { organizationId: c.organizationId, userId: c.userId, userName: c.userName });
    // An open drawer or board has to hear about this too: without the publish
    // a hard delete left every other viewer looking at a row that was gone.
    void publishItemChanged({ itemId: id, boardId, organizationId: c.organizationId, actorId: c.userId });
    return NextResponse.json({ ok: true });
  }
  const archived = await archiveBoardItem(id, c.userId);
  void publishItemChanged({ itemId: id, boardId, organizationId: c.organizationId, actorId: c.userId });
  // Full enriched row, same as PATCH, the client merges this into its cache.
  return NextResponse.json({ item: (await getBoardItemRow(id)) ?? archived });
}
