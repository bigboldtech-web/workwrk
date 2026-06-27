// /api/timers/stop — stop the current user's in-flight session on
// an entity (or any in-flight session if no entity specified).
// Computes durationMs from startedAt to now and persists it.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { logTimerToTimesheet } from "@/lib/timesheet";
import { z } from "zod";

const bodySchema = z.object({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const active = await prisma.timerSession.findFirst({
    where: {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      stoppedAt: null,
      ...(parsed.data.entityType ? { entityType: parsed.data.entityType } : {}),
      ...(parsed.data.entityId ? { entityId: parsed.data.entityId } : {}),
    },
    orderBy: { startedAt: "desc" },
  });
  if (!active) return NextResponse.json({ ok: true, noActive: true });

  const now = new Date();
  const durationMs = Math.max(0, now.getTime() - active.startedAt.getTime());

  const session = await prisma.timerSession.update({
    where: { id: active.id },
    data: { stoppedAt: now, durationMs },
  });

  // Bridge: tracked time on a Kanban card flows into the user's weekly
  // timesheet, linked back to the card. Best-effort; never blocks the stop.
  if (active.entityType === "BOARD_ITEM" && durationMs > 0) {
    try {
      const item = await prisma.item.findUnique({
        where: { id: active.entityId },
        select: { id: true, title: true, organizationId: true },
      });
      if (item && item.organizationId === ctx.orgId) {
        await logTimerToTimesheet({
          orgId: ctx.orgId, userId: ctx.userId, itemId: item.id,
          title: item.title, durationMs, when: now,
        });
      }
    } catch (err) {
      console.error("timer→timesheet bridge failed", err);
    }
  }

  return NextResponse.json({ session });
}
