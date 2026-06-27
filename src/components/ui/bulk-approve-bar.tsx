"use client";

// Specialized floating bar for approval queues — Expenses, Time off,
// Comp decisions, POs, Invoices, Timesheets all share the same
// approve/reject UX wired to /api/bulk-decide. Reject prompts the
// user for a note; Approve is one click.
//
// This is a thin wrapper around the generic BulkActionsBar; use that
// directly when you need a different action set (bulk delete, bulk
// export, bulk close, etc.).

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { usePrompt } from "@/components/ui/dialog-provider";
import { CheckCircle2, XCircle } from "lucide-react";
import { BulkActionsBar, type BulkAction } from "@/components/ui/bulk-actions-bar";

export type BulkEntityType =
  | "expense"
  | "time-off"
  | "comp-decision"
  | "purchase-order"
  | "invoice"
  | "timesheet";

export function BulkApproveBar({
  entityType,
  selectedIds,
  onClear,
  onDone,
}: {
  entityType: BulkEntityType;
  selectedIds: string[];
  onClear: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const promptDialog = usePrompt();
  // Per-decision "doing" label is fed into BulkActionsBar via busyLabel;
  // we don't need to track separately here.
  const [, setActiveDecision] = useState<"APPROVE" | "REJECT" | null>(null);

  async function decide(decision: "APPROVE" | "REJECT") {
    let note: string | null = null;
    if (decision === "REJECT") {
      const reason = await promptDialog({ title: `Reason for rejecting ${selectedIds.length} item(s)?` });
      if (reason === null) return;
      note = reason;
    }
    setActiveDecision(decision);
    try {
      const res = await fetch("/api/bulk-decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          decision,
          note,
          ids: selectedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't update", description: data?.error });
        return;
      }
      const applied = data.applied as number;
      const skipped = (data.skipped as Array<{ id: string; reason: string }>) ?? [];
      if (skipped.length > 0) {
        const reasons = Array.from(new Set(skipped.map((s) => s.reason))).join(", ");
        toast({
          type: applied > 0 ? "warning" : "error",
          title: `${decision === "APPROVE" ? "Approved" : "Rejected"} ${applied}, skipped ${skipped.length}`,
          description: `Skipped reasons: ${reasons}`,
        });
      } else {
        toast({
          type: "success",
          title: `${decision === "APPROVE" ? "Approved" : "Rejected"} ${applied} item${applied === 1 ? "" : "s"}`,
        });
      }
      onClear();
      onDone();
    } finally {
      setActiveDecision(null);
    }
  }

  const actions: BulkAction[] = [
    {
      id: "reject",
      label: "Reject all",
      busyLabel: "Rejecting…",
      icon: <XCircle size={12} />,
      variant: "outline",
      className: "text-rose-500",
      onRun: () => decide("REJECT"),
    },
    {
      id: "approve",
      label: "Approve all",
      busyLabel: "Approving…",
      icon: <CheckCircle2 size={12} />,
      variant: "default",
      onRun: () => decide("APPROVE"),
    },
  ];

  return (
    <BulkActionsBar
      selectedIds={selectedIds}
      onClear={onClear}
      actions={actions}
    />
  );
}
