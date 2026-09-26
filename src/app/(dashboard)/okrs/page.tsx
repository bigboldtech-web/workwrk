// /okrs — goals list. The gate runs HERE, server-side, before the client
// body renders: requireGoalsPage resolves the session (bounce to /login
// otherwise). Row-level visibility is the API's job — GET /api/okrs
// filters three-door (employee: own + audience + COMPANY; manager:
// + report tree; admin/HR: org-wide) — and /okrs/[id] re-checks the same
// rule per goal via requireGoalPage, so a guessed URL never leaks a goal.
//
// Query params, one URL per view (spec-goals section 1 naming canon):
//   /okrs          My goals: the goals the viewer owns or contributes to,
//                  plus their department's goals (GET /api/okrs?mine=1)
//   ?view=team     Team goals: the report tree, or the org for org-wide
//                  levels (GET /api/okrs?team=1)
//   ?view=company  Company goals
//   ?new=1         auto-open the create-goal modal on load
//
// The retired forms `?mine=1`, `?team=1` and `?level=company` are READ for
// one release and canonicalised client-side with router.replace, so stored
// links and old bookmarks land on the view they named (src/lib/nav/
// goals-view.ts). A Member with no reports who opens ?view=team gets My
// goals with one notice line (access 5.5 rule 4), never a Team title over
// their own list.

import { requireGoalsPage } from "@/lib/page-gates";
import { isOrgWideAlignment } from "@/lib/alignment-scope";
import { can } from "@/lib/access/index";
import { viewerFromSession } from "@/lib/access/viewer";
import { canonicalGoalsView } from "@/lib/nav/goals-view";
import OkrsClient from "./okrs-client";

export const dynamic = "force-dynamic";

export default async function OkrsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireGoalsPage();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  // Team goals is the report tree (the org for org-wide levels): anyone with
  // reports, the People team or Admin (the same facts the sidebar row reads,
  // asked of the engine through the `alignment` row, which states exactly
  // them), plus the org-wide levels GET /api/okrs?team=1 widens to the org.
  const engineViewer = await viewerFromSession();
  const canTeam =
    isOrgWideAlignment({ user: viewer }) ||
    (engineViewer ? (await can(engineViewer, "view", { type: "app", key: "alignment" })).allowed : false);
  const resolved = canonicalGoalsView(
    { view: str("view"), mine: str("mine"), team: str("team"), level: str("level"), new: str("new") },
    { canTeam },
  );
  return (
    <OkrsClient
      initialNew={str("new") === "1"}
      view={resolved.view}
      legacyLevel={resolved.legacyLevel}
      canonicalHref={resolved.canonicalHref}
      notice={resolved.notice}
    />
  );
}
