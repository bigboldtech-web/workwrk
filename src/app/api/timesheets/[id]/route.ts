// Timesheet detail (with all entries) + submit / decision in one
// PATCH endpoint to keep the surface tight. The decision actor must
// not be the subject — same anti-self-decision rule used elsewhere.

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
import { logActivity } from "@/lib/activity";

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
        },
      },
    },
  });
  if (!timesheet) return jsonError("Timesheet not found", 404);

  const canSee =
    timesheet.userId === userId ||
    timesheet.approverId === userId ||
    isManager(session);
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
  const body = await req.json();

  // Submit transition: owner only, DRAFT → SUBMITTED.
  if (body.action === "submit") {
    if (!isOwner) return jsonError("Forbidden", 403);
    if (timesheet.status !== "DRAFT") {
      return jsonError(`Cannot submit a ${timesheet.status} timesheet`, 409);
    }
    // Optional: refuse to submit a fully-empty week. Skip the check
    // for v1 — managers in some roles legitimately submit zero-hour
    // weeks (vacation handled elsewhere).
    const updated = await prisma.timesheet.update({
      where: { id },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });
    logActivity({
      type: "timesheet_submitted",
      actorId: userId,
      organizationId: orgId,
      description: `Submitted timesheet`,
      targetId: id,
      targetType: "timesheet",
    });
    return jsonSuccess(updated);
  }

  // Retract: owner only, SUBMITTED → DRAFT before any decision.
  if (body.action === "retract") {
    if (!isOwner) return jsonError("Forbidden", 403);
    if (timesheet.status !== "SUBMITTED") {
      return jsonError(`Cannot retract a ${timesheet.status} timesheet`, 409);
    }
    const updated = await prisma.timesheet.update({
      where: { id },
      data: { status: "DRAFT", submittedAt: null },
    });
    return jsonSuccess(updated);
  }

  // Decide: manager+ only, SUBMITTED → APPROVED|REJECTED. Subject
  // can't decide on their own week.
  if (body.action === "decide") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    if (timesheet.userId === userId) {
      return jsonError("You can't decide on your own timesheet", 403);
    }
    const decision = typeof body.decision === "string" ? body.decision.toUpperCase() : "";
    if (!["APPROVE", "REJECT"].includes(decision)) {
      return jsonError("decision must be APPROVE or REJECT");
    }
    if (timesheet.status !== "SUBMITTED") {
      return jsonError(`Cannot decide on a ${timesheet.status} timesheet`, 409);
    }
    const note = typeof body.note === "string" ? body.note.trim() || null : null;
    const updated = await prisma.timesheet.update({
      where: { id },
      data: {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        approverId: userId,
        decisionAt: new Date(),
        decisionNote: note,
      },
    });
    logActivity({
      type: `timesheet_${decision.toLowerCase()}`,
      actorId: userId,
      organizationId: orgId,
      description: `${decision === "APPROVE" ? "Approved" : "Rejected"} timesheet`,
      targetId: id,
      targetType: "timesheet",
    });
    return jsonSuccess(updated);
  }

  return jsonError("action must be submit | retract | decide");
}
