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
  if (otherActive) {
    const now = new Date();
    const duration = Math.max(0, now.getTime() - otherActive.startedAt.getTime());
    await prisma.timerSession.update({
      where: { id: otherActive.id },
      data: { stoppedAt: now, durationMs: duration },
    });
  }

  const session = await prisma.timerSession.create({
    data: {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      startedAt: new Date(),
    },
  });
  return NextResponse.json({ session });
}
