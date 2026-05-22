"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { PayGroupsTab } from "@/components/payroll/tabs";

export default function PayrollGroupsPage() {
  return (
    <BoardShell productSlug="workwrk-pay" boardKey="groups" viewMode="table">
      <PayGroupsTab />
    </BoardShell>
  );
}
