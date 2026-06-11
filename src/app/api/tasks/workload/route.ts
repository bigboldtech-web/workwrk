import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";

/**
 * Manager workload heatmap.
 *
 * Returns per-user per-day totals:
 *   [{ userId, date: "YYYY-MM-DD", estimateHours, taskCount, completedCount }]
 *
 * Who can call:
 *   - Managers only. Employees don't need this — their own dashboard
 *     already tells them what their day looks like.
 *
 * Scope:
 *   - Defaults to the caller's recursive team (self + all direct/indirect
 *     reports). An explicit `userIds=` filter narrows further.
 *
 * This is intentionally coarse — one row per (user, date) pair — so the
 * manager can spot overloaded days at a glance without having to scan
 * individual calendars. For detail, they drill into the Day/Week view
 * filtered to that person.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const currentUserId = getUserId(session);
  const url = new URL(req.url);

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return jsonError("from and to dates are required (YYYY-MM-DD)");

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return jsonError("Invalid date format");

  // Cap the window at 92 days so one request can't groupBy across an
  // unbounded range.
  const dayMs = 24 * 60 * 60 * 1000;
  if (toDate.getTime() - fromDate.getTime() > 92 * dayMs) {
    return jsonError("Window too large (max 92 days)");
  }

  const userIdsParam = url.searchParams.get("userIds");
  let scopedUserIds: string[];
  if (userIdsParam) {
    scopedUserIds = userIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    scopedUserIds = await getTeamUserIds(orgId, currentUserId);
  }

  const tasks = await prisma.task.findMany({
    where: {
      organizationId: orgId,
      assigneeId: { in: scopedUserIds },
      // Parent tasks only — sub-tasks roll up into the parent's bar.
      parentTaskId: null,
      OR: [
        { date: { gte: fromDate, lte: toDate } },
        {
          AND: [
            { startAt: { lte: toDate } },
            { OR: [{ endAt: null }, { endAt: { gte: fromDate } }] },
          ],
        },
      ],
    },
    select: {
      assigneeId: true,
      date: true,
      startAt: true,
      endAt: true,
      estimateHours: true,
      hoursSpent: true,
      status: true,
    },
  });

  // Bucket by (userId, YYYY-MM-DD). Multi-day tasks split their estimate
  // evenly across the days they span so the heatmap reflects the actual
  // distribution of work, not just the start day.
  const buckets = new Map<string, { userId: string; date: string; estimateHours: number; taskCount: number; completedCount: number }>();

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  for (const t of tasks) {
    const spanStart = t.startAt ?? t.date;
    const spanEnd = t.endAt ?? t.startAt ?? t.date;
    if (!spanStart || !spanEnd) continue; // unscheduled — no span to load-balance
    const dayStart = new Date(spanStart);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(spanEnd);
    dayEnd.setUTCHours(0, 0, 0, 0);
    const spanDays = Math.max(1, Math.round((dayEnd.getTime() - dayStart.getTime()) / dayMs) + 1);
    const hoursPerDay = t.estimateHours ? t.estimateHours / spanDays : 0;

    for (let i = 0; i < spanDays; i++) {
      const d = new Date(dayStart.getTime() + i * dayMs);
      if (d < fromDate || d > toDate) continue;
      const key = `${t.assigneeId}::${iso(d)}`;
      const row = buckets.get(key) ?? { userId: t.assigneeId, date: iso(d), estimateHours: 0, taskCount: 0, completedCount: 0 };
      row.estimateHours += hoursPerDay;
      row.taskCount += 1;
      if (t.status === "COMPLETED") row.completedCount += 1;
      buckets.set(key, row);
    }
  }

  return jsonSuccess(Array.from(buckets.values()));
}
