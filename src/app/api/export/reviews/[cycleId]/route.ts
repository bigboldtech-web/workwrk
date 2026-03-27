import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError } from "@/lib/api-helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { cycleId } = await params;

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, organizationId: orgId },
    include: {
      reviews: {
        include: {
          subject: { select: { firstName: true, lastName: true, department: { select: { name: true } } } },
          reviewer: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!cycle) return jsonError("Review cycle not found", 404);

  const header = ["Employee", "Department", "Reviewer", "Status", "Overall Score", "Outcome"];
  const rows = cycle.reviews.map((r) => [
    `${r.subject.firstName} ${r.subject.lastName}`,
    r.subject.department?.name || "",
    r.reviewer ? `${r.reviewer.firstName} ${r.reviewer.lastName}` : "",
    r.status.replace(/_/g, " "),
    r.overallScore != null ? String(r.overallScore) : "",
    r.outcome || "",
  ]);

  const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="reviews-${cycle.name.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
