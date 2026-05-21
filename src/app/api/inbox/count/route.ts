// /api/inbox/count — lightweight unread/pending count for the topbar
// badge. Counts the user's "owe-me-attention" items: open tasks +
// pending SOP acknowledgements. Cheap aggregate query, no list
// fetch — keeps the topbar render snappy.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const [openTasks, pendingSops] = await Promise.all([
    prisma.task.count({
      where: {
        organizationId: ctx.orgId,
        assigneeId: ctx.userId,
        status: { not: "COMPLETED" },
      },
    }),
    prisma.sOPAssignment.count({
      where: {
        sop: { organizationId: ctx.orgId },
        userId: ctx.userId,
        completedAt: null,
      },
    }),
  ]);

  return NextResponse.json({ total: openTasks + pendingSops, openTasks, pendingSops });
}
