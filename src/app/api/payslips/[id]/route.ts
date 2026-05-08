// Payslip detail — read-only. Two access tiers:
//   - Org admin: any payslip in the org.
//   - Subject:  their own payslip only.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
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
  const userId = getUserId(session);

  const slip = await prisma.payslip.findFirst({
    where: { id, organizationId: orgId },
    include: {
      subject: { select: { id: true, firstName: true, lastName: true, email: true } },
      payRun: { select: { id: true, periodStart: true, periodEnd: true, payDate: true, status: true } },
      payGroup: { select: { id: true, name: true, currency: true } },
      lines: {
        include: {
          earningCode: { select: { id: true, code: true, name: true } },
          deductionCode: { select: { id: true, code: true, name: true } },
        },
        orderBy: { kind: "asc" },
      },
    },
  });
  if (!slip) return jsonError("Not found", 404);

  // Subject can read their own; otherwise admin only.
  if (slip.subjectId !== userId && !isOrgAdmin(session)) {
    return jsonError("Forbidden", 403);
  }
  return jsonSuccess(slip);
}
