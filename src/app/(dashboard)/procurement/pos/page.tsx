"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { POsTab } from "@/components/procurement/tabs";

export default function ProcurementPosPage() {
  return (
    <BoardShell productSlug="workwrk-procurement" boardKey="pos" viewMode="table">
      <POsTab />
    </BoardShell>
  );
}
