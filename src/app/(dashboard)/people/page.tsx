// Teams > Directory: every Member (Phase 6). Every Member lists the whole
// org's directory cards (GET /api/users?scope=directory); people data rides
// only for the people the viewer may read, and the record's own gate.

import { Suspense } from "react";
import PeopleDirectoryClient from "./directory-client";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function PeopleDirectoryPage() {
  // Every Member (Phase 6, spec-teams-people section 1 Access): the Teams
  // hub row gates it, so a Guest gets the in-shell 404 and nobody else does.
  await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: "/people" });
  return (
    <Suspense>
      <PeopleDirectoryClient />
    </Suspense>
  );
}
