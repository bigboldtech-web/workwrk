"use client";

/*
 * DocSplitView — side-by-side dual-doc layout.
 *
 * URL convention: /docs/<primaryId>?peek=<peekId>
 *   - Left pane:  primaryId (the page the user navigated to)
 *   - Right pane: peekId    (the secondary doc opened via "Open side pane")
 *
 * Two BlockDocEditors mount with independent scroll, each carrying its
 * own sticky header inside its own pane. A drag handle between the two
 * persists the split ratio in localStorage so the writer's preferred
 * split survives reloads.
 *
 * Closing the right pane navigates to /docs/<primaryId> (peek param
 * dropped). Swapping flips primary/peek.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowLeftRight, Maximize2, FileText } from "lucide-react";
import { BlockDocEditor } from "./block-doc-editor";
import { apiFetch } from "@/lib/api-fetch";

const RATIO_KEY = "workwrk:docs:splitRatio";
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

interface Props {
  primaryId: string;
  peekId: string;
}

export function DocSplitView({ primaryId, peekId }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState<number>(0.5);
  const draggingRef = useRef(false);

  // Hydrate the persisted split ratio. Done in an effect so we don't
  // mismatch SSR markup; the initial paint at 0.5 is fine since the
  // resize is non-destructive.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RATIO_KEY);
      if (!raw) return;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= MIN_RATIO && n <= MAX_RATIO) setRatio(n);
    } catch { /* localStorage may be disabled */ }
  }, []);

  // Drag handlers — track pointer X against the container width and
  // clamp to a sensible range so neither pane collapses.
  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const next = Math.min(MAX_RATIO, Math.max(MIN_RATIO, x / rect.width));
    setRatio(next);
  }, []);

  // The pointerup listener is one stable function that calls the latest
  // stopDrag through a ref, so the listener startDrag added is the one
  // stopDrag removes even after `ratio` has changed underneath it.
  const stopDragRef = useRef<() => void>(() => {});
  const onPointerUp = useCallback(() => { stopDragRef.current(); }, []);

  const stopDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try { localStorage.setItem(RATIO_KEY, String(ratio)); } catch { /* ignore */ }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp, ratio]);
  useEffect(() => { stopDragRef.current = stopDrag; }, [stopDrag]);

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp]);

  // Clean up listeners if the component unmounts mid-drag.
  useEffect(() => () => {
    if (draggingRef.current) {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  }, [onPointerMove, stopDrag]);

  // The peek pane's own 48px header names the doc (spec-docs-knowledge
  // section 2, Split view): title, Swap, Open full, close.
  const [peekTitle, setPeekTitle] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await apiFetch<{ doc?: { title?: string } }>(`/api/docs/${peekId}`, { cache: "no-store" });
      if (live) setPeekTitle(r.ok ? r.data.doc?.title ?? "" : "");
    })();
    return () => { live = false; };
  }, [peekId]);

  function closePeek() {
    router.push(`/docs/${primaryId}`);
  }
  function openFull() {
    router.push(`/docs/${peekId}`);
  }
  function swap() {
    router.push(`/docs/${peekId}?peek=${primaryId}`);
  }

  const leftPct = `${(ratio * 100).toFixed(2)}%`;
  const rightPct = `${((1 - ratio) * 100).toFixed(2)}%`;

  return (
    <div className="bdoc-split" ref={containerRef}>
      <div className="bdoc-split__pane" style={{ width: leftPct }}>
        <BlockDocEditor key={primaryId} docId={primaryId} />
      </div>

      <div
        className="bdoc-split__divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        onPointerDown={startDrag}
      >
        <span className="bdoc-split__divider-grip" />
      </div>

      <div className="bdoc-split__pane bdoc-split__pane--peek" style={{ width: rightPct }}>
        <div className="bdoc-split__peek-bar">
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-ink">
            <FileText className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            <span className="truncate">{peekTitle === null ? "" : peekTitle || "Untitled doc"}</span>
          </span>
          <button
            type="button"
            className="bdoc-split__peek-act"
            onClick={swap}
            title="Swap panes"
            aria-label="Swap panes"
          >
            <ArrowLeftRight />
          </button>
          <button
            type="button"
            className="bdoc-split__peek-act"
            onClick={openFull}
            title="Open full"
            aria-label="Open full"
          >
            <Maximize2 />
          </button>
          <button
            type="button"
            className="bdoc-split__peek-act"
            onClick={closePeek}
            title="Close side pane"
            aria-label="Close side pane"
          >
            <X />
          </button>
        </div>
        <BlockDocEditor key={peekId} docId={peekId} pane="peek" />
      </div>
    </div>
  );
}
