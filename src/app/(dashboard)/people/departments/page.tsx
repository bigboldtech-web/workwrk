// Teams > Departments: every Member reads; the write controls render from
// the manageDepartments permission inside the page (Phase 6).

import DepartmentsClient from "./departments-client";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function DepartmentsPage() {
  // Every Member (Phase 6, spec-teams-people section 1 Access): the Teams
  // hub row gates it, so a Guest gets the in-shell 404 and nobody else does.
  await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: "/people/departments" });
  return <DepartmentsClient />;
}
