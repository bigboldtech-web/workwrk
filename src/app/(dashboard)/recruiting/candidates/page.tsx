"use client";

// Recruiting → Candidates board.

import { BoardShell } from "@/components/layout/board-shell";
import { CandidatesTab } from "@/components/recruiting/tabs";

export default function RecruitingCandidatesPage() {
  return (
    <BoardShell productSlug="workwrk-recruit" boardKey="candidates" viewMode="table">
      <CandidatesTab />
    </BoardShell>
  );
}
