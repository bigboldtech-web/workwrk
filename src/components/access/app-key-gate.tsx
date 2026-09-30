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
 * Access step 3 for the app pages that had no gate (Phase 8 stage E): the
 * same AppKeyGate, applied only with ACCESS_V2_RESOLVER on, so the shipped
 * default leaves these pages exactly as open as they were. With the flag on,
 * a hidden or floored app locks its routes too (spec 7.1), and a Guest meets
 * the in-shell 404.
 */
export async function FlaggedAppKeyGate(props: Parameters<typeof AppKeyGate>[0]) {
  const { accessV2Resolver } = await import("@/lib/access/flags");
  if (!accessV2Resolver()) return <>{props.children}</>;
  return <AppKeyGate {...props} />;
}
