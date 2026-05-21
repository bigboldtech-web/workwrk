"use client";

// CRM → Reports board (stub). Pipeline analytics, win-rate, cycle
// time, source attribution. v1 is a placeholder; charts come once the
// Activities feed is generating events.

import { BarChart3 } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";

export default function CrmReportsPage() {
  return (
    <BoardShell
      productSlug="workwrk-crm"
      boardKey="reports"
      viewMode="chart"
    >
      <div className="rounded-xl border border-border bg-surface text-center py-20">
        <BarChart3 size={40} className="mx-auto mb-3 text-muted-2" />
        <p className="text-sm font-medium mb-1">Pipeline reports coming soon</p>
        <p className="text-xs text-muted-2 max-w-md mx-auto">
          Win rate, average deal size, sales cycle, source attribution, rep
          leaderboards. Powered by the same data that drives the pipeline kanban.
        </p>
      </div>
    </BoardShell>
  );
}
