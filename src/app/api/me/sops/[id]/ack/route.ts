// POST /api/me/sops/[id]/ack
//   Body: { note?: string }
//
// Acknowledge an SOP assigned to the current user. Flips the
// SOPAssignment to COMPLETED, stamps completedAt + stepsCompleted,
// and merges the user's note into the assignment's progress JSON so
// admins reviewing /sops can see what was attested.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  note: z.string().max(1000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const assignment = await prisma.sOPAssignment.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, stepsTotal: true, progress: true },
  });
  if (!assignment || assignment.userId !== u.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (assignment.status === "COMPLETED") {
    return NextResponse.json({ assignment, alreadyAcknowledged: true });
  }

  const priorProgress = (assignment.progress && typeof assignment.progress === "object")
    ? (assignment.progress as Record<string, unknown>)
    : {};
  const nextProgress = {
    ...priorProgress,
    ackedAt: new Date().toISOString(),
    ackNote: parsed.data.note ?? null,
  };

  const updated = await prisma.sOPAssignment.update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      stepsCompleted: assignment.stepsTotal || 1,
      progress: nextProgress as object,
    },
  });

  return NextResponse.json({ assignment: updated });
}
