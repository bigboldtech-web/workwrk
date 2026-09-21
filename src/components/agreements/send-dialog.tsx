"use client";

// The Send for signature modal (spec-process section 2 `/agreements/[id]`),
// 560: the parties with their emails (each must be valid; inline error), the
// "Signing order" switch ("Parties sign one after another", off), an optional
// Message that goes in the email, and the one primary "Send". On success the
// caller shows "Sent to N parties" and the Parties card.

import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Dots } from "@/components/ui/dots";
import { partyHue, partySendErrors, partyRoleLabel, type PartyLike } from "@/lib/contracts";

export function SendDialog({ open, onClose, parties, onSend, busy }: {
  open: boolean;
  onClose: () => void;
  parties: Array<PartyLike & { role?: string | null }>;
  onSend: (opts: { signingOrder: boolean; message: string }) => Promise<boolean>;
  busy?: boolean;
}) {
  const [signingOrder, setSigningOrder] = useState(false);
  const [message, setMessage] = useState("");
  const ordered = useMemo(() => [...parties].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [parties]);
  const errors = useMemo(() => partySendErrors(ordered), [ordered]);
  const canSend = ordered.length > 0 && Object.keys(errors).length === 0 && !busy;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>Send for signature</DialogTitle>
        <DialogDescription>Each party gets an email with their own signing link.</DialogDescription>
        <ul className="mt-2 flex flex-col">
          {ordered.map((p, i) => (
            <li key={p.id} className="flex min-h-9 items-center gap-2 border-b border-line-soft py-1 last:border-b-0">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: partyHue(i) }} />
              <span className="min-w-0 flex-1 truncate text-base text-ink">{p.name || "Unnamed party"}<span className="ms-2 text-xs text-ink-2">{partyRoleLabel(p.role)}</span></span>
              <span className={`min-w-0 max-w-[45%] truncate text-sm ${errors[p.id] ? "text-danger-text" : "text-ink-2"}`}>{errors[p.id] ?? p.email}</span>
            </li>
          ))}
          {ordered.length === 0 ? <li className="flex h-9 items-center text-sm text-danger-text">Add at least one party first.</li> : null}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-base text-ink">Signing order <span className="block text-sm text-ink-2">Parties sign one after another, in the order above.</span></span>
          <Switch checked={signingOrder} onChange={setSigningOrder} aria-label="Signing order" />
        </div>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-sm font-medium text-ink-2">Message <span className="font-normal text-ink-3">(optional, goes in the email)</span></span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="w-full resize-none rounded-md border border-line-strong bg-raised px-3 py-2 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand" placeholder="A line for the people signing" />
        </label>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void onSend({ signingOrder, message })} disabled={!canSend} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
            {busy ? <Dots variant="pending" /> : <Send className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Send
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
