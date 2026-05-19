// GET /api/itsm/kb-articles — list this org's KB articles
// POST /api/itsm/kb-articles — create / publish a new article

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveItsmContext } from "@/lib/itsm/auth";
import { z } from "zod";

export async function GET(req: Request) {
  const ctx = await resolveItsmContext();
  if ("error" in ctx) return ctx.error;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const onlyPublished = searchParams.get("published") === "true";

  const articles = await prisma.kbArticle.findMany({
    where: {
      organizationId: ctx.orgId,
      archivedAt: null,
      ...(category ? { category } : {}),
      ...(onlyPublished ? { publishedAt: { not: null } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ articles });
}

const createSchema = z.object({
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  excerpt: z.string().max(400).optional(),
  category: z.string().max(80).optional(),
  tags: z.array(z.string()).optional(),
  publish: z.boolean().optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveItsmContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const article = await prisma.kbArticle.create({
      data: {
        organizationId: ctx.orgId,
        slug: parsed.data.slug,
        title: parsed.data.title,
        body: parsed.data.body,
        excerpt: parsed.data.excerpt,
        category: parsed.data.category,
        tags: (parsed.data.tags ?? []) as object,
        authorId: ctx.userId,
        publishedAt: parsed.data.publish ? new Date() : null,
      },
    });
    return NextResponse.json({ article });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return NextResponse.json({ error: "slug already exists" }, { status: 409 });
    }
    throw e;
  }
}
