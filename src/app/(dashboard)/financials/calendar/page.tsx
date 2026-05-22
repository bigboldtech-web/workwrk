"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { CalendarTab } from "@/components/financials/tabs";

export default function FinancialsCalendarPage() {
  return (
    <BoardShell productSlug="workwrk-books" boardKey="calendar" viewMode="table">
      <CalendarTab />
    </BoardShell>
  );
}
