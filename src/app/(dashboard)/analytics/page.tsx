// /analytics: how the people you manage are doing on their work.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/analytics), W6.
//
// The server half is the one thing the first paint cannot guess: which scope
// pills this viewer may use. A manager gets "My team" alone; the People team,
// Owner and Admin also get "Everyone". The page never renders a pill whose
// request would 403, which is the same rule /activity follows.
//
// The gate itself is in layout.tsx, on the `analytics` app key.

import { gatePage } from "@/lib/access/gate";
import { notFound } from "next/navigation";
import { loadOrgFacts } from "@/lib/access/facts";
import {
  allowedAnalyticsScopes,
  parseAnalyticsScope,
  viewerAnalyticsFacts,
} from "@/lib/analytics-view";
import { AnalyticsClient } from "./analytics-client";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; period?: string }>;
}) {
  const { viewer } = await gatePage("view", { type: "app", key: "analytics" }, { callbackUrl: "/analytics" });
  if (viewer.orgRole === "GUEST") notFound();

  const sp = await searchParams;
  const org = await loadOrgFacts(viewer.organizationId).catch(() => ({ peopleTeamIds: [] as string[] }));
  const facts = viewerAnalyticsFacts(viewer, org.peopleTeamIds);
  const scopes = allowedAnalyticsScopes(facts);
  const asked = parseAnalyticsScope(sp.view);

  return (
    <AnalyticsClient
      scopes={scopes}
      // A person arriving on ?view=org without the standing for it lands on
      // their own team rather than on a 403: the URL is a request, not a claim.
      initialScope={scopes.includes(asked) ? asked : "team"}
      initialPeriod={sp.period ?? null}
      // Department only narrows the org-wide view, so the picker is only worth
      // loading for somebody who has that pill.
      canPickDepartment={scopes.includes("org")}
      canExport={!viewer.isAgent && !viewer.actingAs}
    />
  );
}
