// GET /api/boards/[id]/settings: the List comfort rules every reader of the
// List page needs (Phase 5b, gap 14): its default values for new tasks and
// its conditional row colours.
//
// Row colours are display, so the gate is the List page's own:
// getBoardForReaderOrFolderGrantee, which also admits a granular folder
// grantee the strict predicate does not know about. The task type default is
// read from settings.defaultItemTypeId, its one home.
//
// Writes go through PATCH /api/boards/[id] (defaults, rowColorRules), which
// merges them into the stored settings on a locked row.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { parseRowColorRules, readListDefaults } from "@/lib/list-comfort";
import { boardForViewerOrGrantee } from "@/lib/list-links-server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  if (!(await boardForViewerOrGrantee(c, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const board = await prisma.board.findFirst({ where: { id, organizationId: c.organizationId }, select: { settings: true } });
  const settings = board?.settings && typeof board.settings === "object" && !Array.isArray(board.settings)
    ? (board.settings as Record<string, unknown>)
    : {};
  return NextResponse.json(
    { defaults: readListDefaults(settings), rowColorRules: parseRowColorRules(settings.rowColorRules) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
