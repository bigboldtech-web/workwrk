import { NextResponse } from "next/server";
import { requireApp } from "@/lib/app-gate";
import { legacySessionTiers } from "@/lib/access/legacy-session";
import type { Viewer } from "@/lib/access/types";

/**
 * The one gate for every /api/automation/* route (spec-ai-automation 1.4 and
 * section 4 step 2). It replaces hub-access.ts (resolveAutomationContext,
 * canManageAutomations, AutomationRole) and changes one thing on purpose:
 *
 *   READ   the `automation` app key through requireCan, so a Guest now gets
 *          the same 404 as anyone outside the audience (before, a Guest
 *          resolved to "member" and could read every run payload), and an
 *          org that hid or floored the app gets 403 { error: "app_off" }.
 *   WRITE  unchanged from hub-access, delegated until the access engine
 *          flips: create, edit, publish, activate, deactivate and retry for
 *          a manager or above; delete and connections for Owner and Admin.
 *
 * Multi-tenancy is unchanged: callers filter EVERY query by ctx.orgId and
 * 404 any record fetched by id outside it.
 */

export interface AutomationContext {
  userId: string;
  orgId: string;
  /** Create, edit, publish, activate, deactivate, retry. */
  canManage: boolean;
  /** Owner or Admin: delete a workflow, connections, per-person usage. */
  isAdmin: boolean;
  /** The access viewer, for the per-object reads (which Lists a name may show). */
  viewer: Viewer;
}

/** What the viewer may do to one workflow, sent with every row so no control 403s. */
export interface WorkflowRights {
  /** Save, publish, activate, deactivate, rename, restore a version, retry its runs. */
  edit: boolean;
  /** Archive, and bring an archived one back. */
  archive: boolean;
}

/**
 * Delegated until the access engine flips (spec-ai-automation 1.4 names the
 * creator, Owner and Admin): today the write routes accept a manager or
 * above for edits and Owner or Admin for archive, so that is what renders.
 */
export function workflowRights(ctx: AutomationContext): WorkflowRights {
  return { edit: ctx.canManage, archive: ctx.isAdmin };
}

export async function requireAutomation(): Promise<{ error: NextResponse } | AutomationContext> {
  const gate = await requireApp("automation");
  if ("error" in gate) return { error: gate.error };
  const { viewer } = gate;
  const tiers = await legacySessionTiers();
  const isAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  const canManage = isAdmin || tiers.manager;
  return { userId: viewer.userId, orgId: viewer.organizationId, canManage, isAdmin, viewer };
}

export function forbidden(message = "You need edit access to change automations."): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}
