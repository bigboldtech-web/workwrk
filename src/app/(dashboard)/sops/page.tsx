"use client";

/* Real, persistent SOPs page.
 *
 *  GET   /api/sops
 *  POST  /api/sops               { title, content?, category? }
 *  PATCH /api/sops/[id]          { status?, title?, ... }
 *
 *  Status enum: DRAFT | IN_REVIEW | APPROVED | PUBLISHED | ARCHIVED
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookCopy, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
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

type SopStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED";

type ApiSop = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  status: SopStatus;
  version: number;
  tags?: string[];
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_TO_OS: Record<SopStatus, StatusValue> = {
  DRAFT: "planning", IN_REVIEW: "review", APPROVED: "progress",
  PUBLISHED: "done", ARCHIVED: "empty",
};
const STATUS_LABELS: Record<SopStatus, string> = {
  DRAFT: "Draft", IN_REVIEW: "In review", APPROVED: "Approved",
  PUBLISHED: "Published", ARCHIVED: "Archived",
};
const STATUS_COLORS: Record<SopStatus, string> = {
  DRAFT: C.indigo, IN_REVIEW: C.purple, APPROVED: C.blue,
  PUBLISHED: C.green, ARCHIVED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as SopStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

const GROUP_ORDER: SopStatus[] = ["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED"];

function sopToRow(s: ApiSop): Row {
  return {
    id: s.id,
    name: s.title,
    done: s.status === "PUBLISHED",
    cells: {
      status: { value: STATUS_TO_OS[s.status], label: STATUS_LABELS[s.status] },
      category: s.category ?? "—",
      tags: s.tags && s.tags.length > 0 ? s.tags.slice(0, 3).join(", ") : "—",
      version: `v${s.version}`,
      published: s.publishedAt ? { iso: s.publishedAt, state: "done" } : undefined,
      updated: { iso: s.updatedAt },
    },
  };
}

function buildGroups(rows: ApiSop[]): TableGroup[] {
  const buckets = new Map<SopStatus, ApiSop[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const s of rows) {
    if (s.status === "ARCHIVED") continue;
    const b = buckets.get(s.status);
    if (b) b.push(s);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: STATUS_LABELS[s], color: STATUS_COLORS[s],
      rows: (buckets.get(s) ?? []).map(sopToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "DRAFT" || g.id === "PUBLISHED");
}

const COLUMNS: Column[] = [
  { id: "status",    label: "Status",   type: "status" },
  { id: "category",  label: "Category", type: "text" },
  { id: "tags",      label: "Tags",     type: "text" },
  { id: "version",   label: "Version",  type: "text" },
  { id: "published", label: "Published", type: "date" },
  { id: "updated",   label: "Updated",  type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function SopsPage() {
  const [rows, setRows] = useState<ApiSop[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sops?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiSop[] = data?.data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
      setRows(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("sops");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 403) toast("You don't have permission to edit this SOP");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const ok = await patch(rowId, { status: value });
      if (!ok) throw new Error("save failed");
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      const ok = await patch(rowId, { title: name });
      if (!ok) throw new Error("save failed");
    },
    onAdd: async (_g: string) => {
      const res = await fetch("/api/sops", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled SOP", content: {} }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const s: ApiSop = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: s.id, name: s.title };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((s): CalendarEvent => ({
      id: s.id,
      title: `${s.title}${s.version > 1 ? ` (v${s.version})` : ""}`,
      date: s.publishedAt ?? s.updatedAt,
      color: STATUS_COLORS[s.status],
      done: s.status === "PUBLISHED",
      payload: sopToRow(s).cells,
    })),
    [rows],
  );

  const publishedCount = (rows ?? []).filter((s) => s.status === "PUBLISHED").length;

  return (
    <>
      <OsTitleBar
        title="SOPs"
        Icon={BookCopy}
        iconGradient={GRAD.tealGreen}
        description={rows === null ? "Loading SOPs…" : `${rows.length} SOP${rows.length === 1 ? "" : "s"} · ${publishedCount} published · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={5}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New SOP" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={BookCopy} iconGradient={GRAD.redPink} title="Couldn't load SOPs" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={BookCopy} iconGradient={GRAD.tealGreen} title="No SOPs yet" subtitle="Document a process once, then assign it to teammates. SOPs version automatically as you edit." chips={["Draft", "In review", "Approved", "Published"]} cta="New SOP" />
          ) : (
            <OsMainTable moduleId="sops" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="sops" events={calendarEvents} newLabel="New SOP" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={BookCopy} iconGradient={GRAD.tealGreen} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
