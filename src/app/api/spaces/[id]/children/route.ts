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
import { folderAccessForSpace, folderVisibleTo } from "@/lib/folder";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import { viewerFromSession } from "@/lib/access/viewer";
import { canManageObject } from "@/lib/object-manage";
import { readableListsInSpace } from "@/lib/space";
import {
  spaceContainerRole, listContainerRole, type ContainerRole,
} from "@/lib/work/container-menu";

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
  visibility: true, ownerId: true,
  // Board.settings carries sprint identity (settings.sprint) so the sidebar
  // tree can render sprint Lists with their own glyph.
  settings: true,
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

  // Org guard first, then decide HOW MUCH of the space this viewer sees.
  const space = await prisma.space.findUnique({ where: { id }, select: { organizationId: true } });
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const access = await folderAccessForSpace(id, c.userId, c.accessLevel);
  if (access.mode === "none") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // THE ROLE EVERY TREE ROW'S "…" NEEDS. `ContainerMenu` hides the rows a
  // viewer cannot use, and the sidebar had no way to tell it who was looking:
  // a Can view member was offered Rename, Move, Duplicate, Archive and Delete
  // on every row, and each one answered 403. One membership read here answers
  // it for the whole subtree, which is what the sidebar can afford (an async
  // access call per row is dozens of round trips per expand).
  const isOrgAdmin = legacyIsAdminLevel(c.accessLevel);
  const ownMembership = isOrgAdmin
    ? null
    : await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: id, userId: c.userId } },
        select: { role: true },
      });
  const spaceRole: ContainerRole = spaceContainerRole({
    isOrgAdmin,
    memberRole: ownMembership?.role ?? null,
  });
  // Deliberately conservative for a PRIVATE List: without the viewer's own
  // BoardMember row (which this listing does not read, one query per row) an
  // ADMIN grant on a private List resolves to "view" here. An absent row costs
  // a trip to the List's own page; a present one costs a 403.
  const roleForBoard = (b: { visibility: string | null; ownerId: string | null }): ContainerRole =>
    listContainerRole({
      isOrgAdmin,
      spaceRole,
      visibility: b.visibility,
      isOwner: b.ownerId === c.userId,
    });
  // A folder-only grantee sees the Space as a bare container: ONLY their
  // granted folders (rooted here regardless of real nesting) and their
  // subtree — nothing else at the space root.
  const scoped = access.mode === "scoped";

  // The nested folder shape (2 levels of childFolders) is shared by both modes;
  // only the top-level WHERE differs: full = the space's root folders; scoped =
  // exactly the granted folder ids, lifted to the top of the viewer's tree.
  const NESTED_FOLDER_SELECT = {
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
  } as const;

  // WHICH LISTS THIS VIEWER MAY SEE, by the one predicate the Space page and
  // Bird's eye use (readableListsInSpace). The folder and board reads below
  // bring every live List; without this filter the tree named PRIVATE Lists
  // the viewer cannot open (Bird's eye hid them, the sidebar did not). It is
  // also what lets a PRIVATE List shared through BoardMember or a Folder
  // grant show here for its grantee. A failed read shows no Lists rather
  // than every List: the tree fails closed.
  // Started now, awaited after the tree reads, so it runs beside them.
  const readablePromise = readableListsInSpace(id, {
    userId: c.userId,
    organizationId: c.organizationId,
    accessLevel: c.accessLevel,
  }).then(
    (r) => new Set(r.lists.map((l) => l.id)),
    (err) => {
      console.error("[spaces/children] readable Lists query failed:", err);
      return new Set<string>();
    },
  );
  const [foldersR, rootBoardsR, tablesR, docsR, whiteboardsR] = await Promise.allSettled([
    prisma.folder.findMany({
      where: scoped
        ? { spaceId: id, archivedAt: null, id: { in: [...access.folderIds] } }
        : { spaceId: id, archivedAt: null, parentFolderId: null },
      orderBy: { position: "asc" },
      select: NESTED_FOLDER_SELECT,
    }),
    // Root-level space content is space-wide, so a folder-only grantee gets none.
    scoped
      ? Promise.resolve([] as never[])
      : prisma.board.findMany({
          where: { spaceId: id, folderId: null, archivedAt: null },
          orderBy: { name: "asc" },
          select: BOARD_SELECT,
        }),
    scoped
      ? Promise.resolve([] as never[])
      : prisma.dataTable.findMany({
          where: { spaceId: id },
          orderBy: { name: "asc" },
          select: { id: true, name: true, description: true, createdById: true },
        }),
    scoped
      ? Promise.resolve([] as never[])
      : prisma.doc.findMany({
          where: {
            organizationId: c.organizationId,
            entityType: "SPACE",
            entityId: id,
            archivedAt: null,
          },
          orderBy: { title: "asc" },
          select: { id: true, title: true },
        }),
    scoped
      ? Promise.resolve([] as never[])
      : prisma.whiteboard.findMany({
          where: { organizationId: c.organizationId, spaceId: id, archivedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
  ]);

  const readableIds = await readablePromise;
  const readable = (b: { id: string }) => readableIds.has(b.id);

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
    boards: Array<{ id: string; slug: string; name: string; icon: string | null; color: string | null; visibility: "PRIVATE" | "WORKSPACE" | "ORG"; ownerId: string | null; settings: unknown }>;
    childFolders?: FolderShape[];
  };

  // Drop PRIVATE folders (and their whole subtree) the viewer can't see. A
  // private folder hides its boards too, since they live under it in the tree.
  function prune(nodes: FolderShape[]): FolderShape[] {
    return nodes
      .filter((n) => folderVisibleTo(n, c.userId, c.accessLevel))
      .map((n) => ({ ...n, childFolders: n.childFolders ? prune(n.childFolders) : [] }));
  }
  // Scoped viewers see exactly their granted folders (and everything beneath,
  // which they inherit) — never pruned by the coarse PRIVATE rule. Full viewers
  // drop PRIVATE folders they don't own.
  const folders = scoped
    ? (rawFolders as FolderShape[])
    : prune(rawFolders as FolderShape[]);

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
      // A Folder's management gate IS its Space's (canEditSpace), so it carries
      // the Space role unchanged.
      role: spaceRole,
      docs: docsByFolder.get(n.id) ?? [],
      // Only the Lists this viewer can read, and only those counted, so an
      // unreadable List is never named and never counted.
      _count: { ...n._count, boards: n.boards.filter(readable).length },
      boards: n.boards.filter(readable).map((b) => ({ ...b, role: roleForBoard(b) })),
      childFolders: n.childFolders ? annotate(n.childFolders) : [],
    }));
  }

  const manageViewer = await viewerFromSession().catch(() => null);
  return NextResponse.json({
    spaceRole,
    folders: annotate(folders as FolderShape[]),
    boards: (rootBoardsR.status === "fulfilled" ? rootBoardsR.value : []).filter(readable).map((b) => ({
      ...b,
      role: roleForBoard(b),
    })),
    // canManage: may this viewer delete the table (its creator, or an Owner
    // or Admin: lib/object-manage, the same rule DELETE /api/tables/[id]
    // enforces), so the tree's row menu never offers a Delete that fails.
    tables: (tablesR.status === "fulfilled" ? tablesR.value : []).map(({ createdById, ...t }) => ({
      ...t,
      canManage: canManageObject(manageViewer, createdById),
    })),
    docs: docsR.status === "fulfilled" ? docsR.value : [],
    whiteboards: whiteboardsR.status === "fulfilled" ? whiteboardsR.value : [],
  });
}
