// POST /api/teammate-browser/policy/delete-skills { organizationId, confirm: "delete" }
//
// An Owner or Admin deletes every skill in this workspace at once
// (docs/plans/ai-teammates-phase5.md Decisions 14 and 25, step 3), beside
// Stop every browser. They see none of them: recordings in progress stop
// first, every person's skills and the routines made from them are deleted,
// and the answer and the one audit row carry the count only. Nothing about
// any skill is read or answered.
//
// The gate is Stop every browser's: the Apps & modules page's own
// (requireManageApps), then the actor read fresh (freshWorkspaceActor, so an
// Admin demoted a moment ago deletes nothing). The body names the workspace
// the page showed (409 workspace_changed otherwise) and confirms (400
// confirm_needed). The audit row is written however the deleting ends.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";
import { CONNECTION_ROUTE_ERRORS, SKILL_POLICY_COPY } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";
import { requireManageApps } from "@/lib/app-gate";
import { authOptions } from "@/lib/auth";
import { deleteEverySkill } from "@/lib/skills/manage";

const bodySchema = z.object({ confirm: z.literal("delete"), organizationId: z.string().min(1).max(200).optional() });

export async function POST(req: Request) {
  const gate = await requireManageApps("apps");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const fresh = await freshWorkspaceActor(await getServerSession(authOptions));
  if (!fresh.ok) return teammateError(fresh.status, fresh.code, fresh.error);
  if (!fresh.admin) return teammateError(403, "stale_session", CONNECTION_ROUTE_ERRORS.adminsOnly);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return teammateError(400, "confirm_needed", SKILL_POLICY_COPY.confirmNeeded);
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);

  let deleted = 0;
  let finished = false;
  try {
    deleted = await deleteEverySkill(viewer.organizationId);
    finished = true;
  } finally {
    await logActivity({
      type: "teammate_browser.skills_deleted_all",
      actorId: viewer.userId,
      organizationId: viewer.organizationId,
      description: SKILL_POLICY_COPY.auditDeletedAll(deleted),
      targetId: viewer.organizationId,
      targetType: "organization",
      metadata: { count: deleted, finished },
      severity: "warning",
    });
  }
  return NextResponse.json({ deleted }, { headers: { "Cache-Control": "no-store" } });
}
