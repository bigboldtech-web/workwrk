// GET /api/timesheets/summary?scope=approve
//
// One number: how many submitted weeks are waiting for this person to
// decide. The Planner sidebar's Approvals row (sidebar-map.md section 2
// row 6) shows it and hides itself at zero; before Phase 4 that row was a
// hard-coded "No pending approvals" empty state that never counted
// anything (audit T-9).
//
// Deliberately its own tiny route rather than a field on the list: the
// sidebar renders on every page in the hub and must not pull twenty
// timesheet rows with their entries to print one integer.
//
// The scope rule is the list route's, unchanged, so the count and the page
// can never disagree: SUBMITTED weeks whose approver is this person, or
// which have no approver assigned yet.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { isOrgWideTimesheetReader } from "@/lib/timesheet-scope";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const scope = new URL(req.url).searchParams.get("scope") ?? "approve";

  if (scope !== "approve") return jsonError("scope must be 'approve'");

  // Not a manager is not an error here: the row simply does not render.
  // Answering 403 would make the sidebar log a failure on every page load
  // for every Member in the org.
  //
  // `canApprove` and `canReadAll` are also what /timesheets reads to decide
  // WHICH VIEW PILLS TO RENDER. Before this, the page rendered Approvals,
  // Team and All to everybody and each one answered 403 with an
  // unrecoverable "Try again", which is exactly the dead control spec-planner
  // section 1 situation 2 forbids ("the view pill is not rendered ... never
  // disabled"). A capability question the server owns is answered by the
  // server, once.
  if (!isManager(session)) return jsonSuccess({ count: 0, canApprove: false, canReadAll: false });

  const count = await prisma.timesheet.count({
    where: {
      organizationId: orgId,
      status: "SUBMITTED",
      OR: [{ approverId: userId }, { approverId: null }],
      // Nobody decides on their own week (the PATCH refuses it), so a week
      // of my own sitting in the open queue is not something waiting on me.
      NOT: { userId },
    },
  });

  // The org-wide audit view (scope=all) is the People team, Owners and
  // Admins only, which is the rule src/lib/timesheet-scope.ts owns and the
  // list route already enforces. Saying so here is what keeps the All pill
  // off the page for every other manager tier instead of rendering it and
  // silently folding it into `team` behind their back.
  return jsonSuccess({
    count,
    canApprove: true,
    canReadAll: isOrgWideTimesheetReader(session.user?.accessLevel),
  });
}
