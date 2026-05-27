// Accounting periods — list (org-admin only).
//
// GET /api/accounting-periods?fiscalYearId=…   list periods, scoped to
// the org. When fiscalYearId is omitted we return every period across
// every FY so the /financials/calendar page can render the full ribbon.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const fiscalYearId = new URL(req.url).searchParams.get("fiscalYearId");

  const where: Record<string, unknown> = { organizationId: orgId };
  if (fiscalYearId) where.fiscalYearId = fiscalYearId;

  const periods = await prisma.accountingPeriod.findMany({
    where,
    orderBy: { startDate: "asc" },
    include: {
      fiscalYear: { select: { id: true, label: true, startDate: true, endDate: true } },
      _count: { select: { journalEntries: true } },
    },
  });

  return jsonSuccess(periods);
}
