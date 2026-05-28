"use client";

/* Forms — list of forms in the org.
 *
 * Card grid with name, public/private chip, submission count, last
 * edited. Click a card to edit; secondary CTA to view submissions.
 * Quick-add via prompt creates a blank form, routes to the builder.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormInput, Plus, Globe, Lock, Inbox, ChevronRight, Sparkles, Loader2 } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiForm = {
  id: string; name: string; description?: string | null;
  isPublic: boolean; targetBoardId?: string | null;
  createdAt: string; updatedAt: string;
  submissionCount: number;
};

export default function FormsPage() {
  const router = useRouter();
  const [forms, setForms] = useState<ApiForm[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/forms");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setForms(d.data ?? (Array.isArray(d) ? d : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("forms");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const name = window.prompt("Form name?")?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/forms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, fields: [] }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const d = await res.json();
      const f = d.data ?? d;
      router.push(`/forms/${f.id}`);
    } catch { toast("Couldn't create form"); }
  }

  const [generating, setGenerating] = useState(false);
  async function aiGenerate() {
    const prompt = window.prompt("Describe the form you want (e.g. 'Customer support ticket', 'Event RSVP', 'Vendor onboarding'):")?.trim();
    if (!prompt) return;
    setGenerating(true);
    try {
      const gen = await fetch("/api/forms/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!gen.ok) { const err = await gen.json().catch(() => ({ error: `HTTP ${gen.status}` })); toast(`AI failed: ${err.error}`); return; }
      const g = await gen.json();
      const spec = g.data ?? g;
      // Assign IDs to each field (API expects unique IDs on each field).
      const fields = (spec.fields ?? []).map((f: Record<string, unknown>) => ({ ...f, id: Math.random().toString(36).slice(2, 10) }));
      const create = await fetch("/api/forms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: spec.name, description: spec.description, fields }),
      });
      if (!create.ok) throw new Error();
      const d = await create.json();
      const f = d.data ?? d;
      toast(`Generated "${spec.name}" with ${fields.length} fields`);
      router.push(`/forms/${f.id}`);
    } catch { toast("Couldn't generate form"); }
    finally { setGenerating(false); }
  }

  const total = forms?.length ?? 0;
  const publicCount = (forms ?? []).filter((f) => f.isPublic).length;
  const totalSubs = (forms ?? []).reduce((acc, f) => acc + (f.submissionCount ?? 0), 0);

  return (
    <div className="frmlist">
      <header className="frmlist__head">
        <div className="frmlist__head-l">
          <div className="frmlist__icon"><FormInput /></div>
          <div>
            <h1 className="frmlist__title">Forms</h1>
            <div className="frmlist__sub">
              {forms === null ? "Loading…" : `${total} form${total === 1 ? "" : "s"} · ${publicCount} public · ${totalSubs} submission${totalSubs === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="frmlist__new" onClick={aiGenerate} disabled={generating} style={{ background: "linear-gradient(135deg, var(--os-c-purple), var(--os-c-pink))" }}>
            {generating ? <><Loader2 style={{ animation: "spin 1s linear infinite" }} /> Generating…</> : <><Sparkles /> AI generate</>}
          </button>
          <button type="button" className="frmlist__new" onClick={quickAdd}><Plus /> New form</button>
        </div>
      </header>

      {loadError ? (
        <div className="frmlist__error">{loadError}</div>
      ) : forms === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div className="frmlist__empty">
          <FormInput />
          <div>
            <h3>No forms yet</h3>
            <p>Build forms to collect any kind of data — feedback, requests, signups, inspections. Embed a form into any doc with the Form block.</p>
            <button type="button" className="frmlist__new" onClick={quickAdd} style={{ marginTop: 12 }}><Plus /> Create your first form</button>
          </div>
        </div>
      ) : (
        <div className="frmlist__grid">
          {forms.map((f) => (
            <Link key={f.id} href={`/forms/${f.id}`} className="frmcard">
              <header>
                <h3>{f.name}</h3>
                <span className={`frmcard__chip ${f.isPublic ? "is-public" : "is-private"}`}>
                  {f.isPublic ? <><Globe /> Public</> : <><Lock /> Org</>}
                </span>
              </header>
              {f.description && <p className="frmcard__desc">{f.description.length > 80 ? f.description.slice(0, 80) + "…" : f.description}</p>}
              <footer>
                <span className="frmcard__subs"><Inbox /> {f.submissionCount} submission{f.submissionCount === 1 ? "" : "s"}</span>
                <span className="frmcard__open">Edit <ChevronRight /></span>
              </footer>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
