"use client";

// /planner — the time-grid Planner. The view itself lives in PlannerWeek (shared
// with the topbar PlannerModal popup). Click-and-drag the grid to sweep a time
// range; release opens the create popover.

import { PlannerWeek } from "@/components/layout/os/planner-week";

export default function PlannerPage() {
  return <PlannerWeek />;
}
