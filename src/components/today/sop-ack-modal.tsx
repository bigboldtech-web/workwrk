"use client";

// SopAckModal — single-click acknowledgement for a SOPAssignment from
// MyAlignment. Confirms intent (compliance-grade), captures an
// optional note, and POSTs to /api/me/sops/[id]/ack. On success calls
// onAcked so the parent removes the row.

import { useEffect, useState } from "react";
import { BookOpenCheck } from "lucide-react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface SopLike {
  assignmentId: string;
  mandatory: boolean;
  sop: { id: string; title: string; description: string | null };
}

export function SopAckModal({
  open,
  onOpenChange,
  sop,
  onAcked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sop: SopLike | null;
  onAcked?: (assignmentId: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmed(false);
    setNote("");
    setError(null);
    setSubmitting(false);
  }, [open, sop?.assignmentId]);

  const submit = async () => {
    if (!sop) return;
    if (!confirmed) {
      setError("Please confirm you've read this SOP");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/me/sops/${sop.assignmentId}/ack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to acknowledge");
        setSubmitting(false);
        return;
      }
      onAcked?.(sop.assignmentId);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to acknowledge");
      setSubmitting(false);
    }
  };

  if (!sop) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] p-0">
        <div className="px-5 pt-5 pb-2">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <BookOpenCheck className="w-4 h-4 text-[var(--os-brand)]" />
            Acknowledge SOP
          </DialogTitle>
          <DialogDescription className="text-xs text-muted mt-1">
            {sop.mandatory ? "Mandatory · audited." : "Optional acknowledgement."}
          </DialogDescription>
        </div>

        <div className="px-5 py-3 space-y-3">
          <div>
            <h3 className="text-sm font-medium">{sop.sop.title}</h3>
            {sop.sop.description ? (
              <p className="text-xs text-muted mt-1 line-clamp-3">{sop.sop.description}</p>
            ) : null}
            <Link
              href={`/sops?focus=${sop.sop.id}`}
              className="text-xs text-[var(--os-brand)] hover:underline mt-2 inline-block"
            >
              Open the full SOP →
            </Link>
          </div>

          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>I have read and understood this SOP.</span>
          </label>

          <div>
            <label className="text-xs font-medium block mb-1">
              Note <span className="text-muted">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything you want to flag for the SOP owner…"
              className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm resize-y focus:outline-none focus:border-[var(--os-brand)]"
            />
          </div>

          {error ? <div className="text-xs text-red-500">{error}</div> : null}
        </div>

        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-border">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-sm text-muted hover:text-foreground px-3 py-2"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !confirmed}
            className="px-4 py-2 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
          >
            {submitting ? "Acknowledging…" : "Acknowledge"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
