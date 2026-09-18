// Server-side route guards for the layouts that gate a whole directory.
// The sidebar hides these routes; a URL typed by hand still has to meet
// the same tier, or the page chrome and an empty UI would leak.
//
// Denial shape (spec-shell 1.6, back-map 12): never a redirect. A viewer
// outside an app's audience gets the in-shell 404 at the same URL; a
// non-admin on a Workspace settings page gets the AdminOnly card, because
// nothing under /settings ever 404s for a signed-in person (the personal
// door shares the prefix). The /dashboard bounce is gone.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

// Delegate (migration step 1): both lists come from the engine's one copy in
// src/lib/access/legacy-levels.ts. EMPLOYEE_LEVELS stays a DENY list there,
// because that is what it is here.
import { LEGACY_EMPLOYEE_LEVELS, legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import { orgRoleOf } from "@/lib/access/org-role";

async function sessionLevel(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  return (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
}

/** Manager-tier directory gate: employees and agents get the in-shell 404. */
export async function requireManagerOr404(): Promise<void> {
  const level = await sessionLevel();
  if (LEGACY_EMPLOYEE_LEVELS.has(level)) notFound();
}

/**
 * Org-admin gate for Workspace settings directories. Returns whether the
 * viewer is one of the two protected admin tiers; the layout renders the
 * AdminOnly card when it is false.
 */
export async function isOrgAdminViewer(): Promise<boolean> {
  const level = await sessionLevel();
  return legacyIsAdminLevel(level);
}

/** Guest gate for module directories: a Guest never sees ModuleOff, only the in-shell 404. */
export async function isGuestViewer(): Promise<boolean> {
  const level = await sessionLevel();
  return orgRoleOf({ accessLevel: level }) === "GUEST";
}

/**
 * Manager-tier gate for the Workspace settings pages the manager tier may
 * read (Members: read-only below Admin, and the invitations API admits the
 * tier). Returns whether the viewer is above Employee and Agent; the layout
 * renders the AdminOnly card when it is false.
 */
export async function requireManagerTierViewer(): Promise<boolean> {
  const level = await sessionLevel();
  return !LEGACY_EMPLOYEE_LEVELS.has(level);
}
