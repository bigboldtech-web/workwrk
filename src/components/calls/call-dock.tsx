"use client";

// CallDock — the persistent, draggable call window. Mounted ONCE at shell
// level (os-shell), so navigating between pages never unmounts it and the
// LiveKit connection stays live. This is the fix for "the call drops when I
// open another page": the call is a floating Slack-style huddle, not an
// inline panel that dies with its page.
//
// Exactly one CallPanel is rendered from shell `activeCall`. Minimizing only
// RESIZES the container — the CallPanel is never unmounted (a hidden h-0 box),
// so audio keeps flowing while collapsed. Leaving is the only thing that ends
// the call. Position defaults to a bottom-right CSS anchor and only becomes an
// absolute coordinate once the user drags (so nothing reads the window on
// mount), then is clamped into view at render.
//
// The header carries its own mic/camera/roster/duration, bridged out of the
// LiveKit room (see CallDockState), so a minimized huddle still tells you who
// you're with, how long you've been on, and lets you mute or cut video without
// re-opening — the in-video control bar is hidden while collapsed.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Maximize2, Mic, MicOff, Minus, PhoneOff, Video, VideoOff } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { CallPanel } from "@/components/calls/call-panel";
import type { CallDockParticipant, CallDockState } from "@/components/calls/conference-surface";

const EXPANDED = { w: 360, h: 440 };
const MINI_W = 340;
const MINI_H = 46;
const MARGIN = 12;

/** Initials for the avatar chip: first letters of the first two words, else
 *  the first two characters — the same rule the rest of the app reads names
 *  by, kept local so the dock has no cross-import. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const one = parts[0] ?? "";
  return (one.slice(0, 2) || "?").toUpperCase();
}

/** Deterministic hue per identity so a given person keeps one colour. */
function hueOf(identity: string): number {
  let h = 0;
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) % 360;
  return h;
}

