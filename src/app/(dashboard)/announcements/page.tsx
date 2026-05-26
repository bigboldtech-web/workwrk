"use client";

/* Real, persistent Announcements page.
 *
 *  GET   /api/announcements             list (org-wide, non-expired)
 *  POST  /api/announcements             { title, content, type?, priority?, ... }
 *  PATCH /api/announcements/[id]        { title?, content?, type?, priority?, pinned?, ... }
 *
 *  Type (string): INFO | WARNING | CELEBRATION | POLICY | EVENT
 *  Priority (string): LOW | NORMAL | HIGH | URGENT
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row, type StatusValue, type PrioValue } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type AnnType = "INFO" | "WARNING" | "CELEBRATION" | "POLICY" | "EVENT";
type AnnPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";

type ApiAnn = {
  id: string;
  title: string;
  content: string;
  type: AnnType;
  priority: AnnPrio;
  pinned: boolean;
  mustAcknowledge: boolean;
  publishedAt?: string | null;
  expiresAt?: string | null;
  authorId: string;
  createdAt: string;
  ackedByMe?: boolean;
};

const TYPE_TO_OS: Record<AnnType, StatusValue> = {
  INFO: "progress", WARNING: "stuck", CELEBRATION: "done",
  POLICY: "review", EVENT: "pending",
};
const PRIO_TO_OS: Record<AnnPrio, PrioValue> = {
  LOW: "low", NORMAL: "medium", HIGH: "high", URGENT: "critical",
};
const TYPE_LABELS: Record<AnnType, string> = {
  INFO: "Info", WARNING: "Warning", CELEBRATION: "Celebration",
  POLICY: "Policy", EVENT: "Event",
};
const TYPE_COLORS: Record<AnnType, string> = {
  INFO: C.blue, WARNING: C.red, CELEBRATION: C.pink, POLICY: C.purple, EVENT: C.orange,
};

const STATUS_OPTIONS: PickerOption[] = (Object.keys(TYPE_LABELS) as AnnType[]).map((t) => ({
  value: t, label: TYPE_LABELS[t], color: TYPE_COLORS[t],
}));
const PRIO_OPTIONS: PickerOption[] = [
  { value: "URGENT", label: "Urgent", color: C.pink },
  { value: "HIGH",   label: "High",   color: C.red },
  { value: "NORMAL", label: "Normal", color: C.yellow },
  { value: "LOW",    label: "Low",    color: C.teal },
];

const GROUP_ORDER: AnnPrio[] = ["URGENT", "HIGH", "NORMAL", "LOW"];
const GROUP_LABELS: Record<AnnPrio, string> = {
  URGENT: "Urgent", HIGH: "High priority", NORMAL: "Normal", LOW: "Low priority",
};
const GROUP_COLORS: Record<AnnPrio, string> = {
  URGENT: C.pink, HIGH: C.red, NORMAL: C.blue, LOW: C.teal,
};

function annToRow(a: ApiAnn): Row {
  return {
    id: a.id,
    name: a.title,
    cells: {
      type: { value: TYPE_TO_OS[a.type], label: TYPE_LABELS[a.type] },
      prio: { value: PRIO_TO_OS[a.priority] },
      pinned: a.pinned ? "★ Pinned" : "—",
      ack: a.mustAcknowledge ? (a.ackedByMe ? "✓ Acked" : "Required") : "—",
      published: a.publishedAt ? { iso: a.publishedAt } : undefined,
      expires: a.expiresAt ? { iso: a.expiresAt } : undefined,
    },
  };
}

function buildGroups(rows: ApiAnn[]): TableGroup[] {
  const buckets = new Map<AnnPrio, ApiAnn[]>();
  for (const s of GROUP_ORDER) buckets.set(s, []);
  for (const r of rows) {
    const b = buckets.get(r.priority);
    if (b) b.push(r);
  }
  return GROUP_ORDER
    .map((s) => ({
      id: s, title: GROUP_LABELS[s], color: GROUP_COLORS[s],
      rows: (buckets.get(s) ?? []).map(annToRow),
    }))
    .filter((g) => g.rows.length > 0 || g.id === "NORMAL" || g.id === "HIGH");
}

const COLUMNS: Column[] = [
  { id: "type",      label: "Type",     type: "status" },
  { id: "prio",      label: "Priority", type: "priority" },
  { id: "pinned",    label: "Pinned",   type: "text" },
  { id: "ack",       label: "Acknowledge", type: "text" },
  { id: "published", label: "Published", type: "date" },
  { id: "expires",   label: "Expires",  type: "date" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function AnnouncementsPage() {
  const [rows, setRows] = useState<ApiAnn[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/announcements");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : (data.data ?? []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("announcements");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/announcements/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can edit announcements");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  const handlers = {
    onStatusChange: async (rowId: string, _g: string, value: string) => {
      const ok = await patch(rowId, { type: value });
      if (!ok) throw new Error("save failed");
    },
    onPrioChange: async (rowId: string, _g: string, value: string) => {
      const ok = await patch(rowId, { priority: value });
      if (!ok) throw new Error("save failed");
    },
    onRename: async (rowId: string, _g: string, name: string) => {
      const ok = await patch(rowId, { title: name });
      if (!ok) throw new Error("save failed");
    },
    onAdd: async (groupId: string) => {
      const res = await fetch("/api/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled announcement",
          content: "Write the announcement…",
          type: "INFO",
          priority: groupId,
        }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Only managers can post announcements");
        throw new Error(`POST ${res.status}`);
      }
      const data = await res.json();
      const a: ApiAnn = data.data ?? data;
      setTimeout(() => void load(), 200);
      return { id: a.id, name: a.title };
    },
  };

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => (rows ?? []).map((a): CalendarEvent => ({
      id: a.id,
      title: `${a.pinned ? "📌 " : ""}${a.title}`,
      date: a.publishedAt ?? a.createdAt,
      color: TYPE_COLORS[a.type],
      payload: annToRow(a).cells,
    })),
    [rows],
  );

  const ackRequired = (rows ?? []).filter((a) => a.mustAcknowledge && !a.ackedByMe).length;

  return (
    <>
      <OsTitleBar
        title="Announcements"
        Icon={Megaphone}
        iconGradient={GRAD.orangePink}
        description={rows === null ? "Loading announcements…" : `${rows.length} announcement${rows.length === 1 ? "" : "s"}${ackRequired > 0 ? ` · ${ackRequired} need your ack` : ""} · live-synced`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={5}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="New announcement" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={Megaphone} iconGradient={GRAD.redPink} title="Couldn't load announcements" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : rows === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <OsEmptyView Icon={Megaphone} iconGradient={GRAD.orangePink} title="No announcements yet" subtitle="Broadcast org-wide updates. Use Urgent for outages, Policy for rule changes, Celebration for wins." chips={["Info", "Warning", "Policy", "Event", "Celebration"]} cta="New announcement" />
          ) : (
            <OsMainTable moduleId="announcements" columns={COLUMNS} groups={groups} statusOptions={STATUS_OPTIONS} prioOptions={PRIO_OPTIONS} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="announcements" events={calendarEvents} newLabel="New announcement" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={Megaphone} iconGradient={GRAD.orangePink} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
