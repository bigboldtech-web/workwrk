// What each List of a page lets this viewer do with a task in it, for the
// surfaces that list a person's own tasks (My work, Home, the planner): being
// assigned a task lets them change it on every List (rule 9), except where Can
// comment is the whole of their access there (founder decision 3, item-role.ts
// taskSideOfListRole; with Can view from anywhere else the resolver answers
// Can edit assigned tasks instead, node-rules listCommentUnion). And adding to
// a List (Duplicate, Move, Add to another List) needs Can edit on it.
//
// One node-access world for all the Lists of a page, the same resolver the
// task gate asks.

import { nodeCtxFromLevel, nodeRoleMap } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { taskSideOfListRole } from "@/lib/item-role";
import { isOrgAdminAccessLevel } from "@/lib/space";

export interface ListSides {
  /** Lists where neither being assigned nor having made a task lets them change it. */
  withheld: Set<string>;
  /** Lists they may add to and arrange: Can edit or more (an org admin: every one). */
  addable: Set<string>;
}

export async function listSidesFor(
  viewer: { userId: string; organizationId: string; accessLevel: string | null | undefined },
  boardIds: Iterable<string | null | undefined>,
): Promise<ListSides> {
  const ids = [...new Set([...boardIds].filter((id): id is string => !!id))];
  // An org Owner or Admin holds Full access on every task (rule 4).
  if (isOrgAdminAccessLevel(viewer.accessLevel)) return { withheld: new Set(), addable: new Set(ids) };
  if (ids.length === 0) return { withheld: new Set(), addable: new Set() };
  const roles = await nodeRoleMap(nodeCtxFromLevel(viewer.userId, viewer.organizationId, viewer.accessLevel), "list", ids);
  const out: ListSides = { withheld: new Set(), addable: new Set() };
  for (const [id, role] of roles) {
    if (!taskSideOfListRole(role).assigneeLift) out.withheld.add(id);
    if (roleAtLeast(role, "EDIT")) out.addable.add(id);
  }
  return out;
}

/** The Lists where being assigned does not let this viewer change a task. */
export async function liftWithheldListIds(
  viewer: { userId: string; organizationId: string; accessLevel: string | null | undefined },
  boardIds: Iterable<string | null | undefined>,
): Promise<Set<string>> {
  return (await listSidesFor(viewer, boardIds)).withheld;
}
