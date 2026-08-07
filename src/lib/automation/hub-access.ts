import { NextResponse } from "next/server";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { isManagerOrAbove, isOrgAdmin } from "@/lib/access";

/**
 * Shared auth + permission helper for the /api/automation/* routes.
 *
 * Permission matrix (docs/plans/automation-hub.md):
 *   admin   (SUPER_ADMIN / COMPANY_ADMIN): full, including workflow
 *           delete and integration connect.
 *   manager (C_LEVEL / VP / DIRECTOR / MANAGER / TEAM_LEAD / HR):
 *           create / edit / publish / activate / deactivate / retry.
 *   member  (below manager): read-only. Every GET works; every
 *           mutation returns 403.
 *
 * Multi-tenancy: callers must filter EVERY query by ctx.orgId and 404
 * any record fetched by id that falls outside it.
 */

export type AutomationRole = "admin" | "manager" | "member";

export interface AutomationContext {
  userId: string;
  orgId: string;
  accessLevel: string;
  role: AutomationRole;
}

export async function resolveAutomationContext(): Promise<
  { error: NextResponse } | AutomationContext
> {
  const ctx = await resolveSuiteContext();
  if (ctx.error) return { error: ctx.error };
  const viewer = {
    userId: ctx.userId,
    organizationId: ctx.orgId,
    accessLevel: ctx.accessLevel,
  };
  const role: AutomationRole = isOrgAdmin(viewer)
    ? "admin"
    : isManagerOrAbove(viewer)
      ? "manager"
      : "member";
  return {
    userId: ctx.userId,
    orgId: ctx.orgId,
    accessLevel: String(ctx.accessLevel),
    role,
  };
}

/** Manager-and-above gate for workflow mutations. */
export function canManageAutomations(ctx: AutomationContext): boolean {
  return ctx.role === "admin" || ctx.role === "manager";
}

export function forbidden(message = "Forbidden: requires manager access"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}
