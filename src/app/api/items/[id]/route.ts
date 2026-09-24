// GET    /api/items/[id], one task, with the viewer's decision, the
//                          breadcrumb, its watchers and its parent
//                          ?list=<boardId> (Phase 5b): the task as it
//                          appears in a List it is linked into
// PATCH  /api/items/[id], update title / status / assignees / dates / …,
//                          plus `boardId` (move) and `watcherIds`
//                          `contextBoardId` (Phase 5b): the List the edit
//                          is made in
// DELETE /api/items/[id], archive (soft); ?hard=1 moves it to Trash
//                          ?list=<boardId> (Phase 5b): refused inside a
//                          secondary List unless ?everywhere=1
//
// Every branch gates through ONE door, `gateItem` on the ITEM ref
// (src/lib/item-gate.ts). Before Phase 2, GET short-circuited to
// `canEdit: true` for an assignee while PATCH had no assignee branch and 403'd
// them, so the UI handed an assignee a fully editable task whose every save
// failed. One gate is the whole fix.
//
// PHASE 5b, TASKS IN MORE THAN ONE LIST. A task has ONE home (its List) and
// may appear in more Lists through links. What is shared is the TASK: title,
// status (always the home's), dates, priority, people, tags, watchers, the
// body. What each List owns is its own field values, kept in that List's
// namespace on the task (src/lib/list-metadata.ts). So a request names its
// context List, a context the caller cannot read is ONE answer whether or not
// the task is in it (invalid_context), and a reader who reached the task only
// through a linked List is never told anything about its home.

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
import { getBoardStatuses, makeStatusLookup, type StatusOption } from "@/lib/board-items-shared";
import { remapStatusOnMove } from "@/lib/item-move";
import { applyWatcherIds, readWatchers, writeWatchers } from "@/lib/item-watchers";
import { boardContext, gateItem, itemBreadcrumb, itemCtx, itemServerError, listIsReadable, type ItemGateOk } from "@/lib/item-gate";
import { applyTimeOfDay, nextOccurrenceAfter, occurrenceKey, parseRecurrence } from "@/lib/recurrence";
import { advanceSeriesOnComplete } from "@/lib/recurring-tasks";
import { prisma } from "@/lib/prisma";
import { hasModule } from "@/lib/space-modules";
import { dispatchEvent } from "@/services/webhookDispatcher";
import { notifyItemAssigned, notifyItemStatusChanged } from "@/lib/notify-item";
import { publishItemChanged } from "@/lib/notify-realtime";
import { parseBoardSchema, type FieldDef } from "@/lib/field-catalog";
import { fieldKeySets } from "@/lib/list-connect";
import { validateConnectWrites } from "@/lib/list-connect-server";
import {
  applyMetadataPatch,
  checkHomeMetadataKeys,
  hiddenFromHomeProjection,
  isReservedMetadataKey,
  mergeWholesaleMetadata,
  readNamespace,
  routeMetadataPatch,
  type Json,
} from "@/lib/list-metadata";
import { decideContext, validateLinkedStatus } from "@/lib/list-links";
import { linkedListsOf, listReader, readableItemsVia, type LinkRow, type ReadableList } from "@/lib/list-links-server";
import { projectItemForViewer, redactFieldsForViewer } from "@/lib/board-items-view";

type Ctx = Exclude<Awaited<ReturnType<typeof itemCtx>>, { error: NextResponse }>;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  // Every throw inside the read becomes a 500 THAT NAMES ITSELF. Without
  // this, a database that is behind the code (a prisma/sql file not applied)
  // makes `prisma.item.findUnique` throw on the first task anyone opens, the
  // App Router answers an empty 500, and the whole product's task surface
  // reads "Couldn't load" with no clue in it. Now the body carries the line.
  try {
    return await readItem(id, c, new URL(req.url).searchParams.get("list"));
  } catch (err) {
    return itemServerError(err, `GET /api/items/${id}`);
  }
}

