// The Tables module gate, shared by the two directories the module owns
// (/tables and /forms; spec-shell 1.1 puts both in the tables hub). A
// server component, because there is no middleware and the dashboard layout
// is a client component, so a bookmarked URL cannot bypass the
// Settings > Apps & modules switch. With the module off the module's pages
// are replaced by <ModuleOff> at the same URL (access-model 5.5 rule 5,
// example K): Owners and Admins get the switch, Members "Ask an admin" with
// the admins' avatars, Guests the in-shell 404.

import { notFound } from "next/navigation";
import { requireSessionUser } from "@/lib/page-gates";
import { isGuestViewer, isOrgAdminViewer } from "@/lib/route-guard";
import { isModuleActive } from "@/lib/entitlements";
import { MODULE_BY_SLUG } from "@/lib/modules";
import { listOrgAdmins } from "@/lib/access/admins";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { HUB_LABELS } from "@/lib/nav/labels";
import { ModuleOff } from "./denial-views";

const MOD = MODULE_BY_SLUG["workwrk-tables"];

export async function TablesModuleGate({ children }: { children: React.ReactNode }) {
  const user = await requireSessionUser();
  if (await isModuleActive(user.organizationId, MOD.productSlug)) return <>{children}</>;
  // The tier reads live in route-guard (the one transcription), not here.
  if (await isGuestViewer()) notFound();
  const canEnable = await isOrgAdminViewer();
  const admins = canEnable ? [] : await listOrgAdmins(user.organizationId);
  return (
    <ModuleOff
      label={MOD.label}
      productSlug={MOD.productSlug}
      canEnable={canEnable}
      admins={admins}
      unlocks="tables and forms"
      back={{ fallbackHref: WORK_HOME_HREF, label: HUB_LABELS.home }}
    />
  );
}
