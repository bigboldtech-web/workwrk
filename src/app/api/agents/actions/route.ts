// GET /api/agents/actions?status=PENDING&agentSlug=&take=1..100
//
// This person's own requests from their teammates, newest first, each with
// the teammate it came from: { actions, total }. Only theirs: a request that
// acts for anyone else is never listed, an Admin's included. `status=PENDING`
// is what still waits (a request past its time reads as expired, as its
// card does).
//
// docs/plans/ai-teammates.md 4.

import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { actionViews } from "@/lib/agents/actions";
import { hueForAgent } from "@/lib/agents/hues";
import { isAgentActionStatus, type ActionView } from "@/lib/agents/teammate-thread";

const TAKE_DEFAULT = 50;
const TAKE_MAX = 100;

export async function GET(req: Request) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const sp = new URL(req.url).searchParams;
  const status = (sp.get("status") ?? "").toUpperCase();
  const slug = sp.get("agentSlug");
  const takeRaw = parseInt(sp.get("take") ?? "", 10);
  const take = Math.min(TAKE_MAX, Math.max(1, Number.isFinite(takeRaw) ? takeRaw : TAKE_DEFAULT));

  const where: Prisma.AgentActionWhereInput = { organizationId: viewer.organizationId, actingForId: viewer.userId };
  if (isAgentActionStatus(status)) where.status = status;
  if (status === "PENDING") where.expiresAt = { gt: new Date() };
  if (slug) where.agent = { slug: slug.slice(0, 200) };

  const [rows, total] = await Promise.all([
    prisma.agentAction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: { id: true, agent: { select: { slug: true, name: true, hue: true, avatar: true } } },
    }),
    prisma.agentAction.count({ where }),
  ]);
  const views = await actionViews(
    rows.map((r) => r.id),
    viewer.userId,
  );
  const actions = rows.flatMap((r): Array<ActionView & { agent: { slug: string; name: string; hue: string | null; avatar: string | null } }> => {
    const view = views[r.id];
    if (!view) return [];
    return [{ ...view, agent: { slug: r.agent.slug, name: r.agent.name, hue: hueForAgent({ hue: r.agent.hue, slug: r.agent.slug }), avatar: r.agent.avatar } }];
  });
  return NextResponse.json({ actions, total });
}
