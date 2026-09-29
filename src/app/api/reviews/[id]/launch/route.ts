import { canManageReviewCycle, chainOf, isPeopleTeamOrAdmin } from "@/lib/people/review-cycle-access";
import { launchAudience } from "@/lib/people/review-cycle-rules";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/email";
import { reviewPendingTemplate } from "@/lib/email-templates";
import { formatDate } from "@/lib/format/date";

type Session = NonNullable<Awaited<ReturnType<typeof getSessionOrFail>>["session"]>;

/**
 * Who a launch of this cycle would ask, worked out ONE way for the preview
 * (GET) and the launch itself (POST), so the count a confirm names is the
 * count the launch creates reviews for and emails. Every refusal the launch
 * makes is made here too, so the preview fails before a confirm ever opens.
 */
async function launchPlan(session: Session, id: string) {
  const orgId = getOrgId(session);
  const cycle = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: orgId },
    include: { reviews: true },
  });
  if (!cycle) return { error: jsonError("Review cycle not found", 404) } as const;
  // Phase 6: the People team and Admin, or the manager who started it.
  if (!(await canManageReviewCycle(session, cycle))) {
    return { error: jsonError("Only the People team, an Admin or the manager who started this cycle can launch it", 403) } as const;
  }

  // Launchable states: DRAFT (the normal path) and ACTIVE-with-no-reviews
  // (heals legacy cycles whose status was flipped before this route had a
  // UI caller). Never a cycle that's calibrating, finished or cancelled.
  if (["IN_CALIBRATION", "COMPLETED", "CANCELLED"].includes(cycle.status)) {
    return { error: jsonError(`Cannot launch a ${cycle.status.replace(/_/g, " ").toLowerCase()} cycle`) } as const;
  }

  if (cycle.reviews.length > 0) {
    return { error: jsonError("Reviews already generated for this cycle. Delete existing reviews first.") } as const;
  }

  // The active people the cycle covers (review-cycle-rules.ts): the cycle's
  // own audience for the People team and Admin; a manager's cycle is always
  // clipped to their chain. Removed people are never reviewed.
  const people = await prisma.user.findMany({
    where: { organizationId: orgId, status: "ACTIVE", deletedAt: null },
    select: { id: true, managerId: true, departmentId: true },
  });
  const peopleOrAdmin = await isPeopleTeamOrAdmin(session);
  const covered = new Set(
    launchAudience({
      peopleTeamOrAdmin: peopleOrAdmin,
      audienceType: cycle.audienceType,
      departmentIds: cycle.departmentIds,
      userIds: cycle.userIds,
      chainIds: peopleOrAdmin ? [] : await chainOf(getUserId(session)),
      people,
    }),
  );
  const employees = people.filter((p) => covered.has(p.id));
  return { cycle, employees, peopleOrAdmin } as const;
}

/**
 * The launch preview (spec-teams-performance: "Launch {name}? This creates
 * a review for 24 people and emails each of them."). Read only: nothing is
 * created, nobody is told. `clipped` is true for a manager's launch, whose
 * cycle only ever reaches their own reporting line; `covers` names the
 * departments of a Departments cycle as they are spelled.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const plan = await launchPlan(session, id);
  if ("error" in plan) return plan.error;
  const { cycle, employees, peopleOrAdmin } = plan;
  const covers =
    cycle.audienceType === "DEPARTMENTS"
      ? (await prisma.department.findMany({ where: { id: { in: cycle.departmentIds }, organizationId: getOrgId(session) }, select: { name: true } })).map((d) => d.name).join(", ") || null
      : null;
  return jsonSuccess({
    count: employees.length,
    audienceType: cycle.audienceType,
    named: cycle.audienceType === "USERS" ? cycle.userIds.length : null,
    covers,
    clipped: !peopleOrAdmin,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const plan = await launchPlan(session, id);
  if ("error" in plan) return plan.error;
  const { cycle, employees } = plan;

  if (employees.length === 0) {
    return jsonError("No active employees found");
  }

  // The confirm named a count (GET above). If who the cycle covers changed
  // between that preview and this click (someone joined, left or moved
  // teams), refuse rather than email a number of people nobody agreed to.
  // A caller that sends no `expect` (older clients) launches as before.
  const body = await req.json().catch(() => null) as { expect?: unknown } | null;
  if (typeof body?.expect === "number" && body.expect !== employees.length) {
    return jsonError(`Who this cycle covers changed while the confirm was open: it now covers ${employees.length} ${employees.length === 1 ? "person" : "people"}. Nothing was sent. Launch again to see the new count.`, 409);
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

  // Create the reviews and flip the cycle ACTIVE atomically, a crash
  // between the two would strand a cycle with reviews still in DRAFT (or,
  // reordered, an ACTIVE cycle with zero reviews) that the dedupe guard
  // above then refuses to re-launch.
  await prisma.$transaction([
    prisma.review.createMany({ data: reviewData }),
    prisma.reviewCycle.update({ where: { id }, data: { status: "ACTIVE" } }),
  ]);

  // The two Inbox doors (spec-teams-performance section 1): every subject
  // gets "Your review for {cycle} is open", and every reviewer gets one row
  // for all the manager reviews they owe, never one row per person.
  const dueLabel = formatDate(cycle.endDate, { timezone: "UTC" }, "date");
  const owed = new Map<string, number>();
  for (const r of reviewData) {
    if (r.reviewerId !== r.subjectId) owed.set(r.reviewerId, (owed.get(r.reviewerId) ?? 0) + 1);
  }
  const notifications = [
    ...employees.map((emp) => ({
      title: `Your review for ${cycle.name} is open`,
      message: `Due ${dueLabel}`,
      type: "review_open",
      link: `/reviews/${id}`,
      userId: emp.id,
    })),
    ...[...owed.entries()].map(([reviewerId, n]) => ({
      title: `You owe ${n} manager ${n === 1 ? "review" : "reviews"} for ${cycle.name}`,
      message: `Due ${dueLabel}`,
      type: "manager_reviews_due",
      link: `/reviews/${id}?tab=team`,
      userId: reviewerId,
    })),
  ];

  await prisma.notification.createMany({ data: notifications });

  // Send review pending emails to all employees
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const dueDate = dueLabel;
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
