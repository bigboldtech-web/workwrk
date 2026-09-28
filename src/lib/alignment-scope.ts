// Three-door scoping for alignment data (KRAs, KPIs, KPI records, OKRs,
// reviews). Every alignment API enforces the same ladder SERVER-SIDE,
// hiding a nav link is never the permission:
//
//   Door 1  EMPLOYEE / AGENT      → self only
//   Door 2  manager tiers         → self + recursive report tree
//   Door 3  admin / exec / HR     → org-wide
//
// The sets mirror the scope ladder GET /api/kras has always used, so
// tightening other endpoints onto these helpers never WIDENS a gate.

import { getOrgId, getUserId, isManager } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";
import { prisma } from "@/lib/prisma";
import { isAgentOf, isSeededPeopleTeam } from "@/lib/access/org-role";
import { parseAccessSettings } from "@/lib/access/settings";
import {
  mayDeleteGoal,
  mayEditGoal,
  type GoalRightsActor,
  type GoalRightsTarget,
} from "@/lib/goals/goal-rights";

/** Door 3, may read/write alignment data across the whole org. */
export const ORG_WIDE_ALIGNMENT_LEVELS = new Set([
  "COMPANY_ADMIN",
  "SUPER_ADMIN",
  "C_LEVEL",
  "VP",
  "DIRECTOR",
  "HR",
]);

/** Org administration proper (destructive / cross-tree actions). */
export const ORG_ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

/** HR-admin tier for review data (matches the reviews app catalog gate). */
export const HR_ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]);

export function sessionAccessLevel(session: unknown): string {
  return (
    (session as { user?: { accessLevel?: string } } | null)?.user?.accessLevel ?? ""
  );
}

export function isOrgWideAlignment(session: unknown): boolean {
  return ORG_WIDE_ALIGNMENT_LEVELS.has(sessionAccessLevel(session));
}

export function isOrgAdminLevel(session: unknown): boolean {
  return ORG_ADMIN_LEVELS.has(sessionAccessLevel(session));
}

export function isHrAdminLevel(session: unknown): boolean {
  return HR_ADMIN_LEVELS.has(sessionAccessLevel(session));
}

/**
 * May the caller read/write `targetUserId`'s alignment data?
 * Self always; org-wide levels always; manager tiers when the target is
 * inside their recursive report tree. Everyone else: no.
 */
export async function canTouchUserAlignment(
  session: unknown,
  targetUserId: string,
): Promise<boolean> {
  const callerId = getUserId(session);
  if (targetUserId === callerId) return true;
  if (isOrgWideAlignment(session)) return true;
  if (!isManager(session)) return false;
  const teamIds = await getTeamUserIds(getOrgId(session), callerId);
  return teamIds.includes(targetUserId);
}

/** A goal as the edit and delete rules read it (src/lib/goals/goal-rights.ts). */
export interface GoalRef {
  id: string;
  level: string;
  ownerId: string | null;
}

/**
 * Is the caller on the People team, as the access engine counts it
 * (src/lib/access/resolve.ts isPeopleTeam, and /api/boot the same way): an
 * HR-level user (viewer.ts hydrate always counts them, spec 10 step 0), OR
 * anyone on the configured list (access.peopleTeamUserIds). The org row is
 * only read when the level has not already settled it.
 */
async function isGoalPeopleTeam(session: unknown, level: string, admin: boolean): Promise<boolean> {
  if (isSeededPeopleTeam(level)) return true;
  if (admin) return false; // Owner/Admin already has every right the People team does.
  const org = await prisma.organization.findUnique({
    where: { id: getOrgId(session) },
    select: { settings: true },
  });
  const settings = (org?.settings ?? {}) as { access?: unknown };
  return parseAccessSettings(settings.access).peopleTeamUserIds.includes(getUserId(session));
}

/**
 * The caller as the goal rules see them. The reporting chain is walked for
 * every manager-tier caller who is not Owner/Admin, People team included: the
 * People team's org-wide reach is Can edit, not delete, so a People team
 * manager deletes their own reports' goals through the chain like any other
 * manager (mayDeleteGoal).
 */
export async function goalRightsActor(session: unknown, chainIds?: readonly string[]): Promise<GoalRightsActor> {
  const callerId = getUserId(session);
  const level = sessionAccessLevel(session);
  const admin = isOrgAdminLevel(session);
  const manager = isManager(session);
  const [peopleTeam, chain] = await Promise.all([
    isGoalPeopleTeam(session, level, admin),
    !manager || admin
      ? Promise.resolve(null)
      : chainIds
        ? Promise.resolve(new Set(chainIds))
        : getTeamUserIds(getOrgId(session), callerId).then((ids) => new Set(ids)),
  ]);
  return { callerId, admin, peopleTeam, manager, agent: isAgentOf(level), chain };
}

/**
 * Who created each goal: the okr_created activity row POST /api/okrs writes.
 * OKR has no creator column, and the activity row is written in the same
 * request as the goal. A goal with no row (seeded or imported) has no
 * creator, so only its owner, its owner's manager, the People team and
 * Owner/Admin may edit it: the narrow answer.
 */
export async function goalCreatorIds(orgId: string, goalIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (goalIds.length === 0) return out;
  const rows = await prisma.activityLog.findMany({
    where: { organizationId: orgId, type: "okr_created", targetType: "okr", targetId: { in: goalIds } },
    select: { targetId: true, actorId: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of rows) if (r.targetId && !out.has(r.targetId)) out.set(r.targetId, r.actorId);
  return out;
}

async function rightsTarget(session: unknown, goal: GoalRef): Promise<GoalRightsTarget> {
  // The creator only matters below Company level, and only for someone who
  // is not the owner: skip the lookup when it cannot change the answer.
  const needsCreator = goal.level !== "COMPANY" && goal.ownerId !== getUserId(session);
  const creatorId = needsCreator ? (await goalCreatorIds(getOrgId(session), [goal.id])).get(goal.id) ?? null : null;
  return { level: goal.level, ownerId: goal.ownerId, creatorId };
}

/**
 * May the caller EDIT this goal (rename, targets, contributors, linked work,
 * Part of, check in as more than a contributor)? mayEditGoal is the rule.
 */
export async function canEditGoal(session: unknown, goal: GoalRef): Promise<boolean> {
  const [actor, target] = await Promise.all([goalRightsActor(session), rightsTarget(session, goal)]);
  return mayEditGoal(actor, target);
}

/**
 * May the caller DELETE this goal? mayDeleteGoal is the rule. This is the
 * ONE predicate DELETE /api/okrs/[id] enforces AND the list and detail
 * surfaces gate their Delete control on, so the UI never shows a Delete the
 * API then refuses.
 */
export async function canDeleteGoal(session: unknown, goal: GoalRef): Promise<boolean> {
  const [actor, target] = await Promise.all([goalRightsActor(session), rightsTarget(session, goal)]);
  return mayDeleteGoal(actor, target);
}

/**
 * The set of userIds whose alignment data the caller may see, or `null`
 * for "unrestricted" (door 3). Employees get `[self]`, managers their
 * recursive tree (which includes self).
 */
export async function visibleAlignmentUserIds(
  session: unknown,
): Promise<string[] | null> {
  if (isOrgWideAlignment(session)) return null;
  const callerId = getUserId(session);
  if (!isManager(session)) return [callerId];
  return getTeamUserIds(getOrgId(session), callerId);
}
