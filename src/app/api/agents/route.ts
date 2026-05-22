// GET /api/agents — list this org's installed (and enabled) agents +
// indicate which catalog slugs are NOT yet installed (for the "Install"
// CTA in the /agents page).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { AGENT_CATALOG } from "@/lib/agents/catalog";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id?: string }).id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  if (!user?.organizationId) return NextResponse.json({ error: "no organization" }, { status: 400 });

  const installed = await prisma.agent.findMany({
    where: { organizationId: user.organizationId, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      slug: true,
      name: true,
      persona: true,
      description: true,
      productSlug: true,
      isPrebuilt: true,
      status: true,
      autonomousEnabled: true,
      scheduleCron: true,
      autonomousPrompt: true,
      lastRunAt: true,
      nextRunAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const installedSlugs = new Set(installed.map((a) => a.slug));
  const available = AGENT_CATALOG.filter((a) => !installedSlugs.has(a.slug)).map((a) => ({
    slug: a.slug,
    name: a.name,
    persona: a.persona,
    description: a.description,
    productSlug: a.productSlug,
    hue: a.hue,
    examplePrompts: a.examplePrompts,
  }));

  // Hydrate installed agents with catalog hue + examplePrompts so the UI
  // has the full picture without a second roundtrip.
  const hydrated = installed.map((a) => {
    const catalog = AGENT_CATALOG.find((c) => c.slug === a.slug);
    return {
      ...a,
      hue: catalog?.hue ?? "violet",
      examplePrompts: catalog?.examplePrompts ?? [],
      isFlagship: catalog?.isFlagship ?? false,
    };
  });

  return NextResponse.json({ installed: hydrated, available });
}
