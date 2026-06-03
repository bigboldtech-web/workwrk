// PATCH /api/weekly-reviews/[id]/manager-review
//   Body: { action: "approve" | "request_changes", notes?: string }
//
// Manager action on a SUBMITTED review. Caller must be the assigned
// manager OR an org admin (for override / cover). The review must be
// SUBMITTED — we refuse to act on a DRAFT or re-act on an already-
// ACKNOWLEDGED row without an explicit override path (Phase 5c).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { actOnReview } from "@/lib/weekly-review";

const ORG_ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

const bodySchema = z.object({
  action: z.enum(["approve", "request_changes"]),
  notes: z.string().max(5000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const row = await prisma.weeklyReview.findUnique({
    where: { id },
    select: { id: true, organizationId: true, managerId: true, status: true, userId: true },
  });
  if (!row || row.organizationId !== u.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwnerManager = row.managerId === u.id;
  const isOrgAdmin = ORG_ADMIN_LEVELS.has(u.accessLevel ?? "EMPLOYEE");
  if (!isOwnerManager && !isOrgAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (row.status !== "SUBMITTED") {
    return NextResponse.json(
      { error: `Cannot act on a ${row.status.toLowerCase()} review` },
      { status: 400 },
    );
  }
  if (row.userId === u.id) {
    // Self-act refusal — a person can't manager-review their own
    // submission even if they happen to be admin.
    return NextResponse.json({ error: "Cannot act on your own review" }, { status: 400 });
  }

  const review = await actOnReview(id, {
    action: parsed.data.action,
    notes: parsed.data.notes,
    actorId: u.id,
  });
  return NextResponse.json({ review });
}
