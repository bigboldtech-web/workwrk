// GET /api/spaces/[id]/children — folders + boards + tables directly
// under this Space, for the HomeSidebar's expandable tree. Gated by
// getSpaceForReader so users can't enumerate children of Spaces
// they can't see.
//
// Returns:
//   { folders: [...] , boards: [...], tables: [...] }
//
// Folders only includes top-level (parentFolderId = null). Sub-folder
// tree expansion fetches /api/folders/[id]/children when we add it.
// Boards only includes those NOT inside a folder (folderId = null) +
// those inside any folder are returned via the folder's payload below.
// Tables are Space-scoped DataTable rows — org-wide tables (spaceId
// null) live in /library and never appear in any Space tree.

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

  // Single query each — all three indexed on spaceId. Wrapped in
  // allSettled so a failure on one side (e.g. a stale Prisma client
  // before regenerate, or a DataTable.spaceId column not yet migrated)
  // doesn't take down the whole tree. The sidebar UX is much more
  // forgiving when "tables missing" is silent than when the whole
  // expansion renders "Couldn't load".
  const [foldersR, rootBoardsR, tablesR] = await Promise.allSettled([
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

  return NextResponse.json({
    folders: foldersR.status === "fulfilled" ? foldersR.value : [],
    boards: rootBoardsR.status === "fulfilled" ? rootBoardsR.value : [],
    tables: tablesR.status === "fulfilled" ? tablesR.value : [],
  });
}
