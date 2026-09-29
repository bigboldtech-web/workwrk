// The Doc read gate, delegated to the one resolver.
//
// Docs anchor polymorphically (SPACE, FOLDER, BOARD, BOARD_ITEM, NOTEPAD) or
// hang under a parent page, or stand alone. Who can open one is decided by
// src/lib/access/node-access.ts (node-rules R6): an anchored doc follows its
// anchor, a sub-page follows its parent page (A6), a root doc is the whole
// org's, a listing in Organization.settings.docSharing pierces reach and
// restricted keeps only the listed people, a note is its owner's alone.
//
// 404-not-403: callers answer "not found" on false, never "forbidden".
//
// Server-only.

import { prisma } from "@/lib/prisma";
import {
  canCreateDocAt as canCreateDocAtNode,
  docRoleFor,
  nodeCtxFromLevel,
  type DocRoleInfo,
  type NodeCtx,
} from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";

export type { DocRoleInfo };

interface DocRef {
  /** Required: the doc's own id (a sub-page follows its parent, which only the id finds). */
  id: string;
  entityType: string | null;
  entityId: string | null;
  parentId?: string | null;
  createdById?: string | null;
  organizationId?: string;
}

/**
 * The viewer's access to one doc, or null when they cannot open it: the
 * role (the page lock applied), and whether they can comment, change who can
 * open it, and manage it (lock, Trash, template).
 */
export async function docAccess(ctx: NodeCtx, docId: string): Promise<DocRoleInfo | null> {
  const info = await docRoleFor(ctx, docId);
  return roleAtLeast(info.unlockedRole, "VIEW") ? info : null;
}

/** Can the viewer open this doc? The doc's own org is the world's, as before. */
export async function docAccessible(
  doc: DocRef,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<boolean> {
  const orgId =
    doc.organizationId ??
    (await prisma.doc.findUnique({ where: { id: doc.id }, select: { organizationId: true } }))?.organizationId;
  if (!orgId) return false;
  return (await docAccess(nodeCtxFromLevel(userId, orgId, accessLevel), doc.id)) !== null;
}

/**
 * May the viewer create a doc at this anchor (and under this parent page)?
 * The anchor must be one they reach, a note only under their own name, and a
 * parent page one they can read in the same org, never someone else's note.
 */
export async function canCreateDocAt(
  ctx: NodeCtx,
  anchor: { entityType: string | null; entityId: string | null } | null,
  parentId: string | null,
): Promise<boolean> {
  return canCreateDocAtNode(ctx, anchor, parentId);
}
