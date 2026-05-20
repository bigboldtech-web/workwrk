// GET /api/build/apps — list this org's apps
// POST /api/build/apps — save a generated app (after preview)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true } });
  if (!user?.organizationId) return { error: NextResponse.json({ error: "no organization" }, { status: 400 }) };
  return { userId: user.id, orgId: user.organizationId };
}

export async function GET() {
  const c = await ctx();
  if ("error" in c) return c.error;

  const apps = await prisma.app.findMany({
    where: { organizationId: c.orgId, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      iconKey: true,
      hue: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ apps });
}

const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key"),
  label: z.string().min(1).max(80),
  fieldType: z.enum(["TEXT", "TEXTAREA", "NUMBER", "DATE", "CHECKBOX", "SELECT", "MULTI_SELECT", "URL", "EMAIL"]),
  options: z.unknown().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case"),
  description: z.string().max(400).optional(),
  iconKey: z.string().max(40).optional(),
  hue: z.string().max(20).optional(),
  prompt: z.string().max(2000).optional(),
  fields: z.array(fieldSchema).min(1).max(20),
  sampleRows: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });

  try {
    const app = await prisma.app.create({
      data: {
        organizationId: c.orgId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description,
        iconKey: parsed.data.iconKey,
        hue: parsed.data.hue,
        prompt: parsed.data.prompt,
        schema: { fields: parsed.data.fields } as object,
        // sampleRows seeded into ui.rows so the new app is populated.
        ui: { rows: parsed.data.sampleRows ?? [] } as object,
        status: "PUBLISHED",
        createdById: c.userId,
      },
      select: { id: true, slug: true, name: true, status: true },
    });
    return NextResponse.json({ app });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return NextResponse.json({ error: "slug already exists" }, { status: 409 });
    }
    throw e;
  }
}
