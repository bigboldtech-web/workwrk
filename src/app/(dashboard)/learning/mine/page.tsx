"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { MyCoursesTab } from "@/components/learning/tabs";

export default function LearningMinePage() {
  return (
    <BoardShell productSlug="workwrk-learn" boardKey="mine" viewMode="table">
      <MyCoursesTab />
    </BoardShell>
  );
}
