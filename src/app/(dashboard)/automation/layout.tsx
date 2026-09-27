// Automation (/automation/*): every Member reads; writes are gated per route.
//
// The app-key gate (access-model-spec 5.2.1 row `automation`, 5.5 denials): the
// in-shell 404 for anyone outside the audience and for Guests, <AppOff> when
// the org hid or floored the app. No redirect, no manager tier.
import { AppKeyGate } from "@/components/access/app-key-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AppKeyGate appKey="automation" label="Automation" callbackUrl="/automation/workflows" back={{ fallbackHref: "/home", label: "Home" }}>
      {children}
    </AppKeyGate>
  );
}
