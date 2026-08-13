// /okrs — goals list. The gate runs HERE, server-side, before the client
// body renders: requireGoalsPage resolves the session (bounce to /login
// otherwise). Row-level visibility is the API's job — GET /api/okrs
// filters three-door (employee: own + audience + COMPANY; manager:
// + report tree; admin/HR: org-wide) — and /okrs/[id] re-checks the same
// rule per goal via requireGoalPage, so a guessed URL never leaks a goal.
//
// Query params (both linked from the profile hero + sidebar):
//   ?new=1  — auto-open the create-goal modal on load
//   ?mine=1 — only goals the viewer carries (owner or resolved member);
//             enforced server-side by GET /api/okrs?mine=1

import { requireGoalsPage } from "@/lib/page-gates";
import OkrsClient from "./okrs-client";

export const dynamic = "force-dynamic";

export default async function OkrsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireGoalsPage();
  const sp = await searchParams;
  return <OkrsClient initialNew={sp.new === "1"} mine={sp.mine === "1"} />;
}