/**
 * The linked context a request asked for, when it is one: a List the task
 * (or its top-level ancestor on the same home) is linked into and the caller
 * can read. Null for the home and for anything else, which the caller answers
 * as it decides (GET: as if absent; PATCH: invalid_context).
 */
async function linkedContextFor(
  gate: ItemGateOk,
  requested: string | null | undefined,
  c: Ctx,
): Promise<{ list: ReadableList; link: LinkRow; rootId: string } | "home" | "invalid"> {
  if (!requested || requested === gate.item.boardId) return "home";
  const { rootId, links } = await linkedListsOf(gate.item);
  const link = links.find((l) => l.boardId === requested) ?? null;
  const list = link ? await listReader(c).row(requested) : null;
  const kind = decideContext({
    requested,
    homeBoardId: gate.item.boardId,
    linkedBoardIds: links.map((l) => l.boardId),
    requestedReadable: !!list,
  });
  if (kind === "linked" && link && list) return { list, link, rootId };
  return kind === "home" ? "home" : "invalid";
}

async function readItem(id: string, c: Ctx, requestedList: string | null) {
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;
  const item = gate.item;
  const linkedOnly = gate.decision.via === "linked-list";
  const reader = listReader(c);

  // Which body. A linked-only reader ALWAYS gets the linked body: for the
  // List they asked for when it is valid, else for the List that let them in.
  let linked: { list: ReadableList; link: LinkRow; rootId: string } | null = null;
  const asked = await linkedContextFor(gate, requestedList, c);
  if (typeof asked === "object") linked = asked;
  if (!linked && linkedOnly && gate.viaLinkedList) {
    const fallback = await linkedContextFor(gate, gate.viaLinkedList.id, c);
    if (typeof fallback === "object") linked = fallback;
  }
  if (linkedOnly && !linked) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [owner, assigneeUsers, tagAssignments, parentRow, listReadable] = await Promise.all([
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
          select: { id: true, title: true, boardId: true, organizationId: true, ownerId: true, assigneeIds: true, parentItemId: true },
        })
      : Promise.resolve(null),
    linkedOnly ? Promise.resolve(false) : listIsReadable(item, c),
  ]);
  // The parent, exactly as before Phase 5b for every reader the gate let in:
  // a subtask's BackButton is labelled with it, and a reader who cannot open
  // the parent reaches its request-access door through it (spec-task-detail,
  // back-map rule 2). Only a reader who came in THROUGH A SHARED LIST is
  // asked whether they can read it, because that route did not exist before
  // and a shared List must not name anything its reader cannot see. (Their
  // parent is normally the shared task itself, so it is readable.)
  let parent: { id: string; title: string } | null = null;
  if (parentRow) {
    if (!linkedOnly) parent = { id: parentRow.id, title: parentRow.title };
    else if ((await readableItemsVia(c, [parentRow], reader)).get(parentRow.id)?.readable) parent = { id: parentRow.id, title: parentRow.title };
  }

  const homeStatuses = getBoardStatuses(item.board);
  const homeStatus: StatusOption | null = item.status
    ? makeStatusLookup(homeStatuses)[item.status] ?? { value: item.status, label: item.status, color: "#98A2B3", group: "ACTIVE" }
    : null;
  // A personal role (assignee, creator) may see the home's status words, as
  // it sees the home's name in the crumb; only a linked-only reader may not.
  const mayReadHomeStatuses = !linkedOnly;

  const projected = await projectItemForViewer(item, {
    viewer: c,
    context: linked ? linked.list : item.board,
    linked: linked ? { rootId: linked.rootId, position: item.parentItemId ? null : linked.link.position } : null,
    reader,
  });

  const breadcrumb = linkedOnly && linked
    ? { space: null, folder: null, list: { id: linked.list.id, slug: linked.list.slug, name: linked.list.name, readable: true } }
    : await itemBreadcrumb(item, c, { listReadable });

  // The Space, read ONLY for its module toggles (see moduleGating below). It
  // is not a gate and cannot become one: the gate already answered above, a
  // task with no Space reads `null` here, and `hasModule(null, ...)` is true,
  // so a space-less Personal List task gets every field rather than none.
  // In a linked context the toggles are that List's Space's.
  const spaceId = linked ? linked.list.spaceId : item.board.spaceId;
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
    !linkedOnly && item.board.ownerId
      ? prisma.user
          .findFirst({
            where: { id: item.board.ownerId, organizationId: c.organizationId },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const home = boardContext(item);
  const board = linked
    ? {
        id: linked.list.id,
        slug: linked.list.slug,
        name: linked.list.name,
        spaceId: linked.list.spaceId,
        folderId: linked.list.folderId,
        fields: await redactFieldsForViewer(parseBoardSchema(linked.list.schema).fields, reader),
        // The status is always the HOME's. A reader who may see the home set
        // gets it; anyone else a one-element set holding the current status,
        // so an older client still renders the right pill.
        statuses: mayReadHomeStatuses ? homeStatuses : homeStatus ? [homeStatus] : [],
        visibility: linked.list.visibility,
        ownerId: linked.list.ownerId,
      }
    : { ...home, fields: await redactFieldsForViewer(home.fields, reader) };

  return NextResponse.json({
    item: {
      id: item.id,
      // A linked-only reader's task belongs to the List they are reading.
      boardId: linkedOnly && linked ? linked.list.id : item.boardId,
      spaceId: linked ? linked.list.spaceId : item.board.spaceId,
      title: item.title,
      status: item.status,
      ownerId: item.ownerId,
      groupKey: linked && !item.parentItemId ? null : item.groupKey,
      position: projected.position,
      metadata: projected.metadata,
      ...(projected.connections ? { connections: projected.connections } : {}),
      ...(projected.mirrors ? { mirrors: projected.mirrors } : {}),
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
    board,
    // Phase 5b: which List this body is for, and the home status indicator.
    context: {
      boardId: linked ? linked.list.id : item.boardId,
      kind: linked ? "linked" : "home",
      home: listReadable ? { id: item.board.id, slug: item.board.slug, name: item.board.name, readable: true } : { readable: false },
      homeStatus,
      ...(mayReadHomeStatuses ? { homeStatuses } : {}),
    },
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
  let spawnKey: string | null = null;
  if (rule && (rule.trigger ?? "SCHEDULE") === "SCHEDULE") {
    const base = new Date(retimedDue ?? item.dueAt ?? item.startAt ?? new Date());
    // Step from the ANCHOR, not from now: an occurrence whose date already
    // arrived must still spawn (the cron's capped catch-up handles any
    // backlog + records skips). max(now, …) here silently swallowed today's
    // instance when the rule was saved after its time-of-day had passed.
    recurNextAt = nextOccurrenceAfter(base, rule, base);
    spawnKey = occurrenceKey(base);
  }
  // The bookkeeping keys are written over the LOCKED stored blob, so this
  // write can never undo a field value written a moment earlier.
  return updateBoardItem(itemId, {
    recurNextAt,
    ...(retimedDue ? { dueAt: retimedDue } : {}),
  }, actorId, {
    metadataFn: (stored) => {
      const md = { ...stored };
      delete md.lastSpawnedKey;
      delete md.skippedOccurrences;
      if (spawnKey) md.lastSpawnedKey = spawnKey;
      return md;
    },
  });
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
  status: z.string().max(40).nullable().optional(),
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
  // Phase 5b: the List this edit is made in. Absent or the home: the home.
  contextBoardId: z.string().min(1).max(64).optional(),
});

/** A refusal decided inside the metadata write, carried out of its transaction. */
class Refusal extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.error ?? "refused"));
  }
}

