// GET  /api/item-templates  — list the org's reusable task templates
// POST /api/item-templates  — save a new task template (modal config snapshot)

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const templates = await prisma.itemTemplate.findMany({
    where: { organizationId: getOrgId(session) },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
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
  const template = await prisma.itemTemplate.create({
    data: {
      organizationId: getOrgId(session),
      createdById: getUserId(session),
      name: parsed.data.name.trim(),
      config: parsed.data.config as object,
    },
  });
  return jsonSuccess({ template }, 201);
}
