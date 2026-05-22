"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { PayRunsTab } from "@/components/payroll/tabs";

export default function PayrollRunsPage() {
  return (
    <BoardShell productSlug="workwrk-pay" boardKey="runs" viewMode="table">
      <PayRunsTab />
    </BoardShell>
  );
}
