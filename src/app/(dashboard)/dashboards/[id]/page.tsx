/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one component down: DashboardClient renders
// <Breadcrumb items/> once it knows the dashboard's name, which the rule
// cannot see from this file (the docs/[id] precedent).

// /dashboards/[id]: one dashboard's canvas (decision 1). Server half: the
// gate with this page as the sign-in callback, the member rule (a Guest gets
// the in-shell 404, as every dashboard route answers them), and the one flag
// the first paint needs. Everything else, including "not found" and the
// archived dashboard's Restore, is the client's, over the dashboard routes.

import { notFound } from "next/navigation";
import { gatePage } from "@/lib/access/gate";
import { dashboardsAllowedFor } from "@/lib/dashboards/dashboard-access";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { viewer } = await gatePage("view", { type: "app", key: "home" }, { callbackUrl: `/dashboards/${id}` });
  if (!dashboardsAllowedFor(viewer.orgRole)) notFound();
  return <DashboardClient id={id} startRename={sp.rename === "1"} />;
}
