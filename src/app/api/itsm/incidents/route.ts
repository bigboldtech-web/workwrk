// GET /api/itsm/incidents — list this org's incidents
// POST /api/itsm/incidents — declare a new incident
// PATCH /api/itsm/incidents — update status, acknowledge, resolve

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveItsmContext } from "@/lib/itsm/auth";
import { z } from "zod";

export async function GET() {
  const ctx = await resolveItsmContext();
  if ("error" in ctx) return ctx.error;

  const incidents = await prisma.incident.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: [{ status: "asc" }, { startedAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({ incidents });
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(8000).optional(),
  severity: z.enum(["SEV1", "SEV2", "SEV3", "SEV4", "SEV5"]).optional(),
  commanderId: z.string().optional(),
  affectedServices: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveItsmContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const incident = await prisma.incident.create({
    data: {
      organizationId: ctx.orgId,
      title: parsed.data.title,
      summary: parsed.data.summary,
      severity: parsed.data.severity ?? "SEV3",
      commanderId: parsed.data.commanderId ?? ctx.userId,
      affectedServices: (parsed.data.affectedServices ?? []) as object,
    },
  });

  return NextResponse.json({ incident });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["DETECTED", "ACKNOWLEDGED", "INVESTIGATING", "MITIGATING", "RESOLVED", "POSTMORTEM", "CLOSED"]).optional(),
  severity: z.enum(["SEV1", "SEV2", "SEV3", "SEV4", "SEV5"]).optional(),
  rootCause: z.string().max(8000).optional(),
  postmortemUrl: z.string().max(500).optional(),
});

export async function PATCH(req: Request) {
  const ctx = await resolveItsmContext();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const existing = await prisma.incident.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.orgId },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const now = new Date();
  const updates: Partial<{ status: typeof parsed.data.status; severity: typeof parsed.data.severity; rootCause: string; postmortemUrl: string; acknowledgedAt: Date | null; resolvedAt: Date | null }> = {};
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.severity !== undefined) updates.severity = parsed.data.severity;
  if (parsed.data.rootCause !== undefined) updates.rootCause = parsed.data.rootCause;
  if (parsed.data.postmortemUrl !== undefined) updates.postmortemUrl = parsed.data.postmortemUrl;

  if (parsed.data.status === "ACKNOWLEDGED" && !existing.acknowledgedAt) updates.acknowledgedAt = now;
  if (parsed.data.status === "RESOLVED" && !existing.resolvedAt) updates.resolvedAt = now;

  const incident = await prisma.incident.update({
    where: { id: parsed.data.id },
    data: updates,
  });

  return NextResponse.json({ incident });
}
