// GET /api/meetings/summary
//
// One number: how many of my meetings are still to come today. The Planner
// sidebar's Meetings row (sidebar-map.md section 2 row 2) shows it and
// hides itself at zero.
//
// "Mine" is the same rule the list route scopes by, so the badge and the
// page can never disagree: meetings I attend or created. An Owner or Admin
// gets their OWN count here, not the org's; a badge that counted the whole
// company's meetings would say nothing about the reader's day.
//
// "Today" is the viewer's calendar day. The client sends the boundaries it
// computed in its own zone (?from and ?to, ISO instants), because the
// server does not know the viewer's IANA zone on this route and bucketing
// in UTC is exactly the defect audit TC-4 named. With no parameters it
// falls back to the server day, which is the old behaviour and is honest
// for a same-zone deployment.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";

function parseInstant(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const sp = new URL(req.url).searchParams;

  const now = new Date();
  const from = parseInstant(sp.get("from")) ?? now;
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const to = parseInstant(sp.get("to")) ?? dayEnd;

  // Still to come: starts at or after now, and before the end of the day.
  const lowerBound = from > now ? from : now;

  const count = await prisma.meeting.count({
    where: {
      organizationId: orgId,
      deletedAt: null,
      scheduledAt: { gte: lowerBound, lte: to },
      OR: [
        { attendees: { some: { userId } } },
        { createdById: userId },
      ],
    },
  });

  const next = count > 0
    ? await prisma.meeting.findFirst({
        where: {
          organizationId: orgId,
          deletedAt: null,
          scheduledAt: { gte: lowerBound, lte: to },
          OR: [{ attendees: { some: { userId } } }, { createdById: userId }],
        },
        orderBy: { scheduledAt: "asc" },
        select: { id: true, title: true, scheduledAt: true },
      })
    : null;

  return jsonSuccess({ count, next });
}
