// The org role of the person a server page or layout renders for, from the
// session alone (no database read): the engine's own mapping
// (viewerFromSessionObject, orgRoleOf). Replaces src/lib/route-guard.ts's
// isGuestViewer and isOrgAdminViewer (access step 6, Phase 8 stage F): the
// same answers (SUPER_ADMIN is Owner, COMPANY_ADMIN Admin, the rest Member,
// Guest for a Guest), with no level read outside src/lib/access/.
//
// Signed out: the sign-in page, as the route guards did.

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { viewerFromSessionObject } from "./viewer";
import type { OrgRole } from "./types";

export async function pageOrgRole(): Promise<OrgRole> {
  const session = await getServerSession(authOptions);
  const viewer = viewerFromSessionObject(session as Parameters<typeof viewerFromSessionObject>[0]);
  if (!viewer) redirect("/login");
  return viewer.orgRole;
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
