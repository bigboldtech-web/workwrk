// /sops/[id]: the Docs hub's address of an SOP.
//
// SOPs are a folded app of the Docs hub. A person whose rail has no Docs
// hub, or whose org has switched off or floored the SOPs app for them, and
// who lands here (an old bookmark, a pasted link) is moved to the SOP's
// Work door before the editor mounts, keeping the query and the hash;
// everyone else gets the page exactly as before (decision B3,
// src/components/access/canonical-hub-gate.tsx). /sops/new, /sops/my-sops,
// /sops/compliance and /sops/manage are static routes of their own and never
// reach this segment. Whether the SOP can be read is still the SOP centre's
// own API, at either address. Props are typed by hand, not with the
// generated LayoutProps, so a type check never depends on the dev server
// having generated types for this route yet.

import type { ReactNode } from "react";
import { CanonicalHubGate } from "@/components/access/canonical-hub-gate";

export const dynamic = "force-dynamic";

export default async function SopLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <CanonicalHubGate kind="sop" id={id}>
      {children}
    </CanonicalHubGate>
  );
}
