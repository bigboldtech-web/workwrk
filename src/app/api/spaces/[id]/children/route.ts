// GET /api/spaces/[id]/children — folders + boards + tables + docs +
// whiteboards directly under this Space, for the HomeSidebar's
// expandable tree. Gated by getSpaceForReader so users can't enumerate
// children of Spaces they can't see.
//
// Returns:
//   { folders: [...], boards: [...], tables: [...], docs: [...], whiteboards: [...] }
//
// Folders only includes top-level (parentFolderId = null). Sub-folder
// tree expansion fetches /api/folders/[id]/children when we add it.
// Boards only includes those NOT inside a folder (folderId = null) +
// those inside any folder are returned via the folder's payload below.
// Tables/Docs/Whiteboards = Space-scoped only; org-wide rows live in
// /library and never appear in any Space tree.
// Docs scope: Doc.entityType="SPACE" + entityId=spaceId.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSpaceForReader } from "@/lib/space";

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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;

  const space = await getSpaceForReader(id, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Single query each — all indexed on spaceId. allSettled keeps the
  // sidebar usable if one query fails (e.g. stale Prisma client).
  const [foldersR, rootBoardsR, tablesR, docsR, whiteboardsR] = await Promise.allSettled([
    prisma.folder.findMany({
      where: { spaceId: id, archivedAt: null, parentFolderId: null },
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
        position: true,
        _count: { select: { boards: true, childFolders: true } },
        boards: {
          where: { archivedAt: null },
          orderBy: { name: "asc" },
          select: {
            id: true, slug: true, name: true, icon: true, color: true,
            visibility: true,
          },
        },
      },
    }),
    prisma.board.findMany({
      where: { spaceId: id, folderId: null, archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true, slug: true, name: true, icon: true, color: true,
        visibility: true,
      },
    }),
    prisma.dataTable.findMany({
      where: { spaceId: id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true },
    }),
    prisma.doc.findMany({
      where: {
        organizationId: c.organizationId,
        entityType: "SPACE",
        entityId: id,
        archivedAt: null,
      },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    prisma.whiteboard.findMany({
      where: { organizationId: c.organizationId, spaceId: id, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (foldersR.status === "rejected") {
    console.error("[spaces/children] folders query failed:", foldersR.reason);
  }
  if (rootBoardsR.status === "rejected") {
    console.error("[spaces/children] boards query failed:", rootBoardsR.reason);
  }
  if (tablesR.status === "rejected") {
    console.error("[spaces/children] tables query failed:", tablesR.reason);
  }
  if (docsR.status === "rejected") {
    console.error("[spaces/children] docs query failed:", docsR.reason);
  }
  if (whiteboardsR.status === "rejected") {
    console.error("[spaces/children] whiteboards query failed:", whiteboardsR.reason);
  }

  const folders = foldersR.status === "fulfilled" ? foldersR.value : [];
  const folderIds = folders.map((f) => f.id);

  // Folder-anchored docs — Doc.entityType="FOLDER" + entityId IN folderIds.
  // Single batched query; grouped in app code.
  let folderDocs: { id: string; title: string; entityId: string | null }[] = [];
  if (folderIds.length > 0) {
    try {
      folderDocs = await prisma.doc.findMany({
        where: {
          organizationId: c.organizationId,
          entityType: "FOLDER",
          entityId: { in: folderIds },
          archivedAt: null,
        },
        orderBy: { title: "asc" },
        select: { id: true, title: true, entityId: true },
      });
    } catch (err) {
      console.error("[spaces/children] folder docs query failed:", err);
    }
  }
  const docsByFolder = new Map<string, { id: string; title: string }[]>();
  for (const d of folderDocs) {
    if (!d.entityId) continue;
    const arr = docsByFolder.get(d.entityId) ?? [];
    arr.push({ id: d.id, title: d.title });
    docsByFolder.set(d.entityId, arr);
  }
  const foldersWithDocs = folders.map((f) => ({
    ...f,
    docs: docsByFolder.get(f.id) ?? [],
  }));

  return NextResponse.json({
    folders: foldersWithDocs,
    boards: rootBoardsR.status === "fulfilled" ? rootBoardsR.value : [],
    tables: tablesR.status === "fulfilled" ? tablesR.value : [],
    docs: docsR.status === "fulfilled" ? docsR.value : [],
    whiteboards: whiteboardsR.status === "fulfilled" ? whiteboardsR.value : [],
  });
}
