/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one component down: SurveyDetailClient renders
// <Breadcrumb items/> with the survey's title, which the rule cannot see from here.
// A pulse survey (spec-teams-performance /surveys/[id]). The hub gate first
// (runs surveys, or is targeted by one), then the survey itself: its
// runners at any time, its audience while it is Open, and anyone who has
// answered it (to read their own answers). Anyone else, and a survey that
// does not exist, get the same in-shell 404.

import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cultureGate } from "@/lib/people/culture-gate";
import { surveyCtx, surveyFaces } from "@/lib/performance/survey.server";
import SurveyDetailClient from "./survey-detail-client";

export const dynamic = "force-dynamic";

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await cultureGate("surveys", `/surveys/${id}`);
  const session = await getServerSession(authOptions);
  const ctx = await surveyCtx(session);
  if (!ctx) notFound();
  const s = await prisma.pulseSurvey.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!s) notFound();
  const answered = !!(await prisma.surveyResponse.findUnique({ where: { surveyId_userId: { surveyId: id, userId: ctx.userId } }, select: { id: true } }));
  const faces = surveyFaces(ctx, s, answered);
  if (!faces.visible || (s.status === "DRAFT" && !faces.canManage)) notFound();
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <Suspense>
        <SurveyDetailClient id={id} />
      </Suspense>
    </div>
  );
}
