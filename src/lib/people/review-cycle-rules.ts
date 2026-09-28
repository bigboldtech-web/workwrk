// Who may run a review cycle (DECIDED: "a manager may run a review cycle for
// their chain"; access-model-spec 3.3 Review cycle: "Admin + People team
// FULL; the launching manager FULL for their chain").
//
//   - The People team and Owner / Admin manage every cycle in the org.
//   - A manager manages the cycles they started, and those cover their own
//     reporting chain only.
//   - A cycle with no recorded creator (every cycle made before Phase 6)
//     belongs to the People team and Admin only: the safe direction, since
//     nobody else can be proved to have started it.
//
// Pure: no imports. The server wrapper is review-cycle-access.ts.

export interface CycleManageInput {
  callerId: string;
  peopleTeamOrAdmin: boolean;
  createdById: string | null | undefined;
}

export function canManageCycle(i: CycleManageInput): boolean {
  if (i.peopleTeamOrAdmin) return true;
  return !!i.createdById && i.createdById === i.callerId;
}

/**
 * Who a launched cycle creates a review for. The People team and Admin
 * launch for the audience the cycle names (ALL, or its departments or
 * people); a manager's cycle is ALWAYS clipped to their chain, whatever the
 * row says, so a manager can never open a review for somebody else's
 * people.
 */
export function launchAudience(input: {
  peopleTeamOrAdmin: boolean;
  audienceType: string;
  departmentIds: string[];
  userIds: string[];
  chainIds: string[];
  people: { id: string; departmentId: string | null }[];
}): string[] {
  const { audienceType, departmentIds, userIds, chainIds, people } = input;
  let ids: string[];
  if (audienceType === "DEPARTMENTS") ids = people.filter((p) => p.departmentId && departmentIds.includes(p.departmentId)).map((p) => p.id);
  else if (audienceType === "USERS") ids = people.filter((p) => userIds.includes(p.id)).map((p) => p.id);
  else ids = people.map((p) => p.id);
  if (!input.peopleTeamOrAdmin) {
    const chain = new Set(chainIds);
    ids = ids.filter((id) => chain.has(id));
  }
  return ids;
}

/**
 * Who may delete a review cycle, and when. Deleting a cycle deletes every
 * review in it, so appraisal history is never destroyed: only a Draft with
 * no reviews can go (anything else is Cancel, which keeps every row). Who:
 * the People team and Admin, or the person who started it (a mistaken
 * draft must never sit in its starter's list forever), never an Agent.
 *   "who"   the caller may never delete this cycle (403)
 *   "state" the caller may, but not in this state (409, Cancel instead)
 */
export function cycleDeleteBlocked(i: CycleManageInput & { isAgent: boolean; status: string; reviewCount: number }): "who" | "state" | null {
  if (i.isAgent || !canManageCycle(i)) return "who";
  if (i.status !== "DRAFT" || i.reviewCount > 0) return "state";
  return null;
}
