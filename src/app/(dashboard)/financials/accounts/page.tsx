"use client";

import { BoardShell } from "@/components/layout/board-shell";
import { AccountsTab } from "@/components/financials/tabs";

export default function FinancialsAccountsPage() {
  return (
    <BoardShell productSlug="workwrk-books" boardKey="accounts" viewMode="table">
      <AccountsTab />
    </BoardShell>
  );
}
