// GET /api/me/process-runs — checklist runs assigned to the current user that
// still need doing (ACTIVE / OVERDUE), for the "Checklists to run" section of
// the /today MyAlignment block. Mirrors /api/me/sops.

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

  const runs = await prisma.processRun.findMany({
    where: { assigneeId: u.id, status: { in: ["ACTIVE", "OVERDUE"] } },
    select: {
      id: true,
      title: true,
      status: true,
      progress: true,
      dueDate: true,
      shareToken: true,
      sop: { select: { id: true, title: true } },
    },
    orderBy: [{ dueDate: "asc" }, { startedAt: "desc" }],
  });

  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      progress: r.progress,
      dueDate: r.dueDate,
      shareToken: r.shareToken,
      sopId: r.sop?.id ?? null,
      sopTitle: r.sop?.title ?? null,
    })),
  });
}
