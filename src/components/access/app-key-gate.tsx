// The page half of an app-key gate, for a server layout (access 5.5).
//
//   not signed in          -> /login?callbackUrl= (gatePage, the one redirect)
//   outside the audience   -> the in-shell 404 (gatePage: not discoverable)
//   a Guest, app off       -> the in-shell 404
//   hidden or floored      -> <AppOff>, with /settings/apps for Owners and Admins
//   ai with AI features off-> <AppOff reason="ai-disabled">, with /settings/data
//
// Server only. One component so /sidekick, /agents, /automation, /store,
// /integrations, /build, /tools and /assets answer the same way.

import { notFound } from "next/navigation";
import { gatePage } from "@/lib/access/gate";
import { loadOrgFacts } from "@/lib/access/facts";
import { listOrgAdmins } from "@/lib/access/admins";
import type { AppKey } from "@/lib/access/types";
import { AppOff } from "./denial-views";

export async function AppKeyGate({
  appKey,
  label,
  callbackUrl,
  back,
  children,
}: {
  appKey: AppKey;
  label: string;
  callbackUrl: string;
  back: { fallbackHref: string; label: string };
  children: React.ReactNode;
}) {
  const { viewer, decision } = await gatePage("view", { type: "app", key: appKey }, { callbackUrl });
  if (decision.allowed) return <>{children}</>;
  if (viewer.orgRole === "GUEST") notFound();
  if (decision.via === "app-off") {
    const isAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
    const admins = isAdmin ? [] : await listOrgAdmins(viewer.organizationId);
    let reason: "hidden" | "ai-disabled" = "hidden";
    if (appKey === "ai") {
      const org = await loadOrgFacts(viewer.organizationId).catch(() => null);
      const hidden = (org?.apps.hidden ?? []).includes("ai") || Boolean(org?.apps.minAccess?.ai);
      if (org?.aiEnabled === false && !hidden) reason = "ai-disabled";
    }
    return <AppOff label={label} isAdmin={isAdmin} admins={admins} back={back} reason={reason} />;
  }
  // Discoverable but not allowed for any other reason: nothing in these
  // apps is an object the viewer could request, so it is the in-shell 404.
  notFound();
}

/**
 * Access step 3 for the app pages that had no gate (Phase 8 stages E and F,
 * settings-architecture S7: rail floors and hides become real gates), in the
 * same three states as the Workspace settings door (settings-gate-engine.ts):
 *
 *   flags off (the default)       the page is exactly as open as it was
 *   SETTINGS_GATE_LOG_ONLY=true   still open; the engine is asked and every
 *                                 would-be denial is logged (stderr, sampled,
 *                                 and one audit row per person per app per
 *                                 day), so the week before enforcement names
 *                                 everyone a hide or floor would lock out
 *   ACCESS_V2_RESOLVER=true       AppKeyGate: a hidden or floored app locks
 *   (log-only off)                its routes too (spec 7.1), and a Guest
 *                                 meets the in-shell 404
 */
export async function FlaggedAppKeyGate(props: Parameters<typeof AppKeyGate>[0]) {
  const { accessV2Resolver, settingsGateLogOnly } = await import("@/lib/access/flags");
  const { settingsGateMode } = await import("@/lib/access/settings-gate-engine");
  const mode = settingsGateMode({ resolver: accessV2Resolver(), logOnly: settingsGateLogOnly() });
  if (mode === "engine") return <AppKeyGate {...props} />;
  if (mode === "observe") {
    const { observeAppRoute } = await import("@/lib/access/app-route-observe");
    await observeAppRoute(props.appKey, props.label);
  }
  return <>{props.children}</>;
}
