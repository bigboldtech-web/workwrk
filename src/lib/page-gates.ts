// Server-side page gates for the three-door alignment model. Hiding a
// nav link is never the permission — every management surface calls one
// of these in its server page before rendering the client body.
//
//   Door 1  EMPLOYEE / AGENT   → their own career home (/people/me)
//   Door 2  manager tiers      → Teams cockpit, scoped to their report tree
//   Door 3  admin / HR         → org-wide surfaces (reviews administration)
//
// The tier sets mirror src/lib/alignment-scope.ts (API side) and the
// apps-catalog requiredAccess ladder (nav side) so all three layers agree.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeeGoal } from "@/lib/goal-audience";

const MANAGER_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);
const HR_ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]);

export interface PageSessionUser {
  id: string;
  organizationId: string;
  accessLevel: string;
}

/** Resolve the signed-in user or bounce to /login. */
export async function requireSessionUser(): Promise<PageSessionUser> {
  const session = await getServerSession(authOptions);
  const u = session?.user as
    | { id?: string; organizationId?: string; accessLevel?: string }
    | undefined;
  if (!u?.id || !u.organizationId) redirect("/login");
  return { id: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" };
}

/**
 * Manager-tier gate for Teams-app surfaces. Employees are not stranded:
 * they land on their own career home, which carries their KRAs, KPIs,
 * goals, reviews and assets.
 */
export async function requireManagerPage(): Promise<PageSessionUser> {
  const user = await requireSessionUser();
  if (!MANAGER_LEVELS.has(user.accessLevel)) redirect("/people/me");
  return user;
}

/** HR-admin gate (review-cycle administration). Managers keep /team/reviews. */
export async function requireHrAdminPage(): Promise<PageSessionUser> {
  const user = await requireSessionUser();
  if (!HR_ADMIN_LEVELS.has(user.accessLevel)) {
    redirect(MANAGER_LEVELS.has(user.accessLevel) ? "/team/reviews" : "/people/me");
  }
  return user;
}

export function isManagerLevel(accessLevel: string): boolean {
  return MANAGER_LEVELS.has(accessLevel);
}

/**
 * Goals LIST gate. Any signed-in member may open /okrs — the rows
 * themselves are filtered three-door by GET /api/okrs (employees: own +
 * audience + COMPANY; managers: + report tree; admin/HR: org). The page
 * gate's job is only "signed in, org resolved".
 */
export async function requireGoalsPage(): Promise<PageSessionUser> {
  return requireSessionUser();
}

/**
 * One-goal page gate (/okrs/[id]) — the same three-door model as the
 * goals APIs, via the ONE visibility implementation, canSeeGoal
 * (src/lib/goal-audience.ts): COMPANY goals → everyone in the org; your
 * own or audience-resolved goals → you; a report's goals → their
 * managers (report tree via getTeamUserIds); org-wide levels → all.
 * Anything else — including a guessed URL to another team's individual
 * goal — reads as notFound(), never as a peek.
 */
export async function requireGoalPage(okrId: string): Promise<PageSessionUser> {
  const user = await requireSessionUser();
  const okr = await prisma.oKR.findFirst({
    where: { id: okrId, organizationId: user.organizationId },
    select: { id: true, level: true, ownerId: true, departmentId: true },
  });
  if (!okr) notFound();
  const sessionLike = {
    user: { id: user.id, organizationId: user.organizationId, accessLevel: user.accessLevel },
  };
  if (!(await canSeeGoal(sessionLike, okr))) notFound();
  return user;
}
