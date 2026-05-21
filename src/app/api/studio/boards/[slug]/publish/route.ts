// POST /api/studio/boards/[slug]/publish — publishes the board's
// shape (layout + fields) as a BoardTemplate so other workspaces (and
// other orgs, if `visibility=PUBLIC`) can install it.
//
// Body: { visibility: "ORG" | "PUBLIC", category?: string, description?: string }
// Defaults `visibility` to ORG so accidental publishes don't leak.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";

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

const publishSchema = z.object({
  visibility: z.enum(["ORG", "PUBLIC"]).default("ORG"),
  category: z.string().max(40).optional(),
  description: z.string().max(280).optional(),
  name: z.string().min(1).max(80).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required" }, { status: 403 });
  }
  const { slug } = await params;
  const board = await prisma.studioBoard.findFirst({
    where: { slug, organizationId: c.organizationId },
    select: {
      id: true, name: true, description: true, layout: true, fields: true,
      productSlug: true, color: true,
    },
  });
  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const template = await prisma.boardTemplate.create({
    data: {
      organizationId: c.organizationId,
      sourceBoardId: board.id,
      name: parsed.data.name ?? board.name,
      description: parsed.data.description ?? board.description,
      category: parsed.data.category,
      productSlug: board.productSlug,
      layout: board.layout,
      fields: board.fields as Prisma.InputJsonValue,
      color: board.color,
      visibility: parsed.data.visibility,
      publishedById: c.userId,
    },
    select: { id: true, name: true, visibility: true, installCount: true, createdAt: true },
  });

  return NextResponse.json({ template }, { status: 201 });
}
