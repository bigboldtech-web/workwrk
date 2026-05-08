"use client";

// Floating bulk-action bar that appears at the bottom of an approval
// queue when N rows are selected. Reusable across Expenses / Time Off /
// Comp / POs / Invoices / Timesheets — each consumer passes the right
// `entityType` and a refresh callback. Reject prompts for a note.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CheckCircle2, XCircle, X } from "lucide-react";

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
  const [busy, setBusy] = useState<"APPROVE" | "REJECT" | null>(null);

  if (selectedIds.length === 0) return null;

  async function decide(decision: "APPROVE" | "REJECT") {
    let note: string | null = null;
    if (decision === "REJECT") {
      const reason = prompt(`Reason for rejecting ${selectedIds.length} item(s)?`);
      if (reason === null) return;
      note = reason;
    }
    setBusy(decision);
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
      setBusy(null);
    }
  }

  return (
    <div className="bulk-approve-bar">
      <span className="bulk-approve-count">
        {selectedIds.length} selected
      </span>
      <button
        type="button"
        onClick={onClear}
        className="bulk-approve-clear"
        aria-label="Clear selection"
      >
        <X size={12} />
      </button>
      <div className="bulk-approve-actions">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs text-red-400"
          disabled={busy !== null}
          onClick={() => decide("REJECT")}
        >
          <XCircle size={12} className="mr-1" />
          {busy === "REJECT" ? "Rejecting…" : "Reject all"}
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={busy !== null}
          onClick={() => decide("APPROVE")}
        >
          <CheckCircle2 size={12} className="mr-1" />
          {busy === "APPROVE" ? "Approving…" : "Approve all"}
        </Button>
      </div>
    </div>
  );
}
