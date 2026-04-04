import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);

  const templates = await prisma.meetingTemplate.findMany({
    where: { OR: [{ organizationId: orgId }, { organizationId: null }] },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return jsonSuccess(templates);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { name, description, type, agendaItems } = body;

  if (!name?.trim()) return jsonError("Name required");

  const template = await prisma.meetingTemplate.create({
    data: {
      name: name.trim(),
      description: description || null,
      type: type || "ONE_ON_ONE",
      agendaItems: agendaItems || [],
      organizationId: orgId,
    },
  });

  return jsonSuccess(template, 201);
}
