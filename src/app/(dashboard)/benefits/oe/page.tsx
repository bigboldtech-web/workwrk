"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { OpenEnrollmentsTab } from "@/components/benefits/tabs";

export default function BenefitsOpenEnrollmentsPage() {
  return (
    <BoardShell productSlug="workwrk-benefits" boardKey="oe" viewMode="table">
      <OpenEnrollmentsTab />
    </BoardShell>
  );
}
