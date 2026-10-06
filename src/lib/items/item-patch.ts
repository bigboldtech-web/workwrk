// PATCH /api/items/[id], as a function of WHO is acting.
//
// AI teammates (docs/plans/ai-teammates.md 3.15) change and move tasks AS the
// person they work for, who is not at the keyboard. A teammate has to run the
// exact path that person's own PATCH runs, or it could do what they cannot, or
// do it differently: every gate, every refusal and its body, the automation
// events, the Inbox notifications, the realtime nudge and the recurrence step,
// in the same order. So the route's body lives here, moved verbatim, and both
// callers come through it:
//
//   PATCH /api/items/[id]   reads the session (itemCtx) and the JSON body,
//                           then hands both here
//   the teammate tools      build the person's ItemCtx (the plan's 3.2) and
//                           hand it here with the tool's body
//
// The caller answers only "who is calling". Everything about the task (the
// item gate, both Lists' contribute checks, the Personal List refusal, the
// linked-status rule, the assignee check) is decided below for the ItemCtx it
// is given, so a person who is not at the keyboard meets exactly the rules they
// would meet in the browser. The answer is the route's own NextResponse.
//
// Server-only: imports prisma.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getBoardItemRow,
  moveBoardItem,
  updateBoardItem,
  PRIORITY_OPTIONS,
} from "@/lib/board-items";
import { canContributeBoard, getBoardForReader } from "@/lib/board";
import { unknownUserIds } from "@/lib/assignable";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { remapStatusOnMove } from "@/lib/item-move";
import { applyWatcherIds, readWatchers, writeWatchers } from "@/lib/item-watchers";
import { gateItem, type ItemCtx } from "@/lib/item-gate";
import { allowsItemAction } from "@/lib/item-role";
import { applyTimeOfDay, nextOccurrenceAfter, occurrenceKey, parseRecurrence } from "@/lib/recurrence";
import { advanceSeriesOnComplete } from "@/lib/recurring-tasks";
import { prisma } from "@/lib/prisma";
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
import { validateLinkedStatus } from "@/lib/list-links";
import { linkedListsOf } from "@/lib/list-links-server";
import { BUILT_IN_FIELD_KEYS, fieldChanges } from "@/lib/automation/field-changes";
import { linkedContextFor } from "@/lib/item-context";
import { isAiFieldType, normalizeAiWrites } from "@/lib/ai-fields";
import { aiFieldsOn } from "@/lib/ai/ai-features";

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
  c: ItemCtx;
  itemId: string;
  linkedListId: string | null;
  fields: readonly FieldDef[];
  metadataPatch?: Json;
  metadata?: Json;
  watcherIds?: string[];
  /** One time for the whole request, so every re-run stamps the same value. */
  now: string;
  /** The workspace has AI fields on (src/lib/ai/ai-features.ts): AI values are checked and stamped. */
  aiStrict: boolean;
}) {
  const keys = fieldKeySets(args.fields);
  // Batch 8: a write to one of this List's AI fields is a person's
  // correction, checked and stamped as theirs (src/lib/ai-fields.ts); a value
  // the client only re-sent stays exactly as stored.
  const aiChecked = (patch: Json, place: Json): Json => {
    const r = normalizeAiWrites(patch, { fields: args.fields, stored: place, actorId: args.c.userId, now: args.now, strict: args.aiStrict });
    if (!r.ok) throw new Refusal(400, { error: r.error, key: r.key });
    return r.patch;
  };
  return async (stored: Json): Promise<Json> => {
    let next: Json = stored;
    if (args.linkedListId) {
      if (args.metadataPatch) {
        const routed = routeMetadataPatch(args.metadataPatch, { definedKeys: keys.stored, mirrorKeys: keys.mirror });
        if (!routed.ok) throw new Refusal(400, { error: routed.error, key: routed.key });
        routed.ns = aiChecked(routed.ns, readNamespace(stored, args.linkedListId));
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
      const patch = aiChecked(args.metadataPatch, stored);
      const connect = await validateConnectWrites(args.c, args.fields, patch, { stored, selfId: args.itemId });
      if (!connect.ok) throw new Refusal(400, { error: connect.error, key: connect.key });
      next = applyMetadataPatch(stored, { top: { ...patch, ...connect.values }, topConnectKeys: new Set(connect.keys) });
    } else if (args.metadata) {
      const refused = checkHomeMetadataKeys(Object.keys(args.metadata), keys.mirror);
      if (refused) throw new Refusal(400, { error: refused.error, key: refused.key });
      const blob = aiChecked(args.metadata, stored);
      const connect = await validateConnectWrites(args.c, args.fields, blob, { stored, selfId: args.itemId });
      if (!connect.ok) throw new Refusal(400, { error: connect.error, key: connect.key });
      // The whole-blob save keeps what the writer never saw: every "$" key,
      // and every connect value their projection hid.
      next = mergeWholesaleMetadata(stored, { ...blob, ...connect.values }, {
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

/**
 * Apply one task PATCH body for `c`, exactly as PATCH /api/items/[id] does.
 * `body` is the request's JSON (null when it did not parse); the answer is the
 * route's response, status and body included.
 */
export async function patchItemAs(c: ItemCtx, id: string, body: unknown): Promise<NextResponse> {
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  // A move needs Can edit on BOTH Lists, so it gates on "move" rather than on
  // "edit" and then checks the target separately below.
  //
  // Watching is personal, like a reminder: a body that only changes
  // watcherIds needs Can view, and below Can edit it can only add or remove
  // the caller (applied to the stored list, so a stale list in the browser
  // never adds or drops anyone else). The menu offers Watch at Can view.
  const keys = Object.keys(parsed.data).filter((k) => (parsed.data as Record<string, unknown>)[k] !== undefined);
  const onlyWatching = parsed.data.watcherIds !== undefined && keys.every((k) => k === "watcherIds" || k === "contextBoardId");
  const gate = await gateItem(id, c, parsed.data.boardId ? "move" : onlyWatching ? "view" : "edit");
  if ("error" in gate) return gate.error;
  if (onlyWatching && !allowsItemAction(gate.decision, "edit", { creator: gate.creatorId === c.userId })) {
    const wants = parsed.data.watcherIds!.includes(c.userId);
    const others = gate.watcherIds.filter((w) => w !== c.userId);
    parsed.data.watcherIds = wants ? [...others, c.userId] : others;
  }

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

  // Where a task sits in its List (its order, and the older group key) is the
  // List's arrangement, a List write: Can edit on the List, the same rule as
  // PUT /api/boards/[id]/order. Being assigned opens a task's content to
  // change (rule 9), never its place among everyone else's.
  if ((parsed.data.position !== undefined || parsed.data.groupKey !== undefined) && !gate.canAddToList) {
    return NextResponse.json({ error: "no_access", reason: "list_read_only", requestAccess: true }, { status: 403 });
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
  const writerFields = wantsMetadata ? (linkedCtx ? parseBoardSchema(linkedCtx.list.schema).fields : await fieldsOf(currentBoardId)) : [];
  // Batch 8: whether AI-typed values are checked and stamped, read only when
  // this write touches one (src/lib/ai-fields.ts normalizeAiWrites).
  const touchedKeys = [...Object.keys(parsed.data.metadataPatch ?? {}), ...Object.keys(parsed.data.metadata ?? {})];
  const touchesAi = touchedKeys.some((k) => writerFields.some((f) => f.key === k && isAiFieldType(f.type)));
  const aiStrict = touchesAi
    ? aiFieldsOn((await prisma.organization.findUnique({ where: { id: c.organizationId }, select: { settings: true } }))?.settings)
    : false;
  const writer = wantsMetadata
    ? metadataWriter({
        c,
        itemId: id,
        linkedListId: linkedCtx ? linkedCtx.list.id : null,
        fields: writerFields,
        metadataPatch: parsed.data.metadataPatch,
        metadata: parsed.data.metadata,
        watcherIds: parsed.data.watcherIds,
        now: new Date().toISOString(),
        aiStrict,
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
      enteredListIds: [target.id],
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

    // "When a task field changes": one event per changed field (title,
    // priority, dates, and the List's own fields), after the save landed.
    // Built after the write so a refused save never fires it. Never throws.
    try {
      const listKeys = writer && !linkedCtx ? (await fieldsOf(currentBoardId)).map((f) => f.key) : [];
      // Which fields the request touched, but the values the row now HOLDS
      // (a recurrence re-time or a stripped field reports what was stored,
      // not what was asked for).
      const saved: Record<string, unknown> = { metadata: writer ? updated.metadata : undefined };
      const stored = updated as unknown as Record<string, unknown>;
      for (const key of BUILT_IN_FIELD_KEYS) if (key in parsed.data) saved[key] = stored[key];
      const changes = fieldChanges(
        { title: gate.item.title, priority: gate.item.priority, dueAt: gate.item.dueAt, startAt: gate.item.startAt, metadata: gate.item.metadata },
        saved,
        listKeys,
      );
      for (const ch of changes.slice(0, 20)) {
        dispatchEvent({
          organizationId: c.organizationId,
          event: "task.field_changed",
          payload: {
            id: updated.id,
            boardId: currentBoardId,
            title: updated.title,
            status: updated.status,
            ownerId: updated.ownerId,
            assigneeId: updated.ownerId,
            priority: updated.priority,
            dueAt: updated.dueAt,
            startAt: updated.startAt,
            field: ch.field,
            value: ch.value,
            previousValue: ch.previousValue,
            actorId: c.userId,
            updatedAt: updated.updatedAt,
          },
        }).catch(() => {});
      }
    } catch {
      /* the save already landed; an event pipe never fails it */
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
