// Who may edit and who may delete a goal: the one rule every goal write
// (PATCH /api/okrs, DELETE /api/okrs/[id], targets, check-ins, contributors,
// linked work, Part of) and every Edit or Delete control reads.
//
// spec-goals section 1 Access, decided by the smallest worst case:
//
//   Company goal     Owner/Admin, the People team, and the goal's own owner.
//                    Nobody else, not a manager, not the person who typed it
//                    in: the whole org reads a Company goal, so one manager
//                    must never be able to rewrite or wipe it.
//   Team/Individual  its owner, its creator, Owner/Admin, the People team,
//                    and a manager whose reporting chain holds the owner.
//   Unowned (not     its creator, Owner/Admin and the People team. A manager
//   Company)         with no tie to it gets nothing (it used to be every
//                    manager in the org).
//
// Delete is the same rule with two narrowings from the access spec
// (okrs.delete = owner or Owner/Admin; Agents never delete a goal): the
// People team's org-wide reach is Can edit, not delete, and an Agent never
// deletes. A People team member still deletes what they own, created or
// manage like anyone else.
//
// Pure and dependency free: the server gates and the vitest table read it.

export interface GoalRightsActor {
  callerId: string;
  /** Owner or Admin (SUPER_ADMIN, COMPANY_ADMIN). */
  admin: boolean;
  /** The People team: HR level, or on the configured list (access.peopleTeamUserIds). */
  peopleTeam: boolean;
  /** The manager tier of the access ladder: the only tier the chain grants to. */
  manager: boolean;
  /** An Agent account. */
  agent: boolean;
  /** The caller's reporting chain (getTeamUserIds), or null when not loaded.
   *  Loaded for every manager-tier caller but Owner/Admin, People team included,
   *  because delete reads it even where edit is already settled. */
  chain: ReadonlySet<string> | null;
}

export interface GoalRightsTarget {
  level: string;
  ownerId: string | null;
  /** Who created the goal (the okr_created activity row), null when unknown. */
  creatorId: string | null;
}

export function mayEditGoal(actor: GoalRightsActor, goal: GoalRightsTarget): boolean {
  if (actor.admin || actor.peopleTeam) return true;
  if (goal.ownerId && goal.ownerId === actor.callerId) return true;
  if (goal.level === "COMPANY") return false;
  if (goal.creatorId && goal.creatorId === actor.callerId) return true;
  if (!goal.ownerId || !actor.manager) return false;
  return actor.chain?.has(goal.ownerId) ?? false;
}

export function mayDeleteGoal(actor: GoalRightsActor, goal: GoalRightsTarget): boolean {
  if (actor.agent) return false;
  if (actor.admin) return true;
  return mayEditGoal({ ...actor, peopleTeam: false }, goal);
}

/** The one refusal copy: it names the right, never the goal or its owner. */
export const GOAL_EDIT_REFUSED = "You need Can edit on this goal for that. Ask its owner.";
export const GOAL_DELETE_REFUSED = "You can't delete this goal. Ask its owner or an Admin.";
