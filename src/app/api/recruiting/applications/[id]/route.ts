// Application detail / stage transition / edit. Stage moves are the
// hot path — they're tracked via ActivityLog and (on HIRED transition)
// flip the Job to FILLED if all openings are claimed and link the
// candidate to a User if one is supplied.

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

const VALID_STAGES = new Set([
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const app = await prisma.application.findFirst({
    where: { id, organizationId: orgId },
    include: {
      job: { select: { id: true, title: true, status: true, openings: true, departmentId: true } },
      candidate: {
        select: {
          id: true, firstName: true, lastName: true, email: true,
          phone: true, resumeUrl: true, source: true, notes: true,
        },
      },
      recruiter: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!app) return jsonError("Application not found", 404);
  return jsonSuccess(app);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const app = await prisma.application.findFirst({
    where: { id, organizationId: orgId },
    include: {
      job: { select: { id: true, openings: true, status: true, title: true } },
      candidate: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!app) return jsonError("Application not found", 404);

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.stage === "string") {
    if (!VALID_STAGES.has(body.stage)) return jsonError("Invalid stage");
    data.stage = body.stage;
  }
  if (body.rejectionReason !== undefined) {
    data.rejectionReason = typeof body.rejectionReason === "string" ? body.rejectionReason.trim() || null : null;
  }
  if (body.notes !== undefined) {
    data.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  }
  if (body.recruiterId !== undefined) {
    if (body.recruiterId === null || body.recruiterId === "") {
      data.recruiterId = null;
    } else if (typeof body.recruiterId === "string") {
      const r = await prisma.user.findFirst({
        where: { id: body.recruiterId, organizationId: orgId },
        select: { id: true },
      });
      data.recruiterId = r?.id ?? null;
    }
  }

  if (Object.keys(data).length === 0) return jsonError("No changes");

  // Pre-stage transition: if moving to HIRED, optionally link candidate
  // to an existing User record.
  if (data.stage === "HIRED" && typeof body.hiredUserId === "string" && body.hiredUserId) {
    const hiredUser = await prisma.user.findFirst({
      where: { id: body.hiredUserId, organizationId: orgId },
      select: { id: true },
    });
    if (hiredUser) {
      await prisma.candidate.update({
        where: { id: app.candidateId },
        data: { hiredUserId: hiredUser.id },
      });
    }
  }

  const updated = await prisma.application.update({ where: { id }, data });

  // Side-effect: HIRED transition — if this fills all openings on the
  // job, auto-flip the job to FILLED. Counted as APPLIED–HIRED is the
  // accepted definition; a hire can later be reverted but the count
  // stays current.
  if (data.stage === "HIRED" && app.stage !== "HIRED") {
    const hiredCount = await prisma.application.count({
      where: { jobId: app.jobId, stage: "HIRED" },
    });
    if (hiredCount >= app.job.openings && app.job.status === "OPEN") {
      await prisma.job.update({
        where: { id: app.jobId },
        data: { status: "FILLED", closedAt: new Date() },
      });
    }
    logActivity({
      type: "application_hired",
      actorId: userId,
      organizationId: orgId,
      description: `Hired ${app.candidate.firstName} ${app.candidate.lastName} for "${app.job.title}"`,
      targetId: id,
      targetType: "application",
    });
  } else if (typeof data.stage === "string" && data.stage !== app.stage) {
    logActivity({
      type: "application_stage_changed",
      actorId: userId,
      organizationId: orgId,
      description: `Moved ${app.candidate.firstName} ${app.candidate.lastName} to ${data.stage}`,
      targetId: id,
      targetType: "application",
    });
  }

  return jsonSuccess(updated);
}
