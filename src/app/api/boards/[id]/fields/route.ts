// GET  /api/boards/[id]/fields — list fields on a Board
// POST /api/boards/[id]/fields — append a new field { label, type, options? }

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { addBoardField, getBoardFields } from "@/lib/board-fields";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { prisma } from "@/lib/prisma";

const FIELD_TYPES = [
  "TEXT", "LONG_TEXT", "NUMBER", "DATE", "DATETIME",
  "DROPDOWN", "MULTI_SELECT", "CHECKBOX", "LABELS", "TSHIRT_SIZE",
  "URL", "EMAIL", "PHONE", "MONEY", "PERCENT", "RATING",
  "PROGRESS_AUTO", "PROGRESS_MANUAL", "USER", "PEOPLE", "FILES",
  "RELATIONSHIP", "ROLLUP", "FORMULA", "LOCATION", "BUTTON",
  "SIGNATURE", "VOTING", "ACTION_ITEMS", "SUMMARY", "SENTIMENT",
  "CATEGORIZE", "TRANSLATION", "CUSTOM_TEXT", "CUSTOM_DROPDOWN",
  "KRA",
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

async function loadBoard(boardId: string, c: { userId: string; accessLevel: string; organizationId: string }) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { spaceId: true, organizationId: true },
  });
  if (!board || board.organizationId !== c.organizationId || !board.spaceId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const space = await getSpaceForReader(board.spaceId, c.userId, c.accessLevel);
  if (!space) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { spaceId: board.spaceId };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadBoard(id, c);
  if ("error" in gate) return gate.error;
  const fields = await getBoardFields(id);
  return NextResponse.json({ fields });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  options: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await loadBoard(id, c);
  if ("error" in gate) return gate.error;
  const canEdit = await canEditSpace(gate.spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const field = await addBoardField({
      boardId: id,
      label: parsed.data.label,
      type: parsed.data.type,
      options: parsed.data.options as never,
    });
    return NextResponse.json({ field }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add field" },
      { status: 400 },
    );
  }
}
