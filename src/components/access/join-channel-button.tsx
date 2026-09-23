"use client";

// The LockedPage "Join" variant (access-model-spec 6.4, spec-talk.md section 1
// Access): a findable public channel you are not in.
//
// Every other locked object asks its owner for permission, because there is a
// decision for somebody to make. A public channel has no such decision: the
// answer is already yes, and Request access would have created an inbox row
// for a person whose only possible reply is "of course". Self-join replaces
// the request entirely, which is why this is a sibling of RequestAccessButton
// rather than a relabelling of it.
//
// It refuses honestly rather than optimistically: a channel that turned
// private, or was archived, between the page load and the click gets the
// server's own sentence, not a blank page.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dots } from "@/components/ui/dots";
import { apiFetch } from "@/lib/api-fetch";

export function JoinChannelButton({
  conversationId,
  label = "Join channel",
}: {
  conversationId: string;
  label?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setState("busy");
    setError(null);
    const r = await apiFetch(`/api/conversations/${conversationId}/join`, { method: "POST" });
    if (r.ok) {
      // A refresh rather than a push: the URL is already right, and this way
      // the server components above re-run with the membership in place.
      router.refresh();
      return;
    }
    setState("idle");
    setError(r.status === 404 ? "This channel isn't open to join." : r.error);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => void join()}
        disabled={state === "busy"}
        className="os-chrome inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-[var(--os-brand-hover)] disabled:opacity-60"
      >
        {state === "busy" ? <Dots variant="pending" label="Joining" /> : null}
        {label}
      </button>
      {error ? <p className="m-0 text-sm text-danger-text">{error}</p> : null}
    </div>
  );
}