/**
 * The metadata write as ONE function of the STORED value, so it can run on the
 * locked row inside updateBoardItem's transaction (and once, first, as a dry
 * run on the value the gate read, so a refusal is answered before anything
 * is written).
 */
function metadataWriter(args: {
  c: Ctx;
  itemId: string;
  linkedListId: string | null;
  fields: readonly FieldDef[];
  metadataPatch?: Json;
  metadata?: Json;
  watcherIds?: string[];
}) {
  const keys = fieldKeySets(args.fields);
  return async (stored: Json): Promise<Json> => {
    let next: Json = stored;
    if (args.linkedListId) {
      if (args.metadataPatch) {
        const routed = routeMetadataPatch(args.metadataPatch, { definedKeys: keys.stored, mirrorKeys: keys.mirror });
        if (!routed.ok) throw new Refusal(400, { error: routed.error, key: routed.key });
        const connect = await validateConnectWrites(args.c, args.fields, routed.ns, {
          stored: readNamespace(stored, args.linkedListId),
          selfId: args.itemId,
        });
        if (!connect.ok) throw new Refusal(400, { error: connect.error, key: connect.key });
        next = applyMetadataPatch(stored, {
          top: routed.top,
          ns: { ...routed.ns, ...connect.values },
          listId: args.linkedListId,
          nsConnectKeys: new Set(connect.keys),
        });
      }
    } else if (args.metadataPatch) {
      const refused = checkHomeMetadataKeys(Object.keys(args.metadataPatch), keys.mirror);
      if (refused) throw new Refusal(400, { error: refused.error, key: refused.key });
      const connect = await validateConnectWrites(args.c, args.fields, args.metadataPatch, { stored, selfId: args.itemId });
      if (!connect.ok) throw new Refusal(400, { error: connect.error, key: connect.key });
      next = applyMetadataPatch(stored, { top: { ...args.metadataPatch, ...connect.values }, topConnectKeys: new Set(connect.keys) });
    } else if (args.metadata) {
      const refused = checkHomeMetadataKeys(Object.keys(args.metadata), keys.mirror);
      if (refused) throw new Refusal(400, { error: refused.error, key: refused.key });
      const connect = await validateConnectWrites(args.c, args.fields, args.metadata, { stored, selfId: args.itemId });
      if (!connect.ok) throw new Refusal(400, { error: connect.error, key: connect.key });
      // The whole-blob save keeps what the writer never saw: every "$" key,
      // and every connect value their projection hid.
      next = mergeWholesaleMetadata(stored, { ...args.metadata, ...connect.values }, {
        keepKeys: hiddenFromHomeProjection(stored, keys.connect),
        topConnectKeys: new Set(connect.keys),
      });
    }
    // The watcher lists are task-level and only `watcherIds` may change them;
    // every other write re-merges the STORED lists, so an autosave can never
    // re-subscribe somebody who pressed Unwatch.
    const storedWatchers = readWatchers(stored);
    return args.watcherIds
      ? writeWatchers(next, applyWatcherIds(storedWatchers, args.watcherIds, args.c.userId))
      : writeWatchers(next, storedWatchers);
  };
}

