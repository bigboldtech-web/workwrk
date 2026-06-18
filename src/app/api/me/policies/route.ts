// GET /api/me/policies — policies assigned to the current user that still need
// acknowledgement, for the "Policies to acknowledge" section on /today.

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

  const assignments = await prisma.policyAssignment.findMany({
    where: { userId: u.id, status: { not: "COMPLETED" } },
    include: { policy: { select: { id: true, title: true } } },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    policies: assignments.map((a) => ({
      assignmentId: a.id,
      policyId: a.policyId,
      title: a.policy?.title ?? "Policy",
      mandatory: a.mandatory,
      dueDate: a.dueDate,
      status: a.status,
    })),
  });
}
