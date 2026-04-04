import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const course = await prisma.trainingCourse.findFirst({
    where: { id, organizationId: orgId },
    include: {
      enrollments: {
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { startedAt: "desc" },
      },
    },
  });

  if (!course) return jsonError("Course not found", 404);

  return jsonSuccess(course);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);
  const body = await req.json();

  const existing = await prisma.trainingCourse.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) return jsonError("Course not found", 404);

  const data: any = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.category !== undefined) data.category = body.category;
  if (body.duration !== undefined) data.duration = body.duration;
  if (body.content !== undefined) data.content = body.content;
  if (body.mandatory !== undefined) data.mandatory = body.mandatory;

  const updated = await prisma.trainingCourse.update({
    where: { id },
    data,
  });

  return jsonSuccess(updated);
}
