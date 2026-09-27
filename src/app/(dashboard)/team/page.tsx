// Teams > My team (spec-teams-people /team): what the people who report to
// me are working on, and what they need from me.
//
// Gate: the `team` APP_RULES row, anyone with reports (solid or dotted, any
// depth), the People team, Owner, Admin. A Member with nobody reporting to
// them gets the sanctioned LockedPage without Request access
// (src/lib/people/team-gate.ts); a Guest gets the in-shell 404.
//
// Everything else is the client (team-client.tsx) over
// GET /api/team/attention and GET /api/team/members-work, so filters, sort
// and pages are URL state and never a full-page reload.
//
// Where yesterday's page parts live now:
//   the four stat tiles       gone (spec: the Roles tile was org-wide beside
//                             chain-scoped neighbours, PO-24). People is the
//                             footer total; Job titles, KRAs and KPIs are the
//                             sidebar rows Job titles and KRAs & KPIs.
//   the three shortcut cards  the Teams sidebar rows (Directory, Org chart,
//                             Job titles, KRAs & KPIs, Alignment, Weekly
//                             reviews, KPI reviews, Workload; Sub-teams is the
//                             Alignment page's second view).
//   Team pulse cards          the "What everyone is working on" table.

import { LockedPage } from "@/components/access";
import { teamAppGate, TEAM_LOCKED_SENTENCE } from "@/lib/people/team-gate";
import TeamClient from "./team-client";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const gate = await teamAppGate("team", "/team");
  if (gate.status === "locked") {
    return <LockedPage name="My team" sentence={TEAM_LOCKED_SENTENCE} back={{ fallbackHref: "/people", label: "Directory" }} />;
  }
  return <TeamClient />;
}
