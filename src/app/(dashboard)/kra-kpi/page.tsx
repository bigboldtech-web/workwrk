// KRA / KPI — job-title-first workspace (role picker). Manager door:
// templates are defined per job title here; an employee sees their OWN
// inherited KRAs/KPIs with their readings on their career home.

import { Suspense } from "react";
import KraKpiWorkspaceClient from "./workspace-client";
import { requireManagerPage } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function KraKpiPage() {
  await requireManagerPage();
  return (
    <Suspense>
      <KraKpiWorkspaceClient />
    </Suspense>
  );
}
