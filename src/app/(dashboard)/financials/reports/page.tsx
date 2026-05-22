"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { ReportsTab } from "@/components/financials/tabs";

export default function FinancialsReportsPage() {
  return (
    <BoardShell productSlug="workwrk-books" boardKey="reports" viewMode="table">
      <ReportsTab />
    </BoardShell>
  );
}
