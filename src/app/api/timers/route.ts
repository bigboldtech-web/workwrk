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
//
// POST creates a manual (already-stopped) session — the "I worked 45 min
// on this yesterday and forgot to start the timer" path. Body:
//   { entityType, entityId, durationMs, startedAt?, notes? }
// If startedAt is omitted we anchor to (now - durationMs) so the entry
// shows up as "just now" on the timeline.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";

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

const manualSchema = z.object({
  entityType: z.string().min(1).max(40),
  entityId: z.string().min(1).max(80),
  durationMs: z.number().int().min(1000).max(86_400_000), // 1s — 24h
  startedAt: z.string().optional(),
  notes: z.string().max(280).optional(),
});

export async function POST(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const parsed = manualSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const startedAt = parsed.data.startedAt
    ? new Date(parsed.data.startedAt)
    : new Date(Date.now() - parsed.data.durationMs);
  if (isNaN(startedAt.getTime())) {
    return NextResponse.json({ error: "invalid startedAt" }, { status: 400 });
  }
  const stoppedAt = new Date(startedAt.getTime() + parsed.data.durationMs);

  const session = await prisma.timerSession.create({
    data: {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      startedAt,
      stoppedAt,
      durationMs: parsed.data.durationMs,
      notes: parsed.data.notes,
    },
  });
  return NextResponse.json({ session }, { status: 201 });
}
