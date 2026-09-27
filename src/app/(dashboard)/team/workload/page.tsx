// Teams > Workload (spec-teams-people /team/workload): who on my team has
// too much or too little scheduled work over the next weeks.
//
// Gate: the `workload` APP_RULES row, anyone with reports (solid or dotted),
// the People team, Owner, Admin; a Member with nobody reporting to them gets
// the sanctioned LockedPage without Request access (never the old silent
// redirect). A Guest gets the in-shell 404.
//
// The page is a client over GET /api/team/workload (team-workload-view.tsx),
// so moving the window is a fetch, never a page reload. The grid is the same
// WorkloadGrid a List's WORKLOAD view renders.

import { LockedPage } from "@/components/access";
import { teamAppGate, WORKLOAD_LOCKED_SENTENCE } from "@/lib/people/team-gate";
import { TeamWorkloadView } from "./team-workload-view";

export const dynamic = "force-dynamic";

export default async function TeamWorkloadPage() {
  const gate = await teamAppGate("workload", "/team/workload");
  if (gate.status === "locked") {
    return <LockedPage name="Workload" sentence={WORKLOAD_LOCKED_SENTENCE} back={{ fallbackHref: "/people", label: "Directory" }} />;
  }
  return <TeamWorkloadView />;
}
