// The Docs hub layout for /docs, /docs/[id] and /docs/trash.
//
// It hosts DocTabsBar, the strip of open docs. The strip survives navigation
// between docs because this layout does not unmount as the [id] segment
// changes. It is a capability the product already had and keeps: the refresh
// restyles it on the tokens and leaves its Alt (Option) 1 to 9 binding alone,
// which never collided with the hubs' Cmd 1 to 8.
//
// The app-key gate (Phase 8 stage F) is NOT here: it is on the hub page's
// route group, (hub)/layout.tsx, so a canonical /docs/[id] link still reaches
// decision B3 (CanonicalHubGate in [id]/layout.tsx). The strip draws nothing
// for a person without the hub.

import { DocTabsBar } from "@/components/docs/doc-tabs";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DocTabsBar />
      {children}
    </>
  );
}
