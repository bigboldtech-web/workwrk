"use client";

// "Save as view": the 400 modal the Filter panel's footer link opens.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/my-work, Filter
// panel): 'Footer "Save as view" text link then a 400 modal (name, "Set as
// default" switch) writing `home.work.savedFilters[]`'.
//
// It is small on purpose. The page already had saved-view pills, an "+ View"
// affordance and a reader for the preference key; this is the writer that was
// missing, and without it none of the rest could ever do anything.

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

export function SaveViewModal({
  open,
  onClose,
  onSave,
  activeCount,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, isDefault: boolean) => void;
  /** How many filters this view will remember, said out loud before saving. */
  activeCount: number;
}) {
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();

  // A fresh modal every time it opens: a name left over from the last save is
  // a name somebody did not choose. The remount is what clears it, which is
  // also why there is no effect resetting state here.
  if (!open) return null;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Save as view</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!trimmed || busy) return;
            setBusy(true);
            onSave(trimmed, isDefault);
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-base font-medium text-ink">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Overdue and urgent"
              className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3"
            />
            <span className="text-sm text-ink-2">
              {activeCount === 0
                ? "This view remembers the current sort, grouping and layout."
                : `This view remembers ${activeCount} ${activeCount === 1 ? "filter" : "filters"}, plus the sort, grouping and layout.`}
            </span>
          </label>

          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 text-base text-ink">Set as default</span>
            <Switch checked={isDefault} onChange={setIsDefault} aria-label="Set as default" />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!trimmed || busy}
              className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4"
            >
              Save view
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
