// The Tables module gate for /tables (spec-shell 1.1). /forms used to mount
// it too; Forms is core since founder decision D15 and has its own Guest-only
// gate (forms-gate.tsx), so with the module off a Member still has Forms. A
// server component, because there is no middleware and the dashboard layout
// is a client component, so a bookmarked URL cannot bypass the
// Settings > Apps & modules switch. With the module off the module's pages
// are replaced by <ModuleOff> at the same URL (access-model 5.5 rule 5,
// example K): Owners and Admins get the switch, Members "Ask an admin" with
// the admins' avatars, Guests the in-shell 404.

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireSessionUser } from "@/lib/page-gates";
import { pageViewerIsGuest, pageViewerIsWorkspaceAdmin } from "@/lib/access/page-viewer";
import { isModuleActive } from "@/lib/entitlements";
import { MODULE_BY_SLUG } from "@/lib/modules";
import { listOrgAdmins } from "@/lib/access/admins";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { HUB_LABELS } from "@/lib/nav/labels";
import { ModuleOff } from "./denial-views";
import { moduleNeedsUpgradeFor } from "@/lib/module-plan.server";
import { sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";

const MOD = MODULE_BY_SLUG["workwrk-tables"];

/**
 * The module-off state on its own, for a caller that has already resolved
 * the session: null when the module is on, <ModuleOff> for Owners, Admins
 * and Members, and notFound() (the gate's one throw) for a Guest. The
 * /tables layout and the Work table routes (src/components/access/
 * work-object-gate.tsx) both answer through it, so a table opened from Work
 * shows exactly the state /tables/[id] shows.
 */
export async function tablesModuleOffView(user: { organizationId: string }): Promise<ReactNode | null> {
  if (await isModuleActive(user.organizationId, MOD.productSlug)) return null;
  // The role reads live in src/lib/access/page-viewer.ts, not here.
  if (await pageViewerIsGuest()) notFound();
  const canEnable = await pageViewerIsWorkspaceAdmin();
  const [admins, needsUpgrade, canChangePlan] = await Promise.all([
    canEnable ? Promise.resolve([]) : listOrgAdmins(user.organizationId),
    moduleNeedsUpgradeFor(user.organizationId, MOD.productSlug),
    requireSessionUser().then((u) => sessionMayManageOwnerPage({ user: u }, "billing")),
  ]);
  return (
    <ModuleOff
      label={MOD.label}
      productSlug={MOD.productSlug}
      canEnable={canEnable}
      needsUpgrade={needsUpgrade}
      canChangePlan={canChangePlan}
      admins={admins}
      unlocks="tables"
      back={{ fallbackHref: WORK_HOME_HREF, label: HUB_LABELS.home }}
    />
  );
}

export async function TablesModuleGate({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();
  return (await tablesModuleOffView(user)) ?? <>{children}</>;
}
