"use client";

// CallDock, the persistent call window. Mounted ONCE at shell level, so
// navigating between pages never unmounts it and the media connection stays
// live. This is the fix for "the call drops when I open another page": the
// call is a floating dock, not an inline panel that dies with its page.
//
// PHASE 4 (spec-talk.md section 2.6) made it a RESERVED REGION rather than a
// free-floating box, and that is a real behaviour change, not a restyle:
//
//   * Collapsed is 320 x 64 at the bottom-right, 24px from both edges, with
//     the conversation's name, the elapsed time in tabular figures, and the
//     four controls that matter while you are elsewhere: Mic, Camera, Expand,
//     Leave. The old mini bar was 340 x 46 with the roster in place of the
//     name, so you could see who you were with and not what you were in.
//   * Expanded is 360 x 440 and grows UPWARD from the same anchor, so the
//     dock never jumps across the screen when you expand it.
//   * The chrome reads the six fixed `.os-stage` tokens, not a zinc ramp that
//     light mode was quietly fighting.
//   * Presence says "In a call" for the duration and is RESTORED, not
//     overwritten, on leave: the person's own status choice comes back.
//
// Exactly one CallPanel is rendered, from the shell's `activeCall`. Collapsing
// only RESIZES the container; the panel is never unmounted (it becomes a
// hidden zero-size box), so audio keeps flowing. Leaving is the only thing
// that ends a call.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Maximize2, Mic, MicOff, Minimize2, PhoneOff, Video, VideoOff } from "lucide-react";
import { useOsShell, DEFAULT_PRESENCE, type PresenceStatus } from "@/components/layout/os/shell-context";
import { CallPanel, type CallPanelStatus } from "@/components/calls/call-panel";
import { Dots } from "@/components/ui/dots";
import type { CallDockParticipant, CallDockState } from "@/components/calls/call-stage";

/** The reserved region, spec-talk section 2.6 Body layout. */
const EXPANDED = { w: 360, h: 440 };
const COLLAPSED = { w: 320, h: 64 };
const MARGIN = 12;
/** The page-edge inset the incoming-call card stacks against. */
const ANCHOR = 24;

/** Initials for an avatar chip: the first letters of the first two words, else
 *  the first two characters. Kept local so the dock has no cross-import. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const one = parts[0] ?? "";
  return (one.slice(0, 2) || "?").toUpperCase();
}

/* The deterministic HSL hue per identity is GONE (spec-talk section 2.6: "no
   HSL hue-keyed avatar circles"). A generated colour reads as information
   about the person and carries none: two people on the same call could be
   handed the same hue, and the hue meant nothing either way. Initials on one
   neutral stage chip say exactly as much and say it honestly. */

function Avatar({ p, className = "" }: { p: CallDockParticipant; className?: string }) {
  return (
    <span
      title={p.name}
      className={`flex h-6 w-6 items-center justify-center rounded-full text-micro font-semibold ${className}`}
      style={{
        background: "var(--os-stage-surface-2)",
        color: "var(--os-stage-fg)",
        boxShadow: "0 0 0 2px var(--os-stage-surface)",
      }}
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

/** Isolated so its 1Hz tick re-renders ONLY the duration text, never the
 *  CallPanel subtree above it. Remounted via `key={callKey}` so a new call
 *  resets to 0:00 with no in-effect setState. Elapsed time is a DURATION, so
 *  it needs no locale: it is identical in every time zone. */
function CallTimer({ status }: { status: CallPanelStatus }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);
  // THE HEADER SAYS WHAT HAPPENED. It used to say "Connecting…" for as long
  // as the dock was open, including on a workspace with no media server,
  // where the body two lines below it said calls were not set up. A timer
  // that never resolves is a promise the product cannot keep.
  if (status === "not-configured") {
    return <span className="text-xs" style={{ color: "var(--os-stage-fg-2)" }}>Not set up</span>;
  }
  if (status === "failed") {
    return <span className="text-xs" style={{ color: "var(--os-danger-solid)" }}>Couldn&apos;t connect</span>;
  }
  if (status === "connecting") {
    return (
      <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--os-stage-fg-2)" }}>
        <Dots variant="pending" label="Connecting" /> Connecting…
      </span>
    );
  }
  return (
    <span className="font-mono text-xs tabular-nums" style={{ color: "var(--os-stage-fg-2)" }}>
      {fmtElapsed(elapsed)}
    </span>
  );
}

