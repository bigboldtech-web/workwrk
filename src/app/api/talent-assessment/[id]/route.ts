// DELETE /api/talent-assessment/[id]: Remove placement (the /talent detail
// panel and List view). The person goes back to "Not yet placed" for that
// period; nothing else about them changes. Only a placement of someone in
// the viewer's scope, never their own, and never for an Agent
// (cap.agent.delete). Audited.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { talentCtx } from "@/lib/performance/talent.server";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await talentCtx();
  if (!ctx || !ctx.allowed || ctx.isAgent) return jsonError("Forbidden", 403);
  const { id } = await params;
  const row = await prisma.talentAssessment.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!row || row.userId === ctx.userId || (ctx.ids !== null && !ctx.ids.includes(row.userId))) return jsonError("Not found", 404);
  await prisma.talentAssessment.delete({ where: { id } });
  logActivity({
    type: "talent_assessment_removed",
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    description: `Removed a 9-box placement for ${row.period}`,
    targetId: id,
    targetType: "talent_assessment",
    metadata: { userId: row.userId, period: row.period, boxPosition: row.boxPosition, source: row.source },
  });
  return jsonSuccess({ id });
}
