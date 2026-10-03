import { isManager } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getTeamUserIds } from "@/lib/team";

const ORG_WIDE = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);

/** The org-wide roles: every run is theirs to read and change. */
export function runsOrgWide(session: { user: { accessLevel?: string } }): boolean {
  return ORG_WIDE.has(session.user.accessLevel ?? "");
}

/**
 * The caller and the people whose runs are theirs to follow: the solid
 * report tree plus their direct dotted-line reports, the rule the shell's
 * "has reports" reads (src/lib/people/teams-counts.ts hasReportsFor), so Team
 * runs and Reassign never show to someone the server then answers with
 * their own runs only.
 */
export async function runTeamIds(orgId: string, callerId: string): Promise<string[]> {
  const [solid, dotted] = await Promise.all([
    getTeamUserIds(orgId, callerId),
    prisma.userDottedLine.findMany({
      where: { managerId: callerId, user: { organizationId: orgId, deletedAt: null } },
      select: { userId: true },
    }),
  ]);
  const ids = new Set(solid);
  for (const d of dotted) ids.add(d.userId);
  return [...ids];
}

/**
 * Who may read AND change a run (spec-process section 2 `/process-runs`):
 * the org-wide roles, the assignee, and anyone whose report tree holds the
 * assignee, whatever their own level (or any manager when the run is
 * link-shared with no assignee). One rule for GET, PATCH, the legacy
 * body-addressed PATCH and the `canManage` flag the drawer renders from, so
 * nobody can tick, cancel or reassign a run they cannot read. Server-only
 * (it walks the org chart).
 *
 * The tree, not the level: Start run offers a team lead their reports (Team
 * runs is "for people who have reports"), and a run they started for one of
 * them used to vanish from their list the moment it began.
 */
export async function canManageRun(
  session: { user: { accessLevel?: string } },
  orgId: string,
  callerId: string,
  assigneeId: string | null,
): Promise<boolean> {
  if (runsOrgWide(session)) return true;
  if (assigneeId === callerId) return true;
  if (!assigneeId) return isManager(session);
  const team = await runTeamIds(orgId, callerId);
  return team.includes(assigneeId);
}

/**
 * Whether the caller may give a run to this person (Start run, Reassign):
 * the org-wide roles anyone; everyone else themselves or someone in their
 * report tree, the people the picker offers. A run given outside the tree
 * left the caller's own list at once, and the routes took any id at all.
 * "Anyone with the link" (no assignee) is the caller's own check.
 */
export async function mayGiveRunTo(
  session: { user: { accessLevel?: string } },
  orgId: string,
  callerId: string,
  assigneeId: string,
): Promise<boolean> {
  if (runsOrgWide(session) || assigneeId === callerId) return true;
  return (await runTeamIds(orgId, callerId)).includes(assigneeId);
}
