// Server wrapper over review-cycle-rules.ts: the facts the rules need, from
// the access engine's own Viewer (viewerFromSession hydrates the org role,
// the People team and the report tree), never from an access-level read.
// Server only.

import { viewerFromSession } from "@/lib/access/viewer";
import { getEffectiveReportTree } from "@/lib/reporting-line";
import { canManageCycle } from "./review-cycle-rules";

/**
 * Owner / Admin, or the People team (the stored list, or HR while toggle 6
 * is unset: the engine's own rule). The session argument is accepted for the
 * callers' convenience; the answer comes from the engine's Viewer for this
 * request.
 */
export async function isPeopleTeamOrAdmin(session?: unknown): Promise<boolean> {
  void session;
  const v = await viewerFromSession();
  if (!v) return false;
  return v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true;
}

export async function canManageReviewCycle(session: unknown, cycle: { createdById?: string | null }): Promise<boolean> {
  void session;
  const v = await viewerFromSession();
  if (!v) return false;
  const peopleOrAdmin = v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true;
  return canManageCycle({ callerId: v.userId, peopleTeamOrAdmin: peopleOrAdmin, createdById: cycle.createdById ?? null });
}

/** The caller's reporting chain, solid plus dotted, self excluded. */
export async function chainOf(userId: string): Promise<string[]> {
  return (await getEffectiveReportTree(userId)).filter((id) => id !== userId);
}

/**
 * May this person start a review cycle? The People team and Admin (org
 * cycles), anyone with reports (a cycle over their chain: DECIDED, "a
 * manager may run a review cycle for their chain"), and the manager tier
 * that could start one yesterday (its cycle is clipped to its chain at
 * launch, so a tier with no reports launches for nobody).
 */
export async function mayStartReviewCycles(session: { user?: Record<string, unknown> } | null): Promise<boolean> {
  // The legacy tier through the one reader of it (page-gates).
  const { sessionOnLegacyManagerTier } = await import("@/lib/page-gates");
  if (session?.user && (await sessionOnLegacyManagerTier(session))) return true;
  const v = await viewerFromSession();
  if (!v) return false;
  if (v.orgRole === "GUEST") return false;
  if (v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true) return true;
  return (v.reportTree?.size ?? 0) > 0;
}

/**
 * Whose reviews in a cycle this caller may act on as its runner: every
 * row for the People team and Admin (null), otherwise the caller's CURRENT
 * chain. A manager who started a cycle keeps it for the people who still
 * report to them; someone who moved to another manager leaves their reach
 * (no calibration, no outcome, no PIP or exit from a former manager).
 */
export async function cycleSubjectReach(session: unknown): Promise<Set<string> | null> {
  void session;
  const v = await viewerFromSession();
  if (!v) return new Set();
  if (v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true) return null;
  return new Set(await chainOf(v.userId));
}
