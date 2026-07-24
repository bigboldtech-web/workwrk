import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

// Scope — the generic shard dimension (territory/pool/region/shift/client…) a
// role instance owns. Rows are tenant configuration.
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const dimension = req.nextUrl.searchParams.get("dimension");
  const scopes = await prisma.scope.findMany({
    where: { organizationId: getOrgId(session), ...(dimension ? { dimension } : {}) },
    orderBy: [{ dimension: "asc" }, { name: "asc" }],
  });
  return jsonSuccess(scopes);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const dimension = typeof body.dimension === "string" ? body.dimension.trim() : "";
  if (!name) return jsonError("Scope name is required");
  if (!dimension) return jsonError("Scope dimension is required (e.g. pool, region, shift)");

  const scope = await prisma.scope.create({
    data: {
      name,
      dimension,
      description: body.description ?? null,
      parentId: body.parentId ?? null,
      organizationId: getOrgId(session),
    },
  });
  return jsonSuccess(scope, 201);
}
