import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { enrichKeyResults, KR_KPI_SELECT, rollUpOkrProgress } from "@/lib/alignment";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const okr = await prisma.oKR.findFirst({
    where: { id, organizationId: getOrgId(session) },
    include: {
      keyResults: {
        include: {
          checkIns: { orderBy: { createdAt: "desc" }, take: 5 },
          kpi: { select: KR_KPI_SELECT },
        },
      },
      children: { select: { id: true, title: true, progress: true, level: true } },
    },
  });
  if (!okr) return jsonError("Not found", 404);

  // KRs linked to a KPI read the gauge's latest number (read-side derivation);
  // objective progress rolls up from those live values.
  const keyResults = await enrichKeyResults(okr.keyResults, { userId: okr.ownerId });
  const rolled = rollUpOkrProgress(keyResults);
  return jsonSuccess({ ...okr, keyResults, progress: rolled ?? okr.progress });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const okr = await prisma.oKR.findFirst({ where: { id, organizationId: getOrgId(session) } });
  if (!okr) return jsonError("Not found", 404);
  await prisma.oKR.delete({ where: { id } });
  return jsonSuccess({ message: "Deleted" });
}
