"use client";

// The console's typed confirmation (spec-admin-backoffice section 2.3 card 2,
// the hard rule that every destructive staff action is typed): a 400 modal
// whose destructive primary stays disabled until the staff member has typed
// the exact thing the action is about (a company name, a staff email). The
// match ignores case and surrounding spaces, never anything else.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface TypedConfirmRequest {
  title: string;
  /** What the action does, exactly as the build does it. */
  body: string;
  /** A second, quieter sentence (who is not affected, how to undo). */
  note?: string;
  /** The text the staff member must type. */
  match: string;
  /** How the prompt names that text: "the company name", "their email". */
  matchLabel: string;
  confirmLabel: string;
}

/** Pure: does what was typed confirm the action? */
export function typedConfirmMatches(typed: string, match: string): boolean {
  const want = match.trim().toLowerCase();
  return want.length > 0 && typed.trim().toLowerCase() === want;
}

export function TypedConfirmDialog({
  request,
  busy = false,
  onConfirm,
  onCancel,
}: {
  /** null keeps the dialog closed. */
  request: TypedConfirmRequest | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [shownFor, setShownFor] = useState<TypedConfirmRequest | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A fresh request always starts empty, so text typed for one company can
  // never confirm the next one.
  if (request !== shownFor) {
    setShownFor(request);
    setTyped("");
  }

  useEffect(() => {
    if (request) requestAnimationFrame(() => inputRef.current?.focus());
  }, [request]);

  const ok = request ? typedConfirmMatches(typed, request.match) : false;

  return (
    <Dialog open={!!request} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="max-w-[400px] gap-0 p-6" onOpenAutoFocus={(e) => e.preventDefault()}>
        {request ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (ok && !busy) onConfirm();
            }}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-[#E2445C]/15">
                <AlertTriangle size={15} className="text-[#E2445C]" />
              </span>
              <DialogTitle className="text-base leading-none">{request.title}</DialogTitle>
            </div>
            <p className="mt-2.5 text-base leading-relaxed text-muted">{request.body}</p>
            {request.note ? <p className="mt-2 text-sm leading-relaxed text-muted">{request.note}</p> : null}
            <label className="mt-4 block text-sm text-muted" htmlFor="typed-confirm-input">
              Type {request.matchLabel} to confirm: <span className="font-medium text-foreground">{request.match}</span>
            </label>
            <Input
              id="typed-confirm-input"
              ref={inputRef}
              className="mt-1.5"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
            />
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" size="sm" disabled={!ok || busy}>
                {busy ? "Working" : request.confirmLabel}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
