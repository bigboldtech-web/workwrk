"use client";

// CRM → Activities board (stub). Will surface calls, emails, meetings,
// and tasks linked to leads/accounts/opps. v1 is an empty-state with
// a "log activity" CTA so the board exists in the workspace tree.

import { Activity, Plus } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";

export default function CrmActivitiesPage() {
  return (
    <BoardShell
      productSlug="workwrk-crm"
      boardKey="activities"
      viewMode="table"
      primaryAction={{ label: "Log activity", onClick: () => {}, Icon: Plus }}
    >
      <div className="rounded-xl border border-border bg-surface text-center py-20">
        <Activity size={40} className="mx-auto mb-3 text-muted-2" />
        <p className="text-sm font-medium mb-1">Activities timeline coming soon</p>
        <p className="text-xs text-muted-2 max-w-md mx-auto">
          Calls, emails, meetings, and tasks logged against your leads, accounts,
          and deals — all in one timeline. Wires up to the Gmail / Outlook
          connector + the Notetaker meeting recaps.
        </p>
      </div>
    </BoardShell>
  );
}
