"use client";

// The 400px confirm a lossy column type change shows (spec-tables-forms
// section 2, "Typing a column"): it names how many cells will read
// differently and offers to keep the old values in a new Text column first.
// Nothing is rewritten either way: a type change never touches a stored cell,
// it changes how the cells are read, so the old values are also recoverable
// by changing the type back.

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatCount } from "@/lib/format/date";

export function ColumnTypeChangeDialog({
  open, columnName, fromLabel, toLabel, cells, onCancel, onChange, onKeepAndChange,
}: {
  open: boolean;
  columnName: string;
  fromLabel: string;
  toLabel: string;
  cells: number;
  onCancel: () => void;
  onChange: () => void;
  onKeepAndChange: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="os-chrome max-w-[400px] border-line bg-raised p-5">
        <DialogTitle className="text-lg font-semibold text-ink">Change {columnName} to {toLabel}?</DialogTitle>
        <DialogDescription className="text-base text-ink-2">
          {/* "that the Number type cannot read", not "that is not number": the
              type label is a noun that takes no article of its own. */}
          {formatCount(cells)} {cells === 1 ? "cell holds a value" : "cells hold values"} that the {toLabel} type cannot read, so {cells === 1 ? "it" : "they"} may
          show or sort differently. Nothing is deleted: the stored values stay as they are, and changing the column back to{" "}
          {fromLabel.toLowerCase()} reads them as before.
        </DialogDescription>
        <div className="mt-2 flex flex-col gap-2">
          <button type="button" onClick={onKeepAndChange} className="h-9 rounded-md bg-brand px-3 text-base font-medium text-ink-inv hover:bg-brand-hover">
            Keep the old values in a new Text column
          </button>
          <button type="button" onClick={onChange} className="h-9 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover">
            Change the type only
          </button>
          <button type="button" onClick={onCancel} className="h-9 rounded-md px-3 text-base text-ink-2 hover:bg-hover">
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
