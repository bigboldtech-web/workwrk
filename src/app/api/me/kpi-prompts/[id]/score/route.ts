// POST /api/me/kpi-prompts/[id]/score
//   Body: { actualValue: number, notes?: string, evidence?: string }
//
// Submits a single KPI score from the MyAlignment column. The record
// must belong to the current user; we don't let people score someone
// else's KPI. On success the row flips to SUBMITTED and a score is
// computed (higher-is-better default; flipped if lowerIsBetter).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  actualValue: z.number().finite(),
  notes: z.string().max(2000).optional(),
  evidence: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const record = await prisma.kPIRecord.findUnique({
    where: { id },
    include: { kpi: { select: { lowerIsBetter: true, targetValue: true } } },
  });
  if (!record || record.userId !== u.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (record.status === "APPROVED") {
    return NextResponse.json({ error: "Already approved by manager" }, { status: 400 });
  }

  // Score: percent achievement vs target, clamped to [0, 150]. For
  // lowerIsBetter (e.g. churn), invert.
  const target = Number(record.targetValue ?? record.kpi.targetValue ?? 0);
  const actual = parsed.data.actualValue;
  let score: number | null = null;
  if (target !== 0) {
    const raw = record.kpi.lowerIsBetter ? (target / actual) * 100 : (actual / target) * 100;
    score = Math.max(0, Math.min(150, Math.round(raw)));
  }

  const updated = await prisma.kPIRecord.update({
    where: { id },
    data: {
      actualValue: actual,
      notes: parsed.data.notes ?? record.notes,
      evidence: parsed.data.evidence ?? record.evidence,
      score,
      status: "SUBMITTED",
    },
  });
  return NextResponse.json({ record: updated });
}
