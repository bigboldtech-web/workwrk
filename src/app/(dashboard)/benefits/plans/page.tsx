"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { PlansTab } from "@/components/benefits/tabs";

export default function BenefitsPlansPage() {
  return (
    <BoardShell productSlug="workwrk-benefits" boardKey="plans" viewMode="table">
      <PlansTab />
    </BoardShell>
  );
}
