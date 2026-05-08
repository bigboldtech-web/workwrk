// Course detail / edit / delete. Manager+ for write; everyone reads.
// Delete refuses if anyone is enrolled — archive via patch instead.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
  isOrgAdmin,
} from "@/lib/api-helpers";

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
  return jsonSuccess({ deleted: true });
}
