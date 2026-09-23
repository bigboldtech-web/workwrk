"use client";

// CallStage, the shared in-call surface for members AND guests: the LiveKit
// conference plus WorkwrK's reaction layer.
//
// THE NAME IS THE POINT OF THE RENAME (spec-talk.md section 3). It was
// `CallStage`, which is a fifth word for the thing the product calls
// a call: the naming canon settles on Call (the session), Call dock (the
// floating window) and Call stage (the tiles). "Conference" appeared nowhere
// a person could read it, only in the code, which is exactly how a product
// ends up with five words for one thing.
//
// Reactions ride LiveKit data channels (topic "wk-react"): an emoji tap
// broadcasts to every participant and floats up from the bottom of the
// tiles; ✋ Raise hand is sticky, raised hands pin a chip listing names
// until their owner lowers them, or leaves, which prunes their entry on the
// room's own ParticipantDisconnected event (a disconnect sends no packet).
// Pure client + data channel: zero server involvement, works for guests.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom, VideoConference, useConnectionState, useDataChannel, useLocalParticipant, useParticipants, useRoomContext,
} from "@livekit/components-react";
import { RoomEvent, type RemoteParticipant } from "livekit-client";
import "@livekit/components-styles";
import { Hand } from "lucide-react";

/** One person on the call, surfaced to the dock so it can show "who am I in
 *  this call with" even while minimized (the video tiles are hidden then). */
export type CallDockParticipant = { identity: string; name: string; isLocal: boolean };

/** Live call state surfaced OUT of the LiveKit room so the persistent CallDock
 *  can drive its own header controls, mic, camera and roster, usable even
 *  while the call is minimized (the VideoConference control bar is hidden
 *  then). Bridged up because the dock lives OUTSIDE <LiveKitRoom>. */
export type CallDockState = {
  ready: boolean;
  micOn: boolean;
  toggleMic: () => void;
  cameraOn: boolean;
  toggleCamera: () => void;
  participants: CallDockParticipant[];
};

const REACT_TOPIC = "wk-react";
const EMOJI = ["👍", "❤️", "😂", "🎉", "👏"];
const FLOAT_MS = 2600;

type ReactMsg = { kind: "emoji"; emoji: string } | { kind: "hand"; raised: boolean; name: string };

/* `trailingControls` is GONE (Phase 4, spec-talk section 0). It was threaded
   from here through ReactionLayer to a slot in the reaction bar and NO
   CALLER ever passed it: call-panel.tsx and guest-call-client.tsx both omit
   it. A prop with no caller is chrome that looks extensible and is not. The
   controls it hinted at become the named CallControls row in step 8.

   The `.os-stage` class on the root is the other half of this step: the
   surface takes its dark ground from the six fixed stage tokens
   (src/app/globals.css) rather than from a zinc utility, so it looks the
   same in light and dark and needs no dark-mode pass. The rename to
   CallStage rides step 8 with the reserved-region dock. */
export function CallStage({ url, token, video, audio = true, onDisconnected, onState }: {
  url: string;
  token: string;
  video: boolean;
  /** Publish the microphone on connect. DEFAULTS TRUE so the member path,
   *  which has no pre-join mic control and gets a working one from the dock
   *  the moment it is connected, behaves exactly as it always has. The guest
   *  door DOES have a pre-join mic toggle and passes it here: without this
   *  prop a guest who set "Mic off" before joining a stranger's meeting
   *  arrived with a live microphone, because `audio` was a literal true. */
  audio?: boolean;
  onDisconnected?: () => void;
  /** Reports live mic/camera/roster up to the dock (see CallDockState). */
  onState?: (state: CallDockState) => void;
}) {
  return (
    <div className="os-stage relative h-full w-full" data-lk-theme="default">
      <LiveKitRoom serverUrl={url} token={token} connect audio={audio} video={video} onDisconnected={onDisconnected} style={{ height: "100%" }}>
        <VideoConference />
        <ReactionLayer />
        {onState ? <RoomBridge onState={onState} /> : null}
      </LiveKitRoom>
    </div>
  );
}

/** Lives inside LiveKitRoom so it can read the live mic/camera/roster and
 *  report them up to the dock. Renders nothing. A signature gate keeps the
 *  ~10Hz speaking-level churn of `useParticipants` from spamming the dock: it
 *  only reports up when connection, mic, camera or the roster identities
 *  actually change. */
