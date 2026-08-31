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

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Maximize2, Minus, PhoneOff } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { CallPanel } from "@/components/calls/call-panel";

const EXPANDED = { w: 360, h: 440 };
const MINI_W = 300;
const MINI_H = 44;
const MARGIN = 12;

export function CallDock() {
  const { activeCall, endCall, setCallMinimized } = useOsShell();
  const router = useRouter();
  // null = anchored bottom-right via CSS (no window read on mount); a coord =
  // dragged, positioned by left/top and clamped into view at render time.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

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
        <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-zinc-100">{activeCall.subject}</span>
        {activeCall.href ? (
          <button
            type="button"
            title="Open conversation"
            className={btn}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => router.push(activeCall.href)}
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
        />
      </div>
    </div>
  );
}
