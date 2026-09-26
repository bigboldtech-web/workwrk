// A Candor session. The hub gate first (organiser, or invited to answer);
// the session itself is scoped again by GET /api/candor, so a session
// outside the viewer's scope never loads.

import { cultureGate } from "@/lib/people/culture-gate";
import CandorSessionClient from "./candor-session-client";

export const dynamic = "force-dynamic";

export default async function CandorSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await cultureGate("candor", `/candor/${id}`);
  return <CandorSessionClient />;
}
