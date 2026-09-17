// accessibleUsers() and explain() — the two "who and why" reads.
//
// accessibleUsers(viewer, ref) answers "who can see this object, and through
// what", which is what the share dialog's avatar stack and invariant 3's Guest
// directory rule both need: a Guest's person_card VIEW is true only for users
// in accessibleUsers() of an object the Guest holds.
//
// It takes a Viewer, and every query it makes is scoped to that viewer's
// organization. The spec sketches the signature as `accessibleUsers(ref)`
// (section 5.1), but a bare findUnique on a client-supplied id returns the
// member list of ANY tenant's Space, and this function is named in invariant 3
// as the enforcement point for the Guest directory: every future caller would
// inherit a cross-tenant directory leak. rule 1 cannot save it, because rule 1
// lives in decide() and this function never calls decide(). So the viewer is a
// parameter, and a ref outside the viewer's org comes back empty.
//
// explain(viewer, ref) returns EVERY source, not just the maximum, for the
// Check-access panel and for the parity report.
//
// Server-only: imports prisma.

import { prisma } from "../prisma";
import { loadFacts } from "./facts";
import { decide, explainSources } from "./resolve";
import type { Decision, DecisionVia, ObjectRef, ObjectRole, Viewer } from "./types";

export interface AccessibleUser {
  userId: string;
  role: ObjectRole;
  via: DecisionVia;
}

/**
 * Everyone with a role on this object, from today's member tables plus the
 * object's owner. Group and EVERYONE grants are not expanded into user rows:
 * they resolve at read time (principle 4) and the dialog shows them as one row.
 *
 * Cross-org and unknown ids answer `[]`, with no way to tell the two apart,
 * which is the same shape rule 1 gives every other read.
 */
export async function accessibleUsers(viewer: Viewer, ref: ObjectRef): Promise<AccessibleUser[]> {
  const out = new Map<string, AccessibleUser>();
  const put = (userId: string | null, role: ObjectRole, via: DecisionVia) => {
    if (!userId) return;
    const existing = out.get(userId);
    if (!existing || rank(role) > rank(existing.role)) out.set(userId, { userId, role, via });
  };

  const orgId = viewer.organizationId;
  if (!orgId) return [];

  if (ref.type === "space") {
    // findFirst with the org in the where clause, never findUnique on the id
    // alone: that is what makes the tenant boundary part of the query rather
    // than something a caller is trusted to check afterwards.
    const space = await prisma.space.findFirst({
      where: { id: ref.id, organizationId: orgId },
      select: { ownerId: true, members: { select: { userId: true, role: true } } },
    });
    if (!space) return [];
    put(space.ownerId, "FULL", "owner");
    for (const m of space.members) put(m.userId, fromSpaceRole(m.role), "shared");
  } else if (ref.type === "folder") {
    const folder = await prisma.folder.findFirst({
      where: { id: ref.id, organizationId: orgId },
      select: { ownerId: true, members: { select: { userId: true, role: true } } },
    });
    if (!folder) return [];
    put(folder.ownerId, "FULL", "owner");
    for (const m of folder.members) put(m.userId, fromSpaceRole(m.role), "shared");
  } else if (ref.type === "list") {
    const board = await prisma.board.findFirst({
      where: { id: ref.id, organizationId: orgId },
      select: { ownerId: true, members: { select: { userId: true, role: true } } },
    });
    if (!board) return [];
    put(board.ownerId, "FULL", "owner");
    for (const m of board.members) put(m.userId, fromSpaceRole(m.role), "shared");
  } else if (ref.type === "channel") {
    const convo = await prisma.conversation.findFirst({
      where: { id: ref.id, organizationId: orgId },
      select: { createdById: true, members: { select: { userId: true } } },
    });
    if (!convo) return [];
    put(convo.createdById, "FULL", "owner");
    for (const m of convo.members) put(m.userId, "EDIT", "assigned");
  } else if (ref.type === "sop_folder") {
    const rows = await prisma.sOPFolderAccess.findMany({
      where: { folderId: ref.id, folder: { organizationId: orgId } },
      select: { userId: true, role: true },
    });
    for (const r of rows) {
      put(r.userId, r.role === "OWNER" ? "FULL" : r.role === "EDITOR" ? "EDIT" : "VIEW", "shared");
    }
  }

  return [...out.values()];
}

function fromSpaceRole(role: string): ObjectRole {
  if (role === "OWNER" || role === "ADMIN") return "FULL";
  if (role === "MEMBER") return "EDIT";
  return "VIEW";
}

const RANKS: Record<ObjectRole, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };
function rank(role: ObjectRole): number {
  return RANKS[role];
}

/**
 * Every source that gives this viewer a role on this object.
 *
 * The top decision governs. explainSources() answers [] whenever rule 1, 2 or
 * 3 short-circuited, and this function then returns that one decision rather
 * than a source list: without that, a cross-org id came back as
 * `{ allowed: true, role: "FULL", via: "org-admin" }` for any Admin, and any
 * other tenant's org-visible Space came back as `{ role: "EDIT", via:
 * "everyone" }` for a plain Member, because loadFacts synthesises the EVERYONE
 * grant before any org comparison is made.
 */
export async function explain(viewer: Viewer, ref: ObjectRef): Promise<Decision[]> {
  const facts = await loadFacts(viewer, ref);
  const top = decide(facts, "view");
  const sources = explainSources(facts);
  if (sources.length === 0) return [top];
  return sources.map((source) => ({
    allowed: true,
    role: source.role,
    via: source.via,
    reason: source.reason,
    discoverable: true,
    enforcedAt: top.enforcedAt,
  }));
}
