// The Docs hub's own page (/docs): the app-key gate (Phase 8 stage F,
// settings-architecture S7) runs in the settings door's three states
// (FlaggedAppKeyGate): off, open as before; SETTINGS_GATE_LOG_ONLY, open and
// every would-be denial logged; ACCESS_V2_RESOLVER, a hidden or floored Docs
// hub locks this page too. A Guest keeps what is shared with them (APP_RULES
// docs: guest "shared").
//
// It sits on this route group, not on /docs itself, so /docs/[id] never meets
// it: a canonical doc link is decision B3's to answer (CanonicalHubGate in
// ../[id]/layout.tsx moves a person without the hub to the doc's Work door),
// and a gate above it would answer AppOff first and strand every linked-doc
// field, breadcrumb and open-doc tab. Docs are not app-locked objects in the
// engine (APP_BY_OBJECT_TYPE has no doc row). The group adds nothing to the
// URL.
import { FlaggedAppKeyGate } from "@/components/access/app-key-gate";

export default function DocsHubLayout({ children }: { children: React.ReactNode }) {
  return (
    <FlaggedAppKeyGate appKey="docs" label="Docs" callbackUrl="/docs" back={{ fallbackHref: "/home", label: "Home" }}>
      {children}
    </FlaggedAppKeyGate>
  );
}
