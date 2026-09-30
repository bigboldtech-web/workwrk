// hasPermission() under ACCESS_V2_RESOLVER (Phase 8 stage E): the matrix cell
// answered by matrix-rules.ts from the viewer's org role, People team seat and
// report tree, and the org's access toggles. Null when the table does not own
// the cell, and the caller then keeps the matrix answer. Server-only.

import { prisma } from "../prisma";
import { matrixCellAllowed } from "./matrix-rules";
import { hasReports } from "./resolve";
import { parseAccessSettings } from "./settings";
import { hydrate, viewerFromSessionObject } from "./viewer";

export async function engineMatrixCell(session: unknown, module: string, action: string): Promise<boolean | null> {
  const base = viewerFromSessionObject(session as Parameters<typeof viewerFromSessionObject>[0]);
  if (!base) return false;
  const [viewer, org] = await Promise.all([
    hydrate(base, (session as object) ?? undefined),
    prisma.organization.findUnique({ where: { id: base.organizationId }, select: { settings: true } }),
  ]);
  if (viewer.deleted || viewer.status === "INACTIVE") return false;
  const access = parseAccessSettings((org?.settings as { access?: unknown } | null)?.access);
  return matrixCellAllowed(module, action, {
    orgRole: viewer.orgRole,
    isAgent: viewer.isAgent,
    peopleTeam: !!viewer.peopleTeam || access.peopleTeamUserIds.includes(viewer.userId),
    hasReports: hasReports(viewer),
  }, access);
}

/**
 * An org verb (create_space, invite_guest, ...) answered by the engine's
 * decideOrg for the signed-in person, used where a route's legacy tier check
 * gives way to the toggle under ACCESS_V2_RESOLVER (toggle 1 on POST
 * /api/spaces). False when signed out.
 */
export async function engineOrgAllows(orgAction: import("./types").OrgAction): Promise<boolean> {
  const { can, viewerFromSession } = await import("./index");
  const viewer = await viewerFromSession();
  if (!viewer) return false;
  const d = await can(viewer, "manage", { type: "org", action: orgAction });
  return d.allowed;
}
