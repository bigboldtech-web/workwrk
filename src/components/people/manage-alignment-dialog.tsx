"use client";

// ManageAlignmentDialog: manager-facing panel to edit one person's
// alignment: add/remove KRAs (with weightage) and SOP assignments, plus a
// one-click "Seed from job title" that re-applies the job title's templates. Wraps
// the existing /api/kra-assignments + /api/sop-assignments + seed endpoints
// so there's a single screen instead of editing each piece piecemeal.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Picker } from "@/components/ui/picker";
import { ToneChip } from "./person-bits";
import { useToast } from "@/components/ui/toast";
import { ChevronDown, Target, ScrollText, Plus, X, Sparkles } from "lucide-react";
import { SkeletonRows } from "@/components/ui/skeleton";

interface KraAssignment { id: string; kraId: string; weightage: number; kra?: { id: string; name: string; category?: string | null; role?: { id: string; title: string } | null } }
interface SopAssignment { id: string; sopId: string; mandatory?: boolean; sop?: { id: string; title: string } }
interface KraOption { id: string; name: string; category?: string | null; role?: { id: string; title: string } | null }
interface SopOption { id: string; title: string }

// The list endpoints return a few different envelope shapes across the
// codebase: normalize to a plain array.
function asArray<T>(data: unknown, keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  const d = data as Record<string, unknown> | null;
  if (!d) return [];
  for (const k of keys) {
    const v = d[k];
    if (Array.isArray(v)) return v as T[];
  }
  // pagination: { data: { items: [] } } or { data: [] }
  const inner = d.data as Record<string, unknown> | unknown[] | undefined;
  if (Array.isArray(inner)) return inner as T[];
  if (inner && Array.isArray((inner as Record<string, unknown>).items)) return (inner as Record<string, unknown>).items as T[];
  return [];
}

/**
 * A server-searched catalogue for a picker: loads the first 50 when the
 * picker opens and re-queries as the person types (debounced 200ms), so
 * nothing past a fixed row count is ever out of reach.
 */
function useServerSearch<T>(urlFor: (q: string) => string, keys: string[], active: boolean) {
  const [rows, setRows] = useState<T[] | null>(null);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  const run = useCallback(async (q: string) => {
    const mine = ++seq.current;
    const data = await fetch(urlFor(q), { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (mine !== seq.current) return;
    setRows(asArray<T>(data, keys));
    // urlFor and keys are stable per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => { void run(""); }, 0);
    return () => window.clearTimeout(t);
  }, [active, run]);
  const search = useCallback((q: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void run(q.trim()); }, 200);
  }, [run]);
  return { rows, search };
}

/** Editable per-KRA weight. This used to be static text, so an assignment
 *  seeded at 0% could never be corrected from here. Commits on blur/Enter,
 *  Escape reverts. Keyed by the server value in the parent so a successful
 *  reload remounts it fresh; a rejected save snaps the draft back. */
function WeightCell({ value, disabled, onSave }: {
  value: number;
  disabled: boolean;
  onSave: (weightage: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    const w = Number(draft);
    if (!Number.isFinite(w) || w === value || draft.trim() === "") { setDraft(String(value)); return; }
    setSaving(true);
    const ok = await onSave(w);
    setSaving(false);
    if (!ok) setDraft(String(value));
  };
  return (
    <span className="flex items-center gap-0.5 shrink-0">
      <input
        type="number" min={1} max={100} value={draft} disabled={disabled || saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { setDraft(String(value)); }
        }}
        aria-label="Weightage %"
        className="h-7 w-12 rounded-md border border-line bg-raised px-1 text-end text-sm tabular-nums text-ink focus:border-brand focus:outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="text-sm text-ink-2">%</span>
    </span>
  );
}

