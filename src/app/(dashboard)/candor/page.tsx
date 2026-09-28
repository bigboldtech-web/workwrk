// Teams > Candor. Gate (spec-teams-performance section 1 Access): the
// people who run sessions get the organiser face; a Member in the scope of
// an open session (or who has answered one) gets the respondent face with
// no create controls; anyone else and every Guest gets the in-shell 404.
// New session shows only to an organiser with a scope to ask (candorMayCreate).

import { Suspense } from "react";
import { candorMayCreate, cultureGate } from "@/lib/people/culture-gate";
import CandorClient from "./candor-client";

export const dynamic = "force-dynamic";

export default async function CandorPage() {
  const g = await cultureGate("candor", "/candor");
  const canCreate = await candorMayCreate(g.organiser);
  return (
    <div className="flex h-full min-h-0 flex-col bg-raised">
      <Suspense>
        <CandorClient organiser={g.organiser} canCreate={canCreate} />
      </Suspense>
    </div>
  );
}
