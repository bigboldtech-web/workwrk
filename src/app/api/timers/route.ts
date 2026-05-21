// /api/timers — query the current user's timer state for an entity
// and the total accumulated time across everyone.
//
// GET ?entityType=X&entityId=Y returns:
//   {
//     active: { id, startedAt } | null,   // current user's running session
//     totalMs: number,                    // SUM across all stopped sessions
//                                          // + current in-flight session
//     sessions: { id, userId, durationMs, startedAt, stoppedAt }[]
//   }

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType + entityId required" }, { status: 400 });
  }

  const sessions = await prisma.timerSession.findMany({
    where: { organizationId: ctx.orgId, entityType, entityId },
    orderBy: { startedAt: "desc" },
    take: 200,
  });

  // Sum stopped session durations + add the in-flight section's
  // running elapsed (computed against server-clock).
  const now = Date.now();
  let totalMs = 0;
  for (const s of sessions) {
    if (s.stoppedAt) totalMs += s.durationMs;
    else totalMs += Math.max(0, now - s.startedAt.getTime());
  }

  const active = sessions.find((s) => !s.stoppedAt && s.userId === ctx.userId) ?? null;

  return NextResponse.json({
    active: active ? { id: active.id, startedAt: active.startedAt } : null,
    totalMs,
    sessions: sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      startedAt: s.startedAt,
      stoppedAt: s.stoppedAt,
      durationMs: s.stoppedAt ? s.durationMs : Math.max(0, now - s.startedAt.getTime()),
    })),
  });
}
