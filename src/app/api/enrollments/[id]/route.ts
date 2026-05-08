// Enrollment detail / progress update / unenroll.
//   PATCH — owner updates progress (0-100) and score, server stamps
//           completedAt when progress hits 100.
//   DELETE — owner can drop out of optional courses; manager+ can
//            unenroll anyone.

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const enrollment = await prisma.courseEnrollment.findFirst({
    where: { id, course: { organizationId: orgId } },
    include: { course: { select: { mandatory: true, title: true } } },
  });
  if (!enrollment) return jsonError("Enrollment not found", 404);

  const isOwner = enrollment.userId === userId;
  if (!isOwner && !isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.progress !== undefined) {
    const num = Number(body.progress);
    if (!Number.isFinite(num) || num < 0 || num > 100) return jsonError("progress must be 0-100");
    data.progress = Math.round(num);
    if (num >= 100 && !enrollment.completedAt) data.completedAt = new Date();
    if (num < 100 && enrollment.completedAt) data.completedAt = null;
  }
  if (body.score !== undefined) {
    if (body.score === null || body.score === "") data.score = null;
    else {
      const num = Number(body.score);
      if (!Number.isFinite(num) || num < 0 || num > 100) return jsonError("score must be 0-100");
      data.score = num;
    }
  }

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.courseEnrollment.update({ where: { id }, data });
  return jsonSuccess(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const enrollment = await prisma.courseEnrollment.findFirst({
    where: { id, course: { organizationId: orgId } },
    include: { course: { select: { mandatory: true } } },
  });
  if (!enrollment) return jsonError("Enrollment not found", 404);

  const isOwner = enrollment.userId === userId;
  // Mandatory courses can't be self-dropped — only a manager+ can
  // remove an employee from a mandatory training.
  if (isOwner && enrollment.course.mandatory && !isManager(session)) {
    return jsonError("Mandatory courses can't be self-dropped", 403);
  }
  if (!isOwner && !isManager(session)) return jsonError("Forbidden", 403);

  await prisma.courseEnrollment.delete({ where: { id } });
  return jsonSuccess({ deleted: true });
}
