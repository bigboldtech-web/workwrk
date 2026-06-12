"use client";

/* Settings · Task Types — manage the org's Item types (Task / Milestone /
 * custom). List active types + usage meter, create custom types, and add
 * from a recommended library. Mirrors ClickUp's Task Types manager.
 *
 *  GET    /api/item-types          → { types, recommended, categories, usage }
 *  POST   /api/item-types          → create custom type
 *  PATCH  /api/item-types/[id]     → set default / edit
 *  DELETE /api/item-types/[id]     → remove custom type
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Shapes, Plus, Search, Settings as SettingsIcon, Trash2, Star, Check, X, Loader2 } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { itemTypeIcon, ITEM_TYPE_ICON_NAMES } from "@/lib/item-type-icons";

type ApiType = {
  id: string; singular: string; plural: string; icon: string;
  description: string | null; category: string | null; isDefault: boolean; builtIn: boolean;
};
type Recommended = { singular: string; plural: string; icon: string; description: string; category: string };

export default function TaskTypesPage() {
  const { toast } = useOsToast();
  const [types, setTypes] = useState<ApiType[] | null>(null);
  const [recommended, setRecommended] = useState<Recommended[]>([]);
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 20 });
  const [createOpen, setCreateOpen] = useState(false);
  const [recSearch, setRecSearch] = useState("");
  const [recCat, setRecCat] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/item-types", { cache: "no-store" });
      if (!res.ok) { setTypes([]); return; }
      const d = await res.json();
      setTypes(Array.isArray(d.types) ? d.types : []);
      setRecommended(Array.isArray(d.recommended) ? d.recommended : []);
      setUsage(d.usage ?? { used: 0, limit: 20 });
    } catch { setTypes([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const existingNames = useMemo(() => new Set((types ?? []).map((t) => t.singular.toLowerCase())), [types]);

  const setDefault = useCallback(async (id: string) => {
    setTypes((prev) => (prev ?? []).map((t) => ({ ...t, isDefault: t.id === id })));
    try {
      await fetch(`/api/item-types/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isDefault: true }) });
      toast("Default type updated");
    } catch { toast("Couldn't update default"); void load(); }
  }, [load, toast]);

  const remove = useCallback(async (t: ApiType) => {
    if (!window.confirm(`Delete the "${t.singular}" type? Tasks of this type fall back to the default.`)) return;
    setTypes((prev) => (prev ?? []).filter((x) => x.id !== t.id));
    try {
      const res = await fetch(`/api/item-types/${t.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast("Type deleted");
      void load();
    } catch { toast("Couldn't delete type"); void load(); }
  }, [load, toast]);

  const addRecommended = useCallback(async (r: Recommended) => {
    setAdding(r.singular);
    try {
      const res = await fetch("/api/item-types", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ singular: r.singular, plural: r.plural, icon: r.icon, description: r.description, category: r.category }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error); }
      toast(`Added "${r.singular}"`);
      void load();
    } catch (e) { toast(e instanceof Error && e.message ? e.message : "Couldn't add type"); }
    finally { setAdding(null); }
  }, [load, toast]);

  const recCats = useMemo(() => Array.from(new Set(recommended.map((r) => r.category))).sort(), [recommended]);
  const recFiltered = useMemo(() => {
    let list = recommended.filter((r) => !existingNames.has(r.singular.toLowerCase()));
    if (recCat) list = list.filter((r) => r.category === recCat);
    const q = recSearch.trim().toLowerCase();
    if (q) list = list.filter((r) => r.singular.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
    return list;
  }, [recommended, existingNames, recCat, recSearch]);

  return (
    <>
      <OsTitleBar
        title="Task Types"
        Icon={Shapes}
        iconGradient={GRAD.bluePurple}
        description={`${usage.used} of ${usage.limit} custom types used`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/settings" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-200 text-[13px] text-zinc-600 hover:bg-zinc-50"><SettingsIcon className="w-3.5 h-3.5" /> Settings</Link>
            <button type="button" onClick={() => setCreateOpen(true)} disabled={usage.used >= usage.limit} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[var(--os-brand)] text-white text-[13px] disabled:opacity-50"><Plus className="w-3.5 h-3.5" /> New type</button>
          </div>
        }
      />

      <div className="max-w-[860px] mx-auto px-5 py-6 space-y-8">
        {/* Active types */}
        <section>
          <h2 className="text-[13px] font-semibold text-zinc-900 mb-3">Active types</h2>
          {types === null ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400 py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2.5">
              {types.map((t) => {
                const Icon = itemTypeIcon(t.icon);
                return (
                  <div key={t.id} className="group flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3">
                    <span className="mt-0.5 inline-flex w-8 h-8 rounded-lg bg-zinc-50 items-center justify-center text-zinc-600 shrink-0"><Icon className="w-4 h-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13.5px] font-medium text-zinc-900 truncate">{t.singular}</span>
                        {t.isDefault ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">Default</span> : null}
                        {t.builtIn ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">Built-in</span> : null}
                      </div>
                      <div className="text-[12px] text-zinc-500 truncate">{t.description || t.plural}</div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!t.isDefault ? <button type="button" onClick={() => setDefault(t.id)} title="Set as default" className="w-7 h-7 rounded-md inline-flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-amber-500"><Star className="w-3.5 h-3.5" /></button> : null}
                      {!t.builtIn ? <button type="button" onClick={() => remove(t)} title="Delete" className="w-7 h-7 rounded-md inline-flex items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recommended library */}
        <section>
          <div className="flex items-center justify-between mb-3 gap-3">
            <h2 className="text-[13px] font-semibold text-zinc-900">Recommended</h2>
            <div className="inline-flex items-center gap-2 h-8 px-2.5 rounded-lg border border-zinc-200 w-[220px]">
              <Search className="w-3.5 h-3.5 text-zinc-400" />
              <input value={recSearch} onChange={(e) => setRecSearch(e.target.value)} placeholder="Search types…" className="flex-1 text-[13px] bg-transparent outline-none" />
            </div>
          </div>
          {recCats.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <button type="button" onClick={() => setRecCat(null)} className={`h-7 px-2.5 rounded-full text-[12px] ${recCat === null ? "bg-zinc-900 text-white" : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>All</button>
              {recCats.map((c) => (
                <button key={c} type="button" onClick={() => setRecCat(recCat === c ? null : c)} className={`h-7 px-2.5 rounded-full text-[12px] ${recCat === c ? "bg-zinc-900 text-white" : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>{c}</button>
              ))}
            </div>
          ) : null}
          {recFiltered.length === 0 ? (
            <div className="text-[13px] text-zinc-400 py-6">Nothing to add{recSearch || recCat ? " for this filter" : ""}.</div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2.5">
              {recFiltered.map((r) => {
                const Icon = itemTypeIcon(r.icon);
                return (
                  <div key={r.singular} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3">
                    <span className="inline-flex w-8 h-8 rounded-lg bg-zinc-50 items-center justify-center text-zinc-600 shrink-0"><Icon className="w-4 h-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium text-zinc-900 truncate">{r.singular}</div>
                      <div className="text-[12px] text-zinc-500 truncate">{r.description}</div>
                    </div>
                    <button type="button" onClick={() => addRecommended(r)} disabled={adding === r.singular || usage.used >= usage.limit} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-zinc-200 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                      {adding === r.singular ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {createOpen ? (
        <CreateTypeModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); void load(); }}
          existingNames={existingNames}
        />
      ) : null}
    </>
  );
}

function CreateTypeModal({ onClose, onCreated, existingNames }: { onClose: () => void; onCreated: () => void; existingNames: Set<string> }) {
  const { toast } = useOsToast();
  const [icon, setIcon] = useState("CircleDot");
  const [singular, setSingular] = useState("");
  const [plural, setPlural] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const dupe = singular.trim() && existingNames.has(singular.trim().toLowerCase());
  const canSave = singular.trim().length > 0 && !dupe && !busy;

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const res = await fetch("/api/item-types", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ singular: singular.trim(), plural: plural.trim() || undefined, icon, description: description.trim() || undefined }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error); }
      toast("Task type created");
      onCreated();
    } catch (e) { toast(e instanceof Error && e.message ? e.message : "Couldn't create type"); }
    finally { setBusy(false); }
  };

  const PreviewIcon = itemTypeIcon(icon);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-[440px] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100">
          <h3 className="text-[15px] font-semibold text-zinc-900">Create Task Type</h3>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-full bg-zinc-100 hover:bg-zinc-200 inline-flex items-center justify-center text-zinc-500"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex w-11 h-11 rounded-xl bg-zinc-50 items-center justify-center text-zinc-600"><PreviewIcon className="w-5 h-5" /></span>
            <div className="text-[13px] text-zinc-500">Pick an icon and name your type.</div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-zinc-600">Icon</label>
            <div className="mt-1.5 grid grid-cols-9 gap-1 max-h-[120px] overflow-y-auto rounded-lg border border-zinc-200 p-2">
              {ITEM_TYPE_ICON_NAMES.map((name) => {
                const Ic = itemTypeIcon(name);
                return (
                  <button key={name} type="button" onClick={() => setIcon(name)} className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${icon === name ? "bg-[var(--os-brand)] text-white" : "text-zinc-500 hover:bg-zinc-100"}`}>
                    <Ic className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-zinc-600">Singular name <span className="text-red-400">*</span></label>
              <input value={singular} onChange={(e) => setSingular(e.target.value.slice(0, 16))} maxLength={16} placeholder="Bug" className="mt-1 w-full h-9 px-2.5 rounded-lg border border-zinc-200 text-[13px] outline-none focus:border-zinc-400" autoFocus />
              {dupe ? <div className="text-[11px] text-red-500 mt-1">A type with this name exists.</div> : null}
            </div>
            <div>
              <label className="text-[12px] font-medium text-zinc-600">Plural name</label>
              <input value={plural} onChange={(e) => setPlural(e.target.value.slice(0, 16))} maxLength={16} placeholder="Bugs" className="mt-1 w-full h-9 px-2.5 rounded-lg border border-zinc-200 text-[13px] outline-none focus:border-zinc-400" />
            </div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-zinc-600">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value.slice(0, 100))} maxLength={100} placeholder="A defect to fix" className="mt-1 w-full h-9 px-2.5 rounded-lg border border-zinc-200 text-[13px] outline-none focus:border-zinc-400" />
            <div className="text-[11px] text-zinc-400 mt-1 text-right">{description.length}/100</div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-zinc-100">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] text-zinc-600 hover:bg-zinc-100">Cancel</button>
          <button type="button" onClick={submit} disabled={!canSave} className="h-9 px-4 rounded-lg text-[13px] text-white bg-[var(--os-brand)] inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Create
          </button>
        </div>
      </div>
    </div>
  );
}
