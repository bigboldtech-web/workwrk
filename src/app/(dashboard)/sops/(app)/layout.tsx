// SOPs (/sops, /sops/my-sops, /sops/new/*, /sops/manage, /sops/compliance):
// access step 3 for pages that had no server gate (Phase 8 stage F,
// settings-architecture S7). The app-key gate over its APP_RULES row runs in
// the settings door's three states (FlaggedAppKeyGate): off, open as before;
// SETTINGS_GATE_LOG_ONLY, open and every would-be denial logged;
// ACCESS_V2_RESOLVER, a hidden or floored app locks these routes too.
//
// It sits on this route group, not on /sops itself, so /sops/[id] never meets
// it: a canonical SOP link is decision B3's to answer (CanonicalHubGate in
// ../[id]/layout.tsx moves a person without the app to the SOP's Work door),
// and a gate above it would answer AppOff first and strand the link. SOPs are
// not app-locked objects in the engine (APP_BY_OBJECT_TYPE has no sop row),
// so the SOP stays readable at its Work address. The group adds nothing to
// the URL.
import { FlaggedAppKeyGate } from "@/components/access/app-key-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <FlaggedAppKeyGate appKey="sops" label="SOPs" callbackUrl="/sops" back={{ fallbackHref: "/docs", label: "Docs" }}>
      {children}
    </FlaggedAppKeyGate>
  );
}
