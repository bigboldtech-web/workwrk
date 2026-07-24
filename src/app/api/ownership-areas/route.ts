import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

// OwnershipArea — one concept, one owner, one place. The area of responsibility
// and the single role accountable for it.
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const areas = await prisma.ownershipArea.findMany({
    where: { organizationId: getOrgId(session) },
    include: { ownerRole: { select: { id: true, title: true } } },
    orderBy: { name: "asc" },
  });
  return jsonSuccess(areas);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("Area name is required");

  const area = await prisma.ownershipArea.create({
    data: {
      name,
      description: body.description ?? null,
      ownerRoleId: body.ownerRoleId ?? null,
      organizationId: getOrgId(session),
    },
    include: { ownerRole: { select: { id: true, title: true } } },
  });
  return jsonSuccess(area, 201);
}
