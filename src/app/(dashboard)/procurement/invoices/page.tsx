"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { InvoicesTab } from "@/components/procurement/tabs";

export default function ProcurementInvoicesPage() {
  return (
    <BoardShell productSlug="workwrk-procurement" boardKey="invoices" viewMode="table">
      <InvoicesTab />
    </BoardShell>
  );
}
