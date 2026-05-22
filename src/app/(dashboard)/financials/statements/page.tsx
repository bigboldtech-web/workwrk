"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { StatementsTab } from "@/components/financials/tabs";

export default function FinancialsStatementsPage() {
  return (
    <BoardShell productSlug="workwrk-books" boardKey="statements" viewMode="table">
      <StatementsTab />
    </BoardShell>
  );
}
