/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb --
   The crumb IS declared, one component down: PersonRecord renders `<Breadcrumb items/>` from the loaded person ("Teams > Directory > {Name}", or "Teams > My profile" for self). */
// /people/[id]: one person's record as a full page (spec-teams-people
// /people/[id]); the same PersonRecord opens as a drawer over any list on a
// soft navigation (@drawer/(.)people/[id]). Every Member opens the directory
// card; people data renders only for self, the reporting chain, the People
// team, the org-wide levels and Admins (the record's own `access` answer from
// GET /api/users/[id]). A Guest, or an id outside the org, is the in-shell
// 404: a Guest's own record is My settings > Profile.

import { Suspense } from "react";
import { notFound } from "next/navigation";
import { gatePage } from "@/lib/access/gate";
import { prisma } from "@/lib/prisma";
import { PersonRecord } from "@/components/people/person-record";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer } = await gatePage("view", { type: "app", key: "teams" }, { callbackUrl: `/people/${id}` });
  const exists = await prisma.user.count({ where: { id, organizationId: viewer.organizationId } });
  if (!exists) notFound();
  return (
    <Suspense>
      <PersonRecord id={id} presentation="page" />
    </Suspense>
  );
}
