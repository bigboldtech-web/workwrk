"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { ManageTab } from "@/components/learning/tabs";

export default function LearningManagePage() {
  return (
    <BoardShell productSlug="workwrk-learn" boardKey="manage" viewMode="table">
      <ManageTab />
    </BoardShell>
  );
}
