"use client";

/* Real Build page (AI-generated custom apps).
 *
 *  GET  /api/build/apps            list this org's apps (excluding archived)
 *  POST /api/build/apps            { name, slug, fields, ... } — persists a generated app
 *  POST /api/build/generate        AI generation pipeline (not used directly here)
 *
 *  App status enum: DRAFT | PUBLISHED | ARCHIVED (we hide archived).
 *  Each app lives at /build/[slug] and gets its own catalog entry.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Hammer, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type AppStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

type ApiApp = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  iconKey?: string | null;
  hue?: string | null;
  status: AppStatus;
  createdAt: string;
  updatedAt: string;
};

const STATUS_TO_OS: Record<AppStatus, StatusValue> = {
  DRAFT: "planning", PUBLISHED: "done", ARCHIVED: "empty",
};
const STATUS_LABELS: Record<AppStatus, string> = {
  DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived",
};
const STATUS_COLORS: Record<AppStatus, string> = {
  DRAFT: C.indigo, PUBLISHED: C.green, ARCHIVED: C.gray,
};
const GROUP_ORDER: AppStatus[] = ["DRAFT", "PUBLISHED"];

function appToRow(a: ApiApp): Row {
  return {
    id: a.id,
    name: a.name,
    done: a.status === "PUBLISHED",
    cells: {
      status: { value: STATUS_TO_OS[a.status], label: STATUS_LABELS[a.status] },
      slug: `/build/${a.slug}`,
      hue: a.hue ?? "—",
      description: a.description ? (a.description.length > 60 ? a.description.slice(0, 60) + "…" : a.description) : "—",
      updated: { iso: a.updatedAt },
      created: { iso: a.createdAt },
    },
  };
}

function buildGroups(rows: ApiApp[]): TableGroup[] {
  const buckets = new Map<AppStatus, ApiApp[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const a of rows) {
    if (a.status === "ARCHIVED") continue;
    const b = buckets.get(a.status);
    if (b) b.push(a);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(appToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "DRAFT");
}

const COLUMNS: Column[] = [
  { id: "status",      label: "Status",      type: "status" },
  { id: "slug",        label: "Route",       type: "text" },
  { id: "hue",         label: "Hue",         type: "text" },
  { id: "description", label: "Description", type: "text" },
  { id: "updated",     label: "Updated",     type: "date" },
  { id: "created",     label: "Created",     type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function BuildPage() {
  const [rows, setRows] = useState<ApiApp[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/build/apps");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.apps ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("build");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  const handlers = {
    onAdd: async (_g: string) => {
      toast("Apps are AI-generated — open Build → prompt to scaffold one");
      throw new Error("not supported");
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((a): CalendarEvent => ({
      id: a.id,
      title: `${a.name} ${a.status === "PUBLISHED" ? "published" : "drafted"}`,
      date: a.updatedAt,
      color: STATUS_COLORS[a.status],
      done: a.status === "PUBLISHED",
      payload: appToRow(a).cells,
    })),
    [rows],
  );

  const publishedCount = (rows ?? []).filter((a) => a.status === "PUBLISHED").length;

  return (
    <>
      <OsTitleBar
        title="Build"
        Icon={Hammer}
        iconGradient={GRAD.purpleIndigo}
        description={rows === null ? "Loading apps…" : `${rows.length} app${rows.length === 1 ? "" : "s"} · ${publishedCount} published · AI-generated`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="Generate app" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Hammer} iconGradient={GRAD.redPink} title="Couldn't load apps" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Hammer} iconGradient={GRAD.purpleIndigo} title="No custom apps yet" subtitle="Describe what you want — Claude scaffolds a real board with the right columns, status enum, and sample rows. Every app gets its own route." chips={["Prompt", "Schema", "Preview", "Publish"]} cta="Generate app" />
          ) : (
            <OsMainTable moduleId="build" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="build" events={calendarEvents} newLabel="Generate app" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Hammer} iconGradient={GRAD.purpleIndigo} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
