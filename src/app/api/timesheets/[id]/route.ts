// Timesheet detail (with all entries) + submit / decision in one
// PATCH endpoint to keep the surface tight. The decision actor must
// not be the subject: the same anti-self-decision rule used elsewhere.

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
import { logActivity, logAuditEvent } from "@/lib/activity";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import { utcDayKey } from "@/lib/time-format";
import { isOrgWideTimesheetReader } from "@/lib/timesheet-scope";
import { getEffectiveReportTree } from "@/lib/reporting-line";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const timesheet = await prisma.timesheet.findFirst({
    where: { id, organizationId: orgId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      approver: { select: { id: true, firstName: true, lastName: true } },
      entries: {
        orderBy: { day: "asc" },
        include: {
          task: { select: { id: true, title: true } },
          item: { select: { id: true, title: true, board: { select: { slug: true } } } },
        },
      },
    },
  });
  if (!timesheet) return jsonError("Timesheet not found", 404);

  // WHOSE TIMESHEET MAY I READ. The list route and the CSV export both went
  // through src/lib/timesheet-scope.ts in Phase 4 and this route did not, so
  // a TEAM_LEAD (isManager() resolves through LEGACY_MANAGER_LEVELS, which
  // includes TEAM_LEAD and HR) could read any timesheet in the organization
  // by id, with every entry, description and task link on it. Three surfaces
  // answer this question, so all three read the same rule now: your own week,
  // a week you are the approver of, a week belonging to somebody in your
  // report tree, or the org-wide read the People team, Owners and Admins hold.
  let canSee =
    timesheet.userId === userId ||
    timesheet.approverId === userId ||
    isOrgWideTimesheetReader(session.user?.accessLevel);
  if (!canSee && isManager(session)) {
    const tree = await getEffectiveReportTree(userId);
    canSee = tree.includes(timesheet.userId);
  }
  if (!canSee) return jsonError("Timesheet not found", 404);

  return jsonSuccess({
    ...timesheet,
    entries: timesheet.entries.map((e) => ({
      ...e,
      hours: e.hours === null ? null : Number(e.hours),
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const timesheet = await prisma.timesheet.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!timesheet) return jsonError("Timesheet not found", 404);

  const isOwner = timesheet.userId === userId;
  // A missing or malformed body is the contract, not a 500 with an empty
  // response. `req.json()` throws on both, and an unhandled throw in a route
  // handler is a bare 500 that tells the caller nothing (the punch route was
  // fixed for exactly this as audit C-1; its siblings were not).
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return jsonError("action is required: submit | retract | reopen | decide");
  }

  // Submit transition: owner only, DRAFT → SUBMITTED.
  if (body.action === "submit") {
    if (!isOwner) return jsonError("Forbidden", 403);
    if (timesheet.status !== "DRAFT") {
      return jsonError(`Cannot submit a ${timesheet.status} timesheet`, 409);
    }
    // Optional: refuse to submit a fully-empty week. Skip the check
    // for v1: managers in some roles legitimately submit zero-hour
    // weeks (vacation handled elsewhere).
    // AND THE OLD DECISION COMES OFF. The reopen branch below keeps
    // `decisionNote` on purpose, and says so, because it is what the
    // rejection banner shows while the person fixes the week: "it clears on
    // the next submit, not here". This IS the next submit. Without these two
    // lines a week that was rejected, fixed and resubmitted still carried
    // the red "Sent back by ..." banner over a blue Submitted chip, forever,
    // and the neutral "Submitted" branch became unreachable for anyone who
    // had ever been rejected once.
    const updated = await prisma.timesheet.update({
      where: { id },
      data: { status: "SUBMITTED", submittedAt: new Date(), decisionNote: null, decisionAt: null },
    });
    logActivity({
      type: "timesheet_submitted",
      actorId: userId,
      organizationId: orgId,
      description: `Submitted timesheet`,
      targetId: id,
      targetType: "timesheet",
    });
    // AND THE APPROVER IS ACTUALLY TOLD. src/lib/inbox-kinds.ts has
    // registered "Timesheet to review" since Phase 4 with no producer
    // anywhere in the tree, so the one entry point the spec names for the
    // Approvals drawer was never minted by anything and the only signal an
    // approver got was a sidebar badge they had to notice on their own.
    // The link is the queue with this week already open in the drawer.
    const recipientId = timesheet.approverId
      ?? (await prisma.user.findUnique({ where: { id: userId }, select: { managerId: true } }))?.managerId
      ?? null;
    if (recipientId && recipientId !== userId) {
      const submittedWeekKey = utcDayKey(new Date(timesheet.weekStartDate));
      prisma.notification.create({
        data: {
          userId: recipientId,
          type: "timesheet_submitted",
          title: "Timesheet to review",
          message: `A timesheet for the week of ${submittedWeekKey} is waiting for your decision.`,
          link: `/timesheets?view=approvals&sheet=${id}`,
        },
      }).catch((err) => console.error("[Timesheet] Notification failed:", err));
    }
    return jsonSuccess(updated);
  }

  // Retract: owner only, SUBMITTED → DRAFT before any decision.
  if (body.action === "retract") {
    if (!isOwner) return jsonError("Forbidden", 403);
    if (timesheet.status !== "SUBMITTED") {
      return jsonError(`Cannot retract a ${timesheet.status} timesheet`, 409);
    }
    const updated = await prisma.timesheet.update({
      // A retracted week has not been decided, so the decision stamp comes
      // off with the submission. Leaving it made the CSV export print a
      // DRAFT row with a decision time against it, which is a misleading
      // row in the one artifact people take outside the product.
      where: { id },
      data: { status: "DRAFT", submittedAt: null, decisionAt: null },
    });
    return jsonSuccess(updated);
  }

  // Reopen: back to DRAFT. TWO AUDIENCES, and the second one exists because
  // three refusals in this unit say "Ask your approver to reopen it"
  // (POST /api/time-entries and both punch guards). Until now there was no
  // door behind that sentence: `reopen` was owner-only and REJECTED-only, so
  // an approved week could never come back and the copy sent the person
  // nowhere.
  //
  //   owner                      REJECTED -> DRAFT  (spec-planner section 2
  //                              /timesheets, "Reopen and fix", audit T-2)
  //   approver or org admin      APPROVED -> DRAFT  (a correction, logged to
  //                              the audit trail because approval is
  //                              billing relevant, and the owner is told)
  //
  // The decision note is deliberately KEPT on the row. It is what the
  // banner shows while the person fixes the week, and it clears on the
  // next submit, not here. The decision TIME is cleared, because the week
  // no longer carries a decision.
  if (body.action === "reopen") {
    const isApprover = timesheet.approverId === userId || legacyIsAdminLevel(session.user.accessLevel);
    const ownerPath = isOwner && timesheet.status === "REJECTED";
    const approverPath = isApprover && !isOwner && timesheet.status === "APPROVED";
    if (!ownerPath && !approverPath) {
      if (!isOwner && !isApprover) return jsonError("Forbidden", 403);
      return jsonError(
        timesheet.status === "APPROVED"
          ? "Only the approver can reopen an approved week."
          : `Cannot reopen a ${timesheet.status} timesheet`,
        409,
      );
    }
    const updated = await prisma.timesheet.update({
      where: { id },
      data: { status: "DRAFT", submittedAt: null, decisionAt: null },
    });
    const weekKeyReopen = utcDayKey(new Date(timesheet.weekStartDate));
    if (approverPath) {
      logAuditEvent({
        type: "timesheet_reopened",
        actorId: userId,
        organizationId: orgId,
        description: `Reopened an approved timesheet (week of ${weekKeyReopen})`,
        targetId: id,
        targetType: "timesheet",
        metadata: { weekStartDate: timesheet.weekStartDate, ownerId: timesheet.userId },
      });
      prisma.notification.create({
        data: {
          userId: timesheet.userId,
          type: "timesheet_reopened",
          title: "Timesheet reopened",
          message: `Your approved timesheet for the week of ${weekKeyReopen} was reopened for changes.`,
          link: `/timesheets?week=${weekKeyReopen}`,
        },
      }).catch((err) => console.error("[Timesheet] Notification failed:", err));
    } else {
      logActivity({
        type: "timesheet_reopened",
        actorId: userId,
        organizationId: orgId,
        description: "Reopened a rejected timesheet",
        targetId: id,
        targetType: "timesheet",
      });
    }
    return jsonSuccess(updated);
  }

  // Decide: manager+ only, SUBMITTED → APPROVED|REJECTED. Subject
  // can't decide on their own week.
  if (body.action === "decide") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    if (timesheet.userId === userId) {
      return jsonError("You can't decide on your own timesheet", 403);
    }
    // WHOSE WEEK MAY I DECIDE. Every READ in this unit was tightened to the
    // report line (the GET above, the list route's approve scope, the CSV
    // export) and this WRITE was left on isManager() alone, which resolves
    // through LEGACY_MANAGER_LEVELS and so includes TEAM_LEAD and HR. A lead
    // could approve or reject any submitted week in the organization by id,
    // including weeks this same file answers 404 for on GET. The write now
    // asks the same question the read asks, and answers 404 the same way so
    // it never confirms that a week it will not touch exists.
    let canDecide =
      timesheet.approverId === userId ||
      isOrgWideTimesheetReader(session.user?.accessLevel);
    if (!canDecide) {
      const tree = await getEffectiveReportTree(userId);
      canDecide = tree.includes(timesheet.userId);
    }
    if (!canDecide) return jsonError("Timesheet not found", 404);
    const decision = typeof body.decision === "string" ? body.decision.toUpperCase() : "";
    if (!["APPROVE", "REJECT"].includes(decision)) {
      return jsonError("decision must be APPROVE or REJECT");
    }
    if (timesheet.status !== "SUBMITTED") {
      return jsonError(`Cannot decide on a ${timesheet.status} timesheet`, 409);
    }
    const note = typeof body.note === "string" ? body.note.trim() || null : null;
    // A rejection with no reason is what the audit called T-4: the owner
    // saw "Rejected" and had nothing to act on. The Reject modal makes the
    // reason required in the UI; this is the same rule at the API, so a
    // stale tab or a script cannot write a reasonless rejection.
    if (decision === "REJECT" && !note) {
      return jsonError("note_required", 400);
    }
    const updated = await prisma.timesheet.update({
      where: { id },
      data: {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        approverId: userId,
        decisionAt: new Date(),
        decisionNote: note,
      },
    });
    // The week is named by its UTC day key, never by formatting the
    // midnight instant with toLocaleDateString on the server: that printed
    // the SERVER's locale and time zone into an audit row and a
    // notification a person in another zone then read (audit T-7).
    const weekKey = utcDayKey(new Date(timesheet.weekStartDate));

    // Approve/reject on a timesheet is a billing-relevant decision. Bump to
    // warning so the audit log makes it findable on review.
    logAuditEvent({
      type: `timesheet_${decision.toLowerCase()}`,
      actorId: userId,
      organizationId: orgId,
      description: `${decision === "APPROVE" ? "Approved" : "Rejected"} timesheet (week of ${weekKey})`,
      targetId: id,
      targetType: "timesheet",
      metadata: { weekStartDate: timesheet.weekStartDate, ownerId: timesheet.userId },
    });

    // Notify the timesheet owner. Payroll downstream means rejected
    // hours need to be edited fast, so surface it in the bell.
    prisma.notification.create({
      data: {
        userId: timesheet.userId,
        type: `timesheet_${decision.toLowerCase()}`,
        title: decision === "APPROVE" ? "Timesheet approved" : "Timesheet rejected",
        message: `Your timesheet for the week of ${weekKey} was ${decision === "APPROVE" ? "approved" : "rejected"}${note ? `: "${note}"` : "."}`,
        // /time has never existed as a route (audit T-8), so every one of
        // these notifications was a dead link. The week the decision is
        // about is now in the URL, so the page opens on it.
        link: `/timesheets?week=${weekKey}`,
      },
    }).catch((err) => console.error("[Timesheet] Notification failed:", err));

    return jsonSuccess(updated);
  }

  return jsonError("action must be submit | retract | reopen | decide");
}
