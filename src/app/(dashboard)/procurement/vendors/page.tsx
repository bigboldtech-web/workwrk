"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { VendorsTab } from "@/components/procurement/tabs";

export default function ProcurementVendorsPage() {
  return (
    <BoardShell productSlug="workwrk-procurement" boardKey="vendors" viewMode="table">
      <VendorsTab />
    </BoardShell>
  );
}
