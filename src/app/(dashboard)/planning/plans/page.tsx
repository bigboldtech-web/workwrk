"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { PlansTab } from "@/components/planning/tabs";

export default function PlanningPlansPage() {
  return (
    <BoardShell productSlug="workwrk-fpa" boardKey="plans" viewMode="table">
      <PlansTab />
    </BoardShell>
  );
}
