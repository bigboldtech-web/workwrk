// The person scope of the process unit's people-data routes (spec-process
// section 1: "compliance pages resolve through { type: "person" } per row";
// "hasReports (their chain), People team, Owner, Admin").
//
// The access engine stays inert this release, so the scope is the same
// transcription every sibling route already uses: the org-wide legacy levels
// see everyone, any other manager sees their report tree, and a viewer with
// nobody in scope is answered 403 by the route (the page never reaches it:
// the sidebar row and the layout 404 both gate on the same tier).

import { getOrgId, getUserId, isManager } from "@/lib/api-helpers";
import { getTeamUserIds } from "@/lib/team";

const ORG_WIDE = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);

export interface PersonScope {
  /** Everyone in the org is in scope. */
  orgWide: boolean;
  /** When not org-wide: the viewer plus their reports. */
  userIds: Set<string> | null;
  canView: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isOrgWideLevel(session: any): boolean {
  const level = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  return ORG_WIDE.has(level);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function personScope(session: any): Promise<PersonScope> {
  if (!isManager(session)) return { orgWide: false, userIds: null, canView: false };
  if (isOrgWideLevel(session)) return { orgWide: true, userIds: null, canView: true };
  const ids = new Set(await getTeamUserIds(getOrgId(session), getUserId(session)));
  // "hasReports": the tree always contains the viewer, so one id is nobody.
  return { orgWide: false, userIds: ids, canView: ids.size > 1 };
}

/**
 * The one `manage_process` rule (spec-process section 1: Owner, Admin,
 * People team), for the three routes that write the org's process
 * taxonomies and defaults: PATCH /api/settings {section:"process"},
 * POST /api/policies/rename-category, POST /api/agreements/rename-folder.
 * Written once here so the three cannot drift.
 */
const MANAGE_PROCESS = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "HR"]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function canManageProcess(session: any): boolean {
  const level = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  return MANAGE_PROCESS.has(level);
}

export function inScope(scope: PersonScope, userId: string): boolean {
  if (scope.orgWide) return true;
  return !!scope.userIds && scope.userIds.has(userId);
}
