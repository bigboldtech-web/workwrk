"use client";

/* Real CRM Pipeline page (opportunities by stage).
 *
 *  GET   /api/crm/pipeline-stages   list stages (lazily seeds default 6-stage flow)
 *  GET   /api/crm/opportunities     list deals
 *  POST  /api/crm/opportunities     { name, accountId?, amount?, pipelineStageId? }
 *  PATCH /api/crm/opportunities     { id, pipelineStageId? | amount? | name? }
 *
 *  Stage rename here is destructive (re-staging the deal). We use stage as
 *  the status column and group rows under each stage in order.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Workflow, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type ApiStage = {
  id: string;
  name: string;
  position: number;
  probability: number;
  color?: string | null;
  isWon: boolean;
  isLost: boolean;
};

type ApiOpportunity = {
  id: string;
  name: string;
  amount?: number | string | null;
  currency?: string | null;
  pipelineStageId?: string | null;
  expectedCloseDate?: string | null;
  closedAt?: string | null;
  isWon?: boolean | null;
  account?: { id: string; name: string } | null;
  pipelineStage?: { id: string; name: string; color?: string | null; isWon: boolean; isLost: boolean } | null;
  createdAt: string;
  updatedAt: string;
};

function num(v?: number | string | null): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}

function stageStatusValue(s: ApiStage): StatusValue {
  if (s.isWon) return "done";
  if (s.isLost) return "stuck";
  if (s.probability >= 75) return "review";
  if (s.probability >= 50) return "working";
  if (s.probability >= 25) return "progress";
  return "planning";
}

function oppToRow(o: ApiOpportunity, stage: ApiStage | undefined): Row {
  return {
    id: o.id,
    name: o.name,
    done: !!o.pipelineStage?.isWon,
    cells: {
      stage: stage
        ? { value: stageStatusValue(stage), label: stage.name }
        : (o.pipelineStage ? { value: "planning" as StatusValue, label: o.pipelineStage.name } : undefined),
      account: o.account?.name ?? "—",
      amount: num(o.amount),
      currency: o.currency ?? "USD",
      probability: stage ? { pct: stage.probability, color: stage.probability >= 75 ? "green" : stage.probability >= 50 ? "blue" : stage.probability >= 25 ? "warning" : "danger" } : undefined,
      close: o.expectedCloseDate ? { iso: o.expectedCloseDate } : undefined,
      updated: { iso: o.updatedAt },
    },
  };
}

function buildGroups(stages: ApiStage[], opps: ApiOpportunity[]): TableGroup[] {
  const byStage = new Map<string, ApiOpportunity[]>();
  for (const s of stages) byStage.set(s.id, []);
  for (const o of opps) {
    const sid = o.pipelineStageId ?? "";
    if (!byStage.has(sid)) byStage.set(sid, []);
    byStage.get(sid)!.push(o);
  }
  return stages.map((s) => ({
    id: s.id,
    title: s.name,
    color: s.color ?? (s.isWon ? C.green : s.isLost ? C.red : C.indigo),
    rows: (byStage.get(s.id) ?? []).map((o) => oppToRow(o, s)),
  }));
}

const COLUMNS: Column[] = [
  { id: "stage",       label: "Stage",        type: "status" },
  { id: "account",     label: "Account",      type: "text" },
  { id: "amount",      label: "Amount",       type: "number" },
  { id: "currency",    label: "Currency",     type: "text" },
  { id: "probability", label: "Probability",  type: "progress" },
  { id: "close",       label: "Expected close", type: "date" },
  { id: "updated",     label: "Updated",      type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function CrmPipelinePage() {
  const [stages, setStages] = useState<ApiStage[] | null>(null);
  const [opps, setOpps] = useState<ApiOpportunity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const [sRes, oRes] = await Promise.all([
        fetch("/api/crm/pipeline-stages"),
        fetch("/api/crm/opportunities"),
      ]);
      if (!sRes.ok) throw new Error(`stages ${sRes.status}`);
      if (!oRes.ok) throw new Error(`opps ${oRes.status}`);
      const sJ = await sRes.json();
      const oJ = await oRes.json();
      setStages(sJ.stages ?? sJ.data ?? []);
      setOpps(oJ.opportunities ?? oJ.data ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("crm/pipeline");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const statusOptions = useMemo<PickerOption[]>(
    () => (stages ?? []).map((s) => ({
      value: s.id, label: s.name,
      color: s.color ?? (s.isWon ? C.green : s.isLost ? C.red : C.indigo),
    })),
    [stages],
  );

  const groups = useMemo(() => buildGroups(stages ?? [], opps ?? []), [stages, opps]);

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const res = await fetch("/api/crm/opportunities", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, pipelineStageId: value }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      void load();
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      const res = await fetch("/api/crm/opportunities", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, name }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    },
    onAdd: async (groupId: string) => {
      const res = await fetch("/api/crm/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled deal", pipelineStageId: groupId }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const o: ApiOpportunity = data.opportunity ?? data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: o.id, name: o.name };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (opps ?? [])
      .filter((o) => o.expectedCloseDate)
      .map((o): CalendarEvent => {
        const stage = stages?.find((s) => s.id === o.pipelineStageId);
        return {
          id: o.id,
          title: `${o.name}${o.amount ? ` · ${num(o.amount).toLocaleString()}` : ""}`,
          date: o.expectedCloseDate as string,
          color: stage?.color ?? (stage?.isWon ? C.green : stage?.isLost ? C.red : C.indigo),
          done: !!o.pipelineStage?.isWon,
          payload: oppToRow(o, stage).cells,
        };
      }),
    [opps, stages],
  );

  const openOpps = (opps ?? []).filter((o) => !o.closedAt);
  const pipelineValue = openOpps.reduce((acc, o) => acc + num(o.amount), 0);
  const wonOpps = (opps ?? []).filter((o) => o.isWon === true);
  const wonValue = wonOpps.reduce((acc, o) => acc + num(o.amount), 0);

  return (
    <>
      <OsTitleBar
        title="CRM · Pipeline"
        Icon={Workflow}
        iconGradient={GRAD.greenTeal}
        description={opps === null ? "Loading pipeline…" : `${openOpps.length} open deal${openOpps.length === 1 ? "" : "s"} · pipeline ${pipelineValue.toLocaleString()} · won ${wonValue.toLocaleString()}`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={4}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New deal" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Workflow} iconGradient={GRAD.redPink} title="Couldn't load pipeline" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : opps === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : (opps.length === 0 && (stages?.length ?? 0) > 0) ? (
            <OsEmptyView Icon={Workflow} iconGradient={GRAD.greenTeal} title="Pipeline is empty" subtitle={`${stages?.length ?? 0} stages ready — drop your first deal in and start moving it through.`} chips={(stages ?? []).slice(0, 4).map((s) => s.name)} cta="New deal" />
          ) : (
            <OsMainTable moduleId="crm/pipeline" columns={COLUMNS} groups={groups} statusOptions={statusOptions} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="crm/pipeline" events={calendarEvents} newLabel="New deal" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Workflow} iconGradient={GRAD.greenTeal} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
