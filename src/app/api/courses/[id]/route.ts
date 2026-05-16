// Course detail / edit / delete. Manager+ for write; everyone reads.
// Delete refuses if anyone is enrolled — archive via patch instead.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
  isOrgAdmin,
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

  const course = await prisma.trainingCourse.findFirst({
    where: { id, organizationId: orgId },
    include: {
      _count: { select: { enrollments: true } },
    },
  });
  if (!course) return jsonError("Course not found", 404);
  return jsonSuccess(course);
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

  const course = await prisma.trainingCourse.findFirst({ where: { id, organizationId: orgId } });
  if (!course) return jsonError("Course not found", 404);

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return jsonError("title cannot be empty");
    data.title = title;
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if (body.category !== undefined) {
    data.category = typeof body.category === "string" ? body.category.trim() || null : null;
  }
  if (body.duration !== undefined) {
    if (body.duration === null || body.duration === "") data.duration = null;
    else {
      const num = Number(body.duration);
      if (!Number.isFinite(num) || num < 0) return jsonError("Invalid duration");
      data.duration = num;
    }
  }
  if (typeof body.mandatory === "boolean") data.mandatory = body.mandatory;
  if (body.content !== undefined) data.content = body.content;

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.trainingCourse.update({ where: { id }, data });

  // Mandatory-flag flip is the change finance/compliance cares about
  // most — it changes who *must* complete the course.
  const flippedMandatory = typeof data.mandatory === "boolean" && data.mandatory !== course.mandatory;
  logActivity({
    type: "course_updated",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Updated course "${course.title}"${flippedMandatory ? ` (mandatory: ${data.mandatory ? "on" : "off"})` : ""}`,
    targetId: id,
    targetType: "training_course",
    oldValue: flippedMandatory ? { mandatory: course.mandatory } : undefined,
    newValue: flippedMandatory ? { mandatory: data.mandatory } : undefined,
  });

  return jsonSuccess(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const course = await prisma.trainingCourse.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { enrollments: true } } },
  });
  if (!course) return jsonError("Course not found", 404);
  if (course._count.enrollments > 0) {
    return jsonError("Course has enrollments — remove them first or keep for audit", 409);
  }

  await prisma.trainingCourse.delete({ where: { id } });

  logActivity({
    type: "course_deleted",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Deleted course "${course.title}"`,
    targetId: id,
    targetType: "training_course",
  });

  return jsonSuccess({ deleted: true });
}
