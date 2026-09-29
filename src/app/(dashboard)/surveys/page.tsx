// Teams > Surveys. Gate (spec-teams-performance section 1 Access): the
// people who run surveys get the organiser face; a Member targeted by a
// survey (or who has answered one) gets the respondent face with no New
// pulse, Launch or Close; anyone else and every Guest gets the in-shell 404.

import { Suspense } from "react";
import { cultureGate } from "@/lib/people/culture-gate";
import SurveysClient from "./surveys-client";

export const dynamic = "force-dynamic";

export default async function SurveysPage() {
  const g = await cultureGate("surveys", "/surveys");
  return (
    <div className="flex h-full min-h-0 flex-col bg-raised">
      <Suspense>
        <SurveysClient canCreate={g.organiser} />
      </Suspense>
    </div>
  );
}
