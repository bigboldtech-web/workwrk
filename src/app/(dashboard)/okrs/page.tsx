// /okrs — goals list. The gate runs HERE, server-side, before the client
// body renders: requireGoalsPage resolves the session (bounce to /login
// otherwise). Row-level visibility is the API's job — GET /api/okrs
// filters three-door (employee: own + audience + COMPANY; manager:
// + report tree; admin/HR: org-wide) — and /okrs/[id] re-checks the same
// rule per goal via requireGoalPage, so a guessed URL never leaks a goal.
//
// Query params (both linked from the profile hero + sidebar):
//   ?new=1         auto-open the create-goal modal on load
//   ?view=team     the manager's report tree (sidebar row "Team goals")
//   ?view=company  COMPANY-level goals (sidebar row "Company goals")
//   ?mine=1        only goals the viewer carries (owner or resolved member),
//                  enforced server-side by GET /api/okrs?mine=1
//
// `?view=` is the canon form spec-goals section 1 prints; `?team=1` and
// `?level=company` are the retired forms, still READ here so stored links and
// old bookmarks keep landing on the cut they named. They are never printed.
// Until this mapping existed the two sidebar rows that are the only doors to
// Team goals and Company goals both rendered the unfiltered list, silently.

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
  const view = typeof sp.view === "string" ? sp.view : undefined;
  const legacyLevel = typeof sp.level === "string" ? sp.level : undefined;
  const level = view === "company" ? "company" : legacyLevel;
  const team = view === "team" || sp.team === "1";
  return <OkrsClient initialNew={sp.new === "1"} mine={sp.mine === "1"} team={team} level={level} />;
}
