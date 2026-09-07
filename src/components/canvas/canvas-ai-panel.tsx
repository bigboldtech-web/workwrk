"use client";

// CanvasAiPanel — the system-design copilot. A collapsible panel on the canvas:
//   • Generate — describe a system, /api/canvas/generate returns a laid-out scene.
//   • Templates — drop in a ready-made architecture (laid out locally, no call).
//   • Explain / Critique — /api/canvas/analyze reads the current board and either
//     walks through how it works or reviews it as a staff architect.

import { useRef, useState } from "react";
import { Sparkles, X, CornerDownLeft, Loader2, LayoutTemplate, BookOpen, ShieldAlert } from "lucide-react";
import type { CanvasScene } from "@/lib/canvas/scene";
import { specToScene } from "@/lib/canvas/from-spec";
import { CANVAS_TEMPLATES } from "@/lib/canvas/templates";

const EXAMPLES = [
  "Design a URL shortener with a cache and rate limiter",
  "Auth flow: client, API gateway, auth service, user DB, Redis sessions",
  "Design the database schema for a booking app",
];

type Props = {
  onApply: (scene: CanvasScene) => void;
  getScene?: () => CanvasScene;
};

const inkT = { ink: "var(--os-ink, #1e293b)", ink2: "var(--os-ink-2, #52525b)", ink3: "var(--os-ink-3, #9aa3b2)", line: "var(--os-line, #e5e7eb)", surf1: "var(--os-surface-1, #f4f4f5)" };

// Tiny markdown render — headings, bullets, inline **bold**. Enough for the
// analysis output without pulling in a markdown dependency.
function renderInline(s: string, key: number) {
  const parts = s.split(/\*\*(.+?)\*\*/g);
  return <span key={key}>{parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p))}</span>;
}
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(<ul key={`u${out.length}`} style={{ margin: "2px 0 6px", paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>{bullets.map((b, i) => <li key={i} style={{ fontSize: 12.5, lineHeight: 1.45, color: inkT.ink2 }}>{renderInline(b, i)}</li>)}</ul>);
      bullets = [];
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    if (/^#{1,3}\s/.test(line)) { flush(); out.push(<div key={i} style={{ fontSize: 12.5, fontWeight: 700, color: inkT.ink, margin: "6px 0 2px" }}>{line.replace(/^#{1,3}\s/, "")}</div>); return; }
    if (/^[-*]\s/.test(line)) { bullets.push(line.replace(/^[-*]\s/, "")); return; }
    // a bold-only line reads as a subheading
    if (/^\*\*.+\*\*:?$/.test(line)) { flush(); out.push(<div key={i} style={{ fontSize: 12.5, fontWeight: 700, color: inkT.ink, margin: "6px 0 2px" }}>{line.replace(/\*\*/g, "").replace(/:$/, "")}</div>); return; }
    flush();
    out.push(<p key={i} style={{ margin: "0 0 6px", fontSize: 12.5, lineHeight: 1.45, color: inkT.ink2 }}>{renderInline(line, i)}</p>);
  });
  flush();
  return <>{out}</>;
}

