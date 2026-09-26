// Ask AI (/sidekick): every Member, never a Guest; off when AI features are off.
//
// The app-key gate (access-model-spec 5.2.1 row `ai`, 5.5 denials): the
// in-shell 404 for anyone outside the audience and for Guests, <AppOff> when
// the org hid or floored the app. No redirect, no manager tier.
import { AppKeyGate } from "@/components/access/app-key-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AppKeyGate appKey="ai" label="Ask AI" callbackUrl="/sidekick" back={{ fallbackHref: "/home", label: "Home" }}>
      {children}
    </AppKeyGate>
  );
}
