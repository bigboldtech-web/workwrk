"use client";

// CanvasAiPanel — describe a system, get a diagram. A collapsible panel on the
// canvas: type "design a URL shortener with a cache", it calls
// /api/canvas/generate (Claude → a laid-out scene) and drops it on the board.

import { useRef, useState } from "react";
import { Sparkles, X, CornerDownLeft, Loader2 } from "lucide-react";
import type { CanvasScene } from "@/lib/canvas/scene";

const EXAMPLES = [
  "Design a URL shortener with a cache and rate limiter",
  "3-tier web app: React, API, Postgres, behind a load balancer",
  "Event-driven order pipeline with a queue and workers",
  "Auth flow: client, API gateway, auth service, user DB, Redis sessions",
];

export function CanvasAiPanel({ onApply }: { onApply: (scene: CanvasScene) => void }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastTitle, setLastTitle] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const generate = async (text: string) => {
    const p = text.trim();
    if (!p || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/canvas/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: p }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const scene: CanvasScene | undefined = data?.data?.scene ?? data?.scene;
      if (!scene || !Array.isArray(scene.elements)) throw new Error("No diagram returned.");
      onApply(scene);
      setLastTitle(data?.data?.title ?? data?.title ?? "Diagram");
      setPrompt("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); requestAnimationFrame(() => taRef.current?.focus()); }}
        title="Design with AI"
        style={{
          position: "absolute", top: 12, right: 12, zIndex: 8,
          display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px",
          background: "linear-gradient(135deg, #6965db, #0073EA)", color: "#fff",
          border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
          boxShadow: "0 6px 20px rgba(20,34,60,.18)",
        }}
      >
        <Sparkles style={{ width: 15, height: 15 }} /> Design with AI
      </button>
    );
  }

  return (
    <div style={{
      position: "absolute", top: 12, right: 12, zIndex: 8, width: "min(340px, calc(100vw - 24px))",
      background: "var(--os-surface, #fff)", border: "1px solid var(--os-line, #e5e7eb)",
      borderRadius: 14, boxShadow: "0 16px 44px rgba(20,34,60,.18)", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 12px", borderBottom: "1px solid var(--os-line, #e5e7eb)" }}>
        <Sparkles style={{ width: 15, height: 15, color: "#6965db" }} />
        <strong style={{ flex: 1, fontSize: 13.5, color: "var(--os-ink, #1e293b)" }}>Design with AI</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ display: "grid", placeItems: "center", width: 26, height: 26, border: "none", background: "transparent", borderRadius: 7, cursor: "pointer", color: "var(--os-ink-3, #9aa3b2)" }}>
          <X style={{ width: 15, height: 15 }} />
        </button>
      </div>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ position: "relative" }}>
          <textarea
            ref={taRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void generate(prompt); } }}
            placeholder="Describe the system to design…"
            rows={3}
            disabled={busy}
            style={{
              width: "100%", resize: "none", fontSize: 13.5, lineHeight: 1.4, padding: "9px 10px",
              border: "1px solid var(--os-line, #e5e7eb)", borderRadius: 10, outline: "none",
              fontFamily: "inherit", color: "var(--os-ink, #1e293b)", background: "var(--os-surface, #fff)",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => void generate(prompt)}
            disabled={busy || !prompt.trim()}
            style={{
              flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "9px 12px", border: "none", borderRadius: 10, cursor: busy || !prompt.trim() ? "default" : "pointer",
              background: busy || !prompt.trim() ? "var(--os-surface-1, #eef0f3)" : "#0073EA",
              color: busy || !prompt.trim() ? "var(--os-ink-3, #9aa3b2)" : "#fff", fontSize: 13.5, fontWeight: 600,
            }}
          >
            {busy ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Sparkles style={{ width: 14, height: 14 }} />}
            {busy ? "Designing…" : "Generate"}
            {!busy && prompt.trim() ? <span style={{ display: "inline-flex", alignItems: "center", gap: 2, opacity: 0.7, fontSize: 11 }}>⌘<CornerDownLeft style={{ width: 11, height: 11 }} /></span> : null}
          </button>
        </div>

        {err ? <p style={{ margin: 0, fontSize: 12.5, color: "#E11D48" }}>{err}</p> : null}
        {lastTitle && !err ? <p style={{ margin: 0, fontSize: 12.5, color: "var(--os-ink-3, #9aa3b2)" }}>Added “{lastTitle}” to the board. Describe another to add more.</p> : null}

        {!busy ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--os-ink-3, #9aa3b2)" }}>Try</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => { setPrompt(ex); void generate(ex); }}
                style={{ textAlign: "left", fontSize: 12.5, color: "var(--os-ink-2, #52525b)", background: "var(--os-surface-1, #f4f4f5)", border: "none", borderRadius: 8, padding: "7px 9px", cursor: "pointer" }}>
                {ex}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
