"use client";

// New channel (spec-talk.md section 3): Name with a "#" prefix, Topic, and
// the ONE switch that decides who can reach it.
//
// "Restricted: only people you add" is the access model's single switch, not a
// pair of them, and the caption under it changes rather than a second control
// appearing: a public channel says it is findable by everyone, a restricted
// one says it is not. Two switches would have let somebody build the state
// nobody wants (private and advertised) and would have needed a paragraph to
// explain.
//
// A restricted channel opens Add people immediately after creation, because a
// private channel with one member is not a thing anybody meant to make.
//
// Q3 is decided: ANY MEMBER creates channels, Guests never. That is already
// true of POST /api/conversations, which has no role check beyond membership
// of the module, so this dialog adds no gate of its own and the sidebar
// simply does not render the entry for a Guest.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dots } from "@/components/ui/dots";
import { Switch } from "@/components/ui/switch";
import { AddPeopleDialog } from "@/components/talk/add-people-dialog";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import { CHANNEL_NAME_MAX, normaliseChannelName } from "@/lib/channel-name";

export function NewChannelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A restricted channel goes straight to Add people: created, then peopled.
  const [addPeopleFor, setAddPeopleFor] = useState<string | null>(null);

  const slug = normaliseChannelName(name);

  const close = () => {
    setName("");
    setTopic("");
    setRestricted(false);
    setError(null);
    onClose();
  };

  const create = async () => {
    if (!slug || busy) return;
    setBusy(true);
    setError(null);
    try {
      // ONE REQUEST, privacy included. It used to create a PUBLIC channel and
      // then PATCH it private, so between the two calls, and permanently if
      // the second failed, a channel somebody had asked to be private was
      // listed in everybody's Browse channels and any Member could self-join
      // it. Nothing about the answer to "who can reach this" belongs in a
      // follow-up write.
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "CHANNEL",
          name: slug,
          ...(topic.trim() ? { topic: topic.trim() } : {}),
          restricted,
          findable: !restricted,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.id) {
        setError(d?.error || "Couldn't create the channel. Try again.");
        setBusy(false);
        return;
      }
      window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
      setBusy(false);
      if (restricted) {
        setAddPeopleFor(d.id);
        return;
      }
      close();
      router.push(`/tlk/${d.id}`);
    } catch {
      setError("Couldn't create the channel. Check your connection and try again.");
      setBusy(false);
    }
  };

  if (addPeopleFor) {
    return (
      <AddPeopleDialog
        conversationId={addPeopleFor}
        existingMemberIds={[]}
        onClose={() => { const id = addPeopleFor; setAddPeopleFor(null); close(); router.push(`/tlk/${id}`); }}
        onAdded={() => { const id = addPeopleFor; setAddPeopleFor(null); close(); router.push(`/tlk/${id}`); }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="w-full" style={{ maxWidth: 560 }}>
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
        </DialogHeader>

        <label className="block">
          <span className="mb-1 block text-micro font-semibold uppercase tracking-wide text-ink-3">Name</span>
          <span className="flex h-9 items-center rounded-md border border-line bg-app px-2 focus-within:border-line-strong">
            <span className="pe-0.5 text-base text-ink-3" aria-hidden>#</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void create(); } }}
              maxLength={CHANNEL_NAME_MAX}
              placeholder="sales"
              aria-label="Channel name"
              className="h-full w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
            />
          </span>
          {slug && slug !== name.trim().toLowerCase() ? (
            <span className="mt-1 block text-xs text-ink-2">It will be called #{slug}</span>
          ) : null}
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-micro font-semibold uppercase tracking-wide text-ink-3">Topic (optional)</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={280}
            placeholder="What is this channel for?"
            className="h-9 w-full rounded-md border border-line bg-app px-2 text-sm text-ink outline-none focus:border-line-strong"
          />
        </label>

        <div className="mt-4 flex items-start justify-between gap-3 rounded-md border border-line p-3">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              {restricted ? <Lock className="h-3.5 w-3.5 text-ink-2" aria-hidden /> : null}
              Restricted: only people you add
            </span>
            <span className="mt-0.5 block text-xs text-ink-2">
              {restricted
                ? "Nobody else can find or open it, workspace admins included. You will add people next."
                : "Findable by everyone at this company. Anyone can open it and join."}
            </span>
          </span>
          <Switch checked={restricted} aria-label="Restricted" onChange={setRestricted} />
        </div>

        {error ? <p className="m-0 mt-2 text-sm text-danger-text">{error}</p> : null}

        <DialogFooter>
          <button type="button" onClick={close} className="h-9 rounded-md px-3 text-base text-ink-2 hover:bg-hover">Cancel</button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!slug || busy}
            className="inline-flex h-9 items-center gap-2 rounded-md px-4 text-base font-medium text-white disabled:opacity-50"
            style={{ background: "var(--os-brand)" }}
          >
            {busy ? <Dots variant="pending" label="Creating" /> : null}
            Create channel
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