function RoomBridge({ onState }: { onState: (state: CallDockState) => void }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const participants = useParticipants();
  const ready = useConnectionState() === "connected";
  const lastSig = useRef<string>("");
  useEffect(() => {
    const people: CallDockParticipant[] = participants.map((p) => ({
      identity: p.identity,
      name: p.name || p.identity || "Guest",
      isLocal: p.isLocal,
    }));
    const sig = `${ready}|${isMicrophoneEnabled}|${isCameraEnabled}|${people.map((p) => `${p.identity}~${p.name}`).join(",")}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    onState({
      ready,
      micOn: !!isMicrophoneEnabled,
      toggleMic: () => { void localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled); },
      cameraOn: !!isCameraEnabled,
      toggleCamera: () => { void localParticipant?.setCameraEnabled(!isCameraEnabled); },
      participants: people,
    });
  }, [participants, ready, isMicrophoneEnabled, isCameraEnabled, localParticipant, onState]);
  return null;
}

function ReactionLayer() {
  const [floats, setFloats] = useState<{ id: number; emoji: string; left: number }[]>([]);
  const [hands, setHands] = useState<Map<string, string>>(new Map()); // identity → name
  const [myHand, setMyHand] = useState(false);
  const idRef = useRef(0);
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  // A raised hand is sticky and a disconnect broadcasts nothing, so without
  // this the chip keeps naming somebody who has left for the rest of the
  // call and NOBODY can clear it: a guest is issued a fresh random identity
  // with every token, so they cannot even rejoin and lower their own. Pruned
  // on the room's own disconnect event rather than by diffing the roster,
  // because `useParticipants` re-renders at speaking-level rate and a stale
  // snapshot could drop a hand raised in the same tick its owner joined.
  useEffect(() => {
    const drop = (participant: RemoteParticipant) => {
      setHands((prev) => {
        if (!prev.has(participant.identity)) return prev;
        const next = new Map(prev);
        next.delete(participant.identity);
        return next;
      });
    };
    room.on(RoomEvent.ParticipantDisconnected, drop);
    return () => { room.off(RoomEvent.ParticipantDisconnected, drop); };
  }, [room]);

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

  // send() is async, its rejections escape a sync try/catch entirely
  // (fleet finding: unhandled rejection + silently lost hand state).
  const broadcast = useCallback(
    (payload: ReactMsg) => send(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true }),
    [send],
  );

  const connectionState = useConnectionState();
  const ready = connectionState === "connected";
  // Pre-connect the local identity is "", a hand keyed by it could never
  // be lowered by anyone. The bar is disabled until connected.
  const myIdentity = localParticipant?.identity || null;

  const react = (emoji: string) => {
    if (!ready) return;
    showFloat(emoji); // your own reaction floats immediately
    void broadcast({ kind: "emoji", emoji }).catch(() => { /* others miss one emoji, harmless */ });
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
      // Nobody heard it, showing yourself as raised would be a lie.
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
            /* A floating reaction is a GLYPH, not text: the type scale is
               about reading, and 28px here is the size of the emoji itself.
               Set as a style so it does not read as a text-size decision. */
            className="absolute bottom-16 wk-react-float"
            style={{ left: `${f.left}%`, fontSize: 28, lineHeight: 1 }}
          >
            {f.emoji}
          </span>
        ))}
      </div>

      {/* Raised hands chip */}
      {hands.size > 0 && (
        <div className="absolute left-3 top-3 z-[4] flex items-center gap-1.5 rounded-full bg-warning-solid/95 px-3 py-1.5 text-sm font-medium text-amber-950 shadow">
          <Hand className="h-4 w-4" />
          {[...hands.values()].slice(0, 3).join(", ")}{hands.size > 3 ? ` +${hands.size - 3}` : ""}
        </div>
      )}

      {/* Reaction bar */}
      <div className={`os-stage__bar absolute bottom-20 left-1/2 z-[4] flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-1.5 backdrop-blur ${ready ? "" : "pointer-events-none opacity-50"}`}>
        {EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => react(e)}
            className="os-stage__bar-btn flex h-8 w-8 items-center justify-center rounded-full text-lg"
            aria-label={`React ${e}`}
          >
            {e}
          </button>
        ))}
        <button
          type="button"
          onClick={toggleHand}
          className={
            myHand
              ? "flex h-8 items-center gap-1 rounded-full bg-warning-solid px-2.5 text-sm font-medium text-amber-950"
              : "os-stage__bar-btn flex h-8 items-center gap-1 rounded-full px-2.5 text-sm font-medium"
          }
        >
          <Hand className="h-4 w-4" /> {myHand ? "Lower" : "Raise"}
        </button>
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
