// The ONE gate in front of everything in Talk (spec-talk.md section 2.0).
//
// A server layout, because there is no middleware and the dashboard layout is
// a client component: a bookmarked /tlk must not be able to walk past the
// Settings > Apps & modules switch by arriving before the client boots.
//
// THREE DENIALS, ONE CONVENTION (access-model-spec 5.5):
//
//   module off  -> <ModuleOff>. Owners and Admins get the switch itself,
//                  Members "Ask an admin" with the admins' avatars, a Guest
//                  the in-shell 404. Nothing is deleted while a module is off,
//                  and the copy says so.
//   app hidden  -> <AppOff>. An Admin can hide or floor the `chat` app in
//                  Workspace settings, which is a DIFFERENT act from turning
//                  the module off and deserves a different sentence and a
//                  different door: this one links to /settings/apps.
//   a Guest     -> notFound(), in both cases. A Guest has no business knowing
//                  what this workspace does and does not pay for.
//
// /announcements is NOT under this segment, and that is the Q5 decision made
// structural: Announcements is not module-gated, the Talk hub survives the
// module being off to keep its row reachable (rail-apps.ts
// MODULE_HUB_SURVIVES_ON), and the page itself never asks about Talk. A gate
// that wrapped both would have taken the announcements away with the calls.

import { notFound } from "next/navigation";
import { requireSessionUser } from "@/lib/page-gates";
import { isModuleActive } from "@/lib/entitlements";
import { MODULE_BY_SLUG } from "@/lib/modules";
import { legacyIsAdminLevel, legacyTierAllows, type LegacyTier } from "@/lib/access/legacy-levels";
import { orgRoleOf } from "@/lib/access/org-role";
import { listOrgAdmins } from "@/lib/access/admins";
import { AppOff, ModuleOff } from "@/components/access";
import { parseOrgAppsConfig } from "@/lib/rail-apps";
import { getEffectivePreferences } from "@/lib/preferences";

const MOD = MODULE_BY_SLUG["workwrk-talk"];
const BACK = { fallbackHref: "/announcements", label: "Announcements" } as const;

export default async function TalkModuleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSessionUser();
  const isGuest = orgRoleOf({ accessLevel: user.accessLevel }) === "GUEST";
  const canEnable = legacyIsAdminLevel(user.accessLevel);

  // The module comes first: a workspace that has not turned Talk on has no
  // opinion about whether its `chat` app is hidden, and offering the Apps page
  // to somebody whose answer is the Modules page would be the wrong door.
  if (!(await isModuleActive(user.organizationId, MOD.productSlug))) {
    if (isGuest) notFound();
    const admins = canEnable ? [] : await listOrgAdmins(user.organizationId);
    return (
      <ModuleOff
        label={MOD.label}
        productSlug={MOD.productSlug}
        canEnable={canEnable}
        admins={admins}
        unlocks="channels, direct messages and calls"
        back={BACK}
      />
    );
  }

  // The app key. An Admin who hides or floors `chat` in Workspace settings >
  // Apps & modules > Rail apps removes the rail entry, and before this the
  // PAGE stayed reachable by URL: the nav said one thing and the route said
  // another, which is exactly the fragmentation critic #4 names.
  const prefs = await getEffectivePreferences(user.id, user.organizationId).catch(() => null);
  // A failed preference read must never lock somebody out of Talk: the app is
  // visible unless the stored config actually says otherwise.
  const config = prefs ? parseOrgAppsConfig(prefs.sidebar?.apps) : {};
  const floor = config.minAccess?.chat;
  const visible = !(config.hidden ?? []).includes("chat")
    && (!floor || legacyTierAllows(floor as LegacyTier, user.accessLevel));
  if (!visible) {
    if (isGuest) notFound();
    const admins = canEnable ? [] : await listOrgAdmins(user.organizationId);
    return <AppOff label={MOD.label} isAdmin={canEnable} admins={admins} back={BACK} />;
  }

  return <>{children}</>;
}