export function CallDock() {
  const { activeCall, endCall, setCallMinimized, presenceStatus, setPresenceStatus } = useOsShell();
  const router = useRouter();
  // null = anchored bottom-right via CSS (no window read on mount); a coord =
  // dragged, positioned by left/top and clamped into view at render time.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Live room state (mic, camera, roster), bridged out of the media room so
  // the header works even while collapsed.
  const [dock, setDock] = useState<CallDockState | null>(null);
  const [panelStatus, setPanelStatus] = useState<CallPanelStatus>("connecting");

  // Drop stale room state when the call switches (React's adjust-state-on-
  // prop-change pattern; the bridge re-reports for the new call).
  const callKey = `${activeCall?.conversationId ?? ""}:${activeCall?.meetingId ?? ""}`;
  const [prevCallKey, setPrevCallKey] = useState(callKey);
  if (callKey !== prevCallKey) {
    setPrevCallKey(callKey);
    setDock(null);
    setPanelStatus("connecting");
    // The dock returns to its anchor on a new call, so a drag from an hour
    // ago never decides where the next call appears.
    setPos(null);
  }

  // PRESENCE: "In a call" for the duration, and the person's own choice
  // RESTORED afterwards rather than overwritten (spec-talk section 2.6 Data).
  // The snapshot is a ref so what comes back is the status from when the call
  // started, not one set while it was running.
  const presenceBefore = useRef<PresenceStatus | null>(null);
  const presenceRef = useRef(presenceStatus);
  useEffect(() => { presenceRef.current = presenceStatus; }, [presenceStatus]);
  const inCall = Boolean(activeCall);
  useEffect(() => {
    if (!inCall) return;
    presenceBefore.current = presenceRef.current;
    setPresenceStatus({ emoji: "📞", label: "In a call", expiresAt: null });
    return () => {
      setPresenceStatus(presenceBefore.current ?? DEFAULT_PRESENCE);
      presenceBefore.current = null;
    };
  }, [inCall, setPresenceStatus]);

  const minimized = activeCall?.minimized ?? false;
  const w = minimized ? COLLAPSED.w : EXPANDED.w;
  const h = minimized ? COLLAPSED.h : EXPANDED.h;

  const clamp = useCallback((x: number, y: number, cw: number, ch: number) => ({
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, window.innerWidth - cw - MARGIN)),
    y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, window.innerHeight - ch - MARGIN)),
  }), []);

  // Re-clamp a dragged dock when the window resizes (event driven, not on mount).
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y, w, h) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [w, h, clamp]);

  // M and V while the dock has focus (spec-talk section 2.6 Keyboard), never
  // while a text field has focus, and never as the only path: both are also
  // buttons whose tooltips name the key.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "m" && dock?.ready) { e.preventDefault(); dock.toggleMic(); }
    if (k === "v" && dock?.ready) { e.preventDefault(); dock.toggleCamera(); }
  }, [dock]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // First drag: seed the coordinate from where the dock currently sits.
    const start = pos ?? (() => {
      const r = boxRef.current?.getBoundingClientRect();
      return r ? { x: r.left, y: r.top } : { x: window.innerWidth - w - ANCHOR, y: window.innerHeight - h - ANCHOR };
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

  // Clamp a dragged position into the viewport at render (which covers the
  // collapse and expand size change with no state write). Undragged: the CSS
  // anchor, so the dock grows upward rather than jumping.
  const placed = pos && typeof window !== "undefined" ? clamp(pos.x, pos.y, w, h) : null;
  const style: React.CSSProperties = placed
    ? { left: placed.x, top: placed.y, width: w, height: h }
    : { right: ANCHOR, bottom: ANCHOR, width: w, height: h };

  const btn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md os-stage__btn";
  const btnOff = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-danger-solid/20 os-stage__btn--danger";

  const people = dock?.participants ?? [];
  const faces = people.slice(0, 3);
  const status: CallPanelStatus = dock?.ready ? "ready" : panelStatus;
  // Nothing is "live" until it connects: a live dot over a call that never
  // started is the same lie the permanent "Connecting…" was.
  const live = status === "ready";

  return (
    <div
      ref={boxRef}
      role="region"
      aria-label="Call"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="os-stage fixed z-[45] flex flex-col overflow-hidden rounded-xl"
      style={{ ...style, border: "1px solid var(--os-stage-line)", boxShadow: "var(--os-shadow-pop)" }}
    >
      <header
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`flex shrink-0 cursor-grab touch-none select-none items-center gap-2 px-3 active:cursor-grabbing ${minimized ? "h-full" : "h-11"}`}
        style={{ background: "var(--os-stage-surface)", borderBottom: minimized ? "none" : "1px solid var(--os-stage-line)" }}
      >
        <Dots variant={live ? "live" : "pending"} />

        {faces.length > 0 ? (
          <span className="flex shrink-0 items-center">
            {faces.map((p, i) => <Avatar key={p.identity} p={p} className={i > 0 ? "-ms-2" : ""} />)}
            {people.length > 3 ? (
              <span
                className="-ms-2 flex h-6 w-6 items-center justify-center rounded-full text-micro font-semibold"
                style={{ background: "var(--os-stage-surface-2)", color: "var(--os-stage-fg-2)", boxShadow: "0 0 0 2px var(--os-stage-surface)" }}
              >
                +{people.length - 3}
              </span>
            ) : null}
          </span>
        ) : null}

        {/* The conversation's NAME, collapsed as well as expanded: the old
            mini bar showed the roster instead, so you could see who you were
            with and not what you were in. */}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium" style={{ color: "var(--os-stage-fg)" }}>
            {activeCall.subject}
          </span>
          <CallTimer key={callKey} status={status} />
        </span>

        {dock?.ready ? (
          <>
            <button
              type="button"
              title={dock.micOn ? "Mute · M" : "Unmute · M"}
              aria-label={dock.micOn ? "Mute" : "Unmute"}
              className={dock.micOn ? btn : btnOff}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => dock.toggleMic()}
            >
              {dock.micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              title={dock.cameraOn ? "Turn camera off · V" : "Turn camera on · V"}
              aria-label={dock.cameraOn ? "Turn camera off" : "Turn camera on"}
              className={dock.cameraOn ? btn : btnOff}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => dock.toggleCamera()}
            >
              {dock.cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </button>
          </>
        ) : null}

        {activeCall.href && !minimized ? (
          <button
            type="button"
            title="Open conversation"
            aria-label="Open conversation"
            className={btn}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => router.push(activeCall.href!)}
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        ) : null}

        <button
          type="button"
          title={minimized ? "Expand" : "Collapse"}
          aria-label={minimized ? "Expand" : "Collapse"}
          className={btn}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setCallMinimized(!minimized)}
        >
          {minimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
        </button>

        <button
          type="button"
          title="Leave call"
          aria-label="Leave call"
          className={btnOff}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={endCall}
        >
          <PhoneOff className="h-4 w-4" />
        </button>
      </header>

      {/* The CallPanel is ALWAYS mounted, hidden rather than unmounted while
          collapsed, so the connection and the audio survive. */}
      <div className={minimized ? "h-0 w-0 overflow-hidden" : "min-h-0 flex-1"}>
        <CallPanel
          conversationId={activeCall.conversationId}
          meetingId={activeCall.meetingId}
          subject={activeCall.subject}
          audioOnly={activeCall.audioOnly}
          onLeave={endCall}
          onState={setDock}
          onStatus={setPanelStatus}
        />
      </div>
    </div>
  );
}
