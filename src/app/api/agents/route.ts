// GET  /api/agents — list this org's installed (and enabled) agents +
// indicate which catalog slugs are NOT yet installed (for the "Install"
// CTA in the /agents page).
// POST /api/agents — create a custom agent for this org (manager+).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { AGENT_CATALOG } from "@/lib/agents/catalog";
import { z } from "zod";

const ADMIN_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);

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

const createSchema = z.object({
  name: z.string().min(1).max(80),
  persona: z.string().max(120).optional(),
  description: z.string().min(1).max(500),
  systemPrompt: z.string().min(1).max(8000),
  productSlug: z.string().max(80).optional(),
});

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "agent";
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id?: string }).id;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ADMIN_LEVELS.has(accessLevel)) {
    return NextResponse.json({ error: "Manager-level access required to create agents." }, { status: 403 });
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  if (!user?.organizationId) return NextResponse.json({ error: "no organization" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  // Generate a unique slug within the org; bump with -2/-3/... on clash.
  const baseSlug = slugify(parsed.data.name);
  let slug = baseSlug;
  for (let i = 2; i < 50; i++) {
    const clash = await prisma.agent.findFirst({
      where: { organizationId: user.organizationId, slug },
      select: { id: true },
    });
    if (!clash) break;
    slug = `${baseSlug}-${i}`;
  }

  const agent = await prisma.agent.create({
    data: {
      organizationId: user.organizationId,
      slug,
      name: parsed.data.name,
      persona: parsed.data.persona,
      description: parsed.data.description,
      systemPrompt: parsed.data.systemPrompt,
      productSlug: parsed.data.productSlug,
      isPrebuilt: false,
      createdById: userId,
    },
    select: {
      id: true, slug: true, name: true, persona: true, description: true,
      productSlug: true, status: true, createdAt: true,
    },
  });

  return NextResponse.json({ agent }, { status: 201 });
}
