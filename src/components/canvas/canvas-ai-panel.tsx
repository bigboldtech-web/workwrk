"use client";

// CanvasAiPanel — the system-design copilot. A collapsible panel on the canvas:
//   • Generate — describe a system, /api/canvas/generate returns a laid-out scene.
//   • Templates — drop in a ready-made architecture (laid out locally, no call).
//   • Explain / Critique — /api/canvas/analyze reads the current board and either
//     walks through how it works or reviews it as a staff architect.

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, CornerDownLeft, Loader2, LayoutTemplate, BookOpen, ShieldAlert, Boxes, Server, Network, Database, Zap, ListOrdered, Cloud, User, Globe, Table2, RotateCcw, Code2, Copy, Check, ClipboardPaste } from "lucide-react";
import type { CanvasScene } from "@/lib/canvas/scene";
import { specToScene, type NodeKind, type DiagramSpec } from "@/lib/canvas/from-spec";
import { CANVAS_TEMPLATES } from "@/lib/canvas/templates";
import { schemaFromScene, type SchemaExport } from "@/lib/canvas/schema-export";
import { parseSchema } from "@/lib/canvas/schema-import";

type Turn = { role: "user" | "assistant"; text: string; error?: boolean };

// A one-line, human summary of what a refine changed (added / removed nodes),
// computed client-side by diffing the prior and new spec node sets.
function diffSummary(prev: DiagramSpec, next: DiagramSpec): string {
  const p = new Map((prev.nodes ?? []).map((n) => [n.id, n.label]));
  const q = new Map((next.nodes ?? []).map((n) => [n.id, n.label]));
  const added = [...q].filter(([id]) => !p.has(id)).map(([, l]) => l);
  const removed = [...p].filter(([id]) => !q.has(id)).map(([, l]) => l);
  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.slice(0, 6).join(", ")}`);
  if (removed.length) parts.push(`removed ${removed.slice(0, 6).join(", ")}`);
  return parts.length ? `Updated: ${parts.join("; ")}.` : "Updated the diagram.";
}

// Preset nodes for fast hand-drawing — each drops a pre-labelled, pre-styled
// shape via the same specToScene mapping the AI uses, so a hand-built system
// looks identical to a generated one.
const SYSTEM_KIT: { kind: NodeKind; label: string; Icon: typeof Server }[] = [
  { kind: "service", label: "Service", Icon: Server },
  { kind: "gateway", label: "Gateway", Icon: Network },
  { kind: "database", label: "Database", Icon: Database },
  { kind: "cache", label: "Cache", Icon: Zap },
  { kind: "queue", label: "Queue", Icon: ListOrdered },
  { kind: "cloud", label: "Cloud", Icon: Cloud },
  { kind: "actor", label: "User", Icon: User },
  { kind: "external", label: "External", Icon: Globe },
];

const EXAMPLES = [
  "Design a URL shortener with a cache and rate limiter",
  "Auth flow: client, API gateway, auth service, user DB, Redis sessions",
  "Design the database schema for a booking app",
];

type Props = {
  onApply: (scene: CanvasScene) => string[];
  onReplace?: (oldIds: string[], scene: CanvasScene) => string[];
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

export function CanvasAiPanel({ onApply, onReplace, getScene }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [thread, setThread] = useState<Turn[]>([]);
  const [analysis, setAnalysis] = useState<{ action: string; text: string } | null>(null);
  const [analyzing, setAnalyzing] = useState<"explain" | "critique" | null>(null);
  const [schema, setSchema] = useState<SchemaExport | null>(null);
  const [schemaTab, setSchemaTab] = useState<"sql" | "prisma">("sql");
  const [copied, setCopied] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importErr, setImportErr] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  // The last diagram the AI produced (spec + the element ids it put on the
  // board) — the seed for the next refine. Refresh via refs so the async send
  // always reads the latest without re-subscribing.
  const lastSpecRef = useRef<DiagramSpec | null>(null);
  const lastIdsRef = useRef<string[]>([]);
  const [hasDiagram, setHasDiagram] = useState(false);

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }); }, [thread]);

  const seed = (spec: DiagramSpec, ids: string[]) => {
    lastSpecRef.current = spec; lastIdsRef.current = ids; setHasDiagram(true);
  };
  const resetConversation = () => {
    lastSpecRef.current = null; lastIdsRef.current = []; setHasDiagram(false);
    setThread([]); setErr(null);
  };

  // One turn: fresh generate when there's no diagram yet, else refine the last
  // one in place (the AI edits the prior spec; we swap only its elements).
  const send = async (text: string) => {
    const p = text.trim();
    if (!p || busy) return;
    const prior = lastSpecRef.current;
    setBusy(true); setErr(null); setAnalysis(null);
    setThread((t) => [...t, { role: "user", text: p }]);
    setInput("");
    try {
      const res = await fetch("/api/canvas/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prior ? { prompt: p, priorSpec: prior } : { prompt: p }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const scene: CanvasScene | undefined = data?.data?.scene ?? data?.scene;
      const spec: DiagramSpec | undefined = data?.data?.spec ?? data?.spec;
      if (!scene || !Array.isArray(scene.elements)) throw new Error("No diagram returned.");
      let summary: string;
      if (prior && onReplace) {
        const ids = onReplace(lastIdsRef.current, scene);
        summary = spec ? diffSummary(prior, spec) : "Updated the diagram.";
        if (spec) seed(spec, ids); else lastIdsRef.current = ids;
      } else {
        const ids = onApply(scene);
        summary = `Designed “${data?.data?.title ?? data?.title ?? spec?.title ?? "diagram"}”.`;
        if (spec) seed(spec, ids);
      }
      setThread((t) => [...t, { role: "assistant", text: summary }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Generation failed.";
      setErr(msg);
      setThread((t) => [...t, { role: "assistant", text: msg, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (id: string) => {
    const t = CANVAS_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setErr(null); setAnalysis(null);
    const ids = onApply(specToScene(t.spec));
    seed(t.spec, ids); // a template can be refined too
    setThread([{ role: "assistant", text: `Added the ${t.label} template. Tell me how to change it.` }]);
  };

  const doImport = () => {
    const spec = parseSchema(importText);
    if (!spec || spec.nodes.length === 0) {
      setImportErr("Couldn't find any tables. Paste CREATE TABLE… statements or Prisma models.");
      return;
    }
    setErr(null); setAnalysis(null); setSchema(null);
    const ids = onApply(specToScene(spec));
    seed(spec, ids); // the imported schema can be refined by chat too
    const n = spec.nodes.length;
    setThread([{ role: "assistant", text: `Imported ${n} table${n === 1 ? "" : "s"}. Tell me how to change it.` }]);
    setImportOpen(false); setImportText(""); setImportErr(null);
  };

  const insertKit = (kind: NodeKind, label: string) => {
    setErr(null); setAnalysis(null);
    onApply(specToScene({ nodes: [{ id: "n", label, kind }] }));
  };
  const insertTable = () => {
    setErr(null); setAnalysis(null);
    onApply(specToScene({ nodes: [{ id: "t", label: "Table", fields: [
      { name: "id", type: "uuid", key: "pk" }, { name: "name", type: "text" }, { name: "created_at", type: "timestamp" },
    ] }] }));
  };

  const exportSchema = () => {
    if (!getScene) return;
    setErr(null); setAnalysis(null);
    const result = schemaFromScene(getScene());
    if (result.tableCount === 0) { setErr("Add ER tables to export a schema."); setSchema(null); return; }
    setSchema(result); setSchemaTab("sql"); setCopied(false);
  };
  const copySchema = () => {
    if (!schema) return;
    const text = schemaTab === "sql" ? schema.sql : schema.prisma;
    void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  const analyze = async (action: "explain" | "critique") => {
    if (!getScene || analyzing) return;
    const scene = getScene();
    if (!scene || scene.elements.length === 0) { setErr("Draw or generate a diagram first."); return; }
    setAnalyzing(action); setErr(null); setAnalysis(null); setSchema(null);
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
        {hasDiagram ? (
          <button type="button" onClick={resetConversation} title="Start a new design" style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 8px", border: `1px solid ${inkT.line}`, background: inkT.surf1, borderRadius: 7, cursor: "pointer", color: inkT.ink2, fontSize: 11.5, fontWeight: 600 }}>
            <RotateCcw style={{ width: 12, height: 12 }} /> New
          </button>
        ) : null}
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ display: "grid", placeItems: "center", width: 26, height: 26, border: "none", background: "transparent", borderRadius: 7, cursor: "pointer", color: inkT.ink3 }}>
          <X style={{ width: 15, height: 15 }} />
        </button>
      </div>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
        {thread.length > 0 ? (
          <div ref={threadRef} style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
            {thread.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", fontSize: 12.5, lineHeight: 1.4, padding: "6px 10px", borderRadius: 10,
                background: m.role === "user" ? "#0073EA" : m.error ? "rgba(225,29,72,.08)" : inkT.surf1,
                color: m.role === "user" ? "#fff" : m.error ? "#E11D48" : inkT.ink2,
                border: m.role === "user" ? "none" : `1px solid ${inkT.line}` }}>
                {m.text}
              </div>
            ))}
            {busy ? <div style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: inkT.ink3, padding: "4px 2px" }}><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> {hasDiagram ? "Updating…" : "Designing…"}</div> : null}
          </div>
        ) : null}

        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey || !e.shiftKey) && e.key === "Enter") { e.preventDefault(); void send(input); } }}
          placeholder={hasDiagram ? "Refine: add a cache, split the service, make the DB a cluster…" : "Describe the system to design…"}
          rows={hasDiagram ? 2 : 3}
          disabled={busy}
          style={{
            width: "100%", resize: "none", fontSize: 13.5, lineHeight: 1.4, padding: "9px 10px",
            border: `1px solid ${inkT.line}`, borderRadius: 10, outline: "none",
            fontFamily: "inherit", color: inkT.ink, background: "var(--os-surface, #fff)",
          }}
        />
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "9px 12px", border: "none", borderRadius: 10, cursor: busy || !input.trim() ? "default" : "pointer",
            background: busy || !input.trim() ? inkT.surf1 : "#0073EA",
            color: busy || !input.trim() ? inkT.ink3 : "#fff", fontSize: 13.5, fontWeight: 600,
          }}
        >
          {busy ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Sparkles style={{ width: 14, height: 14 }} />}
          {busy ? (hasDiagram ? "Updating…" : "Designing…") : (hasDiagram ? "Update" : "Generate")}
          {!busy && input.trim() ? <span style={{ display: "inline-flex", alignItems: "center", gap: 2, opacity: 0.7, fontSize: 11 }}><CornerDownLeft style={{ width: 11, height: 11 }} /></span> : null}
        </button>

        {err && thread.length === 0 ? <p style={{ margin: 0, fontSize: 12.5, color: "#E11D48" }}>{err}</p> : null}

        {!busy ? (
          <>
            {!hasDiagram ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: inkT.ink3 }}>Try</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => void send(ex)}
                    style={{ textAlign: "left", fontSize: 12.5, color: inkT.ink2, background: inkT.surf1, border: "none", borderRadius: 8, padding: "7px 9px", cursor: "pointer" }}>
                    {ex}
                  </button>
                ))}
              </div>
            ) : null}

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

            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: inkT.ink3 }}>
                <ClipboardPaste style={{ width: 12, height: 12 }} /> Import schema
              </span>
              {!importOpen ? (
                <button type="button" onClick={() => { setImportOpen(true); setImportErr(null); }}
                  style={{ textAlign: "left", fontSize: 12.5, color: inkT.ink2, background: inkT.surf1, border: `1px solid ${inkT.line}`, borderRadius: 8, padding: "7px 9px", cursor: "pointer" }}>
                  Paste SQL DDL or a Prisma schema…
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={"CREATE TABLE users (\n  id uuid PRIMARY KEY,\n  ...\n);\n\n— or —\n\nmodel User { id String @id ... }"}
                    rows={5}
                    style={{ width: "100%", resize: "vertical", fontSize: 12, lineHeight: 1.4, padding: "8px 9px", border: `1px solid ${inkT.line}`, borderRadius: 9, outline: "none", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: inkT.ink, background: "var(--os-surface, #fff)" }}
                  />
                  {importErr ? <p style={{ margin: 0, fontSize: 12, color: "#E11D48" }}>{importErr}</p> : null}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={doImport} disabled={!importText.trim()}
                      style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 10px", border: "none", borderRadius: 9, cursor: importText.trim() ? "pointer" : "default", background: importText.trim() ? "#0073EA" : inkT.surf1, color: importText.trim() ? "#fff" : inkT.ink3, fontSize: 12.5, fontWeight: 600 }}>
                      <ClipboardPaste style={{ width: 13, height: 13 }} /> Add to canvas
                    </button>
                    <button type="button" onClick={() => { setImportOpen(false); setImportText(""); setImportErr(null); }}
                      style={{ padding: "7px 10px", border: `1px solid ${inkT.line}`, borderRadius: 9, cursor: "pointer", background: inkT.surf1, color: inkT.ink2, fontSize: 12.5, fontWeight: 600 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: inkT.ink3 }}>
                <Boxes style={{ width: 12, height: 12 }} /> System kit
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {SYSTEM_KIT.map((k) => (
                  <button key={k.kind + k.label} type="button" onClick={() => insertKit(k.kind, k.label)} title={`Add ${k.label}`}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: inkT.surf1, border: `1px solid ${inkT.line}`, borderRadius: 9, padding: "8px 4px", cursor: "pointer", color: inkT.ink2 }}>
                    <k.Icon style={{ width: 15, height: 15 }} />
                    <span style={{ fontSize: 10.5, fontWeight: 600 }}>{k.label}</span>
                  </button>
                ))}
                <button type="button" onClick={insertTable} title="Add ER table"
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: inkT.surf1, border: `1px solid ${inkT.line}`, borderRadius: 9, padding: "8px 4px", cursor: "pointer", color: inkT.ink2 }}>
                  <Table2 style={{ width: 15, height: 15 }} />
                  <span style={{ fontSize: 10.5, fontWeight: 600 }}>Table</span>
                </button>
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
                  <button type="button" onClick={exportSchema} disabled={!!analyzing} style={smallBtn(!!analyzing)} title="Export ER tables as SQL / Prisma">
                    <Code2 style={{ width: 13, height: 13 }} /> Schema
                  </button>
                </div>
                {analysis ? (
                  <div style={{ background: inkT.surf1, border: `1px solid ${inkT.line}`, borderRadius: 10, padding: "9px 11px", maxHeight: 240, overflowY: "auto" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "#6965db", marginBottom: 4 }}>{analysis.action === "critique" ? "Design review" : "How it works"}</div>
                    <Markdown text={analysis.text} />
                  </div>
                ) : null}
                {schema ? (
                  <div style={{ border: `1px solid ${inkT.line}`, borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderBottom: `1px solid ${inkT.line}`, background: inkT.surf1 }}>
                      {(["sql", "prisma"] as const).map((tab) => (
                        <button key={tab} type="button" onClick={() => { setSchemaTab(tab); setCopied(false); }}
                          style={{ padding: "3px 8px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontWeight: 600,
                            background: schemaTab === tab ? "#0073EA" : "transparent", color: schemaTab === tab ? "#fff" : inkT.ink2 }}>
                          {tab === "sql" ? "SQL" : "Prisma"}
                        </button>
                      ))}
                      <span style={{ flex: 1 }} />
                      <button type="button" onClick={copySchema} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", border: `1px solid ${inkT.line}`, borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontWeight: 600, background: "var(--os-surface, #fff)", color: inkT.ink2 }}>
                        {copied ? <Check style={{ width: 12, height: 12 }} /> : <Copy style={{ width: 12, height: 12 }} />} {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <pre style={{ margin: 0, padding: "9px 11px", maxHeight: 240, overflow: "auto", fontSize: 11.5, lineHeight: 1.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: inkT.ink, background: "var(--os-surface, #fff)", whiteSpace: "pre" }}>
                      {schemaTab === "sql" ? schema.sql : schema.prisma}
                    </pre>
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
