// The Docs hub layout for /docs, /docs/[id] and /docs/trash.
//
// It hosts DocTabsBar, the strip of open docs. The strip survives navigation
// between docs because this layout does not unmount as the [id] segment
// changes. It is a capability the product already had and keeps: the refresh
// restyles it on the tokens and leaves its Alt (Option) 1 to 9 binding alone,
// which never collided with the hubs' Cmd 1 to 8.
//
// The app-key gate for this hub is the shell's URL-derived one
// (src/lib/nav/route-hub.ts); nothing else lives here.

import { DocTabsBar } from "@/components/docs/doc-tabs";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DocTabsBar />
      {children}
    </>
  );
}
