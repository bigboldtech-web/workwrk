// The canvas read gate, stated once.
//
// A canvas in a Space is visible when the viewer can read that Space; a
// canvas in no Space is org-wide. This is the private checkSpaceVisible that
// GET, PATCH and DELETE /api/whiteboards/[id] ran, moved here verbatim so the
// Work canvas routes (src/lib/work/placement-server.ts) gate with the very
// same function and a canvas can never open at a Work address while its own
// API answers 404. The caller scopes the canvas row to the viewer's org.
//
// Server-only: getSpaceForReader reads the database.

import { getSpaceForReader } from "@/lib/space";

export async function whiteboardSpaceVisible(
  spaceId: string | null,
  userId: string,
  accessLevel: string | null | undefined,
): Promise<boolean> {
  if (!spaceId) return true;
  const space = await getSpaceForReader(spaceId, userId, accessLevel ?? "EMPLOYEE");
  return Boolean(space);
}
