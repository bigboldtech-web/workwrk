// Run history (/process-runs) is a MEMBER's page.
//
// Spec: docs/plans/ui-refresh/spec-process.md section 0 and section 1
// ("every Member (My runs view); Team runs view for hasReports; All runs for
// People team, Owner, Admin") and sidebar-map section 6 row 11.
//
// WHAT WAS HERE, AND WHY IT WENT. `await requireManagerOr404()`, which calls
// `notFound()` for anyone on a legacy employee level. So a person assigned a
// checklist SOP could run it, but could not open the history of their OWN
// runs: the page 404'd before it rendered. Meanwhile the API underneath has
// always scoped correctly per role (api/process-runs/route.ts resolves
// `all` for the People team and admins, `team` for anyone with reports and
// `own` for everybody else), so the layout was the only thing keeping a
// Member out of rows the server was already willing to give them.
//
// The gate that replaces it is the `sops` app key, whose APP_RULES row
// (src/lib/access/settings.ts) reads audience "member": every Member, and a
// Guest only through a share. That keeps a real gate on the route, opens it
// to the people whose runs it lists, and leaves WHICH runs to the API.
//
// The scoped views (`?view=my|team|all`) and their "views a viewer cannot
// hold" notice lines are spec-process step 2, on the page itself.

import { gatePage } from "@/lib/access/gate";

export default async function ProcessRunsLayout({ children }: { children: React.ReactNode }) {
  await gatePage("view", { type: "app", key: "sops" }, { callbackUrl: "/process-runs" });
  return <>{children}</>;
}
