// The one gate for /api/build/* (spec-tools-misc 2.3 and 2.4): the `build`
// app key, Owner and Admin only (access 5.2.1). A Member, an Agent or a Guest
// gets the same 404 the page gives them, because Build apps is not
// discoverable outside its audience; an org that hid the app gets 403
// app_off. Before this every route checked org membership alone, so any
// Member could create, edit and archive any app and spend AI tokens on
// /api/build/generate.
//
// THE MEMBER EXCEPTION. Tightening the gate must not take away what a Member
// could do yesterday (at HEAD every route checked org membership alone). A
// non-Guest Member of an org that has built apps keeps USING them: open every
// live app in the org, add, change and delete its rows. On the apps THEY
// created they also keep rename, archive and restore. Creating a new app and
// AI generation are Owner and Admin (requireBuild), which is the one thing
// that narrows, and it is reported as a spec conflict: whether Members should
// build apps at all is spec-tools-misc 2.3 open question 1, a founder
// decision recorded in scripts/MIGRATIONS.md.

import type { NextResponse } from "next/server";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";

/** Owner and Admin: create an app, generate one with AI. */
export async function requireBuild(): Promise<{ error: NextResponse } | { userId: string; orgId: string }> {
  const gate = await requireApp("build");
  if ("error" in gate) return { error: gate.error };
  return { userId: gate.viewer.userId, orgId: gate.viewer.organizationId };
}

export interface BuildViewer {
  userId: string;
  orgId: string;
  /** Owner or Admin: every app in the org. False: the Member exception (use live apps, manage own). */
  admin: boolean;
}

/** Live apps in the org plus this person's own (archived included): what a Member may open. */
function memberAppWhere(orgId: string, userId: string) {
  return { organizationId: orgId, AND: [{ OR: [{ status: { not: "ARCHIVED" as const } }, { createdById: userId }] }] };
}

/** How many apps this Member may open (the Member exception). */
export async function countUsableBuildApps(orgId: string, userId: string): Promise<number> {
  return prisma.app.count({ where: memberAppWhere(orgId, userId) });
}

/**
 * Read and use apps: Owner and Admin over the org; a non-Guest Member over
 * the org's live apps and their own, when there is at least one. Everyone
 * else gets exactly the answer requireBuild gives (404 outside the audience,
 * 403 app_off when the org hid the app, which a Member gets too).
 */
export async function requireBuildViewer(): Promise<{ error: NextResponse } | BuildViewer> {
  const gate = await requireApp("build");
  if (!("error" in gate)) {
    return { userId: gate.viewer.userId, orgId: gate.viewer.organizationId, admin: true };
  }
  if (gate.error.status !== 404) return { error: gate.error };
  const viewer = await viewerFromSession();
  if (!viewer || viewer.orgRole === "GUEST") return { error: gate.error };
  if ((await countUsableBuildApps(viewer.organizationId, viewer.userId)) === 0) return { error: gate.error };
  return { userId: viewer.userId, orgId: viewer.organizationId, admin: false };
}

/** The where-clause scope of the apps this viewer may open. */
export function buildAppScope(c: BuildViewer) {
  return c.admin ? { organizationId: c.orgId } : memberAppWhere(c.orgId, c.userId);
}

/** Rename, archive, restore: Owner and Admin, or the app's creator. */
export function canManageBuildApp(c: BuildViewer, app: { createdById: string | null }): boolean {
  return c.admin || (app.createdById !== null && app.createdById === c.userId);
}
