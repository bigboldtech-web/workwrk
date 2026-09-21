// /trash: get back anything you deleted or archived, before it is gone.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/trash).
//
// FOUR TRASH SURFACES BECOME ONE (critic #3). Each keeps a door:
//   /trash                  this page
//   /docs/trash             308 -> /trash?type=doc      (next.config.ts)
//   /docs?view=archived     308 -> /trash?type=doc      (next.config.ts)
//   /agreements?view=trash  308 -> /trash?type=contract (next.config.ts)
// Those three land with NO ?tab=, and resolveTrashTab picks Archived for
// them: a Doc, a Canvas and a Contract are archived in place and have no
// TrashItem row, so the Deleted tab is empty for them by construction and a
// clean ?type= link would otherwise look like the row was lost.
// The Tables toolbar's deleted tables and forms land here with ?type=table and
// ?type=form. Deleted ROWS inside a table are not app Trash and stay in that
// table's own Data > Trash dialog: a row has no name, no page and no location
// outside its table, so it could not be given a Name, Location or Restore
// target on this table.
//
// The page is a Member's page now. It used to answer `isManager`, so somebody
// who deleted their own list read "Trash is for managers" and had to find a
// manager (work-tasks #11). The gate is the `trash` app key; what a person can
// see inside is decided per row by the route.

import { redirect } from "next/navigation";
import { gatePage } from "@/lib/access/gate";
import { resolveTrashTab, typeFromParam } from "@/lib/trash-view";
import { TrashClient } from "./trash-client";

export const dynamic = "force-dynamic";

export default async function TrashPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; type?: string; q?: string; view?: string }>;
}) {
  const { viewer } = await gatePage("view", { type: "app", key: "trash" }, { callbackUrl: "/trash" });
  const sp = await searchParams;

  // The retired-view redirects in next.config.ts (/docs?view=archived,
  // /agreements?view=trash) land here with `view` riding along, because Next
  // appends the matched source query to every config redirect. `view` means
  // nothing on this page, so it is dropped before anything renders and the
  // URL a person copies is the canonical /trash?type=doc. Loop-free: the
  // replacement has no `view`.
  if (sp.view !== undefined) {
    const next = new URLSearchParams();
    if (sp.tab) next.set("tab", sp.tab);
    if (sp.type) next.set("type", sp.type);
    if (sp.q) next.set("q", sp.q);
    const qs = next.toString();
    redirect(qs ? `/trash?${qs}` : "/trash");
  }

  return (
    <TrashClient
      initialTab={resolveTrashTab(sp.tab, sp.type)}
      initialType={typeFromParam(sp.type)}
      initialQuery={sp.q ?? ""}
      canPurge={viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN"}
    />
  );
}
