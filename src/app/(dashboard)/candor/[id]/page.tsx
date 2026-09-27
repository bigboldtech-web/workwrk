// A Candor session (spec-teams-performance /candor/[id]). The hub gate
// first (runs sessions, or is invited to answer), then the session itself:
// its owner, the People team and Admin at any time, anyone in its scope
// while it is Open. Anyone else, and a session that does not exist, get the
// same in-shell 404 (a session is never discoverable out of scope).

import { Suspense } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cultureGate } from "@/lib/people/culture-gate";
import { candorCtx, candorFaces, hasAnsweredCandor } from "@/lib/performance/candor.server";
import CandorSessionClient from "./candor-session-client";

export const dynamic = "force-dynamic";

export default async function CandorSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await cultureGate("candor", `/candor/${id}`);
  const ctx = await candorCtx();
  if (!ctx) notFound();
  const s = await prisma.candorSession.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { createdBy: true, status: true, departmentId: true } });
  if (!s) notFound();
  const answered = await hasAnsweredCandor(id, ctx.userId);
  if (!candorFaces(ctx, s, answered).visible) notFound();
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <Suspense>
        <CandorSessionClient id={id} />
      </Suspense>
    </div>
  );
}
