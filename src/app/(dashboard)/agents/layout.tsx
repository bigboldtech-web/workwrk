// Agents (/agents): read on the ai key; writes are Owner and Admin in the API.
//
// The app-key gate (access-model-spec 5.2.1 row `ai`, 5.5 denials): the
// in-shell 404 for anyone outside the audience and for Guests, <AppOff> when
// the org hid or floored the app. No redirect, no manager tier.
import { AppKeyGate } from "@/components/access/app-key-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AppKeyGate appKey="ai" label="Agents" callbackUrl="/agents" back={{ fallbackHref: "/home", label: "Home" }}>
      {children}
    </AppKeyGate>
  );
}
