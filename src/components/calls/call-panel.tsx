"use client";

// CallPanel — WorkwrK's own call surface (docs/plans/native-calls.md
// Phase 1). Asks /api/calls/token for a LiveKit grant and mounts the
// conference on OUR media server. While the calls box isn't configured
// (token route 503s) it falls back to the legacy Jitsi embed, so the
// swap ships dark and lights up with env config alone.
//
// Slack-huddle join model: no prejoin screen. Audio starts ON, camera
// follows the button that opened the panel (video call vs audio call),
// and every device is switchable from the in-call control bar.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ConferenceSurface } from "@/components/calls/conference-surface";
import { MeetingCall } from "@/components/meetings/meeting-call";

type Grant = { url: string; token: string; room: string };

export function CallPanel({ conversationId, meetingId, room, subject, displayName, audioOnly, onLeave }: {
  conversationId?: string;
  meetingId?: string;
  /** Legacy Jitsi room name — the fallback while the calls box is dark. */
  room: string;
  subject?: string;
  displayName?: string | null;
  audioOnly?: boolean;
  onLeave?: () => void;
}) {
  // One state object per token request: id changes make a NEW request,
  // and stale results are dropped by the effect's active flag — no
  // synchronous reset writes needed in the effect body.
  const [call, setCall] = useState<{ grant: Grant | null; fallback: boolean; error: string | null }>(
    { grant: null, fallback: false, error: null },
  );
  const { grant, fallback, error } = call;

  useEffect(() => {
    let active = true;
    fetch("/api/calls/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(conversationId ? { conversationId } : { meetingId }),
    })
      .then(async (r) => {
        if (!active) return;
        if (r.status === 503) { setCall({ grant: null, fallback: true, error: null }); return; }
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Couldn't join the call");
        const d = await r.json();
        if (active) setCall({ grant: d, fallback: false, error: null });
      })
      .catch((e) => {
        if (active) setCall({ grant: null, fallback: false, error: e instanceof Error ? e.message : "Couldn't join the call" });
      });
    return () => { active = false; };
  }, [conversationId, meetingId]);

  if (fallback) {
    return <MeetingCall room={room} subject={subject} displayName={displayName} audioOnly={audioOnly} onLeave={onLeave} />;
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 p-8 text-center">
        <p className="text-[14px] text-zinc-600">{error}. Check your connection and try again.</p>
      </div>
    );
  }

  if (!grant) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-zinc-200 bg-zinc-900 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Starting the call…
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-900">
      <ConferenceSurface url={grant.url} token={grant.token} video={!audioOnly} onDisconnected={() => onLeave?.()} />
    </div>
  );
}
