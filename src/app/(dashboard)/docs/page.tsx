"use client";

/* Real Docs page.
 *
 *  GET  /api/docs               list
 *  POST /api/docs               { title, content?, entityType?, entityId? }
 *  PUT  /api/docs/[id]          { title?, content? }  (versions automatically)
 *
 *  Docs have no status enum. We bucket by attachment: standalone docs vs
 *  docs attached to a board row, and "Recent (last 7d)" surfaced first.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiDoc = {
  id: string;
  title: string;
  excerpt?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
};

const MS_DAY = 86400_000;

function docToRow(d: ApiDoc): Row {
  return {
    id: d.id,
    name: d.title,
    cells: {
      attached: d.entityType ? `${d.entityType.toLowerCase()}` : "standalone",
      excerpt: d.excerpt ? d.excerpt.slice(0, 80) + (d.excerpt.length > 80 ? "…" : "") : "—",
      created: { iso: d.createdAt },
      updated: { iso: d.updatedAt },
    },
  };
}

function buildGroups(rows: ApiDoc[]): TableGroup[] {
  const recentCutoff = Date.now() - 7 * MS_DAY;
  const recent: ApiDoc[] = [];
  const attached: ApiDoc[] = [];
  const standalone: ApiDoc[] = [];
  for (const d of rows) {
    if (new Date(d.updatedAt).getTime() >= recentCutoff) recent.push(d);
    else if (d.entityType) attached.push(d);
    else standalone.push(d);
  }
  return [
    { id: "recent",     title: "Recent (last 7 days)", color: C.orange, rows: recent.map(docToRow) },
    { id: "attached",   title: "Attached to items",   color: C.purple,  rows: attached.map(docToRow) },
    { id: "standalone", title: "Standalone notes",     color: C.teal,    rows: standalone.map(docToRow) },
  ].filter((g) => g.rows.length > 0 || g.id === "standalone");
}

const COLUMNS: Column[] = [
  { id: "attached", label: "Attached to", type: "text" },
  { id: "excerpt",  label: "Excerpt",     type: "text" },
  { id: "created",  label: "Created",     type: "date" },
  { id: "updated",  label: "Updated",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function DocsPage() {
  const [rows, setRows] = useState<ApiDoc[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/docs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.docs ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("docs");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onRename: async (rowId: string, _g: string, name: string) => {
      const res = await fetch(`/api/docs/${rowId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: name }),
      });
      if (!res.ok) {
        if (res.status === 410) toast("Doc is archived");
        throw new Error(`PUT ${res.status}`);
      }
    },
    onAdd: async (_g: string) => {
      const res = await fetch("/api/docs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled doc" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const d: ApiDoc = data.doc ?? data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: d.id, name: d.title };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((d): CalendarEvent => ({
      id: d.id,
      title: d.title,
      date: d.updatedAt,
      color: d.entityType ? C.purple : C.teal,
      payload: docToRow(d).cells,
    })),
    [rows],
  );

  return (
    <>
      <OsTitleBar
        title="Docs & notes"
        Icon={FileText}
        iconGradient={GRAD.tealGreen}
        description={rows === null ? "Loading docs…" : `${rows.length} doc${rows.length === 1 ? "" : "s"} · live-synced`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]}
        morePeople={9}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New doc" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={FileText} iconGradient={GRAD.redPink} title="Couldn't load docs" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={FileText} iconGradient={GRAD.tealGreen} title="No docs yet" subtitle="Write standalone notes or attach docs to any board row. Every save creates an automatic version." chips={["Standalone", "Attached", "Versioned"]} cta="New doc" />
          ) : (
            <OsMainTable moduleId="docs" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="docs" events={calendarEvents} newLabel="New doc" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={FileText} iconGradient={GRAD.tealGreen} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
