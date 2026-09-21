"use client";

// DueDateDialog: the 400 confirm behind every "Change due date" row action in
// the process unit (a run, a SOP assignment). One DateField (design-system
// 5.6 date picker: quick chips + month grid), Cancel, and the one blue Save.
// It replaced a free-text prompt asking for "YYYY-MM-DD".

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Dots } from "@/components/ui/dots";
import { useFormat } from "@/lib/format/use-date-prefs";

function DateLabel({ value }: { value: string }) {
  const fmt = useFormat();
  return <>{fmt.date(value, "date")}</>;
}

export function DueDateDialog({ open, title, description, value, onClose, onSave }: {
  open: boolean;
  /** "Change due date" by default. */
  title?: string;
  /** The row this is for: "Kickoff · Verify Bot". */
  description?: string;
  /** The current due date ("YYYY-MM-DD" or an ISO string), or null. */
  value: string | null;
  onClose: () => void;
  /** Resolves when the write is done; reject or return false to keep the dialog open. */
  onSave: (next: string | null) => Promise<boolean | void>;
}) {
  const [draft, setDraft] = useState<string | null>(value ? value.slice(0, 10) : null);
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) { setSeenOpen(open); if (open) setDraft(value ? value.slice(0, 10) : null); }
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await onSave(draft);
      if (ok !== false) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[400px]">
        <DialogTitle>{title ?? "Change due date"}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm text-ink-2">{draft ? <>Due <span className="font-medium text-ink"><DateLabel value={draft} /></span></> : "No due date"}</p>
          {/* The month grid in place: a popover inside a 400 dialog would be
              clipped by the dialog's own scroll box. */}
          <DateField inline value={draft} onChange={setDraft} ariaLabel="Due date" />
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
            {busy ? <Dots variant="pending" /> : null} Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
