// GET  /api/item-templates  — list the org's reusable task templates
// POST /api/item-templates  — save a new task template (modal config snapshot)
//
// Backed by the unified Template store (kind=TASK). The legacy `config`
// field maps to/from Template.payload so the create-task modal keeps
// working unchanged.

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const rows = await prisma.template.findMany({
    where: { organizationId: getOrgId(session), kind: "TASK" },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, name: true, payload: true },
  });
  const templates = rows.map((r) => ({ id: r.id, name: r.name, config: r.payload }));
  return jsonSuccess({ templates });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid body", 400);
  const row = await prisma.template.create({
    data: {
      organizationId: getOrgId(session),
      createdById: getUserId(session),
      kind: "TASK",
      name: parsed.data.name.trim(),
      payload: parsed.data.config as object,
    },
    select: { id: true, name: true, payload: true },
  });
  return jsonSuccess({ template: { id: row.id, name: row.name, config: row.payload } }, 201);
}
