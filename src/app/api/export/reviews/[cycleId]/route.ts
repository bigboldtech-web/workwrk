// GET /api/export/reviews/[cycleId]?subjectIds= : a cycle's reviews as CSV
// (Export cycle CSV, and Export selected in the Team and Calibration bulk
// bars). The People team and Admin export the cycle; anyone else only the
// people in their current chain (the same reach calibration reads), and an
// Agent never exports (cap.agent.export). Performance data never leaves to
// someone the cycle page would not show it to.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError } from "@/lib/api-helpers";
import { cycleViewerCtx } from "@/lib/performance/review-cycle.server";
import { outcomeLabel, reviewStatusOf, POTENTIALS } from "@/lib/performance/review-cycle";
import { toCsv } from "@/lib/csv";

export async function GET(req: NextRequest, { params }: { params: Promise<{ cycleId: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const ctx = await cycleViewerCtx();
  if (!ctx || ctx.isGuest || ctx.isAgent) return jsonError("Forbidden", 403);
  if (!ctx.peopleTeamOrAdmin && ctx.chain.size === 0) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { cycleId } = await params;
  const only = (new URL(req.url).searchParams.get("subjectIds") ?? "").split(",").filter(Boolean);

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, organizationId: orgId },
    include: {
      reviews: {
        where: {
          ...(ctx.peopleTeamOrAdmin ? {} : { subjectId: { in: [...ctx.chain] } }),
          ...(only.length ? { subjectId: { in: only } } : {}),
        },
        include: {
          subject: { select: { firstName: true, lastName: true, email: true, department: { select: { name: true } } } },
          reviewer: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!cycle) return jsonError("Review cycle not found", 404);

  const csv = toCsv(
    cycle.reviews.map((r) => ({
      Person: `${r.subject.firstName} ${r.subject.lastName}`.trim(),
      Email: r.subject.email,
      Department: r.subject.department?.name ?? "",
      Reviewer: r.reviewer ? `${r.reviewer.firstName} ${r.reviewer.lastName}`.trim() : "",
      Status: reviewStatusOf(r).label,
      "KPI score": r.kpiScore,
      "Manager rating": r.managerRating,
      Composite: r.compositeScore,
      Calibrated: r.calibratedScore,
      Potential: POTENTIALS.find((p) => p.value === r.potential)?.label ?? "",
      "Overall score": r.overallScore,
      Outcome: outcomeLabel(r.outcome),
    })),
    ["Person", "Email", "Department", "Reviewer", "Status", "KPI score", "Manager rating", "Composite", "Calibrated", "Potential", "Overall score", "Outcome"],
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reviews-${cycle.name.replace(/[^\w-]+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
