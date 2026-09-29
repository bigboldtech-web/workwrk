// DELETE /api/kudos/[id] (spec-teams-performance /kudos Data): the giver or
// an Admin may delete a kudos at any time; an Agent never may, even one it
// gave (cap.agent.delete); a Guest never reaches it. Every delete is
// audited (ActivityLog kudos_deleted, with the message kept in the log's
// description so an Admin can see what was removed). The toast's five second
// Undo on the page is a convenience over this same route plus a re-POST.
// The reactions go with the kudos (cascade).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { viewerFromSession } from "@/lib/access/viewer";
import { logActivity } from "@/lib/activity";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const viewer = await viewerFromSession();
  if (!viewer || viewer.orgRole === "GUEST") return jsonError("Not found", 404);

  const kudos = await prisma.kudos.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, giverId: true, receiverId: true, message: true, companyValue: true, receiver: { select: { firstName: true, lastName: true } } },
  });
  if (!kudos) return jsonError("Not found", 404);
  const isAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  if (viewer.isAgent) return jsonError("An agent can't delete kudos", 403);
  if (kudos.giverId !== userId && !isAdmin) return jsonError("Only the person who gave it, or an Admin, can delete this kudos", 403);

  await prisma.kudos.delete({ where: { id: kudos.id } });
  logActivity({
    type: "kudos_deleted",
    actorId: userId,
    organizationId: orgId,
    description: `Deleted kudos to ${kudos.receiver.firstName} ${kudos.receiver.lastName}${kudos.companyValue ? ` (${kudos.companyValue})` : ""}: "${kudos.message.slice(0, 200)}"`,
    targetId: kudos.receiverId,
    targetType: "user",
  });
  return jsonSuccess({ deleted: true, kudos: { receiverId: kudos.receiverId, message: kudos.message, companyValue: kudos.companyValue } });
}
