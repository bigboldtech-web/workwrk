import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { allOwned, idOrNull } from "@/lib/access/company-wall";

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
  // The company wall (pen test 2026-11-28, V-04): an area pinned to another
  // company's job title showed on its role page.
  const ownerRoleId = idOrNull(body.ownerRoleId ?? null);
  if (ownerRoleId === "invalid") return jsonError("Invalid job title");
  if (!(await allOwned("role", [ownerRoleId], getOrgId(session)))) return jsonError("Job title not found", 404);

  const area = await prisma.ownershipArea.create({
    data: {
      name,
      description: body.description ?? null,
      ownerRoleId,
      organizationId: getOrgId(session),
    },
    include: { ownerRole: { select: { id: true, title: true } } },
  });
  return jsonSuccess(area, 201);
}
