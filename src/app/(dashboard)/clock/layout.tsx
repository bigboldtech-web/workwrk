// Clock in/out (/clock): access step 3 for a page that had no server gate (Phase 8
// stage F, settings-architecture S7). The app-key gate over its APP_RULES row
// runs in the settings door's three states (FlaggedAppKeyGate): off, open as
// before; SETTINGS_GATE_LOG_ONLY, open and every would-be denial logged;
// ACCESS_V2_RESOLVER, a hidden or floored app locks its routes too.
import { FlaggedAppKeyGate } from "@/components/access/app-key-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <FlaggedAppKeyGate appKey="clock" label="Clock in/out" callbackUrl="/clock" back={{ fallbackHref: "/planner", label: "Planner" }}>
      {children}
    </FlaggedAppKeyGate>
  );
}
