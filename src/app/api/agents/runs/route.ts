// GET /api/agents/runs?trigger=SCHEDULED&limit=10
//
// Lists recent AgentRun rows for this org, joined with agent name +
// productSlug so the dashboard card can render them without a second
// roundtrip. Defaults to all triggers (manual + scheduled), but the
// dashboard digest passes ?trigger=SCHEDULED so users see the
// autonomous work specifically.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const organizationId = (session.user as { organizationId?: string }).organizationId;
  if (!organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const trigger = url.searchParams.get("trigger");
  const agentSlug = url.searchParams.get("agent");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "10", 10) || 10, 50);

  // Pull a slightly wider window and filter in-memory by trigger so we
  // don't have to denormalize trigger onto AgentRun (it lives inside
  // input JSON).
  const rows = await prisma.agentRun.findMany({
    where: {
      agent: {
        organizationId,
        ...(agentSlug ? { slug: agentSlug } : {}),
      },
    },
    orderBy: { startedAt: "desc" },
    take: limit * 3,
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      tokensIn: true,
      tokensOut: true,
      input: true,
      output: true,
      error: true,
      agent: { select: { name: true, slug: true } },
    },
  });

  const filtered = trigger
    ? rows.filter((r) => {
        const inp = r.input as { trigger?: string } | null;
        return inp?.trigger === trigger;
      })
    : rows;

  const limited = filtered.slice(0, limit);

  return NextResponse.json({
    runs: limited.map((r) => ({
      id: r.id,
      agentName: r.agent.name,
      agentSlug: r.agent.slug,
      agentHue: "violet",
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      output: r.output,
      error: r.error,
    })),
  });
}
