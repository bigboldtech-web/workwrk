// GET /api/me/sops — SOPs assigned to the current user, with their
// status (ASSIGNED / IN_PROGRESS / COMPLETED / SKIPPED) and a
// `pending` flag for the MyAlignment block to surface unacknowledged
// mandatory SOPs at the top.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assignments = await prisma.sOPAssignment.findMany({
    where: { userId: u.id },
    include: {
      sop: { select: { id: true, title: true, description: true, status: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    sops: assignments.map((a) => ({
      assignmentId: a.id,
      status: a.status,
      mandatory: a.mandatory,
      pending: a.status !== "COMPLETED",
      sop: a.sop,
    })),
  });
}
