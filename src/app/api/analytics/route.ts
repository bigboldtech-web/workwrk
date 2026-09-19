// GET /api/analytics?view=team|org&period=&departmentId=&personId=
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/analytics), W6.
//
// WHAT THIS ROUTE USED TO BE. It joined users, departments, sops, sopCompliance,
// kpiRecords, checkIns and kraAssignments, called getTopPerformers, computed an
// invented "company health score" (KPI 50 percent plus SOP compliance 30 percent
// plus mood 20 percent) and had ZERO consumers in src: the page next door counted
// its own numbers in the browser from five capped list fetches instead.
//
// WHAT IT IS NOW. The five numbers the page prints, the weekly series the chart
// draws, and the two tables, all over Items and the people the viewer is allowed
// to see. The gate is the `analytics` app key (access 5.2.1: anyone with reports
// over their chain, the People team, Owner and Admin; never Guests), not the
// hard-coded eight-string `isManager` array it used to carry.
//
// The scope a caller asks for is checked, never silently downgraded: /api/activity
// used to hand a non-manager their own rows back with the wider tab still lit, and
// that is the failure this route refuses to repeat.

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { loadOrgFacts } from "@/lib/access/facts";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import {
  analyticsScopeAllowed,
  buildAnalytics,
  parseAnalyticsScope,
  periodDays,
  viewerAnalyticsFacts,
} from "@/lib/analytics";

export async function GET(req: NextRequest) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "analytics" });

    const sp = new URL(req.url).searchParams;
    const scope = parseAnalyticsScope(sp.get("view") ?? sp.get("scope"));
    const org = await loadOrgFacts(viewer.organizationId).catch(() => ({ peopleTeamIds: [] as string[] }));
    if (!analyticsScopeAllowed(scope, viewerAnalyticsFacts(viewer, org.peopleTeamIds))) {
      return jsonError("no_access", 403);
    }

    const result = await buildAnalytics(viewer, {
      scope,
      days: periodDays(sp.get("period")),
      personId: sp.get("personId"),
      departmentId: sp.get("departmentId"),
    });

    return jsonSuccess(result, 200, { "Cache-Control": "no-store" });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
