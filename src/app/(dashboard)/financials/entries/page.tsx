"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { EntriesTab } from "@/components/financials/tabs";

export default function FinancialsEntriesPage() {
  return (
    <BoardShell productSlug="workwrk-books" boardKey="entries" viewMode="table">
      <EntriesTab />
    </BoardShell>
  );
}
