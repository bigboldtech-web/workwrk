// GET /api/work/locate?folderId=&boardSlug=&boardId=: where in the tree is this?
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 (Tree data):
// "/folders/[id] -> that Folder's row active; ancestors expanded", and the same
// for a List deep link.
//
// WHY A ROUTE. The sidebar's expand state came only from the stored
// preference, so the FIRST time a person followed a link to a Folder or a
// List the tree sat collapsed with no active row: the page knew where it was and the
// navigation did not. The tree cannot work the ancestry out for itself, because
// it only loads a Space's children once that Space is already open, which is
// the thing being decided. One cheap read answers it.
//
// It returns ids only (never names, never contents), and it returns them only
// when the viewer may read the object, so it is not an enumeration door: an
// unreadable or absent object answers 404 exactly as its page does.
//
// THE FOLDERS IT RETURNS are the ones the viewer's own tree renders on the
// way to the object (revealFolderIds, src/lib/work/placement-server.ts): the
// one resolver's walk, where a Folder shows when the viewer can open it or
// passes through it on the way to what they were given (a path container),
// to the depth the tree loads. A path Folder itself answers too: its page is
// the path view, and the tree renders it at its real depth. A Doc, Table or
// Canvas opened in Work needs no call here: its route's gate computes the
// same ids and the page publishes them.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nodeCtxFromSession, nodeRole } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { revealFolderIds } from "@/lib/work/placement-server";

export const dynamic = "force-dynamic";

const NOT_FOUND = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(req: Request) {
  const ctx = await nodeCtxFromSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = ctx.organizationId;

  const url = new URL(req.url);
  const folderId = url.searchParams.get("folderId");
  const boardSlug = url.searchParams.get("boardSlug");
  const boardId = url.searchParams.get("boardId");

  if (folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, organizationId },
      select: { id: true, spaceId: true },
    });
    if (!folder) return NOT_FOUND();
    // Readable, or a path container the viewer passes through: both have a
    // row in their tree. Anything else is the same 404 as a wrong id.
    const d = await nodeRole(ctx, { kind: "folder", id: folder.id });
    if (!roleAtLeast(d.role, "VIEW") && !d.path) return NOT_FOUND();
    const ids = await revealFolderIds(ctx, { kind: "folder", id: folder.id });
    return NextResponse.json({
      spaceId: folder.spaceId,
      // Nearest first, as this route has always answered.
      folderIds: ids.reverse(),
      boardId: null,
    });
  }

  if (boardSlug || boardId) {
    const board = await prisma.board.findFirst({
      where: boardSlug ? { slug: boardSlug, organizationId } : { id: boardId!, organizationId },
      select: { id: true, spaceId: true, folderId: true },
    });
    if (!board) return NOT_FOUND();
    const d = await nodeRole(ctx, { kind: "list", id: board.id });
    if (!roleAtLeast(d.role, "VIEW")) return NOT_FOUND();
    const ids = board.folderId && board.spaceId ? await revealFolderIds(ctx, { kind: "list", id: board.id }) : [];
    return NextResponse.json({
      spaceId: board.spaceId,
      folderIds: ids.reverse(),
      boardId: board.id,
    });
  }

  return NextResponse.json({ error: "folderId, boardSlug or boardId is required" }, { status: 400 });
}
