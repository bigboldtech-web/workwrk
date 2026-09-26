// Teams > Job titles: every Member reads the library (Phase 6); the create
// and delete controls render only for the people POST /api/roles admits.

import { Suspense } from "react";
import RolesClient from "./roles-client";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  // Every Member (Phase 6, spec-teams-people section 1 Access): the Teams
  // hub row gates it, so a Guest gets the in-shell 404 and nobody else does.
  await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: "/people/roles" });
  return (
    <Suspense>
      <RolesClient />
    </Suspense>
  );
}
