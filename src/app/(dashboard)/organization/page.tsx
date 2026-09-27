// Teams > Org chart: every Member reads the whole tree (Phase 6), over the
// directory card projection of GET /api/users.

import { Suspense } from "react";
import OrgChartClient from "./org-chart-client";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function OrganizationPage() {
  // Every Member (Phase 6, spec-teams-people section 1 Access): the Teams
  // hub row gates it, so a Guest gets the in-shell 404 and nobody else does.
  await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: "/organization" });
  return (
    <Suspense>
      <OrgChartClient />
    </Suspense>
  );
}
