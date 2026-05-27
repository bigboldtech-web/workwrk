"use client";

/* Checklist-SOP editor.
 *
 * Structured steps grouped into sections. Each step has a title and an
 * optional notes blob. Sections + steps are reorderable via the arrow
 * buttons (no DnD libs). Publishing makes the checklist available to
 * spin up as a ProcessRun.
 *
 * URL: /sops/new/checklist?id=<sopId>
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ListChecks, Plus, Send, Save, ArrowLeft, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

type Step = { id: string; title: string; notes?: string };
type Section = { title: string; steps: Step[] };

function newStepId() { return Math.random().toString(36).slice(2, 10); }

export default function ChecklistSopEditor() {
  const router = useRouter();
  const search = useSearchParams();
  const id = search.get("id");
  const { toast } = useOsToast();

  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<Section[]>([{ title: "Steps", steps: [{ id: newStepId(), title: "" }] }]);
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED" | "IN_REVIEW" | "APPROVED">("DRAFT");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const dirty = useRef(false);
  const initialLoad = useRef(true);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/sops/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        const sop = data.data ?? data;
        setTitle(sop.title ?? "");
        const c = sop.content as { sections?: Section[] } | null;
        if (c?.sections && c.sections.length > 0) setSections(c.sections);
        setStatus(sop.status ?? "DRAFT");
        initialLoad.current = false;
      } catch { /* ignore */ }
    })();
  }, [id]);

  useEffect(() => { if (!initialLoad.current) dirty.current = true; }, [title, sections]);

  async function save(opts: { publish?: boolean } = {}) {
    if (!id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Untitled checklist",
          content: { type: "CHECKLIST", sections },
          ...(opts.publish ? { status: "PUBLISHED" } : {}),
        }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      setLastSaved(new Date());
      if (opts.publish) { setStatus("PUBLISHED"); toast("Checklist published"); }
      dirty.current = false;
    } catch { toast("Couldn't save"); }
    finally { setSaving(false); }
  }
  useEffect(() => {
    const t = setInterval(() => { if (dirty.current && !saving) void save(); }, 5000);
    return () => clearInterval(t);
  }, [saving, title, sections]);

  function updateStep(si: number, idx: number, patch: Partial<Step>) {
    setSections((s) => s.map((sec, i) => i !== si ? sec : { ...sec, steps: sec.steps.map((st, j) => j === idx ? { ...st, ...patch } : st) }));
  }
  function addStep(si: number) {
    setSections((s) => s.map((sec, i) => i !== si ? sec : { ...sec, steps: [...sec.steps, { id: newStepId(), title: "" }] }));
  }
  function removeStep(si: number, idx: number) {
    setSections((s) => s.map((sec, i) => i !== si ? sec : { ...sec, steps: sec.steps.filter((_, j) => j !== idx) }));
  }
  function moveStep(si: number, idx: number, dir: -1 | 1) {
    setSections((s) => s.map((sec, i) => {
      if (i !== si) return sec;
      const arr = [...sec.steps];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return sec;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return { ...sec, steps: arr };
    }));
  }
  function addSection() {
    setSections((s) => [...s, { title: `Section ${s.length + 1}`, steps: [{ id: newStepId(), title: "" }] }]);
  }
  function removeSection(si: number) {
    setSections((s) => s.filter((_, i) => i !== si));
  }
  function setSectionTitle(si: number, v: string) {
    setSections((s) => s.map((sec, i) => i === si ? { ...sec, title: v } : sec));
  }

  if (!id) return <div className="sop-edit__error">Missing SOP id. <a href="/sops">Back to SOPs</a></div>;

  const totalSteps = sections.reduce((acc, s) => acc + s.steps.length, 0);

  return (
    <div className="sop-edit">
      <header className="sop-edit__head">
        <div className="sop-edit__head-l">
          <button type="button" className="sop-edit__back" onClick={() => router.push("/sops")} aria-label="Back"><ArrowLeft /></button>
          <div className="sop-edit__type"><ListChecks /> Checklist · {totalSteps} step{totalSteps === 1 ? "" : "s"}</div>
          <div className="sop-edit__save-state">{saving ? "Saving…" : lastSaved ? `Saved ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}</div>
        </div>
        <div className="sop-edit__actions">
          <button type="button" onClick={() => save()} className="sop-edit__btn" disabled={saving}><Save /> Save</button>
          {status !== "PUBLISHED" && (
            <button type="button" onClick={() => save({ publish: true })} className="sop-edit__btn sop-edit__btn--primary" disabled={saving}><Send /> Publish</button>
          )}
          {status === "PUBLISHED" && <span className="sop-edit__pub">Published</span>}
        </div>
      </header>

      <input type="text" className="sop-edit__title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Checklist title…" />

      <div className="sop-edit__sections">
        {sections.map((sec, si) => (
          <section key={si} className="sop-edit__section">
            <header className="sop-edit__section-head">
              <input type="text" value={sec.title} onChange={(e) => setSectionTitle(si, e.target.value)} className="sop-edit__section-title" placeholder="Section title…" />
              {sections.length > 1 && <button type="button" onClick={() => removeSection(si)} className="sop-edit__icon-btn" aria-label="Delete section"><Trash2 /></button>}
            </header>
            <ol className="sop-edit__steps">
              {sec.steps.map((st, idx) => (
                <li key={st.id} className="sop-edit__step">
                  <span className="sop-edit__step-num">{idx + 1}</span>
                  <div className="sop-edit__step-main">
                    <input type="text" value={st.title} onChange={(e) => updateStep(si, idx, { title: e.target.value })} placeholder="Step description…" className="sop-edit__step-title" />
                    <textarea value={st.notes ?? ""} onChange={(e) => updateStep(si, idx, { notes: e.target.value })} placeholder="Optional notes / acceptance criteria…" className="sop-edit__step-notes" rows={1} />
                  </div>
                  <div className="sop-edit__step-actions">
                    <button type="button" onClick={() => moveStep(si, idx, -1)} disabled={idx === 0}><ChevronUp /></button>
                    <button type="button" onClick={() => moveStep(si, idx, +1)} disabled={idx === sec.steps.length - 1}><ChevronDown /></button>
                    <button type="button" onClick={() => removeStep(si, idx)} disabled={sec.steps.length === 1}><Trash2 /></button>
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" className="sop-edit__add-step" onClick={() => addStep(si)}><Plus /> Add step</button>
          </section>
        ))}

        <button type="button" className="sop-edit__add-section" onClick={addSection}><Plus /> Add section</button>
      </div>
    </div>
  );
}
