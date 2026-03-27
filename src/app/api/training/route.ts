import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "courses";

  if (type === "enrollments") {
    const userId = url.searchParams.get("userId");
    const enrollments = await prisma.courseEnrollment.findMany({
      where: {
        course: { organizationId: orgId },
        ...(userId ? { userId } : {}),
      },
      include: {
        course: { select: { title: true, category: true, duration: true, mandatory: true } },
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return jsonSuccess(enrollments);
  }

  const courses = await prisma.trainingCourse.findMany({
    where: { organizationId: orgId },
    include: {
      _count: { select: { enrollments: true } },
      enrollments: { select: { progress: true, completedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonSuccess(courses);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const body = await req.json();

  // Create course
  if (body.type === "course") {
    const { title, description, category, content, duration, mandatory } = body;
    if (!title) return jsonError("Title is required");

    const course = await prisma.trainingCourse.create({
      data: { title, description, category, content: content || {}, duration, mandatory: mandatory || false, organizationId: orgId },
    });
    return jsonSuccess(course, 201);
  }

  // Enroll user
  const { courseId, userId } = body;
  if (!courseId || !userId) return jsonError("courseId and userId are required");

  const enrollment = await prisma.courseEnrollment.create({
    data: { courseId, userId },
  });
  return jsonSuccess(enrollment, 201);
}
