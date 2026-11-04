// Is the viewer a Contributor on a goal (spec-goals access: "Contributors
// = Can edit, which means check in and comment, never rename, delete, share
// or transfer")? A contributor is anyone a GoalAssignee row resolves to:
// their user row, their department, their job title or one of their tags,
// resolved at read time (memberVisibilityOr) at their seat here, so a new hire in a covered
// department contributes from day one and a leaver stops the day they go.
//
// Used by the two check-in writes (POST /api/okrs/[id]/check-in and the
// goal page's Check in buttons). Server only.

import { prisma } from "@/lib/prisma";
import { getOrgId, getUserId } from "@/lib/api-helpers";
import { memberVisibilityOr } from "@/lib/goal-audience";
import { placementHereOf } from "@/lib/access/profile-here";
import { getUserTagIds } from "@/lib/user-tags";

export async function isGoalContributor(session: unknown, okrId: string): Promise<boolean> {
  const orgId = getOrgId(session as never);
  const userId = getUserId(session as never);
  // Their seat here, not removed, with the department and job title it holds
  // (docs/plans/workspace-status-2.md E15, step 8): the account's where they
  // are anchored here, their membership's otherwise. Before, someone here
  // through a membership was never a contributor, not even by name.
  const me = await placementHereOf(orgId, userId, "kept");
  if (!me) return false;
  const tagIds = await getUserTagIds(orgId, userId);
  const n = await prisma.oKR.count({
    where: { id: okrId, organizationId: orgId, OR: memberVisibilityOr({ id: userId, departmentId: me.departmentId, roleId: me.roleId, tagIds }) },
  });
  return n > 0;
}
