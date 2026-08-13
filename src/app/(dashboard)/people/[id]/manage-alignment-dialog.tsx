"use client";

// ManageAlignmentDialog — manager-facing panel to edit one person's
// alignment: add/remove KRAs (with weightage) and SOP assignments, plus a
// one-click "Seed from role" that re-applies the role's templates. Wraps
// the existing /api/kra-assignments + /api/sop-assignments + seed endpoints
// so there's a single screen instead of editing each piece piecemeal.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Target, ScrollText, Plus, X, Sparkles, Loader2 } from "lucide-react";

interface KraAssignment { id: string; kraId: string; weightage: number; kra?: { id: string; name: string; category?: string | null; role?: { id: string; title: string } | null } }
interface SopAssignment { id: string; sopId: string; mandatory?: boolean; sop?: { id: string; title: string } }
interface KraOption { id: string; name: string; category?: string | null; role?: { id: string; title: string } | null }
interface SopOption { id: string; title: string }

// The list endpoints return a few different envelope shapes across the
// codebase — normalize to a plain array.
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
        className="w-12 h-6 px-1 rounded border border-zinc-200 text-[11px] text-right tabular-nums bg-white focus:outline-none focus:border-[#0073EA] disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="text-[11px] text-zinc-400">%</span>
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
  const [allKras, setAllKras] = useState<KraOption[]>([]);
  const [allSops, setAllSops] = useState<SopOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [newKraId, setNewKraId] = useState("");
  const [newKraWeight, setNewKraWeight] = useState(10);
  const [newSopId, setNewSopId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [kraRes, sopRes, krasRes, sopsRes] = await Promise.all([
        fetch(`/api/kra-assignments?userId=${userId}`).then((r) => r.json()).catch(() => null),
        fetch(`/api/sop-assignments?userId=${userId}`).then((r) => r.json()).catch(() => null),
        fetch(`/api/kras?limit=200`).then((r) => r.json()).catch(() => null),
        fetch(`/api/sops?limit=200&status=PUBLISHED`).then((r) => r.json()).catch(() => null),
      ]);
      setKraAssignments(asArray<KraAssignment>(kraRes, ["assignments", "data"]));
      setSopAssignments(asArray<SopAssignment>(sopRes, ["assignments", "data"]));
      setAllKras(asArray<KraOption>(krasRes, ["items", "data"]));
      setAllSops(asArray<SopOption>(sopsRes, ["items", "data"]));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const fireChanged = () => onChanged?.();

  const assignedKraIds = useMemo(() => new Set(kraAssignments.map((a) => a.kraId)), [kraAssignments]);
  const assignedSopIds = useMemo(() => new Set(sopAssignments.map((a) => a.sopId)), [sopAssignments]);
  const totalWeight = useMemo(() => kraAssignments.reduce((s, a) => s + (a.weightage || 0), 0), [kraAssignments]);

  const availableKras = allKras.filter((k) => !assignedKraIds.has(k.id));
  const availableSops = allSops.filter((s) => !assignedSopIds.has(s.id));

  const addKra = async () => {
    if (!newKraId) return;
    setBusy("add-kra");
    try {
      const res = await fetch("/api/kra-assignments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, kraId: newKraId, weightage: newKraWeight }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); error("Couldn't add KRA", d.error); return; }
      setNewKraId(""); setNewKraWeight(10);
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
      setNewSopId("");
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
      if (!res.ok) { error("Couldn't seed from role", d.error ?? d?.data?.error); return; }
      const r = d.data ?? d;
      await load(); fireChanged();
      success("Seeded from role", `${r.krasSeeded ?? 0} KRA(s) · ${r.sopsSeeded ?? 0} SOP(s) added`);
    } finally { setBusy(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>Manage alignment · {userName}</span>
            <Button size="sm" variant="outline" onClick={() => void seedFromRole()} disabled={busy !== null}>
              {busy === "seed" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
              Seed from role
            </Button>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-zinc-500">Loading…</div>
        ) : (
          <div className="space-y-6">
            {/* KRAs */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" /> KRAs · {kraAssignments.length}
                </h3>
                <span className={`text-[11px] ${totalWeight > 100 ? "text-red-500" : "text-zinc-400"}`}>
                  weight {totalWeight}%
                </span>
              </div>
              <ul className="space-y-1.5">
                {kraAssignments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5">
                    <span className="flex-1 min-w-0 text-sm truncate">{a.kra?.name ?? "KRA"}</span>
                    {/* Which job title this KRA belongs to — an orphan KRA is
                        flagged so the manager spots it before assigning. */}
                    {a.kra?.role ? (
                      <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 truncate max-w-[120px]" title={a.kra.role.title}>{a.kra.role.title}</span>
                    ) : (
                      <span className="text-[10px] text-amber-600 px-1.5 py-0.5 rounded bg-amber-50" title="This KRA belongs to no job title yet">No job title</span>
                    )}
                    {a.kra?.category ? <Badge variant="outline" className="text-[9px]">{a.kra.category}</Badge> : null}
                    <WeightCell key={`w-${a.id}-${a.weightage}`} value={a.weightage} disabled={busy !== null} onSave={(w) => saveWeight(a.id, w)} />
                    <button type="button" onClick={() => void removeKra(a.id)} disabled={busy !== null}
                      className="text-zinc-400 hover:text-red-500 disabled:opacity-50" aria-label="Remove KRA">
                      {busy === `del-kra-${a.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    </button>
                  </li>
                ))}
                {kraAssignments.length === 0 ? <li className="text-[12px] text-zinc-400 px-1">No KRAs assigned.</li> : null}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <select value={newKraId} onChange={(e) => setNewKraId(e.target.value)}
                  className="flex-1 h-8 px-2 rounded-md border border-zinc-200 text-[12.5px] bg-white">
                  <option value="">Add a KRA…</option>
                  {availableKras.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}{k.role?.title ? ` · ${k.role.title}` : " · no job title"}
                    </option>
                  ))}
                </select>
                <Input type="number" min={1} max={100} value={newKraWeight}
                  onChange={(e) => setNewKraWeight(Number(e.target.value))}
                  className="w-16 h-8 text-[12.5px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" aria-label="Weightage %" />
                <Button size="sm" onClick={() => void addKra()} disabled={!newKraId || busy !== null}>
                  {busy === "add-kra" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </section>

            {/* SOPs */}
            <section>
              <h3 className="text-xs uppercase tracking-wide text-zinc-500 flex items-center gap-1.5 mb-2">
                <ScrollText className="w-3.5 h-3.5" /> SOPs · {sopAssignments.length}
              </h3>
              <ul className="space-y-1.5">
                {sopAssignments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5">
                    <span className="flex-1 min-w-0 text-sm truncate">{a.sop?.title ?? "SOP"}</span>
                    {a.mandatory ? <Badge variant="outline" className="text-[9px]">Mandatory</Badge> : null}
                    <button type="button" onClick={() => void removeSop(a.id)} disabled={busy !== null}
                      className="text-zinc-400 hover:text-red-500 disabled:opacity-50" aria-label="Remove SOP">
                      {busy === `del-sop-${a.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    </button>
                  </li>
                ))}
                {sopAssignments.length === 0 ? <li className="text-[12px] text-zinc-400 px-1">No SOPs assigned.</li> : null}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <select value={newSopId} onChange={(e) => setNewSopId(e.target.value)}
                  className="flex-1 h-8 px-2 rounded-md border border-zinc-200 text-[12.5px] bg-white">
                  <option value="">Assign a SOP…</option>
                  {availableSops.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
                <Button size="sm" onClick={() => void addSop()} disabled={!newSopId || busy !== null}>
                  {busy === "add-sop" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
