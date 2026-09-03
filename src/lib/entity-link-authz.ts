// Object-level authz for MUTATING an entity-link, keyed on the link's
// SOURCE entity.
//
// The entity-link graph is a general "reference anything to anything"
// primitive, and most sources (a task referencing a doc, a note embedding a
// whiteboard) are open to any org member who can see them. But some sources
// are GOVERNANCE objects whose edit rights are narrower than their read
// rights — a goal (OKR) can be seen org-wide yet only edited by its owner or
// their management line. The OkrLinkedWork UI already hides its attach/detach
// buttons behind that same edit check (`canEditGoal`); this makes the API
// enforce it too, so a member who can merely VIEW a goal can't re-wire the
// Spaces/Boards linked under it by calling the endpoint directly.
//
// Returns true (allowed) for every source type that carries no such gate, so
// existing open linking flows are unaffected.

import { prisma } from "@/lib/prisma";
import { canEditOkrOwner } from "@/lib/alignment-scope";

/** A session shape sufficient for the alignment-scope helpers. */
type SessionLike = { user?: { id?: string; organizationId?: string; accessLevel?: string } };

export async function canMutateLinkFromSource(
  session: SessionLike,
  orgId: string,
  source: { type: string; id: string },
): Promise<boolean> {
  if (source.type === "OKR") {
    const okr = await prisma.oKR.findFirst({
      where: { id: source.id, organizationId: orgId },
      select: { ownerId: true },
    });
    if (!okr) return false; // unknown / cross-org source: refuse the write
    return canEditOkrOwner(session, okr.ownerId);
  }
  if (source.type === "KEY_RESULT") {
    const kr = await prisma.keyResult.findFirst({
      where: { id: source.id, okr: { organizationId: orgId } },
      select: { okr: { select: { ownerId: true } } },
    });
    if (!kr) return false;
    return canEditOkrOwner(session, kr.okr.ownerId);
  }
  return true;
}
