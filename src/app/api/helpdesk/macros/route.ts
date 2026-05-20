// GET /api/helpdesk/macros — list canned responses
// POST /api/helpdesk/macros — create

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const macros = await prisma.supportMacro.findMany({
    where: { organizationId: ctx.orgId, archivedAt: null },
    orderBy: { usageCount: "desc" },
    take: 200,
  });
  return NextResponse.json({ macros });
}

const createSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case slug"),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(20000),
  category: z.string().max(40).optional(),
  resolves: z.boolean().optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    const macro = await prisma.supportMacro.create({
      data: {
        organizationId: ctx.orgId,
        slug: parsed.data.slug,
        title: parsed.data.title,
        body: parsed.data.body,
        category: parsed.data.category,
        resolves: parsed.data.resolves ?? false,
      },
    });
    return NextResponse.json({ macro });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return NextResponse.json({ error: "slug already exists" }, { status: 409 });
    }
    throw e;
  }
}
