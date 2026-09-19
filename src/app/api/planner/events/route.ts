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

  // ── Tasks with a date ───────────────────────────────────────────
  //
  // Phase 2 W4. This handler used to run TWO queries side by side, one over
  // the legacy `Task` table and one over `Item`, and prefix their ids to keep
  // them apart. That was the clearest evidence in the codebase that there were
  // two task models: a task created in the planner went to one table and a
  // task created on a board went to the other, and neither surface could see
  // the other's rows. The legacy rows are Items now
  // (scripts/migrate-legacy-tasks.ts), so there is one query.
  //
  // `source: "task"` is kept as the event kind, because that is what these
  // events ARE to the planner and to every client reading this payload; only
  // the table behind it changed.
  //
  // Two fixes ride along, both of which were bugs rather than model details:
  //   - it matched `ownerId` alone, so a task assigned to you by somebody else
  //     never appeared on your own planner. It now matches the assignee set.
  //   - legacy events carried `url: null` and so were unclickable. Every row
  //     has a task URL now.
  const items = await prisma.item.findMany({
    where: {
      organizationId: u.organizationId,
      archivedAt: null,
      OR: [{ ownerId: u.id }, { assigneeIds: { has: u.id } }],
      AND: [{ OR: [{ dueAt: { gte: from, lte: to } }, { startAt: { gte: from, lte: to } }] }],
    },
    select: { id: true, title: true, status: true, startAt: true, dueAt: true, metadata: true },
    take: 500,
  });
  for (const it of items) {
    const start = it.startAt ?? it.dueAt!;
    const end = it.dueAt && it.startAt ? it.dueAt : new Date(start.getTime() + 60 * 60 * 1000);
    // A Google-synced legacy task keeps its provenance under the remainder the
    // migration preserved, so the "external" pill on the planner still tells
    // the truth about rows that came from a calendar.
    const legacy = (it.metadata as { legacyTask?: { externalSource?: string } } | null)?.legacyTask;
    events.push({
      id: `item:${it.id}`,
      source: "task",
      external: legacy?.externalSource === "GCAL",
      title: it.title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      status: it.status,
      url: `/item/${it.id}`,
    });
  }

  return NextResponse.json({ events, range: { from: from.toISOString(), to: to.toISOString() } });
}
