// /api/planner/events — the signed-in user's scheduled things for the Planner
// time-grid: Tasks (personal events + Google-synced meetings) and work Items
// that have a date. Normalized to { start, end, allDay } so the grid can
// position each block by time.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

interface PlannerEvent {
  id: string;
  source: "task" | "item";
  external: boolean;        // synced from Google
  title: string;
  start: string;            // ISO
  end: string;              // ISO
  allDay: boolean;
  status: string | null;
  url: string | null;
}

function parse(d: string | null): Date | null {
  if (!d) return null;
  const x = new Date(d);
  return isNaN(x.getTime()) ? null : x;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const now = new Date();
  const from = parse(url.searchParams.get("from")) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = parse(url.searchParams.get("to")) ?? new Date(from.getTime() + 7 * 86_400_000);

  const events: PlannerEvent[] = [];

  // ── Scheduled Tasks (personal events + Google-synced) ───────────
  const tasks = await prisma.task.findMany({
    where: {
      organizationId: u.organizationId,
      assigneeId: u.id,
      OR: [
        { date: { gte: from, lte: to } },
        { startAt: { gte: from, lte: to } },
        { AND: [{ startAt: { lte: to } }, { OR: [{ endAt: null }, { endAt: { gte: from } }] }] },
      ],
    },
    select: { id: true, title: true, date: true, startAt: true, endAt: true, allDay: true, status: true, externalSource: true },
    take: 500,
  });
  for (const t of tasks) {
    const start = t.startAt ?? t.date;
    if (!start) continue;
    const end = t.endAt ?? new Date(start.getTime() + (t.allDay ? 0 : 60 * 60 * 1000));
    events.push({
      id: `task:${t.id}`, source: "task", external: t.externalSource === "GCAL",
      title: t.title, start: start.toISOString(), end: end.toISOString(),
      allDay: t.allDay, status: t.status, url: null,
    });
  }

  // ── Work Items with a date ──────────────────────────────────────
  const items = await prisma.item.findMany({
    where: {
      organizationId: u.organizationId, ownerId: u.id, archivedAt: null,
      OR: [{ dueAt: { gte: from, lte: to } }, { startAt: { gte: from, lte: to } }],
    },
    select: { id: true, title: true, status: true, startAt: true, dueAt: true, boardId: true, board: { select: { slug: true } } },
    take: 500,
  });
  for (const it of items) {
    const start = it.startAt ?? it.dueAt!;
    const end = it.dueAt && it.startAt ? it.dueAt : new Date(start.getTime() + 60 * 60 * 1000);
    events.push({
      id: `item:${it.id}`, source: "item", external: false,
      title: it.title, start: start.toISOString(), end: end.toISOString(),
      allDay: false, status: it.status,
      url: `/boards/${it.board?.slug ?? it.boardId}?item=${it.id}`,
    });
  }

  return NextResponse.json({ events, range: { from: from.toISOString(), to: to.toISOString() } });
}
