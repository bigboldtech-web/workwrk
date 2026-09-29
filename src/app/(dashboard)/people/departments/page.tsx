// Teams > Departments (spec-teams-people /people/departments): every Member
// reads; Owner, Admin and whoever the permission matrix grants
// organization.manageDepartments write. The same DepartmentsManager renders
// Settings > Structure > Departments.

import { Suspense } from "react";
import { DepartmentsManager } from "@/components/people/departments-manager";
import { gatePage } from "@/lib/access/gate";

export const dynamic = "force-dynamic";

export default async function DepartmentsPage() {
  // Every Member (Phase 6, spec-teams-people section 1 Access): the Teams
  // hub row gates it, so a Guest gets the in-shell 404 and nobody else does.
  await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: "/people/departments" });
  return (
    <Suspense>
      <DepartmentsManager door="teams" />
    </Suspense>
  );
}
