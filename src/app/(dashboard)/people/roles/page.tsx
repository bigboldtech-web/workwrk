// Teams > Job titles (spec-teams-people /people/roles): every Member reads
// the list; Owner, Admin and the People team (and the tier that wrote job
// titles yesterday) create, rename and delete. The same JobTitlesList
// renders Settings > Structure > Job titles.

import { Suspense } from "react";
import { JobTitlesList } from "@/components/people/job-titles-list";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  // Every Member (Phase 6, spec-teams-people section 1 Access): the Teams
  // hub row gates it, so a Guest gets the in-shell 404 and nobody else does.
  await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: "/people/roles" });
  return (
    <Suspense>
      <JobTitlesList door="teams" />
    </Suspense>
  );
}
