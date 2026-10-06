// GET  /api/agents: this org's agents (every one not archived) plus the
// catalog agents that can still be added, plus `removed`: the agents that
// were removed (ARCHIVED), so their kept run history still opens under their
// name and an Owner or Admin can add one back, a custom agent or one whose
// product is no longer offered included. Every Member reads (app key ai).
// POST /api/agents: create a custom agent (Owner and Admin, the Apps
// settings gate, access section 9; spec-ai-automation 1.4).
//
// `available` lists only agents whose product is in the PPMS scope: the CRM,
// ITSM, procurement, books, helpdesk and campaigns agents stay in the
// catalog (an org that already added one keeps it) but are not offered.
//
// Workspace agents only (docs/plans/ai-teammates.md 3.15): a PRIVATE AI
// teammate is its owner's alone and lives in AI teammates, so it is in
// neither `installed` nor `removed`, for anyone, its owner and Admins
// included. A new custom agent never takes a slug a static route beside
// /api/agents/[slug] owns (RESERVED_AGENT_SLUGS).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AGENT_CATALOG } from "@/lib/agents/catalog";
import { isReservedAgentSlug } from "@/lib/agents/teammate-access";
import { PRODUCT_TOOL_NAMES } from "@/lib/agents/tools";
import { isOwnerOrAdmin, requireApp, requireManageApps } from "@/lib/app-gate";
import { z } from "zod";
import { LEGACY_AGENT } from "@/lib/agents/legacy-agents";

export async function GET() {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const user = { organizationId: gate.viewer.organizationId };

  const installed = await prisma.agent.findMany({
    where: { organizationId: user.organizationId, visibility: "WORKSPACE", status: { not: "ARCHIVED" }, ...LEGACY_AGENT },
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

  // The Last run column links to the run itself (/agents?agent=&run=): the
  // newest autonomous run per agent, the same run lastRunAt records, and one
  // every Member may open (run-query.ts).
  const lastRuns = installed.length
    ? await prisma.agentRun.findMany({
        where: {
          agentId: { in: installed.map((a) => a.id) },
          OR: [{ input: { path: ["trigger"], equals: "SCHEDULED" } }, { input: { path: ["trigger"], equals: "MANUAL" } }],
        },
        orderBy: [{ agentId: "asc" }, { startedAt: "desc" }],
        distinct: ["agentId"],
        select: { id: true, agentId: true, status: true },
      })
    : [];
  const lastRunBy = new Map(lastRuns.map((r) => [r.agentId, r]));

  const removed = await prisma.agent.findMany({
    where: { organizationId: user.organizationId, visibility: "WORKSPACE", status: "ARCHIVED", ...LEGACY_AGENT },
    select: { id: true, slug: true, name: true, persona: true, description: true, isPrebuilt: true },
    orderBy: { name: "asc" },
    take: 200,
  });

  const installedSlugs = new Set(installed.map((a) => a.slug));
  const inScope = new Set(Object.keys(PRODUCT_TOOL_NAMES));
  const available = AGENT_CATALOG.filter((a) => !installedSlugs.has(a.slug) && inScope.has(a.productSlug)).map((a) => ({
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
      lastRunId: lastRunBy.get(a.id)?.id ?? null,
      lastRunStatus: lastRunBy.get(a.id)?.status ?? null,
    };
  });

  return NextResponse.json({
    installed: hydrated,
    available,
    removed: removed.map((a) => ({ ...a, status: "ARCHIVED" as const })),
    canManage: isOwnerOrAdmin(gate.viewer),
    // The clock a schedule saved without a CRON_TZ= zone runs on, so the page
    // can name it beside the words (src/lib/agents/cron.ts).
    serverZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
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
  const gate = await requireManageApps();
  if ("error" in gate) return gate.error;
  const userId = gate.viewer.userId;
  const user = { organizationId: gate.viewer.organizationId };

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  // Generate a unique slug within the org; bump with -2/-3/... on clash. A
  // reserved slug ("runs", "teammates", ...) counts as taken: the static
  // route of that name is served first, so the agent could never be reached.
  const baseSlug = slugify(parsed.data.name);
  let slug = baseSlug;
  for (let i = 2; i < 50; i++) {
    const clash = isReservedAgentSlug(slug)
      ? { id: slug }
      : await prisma.agent.findFirst({
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
