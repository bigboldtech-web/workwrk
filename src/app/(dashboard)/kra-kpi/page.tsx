"use client";

/* Real KRA + KPI page.
 *
 *  GET   /api/kras                  list (paginated)
 *  POST  /api/kras                  { name, description?, category?, roleId? }
 *  PATCH /api/kras                  { id, name?, ... }
 *
 *  Each KRA holds child KPIs (no separate row — KPIs roll up in the count
 *  + a comma-list cell). Groups are by category.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Target, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiKpi = {
  id: string;
  name: string;
  unit?: string | null;
  type?: string | null;
  frequency?: string | null;
  targetValue?: number | string | null;
  lowerIsBetter?: boolean;
};

type ApiKra = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  roleId?: string | null;
  role?: { id: string; title: string } | null;
  kpis?: ApiKpi[];
  _count?: { assignments?: number };
  createdAt?: string;
  updatedAt?: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  "Sales": C.green, "Engineering": C.blue, "Operations": C.orange,
  "Marketing": C.pink, "HR": C.purple, "Finance": C.teal,
  "Customer Success": C.indigo, "Product": C.brown,
  Uncategorized: C.gray, default: C.indigo,
};

function kraToRow(k: ApiKra): Row {
  const kpiNames = (k.kpis ?? []).slice(0, 3).map((p) => p.name).join(", ");
  const more = (k.kpis?.length ?? 0) > 3 ? ` +${(k.kpis?.length ?? 0) - 3}` : "";
  return {
    id: k.id,
    name: k.name,
    cells: {
      role: k.role?.title ?? "—",
      kpiCount: `${k.kpis?.length ?? 0}`,
      kpis: kpiNames ? kpiNames + more : "—",
      assigned: `${k._count?.assignments ?? 0}`,
      updated: k.updatedAt ? { iso: k.updatedAt } : undefined,
    },
  };
}

function buildGroups(rows: ApiKra[]): TableGroup[] {
  const byCategory = new Map<string, ApiKra[]>();
  for (const k of rows) {
    const key = k.category ?? "Uncategorized";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(k);
  }
  return Array.from(byCategory.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, items]) => ({
      id: cat, title: cat,
      color: CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default,
      rows: items.map(kraToRow),
    }));
}

const COLUMNS: Column[] = [
  { id: "role",     label: "Role",      type: "text" },
  { id: "kpiCount", label: "KPIs",      type: "text" },
  { id: "kpis",     label: "Metrics",   type: "text" },
  { id: "assigned", label: "Assigned",  type: "text" },
  { id: "updated",  label: "Updated",   type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function KraKpiPage() {
  const [rows, setRows] = useState<ApiKra[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/kras?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiKra[] = data?.data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
      setRows(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("kra-kpi");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/kras", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("You don't have permission to edit KRAs");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  const handlers = {
    onRename: async (rowId: string, _g: string, name: string) => {
      const ok = await patch(rowId, { name });
      if (!ok) throw new Error("save failed");
    },
    onAdd: async (groupId: string) => {
      const category = groupId && groupId !== "Uncategorized" ? groupId : null;
      const res = await fetch("/api/kras", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled KRA", category }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can create KRAs");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const k: ApiKra = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: k.id, name: k.name };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? [])
      .filter((k) => k.updatedAt)
      .map((k): CalendarEvent => ({
        id: k.id,
        title: `${k.name} · ${k.kpis?.length ?? 0} KPI${(k.kpis?.length ?? 0) === 1 ? "" : "s"}`,
        date: k.updatedAt as string,
        color: CATEGORY_COLORS[k.category ?? "Uncategorized"] ?? CATEGORY_COLORS.default,
        payload: kraToRow(k).cells,
      })),
    [rows],
  );

  const totalKpis = (rows ?? []).reduce((acc, k) => acc + (k.kpis?.length ?? 0), 0);
  const totalAssigned = (rows ?? []).reduce((acc, k) => acc + (k._count?.assignments ?? 0), 0);

  return (
    <>
      <OsTitleBar
        title="KRA & KPI"
        Icon={Target}
        iconGradient={GRAD.bluePurple}
        description={rows === null ? "Loading KRAs…" : `${rows.length} KRA${rows.length === 1 ? "" : "s"} · ${totalKpis} KPI${totalKpis === 1 ? "" : "s"} · ${totalAssigned} assigned`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={5}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New KRA" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Target} iconGradient={GRAD.redPink} title="Couldn't load KRAs" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Target} iconGradient={GRAD.bluePurple} title="No KRAs yet" subtitle="Define what success looks like for each role, then break it down into measurable KPIs." chips={["Sales", "Engineering", "Operations", "Product"]} cta="New KRA" />
          ) : (
            <OsMainTable moduleId="kra-kpi" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="kra-kpi" events={calendarEvents} newLabel="New KRA" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Target} iconGradient={GRAD.bluePurple} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
