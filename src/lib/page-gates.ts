// Server-side page gates for the three-door alignment model. Hiding a
// nav link is never the permission: every management surface calls one
// of these in its server page before rendering the client body.
//
//   Door 1  EMPLOYEE / AGENT   -> their own career home (/people/me)
//   Door 2  manager tiers      -> Teams cockpit, scoped to their report tree
//   Door 3  admin / HR         -> org-wide surfaces (reviews administration)
//
// The tier sets mirror src/lib/alignment-scope.ts (API side) and the
// apps-catalog requiredAccess ladder (nav side) so all three layers agree.
//
// Denial shape (spec-shell 1.6, consistency-report C29): a page whose app
// key the viewer's tier excludes renders the in-shell 404 at the same URL,
// with the rail, sidebar and bar intact. Nothing here redirects on denial;
// the only redirect is the signed-out one. The old bounces to /people/me
// and /team/reviews are gone (back-map 12).

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeeGoal } from "@/lib/goal-audience";
import { gatePage } from "@/lib/access/gate";

// Delegate (migration step 1): both ladders come from the engine's one copy,
// src/lib/access/legacy-levels.ts.
import { legacyIsHrAdminLevel, legacyIsManagerLevel } from "@/lib/access/legacy-levels";

export interface PageSessionUser {
  id: string;
  organizationId: string;
  accessLevel: string;
}

/** Resolve the signed-in user or send them to /login (the one redirect). */
export async function requireSessionUser(): Promise<PageSessionUser> {
  const session = await getServerSession(authOptions);
  const u = session?.user as
    | { id?: string; organizationId?: string; accessLevel?: string }
    | undefined;
  if (!u?.id || !u.organizationId) redirect("/login");
  return { id: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" };
}

/**
 * Manager-tier gate for Teams-app surfaces. A viewer outside the tier gets
 * the in-shell 404: there is no object to request access to, and naming the
 * page would confirm it exists (access 5.5 rule 6).
 */
export async function requireManagerPage(): Promise<PageSessionUser> {
  const user = await requireSessionUser();
  if (!legacyIsManagerLevel(user.accessLevel)) notFound();
  return user;
}

/** HR-admin gate (review-cycle administration). Same 404 shape. */
export async function requireHrAdminPage(): Promise<PageSessionUser> {
  const user = await requireSessionUser();
  if (!legacyIsHrAdminLevel(user.accessLevel)) notFound();
  return user;
}

export function isManagerLevel(accessLevel: string): boolean {
  return legacyIsManagerLevel(accessLevel);
}

/**
 * Is this session on the legacy manager tier (HR included)? The one reader
 * of that signal for the Phase 6 culture and review-cycle create rules
 * (src/lib/people/culture-gate.ts, review-cycle-access.ts), which keep the
 * tier that could create yesterday alongside the engine's facts (reports,
 * People team, Admin), so nobody loses a create path they had. Pass the
 * request's session when the caller already has it; with none it reads the
 * current one.
 */
export async function sessionOnLegacyManagerTier(session?: unknown): Promise<boolean> {
  const s = (session ?? (await getServerSession(authOptions))) as
    | { user?: { accessLevel?: string | null } }
    | null
    | undefined;
  return legacyIsManagerLevel(s?.user?.accessLevel ?? null);
}

/**
 * Goals LIST gate. Any signed-in member may open /okrs; the rows themselves
 * are filtered three-door by GET /api/okrs. The page gate's job is only
 * "signed in, org resolved".
 */
export async function requireGoalsPage(): Promise<PageSessionUser> {
  // The one gate shape (Phase 6): the app row first (APP_RULES.goals, every
  // Member, never a Guest), then the session the page reads.
  await gatePage("view", { type: "app", key: "goals" }, { callbackUrl: "/okrs" });
  return requireSessionUser();
}

/**
 * One-goal page gate (/okrs/[id]): the same three-door model as the goals
 * APIs, via the ONE visibility implementation, canSeeGoal. Anything else,
 * including a guessed URL to another team's individual goal, reads as
 * notFound(), never as a peek.
 */
export async function requireGoalPage(okrId: string): Promise<PageSessionUser> {
  // The app row first, then the object rule (canSeeGoal).
  await gatePage("view", { type: "app", key: "goals" }, { callbackUrl: `/okrs/${okrId}` });
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
