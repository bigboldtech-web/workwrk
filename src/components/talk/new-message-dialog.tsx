"use client";

// New message (spec-talk.md section 3). One person is a direct message,
// several is a group, and the dialog says which as you pick rather than
// asking you to choose a "kind" first: nobody starting a conversation thinks
// "I would like to create a GROUP entity".
//
// It was an inline modal inside the 866-line sidebar file, with its own copy
// of the people search. Both halves are shared now: the search is
// PeoplePicker, and the dialog is a file somebody can find.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dots } from "@/components/ui/dots";
import { PeoplePicker, personLabel, type PersonRow } from "@/components/talk/people-picker";
import { WINDOW_EVENTS } from "@/lib/realtime-events";

export function NewMessageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [picked, setPicked] = useState<PersonRow[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGroup = picked.length > 1;

  const close = () => {
    setPicked([]);
    setName("");
    setError(null);
    onClose();
  };

  const start = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: isGroup ? "GROUP" : "DM",
          // The route's field is `memberIds`, not `userIds`. Caught by
          // calling it: the dialog looked right and answered "Pick at least
          // one person" with three people picked.
          memberIds: picked.map((p) => p.id),
          ...(isGroup && name.trim() ? { name: name.trim() } : {}),
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.id) {
        setError(d?.error || "Couldn't start the conversation. Try again.");
        setBusy(false);
        return;
      }
      window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
      close();
      router.push(`/tlk/${d.id}`);
    } catch {
      setError("Couldn't start the conversation. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="w-full" style={{ maxWidth: 560 }}>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
        </DialogHeader>

        <PeoplePicker
          picked={picked}
          onChange={(next) => { setPicked(next); setError(null); }}
          placeholder="Search people"
        />

        {isGroup ? (
          <label className="mt-3 block">
            <span className="mb-1 block text-micro font-semibold uppercase tracking-wide text-ink-3">Group name (optional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder={picked.slice(0, 3).map((p) => p.firstName).join(", ")}
              className="h-9 w-full rounded-md border border-line bg-app px-2 text-sm text-ink outline-none focus:border-line-strong"
            />
          </label>
        ) : null}

        {error ? <p className="m-0 mt-2 text-sm text-danger-text">{error}</p> : null}

        <DialogFooter>
          <button type="button" onClick={close} className="h-9 rounded-md px-3 text-base text-ink-2 hover:bg-hover">Cancel</button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={picked.length === 0 || busy}
            className="inline-flex h-9 items-center gap-2 rounded-md px-4 text-base font-medium text-white disabled:opacity-50"
            style={{ background: "var(--os-brand)" }}
          >
            {busy ? <Dots variant="pending" label="Starting" /> : null}
            {isGroup ? "Start group" : "Start chat"}
          </button>
        </DialogFooter>

        {picked.length === 1 ? (
          <p className="m-0 mt-1 text-xs text-ink-2">A direct message with {personLabel(picked[0])}.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
