// Training courses — list + create. Manager+ create, all employees
// can read the catalog (so they can self-enroll in non-mandatory
// courses).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const category = sp.get("category");
  const mandatoryOnly = sp.get("mandatory") === "1";
  const search = sp.get("q")?.trim() ?? "";

  const where: Record<string, unknown> = { organizationId: orgId };
  if (category) where.category = category;
  if (mandatoryOnly) where.mandatory = true;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const courses = await prisma.trainingCourse.findMany({
    where,
    orderBy: [{ mandatory: "desc" }, { title: "asc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      duration: true,
      mandatory: true,
      createdAt: true,
      _count: { select: { enrollments: true } },
    },
  });

  return jsonSuccess(courses);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return jsonError("title is required");
  if (title.length > 200) return jsonError("title too long");

  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const category = typeof body.category === "string" ? body.category.trim() || null : null;
  const duration = body.duration === undefined || body.duration === null
    ? null
    : Math.max(0, Math.min(100_000, Number(body.duration) || 0));
  const mandatory = !!body.mandatory;

  const orgId = getOrgId(session);

  const course = await prisma.trainingCourse.create({
    data: {
      organizationId: orgId,
      title,
      description,
      category,
      duration,
      mandatory,
      content: body.content ?? {},
    },
  });

  logActivity({
    type: "course_created",
    actorId: (session.user as { id: string }).id,
    organizationId: orgId,
    description: `Created course "${title}"${mandatory ? " (mandatory)" : ""}`,
    targetId: course.id,
    targetType: "training_course",
  });

  return jsonSuccess(course, 201);
}
