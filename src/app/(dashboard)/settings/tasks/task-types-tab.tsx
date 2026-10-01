"use client";

/* Task system > Task types (the old /settings/task-types 308s to
 * /settings/tasks?tab=types). Manage the org's Item types (Task / Milestone /
 * custom). List active types + usage meter, create custom types, and add
 * from a recommended library. Mirrors ClickUp's Task Types manager.
 *
 *  GET    /api/item-types          → { types, recommended, categories, usage }
 *  POST   /api/item-types          → create custom type
 *  PATCH  /api/item-types/[id]     → set default / edit
 *  DELETE /api/item-types/[id]     → remove custom type
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "@/components/ui/error-state";
import { Plus, Search } from "lucide-react";
import { Dots } from "@/components/ui/dots";

import { useOsToast } from "@/components/layout/os/toast";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { btn } from "@/components/settings/settings-form";
import { useConfirm } from "@/components/ui/dialog-provider";
import { itemTypeIcon, ITEM_TYPE_ICON_NAMES } from "@/lib/item-type-icons";

type ApiType = {
  id: string; singular: string; plural: string; icon: string;
  description: string | null; category: string | null; isDefault: boolean; builtIn: boolean;
};
type Recommended = { singular: string; plural: string; icon: string; description: string; category: string };

export function TaskTypesTab({
  createOpen,
  onCreateOpenChange,
  onUsage,
}: {
  /** The page toolbar's "New type" button opens this (the tab's one primary). */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onUsage: (usage: { used: number; limit: number }) => void;
}) {
  const setCreateOpen = onCreateOpenChange;
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [types, setTypes] = useState<ApiType[] | null>(null);
  const [recommended, setRecommended] = useState<Recommended[]>([]);
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 20 });
  const [recSearch, setRecSearch] = useState("");
  const [recCat, setRecCat] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  // A failed read renders ErrorState with Retry, never an empty list that
  // reads as "this workspace has no task types".
  const [loadError, setLoadError] = useState<string | null>(null);
  const onUsageRef = useRef(onUsage);
  onUsageRef.current = onUsage;
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/item-types", { cache: "no-store" });
      if (!res.ok) { setLoadError(`HTTP ${res.status}`); return; }
      const d = await res.json();
      setTypes(Array.isArray(d.types) ? d.types : []);
      setRecommended(Array.isArray(d.recommended) ? d.recommended : []);
      setUsage(d.usage ?? { used: 0, limit: 20 });
      onUsageRef.current(d.usage ?? { used: 0, limit: 20 });
    } catch (e) { setLoadError(e instanceof Error ? e.message : "Network error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const existingNames = useMemo(() => new Set((types ?? []).map((t) => t.singular.toLowerCase())), [types]);

  const setDefault = useCallback(async (id: string) => {
    setTypes((prev) => (prev ?? []).map((t) => ({ ...t, isDefault: t.id === id })));
    try {
      const res = await fetch(`/api/item-types/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isDefault: true }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(typeof d?.error === "string" ? d.error : ""); }
      toast("Default type updated");
    } catch (e) {
      // The optimistic swap is undone by reloading the stored list.
      toast(e instanceof Error && e.message ? `Couldn't update default: ${e.message}` : "Couldn't update default");
      void load();
    }
  }, [load, toast]);

  const remove = useCallback(async (t: ApiType) => {
    if (!(await confirm({ title: "Delete task type", description: `Delete the "${t.singular}" type? Tasks of this type fall back to the default.`, destructive: true, confirmLabel: "Delete" }))) return;
    setTypes((prev) => (prev ?? []).filter((x) => x.id !== t.id));
    try {
      const res = await fetch(`/api/item-types/${t.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast("Type deleted");
      void load();
    } catch { toast("Couldn't delete type"); void load(); }
  }, [load, toast, confirm]);

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

  if (loadError) {
    return <ErrorState what="task types" hint={loadError} onRetry={() => { void load(); }} />;
  }

  const columns: TableColumn<ApiType>[] = [
    {
      key: "type", label: "Type", title: true, width: "minmax(240px,2fr)",
      render: (t) => {
        const Icon = itemTypeIcon(t.icon);
        return (
          <span className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-hover text-ink-2"><Icon className="h-4 w-4" strokeWidth={1.5} /></span>
            <span className="min-w-0">
              <span className="block truncate">{t.singular}</span>
              <span className="block truncate text-sm font-normal text-ink-2">{t.description || t.plural}</span>
            </span>
          </span>
        );
      },
    },
    { key: "kind", label: "Built-in", width: "110px", render: (t) => (t.builtIn ? "Built-in" : "Custom") },
    { key: "default", label: "Default", width: "110px", render: (t) => (t.isDefault ? <Chip>Default</Chip> : "·") },
  ];

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* Active types */}
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-ink">Active types</h2>
          <TableCard
            ariaLabel="Task types"
            columns={columns}
            rows={types}
            rowKey={(t) => t.id}
            rowMenuAlwaysVisible
            rowMenuWidth={200}
            rowMenu={(t) => (
              <span className="flex items-center justify-end gap-1">
                {!t.isDefault ? <button type="button" className={btn.ghost} onClick={() => { void setDefault(t.id); }}>Make default</button> : null}
                {!t.builtIn ? <button type="button" className={btn.dangerGhost} onClick={() => { void remove(t); }}>Delete</button> : null}
              </span>
            )}
            empty={<span>No task types yet</span>}
          />
        </section>

        {/* Recommended library */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">Recommended</h2>
            <label className="flex h-9 w-[240px] max-w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-3 focus-within:shadow-[0_0_0_3px_var(--os-focus-halo)]">
              <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
              <input value={recSearch} onChange={(e) => setRecSearch(e.target.value)} placeholder="Search types" aria-label="Search recommended types" className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none" />
            </label>
          </div>
          {recCats.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {/* Filter chips: the selected one is the neutral pill, never a
                  second blue fill beside the page's one primary. */}
              <button type="button" aria-pressed={recCat === null} onClick={() => setRecCat(null)} className={chipClass(recCat === null)}>All</button>
              {recCats.map((c) => (
                <button key={c} type="button" aria-pressed={recCat === c} onClick={() => setRecCat(recCat === c ? null : c)} className={chipClass(recCat === c)}>{c}</button>
              ))}
            </div>
          ) : null}
          {recFiltered.length === 0 ? (
            <p className="py-4 text-base text-ink-2">Nothing to add{recSearch || recCat ? " for this filter" : ""}.</p>
          ) : (
            <ul className="flex flex-col rounded-lg border border-line bg-raised">
              {recFiltered.map((r) => {
                const Icon = itemTypeIcon(r.icon);
                return (
                  <li key={r.singular} className="flex min-h-11 items-center gap-3 border-b border-line-soft px-4 py-2 last:border-b-0">
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-hover text-ink-2"><Icon className="h-4 w-4" strokeWidth={1.5} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-ink">{r.singular}</span>
                      <span className="block truncate text-sm text-ink-2">{r.description}</span>
                    </span>
                    <button type="button" onClick={() => addRecommended(r)} disabled={adding === r.singular || usage.used >= usage.limit} className={btn.secondary}>
                      {adding === r.singular ? <Dots variant="pending" /> : <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />} Add
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <CreateTypeModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); void load(); }}
        existingNames={existingNames}
      />
    </>
  );
}

function chipClass(on: boolean): string {
  return on
    ? "h-7 rounded-full border border-ink bg-active px-2.5 text-sm font-medium text-ink"
    : "h-7 rounded-full border border-line-strong px-2.5 text-sm text-ink-2 hover:bg-hover hover:text-ink";
}

function CreateTypeModal({ open, onClose, onCreated, existingNames }: { open: boolean; onClose: () => void; onCreated: () => void; existingNames: Set<string> }) {
  const { toast } = useOsToast();
  const [icon, setIcon] = useState("CircleDot");
  const [singular, setSingular] = useState("");
  const [plural, setPlural] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const dupe = singular.trim() && existingNames.has(singular.trim().toLowerCase());
  const canSave = singular.trim().length > 0 && !dupe && !busy;
  const close = () => { setSingular(""); setPlural(""); setDescription(""); setIcon("CircleDot"); onClose(); };

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
      setSingular(""); setPlural(""); setDescription(""); setIcon("CircleDot");
      onCreated();
    } catch (e) { toast(e instanceof Error && e.message ? e.message : "Couldn't create type"); }
    finally { setBusy(false); }
  };

  const PreviewIcon = itemTypeIcon(icon);
  const input = "mt-1 h-9 w-full rounded-md border border-line-strong bg-raised px-2.5 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]";
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New task type</DialogTitle>
          <DialogDescription>Pick an icon and name your type.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-hover text-ink-2"><PreviewIcon className="h-5 w-5" strokeWidth={1.5} /></span>
            <span className="text-base text-ink-2">{singular.trim() || "Your type"}</span>
          </div>
          <div>
            <span className="text-sm font-medium text-ink">Icon</span>
            <div className="mt-1.5 grid max-h-[120px] grid-cols-9 gap-1 overflow-y-auto rounded-md border border-line p-2">
              {ITEM_TYPE_ICON_NAMES.map((name) => {
                const Ic = itemTypeIcon(name);
                return (
                  <button key={name} type="button" aria-label={name} aria-pressed={icon === name} onClick={() => setIcon(name)} className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${icon === name ? "bg-active text-ink ring-1 ring-ink" : "text-ink-2 hover:bg-hover hover:text-ink"}`}>
                    <Ic className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-ink">Singular name</span>
              <input value={singular} onChange={(e) => setSingular(e.target.value.slice(0, 16))} maxLength={16} placeholder="Bug" className={input} autoFocus />
              {dupe ? <span role="alert" className="mt-1 block text-sm text-danger-text">A type with this name exists.</span> : null}
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Plural name</span>
              <input value={plural} onChange={(e) => setPlural(e.target.value.slice(0, 16))} maxLength={16} placeholder="Bugs" className={input} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-ink">Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value.slice(0, 100))} maxLength={100} placeholder="A defect to fix" className={input} />
            <span className="mt-1 block text-end text-sm text-ink-3">{description.length}/100</span>
          </label>
        </div>
        <DialogFooter>
          <button type="button" onClick={close} className={btn.ghost}>Cancel</button>
          <button type="button" onClick={() => { void submit(); }} disabled={!canSave} className={btn.primary}>
            {busy ? <Dots variant="pending" /> : null} Create
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
