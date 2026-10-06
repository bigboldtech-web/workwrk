// AI teammates (/agents): read on the ai key; who may change what is the
// API's (a workspace agent: Owner and Admin; a private teammate: its owner).
//
// The app-key gate (access-model-spec 5.2.1 row `ai`, 5.5 denials): the
// in-shell 404 for anyone outside the audience and for Guests, <AppOff> when
// the org hid or floored the app. No redirect, no manager tier.
import { AppKeyGate } from "@/components/access/app-key-gate";
import { TEAMMATES_PAGE } from "@/lib/agents/teammate-copy";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AppKeyGate appKey="ai" label={TEAMMATES_PAGE.title} callbackUrl="/agents" back={{ fallbackHref: "/home", label: "Home" }}>
      {children}
    </AppKeyGate>
  );
}
