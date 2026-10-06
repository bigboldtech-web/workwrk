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
import {
  archiveBoardItem,
  getBoardItemRow,
} from "@/lib/board-items";
import { moveToTrash } from "@/lib/trash";
import { getBoardStatuses, makeStatusLookup, type StatusOption } from "@/lib/board-items-shared";
import { boardContext, gateItem, itemBreadcrumb, itemCtx, itemServerError, listIsReadable, type ItemGateOk } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { hasModule } from "@/lib/space-modules";
import { publishItemChanged } from "@/lib/notify-realtime";
import { parseBoardSchema } from "@/lib/field-catalog";
import { decideContext } from "@/lib/list-links";
import { listReader, readableItemsVia, type LinkRow, type ReadableList } from "@/lib/list-links-server";
import { projectItemForViewer, redactFieldsForViewer } from "@/lib/board-items-view";
import { linkedContextFor } from "@/lib/item-context";
import { patchItemAs } from "@/lib/items/item-patch";

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
    // Adding a subtask adds to the List: Can edit on it (founder decision 3,
    // Can edit assigned tasks changes the viewer's tasks, never adds one).
    canAddToList: gate.canAddToList,
    // Managing statuses and fields is the HOME List's (Full access on it), but
    // opened in a List the task is only shown in, the page's fields and its
    // Manage links are that other List's: no answer here fits both, so none.
    canManageList: linked ? false : gate.canManageList,
  });
}

// The write path lives in src/lib/items/item-patch.ts, so an AI teammate's
// tools run it as the person they act for (docs/plans/ai-teammates.md 3.15).
// The session and the body are read here; everything about the task is
// decided there.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  return patchItemAs(c, id, body);
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
