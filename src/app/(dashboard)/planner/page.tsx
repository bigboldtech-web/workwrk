// /planner, the one Calendar.
//
// naming-canon section 1: the rail row, the breadcrumb leaf and the page all
// say Calendar; "Planner" is the hub, not the page.
//
// This file is the route and nothing else, so there is one place to read the
// calendar's behaviour and it is src/components/planner/calendar-page.tsx.
//
// THE SUSPENSE BOUNDARY IS LOAD-BEARING (audit P-15). The page reads
// `useSearchParams` for `?view`, `?date` and `?calendar`, and Next requires
// that read to sit under a Suspense boundary or the whole route opts out of
// static rendering with a build-time warning. The fallback is the header
// skeleton rather than a blank frame, so a slow first paint still draws the
// page's shape.
//
// /calendar and /tasks/calendar are 308s to here in next.config.ts, so
// stored links, bookmarks and notification links still land.

import { Suspense } from "react";
import { OsPageHeaderSkeleton } from "@/components/layout/os/page-header";
import { CalendarPage } from "@/components/planner/calendar-page";

export default function PlannerRoute() {
  return (
    <Suspense fallback={<OsPageHeaderSkeleton views toolbar />}>
      <CalendarPage />
    </Suspense>
  );
}
