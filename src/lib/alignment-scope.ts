// Three-door scoping for alignment data (KRAs, KPIs, KPI records, OKRs,
// reviews). Every alignment API enforces the same ladder SERVER-SIDE —
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

/** Door 3 — may read/write alignment data across the whole org. */
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

/**
 * May the caller EDIT an objective owned by `ownerId`? The owner always;
 * org-wide levels always; manager tiers when the owner is in their report
 * tree — and for unowned objectives (managers create those), any manager.
 */
export async function canEditOkrOwner(
  session: unknown,
  ownerId: string | null,
): Promise<boolean> {
  const callerId = getUserId(session);
  if (ownerId === callerId) return true;
  if (isOrgWideAlignment(session)) return true;
  if (!isManager(session)) return false;
  if (!ownerId) return true;
  const teamIds = await getTeamUserIds(getOrgId(session), callerId);
  return teamIds.includes(ownerId);
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
