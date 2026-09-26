// Teams > Talent (9-box). Gate (Phase 6, spec-teams-performance section 0):
// the `talent` APP_RULES row, anyone with reports (their chain), the People
// team and Admin (the org), in the page itself. It replaces talent/layout.tsx
// (requireManagerOr404, a different ladder from its own sidebar row). The
// grid population is scoped again by GET /api/talent-assessment, and a
// person never sees their own placement.

import { gatePage } from "@/lib/access/gate";
import TalentClient from "./talent-client";

export const dynamic = "force-dynamic";

export default async function TalentPage() {
  await gatePage("view", { type: "app", key: "talent" }, { callbackUrl: "/talent" });
  return <TalentClient />;
}
