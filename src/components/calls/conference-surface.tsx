"use client";

// ConferenceSurface — the shared in-call chrome for members AND guests
// (native-calls Phase 4): LiveKit conference + WorkwrK's reaction layer.
//
// Reactions ride LiveKit data channels (topic "wk-react"): an emoji tap
// broadcasts to every participant and floats up from the bottom of the
// tiles; ✋ Raise hand is sticky — raised hands pin a chip listing names
// until their owner lowers them (or leaves, which drops their packets).
// Pure client + data channel: zero server involvement, works for guests.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom, VideoConference, useConnectionState, useDataChannel, useLocalParticipant,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Hand } from "lucide-react";

/** Mic state surfaced OUT of the LiveKit room so the persistent CallDock can
 *  offer a mute button in its header — usable even while the call is minimized
 *  (the VideoConference control bar is hidden then). */
export type CallMicState = { ready: boolean; micOn: boolean; toggle: () => void };

const REACT_TOPIC = "wk-react";
const EMOJI = ["👍", "❤️", "😂", "🎉", "👏"];
const FLOAT_MS = 2600;

type ReactMsg = { kind: "emoji"; emoji: string } | { kind: "hand"; raised: boolean; name: string };

export function ConferenceSurface({ url, token, video, onDisconnected, trailingControls, onMic }: {
  url: string;
  token: string;
  video: boolean;
  onDisconnected?: () => void;
  /** Extra member-only controls (e.g. the record button) rendered in the reaction bar. */
  trailingControls?: React.ReactNode;
  /** Reports the local mic state/toggle up to the dock (see CallMicState). */
  onMic?: (state: CallMicState) => void;
}) {
  return (
    <div className="relative h-full w-full" data-lk-theme="default">
      <LiveKitRoom serverUrl={url} token={token} connect audio video={video} onDisconnected={onDisconnected} style={{ height: "100%" }}>
        <VideoConference />
        <ReactionLayer trailingControls={trailingControls} />
        {onMic ? <MicBridge onMic={onMic} /> : null}
      </LiveKitRoom>
    </div>
  );
}

/** Lives inside LiveKitRoom so it can read/toggle the local mic, and reports
 *  that up to the dock. Renders nothing. */
function MicBridge({ onMic }: { onMic: (state: CallMicState) => void }) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const ready = useConnectionState() === "connected";
  useEffect(() => {
    onMic({
      ready,
      micOn: !!isMicrophoneEnabled,
      toggle: () => { void localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled); },
    });
  }, [onMic, ready, isMicrophoneEnabled, localParticipant]);
  return null;
}

function ReactionLayer({ trailingControls }: { trailingControls?: React.ReactNode }) {
  const [floats, setFloats] = useState<{ id: number; emoji: string; left: number }[]>([]);
  const [hands, setHands] = useState<Map<string, string>>(new Map()); // identity → name
  const [myHand, setMyHand] = useState(false);
  const idRef = useRef(0);
  const { localParticipant } = useLocalParticipant();

  const showFloat = useCallback((emoji: string) => {
    const id = ++idRef.current;
    setFloats((prev) => [...prev.slice(-14), { id, emoji, left: 12 + Math.random() * 76 }]);
    window.setTimeout(() => setFloats((prev) => prev.filter((f) => f.id !== id)), FLOAT_MS);
  }, []);

  const { send } = useDataChannel(REACT_TOPIC, (msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload)) as ReactMsg;
      const from = msg.from?.identity ?? "unknown";
      if (data.kind === "emoji") showFloat(data.emoji);
      else if (data.kind === "hand") {
        setHands((prev) => {
          const next = new Map(prev);
          if (data.raised) next.set(from, data.name);
          else next.delete(from);
          return next;
        });
      }
    } catch { /* not ours */ }
  });

  // send() is async — its rejections escape a sync try/catch entirely
  // (fleet finding: unhandled rejection + silently lost hand state).
  const broadcast = useCallback(
    (payload: ReactMsg) => send(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true }),
    [send],
  );

  const connectionState = useConnectionState();
  const ready = connectionState === "connected";
  // Pre-connect the local identity is "" — a hand keyed by it could never
  // be lowered by anyone. The bar is disabled until connected.
  const myIdentity = localParticipant?.identity || null;

  const react = (emoji: string) => {
    if (!ready) return;
    showFloat(emoji); // your own reaction floats immediately
    void broadcast({ kind: "emoji", emoji }).catch(() => { /* others miss one emoji — harmless */ });
  };

  const myName = localParticipant?.name || localParticipant?.identity || "You";
  const toggleHand = () => {
    if (!ready || !myIdentity) return;
    const raised = !myHand;
    const apply = (up: boolean) => {
      setMyHand(up);
      setHands((prev) => {
        const next = new Map(prev);
        if (up) next.set(myIdentity, myName); else next.delete(myIdentity);
        return next;
      });
    };
    apply(raised);
    void broadcast({ kind: "hand", raised, name: myName }).catch(() => {
      // Nobody heard it — showing yourself as raised would be a lie.
      apply(!raised);
    });
  };

  return (
    <>
      {/* Floating reactions */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {floats.map((f) => (
          <span
            key={f.id}
            className="absolute bottom-16 text-[28px] wk-react-float"
            style={{ left: `${f.left}%` }}
          >
            {f.emoji}
          </span>
        ))}
      </div>

      {/* Raised hands chip */}
      {hands.size > 0 && (
        <div className="absolute left-3 top-3 z-[4] flex items-center gap-1.5 rounded-full bg-amber-400/95 px-3 py-1.5 text-[13px] font-medium text-amber-950 shadow">
          <Hand className="h-4 w-4" />
          {[...hands.values()].slice(0, 3).join(", ")}{hands.size > 3 ? ` +${hands.size - 3}` : ""}
        </div>
      )}

      {/* Reaction bar */}
      <div className={`absolute bottom-20 left-1/2 z-[4] flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900/85 px-2 py-1.5 shadow-lg backdrop-blur ${ready ? "" : "pointer-events-none opacity-50"}`}>
        {EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => react(e)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[17px] hover:bg-white/15"
            aria-label={`React ${e}`}
          >
            {e}
          </button>
        ))}
        <button
          type="button"
          onClick={toggleHand}
          className={`flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium ${myHand ? "bg-amber-400 text-amber-950" : "text-white hover:bg-white/15"}`}
        >
          <Hand className="h-4 w-4" /> {myHand ? "Lower" : "Raise"}
        </button>
        {trailingControls}
      </div>

      <style>{`
        @keyframes wk-react-rise {
          0% { transform: translateY(0) scale(0.8); opacity: 0; }
          12% { opacity: 1; transform: translateY(-14px) scale(1.1); }
          100% { transform: translateY(-190px) scale(1); opacity: 0; }
        }
        .wk-react-float { animation: wk-react-rise ${FLOAT_MS}ms ease-out forwards; }
      `}</style>
    </>
  );
}
