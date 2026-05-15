"use client";

// Generic floating bulk-actions bar — pin-bottom-center when N rows are
// selected in any list. Each consumer passes its own action set; this
// component just renders the chrome (count + clear + button row) and
// tracks per-action busy state.
//
// For the common "approve / reject N pending items" case, use the
// specialized BulkApproveBar wrapper which hits /api/bulk-decide.

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BulkAction = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Button variant; defaults to "outline". Use "destructive" for
   * delete-style actions and "default" for the primary action. */
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost";
  /** Async handler receiving the selected ids. Resolve to dismiss the
   * busy state; throw / reject if the work failed (the bar stays open
   * so the user can retry). */
  onRun: (ids: string[]) => Promise<void> | void;
  /** Label shown while the action is in-flight. */
  busyLabel?: string;
  /** Extra Tailwind classes for the button (e.g. text color override). */
  className?: string;
};

export function BulkActionsBar({
  selectedIds,
  onClear,
  actions,
  countLabel,
}: {
  selectedIds: string[];
  onClear: () => void;
  actions: BulkAction[];
  /** Override the default "N selected" string. */
  countLabel?: (n: number) => string;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (selectedIds.length === 0) return null;

  async function run(action: BulkAction) {
    if (busyId !== null) return;
    setBusyId(action.id);
    try {
      await action.onRun(selectedIds);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bulk-approve-bar" role="region" aria-label="Bulk actions">
      <span className="bulk-approve-count">
        {countLabel ? countLabel(selectedIds.length) : `${selectedIds.length} selected`}
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
        {actions.map((a) => {
          const isBusy = busyId === a.id;
          const isDisabled = busyId !== null && !isBusy;
          return (
            <Button
              key={a.id}
              size="sm"
              variant={a.variant ?? "outline"}
              className={cn("h-8 text-xs", a.className)}
              disabled={isDisabled || isBusy}
              onClick={() => run(a)}
            >
              {a.icon && <span className="mr-1 inline-flex items-center">{a.icon}</span>}
              {isBusy && a.busyLabel ? a.busyLabel : a.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
