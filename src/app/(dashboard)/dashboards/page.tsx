// /dashboards: every dashboard in the workspace (decision 1), under the Work
// hub. Server half: the gate, the member rule and the one flag the first
// paint needs; the list itself is the client's, over GET /api/dashboards.
//
// A Guest gets the in-shell 404 (dashboardsAllowedFor), exactly like every
// dashboard route answers them, and their Work sidebar has no Dashboards row.
// `?new=1` (the retired app's rail action, and old bookmarks of it) runs New
// dashboard once; the client strips the parameter first, so a refresh never
// makes a second one.

import { notFound } from "next/navigation";
import { gatePage } from "@/lib/access/gate";
import { dashboardsAllowedFor } from "@/lib/dashboards/dashboard-access";
import { DashboardsClient } from "./dashboards-client";

export const dynamic = "force-dynamic";

export default async function DashboardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { viewer } = await gatePage("view", { type: "app", key: "home" }, { callbackUrl: "/dashboards" });
  if (!dashboardsAllowedFor(viewer.orgRole)) notFound();
  const sp = await searchParams;
  return <DashboardsClient openNew={sp.new === "1"} />;
}
