// POST /api/agents/[slug]/install, install a prebuilt catalog agent
// into the current org. Idempotent: re-install just re-enables. A removed
// agent that is not in the catalog (a custom one) is added back as it was:
// its own prompt and settings, turned back on.
//
// Workspace agents only (docs/plans/ai-teammates.md 3.15): a PRIVATE AI
// teammate answers exactly as an unknown agent, so an Admin who learns its
// slug can neither add it back nor overwrite it with a catalog prompt. Only
// its owner adds it back (PATCH /api/agents/teammates/[slug] restore). A
// workspace teammate added back here counts toward the plan's teammate
// limit again, as adding it back there does.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManageApps } from "@/lib/app-gate";
import { AGENTS_BY_SLUG } from "@/lib/agents/catalog";
import { auditAgent } from "@/lib/agents/audit";
import { overLimit, teammateLimits } from "@/lib/agents/teammate-server";
import { LEGACY_AGENT } from "@/lib/agents/legacy-agents";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Owner and Admin: an agent is an org-level install (access section 9,
  // the Apps settings gate). Same audience as the admin check it replaces.
  const gate = await requireManageApps();
  if ("error" in gate) return gate.error;
  const user = { id: gate.viewer.userId, organizationId: gate.viewer.organizationId };

  const unknown = () => NextResponse.json({ error: "unknown agent" }, { status: 404 });
  const catalog = AGENTS_BY_SLUG[slug];
  if (!catalog) {
    const removed = await prisma.agent.findFirst({
      where: { organizationId: user.organizationId, slug, visibility: "WORKSPACE", status: "ARCHIVED", ...LEGACY_AGENT },
      select: { id: true, toolNames: true },
    });
    if (!removed) return unknown();
    // One made as a teammate (toolNames set) counts toward the plan's
    // limit; an agent the workspace had before teammates never does.
    if (removed.toolNames !== null) {
      const over = overLimit(await teammateLimits(user.organizationId, user.id), "WORKSPACE");
      if (over) return over;
    }
    const agent = await prisma.agent.update({
      where: { id: removed.id },
      data: { status: "ENABLED" },
      select: { id: true, slug: true, name: true, status: true },
    });
    await auditAgent({ organizationId: user.organizationId, actorId: user.id, agent, action: "added" });
    return NextResponse.json({ agent });
  }

  // The upsert below matches by slug alone, so a private teammate holding
  // this catalog slug would get the catalog's prompt written over its own.
  // New private teammates never take one (teammate-access.ts teammateSlug);
  // a row that does anyway is not the workspace's to add.
  const holder = await prisma.agent.findFirst({
    where: { organizationId: user.organizationId, slug },
    select: { visibility: true, toolNames: true },
  });
  if (holder && holder.visibility !== "WORKSPACE") return unknown();
  // Nor is a catalog agent whose tools were chosen in AI teammates: it is a
  // teammate now, and adding the catalog agent would write the catalog's
  // name and prompt over its own instructions (review round 2).
  if (holder && holder.toolNames !== null) return unknown();

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
