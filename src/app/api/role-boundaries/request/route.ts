import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { peoplePlacedHere, placementHereOf, placementsHere } from "@/lib/access/profile-here";

// POST /api/role-boundaries/request — raise a boundary request to an area's
// OWNER. This is the whole point of the ownership boundary: a role that
// CAN_REQUEST never edits the concept directly — it asks the owner, and the
// owner's current holders get a real notification in their Inbox.
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const body = await req.json().catch(() => ({}));
  const areaId = typeof body.areaId === "string" ? body.areaId : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (!areaId) return jsonError("areaId required");
  if (!note) return jsonError("Describe what you need from the owner");

  const area = await prisma.ownershipArea.findFirst({
    where: { id: areaId, organizationId: orgId },
    include: { ownerRole: { select: { id: true, title: true } } },
  });
  if (!area) return jsonError("Area not found", 404);
  if (!area.ownerRole) return jsonError("This area has no owner role yet — set an owner first");

  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  const requesterName = [requester?.firstName, requester?.lastName].filter(Boolean).join(" ") || requester?.email || "Someone";
  // Their job title here: the one their seat here holds, this workspace's own
  // only (D18; docs/plans/workspace-status-2.md E15, step 8).
  const placed = await placementHereOf(orgId, userId);
  const ownRole = placed?.roleId ? (await placementsHere(orgId, [placed])).role.get(placed.roleId) : null;
  const requesterRole = ownRole?.title ? ` (${ownRole.title})` : "";

  // The request lands with everyone CURRENTLY holding the owner role,
  // resolved now, so a role handover automatically reroutes future requests:
  // ACTIVE at their seat here, the people anchored here by their account's
  // job title and the people here through a membership by the one their
  // membership holds (E15, step 8; before, the people anchored here only).
  const holders = await peoplePlacedHere(orgId, { roleIds: [area.ownerRole.id] }, "active");

  if (holders.length > 0) {
    await prisma.notification.createMany({
      data: holders.map((h) => ({
        userId: h.id,
        type: "boundary_request",
        title: `Request: ${area.name}`,
        message: `${requesterName}${requesterRole} asks: ${note}`,
        link: `/people/roles/${area.ownerRole!.id}`,
      })),
    });
  }

  await logActivity({
    type: "boundary_request",
    actorId: userId,
    organizationId: orgId,
    description: `Raised a boundary request for "${area.name}" to ${area.ownerRole.title}`,
    targetType: "OwnershipArea",
    targetId: area.id,
    metadata: { note, ownerRoleId: area.ownerRole.id, notified: holders.length },
  });

  return jsonSuccess({ notified: holders.length, ownerTitle: area.ownerRole.title });
}
