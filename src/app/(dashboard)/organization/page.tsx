// Organization — org chart. Manager door: reporting lines across the org
// are a management surface; employees reach their own manager + role from
// their career home (/people/me).

import OrgChartClient from "./org-chart-client";
import { requireManagerPage } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function OrganizationPage() {
  await requireManagerPage();
  return <OrgChartClient />;
}
