"use client";

/* Real Whiteboards page.
 *
 *  GET  /api/whiteboards               list this org's boards
 *  POST /api/whiteboards               { name, description?, productSlug? }
 *
 *  Each board is a tldraw-style scene living at /whiteboards/[id].
 *  We group by product slug (where it was opened from) and by "mine"
 *  vs "shared" using the owner column.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Frame, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiWhiteboard = {
  id: string;
  name: string;
  description?: string | null;
  thumbnail?: string | null;
  ownerId: string;
  productSlug?: string | null;
  lastEditedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

const SLUG_LABELS: Record<string, string> = {
  crm: "CRM", tasks: "Tasks", itsm: "ITSM", helpdesk: "Helpdesk",
  recruiting: "Recruiting", marketing: "Marketing", procurement: "Procurement",
  expenses: "Expenses", finance: "Finance", general: "General",
};
const SLUG_COLORS: Record<string, string> = {
  crm: C.green, tasks: C.blue, itsm: C.orange, helpdesk: C.red,
  recruiting: C.purple, marketing: C.pink, procurement: C.brown,
  expenses: C.indigo, finance: C.teal, general: C.gray, default: C.indigo,
};

function wbToRow(w: ApiWhiteboard): Row {
  return {
    id: w.id,
    name: w.name,
    cells: {
      surface: w.productSlug ? (SLUG_LABELS[w.productSlug] ?? w.productSlug) : "General",
      description: w.description ? (w.description.length > 60 ? w.description.slice(0, 60) + "…" : w.description) : "—",
      lastEdited: w.lastEditedAt ? { iso: w.lastEditedAt } : undefined,
      created: { iso: w.createdAt },
    },
  };
}

function buildGroups(rows: ApiWhiteboard[]): TableGroup[] {
  const bySlug = new Map<string, ApiWhiteboard[]>();
  for (const w of rows) {
    const key = w.productSlug ?? "general";
    if (!bySlug.has(key)) bySlug.set(key, []);
    bySlug.get(key)!.push(w);
  }
  return Array.from(bySlug.entries())
    .sort(([a], [b]) => (SLUG_LABELS[a] ?? a).localeCompare(SLUG_LABELS[b] ?? b))
    .map(([slug, items]) => ({
      id: slug,
      title: SLUG_LABELS[slug] ?? slug,
      color: SLUG_COLORS[slug] ?? SLUG_COLORS.default,
      rows: items.map(wbToRow),
    }));
}

const COLUMNS: Column[] = [
  { id: "surface",     label: "Surface",     type: "text" },
  { id: "description", label: "Description", type: "text" },
  { id: "lastEdited",  label: "Last edited", type: "date" },
  { id: "created",     label: "Created",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function WhiteboardsPage() {
  const [rows, setRows] = useState<ApiWhiteboard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whiteboards");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.whiteboards ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("whiteboards");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (groupId: string) => {
      const productSlug = groupId && groupId !== "general" ? groupId : undefined;
      const res = await fetch("/api/whiteboards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled whiteboard", productSlug }),
      });
      if (!res.ok) {
        toast(`Couldn't create whiteboard (HTTP ${res.status})`);
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const w: ApiWhiteboard = data.whiteboard ?? data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: w.id, name: w.name };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((w): CalendarEvent => ({
      id: w.id,
      title: w.name,
      date: w.lastEditedAt ?? w.updatedAt,
      color: SLUG_COLORS[w.productSlug ?? "general"] ?? SLUG_COLORS.default,
      payload: wbToRow(w).cells,
    })),
    [rows],
  );

  return (
    <>
      <OsTitleBar
        title="Whiteboards"
        Icon={Frame}
        iconGradient={GRAD.tealGreen}
        description={rows === null ? "Loading whiteboards…" : `${rows.length} board${rows.length === 1 ? "" : "s"} · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.sc]}
        morePeople={6}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New whiteboard" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Frame} iconGradient={GRAD.redPink} title="Couldn't load whiteboards" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Frame} iconGradient={GRAD.tealGreen} title="No whiteboards yet" subtitle="Sketch flows, map architectures, brainstorm anything. Whiteboards live alongside the board they were opened from." chips={["Sketch", "Map", "Brainstorm", "Live cursors"]} cta="New whiteboard" />
          ) : (
            <OsMainTable moduleId="whiteboards" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="whiteboards" events={calendarEvents} newLabel="New whiteboard" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Frame} iconGradient={GRAD.tealGreen} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
