// A pulse survey. The hub gate first (organiser, or targeted); the survey
// itself is gated again by GET /api/pulse-surveys/[id] (its audience, or an
// organiser).

import { cultureGate } from "@/lib/people/culture-gate";
import SurveyDetailClient from "./survey-detail-client";

export const dynamic = "force-dynamic";

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await cultureGate("surveys", `/surveys/${id}`);
  return <SurveyDetailClient />;
}
