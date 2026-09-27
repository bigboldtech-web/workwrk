"use client";

// Targets card on the goal page (spec-goals /okrs/[id] body 3). One 36px
// row per target: name · "Start 0 to Now 42 to Target 100 units" · a 72px
// bar and % · the last check-in · a 28px Check in for people who may check in
// (owner, contributors, the owner's manager chain, the People team, Admin) ·
// a row "..." (Check in, View history, Delete target for target writers).
// A target fed by a KPI shows "From KPI {name}" instead of Check in; the
// server refuses hand check-ins on it (409). The last row is "+ Add target",
// an inline composer (name, start, target, unit; Enter saves, Esc cancels)
// for target writers. Writes: POST /api/okrs/[id]/key-results, DELETE
// /api/okrs/[id]/key-results/[krId], POST /api/okrs/[id]/check-in, then
// router.refresh() so the ring, the verdict and Activity repaint.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { History, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MenuList, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { OkrCheckInModal } from "./okr-checkin-modal";

export interface TargetRowData {
  id: string;
  title: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
  currentValue: number;
  progress: number;
  /** Measured by a linked role KPI: check-ins are refused server-side. */
  isDerived: boolean;
  kpiName: string | null;
  /** Pre-formatted relative time of the last check-in (server clock). */
  lastCheckIn: string | null;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function GoalTargets({ okrId, canEdit, canCheckIn, targets, onHistory }: {
  okrId: string;
  /** Target writer (add, delete): canEditOkrOwner, the key-results routes' gate. */
  canEdit: boolean;
  /** May check in: target writers plus the goal's contributors. */
  canCheckIn: boolean;
  targets: TargetRowData[];
  /** Scroll to the Activity card ("View history"). */
  onHistory?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="rounded-lg border border-line bg-raised p-6" aria-labelledby="goal-targets-h">
      <h2 id="goal-targets-h" className="m-0 flex items-baseline gap-2 text-base font-semibold text-ink">
        Targets {targets.length ? <span className="text-xs font-medium text-ink-2">{targets.length}</span> : null}
      </h2>
      <ol className="m-0 mt-3 flex list-none flex-col p-0">
        {targets.length === 0 && !adding ? (
          <li className="flex h-9 items-center text-row text-ink-2">
            No targets yet{canEdit ? <> · <button type="button" className="ms-1 text-brand-deep hover:underline" onClick={() => setAdding(true)}>Add a target</button></> : null}
          </li>
        ) : null}
        {targets.map((t) => (
          <TargetRow key={t.id} okrId={okrId} target={t} canEdit={canEdit} canCheckIn={canCheckIn} onHistory={onHistory} />
        ))}
        {adding ? <TargetComposer okrId={okrId} onDone={() => setAdding(false)} /> : null}
        {canEdit && !adding && targets.length > 0 ? (
          <li>
            <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md px-1 text-row text-ink-2 hover:text-ink">
              <Plus className="h-4 w-4" aria-hidden /> Add target
            </button>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function TargetRow({ okrId, target: t, canEdit, canCheckIn, onHistory }: {
  okrId: string;
  target: TargetRowData;
  canEdit: boolean;
  canCheckIn: boolean;
  onHistory?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pct = Math.max(0, Math.min(100, t.progress));
  const unit = t.unit?.trim();

  const del = async () => {
    setMenuOpen(false);
    const ok = await confirm({
      title: `Delete ${t.title}?`,
      description: "Its check-ins go with it and the goal's progress re-rolls from the targets left. This can't be undone.",
      destructive: true,
      confirmLabel: "Delete target",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/okrs/${okrId}/key-results/${t.id}`, { method: "DELETE" });
      if (res.ok) { toast("Target deleted"); router.refresh(); }
      else { const d = await res.json().catch(() => ({})); toast(d?.error ?? "Couldn't delete the target", { tone: "danger" }); }
    } catch {
      toast("Couldn't delete the target", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="os-row group flex h-9 min-w-0 items-center gap-3 border-b border-line last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-row text-ink" title={t.title}>{t.title}</span>
      <span className="shrink-0 text-sm tabular-nums text-ink-2" title={`Start ${fmtNum(t.startValue)}, now ${fmtNum(t.currentValue)}, target ${fmtNum(t.targetValue)}${unit ? ` ${unit}` : ""}`}>
        {fmtNum(t.currentValue)} of {fmtNum(t.targetValue)}{unit ? ` ${unit}` : ""}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="h-1 w-[72px] overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </span>
        <span className="w-9 text-end text-sm tabular-nums text-ink">{pct}%</span>
      </span>
      <span className="hidden w-20 shrink-0 truncate text-xs text-ink-2 xl:inline">
        {t.isDerived ? `From KPI ${t.kpiName ?? ""}`.trim() : t.lastCheckIn ?? "No check-ins"}
      </span>
      {canCheckIn && !t.isDerived ? (
        <button type="button" onClick={() => setCheckinOpen(true)} className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
          Check in
        </button>
      ) : null}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={`Actions for ${t.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <MorePortal anchorRef={btnRef} width={200} open={menuOpen} placement="below" onClose={() => setMenuOpen(false)}>
        <MenuList aria-label={`Actions for ${t.title}`}>
          <MenuItem icon={Pencil} label={canCheckIn && !t.isDerived ? "Check in" : "View target"} onClick={() => { setMenuOpen(false); setCheckinOpen(true); }} />
          {onHistory ? <MenuItem icon={History} label="View history" onClick={() => { setMenuOpen(false); onHistory(); }} /> : null}
          {canEdit ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} label="Delete target" destructive onClick={() => void del()} busy={busy} />
            </>
          ) : null}
        </MenuList>
      </MorePortal>
      {checkinOpen ? <OkrCheckInModal okrId={okrId} target={t} canEdit={canCheckIn} onClose={() => setCheckinOpen(false)} /> : null}
    </li>
  );
}

function TargetComposer({ okrId, onDone }: { okrId: string; onDone: () => void }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [title, setTitle] = useState("");
  const [startValue, setStartValue] = useState("0");
  const [targetValue, setTargetValue] = useState("100");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || saving) return;
    const start = Number(startValue);
    const target = Number(targetValue);
    if (!Number.isFinite(start) || !Number.isFinite(target)) { setError("Start and Target must be numbers."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/okrs/${okrId}/key-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), startValue: start, targetValue: target, unit: unit.trim() || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error ?? `Couldn't add it (${res.status})`); }
      toast("Target added");
      onDone();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the target");
    } finally {
      setSaving(false);
    }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void submit(); }
    if (e.key === "Escape") { e.stopPropagation(); onDone(); }
  };
  const field = "h-8 min-w-0 rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-brand focus:outline-none";
  return (
    <li className="flex flex-col gap-2 border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2" onKeyDown={onKey}>
        <input autoFocus aria-label="Target name" placeholder="Target name" value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} flex-1`} />
        <input aria-label="Start" type="number" step="any" value={startValue} onChange={(e) => setStartValue(e.target.value)} className={`${field} w-20 tabular-nums`} />
        <input aria-label="Target" type="number" step="any" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className={`${field} w-20 tabular-nums`} />
        <input aria-label="Unit" placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={`${field} w-24`} />
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={saving}>Cancel</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void submit()} disabled={saving || !title.trim()}>{saving ? "Adding" : "Add"}</Button>
      </div>
      {error ? <p role="alert" className="m-0 text-sm text-danger-text">{error}</p> : null}
    </li>
  );
}
