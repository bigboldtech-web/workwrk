// The Calendar's route loader.
//
// One drawing for two states (spec-shell 2.2): this file renders on a route
// transition into /planner, and the same skeleton is the Suspense fallback
// inside page.tsx, so the shape a person sees while the route resolves and
// the shape they see while the page reads its search parameters are the
// same shape. A bare spinner, or nothing at all, makes the page look like
// it jumped.

import { OsPageHeaderSkeleton } from "@/components/layout/os/page-header";

export default function PlannerLoading() {
  return <OsPageHeaderSkeleton views toolbar />;
}
