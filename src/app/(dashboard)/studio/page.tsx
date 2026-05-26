"use client";

/* Real Studio page (user-built boards).
 *
 *  GET  /api/studio/boards         list all boards in this org
 *  POST /api/studio/boards         { name, layout, fields, ... } — admin
 *
 *  Studio is the no-code board builder. Each board has a layout (TABLE | KANBAN),
 *  custom fields, and an item count. We group by product surface (workspace).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Layout = "TABLE" | "KANBAN";

type ApiBoard = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  layout: Layout;
  productSlug?: string | null;
  workspaceId?: string | null;
  color?: string | null;
  updatedAt: string;
  _count?: { items?: number };
};

const SLUG_LABELS: Record<string, string> = {
  crm: "CRM", tasks: "Tasks", itsm: "ITSM", helpdesk: "Helpdesk",
  recruiting: "Recruiting", marketing: "Marketing", procurement: "Procurement",
  expenses: "Expenses", finance: "Finance",
};
const SLUG_COLORS: Record<string, string> = {
  crm: C.green, tasks: C.blue, itsm: C.orange, helpdesk: C.red,
  recruiting: C.purple, marketing: C.pink, procurement: C.brown,
  expenses: C.indigo, finance: C.teal, standalone: C.gray, default: C.indigo,
};

function boardToRow(b: ApiBoard): Row {
  return {
    id: b.id,
    name: b.name,
    cells: {
      slug: `/studio/boards/${b.slug}`,
      layout: b.layout === "KANBAN" ? "Kanban" : "Table",
      items: `${b._count?.items ?? 0}`,
      description: b.description ? (b.description.length > 60 ? b.description.slice(0, 60) + "…" : b.description) : "—",
      updated: { iso: b.updatedAt },
    },
  };
}

function buildGroups(rows: ApiBoard[]): TableGroup[] {
  const bySlug = new Map<string, ApiBoard[]>();
  for (const b of rows) {
    const key = b.productSlug ?? "standalone";
    if (!bySlug.has(key)) bySlug.set(key, []);
    bySlug.get(key)!.push(b);
  }
  return Array.from(bySlug.entries())
    .sort(([a], [b]) => (SLUG_LABELS[a] ?? a).localeCompare(SLUG_LABELS[b] ?? b))
    .map(([slug, items]) => ({
      id: slug, title: SLUG_LABELS[slug] ?? (slug === "standalone" ? "Standalone" : slug),
      color: SLUG_COLORS[slug] ?? SLUG_COLORS.default,
      rows: items.map(boardToRow),
    }));
}

const COLUMNS: Column[] = [
  { id: "slug",        label: "Route",       type: "text" },
  { id: "layout",      label: "Layout",      type: "text" },
  { id: "items",       label: "Items",       type: "text" },
  { id: "description", label: "Description", type: "text" },
  { id: "updated",     label: "Updated",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function StudioPage() {
  const [rows, setRows] = useState<ApiBoard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/studio/boards");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.boards ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("studio");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (groupId: string) => {
      const productSlug = groupId && groupId !== "standalone" ? groupId : undefined;
      const res = await fetch("/api/studio/boards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled board",
          layout: "TABLE",
          productSlug,
          fields: [{ key: "name", label: "Name", type: "TEXT" }],
        }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Manager-level access required to create studio boards");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const b: ApiBoard = data.board ?? data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: b.id, name: b.name };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((b): CalendarEvent => ({
      id: b.id,
      title: `${b.name} · ${b._count?.items ?? 0} items`,
      date: b.updatedAt,
      color: SLUG_COLORS[b.productSlug ?? "standalone"] ?? SLUG_COLORS.default,
      payload: boardToRow(b).cells,
    })),
    [rows],
  );

  const totalItems = (rows ?? []).reduce((acc, b) => acc + (b._count?.items ?? 0), 0);

  return (
    <>
      <OsTitleBar
        title="Studio"
        Icon={LayoutGrid}
        iconGradient={GRAD.tealGreen}
        description={rows === null ? "Loading boards…" : `${rows.length} board${rows.length === 1 ? "" : "s"} · ${totalItems} item${totalItems === 1 ? "" : "s"} · no-code`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.sc]}
        morePeople={4}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New board" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={LayoutGrid} iconGradient={GRAD.redPink} title="Couldn't load boards" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={LayoutGrid} iconGradient={GRAD.tealGreen} title="No studio boards yet" subtitle="Spin up custom boards with the columns you actually need — pick TABLE or KANBAN, drop in fields, share the route." chips={["Table", "Kanban", "Status", "Files", "Timeline"]} cta="New board" />
          ) : (
            <OsMainTable moduleId="studio" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="studio" events={calendarEvents} newLabel="New board" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={LayoutGrid} iconGradient={GRAD.tealGreen} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
