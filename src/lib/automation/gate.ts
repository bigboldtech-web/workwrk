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
 *   WRITE  delegated until the access engine flips, with the spec's owner
 *          rule added (spec-ai-automation 1.4, access 5.2.1
 *          org.create_automation): EVERY Member creates, duplicates and uses
 *          a template (the copy is theirs); a workflow's creator edits,
 *          publishes, activates, deactivates, retries and archives their
 *          own; a manager or above keeps editing every workflow as before;
 *          Owners and Admins do everything, and alone own connections.
 *          What a Member's automation can reach is capped at the Member
 *          (author-reach.ts), so creating one never widens anyone's access.
 *
 * Multi-tenancy is unchanged: callers filter EVERY query by ctx.orgId and
 * 404 any record fetched by id outside it.
 */

export interface AutomationContext {
  userId: string;
  orgId: string;
  /** Create a new automation (a DRAFT), duplicate, use a template: every Member. */
  canCreate: boolean;
  /** Edit, publish, activate, deactivate, retry ANY workflow (manager or above). */
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
 * What the viewer may do to one workflow (spec-ai-automation 1.4: its creator,
 * Owners and Admins; a manager or above keeps the edit rights they had).
 * Every write route answers with exactly this, so no rendered control 403s.
 */
export function workflowRights(ctx: AutomationContext, createdById: string | null | undefined): WorkflowRights {
  const mine = !!createdById && createdById === ctx.userId;
  return { edit: ctx.canManage || mine, archive: ctx.isAdmin || mine };
}

export async function requireAutomation(): Promise<{ error: NextResponse } | AutomationContext> {
  const gate = await requireApp("automation");
  if ("error" in gate) return { error: gate.error };
  const { viewer } = gate;
  const tiers = await legacySessionTiers();
  const isAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  const canManage = isAdmin || tiers.manager;
  // requireApp already turned away Guests and anyone outside the audience.
  return { userId: viewer.userId, orgId: viewer.organizationId, canCreate: true, canManage, isAdmin, viewer };
}

export function forbidden(message = "You need edit access to change automations."): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

/** The one refusal for a workflow the viewer did not make and cannot edit. */
export function notYours(): NextResponse {
  return forbidden("You can change the automations you made. Ask whoever made this one, or an Admin.");
}

/**
 * The per-workflow write check every [id] route runs before it acts: 404 when
 * the workflow is not in this workspace, 403 when the viewer holds neither
 * the tier right nor authorship. Returns null when the write may go ahead.
 */
export async function refuseWorkflowWrite(
  ctx: AutomationContext,
  workflowId: string,
  right: keyof WorkflowRights,
): Promise<NextResponse | null> {
  if (right === "edit" && ctx.canManage) return null;
  if (right === "archive" && ctx.isAdmin) return null;
  const { prisma } = await import("@/lib/prisma");
  const row = await prisma.automationWorkflow.findFirst({
    where: { id: workflowId, organizationId: ctx.orgId },
    select: { createdById: true },
  });
  if (!row) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  return workflowRights(ctx, row.createdById)[right] ? null : notYours();
}
