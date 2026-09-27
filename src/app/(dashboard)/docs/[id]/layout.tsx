// /docs/[id]: the Docs hub's address of a doc.
//
// The Docs hub is a storage browser, and an org can leave it off a person's
// rail. A person without it who lands here (an old bookmark, a pasted link)
// is moved to the doc's Work door before any editor mounts, keeping the
// query and the hash; everyone who has the hub gets the page exactly as
// before (decision B3, src/components/access/canonical-hub-gate.tsx). The
// open-doc strip above this segment (DocTabsBar in ../layout.tsx) draws
// nothing for a person without the hub, so it never flashes before the move.
// Props are typed by hand, not with the generated LayoutProps, so a type
// check never depends on the dev server having generated types for this
// route yet.

import type { ReactNode } from "react";
import { CanonicalHubGate } from "@/components/access/canonical-hub-gate";

export const dynamic = "force-dynamic";

export default async function DocLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <CanonicalHubGate kind="doc" id={id}>
      {children}
    </CanonicalHubGate>
  );
}
