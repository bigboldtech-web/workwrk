import { isManager } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";

const ORG_WIDE = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);

/**
 * Who may read AND change a run (spec-process section 2 `/process-runs`):
 * the org-wide roles, the assignee, and a manager whose report tree holds
 * the assignee (or any manager when the run is link-shared with no
 * assignee). One rule for GET, PATCH, the legacy body-addressed PATCH and
 * the `canManage` flag the drawer renders from, so nobody can tick, cancel
 * or reassign a run they cannot read. Server-only (it walks the org chart).
 */
export async function canManageRun(
  session: { user: { accessLevel?: string } },
  orgId: string,
  callerId: string,
  assigneeId: string | null,
): Promise<boolean> {
  const level = session.user.accessLevel ?? "";
  if (ORG_WIDE.has(level)) return true;
  if (assigneeId === callerId) return true;
  if (!assigneeId) return isManager(session);
  if (!isManager(session)) return false;
  const team = await getTeamUserIds(orgId, callerId);
  return team.includes(assigneeId);
}
