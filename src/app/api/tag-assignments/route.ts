// Tag assignments — list (per entity) + assign + unassign. Polymorphic
// entity targeting via (entityType, entityId). For the picker UX you
// usually want both: which tags exist (GET /api/tags?type=...) AND
// which are currently applied to this entity (this endpoint with
// entityType/entityId).
//
// Authorization: assigning a tag to an entity requires the caller to
// have permission on that entity type. For v1 we delegate to a coarse
// rule — manager-or-above can tag anything in their org. Once the
// permission matrix grows tag-specific actions we'll route through
// `requirePermission`.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";

const VALID_ENTITY_TYPES = new Set([
  "USER",
  "TASK",
  "KRA",
  "KPI",
  "OKR",
  "SOP",
  "REVIEW",
  "REVIEW_CYCLE",
  "ASSET",
  "EXPENSE",
  "MEETING",
]);

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const entityType = sp.get("entityType");
  const entityId = sp.get("entityId");

  if (!entityType || !entityId) return jsonError("entityType and entityId are required");
  if (!VALID_ENTITY_TYPES.has(entityType)) return jsonError("Invalid entityType");

  const assignments = await prisma.tagAssignment.findMany({
    where: { organizationId: orgId, entityType: entityType as never, entityId },
    include: {
      tag: {
        select: { id: true, name: true, type: true, color: true, archived: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return jsonSuccess(assignments);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { tagId, entityType, entityId } = body as {
    tagId?: string;
    entityType?: string;
    entityId?: string;
  };

  if (!tagId || !entityType || !entityId) {
    return jsonError("tagId, entityType, entityId are required");
  }
  if (!VALID_ENTITY_TYPES.has(entityType)) return jsonError("Invalid entityType");

  const orgId = getOrgId(session);

  // Sanity-check the tag belongs to the caller's org and isn't archived.
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, organizationId: orgId },
    select: { id: true, archived: true },
  });
  if (!tag) return jsonError("Tag not found", 404);
  if (tag.archived) return jsonError("Tag is archived", 409);

  // Unique constraint will dedupe; we explicitly upsert so the response
  // shape is consistent whether the assignment is new or pre-existing.
  const assignment = await prisma.tagAssignment.upsert({
    where: {
      tagId_entityType_entityId: {
        tagId,
        entityType: entityType as never,
        entityId,
      },
    },
    update: {},
    create: {
      tagId,
      entityType: entityType as never,
      entityId,
      organizationId: orgId,
      assignedById: getUserId(session),
    },
  });
  return jsonSuccess(assignment, 201);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  const tagId = sp.get("tagId");
  const entityType = sp.get("entityType");
  const entityId = sp.get("entityId");

  // Two callable shapes: `?id=…` for direct removal by assignment id,
  // or the (tagId,entityType,entityId) tuple when the caller doesn't
  // know the assignment id (typical from a tag picker that's just
  // toggling tags on an entity).
  const orgId = getOrgId(session);

  if (id) {
    const assignment = await prisma.tagAssignment.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!assignment) return jsonError("Assignment not found", 404);
    await prisma.tagAssignment.delete({ where: { id } });
    return jsonSuccess({ deleted: true });
  }

  if (tagId && entityType && entityId) {
    if (!VALID_ENTITY_TYPES.has(entityType)) return jsonError("Invalid entityType");
    const result = await prisma.tagAssignment.deleteMany({
      where: {
        organizationId: orgId,
        tagId,
        entityType: entityType as never,
        entityId,
      },
    });
    return jsonSuccess({ deleted: result.count });
  }

  return jsonError("Provide ?id= or (?tagId=&entityType=&entityId=)");
}
