// hasPermission() under ACCESS_V2_RESOLVER (Phase 8 stage E): the matrix cell
// answered by matrix-rules.ts from the viewer's org role, People team seat and
// report tree, and the org's access toggles. Null when the table does not own
// the cell, and the caller then keeps the matrix answer. Server-only.

import { prisma } from "../prisma";
import { matrixCellDecision } from "./matrix-rules";
import { hasReports } from "./resolve";
import { parseAccessSettings } from "./settings";
import { hydrate, viewerFromSessionObject } from "./viewer";

/**
 * `stored` is today's matrix answer for this person and cell, which a
 * narrowOnly row (the SOP content cells) intersects with the rule.
 */
export async function engineMatrixCell(session: unknown, module: string, action: string, stored: boolean): Promise<boolean | null> {
  const base = viewerFromSessionObject(session as Parameters<typeof viewerFromSessionObject>[0]);
  if (!base) return false;
  const [viewer, org] = await Promise.all([
    hydrate(base, (session as object) ?? undefined),
    prisma.organization.findUnique({ where: { id: base.organizationId }, select: { settings: true } }),
  ]);
  if (viewer.deleted || viewer.status === "INACTIVE") return false;
  const access = parseAccessSettings((org?.settings as { access?: unknown } | null)?.access);
  return matrixCellDecision(module, action, {
    orgRole: viewer.orgRole,
    isAgent: viewer.isAgent,
    peopleTeam: !!viewer.peopleTeam || access.peopleTeamUserIds.includes(viewer.userId),
    hasReports: hasReports(viewer),
  }, access, stored);
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

/**
 * Every cell matrix-rules.ts owns, answered for the signed-in person the way
 * hasPermission answers it, keyed "module.action". /api/permissions sends
 * this to the client with ACCESS_V2_RESOLVER on, so usePermission shows a
 * control exactly when the server's gate lets its handler through (a Manager
 * never sees an Invite button whose POST the engine refuses, and a People
 * team Member sees the New announcement button the server allows).
 */
export async function engineMatrixCells(session: unknown): Promise<Record<string, boolean>> {
  const { MATRIX_CELL_RULES } = await import("./matrix-rules");
  const { hasPermission } = await import("../api-helpers");
  const out: Record<string, boolean> = {};
  for (const row of MATRIX_CELL_RULES) {
    out[`${row.module}.${row.action}`] = await hasPermission(session, row.module as Parameters<typeof hasPermission>[1], row.action);
  }
  return out;
}
