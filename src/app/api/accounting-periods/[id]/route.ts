// Accounting period — close / reopen. Org-admin only.
//
// Closing a period freezes all entries inside it: no new posts, no
// edits to existing entries. Reopening is allowed (sometimes you
// close too early), but flips a flag on the activity log so audits
// can spot the unusual pattern.

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
import { logActivity } from "@/lib/activity";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const body = await req.json();
  const action = typeof body.action === "string" ? body.action : "";

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const period = await prisma.accountingPeriod.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!period) return jsonError("Period not found", 404);

  if (action === "close") {
    if (period.status === "CLOSED") return jsonError("Period already closed", 400);
    // Block close if any entries are still in DRAFT/PENDING — they
    // need to be posted, voided, or moved to a later period first.
    const stale = await prisma.journalEntry.count({
      where: { periodId: id, status: { in: ["DRAFT", "PENDING"] } },
    });
    if (stale > 0) {
      return jsonError(`Can't close — ${stale} entries are still in DRAFT/PENDING`, 400);
    }
    const updated = await prisma.accountingPeriod.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    logActivity({
      type: "period_closed",
      actorId: userId,
      organizationId: orgId,
      description: `Closed period ${period.label}`,
      targetType: "accounting-period",
      targetId: id,
      severity: "info",
    });
    return jsonSuccess(updated);
  }

  if (action === "reopen") {
    if (period.status === "OPEN") return jsonError("Period already open", 400);
    const updated = await prisma.accountingPeriod.update({
      where: { id },
      data: { status: "OPEN", closedAt: null },
    });
    logActivity({
      type: "period_reopened",
      actorId: userId,
      organizationId: orgId,
      description: `Reopened closed period ${period.label}`,
      targetType: "accounting-period",
      targetId: id,
      severity: "warning",
    });
    return jsonSuccess(updated);
  }

  return jsonError("Unknown action. Use close | reopen");
}
