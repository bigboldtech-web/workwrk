"use client";

/* Real (read-mostly) Benefits page.
 *
 *  GET  /api/benefit-plans          list (org-admin only)
 *  POST /api/benefit-plans          { name, type, effectiveFrom, ... }
 *
 *  No PATCH endpoint exists yet — plans render as a read-only directory
 *  grouped by benefit type. Adding new plans needs admin role and a
 *  carrier + effective dates, so we surface the proper setup flow.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type BType = "MEDICAL" | "DENTAL" | "VISION" | "LIFE" | "DISABILITY_SHORT" | "DISABILITY_LONG" | "RETIREMENT_401K" | "RETIREMENT_ROTH" | "HSA" | "FSA" | "COMMUTER" | "OTHER";

type ApiPlan = {
  id: string;
  name: string;
  type: BType;
  carrier?: string | null;
  description?: string | null;
  employeeCost: number | string;
  employerCost: number | string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  active: boolean;
  _count?: { enrollments?: number; tiers?: number };
};

const TYPE_LABELS: Record<BType, string> = {
  MEDICAL: "Medical", DENTAL: "Dental", VISION: "Vision", LIFE: "Life",
  DISABILITY_SHORT: "Disability (short)", DISABILITY_LONG: "Disability (long)",
  RETIREMENT_401K: "401(k)", RETIREMENT_ROTH: "Roth 401(k)",
  HSA: "HSA", FSA: "FSA", COMMUTER: "Commuter", OTHER: "Other",
};
const TYPE_COLORS: Record<BType, string> = {
  MEDICAL: C.pink, DENTAL: C.blue, VISION: C.teal, LIFE: C.purple,
  DISABILITY_SHORT: C.orange, DISABILITY_LONG: C.brown,
  RETIREMENT_401K: C.green, RETIREMENT_ROTH: C.sage,
  HSA: C.indigo, FSA: C.yellow, COMMUTER: C.red, OTHER: C.gray,
};

const TYPE_ORDER: BType[] = ["MEDICAL", "DENTAL", "VISION", "LIFE", "DISABILITY_SHORT", "DISABILITY_LONG", "RETIREMENT_401K", "RETIREMENT_ROTH", "HSA", "FSA", "COMMUTER", "OTHER"];

function num(v: number | string) { return typeof v === "string" ? parseFloat(v) : v; }

function planToRow(p: ApiPlan): Row {
  return {
    id: p.id,
    name: p.name,
    done: !p.active,
    cells: {
      status: { value: (p.active ? "working" : "empty") as StatusValue, label: p.active ? "Active" : "Inactive" },
      carrier: p.carrier ?? "—",
      employeeCost: num(p.employeeCost),
      employerCost: num(p.employerCost),
      enrollments: `${p._count?.enrollments ?? 0}`,
      effective: p.effectiveFrom ? { iso: p.effectiveFrom } : undefined,
      expires: p.effectiveTo ? { iso: p.effectiveTo } : undefined,
    },
  };
}

function buildGroups(plans: ApiPlan[]): TableGroup[] {
  const buckets = new Map<BType, ApiPlan[]>();
  for (const t of TYPE_ORDER) buckets.set(t, []);
  for (const p of plans) {
    const b = buckets.get(p.type);
    if (b) b.push(p);
  }
  return TYPE_ORDER
    .map((t) => ({
      id: t, title: TYPE_LABELS[t], color: TYPE_COLORS[t],
      rows: (buckets.get(t) ?? []).map(planToRow),
    }))
    .filter((g) => g.rows.length > 0);
}

const COLUMNS: Column[] = [
  { id: "status",       label: "Active",        type: "status" },
  { id: "carrier",      label: "Carrier",       type: "text" },
  { id: "employeeCost", label: "Employee cost", type: "number", currency: "₹" },
  { id: "employerCost", label: "Employer cost", type: "number", currency: "₹" },
  { id: "enrollments",  label: "Enrollments",   type: "text" },
  { id: "effective",    label: "Effective",     type: "date" },
  { id: "expires",      label: "Expires",       type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function BenefitsPage() {
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/benefit-plans");
      if (res.status === 403) {
        setLoadError("Benefits admin requires admin role. View your own coverage at /my-benefits.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlans(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("benefits");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(plans ?? []), [plans]);

  const handlers = {
    onAdd: async (_g: string) => {
      toast("New benefit plans need a carrier, effective dates, and admin role — use the benefits setup flow");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (plans ?? [])
      .filter((p) => p.effectiveFrom)
      .map((p): CalendarEvent => ({
        id: p.id,
        title: `${p.name} starts`,
        date: p.effectiveFrom,
        color: TYPE_COLORS[p.type],
        done: !p.active,
        payload: planToRow(p).cells,
      })),
    [plans],
  );

  const activeCount = (plans ?? []).filter((p) => p.active).length;
  const enrollments = (plans ?? []).reduce((acc, p) => acc + (p._count?.enrollments ?? 0), 0);

  return (
    <>
      <OsTitleBar
        title="Benefits"
        Icon={Gift}
        iconGradient={GRAD.pinkPurple}
        description={plans === null ? "Loading plans…" : `${plans.length} plan${plans.length === 1 ? "" : "s"} · ${activeCount} active · ${enrollments} enrolled`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New plan" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Gift} iconGradient={GRAD.redPink} title="Couldn't load plans" subtitle={loadError} cta="My benefits" />
          ) : plans === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : plans.length === 0 ? (
            <OsEmptyView Icon={Gift} iconGradient={GRAD.pinkPurple} title="No benefit plans yet" subtitle="Set up your benefits catalog. Each plan has a type, carrier, costs, and an effective window." chips={["Medical", "Dental", "401(k)", "Life", "HSA"]} cta="New plan" />
          ) : (
            <OsMainTable moduleId="benefits" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="benefits" events={calendarEvents} newLabel="New plan" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Gift} iconGradient={GRAD.pinkPurple} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
