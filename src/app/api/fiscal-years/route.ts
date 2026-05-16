// Fiscal years + accounting periods — list + create. Org-admin only.
//
// Creating a fiscal year auto-generates monthly accounting periods
// across the date range. Apr-Mar (India), Jul-Jun (Australia), and
// Jan-Dec (US default) are all supported via the start month.

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
import { logAuditEvent } from "@/lib/activity";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const years = await prisma.fiscalYear.findMany({
    where: { organizationId: orgId },
    orderBy: { startDate: "desc" },
    include: {
      periods: {
        select: { id: true, label: true, startDate: true, endDate: true, status: true },
        orderBy: { startDate: "asc" },
      },
    },
  });
  return jsonSuccess(years);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return jsonError("label required (e.g. 'FY2026')");
  if (label.length > 32) return jsonError("label too long");

  const startRaw = typeof body.startDate === "string" ? body.startDate : null;
  const endRaw = typeof body.endDate === "string" ? body.endDate : null;
  const startDate = startRaw ? new Date(startRaw) : null;
  const endDate = endRaw ? new Date(endRaw) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) return jsonError("startDate required");
  if (!endDate || Number.isNaN(endDate.getTime())) return jsonError("endDate required");
  if (endDate <= startDate) return jsonError("endDate must be after startDate");

  // Reasonable bounds — at least 30 days, at most 18 months.
  const ms = endDate.getTime() - startDate.getTime();
  if (ms < 30 * 24 * 3600 * 1000) return jsonError("fiscal year too short (< 30 days)");
  if (ms > 540 * 24 * 3600 * 1000) return jsonError("fiscal year too long (> 18 months)");

  const orgId = getOrgId(session);

  // Auto-generate monthly periods. Each period starts on the 1st
  // of its month (or the fiscal year start, for the first period)
  // and ends on the last day of the same month (or the fiscal
  // year end, for the last period). Using UTC to avoid DST drift.
  const periods: Array<{ label: string; startDate: Date; endDate: Date }> = [];
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  while (cursor <= endDate) {
    const periodStart = new Date(cursor);
    const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const periodEnd = new Date(Math.min(nextMonth.getTime() - 24 * 3600 * 1000, endDate.getTime()));
    const lbl = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}`;
    periods.push({ label: lbl, startDate: periodStart, endDate: periodEnd });
    cursor = nextMonth;
  }

  try {
    const year = await prisma.fiscalYear.create({
      data: {
        organizationId: orgId,
        label,
        startDate,
        endDate,
        periods: {
          create: periods.map((p) => ({
            organizationId: orgId,
            label: p.label,
            startDate: p.startDate,
            endDate: p.endDate,
          })),
        },
      },
      include: { periods: true },
    });

    // Fiscal years gate every financial statement + journal posting —
    // creating one is admin-rare and forensically important.
    logAuditEvent({
      type: "fiscal_year_created",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Created fiscal year "${label}" (${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}, ${periods.length} periods)`,
      targetId: year.id,
      targetType: "fiscal_year",
      metadata: { label, startDate: startDate.toISOString(), endDate: endDate.toISOString(), periodCount: periods.length },
    });

    return jsonSuccess(year, 201);
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return jsonError("A fiscal year with that label already exists", 409);
    }
    throw e;
  }
}
