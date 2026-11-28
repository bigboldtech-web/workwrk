// /api/timers/start — begin a timer session for the current user on
// an entity. If the user already has a running session on this
// entity, return that one (idempotent — clicks the play button
// twice don't create duplicates).
//
// If the user has a running session on a *different* entity, stop it
// first (one active timer per user across the system, matching
// monday/Toggl behavior).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { stopTimerSession, taskTimerRefusal } from "@/lib/timer-stop";
import { z } from "zod";

const bodySchema = z.object({
  entityType: z.string().min(1).max(40),
  entityId: z.string().min(1).max(80),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // A task's timer only on a task this person can open (pen test 2026-11-28,
  // V-24 and V-59): a timer on any id, another company's or a private task's,
  // was accepted, and the timesheet then showed that task's title.
  // A timer runs on a task, and only on a task: any other target was taken as
  // is and its time was lost on stop (V-59). Every timer in the product is a task's.
  if (parsed.data.entityType !== "BOARD_ITEM") return NextResponse.json({ error: "A timer runs on a task." }, { status: 400 });
  const refused = await taskTimerRefusal(parsed.data.entityType, parsed.data.entityId);
  if (refused) return refused;

  // Already running on this entity? Return it.
  const existing = await prisma.timerSession.findFirst({
    where: {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      stoppedAt: null,
    },
  });
  if (existing) return NextResponse.json({ session: existing, alreadyRunning: true });

  // Stop any other in-flight session for this user first.
  const otherActive = await prisma.timerSession.findFirst({
    where: { organizationId: ctx.orgId, userId: ctx.userId, stoppedAt: null },
  });
  // The one stop (src/lib/timer-stop.ts, pen test 2026-11-28 V-16): the
  // switched-away task's time reaches the timesheet, as a Stop click does.
  const previous = otherActive ? await stopTimerSession(otherActive, ctx) : null;

  const session = await prisma.timerSession.create({
    data: {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      startedAt: new Date(),
    },
  });
  return NextResponse.json({ session, previous: previous ? { session: previous.session, timesheet: previous.timesheet } : null });
}
