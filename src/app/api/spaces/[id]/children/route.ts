// GET /api/spaces/[id]/children — folders (with up to 2 sub-levels)
// + boards + tables + docs + whiteboards directly under this Space, for
// the HomeSidebar's expandable tree. Gated by getSpaceForReader so
// users can't enumerate children of Spaces they can't see.
//
// Returns:
//   {
//     folders: FolderNode[]   // parentFolderId = null
//     boards:  []             // folderId = null
//     tables:  []
//     docs:    []             // entityType="SPACE"
//     whiteboards: []
//   }
//
// FolderNode = { id, name, ..., boards, docs, childFolders } recursive.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSpaceForReader } from "@/lib/space";
import { folderVisibleTo } from "@/lib/folder";

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

const BOARD_SELECT = {
  id: true, slug: true, name: true, icon: true, color: true,
  visibility: true,
} as const;

const FOLDER_INNER_SELECT = {
  id: true, name: true, icon: true, color: true, position: true,
  visibility: true, ownerId: true,
  _count: { select: { boards: true, childFolders: true } },
  boards: {
    where: { archivedAt: null },
    orderBy: { name: "asc" as const },
    select: BOARD_SELECT,
  },
} as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;

  const space = await getSpaceForReader(id, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Top-level folders with 2 nested levels of childFolders.
  const [foldersR, rootBoardsR, tablesR, docsR, whiteboardsR] = await Promise.allSettled([
    prisma.folder.findMany({
      where: { spaceId: id, archivedAt: null, parentFolderId: null },
      orderBy: { position: "asc" },
      select: {
        ...FOLDER_INNER_SELECT,
        childFolders: {
          where: { archivedAt: null },
          orderBy: { position: "asc" as const },
          select: {
            ...FOLDER_INNER_SELECT,
            childFolders: {
              where: { archivedAt: null },
              orderBy: { position: "asc" as const },
              select: FOLDER_INNER_SELECT,
            },
          },
        },
      },
    }),
    prisma.board.findMany({
      where: { spaceId: id, folderId: null, archivedAt: null },
      orderBy: { name: "asc" },
      select: BOARD_SELECT,
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

  const rawFolders = foldersR.status === "fulfilled" ? foldersR.value : [];

  // Walk the tree to collect every folder ID for the docs batch query.
  type FolderShape = {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    position: number;
    visibility: "PRIVATE" | "WORKSPACE" | "ORG";
    ownerId: string | null;
    _count: { boards: number; childFolders: number };
    boards: Array<{ id: string; slug: string; name: string; icon: string | null; color: string | null; visibility: "PRIVATE" | "WORKSPACE" | "ORG" }>;
    childFolders?: FolderShape[];
  };

  // Drop PRIVATE folders (and their whole subtree) the viewer can't see. A
  // private folder hides its boards too — they live under it in the tree.
  function prune(nodes: FolderShape[]): FolderShape[] {
    return nodes
      .filter((n) => folderVisibleTo(n, c.userId, c.accessLevel))
      .map((n) => ({ ...n, childFolders: n.childFolders ? prune(n.childFolders) : [] }));
  }
  const folders = prune(rawFolders as FolderShape[]);

  function collectIds(nodes: FolderShape[], acc: string[]) {
    for (const n of nodes) {
      acc.push(n.id);
      if (n.childFolders?.length) collectIds(n.childFolders, acc);
    }
  }
  const allFolderIds: string[] = [];
  collectIds(folders, allFolderIds);

  let folderDocs: { id: string; title: string; entityId: string | null }[] = [];
  if (allFolderIds.length > 0) {
    try {
      folderDocs = await prisma.doc.findMany({
        where: {
          organizationId: c.organizationId,
          entityType: "FOLDER",
          entityId: { in: allFolderIds },
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

  // Distribute docs to their folders + flatten childFolders -> childFolders shape.
  function annotate(nodes: FolderShape[]): unknown[] {
    return nodes.map((n) => ({
      ...n,
      docs: docsByFolder.get(n.id) ?? [],
      childFolders: n.childFolders ? annotate(n.childFolders) : [],
    }));
  }

  return NextResponse.json({
    folders: annotate(folders as FolderShape[]),
    boards: rootBoardsR.status === "fulfilled" ? rootBoardsR.value : [],
    tables: tablesR.status === "fulfilled" ? tablesR.value : [],
    docs: docsR.status === "fulfilled" ? docsR.value : [],
    whiteboards: whiteboardsR.status === "fulfilled" ? whiteboardsR.value : [],
  });
}
