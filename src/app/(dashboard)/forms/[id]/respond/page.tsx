"use client";

/* Form responder — what someone sees when they fill out a form.
 *
 * Renders each field based on its type. Submit POSTs to
 * /api/forms/[id]/submissions. Public forms allow anonymous submit;
 * private require the user be signed in to the form's org.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormInput, CheckCircle2, Loader2 } from "lucide-react";

type FieldType = "short_text" | "long_text" | "number" | "email" | "url" | "date" | "select" | "multi_select" | "checkbox";
type Field = { id: string; type: FieldType; label: string; required: boolean; options?: string[]; placeholder?: string };
type ApiForm = { id: string; name: string; description?: string | null; fields: Field[]; isPublic: boolean };

export default function FormResponder({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
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
    // Required validation
    for (const f of form.fields) {
      if (f.required) {
        const v = answers[f.id];
        const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
        if (empty) {
          alert(`"${f.label}" is required`);
          return;
        }
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
    } catch {
      alert("Couldn't submit. Try again.");
    }
    setSubmitting(false);
  }

  if (loadError) {
    return (
      <div className="resp">
        <div className="resp__error">
          <FormInput />
          <p>Couldn&apos;t load this form: {loadError}</p>
        </div>
      </div>
    );
  }
  if (!form) {
    return <div className="resp"><div className="resp__loading"><Loader2 className="resp__spin" /> Loading…</div></div>;
  }
  if (submitted) {
    return (
      <div className="resp">
        <div className="resp__done">
          <CheckCircle2 />
          <h1>Thanks — submitted.</h1>
          <p>Your response was recorded.</p>
          <button type="button" onClick={() => { setAnswers({}); setSubmitted(false); }}>Submit another response</button>
        </div>
      </div>
    );
  }

  return (
    <div className="resp">
      <div className="resp__card">
        <header className="resp__head">
          <div className="resp__icon"><FormInput /></div>
          <div>
            <h1>{form.name}</h1>
            {form.description && <p>{form.description}</p>}
          </div>
        </header>

        <div className="resp__fields">
          {form.fields.length === 0 ? (
            <div className="resp__empty">This form has no fields yet.</div>
          ) : form.fields.map((f) => (
            <div key={f.id} className="resp-field">
              <label className="resp-field__label">
                {f.label}
                {f.required && <span className="resp-field__req">*</span>}
              </label>
              <FieldInput field={f} value={answers[f.id]} onChange={(v) => setAnswer(f.id, v)} />
            </div>
          ))}
        </div>

        <footer className="resp__foot">
          <button type="button" className="resp__submit" onClick={submit} disabled={submitting || form.fields.length === 0}>
            {submitting ? <><Loader2 className="resp__spin" /> Submitting…</> : "Submit"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === "short_text" || field.type === "email" || field.type === "url") {
    return <input type={field.type === "short_text" ? "text" : field.type} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="resp-field__input" />;
  }
  if (field.type === "long_text") {
    return <textarea rows={4} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="resp-field__input resp-field__input--textarea" />;
  }
  if (field.type === "number") {
    return <input type="number" value={(value as number | "") ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} className="resp-field__input" />;
  }
  if (field.type === "date") {
    return <input type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="resp-field__input" />;
  }
  if (field.type === "checkbox") {
    return (
      <label className="resp-field__check">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        Yes
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <div className="resp-field__options">
        {(field.options ?? []).map((o) => (
          <label key={o}>
            <input type="radio" name={field.id} checked={value === o} onChange={() => onChange(o)} />
            {o}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "multi_select") {
    const arr = (value as string[]) ?? [];
    return (
      <div className="resp-field__options">
        {(field.options ?? []).map((o) => (
          <label key={o}>
            <input
              type="checkbox"
              checked={arr.includes(o)}
              onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))}
            />
            {o}
          </label>
        ))}
      </div>
    );
  }
  return null;
}
