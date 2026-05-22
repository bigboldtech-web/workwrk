"use client";

// Recruiting → Jobs board.

import { BoardShell } from "@/components/layout/board-shell";
import { JobsTab } from "@/components/recruiting/tabs";

export default function RecruitingJobsPage() {
  return (
    <BoardShell productSlug="workwrk-recruit" boardKey="jobs" viewMode="table">
      <JobsTab />
    </BoardShell>
  );
}
