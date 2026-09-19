// GET /api/work/locate?folderId=&boardSlug=&boardId= — where in the tree is this?
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 (Tree data):
// "/folders/[id] -> that Folder's row active; ancestors expanded", and the same
// for a List deep link.
//
// WHY A ROUTE. The sidebar's expand state came only from the stored
// preference, so the FIRST time a person followed a link to a Folder or a List
// the tree sat collapsed with no active row: the page knew where it was and the
// navigation did not. The tree cannot work the ancestry out for itself, because
// it only loads a Space's children once that Space is already open, which is
// the thing being decided. One cheap read answers it.
//
// It returns ids only (never names, never contents), and it returns them only
// when the viewer may read the object, so it is not an enumeration door: an
// unreadable or absent object answers 404 exactly as its page does.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { folderReadable } from "@/lib/folder";
import { canRead, type ViewerContext } from "@/lib/access";

export const dynamic = "force-dynamic";

const MAX_DEPTH = 8;

/** The folder's own id plus every ancestor, nearest first. */
async function chainUp(folderId: string, organizationId: string): Promise<string[]> {
  const out: string[] = [];
  let current: string | null = folderId;
  for (let hops = 0; current && hops < MAX_DEPTH; hops += 1) {
    const row: { id: string; parentFolderId: string | null } | null = await prisma.folder.findFirst({
      where: { id: current, organizationId },
      select: { id: true, parentFolderId: true },
    });
    if (!row) break;
    out.push(row.id);
    current = row.parentFolderId;
  }
  return out;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const organizationId = u.organizationId;
  const viewer: ViewerContext = { userId: u.id, organizationId, accessLevel };

  const url = new URL(req.url);
  const folderId = url.searchParams.get("folderId");
  const boardSlug = url.searchParams.get("boardSlug");
  const boardId = url.searchParams.get("boardId");

  if (folderId) {
    if (!(await folderReadable(folderId, u.id, accessLevel))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, organizationId },
      select: { id: true, spaceId: true },
    });
    if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      spaceId: folder.spaceId,
      folderIds: await chainUp(folder.id, organizationId),
      boardId: null,
    });
  }

  if (boardSlug || boardId) {
    const board = await prisma.board.findFirst({
      where: boardSlug ? { slug: boardSlug, organizationId } : { id: boardId!, organizationId },
      select: { id: true, spaceId: true, folderId: true },
    });
    if (!board) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(await canRead(viewer, { type: "board", id: board.id }))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      spaceId: board.spaceId,
      folderIds: board.folderId ? await chainUp(board.folderId, organizationId) : [],
      boardId: board.id,
    });
  }

  return NextResponse.json({ error: "folderId, boardSlug or boardId is required" }, { status: 400 });
}
