// Route gate for the Talk module. A server layout (there is no middleware and
// the dashboard layout is a client component) so a bookmarked /tlk can't
// bypass the Settings > Apps & modules switch. With the module off the
// module's pages are replaced by <ModuleOff> at the same URL (access-model
// 5.5 rule 5, example K): Owners and Admins get the switch, Members "Ask an
// admin" with the admins' avatars, Guests the in-shell 404.

import { notFound } from "next/navigation";
import { requireSessionUser } from "@/lib/page-gates";
import { isModuleActive } from "@/lib/entitlements";
import { MODULE_BY_SLUG } from "@/lib/modules";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import { orgRoleOf } from "@/lib/access/org-role";
import { listOrgAdmins } from "@/lib/access/admins";
import { ModuleOff } from "@/components/access";

const MOD = MODULE_BY_SLUG["workwrk-talk"];

export default async function TalkModuleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSessionUser();
  if (await isModuleActive(user.organizationId, MOD.productSlug)) return <>{children}</>;
  if (orgRoleOf({ accessLevel: user.accessLevel }) === "GUEST") notFound();
  const canEnable = legacyIsAdminLevel(user.accessLevel);
  const admins = canEnable ? [] : await listOrgAdmins(user.organizationId);
  return (
    <ModuleOff
      label={MOD.label}
      productSlug={MOD.productSlug}
      canEnable={canEnable}
      admins={admins}
      unlocks="channels, direct messages and calls"
      back={{ fallbackHref: "/announcements", label: "Announcements" }}
    />
  );
}
