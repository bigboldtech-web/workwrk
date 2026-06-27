// Timesheets — list (per scope) and "my current week" upsert.
//
// scope:
//   "mine"    → my last N weeks
//   "approve" → SUBMITTED rows assigned to me (or unassigned)
//   "team"    → my direct reports
//   "all"     → manager+ org-wide audit
//
// POST upserts the current-week timesheet for the caller — used the
// first time an employee opens /timesheets so the row exists for
// inline entry creation.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";
import { weekStartUTC } from "@/lib/timesheet-week";
import { tagFilterIds } from "@/lib/tag-filter";
import { getEffectiveReportTree } from "@/lib/reporting-line";

const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") ?? "mine";
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 20)), MAX_LIMIT);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (scope === "mine") {
    where.userId = userId;
  } else if (scope === "approve") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    where.status = "SUBMITTED";
    where.OR = [{ approverId: userId }, { approverId: null }];
  } else if (scope === "team") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    // Full report tree (direct + indirect), matching the Team Calendar.
    const tree = await getEffectiveReportTree(userId);
    where.userId = { in: tree.filter((id) => id !== userId) };
  } else if (scope === "all") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
  } else {
    return jsonError("Invalid scope");
  }

  const tagsRaw = sp.get("tags");
  if (tagsRaw) {
    const matched = await tagFilterIds({ organizationId: orgId, entityType: "TIMESHEET", tagsRaw });
    if (matched !== null) {
      if (matched.length === 0) return jsonSuccess([]);
      where.id = { in: matched };
    }
  }

  const timesheets = await prisma.timesheet.findMany({
    where,
    orderBy: { weekStartDate: "desc" },
    take: limit,
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      approver: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { entries: true } },
      entries: { select: { hours: true } },
    },
  });

  // Sum entry hours → totalMinutes so the list shows real logged time.
  const withTotals = timesheets.map(({ entries, ...rest }) => ({
    ...rest,
    totalMinutes: Math.round(entries.reduce((s, e) => s + (e.hours ? Number(e.hours) : 0), 0) * 60),
  }));

  return jsonSuccess(withTotals);
}

export async function POST(req: NextRequest) {
  // Upsert current-week timesheet for the caller. Idempotent.
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const body = await req.json().catch(() => ({}));
  const weekStart = body.weekStartDate
    ? weekStartUTC(new Date(body.weekStartDate))
    : weekStartUTC();

  const existing = await prisma.timesheet.findUnique({
    where: { userId_weekStartDate: { userId, weekStartDate: weekStart } },
  });
  if (existing) return jsonSuccess(existing);

  // Default approver = user's manager. Open queue if no manager.
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { managerId: true },
  });

  const created = await prisma.timesheet.create({
    data: {
      organizationId: orgId,
      userId,
      weekStartDate: weekStart,
      approverId: me?.managerId ?? null,
    },
  });
  return jsonSuccess(created, 201);
}
