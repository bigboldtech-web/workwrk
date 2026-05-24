// GET  /api/studio/boards?workspace=<id>  — list studio boards
// POST /api/studio/boards                 — create one
//
// Studio boards are user-built tables/kanbans inside a workspace. The
// `fields` array follows the BoardView field-type vocabulary so the
// canonical <BoardView> renderer can drive them with no extra glue.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const ADMIN_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);

const FIELD_TYPES = [
  "TEXT", "TEXTAREA", "NUMBER", "DATE", "CHECKBOX",
  "SELECT", "MULTI_SELECT", "URL", "EMAIL",
  "USER", "RELATION",
  // Power columns. PRIORITY/STATUS share the SELECT shape; the
  // renderer picks them up by fieldType for color + chip treatment.
  "PRIORITY", "STATUS",
  "TIMELINE", "RATING", "PROGRESS",
  "FILES", "PHONE", "LOCATION", "COUNTRY",
  "TAGS", "DURATION", "FORMULA", "CONNECT_BOARDS",
] as const;

const fieldSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z][a-zA-Z0-9_]*$/, "key must start with a letter and use only alphanumerics + underscore"),
  label: z.string().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  options: z.object({
    choices: z.array(z.object({
      value: z.string().min(1).max(40),
      label: z.string().max(80).optional(),
      color: z.string().max(20).optional(),
    })).optional(),
  }).optional(),
});

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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "board";
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

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspace");
  const productSlug = url.searchParams.get("product");

  const where: Record<string, unknown> = { organizationId: c.organizationId };
  if (workspaceId) where.workspaceId = workspaceId;
  if (productSlug) where.productSlug = productSlug;

  const boards = await prisma.studioBoard.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true, name: true, slug: true, description: true, layout: true,
      productSlug: true, workspaceId: true, color: true, updatedAt: true,
      _count: { select: { items: true } },
    },
  });
  return NextResponse.json({ boards });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  workspaceId: z.string().optional(),
  productSlug: z.string().max(80).optional(),
  layout: z.enum(["TABLE", "KANBAN"]).default("TABLE"),
  fields: z.array(fieldSchema).max(40),
  color: z.string().max(20).optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  if (!ADMIN_LEVELS.has(c.accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required to create boards." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  // Workspace cross-tenant check.
  if (parsed.data.workspaceId) {
    const ws = await prisma.workspace.findFirst({
      where: { id: parsed.data.workspaceId, organizationId: c.organizationId },
      select: { id: true },
    });
    if (!ws) return NextResponse.json({ error: "Workspace not found in this org" }, { status: 400 });
  }

  // Field-key uniqueness inside the board.
  const seen = new Set<string>();
  for (const f of parsed.data.fields) {
    if (seen.has(f.key)) {
      return NextResponse.json({ error: `Duplicate field key: ${f.key}` }, { status: 400 });
    }
    seen.add(f.key);
  }

  const slug = await uniqueSlug(c.organizationId, slugify(parsed.data.name));

  const created = await prisma.studioBoard.create({
    data: {
      organizationId: c.organizationId,
      workspaceId: parsed.data.workspaceId,
      productSlug: parsed.data.productSlug,
      name: parsed.data.name,
      slug,
      description: parsed.data.description,
      layout: parsed.data.layout,
      fields: parsed.data.fields,
      color: parsed.data.color,
      createdById: c.userId,
    },
    select: {
      id: true, name: true, slug: true, description: true, layout: true,
      productSlug: true, workspaceId: true, color: true, updatedAt: true,
    },
  });

  return NextResponse.json({ board: created }, { status: 201 });
}