export function ManageAlignmentDialog({
  open, onOpenChange, userId, userName, onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  userName: string;
  onChanged?: () => void;
}) {
  const { success, error } = useToast();
  const [kraAssignments, setKraAssignments] = useState<KraAssignment[]>([]);
  const [sopAssignments, setSopAssignments] = useState<SopAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [newKraId, setNewKraId] = useState("");
  const [newKraLabel, setNewKraLabel] = useState("");
  const [newKraWeight, setNewKraWeight] = useState(10);
  const [newSopId, setNewSopId] = useState("");
  const [newSopLabel, setNewSopLabel] = useState("");
  const [kraPickOpen, setKraPickOpen] = useState(false);
  const [sopPickOpen, setSopPickOpen] = useState(false);
  const kraSearch = useServerSearch<KraOption>((q) => `/api/kras?limit=50${q ? `&search=${encodeURIComponent(q)}` : ""}`, ["items", "data"], kraPickOpen);
  const sopSearch = useServerSearch<SopOption>((q) => `/api/sops?limit=50&status=PUBLISHED${q ? `&q=${encodeURIComponent(q)}` : ""}`, ["items", "data"], sopPickOpen);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The KRA and SOP catalogues are searched on the server as the
      // manager types (no row cap: KRA number 501 is as findable as the first).
      const [kraRes, sopRes] = await Promise.all([
        fetch(`/api/kra-assignments?userId=${userId}`).then((r) => r.json()).catch(() => null),
        fetch(`/api/sop-assignments?userId=${userId}`).then((r) => r.json()).catch(() => null),
      ]);
      setKraAssignments(asArray<KraAssignment>(kraRes, ["assignments", "data"]));
      setSopAssignments(asArray<SopAssignment>(sopRes, ["assignments", "data"]));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const fireChanged = () => onChanged?.();

  const assignedKraIds = useMemo(() => new Set(kraAssignments.map((a) => a.kraId)), [kraAssignments]);
  const assignedSopIds = useMemo(() => new Set(sopAssignments.map((a) => a.sopId)), [sopAssignments]);
  const totalWeight = useMemo(() => kraAssignments.reduce((s, a) => s + (a.weightage || 0), 0), [kraAssignments]);

  const availableKras = (kraSearch.rows ?? []).filter((k) => !assignedKraIds.has(k.id));
  const availableSops = (sopSearch.rows ?? []).filter((s) => !assignedSopIds.has(s.id));

  const addKra = async () => {
    if (!newKraId) return;
    setBusy("add-kra");
    try {
      const res = await fetch("/api/kra-assignments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, kraId: newKraId, weightage: newKraWeight }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); error("Couldn't add KRA", d.error); return; }
      setNewKraId(""); setNewKraLabel(""); setNewKraWeight(10);
      await load(); fireChanged(); success("KRA added");
    } finally { setBusy(null); }
  };

  // Wired to the existing PUT /api/kra-assignments/[id], which validates
  // 1..100 and caps the person's total at 100. Its rejection message (with
  // the exact totals) is surfaced as a toast instead of failing silently.
  const saveWeight = async (id: string, weightage: number): Promise<boolean> => {
    if (weightage <= 0 || weightage > 100) {
      error("Weight must be between 1 and 100");
      return false;
    }
    setBusy(`weight-${id}`);
    try {
      const res = await fetch(`/api/kra-assignments/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightage }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        error("Couldn't update weight", d.error);
        return false;
      }
      await load(); fireChanged(); success("Weight updated");
      return true;
    } finally { setBusy(null); }
  };

  const removeKra = async (id: string) => {
    setBusy(`del-kra-${id}`);
    try {
      const res = await fetch(`/api/kra-assignments/${id}`, { method: "DELETE" });
      if (!res.ok) { error("Couldn't remove KRA"); return; }
      await load(); fireChanged();
    } finally { setBusy(null); }
  };

  const addSop = async () => {
    if (!newSopId) return;
    setBusy("add-sop");
    try {
      const res = await fetch("/api/sop-assignments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sopId: newSopId, userIds: [userId] }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); error("Couldn't assign SOP", d.error); return; }
      setNewSopId(""); setNewSopLabel("");
      await load(); fireChanged(); success("SOP assigned");
    } finally { setBusy(null); }
  };

  const removeSop = async (id: string) => {
    setBusy(`del-sop-${id}`);
    try {
      const res = await fetch(`/api/sop-assignments/${id}`, { method: "DELETE" });
      if (!res.ok) { error("Couldn't remove SOP"); return; }
      await load(); fireChanged();
    } finally { setBusy(null); }
  };

  const seedFromRole = async () => {
    setBusy("seed");
    try {
      const res = await fetch(`/api/users/${userId}/seed-alignment`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { error("Couldn't seed from the job title", d.error ?? d?.data?.error); return; }
      const r = d.data ?? d;
      await load(); fireChanged();
      success("Seeded from the job title", `${r.krasSeeded ?? 0} KRA(s) · ${r.sopsSeeded ?? 0} SOP(s) added`);
    } finally { setBusy(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px] max-h-[85vh] min-h-[min(560px,85vh)] content-start overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pe-8">
            <span>Manage alignment · {userName}</span>
            <Button size="sm" variant="outline" onClick={() => void seedFromRole()} disabled={busy !== null}>
              <Sparkles className="me-1 h-3.5 w-3.5" />
              Seed from job title
            </Button>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <SkeletonRows rows={4} />
        ) : (
          <div className="flex flex-col gap-6">
            {/* KRAs */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink-2">
                  <Target className="h-3.5 w-3.5" aria-hidden /> KRAs <span className="tabular-nums">{kraAssignments.length}</span>
                </h3>
                {totalWeight > 100 ? (
                  <ToneChip tone="warning" label={`Weights total ${totalWeight}%`} />
                ) : (
                  <span className="text-sm tabular-nums text-ink-2">Weights total {totalWeight}%</span>
                )}
              </div>
              <ul className="flex flex-col gap-1.5">
                {kraAssignments.map((a) => (
                  <li key={a.id} className="flex min-h-11 items-center gap-2 rounded-md border border-line px-2.5">
                    <span className="min-w-0 flex-1 truncate text-row text-ink">{a.kra?.name ?? "KRA"}</span>
                    {/* Which job title this KRA belongs to: an orphan KRA is
                        flagged so the manager spots it before assigning. */}
                    {a.kra?.role ? (
                      <span className="max-w-[140px] shrink-0 truncate" title={a.kra.role.title}><Chip>{a.kra.role.title}</Chip></span>
                    ) : (
                      <ToneChip tone="warning" label="No job title" title="This KRA belongs to no job title yet" />
                    )}
                    {a.kra?.category ? <Chip>{a.kra.category}</Chip> : null}
                    <WeightCell key={`w-${a.id}-${a.weightage}`} value={a.weightage} disabled={busy !== null} onSave={(w) => saveWeight(a.id, w)} />
                    <button type="button" onClick={() => void removeKra(a.id)} disabled={busy !== null}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-danger-text disabled:opacity-50" aria-label="Remove KRA">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {kraAssignments.length === 0 ? <li className="px-1 text-sm text-ink-2">No KRAs assigned.</li> : null}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <button type="button" aria-haspopup="listbox" aria-expanded={kraPickOpen} onClick={() => setKraPickOpen((v) => !v)}
                    className="inline-flex h-8 w-full items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm text-ink hover:border-line-strong">
                    <span className={`min-w-0 flex-1 truncate text-start ${newKraId ? "" : "text-ink-3"}`}>{newKraId ? newKraLabel : "Add a KRA"}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-hidden />
                  </button>
                  <Picker
                    open={kraPickOpen}
                    onClose={() => setKraPickOpen(false)}
                    ariaLabel="Add a KRA"
                    searchPlaceholder="Search KRAs"
                    alwaysSearch
                    loading={kraSearch.rows === null}
                    onSearchChange={kraSearch.search}
                    emptyLabel="No KRAs match"
                    sections={[{ options: availableKras.map((k) => ({ value: k.id, label: k.name, hint: k.role?.title ?? "No job title" })) }]}
                    onSelect={(v) => { const k = availableKras.find((x) => x.id === v); setNewKraId(v); setNewKraLabel(k?.name ?? ""); setKraPickOpen(false); }}
                    className="absolute start-0 top-9 z-50"
                  />
                </div>
                <input type="number" min={1} max={100} value={newKraWeight}
                  onChange={(e) => setNewKraWeight(Number(e.target.value))}
                  className="h-8 w-16 rounded-md border border-line bg-raised px-2 text-end text-sm tabular-nums text-ink focus:border-brand focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" aria-label="Weightage %" />
                <Button size="sm" variant="outline" onClick={() => void addKra()} disabled={!newKraId || busy !== null} aria-label="Add KRA">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </section>

            {/* SOPs */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink-2">
                <ScrollText className="h-3.5 w-3.5" aria-hidden /> SOPs <span className="tabular-nums">{sopAssignments.length}</span>
              </h3>
              <ul className="flex flex-col gap-1.5">
                {sopAssignments.map((a) => (
                  <li key={a.id} className="flex min-h-11 items-center gap-2 rounded-md border border-line px-2.5">
                    <span className="min-w-0 flex-1 truncate text-row text-ink">{a.sop?.title ?? "SOP"}</span>
                    {a.mandatory ? <Chip>Mandatory</Chip> : null}
                    <button type="button" onClick={() => void removeSop(a.id)} disabled={busy !== null}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-danger-text disabled:opacity-50" aria-label="Remove SOP">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {sopAssignments.length === 0 ? <li className="px-1 text-sm text-ink-2">No SOPs assigned.</li> : null}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <button type="button" aria-haspopup="listbox" aria-expanded={sopPickOpen} onClick={() => setSopPickOpen((v) => !v)}
                    className="inline-flex h-8 w-full items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm text-ink hover:border-line-strong">
                    <span className={`min-w-0 flex-1 truncate text-start ${newSopId ? "" : "text-ink-3"}`}>{newSopId ? newSopLabel : "Assign a SOP"}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-hidden />
                  </button>
                  <Picker
                    open={sopPickOpen}
                    onClose={() => setSopPickOpen(false)}
                    ariaLabel="Assign a SOP"
                    searchPlaceholder="Search published SOPs"
                    alwaysSearch
                    loading={sopSearch.rows === null}
                    onSearchChange={sopSearch.search}
                    emptyLabel="No published SOPs match"
                    sections={[{ options: availableSops.map((x) => ({ value: x.id, label: x.title })) }]}
                    onSelect={(v) => { const x = availableSops.find((y) => y.id === v); setNewSopId(v); setNewSopLabel(x?.title ?? ""); setSopPickOpen(false); }}
                    className="absolute start-0 top-9 z-50"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => void addSop()} disabled={!newSopId || busy !== null} aria-label="Assign SOP">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
