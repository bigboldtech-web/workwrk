// PATCH /api/me/weekly-review/[id]
//   Body: { kpiSnapshots?, kraProgress?, highlights?, blockers?, plan?,
//           action?: "save" | "submit" | "reopen" }
//
// Save a draft, submit for manager review, or reopen a submitted
// review back to draft. Author ownership is enforced (userId === me).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  reopenWeeklyReview,
  saveWeeklyReviewDraft,
  submitWeeklyReview,
} from "@/lib/weekly-review";

const bodySchema = z.object({
  kpiSnapshots: z.array(z.object({
    kpiId: z.string().min(1),
    value: z.number().finite().nullable(),
    note: z.string().max(2000).optional(),
  })).optional(),
  kraProgress: z.array(z.object({
    kraId: z.string().min(1),
    progressPct: z.number().min(0).max(100),
    note: z.string().max(2000).optional(),
  })).optional(),
  highlights: z.string().max(5000).nullable().optional(),
  blockers: z.string().max(5000).nullable().optional(),
  plan: z.string().max(5000).nullable().optional(),
  action: z.enum(["save", "submit", "reopen"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  // Ownership check.
  const owner = await prisma.weeklyReview.findUnique({
    where: { id },
    select: { userId: true, status: true },
  });
  if (!owner || owner.userId !== u.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (owner.status === "ACKNOWLEDGED" && parsed.data.action !== "reopen") {
    return NextResponse.json({ error: "Already acknowledged by manager" }, { status: 400 });
  }

  // Save any body fields first.
  let review = await saveWeeklyReviewDraft(id, {
    kpiSnapshots: parsed.data.kpiSnapshots,
    kraProgress: parsed.data.kraProgress,
    highlights: parsed.data.highlights,
    blockers: parsed.data.blockers,
    plan: parsed.data.plan,
  });

  // Then apply the action.
  if (parsed.data.action === "submit") {
    review = await submitWeeklyReview(id);
  } else if (parsed.data.action === "reopen") {
    review = await reopenWeeklyReview(id);
  }

  return NextResponse.json({ review });
}
