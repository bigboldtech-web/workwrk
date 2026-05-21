"use client";

// CRM → Pipeline board. Kanban by stage with optimistic move + an
// inline KPI strip. Wrapped in <BoardShell> for monday-style chrome.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BoardShell } from "@/components/layout/board-shell";
import {
  DealCard, KpiCard, NewOpportunityModal, formatMoney,
  type Stage, type Opportunity, type Account,
} from "@/components/crm/shared";

export default function CrmPipelinePage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o, a] = await Promise.all([
        fetch("/api/crm/pipeline-stages").then((r) => r.ok ? r.json() : { stages: [] }),
        fetch("/api/crm/opportunities").then((r) => r.ok ? r.json() : { opportunities: [] }),
        fetch("/api/crm/accounts").then((r) => r.ok ? r.json() : { accounts: [] }),
      ]);
      setStages(s.stages || []);
      setOpps(o.opportunities || []);
      setAccounts(a.accounts || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const oppsByStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const stage of stages) map.set(stage.id, []);
    for (const o of opps) {
      if (!o.pipelineStageId) continue;
      const arr = map.get(o.pipelineStageId) ?? [];
      arr.push(o);
      map.set(o.pipelineStageId, arr);
    }
    return map;
  }, [stages, opps]);

  const totalPipelineValue = useMemo(
    () => opps.filter((o) => !o.closedAt).reduce((sum, o) => sum + (o.amount ? parseFloat(o.amount) : 0), 0),
    [opps],
  );

  const weightedForecast = useMemo(() => {
    return opps
      .filter((o) => !o.closedAt)
      .reduce((sum, o) => {
        if (!o.amount) return sum;
        const stage = stages.find((s) => s.id === o.pipelineStageId);
        const prob = (stage?.probability ?? 50) / 100;
        return sum + parseFloat(o.amount) * prob;
      }, 0);
  }, [opps, stages]);

  async function moveOpp(oppId: string, newStageId: string) {
    setOpps((prev) =>
      prev.map((o) =>
        o.id === oppId
          ? {
              ...o,
              pipelineStageId: newStageId,
              pipelineStage: stages.find((s) => s.id === newStageId)
                ? { ...stages.find((s) => s.id === newStageId)! }
                : o.pipelineStage,
            }
          : o,
      ),
    );
    await fetch("/api/crm/opportunities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: oppId, pipelineStageId: newStageId }),
    });
  }

  return (
    <BoardShell
      productSlug="workwrk-crm"
      boardKey="pipeline"
      viewMode="kanban"
      primaryAction={{ label: "New deal", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">
          {opps.filter((o) => !o.closedAt).length} open
        </span>
      }
      kpis={
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Open deals" value={opps.filter((o) => !o.closedAt).length.toString()} />
          <KpiCard label="Pipeline value" value={formatMoney(totalPipelineValue.toString(), "USD")} />
          <KpiCard label="Weighted forecast" value={formatMoney(weightedForecast.toString(), "USD")} tone="emerald" />
          <KpiCard label="Won this quarter" value={opps.filter((o) => o.isWon === true).length.toString()} />
        </div>
      }
    >
      {loading ? (
        <div className="text-sm text-muted py-20 text-center">Loading pipeline…</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 480 }}>
          {stages.map((stage) => {
            const stageOpps = oppsByStage.get(stage.id) ?? [];
            const total = stageOpps.reduce((s, o) => s + (o.amount ? parseFloat(o.amount) : 0), 0);
            return (
              <div key={stage.id} className="flex-shrink-0 w-[280px] rounded-xl bg-surface-2 p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: stage.color ?? "#94a3b8" }}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold">{stage.name}</span>
                    <span className="text-xs text-muted-2">{stageOpps.length}</span>
                  </div>
                  <div className="text-xs text-muted-2">{formatMoney(total.toString(), "USD")}</div>
                </div>
                <div className="space-y-2">
                  {stageOpps.length === 0 ? (
                    <div className="text-xs text-muted-2 italic py-4 text-center border border-dashed border-border rounded-lg">
                      No deals yet
                    </div>
                  ) : (
                    stageOpps.map((opp) => (
                      <DealCard
                        key={opp.id}
                        opp={opp}
                        stages={stages}
                        onMove={(newStageId) => moveOpp(opp.id, newStageId)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <NewOpportunityModal
          accounts={accounts}
          stages={stages}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}
    </BoardShell>
  );
}
