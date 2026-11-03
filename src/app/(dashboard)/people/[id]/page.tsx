/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb --
   The crumb IS declared, one component down: PersonRecord renders `<Breadcrumb items/>` from the loaded person ("Teams > Directory > {Name}", or "Teams > My profile" for self). */
// /people/[id]: one person's record as a full page (spec-teams-people
// /people/[id]); the same PersonRecord opens as a drawer over any list on a
// soft navigation (@drawer/(.)people/[id]). Every Member opens the directory
// card; people data renders only for self, the reporting chain, the People
// team, the org-wide levels and Admins (the record's own `access` answer from
// GET /api/users/[id]). A Guest, or an id outside the org, is the in-shell
// 404: a Guest's own record is My settings > Profile.
//
// "In the org" is a seat here, the one GET /api/users/[id] reads
// (acting-workspace.ts personSeatIn): someone anchored here in any state, as
// the count of people anchored here answered, and someone who works here
// through a membership, a removed one included, never by the anchored
// workspace's own stale row (docs/plans/workspace-status.md, the final
// review, product H2). Before, a membership person's record opened only as
// the drawer, and the full page (a refresh, a new tab, a copied link) was
// the 404.

import { Suspense } from "react";
import { notFound } from "next/navigation";
import { gatePage } from "@/lib/access/gate";
import { personSeatIn } from "@/lib/access/acting-workspace";
import { PersonRecord } from "@/components/people/person-record";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer } = await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: `/people/${id}` });
  const seat = await personSeatIn(viewer.organizationId, id);
  if (!seat) notFound();
  return (
    <Suspense>
      <PersonRecord id={id} presentation="page" />
    </Suspense>
  );
}
