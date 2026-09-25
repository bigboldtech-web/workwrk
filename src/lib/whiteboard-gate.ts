// The canvas read gates, stated once.
//
// whiteboardReadable is THE canvas gate since the one access model: the
// viewer's role on the canvas from node-access (R8: its Folder when that
// Folder is in its Space, else its Space, else the org; its owner with
// reach; a canvas grant that pierces). Every canvas route calls it.
//
// whiteboardSpaceVisible stays as it was, Space only: it is the source of the
// legacy floor's canvas reach and no longer a route gate. A canvas in a Space
// is visible when the viewer can read that Space; a canvas in no Space is
// org-wide. This is the private checkSpaceVisible that
// GET, PATCH and DELETE /api/whiteboards/[id] ran, moved here verbatim so the
// Work canvas routes (src/lib/work/placement-server.ts) gate with the very
// same function and a canvas can never open at a Work address while its own
// API answers 404. The caller scopes the canvas row to the viewer's org.
//
// Server-only: getSpaceForReader reads the database.

import { getSpaceForReader } from "@/lib/space";
import { nodeRole, type NodeCtx } from "@/lib/access/node-access";
import { roleAtLeast, type NodeRole } from "@/lib/access/node-rules";

export async function whiteboardSpaceVisible(
  spaceId: string | null,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<boolean> {
  if (!spaceId) return true;
  const space = await getSpaceForReader(spaceId, userId, accessLevel ?? "EMPLOYEE");
  return Boolean(space);
}

/**
 * The viewer's role on a canvas, or null when they cannot open it. The
 * caller scopes the canvas row to the viewer's org first.
 */
export async function whiteboardReadable(ctx: NodeCtx, canvas: { id: string }): Promise<Exclude<NodeRole, "none"> | null> {
  const d = await nodeRole(ctx, { kind: "canvas", id: canvas.id });
  return roleAtLeast(d.role, "VIEW") ? (d.role as Exclude<NodeRole, "none">) : null;
}
