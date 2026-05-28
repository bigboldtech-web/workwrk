"use client";

/* Public form embed — standalone (no dashboard chrome) so users can
 * drop the form into an iframe on any external site. Same responder
 * logic as /forms/[id]/respond but isolated from the dashboard layout.
 */

import { useCallback, useEffect, useState } from "react";
import { FormInput, CheckCircle2, Loader2 } from "lucide-react";

type FieldType = "short_text" | "long_text" | "number" | "email" | "url" | "date" | "select" | "multi_select" | "checkbox";
type Field = { id: string; type: FieldType; label: string; required: boolean; options?: string[]; placeholder?: string };
type ApiForm = { id: string; name: string; description?: string | null; fields: Field[]; isPublic: boolean };

export default function FormEmbed({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [form, setForm] = useState<ApiForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => { void params.then((p) => setId(p.id)); }, [params]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/forms/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const f: ApiForm = d.data ?? d;
      f.fields = Array.isArray(f.fields) ? f.fields : [];
      setForm(f);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  function setAnswer(fid: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [fid]: value }));
  }

  async function submit() {
    if (!form || !id) return;
    for (const f of form.fields) {
      if (f.required) {
        const v = answers[f.id];
        const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
        if (empty) { alert(`"${f.label}" is required`); return; }
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/forms/${id}/submissions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: answers }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      setSubmitted(true);
    } catch { alert("Couldn't submit. Try again."); }
    setSubmitting(false);
  }

  if (loadError) return <Wrap><div style={S.error}><FormInput /><p>Couldn&apos;t load this form: {loadError}</p></div></Wrap>;
  if (!form) return <Wrap><div style={S.loading}><Loader2 style={{ animation: "spin 1s linear infinite" }} /> Loading…</div></Wrap>;
  if (submitted) return <Wrap><div style={S.done}><CheckCircle2 size={48} color="#00C875" /><h1>Thanks — submitted.</h1><p>Your response was recorded.</p></div></Wrap>;

  return (
    <Wrap>
      <header style={S.head}>
        <div style={S.icon}><FormInput /></div>
        <div>
          <h1 style={S.title}>{form.name}</h1>
          {form.description && <p style={S.desc}>{form.description}</p>}
        </div>
      </header>
      <div style={S.fields}>
        {form.fields.map((f) => (
          <div key={f.id} style={S.field}>
            <label style={S.label}>{f.label}{f.required && <span style={S.req}> *</span>}</label>
            <FieldInput field={f} value={answers[f.id]} onChange={(v) => setAnswer(f.id, v)} />
          </div>
        ))}
      </div>
      <button type="button" style={{ ...S.btn, opacity: submitting || form.fields.length === 0 ? .6 : 1 }} onClick={submit} disabled={submitting || form.fields.length === 0}>
        {submitting ? "Submitting…" : "Submit"}
      </button>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f9fafb", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", background: "white", borderRadius: 10, padding: 28, boxShadow: "0 2px 12px rgba(0,0,0,.05)" }}>
        {children}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } input, textarea, select, button { font-family: inherit; }`}</style>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  const t = field.type;
  if (t === "short_text" || t === "email" || t === "url") {
    return <input type={t === "short_text" ? "text" : t} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} style={S.input} />;
  }
  if (t === "long_text") {
    return <textarea rows={4} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} style={{ ...S.input, resize: "vertical" as const, minHeight: 80 }} />;
  }
  if (t === "number") {
    return <input type="number" value={(value as number | "") ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} style={S.input} />;
  }
  if (t === "date") {
    return <input type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} style={S.input} />;
  }
  if (t === "checkbox") {
    return <label style={S.check}><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> Yes</label>;
  }
  if (t === "select") {
    return (
      <div style={S.opts}>
        {(field.options ?? []).map((o) => (
          <label key={o} style={S.opt}><input type="radio" name={field.id} checked={value === o} onChange={() => onChange(o)} /> {o}</label>
        ))}
      </div>
    );
  }
  if (t === "multi_select") {
    const arr = (value as string[]) ?? [];
    return (
      <div style={S.opts}>
        {(field.options ?? []).map((o) => (
          <label key={o} style={S.opt}>
            <input type="checkbox" checked={arr.includes(o)} onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} /> {o}
          </label>
        ))}
      </div>
    );
  }
  return null;
}

const S = {
  head: { display: "flex", gap: 14, alignItems: "center", marginBottom: 24, paddingBottom: 18, borderBottom: "1px solid #e5e7eb" } as React.CSSProperties,
  icon: { width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #5559DF, #A25DDC)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" } as React.CSSProperties,
  title: { margin: 0, fontSize: 20, fontWeight: 600, color: "#1f2937" } as React.CSSProperties,
  desc: { margin: "4px 0 0", fontSize: 13, color: "#6b7280" } as React.CSSProperties,
  fields: { display: "flex", flexDirection: "column" as const, gap: 18, marginBottom: 22 },
  field: { display: "flex", flexDirection: "column" as const, gap: 6 },
  label: { fontSize: 13, fontWeight: 500, color: "#374151" } as React.CSSProperties,
  req: { color: "#dc2626" } as React.CSSProperties,
  input: { width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, color: "#1f2937", boxSizing: "border-box" as const, outline: "none" },
  check: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151" } as React.CSSProperties,
  opts: { display: "flex", flexDirection: "column" as const, gap: 6 },
  opt: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151" } as React.CSSProperties,
  btn: { width: "100%", padding: "11px 16px", background: "#1f2937", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer" } as React.CSSProperties,
  loading: { textAlign: "center" as const, color: "#6b7280", fontSize: 13, padding: 30, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  error: { textAlign: "center" as const, color: "#dc2626", fontSize: 13, padding: 30 },
  done: { textAlign: "center" as const, padding: 30, color: "#374151" } as React.CSSProperties,
};
