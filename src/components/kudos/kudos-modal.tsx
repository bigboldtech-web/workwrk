"use client";

// KudosComposer (spec-teams-performance section 3): the ONLY kudos composer
// in the product, a 560 ui/dialog.
//
//   Who do you want to thank?   a people Picker over GET /api/people/pick
//                               (every Member, never the viewer), prefilled
//                               from ?to= or a person's Kudos tab
//   Message                     required, up to 500 characters, a live
//                               counter once fewer than 50 remain
//   Company value               the org's own values (useCultureValues,
//                               Settings > Identity and culture); "No value"
//                               first. With no values set, the picker is
//                               simply not shown (no invented list).
//   Cancel · Give kudos         Cmd+Enter sends; Esc closes, confirming
//                               when something is typed
//
// A failed send keeps the draft in the modal and retries once on a dropped
// connection; the error stays visible until the next try.

import { useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useBoot } from "@/components/layout/os/boot-context";
import { PeoplePickerField, type PickPerson } from "@/components/people/person-bits";
import { apiFetch } from "@/lib/api-fetch";
import { useCultureValues } from "@/lib/use-culture";

const MAX = 500;

export interface GivenKudos {
  id: string;
  receiver: { id: string; firstName: string | null; lastName: string | null };
}

export function KudosModal({
  open,
  onClose,
  preselectedUserId,
  onGiven,
}: {
  open: boolean;
  onClose: () => void;
  /** The receiver, from ?to= or a person's Kudos tab. */
  preselectedUserId?: string;
  onGiven?: (k: GivenKudos) => void;
}) {
  const { boot } = useBoot();
  const confirm = useConfirm();
  const values = useCultureValues();
  const [to, setTo] = useState<string[]>(preselectedUserId ? [preselectedUserId] : []);
  const [picked, setPicked] = useState<PickPerson[]>([]);
  const [message, setMessage] = useState("");
  const [value, setValue] = useState<string | null>(null);
  const [valueOpen, setValueOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // A preselected receiver is read by id, so they show by name even when
  // they are not on the picker's first page.
  useEffect(() => {
    if (!open || !preselectedUserId) return;
    let live = true;
    void apiFetch<Record<string, unknown>>(`/api/users/${encodeURIComponent(preselectedUserId)}`, { cache: "no-store" }).then((r) => {
      if (!live || !r.ok) return;
      const u = ((r.data as { data?: Record<string, unknown> }).data ?? r.data) as { id?: string; firstName?: string; lastName?: string; avatar?: string | null; email?: string | null };
      if (u?.id) setPicked([{ id: u.id, firstName: u.firstName ?? null, lastName: u.lastName ?? null, avatar: u.avatar ?? null, email: u.email ?? null }]);
    });
    return () => { live = false; };
  }, [open, preselectedUserId]);

  // Auto-grow from three rows.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [message]);

  const dirty = message.trim().length > 0;
  const remaining = MAX - message.length;
  const ready = to.length === 1 && message.trim().length > 0 && remaining >= 0 && !sending;

  async function close() {
    if (sending) return;
    if (dirty && !(await confirm({ title: "Discard this kudos?", description: "What you wrote will be lost.", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  }

  async function send(attempt = 0): Promise<void> {
    if (!ready && attempt === 0) return;
    setSending(true);
    setError(null);
    const r = await apiFetch<{ id: string; receiver: GivenKudos["receiver"] }>("/api/kudos", {
      method: "POST",
      json: { receiverId: to[0], message: message.trim(), companyValue: value },
    });
    if (!r.ok) {
      // One quiet retry for a dropped connection. Status 0 can also mean the
      // first request landed and only its answer was lost: POST /api/kudos
      // answers a resend of the same kudos inside two minutes with the one
      // it already made, so the retry never thanks or emails anyone twice.
      if (attempt === 0 && r.status === 0) { await send(1); return; }
      setSending(false);
      setError(r.error || "Couldn't send the kudos. Your message is still here.");
      return;
    }
    setSending(false);
    const data = (r.data as { data?: { id: string; receiver: GivenKudos["receiver"] } }).data ?? r.data;
    onGiven?.({ id: data.id, receiver: data.receiver });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) void close(); }}>
      <DialogContent className="max-w-[560px]" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}>
        <DialogHeader>
          <DialogTitle>Give kudos</DialogTitle>
          <DialogDescription>Thank a colleague by name. They get a notification, and it shows on the Kudos feed and their record.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Who do you want to thank?</span>
            <PeoplePickerField
              ariaLabel="Who do you want to thank?"
              value={to}
              people={picked}
              exclude={[boot.viewer.id]}
              placeholder="Choose a person"
              allowClear={false}
              onChange={(ids, ppl) => { setTo(ids.slice(0, 1)); setPicked(ppl); }}
            />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Message</span>
            <textarea
              ref={area}
              rows={3}
              value={message}
              maxLength={MAX + 50}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What did they do that made a difference?"
              className="min-h-[76px] resize-none rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus:border-[var(--os-brand)]"
              aria-describedby="kudos-count"
            />
            {remaining < 50 ? (
              <span id="kudos-count" className={`text-xs tabular-nums ${remaining < 0 ? "text-danger-text" : "text-ink-2"}`}>
                {remaining < 0 ? `${-remaining} characters over` : `${remaining} characters left`}
              </span>
            ) : <span id="kudos-count" className="sr-only">Up to {MAX} characters</span>}
          </label>
          {values.length ? (
            <div className="relative flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Company value</span>
              <button type="button" onClick={() => setValueOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={valueOpen}
                className="inline-flex h-8 w-full items-center rounded-md border border-line bg-raised px-3 text-start text-sm text-ink hover:bg-hover">
                {value ?? <span className="text-ink-3">No value</span>}
              </button>
              <Picker
                open={valueOpen}
                onClose={() => setValueOpen(false)}
                ariaLabel="Company value"
                selected={value ?? "__none__"}
                sections={[{ options: [{ value: "__none__", label: "No value" }, ...values.map((v) => ({ value: v, label: v }))] }]}
                onSelect={(v) => { setValueOpen(false); setValue(v === "__none__" ? null : v); }}
                className="absolute start-0 top-[60px] z-50"
              />
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => void close()} disabled={sending}>Cancel</Button>
          <Button onClick={() => void send()} disabled={!ready}>
            <Heart className="h-4 w-4" aria-hidden />
            {sending ? "Sending" : "Give kudos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
