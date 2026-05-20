// POST /api/agents/[slug]/install — install a prebuilt catalog agent
// into the current org. Idempotent: re-install just re-enables.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { AGENTS_BY_SLUG } from "@/lib/agents/catalog";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id?: string }).id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, accessLevel: true },
  });
  if (!user?.organizationId) return NextResponse.json({ error: "no organization" }, { status: 400 });
  if (user.accessLevel !== "SUPER_ADMIN" && user.accessLevel !== "COMPANY_ADMIN") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const catalog = AGENTS_BY_SLUG[slug];
  if (!catalog) return NextResponse.json({ error: "unknown agent" }, { status: 404 });

  const agent = await prisma.agent.upsert({
    where: { organizationId_slug: { organizationId: user.organizationId, slug } },
    create: {
      organizationId: user.organizationId,
      slug,
      name: catalog.name,
      persona: catalog.persona,
      description: catalog.description,
      systemPrompt: catalog.systemPrompt,
      productSlug: catalog.productSlug,
      tools: catalog.tools as object,
      isPrebuilt: true,
      prebuiltSlug: slug,
      status: "ENABLED",
      createdById: user.id,
    },
    update: {
      status: "ENABLED",
      // Refresh from catalog if the team improves the prompt later
      name: catalog.name,
      persona: catalog.persona,
      description: catalog.description,
      systemPrompt: catalog.systemPrompt,
    },
    select: { id: true, slug: true, name: true, status: true },
  });

  return NextResponse.json({ agent });
}
