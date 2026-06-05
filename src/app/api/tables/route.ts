// GET  /api/tables   list tables in this org (with row counts)
// POST /api/tables   create a table { name, description?, columns? }

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { visibleSpaceIds } from "@/lib/space";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";

  const sp = new URL(req.url).searchParams;
  const spaceIdParam = sp.get("spaceId"); // "unscoped" → spaceId IS NULL; specific id → scoped; absent → all

  const where: Record<string, unknown> = { organizationId: orgId };
  if (spaceIdParam === "unscoped") where.spaceId = null;
  else if (spaceIdParam) where.spaceId = spaceIdParam;

  const tables = await prisma.dataTable.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { rows: true } } },
  });

  // Phase 32 — gate by Space visibility. Unscoped tables (spaceId=null)
  // stay org-wide; scoped ones return only if the viewer can read the
  // parent Space. Mirrors the Files/Whiteboards gate from Phase 22.
  const scopedIds = tables.map((t) => t.spaceId).filter((s): s is string => Boolean(s));
  const visible = scopedIds.length > 0
    ? await visibleSpaceIds(scopedIds, userId, accessLevel)
    : new Set<string>();
  const gated = tables.filter((t) => !t.spaceId || visible.has(t.spaceId));

  return jsonSuccess(gated.map((t) => ({ ...t, rowCount: t._count.rows })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  const description = typeof body.description === "string" ? body.description.slice(0, 2000) : null;
  const spaceId = typeof body.spaceId === "string" && body.spaceId ? body.spaceId : null;
  const columns = Array.isArray(body.columns) && body.columns.length > 0
    ? body.columns
    : [{ id: defaultId(), type: "short_text", label: "Name" }];

  if (!name) return jsonError("name required");

  // Cross-tenant safety: spaceId must belong to the caller's org.
  if (spaceId) {
    const space = await prisma.space.findFirst({ where: { id: spaceId, organizationId: orgId }, select: { id: true } });
    if (!space) return jsonError("space not found", 404);
  }

  const table = await prisma.dataTable.create({
    data: { organizationId: orgId, name, description, columns, spaceId, createdById: userId },
  });

  void logActivity({
    type: "table.create",
    actorId: userId,
    organizationId: orgId,
    description: `Created table "${table.name}"`,
    targetId: table.id,
    targetType: "DataTable",
  });

  return jsonSuccess(table, 201);
}

function defaultId() { return Math.random().toString(36).slice(2, 10); }
