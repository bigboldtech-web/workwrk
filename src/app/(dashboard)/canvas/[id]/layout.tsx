// /canvas/[id]: the Docs hub's address of a canvas.
//
// Canvases live in the Docs hub's store. A person whose rail has no Docs hub
// and who lands here (an old bookmark, a pasted link) is moved to the
// canvas's Work door before the editor mounts, keeping the query and the
// hash; everyone who has the hub gets the page exactly as before (decision
// B3, src/components/access/canonical-hub-gate.tsx). Props are typed by
// hand, not with the generated LayoutProps, so a type check never depends
// on the dev server having generated types for this route yet.

import type { ReactNode } from "react";
import { CanonicalHubGate } from "@/components/access/canonical-hub-gate";

export const dynamic = "force-dynamic";

export default async function CanvasLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <CanonicalHubGate kind="canvas" id={id}>
      {children}
    </CanonicalHubGate>
  );
}
