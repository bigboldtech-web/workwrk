import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";

/**
 * Lightweight meetings feed for the Work Calendar views.
 *
 * Scope (matches the tasks route's rules so the two surfaces feel
 * consistent):
 *   - Employees: only meetings they're attending.
 *   - Managers: meetings their team is in (via `view=team`) or a
 *     specific subset (`userIds=` filter). An explicit `userIds=`
 *     means "show meetings these people are in."
 *
 * Returns only the fields the calendar renders — title, scheduledAt,
 * duration, type, attendee ids. Full detail lives on /meetings/:id.
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const currentUserId = getUserId(session);
  const url = new URL(req.url);

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return jsonError("from and to dates are required");

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return jsonError("Invalid date format");

  const userIdsParam = url.searchParams.get("userIds");
  const view = url.searchParams.get("view");
  const managerLevel = isManager(session);

  let attendeeFilter: string[] | null = null;
  if (userIdsParam) {
    attendeeFilter = userIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (view === "team" && managerLevel) {
    attendeeFilter = await getTeamUserIds(orgId, currentUserId);
  } else if (!managerLevel) {
    attendeeFilter = [currentUserId];
  }

  const where: any = {
    organizationId: orgId,
    scheduledAt: { gte: fromDate, lte: toDate },
  };
  if (attendeeFilter) {
    where.attendees = { some: { userId: { in: attendeeFilter } } };
  }

  const meetings = await prisma.meeting.findMany({
    where,
    select: {
      id: true, title: true, type: true,
      scheduledAt: true, duration: true,
      attendees: { select: { userId: true } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });

  return jsonSuccess(meetings);
}
