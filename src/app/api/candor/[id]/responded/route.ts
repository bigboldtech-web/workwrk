// GET /api/candor/[id]/responded -> { responded } : has the viewer answered
// this session? Read from CandorRespondent, which records WHO answered and
// never what, so the form stops reopening on a second device and nobody can
// answer twice (it replaced a browser-only flag).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { candorCtx, candorFaces, hasAnsweredCandor } from "@/lib/performance/candor.server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await getSessionOrFail();
  if (error) return error;
  const ctx = await candorCtx();
  if (!ctx) return jsonError("Not found", 404);
  const { id } = await params;
  const s = await prisma.candorSession.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!s) return jsonError("Not found", 404);
  const responded = await hasAnsweredCandor(id, ctx.userId);
  if (!candorFaces(ctx, s, responded).visible && !responded) return jsonError("Not found", 404);
  return jsonSuccess({ responded });
}
