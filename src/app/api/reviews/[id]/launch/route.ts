import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/email";
import { reviewPendingTemplate } from "@/lib/email-templates";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: orgId },
    include: { reviews: true },
  });
  if (!cycle) return jsonError("Review cycle not found", 404);

  // Launchable states: DRAFT (the normal path) and ACTIVE-with-no-reviews
  // (heals legacy cycles whose status was flipped before this route had a
  // UI caller). Never a cycle that's calibrating, finished or cancelled.
  if (["IN_CALIBRATION", "COMPLETED", "CANCELLED"].includes(cycle.status)) {
    return jsonError(`Cannot launch a ${cycle.status.replace(/_/g, " ").toLowerCase()} cycle`);
  }

  if (cycle.reviews.length > 0) {
    return jsonError("Reviews already generated for this cycle. Delete existing reviews first.");
  }

  // Get all active employees in the org
  const employees = await prisma.user.findMany({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
    },
    select: { id: true, managerId: true },
  });

  if (employees.length === 0) {
    return jsonError("No active employees found");
  }

  // Create a Review for each employee
  // reviewer = their manager, or the launching user if no manager
  const launcherId = getUserId(session);
  const reviewData = employees.map((emp) => ({
    cycleId: id,
    subjectId: emp.id,
    reviewerId: emp.managerId || launcherId,
    status: "PENDING" as const,
  }));

  // Create the reviews and flip the cycle ACTIVE atomically — a crash
  // between the two would strand a cycle with reviews still in DRAFT (or,
  // reordered, an ACTIVE cycle with zero reviews) that the dedupe guard
  // above then refuses to re-launch.
  await prisma.$transaction([
    prisma.review.createMany({ data: reviewData }),
    prisma.reviewCycle.update({ where: { id }, data: { status: "ACTIVE" } }),
  ]);

  // Create notifications for all employees
  const notifications = employees.map((emp) => ({
    title: "Review Cycle Started",
    message: `${cycle.name} has been launched. Please complete your self-assessment.`,
    type: "REVIEW",
    link: `/reviews/${id}`,
    userId: emp.id,
  }));

  await prisma.notification.createMany({ data: notifications });

  // Send review pending emails to all employees
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const dueDate = new Date(cycle.endDate).toLocaleDateString();
  const employeesWithEmail = await prisma.user.findMany({
    where: { id: { in: employees.map((e) => e.id) } },
    select: { id: true, email: true },
  });

  // Template is identical per-employee; render once and fan out in parallel.
  const { subject, html } = reviewPendingTemplate({
    reviewCycleName: cycle.name,
    dueDate,
    reviewLink: `${baseUrl}/reviews/${id}`,
  });
  await Promise.all(
    employeesWithEmail.map((emp) =>
      sendEmail({
        to: emp.email,
        subject,
        html,
        template: "review-pending",
        variables: { reviewCycleName: cycle.name, dueDate },
        organizationId: orgId,
        userId: emp.id,
        category: "review",
      }).catch((emailErr) => {
        console.error("[ReviewLaunch] Email send failed:", emailErr);
      }),
    ),
  );

  return jsonSuccess({
    message: `${employees.length} reviews generated`,
    count: employees.length,
  });
}
