// Build apps (/build, /build/[slug]): Owner and Admin; a Member gets the
// in-shell 404, never AppOff, with one exception.
//
// The app-key gate (access-model-spec 5.2.1 row `build`, 5.5 denials): the
// in-shell 404 for anyone outside the audience and for Guests, <AppOff> when
// the org hid or floored the app. No redirect, no manager tier.
//
// The Member exception (src/lib/build/gate.ts): in an org that has built
// apps, a Member keeps the pages for using them (open a live app, change its
// rows), as before Build apps became Owner and Admin. Creating one stays
// Owner and Admin; the API decides every write.
import { AppKeyGate } from "@/components/access/app-key-gate";
import { viewerFromSession } from "@/lib/access/viewer";
import { can } from "@/lib/access/index";
import { countUsableBuildApps } from "@/lib/build/gate";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const viewer = await viewerFromSession();
  if (viewer && viewer.orgRole !== "GUEST" && viewer.orgRole !== "OWNER" && viewer.orgRole !== "ADMIN") {
    const decision = await can(viewer, "view", { type: "app", key: "build" });
    if (!decision.allowed && decision.via !== "app-off" && (await countUsableBuildApps(viewer.organizationId, viewer.userId)) > 0) {
      return <>{children}</>;
    }
  }
  return (
    <AppKeyGate appKey="build" label="Build apps" callbackUrl="/build" back={{ fallbackHref: "/home", label: "Home" }}>
      {children}
    </AppKeyGate>
  );
}
