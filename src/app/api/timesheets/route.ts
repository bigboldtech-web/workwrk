// Timesheets: list (per scope) and "my current week" upsert.
//
// scope:
//   "mine"    → my last N weeks
//   "approve" → SUBMITTED rows assigned to me (or unassigned)
//   "team"    → my report tree, or the whole organization for the People
//               team, Owners and Admins (spec-planner section 10: `all`
//               folds into `team`)
//   "all"     → a legacy alias of "team", kept so stored links resolve
//
// POST upserts the current-week timesheet for the caller. Used the
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
import { utcDayFromKey } from "@/lib/time-format";
import { isOrgWideTimesheetReader } from "@/lib/timesheet-scope";

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
    // "Weeks whose subject is in the viewer's chain or assigned to the
    // viewer" (spec-planner section 1 Access). The unassigned queue used to
    // be org-wide: `approverId: null` alone handed every unclaimed week in
    // the company to every Team Lead and every HR account, because
    // isManager() resolves through LEGACY_MANAGER_LEVELS. An unclaimed week
    // is now only visible to the people the subject actually reports to.
    const chain = await getEffectiveReportTree(userId);
    const reports = chain.filter((id) => id !== userId);
    where.OR = [
      { approverId: userId },
      ...(reports.length ? [{ approverId: null, userId: { in: reports } }] : []),
    ];
  } else if (scope === "team" || scope === "all") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    // ONE TEAM SCOPE. "`all` folds into `team` for People team and Admin ...
    // the org-wide `all` scope for any team lead is gone" (spec-planner
    // section 10). The fold is now actually performed: `team` IS the widest
    // read a viewer holds, so an Admin's Team view shows the organization
    // rather than the empty report tree of somebody who manages nobody.
    // `all` stays accepted as an alias so a link minted before this release
    // still resolves, and answers exactly what `team` answers.
    if (!isOrgWideTimesheetReader(session.user?.accessLevel)) {
      // Full report tree (direct + indirect), matching the Team Calendar.
      const tree = await getEffectiveReportTree(userId);
      where.userId = { in: tree.filter((id) => id !== userId) };
    }
    // Owners, Admins and HR: no userId narrowing, which is the org-wide audit
    // read the "All" view used to be. It is the same view, under one name.
  } else {
    return jsonError("Invalid scope");
  }

  // ?week=YYYY-MM-DD narrows to the one week a decision notification or a
  // "See in timesheet" link names (spec-planner section 2 /timesheets
  // Data). A malformed value is a 400, never a silent Invalid Date that
  // matches nothing and reads as "you have no timesheets".
  const weekRaw = sp.get("week");
  if (weekRaw) {
    const day = utcDayFromKey(weekRaw);
    if (!day) return jsonError("week must be YYYY-MM-DD");
    where.weekStartDate = weekStartUTC(day);
  }

  // ?person= narrows a team or approvals list to one person. It can only
  // narrow: the scope clause above has already decided whose rows are
  // visible, and this is applied on top of it.
  const person = sp.get("person");
  if (person && scope !== "mine") {
    const already = where.userId;
    if (already && typeof already === "object" && "in" in (already as Record<string, unknown>)) {
      const allowed = (already as { in: string[] }).in;
      where.userId = allowed.includes(person) ? person : "__none__";
    } else {
      where.userId = person;
    }
  }

  const status = sp.get("status");
  if (status && ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].includes(status)) {
    // scope=approve has already pinned status to SUBMITTED; do not widen it.
    if (scope !== "approve") where.status = status;
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
  //
  // ROUNDED PER ENTRY, not once at the end. Every client surface renders
  // h:mm by rounding each entry's decimal hours to whole minutes and adding
  // those up (src/lib/timesheet-grid.ts), so summing the decimals first and
  // rounding once puts this number a minute away from the one the week card
  // and the drawer print for the SAME week. The two appeared side by side
  // on one card: the header said 37:37 and the footer said 37:38.
  const withTotals = timesheets.map(({ entries, ...rest }) => ({
    ...rest,
    totalMinutes: entries.reduce((s, e) => s + (e.hours ? Math.round(Number(e.hours) * 60) : 0), 0),
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
