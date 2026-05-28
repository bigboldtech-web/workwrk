// GET  /api/tables   list tables in this org (with row counts)
// POST /api/tables   create a table { name, description?, columns? }

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const tables = await prisma.dataTable.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { rows: true } } },
  });
  return jsonSuccess(tables.map((t: typeof tables[number]) => ({ ...t, rowCount: t._count.rows })));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  const description = typeof body.description === "string" ? body.description.slice(0, 2000) : null;
  const columns = Array.isArray(body.columns) && body.columns.length > 0
    ? body.columns
    : [{ id: defaultId(), type: "short_text", label: "Name" }];

  if (!name) return jsonError("name required");

  const table = await prisma.dataTable.create({
    data: { organizationId: orgId, name, description, columns, createdById: userId },
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
