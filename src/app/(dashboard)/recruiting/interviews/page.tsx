"use client";

// Recruiting → Interviews board.

import { BoardShell } from "@/components/layout/board-shell";
import { InterviewsTab } from "@/components/recruiting/tabs";

export default function RecruitingInterviewsPage() {
  return (
    <BoardShell productSlug="workwrk-recruit" boardKey="interviews" viewMode="table">
      <InterviewsTab />
    </BoardShell>
  );
}
