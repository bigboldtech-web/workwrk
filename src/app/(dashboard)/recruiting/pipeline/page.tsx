"use client";

// Recruiting → Pipeline board (kanban by stage).

import { BoardShell } from "@/components/layout/board-shell";
import { PipelineTab } from "@/components/recruiting/tabs";

export default function RecruitingPipelinePage() {
  return (
    <BoardShell productSlug="workwrk-recruit" boardKey="pipeline" viewMode="kanban">
      <PipelineTab />
    </BoardShell>
  );
}
