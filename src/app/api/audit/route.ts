// Org-scoped audit trail. Manager+ to read; admin can export.
// Indexed on (organizationId, type, actorId, severity, createdAt)
// so the common filter combinations stay sub-second even at
// Fortune-500 row counts.
//
// Cursor pagination by id (DESC) — newest first; fetch `limit + 1`
// to detect "more" without a separate count query.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";

const VALID_SEVERITY = new Set(["info", "warning", "critical"]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type");
  const actorId = sp.get("actorId");
  const targetType = sp.get("targetType");
  const targetId = sp.get("targetId");
  const severity = sp.get("severity");
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const cursor = sp.get("cursor");
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 100)), 500);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (type) where.type = type;
  if (actorId) where.actorId = actorId;
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;
  if (severity) {
    if (!VALID_SEVERITY.has(severity)) return jsonError("Invalid severity");
    where.severity = severity;
  }
  if (startDate || endDate) {
    const created: Record<string, Date> = {};
    if (startDate) created.gte = new Date(startDate);
    if (endDate) created.lte = new Date(endDate);
    where.createdAt = created;
  }

  const items = await prisma.activityLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      type: true,
      description: true,
      targetType: true,
      targetId: true,
      severity: true,
      oldValue: true,
      newValue: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      actor: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  return jsonSuccess({
    items: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
}
