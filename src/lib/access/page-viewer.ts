// The org role of the person a server page or layout renders for, from the
// session (a database read only for a token with no level claim): the
// engine's own mapping (orgRoleOf). Replaces src/lib/route-guard.ts's
// isGuestViewer and isOrgAdminViewer (access step 6, Phase 8 stage F): the
// same answers (SUPER_ADMIN is Owner, COMPANY_ADMIN Admin, the rest Member,
// Guest for a Guest), with no level read outside src/lib/access/.
//
// Signed out: the sign-in page, as the route guards did.
//
// TWO EDGES KEEP route-guard's answers. A token with no accessLevel claim (one
// issued before step 0) is NOT read as a Guest: the engine's own fallback
// re-reads the level from the account (viewerFromSession, hydrate), and if
// that cannot answer it is a Member, route-guard's `accessLevel ?? "EMPLOYEE"`.
// Signed in with no organizationId renders as a Member too, as before, never
// a bounce to the sign-in page the person is already past.

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { viewerFromSession } from "./viewer";
import { orgRoleOf } from "./org-role";
import type { OrgRole } from "./types";

export async function pageOrgRole(): Promise<OrgRole> {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; organizationId?: string | null; accessLevel?: string | null } | undefined;
  if (!session?.user || !user) redirect("/login");
  if (user.accessLevel) return orgRoleOf({ accessLevel: user.accessLevel });
  const viewer = user.id && user.organizationId ? await viewerFromSession().catch(() => null) : null;
  return viewer?.orgRole ?? "MEMBER";
}

/** An Owner or an Admin (route-guard isOrgAdminViewer). */
export async function pageViewerIsWorkspaceAdmin(): Promise<boolean> {
  const role = await pageOrgRole();
  return role === "OWNER" || role === "ADMIN";
}

/** A Guest (route-guard isGuestViewer): module pages show them the in-shell 404, never ModuleOff. */
export async function pageViewerIsGuest(): Promise<boolean> {
  return (await pageOrgRole()) === "GUEST";
}
