// Who may read WHOSE timesheets.
//
// One reader, because two surfaces answer the question and they must agree:
// GET /api/timesheets?scope=all renders the audit list, and
// GET /api/export/timesheets writes the CSV a manager takes to payroll. Until
// Phase 4 both gated on isManager() alone, which resolves through
// LEGACY_MANAGER_LEVELS and therefore includes TEAM_LEAD and HR, so any team
// lead could list, and download, every employee's hours in the organization.
//
// spec-planner.md section 10: "the org-wide `all` scope for any team lead is
// gone", and section 2 /timesheets Data: "`all` folds into `team` for People
// team and Admin". LEGACY_HR_ADMIN_LEVELS is exactly SUPER_ADMIN,
// COMPANY_ADMIN and HR, which is that audience spelled in the ladder the rest
// of the gates already read.
//
// Pure: no prisma, no session import, no React. Unit-tested.

import { LEGACY_HR_ADMIN_LEVELS } from "@/lib/access/legacy-levels";

/** The People team, Owners and Admins keep the org-wide timesheet view. */
export function isOrgWideTimesheetReader(accessLevel: string | null | undefined): boolean {
  return LEGACY_HR_ADMIN_LEVELS.has(String(accessLevel ?? ""));
}
