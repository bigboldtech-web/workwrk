"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { VarianceTab } from "@/components/planning/tabs";

export default function PlanningVariancePage() {
  return (
    <BoardShell productSlug="workwrk-fpa" boardKey="variance" viewMode="table">
      <VarianceTab />
    </BoardShell>
  );
}
