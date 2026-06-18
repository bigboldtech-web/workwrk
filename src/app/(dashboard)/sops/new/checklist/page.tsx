"use client";

/* Checklist-SOP editor — uses the rich ChecklistBuilder (the SAME component
 * the SOP detail page uses): per-step content blocks (text / divider / image /
 * video), form fields (short/long text, number, checkbox, email, website,
 * date, dropdown, multichoice, file upload), and approval steps.
 *
 * Saves { type: "CHECKLIST", sections } and can be spun up as a ProcessRun
 * (shareable, runnable at /run/[token]). Old checklists ({title, notes}) are
 * normalized into the rich shape on load.
 *
 * URL: /sops/new/checklist?id=<sopId>
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ListChecks, Send, Save, ArrowLeft, Loader2 } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { ChecklistBuilder, normalizeChecklistSections, type ChecklistSection } from "@/components/checklist-builder";

function genId(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }
function emptySections(): ChecklistSection[] {
  return [{ id: genId("sec"), title: "Steps", steps: [{ id: genId("step"), title: "", description: "", type: "task", inputs: [], contentBlocks: [] }] }];
}

export default function ChecklistSopEditor() {
  const router = useRouter();
  const search = useSearchParams();
  const id = search.get("id");
  const { toast } = useOsToast();

  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<ChecklistSection[]>(emptySections);
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED" | "IN_REVIEW" | "APPROVED">("DRAFT");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const dirty = useRef(false);
  const initialLoad = useRef(true);
  const creatingRef = useRef(false);

  // Self-create: visiting /sops/new/checklist with no ?id (e.g. the sidebar
  // "New step-by-step SOP" link) mints a fresh CHECKLIST SOP and redirects to
  // it, so the editor always has a row to load/save.
  useEffect(() => {
    if (id || creatingRef.current) return;
    creatingRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/sops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Untitled checklist",
            sopType: "CHECKLIST",
            content: { type: "CHECKLIST", sections: [{ title: "Steps", steps: [{ id: "s1", title: "First step" }] }] },
          }),
        });
        if (!res.ok) throw new Error(`POST ${res.status}`);
        const data = await res.json();
        const sop = data.data ?? data;
        router.replace(`/sops/new/checklist?id=${encodeURIComponent(sop.id)}`);
      } catch { toast("Couldn't create checklist"); }
    })();
  }, [id, router, toast]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const res = await fetch(`/api/sops/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        const sop = data.data ?? data;
        setTitle(sop.title ?? "");
        const c = sop.content as { sections?: unknown } | null;
        const normalized = normalizeChecklistSections(c?.sections);
        if (normalized.length > 0) setSections(normalized);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, title, sections]);

  const totalSteps = sections.reduce((acc, s) => acc + s.steps.length, 0);

  if (!id) return (<>
    <OsTitleBar title="New checklist SOP" Icon={ListChecks} iconGradient={GRAD.indigoBlue} showStandardActions={false} />
    <div className="sop-edit__loading"><Loader2 className="bedit__spin" /> Creating checklist…</div>
  </>);

  return (<>
    <OsTitleBar
      title="Checklist SOP"
      Icon={ListChecks}
      iconGradient={GRAD.indigoBlue}
      showStandardActions={false}
      description={`${totalSteps} step${totalSteps === 1 ? "" : "s"} · ${saving ? "saving…" : lastSaved ? `saved ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "auto-saves every 5s"}`}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => save()}
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>
          {status !== "PUBLISHED" ? (
            <button
              type="button"
              onClick={() => save({ publish: true })}
              disabled={saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[13px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> Publish
            </button>
          ) : (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 text-[13px] font-medium text-emerald-700">Published</span>
          )}
        </div>
      }
    />

    <div className="sop-edit">
      <button
        type="button"
        onClick={() => router.push("/sops")}
        className="inline-flex h-7 w-fit items-center gap-1.5 rounded-md px-2 text-[13px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
      >
        <ArrowLeft className="h-4 w-4" /> All SOPs
      </button>

      <input type="text" className="sop-edit__title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Checklist title…" />

      <ChecklistBuilder sections={sections} onChange={setSections} editing />
    </div>
  </>);
}
