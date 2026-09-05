"use client";

// CanvasPreview — read-only, fit-to-content thumbnail of a Canvas, drawn with
// the same painter as the live editor (src/lib/canvas/render). Used to embed a
// Canvas inside a Doc and (Phase D) as a canvas-in-canvas card. It fetches the
// scene once, converts a legacy Excalidraw scene on the fly, and repaints on
// resize. Never writes — a pure viewer.

import { useEffect, useRef, useState } from "react";
import { isCanvasScene, emptyScene, type CanvasScene } from "@/lib/canvas/scene";
import { isExcalidrawScene, importExcalidraw } from "@/lib/canvas/import-excalidraw";
import { renderScene } from "@/lib/canvas/render";

interface Props {
  whiteboardId: string;
  /** Fixed height in CSS px (width fills the container). */
  height?: number;
  /** Pre-fetched scene, to skip the network round-trip (Phase D). */
  scene?: CanvasScene | null;
  className?: string;
  background?: string;
}

function toScene(raw: unknown): CanvasScene {
  if (isCanvasScene(raw)) return raw;
  if (isExcalidrawScene(raw)) return importExcalidraw(raw);
  return emptyScene();
}

export function CanvasPreview({ whiteboardId, height = 200, scene: given, className, background = "#ffffff" }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Scene fetched from the server (uncontrolled mode). When `given` is supplied
  // the component is controlled and renders that directly — no fetch, no state.
  const [fetched, setFetched] = useState<CanvasScene | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(given ? "ready" : "loading");

  // Fetch the scene once, unless the caller supplied one. State updates happen
  // only inside the async callbacks (never synchronously in the effect body).
  useEffect(() => {
    if (given) return;
    let active = true;
    fetch(`/api/whiteboards/${whiteboardId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d) => { if (active) { setFetched(toScene(d?.whiteboard?.scene)); setStatus("ready"); } })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [whiteboardId, given]);

  const scene = given ?? fetched;
  const state = given ? "ready" : status;

  // Paint + repaint on resize.
  useEffect(() => {
    if (state !== "ready" || !scene) return;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const paint = () => {
      const w = wrap.clientWidth || 1;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderScene(ctx, scene, { width: w, height, dpr, background, padding: 14 });
    };

    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [state, scene, height, background]);

  const empty = state === "ready" && (!scene || scene.elements.length === 0);

  return (
    <div ref={wrapRef} className={className} style={{ position: "relative", width: "100%", height }}>
      <canvas ref={canvasRef} style={{ display: "block", borderRadius: 8 }} />
      {state === "loading" && (
        <div style={placeholderStyle}>Loading canvas…</div>
      )}
      {state === "error" && (
        <div style={placeholderStyle}>Canvas unavailable</div>
      )}
      {empty && (
        <div style={placeholderStyle}>Empty canvas</div>
      )}
    </div>
  );
}

const placeholderStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12.5,
  color: "#94a3b8",
  pointerEvents: "none",
};
