"use client";

/* Public signing page (no auth) — a party opens their /sign/[token] link, sees
 * the document with their assigned fields highlighted, draws/types a signature,
 * fills text/date fields, and submits. Mirrors the /run/[token] pattern.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, CheckCircle2, PenLine, X } from "lucide-react";
import { BlockNoteCanvas } from "@/components/docs/blocknote-canvas";
import { PdfPages } from "@/components/agreements/pdf-pages";

type Field = { id: string; type: string; partyId: string; page?: number; x: number; y: number; w: number; h: number; label?: string; required?: boolean };
type SignData = {
  title: string; content: string; sourceType?: string; pdfUrl?: string | null; status: string;
  party: { id: string; name: string; email: string; role: string; status: string };
  fields: Field[]; myFields: Field[]; values: Record<string, string>;
};

export default function SignPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [data, setData] = useState<SignData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [padFor, setPadFor] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const res = await fetch(`/api/public/sign/${token}`);
        if (!res.ok) { setErr("This signing link is invalid or has expired."); return; }
        const d = (await res.json()) as SignData;
        setData(d);
        setValues(d.values || {});
        if (d.party.status === "SIGNED") setDone(true);
      } catch { setErr("Couldn't load the document."); }
    })();
  }, [token]);

  const myIds = new Set((data?.myFields ?? []).map((f) => f.id));

  async function finish() {
    if (!data || submitting) return;
    // Validate required (signature/initials always; text/date if required).
    for (const f of data.myFields) {
      const need = f.type === "signature" || f.type === "initials" || f.required;
      if (need && !(values[f.id] || "").trim()) { setErr("Please complete all your fields before finishing."); return; }
    }
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/sign/${token}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) { setErr((await res.json().catch(() => ({})))?.error || "Couldn't submit."); return; }
      setDone(true);
    } catch { setErr("Couldn't submit."); } finally { setSubmitting(false); }
  }

  if (err && !data) return <Centered><p className="text-sm text-zinc-500">{err}</p></Centered>;
  if (!data) return <Centered><div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div></Centered>;

  if (done) {
    return (
      <Centered>
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <h1 className="mt-3 text-lg font-semibold text-zinc-900">Signed — thank you</h1>
          <p className="mt-1 text-sm text-zinc-500">Your signature for &ldquo;{data.title}&rdquo; has been recorded.</p>
        </div>
      </Centered>
    );
  }

  const remaining = data.myFields.filter((f) => {
    const need = f.type === "signature" || f.type === "initials" || f.required;
    return need && !(values[f.id] || "").trim();
  }).length;

  function renderField(f: Field) {
    const mine = myIds.has(f.id);
    const val = values[f.id] || "";
    const base: React.CSSProperties = { position: "absolute", left: f.x, top: f.y, width: f.w, height: f.h };
    if (!mine) return <div key={f.id} className="rounded border border-dashed border-zinc-200 bg-zinc-50/40" style={base} />;
    if (f.type === "signature" || f.type === "initials") {
      return (
        <button key={f.id} type="button" onClick={() => setPadFor(f.id)} className="flex items-center justify-center overflow-hidden rounded border-2 border-dashed border-violet-400 bg-violet-50 text-[11px] font-medium text-violet-700 hover:bg-violet-100" style={base}>
          {val ? <img src={val} alt="signature" className="max-h-full max-w-full object-contain" /> : <span className="inline-flex items-center gap-1"><PenLine className="h-3.5 w-3.5" /> {f.type === "initials" ? "Initials" : "Sign"}</span>}
        </button>
      );
    }
    if (f.type === "checkbox") {
      const checked = val === "true";
      return (
        <button key={f.id} type="button" onClick={() => setValues((v) => ({ ...v, [f.id]: checked ? "" : "true" }))}
          className={`flex items-center justify-center rounded border-2 ${checked ? "border-violet-500 bg-violet-500 text-white" : "border-dashed border-violet-400 bg-violet-50"}`} style={base}>
          {checked ? "✓" : ""}
        </button>
      );
    }
    return (
      <input key={f.id} type={f.type === "date" ? "date" : f.type === "email" ? "email" : "text"} value={val}
        onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
        placeholder={f.type === "date" ? "" : (f.label || (f.type === "email" ? "Email" : "Text"))}
        className="rounded border-2 border-dashed border-violet-400 bg-violet-50 px-1.5 text-[12px] text-zinc-800 outline-none" style={base} />
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-900">{data.title}</div>
          <div className="truncate text-[12px] text-zinc-500">Signing as {data.party.name} · {remaining === 0 ? "all fields complete" : `${remaining} field${remaining === 1 ? "" : "s"} left`}</div>
        </div>
        <button type="button" onClick={finish} disabled={submitting || remaining > 0}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-[13px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Finish &amp; sign
        </button>
      </header>

      {err ? <div className="mx-auto mt-3 max-w-[800px] rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-700">{err}</div> : null}

      <div className="px-4 py-6">
        {data.sourceType === "pdf" && data.pdfUrl ? (
          <PdfPages url={data.pdfUrl} width={760} renderPage={(i) => (
            <div className="absolute inset-0">
              {data.fields.filter((f) => (f.page ?? 0) === i).map(renderField)}
            </div>
          )} />
        ) : (
          <div className="relative mx-auto w-[760px] max-w-full rounded-xl border border-zinc-200 bg-white px-10 py-7 shadow-sm">
            <div className="pointer-events-none select-none">
              <BlockNoteCanvas key={token} initialBnDoc={null} legacyBlocks={null} initialHtml={data.content || ""} readonly onChange={() => {}} entity={{ type: "agreement", id: data.party.id }} />
            </div>
            {data.fields.filter((f) => (f.page ?? 0) === 0).map(renderField)}
          </div>
        )}
      </div>

      {padFor ? (
        <SignaturePad
          onCancel={() => setPadFor(null)}
          onDone={(dataUrl) => { setValues((v) => ({ ...v, [padFor]: dataUrl })); setPadFor(null); }}
        />
      ) : null}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">{children}</div>;
}

function SignaturePad({ onDone, onCancel }: { onDone: (dataUrl: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [tab, setTab] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");

  const ctx = useCallback(() => {
    const c = canvasRef.current; if (!c) return null;
    const g = c.getContext("2d"); if (!g) return null;
    g.lineWidth = 2.5; g.lineCap = "round"; g.strokeStyle = "#111827";
    return g;
  }, []);
  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function down(e: React.PointerEvent) { const g = ctx(); if (!g) return; drawing.current = true; dirty.current = true; const p = pos(e); g.beginPath(); g.moveTo(p.x, p.y); }
  function move(e: React.PointerEvent) { if (!drawing.current) return; const g = ctx(); if (!g) return; const p = pos(e); g.lineTo(p.x, p.y); g.stroke(); }
  function up() { drawing.current = false; }
  function clear() { const c = canvasRef.current, g = ctx(); if (c && g) g.clearRect(0, 0, c.width, c.height); dirty.current = false; }

  function done() {
    if (tab === "type") {
      if (!typed.trim()) return;
      const c = document.createElement("canvas"); c.width = 600; c.height = 200;
      const g = c.getContext("2d")!;
      g.fillStyle = "#111827"; g.textBaseline = "middle"; g.font = "64px 'Brush Script MT', cursive";
      g.fillText(typed, 20, 100);
      onDone(c.toDataURL("image/png"));
      return;
    }
    if (!dirty.current || !canvasRef.current) return;
    onDone(canvasRef.current.toDataURL("image/png"));
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="text-sm font-semibold text-zinc-900">Add your signature</div>
          <button type="button" onClick={onCancel} className="rounded p-1 text-zinc-400 hover:bg-zinc-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex gap-1 px-4 pt-3">
          <button type="button" onClick={() => setTab("draw")} className={`rounded px-3 py-1 text-[13px] ${tab === "draw" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}>Draw</button>
          <button type="button" onClick={() => setTab("type")} className={`rounded px-3 py-1 text-[13px] ${tab === "type" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}>Type</button>
        </div>
        <div className="p-4">
          {tab === "draw" ? (
            <>
              <canvas ref={canvasRef} width={600} height={200} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
                className="h-[160px] w-full cursor-crosshair touch-none rounded-md border border-zinc-200 bg-zinc-50" />
              <button type="button" onClick={clear} className="mt-2 text-[12px] text-zinc-500 hover:text-zinc-800 underline">Clear</button>
            </>
          ) : (
            <>
              <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your name" className="h-9 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-300" />
              <div className="mt-3 flex h-[120px] items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-3xl text-zinc-800" style={{ fontFamily: "'Brush Script MT', cursive" }}>{typed || "Preview"}</div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 px-4 py-3">
          <button type="button" onClick={onCancel} className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-[13px] text-zinc-700 hover:bg-zinc-50">Cancel</button>
          <button type="button" onClick={done} className="inline-flex h-8 items-center rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500">Apply</button>
        </div>
      </div>
    </div>
  );
}
