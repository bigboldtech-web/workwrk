"use client";

// TemplateCenter — ClickUp-style Template Center modal.
// Browse (left nav: Featured/Workspace + kind + complexity filters, search,
// category grid) → detail ("Template includes" + Use Template) → apply.
// Controlled: open/onClose. Optionally scoped to one `kind` and given an
// `applyContext` (e.g. { spaceId } when opened from the Create-List modal).
// On apply: TASK → onApplied({config}); LIST → navigate to the new board;
// SPACE → navigate to the new space.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, ChevronLeft, Loader2, FileStack, Layers, Compass, CheckSquare, ListChecks } from "lucide-react";
import { taupeButton } from "@/components/ui/accent";

type Kind = "TASK" | "LIST" | "SPACE" | "FOLDER" | "DOC" | "VIEW" | "WHITEBOARD";
type Complexity = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

interface TemplateRow {
  id: string;
  kind: Kind;
  name: string;
  description: string | null;
  complexity: Complexity | null;
  category: string | null;
  useCases: string[];
  tags: string[];
  builtIn: boolean;
  usedCount: number;
  organizationId: string | null;
}

interface TemplateDetail extends TemplateRow {
  payload: Record<string, unknown>;
}

const KIND_LABEL: Record<Kind, string> = {
  TASK: "Task", LIST: "List", SPACE: "Space", FOLDER: "Folder",
  DOC: "Doc", VIEW: "View", WHITEBOARD: "Whiteboard",
};
const COMPLEXITY_LABEL: Record<Complexity, string> = {
  BEGINNER: "Beginner", INTERMEDIATE: "Intermediate", ADVANCED: "Advanced",
};
const COMPLEXITY_TONE: Record<Complexity, string> = {
  BEGINNER: "bg-emerald-50 text-emerald-700",
  INTERMEDIATE: "bg-amber-50 text-amber-700",
  ADVANCED: "bg-rose-50 text-rose-700",
};

export interface TemplateCenterProps {
  open: boolean;
  onClose: () => void;
  /** Restrict to one kind (e.g. LIST from the Create-List modal). */
  kind?: Kind;
  /** Context for applying — e.g. the target space for a LIST template. */
  applyContext?: { spaceId?: string };
  /** Called after a TASK template is applied (host opens the create-task modal). */
  onApplied?: (result: { kind: Kind; config?: Record<string, unknown>; slug?: string }) => void;
}

