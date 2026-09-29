"use client";

// Calibration (spec-teams-performance /reviews/[id]): a warning line, the
// distribution over the org's own performance bands, then the calibration
// table in its own horizontal scroll with the checkbox column. Calibrated
// opens the Adjust score modal (a required "why"); Potential (Low, Medium,
// High) is what feeds the talent grid; Outcome has all five values. The bulk
// bar is Set outcome, Set potential and Export selected, never a bulk score
// (a score is the thing a person is meant to look at). The page's blue
// "Finalize outcomes" is this panel's, handed up through onPrimary.

import { useCallback, useEffect, useState } from "react";
import { Download, Flag, Gauge } from "lucide-react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { TableCard, BulkAction, type TableColumn } from "@/components/ui/table-card";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PickerButton } from "@/components/dashboards/widget-registry";
import { Picker } from "@/components/ui/picker";
import { PersonAvatar, personName } from "@/components/people/person-bits";
import { PerformanceBandChip } from "@/components/performance/performance-band-chip";
import { apiFetch } from "@/lib/api-fetch";
import { OUTCOMES, POTENTIALS, outcomeLabel } from "@/lib/performance/review-cycle";
import type { Band, PanelPrimary, Person } from "./cycle-types";

type CalibRow = {
  reviewId: string;
  subject: Person;
  status: string;
  kpiScore: number | null;
  selfRating: number | null;
  managerRating: number | null;
  peerRating: number | null;
  peerCount: number;
  sopScore: number | null;
  compositeScore: number | null;
  calibratedScore: number | null;
  calibrationNotes: string | null;
  band: string | null;
  potential: number | null;
  outcome: string | null;
};
type Payload = {
  canManage: boolean;
  bands: Band[];
  calibrationData: CalibRow[];
  distribution: Array<{ label: string; min: number; max: number; count: number }>;
  warning: string | null;
};

// Every score is out of 100 (the same scale as the Team tab); an empty cell
// reads as a dash.
const n = (v: number | null) => (v == null ? "-" : String(Math.round(v)));