async function fieldsOf(boardId: string): Promise<FieldDef[]> {
  const b = await prisma.board.findUnique({ where: { id: boardId }, select: { schema: true } });
  return parseBoardSchema(b?.schema).fields;
}

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

  // Reserved keys are never written by a client, in either shape.
  for (const blob of [parsed.data.metadata, parsed.data.metadataPatch]) {
    const k = blob ? Object.keys(blob).find(isReservedMetadataKey) : undefined;
    if (k) return NextResponse.json({ error: "reserved_key", key: k }, { status: 400 });
  }

  // ── Phase 5b: the context List ───────────────────────────────────
  const contextAsked = await linkedContextFor(gate, parsed.data.contextBoardId, c);
  if (contextAsked === "invalid") return NextResponse.json({ error: "invalid_context" }, { status: 400 });
  const linkedCtx = typeof contextAsked === "object" ? contextAsked : null;
  delete (parsed.data as { contextBoardId?: unknown }).contextBoardId;
  if (linkedCtx) {
    // Moving, reordering and regrouping belong to the link in a secondary
    // List (PATCH /api/boards/[B]/links/[id]), so none of them can re-home
    // the task or reorder its home from here.
    if (parsed.data.boardId !== undefined || parsed.data.position !== undefined || parsed.data.groupKey !== undefined) {
      return NextResponse.json({ error: "use_list_link" }, { status: 400 });
    }
    if (parsed.data.metadata !== undefined) {
      return NextResponse.json({ error: "use_metadata_patch" }, { status: 400 });
    }
    // THE VALUES LIST B OWNS NEED WRITE ON LIST B. The gate above answered
    // for the TASK (its home List, or being its assignee or creator), and that
    // is what the shared body (title, status, dates, description) needs. A
    // key this patch would write into B's own namespace is B's content, so it
    // takes contribute on B, as every other link-side write does (reorder,
    // move, add): a read-only guest of B edits none of B's columns, whatever
    // they may do to the task at home.
    if (parsed.data.metadataPatch) {
      const bKeys = fieldKeySets(parseBoardSchema(linkedCtx.list.schema).fields);
      const routed = routeMetadataPatch(parsed.data.metadataPatch, { definedKeys: bKeys.stored, mirrorKeys: bKeys.mirror });
      if (routed.ok && Object.keys(routed.ns).length > 0 && !(await canContributeBoard(linkedCtx.list.id, c.userId, c.accessLevel))) {
        return NextResponse.json({ error: "no_access", reason: "list_read_only", requestAccess: true }, { status: 403 });
      }
    }
  }

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

  // ── Move to another List: every check, and no write yet ─────────
  //
  // The move does NOT return early. A body that carries `boardId` beside a
  // title, a status or a metadata blob used to answer 200 having written only
  // the move, silently discarding every other field the caller sent; now the
  // move runs first and the rest of the patch is applied straight after it, so
  // nothing a user typed is thrown away under a success. Every refusal (the
  // move's, the status rule's, the metadata's) is answered BEFORE the move is
  // written, so a refused patch never leaves a half-applied one behind.
  const sourceBoardId = gate.item.boardId;
  let target: { id: string; name: string; statuses: unknown; productSlug: string | null } | null = null;
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
    target = await prisma.board.findFirst({
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
  }
  delete (parsed.data as { boardId?: unknown }).boardId;
  const remap = target
    ? remapStatusOnMove({ status: gate.item.status, from: getBoardStatuses(gate.item.board), to: getBoardStatuses(target) })
    : null;
  const currentBoardId = target ? target.id : gate.item.boardId;
  const currentStatuses = target ? getBoardStatuses(target) : getBoardStatuses(gate.item.board);

  // ── Phase 5b: a linked task's status comes from its HOME set ─────
  if (parsed.data.status !== undefined && parsed.data.status !== null) {
    const { links } = await linkedListsOf(gate.item);
    const stillLinked = links.filter((l) => l.boardId !== currentBoardId);
    const verdict = validateLinkedStatus(parsed.data.status, currentStatuses, remap ? remap.status : gate.item.status, stillLinked.length > 0);
    if (!verdict.ok) {
      return NextResponse.json({ error: "invalid_status", reason: verdict.reason, homeStatuses: currentStatuses }, { status: 409 });
    }
  }

  // ── Phase 5b: the metadata write, as a function of the stored value ──
  const wantsMetadata = parsed.data.metadataPatch !== undefined || parsed.data.metadata !== undefined || parsed.data.watcherIds !== undefined;
  const writer = wantsMetadata
    ? metadataWriter({
        c,
        itemId: id,
        linkedListId: linkedCtx ? linkedCtx.list.id : null,
        fields: linkedCtx ? parseBoardSchema(linkedCtx.list.schema).fields : await fieldsOf(currentBoardId),
        metadataPatch: parsed.data.metadataPatch,
        metadata: parsed.data.metadata,
        watcherIds: parsed.data.watcherIds,
      })
    : null;
  if (writer) {
    try {
      const pre = gate.item.metadata;
      await writer(pre && typeof pre === "object" && !Array.isArray(pre) ? (pre as Json) : {});
    } catch (err) {
      if (err instanceof Refusal) return NextResponse.json(err.body, { status: err.status });
      throw err;
    }
  }
  delete (parsed.data as { metadataPatch?: unknown }).metadataPatch;
  delete (parsed.data as { metadata?: unknown }).metadata;
  delete (parsed.data as { watcherIds?: unknown }).watcherIds;
  const responseContext = linkedCtx ? linkedCtx.list.id : currentBoardId;

  // ── The move itself ──────────────────────────────────────────────
  let moved: { toBoardId: string; toListName: string; status: string | null; reason: string } | null = null;
  if (target && remap) {
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
      leftListIds: [sourceBoardId],
    });
  }

  // A move on its own, no other field in the body, is already written.
  if (moved && Object.keys(parsed.data).length === 0 && !writer) {
    const row = await getBoardItemRow(id, { viewer: c, contextBoardId: responseContext });
    return NextResponse.json({ ...(row ? { item: row } : {}), moved });
  }

  try {
    const updated = await updateBoardItem(id, parsed.data, c.userId, writer ? { metadataFn: writer } : {});
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
    // time/creator, the exact listBoardItems shape), projected for this
    // viewer in the List the edit was made in.
    const rowFor = async () => getBoardItemRow(id, { viewer: c, contextBoardId: responseContext });
    if (parsed.data.recurRule !== undefined) {
      const rescheduled = await applyRecurrenceSchedule(id, parsed.data.recurRule ?? null, c.userId);
      if (rescheduled) return NextResponse.json({ item: (await rowFor()) ?? rescheduled, ...(moved ? { moved } : {}) });
    } else if (parsed.data.dueAt !== undefined) {
      // The due date IS the series anchor, moving it re-anchors an active
      // SCHEDULE series (recurNextAt + lastSpawnedKey recomputed from it).
      const storedRule = parseRecurrence(gate.item.recurRule);
      if (storedRule && (storedRule.trigger ?? "SCHEDULE") === "SCHEDULE") {
        const rescheduled = await applyRecurrenceSchedule(id, gate.item.recurRule, c.userId);
        if (rescheduled) return NextResponse.json({ item: (await rowFor()) ?? rescheduled, ...(moved ? { moved } : {}) });
      }
    }
    // Completing an ON_COMPLETE recurring task advances its series in place -
    // return the rolled-forward row so the board updates without a refetch.
    if (parsed.data.status !== undefined) {
      const recur = await advanceSeriesOnComplete(id, updated.status, c.userId);
      if (recur.recurred && recur.item) {
        return NextResponse.json({ item: (await rowFor()) ?? recur.item, recurred: true, ...(moved ? { moved } : {}) });
      }
    }
    return NextResponse.json({ item: (await rowFor()) ?? updated, ...(moved ? { moved } : {}) });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json(err.body, { status: err.status });
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
  // Phase 5b: "Delete" pressed inside a SECONDARY List must never destroy the
  // task in its home by accident. There it answers use_list_link, and the
  // client offers "Remove from this List" or an explicit "Delete everywhere".
  const listParam = url.searchParams.get("list");
  if (listParam && url.searchParams.get("everywhere") !== "1") {
    const ctx = await linkedContextFor(gate, listParam, c);
    if (typeof ctx === "object") {
      return NextResponse.json({ error: "use_list_link", hint: "remove_from_list" }, { status: 400 });
    }
  }
  const boardId = gate.item.boardId;
  if (hard) {
    // Recoverable delete, snapshot to Trash (with the task's links), then
    // remove (subtasks and links cascade).
    await moveToTrash("item", id, { organizationId: c.organizationId, userId: c.userId, userName: c.userName });
    // An open drawer or board has to hear about this too: without the publish
    // a hard delete left every other viewer looking at a row that was gone.
    void publishItemChanged({ itemId: id, boardId, organizationId: c.organizationId, actorId: c.userId });
    return NextResponse.json({ ok: true });
  }
  const archived = await archiveBoardItem(id, c.userId);
  void publishItemChanged({ itemId: id, boardId, organizationId: c.organizationId, actorId: c.userId });
  // Full enriched row, same as PATCH, the client merges this into its cache.
  return NextResponse.json({ item: (await getBoardItemRow(id, { viewer: c })) ?? archived });
}
