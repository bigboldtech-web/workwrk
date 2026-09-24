// GET  /api/boards/[id]/items — list non-archived items
//      ?links=1 (Phase 5b): the List's own rows UNION the rows linked into it
// POST /api/boards/[id]/items — append a new item to the board
//
// Phase 5b. Every row is projected for the viewer (src/lib/board-items-view.ts):
// the reserved "$" keys are never sent, a connect value is reduced to the
// tasks the viewer can read, and connect and mirror columns come back as
// `connections` and `mirrors`. WITHOUT ?links=1 the rows are exactly today's
// home rows otherwise, so no existing client changes; the canvas asks for the
// union only once LIST_LINK_CANVAS_LIVE flips (src/lib/list-links.ts).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canContributeBoard, canReadBoard, getBoardForReader } from "@/lib/board";
import { createBoardItem, getBoardItemRow, listBoardItems, PRIORITY_OPTIONS } from "@/lib/board-items";
import { notifyItemAssigned } from "@/lib/notify-item";
import { unknownUserIds } from "@/lib/assignable";
import { prisma } from "@/lib/prisma";
import { parseBoardSchema } from "@/lib/field-catalog";
import { fieldKeySets } from "@/lib/list-connect";
import { validateConnectWrites } from "@/lib/list-connect-server";
import { applyMetadataPatch, checkHomeMetadataKeys, isReservedMetadataKey, routeMetadataPatch } from "@/lib/list-metadata";
import { linkedListsOf } from "@/lib/list-links-server";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const canRead = await canReadBoard(id, c.userId, c.accessLevel);
  if (!canRead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const items = await listBoardItems(id, {
    includeArchived,
    view: { viewer: c, contextBoardId: id },
    includeLinked: url.searchParams.get("links") === "1",
  });
  return NextResponse.json({ items });
}

const createSchema = z.object({
  title: z.string().min(1).max(280),
  status: z.string().max(40).optional(),
  // Shape-checked here, existence-checked against the org below. These columns
  // carry no foreign key, so nothing else refuses a typo or a 5000-character
  // string. See the same pair in PATCH /api/items/[id].
  ownerId: z.string().trim().min(1).max(64).nullable().optional(),
  assigneeIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  groupKey: z.string().max(80).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Phase 58 — optional scheduling on create.
  startAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  // Task-system phase 2 — first-class priority + workspace tags on create.
  priority: z.enum(PRIORITY_OPTIONS.map((p) => p.value) as [string, ...string[]]).nullable().optional(),
  tagIds: z.array(z.string().min(1)).max(20).optional(),
  // Task Types — the ItemType to re-skin this row as (null = default).
  itemTypeId: z.string().min(1).nullable().optional(),
  // Phase 72 — pass to create a subtask under the given parent.
  parentItemId: z.string().min(1).nullable().optional(),
});

