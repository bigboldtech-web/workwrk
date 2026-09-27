// /tables/[id]: the Tables hub's address of a table.
//
// A person whose rail has no Tables hub and who lands here (an old bookmark,
// a pasted link) is moved to the table's Work door before the sheet mounts,
// keeping the query and the hash; everyone who has the hub gets the page
// exactly as before (decision B3, src/components/access/canonical-hub-gate.tsx).
// This segment sits under ../layout.tsx, so TablesModuleGate answers first:
// with the module off a Member still sees the module-off state and a Guest
// the in-shell 404, never a move. Props are typed by hand, not with the
// generated LayoutProps, so a type check never depends on the dev server
// having generated types for this route yet.

import type { ReactNode } from "react";
import { CanonicalHubGate } from "@/components/access/canonical-hub-gate";

export const dynamic = "force-dynamic";

export default async function TableLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <CanonicalHubGate kind="table" id={id}>
      {children}
    </CanonicalHubGate>
  );
}
