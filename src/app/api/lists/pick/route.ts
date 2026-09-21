// GET /api/lists/pick?q=&limit=&cursor=
//
// The Lists the viewer holds Can edit on, for the pickers that CREATE a task
// somewhere (the Notetaker's "Create a task for each action item · in {List}"
// footer, spec-docs-knowledge section 2). It answers "where may I write",
// never "what may I read": a picker row that 403s on click is the thing this
// route exists to prevent, so every candidate passes the same write check
// PATCH /api/items/[id] and POST /api/boards/[id]/items apply.
//
// The set is the one GET /api/boards?editable=1 returns (the create-task
// modal's picker), with the Space and Folder names resolved so a row reads
// "Roadmap · Engineering › Q4" and a name search matches any of the three.
// Cursor-paged on id so a large org never truncates.
//
//   { data: [{ id, slug, name, icon, color, spaceId, spaceName, folderName,
//              productSlug }], total, nextCursor }

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canContributeBoard } from "@/lib/board";
import { listSpacesForUser } from "@/lib/space";

const MAX_LIMIT = 100;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = u.id;
  const organizationId = u.organizationId;
  const accessLevel = u.accessLevel ?? "EMPLOYEE";

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || 40));
  const cursor = url.searchParams.get("cursor") ?? null;

  const spaces = await listSpacesForUser(userId, organizationId, { accessLevel });
  const spaceIds = spaces.map((s) => s.id);
  const candidates = await prisma.board.findMany({
    where: {
      organizationId,
      archivedAt: null,
      OR: [
        ...(spaceIds.length ? [{ spaceId: { in: spaceIds } }] : []),
        { spaceId: null, ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
    select: { id: true, slug: true, name: true, icon: true, color: true, spaceId: true, folderId: true, productSlug: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const allowedFlags = await Promise.all(
    candidates.map((b) => canContributeBoard(b.id, userId, accessLevel)),
  );
  const allowed = candidates.filter((_, i) => allowedFlags[i]);

  const folderIds = [...new Set(allowed.map((b) => b.folderId).filter((x): x is string => !!x))];
  const folders = folderIds.length
    ? await prisma.folder.findMany({ where: { id: { in: folderIds } }, select: { id: true, name: true } })
    : [];
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const spaceName = new Map(spaces.map((s) => [s.id, s.name]));

  const rows = allowed
    .map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      icon: b.icon ?? null,
      color: b.color ?? null,
      spaceId: b.spaceId ?? null,
      // A space-less List the viewer owns is their Personal list.
      spaceName: b.spaceId ? (spaceName.get(b.spaceId) ?? null) : "My work",
      folderName: b.folderId ? (folderName.get(b.folderId) ?? null) : null,
      productSlug: b.productSlug ?? null,
    }))
    .filter((r) => {
      if (!q) return true;
      return [r.name, r.spaceName ?? "", r.folderName ?? ""].some((s) => s.toLowerCase().includes(q));
    });

  // The Personal list first, then everything else by name (the query above).
  rows.sort((a, b) => Number(!!b.spaceId === false) - Number(!!a.spaceId === false) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const total = rows.length;
  let start = 0;
  if (cursor) {
    const i = rows.findIndex((r) => r.id === cursor);
    start = i >= 0 ? i + 1 : 0;
  }
  const page = rows.slice(start, start + limit);
  const nextCursor = start + limit < total ? page[page.length - 1]?.id ?? null : null;

  return NextResponse.json({ data: page, total, nextCursor });
}
