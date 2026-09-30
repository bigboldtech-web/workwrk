// The Docs hub layout for /docs, /docs/[id] and /docs/trash.
//
// It hosts DocTabsBar, the strip of open docs. The strip survives navigation
// between docs because this layout does not unmount as the [id] segment
// changes. It is a capability the product already had and keeps: the refresh
// restyles it on the tokens and leaves its Alt (Option) 1 to 9 binding alone,
// which never collided with the hubs' Cmd 1 to 8.
//
// The app-key gate (Phase 8 stage F, settings-architecture S7) runs in the
// settings door's three states (FlaggedAppKeyGate): off, open as before;
// SETTINGS_GATE_LOG_ONLY, open and every would-be denial logged;
// ACCESS_V2_RESOLVER, a hidden or floored Docs hub locks its routes too. A
// Guest keeps what is shared with them (APP_RULES docs: guest "shared").

import { DocTabsBar } from "@/components/docs/doc-tabs";
import { FlaggedAppKeyGate } from "@/components/access/app-key-gate";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <FlaggedAppKeyGate appKey="docs" label="Docs" callbackUrl="/docs" back={{ fallbackHref: "/home", label: "Home" }}>
      <DocTabsBar />
      {children}
    </FlaggedAppKeyGate>
  );
}
