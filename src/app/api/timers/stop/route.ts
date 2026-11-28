// /api/timers/stop — stop the current user's in-flight session on
// an entity (or any in-flight session if no entity specified).
// Computes durationMs from startedAt to now and persists it.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { stopTimerSession } from "@/lib/timer-stop";
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

  // The one stop (src/lib/timer-stop.ts): closed, and logged to the timesheet.
  const stopped = await stopTimerSession(active, ctx);
  if (!stopped) return NextResponse.json({ ok: true, noActive: true });
  return NextResponse.json({ session: stopped.session, timesheet: stopped.timesheet });
}
