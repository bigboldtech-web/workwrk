// GET  /api/studio/templates                — list templates visible
//                                              to the current org.
// POST /api/studio/templates/install         — install a template as
//                                              a new StudioBoard in
//                                              this org (workspace
//                                              + product optional).

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

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const product = url.searchParams.get("product");
  const search = url.searchParams.get("q")?.toLowerCase().trim();

  // Visible templates: this org's own (any visibility) + every public
  // template from any other org.
  const where: Prisma.BoardTemplateWhereInput = {
    OR: [
      { organizationId: c.organizationId },
      { visibility: "PUBLIC" },
    ],
  };
  if (product) where.productSlug = product;

  const rows = await prisma.boardTemplate.findMany({
    where,
    orderBy: [{ installCount: "desc" }, { updatedAt: "desc" }],
    take: 100,
    select: {
      id: true, name: true, description: true, category: true,
      productSlug: true, layout: true, fields: true, color: true,
      visibility: true, installCount: true, organizationId: true,
      organization: { select: { name: true, slug: true } },
      createdAt: true, updatedAt: true,
    },
  });

  const filtered = search
    ? rows.filter((t) =>
        t.name.toLowerCase().includes(search) ||
        (t.description ?? "").toLowerCase().includes(search) ||
        (t.category ?? "").toLowerCase().includes(search),
      )
    : rows;

  return NextResponse.json({
    templates: filtered.map((t) => ({
      ...t,
      isOwn: t.organizationId === c.organizationId,
    })),
  });
}

const installSchema = z.object({
  templateId: z.string().min(1),
  workspaceId: z.string().optional(),
  productSlug: z.string().max(80).optional(),
  name: z.string().min(1).max(80).optional(),
});

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "board";
}

async function uniqueSlug(organizationId: string, desired: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? desired : `${desired}-${i + 1}`;
    const clash = await prisma.studioBoard.findFirst({
      where: { organizationId, slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${desired}-${Date.now()}`;
}

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = installSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  // Pull the template + verify visibility — if not public, it must
  // belong to the caller's org.
  const tpl = await prisma.boardTemplate.findUnique({
    where: { id: parsed.data.templateId },
    select: {
      id: true, name: true, description: true, layout: true, fields: true,
      productSlug: true, color: true, visibility: true, organizationId: true,
    },
  });
  if (!tpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (tpl.visibility !== "PUBLIC" && tpl.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Template not visible to this org" }, { status: 403 });
  }

  if (parsed.data.workspaceId) {
    const ws = await prisma.workspace.findFirst({
      where: { id: parsed.data.workspaceId, organizationId: c.organizationId },
      select: { id: true },
    });
    if (!ws) return NextResponse.json({ error: "Workspace not found in this org" }, { status: 400 });
  }

  const installedName = parsed.data.name ?? tpl.name;
  const slug = await uniqueSlug(c.organizationId, slugify(installedName));

  const [board] = await prisma.$transaction([
    prisma.studioBoard.create({
      data: {
        organizationId: c.organizationId,
        workspaceId: parsed.data.workspaceId,
        productSlug: parsed.data.productSlug ?? tpl.productSlug,
        name: installedName,
        slug,
        description: tpl.description,
        layout: tpl.layout,
        fields: tpl.fields as Prisma.InputJsonValue,
        color: tpl.color,
        createdById: c.userId,
      },
      select: {
        id: true, name: true, slug: true, description: true, layout: true,
        productSlug: true, workspaceId: true, color: true,
      },
    }),
    prisma.boardTemplate.update({
      where: { id: tpl.id },
      data: { installCount: { increment: 1 } },
    }),
  ]);

  return NextResponse.json({ board }, { status: 201 });
}
