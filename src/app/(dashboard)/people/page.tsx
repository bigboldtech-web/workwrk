// Teams > Directory: every Member (Phase 6). A Member who is not org-wide
// gets the directory card only (GET /api/users?scope=directory); people
// data stays behind the person record's own gate.

import PeopleDirectoryClient from "./directory-client";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function PeopleDirectoryPage() {
  // Every Member (Phase 6, spec-teams-people section 1 Access): the Teams
  // hub row gates it, so a Guest gets the in-shell 404 and nobody else does.
  await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: "/people" });
  return <PeopleDirectoryClient />;
}
