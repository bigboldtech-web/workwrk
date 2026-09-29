// PATCH /api/kpi-records/[id]/manager-review: a manager decides on a
// person's KPI number (spec-goals /team/kpi-reviews).
//   { action: "approve" }                         SUBMITTED -> APPROVED
//   { action: "request_changes", notes }          SUBMITTED -> REJECTED (a
//                                                 note is required: "change
//                                                 this" with no word is worse
//                                                 than nothing)
//   { action: "reopen" }                          APPROVED or REJECTED ->
//                                                 SUBMITTED, the toast's Undo;
//                                                 only the person who made
//                                                 the decision, or an Admin
// Gate: Can edit on the person (src/lib/kpi-review.server.ts: the chain,
// solid or dotted, the People team, Admin), never your own number.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { actOnKpiRecord } from "@/lib/kpi-record";
import { kpiActorCtx, mayActOnKpisOf } from "@/lib/kpi-review.server";

const bodySchema = z.object({
  action: z.enum(["approve", "request_changes", "reopen"]),
  notes: z.string().max(5000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const row = await prisma.kPIRecord.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, reviewedById: true, kpi: { select: { organizationId: true } } },
  });
  if (!row || row.kpi.organizationId !== u.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (row.userId === u.id) {
    return NextResponse.json({ error: "You can't review your own KPI number." }, { status: 400 });
  }
  const ctx = await kpiActorCtx();
  if (!ctx || !mayActOnKpisOf(ctx, row.userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { action } = parsed.data;
  if (action === "request_changes" && !parsed.data.notes?.trim()) {
    return NextResponse.json({ error: "Say what should change." }, { status: 400 });
  }
  if (action === "reopen") {
    if (row.status !== "APPROVED" && row.status !== "REJECTED") {
      return NextResponse.json({ error: `Nothing to undo on a ${row.status.toLowerCase()} number.` }, { status: 400 });
    }
    // Undo is the decider's (or an Admin's): a second manager never quietly
    // reopens someone else's decision.
    if (row.reviewedById && row.reviewedById !== u.id && !ctx.isAdmin) {
      return NextResponse.json({ error: "Only the person who decided can undo it." }, { status: 403 });
    }
  } else if (row.status !== "SUBMITTED") {
    const word = row.status === "APPROVED" ? "approved" : row.status === "REJECTED" ? "sent back" : "not yet submitted";
    return NextResponse.json({ error: `This KPI number is ${word}, so there is nothing to decide.` }, { status: 400 });
  }

  const result = await actOnKpiRecord(id, { action, notes: parsed.data.notes, actorId: u.id });
  return NextResponse.json({ ok: true, status: result.status });
}
