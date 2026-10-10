// POST /api/teammate-connections/policy/disconnect-all { confirm: "disconnect", organizationId }
//
// An Owner or Admin ends every person's Google connection for AI teammates
// in this workspace (docs/plans/ai-teammates-phase3.md step 2, Decision 21).
// Each connection's row goes and its revoke is queued in one transaction per
// chunk (connections.ts removeConnections); each person gets their own audit
// row and Inbox row, and the admin one audit row with the count. Google is
// told at once for as many as a few seconds allow; the cron drains the rest.
//
// THE ACTOR IS READ FRESH (review of step 2). The session's role is checked
// against the database only every five minutes (src/lib/auth.ts), so an Admin
// demoted or removed a moment ago could otherwise still end everyone's
// connection. freshWorkspaceActor re-reads them, as the users route does.
// Google is told through the revoke settings alone (googleRevokeConfig), so a
// WorkwrK that stopped offering Google still revokes.
//
// REVIEW ROUND 1 OF PHASE 3. The body names the workspace the page showed
// (organizationId): a session switched to another workspace in another tab
// ends nothing there and answers 409 workspace_changed, and the page
// reloads. The admin's own audit row is written before the first connection
// ends (what was asked), and the count is recorded when it ends, however it
// ends, so a request that dies part way (a pool timeout, a deadlock) still
// leaves the admin's rows beside the people's.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { logActivity } from "@/lib/activity";
import { CONNECTION_ROUTE_ERRORS, CONNECTOR_POLICY_COPY } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";
import { requireManageApps } from "@/lib/app-gate";
import { authOptions } from "@/lib/auth";
import { removeConnections, revokeQueued } from "@/lib/connectors/connections";
import { googleRevokeConfig } from "@/lib/connectors/google/config";

// organizationId: the workspace the page showed, required. It is optional in
// the schema only so that a caller that names none (an API client, a page
// from before review round 1 of Phase 3) answers workspace_changed, never a
// bare 400 (comment corrected in review round 2 of Phase 3).
const bodySchema = z.object({ confirm: z.literal("disconnect"), organizationId: z.string().min(1).max(200).optional() });

export async function POST(req: Request) {
  const gate = await requireManageApps("apps");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const fresh = await freshWorkspaceActor(await getServerSession(authOptions));
  if (!fresh.ok) return teammateError(fresh.status, fresh.code, fresh.error);
  if (!fresh.admin) return teammateError(403, "stale_session", CONNECTION_ROUTE_ERRORS.adminsOnly);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return teammateError(400, "confirm_needed", CONNECTOR_POLICY_COPY.confirmNeeded);
  const shownIn = parsed.data.organizationId;
  // Required (lead, after review round 1): a page that names no workspace,
  // such as one loaded before this release, reloads rather than act on
  // whichever workspace the session holds now.
  if (shownIn !== viewer.organizationId) return teammateError(409, "workspace_changed", CONNECTION_ROUTE_ERRORS.workspaceChanged);

  // What was asked, on record before anything ends.
  await logActivity({
    type: "teammate_connectors.disconnect_all_started",
    actorId: viewer.userId,
    organizationId: viewer.organizationId,
    description: CONNECTOR_POLICY_COPY.auditDisconnectingAll,
    targetId: viewer.organizationId,
    targetType: "organization",
    metadata: { provider: "google" },
    severity: "warning",
  });
  let ended = 0;
  let finished = false;
  let queued: string[] = [];
  try {
    const out = await removeConnections({
      where: Prisma.sql`"organizationId" = ${viewer.organizationId}`,
      reason: "admin_all",
      actor: { id: viewer.userId, type: "person" },
      notify: true,
      onChunk: (n) => {
        ended += n;
      },
    });
    queued = out.queued;
    finished = true;
  } finally {
    // How many ended, whether every chunk committed or one threw part way.
    await logActivity({
      type: "teammate_connectors.disconnected_all",
      actorId: viewer.userId,
      organizationId: viewer.organizationId,
      description: CONNECTOR_POLICY_COPY.auditDisconnectedAll(ended),
      targetId: viewer.organizationId,
      targetType: "organization",
      metadata: { provider: "google", count: ended, finished },
      severity: "warning",
    });
  }
  const cfg = googleRevokeConfig();
  if (cfg && queued.length > 0) await revokeQueued(queued, cfg, { timeoutMs: 5_000, budgetMs: 8_000 }).catch(() => undefined);
  return NextResponse.json({ disconnected: ended });
}
