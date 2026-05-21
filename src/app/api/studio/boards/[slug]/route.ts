// GET    /api/studio/boards/[slug]         — board + items
// PATCH  /api/studio/boards/[slug]         — rename / layout / fields
// DELETE /api/studio/boards/[slug]         — destroy (manager+ only)

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const ADMIN_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userId = (session.user as { id?: string }).id;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const organizationId = (session.user as { organizationId?: string }).organizationId;
  if (!userId || !organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId, accessLevel, organizationId };
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { slug } = await params;

  const board = await prisma.studioBoard.findFirst({
    where: { organizationId: c.organizationId, slug },
    include: {
      items: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });
  return NextResponse.json({ board });
}

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).optional().nullable(),
  layout: z.enum(["TABLE", "KANBAN"]).optional(),
  // Whole-replace of the field list. Callers send the full array.
  fields: z.array(z.object({
    key: z.string(),
    label: z.string(),
    type: z.string(),
    options: z.any().optional(),
  })).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required" }, { status: 403 });
  }
  const { slug } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const board = await prisma.studioBoard.findFirst({
    where: { organizationId: c.organizationId, slug },
    select: { id: true },
  });
  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

  const updated = await prisma.studioBoard.update({
    where: { id: board.id },
    data: parsed.data,
  });
  return NextResponse.json({ board: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required" }, { status: 403 });
  }
  const { slug } = await params;
  const board = await prisma.studioBoard.findFirst({
    where: { organizationId: c.organizationId, slug },
    select: { id: true },
  });
  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });
  await prisma.studioBoard.delete({ where: { id: board.id } });
  return NextResponse.json({ ok: true });
}
