// Interview detail / reschedule / decision (complete + score) /
// cancel. Manager+ for write; the named interviewer for their own
// scorecard.

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

const VALID_STATUS = new Set(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const interview = await prisma.interview.findFirst({
    where: { id, organizationId: orgId },
    include: {
      interviewer: { select: { id: true, firstName: true, lastName: true, email: true } },
      application: {
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
          job: { select: { id: true, title: true } },
        },
      },
    },
  });
  if (!interview) return jsonError("Interview not found", 404);
  return jsonSuccess(interview);
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

  const interview = await prisma.interview.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!interview) return jsonError("Interview not found", 404);

  const isInterviewer = interview.interviewerId === userId;
  if (!isManager(session) && !isInterviewer) return jsonError("Forbidden", 403);

  const body = await req.json();
  const data: Record<string, unknown> = {};

  // Reschedule: scheduledAt + duration. Manager+ only — interviewer
  // can't move their own slot without a manager's blessing in v1.
  if (body.scheduledAt && isManager(session)) {
    const d = new Date(body.scheduledAt);
    if (Number.isNaN(d.getTime())) return jsonError("Invalid scheduledAt");
    data.scheduledAt = d;
  }
  if (body.durationMinutes !== undefined && isManager(session)) {
    const num = Number(body.durationMinutes);
    if (!Number.isFinite(num) || num < 5 || num > 480) return jsonError("Invalid durationMinutes");
    data.durationMinutes = num;
  }
  if (body.location !== undefined && isManager(session)) {
    data.location = typeof body.location === "string" ? body.location.trim() || null : null;
  }
  if (typeof body.interviewerId === "string" && isManager(session)) {
    const u = await prisma.user.findFirst({
      where: { id: body.interviewerId, organizationId: orgId },
      select: { id: true },
    });
    if (!u) return jsonError("Interviewer not found", 404);
    data.interviewerId = body.interviewerId;
  }

  // Status transitions — interviewer can mark COMPLETED / NO_SHOW;
  // manager+ can also CANCEL.
  if (typeof body.status === "string") {
    if (!VALID_STATUS.has(body.status)) return jsonError("Invalid status");
    if (body.status === "CANCELLED" && !isManager(session)) {
      return jsonError("Only managers can cancel an interview", 403);
    }
    data.status = body.status;
  }

  // Scorecard fields — interviewer or manager. Score is 1-5.
  if (body.score !== undefined) {
    if (body.score === null || body.score === "") data.score = null;
    else {
      const num = Number(body.score);
      if (!Number.isFinite(num) || num < 1 || num > 5) return jsonError("score must be 1-5");
      data.score = Math.round(num);
    }
  }
  if (body.notes !== undefined) {
    data.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  }

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.interview.update({ where: { id }, data });

  logActivity({
    type: "interview_updated",
    actorId: userId,
    organizationId: orgId,
    description: `Updated interview (${updated.status.toLowerCase()})`,
    targetId: id,
    targetType: "interview",
  });

  return jsonSuccess(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const interview = await prisma.interview.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!interview) return jsonError("Interview not found", 404);

  // Hard delete is reserved for accidentally-created rows; cancel
  // is the safer default. We refuse delete on completed interviews
  // (they're audit-relevant).
  if (interview.status === "COMPLETED") {
    return jsonError("Completed interviews can't be deleted; cancel instead", 409);
  }

  await prisma.interview.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
