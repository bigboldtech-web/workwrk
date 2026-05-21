// POST /api/people/backfill-role-defs
//
// Org-admin one-click: walk every user in this org who has zero KRA
// assignments, infer a sensible starter role definition from their
// access level, and stamp KRAAssignment + SOPAssignment rows so the
// KRA/KPI/SOP entry gate is satisfied for the install base.
//
// Also seeds a default set of org-level KRAs (each with a starter KPI)
// and a welcome SOP if the org doesn't have them yet, so the
// assignments have something real to point at.
//
// GET returns the count of users currently missing role definitions
// (used by the People page banner to decide whether to show the CTA).

import { NextResponse } from "next/server";
import { getSessionOrFail, hasRole, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { backfillOrgRoleDefinitions } from "@/lib/role-defaults";
import type { AccessLevel } from "@/generated/prisma";
import { logAuditEvent } from "@/lib/activity";

const ADMIN_LEVELS: AccessLevel[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "HR"] as AccessLevel[];

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ADMIN_LEVELS)) {
    return jsonError("Forbidden", 403);
  }
  const orgId = (session.user as { organizationId: string }).organizationId;

  const missing = await prisma.user.count({
    where: { organizationId: orgId, kraAssignments: { none: {} } },
  });
  return NextResponse.json({ missing });
}

export async function POST() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ADMIN_LEVELS)) {
    return jsonError("Forbidden", 403);
  }
  const orgId = (session.user as { organizationId: string }).organizationId;
  const actorId = (session.user as { id: string }).id;

  const summary = await backfillOrgRoleDefinitions(orgId);

  logAuditEvent({
    type: "people.backfill_role_definitions",
    actorId,
    organizationId: orgId,
    description: `Backfilled role definitions for ${summary.usersTouched} user(s)`,
    metadata: summary,
  });

  return jsonSuccess(summary);
}
