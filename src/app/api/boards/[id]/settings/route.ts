// GET /api/boards/[id]/settings: the List comfort rules every reader of the
// List page needs (Phase 5b, gap 14): its default values for new tasks and
// its conditional row colours.
//
// Row colours are display, so the gate is the List page's own:
// getBoardForReaderOrFolderGrantee, which also admits a granular folder
// grantee the strict predicate does not know about. The task type default is
// read from settings.defaultItemTypeId, its one home.
//
// Answer: { defaults, rowColorRules, statuses, staleDefaults }.
//   defaults       PRUNED to what still applies, with the SAME three existence
//                  checks createBoardItem's withListDefaults runs (people live
//                  in this org, tags not archived, task types in this org), so
//                  a create surface never shows "Default: <someone gone>";
//   statuses       this List's own set, which a default status must be in;
//   staleDefaults  how many stored entries no longer apply (a field, status,
//                  person, tag or type that was removed). The List settings
//                  panel says so, and its next Save drops them.
//
// Writes go through PATCH /api/boards/[id] (defaults, rowColorRules), which
// merges them into the stored settings on a locked row.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { parseRowColorRules, readListDefaults, userIdsInDefaults } from "@/lib/list-comfort";
import { pruneListDefaults } from "@/lib/list-defaults-client";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { parseBoardSchema } from "@/lib/field-catalog";
import { boardForViewerOrGrantee } from "@/lib/list-links-server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  if (!(await boardForViewerOrGrantee(c, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const board = await prisma.board.findFirst({
    where: { id, organizationId: c.organizationId },
    select: { settings: true, statuses: true, schema: true },
  });
  const settings = board?.settings && typeof board.settings === "object" && !Array.isArray(board.settings)
    ? (board.settings as Record<string, unknown>)
    : {};
  const statuses = getBoardStatuses(board);
  const fields = parseBoardSchema(board?.schema).fields;
  const stored = readListDefaults(settings);
  const userIds = userIdsInDefaults(stored, fields);
  const [users, tags, types] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds }, organizationId: c.organizationId, deletedAt: null, status: { not: "INACTIVE" } }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
    stored.tagIds?.length
      ? prisma.tag.findMany({ where: { id: { in: stored.tagIds }, organizationId: c.organizationId, archived: false }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
    stored.itemTypeId
      ? prisma.itemType.findMany({ where: { id: stored.itemTypeId, organizationId: c.organizationId }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
  ]);
  const { defaults, stale } = pruneListDefaults(stored, {
    statuses,
    fields,
    liveUserIds: new Set(users.map((u) => u.id)),
    liveTagIds: new Set(tags.map((t) => t.id)),
    liveItemTypeIds: new Set(types.map((t) => t.id)),
  });
  // A deleted default task TYPE is pruned (nothing applies it), but it is not
  // counted: it is kept by the "Default task type" submenu, not by the Default
  // values panel whose Save this count promises will clear the stale ones.
  const typeStale = stored.itemTypeId && types.length === 0 ? 1 : 0;
  return NextResponse.json(
    { defaults, rowColorRules: parseRowColorRules(settings.rowColorRules), statuses, staleDefaults: stale - typeStale },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