function Avatar({ p, className = "" }: { p: CallDockParticipant; className?: string }) {
  return (
    <span
      title={p.name}
      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-zinc-800 ${className}`}
      style={{ backgroundColor: `hsl(${hueOf(p.identity)} 52% 42%)` }}
    >
      {initialsOf(p.name)}
    </span>
  );
}

function fmtElapsed(total: number): string {
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Isolated so its 1Hz tick re-renders ONLY the duration text — never the
 *  CallPanel/LiveKit subtree above it. Remounted via a `key={callKey}` so a new
 *  call resets to 0:00 with no in-effect setState. */
function CallTimer() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);
  return <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-400">{fmtElapsed(elapsed)}</span>;
}

export function CallDock() {
  const { activeCall, endCall, setCallMinimized } = useOsShell();
  const router = useRouter();
  // null = anchored bottom-right via CSS (no window read on mount); a coord =
  // dragged, positioned by left/top and clamped into view at render time.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Live room state (mic/camera/roster), bridged out of the LiveKit room so the
  // header works even while minimized (the in-video control bar is hidden then).
  const [dock, setDock] = useState<CallDockState | null>(null);
  // Drop stale room state when the call switches (React's adjust-state-on-
  // prop-change pattern — the bridge re-reports for the new call).
  const callKey = `${activeCall?.conversationId ?? ""}:${activeCall?.meetingId ?? ""}`;
  const [prevCallKey, setPrevCallKey] = useState(callKey);
  if (callKey !== prevCallKey) {
    // Adjust-state-on-prop-change (not an effect): a new call drops the stale
    // room state; the timer resets on its own via key={callKey} remount.
    setPrevCallKey(callKey);
    setDock(null);
  }

  const minimized = activeCall?.minimized ?? false;
  const w = minimized ? MINI_W : EXPANDED.w;
  const h = minimized ? MINI_H : EXPANDED.h;

  const clamp = useCallback((x: number, y: number, cw: number, ch: number) => ({
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, window.innerWidth - cw - MARGIN)),
    y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, window.innerHeight - ch - MARGIN)),
  }), []);

  // Re-clamp a dragged dock when the window resizes (event-driven, not on mount).
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y, w, h) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [w, h, clamp]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // First drag: seed the coordinate from where the dock currently sits.
    const start = pos ?? (() => {
      const r = boxRef.current?.getBoundingClientRect();
      return r ? { x: r.left, y: r.top } : { x: window.innerWidth - w - 20, y: window.innerHeight - h - 20 };
    })();
    drag.current = { dx: e.clientX - start.x, dy: e.clientY - start.y };
    setPos(start);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pos, w, h]);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy, w, h));
  }, [w, h, clamp]);
  const endDrag = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  if (!activeCall) return null;

  // Clamp a dragged position into the viewport at render (covers minimize/
  // expand size changes without a state write). Undragged → CSS bottom-right.
  const placed = pos && typeof window !== "undefined" ? clamp(pos.x, pos.y, w, h) : null;
  const style: React.CSSProperties = placed
    ? { left: placed.x, top: placed.y, width: w, height: h }
    : { right: 20, bottom: 20, width: w, height: h };

  const btn = "flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-300 hover:bg-zinc-700 hover:text-white";
  const activeBtn = "flex h-6 w-6 shrink-0 items-center justify-center rounded bg-red-500/20 text-red-300 hover:bg-red-500/30";

  const people = dock?.participants ?? [];
  const others = people.filter((p) => !p.isLocal);
  const faces = people.slice(0, 3);
  // Minimized has no room for the subject, so it shows who you're with instead.
  const roster =
    people.length <= 1
      ? "Waiting for others…"
      : others.length === 1
        ? others[0].name
        : `${people.length} people`;

  return (
    <div
      ref={boxRef}
      className="fixed z-[45] flex flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      style={style}
    >
      <header
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1.5 bg-zinc-800 px-2.5 py-2 active:cursor-grabbing"
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>

        {/* Roster faces — who you're on the call with, visible even minimized. */}
        {faces.length > 0 ? (
          <span className="flex shrink-0 items-center">
            {faces.map((p, i) => (
              <Avatar key={p.identity} p={p} className={i > 0 ? "-ml-2" : ""} />
            ))}
            {people.length > 3 ? (
              <span className="-ml-2 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-600 text-[10px] font-semibold text-zinc-100 ring-2 ring-zinc-800">
                +{people.length - 3}
              </span>
            ) : null}
          </span>
        ) : null}

        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-zinc-100">
          {minimized ? roster : activeCall.subject}
        </span>

        {/* Duration — remounts per call, ticks in isolation. */}
        <CallTimer key={callKey} />

        {dock?.ready ? (
          <>
            <button
              type="button"
              title={dock.micOn ? "Mute" : "Unmute"}
              className={dock.micOn ? btn : activeBtn}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => dock.toggleMic()}
            >
              {dock.micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              title={dock.cameraOn ? "Turn camera off" : "Turn camera on"}
              className={dock.cameraOn ? btn : activeBtn}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => dock.toggleCamera()}
            >
              {dock.cameraOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
            </button>
          </>
        ) : null}

        {activeCall.href && !minimized ? (
          <button
            type="button"
            title="Open conversation"
            className={btn}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => router.push(activeCall.href!)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          title={minimized ? "Expand" : "Minimize"}
          className={btn}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setCallMinimized(!minimized)}
        >
          {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          title="Leave call"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-red-400 hover:bg-red-500/20 hover:text-red-300"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={endCall}
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* CallPanel is ALWAYS mounted — hidden (not unmounted) when minimized so
          the LiveKit connection and audio survive. */}
      <div className={minimized ? "h-0 w-0 overflow-hidden" : "min-h-0 flex-1"}>
        <CallPanel
          conversationId={activeCall.conversationId}
          meetingId={activeCall.meetingId}
          room={activeCall.room}
          subject={activeCall.subject}
          displayName={activeCall.displayName}
          audioOnly={activeCall.audioOnly}
          onLeave={endCall}
          onState={setDock}
        />
      </div>
    </div>
  );
}
