// POST /api/teammate-connections/policy/disconnect-all { confirm: "disconnect" }
//
// An Owner or Admin ends every person's Google connection for AI teammates
// in this workspace (docs/plans/ai-teammates-phase3.md step 2, Decision 21).
// Each connection's row goes and its revoke is queued in one transaction per
// chunk (connections.ts removeConnections); each person gets their own audit
// row and Inbox row, and the admin one audit row with the count. Google is
// told at once for as many as a few seconds allow; the cron drains the rest.

import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { CONNECTOR_POLICY_COPY } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";
import { requireManageApps } from "@/lib/app-gate";
import { removeConnections, revokeQueued } from "@/lib/connectors/connections";
import { googleConfig } from "@/lib/connectors/google/config";

const bodySchema = z.object({ confirm: z.literal("disconnect") });

export async function POST(req: Request) {
  const gate = await requireManageApps("apps");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  if (!bodySchema.safeParse(await req.json().catch(() => null)).success) {
    return teammateError(400, "confirm_needed", CONNECTOR_POLICY_COPY.confirmNeeded);
  }

  const { removed, queued } = await removeConnections({
    where: Prisma.sql`"organizationId" = ${viewer.organizationId}`,
    reason: "admin_all",
    actor: { id: viewer.userId, type: "person" },
    notify: true,
  });
  await logActivity({
    type: "teammate_connectors.disconnected_all",
    actorId: viewer.userId,
    organizationId: viewer.organizationId,
    description: CONNECTOR_POLICY_COPY.auditDisconnectedAll(removed.length),
    targetId: viewer.organizationId,
    targetType: "organization",
    metadata: { provider: "google", count: removed.length },
    severity: "warning",
  });
  const cfg = googleConfig();
  if (cfg && queued.length > 0) await revokeQueued(queued, cfg, { timeoutMs: 5_000, budgetMs: 8_000 }).catch(() => undefined);
  return NextResponse.json({ disconnected: removed.length });
}