export function CalibrationPanel({
  cycleId,
  cycleStatus,
  isAgent,
  onPrimary,
  onChanged,
}: {
  cycleId: string;
  cycleStatus: string;
  isAgent: boolean;
  onPrimary: (p: PanelPrimary) => void;
  onChanged: () => void;
}) {
  const { toast } = useOsToast();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adjust, setAdjust] = useState<CalibRow | null>(null);
  const [bulk, setBulk] = useState<null | "outcome" | "potential">(null);
  const [finalizing, setFinalizing] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<Payload>(`/api/reviews/${cycleId}/calibration`, { cache: "no-store" });
    if (!r.ok) { setError(r.error || "Couldn't load calibration"); return; }
    setError(null);
    setData(r.data);
  }, [cycleId]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const editable = !!data?.canManage && cycleStatus === "IN_CALIBRATION";
  // One blue on screen: while a dialog of this panel is open (it has its own
  // primary), the page's Finalize outcomes is not rendered.
  const dialogOpen = finalizing || !!adjust;
  useEffect(() => {
    onPrimary(editable && !dialogOpen ? { label: "Finalize outcomes", onClick: () => setFinalizing(true) } : null);
  }, [editable, dialogOpen, onPrimary]);
  useEffect(() => () => onPrimary(null), [onPrimary]);

  const patch = async (body: Record<string, unknown>, okMsg?: string) => {
    const r = await apiFetch(`/api/reviews/${cycleId}/calibration`, { method: "PATCH", json: body });
    if (!r.ok) { toast(r.error || "Couldn't save that", { tone: "danger" }); return false; }
    if (okMsg) toast(okMsg);
    await load();
    return true;
  };

  if (error && !data) return <OsEmptyView variant="error" title="Couldn't load calibration" hint={error} action={{ label: "Try again", onClick: () => void load() }} />;
  if (!data) return <SkeletonRows rows={8} />;

  const rows = data.calibrationData;
  const total = rows.length;
  const calibrated = rows.filter((r) => r.calibratedScore != null).length;
  const withOutcome = rows.filter((r) => r.outcome && r.status !== "COMPLETED").length;

  const columns: TableColumn<CalibRow>[] = [
    {
      key: "person", label: "Person", title: true, width: "minmax(200px,1.6fr)",
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <PersonAvatar person={r.subject} size={28} />
          <span className="min-w-0 truncate">{personName(r.subject)}</span>
        </span>
      ),
    },
    { key: "kpi", label: "KPI", width: "64px", numeric: true, render: (r) => <span>{n(r.kpiScore)}</span> },
    { key: "self", label: "Self", width: "64px", numeric: true, render: (r) => <span>{n(r.selfRating)}</span> },
    { key: "manager", label: "Manager", width: "80px", numeric: true, render: (r) => <span>{n(r.managerRating)}</span> },
    { key: "peers", label: "Peers", width: "64px", numeric: true, render: (r) => <span title={`${r.peerCount} answered`}>{n(r.peerRating)}</span> },
    { key: "composite", label: "Composite", width: "96px", numeric: true, render: (r) => <span>{n(r.compositeScore)}</span> },
    { key: "band", label: "Band", width: "150px", render: (r) => <PerformanceBandChip score={r.calibratedScore ?? r.compositeScore} bands={data.bands} /> },
    {
      key: "calibrated", label: "Calibrated", width: "104px", numeric: true,
      render: (r) => editable && r.status !== "COMPLETED" ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); setAdjust(r); }} title={r.calibrationNotes ?? "Adjust the score"}
          className="inline-flex h-7 min-w-12 items-center justify-end rounded-md px-2 text-row tabular-nums text-ink hover:bg-hover">
          {r.calibratedScore == null ? <span className="text-ink-3">Adjust</span> : n(r.calibratedScore)}
        </button>
      ) : <span title={r.calibrationNotes ?? undefined}>{n(r.calibratedScore)}</span>,
    },
    {
      key: "potential", label: "Potential", width: "124px",
      render: (r) => editable && r.status !== "COMPLETED" ? (
        <span onClick={(e) => e.stopPropagation()}>
          <PickerButton ariaLabel={`Potential for ${personName(r.subject)}`} label={POTENTIALS.find((p) => p.value === (r.potential ?? 2))?.label ?? "Medium"}
            selected={String(r.potential ?? 2)} sections={[{ options: POTENTIALS.map((p) => ({ value: String(p.value), label: p.label })) }]}
            onSelect={(v) => void patch({ reviewId: r.reviewId, potential: Number(v) })} />
        </span>
      ) : <span>{POTENTIALS.find((p) => p.value === r.potential)?.label ?? ""}</span>,
    },
    {
      key: "outcome", label: "Outcome", width: "minmax(170px,1fr)",
      render: (r) => editable && r.status !== "COMPLETED" ? (
        <span onClick={(e) => e.stopPropagation()}>
          <PickerButton ariaLabel={`Outcome for ${personName(r.subject)}`} label={r.outcome ? outcomeLabel(r.outcome) : <span className="text-ink-3">Pick</span>}
            selected={r.outcome} sections={[{ options: OUTCOMES }]} onSelect={(v) => void patch({ reviewId: r.reviewId, outcome: v })} />
        </span>
      ) : <span>{outcomeLabel(r.outcome)}</span>,
    },
  ];

  const top = Math.max(1, ...data.distribution.map((d) => d.count));

  return (
    <div className="flex flex-col gap-4">
      {editable ? <p className="m-0 rounded-md bg-[var(--os-warning-bg,var(--os-surface-1))] px-3 py-2 text-sm text-ink">Changing a score here overrides the manager&apos;s. Everyone in this list will see the final number.</p> : null}
      {data.warning ? <p className="m-0 text-sm text-ink-2">{data.warning}</p> : null}
      <section className="rounded-lg border border-line bg-raised p-4" aria-label="Distribution">
        <h2 className="m-0 mb-3 text-sm font-medium text-ink-2">Distribution</h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.distribution.map((d) => (
            <li key={d.label} className="grid grid-cols-[140px_1fr_80px] items-center gap-3 text-sm">
              <span className="truncate text-ink">{d.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-subtle" aria-hidden><span className="block h-full rounded-full bg-[var(--os-ink-3)]" style={{ width: `${(d.count / top) * 100}%` }} /></span>
              <span className="text-end tabular-nums text-ink-2">{d.count} · {total ? Math.round((d.count / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="m-0 text-xs text-ink-2">Every score here is out of 100: KPI, Self, Manager, Peers, Composite and Calibrated.</p>
      <TableCard
        ariaLabel="Calibration"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.reviewId}
        selectable={editable || !isAgent}
        isRowSelectable={(r) => r.status !== "COMPLETED" || !isAgent}
        selected={selected}
        onSelectedChange={setSelected}
        empty={<span className="text-row text-ink-2">Nobody to calibrate yet</span>}
        bulkActions={
          <>
            {editable ? <BulkAction icon={Flag} label="Set outcome" onClick={() => setBulk("outcome")} /> : null}
            {editable ? <BulkAction icon={Gauge} label="Set potential" onClick={() => setBulk("potential")} /> : null}
            {!isAgent ? (
              <BulkAction icon={Download} label="Export selected" onClick={() => {
                const ids = rows.filter((r) => selected.has(r.reviewId)).map((r) => r.subject.id);
                window.location.href = `/api/export/reviews/${cycleId}?subjectIds=${ids.join(",")}`;
              }} />
            ) : null}
          </>
        }
        footer={{ total, noun: "people", from: total ? 1 : 0, to: total, hidePaging: true, extra: <span className="font-normal">· {calibrated} calibrated</span> }}
      />

      {bulk ? (
        <div className="fixed bottom-24 start-1/2 z-50 -translate-x-1/2">
          <Picker open onClose={() => setBulk(null)} ariaLabel={bulk === "outcome" ? "Set outcome" : "Set potential"}
            sections={[{ label: bulk === "outcome" ? "Outcome for the selection" : "Potential for the selection", options: bulk === "outcome" ? OUTCOMES : POTENTIALS.map((p) => ({ value: String(p.value), label: p.label })) }]}
            onSelect={(v) => {
              const ids = [...selected];
              setBulk(null);
              void patch({ reviewIds: ids, ...(bulk === "outcome" ? { outcome: v } : { potential: Number(v) }) }, `Updated ${ids.length} ${ids.length === 1 ? "person" : "people"}`).then((ok) => { if (ok) setSelected(new Set()); });
            }} />
        </div>
      ) : null}

      {adjust ? <AdjustScoreDialog row={adjust} onClose={() => setAdjust(null)} onSave={async (score, why) => { const ok = await patch({ reviewId: adjust.reviewId, calibratedScore: score, calibrationNotes: why }, "Score calibrated"); if (ok) setAdjust(null); return ok; }} /> : null}

      {finalizing ? (
        <FinalizeDialog
          count={withOutcome}
          missing={rows.filter((r) => !r.outcome && r.status !== "COMPLETED").length}
          onClose={() => setFinalizing(false)}
          onConfirm={async (place) => {
            const r = await apiFetch<{ finalized: number; remaining: number; completed: boolean; placed: number }>(`/api/reviews/${cycleId}/finalize`, { method: "POST", json: { placeOnTalentGrid: place } });
            if (!r.ok) { toast(r.error || "Couldn't finalize", { tone: "danger" }); return false; }
            const d = r.data;
            toast(
              d.completed
                ? `${d.finalized} outcomes final. The cycle is complete.${d.placed ? ` ${d.placed} people placed on the talent grid.` : ""}`
                : `${d.finalized} outcomes final. ${d.remaining} ${d.remaining === 1 ? "review is" : "reviews are"} still open, so the cycle stays in calibration.`,
              d.placed ? { action: { label: "Open the talent grid", onClick: () => { window.location.href = "/talent"; } } } : undefined,
            );
            setFinalizing(false);
            await load();
            onChanged();
            return true;
          }}
        />
      ) : null}
    </div>
  );
}

function AdjustScoreDialog({ row, onClose, onSave }: { row: CalibRow; onClose: () => void; onSave: (score: number, why: string) => Promise<boolean> }) {
  const [score, setScore] = useState(String(Math.round(row.calibratedScore ?? row.compositeScore ?? 0)));
  const [why, setWhy] = useState(row.calibrationNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const v = Number(score);
    if (!Number.isFinite(v) || v < 0 || v > 120) { setErr("A score from 0 to 120."); return; }
    if (!why.trim()) { setErr("Say why the score changes."); return; }
    setBusy(true);
    const ok = await onSave(v, why.trim());
    setBusy(false);
    if (!ok) setErr("Not saved. Try again.");
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Adjust {personName(row.subject)}&apos;s score</DialogTitle>
          <DialogDescription>The composite is {row.compositeScore == null ? "not available" : Math.round(row.compositeScore)}.</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Calibrated score</span>
          <input type="number" min={0} max={120} value={score} onChange={(e) => setScore(e.target.value)} className="h-9 w-28 rounded-md border border-line bg-raised px-3 text-row tabular-nums text-ink outline-none focus-visible:border-[var(--os-focus)]" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Why</span>
          <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} maxLength={5000} className="min-h-[76px] w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]" />
        </label>
        {err ? <p role="alert" className="m-0 text-sm text-danger-text">{err}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinalizeDialog({ count, missing, onClose, onConfirm }: { count: number; missing: number; onClose: () => void; onConfirm: (place: boolean) => Promise<boolean> }) {
  const [place, setPlace] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Finalize {count} {count === 1 ? "outcome" : "outcomes"}?</DialogTitle>
          <DialogDescription>
            Everyone finalized sees their result, and their appraisal letter becomes available.
            {missing ? ` ${missing} ${missing === 1 ? "person has" : "people have"} no outcome yet and stay open.` : ""}
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-3 text-sm text-ink">
          <Switch checked={place} onChange={setPlace} aria-label="Also place these people on the talent grid" />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Also place these people on the talent grid</span>
            <span className="text-xs text-ink-2">Performance comes from the final score and the bands in Settings. Potential comes from the Potential column. A placement someone made by hand is kept.</span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || count === 0} onClick={async () => { setBusy(true); const ok = await onConfirm(place); setBusy(false); if (ok) onClose(); }}>
            {busy ? "Finalizing" : "Finalize"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
