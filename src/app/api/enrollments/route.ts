// Course enrollments — list (per scope) + create / self-enroll.
//
// scope:
//   "mine"   → my enrollments (default)
//   "course" → all enrollments for ?courseId= (manager+)
//   "all"    → everyone in the org (manager+)

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

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") ?? "mine";
  const courseId = sp.get("courseId");
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 100)), 200);

  const where: Record<string, unknown> = {
    course: { organizationId: orgId },
  };

  if (scope === "mine") {
    where.userId = userId;
  } else if (scope === "course") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
    if (!courseId) return jsonError("courseId required");
    where.courseId = courseId;
  } else if (scope === "all") {
    if (!isManager(session)) return jsonError("Forbidden", 403);
  } else {
    return jsonError("Invalid scope");
  }

  const enrollments = await prisma.courseEnrollment.findMany({
    where,
    orderBy: [{ completedAt: { sort: "desc", nulls: "first" } }, { startedAt: "desc" }],
    take: limit,
    include: {
      course: { select: { id: true, title: true, mandatory: true, duration: true, category: true } },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  return jsonSuccess(enrollments);
}

export async function POST(req: NextRequest) {
  // Two flavors:
  //   { courseId } — self-enroll the caller
  //   { courseId, userIds: [...] } — bulk-enroll for managers
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  if (!courseId) return jsonError("courseId is required");

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const course = await prisma.trainingCourse.findFirst({
    where: { id: courseId, organizationId: orgId },
    select: { id: true, title: true },
  });
  if (!course) return jsonError("Course not found", 404);

  // Bulk-enroll requires manager+. Self-enroll allowed for everyone.
  const userIds: string[] = Array.isArray(body.userIds) && body.userIds.length > 0
    ? body.userIds.filter((u: unknown): u is string => typeof u === "string")
    : [userId];

  if (userIds.length > 1 && !isManager(session)) {
    return jsonError("Only managers can bulk-enroll", 403);
  }

  // Validate all target users belong to this org. Prevents an admin in
  // org A from enrolling users in org B via a malformed request.
  if (userIds.some((id) => id !== userId)) {
    const valid = await prisma.user.findMany({
      where: { id: { in: userIds }, organizationId: orgId },
      select: { id: true },
    });
    const validSet = new Set(valid.map((v) => v.id));
    if (userIds.some((id) => !validSet.has(id))) {
      return jsonError("Some users are not in this org", 403);
    }
  }

  // Idempotent createMany — duplicates are silently skipped per the
  // unique constraint on (courseId, userId).
  const result = await prisma.courseEnrollment.createMany({
    data: userIds.map((uid) => ({ courseId, userId: uid })),
    skipDuplicates: true,
  });

  logActivity({
    type: "enrollment_created",
    actorId: userId,
    organizationId: orgId,
    description: `Enrolled ${result.count} user(s) in "${course.title}"`,
    targetId: courseId,
    targetType: "training_course",
  });

  return jsonSuccess({ created: result.count }, 201);
}
