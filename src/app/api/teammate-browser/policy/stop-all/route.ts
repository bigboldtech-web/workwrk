// POST /api/teammate-browser/policy/stop-all { organizationId, confirm: "stop" }
//
// An Owner or Admin closes every teammate browser in this workspace at once
// (docs/plans/ai-teammates-phase4.md Decision 30). They see none of them:
// each closes as its person would see it ("An Owner or Admin stopped every
// browser in this workspace."), its waiting steps are cancelled, and nothing
// any did is undone. People can start again while the computer is on.
//
// The actor is read fresh (freshWorkspaceActor), the body names the
// workspace the page showed (409 workspace_changed otherwise), and the
// admin's own audit row says how many closed, written however the ending
// ends (each session also writes its own summary row).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";
import { BROWSER_POLICY_COPY, CONNECTION_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";
import { requireManageApps } from "@/lib/app-gate";
import { authOptions } from "@/lib/auth";
import { endWorkspaceBrowserSessions } from "@/lib/browser/sessions";

const bodySchema = z.object({ confirm: z.literal("stop"), organizationId: z.string().min(1).max(200).optional() });

export async function POST(req: Request) {
  const gate = await requireManageApps("apps");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const fresh = await freshWorkspaceActor(await getServerSession(authOptions));
  if (!fresh.ok) return teammateError(fresh.status, fresh.code, fresh.error);
  if (!fresh.admin) return teammateError(403, "stale_session", CONNECTION_ROUTE_ERRORS.adminsOnly);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return teammateError(400, "confirm_needed", BROWSER_POLICY_COPY.confirmNeeded);
  if (parsed.data.organizationId !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);

  let ended = 0;
  let finished = false;
  try {
    ended = await endWorkspaceBrowserSessions(viewer.organizationId, "admin_stopped", viewer.userId);
    finished = true;
  } finally {
    await logActivity({
      type: "teammate_browser.stopped_all",
      actorId: viewer.userId,
      organizationId: viewer.organizationId,
      description: BROWSER_POLICY_COPY.auditStoppedAll(ended),
      targetId: viewer.organizationId,
      targetType: "organization",
      metadata: { count: ended, finished },
      severity: "warning",
    });
  }
  return NextResponse.json({ ended });
}
