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
import { CallStage, type CallDockState } from "@/components/calls/call-stage";

type Grant = { url: string; token: string; room: string };

// `displayName` is deliberately NOT a prop. The name a participant appears
// under is stamped on the token by /api/calls/token from the SESSION, which is
// the only version of it anybody should trust: a client-supplied display name
// on a call is a client-supplied display name on a call. The dock used to pass
// one and this file used to accept it and never use it, which read as though
// the value mattered.
export type CallPanelStatus = "connecting" | "ready" | "failed" | "not-configured";

export function CallPanel({ conversationId, meetingId, subject, audioOnly, onLeave, onState, onStatus }: {
  conversationId?: string;
  meetingId?: string;
  subject?: string;
  audioOnly?: boolean;
  onLeave?: () => void;
  /** Surfaces live mic/camera/roster to the dock (LiveKit path only). */
  onState?: (state: CallDockState) => void;
  /** So the dock's header can say what actually happened. It used to read
   *  "Connecting…" for ever beside a body that said calls were not set up,
   *  which is two contradictory sentences on one overlay. */
  onStatus?: (status: CallPanelStatus) => void;
}) {
  // One state object per token request: id changes make a NEW request,
  // and stale results are dropped by the effect's active flag, no
  // synchronous reset writes needed in the effect body.
  // `reachedServer` separates "the server told us why" from "we never got
  // there". The panel used to print `{error}. Check your connection and try
  // again.` for BOTH, so a refusal the server explained precisely came out as
  // "This conversation is archived. Restore it first. Check your connection
  // and try again.", which blames the network for a decision the server made.
  // Dropping the sentence outright is the other half of the same mistake: a
  // real connection failure would then read "Failed to fetch" and offer
  // nothing. So it is kept, and shown only when it is true.
  const [call, setCall] = useState<{ grant: Grant | null; notConfigured: boolean; error: string | null; reachedServer: boolean }>(
    { grant: null, notConfigured: false, error: null, reachedServer: false },
  );
  const { grant, notConfigured, error, reachedServer } = call;

  useEffect(() => {
    let active = true;
    fetch("/api/calls/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(conversationId ? { conversationId } : { meetingId }),
    })
      .then(async (r) => {
        if (!active) return;
        if (r.status === 503) { setCall({ grant: null, notConfigured: true, error: null, reachedServer: true }); return; }
        if (!r.ok) {
          const body = (await r.json().catch(() => null))?.error ?? "Couldn't join the call";
          if (active) setCall({ grant: null, notConfigured: false, error: body, reachedServer: true });
          return;
        }
        const d = await r.json();
        if (active) setCall({ grant: d, notConfigured: false, error: null, reachedServer: true });
      })
      .catch((e) => {
        if (active) setCall({ grant: null, notConfigured: false, error: e instanceof Error ? e.message : "Couldn't join the call", reachedServer: false });
      });
    return () => { active = false; };
  }, [conversationId, meetingId]);

  // One report per transition, to whoever is drawing the chrome around this.
  useEffect(() => {
    if (!onStatus) return;
    onStatus(notConfigured ? "not-configured" : error ? "failed" : grant ? "ready" : "connecting");
  }, [onStatus, notConfigured, error, grant]);

  // EVERY STATE BELOW IS PAINTED IN STAGE TOKENS, not dashboard utilities.
  // .os-stage rebinds only the six --os-stage-* values; it does NOT rebind
  // --os-app, --os-subtle or --os-ink (globals.css says so in as many words).
  // A `bg-subtle` card inside the dark dock therefore rendered as a white box
  // under a near-black header, which is exactly the two-tone flash the
  // comment on the CallStage wrapper below warns about.
  if (notConfigured) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 rounded-xl p-8 text-center"
        style={{ background: "var(--os-stage-bg)", border: "1px solid var(--os-stage-line)" }}
      >
        <PhoneOff className="h-6 w-6" style={{ color: "var(--os-stage-fg-2)" }} strokeWidth={1.5} aria-hidden />
        <p className="text-base font-medium" style={{ color: "var(--os-stage-fg)" }}>Calls are not set up on this workspace</p>
        <p className="max-w-sm text-sm" style={{ color: "var(--os-stage-fg-2)" }}>
          {subject ? `${subject} can still be used for messages. ` : ""}
          An Owner or Admin turns calling on in Settings. Nothing is sent to an outside service in the meantime.
        </p>
        {onLeave ? (
          <button
            type="button"
            onClick={onLeave}
            className="mt-1 rounded-md px-3 py-1.5 text-sm font-medium"
            style={{ border: "1px solid var(--os-stage-line)", color: "var(--os-stage-fg)" }}
          >
            Close
          </button>
        ) : null}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex h-full items-center justify-center rounded-xl p-8 text-center"
        style={{ background: "var(--os-stage-bg)", border: "1px solid var(--os-stage-line)" }}
      >
        <p className="text-base" style={{ color: "var(--os-stage-fg-2)" }}>{reachedServer ? error : `${error}. Check your connection and try again.`}</p>
      </div>
    );
  }

  if (!grant) {
    return (
      <div
        className="flex h-full items-center justify-center rounded-xl"
        style={{ background: "var(--os-stage-bg)", border: "1px solid var(--os-stage-line)", color: "var(--os-stage-fg-2)" }}
        aria-label="Starting the call"
      >
        {/* The four-dot mini loader, not a spinner (spec-shell 1.6). */}
        <Dots variant="pending" />
      </div>
    );
  }

  return (
    // os-stage on the WRAPPER as well as on CallStage's own root:
    // the box is painted a frame before LiveKit's tiles arrive, and a
    // near-white bg-app ground flashing under a dark stage is the one thing
    // a person notices on every join.
    <div className="os-stage h-full w-full overflow-hidden rounded-xl border border-line">
      <CallStage url={grant.url} token={grant.token} video={!audioOnly} onDisconnected={() => onLeave?.()} onState={onState} />
    </div>
  );
}
