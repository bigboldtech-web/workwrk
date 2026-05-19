// GET /api/crm/pipeline-stages — list this org's pipeline stages.
//   If none exist yet, lazily seed a sensible default 6-stage pipeline
//   (New, Qualified, Proposal, Negotiation, Closed Won, Closed Lost).
//   This way orgs that install CRM via the Product Store get a working
//   kanban on first visit with no extra setup.
//
// POST — create a new stage { name, position?, probability?, color? }
// PATCH — reorder/edit stages { id, ... }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCrmContext } from "@/lib/crm/auth";
import { z } from "zod";

const DEFAULT_STAGES = [
  { name: "New", position: 1, probability: 10, color: "#94a3b8" },
  { name: "Qualified", position: 2, probability: 25, color: "#60a5fa" },
  { name: "Proposal", position: 3, probability: 50, color: "#a78bfa" },
  { name: "Negotiation", position: 4, probability: 75, color: "#f59e0b" },
  { name: "Closed Won", position: 5, probability: 100, color: "#10b981", isWon: true },
  { name: "Closed Lost", position: 6, probability: 0, color: "#ef4444", isLost: true },
];

export async function GET() {
  const ctx = await resolveCrmContext();
  if ("error" in ctx) return ctx.error;

  let stages = await prisma.pipelineStage.findMany({
    where: { organizationId: ctx.orgId, archivedAt: null },
    orderBy: { position: "asc" },
  });

  if (stages.length === 0) {
    await prisma.$transaction(
      DEFAULT_STAGES.map((s) =>
        prisma.pipelineStage.create({
          data: {
            organizationId: ctx.orgId,
            name: s.name,
            position: s.position,
            probability: s.probability,
            color: s.color,
            isWon: s.isWon ?? false,
            isLost: s.isLost ?? false,
          },
        }),
      ),
    );
    stages = await prisma.pipelineStage.findMany({
      where: { organizationId: ctx.orgId, archivedAt: null },
      orderBy: { position: "asc" },
    });
  }

  return NextResponse.json({ stages });
}

const createSchema = z.object({
  name: z.string().min(1).max(64),
  position: z.number().int().min(0).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  color: z.string().max(16).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveCrmContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const last = await prisma.pipelineStage.findFirst({
    where: { organizationId: ctx.orgId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const stage = await prisma.pipelineStage.create({
    data: {
      organizationId: ctx.orgId,
      name: parsed.data.name,
      position: parsed.data.position ?? (last?.position ?? 0) + 1,
      probability: parsed.data.probability ?? 50,
      color: parsed.data.color,
    },
  });

  return NextResponse.json({ stage });
}