export function CanvasAiPanel({ onApply, getScene }: Props) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastTitle, setLastTitle] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{ action: string; text: string } | null>(null);
  const [analyzing, setAnalyzing] = useState<"explain" | "critique" | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const generate = async (text: string) => {
    const p = text.trim();
    if (!p || busy) return;
    setBusy(true); setErr(null); setAnalysis(null);
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

  const applyTemplate = (id: string) => {
    const t = CANVAS_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setErr(null); setAnalysis(null);
    onApply(specToScene(t.spec));
    setLastTitle(t.spec.title ?? t.label);
  };

  const analyze = async (action: "explain" | "critique") => {
    if (!getScene || analyzing) return;
    const scene = getScene();
    if (!scene || scene.elements.length === 0) { setErr("Draw or generate a diagram first."); return; }
    setAnalyzing(action); setErr(null); setAnalysis(null);
    try {
      const res = await fetch("/api/canvas/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scene, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const t: string | undefined = data?.data?.text ?? data?.text;
      if (!t) throw new Error("No response.");
      setAnalysis({ action, text: t });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setAnalyzing(null);
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

  const smallBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
    padding: "7px 8px", border: `1px solid ${inkT.line}`, borderRadius: 9, cursor: active ? "default" : "pointer",
    background: inkT.surf1, color: inkT.ink2, fontSize: 12.5, fontWeight: 600,
  });

  return (
    <div style={{
      position: "absolute", top: 12, right: 12, zIndex: 8, width: "min(340px, calc(100vw - 24px))",
      maxHeight: "calc(100vh - 24px)", display: "flex", flexDirection: "column",
      background: "var(--os-surface, #fff)", border: `1px solid ${inkT.line}`,
      borderRadius: 14, boxShadow: "0 16px 44px rgba(20,34,60,.18)", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 12px", borderBottom: `1px solid ${inkT.line}` }}>
        <Sparkles style={{ width: 15, height: 15, color: "#6965db" }} />
        <strong style={{ flex: 1, fontSize: 13.5, color: inkT.ink }}>Design with AI</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ display: "grid", placeItems: "center", width: 26, height: 26, border: "none", background: "transparent", borderRadius: 7, cursor: "pointer", color: inkT.ink3 }}>
          <X style={{ width: 15, height: 15 }} />
        </button>
      </div>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
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
            border: `1px solid ${inkT.line}`, borderRadius: 10, outline: "none",
            fontFamily: "inherit", color: inkT.ink, background: "var(--os-surface, #fff)",
          }}
        />
        <button
          type="button"
          onClick={() => void generate(prompt)}
          disabled={busy || !prompt.trim()}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "9px 12px", border: "none", borderRadius: 10, cursor: busy || !prompt.trim() ? "default" : "pointer",
            background: busy || !prompt.trim() ? inkT.surf1 : "#0073EA",
            color: busy || !prompt.trim() ? inkT.ink3 : "#fff", fontSize: 13.5, fontWeight: 600,
          }}
        >
          {busy ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Sparkles style={{ width: 14, height: 14 }} />}
          {busy ? "Designing…" : "Generate"}
          {!busy && prompt.trim() ? <span style={{ display: "inline-flex", alignItems: "center", gap: 2, opacity: 0.7, fontSize: 11 }}>⌘<CornerDownLeft style={{ width: 11, height: 11 }} /></span> : null}
        </button>

        {err ? <p style={{ margin: 0, fontSize: 12.5, color: "#E11D48" }}>{err}</p> : null}
        {lastTitle && !err && !analysis ? <p style={{ margin: 0, fontSize: 12.5, color: inkT.ink3 }}>Added “{lastTitle}” to the board.</p> : null}

        {!busy ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: inkT.ink3 }}>Try</span>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => { setPrompt(ex); void generate(ex); }}
                  style={{ textAlign: "left", fontSize: 12.5, color: inkT.ink2, background: inkT.surf1, border: "none", borderRadius: 8, padding: "7px 9px", cursor: "pointer" }}>
                  {ex}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: inkT.ink3 }}>
                <LayoutTemplate style={{ width: 12, height: 12 }} /> Templates
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {CANVAS_TEMPLATES.map((t) => (
                  <button key={t.id} type="button" onClick={() => applyTemplate(t.id)} title={t.blurb}
                    style={{ textAlign: "left", background: inkT.surf1, border: `1px solid ${inkT.line}`, borderRadius: 9, padding: "8px 9px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: inkT.ink }}>{t.label}</span>
                    <span style={{ fontSize: 11, lineHeight: 1.3, color: inkT.ink3 }}>{t.blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            {getScene ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${inkT.line}`, paddingTop: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: inkT.ink3 }}>This board</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => void analyze("explain")} disabled={!!analyzing} style={smallBtn(!!analyzing)}>
                    {analyzing === "explain" ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <BookOpen style={{ width: 13, height: 13 }} />} Explain
                  </button>
                  <button type="button" onClick={() => void analyze("critique")} disabled={!!analyzing} style={smallBtn(!!analyzing)}>
                    {analyzing === "critique" ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <ShieldAlert style={{ width: 13, height: 13 }} />} Critique
                  </button>
                </div>
                {analysis ? (
                  <div style={{ background: inkT.surf1, border: `1px solid ${inkT.line}`, borderRadius: 10, padding: "9px 11px", maxHeight: 240, overflowY: "auto" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "#6965db", marginBottom: 4 }}>{analysis.action === "critique" ? "Design review" : "How it works"}</div>
                    <Markdown text={analysis.text} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
