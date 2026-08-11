// People · Skills — manager door (org-wide skill matrix).

import SkillsClient from "./skills-client";
import { requireManagerPage } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  await requireManagerPage();
  return <SkillsClient />;
}
