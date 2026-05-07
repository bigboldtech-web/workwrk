// Dimensional tags — list + create. Org-scoped, type-filterable.
// At Fortune-500 scale a tenant could carry thousands of tags
// (cost centers across global business units), so we cap and
// support a `type` filter so callers don't have to pull the world
// just to render a picker for one dimension.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

const MAX_LIMIT = 500;

const VALID_TYPES = new Set([
  "COST_CENTER",
  "BUSINESS_UNIT",
  "LOCATION",
  "REGION",
  "PROJECT",
  "FUNCTION",
  "CUSTOM",
]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type");
  const includeArchived = sp.get("includeArchived") === "1";
  const search = sp.get("q")?.trim() ?? "";

  const where: Record<string, unknown> = { organizationId: orgId };
  if (type) {
    if (!VALID_TYPES.has(type)) return jsonError("Invalid type");
    where.type = type;
  }
  if (!includeArchived) where.archived = false;
  if (search) {
    where.name = { contains: search, mode: "insensitive" };
  }

  const tags = await prisma.tag.findMany({
    where,
    orderBy: [{ type: "asc" }, { name: "asc" }],
    take: MAX_LIMIT,
    select: {
      id: true,
      name: true,
      type: true,
      color: true,
      description: true,
      archived: true,
      _count: { select: { assignments: true } },
    },
  });

  return jsonSuccess(tags);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const type = typeof body.type === "string" ? body.type : "CUSTOM";
  const color = typeof body.color === "string" ? body.color.trim() || null : null;
  const description = typeof body.description === "string" ? body.description.trim() || null : null;

  if (!rawName) return jsonError("name is required");
  if (rawName.length > 80) return jsonError("name must be 80 chars or fewer");
  if (!VALID_TYPES.has(type)) return jsonError("Invalid type");

  const orgId = getOrgId(session);
  // Unique on (org, type, name) — surface the violation cleanly.
  const existing = await prisma.tag.findUnique({
    where: { organizationId_type_name: { organizationId: orgId, type: type as never, name: rawName } },
    select: { id: true, archived: true },
  });
  if (existing) {
    if (existing.archived) {
      // Reuse the archived row instead of creating a duplicate; admins
      // un-archiving an old tag should pick up history.
      const reactivated = await prisma.tag.update({
        where: { id: existing.id },
        data: { archived: false, color, description },
      });
      return jsonSuccess(reactivated, 200);
    }
    return jsonError("A tag of this type with that name already exists", 409);
  }

  const created = await prisma.tag.create({
    data: {
      name: rawName,
      type: type as never,
      color,
      description,
      organizationId: orgId,
    },
  });
  // userId on created tag is not stored on Tag, but we keep the actor
  // in activity logs upstream. No-op here.
  void getUserId(session);
  return jsonSuccess(created, 201);
}