export function TemplateCenter({ open, onClose, kind, applyContext, onApplied }: TemplateCenterProps) {
  const router = useRouter();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"featured" | "workspace" | "all">("featured");
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(kind ? [kind] : []));
  const [complexities, setComplexities] = useState<Set<Complexity>>(new Set());
  const [selected, setSelected] = useState<TemplateDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // LIST apply needs a target space when none was supplied.
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [chosenSpace, setChosenSpace] = useState<string>(applyContext?.spaceId ?? "");

  // Fetch on open + when filters change.
  useEffect(() => {
    if (!open) return;
    let active = true;
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (query.trim()) params.set("q", query.trim());
    fetch(`/api/template-center?${params}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => { if (active) setRows(Array.isArray(d?.templates) ? d.templates : []); })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [open, kind, query]);

  // Lazy-load spaces only if a LIST might need a target.
  useEffect(() => {
    if (!open || applyContext?.spaceId) return;
    fetch("/api/spaces", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { spaces: [] }))
      .then((d) => setSpaces(Array.isArray(d?.spaces) ? d.spaces : []))
      .catch(() => {});
  }, [open, applyContext?.spaceId]);

  useEffect(() => {
    if (!open) { setSelected(null); setError(null); }
  }, [open]);

  const filtered = useMemo(() => {
    let r = rows ?? [];
    if (scope === "featured") r = r.filter((t) => t.builtIn);
    else if (scope === "workspace") r = r.filter((t) => !t.builtIn);
    if (kinds.size) r = r.filter((t) => kinds.has(t.kind));
    if (complexities.size) r = r.filter((t) => t.complexity && complexities.has(t.complexity));
    return r;
  }, [rows, scope, kinds, complexities]);

  const byCategory = useMemo(() => {
    const m = new Map<string, TemplateRow[]>();
    for (const t of filtered) {
      const c = t.category || "Other";
      const arr = m.get(c) ?? [];
      arr.push(t);
      m.set(c, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const openDetail = useCallback(async (id: string) => {
    setError(null);
    const res = await fetch(`/api/template-center/${id}`, { cache: "no-store" });
    if (!res.ok) { setError("Could not load template"); return; }
    const d = await res.json();
    setSelected(d.template as TemplateDetail);
  }, []);

  const applyTemplate = useCallback(async (tpl: TemplateDetail) => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (tpl.kind === "LIST") {
        const spaceId = applyContext?.spaceId ?? chosenSpace;
        if (!spaceId) { setError("Pick a Space to create this List in."); setBusy(false); return; }
        body.spaceId = spaceId;
      }
      const res = await fetch(`/api/template-center/${tpl.id}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? "Failed to apply template"); setBusy(false); return; }
      if (tpl.kind === "TASK") {
        onApplied?.({ kind: "TASK", config: data.config });
        onClose();
      } else if (tpl.kind === "LIST" && data.slug) {
        onClose();
        router.push(`/boards/${data.slug}`);
      } else if (tpl.kind === "SPACE" && data.slug) {
        onClose();
        router.push(`/spaces/${data.slug}`);
      } else {
        onApplied?.({ kind: tpl.kind, slug: data.slug });
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply template");
    } finally {
      setBusy(false);
    }
  }, [applyContext?.spaceId, chosenSpace, onApplied, onClose, router]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-[1040px] h-[82vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-zinc-200/60">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-100">
          {selected ? (
            <button type="button" onClick={() => setSelected(null)} className="inline-flex items-center gap-1.5 text-[13px] text-zinc-600 hover:text-zinc-900">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-zinc-900">
              <FileStack className="w-4 h-4 text-zinc-500" /> Template Center
            </span>
          )}
          {!selected ? (
            <div className="ml-2 flex-1 max-w-[420px] inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-zinc-200">
              <Search className="w-3.5 h-3.5 text-zinc-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates…" className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-zinc-400" />
            </div>
          ) : <div className="flex-1" />}
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 inline-flex items-center justify-center text-zinc-500" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error ? <div className="px-5 py-2 text-xs text-red-500 bg-red-500/10">{error}</div> : null}

        {selected ? (
          <DetailView
            tpl={selected}
            busy={busy}
            needSpace={selected.kind === "LIST" && !applyContext?.spaceId}
            spaces={spaces}
            chosenSpace={chosenSpace}
            onChooseSpace={setChosenSpace}
            onUse={() => applyTemplate(selected)}
          />
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* Left nav */}
            <aside className="w-[210px] shrink-0 border-r border-zinc-100 overflow-y-auto p-3 space-y-4">
              <nav className="space-y-0.5">
                <NavRow Icon={Compass} label="Featured" active={scope === "featured"} onClick={() => setScope("featured")} />
                <NavRow Icon={Layers} label="Workspace Templates" active={scope === "workspace"} onClick={() => setScope("workspace")} />
                <NavRow Icon={FileStack} label="All Templates" active={scope === "all"} onClick={() => setScope("all")} />
              </nav>
              {!kind ? (
                <FilterGroup title="Template Types">
                  {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                    <CheckRow key={k} label={KIND_LABEL[k]} checked={kinds.has(k)} onToggle={() => setKinds(toggle(kinds, k))} />
                  ))}
                </FilterGroup>
              ) : null}
              <FilterGroup title="Complexity">
                {(Object.keys(COMPLEXITY_LABEL) as Complexity[]).map((c) => (
                  <CheckRow key={c} label={COMPLEXITY_LABEL[c]} checked={complexities.has(c)} onToggle={() => setComplexities(toggle(complexities, c))} />
                ))}
              </FilterGroup>
            </aside>

            {/* Grid */}
            <main className="flex-1 min-w-0 overflow-y-auto p-5 space-y-6">
              {rows === null ? (
                <div className="flex items-center justify-center h-40 text-sm text-zinc-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center text-zinc-400">
                  <FileStack className="w-8 h-8 mb-2" />
                  <div className="text-sm">No templates yet{scope === "featured" ? "" : " in this view"}.</div>
                  <div className="text-xs mt-1">Save a task, list, or space as a template to see it here.</div>
                </div>
              ) : (
                byCategory.map(([cat, items]) => (
                  <section key={cat}>
                    <h3 className="text-[13px] font-semibold text-zinc-900 mb-2">{cat}</h3>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                      {items.map((t) => (
                        <button key={t.id} type="button" onClick={() => openDetail(t.id)} className="text-left rounded-xl border border-zinc-200 bg-white hover:shadow-sm hover:border-zinc-300 transition-all p-3">
                          <div className="h-20 rounded-lg bg-gradient-to-br from-zinc-50 to-zinc-100 mb-2.5 flex items-center justify-center text-zinc-300">
                            <ListChecks className="w-6 h-6" />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <CheckSquare className="w-3.5 h-3.5 text-fuchsia-500 shrink-0" />
                            <span className="text-[13px] font-medium text-zinc-900 truncate">{t.name}</span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span className="text-[10.5px] uppercase tracking-wide text-zinc-400">{KIND_LABEL[t.kind]}</span>
                            {t.complexity ? <span className={`text-[10px] px-1.5 py-0.5 rounded ${COMPLEXITY_TONE[t.complexity]}`}>{COMPLEXITY_LABEL[t.complexity]}</span> : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailView({
  tpl, busy, needSpace, spaces, chosenSpace, onChooseSpace, onUse,
}: {
  tpl: TemplateDetail; busy: boolean; needSpace: boolean;
  spaces: Array<{ id: string; name: string }>; chosenSpace: string;
  onChooseSpace: (id: string) => void; onUse: () => void;
}) {
  const p = tpl.payload ?? {};
  const statuses = Array.isArray((p as { statuses?: unknown }).statuses) ? (p as { statuses: Array<{ label?: string; color?: string }> }).statuses : [];
  const fields = Array.isArray((p as { fields?: unknown }).fields) ? (p as { fields: Array<{ label?: string }> }).fields : [];
  const views = Array.isArray((p as { views?: unknown }).views) ? (p as { views: Array<{ type?: string; name?: string }> }).views : [];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold text-zinc-900">{tpl.name}</h2>
          {tpl.complexity ? <span className={`inline-block mt-1.5 text-[11px] px-2 py-0.5 rounded ${COMPLEXITY_TONE[tpl.complexity]}`}>Complexity: {COMPLEXITY_LABEL[tpl.complexity]}</span> : null}
        </div>
        <button type="button" onClick={onUse} disabled={busy || (needSpace && !chosenSpace)} className={`h-9 px-4 rounded-lg text-[13px] inline-flex items-center gap-2 disabled:opacity-50 ${taupeButton}`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Use Template
        </button>
      </div>

      {tpl.description ? <p className="mt-3 text-[13px] text-zinc-600 leading-relaxed max-w-[680px]">{tpl.description}</p> : null}

      {needSpace ? (
        <div className="mt-4 max-w-[360px]">
          <label className="text-[12px] font-medium text-zinc-600">Create in Space</label>
          <select value={chosenSpace} onChange={(e) => onChooseSpace(e.target.value)} className="mt-1 w-full h-9 px-2 rounded-lg border border-zinc-200 text-[13px] bg-white">
            <option value="">Select a Space…</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      ) : null}

      <div className="mt-6 space-y-3 max-w-[680px]">
        <h3 className="text-[13px] font-semibold text-zinc-900">Template includes</h3>
        {statuses.length > 0 ? (
          <IncludeRow title={`${statuses.length} status${statuses.length === 1 ? "" : "es"}`}>
            <span className="inline-flex items-center gap-1">{statuses.slice(0, 8).map((s, i) => <span key={i} className="w-3 h-3 rounded-full ring-1 ring-black/10" style={{ background: s.color ?? "#d4d4d8" }} />)}</span>
          </IncludeRow>
        ) : null}
        {fields.length > 0 ? (
          <IncludeRow title={`${fields.length} custom field${fields.length === 1 ? "" : "s"}`}>
            <span className="flex flex-wrap gap-1">{fields.slice(0, 12).map((f, i) => <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">{f.label ?? "Field"}</span>)}</span>
          </IncludeRow>
        ) : null}
        {views.length > 0 ? (
          <IncludeRow title={`${views.length} view${views.length === 1 ? "" : "s"}`}>
            <span className="flex flex-wrap gap-1">{views.map((v, i) => <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">{v.name ?? v.type}</span>)}</span>
          </IncludeRow>
        ) : null}
        {statuses.length === 0 && fields.length === 0 && views.length === 0 ? (
          <p className="text-[12.5px] text-zinc-400">A clean {KIND_LABEL[tpl.kind].toLowerCase()} with default settings.</p>
        ) : null}
      </div>
    </div>
  );
}

function IncludeRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2.5 flex items-center justify-between gap-3">
      <span className="text-[12.5px] font-medium text-zinc-700">{title}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function NavRow({ Icon, label, active, onClick }: { Icon: typeof Compass; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] ${active ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-600 hover:bg-zinc-50"}`}>
      <Icon className="w-3.5 h-3.5" /> <span className="truncate">{label}</span>
    </button>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-zinc-400 font-semibold px-1 mb-1.5">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function CheckRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="w-full flex items-center gap-2 px-1 py-1 text-[12.5px] text-zinc-700 hover:bg-zinc-50 rounded">
      <span className={`w-3.5 h-3.5 rounded border inline-flex items-center justify-center ${checked ? "bg-[var(--os-brand)] border-[var(--os-brand)] text-white" : "border-zinc-300"}`}>{checked ? "✓" : ""}</span>
      {label}
    </button>
  );
}

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set);
  if (n.has(v)) n.delete(v); else n.add(v);
  return n;
}
