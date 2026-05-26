"use client";

/* Real Tools page (org tool catalog + shared credentials).
 *
 *  GET  /api/tools                  list visible tools (admins: all; employees: shared)
 *  POST /api/tools                  { name, url, category?, credentials?, ... } — admin
 *  PATCH /api/tools/[id]            updates
 *
 *  Groups by category (e.g. Productivity, Design, Engineering).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wrench, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiTool = {
  id: string;
  name: string;
  description?: string | null;
  url: string;
  icon?: string | null;
  category?: string | null;
  shares?: Array<{ userId: string; sharedAt: string }>;
  sharedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  Productivity: C.blue, Design: C.pink, Engineering: C.purple,
  Marketing: C.orange, Finance: C.green, HR: C.teal, Sales: C.indigo,
  Support: C.red, Communication: C.brown, Uncategorized: C.gray, default: C.indigo,
};

function toolToRow(t: ApiTool): Row {
  const sharedCount = t.shares?.length ?? 0;
  return {
    id: t.id,
    name: t.name,
    cells: {
      url: t.url ? (t.url.length > 40 ? t.url.slice(0, 40) + "…" : t.url) : "—",
      description: t.description ? (t.description.length > 60 ? t.description.slice(0, 60) + "…" : t.description) : "—",
      shared: t.sharedAt ? "✓ Shared with you" : `${sharedCount} member${sharedCount === 1 ? "" : "s"}`,
      added: t.createdAt ? { iso: t.createdAt } : (t.sharedAt ? { iso: t.sharedAt } : undefined),
    },
  };
}

function buildGroups(rows: ApiTool[]): TableGroup[] {
  const byCat = new Map<string, ApiTool[]>();
  for (const t of rows) {
    const key = t.category ?? "Uncategorized";
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(t);
  }
  return Array.from(byCat.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, items]) => ({
      id: cat, title: cat,
      color: CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default,
      rows: items.map(toolToRow),
    }));
}

const COLUMNS: Column[] = [
  { id: "url",         label: "URL",         type: "text" },
  { id: "description", label: "Description", type: "text" },
  { id: "shared",      label: "Sharing",     type: "text" },
  { id: "added",       label: "Added",       type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function ToolsPage() {
  const [rows, setRows] = useState<ApiTool[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tools");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("tools");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (groupId: string) => {
      const category = groupId && groupId !== "Uncategorized" ? groupId : null;
      const res = await fetch("/api/tools", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled tool", url: "https://", category }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only admins can add tools to the catalog");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const t: ApiTool = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: t.id, name: t.name };
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      const res = await fetch(`/api/tools/${rowId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only admins can rename tools");
        throw new Error(`PATCH ${res.status}`);
      }
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? [])
      .filter((t) => t.createdAt || t.sharedAt)
      .map((t): CalendarEvent => ({
        id: t.id,
        title: `${t.name} added`,
        date: (t.createdAt ?? t.sharedAt) as string,
        color: CATEGORY_COLORS[t.category ?? "Uncategorized"] ?? CATEGORY_COLORS.default,
        payload: toolToRow(t).cells,
      })),
    [rows],
  );

  return (
    <>
      <OsTitleBar
        title="Tools"
        Icon={Wrench}
        iconGradient={GRAD.brownOrange}
        description={rows === null ? "Loading tools…" : `${rows.length} tool${rows.length === 1 ? "" : "s"} in catalog · shared credentials supported`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="Add tool" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Wrench} iconGradient={GRAD.redPink} title="Couldn't load tools" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Wrench} iconGradient={GRAD.brownOrange} title="No tools yet" subtitle="Build the team's tool catalog. Add Figma, Notion, GitHub — share credentials with specific people, audit access." chips={["Productivity", "Design", "Engineering", "Marketing"]} cta="Add tool" />
          ) : (
            <OsMainTable moduleId="tools" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="tools" events={calendarEvents} newLabel="Add tool" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Wrench} iconGradient={GRAD.brownOrange} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