/** The body keys List defaults may fill when the client did not send them. */
const DEFAULTABLE_KEYS = ["status", "priority", "assigneeIds", "ownerId", "tagIds", "itemTypeId"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  // Phase 23b — compose Space + Board gates. Cross-org check is folded
  // into getBoardForReader.
  const board = await getBoardForReader(id, c.userId, c.accessLevel);
  if (!board || board.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Creating a task is CONTENT, not board management — a Space/Board MEMBER
  // may do it (canContributeBoard), only GUESTs are blocked.
  const canWrite = await canContributeBoard(id, c.userId, c.accessLevel);
  if (!canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  // A task may only be created FOR a real, live person in this org: the
  // assignee columns have no foreign key, so an unchecked id lands in the row
  // and, once owner-only patches started merging, never leaves it again.
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

  // ── Phase 5b: the metadata this create may carry ────────────────────
  const submitted = parsed.data.metadata ?? {};
  const reserved = Object.keys(submitted).find(isReservedMetadataKey);
  if (reserved) return NextResponse.json({ error: "reserved_key", key: reserved }, { status: 400 });
  const listRow = await prisma.board.findUnique({ where: { id }, select: { schema: true } });
  const listFields = parseBoardSchema(listRow?.schema).fields;
  const listKeys = fieldKeySets(listFields);

  // A subtask under a task that is LINKED into this List is created on the
  // parent's HOME List (a subtask belongs to its parent), and so it needs
  // write access there as well; it appears here with its parent, because the
  // subtree is part of the share, so there is no second write that can fail.
  let homeBoardId = id;
  let linkedParent = false;
  if (parsed.data.parentItemId) {
    const parent = await prisma.item.findFirst({
      where: { id: parsed.data.parentItemId, organizationId: c.organizationId },
      select: { id: true, boardId: true, parentItemId: true },
    });
    if (parent && parent.boardId !== id) {
      const { links } = await linkedListsOf(parent);
      if (links.some((l) => l.boardId === id)) {
        if (!(await canContributeBoard(parent.boardId, c.userId, c.accessLevel))) {
          return NextResponse.json({ error: "no_access", reason: "parent_home_list_read_only" }, { status: 403 });
        }
        homeBoardId = parent.boardId;
        linkedParent = true;
      }
    }
  }

  let metadata: Record<string, unknown> = submitted;
  let validatedConnectKeys: string[] = [];
  if (linkedParent) {
    // This List's keys go to its namespace on the task, task-level keys to the
    // top, anything else (a home-only field) is not this List's to write.
    const routed = routeMetadataPatch(submitted, { definedKeys: listKeys.stored, mirrorKeys: listKeys.mirror });
    if (!routed.ok) return NextResponse.json({ error: routed.error, key: routed.key }, { status: 400 });
    const connect = await validateConnectWrites(c, listFields, routed.ns, {});
    if (!connect.ok) return NextResponse.json({ error: connect.error, key: connect.key }, { status: 400 });
    metadata = applyMetadataPatch({}, {
      top: routed.top,
      ns: { ...routed.ns, ...connect.values },
      listId: id,
      nsConnectKeys: new Set(connect.keys),
    });
  } else {
    const refused = checkHomeMetadataKeys(Object.keys(submitted), listKeys.mirror);
    if (refused) return NextResponse.json({ error: refused.error, key: refused.key }, { status: 400 });
    const connect = await validateConnectWrites(c, listFields, submitted, {});
    if (!connect.ok) return NextResponse.json({ error: connect.error, key: connect.key }, { status: 400 });
    metadata = { ...submitted, ...connect.values };
    validatedConnectKeys = connect.keys;
  }

  // The keys the client SENT, explicit nulls included: defaults never
  // override one of them (list-comfort.ts planCreateDefaults).
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const sentKeys = new Set<string>(DEFAULTABLE_KEYS.filter((k) => k in raw));
  const sentMetadataKeys = new Set<string>(Object.keys(submitted));

  try {
    const item = await createBoardItem(
      {
        organizationId: c.organizationId,
        boardId: homeBoardId,
        title: parsed.data.title,
        status: parsed.data.status,
        ownerId: parsed.data.ownerId ?? undefined,
        assigneeIds: parsed.data.assigneeIds,
        groupKey: parsed.data.groupKey,
        metadata,
        startAt: parsed.data.startAt ?? null,
        dueAt: parsed.data.dueAt ?? null,
        priority: parsed.data.priority ?? null,
        itemTypeId: parsed.data.itemTypeId ?? null,
        tagIds: parsed.data.tagIds,
        parentItemId: parsed.data.parentItemId ?? null,
        actorId: c.userId,
      },
      {
        // The HOME List's defaults, which for a subtask under a linked parent
        // is the parent's home, never this List's.
        listDefaults: { sentKeys, sentMetadataKeys },
        // A linked-parent blob was built above, namespace and all.
        trustedMetadata: linkedParent,
        validatedConnectKeys,
      },
    );
    // Inbox notification — a task created FOR someone else lands in their
    // bell. Routed through src/lib/notify-item.ts so the recipient's
    // /settings/notifications toggle is the only switch that matters; the
    // helper no-ops when the owner is the actor or the item is unassigned.
    // Never throws (best effort): the item is already saved. When the List's
    // defaults chose the people (the client sent none), the person they chose
    // hears about it exactly as if the creator had picked them.
    const peopleSent = sentKeys.has("assigneeIds") || sentKeys.has("ownerId");
    await notifyItemAssigned({
      organizationId: c.organizationId,
      item: { id: item.id, title: item.title, dueAt: item.dueAt ?? null },
      ownerId: parsed.data.ownerId ?? (peopleSent ? null : item.ownerId ?? null),
      actorId: c.userId,
    });
    // Respond with the FULL enriched row (counts/links/time/creator — the
    // exact listBoardItems shape): clients append this straight into their
    // cached list, and a lean row there diverges from refetched rows.
    const row = (await getBoardItemRow(item.id, { viewer: c, contextBoardId: id })) ?? item;
    return NextResponse.json({ item: row, ...(linkedParent ? { homeBoardId } : {}) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create item" },
      { status: 400 },
    );
  }
}
