// /api/me/work — the signed-in user's assigned work, bucketed for the
// My Work quick panel: Today / Overdue / Next (7d) / Unscheduled / Done.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

function normalizeStatus(s?: string | null): "done" | "in-progress" | "todo" {
  const t = (s ?? "").toLowerCase();
  if (/(done|complete|closed|resolved|shipped)/.test(t)) return "done";
  if (/(progress|doing|active|review|started|working)/.test(t)) return "in-progress";
  return "todo";
}

interface WorkItem {
  id: string; title: string; status: string | null;
  dueAt: string | null; priority: string | null; board: string | null; url: string;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
  const soon = new Date(todayStart.getTime() + 8 * 86_400_000); // through next 7 days
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const items = await prisma.item.findMany({
    where: { organizationId: u.organizationId, ownerId: u.id, archivedAt: null },
    select: {
      id: true, title: true, status: true, dueAt: true, startAt: true, priority: true,
      updatedAt: true, boardId: true, board: { select: { slug: true, name: true } },
    },
    orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
    take: 600,
  });

  const today: WorkItem[] = [], overdue: WorkItem[] = [], next: WorkItem[] = [];
  const unscheduled: WorkItem[] = [], done: WorkItem[] = [];

  for (const it of items) {
    const card: WorkItem = {
      id: it.id, title: it.title, status: it.status,
      dueAt: it.dueAt ? it.dueAt.toISOString() : null,
      priority: it.priority,
      board: it.board?.name ?? null,
      url: `/boards/${it.board?.slug ?? it.boardId}?item=${it.id}`,
    };
    const isDone = normalizeStatus(it.status) === "done";
    const when = it.dueAt ?? it.startAt ?? null;

    if (isDone) {
      if (it.updatedAt >= weekAgo) done.push(card);
      continue;
    }
    if (!when) { unscheduled.push(card); continue; }
    if (when < todayStart) overdue.push(card);
    else if (when < todayEnd) today.push(card);
    else if (when < soon) next.push(card);
    else next.push(card); // due further out still lands in "Next"
  }

  return NextResponse.json({
    buckets: { today, overdue, next, unscheduled, done },
    counts: {
      today: today.length, overdue: overdue.length, next: next.length,
      unscheduled: unscheduled.length, done: done.length,
    },
  });
}
