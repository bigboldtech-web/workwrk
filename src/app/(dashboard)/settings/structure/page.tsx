// Workspace settings > Structure (spec-settings-workspace
// `/settings/structure`, settings-architecture 5.6): the shape of the
// company. Tabs Departments, Job titles, Offices, Profile fields and Org
// chart; the four-role strip with live counts is the first element of the
// body on every tab (it replaces the hand-written ten-rung ladder prose,
// which drifted from the real model; the one explainer is on Access).
//
// Server component: gates through SettingsGate's rule, runs the counts
// (every number live, never invented), then hands the tabs to the client.

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { settingsGateAllows, SettingsDenied } from "@/components/settings/settings-gate";
import { sessionIsWorkspaceAdmin } from "@/lib/access/workspace-admin";
import { roleCountsFor } from "@/lib/access/role-counts";
import { StructureClient } from "./structure-client";

export const dynamic = "force-dynamic";

export default async function StructurePage() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) redirect("/login");
  if (!(await settingsGateAllows("structure"))) return <SettingsDenied page="structure" />;
  const orgId = u.organizationId;

  const [counts, unlinked] = await Promise.all([
    roleCountsFor(orgId),
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null, status: { not: "INACTIVE" }, managerId: null } }),
  ]);

  return <StructureClient counts={counts} unlinked={unlinked} canEdit={sessionIsWorkspaceAdmin(session)} />;
}
