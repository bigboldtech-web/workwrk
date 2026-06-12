// GET  /api/boards?spaceId=... | /api/boards?folderId=...  — list
// POST /api/boards — create a Board with a default View

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { createBoard, listBoardsInFolder, listBoardsInSpace } from "@/lib/board";
import { canEditSpace, getSpaceForReader, listSpacesForUser } from "@/lib/space";
import { prisma } from "@/lib/prisma";

const VIEW_TYPES = [
  "TABLE", "KANBAN", "GANTT", "CALENDAR", "TIMELINE", "CHART", "DOC", "FORM",
  "DASHBOARD", "MAP", "WORKLOAD", "WHITEBOARD", "FILE_GALLERY",
  "CARDS", "PIVOT", "HIERARCHY", "ACTIVITY",
] as const;

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

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const spaceId = url.searchParams.get("spaceId");
  const folderId = url.searchParams.get("folderId");
  const includeArchived = url.searchParams.get("includeArchived") === "1";

  // Flat org-wide listing across every Space the viewer can read. Used
  // by cross-entity pickers (e.g. linking Boards to an OKR) where the
  // caller has no single Space context. Backwards-compatible: only
  // triggers on ?all=1.
  if (url.searchParams.get("all") === "1") {
    const spaces = await listSpacesForUser(c.userId, c.organizationId, { accessLevel: c.accessLevel });
    const spaceIds = spaces.map((s) => s.id);
    const boards = spaceIds.length
      ? await prisma.board.findMany({
          where: {
            organizationId: c.organizationId,
            spaceId: { in: spaceIds },
            ...(includeArchived ? {} : { archivedAt: null }),
          },
          select: { id: true, slug: true, name: true, icon: true, color: true, spaceId: true },
          orderBy: { name: "asc" },
        })
      : [];
    return NextResponse.json({ boards });
  }

  if (folderId) {
    const boards = await listBoardsInFolder(folderId, { includeArchived });
    return NextResponse.json({ boards });
  }
  if (spaceId) {
    const space = await getSpaceForReader(spaceId, c.userId, c.accessLevel);
    if (!space || space.organizationId !== c.organizationId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const boards = await listBoardsInSpace(spaceId, { includeArchived });
    return NextResponse.json({ boards });
  }
  return NextResponse.json({ error: "spaceId or folderId required" }, { status: 400 });
}

const createSchema = z.object({
  spaceId: z.string().min(1),
  folderId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(20).optional(),
  itemType: z.string().max(40).optional(),
  defaultViewType: z.enum(VIEW_TYPES).optional(),
  visibility: z.enum(["PRIVATE", "WORKSPACE", "ORG"]).optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const space = await getSpaceForReader(parsed.data.spaceId, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const canEdit = await canEditSpace(parsed.data.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const board = await createBoard({
      organizationId: c.organizationId,
      userId: c.userId,
      spaceId: parsed.data.spaceId,
      folderId: parsed.data.folderId ?? null,
      name: parsed.data.name,
      description: parsed.data.description,
      icon: parsed.data.icon,
      color: parsed.data.color,
      itemType: parsed.data.itemType,
      defaultViewType: parsed.data.defaultViewType,
      visibility: parsed.data.visibility,
    });
    return NextResponse.json({ board }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create board" },
      { status: 400 },
    );
  }
}
