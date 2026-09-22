"use client";

// CallPanel, WorkwrK's own call surface (docs/plans/native-calls.md
// Phase 1). Asks /api/calls/token for a LiveKit grant and mounts the
// conference on OUR media server.
//
// THE PUBLIC JITSI FALLBACK IS GONE (Phase 4, decision Q1). Until now a 503
// from the token route, which is exactly what an unconfigured deployment
// answers, mounted meet.jit.si's IFrame API and joined a room on a
// third-party PUBLIC server, carrying the derived room name, the
// conversation subject and the person's display name with it. Nothing in the
// product said so. A call that cannot happen on our own media server now
// says it cannot happen, and says who can fix it.
//
// Join model: no prejoin screen. Audio starts ON, camera
// follows the button that opened the panel (video call vs audio call),
// and every device is switchable from the in-call control bar.

import { useEffect, useState } from "react";
import { PhoneOff } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { ConferenceSurface, type CallDockState } from "@/components/calls/conference-surface";

type Grant = { url: string; token: string; room: string };

export function CallPanel({ conversationId, meetingId, subject, displayName, audioOnly, onLeave, onState }: {
  conversationId?: string;
  meetingId?: string;
  subject?: string;
  displayName?: string | null;
  audioOnly?: boolean;
  onLeave?: () => void;
  /** Surfaces live mic/camera/roster to the dock (LiveKit path only). */
  onState?: (state: CallDockState) => void;
}) {
  // One state object per token request: id changes make a NEW request,
  // and stale results are dropped by the effect's active flag, no
  // synchronous reset writes needed in the effect body.
  const [call, setCall] = useState<{ grant: Grant | null; notConfigured: boolean; error: string | null }>(
    { grant: null, notConfigured: false, error: null },
  );
  const { grant, notConfigured, error } = call;

  useEffect(() => {
    let active = true;
    fetch("/api/calls/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(conversationId ? { conversationId } : { meetingId }),
    })
      .then(async (r) => {
        if (!active) return;
        if (r.status === 503) { setCall({ grant: null, notConfigured: true, error: null }); return; }
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Couldn't join the call");
        const d = await r.json();
        if (active) setCall({ grant: d, notConfigured: false, error: null });
      })
      .catch((e) => {
        if (active) setCall({ grant: null, notConfigured: false, error: e instanceof Error ? e.message : "Couldn't join the call" });
      });
    return () => { active = false; };
  }, [conversationId, meetingId]);

  if (notConfigured) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-line bg-subtle p-8 text-center">
        <PhoneOff className="h-6 w-6 text-ink-3" strokeWidth={1.5} aria-hidden />
        <p className="text-base font-medium text-ink">Calls are not set up on this workspace</p>
        <p className="max-w-sm text-sm text-ink-2">
          {subject ? `${subject} can still be used for messages. ` : ""}
          An Owner or Admin turns calling on in Settings. Nothing is sent to an outside service in the meantime.
        </p>
        {onLeave ? (
          <button type="button" onClick={onLeave} className="mt-1 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-raised">
            Close
          </button>
        ) : null}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-line bg-subtle p-8 text-center">
        <p className="text-base text-ink-2">{error}. Check your connection and try again.</p>
      </div>
    );
  }

  if (!grant) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-line bg-app text-ink-3" aria-label="Starting the call">
        {/* The four-dot mini loader, not a spinner (spec-shell 1.6). */}
        <Dots variant="pending" />
      </div>
    );
  }

  return (
    // os-stage on the WRAPPER as well as on ConferenceSurface's own root:
    // the box is painted a frame before LiveKit's tiles arrive, and a
    // near-white bg-app ground flashing under a dark stage is the one thing
    // a person notices on every join.
    <div className="os-stage h-full w-full overflow-hidden rounded-xl border border-line">
      <ConferenceSurface url={grant.url} token={grant.token} video={!audioOnly} onDisconnected={() => onLeave?.()} onState={onState} />
    </div>
  );
}
