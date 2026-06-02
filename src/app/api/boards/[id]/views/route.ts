// GET  /api/boards/[id]/views — list views on a Board
// POST /api/boards/[id]/views — add a new View { name, type, config?, isPrivate? }

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { canReadBoard } from "@/lib/board";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { prisma } from "@/lib/prisma";

const VIEW_TYPES = [
  "TABLE", "KANBAN", "GANTT", "CALENDAR", "TIMELINE", "CHART", "DOC", "FORM",
  "DASHBOARD", "MAP", "WORKLOAD", "WHITEBOARD", "FILE_GALLERY",
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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const canRead = await canReadBoard(id, c.userId, c.accessLevel);
  if (!canRead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const views = await prisma.view.findMany({
    where: { boardId: id },
    orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ views });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(VIEW_TYPES),
  config: z.record(z.string(), z.unknown()).optional(),
  isShared: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const board = await prisma.board.findUnique({
    where: { id },
    select: { spaceId: true, organizationId: true },
  });
  if (!board || board.organizationId !== c.organizationId || !board.spaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const space = await getSpaceForReader(board.spaceId, c.userId, c.accessLevel);
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const canEdit = await canEditSpace(board.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const last = await prisma.view.findFirst({
    where: { boardId: id },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  const view = await prisma.view.create({
    data: {
      boardId: id,
      name: parsed.data.name,
      type: parsed.data.type,
      config: (parsed.data.config ?? {}) as object,
      isShared: parsed.data.isShared ?? true,
      ownerId: c.userId,
      displayOrder: (last?.displayOrder ?? -1) + 1,
    },
  });
  return NextResponse.json({ view }, { status: 201 });
}
