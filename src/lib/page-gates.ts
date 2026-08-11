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

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

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
