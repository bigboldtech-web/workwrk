// POST /api/agents/[slug]/install, install a prebuilt catalog agent
// into the current org. Idempotent: re-install just re-enables.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManageApps } from "@/lib/app-gate";
import { AGENTS_BY_SLUG } from "@/lib/agents/catalog";
import { auditAgent } from "@/lib/agents/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Owner and Admin: an agent is an org-level install (access section 9,
  // the Apps settings gate). Same audience as the admin check it replaces.
  const gate = await requireManageApps();
  if ("error" in gate) return gate.error;
  const user = { id: gate.viewer.userId, organizationId: gate.viewer.organizationId };

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
  await auditAgent({ organizationId: user.organizationId, actorId: user.id, agent, action: "added" });

  return NextResponse.json({ agent });
}
