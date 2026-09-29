// Teams > Skills (spec-teams-people /people/skills): every Member reads skill
// names and holder counts and adds skills to their own record; ratings,
// averages and the Gap and Expert marks are computed by GET /api/skills only
// over the people the viewer may read.

import { Suspense } from "react";
import SkillsClient from "./skills-client";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  // Every Member (Phase 6, spec-teams-people section 1 Access): the Teams
  // hub row gates it, so a Guest gets the in-shell 404 and nobody else does.
  await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: "/people/skills" });
  return (
    <Suspense>
      <SkillsClient />
    </Suspense>
  );
}
