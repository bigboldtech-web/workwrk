import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isOrgAdmin, jsonError, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";

/**
 * SOP folders — the access-scoping unit for SOPs.
 *
 * GET  → list folders. Admins see all; everyone else sees only the
 *        folders they've been granted access to.
 * POST → create a folder. Org admins only.
 *
 * Per-folder access management lives at /api/sop-folders/[id]/access.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const where: any = { organizationId: orgId };
  if (!isOrgAdmin(session)) {
    where.access = { some: { userId: (session.user as any).id } };
  }

  const folders = await prisma.sOPFolder.findMany({
    where,
    select: {
      id: true, name: true, color: true, description: true,
      createdAt: true, updatedAt: true,
      _count: { select: { sops: true, access: true } },
    },
    orderBy: { name: "asc" },
  });

  return jsonSuccess(folders, 200, LOOKUP_CACHE_HEADERS);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Only org admins can create folders", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("Folder name is required");
  if (name.length > 60) return jsonError("Folder name too long (max 60 chars)");

  const color = typeof body?.color === "string" && body.color.startsWith("#") ? body.color : null;
  const description = typeof body?.description === "string" ? body.description.slice(0, 500) : null;

  try {
    const folder = await prisma.sOPFolder.create({
      data: { name, color, description, organizationId: orgId },
    });
    return jsonSuccess(folder, 201);
  } catch (err: any) {
    if (err.code === "P2002") return jsonError("A folder with that name already exists");
    return jsonError(err.message || "Failed to create folder", 500);
  }
}
