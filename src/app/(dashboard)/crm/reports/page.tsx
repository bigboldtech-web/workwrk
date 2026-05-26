"use client";

/* Real CRM Reports page.
 *
 *  Composite read from three sources, aggregated client-side:
 *    GET /api/crm/leads
 *    GET /api/crm/accounts
 *    GET /api/crm/opportunities
 *    GET /api/crm/pipeline-stages
 *
 *  Each row is a single metric; groups bucket metrics by report area
 *  (Pipeline · Conversion · Customers · Activity).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LineChart, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiLead = { id: string; status: string; createdAt: string };
type ApiAccount = { id: string; type: string; createdAt: string };
type ApiOpportunity = { id: string; amount?: number | string | null; pipelineStageId?: string | null; isWon?: boolean | null; closedAt?: string | null; createdAt: string; pipelineStage?: { name: string; isWon: boolean; isLost: boolean } | null };
type ApiStage = { id: string; name: string; position: number; isWon: boolean; isLost: boolean; probability: number };

function num(v?: number | string | null): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}

function fmt(n: number): string { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function pct(n: number, total: number): string { return total === 0 ? "—" : `${Math.round((n / total) * 100)}%`; }

function buildGroups(leads: ApiLead[], accounts: ApiAccount[], opps: ApiOpportunity[], stages: ApiStage[]): TableGroup[] {
  const openDeals = opps.filter((o) => !o.closedAt);
  const wonDeals = opps.filter((o) => o.isWon === true);
  const lostDeals = opps.filter((o) => o.isWon === false);
  const pipelineValue = openDeals.reduce((acc, o) => acc + num(o.amount), 0);
  const wonValue = wonDeals.reduce((acc, o) => acc + num(o.amount), 0);
  const avgWin = wonDeals.length > 0 ? wonValue / wonDeals.length : 0;
  const totalClosed = wonDeals.length + lostDeals.length;
  const winRate = totalClosed === 0 ? 0 : (wonDeals.length / totalClosed) * 100;

  const stageRows: Row[] = stages
    .filter((s) => !s.isWon && !s.isLost)
    .map((s) => {
      const inStage = opps.filter((o) => o.pipelineStageId === s.id);
      const value = inStage.reduce((acc, o) => acc + num(o.amount), 0);
      return {
        id: `stage-${s.id}`,
        name: s.name,
        cells: {
          metric: `${inStage.length} deal${inStage.length === 1 ? "" : "s"}`,
          value: `${fmt(value)}`,
          weighted: `${fmt(value * (s.probability / 100))}`,
          area: "Stage",
        },
      };
    });

  const pipelineRows: Row[] = [
    { id: "open",      name: "Open deals",             cells: { metric: `${openDeals.length}`,  value: fmt(pipelineValue), weighted: "—", area: "Live pipeline" } },
    { id: "avgWin",    name: "Avg won deal",           cells: { metric: `${wonDeals.length} won`, value: fmt(avgWin),       weighted: "—", area: "Performance" } },
    { id: "winRate",   name: "Win rate (closed-deals)", cells: { metric: `${wonDeals.length}/${totalClosed}`, value: `${winRate.toFixed(0)}%`, weighted: "—", area: "Performance" } },
    ...stageRows,
  ];

  const newLeads = leads.filter((l) => l.status === "NEW").length;
  const qualifiedLeads = leads.filter((l) => l.status === "QUALIFIED").length;
  const convertedLeads = leads.filter((l) => l.status === "CONVERTED").length;
  const conversionRows: Row[] = [
    { id: "newLeads",  name: "New leads",       cells: { metric: `${newLeads}`,       value: pct(newLeads, leads.length),       weighted: "—", area: "Leads" } },
    { id: "qualif",    name: "Qualified leads", cells: { metric: `${qualifiedLeads}`, value: pct(qualifiedLeads, leads.length), weighted: "—", area: "Leads" } },
    { id: "converted", name: "Converted leads", cells: { metric: `${convertedLeads}`, value: pct(convertedLeads, leads.length), weighted: "—", area: "Leads" } },
    { id: "totalLeads",name: "Total leads",     cells: { metric: `${leads.length}`,   value: "—",                                weighted: "—", area: "Leads" } },
  ];

  const customers = accounts.filter((a) => a.type === "CUSTOMER").length;
  const prospects = accounts.filter((a) => a.type === "PROSPECT").length;
  const partners = accounts.filter((a) => a.type === "PARTNER").length;
  const churned = accounts.filter((a) => a.type === "CHURNED").length;
  const customerRows: Row[] = [
    { id: "customers", name: "Customers",  cells: { metric: `${customers}`, value: pct(customers, accounts.length), weighted: "—", area: "Accounts" } },
    { id: "prospects", name: "Prospects",  cells: { metric: `${prospects}`, value: pct(prospects, accounts.length), weighted: "—", area: "Accounts" } },
    { id: "partners",  name: "Partners",   cells: { metric: `${partners}`,  value: pct(partners, accounts.length),  weighted: "—", area: "Accounts" } },
    { id: "churned",   name: "Churned",    cells: { metric: `${churned}`,   value: pct(churned, accounts.length),   weighted: "—", area: "Accounts" } },
  ];

  return [
    { id: "pipeline",   title: "Pipeline",   color: C.green,  rows: pipelineRows },
    { id: "conversion", title: "Conversion", color: C.orange, rows: conversionRows },
    { id: "customers",  title: "Customers",  color: C.indigo, rows: customerRows },
  ];
}

const COLUMNS: Column[] = [
  { id: "metric",   label: "Count",    type: "text" },
  { id: "value",    label: "Value / %", type: "text" },
  { id: "weighted", label: "Weighted",  type: "text" },
  { id: "area",     label: "Area",      type: "text" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function CrmReportsPage() {
  const [leads, setLeads] = useState<ApiLead[] | null>(null);
  const [accounts, setAccounts] = useState<ApiAccount[] | null>(null);
  const [opps, setOpps] = useState<ApiOpportunity[] | null>(null);
  const [stages, setStages] = useState<ApiStage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const [lRes, aRes, oRes, sRes] = await Promise.all([
        fetch("/api/crm/leads"),
        fetch("/api/crm/accounts"),
        fetch("/api/crm/opportunities"),
        fetch("/api/crm/pipeline-stages"),
      ]);
      if (!lRes.ok) throw new Error(`leads ${lRes.status}`);
      if (!aRes.ok) throw new Error(`accounts ${aRes.status}`);
      if (!oRes.ok) throw new Error(`opps ${oRes.status}`);
      if (!sRes.ok) throw new Error(`stages ${sRes.status}`);
      const lJ = await lRes.json();
      const aJ = await aRes.json();
      const oJ = await oRes.json();
      const sJ = await sRes.json();
      setLeads(lJ.leads ?? lJ.data ?? []);
      setAccounts(aJ.accounts ?? aJ.data ?? []);
      setOpps(oJ.opportunities ?? oJ.data ?? []);
      setStages(sJ.stages ?? sJ.data ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("crm/reports");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(
    () => buildGroups(leads ?? [], accounts ?? [], opps ?? [], stages ?? []),
    [leads, accounts, opps, stages],
  );

  const handlers = {
    onAdd: async (_g: string) => {
      toast("Reports are computed from your live data — no rows to add here");
      throw new Error("not supported");
    },
  };

  const ready = leads !== null && accounts !== null && opps !== null && stages !== null;
  const openCount = (opps ?? []).filter((o) => !o.closedAt).length;
  const pipelineValue = (opps ?? []).filter((o) => !o.closedAt).reduce((acc, o) => acc + num(o.amount), 0);

  return (
    <>
      <OsTitleBar
        title="CRM · Reports"
        Icon={LineChart}
        iconGradient={GRAD.greenTeal}
        description={!ready ? "Computing reports…" : `${(leads ?? []).length} lead${(leads ?? []).length === 1 ? "" : "s"} · ${openCount} open deal${openCount === 1 ? "" : "s"} · pipeline ${pipelineValue.toLocaleString()}`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={4}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={LineChart} iconGradient={GRAD.redPink} title="Couldn't compute reports" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : !ready ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : (
            <OsMainTable moduleId="crm/reports" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="crm/reports" events={[] as CalendarEvent[]} newLabel="" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={LineChart} iconGradient={GRAD.greenTeal} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
