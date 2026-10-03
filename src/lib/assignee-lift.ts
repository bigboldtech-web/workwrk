// Which Lists withhold rule 9's lift from this viewer: being assigned a task
// lets them change it on every List, except where Can comment is the whole of
// their access there (founder decision 3, item-role.ts taskSideOfListRole;
// with Can view from anywhere else the resolver answers Can edit assigned
// tasks instead, node-rules listCommentUnion).
//
// For the surfaces that list a person's OWN tasks (My work, the planner's
// unscheduled panel): every row there is assigned to the viewer, so a row is
// theirs to change unless its List is in this set. One node-access world for
// all the Lists of a page, the same resolver the task gate asks.

import { nodeCtxFromLevel, nodeRoleMap } from "@/lib/access/node-access";
import { taskSideOfListRole } from "@/lib/item-role";
import { isOrgAdminAccessLevel } from "@/lib/space";

export async function liftWithheldListIds(
  viewer: { userId: string; organizationId: string; accessLevel: string | null | undefined },
  boardIds: Iterable<string | null | undefined>,
): Promise<Set<string>> {
  const ids = [...new Set([...boardIds].filter((id): id is string => !!id))];
  // An org Owner or Admin holds Full access on every task (rule 4).
  if (ids.length === 0 || isOrgAdminAccessLevel(viewer.accessLevel)) return new Set();
  const roles = await nodeRoleMap(nodeCtxFromLevel(viewer.userId, viewer.organizationId, viewer.accessLevel), "list", ids);
  const out = new Set<string>();
  for (const [id, role] of roles) if (!taskSideOfListRole(role).assigneeLift) out.add(id);
  return out;
}
