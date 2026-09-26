// Teams > Skills: every Member reads skill names and holders; ratings are
// scoped by GET /api/skills to the people the viewer holds people data on.

import SkillsClient from "./skills-client";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  // Every Member (Phase 6, spec-teams-people section 1 Access): the Teams
  // hub row gates it, so a Guest gets the in-shell 404 and nobody else does.
  await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: "/people/skills" });
  return <SkillsClient />;
}
