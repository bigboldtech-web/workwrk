// /okrs — goals list. The gate runs HERE, server-side, before the client
// body renders: requireGoalsPage resolves the session (bounce to /login
// otherwise). Row-level visibility is the API's job — GET /api/okrs
// filters three-door (employee: own + audience + COMPANY; manager:
// + report tree; admin/HR: org-wide) — and /okrs/[id] re-checks the same
// rule per goal via requireGoalPage, so a guessed URL never leaks a goal.

import { requireGoalsPage } from "@/lib/page-gates";
import OkrsClient from "./okrs-client";

export const dynamic = "force-dynamic";

export default async function OkrsPage() {
  await requireGoalsPage();
  return <OkrsClient />;
}
